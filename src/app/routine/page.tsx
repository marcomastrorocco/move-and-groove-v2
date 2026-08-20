'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Header from '@/components/Header'
import PostSessionCheckinModal from '@/components/PostSessionCheckinModal'
import PreSessionReadinessModal from '@/components/PreSessionReadinessModal'
import { getExerciseVideo, getExerciseVideoEmbedUrl, getExerciseVideoWatchUrl } from '@/lib/exercise-videos'
import type { ReadinessAdjustmentSnapshot } from '@/lib/readiness'
import { pickRoutineBackground } from '@/lib/routine-backgrounds'
import { MAX_SAVED_WORKOUTS, isWorkoutSaved, saveWorkoutToLibrary } from '@/lib/saved-workouts'
import { createClient } from '@/lib/supabase/client'
import { hasPreSessionCheckinToday } from '@/lib/session-flow'

type Exercise = {
  videoId: number | null
  name: string
  targetArea: string
  sets: number
  reps: number | null
  holdSeconds: number | null
  rationale: string
  study: string
  isFoamRoll?: boolean
}

type Phase = {
  pillar: 'prep' | 'release' | 'activation' | 'range'
  phaseDescription: string
  exercises: Exercise[]
}

type Routine = {
  routineTitle: string
  summary: string
  difficultyLevel: string
  totalExercises: number
  phases: Phase[]
  evidenceSummary: string
  savedId?: number
}

type RoutineMeta = {
  routine: Routine
  mode?: 'sport' | 'area'
  sport?: string | null
  areas?: string[]
  duration?: number
  goal?: string | null
  source?: 'recovery' | string
  readiness?: ReadinessAdjustmentSnapshot | null
  completedAt?: string | null
  progressLoggedAt?: string | null
}

function shouldUseLighterRangeSetScheme(meta: RoutineMeta | null) {
  return meta?.source === 'recovery'
    || meta?.goal === 'flexibility'
    || meta?.goal === 'performance'
    || meta?.readiness?.modificationMode === 'recovery'
}

function normalizeExerciseForDisplay(
  exercise: Exercise,
  pillar: Phase['pillar'],
  index: number,
  phaseLength: number,
  meta: RoutineMeta | null,
): Exercise {
  const shouldTreatTinyHoldAsTempo =
    typeof exercise.reps === 'number'
    && typeof exercise.holdSeconds === 'number'
    && exercise.holdSeconds <= 5

  const nextHoldSeconds = shouldTreatTinyHoldAsTempo ? null : exercise.holdSeconds

  if (pillar === 'prep') {
    return {
      ...exercise,
      holdSeconds: nextHoldSeconds,
    }
  }

  if (pillar === 'release') {
    return {
      ...exercise,
      sets: 1,
      holdSeconds: nextHoldSeconds,
    }
  }

  if (pillar === 'activation') {
    return {
      ...exercise,
      sets: index < 2 ? 2 : 1,
      holdSeconds: nextHoldSeconds,
    }
  }

  if (pillar === 'range') {
    if (!shouldUseLighterRangeSetScheme(meta)) {
      return {
        ...exercise,
        sets: 2,
        holdSeconds: nextHoldSeconds,
      }
    }

    const prioritizeTwoRangeDrills = phaseLength >= 4 ? index < 2 : index === 0
    return {
      ...exercise,
      sets: prioritizeTwoRangeDrills ? 2 : 1,
      holdSeconds: nextHoldSeconds,
    }
  }

  return {
    ...exercise,
    holdSeconds: nextHoldSeconds,
  }
}

function readStoredRoutineMeta() {
  if (typeof window === 'undefined') {
    return null
  }

  const stored = window.localStorage.getItem('mg_routine')
  if (!stored) {
    return null
  }

  try {
    return JSON.parse(stored) as RoutineMeta
  } catch {
    return null
  }
}

function writeStoredRoutineMeta(nextMeta: RoutineMeta) {
  if (typeof window === 'undefined') {
    return
  }

  window.localStorage.setItem('mg_routine', JSON.stringify(nextMeta))
}

function markRoutineCompleted() {
  const currentMeta = readStoredRoutineMeta()
  if (!currentMeta) {
    return null
  }

  const completedAt = currentMeta.completedAt || new Date().toISOString()
  writeStoredRoutineMeta({
    ...currentMeta,
    completedAt,
    progressLoggedAt: currentMeta.progressLoggedAt || null,
  })
  return completedAt
}

function normalizeRoutineForDisplay(routine: Routine, meta: RoutineMeta | null): Routine {
  const phases = routine.phases.map((phase) => ({
    ...phase,
    exercises: phase.exercises.map((exercise, index) =>
      normalizeExerciseForDisplay(exercise, phase.pillar, index, phase.exercises.length, meta),
    ),
  }))

  return {
    ...routine,
    phases,
    totalExercises: phases.reduce((sum, phase) => sum + phase.exercises.length, 0),
  }
}

const RELEASE_REP_SECONDS = 4
const ACTIVE_REP_SECONDS = 3.5
const HOLD_REST_SECONDS = 15
const REP_REST_SECONDS = 12
const EXERCISE_SETUP_SECONDS = 15

function estimateExerciseDurationSeconds(exercise: Exercise, pillar: Phase['pillar']) {
  const setCount = Math.max(exercise.sets, 1)

  if (exercise.holdSeconds) {
    return EXERCISE_SETUP_SECONDS + (setCount * exercise.holdSeconds) + (Math.max(setCount - 1, 0) * HOLD_REST_SECONDS)
  }

  const repCount = Math.max(exercise.reps || 0, 1)
  const repSeconds = pillar === 'release' ? RELEASE_REP_SECONDS : ACTIVE_REP_SECONDS
  return EXERCISE_SETUP_SECONDS + (setCount * repCount * repSeconds) + (Math.max(setCount - 1, 0) * REP_REST_SECONDS)
}

function estimateRoutineDurationMinutes(routine: Routine | null) {
  if (!routine) {
    return 0
  }

  const totalSeconds = routine.phases.reduce(
    (sum, phase) => sum + phase.exercises.reduce((phaseSum, exercise) => phaseSum + estimateExerciseDurationSeconds(exercise, phase.pillar), 0),
    0,
  )

  return Math.round((totalSeconds / 60) * 10) / 10
}

type ExerciseVideoOverride = {
  exercise_name: string
  youtube_id: string | null
}

const PHASE_STYLES: Record<Phase['pillar'], { label: string; color: string; border: string; bg: string }> = {
  prep: { label: 'PREP', color: 'var(--silver2)', border: 'var(--silver4)', bg: 'var(--black3)' },
  release: { label: 'RELEASE', color: 'var(--silver2)', border: 'var(--silver4)', bg: 'var(--black3)' },
  activation: { label: 'ACTIVATION', color: 'var(--white)', border: 'rgba(200,205,212,0.25)', bg: 'var(--black4)' },
  range: { label: 'RANGE', color: 'var(--cyan)', border: 'rgba(0,180,216,0.35)', bg: 'rgba(0,180,216,0.05)' },
}

