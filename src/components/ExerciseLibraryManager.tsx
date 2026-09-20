'use client'

import { useEffect, useState } from 'react'

type Exercise = {
  id: string
  name: string
  area: 'hips' | 'shoulders' | 'spine'
  phase: 'release' | 'activation' | 'range' | 'foam_roll'
  sets: number
  reps: number | null
  hold_seconds: number | null
  movement_pattern: 'rotational' | 'linear' | 'lateral' | null
  anatomical_quadrants: string[]
  rationale: string
  study_citation: string
  aliases: string[]
  youtube_id: string | null
  is_active: boolean
}

type FormValues = {
  name: string; area: Exercise['area']; phase: Exercise['phase']; sets: string; reps: string; holdSeconds: string
  movementPattern: string; anatomicalQuadrants: string; rationale: string; studyCitation: string; aliases: string; youtubeId: string; isActive: boolean
}

const emptyForm = (): FormValues => ({ name: '', area: 'hips', phase: 'release', sets: '1', reps: '6', holdSeconds: '', movementPattern: 'linear', anatomicalQuadrants: '', rationale: '', studyCitation: '', aliases: '', youtubeId: '', isActive: true })
const fieldStyle = { width: '100%', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.12)', color: 'var(--white)', padding: '10px 12px', fontFamily: "'DM Sans',sans-serif", fontSize: 13 }

function toForm(exercise: Exercise): FormValues {
  return { name: exercise.name, area: exercise.area, phase: exercise.phase, sets: String(exercise.sets), reps: exercise.reps?.toString() || '', holdSeconds: exercise.hold_seconds?.toString() || '', movementPattern: exercise.movement_pattern || '', anatomicalQuadrants: exercise.anatomical_quadrants.join(', '), rationale: exercise.rationale, studyCitation: exercise.study_citation, aliases: exercise.aliases.join(', '), youtubeId: exercise.youtube_id || '', isActive: exercise.is_active }
}

