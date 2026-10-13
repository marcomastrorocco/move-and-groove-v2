import type { CuratedRoutineExerciseTemplate } from './curated-mobility'

export type PrescriptionPhase = 'release' | 'activation' | 'range'
export type TimedPhase = PrescriptionPhase | 'prep'
export type Prescription = Pick<CuratedRoutineExerciseTemplate, 'sets' | 'reps' | 'holdSeconds'>
export type CuratedExercise = Prescription

export const EXERCISE_TRANSITION_SECONDS = 15

const PHASE_WEIGHTS: Record<string, Record<PrescriptionPhase, number>> = {
  flexibility: { release: 0.5, activation: 0.25, range: 0.25 },
  strength: { release: 0.25, activation: 0.5, range: 0.25 },
  balanced: { release: 0.4, activation: 0.3, range: 0.3 },
  performance: { release: 0.25, activation: 0.25, range: 0.5 },
}

export function calculatePhaseBudgets(durationMinutes: number, goal: string, prepSeconds: number) {
  const mainSeconds = Math.max(0, durationMinutes * 60 - prepSeconds)
  const weights = PHASE_WEIGHTS[goal] || PHASE_WEIGHTS.balanced

  return {
    prep: prepSeconds,
    release: mainSeconds * weights.release,
    activation: mainSeconds * weights.activation,
    range: mainSeconds * weights.range,
  }
}

export function estimatePrescriptionSeconds(exercise: Prescription, phase: TimedPhase) {
  const sets = Math.max(1, exercise.sets)
  const rest = phase === 'range' ? 30 : phase === 'activation' ? 20 : 15
  const secondsPerRep = phase === 'release' ? 4 : 2
  const work = exercise.holdSeconds != null
    ? exercise.holdSeconds
    : Math.max(1, exercise.reps || 0) * secondsPerRep

  return EXERCISE_TRANSITION_SECONDS + sets * work + (sets - 1) * rest
}

export function scalePrescription(
  exercise: CuratedExercise,
  phase: PrescriptionPhase,
  sessionBudgetSeconds: number,
  totalExercisesInPhase: number,
  isPrimaryExercise: boolean,
): { sets: number; reps: number | null; holdSeconds: number | null } {
  const timePerExercise = sessionBudgetSeconds / Math.max(1, totalExercisesInPhase)
  const isHold = exercise.holdSeconds != null

  if (phase === 'release') {
    if (!isHold) {
      // Dynamic release drills must remain movements rather than becoming static stretches.
      return { sets: 1, reps: timePerExercise < 50 ? 6 : timePerExercise <= 80 ? 8 : 10, holdSeconds: null }
    }
    return {
      sets: 1,
      reps: null,
      holdSeconds: timePerExercise < 40 ? 20 : timePerExercise <= 60 ? 30 : timePerExercise <= 90 ? 45 : 60,
    }
  }

  if (phase === 'activation') {
    const sets = isPrimaryExercise && timePerExercise > 60 ? 2 : 1
    if (isHold) {
      const available = (timePerExercise - EXERCISE_TRANSITION_SECONDS - (sets - 1) * 20) / sets
      return { sets, reps: null, holdSeconds: Math.max(20, Math.min(45, Math.floor(available / 5) * 5)) }
    }
    return {
      sets,
      reps: timePerExercise < 50 ? 6 : timePerExercise <= 80 ? 8 : 10,
      holdSeconds: null,
    }
  }

  const sets = isPrimaryExercise && timePerExercise > 80 ? 2 : 1
  if (isHold) {
    const available = (timePerExercise - EXERCISE_TRANSITION_SECONDS - (sets - 1) * 30) / sets
    return { sets, reps: null, holdSeconds: Math.max(20, Math.min(45, Math.floor(available / 5) * 5)) }
  }
  return {
    sets,
    reps: timePerExercise < 50 ? 6 : timePerExercise <= 80 ? 8 : 10,
    holdSeconds: null,
  }
}
