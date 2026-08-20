'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Header from '@/components/Header'
import { CURATED_ROUTINE_LIBRARY, type CuratedArea, type CuratedPillar, type CuratedRoutineExerciseTemplate } from '@/lib/curated-mobility'
import { EXERCISE_VIDEO_LIBRARY, getExerciseVideo } from '@/lib/exercise-videos'
import { isDemoSessionActive } from '@/lib/demo-session'
import { EDITABLE_CONFIG_FIELDS, type AppConfigValues, type EditableConfigKey } from '@/lib/app-config'
import { createClient } from '@/lib/supabase/client'

type AdminOverview = {
  users: {
    totalRegisteredUsers: number
    newSignupsThisWeek: number
    totalScreeningsCompleted: number
    totalRoutinesGenerated: number
  }
  routines: {
    mostPopularSports: Array<{ label: string; count: number }>
    mostPopularGoals: Array<{ label: string; count: number }>
    averageSessionDuration: number
  }
}

type ConfigStatus = 'idle' | 'saving' | 'saved' | 'error'

type ExerciseVideoOverride = {
  exercise_name: string
  youtube_id: string | null
  updated_at?: string | null
}

type BulkImportSummary = {
  added: number
  skipped: number
  errors: string[]
}

type YoutubeSyncResult = {
  matched: Array<{
    videoTitle: string
    exerciseName: string
    youtubeId: string
  }>
  skipped: string[]
  errors: string[]
  channelIdMasked?: string
}

type ExerciseAdminRow = {
  name: string
  area: CuratedArea
  pillar: CuratedPillar
  hardcodedYoutubeId: string
  groupKey: string
  groupLabel: string
  sortOrder: number
}

const UC = 'uppercase' as const
const GROUP_ORDER: Array<{ key: string; label: string }> = [
  { key: 'hips-release', label: 'HIPS — RELEASE' },
  { key: 'hips-activation', label: 'HIPS — ACTIVATION' },
  { key: 'hips-range', label: 'HIPS — RANGE' },
  { key: 'shoulders-release', label: 'SHOULDERS — RELEASE' },
  { key: 'shoulders-activation', label: 'SHOULDERS — ACTIVATION' },
  { key: 'shoulders-range', label: 'SHOULDERS — RANGE' },
  { key: 'spine-release', label: 'SPINE — RELEASE' },
  { key: 'spine-activation', label: 'SPINE — ACTIVATION' },
  { key: 'spine-range', label: 'SPINE — RANGE' },
  { key: 'foam-roll-hips', label: 'FOAM ROLL — HIPS' },
  { key: 'foam-roll-shoulders', label: 'FOAM ROLL — SHOULDERS' },
  { key: 'foam-roll-spine', label: 'FOAM ROLL — SPINE' },
]

const GROUP_ORDER_INDEX = Object.fromEntries(GROUP_ORDER.map((group, index) => [group.key, index]))

function getStandardGroup(area: CuratedArea, pillar: CuratedPillar) {
  const key = `${area}-${pillar}`
  const label = GROUP_ORDER.find((group) => group.key === key)?.label || `${area.toUpperCase()} — ${pillar.toUpperCase()}`
  return {
    key,
    label,
    sortOrder: GROUP_ORDER_INDEX[key] ?? 999,
  }
}

function getFoamRollGroup(area: CuratedArea) {
  const key = `foam-roll-${area}`
  const label = GROUP_ORDER.find((group) => group.key === key)?.label || `FOAM ROLL — ${area.toUpperCase()}`
  return {
    key,
    label,
    sortOrder: GROUP_ORDER_INDEX[key] ?? 999,
  }
}

function flattenCuratedExercises(): ExerciseAdminRow[] {
  const rows: ExerciseAdminRow[] = []
  const seen = new Set<string>()

  ;(Object.entries(CURATED_ROUTINE_LIBRARY) as Array<[CuratedArea, Record<CuratedPillar, CuratedRoutineExerciseTemplate[]>]>)
    .forEach(([area, phases]) => {
      ;(Object.entries(phases) as Array<[CuratedPillar, CuratedRoutineExerciseTemplate[]]>)
        .forEach(([pillar, exercises]) => {
          exercises.forEach((exercise) => {
            if (seen.has(exercise.name)) {
              return
            }

            const group = getStandardGroup(area, pillar)
            seen.add(exercise.name)
            rows.push({
              name: exercise.name,
              area,
              pillar,
              hardcodedYoutubeId: getExerciseVideo(exercise.name)?.youtubeVideoId || '',
              groupKey: group.key,
              groupLabel: group.label,
              sortOrder: group.sortOrder,
            })
          })
        })
    })

  EXERCISE_VIDEO_LIBRARY.forEach((entry) => {
    const normalizedTitle = entry.title.trim()
    if (!normalizedTitle || seen.has(normalizedTitle)) {
      return
    }

    const normalizedAliases = entry.aliases.map((alias) => alias.toLowerCase())
    const looksLikeFoamRoll = normalizedTitle.toLowerCase().includes('foam roll') || normalizedAliases.some((alias) => alias.includes('foam roll'))

    const area = entry.area as CuratedArea | undefined
    if (!looksLikeFoamRoll || !area || !['hips', 'shoulders', 'spine'].includes(area)) {
      return
    }

    const group = getFoamRollGroup(area)
    seen.add(normalizedTitle)
    rows.push({
      name: normalizedTitle,
      area,
      pillar: 'activation',
      hardcodedYoutubeId: entry.youtubeVideoId,
      groupKey: group.key,
      groupLabel: group.label,
      sortOrder: group.sortOrder,
    })
  })

  return rows
}

