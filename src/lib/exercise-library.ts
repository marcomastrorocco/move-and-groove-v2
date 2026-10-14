import type { SupabaseClient } from '@supabase/supabase-js'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import {
  CURATED_ROUTINE_LIBRARY,
  type CuratedArea,
  type CuratedPillar,
  type CuratedRoutineExerciseTemplate,
} from '@/lib/curated-mobility'

export type ExerciseArea = CuratedArea
export type ExercisePhase = CuratedPillar | 'foam_roll'

export type ExerciseRecord = {
  id: string
  name: string
  area: ExerciseArea
  phase: ExercisePhase
  sets: number
  reps: number | null
  hold_seconds: number | null
  movement_pattern: 'rotational' | 'linear' | 'lateral' | null
  anatomical_quadrants: string[] | null
  rationale: string | null
  study_citation: string | null
  aliases: string[] | null
  youtube_id: string | null
  is_active: boolean
}

export type RoutineExerciseTemplate = CuratedRoutineExerciseTemplate
export type ExerciseLibrary = {
  routine: Record<ExerciseArea, Record<CuratedPillar, RoutineExerciseTemplate[]>>
  foamRoll: Record<ExerciseArea, RoutineExerciseTemplate[]>
  source: 'supabase' | 'fallback'
}

export class ExerciseLibraryUnavailableError extends Error {
  constructor() {
    super('Exercise library is temporarily unavailable. Please try again.')
  }
}

const EMPTY_ROUTINE_LIBRARY = (): ExerciseLibrary['routine'] => ({
  hips: { release: [], activation: [], range: [] },
  shoulders: { release: [], activation: [], range: [] },
  spine: { release: [], activation: [], range: [] },
})

const STATIC_FOAM_ROLL_LIBRARY: Record<ExerciseArea, RoutineExerciseTemplate[]> = {
  hips: [
    ['IT Band Roll', 'Side lying, roll hip to knee - pause on tender spots 5-10s.'],
    ['Glute / Piriformis Roll', 'Figure 4 position on roller - cross leg for deeper pressure.'],
    ['Hip Flexor Roll', 'Prone, roller under anterior hip - TFL and iliopsoas.'],
    ['Hamstring Roll', 'Seated on roller - proximal to distal, cross leg for more pressure.'],
    ['Quad Roll', 'Prone, roller under thigh - rectus femoris and vastus lateralis.'],
  ].map(([name, rationale]) => foamTemplate(name, 'hips', rationale)),
  shoulders: [
    ['Thoracic Spine Roll', 'Slow roll T1 to T12 - pause on tender spots, arms crossed.'],
    ['Lat Roll', 'Side lying arm overhead - latissimus dorsi and teres major.'],
    ['Pec Minor Roll', 'Prone, roller near shoulder - rotate to find pec minor.'],
    ['Posterior Shoulder Roll', 'Side lying, roller on posterior capsule - gentle rotation.'],
  ].map(([name, rationale]) => foamTemplate(name, 'shoulders', rationale)),
  spine: [
    ['Thoracic Spine Roll', 'Slow roll T1 to T12 - pause on tender spots, breathe into each segment.'],
    ['Thoracic Rotation Roll', 'T-spine rotation over roller - lateral thoracic and rib cage release.'],
    ['Lumbar Paraspinal Roll', 'Feet flat, hips up - roll slowly along paraspinals.'],
    ['QL / Hip Roll', 'Side lying at 45 degrees - quadratus lumborum and iliolumbar fascia.'],
  ].map(([name, rationale]) => foamTemplate(name, 'spine', rationale)),
}

function foamTemplate(name: string, targetArea: ExerciseArea, rationale: string): RoutineExerciseTemplate {
  return {
    name,
    targetArea,
    sets: 2,
    reps: null,
    holdSeconds: 60,
    rationale,
    study: 'Cheatham et al. (2015). The effects of self-myofascial release using a foam roll on joint ROM, muscle recovery, and performance. IJSPT.',
    movementPattern: 'linear',
    anatomicalQuadrants: [],
  }
}

function copyFallbackLibrary(): ExerciseLibrary {
  return {
    routine: CURATED_ROUTINE_LIBRARY,
    foamRoll: STATIC_FOAM_ROLL_LIBRARY,
    source: 'fallback',
  }
}

function isArea(value: string): value is ExerciseArea {
  return value === 'hips' || value === 'shoulders' || value === 'spine'
}

function isRoutinePhase(value: string): value is CuratedPillar {
  return value === 'release' || value === 'activation' || value === 'range'
}

function toTemplate(row: ExerciseRecord): RoutineExerciseTemplate | null {
  const hasReps = typeof row.reps === 'number'
  const hasHold = typeof row.hold_seconds === 'number'
  if (!isArea(row.area) || hasReps === hasHold || (hasReps && row.reps! < 6) || (hasHold && row.hold_seconds! < 20)) {
    return null
  }

  return {
    name: row.name,
    targetArea: row.area,
    sets: Math.max(1, row.sets),
    reps: row.reps,
    holdSeconds: row.hold_seconds,
    rationale: row.rationale || 'Controlled mobility work for the target area.',
    study: row.study_citation || 'Exercise prescription maintained in the Move & Groove clinical library.',
    aliases: row.aliases || [],
    movementPattern: row.movement_pattern === 'lateral' ? 'linear' : row.movement_pattern || 'linear',
    anatomicalQuadrants: row.anatomical_quadrants || [],
  }
}

