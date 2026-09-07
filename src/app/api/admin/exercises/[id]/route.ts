import { NextRequest, NextResponse } from 'next/server'
import { invalidateExerciseLibraryCache } from '@/lib/exercise-library'
import { requireAdminAccess } from '@/lib/supabase/admin'

type Context = { params: Promise<{ id: string }> }

function text(value: unknown) { return typeof value === 'string' ? value.trim() : '' }
function numberOrNull(value: unknown) {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isInteger(parsed) ? parsed : Number.NaN
}
function array(value: unknown) { return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean) : [] }
function videoId(value: string) {
  if (!value) return null
  return value.match(/(?:[?&]v=|youtu\.be\/|embed\/)?([A-Za-z0-9_-]{11})(?:[?&/]|$)/)?.[1] || null
}
function validate(body: Record<string, unknown>) {
  const name = text(body.name)
  const area = text(body.area).toLowerCase()
  const phase = text(body.phase).toLowerCase()
  const sets = numberOrNull(body.sets)
  const reps = numberOrNull(body.reps)
  const hold = numberOrNull(body.holdSeconds)
  const movement = text(body.movementPattern).toLowerCase()
  const youtube = text(body.youtubeId)
  if (!name || !['hips', 'shoulders', 'spine'].includes(area) || !['release', 'activation', 'range', 'foam_roll'].includes(phase)) throw new Error('Enter a name, valid area, and valid phase.')
  if (sets === null || !Number.isInteger(sets) || sets < 1) throw new Error('Sets must be at least 1.')
  if ((reps === null) === (hold === null) || (reps !== null && reps < 6) || (hold !== null && hold < 20)) throw new Error('Use either at least 6 reps or at least a 20 second hold.')
  if (movement && !['rotational', 'linear', 'lateral'].includes(movement)) throw new Error('Invalid movement pattern.')
  if (youtube && !videoId(youtube)) throw new Error('Invalid YouTube URL or ID.')
  return { name, area, phase, sets, reps, hold_seconds: hold, movement_pattern: movement || null, anatomical_quadrants: array(body.anatomicalQuadrants), rationale: text(body.rationale), study_citation: text(body.studyCitation), aliases: array(body.aliases), youtube_id: videoId(youtube), is_active: typeof body.isActive === 'boolean' ? body.isActive : true }
}

export async function PUT(req: NextRequest, { params }: Context) {
  try {
    const { serviceClient } = await requireAdminAccess(req)
    const { id } = await params
    const payload = validate(await req.json() as Record<string, unknown>)
    const { data, error } = await serviceClient.from('exercises').update(payload).eq('id', id).select().single()
    if (error) throw new Error(error.message)
    invalidateExerciseLibraryCache()
    return NextResponse.json({ exercise: data })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not update exercise.'
    return NextResponse.json({ error: message }, { status: message.includes('Admin') ? 401 : 400 })
  }
}

export async function DELETE(req: NextRequest, { params }: Context) {
  try {
    const { serviceClient } = await requireAdminAccess(req)
    const { id } = await params
    const { data, error } = await serviceClient.from('exercises').update({ is_active: false }).eq('id', id).select('id, is_active').single()
    if (error) throw new Error(error.message)
    invalidateExerciseLibraryCache()
    return NextResponse.json({ exercise: data })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not deactivate exercise.'
    return NextResponse.json({ error: message }, { status: message.includes('Admin') ? 401 : 400 })
  }
}
