import { NextRequest, NextResponse } from 'next/server'
import { readDailyWorkoutLimit } from '@/lib/app-config'
import { createAccessTokenClient, createAuthClient, createServiceRoleClient } from '@/lib/supabase/admin'

type ProgressRow = {
  user_id: string
  routine_id?: number | null
  duration_minutes?: number | null
  completed_at?: string | null
  sport?: string | null
  areas?: string[] | null
  goal?: string | null
}

type ProgressPayload = {
  row?: ProgressRow
}

type ProgressReadRow = {
  id?: string | number
  user_id: string
  routine_id?: number | null
  duration_minutes?: number | null
  completed_at?: string | null
  created_at?: string | null
  sport?: string | null
  areas?: string[] | null
  goal?: string | null
}

type ProgressWriteRow = {
  user_id: string
  routine_id?: number | null
  duration_minutes?: number | null
  completed_at?: string | null
  sport?: string | null
  areas?: string[] | null
  goal?: string | null
}

function startOfTodayUtcIso() {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString()
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message
  }

  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') {
    return error.message
  }

  return null
}

function looksLikeSchemaMismatch(error: unknown) {
  const message = getErrorMessage(error)?.toLowerCase() || ''

  return (
    message.includes('column') ||
    message.includes('schema cache') ||
    message.includes('could not find') ||
    message.includes('does not exist') ||
    message.includes('pgrst')
  )
}

function looksLikeAccessPolicyIssue(error: unknown) {
  const message = getErrorMessage(error)?.toLowerCase() || ''

  return (
    message.includes('row-level security') ||
    message.includes('violates row-level security policy') ||
    message.includes('permission denied') ||
    message.includes('insufficient privilege') ||
    message.includes('not authenticated') ||
    message.includes('jwt')
  )
}

function getMissingColumnName(error: unknown) {
  const message = getErrorMessage(error)
  const quotedMatch = message?.match(/'([^']+)' column/)
  if (quotedMatch?.[1]) {
    return quotedMatch[1]
  }

  const postgresMatch = message?.match(/column\s+[\w.]*?([a-zA-Z_][a-zA-Z0-9_]*)\s+does not exist/i)
  return postgresMatch?.[1] || null
}

function withoutUnknownColumn(row: ProgressWriteRow, columnName: string | null) {
  if (!columnName || !(columnName in row)) {
    return row
  }

  const nextRow = { ...row }
  delete nextRow[columnName as keyof ProgressWriteRow]
  return nextRow
}

function mapProgressRows(rows: ProgressReadRow[]) {
  return rows.map((row) => ({
    id: row.id ?? null,
    user_id: row.user_id,
    routine_id: row.routine_id ?? null,
    duration_minutes: row.duration_minutes ?? null,
    completed_at: row.completed_at ?? null,
    created_at: row.created_at ?? null,
    sport: row.sport ?? null,
    areas: Array.isArray(row.areas) ? row.areas : null,
    goal: row.goal ?? null,
  }))
}

function readAccessToken(req: NextRequest) {
  const authHeader = req.headers.get('authorization') || ''
  return authHeader.startsWith('Bearer ')
    ? authHeader.slice('Bearer '.length).trim()
    : ''
}

async function validateUser(req: NextRequest) {
  const accessToken = readAccessToken(req)

  if (!accessToken) {
    throw new Error('Missing progress access token.')
  }

  const authClient = createAuthClient(accessToken)
  const {
    data: { user },
    error,
  } = await authClient.auth.getUser(accessToken)

  if (error || !user) {
    throw new Error('Progress request is not authenticated.')
  }

  return {
    accessToken,
    userId: user.id,
  }
}

