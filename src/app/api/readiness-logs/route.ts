import { NextRequest, NextResponse } from 'next/server'
import { createAccessTokenClient, createAuthClient } from '@/lib/supabase/admin'

type ReadinessLogPayload = {
  row?: Record<string, unknown>
}

type SanitizedReadinessRow = {
  user_id: string
  date: string
  session_type: 'pre' | 'post'
  sleep_quality: number | null
  energy_level: number | null
  soreness_level: number | null
  niggled_region: string | null
  training_context: string | null
  intensity_modifier: string | null
  avoid_passive_holds: boolean
  reduce_region: string | null
}

type ReadinessTableRow = SanitizedReadinessRow & {
  id?: string
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message
  }

  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') {
    return error.message
  }

  return 'Unknown error'
}

function toNullableNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function toNullableString(value: unknown) {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function looksLikeSchemaMismatch(error: unknown) {
  const message = getErrorMessage(error).toLowerCase()

  return (
    message.includes('schema cache') ||
    message.includes('could not find') ||
    message.includes('does not exist') ||
    message.includes('column ')
  )
}

function getMissingColumnName(error: unknown) {
  const message = getErrorMessage(error)
  const quotedMatch = message.match(/'([^']+)' column/)
  if (quotedMatch?.[1]) {
    return quotedMatch[1]
  }

  const postgresMatch = message.match(/column\s+[\w.]*?([a-zA-Z_][a-zA-Z0-9_]*)\s+does not exist/i)
  return postgresMatch?.[1] || null
}

function getReadinessSchemaError(error: unknown) {
  const message = getErrorMessage(error)
  const lower = message.toLowerCase()

  if (lower.includes('double precision') && (lower.includes('modified') || lower.includes('recovery'))) {
    return 'Supabase schema mismatch: readiness_logs.intensity_modifier must be a text column, not double precision.'
  }

  return null
}

function withoutUnknownColumn(row: SanitizedReadinessRow, columnName: string | null) {
  if (!columnName) {
    return row
  }

  if (!(columnName in row)) {
    return row
  }

  const nextRow = { ...row }
  delete nextRow[columnName as keyof SanitizedReadinessRow]
  return nextRow
}

function sanitizeReadinessRow(rawRow: Record<string, unknown>, userId: string): SanitizedReadinessRow | null {
  const date = typeof rawRow.date === 'string' ? rawRow.date.trim() : ''
  const sessionType = rawRow.session_type === 'pre' || rawRow.session_type === 'post'
    ? rawRow.session_type
    : null

  if (!date || !sessionType) {
    return null
  }

  return {
    user_id: userId,
    date,
    session_type: sessionType,
    sleep_quality: toNullableNumber(rawRow.sleep_quality),
    energy_level: toNullableNumber(rawRow.energy_level),
    soreness_level: toNullableNumber(rawRow.soreness_level),
    niggled_region: toNullableString(rawRow.niggled_region),
    training_context: toNullableString(rawRow.training_context),
    intensity_modifier: toNullableString(rawRow.intensity_modifier),
    avoid_passive_holds: rawRow.avoid_passive_holds === true,
    reduce_region: toNullableString(rawRow.reduce_region),
  }
}

async function findExistingReadinessRow(
  readinessClient: ReturnType<typeof createAccessTokenClient>,
  userId: string,
  date: string,
  sessionType: 'pre' | 'post',
) {
  const ordered = await readinessClient
    .from('readiness_logs')
    .select('id')
    .eq('user_id', userId)
    .eq('date', date)
    .eq('session_type', sessionType)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle<ReadinessTableRow>()

  if (!ordered.error) {
    return ordered.data
  }

  if (!looksLikeSchemaMismatch(ordered.error)) {
    throw ordered.error
  }

  const fallback = await readinessClient
    .from('readiness_logs')
    .select('id')
    .eq('user_id', userId)
    .eq('date', date)
    .eq('session_type', sessionType)
    .limit(1)
    .maybeSingle<ReadinessTableRow>()

  if (fallback.error) {
    throw fallback.error
  }

  return fallback.data
}

async function writeReadinessRow(
  readinessClient: ReturnType<typeof createAccessTokenClient>,
  baseRow: SanitizedReadinessRow,
) {
  let row = { ...baseRow }

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const existing = await findExistingReadinessRow(
      readinessClient,
      row.user_id,
      row.date,
      row.session_type,
    )

    if (existing?.id) {
      const { error: updateError } = await readinessClient
        .from('readiness_logs')
        .update(row)
        .eq('id', existing.id)

      if (!updateError) {
        return { mode: 'updated', id: existing.id, row }
      }

      if (!looksLikeSchemaMismatch(updateError)) {
        throw updateError
      }

      const nextRow = withoutUnknownColumn(row, getMissingColumnName(updateError))
      if (Object.keys(nextRow).length === Object.keys(row).length) {
        throw updateError
      }
      row = nextRow
      continue
    }

    const { error: insertError } = await readinessClient
      .from('readiness_logs')
      .insert([row])

    if (!insertError) {
      return { mode: 'inserted', id: null, row }
    }

    if (!looksLikeSchemaMismatch(insertError)) {
      throw insertError
    }

    const nextRow = withoutUnknownColumn(row, getMissingColumnName(insertError))
    if (Object.keys(nextRow).length === Object.keys(row).length) {
      throw insertError
    }
    row = nextRow
  }

  throw new Error('Could not write readiness log with the current table schema.')
}

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('authorization') || ''
  const accessToken = authHeader.startsWith('Bearer ')
    ? authHeader.slice('Bearer '.length).trim()
    : ''

  if (!accessToken) {
    return NextResponse.json({ error: 'Missing readiness access token.' }, { status: 401 })
  }

  try {
    const authClient = createAuthClient(accessToken)
    const {
      data: { user },
      error: authError,
    } = await authClient.auth.getUser(accessToken)

    if (authError || !user) {
      console.error('[readiness-logs.auth]', authError)
      return NextResponse.json({ error: 'Readiness request is not authenticated.' }, { status: 401 })
    }

    const body = await req.json() as ReadinessLogPayload
    const row = sanitizeReadinessRow(body.row || {}, user.id)

    if (!row) {
      return NextResponse.json({ error: 'Readiness payload is incomplete or user-scoped incorrectly.' }, { status: 400 })
    }

    const readinessClient = createAccessTokenClient(accessToken)
    const result = await writeReadinessRow(readinessClient, row)

    console.info('[readiness-logs.write]', {
      mode: result.mode,
      userId: user.id,
      sessionType: row.session_type,
      date: row.date,
      id: result.id,
      storedKeys: Object.keys(result.row),
    })

    return NextResponse.json({ ok: true, mode: result.mode, id: result.id })
  } catch (error) {
    const schemaError = getReadinessSchemaError(error)
    console.error('[readiness-logs.write]', {
      message: schemaError || getErrorMessage(error),
      error,
    })
    return NextResponse.json(
      { error: schemaError || getErrorMessage(error) || 'Could not write readiness log.' },
      { status: 500 },
    )
  }
}
