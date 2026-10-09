import { NextRequest, NextResponse } from 'next/server'
import { createServiceRoleClient, requireAdminAccess } from '@/lib/supabase/admin'

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
  if (typeof body.isActive !== 'boolean') throw new Error('Active status must be true or false.')
  return { name, area, phase, sets, reps, hold_seconds: hold, movement_pattern: movement || null, anatomical_quadrants: array(body.anatomicalQuadrants), rationale: text(body.rationale), study_citation: text(body.studyCitation), aliases: array(body.aliases), youtube_id: videoId(youtube), is_active: body.isActive }
}

async function guardLastActiveSlot(
  serviceClient: ReturnType<typeof createServiceRoleClient>,
  id: string,
  next: { area?: string; phase?: string; isActive?: boolean },
) {
  const { data: current, error: currentError } = await serviceClient
    .from('exercises')
    .select('area, phase, is_active')
    .eq('id', id)
    .single()
  if (currentError) throw new Error(currentError.message)

  const leavesSlot = current.is_active && (
    next.isActive === false ||
    (next.area !== undefined && next.area !== current.area) ||
    (next.phase !== undefined && next.phase !== current.phase)
  )
  if (!leavesSlot) return null

  const { count, error: countError } = await serviceClient
    .from('exercises')
    .select('id', { count: 'exact', head: true })
    .eq('area', current.area)
    .eq('phase', current.phase)
    .eq('is_active', true)
    .neq('id', id)
  if (countError) throw new Error(countError.message)
  if ((count || 0) > 0) return null

  return NextResponse.json(
    { error: `At least one exercise must stay active in ${current.area} / ${current.phase}.` },
    { status: 409 },
  )
}

export async function PUT(req: NextRequest, { params }: Context) {
  try {
    const { serviceClient } = await requireAdminAccess(req)
    const { id } = await params
    const payload = validate(await req.json() as Record<string, unknown>)
    const guardResponse = await guardLastActiveSlot(serviceClient, id, {
      area: payload.area,
      phase: payload.phase,
      isActive: payload.is_active,
    })
    if (guardResponse) return guardResponse
    const { data, error } = await serviceClient.from('exercises').update(payload).eq('id', id).select().single()
    if (error) throw new Error(error.message)
    return NextResponse.json({ exercise: data })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not update exercise.'
    return NextResponse.json({ error: message }, { status: message.includes('Admin') ? 401 : 400 })
  }
}

// Supports correcting a title or toggling whether an exercise can be generated
// without requiring an admin to resubmit the full programming form.
export async function PATCH(req: NextRequest, { params }: Context) {
  try {
    const { serviceClient } = await requireAdminAccess(req)
    const { id } = await params
    const body: unknown = await req.json()
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: 'PATCH body must be an object.' }, { status: 400 })
    }

    const patch = body as Record<string, unknown>
    const unsupportedFields = Object.keys(patch).filter((key) => key !== 'name' && key !== 'isActive')
    if (unsupportedFields.length > 0) {
      return NextResponse.json({ error: 'Only name and isActive can be updated here.' }, { status: 400 })
    }
    const changesName = Object.prototype.hasOwnProperty.call(patch, 'name')
    const changesActiveStatus = Object.prototype.hasOwnProperty.call(patch, 'isActive')

    if (!changesName && !changesActiveStatus) {
      return NextResponse.json({ error: 'Provide a name or active status.' }, { status: 400 })
    }

    const updates: { name?: string; is_active?: boolean } = {}

    if (changesName) {
      const name = text(patch.name)
      if (!name) return NextResponse.json({ error: 'Exercise name is required.' }, { status: 400 })

      const { data: current, error: currentError } = await serviceClient
        .from('exercises')
        .select('area, phase')
        .eq('id', id)
        .single()
      if (currentError) throw new Error(currentError.message)

      const { data: duplicate, error: duplicateError } = await serviceClient
        .from('exercises')
        .select('id')
        .ilike('name', name)
        .eq('area', current.area)
        .eq('phase', current.phase)
        .neq('id', id)
        .maybeSingle()
      if (duplicateError) throw new Error(duplicateError.message)
      if (duplicate) throw new Error('An exercise with this name already exists in this area and phase.')

      updates.name = name
    }

    if (changesActiveStatus) {
      if (typeof patch.isActive !== 'boolean') {
        return NextResponse.json({ error: 'isActive must be true or false.' }, { status: 400 })
      }
      updates.is_active = patch.isActive
    }

    if (updates.is_active === false) {
      const guardResponse = await guardLastActiveSlot(serviceClient, id, { isActive: false })
      if (guardResponse) return guardResponse
    }

    const { data, error } = await serviceClient
      .from('exercises')
      .update(updates)
      .eq('id', id)
      .select('id, name, is_active')
      .single()
    if (error) throw new Error(error.message)
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
    const guardResponse = await guardLastActiveSlot(serviceClient, id, { isActive: false })
    if (guardResponse) return guardResponse
    const { data, error } = await serviceClient.from('exercises').update({ is_active: false }).eq('id', id).select('id, is_active').single()
    if (error) throw new Error(error.message)
    return NextResponse.json({ exercise: data })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not deactivate exercise.'
    return NextResponse.json({ error: message }, { status: message.includes('Admin') ? 401 : 400 })
  }
}
