import { NextRequest, NextResponse } from 'next/server'
import { isGenerationSource, type GenerationSource } from '@/lib/generation-source'
import { createAccessTokenClient, createAuthClient } from '@/lib/supabase/admin'

type RoutineExercise = {
  videoId: null
  name: string
  targetArea: string
  sets: number
  reps: number | null
  holdSeconds: number | null
  rationale: string
  study: string
  isFoamRoll?: boolean
}

type RoutinePhase = {
  pillar: 'prep' | 'release' | 'activation' | 'range'
  phaseDescription: string
  exercises: RoutineExercise[]
}

type Routine = {
  routineTitle: string
  summary: string
  generationSource?: GenerationSource
  difficultyLevel: string
  totalExercises: number
  phases: RoutinePhase[]
  evidenceSummary: string
}

type SaveRoutineRequest = {
  userId: string
  routine: Routine
  sport?: string | null
  areas?: string[]
  duration?: number
  goal?: string | null
}

function readAccessToken(req: NextRequest) {
  const authHeader = req.headers.get('authorization') || ''
  return authHeader.startsWith('Bearer ')
    ? authHeader.slice('Bearer '.length).trim()
    : ''
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message
  }

  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') {
    return error.message
  }

  return 'Could not save routine. Please try again.'
}

export async function POST(req: NextRequest) {
  try {
    const { userId, routine, sport, areas, duration, goal } = await req.json() as SaveRoutineRequest
    const accessToken = readAccessToken(req)

    if (!userId || !routine || !accessToken) {
      return NextResponse.json({ error: 'Missing required routine save payload.' }, { status: 400 })
    }

    const authClient = createAuthClient(accessToken)
    const supabase = createAccessTokenClient(accessToken)

    const {
      data: { user },
      error: authError,
    } = await authClient.auth.getUser(accessToken)

    if (authError || !user || user.id !== userId) {
      return NextResponse.json({ error: 'Routine save is not authorized for this user.' }, { status: 401 })
    }

    const targetAreas = areas && areas.length > 0 ? areas : ['hips', 'shoulders', 'spine']
    // Routines cached before source tracking have no provenance to carry forward.
    const generationSource = isGenerationSource(routine.generationSource)
      ? routine.generationSource
      : 'curated_fallback'

    const { data: savedRoutine, error: routineError } = await supabase
      .from('routines')
      .insert([{
        user_id: userId,
        title: routine.routineTitle,
        sport: sport || null,
        areas: targetAreas,
        goal: goal || null,
        duration_minutes: duration || null,
        difficulty: routine.difficultyLevel,
        summary: routine.summary,
        evidence_summary: routine.evidenceSummary,
        generation_source: generationSource,
      }])
      .select()
      .single()

    if (routineError) {
      throw routineError
    }

    const items: Array<{
      routine_id: number
      video_id: null
      pillar: string
      exercise_name: string
      target_area: string
      sets: number
      reps: number | null
      hold_seconds: number | null
      rationale: string
      study_citation: string
      order_index: number
    }> = []

    routine.phases.forEach((phase, phaseIndex) => {
      phase.exercises.forEach((exercise, exerciseIndex) => {
        items.push({
          routine_id: savedRoutine.id,
          video_id: null,
          pillar: phase.pillar,
          exercise_name: exercise.name,
          target_area: exercise.targetArea,
          sets: exercise.sets,
          reps: exercise.reps || null,
          hold_seconds: exercise.holdSeconds || null,
          rationale: exercise.rationale,
          study_citation: exercise.study,
          order_index: phaseIndex * 10 + exerciseIndex,
        })
      })
    })

    if (items.length > 0) {
      const { error: itemsError } = await supabase.from('routine_items').insert(items)
      if (itemsError) {
        throw itemsError
      }
    }

    return NextResponse.json({ savedId: savedRoutine.id })
  } catch (err: unknown) {
    console.error('[routines.save]', err)
    return NextResponse.json({ error: getErrorMessage(err) }, { status: 500 })
  }
}
