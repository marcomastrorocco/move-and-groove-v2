import { NextRequest, NextResponse } from 'next/server'
import { isGenerationSource } from '@/lib/generation-source'
import { createAccessTokenClient, createAuthClient } from '@/lib/supabase/admin'

type RoutineItemRow = {
  pillar: 'prep' | 'release' | 'activation' | 'range'
  exercise_name: string
  target_area: string
  sets: number
  reps: number | null
  hold_seconds: number | null
  rationale: string | null
  study_citation: string | null
  order_index: number
}

const PHASE_DESCRIPTIONS: Record<RoutineItemRow['pillar'], string> = {
  prep: 'Foam-roll prep to reduce stiffness before the main mobility work starts.',
  release: 'Release work to reduce stiffness and prepare the area for stronger movement.',
  activation: 'Activation work to switch on control and support the range you just opened.',
  range: 'Range work to own the new motion with strength and usable control.',
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
    throw new Error('Missing routine access token.')
  }

  const authClient = createAuthClient(accessToken)
  const {
    data: { user },
    error,
  } = await authClient.auth.getUser(accessToken)

  if (error || !user) {
    throw new Error('Routine request is not authenticated.')
  }

  return {
    accessToken,
    userId: user.id,
  }
}

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params
    const routineId = Number(id)

    if (!Number.isInteger(routineId) || routineId <= 0) {
      return NextResponse.json({ error: 'Invalid routine id.' }, { status: 400 })
    }

    const { accessToken, userId } = await validateUser(req)
    const supabase = createAccessTokenClient(accessToken)

    const { data: routineRow, error: routineError } = await supabase
      .from('routines')
      .select('*')
      .eq('id', routineId)
      .eq('user_id', userId)
      .maybeSingle<{
        id: number
        title: string
        sport: string | null
        areas: string[] | null
        duration_minutes: number | null
        goal: string | null
        difficulty: string | null
        summary: string | null
        evidence_summary: string | null
        generation_source?: string | null
      }>()

    if (routineError) {
      throw routineError
    }

    if (!routineRow) {
      return NextResponse.json({ error: 'Routine not found.' }, { status: 404 })
    }

    const { data: itemRows, error: itemsError } = await supabase
      .from('routine_items')
      .select('pillar,exercise_name,target_area,sets,reps,hold_seconds,rationale,study_citation,order_index')
      .eq('routine_id', routineId)
      .order('order_index', { ascending: true })

    if (itemsError) {
      throw itemsError
    }

    const groupedByPhase = (itemRows || []).reduce<Record<RoutineItemRow['pillar'], RoutineItemRow[]>>(
      (acc, item) => {
        const pillar = item.pillar as RoutineItemRow['pillar']
        acc[pillar].push(item as RoutineItemRow)
        return acc
      },
      {
        prep: [],
        release: [],
        activation: [],
        range: [],
      },
    )

    const phases = (['prep', 'release', 'activation', 'range'] as const)
      .filter((pillar) => groupedByPhase[pillar].length > 0)
      .map((pillar) => ({
        pillar,
        phaseDescription: PHASE_DESCRIPTIONS[pillar],
        exercises: groupedByPhase[pillar].map((item) => ({
          videoId: null,
          name: item.exercise_name,
          targetArea: item.target_area,
          sets: item.sets,
          reps: item.reps,
          holdSeconds: item.hold_seconds,
          rationale: item.rationale || '',
          study: item.study_citation || '',
          isFoamRoll: pillar === 'prep',
        })),
      }))

    return NextResponse.json({
      routine: {
        routineTitle: routineRow.title,
        summary: routineRow.summary || '',
        difficultyLevel: routineRow.difficulty || 'Guided',
        totalExercises: phases.reduce((sum, phase) => sum + phase.exercises.length, 0),
        phases,
        evidenceSummary: routineRow.evidence_summary || '',
        generationSource: isGenerationSource(routineRow.generation_source) ? routineRow.generation_source : undefined,
        savedId: routineRow.id,
      },
      sport: routineRow.sport,
      areas: routineRow.areas || [],
      duration: routineRow.duration_minutes || 0,
      goal: routineRow.goal,
    })
  } catch (error) {
    console.error('[routines.read]', error)
    const message = error instanceof Error ? error.message : 'Could not load routine.'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