function useTimer(sets: number, holdSeconds: number) {
  const [active, setActive] = useState(false)
  const [currentSet, setCurrentSet] = useState(1)
  const [secondsLeft, setSecondsLeft] = useState(holdSeconds)
  const [isRest, setIsRest] = useState(false)
  const [done, setDone] = useState(false)
  const REST = 15

  useEffect(() => {
    if (!active || done) return

    const interval = window.setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          if (!isRest) {
            if (currentSet < sets) {
              setIsRest(true)
              return REST
            }
            setDone(true)
            setActive(false)
            return 0
          }

          setIsRest(false)
          setCurrentSet((value) => value + 1)
          return holdSeconds
        }

        return prev - 1
      })
    }, 1000)

    return () => window.clearInterval(interval)
  }, [active, currentSet, done, holdSeconds, isRest, sets])

  function start() {
    setActive(true)
  }

  function pause() {
    setActive(false)
  }

  function reset() {
    setActive(false)
    setCurrentSet(1)
    setSecondsLeft(holdSeconds)
    setIsRest(false)
    setDone(false)
  }

  return { active, currentSet, secondsLeft, isRest, done, start, pause, reset }
}

function ExerciseTimer({ sets, holdSeconds }: { sets: number; holdSeconds: number }) {
  const { active, currentSet, secondsLeft, isRest, done, start, pause, reset } = useTimer(sets, holdSeconds)
  const circumference = 2 * Math.PI * 36
  const total = isRest ? 15 : holdSeconds
  const offset = circumference * (1 - secondsLeft / total)

  if (done) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 8 }}>
        <div style={{ fontFamily: "'Syncopate',sans-serif", fontSize: 10, letterSpacing: 2, color: 'var(--cyan)', padding: '8px 16px', border: '1px solid var(--cyan3)', borderRadius: 20 }}>
          COMPLETE / ALL {sets} SETS DONE
        </div>
        <button onClick={reset} style={{ fontFamily: "'Syncopate',sans-serif", fontSize: 8, letterSpacing: 2, color: 'var(--silver3)', background: 'transparent', border: '1px solid var(--silver4)', padding: '6px 14px', borderRadius: 20, cursor: 'pointer' }}>
          REPEAT
        </button>
      </div>
    )
  }

  if (!active && currentSet === 1 && secondsLeft === holdSeconds) {
    return (
      <button onClick={start} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: 'var(--black3)', border: '1px solid var(--cyan3)', padding: '8px 18px', borderRadius: 30, fontFamily: "'Syncopate',sans-serif", fontSize: 9, fontWeight: 700, letterSpacing: 2, color: 'var(--cyan)', cursor: 'pointer', marginTop: 8 }}>
        START TIMER
      </button>
    )
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 8 }}>
      <svg width="80" height="80" viewBox="0 0 80 80" style={{ transform: 'rotate(-90deg)', flexShrink: 0 }}>
        <circle cx="40" cy="40" r="36" fill="none" stroke="var(--black4)" strokeWidth="4" />
        <circle
          cx="40"
          cy="40"
          r="36"
          fill="none"
          stroke={isRest ? 'var(--silver3)' : 'var(--cyan)'}
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset 1s linear' }}
        />
      </svg>
      <div>
        <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 9, letterSpacing: 3, color: 'var(--silver3)', textTransform: 'uppercase' }}>
          {isRest ? 'REST' : `SET ${currentSet} / ${sets}`}
        </div>
        <div style={{ fontFamily: "'Syncopate',sans-serif", fontSize: 36, fontWeight: 700, color: isRest ? 'var(--silver3)' : 'var(--white)', letterSpacing: 2, lineHeight: 1 }}>
          {secondsLeft}s
        </div>
        <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 9, letterSpacing: 2, color: 'var(--cyan3)', textTransform: 'uppercase' }}>
          {isRest ? 'Get ready' : 'Hold position'}
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <button onClick={active ? pause : start} style={{ fontFamily: "'Syncopate',sans-serif", fontSize: 8, fontWeight: 700, letterSpacing: 2, padding: '6px 14px', cursor: 'pointer', borderRadius: 20, background: 'transparent', color: 'var(--silver2)', border: '1px solid var(--silver4)' }}>
            {active ? 'PAUSE' : 'RESUME'}
          </button>
          <button onClick={reset} style={{ fontFamily: "'Syncopate',sans-serif", fontSize: 8, fontWeight: 700, letterSpacing: 2, padding: '6px 14px', cursor: 'pointer', borderRadius: 20, background: 'transparent', color: 'var(--silver3)', border: '1px solid var(--silver4)' }}>
            RESET
          </button>
        </div>
      </div>
    </div>
  )
}

function getYoutubeThumbnailUrl(youtubeVideoId: string) {
  return `https://img.youtube.com/vi/${youtubeVideoId}/hqdefault.jpg`
}

