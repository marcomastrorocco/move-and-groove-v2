import type { ReadinessAdjustmentSnapshot, ReadinessMode } from '@/lib/readiness'
import type { SupabaseClient } from '@supabase/supabase-js'

type ReadinessLogRow = {
  created_at?: string | null
  date?: string | null
  user_id: string
  sleep_quality?: number | null
  energy_level?: number | null
  soreness_level?: number | null
  niggled_region?: string | null
  training_context?: string | null
  intensity_modifier?: string | null
  session_type?: string | null
  avoid_passive_holds?: boolean | null
  reduce_region?: string | null
}

function toDateKey(isoString = new Date().toISOString()) {
  return isoString.slice(0, 10)
}

function mapSorenessArea(area: string) {
  const normalized = area.trim().toLowerCase()

  if (normalized === 'shoulders') return 'shoulders'
  if (normalized === 'neck' || normalized === 'upper back' || normalized === 'lower back') return 'spine'
  if (normalized === 'hips' || normalized === 'knees' || normalized === 'ankles') return 'hips'
  return null
}

function parseAreaList(value: string | null | undefined) {
  if (!value) return []
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

function toStoredAreaList(areas: string[]) {
  return areas.length > 0 ? areas.join(', ') : null
}

function normalizeEnergyFromSnapshot(snapshot: ReadinessAdjustmentSnapshot) {
  return snapshot.answers.mood ?? snapshot.answers.energy ?? 4
}

function inferRestrictedAreas(row: ReadinessLogRow) {
  const explicit = parseAreaList(row.reduce_region)
  if (explicit.length > 0) {
    return [...new Set(explicit.map(mapSorenessArea).filter(Boolean))] as string[]
  }

  return [...new Set(parseAreaList(row.niggled_region).map(mapSorenessArea).filter(Boolean))] as string[]
}

export function buildPreSessionReadinessInsert({
  userId,
  snapshot,
}: {
  userId: string
  snapshot: ReadinessAdjustmentSnapshot
}) {
  return {
    user_id: userId,
    date: toDateKey(snapshot.checked_at),
    sleep_quality: snapshot.answers.sleep ?? null,
    energy_level: normalizeEnergyFromSnapshot(snapshot),
    soreness_level: snapshot.sorenessSeverity || (snapshot.answers.soreness ? 5 - snapshot.answers.soreness : null),
    niggled_region: toStoredAreaList(snapshot.sorenessAreas),
    training_context: snapshot.sorenessNotes || snapshot.userMessage,
    intensity_modifier: snapshot.modificationMode,
    session_type: 'pre',
    avoid_passive_holds: snapshot.modificationMode === 'recovery',
    reduce_region: toStoredAreaList(snapshot.restrictedAreas),
  }
}

export function buildPostSessionCheckinInsert({
  userId,
  answers,
}: {
  userId: string
  answers: Record<string, number>
}) {
  const areaFocus =
    answers.areas === 4
      ? 'hips'
      : answers.areas === 3
        ? 'shoulders'
        : answers.areas === 2
          ? 'spine'
          : ''

  return {
    user_id: userId,
    date: toDateKey(),
    sleep_quality: null,
    energy_level: answers.feel ?? null,
    soreness_level: answers.rpe ?? null,
    niggled_region: areaFocus || null,
    training_context: `post-session: completion=${answers.completion ?? 'na'}, feel=${answers.feel ?? 'na'}, rpe=${answers.rpe ?? 'na'}`,
    intensity_modifier: answers.completion && answers.completion >= 3 ? 'normal' : 'modified',
    session_type: 'post',
    avoid_passive_holds: false,
    reduce_region: areaFocus || null,
  }
}

export async function upsertReadinessLog(
  supabase: SupabaseClient,
  row: Record<string, unknown>,
) {
  const userId = typeof row.user_id === 'string' ? row.user_id : ''
  const date = typeof row.date === 'string' ? row.date : ''
  const sessionType = typeof row.session_type === 'string' ? row.session_type : ''

  if (!userId || !date || !sessionType) {
    throw new Error('Readiness log row is missing user_id, date, or session_type.')
  }

  const { data: existing, error: existingError } = await supabase
    .from('readiness_logs')
    .select('id')
    .eq('user_id', userId)
    .eq('date', date)
    .eq('session_type', sessionType)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string }>()

  if (existingError) {
    throw existingError
  }

  if (existing?.id) {
    const { error: updateError } = await supabase
      .from('readiness_logs')
      .update(row)
      .eq('id', existing.id)

    if (updateError) {
      throw updateError
    }
    return
  }

  const { error: insertError } = await supabase.from('readiness_logs').insert([row])
  if (insertError) {
    throw insertError
  }
}

export async function readLatestPreSessionReadinessLog(supabase: SupabaseClient, userId: string) {
  const todayKey = toDateKey()
  const { data, error } = await supabase
    .from('readiness_logs')
    .select('created_at,date,user_id,sleep_quality,energy_level,soreness_level,niggled_region,training_context,intensity_modifier,session_type,avoid_passive_holds,reduce_region')
    .eq('user_id', userId)
    .eq('session_type', 'pre')
    .eq('date', todayKey)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle<ReadinessLogRow>()

  if (error) {
    throw error
  }

  return data
}

export function buildReadinessSnapshotFromLog(row: ReadinessLogRow | null) {
  if (!row) {
    return null
  }

  const sorenessAreas = parseAreaList(row.niggled_region)
  const restrictedAreas = inferRestrictedAreas(row)
  const sorenessSeverity = typeof row.soreness_level === 'number' ? row.soreness_level : 0
  const sleep = typeof row.sleep_quality === 'number' ? row.sleep_quality : 0
  const energy = typeof row.energy_level === 'number' ? row.energy_level : 0

  if (!sleep && !energy && !sorenessSeverity && sorenessAreas.length === 0) {
    return null
  }

  const readinessScore = Math.round(((sleep + energy + Math.max(1, 5 - Math.min(sorenessSeverity, 4))) / 12) * 100)
  const modificationMode: ReadinessMode =
    row.intensity_modifier === 'recovery' || row.avoid_passive_holds
      ? 'recovery'
      : row.intensity_modifier === 'avoid_sore_areas'
        ? 'avoid_sore_areas'
        : row.intensity_modifier === 'modified'
          ? 'modified'
          : 'normal'

  const readinessLabel =
    modificationMode === 'recovery'
      ? 'REST OR RECOVER'
      : modificationMode === 'avoid_sore_areas'
        ? 'MODIFIED SESSION'
        : readinessScore >= 80
          ? 'READY TO PERFORM'
          : readinessScore >= 60
            ? 'GOOD TO GO'
            : 'MODIFIED SESSION'

  return {
    checked_at: row.created_at || new Date().toISOString(),
    readinessScore,
    readinessLabel,
    readinessRecommendation:
      modificationMode === 'recovery'
        ? 'Keep the session restorative and reduce aggressive range work.'
        : modificationMode === 'avoid_sore_areas'
          ? 'Bias away from sore areas and use more release before control work.'
          : readinessScore >= 80
            ? 'Use the full session normally.'
            : "Keep the session controlled and honest to today's state.",
    sorenessAreas,
    sorenessSeverity,
    sorenessNotes: row.training_context || null,
    restrictedAreas,
    modificationMode,
    userMessage: row.training_context || "Today's readiness check has been applied to your session.",
    answers: {
      sleep,
      soreness: Math.max(1, 5 - Math.min(Math.max(sorenessSeverity, 1), 4)),
      mood: energy,
      energy,
    },
  }
}
