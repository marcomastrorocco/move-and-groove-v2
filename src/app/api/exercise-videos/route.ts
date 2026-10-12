import { NextRequest, NextResponse } from 'next/server'
import { createAccessTokenClient, createAuthClient } from '@/lib/supabase/admin'

export async function GET(req: NextRequest) {
  try {
    const authHeader = req.headers.get('authorization') || ''
    const accessToken = authHeader.startsWith('Bearer ')
      ? authHeader.slice('Bearer '.length).trim()
      : ''

    if (!accessToken) {
      return NextResponse.json({ error: 'Missing exercise video access token.' }, { status: 401 })
    }

    const authClient = createAuthClient(accessToken)
    const {
      data: { user },
      error: authError,
    } = await authClient.auth.getUser(accessToken)

    if (authError || !user) {
      return NextResponse.json({ error: 'Exercise video request is not authenticated.' }, { status: 401 })
    }

    const { searchParams } = new URL(req.url)
    const areas = searchParams.getAll('area')
    const pillars = searchParams.getAll('pillar')
    const nameParams = searchParams.getAll('name')
    const names = (areas.length || pillars.length
      ? nameParams
      : nameParams.flatMap((value) => value.split(',')))
      .map((value) => value.trim())
      .slice(0, 50)
    const requests = names.map((name, index) => ({
      name,
      area: areas[index]?.trim() || '',
      pillar: pillars[index]?.trim() || '',
    })).filter((item) => item.name)

    if (requests.length === 0) {
      return NextResponse.json({ mappings: [] })
    }

    const supabase = createAccessTokenClient(accessToken)
    const uniqueNames = [...new Set(requests.map((item) => item.name))]
    const { data: exercises, error: exercisesError } = await supabase
      .from('exercises')
      .select('name, area, phase, youtube_id, updated_at')
      .in('name', uniqueNames)

    if (exercisesError) {
      throw new Error(exercisesError.message)
    }

    const catalogMatches = requests.map((item) => {
      const phase = item.pillar === 'prep' ? 'foam_roll' : item.pillar
      const matches = (exercises || []).filter((exercise) =>
        exercise.name === item.name
        && (!item.area || exercise.area === item.area)
        && (!phase || exercise.phase === phase),
      )
      return matches.length === 1 ? matches[0] : null
    })
    const legacyNames = [...new Set(requests.filter((_, index) => !catalogMatches[index]).map((item) => item.name))]
    const legacyByName = new Map<string, { youtube_id: string | null; updated_at: string | null }>()

    if (legacyNames.length > 0) {
      const { data: legacy, error: legacyError } = await supabase
        .from('exercise_videos')
        .select('exercise_name, youtube_id, updated_at')
        .in('exercise_name', legacyNames)
      if (legacyError) {
        console.warn('[exercise-videos] Legacy video lookup failed', legacyError)
      } else {
        for (const row of legacy || []) {
          legacyByName.set(row.exercise_name, { youtube_id: row.youtube_id, updated_at: row.updated_at })
        }
      }
    }

    const mappings = requests.flatMap((item, index) => {
      const mapping = catalogMatches[index] || legacyByName.get(item.name)
      if (!mapping) return []
      return [{
        exercise_name: item.name,
        target_area: item.area,
        pillar: item.pillar,
        youtube_id: mapping.youtube_id,
        updated_at: mapping.updated_at,
      }]
    })

    return NextResponse.json({ mappings }, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