export async function getActiveExerciseLibrary(client: SupabaseClient): Promise<ExerciseLibrary> {
  let data: ExerciseRecord[] | null = null
  try {
    const result = await client
      .from('exercises')
      .select('id, name, area, phase, sets, reps, hold_seconds, movement_pattern, anatomical_quadrants, rationale, study_citation, aliases, youtube_id, is_active')
      .eq('is_active', true)
      .order('area')
      .order('phase')
      .order('name')
      .abortSignal(AbortSignal.timeout(10000))
    if (result.error) throw result.error
    data = result.data as ExerciseRecord[] | null
  } catch (error) {
    console.error('[exercise-library] Supabase read failed', error)
    throw new ExerciseLibraryUnavailableError()
  }

  if (!data) {
    console.error('[exercise-library] Supabase returned no result data')
    throw new ExerciseLibraryUnavailableError()
  }
  if (data.length === 0) {
    console.warn('[exercise-library] No active rows; using hardcoded fallback library')
    return copyFallbackLibrary()
  }

  const routine = EMPTY_ROUTINE_LIBRARY()
  const foamRoll: ExerciseLibrary['foamRoll'] = { hips: [], shoulders: [], spine: [] }

  for (const rawRow of data) {
    const template = toTemplate(rawRow)
    if (!template) continue
    if (rawRow.phase === 'foam_roll') {
      foamRoll[rawRow.area].push(template)
    } else if (isRoutinePhase(rawRow.phase)) {
      routine[rawRow.area][rawRow.phase].push(template)
    }
  }

  return { routine, foamRoll, source: 'supabase' }
}

export async function getActiveExerciseLibraryForGeneration() {
  try {
    return await getActiveExerciseLibrary(createServiceRoleClient())
  } catch (error) {
    if (error instanceof ExerciseLibraryUnavailableError) throw error
    console.error('[exercise-library] Server-side reader unavailable', error)
    throw new ExerciseLibraryUnavailableError()
  }
}

export function buildApprovedExercisePoolTextFromLibrary(targetAreas: string[], library: ExerciseLibrary) {
  const areas = targetAreas.filter(isArea)
  const selectedAreas: ExerciseArea[] = areas.length > 0 ? areas : ['hips', 'shoulders', 'spine']

  return selectedAreas.map((area: ExerciseArea) => {
    const phases = library.routine[area]
    return [
      `${area.toUpperCase()}:`,
      ...(['release', 'activation', 'range'] as CuratedPillar[]).map((phase) =>
        `${phase} -> ${phases[phase].map((exercise) => `${exercise.name} [pattern: ${exercise.movementPattern}; anatomy: ${exercise.anatomicalQuadrants.join(', ')}]`).join(', ')}`,
      ),
    ].join('\n')
  }).join('\n\n')
}

export function getStaticExerciseSeed(): Omit<ExerciseRecord, 'id' | 'youtube_id' | 'is_active'>[] {
  const rows: Omit<ExerciseRecord, 'id' | 'youtube_id' | 'is_active'>[] = []
  for (const [area, phases] of Object.entries(CURATED_ROUTINE_LIBRARY) as Array<[ExerciseArea, Record<CuratedPillar, RoutineExerciseTemplate[]>]>) {
    for (const [phase, exercises] of Object.entries(phases) as Array<[CuratedPillar, RoutineExerciseTemplate[]]>) {
      for (const exercise of exercises) {
        rows.push({
          name: exercise.name,
          area,
          phase,
          sets: exercise.sets,
          reps: exercise.reps,
          hold_seconds: exercise.holdSeconds,
          movement_pattern: exercise.movementPattern,
          anatomical_quadrants: exercise.anatomicalQuadrants,
          rationale: exercise.rationale,
          study_citation: exercise.study,
        aliases: exercise.aliases || [],
        } as Omit<ExerciseRecord, 'id' | 'youtube_id' | 'is_active'>)
      }
    }
  }
  for (const [area, exercises] of Object.entries(STATIC_FOAM_ROLL_LIBRARY) as Array<[ExerciseArea, RoutineExerciseTemplate[]]>) {
    for (const exercise of exercises) {
      rows.push({
        name: exercise.name,
        area,
        phase: 'foam_roll',
        sets: exercise.sets,
        reps: exercise.reps,
        hold_seconds: exercise.holdSeconds,
        movement_pattern: exercise.movementPattern,
        anatomical_quadrants: exercise.anatomicalQuadrants,
        rationale: exercise.rationale,
        study_citation: exercise.study,
          aliases: exercise.aliases || [],
      } as Omit<ExerciseRecord, 'id' | 'youtube_id' | 'is_active'>)
    }
  }
  return rows
}