export default function ExerciseLibraryManager({ accessToken, onLibraryChange }: { accessToken: string; onLibraryChange?: (exercises: Exercise[]) => void }) {
  const [exercises, setExercises] = useState<Exercise[]>([])
  const [form, setForm] = useState<FormValues>(emptyForm)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [nameDrafts, setNameDrafts] = useState<Record<string, string>>({})
  const [message, setMessage] = useState('')

  async function load() {
    setLoading(true)
    try {
      const response = await fetch('/api/admin/exercises', { headers: { Authorization: `Bearer ${accessToken}` } })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || 'Could not load the exercise library.')
      setExercises(payload.exercises || [])
      onLibraryChange?.(payload.exercises || [])
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not load the exercise library.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => { void load() }, 0)
    return () => window.clearTimeout(timer)
    // Loading is intentionally restarted only when the authenticated token changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken])

  function update<K extends keyof FormValues>(key: K, value: FormValues[K]) {
    setForm((current) => ({ ...current, [key]: value }))
  }

  function payload() {
    return {
      ...form,
      sets: Number(form.sets), reps: form.reps ? Number(form.reps) : null, holdSeconds: form.holdSeconds ? Number(form.holdSeconds) : null,
      anatomicalQuadrants: form.anatomicalQuadrants.split(',').map((item) => item.trim()).filter(Boolean),
      aliases: form.aliases.split(',').map((item) => item.trim()).filter(Boolean),
    }
  }

  async function save() {
    setSaving(true); setMessage('')
    const response = await fetch(editingId ? `/api/admin/exercises/${editingId}` : '/api/admin/exercises', {
      method: editingId ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` }, body: JSON.stringify(payload()),
    })
    const result = await response.json()
    setSaving(false)
    if (!response.ok) { setMessage(result.error || 'Could not save exercise.'); return }
    setMessage(editingId ? 'Exercise updated.' : 'Exercise added.')
    setEditingId(null); setForm(emptyForm()); await load()
  }

  async function deactivate(exercise: Exercise) {
    if (!window.confirm(`Deactivate ${exercise.name}? Existing saved routines remain unchanged.`)) return
    const response = await fetch(`/api/admin/exercises/${exercise.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${accessToken}` } })
    const result = await response.json()
    if (!response.ok) { setMessage(result.error || 'Could not deactivate exercise.'); return }
    setMessage(`${exercise.name} deactivated.`); await load()
  }

  async function rename(exercise: Exercise) {
    const name = (nameDrafts[exercise.id] ?? exercise.name).trim()
    if (!name || name === exercise.name) return

    setRenamingId(exercise.id); setMessage('')
    try {
      const response = await fetch(`/api/admin/exercises/${exercise.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ name }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Could not rename exercise.')
      setExercises((current) => current.map((item) => item.id === exercise.id ? { ...item, name: result.exercise.name } : item))
      setNameDrafts((current) => ({ ...current, [exercise.id]: result.exercise.name }))
      setMessage('Exercise name updated.')
      await load()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not rename exercise.')
    } finally {
      setRenamingId(null)
    }
  }

  async function seed() {
    if (!window.confirm('Import the existing curated and foam-roll libraries into Supabase now? This can be safely run once.')) return
    setSaving(true); setMessage('')
    const response = await fetch('/api/admin/exercises', { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` }, body: JSON.stringify({ seed: true }) })
    const result = await response.json(); setSaving(false)
    if (!response.ok) { setMessage(result.error || 'Could not seed the library.'); return }
    setMessage(`${result.seeded} existing exercises imported into Supabase.`); await load()
  }

  const filtered = exercises.filter((exercise) => `${exercise.name} ${exercise.area} ${exercise.phase}`.toLowerCase().includes(search.toLowerCase()))

  return <section style={{ marginBottom: 36 }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 16 }}>
      <div><div style={{ fontFamily: "'Syncopate',sans-serif", fontSize: 18, letterSpacing: 3, color: 'var(--white)', marginBottom: 8 }}>EXERCISE LIBRARY</div><div style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 14, color: 'var(--silver2)', lineHeight: 1.7 }}>The live Supabase source for athlete routines. Add, edit, deactivate, and map your own unlisted video here.</div></div>
      <button type="button" onClick={() => { void seed() }} disabled={saving} style={{ ...fieldStyle, width: 'auto', cursor: 'pointer', color: 'var(--cyan)' }}>IMPORT CURRENT LIBRARY</button>
    </div>
    {message && <div style={{ marginBottom: 14, padding: '11px 13px', border: '1px solid rgba(0,180,216,0.25)', color: 'var(--silver2)', fontFamily: "'DM Sans',sans-serif", fontSize: 13 }}>{message}</div>}
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(300px, 0.8fr) minmax(0, 1.2fr)', gap: 16 }}>
      <div style={{ padding: 18, border: '1px solid rgba(0,180,216,0.18)', background: 'rgba(8,10,14,0.96)' }}>
        <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, letterSpacing: 2, color: 'var(--cyan)', marginBottom: 14 }}>{editingId ? 'EDIT EXERCISE' : 'ADD EXERCISE'}</div>
        <div style={{ display: 'grid', gap: 10 }}>
          <input style={fieldStyle} value={form.name} onChange={(event) => update('name', event.target.value)} placeholder="Exercise name" />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}><select style={fieldStyle} value={form.area} onChange={(event) => update('area', event.target.value as Exercise['area'])}><option value="hips">Hips</option><option value="shoulders">Shoulders</option><option value="spine">Spine</option></select><select style={fieldStyle} value={form.phase} onChange={(event) => update('phase', event.target.value as Exercise['phase'])}><option value="release">Release</option><option value="activation">Activation</option><option value="range">Range</option><option value="foam_roll">Foam roll</option></select></div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}><input style={fieldStyle} value={form.sets} onChange={(event) => update('sets', event.target.value)} placeholder="Sets" inputMode="numeric" /><input style={fieldStyle} value={form.reps} onChange={(event) => { update('reps', event.target.value); if (event.target.value) update('holdSeconds', '') }} placeholder="Reps" inputMode="numeric" /><input style={fieldStyle} value={form.holdSeconds} onChange={(event) => { update('holdSeconds', event.target.value); if (event.target.value) update('reps', '') }} placeholder="Hold seconds" inputMode="numeric" /></div>
          <select style={fieldStyle} value={form.movementPattern} onChange={(event) => update('movementPattern', event.target.value)}><option value="">No movement pattern</option><option value="linear">Linear</option><option value="rotational">Rotational</option><option value="lateral">Lateral</option></select>
          <input style={fieldStyle} value={form.anatomicalQuadrants} onChange={(event) => update('anatomicalQuadrants', event.target.value)} placeholder="Anatomical areas, comma separated" />
          <textarea style={{ ...fieldStyle, minHeight: 76 }} value={form.rationale} onChange={(event) => update('rationale', event.target.value)} placeholder="Why this exercise is used" />
          <textarea style={{ ...fieldStyle, minHeight: 62 }} value={form.studyCitation} onChange={(event) => update('studyCitation', event.target.value)} placeholder="Study citation" />
          <input style={fieldStyle} value={form.aliases} onChange={(event) => update('aliases', event.target.value)} placeholder="Aliases, comma separated" />
          <input style={fieldStyle} value={form.youtubeId} onChange={(event) => update('youtubeId', event.target.value)} placeholder="YouTube URL or ID" />
          <div style={{ display: 'flex', gap: 10 }}><button type="button" onClick={() => { void save() }} disabled={saving} style={{ ...fieldStyle, width: 'auto', cursor: 'pointer', color: 'var(--cyan)' }}>{saving ? 'SAVING' : editingId ? 'SAVE CHANGES' : 'ADD EXERCISE'}</button>{editingId && <button type="button" onClick={() => { setEditingId(null); setForm(emptyForm()) }} style={{ ...fieldStyle, width: 'auto', cursor: 'pointer' }}>CANCEL</button>}</div>
        </div>
      </div>
      <div style={{ border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(8,10,14,0.96)' }}>
        <div style={{ padding: 14, borderBottom: '1px solid rgba(255,255,255,0.08)' }}><input style={fieldStyle} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Filter by exercise, area, or phase" /></div>
        <div style={{ maxHeight: 620, overflowY: 'auto' }}>{loading ? <div style={{ padding: 20, color: 'var(--silver2)' }}>Loading library...</div> : filtered.map((exercise) => <div key={exercise.id} style={{ display: 'grid', gridTemplateColumns: 'minmax(190px,1fr) 110px 100px 110px auto', gap: 10, padding: '13px 14px', borderBottom: '1px solid rgba(255,255,255,0.06)', alignItems: 'center', opacity: exercise.is_active ? 1 : 0.5 }}><div><div style={{ display: 'flex', gap: 6 }}><input aria-label={`${exercise.name} exercise name`} value={nameDrafts[exercise.id] ?? exercise.name} onChange={(event) => setNameDrafts((current) => ({ ...current, [exercise.id]: event.target.value }))} style={{ ...fieldStyle, padding: '7px 9px' }} /><button type="button" onClick={() => { void rename(exercise) }} disabled={renamingId === exercise.id || (nameDrafts[exercise.id] ?? exercise.name).trim() === exercise.name} style={{ ...fieldStyle, width: 'auto', padding: '7px 8px', cursor: 'pointer', color: 'var(--cyan)' }}>{renamingId === exercise.id ? '...' : 'SAVE'}</button></div><div style={{ color: 'var(--silver3)', fontFamily: "'DM Mono',monospace", fontSize: 10, marginTop: 4 }}>{exercise.reps ? `${exercise.sets} x ${exercise.reps} reps` : `${exercise.sets} x ${exercise.hold_seconds}s`}</div></div><div style={{ color: 'var(--cyan)', fontFamily: "'DM Mono',monospace", fontSize: 10 }}>{exercise.area}</div><div style={{ color: 'var(--silver2)', fontFamily: "'DM Mono',monospace", fontSize: 10 }}>{exercise.phase.replace('_', ' ')}</div><div style={{ color: exercise.is_active ? 'var(--cyan)' : '#ffb6b6', fontFamily: "'DM Mono',monospace", fontSize: 10 }}>{exercise.is_active ? 'ACTIVE' : 'INACTIVE'}</div><div style={{ display: 'flex', gap: 6 }}><button type="button" onClick={() => { setEditingId(exercise.id); setForm(toForm(exercise)); setMessage('') }} style={{ ...fieldStyle, width: 'auto', padding: '8px', cursor: 'pointer' }}>EDIT</button>{exercise.is_active && <button type="button" onClick={() => { void deactivate(exercise) }} style={{ ...fieldStyle, width: 'auto', padding: '8px', cursor: 'pointer', color: '#ffb6b6' }}>OFF</button>}</div></div>)}</div>
      </div>
    </div>
  </section>
}
