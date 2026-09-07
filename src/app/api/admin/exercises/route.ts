import { NextRequest, NextResponse } from 'next/server'
import { getStaticExerciseSeed, invalidateExerciseLibraryCache, type ExerciseArea, type ExercisePhase } from '@/lib/exercise-library'
import { requireAdminAccess } from '@/lib/supabase/admin'

type ExercisePayload = {
  name?: unknown
  area?: unknown
  phase?: unknown
  sets?: unknown
  reps?: unknown
  holdSeconds?: unknown
  movementPattern?: unknown
  anatomicalQuadrants?: unknown
  rationale?: unknown
  studyCitation?: unknown
  aliases?: unknown
  youtubeId?: unknown
  isActive?: unknown
}

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function optionalNumber(value: unknown) {
  if (value === null || value === undefined || value === '') return null
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isInteger(number) ? number : Number.NaN
}

function stringArray(value: unknown) {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean)
}

function normalizeYoutubeId(value: string) {
  if (!value) return null
  const match = value.match(/(?:[?&]v=|youtu\.be\/|embed\/)?([A-Za-z0-9_-]{11})(?:[?&/]|$)/)
  return match?.[1] || null
}

function validatePayload(body: ExercisePayload) {
  const name = text(body.name)
  const area = text(body.area).toLowerCase() as ExerciseArea
  const phase = text(body.phase).toLowerCase() as ExercisePhase
  const sets = optionalNumber(body.sets ?? 1)
  const reps = optionalNumber(body.reps)
  const holdSeconds = optionalNumber(body.holdSeconds)
  const movementPattern = text(body.movementPattern).toLowerCase()
  const youtubeRaw = text(body.youtubeId)

  if (!name) throw new Error('Exercise name is required.')
  if (!['hips', 'shoulders', 'spine'].includes(area)) throw new Error('Area must be hips, shoulders, or spine.')
  if (!['release', 'activation', 'range', 'foam_roll'].includes(phase)) throw new Error('Phase must be release, activation, range, or foam roll.')
  if (sets === null || !Number.isInteger(sets) || sets < 1) throw new Error('Sets must be a whole number of at least 1.')
  if ((reps === null) === (holdSeconds === null)) throw new Error('Enter either reps or hold seconds, not both.')
  if (!Number.isInteger(reps) && reps !== null) throw new Error('Reps must be a whole number.')
  if (!Number.isInteger(holdSeconds) && holdSeconds !== null) throw new Error('Hold seconds must be a whole number.')
  if (reps !== null && reps < 6) throw new Error('Reps must be at least 6.')
  if (holdSeconds !== null && holdSeconds < 20) throw new Error('Hold seconds must be at least 20.')
  if (movementPattern && !['rotational', 'linear', 'lateral'].includes(movementPattern)) throw new Error('Movement pattern must be rotational, linear, or lateral.')
  if (youtubeRaw && !normalizeYoutubeId(youtubeRaw)) throw new Error('Enter a valid YouTube URL or 11-character video ID.')

  return {
    name,
    area,
    phase,
    sets,
    reps,
    hold_seconds: holdSeconds,
    movement_pattern: movementPattern || null,
    anatomical_quadrants: stringArray(body.anatomicalQuadrants),
    rationale: text(body.rationale),
    study_citation: text(body.studyCitation),
    aliases: stringArray(body.aliases),
    youtube_id: normalizeYoutubeId(youtubeRaw),
    is_active: typeof body.isActive === 'boolean' ? body.isActive : true,
  }
}

function responseError(error: unknown) {
  const message = error instanceof Error ? error.message : 'Unknown error'
  const status = message.includes('Admin') || message.includes('admin access') ? 401 : message.includes('required') || message.includes('must be') || message.includes('Enter') ? 400 : 500
  return NextResponse.json({ error: message }, { status })
}

export async function GET(req: NextRequest) {
  try {
    const { serviceClient } = await requireAdminAccess(req)
    const { data, error } = await serviceClient
      .from('exercises')
      .select('id, name, area, phase, sets, reps, hold_seconds, movement_pattern, anatomical_quadrants, rationale, study_citation, aliases, youtube_id, is_active, created_at, updated_at')
      .order('area')
      .order('phase')
      .order('name')
    if (error) throw new Error(error.message)
    return NextResponse.json({ exercises: data || [] })
  } catch (error) {
    return responseError(error)
  }
}

export async function POST(req: NextRequest) {
  try {
    const { serviceClient } = await requireAdminAccess(req)
    const body = await req.json() as ExercisePayload
    const exercise = validatePayload(body)
    const { data: existing, error: existingError } = await serviceClient
      .from('exercises')
      .select('id')
      .ilike('name', exercise.name)
      .eq('area', exercise.area)
      .eq('phase', exercise.phase)
      .maybeSingle()
    if (existingError) throw new Error(existingError.message)
    if (existing) return NextResponse.json({ error: 'An exercise with this name already exists.' }, { status: 409 })

    const { data, error } = await serviceClient
      .from('exercises')
      .insert(exercise)
      .select('id, name, area, phase, sets, reps, hold_seconds, movement_pattern, anatomical_quadrants, rationale, study_citation, aliases, youtube_id, is_active, created_at, updated_at')
      .single()
    if (error) throw new Error(error.message)
    invalidateExerciseLibraryCache()
    return NextResponse.json({ exercise: data }, { status: 201 })
  } catch (error) {
    return responseError(error)
  }
}

// This is deliberately a one-time, idempotent import. It preserves the static library
// until the database-backed library has been reviewed by an admin.
export async function PUT(req: NextRequest) {
  try {
    const { serviceClient } = await requireAdminAccess(req)
    const body = await req.json() as { seed?: boolean }
    if (!body.seed) return NextResponse.json({ error: 'Use the exercise ID route to edit an exercise.' }, { status: 400 })

    const seed = getStaticExerciseSeed().map((exercise) => ({ ...exercise, is_active: true }))
    const { data: videoRows, error: videoError } = await serviceClient.from('exercise_videos').select('exercise_name, youtube_id')
    if (videoError) throw new Error(videoError.message)
    const videoByName = new Map((videoRows || []).map((row) => [row.exercise_name.toLowerCase(), row.youtube_id]))
    const rows = seed.map((exercise) => ({ ...exercise, youtube_id: videoByName.get(exercise.name.toLowerCase()) || null }))
    const { data, error } = await serviceClient.from('exercises').upsert(rows, { onConflict: 'name,area,phase' }).select('id')
    if (error) throw new Error(error.message)
    invalidateExerciseLibraryCache()
    return NextResponse.json({ seeded: data?.length || 0 })
  } catch (error) {
    return responseError(error)
  }
}