function normalizeYoutubeId(value: string) {
  const trimmed = value.trim()
  if (!trimmed) {
    return ''
  }

  const watchMatch = trimmed.match(/[?&]v=([A-Za-z0-9_-]{11})/)
  if (watchMatch) {
    return watchMatch[1]
  }

  const shortMatch = trimmed.match(/youtu\.be\/([A-Za-z0-9_-]{11})/)
  if (shortMatch) {
    return shortMatch[1]
  }

  const embedMatch = trimmed.match(/embed\/([A-Za-z0-9_-]{11})/)
  if (embedMatch) {
    return embedMatch[1]
  }

  const directMatch = trimmed.match(/^[A-Za-z0-9_-]{11}$/)
  if (directMatch) {
    return trimmed
  }

  return trimmed
}

function parseBulkMappings(text: string) {
  const errors: string[] = []
  const mappings: Array<{ exerciseName: string; youtubeId: string }> = []

  text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .forEach((line, index) => {
      if (!line) {
        return
      }

      const parts = line.includes('\t')
        ? line.split('\t')
        : line.includes('|')
          ? line.split('|')
          : line.split(',')

      if (parts.length < 2) {
        errors.push(`Line ${index + 1}: use "exercise name, youtube id" format.`)
        return
      }

      const rawExerciseName = parts[0].trim()
      const normalizedName = EXERCISE_NAME_LOOKUP.get(rawExerciseName.toLowerCase())
      const youtubeId = normalizeYoutubeId(parts.slice(1).join(',').trim())

      if (!normalizedName) {
        errors.push(`Line ${index + 1}: "${rawExerciseName}" is not in the current exercise library.`)
        return
      }

      if (!youtubeId || youtubeId.length !== 11) {
        errors.push(`Line ${index + 1}: invalid YouTube ID or URL for "${normalizedName}".`)
        return
      }

      mappings.push({
        exerciseName: normalizedName,
        youtubeId,
      })
    })

  return { mappings, errors }
}

const ALL_EXERCISES = flattenCuratedExercises()
const EXERCISE_NAME_LOOKUP = new Map(
  ALL_EXERCISES.map((exercise) => [exercise.name.trim().toLowerCase(), exercise.name] as const),
)

// Local preview only. Gated on NODE_ENV === 'development' at the call site, so
// this never becomes a way into the admin panel on a deployed build.
const DEMO_OVERVIEW: AdminOverview = {
  users: {
    totalRegisteredUsers: 128,
    newSignupsThisWeek: 14,
    totalScreeningsCompleted: 96,
    totalRoutinesGenerated: 212,
  },
  routines: {
    mostPopularSports: [
      { label: 'Running', count: 47 },
      { label: 'Football', count: 33 },
      { label: 'Cricket', count: 28 },
      { label: 'Swimming', count: 19 },
      { label: 'Cycling', count: 11 },
    ],
    mostPopularGoals: [
      { label: 'Injury Prevention', count: 58 },
      { label: 'Mobility', count: 44 },
      { label: 'Recovery', count: 31 },
      { label: 'Performance', count: 22 },
    ],
    averageSessionDuration: 18,
  },
}

const DEMO_CONFIG = Object.fromEntries(
  EDITABLE_CONFIG_FIELDS.map((field) => [field.key, field.fallback]),
) as AppConfigValues

function draftsFromConfig(values: AppConfigValues) {
  return Object.fromEntries(
    EDITABLE_CONFIG_FIELDS.map((field) => [field.key, String(values[field.key])]),
  ) as Record<EditableConfigKey, string>
}