async function readProgressRows(
  progressClient: ReturnType<typeof createAccessTokenClient> | ReturnType<typeof createServiceRoleClient>,
  userId: string,
) {
  const { data, error } = await progressClient
    .from('progress')
    .select('id,user_id,routine_id,duration_minutes,completed_at,created_at,sport,areas,goal')
    .eq('user_id', userId)
    .order('completed_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })

  if (!error) {
    return mapProgressRows((data || []) as ProgressReadRow[])
  }

  if (!looksLikeSchemaMismatch(error)) {
    throw error
  }

  const { data: fallbackData, error: fallbackError } = await progressClient
    .from('progress')
    .select('id,user_id,duration_minutes,created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })

  if (fallbackError) {
    throw fallbackError
  }

  return mapProgressRows((fallbackData || []) as ProgressReadRow[])
}

async function findExistingProgressId(
  progressClient: ReturnType<typeof createAccessTokenClient> | ReturnType<typeof createServiceRoleClient>,
  userId: string,
  completedAt: string,
  routineId: number | null,
) {
  let existingQuery = progressClient
    .from('progress')
    .select('id')
    .eq('user_id', userId)
    .eq('completed_at', completedAt)
    .limit(1)

  existingQuery = routineId == null
    ? existingQuery.is('routine_id', null)
    : existingQuery.eq('routine_id', routineId)

  const { data, error } = await existingQuery.maybeSingle<{ id: string }>()

  if (!error) {
    return data?.id || null
  }

  if (looksLikeSchemaMismatch(error)) {
    return null
  }

  throw error
}

async function countCompletedWorkoutsToday(
  progressClient: ReturnType<typeof createAccessTokenClient>,
  userId: string,
) {
  const { count, error } = await progressClient
    .from('progress')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .gte('completed_at', startOfTodayUtcIso())

  if (error) {
    throw error
  }

  return count || 0
}

// Pro accounts bypass the routine-generation cap in /api/routines/generate,
// so the completion cap has to honour the same entitlement or a Pro user can
// generate routines they are then blocked from logging. Mirrors the tolerance
// there too: some projects never provisioned the legacy profiles table, and a
// missing table must not change enforcement for anyone else.
async function readIsProFlag(
  progressClient: ReturnType<typeof createAccessTokenClient>,
  userId: string,
) {
  const { data, error } = await progressClient
    .from('profiles')
    .select('is_pro')
    .eq('id', userId)
    .maybeSingle<{ is_pro?: boolean | null }>()

  if (error) {
    console.warn('[progress.profile]', error.message)
    return false
  }

  return Boolean(data?.is_pro)
}

async function insertProgressRow(
  progressClient: ReturnType<typeof createAccessTokenClient> | ReturnType<typeof createServiceRoleClient>,
  baseRow: ProgressWriteRow,
) {
  let row = { ...baseRow }

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const { data, error } = await progressClient
      .from('progress')
      .insert([row])
      .select('id')
      .single<{ id: string }>()

    if (!error) {
      return {
        id: data.id,
        storedKeys: Object.keys(row),
      }
    }

    if (!looksLikeSchemaMismatch(error)) {
      throw error
    }

    const nextRow = withoutUnknownColumn(row, getMissingColumnName(error))
    if (Object.keys(nextRow).length === Object.keys(row).length) {
      throw error
    }

    row = nextRow
  }

  throw new Error('Could not write progress with the current table schema.')
}

export async function GET(req: NextRequest) {
  try {
    const { accessToken, userId } = await validateUser(req)
    const progressClient = createAccessTokenClient(accessToken)

    try {
      return NextResponse.json({ progress: await readProgressRows(progressClient, userId) })
    } catch (error) {
      if (!looksLikeAccessPolicyIssue(error)) {
        throw error
      }

      const serviceClient = createServiceRoleClient()
      const progress = await readProgressRows(serviceClient, userId)

      console.info('[progress.read]', {
        mode: 'service-role-fallback',
        userId,
        count: progress.length,
      })

      return NextResponse.json({ progress })
    }
  } catch (error) {
    console.error('[progress.read]', error)
    return NextResponse.json(
      { error: getErrorMessage(error) || 'Could not read progress.' },
      { status: 500 },
    )
  }
}

export async function POST(req: NextRequest) {
  try {
    const { accessToken, userId } = await validateUser(req)
    const body = await req.json() as ProgressPayload
    const row = body.row

    if (!row || row.user_id !== userId) {
      return NextResponse.json({ error: 'Progress payload is missing or user-scoped incorrectly.' }, { status: 400 })
    }

    if (typeof row.duration_minutes !== 'number' || !Number.isInteger(row.duration_minutes) || row.duration_minutes < 1 || row.duration_minutes > 45) {
      return NextResponse.json({ error: 'Workout duration must be between 1 and 45 minutes.' }, { status: 400 })
    }

    const progressClient = createAccessTokenClient(accessToken)
    const completedAt = row.completed_at || new Date().toISOString()
    let existingId: string | null = null

    try {
      existingId = await findExistingProgressId(progressClient, userId, completedAt, row.routine_id ?? null)
    } catch (error) {
      if (!looksLikeAccessPolicyIssue(error)) {
        throw error
      }
      const serviceClient = createServiceRoleClient()
      existingId = await findExistingProgressId(serviceClient, userId, completedAt, row.routine_id ?? null)
    }

    if (existingId) {
      console.info('[progress.write]', {
        mode: 'existing',
        userId,
        routineId: row.routine_id ?? null,
        completedAt,
        id: existingId,
      })
      return NextResponse.json({ ok: true, mode: 'existing', id: existingId })
    }

    const [completedWorkoutsToday, isPro, dailyWorkoutLimit] = await Promise.all([
      countCompletedWorkoutsToday(progressClient, userId),
      readIsProFlag(progressClient, userId),
      readDailyWorkoutLimit(progressClient as never),
    ])
    if (!isPro && completedWorkoutsToday >= dailyWorkoutLimit) {
      return NextResponse.json(
        {
          error: 'DAILY_WORKOUT_LIMIT_REACHED',
          message: `You have already logged ${dailyWorkoutLimit} ${dailyWorkoutLimit === 1 ? 'workout' : 'workouts'} today.`,
        },
        { status: 429 },
      )
    }

    const rowToWrite: ProgressWriteRow = {
      user_id: userId,
      routine_id: row.routine_id ?? null,
      duration_minutes: row.duration_minutes ?? null,
      completed_at: completedAt,
      sport: row.sport ?? null,
      areas: row.areas ?? null,
      goal: row.goal ?? null,
    }

    try {
      const inserted = await insertProgressRow(progressClient, rowToWrite)
      console.info('[progress.write]', {
        mode: 'inserted',
        userId,
        routineId: row.routine_id ?? null,
        completedAt,
        id: inserted.id,
        storedKeys: inserted.storedKeys,
      })
      return NextResponse.json({ ok: true, mode: 'inserted', id: inserted.id })
    } catch (error) {
      if (!looksLikeAccessPolicyIssue(error)) {
        throw error
      }

      const serviceClient = createServiceRoleClient()
      const inserted = await insertProgressRow(serviceClient, rowToWrite)
      console.info('[progress.write]', {
        mode: 'service-role-fallback',
        userId,
        routineId: row.routine_id ?? null,
        completedAt,
        id: inserted.id,
        storedKeys: inserted.storedKeys,
      })
      return NextResponse.json({ ok: true, mode: 'service-role-fallback', id: inserted.id })
    }
  } catch (error) {
    console.error('[progress.write]', {
      message: getErrorMessage(error),
      error,
    })
    return NextResponse.json(
      { error: getErrorMessage(error) || 'Could not write progress.' },
      { status: 500 },
    )
  }
}