export default function RoutinePage() {
  const router = useRouter()
  const supabase = createClient()
  const [storedMeta] = useState<RoutineMeta | null>(() => readStoredRoutineMeta())

  const routine = useMemo(
    () => (storedMeta?.routine ? normalizeRoutineForDisplay(storedMeta.routine, storedMeta) : null),
    [storedMeta],
  )
  const [savedId, setSavedId] = useState<number | null>(() => storedMeta?.routine?.savedId ?? null)
  const [isSavedToLibrary, setIsSavedToLibrary] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [activePhaseIndex, setActivePhaseIndex] = useState(0)
  const [sessionFinished, setSessionFinished] = useState(false)
  const [showReadinessModal, setShowReadinessModal] = useState(false)
  const [showPostSessionModal, setShowPostSessionModal] = useState(false)
  const [hasTodayReadiness, setHasTodayReadiness] = useState(false)
  const [completedSets, setCompletedSets] = useState<Record<number, number>>({})
  const [videoOverrides, setVideoOverrides] = useState<Record<string, string>>({})
  const [expandedVideo, setExpandedVideo] = useState<{ title: string; youtubeVideoId: string } | null>(null)
  const [progressSaved, setProgressSaved] = useState(false)
  const [progressSaveError, setProgressSaveError] = useState('')
  const [loggingProgress, setLoggingProgress] = useState(false)
  const [progressCapped, setProgressCapped] = useState(false)
  const [postSessionCompleted, setPostSessionCompleted] = useState(false)
  const [postSessionDismissed, setPostSessionDismissed] = useState(false)

  useEffect(() => {
    if (!routine) {
      router.push('/quiz')
    }
  }, [routine, router])

  useEffect(() => {
    setActivePhaseIndex(0)
    setSessionFinished(false)
    setCompletedSets({})
    setShowPostSessionModal(false)
    setProgressSaved(false)
    setProgressSaveError('')
    setLoggingProgress(false)
    setPostSessionCompleted(false)
    setPostSessionDismissed(false)
  }, [routine])

  const logCompletedSessionProgress = useCallback(async () => {
    if (!routine) {
      return false
    }

    const currentMeta = readStoredRoutineMeta()
    if (!currentMeta) {
      throw new Error('Could not find the stored workout details.')
    }

    if (currentMeta.progressLoggedAt) {
      setProgressSaved(true)
      setProgressSaveError('')
      return true
    }

    setLoggingProgress(true)
    setProgressSaveError('')
    setProgressCapped(false)

    try {
      const { data: { session } } = await supabase.auth.getSession()
      const uid = session?.user?.id
      const accessToken = session?.access_token

      if (!uid || !accessToken) {
        throw new Error('Sign in required to save workout progress.')
      }

      const completedAt = currentMeta.completedAt || new Date().toISOString()
      const durationMinutes = currentMeta.duration

      if (typeof durationMinutes !== 'number' || !Number.isFinite(durationMinutes) || durationMinutes < 1 || durationMinutes > 45) {
        throw new Error('The selected workout duration is missing or invalid, so it cannot be added to your daily total.')
      }
      const response = await fetch('/api/progress', {
        method: 'POST',
        keepalive: true,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          row: {
            user_id: uid,
            routine_id: currentMeta.routine?.savedId ?? null,
            duration_minutes: durationMinutes,
            completed_at: completedAt,
            sport: currentMeta.sport ?? null,
            areas: currentMeta.areas ?? null,
            goal: currentMeta.goal ?? null,
          },
        }),
      })

      if (!response.ok) {
        const payload = await response.json().catch(() => null)
        // The daily cap is an expected outcome, not a failure. The route pairs
        // the machine code with human-readable copy, so surface that instead of
        // showing the caller DAILY_WORKOUT_LIMIT_REACHED.
        if (payload?.error === 'DAILY_WORKOUT_LIMIT_REACHED') {
          setProgressCapped(true)
          throw new Error(payload?.message || 'You have already logged both workouts for today. Your next one counts tomorrow.')
        }
        throw new Error(payload?.error || 'Could not log completed session progress.')
      }

      writeStoredRoutineMeta({
        ...currentMeta,
        completedAt,
        progressLoggedAt: completedAt,
      })
      setProgressSaved(true)
      setProgressSaveError('')
      return true
    } catch (error) {
      console.warn('[routine.progress]', error)
      setProgressSaved(false)
      setProgressSaveError(error instanceof Error ? error.message : 'Could not save workout progress.')
      return false
    } finally {
      setLoggingProgress(false)
    }
  }, [routine, supabase])

  // The auto-log must fire once per finished session. loggingProgress is one of
  // the effect's dependencies, so a failed attempt flips it back to false and
  // re-triggers the effect, which retries forever - visible as the error text
  // flickering while /api/progress is called in a loop. Hitting the daily cap is
  // an ordinary outcome, not a transient fault, so there is nothing to retry.
  // The "log progress" button below still allows a deliberate retry.
  const autoLoggedSessionRef = useRef(false)

  useEffect(() => {
    async function saveWorkoutProgressOnly() {
      if (!sessionFinished) {
        autoLoggedSessionRef.current = false
        return
      }

      if (!routine || progressSaved || loggingProgress || autoLoggedSessionRef.current) {
        return
      }

      autoLoggedSessionRef.current = true
      await logCompletedSessionProgress()
    }

    void saveWorkoutProgressOnly()
  }, [logCompletedSessionProgress, loggingProgress, progressSaved, routine, sessionFinished])

  useEffect(() => {
    async function loadReadiness() {
      const { data: { session } } = await supabase.auth.getSession()
      const uid = session?.user?.id
      if (!uid) {
        return
      }

      try {
        const ready = await hasPreSessionCheckinToday(supabase as never, uid)
        setHasTodayReadiness(ready)
      } catch (error) {
        console.error(error)
      }
    }

    void loadReadiness()
  }, [supabase])

  useEffect(() => {
    async function loadLibraryState() {
      const { data: { session } } = await supabase.auth.getSession()
      const accessToken = session?.access_token || null

      if (!accessToken || !savedId) {
        setIsSavedToLibrary(false)
        return
      }

      try {
        setIsSavedToLibrary(await isWorkoutSaved(accessToken, savedId))
      } catch (error) {
        console.warn('[routine.saved-workouts]', error)
        setIsSavedToLibrary(false)
      }
    }

    void loadLibraryState()
  }, [savedId, supabase])

  useEffect(() => {
    async function loadVideoOverrides() {
      if (!routine) {
        setVideoOverrides({})
        return
      }

      const exerciseNames = [...new Set(
        routine.phases
          .flatMap((phase) => phase.exercises)
          .map((exercise) => exercise.name.trim())
          .filter(Boolean),
      )]

      if (exerciseNames.length === 0) {
        setVideoOverrides({})
        return
      }

      try {
        const params = new URLSearchParams()
        exerciseNames.forEach((name) => params.append('name', name))
        const { data: { session } } = await supabase.auth.getSession()
        const accessToken = session?.access_token

        if (!accessToken) {
          throw new Error('Sign in required to load exercise videos.')
        }

        const response = await fetch(`/api/exercise-videos?${params.toString()}`, {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        })
        const payload = await response.json()

        if (!response.ok) {
          throw new Error(payload.error || 'Could not load exercise video overrides.')
        }

        const nextOverrides = Object.fromEntries(
          (payload.mappings as ExerciseVideoOverride[])
            .filter((mapping) => mapping.youtube_id)
            .map((mapping) => [mapping.exercise_name, mapping.youtube_id as string]),
        )
        setVideoOverrides(nextOverrides)
      } catch (error) {
        console.error('[routine.exerciseVideos]', error)
        setVideoOverrides({})
      }
    }

    void loadVideoOverrides()
  }, [routine])

  const sportLabel = storedMeta?.sport ? storedMeta.sport.toUpperCase() : null
  const areasLabel = storedMeta?.areas && storedMeta.areas.length > 0 ? storedMeta.areas.map((area) => area.toUpperCase()).join(' / ') : 'FULL BODY'
  const builderHref = storedMeta?.source === 'recovery' ? '/recovery' : '/quiz'
  const builderLabel = storedMeta?.source === 'recovery' ? 'REGENERATE RECOVERY' : 'GENERATE NEW ROUTINE'
  const routineBackground = pickRoutineBackground({
    sport: storedMeta?.sport,
    areas: storedMeta?.areas,
  })
  const isSaved = isSavedToLibrary
  const totalExerciseCount = routine ? routine.phases.reduce((sum, phase) => sum + phase.exercises.length, 0) : 0
  const totalCompletedSets = routine
    ? routine.phases.reduce((sum, phase, phaseIndex) => {
        let runningIndexBeforePhase = 0
        for (let i = 0; i < phaseIndex; i += 1) {
          runningIndexBeforePhase += routine.phases[i].exercises.length
        }

        return sum + phase.exercises.reduce((phaseSum, exercise, exerciseIndex) => {
          const flatIndex = runningIndexBeforePhase + exerciseIndex
          return phaseSum + Math.min(completedSets[flatIndex] || 0, exercise.sets)
        }, 0)
      }, 0)
    : 0
  const totalSetCount = routine
    ? routine.phases.reduce((sum, phase) => sum + phase.exercises.reduce((phaseSum, exercise) => phaseSum + exercise.sets, 0), 0)
    : 0
  const requestedDuration = storedMeta?.duration ?? 0
  const estimatedDuration = estimateRoutineDurationMinutes(routine)
  const phaseExerciseCounts = routine
    ? routine.phases.map((phase) => `${phase.pillar}:${phase.exercises.length}`).join(' / ')
    : ''
  const showDurationDebug = process.env.NODE_ENV !== 'production'

  const studies = useMemo(
    () => (routine ? [...new Set(routine.phases.flatMap((phase) => phase.exercises).map((exercise) => exercise.study).filter(Boolean))] : []),
    [routine],
  )
  const featuredEvidence = useMemo(
    () => (routine
      ? routine.phases
        .flatMap((phase) =>
          phase.exercises
            .filter((exercise) => exercise.study)
            .map((exercise) => ({
              pillar: phase.pillar,
              exerciseName: exercise.name,
              rationale: exercise.rationale,
              study: exercise.study,
            })))
        .filter((item, index, items) => items.findIndex((entry) => entry.study === item.study) === index)
        .slice(0, 2)
      : []),
    [routine],
  )
  function isPhaseComplete(phaseIndex: number) {
    if (!routine) return false

    let runningIndexBeforePhase = 0
    for (let i = 0; i < phaseIndex; i += 1) {
      runningIndexBeforePhase += routine.phases[i].exercises.length
    }

    return routine.phases[phaseIndex].exercises.every((exercise, exerciseIndex) => {
      const flatIndex = runningIndexBeforePhase + exerciseIndex
      return (completedSets[flatIndex] || 0) >= exercise.sets
    })
  }

  async function saveRoutine() {
    if (!storedMeta?.routine || isSaved || saving) {
      return
    }

    setSaving(true)
    setSaveError('')

    try {
      const { data: { session } } = await supabase.auth.getSession()
      const accessToken = session?.access_token

      if (!session?.user?.id || !accessToken) {
        throw new Error('Sign in to save routines to your library.')
      }

      let nextSavedId = savedId

      if (!nextSavedId) {
        const response = await fetch('/api/routines/save', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({
            userId: session.user.id,
            routine: storedMeta.routine,
            sport: storedMeta.sport || null,
            areas: storedMeta.areas || [],
            duration: storedMeta.duration,
            goal: storedMeta.goal || null,
          }),
        })

        const payload = await response.json()

        if (!response.ok) {
          throw new Error(payload.error || `Server error ${response.status}`)
        }

        nextSavedId = payload.savedId as number
        setSavedId(nextSavedId)

        const nextMeta = {
          ...storedMeta,
          routine: {
            ...storedMeta.routine,
            savedId: nextSavedId,
          },
        }

        writeStoredRoutineMeta(nextMeta)
      }

      await saveWorkoutToLibrary(accessToken, nextSavedId)

      setIsSavedToLibrary(true)
    } catch (err: unknown) {
      console.error('[routine.save]', err)
      setSaveError(err instanceof Error ? err.message : 'Could not save routine')
    } finally {
      setSaving(false)
    }
  }

  function completeExerciseSet(phaseIndex: number, index: number, totalSets: number) {
    if (phaseIndex !== activePhaseIndex || sessionFinished) {
      return
    }

    setCompletedSets((prev) => {
      if ((prev[index] || 0) >= totalSets) {
        return prev
      }

      const nextCompleted = Math.min((prev[index] || 0) + 1, totalSets)
      const next = { ...prev, [index]: nextCompleted }

      const phaseExercises = routine?.phases[phaseIndex].exercises || []
      let runningIndexBeforePhase = 0
      for (let i = 0; i < phaseIndex; i += 1) {
        runningIndexBeforePhase += routine?.phases[i].exercises.length || 0
      }

      const phaseDone = phaseExercises.every((exercise, exerciseIndex) => {
        const flatIndex = runningIndexBeforePhase + exerciseIndex
        const completed = flatIndex === index ? nextCompleted : (next[flatIndex] || 0)
        return completed >= exercise.sets
      })

      if (phaseDone) {
        const nextPhaseIndex = phaseIndex + 1
        if (!routine || nextPhaseIndex >= routine.phases.length) {
          markRoutineCompleted()
          setSessionFinished(true)
        } else {
          setActivePhaseIndex(nextPhaseIndex)
        }
      }

      return next
    })
  }

  if (!routine) {
    return (
      <>
        <Header />
        <main style={{ position: 'relative', zIndex: 2, paddingTop: 64 }}>
          <div style={{ textAlign: 'center', padding: '100px 40px' }}>
            <div className="loading-ring" />
            <div style={{ fontFamily: "'Syncopate',sans-serif", fontSize: 11, letterSpacing: 4, color: 'var(--silver3)' }}>LOADING</div>
          </div>
        </main>
      </>
    )
  }

  return (
    <>
      <div style={{ position: 'fixed', inset: 0, zIndex: 0, pointerEvents: 'none', background: '#000' }}>
        <div
          style={{
            position: 'absolute',
            inset: 0,
            backgroundImage: `url(${routineBackground.image})`,
            backgroundSize: 'min(1080px, 80vw) auto',
            backgroundRepeat: 'no-repeat',
            backgroundPosition: routineBackground.position || 'center 16%',
            opacity: 0.38,
          }}
        />
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to bottom,rgba(0,0,0,0.6) 0%,rgba(0,0,0,0.58) 50%,rgba(0,0,0,0.78) 100%)' }} />
      </div>

      <Header />

      <main style={{ position: 'relative', zIndex: 2, paddingTop: 64 }}>
        <div className="mg-page-shell routine-page-shell" style={{ maxWidth: 980 }}>
          <div className="mg-split-section routine-hero-shell" style={{ alignItems: 'flex-start', marginBottom: 48, paddingBottom: 32, borderBottom: '1px solid var(--border)', gap: 24 }}>
            <div>
              <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 9, letterSpacing: 4, color: 'var(--cyan)', marginBottom: 12, textTransform: 'uppercase' }}>
                {'// MOVE&GROOVE / '}{new Date().toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' }).toUpperCase()}
              </div>
              <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 'clamp(30px,4vw,48px)', fontWeight: 600, color: 'var(--white)', lineHeight: 1.2, marginBottom: 16 }}>
                {routine.routineTitle}
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
                {[`${storedMeta?.duration} MIN`, routine.difficultyLevel?.toUpperCase(), `${routine.totalExercises} EXERCISES`, sportLabel || areasLabel]
                  .filter(Boolean)
                  .map((tag) => (
                    <span key={tag} style={{ fontFamily: "'DM Mono',monospace", fontSize: 9, letterSpacing: 2, color: 'var(--silver)', border: '1px solid rgba(0,180,216,0.2)', padding: '5px 12px', textTransform: 'uppercase', background: 'var(--black2)' }}>
                      {tag}
                    </span>
                  ))}
              </div>
              <div style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 16, color: 'var(--silver2)', lineHeight: 1.7, maxWidth: 560 }}>
                {routine.summary}
              </div>
              {storedMeta?.readiness && storedMeta.readiness.modificationMode !== 'normal' && (
                <div style={{ marginTop: 16, maxWidth: 620, border: '1px solid rgba(0,180,216,0.18)', background: 'rgba(0,180,216,0.06)', padding: '14px 16px' }}>
                  <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 9, letterSpacing: 3, color: 'var(--cyan)', marginBottom: 8, textTransform: 'uppercase' }}>
                    {'// Today’s Readiness Adjustment'}
                  </div>
                  <div style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 14, color: 'var(--silver2)', lineHeight: 1.7 }}>
                    {storedMeta.readiness.userMessage}
                  </div>
                </div>
              )}
              {showDurationDebug && (
                <div style={{ marginTop: 16, maxWidth: 620, border: '1px dashed rgba(139,231,255,0.22)', background: 'rgba(139,231,255,0.05)', padding: '14px 16px' }}>
                  <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 9, letterSpacing: 3, color: 'var(--cyan)', marginBottom: 8, textTransform: 'uppercase' }}>
                    {'// Dev Duration QA'}
                  </div>
                  <div style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 14, color: 'var(--silver2)', lineHeight: 1.7 }}>
                    Requested: <span style={{ color: 'var(--white)' }}>{requestedDuration} min</span>
                    {' / '}Estimated: <span style={{ color: 'var(--white)' }}>{estimatedDuration} min</span>
                    {' / '}Exercises: <span style={{ color: 'var(--white)' }}>{totalExerciseCount}</span>
                    <br />
                    Phase counts: <span style={{ color: 'var(--white)' }}>{phaseExerciseCounts || 'n/a'}</span>
                  </div>
                </div>
              )}
              <div className="mg-mobile-stack" style={{ marginTop: 18, alignItems: 'center' }}>
                {!hasTodayReadiness ? (
                  <>
                    <button className="btn-primary" onClick={() => setShowReadinessModal(true)}>
                      PRE TRAINING READINESS CHECK
                    </button>
                    <span style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 14, color: 'var(--cyan)' }}>
                      Complete this before you start the workout.
                    </span>
                  </>
                ) : (
                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '8px 12px', border: '1px solid rgba(67,209,122,0.24)', background: 'rgba(67,209,122,0.08)', fontFamily: "'DM Mono',monospace", fontSize: 10, letterSpacing: 3, color: '#43d17a', textTransform: 'uppercase' }}>
                    Ready for training / pre-session check-in logged
                  </div>
                )}
              </div>
            </div>
            <div className="routine-sidebar" style={{ flexShrink: 0, width: 'min(100%, 320px)' }}>
              <div className="mg-mobile-stack" style={{ marginBottom: 16, justifyContent: 'flex-end' }}>
                <button className="btn-outline" onClick={() => router.push(builderHref)}>ADJUST</button>
                <button className="btn-primary" onClick={() => router.push(builderHref)}>REGENERATE</button>
              </div>
              <div style={{ border: '1px solid rgba(0,180,216,0.24)', background: 'rgba(0,180,216,0.07)', padding: '18px 16px' }}>
                <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 9, letterSpacing: 3, color: 'var(--cyan)', marginBottom: 9, textTransform: 'uppercase' }}>
                  {'// Workout Library'}
                </div>
                <div style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 14, color: 'var(--silver2)', lineHeight: 1.65, marginBottom: 14 }}>
                  {isSaved
                    ? 'This workout is saved to your library and can be repeated later.'
                    : 'Keep this workout in your library before you begin, so you can repeat it later.'}
                </div>
                {saveError && (
                  <div style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 13, color: '#ffb7b7', lineHeight: 1.55, marginBottom: 12 }}>
                    {saveError}
                  </div>
                )}
                {isSaved ? (
                  <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, letterSpacing: 2, color: '#43d17a', textTransform: 'uppercase' }}>
                    ✓ Saved to My Workouts
                  </div>
                ) : (
                  <button className="btn-primary" onClick={saveRoutine} disabled={saving} style={{ width: '100%' }}>
                    {saving ? 'SAVING...' : '★ SAVE TO MY WORKOUTS'}
                  </button>
                )}
              </div>
            </div>
          </div>

          {routine.phases.map((phase, phaseIndex) => {
            const phaseStyle = PHASE_STYLES[phase.pillar]
            let runningIndexBeforePhase = 0
            for (let i = 0; i < phaseIndex; i += 1) {
              runningIndexBeforePhase += routine.phases[i].exercises.length
            }
            return (
              <div key={phaseIndex} style={{ marginBottom: 44 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 16, paddingBottom: 14, borderBottom: '1px solid var(--border2)' }}>
                  <div style={{ fontFamily: "'Syncopate',sans-serif", fontSize: 9, fontWeight: 700, letterSpacing: 3, padding: '8px 20px', border: `1px solid ${phaseStyle.border}`, color: phaseStyle.color, background: phaseStyle.bg, textTransform: 'uppercase' }}>
                    {phaseStyle.label}
                  </div>
                  <div style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 15, color: 'var(--silver2)' }}>
                    {phase.phaseDescription}
                  </div>
                </div>

                {phase.exercises.map((exercise, exerciseIndex) => {
                  const flatIndex = runningIndexBeforePhase + exerciseIndex
                  const isCurrentPhase = phaseIndex === activePhaseIndex && !sessionFinished
                  const completedSetCount = Math.min(completedSets[flatIndex] || 0, exercise.sets)
                  const isDone = completedSetCount >= exercise.sets
                  const isLocked = phaseIndex > activePhaseIndex && !sessionFinished
                  const overrideVideoId = videoOverrides[exercise.name] || null
                  const mappedVideo = overrideVideoId
                    ? {
                        slug: `override-${exercise.name}`,
                        title: exercise.name,
                        youtubeVideoId: overrideVideoId,
                        aliases: [],
                        area: exercise.targetArea,
                      }
                    : getExerciseVideo(exercise.name)

                  return (
                  <div
                    key={exerciseIndex}
                    style={{
                      border: isCurrentPhase ? '1px solid rgba(0,180,216,0.28)' : '1px solid var(--border)',
                      marginBottom: 2,
                      background: isLocked ? 'rgba(255,255,255,0.015)' : 'var(--black)',
                      borderRadius: 4,
                      overflow: 'hidden',
                      transition: 'all 0.2s',
                    }}
                    onMouseEnter={(event) => { event.currentTarget.style.background = 'var(--black2)' }}
                    onMouseLeave={(event) => { event.currentTarget.style.background = isLocked ? 'rgba(255,255,255,0.015)' : 'var(--black)' }}
                  >
                    <div className="mg-routine-exercise-row">
                      <div className="mg-routine-media routine-media-panel" style={{ background: 'var(--black3)', display: 'flex', flexDirection: 'column', alignItems: 'stretch', justifyContent: 'center', gap: 12, borderRight: '1px solid var(--border)', overflow: 'hidden' }}>
                        {mappedVideo ? (
                          <>
                            <button
                              type="button"
                              onClick={() => setExpandedVideo({ title: mappedVideo.title, youtubeVideoId: mappedVideo.youtubeVideoId })}
                              style={{
                                position: 'relative',
                                width: '100%',
                                minHeight: 180,
                                border: 'none',
                                padding: 0,
                                cursor: 'pointer',
                                background: '#05070a',
                                display: 'block',
                                overflow: 'hidden',
                              }}
                            >
                              <div
                                aria-hidden="true"
                                style={{
                                  width: '100%',
                                  minHeight: 180,
                                  backgroundImage: `url(${getYoutubeThumbnailUrl(mappedVideo.youtubeVideoId)})`,
                                  backgroundSize: 'cover',
                                  backgroundPosition: 'center',
                                  opacity: 0.9,
                                }}
                              />
                              <div
                                style={{
                                  position: 'absolute',
                                  inset: 0,
                                  background: 'linear-gradient(180deg, rgba(0,0,0,0.18) 0%, rgba(0,0,0,0.74) 100%)',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  flexDirection: 'column',
                                  gap: 10,
                                }}
                              >
                                <div
                                  style={{
                                    width: 58,
                                    height: 58,
                                    borderRadius: 999,
                                    border: '1px solid rgba(255,255,255,0.24)',
                                    background: 'rgba(0,0,0,0.64)',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    color: 'var(--white)',
                                    fontSize: 24,
                                    paddingLeft: 4,
                                  }}
                                >
                                  ▶
                                </div>
                                <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 8, letterSpacing: 2, textTransform: 'uppercase', color: 'var(--white)' }}>
                                  Tap video to enlarge
                                </div>
                              </div>
                            </button>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr', borderTop: '1px solid var(--border)' }}>
                              <a
                                href={getExerciseVideoWatchUrl(mappedVideo.youtubeVideoId)}
                                target="_blank"
                                rel="noopener noreferrer"
                                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '10px 12px', textDecoration: 'none', fontFamily: "'DM Mono',monospace", fontSize: 9, letterSpacing: 2, color: 'var(--cyan)', textTransform: 'uppercase' }}
                              >
                                Watch on YouTube
                              </a>
                            </div>
                          </>
                        ) : (
                          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, padding: '18px', minHeight: 180, textAlign: 'center' }}>
                            <svg viewBox="0 0 24 24" fill="none" stroke="var(--cyan)" strokeWidth="1" style={{ width: 28, opacity: 0.12 }}>
                              <rect x="2" y="4" width="20" height="16" rx="1" />
                              <polygon points="10,9 16,12 10,15" fill="currentColor" stroke="none" opacity="0.5" />
                            </svg>
                            <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 8, letterSpacing: 3, color: 'var(--silver4)', textTransform: 'uppercase' }}>
                              {exercise.isFoamRoll ? 'FOAM ROLL VIDEO' : 'VIDEO'}
                            </div>
                            <div style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 13, lineHeight: 1.6, color: 'var(--silver3)', maxWidth: 180 }}>
                              {exercise.isFoamRoll ? 'No linked foam-roll video yet. Add a YouTube mapping in admin for this drill.' : 'No linked exercise video yet. Add a YouTube mapping for this exercise.'}
                            </div>
                          </div>
                        )}
                      </div>

                      <div style={{ padding: '24px 28px', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 8, minWidth: 0 }}>
                        <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 9, letterSpacing: 3, color: 'var(--silver4)', textTransform: 'uppercase' }}>
                          {String(flatIndex + 1).padStart(2, '0')} / {phaseStyle.label}
                        </div>
                        <div style={{ fontFamily: "'Syncopate',sans-serif", fontSize: 18, fontWeight: 700, color: 'var(--white)', lineHeight: 1.3, letterSpacing: 2 }}>
                          {exercise.name}
                        </div>
                        <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 11, letterSpacing: 2, color: 'var(--cyan)', textTransform: 'uppercase' }}>
                          {exercise.targetArea}
                        </div>
                        <div style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 16, color: 'var(--silver)', lineHeight: 1.8 }}>
                          {exercise.rationale}
                        </div>

                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 12, background: 'var(--black3)', border: '1px solid var(--border)', padding: '10px 20px', borderRadius: 30, fontFamily: "'Syncopate',sans-serif", fontSize: 11, fontWeight: 700, letterSpacing: 2, color: 'var(--white)', alignSelf: 'flex-start', marginTop: 4 }}>
                          {exercise.holdSeconds ? (
                            <>
                              {exercise.sets} SETS <span style={{ color: 'var(--cyan)', fontSize: 14 }}>×</span> <span style={{ color: 'var(--silver3)', fontSize: 9, letterSpacing: 3 }}>{exercise.holdSeconds}s HOLD</span>
                            </>
                          ) : (
                            <>
                              {exercise.sets} SETS <span style={{ color: 'var(--cyan)', fontSize: 14 }}>×</span> <span style={{ color: 'var(--silver3)', fontSize: 9, letterSpacing: 3 }}>{exercise.reps} REPS × 2s EACH</span>
                            </>
                          )}
                        </div>

                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
                          {Array.from({ length: exercise.sets }).map((_, setIndex) => {
                            const checked = isDone || setIndex < completedSetCount
                            const isNextSet = !checked && setIndex === completedSetCount
                            const canTickSet = !sessionFinished && isCurrentPhase && isNextSet
                            return (
                              <button
                                key={setIndex}
                                type="button"
                                onClick={() => {
                                  if (canTickSet) completeExerciseSet(phaseIndex, flatIndex, exercise.sets)
                                }}
                                disabled={!canTickSet}
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: 7,
                                  borderRadius: 999,
                                  padding: '6px 10px',
                                  border: `1px solid ${checked ? 'rgba(67,209,122,0.35)' : canTickSet ? 'rgba(0,180,216,0.4)' : 'rgba(255,255,255,0.1)'}`,
                                  background: checked ? 'rgba(67,209,122,0.08)' : canTickSet ? 'rgba(0,180,216,0.08)' : 'rgba(255,255,255,0.03)',
                                  fontFamily: "'DM Mono',monospace",
                                  fontSize: 9,
                                  letterSpacing: 2,
                                  color: checked ? '#43d17a' : canTickSet ? 'var(--cyan)' : 'var(--silver3)',
                                  textTransform: 'uppercase',
                                  cursor: canTickSet ? 'pointer' : 'default',
                                  opacity: isLocked ? 0.55 : 1,
                                }}
                              >
                                <span
                                  style={{
                                    width: 12,
                                    height: 12,
                                    borderRadius: 3,
                                    border: `1px solid ${checked ? '#43d17a' : canTickSet ? 'var(--cyan)' : 'var(--silver4)'}`,
                                    background: checked ? '#43d17a' : 'transparent',
                                    display: 'inline-block',
                                  }}
                                />
                                {`Set ${setIndex + 1}`}
                              </button>
                            )
                          })}
                        </div>

                        {exercise.holdSeconds && <ExerciseTimer sets={exercise.sets} holdSeconds={exercise.holdSeconds} />}

                        <div className="mg-mobile-stack" style={{ marginTop: 10 }}>
                          {isDone && (
                            <span style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, letterSpacing: 3, color: 'var(--cyan)', textTransform: 'uppercase' }}>
                              COMPLETED
                            </span>
                          )}
                          {!isDone && isCurrentPhase && (
                            <>
                              <button className="btn-primary" onClick={() => completeExerciseSet(phaseIndex, flatIndex, exercise.sets)}>
                                {exercise.sets === 1 ? 'TICK SET COMPLETE' : `TICK SET ${completedSetCount + 1} COMPLETE`}
                              </button>
                              <span style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 14, color: 'var(--silver2)', lineHeight: 1.65 }}>
                                {exercise.sets === 1
                                  ? 'Tick the set chip or button once you finish this exercise.'
                                  : `${completedSetCount} of ${exercise.sets} sets completed. You can tick the next set chip on any exercise in this block and run it like a circuit.`}
                              </span>
                            </>
                          )}
                          {isLocked && (
                            <span style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, letterSpacing: 3, color: 'var(--silver3)', textTransform: 'uppercase' }}>
                              LOCKED / UNLOCKS WHEN THE CURRENT BLOCK IS COMPLETED
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                )})}
              </div>
            )
          })}

          <div style={{ border: '1px solid rgba(0,180,216,0.18)', padding: '22px 24px', marginTop: 12, background: 'linear-gradient(180deg, rgba(0,180,216,0.05) 0%, rgba(8,10,14,0.96) 100%)' }}>
            <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, letterSpacing: 3, color: 'var(--cyan)', marginBottom: 10, textTransform: 'uppercase' }}>
              Session Progress
            </div>
            <div style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 16, color: 'var(--silver2)', lineHeight: 1.7 }}>
              {sessionFinished
                ? 'All exercises confirmed. Your workout is being saved first, then the post-session check-in opens separately.'
                : `${PHASE_STYLES[routine.phases[activePhaseIndex]?.pillar || 'release'].label} block is live. Tick sets across the exercises in any order, then the next block unlocks.`}
            </div>
            {!sessionFinished && (
              <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, letterSpacing: 3, color: 'var(--cyan)', marginTop: 10, textTransform: 'uppercase' }}>
                {totalCompletedSets} / {totalSetCount} total sets completed
              </div>
            )}
            {sessionFinished && (
              <div style={{ marginTop: 16, display: 'grid', gap: 14 }}>
                <div style={{ border: '1px solid rgba(139,231,255,0.28)', background: 'linear-gradient(180deg, rgba(0,180,216,0.12) 0%, rgba(8,10,14,0.98) 100%)', padding: '20px 22px' }}>
                  <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, letterSpacing: 4, color: 'var(--cyan)', marginBottom: 10, textTransform: 'uppercase' }}>
                    {'// Session Saved'}
                  </div>
                  <div style={{ fontFamily: "'Syncopate',sans-serif", fontSize: 16, fontWeight: 700, letterSpacing: 3, color: 'var(--white)', marginBottom: 10, textTransform: 'uppercase' }}>
                    {progressSaved ? 'WORKOUT COUNTED IN YOUR STATS' : loggingProgress ? 'SAVING WORKOUT PROGRESS...' : progressCapped ? 'DAILY WORKOUT LIMIT REACHED' : 'WORKOUT PROGRESS NEEDS RETRY'}
                  </div>
                  <div style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 15, color: 'var(--silver2)', lineHeight: 1.75, marginBottom: 14 }}>
                    {progressSaved
                      ? 'Your workout duration has already been fed into your dashboard stats and weekly summary. The questionnaire is a separate feedback step.'
                      : loggingProgress
                        ? 'We are saving this workout into your progress history now before opening the questionnaire.'
                        : progressCapped
                          ? 'You finished the session, but both workout slots for today are already counted, so this one will not be added to your stats. Your next workout counts tomorrow, and the check-in below is still open.'
                          : 'The workout itself needs to save successfully before the questionnaire step. Retry this save first so the dashboard and weekly stats update correctly.'}
                  </div>
                  {progressSaveError && (
                    <div style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 14, color: '#ffb7b7', lineHeight: 1.6, marginBottom: 12 }}>
                      {progressSaveError}
                    </div>
                  )}
                  {!progressSaved && !progressCapped && (
                  <button className="btn-primary" onClick={() => { void logCompletedSessionProgress().then((ok) => { if (ok) { setPostSessionDismissed(false); setShowPostSessionModal(true) } }) }} disabled={loggingProgress}>
                    {loggingProgress ? 'SAVING WORKOUT...' : 'SAVE WORKOUT TO STATS'}
                  </button>
                )}
                </div>

                <div style={{ border: '1px solid rgba(139,231,255,0.28)', background: 'linear-gradient(180deg, rgba(0,180,216,0.12) 0%, rgba(8,10,14,0.98) 100%)', padding: '20px 22px' }}>
                  <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, letterSpacing: 4, color: 'var(--cyan)', marginBottom: 10, textTransform: 'uppercase' }}>
                    {'// Saved Workout'}
                  </div>
                  <div style={{ fontFamily: "'Syncopate',sans-serif", fontSize: 16, fontWeight: 700, letterSpacing: 3, color: 'var(--white)', marginBottom: 10, textTransform: 'uppercase' }}>
                    {isSaved ? 'WORKOUT SAVED TO YOUR LIBRARY' : 'SAVE THIS WORKOUT FOR LATER'}
                  </div>
                  <div style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 15, color: 'var(--silver2)', lineHeight: 1.75 }}>
                    {isSaved
                      ? `This workout is in your saved library and can be repeated later. You can keep up to ${MAX_SAVED_WORKOUTS} saved workouts at a time.`
                      : `Tap the star to keep this workout in your repeat library. Only starred workouts are saved, and you can keep up to ${MAX_SAVED_WORKOUTS} at a time.`}
                  </div>
                  {saveError && (
                    <div style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 14, color: '#ff8f8f', lineHeight: 1.6, marginTop: 10 }}>
                      {saveError}
                    </div>
                  )}
                  {!isSaved && (
                    <div style={{ marginTop: 16, display: 'grid', gap: 10 }}>
                      <button className="btn-primary" onClick={saveRoutine} disabled={saving}>
                        {saving ? 'SAVING...' : '★ SAVE TO MY WORKOUTS'}
                      </button>
                      <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 9, letterSpacing: 2, color: 'var(--silver3)', textTransform: 'uppercase' }}>
                        appears in saved workouts for quick repeat access
                      </div>
                    </div>
                  )}
                </div>
                <div>
                  <button className="btn-primary" onClick={() => { setPostSessionDismissed(false); setShowPostSessionModal(true) }} disabled={!progressSaved && !progressCapped}>
                    {postSessionCompleted ? 'POST SESSION CHECK-IN SAVED' : postSessionDismissed ? 'REOPEN OPTIONAL POST SESSION CHECK-IN' : 'OPEN OPTIONAL POST SESSION CHECK-IN'}
                  </button>
                </div>
              </div>
            )}
          </div>

          {(routine.evidenceSummary || studies.length > 0) && (
            <div
              id="routine-evidence-section"
              style={{
                border: '1px solid rgba(0,180,216,0.2)',
                padding: '32px 34px',
                marginTop: 40,
                background: 'linear-gradient(180deg, rgba(14,18,24,0.98) 0%, rgba(5,7,10,0.98) 100%)',
                boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04)',
              }}
            >
              <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 9, letterSpacing: 4, color: 'var(--cyan3)', marginBottom: 10, textTransform: 'uppercase' }}>
                Research Rationale
              </div>
              <div style={{ fontFamily: "'Syncopate',sans-serif", fontSize: 'clamp(20px,3vw,28px)', letterSpacing: 2, color: 'var(--white)', marginBottom: 16 }}>
                PAPERS BEHIND THIS SESSION
              </div>
              {routine.evidenceSummary && (
                <div style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 15, color: 'var(--silver)', lineHeight: 1.8, marginBottom: 20, maxWidth: 820 }}>
                  {routine.evidenceSummary}
                </div>
              )}
              <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 9, letterSpacing: 2.5, color: 'var(--silver4)', marginBottom: 24, textTransform: 'uppercase' }}>
                Evidence-backed programming. Trusted by practitioners. References available if you want them.
              </div>

              {featuredEvidence.length > 0 && (
                <div className="mg-grid-2" style={{ gap: 14, marginBottom: 22 }}>
                  {featuredEvidence.map((item, index) => (
                    <div
                      key={`${item.study}-${index}`}
                      style={{
                        border: '1px solid rgba(255,255,255,0.08)',
                        background: 'linear-gradient(180deg, rgba(255,255,255,0.03) 0%, rgba(10,12,16,0.96) 100%)',
                        padding: '16px 16px 14px',
                      }}
                    >
                      <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 8, letterSpacing: 3, color: 'var(--cyan)', textTransform: 'uppercase', marginBottom: 10 }}>
                        {PHASE_STYLES[item.pillar]?.label || item.pillar} / {item.exerciseName}
                      </div>
                      <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: 'var(--silver3)', lineHeight: 1.8 }}>
                        {item.study}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {studies.length > 0 && (
                <details style={{ marginTop: 6, borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: 18 }}>
                  <summary
                    style={{
                      fontFamily: "'DM Mono',monospace",
                      fontSize: 9,
                      letterSpacing: 3,
                      color: 'var(--silver3)',
                      textTransform: 'uppercase',
                      cursor: 'pointer',
                      listStyle: 'none',
                    }}
                  >
                    View Full Reference List ({studies.length})
                  </summary>
                  <div style={{ display: 'grid', gap: 10, marginTop: 16 }}>
                    {studies.map((study, index) => (
                      <div
                        key={index}
                        style={{
                          fontFamily: "'DM Mono',monospace",
                          fontSize: 11,
                          color: 'var(--silver3)',
                          lineHeight: 1.8,
                          letterSpacing: 0.2,
                          padding: '10px 12px',
                          border: '1px solid rgba(255,255,255,0.06)',
                          background: 'rgba(255,255,255,0.02)',
                        }}
                      >
                        {study}
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </div>
          )}

          <div className="mg-mobile-stack" style={{ justifyContent: 'center', padding: '52px 0' }}>
            <button className="btn-outline" onClick={() => router.push('/dashboard')}>HOME</button>
            <button className="btn-primary" onClick={() => router.push(builderHref)}>{builderLabel}</button>
          </div>
        </div>
      </main>
      {expandedVideo && (
        <div
          onClick={() => setExpandedVideo(null)}
          className="routine-video-modal"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 20,
            background: 'rgba(0,0,0,0.88)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '24px',
          }}
        >
          <div
            onClick={(event) => event.stopPropagation()}
            className="routine-video-modal-card"
            style={{
              width: 'min(1100px, 96vw)',
              background: 'var(--black2)',
              border: '1px solid rgba(255,255,255,0.08)',
              boxShadow: '0 24px 80px rgba(0,0,0,0.45)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, padding: '14px 18px', borderBottom: '1px solid var(--border)' }}>
              <div style={{ fontFamily: "'Syncopate',sans-serif", fontSize: 13, letterSpacing: 2, color: 'var(--white)' }}>
                {expandedVideo.title}
              </div>
              <button
                type="button"
                onClick={() => setExpandedVideo(null)}
                style={{
                  border: '1px solid rgba(255,255,255,0.12)',
                  background: 'transparent',
                  color: 'var(--silver2)',
                  padding: '8px 12px',
                  fontFamily: "'DM Mono',monospace",
                  fontSize: 9,
                  letterSpacing: 2,
                  textTransform: 'uppercase',
                  cursor: 'pointer',
                }}
              >
                Close
              </button>
            </div>
            <div style={{ position: 'relative', paddingTop: '56.25%' }}>
              <iframe
                src={getExerciseVideoEmbedUrl(expandedVideo.youtubeVideoId)}
                title={expandedVideo.title}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
                style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 'none', display: 'block' }}
              />
            </div>
          </div>
        </div>
      )}
      <PreSessionReadinessModal
        open={showReadinessModal}
        allowClose
        onClose={() => setShowReadinessModal(false)}
        onComplete={() => {
          setHasTodayReadiness(true)
          setShowReadinessModal(false)
        }}
      />
      <PostSessionCheckinModal
        open={showPostSessionModal}
        onClose={() => {
          setShowPostSessionModal(false)
          setPostSessionDismissed(true)
        }}
        onComplete={() => {
          setPostSessionCompleted(true)
          setPostSessionDismissed(false)
          setShowPostSessionModal(false)
        }}
      />
      <style jsx global>{`
        @media (max-width: 1024px) {
          .routine-page-shell {
            padding-left: 18px;
            padding-right: 18px;
          }
        }

        @media (max-width: 860px) {
          .routine-hero-shell {
            display: grid !important;
            grid-template-columns: 1fr !important;
          }

          .routine-sidebar {
            width: 100% !important;
          }

          .routine-sidebar-card {
            position: static !important;
            top: auto !important;
          }

          .mg-routine-exercise-row {
            grid-template-columns: 1fr !important;
          }

          .routine-media-panel {
            border-right: none !important;
            border-bottom: 1px solid var(--border) !important;
          }

          .routine-video-modal {
            padding: 12px !important;
          }

          .routine-video-modal-card {
            width: 100% !important;
          }
        }

        @media (max-width: 640px) {
          .routine-page-shell {
            padding-left: 14px;
            padding-right: 14px;
          }
        }
      `}</style>
    </>
  )
}