export default function AdminPage() {
  const router = useRouter()
  const supabase = createClient()
  const [loading, setLoading] = useState(true)
  const [accessToken, setAccessToken] = useState('')
  const [overview, setOverview] = useState<AdminOverview | null>(null)
  const [overrides, setOverrides] = useState<Record<string, ExerciseVideoOverride>>({})
  const [search, setSearch] = useState('')
  const [error, setError] = useState('')
  const [saveStatus, setSaveStatus] = useState<Record<string, 'idle' | 'saving' | 'saved' | 'error'>>({})
  const [draftYoutubeIds, setDraftYoutubeIds] = useState<Record<string, string>>({})
  const [bulkDraft, setBulkDraft] = useState('')
  const [bulkSaving, setBulkSaving] = useState(false)
  const [bulkSummary, setBulkSummary] = useState<BulkImportSummary | null>(null)
  const [youtubeSyncLoading, setYoutubeSyncLoading] = useState(false)
  const [youtubeSyncResult, setYoutubeSyncResult] = useState<YoutubeSyncResult | null>(null)
  const [youtubeChannelMasked, setYoutubeChannelMasked] = useState('not configured')
  const [youtubeConfigured, setYoutubeConfigured] = useState(false)
  const [config, setConfig] = useState<AppConfigValues | null>(null)
  const [configDrafts, setConfigDrafts] = useState<Record<EditableConfigKey, string>>(() => draftsFromConfig(DEMO_CONFIG))
  const [configStatus, setConfigStatus] = useState<Partial<Record<EditableConfigKey, ConfigStatus>>>({})
  const [demoMode, setDemoMode] = useState(false)

  useEffect(() => {
    let mounted = true

    async function loadAdmin() {
      // Local preview of the admin UI without Supabase credentials. Never runs
      // in a production build.
      if (process.env.NODE_ENV === 'development' && isDemoSessionActive()) {
        if (!mounted) return
        setDemoMode(true)
        setOverview(DEMO_OVERVIEW)
        setConfig(DEMO_CONFIG)
        setConfigDrafts(draftsFromConfig(DEMO_CONFIG))
        setDraftYoutubeIds(
          Object.fromEntries(ALL_EXERCISES.map((exercise) => [exercise.name, exercise.hardcodedYoutubeId || ''])),
        )
        setLoading(false)
        return
      }

      const { data: { session } } = await supabase.auth.getSession()

      if (!mounted) return

      if (!session) {
        router.replace('/auth')
        return
      }

      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('is_admin')
        .eq('id', session.user.id)
        .maybeSingle()

      if (!mounted) return

      if (profileError || !profile?.is_admin) {
        router.replace('/dashboard')
        return
      }

      setAccessToken(session.access_token)

      try {
        const [overviewResponse, mappingsResponse, youtubeSyncResponse, configResponse] = await Promise.all([
          fetch('/api/admin/overview', {
            headers: { Authorization: `Bearer ${session.access_token}` },
          }),
          fetch('/api/admin/exercise-videos', {
            headers: { Authorization: `Bearer ${session.access_token}` },
          }),
          fetch('/api/admin/youtube-sync', {
            headers: { Authorization: `Bearer ${session.access_token}` },
          }),
          fetch('/api/admin/config', {
            headers: { Authorization: `Bearer ${session.access_token}` },
          }),
        ])

        const overviewPayload = await overviewResponse.json()
        const mappingsPayload = await mappingsResponse.json()
        const youtubeSyncPayload = await youtubeSyncResponse.json()
        const configPayload = await configResponse.json()

        if (!overviewResponse.ok) {
          throw new Error(overviewPayload.error || 'Could not load admin overview.')
        }

        if (!mappingsResponse.ok) {
          throw new Error(mappingsPayload.error || 'Could not load exercise video mappings.')
        }
        if (!youtubeSyncResponse.ok) {
          throw new Error(youtubeSyncPayload.error || 'Could not load YouTube sync settings.')
        }
        if (!configResponse.ok) {
          throw new Error(configPayload.error || 'Could not load app config.')
        }

        if (!mounted) return

        setOverview(overviewPayload)
        setYoutubeConfigured(Boolean(youtubeSyncPayload.configured))
        setYoutubeChannelMasked(youtubeSyncPayload.channelIdMasked || 'not configured')
        const nextOverrides = Object.fromEntries(
          (mappingsPayload.mappings as ExerciseVideoOverride[]).map((mapping) => [mapping.exercise_name, mapping]),
        )
        setOverrides(nextOverrides)
        setDraftYoutubeIds(
          Object.fromEntries(
            ALL_EXERCISES.map((exercise) => [exercise.name, nextOverrides[exercise.name]?.youtube_id || exercise.hardcodedYoutubeId || '']),
          ),
        )
        setConfig(configPayload.config)
        setConfigDrafts(draftsFromConfig(configPayload.config))
      } catch (loadError) {
        if (!mounted) return
        setError(loadError instanceof Error ? loadError.message : 'Could not load admin panel.')
      } finally {
        if (mounted) {
          setLoading(false)
        }
      }
    }

    void loadAdmin()
    return () => {
      mounted = false
    }
  }, [router, supabase])

  const filteredExercises = useMemo(() => {
    const normalized = search.trim().toLowerCase()
    if (!normalized) return ALL_EXERCISES

    return ALL_EXERCISES.filter((exercise) =>
      exercise.name.toLowerCase().includes(normalized)
      || exercise.area.toLowerCase().includes(normalized)
      || exercise.pillar.toLowerCase().includes(normalized),
    )
  }, [search])

  const groupedExercises = useMemo(() => {
    const rowsByGroup = new Map<string, ExerciseAdminRow[]>()

    filteredExercises.forEach((exercise) => {
      const existing = rowsByGroup.get(exercise.groupKey) || []
      existing.push(exercise)
      rowsByGroup.set(exercise.groupKey, existing)
    })

    return GROUP_ORDER
      .map((group) => ({
        key: group.key,
        label: group.label,
        exercises: rowsByGroup.get(group.key) || [],
      }))
      .filter((group) => group.exercises.length > 0)
  }, [filteredExercises])

  async function saveVideoMapping(exerciseName: string) {
    if (demoMode) {
      setOverrides((current) => ({
        ...current,
        [exerciseName]: {
          exercise_name: exerciseName,
          youtube_id: draftYoutubeIds[exerciseName] || '',
        },
      }))
      setSaveStatus((current) => ({ ...current, [exerciseName]: 'saved' }))
      window.setTimeout(() => {
        setSaveStatus((current) => ({ ...current, [exerciseName]: 'idle' }))
      }, 1800)
      return
    }

    if (!accessToken) return

    setSaveStatus((current) => ({ ...current, [exerciseName]: 'saving' }))
    setError('')

    try {
      const response = await fetch('/api/admin/exercise-videos', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          exerciseName,
          youtubeId: draftYoutubeIds[exerciseName] || '',
        }),
      })

      const payload = await response.json()
      if (!response.ok) {
        throw new Error(payload.error || 'Could not save exercise video mapping.')
      }

      setOverrides((current) => ({
        ...current,
        [exerciseName]: payload.mapping,
      }))
      setSaveStatus((current) => ({ ...current, [exerciseName]: 'saved' }))
      window.setTimeout(() => {
        setSaveStatus((current) => ({ ...current, [exerciseName]: 'idle' }))
      }, 1800)
    } catch (saveError) {
      setSaveStatus((current) => ({ ...current, [exerciseName]: 'error' }))
      setError(saveError instanceof Error ? saveError.message : 'Could not save exercise video mapping.')
    }
  }

  async function importBulkMappings() {
    if (demoMode) {
      const parsed = parseBulkMappings(bulkDraft)
      setDraftYoutubeIds((current) => ({
        ...current,
        ...Object.fromEntries(parsed.mappings.map((mapping) => [mapping.exerciseName, mapping.youtubeId])),
      }))
      setOverrides((current) => ({
        ...current,
        ...Object.fromEntries(
          parsed.mappings.map((mapping) => [
            mapping.exerciseName,
            { exercise_name: mapping.exerciseName, youtube_id: mapping.youtubeId },
          ]),
        ),
      }))
      setBulkSummary({ added: parsed.mappings.length, skipped: parsed.errors.length, errors: parsed.errors })
      if (parsed.mappings.length > 0) {
        setBulkDraft('')
      }
      return
    }

    if (!accessToken || bulkSaving) return

    setBulkSaving(true)
    setBulkSummary(null)
    setError('')

    try {
      const parsed = parseBulkMappings(bulkDraft)

      if (parsed.mappings.length === 0) {
        setBulkSummary({
          added: 0,
          skipped: parsed.errors.length,
          errors: parsed.errors.length > 0 ? parsed.errors : ['No valid mappings found.'],
        })
        return
      }

      const response = await fetch('/api/admin/exercise-videos', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          mappings: parsed.mappings,
        }),
      })

      const payload = await response.json()
      if (!response.ok) {
        throw new Error(payload.error || 'Could not import exercise video mappings.')
      }

      const returnedMappings = (payload.mappings as ExerciseVideoOverride[]) || []
      const nextOverrides = Object.fromEntries(returnedMappings.map((mapping) => [mapping.exercise_name, mapping]))

      setOverrides((current) => ({
        ...current,
        ...nextOverrides,
      }))
      setDraftYoutubeIds((current) => ({
        ...current,
        ...Object.fromEntries(returnedMappings.map((mapping) => [mapping.exercise_name, mapping.youtube_id || ''])),
      }))
      setBulkSummary({
        added: returnedMappings.length,
        skipped: parsed.errors.length,
        errors: parsed.errors,
      })
      setBulkDraft('')
    } catch (bulkError) {
      setBulkSummary({
        added: 0,
        skipped: 0,
        errors: [bulkError instanceof Error ? bulkError.message : 'Could not import video mappings.'],
      })
      setError(bulkError instanceof Error ? bulkError.message : 'Could not import video mappings.')
    } finally {
      setBulkSaving(false)
    }
  }

  async function syncFromYoutube() {
    if (!accessToken || youtubeSyncLoading) return

    setYoutubeSyncLoading(true)
    setYoutubeSyncResult(null)
    setError('')

    try {
      const response = await fetch('/api/admin/youtube-sync', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      })

      const payload = await response.json()
      if (!response.ok) {
        throw new Error(payload.error || 'Could not sync videos from YouTube.')
      }

      const matched = (payload.matched as YoutubeSyncResult['matched']) || []
      const nextOverrides = Object.fromEntries(
        matched.map((item) => [
          item.exerciseName,
          {
            exercise_name: item.exerciseName,
            youtube_id: item.youtubeId,
            updated_at: new Date().toISOString(),
          } as ExerciseVideoOverride,
        ]),
      )

      setYoutubeChannelMasked(payload.channelIdMasked || youtubeChannelMasked)
      setOverrides((current) => ({
        ...current,
        ...nextOverrides,
      }))
      setDraftYoutubeIds((current) => ({
        ...current,
        ...Object.fromEntries(matched.map((item) => [item.exerciseName, item.youtubeId])),
      }))
      setYoutubeSyncResult({
        matched,
        skipped: Array.isArray(payload.skipped) ? payload.skipped : [],
        errors: Array.isArray(payload.errors) ? payload.errors : [],
        channelIdMasked: payload.channelIdMasked,
      })
    } catch (syncError) {
      setYoutubeSyncResult({
        matched: [],
        skipped: [],
        errors: [syncError instanceof Error ? syncError.message : 'Could not sync videos from YouTube.'],
      })
      setError(syncError instanceof Error ? syncError.message : 'Could not sync videos from YouTube.')
    } finally {
      setYoutubeSyncLoading(false)
    }
  }

  function markConfigStatus(key: EditableConfigKey, status: ConfigStatus) {
    setConfigStatus((current) => ({ ...current, [key]: status }))
  }

  async function saveConfig(key: EditableConfigKey) {
    const fallback = EDITABLE_CONFIG_FIELDS.find((field) => field.key === key)?.fallback ?? 1

    if (demoMode) {
      const parsed = Number(configDrafts[key])
      setConfig((current) => ({
        ...(current || DEMO_CONFIG),
        [key]: Number.isFinite(parsed) && parsed > 0 ? parsed : fallback,
      }))
      markConfigStatus(key, 'saved')
      window.setTimeout(() => markConfigStatus(key, 'idle'), 1800)
      return
    }

    if (!accessToken) return

    markConfigStatus(key, 'saving')
    setError('')

    try {
      const response = await fetch('/api/admin/config', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          key,
          value: configDrafts[key],
        }),
      })

      const payload = await response.json()
      if (!response.ok) {
        throw new Error(payload.error || 'Could not save app config.')
      }

      setConfig((current) => ({ ...(current || DEMO_CONFIG), [key]: payload.value }))
      setConfigDrafts((current) => ({ ...current, [key]: String(payload.value) }))
      markConfigStatus(key, 'saved')
      window.setTimeout(() => markConfigStatus(key, 'idle'), 1800)
    } catch (configError) {
      markConfigStatus(key, 'error')
      setError(configError instanceof Error ? configError.message : 'Could not save app config.')
    }
  }

  if (loading) {
    return (
      <>
        <Header />
        <main style={{ position: 'relative', zIndex: 2, paddingTop: 64 }}>
          <div style={{ textAlign: 'center', padding: '120px 40px' }}>
            <div className="loading-ring" />
            <div style={{ fontFamily: "'Syncopate',sans-serif", fontSize: 11, letterSpacing: 4, color: 'var(--silver3)', textTransform: UC }}>
              LOADING ADMIN
            </div>
          </div>
        </main>
      </>
    )
  }

  return (
    <>
      <div style={{ position: 'fixed', inset: 0, zIndex: 0, pointerEvents: 'none', background: '#000000' }}>
        <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(circle at top, rgba(0,180,216,0.1) 0%, rgba(0,0,0,0) 36%), linear-gradient(to bottom, rgba(4,6,9,0.98) 0%, rgba(0,0,0,1) 100%)' }} />
      </div>

      <Header />

      <main style={{ position: 'relative', zIndex: 2, paddingTop: 64 }}>
        <div className="mg-page-shell" style={{ maxWidth: 1220 }}>
          <div style={{ marginBottom: 34 }}>
            <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, letterSpacing: 4, color: 'var(--cyan)', marginBottom: 10, textTransform: UC }}>
              {'// Internal Tooling'}
            </div>
            <div style={{ fontFamily: "'Syncopate',sans-serif", fontSize: 'clamp(34px,5vw,54px)', fontWeight: 700, letterSpacing: 4, color: 'var(--white)', lineHeight: 1.06, marginBottom: 14 }}>
              ADMIN PANEL
            </div>
            <div style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 16, color: 'var(--silver2)', lineHeight: 1.75, maxWidth: 760 }}>
              Manage the internal overview metrics and live exercise video mappings without touching the user-facing flows.
            </div>
            {demoMode && (
              <div style={{ marginTop: 16, border: '1px solid rgba(255,206,120,0.24)', background: 'rgba(255,206,120,0.07)', padding: '12px 14px', fontFamily: "'DM Sans',sans-serif", fontSize: 14, color: '#ffce78' }}>
                Local demo preview — metrics are sample values and nothing you save here is written to Supabase.
              </div>
            )}
            {error && (
              <div style={{ marginTop: 16, border: '1px solid rgba(255,143,143,0.2)', background: 'rgba(255,143,143,0.07)', padding: '12px 14px', fontFamily: "'DM Sans',sans-serif", fontSize: 14, color: '#ff9f9f' }}>
                {error}
              </div>
            )}
          </div>

          <section style={{ marginBottom: 36 }}>
            <div style={{ fontFamily: "'Syncopate',sans-serif", fontSize: 18, letterSpacing: 3, color: 'var(--white)', marginBottom: 16 }}>
              USERS
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 14 }}>
              {[
                { label: 'Total Registered Users', value: overview?.users.totalRegisteredUsers ?? 0 },
                { label: 'New Signups This Week', value: overview?.users.newSignupsThisWeek ?? 0 },
                { label: 'Total Screenings Completed', value: overview?.users.totalScreeningsCompleted ?? 0 },
                { label: 'Total Routines Generated', value: overview?.users.totalRoutinesGenerated ?? 0 },
              ].map((card) => (
                <div key={card.label} style={{ background: 'rgba(8,10,14,0.96)', border: '1px solid rgba(255,255,255,0.08)', padding: '22px 20px' }}>
                  <div style={{ fontFamily: "'Syncopate',sans-serif", fontSize: 34, letterSpacing: 2, color: 'var(--white)', lineHeight: 1, marginBottom: 8 }}>
                    {card.value}
                  </div>
                  <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 9, letterSpacing: 3, color: 'var(--cyan)', textTransform: UC }}>
                    {card.label}
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section style={{ marginBottom: 36 }}>
            <div style={{ fontFamily: "'Syncopate',sans-serif", fontSize: 18, letterSpacing: 3, color: 'var(--white)', marginBottom: 16 }}>
              CONFIG
            </div>
            <div style={{ background: 'rgba(8,10,14,0.96)', border: '1px solid rgba(255,255,255,0.08)', padding: '20px' }}>
              <div style={{ display: 'grid', gap: 24 }}>
                {EDITABLE_CONFIG_FIELDS.map((field) => {
                  const status = configStatus[field.key] || 'idle'

                  return (
                    <div key={field.key}>
                      <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, letterSpacing: 3, color: 'var(--cyan)', textTransform: UC, marginBottom: 6 }}>
                        {field.label}
                      </div>
                      <div style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 13, color: 'var(--silver3)', lineHeight: 1.6, marginBottom: 10 }}>
                        {field.hint}
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '180px 140px 100px', gap: 12, alignItems: 'center', maxWidth: 520 }}>
                        <div style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 14, color: 'var(--silver2)', lineHeight: 1.7 }}>
                          Current value: {config?.[field.key] ?? field.fallback}
                        </div>
                        <input
                          value={configDrafts[field.key] ?? ''}
                          onChange={(event) => {
                            const nextValue = event.target.value
                            setConfigDrafts((current) => ({ ...current, [field.key]: nextValue }))
                          }}
                          style={{
                            background: 'rgba(255,255,255,0.02)',
                            border: '1px solid rgba(255,255,255,0.1)',
                            color: 'var(--white)',
                            padding: '10px 12px',
                            fontFamily: "'DM Mono',monospace",
                            fontSize: 12,
                          }}
                        />
                        <button
                          type="button"
                          onClick={() => { void saveConfig(field.key) }}
                          style={{
                            width: '100%',
                            background: status === 'saved' ? 'rgba(0,180,216,0.18)' : 'transparent',
                            border: '1px solid rgba(0,180,216,0.28)',
                            color: status === 'error' ? '#ff9f9f' : 'var(--cyan)',
                            padding: '10px 8px',
                            cursor: 'pointer',
                            fontFamily: "'DM Mono',monospace",
                            fontSize: 9,
                            letterSpacing: 2,
                            textTransform: UC,
                          }}
                        >
                          {status === 'saving' ? 'Saving' : status === 'saved' ? 'Saved' : status === 'error' ? 'Retry' : 'Save'}
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </section>

          <section style={{ marginBottom: 36 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 16, marginBottom: 16 }}>
              <div>
                <div style={{ fontFamily: "'Syncopate',sans-serif", fontSize: 18, letterSpacing: 3, color: 'var(--white)', marginBottom: 8 }}>
                  VIDEO MANAGER
                </div>
                <div style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 15, color: 'var(--silver2)', lineHeight: 1.7 }}>
                  Save a YouTube ID to the live Supabase override table. Reads check that table first, then fall back to the hardcoded library.
                </div>
              </div>
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search exercise, area, or phase..."
                style={{
                  width: 360,
                  background: 'rgba(8,10,14,0.96)',
                  border: '1px solid rgba(255,255,255,0.12)',
                  color: 'var(--white)',
                  padding: '12px 14px',
                  fontFamily: "'DM Sans',sans-serif",
                  fontSize: 14,
                }}
              />
            </div>
            <div style={{ marginBottom: 18, border: '1px solid rgba(139,231,255,0.14)', background: 'rgba(8,10,14,0.98)', padding: '18px 18px 16px' }}>
              <div style={{ border: '1px solid rgba(0,180,216,0.16)', background: 'rgba(0,180,216,0.04)', padding: '16px 16px 14px', marginBottom: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 18, flexWrap: 'wrap', marginBottom: 10 }}>
                  <div>
                    <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, letterSpacing: 3, color: 'var(--cyan)', textTransform: UC, marginBottom: 8 }}>
                      YouTube Sync
                    </div>
                    <div style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 14, color: 'var(--silver2)', lineHeight: 1.7, maxWidth: 720 }}>
                      Pull videos directly from the configured YouTube channel, auto-match titles to curated exercise names, and save matches into the live override table. Best results come when video titles exactly match the exercise names in the library.
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => { void syncFromYoutube() }}
                    disabled={!youtubeConfigured || youtubeSyncLoading}
                    style={{
                      minWidth: 180,
                      background: youtubeSyncLoading ? 'rgba(0,180,216,0.18)' : 'transparent',
                      border: '1px solid rgba(0,180,216,0.28)',
                      color: youtubeConfigured ? 'var(--cyan)' : 'var(--silver4)',
                      padding: '10px 12px',
                      cursor: !youtubeConfigured || youtubeSyncLoading ? 'default' : 'pointer',
                      fontFamily: "'DM Mono',monospace",
                      fontSize: 9,
                      letterSpacing: 2,
                      textTransform: UC,
                    }}
                  >
                    {youtubeSyncLoading ? 'Syncing' : 'Sync From YouTube'}
                  </button>
                </div>
                <div style={{ display: 'grid', gap: 6 }}>
                  <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 9, letterSpacing: 2, color: youtubeConfigured ? 'var(--white)' : '#ffb6b6', textTransform: UC }}>
                    Channel: {youtubeChannelMasked}
                  </div>
                  <div style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 13, color: 'var(--silver3)', lineHeight: 1.6 }}>
                    {youtubeConfigured
                      ? 'Configured. The sync will fetch every video on the channel and save the matched exercise videos automatically.'
                      : 'Missing YOUTUBE_API_KEY or YOUTUBE_CHANNEL_ID. Add both in Vercel and .env.local before using sync.'}
                  </div>
                </div>
                {youtubeSyncResult && (
                  <div style={{ marginTop: 12, border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.02)', padding: '12px 14px' }}>
                    <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, letterSpacing: 2, color: 'var(--white)', textTransform: UC, marginBottom: 10 }}>
                      {youtubeSyncResult.matched.length} matched and saved / {youtubeSyncResult.skipped.length} skipped
                    </div>
                    {youtubeSyncResult.errors.length > 0 && (
                      <div style={{ display: 'grid', gap: 6, marginBottom: youtubeSyncResult.skipped.length > 0 ? 10 : 0 }}>
                        {youtubeSyncResult.errors.map((item) => (
                          <div key={item} style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 13, color: '#ffb6b6', lineHeight: 1.6 }}>
                            {item}
                          </div>
                        ))}
                      </div>
                    )}
                    {youtubeSyncResult.skipped.length > 0 && (
                      <div>
                        <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 9, letterSpacing: 2, color: 'var(--silver3)', textTransform: UC, marginBottom: 8 }}>
                          Needs Manual Review
                        </div>
                        <div style={{ display: 'grid', gap: 6 }}>
                          {youtubeSyncResult.skipped.map((title) => (
                            <div key={title} style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 13, color: 'var(--silver2)', lineHeight: 1.6 }}>
                              {title}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 18, flexWrap: 'wrap', marginBottom: 10 }}>
                <div>
                  <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, letterSpacing: 3, color: 'var(--cyan)', textTransform: UC, marginBottom: 8 }}>
                    Bulk Import
                  </div>
                  <div style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 14, color: 'var(--silver2)', lineHeight: 1.7, maxWidth: 700 }}>
                    Paste one mapping per line using <span style={{ color: 'var(--white)' }}>exercise name, youtube id</span>. You can also paste full YouTube URLs. Unknown exercise names and invalid IDs will be reported without blocking the valid rows.
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => { void importBulkMappings() }}
                  disabled={bulkSaving}
                  style={{
                    minWidth: 140,
                    background: bulkSaving ? 'rgba(0,180,216,0.18)' : 'transparent',
                    border: '1px solid rgba(0,180,216,0.28)',
                    color: 'var(--cyan)',
                    padding: '10px 12px',
                    cursor: bulkSaving ? 'default' : 'pointer',
                    fontFamily: "'DM Mono',monospace",
                    fontSize: 9,
                    letterSpacing: 2,
                    textTransform: UC,
                  }}
                >
                  {bulkSaving ? 'Importing' : 'Import Bulk'}
                </button>
              </div>
              <textarea
                value={bulkDraft}
                onChange={(event) => setBulkDraft(event.target.value)}
                placeholder={'90/90 Hip Stretch, abc123xyz89\nOpen Book Rotation, https://www.youtube.com/watch?v=abc123xyz89'}
                style={{
                  width: '100%',
                  minHeight: 132,
                  resize: 'vertical',
                  background: 'rgba(255,255,255,0.02)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  color: 'var(--white)',
                  padding: '12px 14px',
                  fontFamily: "'DM Mono',monospace",
                  fontSize: 12,
                  lineHeight: 1.6,
                }}
              />
              {bulkSummary && (
                <div style={{ marginTop: 12, border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.02)', padding: '12px 14px' }}>
                  <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, letterSpacing: 2, color: 'var(--white)', textTransform: UC, marginBottom: bulkSummary.errors.length > 0 ? 10 : 0 }}>
                    {bulkSummary.added} saved / {bulkSummary.skipped} skipped
                  </div>
                  {bulkSummary.errors.length > 0 && (
                    <div style={{ display: 'grid', gap: 6 }}>
                      {bulkSummary.errors.map((item) => (
                        <div key={item} style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 13, color: '#ffb6b6', lineHeight: 1.6 }}>
                          {item}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
            <div style={{ border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(8,10,14,0.98)' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'minmax(220px, 1.4fr) 110px 110px 140px minmax(220px, 1fr) 92px', gap: 12, padding: '14px 18px', borderBottom: '1px solid rgba(255,255,255,0.08)', fontFamily: "'DM Mono',monospace", fontSize: 9, letterSpacing: 3, color: 'var(--silver3)', textTransform: UC }}>
                <div>Exercise</div>
                <div>Area</div>
                <div>Phase</div>
                <div>Source</div>
                <div>YouTube ID</div>
                <div>Save</div>
              </div>
              <div style={{ maxHeight: 620, overflowY: 'auto' }}>
                {groupedExercises.map((group) => (
                  <div key={group.key}>
                    <div style={{ padding: '14px 18px', borderBottom: '1px solid rgba(255,255,255,0.05)', borderTop: '1px solid rgba(255,255,255,0.05)', background: 'rgba(0,180,216,0.05)', fontFamily: "'DM Mono',monospace", fontSize: 10, letterSpacing: 3, color: 'var(--cyan)', textTransform: UC }}>
                      {group.label}
                    </div>
                    {group.exercises.map((exercise) => {
                      const override = overrides[exercise.name]
                      const activeYoutubeId = override?.youtube_id || exercise.hardcodedYoutubeId || ''
                      const source = override?.youtube_id ? 'Supabase' : exercise.hardcodedYoutubeId ? 'Hardcoded' : 'Empty'
                      const status = saveStatus[exercise.name] || 'idle'

                      return (
                        <div key={exercise.name} style={{ display: 'grid', gridTemplateColumns: 'minmax(220px, 1.4fr) 110px 110px 140px minmax(220px, 1fr) 92px', gap: 12, padding: '15px 18px', borderBottom: '1px solid rgba(255,255,255,0.05)', alignItems: 'center' }}>
                          <div>
                            <div style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 14, color: 'var(--white)', lineHeight: 1.45 }}>
                              {exercise.name}
                            </div>
                          </div>
                          <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 9, letterSpacing: 2, color: 'var(--cyan)', textTransform: UC }}>
                            {exercise.area}
                          </div>
                          <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 9, letterSpacing: 2, color: 'var(--silver3)', textTransform: UC }}>
                            {exercise.pillar}
                          </div>
                          <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 9, letterSpacing: 2, color: source === 'Supabase' ? 'var(--cyan)' : source === 'Hardcoded' ? 'var(--silver2)' : 'var(--silver4)', textTransform: UC }}>
                            {source}
                          </div>
                          <div>
                            <input
                              value={draftYoutubeIds[exercise.name] ?? activeYoutubeId}
                              onChange={(event) => setDraftYoutubeIds((current) => ({ ...current, [exercise.name]: event.target.value.trim() }))}
                              placeholder="Paste YouTube ID"
                              style={{
                                width: '100%',
                                background: 'rgba(255,255,255,0.02)',
                                border: '1px solid rgba(255,255,255,0.1)',
                                color: 'var(--white)',
                                padding: '10px 12px',
                                fontFamily: "'DM Mono',monospace",
                                fontSize: 12,
                              }}
                            />
                          </div>
                          <div>
                            <button
                              type="button"
                              onClick={() => saveVideoMapping(exercise.name)}
                              style={{
                                width: '100%',
                                background: status === 'saved' ? 'rgba(0,180,216,0.18)' : 'transparent',
                                border: '1px solid rgba(0,180,216,0.28)',
                                color: status === 'error' ? '#ff9f9f' : 'var(--cyan)',
                                padding: '10px 8px',
                                cursor: 'pointer',
                                fontFamily: "'DM Mono',monospace",
                                fontSize: 9,
                                letterSpacing: 2,
                                textTransform: UC,
                              }}
                            >
                              {status === 'saving' ? 'Saving' : status === 'saved' ? 'Saved' : status === 'error' ? 'Retry' : 'Save'}
                            </button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section>
            <div style={{ fontFamily: "'Syncopate',sans-serif", fontSize: 18, letterSpacing: 3, color: 'var(--white)', marginBottom: 16 }}>
              ROUTINES
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1.2fr 0.8fr', gap: 14 }}>
              <div style={{ background: 'rgba(8,10,14,0.96)', border: '1px solid rgba(255,255,255,0.08)', padding: '20px' }}>
                <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, letterSpacing: 3, color: 'var(--cyan)', textTransform: UC, marginBottom: 12 }}>
                  Most Popular Sports
                </div>
                <div style={{ display: 'grid', gap: 10 }}>
                  {(overview?.routines.mostPopularSports || []).map((item) => (
                    <div key={item.label} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontFamily: "'DM Sans',sans-serif", fontSize: 14, color: 'var(--silver2)' }}>
                      <span>{item.label}</span>
                      <span style={{ color: 'var(--white)' }}>{item.count}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div style={{ background: 'rgba(8,10,14,0.96)', border: '1px solid rgba(255,255,255,0.08)', padding: '20px' }}>
                <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, letterSpacing: 3, color: 'var(--cyan)', textTransform: UC, marginBottom: 12 }}>
                  Most Popular Goals
                </div>
                <div style={{ display: 'grid', gap: 10 }}>
                  {(overview?.routines.mostPopularGoals || []).map((item) => (
                    <div key={item.label} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontFamily: "'DM Sans',sans-serif", fontSize: 14, color: 'var(--silver2)' }}>
                      <span>{item.label}</span>
                      <span style={{ color: 'var(--white)' }}>{item.count}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div style={{ background: 'rgba(8,10,14,0.96)', border: '1px solid rgba(255,255,255,0.08)', padding: '20px' }}>
                <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, letterSpacing: 3, color: 'var(--cyan)', textTransform: UC, marginBottom: 12 }}>
                  Average Session Duration
                </div>
                <div style={{ fontFamily: "'Syncopate',sans-serif", fontSize: 42, color: 'var(--white)', lineHeight: 1 }}>
                  {overview?.routines.averageSessionDuration ?? 0}
                </div>
                <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, letterSpacing: 3, color: 'var(--silver3)', textTransform: UC, marginTop: 8 }}>
                  Minutes
                </div>
              </div>
            </div>
          </section>
        </div>
      </main>
    </>
  )
}
