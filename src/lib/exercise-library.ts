import type { SupabaseClient } from '@supabase/supabase-js'
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

let cachedLibrary: { expiresAt: number; library: ExerciseLibrary } | null = null

export function invalidateExerciseLibraryCache() {
  cachedLibrary = null
}

export async function getActiveExerciseLibrary(client: SupabaseClient): Promise<ExerciseLibrary> {
  if (cachedLibrary && cachedLibrary.expiresAt > Date.now()) {
    return cachedLibrary.library
  }

  const { data, error } = await client
    .from('exercises')
    .select('id, name, area, phase, sets, reps, hold_seconds, movement_pattern, anatomical_quadrants, rationale, study_citation, aliases, youtube_id, is_active')
    .eq('is_active', true)
    .order('area')
    .order('phase')
    .order('name')

  if (error || !data || data.length === 0) {
    return copyFallbackLibrary()
  }

  const routine = EMPTY_ROUTINE_LIBRARY()
  const foamRoll: ExerciseLibrary['foamRoll'] = { hips: [], shoulders: [], spine: [] }

  for (const rawRow of data as ExerciseRecord[]) {
    const template = toTemplate(rawRow)
    if (!template) continue
    if (rawRow.phase === 'foam_roll') {
      foamRoll[rawRow.area].push(template)
    } else if (isRoutinePhase(rawRow.phase)) {
      routine[rawRow.area][rawRow.phase].push(template)
    }
  }

  const hasCompleteRoutineLibrary = (Object.values(routine) as Array<Record<CuratedPillar, RoutineExerciseTemplate[]>>)
    .every((area) => area.release.length > 0 && area.activation.length > 0 && area.range.length > 0)
  if (!hasCompleteRoutineLibrary) {
    return copyFallbackLibrary()
  }

  const library: ExerciseLibrary = { routine, foamRoll, source: 'supabase' }
  cachedLibrary = { library, expiresAt: Date.now() + 5 * 60 * 1000 }
  return library
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
