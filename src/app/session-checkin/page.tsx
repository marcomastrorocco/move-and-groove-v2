'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Header from '@/components/Header'
import { IconBattery, IconCheckin, IconCheckbox, IconFocus, IconMotivation, IconPain, IconReadiness, IconSleep, IconSoreness } from '@/components/Icons'
import { buildPostSessionCheckinInsert, buildPreSessionReadinessInsert } from '@/lib/readiness-log'
import { buildReadinessAdjustmentSnapshot } from '@/lib/readiness'
import { writeStoredPreSessionReadiness } from '@/lib/readiness-storage'
import { createClient } from '@/lib/supabase/client'

const UC = 'uppercase' as const

type CheckinType = 'pre' | 'post'
type Question = {
  id: string
  text: string
  sub: string
  Icon: typeof IconPain
  options: { value: number; label: string }[]
}

const PRE_QUESTIONS: Question[] = [
  {
    id: 'sleep',
    text: 'HOW DID YOU SLEEP?',
    sub: 'Sleep quality shapes recovery, stiffness, and how much quality work you can handle.',
    Icon: IconSleep,
    options: [
      { value: 4, label: 'Great - fully rested' },
      { value: 3, label: 'Good - slept well enough' },
      { value: 2, label: 'Average - not ideal' },
      { value: 1, label: 'Poor - feel under-recovered' },
    ],
  },
  {
    id: 'soreness',
    text: 'HOW SORE DO YOU FEEL?',
    sub: 'Flags whether today should stay light, modified, or away from sensitive areas.',
    Icon: IconSoreness,
    options: [
      { value: 4, label: 'Fresh - no real soreness' },
      { value: 3, label: 'Mild - a little tight' },
      { value: 2, label: 'Moderate - definitely sore' },
      { value: 1, label: 'High - movement feels limited' },
    ],
  },
  {
    id: 'mood',
    text: 'WHAT IS YOUR MOOD LIKE?',
    sub: 'A quick mood check helps us judge how much load and complexity makes sense today.',
    Icon: IconMotivation,
    options: [
      { value: 4, label: 'Focused - ready to train' },
      { value: 3, label: 'Fine - steady and okay' },
      { value: 2, label: 'Flat - hard to get going' },
      { value: 1, label: 'Off - not in a great headspace' },
    ],
  },
]

const SORENESS_AREAS = ['Neck', 'Shoulders', 'Upper back', 'Lower back', 'Hips', 'Knees', 'Ankles'] as const

const POST_QUESTIONS: Question[] = [
  {
    id: 'completion',
    text: 'DID YOU COMPLETE THE SESSION?',
    sub: 'Tracks adherence and gives context for your progress.',
    Icon: IconCheckbox,
    options: [
      { value: 4, label: 'Fully - every exercise done' },
      { value: 3, label: 'Mostly - skipped one or two' },
      { value: 2, label: 'Partially - got through about half' },
      { value: 1, label: 'Barely - had to cut it short' },
    ],
  },
  {
    id: 'rpe',
    text: 'HOW HARD DID IT FEEL?',
    sub: 'Rate of perceived exertion across the whole session.',
    Icon: IconBattery,
    options: [
      { value: 1, label: 'Very easy - barely felt it' },
      { value: 2, label: 'Moderate - good challenge' },
      { value: 3, label: 'Hard - pushed myself' },
      { value: 4, label: 'Very hard - gave everything' },
    ],
  },
  {
    id: 'feel',
    text: 'HOW DO YOU FEEL NOW?',
    sub: 'Post-session feedback helps calibrate future sessions.',
    Icon: IconReadiness,
    options: [
      { value: 4, label: 'Great - looser and energised' },
      { value: 3, label: 'Good - noticeably better' },
      { value: 2, label: 'Same - not much difference' },
      { value: 1, label: 'Tired - need to rest now' },
    ],
  },
  {
    id: 'areas',
    text: 'ANY AREAS THAT NEED MORE WORK?',
    sub: 'Flags which regions to prioritise in your next session.',
    Icon: IconFocus,
    options: [
      { value: 4, label: 'Hips feel tight' },
      { value: 3, label: 'Shoulders feel tight' },
      { value: 2, label: 'Spine feels tight' },
      { value: 1, label: 'Felt balanced' },
    ],
  },
]

function readInitialRouteState() {
  if (typeof window === 'undefined') {
    return { initialType: null as CheckinType | null, autoStart: false }
  }

  const searchParams = new URLSearchParams(window.location.search)
  const routeType = searchParams.get('type')

  return {
    initialType: routeType === 'pre' || routeType === 'post' ? routeType as CheckinType : null,
    autoStart: searchParams.get('autostart') === '1',
  }
}

type StoredRoutineMeta = {
  routine?: {
    savedId?: number | null
  } | null
  sport?: string | null
  areas?: string[] | null
  duration?: number
  goal?: string | null
  completedAt?: string | null
  progressLoggedAt?: string | null
}

function readStoredRoutineMeta(): StoredRoutineMeta | null {
  if (typeof window === 'undefined') {
    return null
  }

  const raw = window.localStorage.getItem('mg_routine')
  if (!raw) {
    return null
  }

  try {
    return JSON.parse(raw) as StoredRoutineMeta
  } catch {
    return null
  }
}

function writeStoredRoutineMeta(nextMeta: StoredRoutineMeta) {
  if (typeof window === 'undefined') {
    return
  }

  window.localStorage.setItem('mg_routine', JSON.stringify(nextMeta))
}

export default function SessionCheckinPage() {
  const router = useRouter()
  const supabase = createClient()
  const { initialType, autoStart } = readInitialRouteState()
  const [type, setType] = useState<CheckinType | null>(initialType)
  const [step, setStep] = useState(initialType && autoStart ? 1 : 0)
  const [answers, setAnswers] = useState<Record<string, number>>({})
  const [sorenessAreas, setSorenessAreas] = useState<string[]>([])
  const [sorenessSeverity, setSorenessSeverity] = useState(0)
  const [sorenessNotes, setSorenessNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [postFeedbackSynced, setPostFeedbackSynced] = useState(false)

  const questions = type === 'pre' ? PRE_QUESTIONS : POST_QUESTIONS
  const question = questions[step - 1]
  const total = questions.length
  const progress = step === 0 ? 0 : Math.round((step / total) * 100)
  const accentColor = type === 'pre' ? '#00b4d8' : '#4ac8e8'

  useEffect(() => {
    const routeState = readInitialRouteState()
    setType(routeState.initialType)
    setStep(routeState.initialType && routeState.autoStart ? 1 : 0)
  }, [])

  function pick(questionId: string, value: number) {
    setAnswers((prev) => ({ ...prev, [questionId]: value }))
  }

  function toggleSorenessArea(area: string) {
    setSorenessAreas((prev) => (prev.includes(area) ? prev.filter((item) => item !== area) : [...prev, area]))
  }

  function next() {
    if (step < total) {
      setStep((current) => current + 1)
      return
    }
    void finish()
  }

  function back() {
    if (step === 0) {
      setType(null)
      setStep(0)
      setAnswers({})
      setSorenessAreas([])
      setSorenessSeverity(0)
      setSorenessNotes('')
      setSaveError('')
      return
    }
    setStep((current) => current - 1)
  }

  async function finish() {
    setSaving(true)
    setSaveError('')
    let failed = false
    const warnings: string[] = []
    let postWriteFailed = false

    const { data: { session } } = await supabase.auth.getSession()
    const uid = session?.user?.id
    const accessToken = session?.access_token

    if (type === 'pre') {
      const snapshot = buildReadinessAdjustmentSnapshot({
        answers,
        sorenessAreas,
        sorenessSeverity,
        sorenessNotes,
      })
      writeStoredPreSessionReadiness(snapshot)
      if (uid && accessToken) {
        const row = buildPreSessionReadinessInsert({
          userId: uid,
          snapshot,
        })
        try {
          const response = await fetch('/api/readiness-logs', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${accessToken}`,
            },
            body: JSON.stringify({ row }),
          })

          if (!response.ok) {
            const payload = await response.json().catch(() => null)
            throw new Error(payload?.error || 'Could not save pre-session check-in.')
          }
        } catch (error) {
          warnings.push(error instanceof Error ? error.message : 'Could not sync pre-session check-in.')
        }
      }
    }

    if (uid && accessToken && type === 'post') {
      try {
        const row = buildPostSessionCheckinInsert({
          userId: uid,
          answers,
        })
        const response = await fetch('/api/readiness-logs', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({ row }),
        })

        if (!response.ok) {
          const payload = await response.json().catch(() => null)
          throw new Error(payload?.error || 'Could not save post-session check-in.')
        }
      } catch (error) {
        warnings.push(error instanceof Error ? error.message : 'Could not sync post-session check-in.')
        postWriteFailed = true
      }

      // progressLoggedAt means "a progress row exists for this session", so only
      // the code that writes that row may set it. Stamping it here marked the
      // workout as logged when the write had never happened, which silenced both
      // recovery paths: /routine short-circuits on it and reports the session as
      // counted, and the dashboard sync skips it. A failed write then vanished
      // with no error and no way back. Record the completion time only, which is
      // what lets the dashboard sync pick the session up later.
      const routineMeta = readStoredRoutineMeta()
      if (routineMeta && !routineMeta.completedAt) {
        writeStoredRoutineMeta({
          ...routineMeta,
          completedAt: routineMeta.progressLoggedAt || new Date().toISOString(),
        })
      }
    }

    if (warnings.length > 0) {
      const message = warnings.join(' | ')
      console.warn('[session-checkin]', {
        type,
        answers,
        sorenessAreas,
        sorenessSeverity,
        message,
      })
      if (type === 'post') {
        setSaveError('')
      } else {
        failed = true
        setSaveError('We could not sync this check-in right now. Please try again.')
      }
    }

    if (type === 'post') {
      setPostFeedbackSynced(!postWriteFailed)
    }

    setSaving(false)
    if (!failed || type === 'post') {
      setDone(true)
    }
  }

  function reset() {
    setType(initialType)
    setStep(0)
    setAnswers({})
    setSorenessAreas([])
    setSorenessSeverity(0)
    setSorenessNotes('')
    setDone(false)
    setSaveError('')
    setPostFeedbackSynced(false)
  }

  return (
    <div style={{ minHeight: '100vh' }}>
      <div style={{ position: 'fixed', inset: 0, zIndex: 0, pointerEvents: 'none', backgroundImage: 'url(/athlete-backgrounds/athletix-foam-roll.jpg)', backgroundSize: 'cover', backgroundPosition: 'center 20%' }}>
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to bottom,rgba(0,0,0,0.88) 0%,rgba(0,0,0,0.75) 40%,rgba(0,0,0,0.95) 100%)' }} />
      </div>

      <Header />

      <div style={{ position: 'relative', zIndex: 2, paddingTop: 80 }}>
        <div className="mg-page-shell" style={{ maxWidth: 1000 }}>
          {!type && (
            <div style={{ animation: 'fadeUp 0.5s ease forwards' }}>
              <p style={{ fontFamily: "'DM Mono',monospace", fontSize: 15, letterSpacing: 6, color: 'var(--cyan)', marginBottom: 32, textTransform: UC }}>Session Check-in</p>
              <p style={{ fontFamily: "'Syncopate',sans-serif", fontSize: 'clamp(34px, 10vw, 72px)', fontWeight: 700, letterSpacing: 2, color: 'var(--white)', lineHeight: 1.05, marginBottom: 24 }}>
                PRE OR POST
                <br />
                SESSION?
              </p>
              <p style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 22, lineHeight: 1.7, color: 'var(--silver2)', marginBottom: 56, maxWidth: 620 }}>
                Check in before your session to capture sleep, soreness, and mood, or after to log how the session landed.
              </p>
              <div className="mg-grid-2" style={{ gap: 2, background: 'var(--border)', border: '1px solid var(--border)', marginBottom: 56 }}>
                {[
                  { id: 'pre' as CheckinType, Icon: IconReadiness, label: 'PRE-SESSION', sub: 'Sleep, soreness, and mood before you start.', questions: 3 },
                  { id: 'post' as CheckinType, Icon: IconCheckin, label: 'POST-SESSION', sub: 'Completion, effort, feel, and next focus.', questions: 4 },
                ].map((item) => (
                  <div key={item.id} onClick={() => { setType(item.id); setStep(1) }} style={{ background: 'var(--black2)', padding: '56px 40px', cursor: 'pointer', transition: 'background 0.2s' }}>
                    <span style={{ display: 'flex', marginBottom: 24 }}><item.Icon size={42} color="var(--cyan)" /></span>
                    <p style={{ fontFamily: "'Syncopate',sans-serif", fontSize: 20, fontWeight: 700, letterSpacing: 3, color: 'var(--cyan)', marginBottom: 16 }}>{item.label}</p>
                    <p style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 20, color: 'var(--silver2)', lineHeight: 1.6, marginBottom: 20 }}>{item.sub}</p>
                    <p style={{ fontFamily: "'DM Mono',monospace", fontSize: 12, letterSpacing: 3, color: 'var(--silver3)', textTransform: UC }}>{item.questions} questions</p>
                  </div>
                ))}
              </div>
              <button className="btn-outline" onClick={() => router.push('/dashboard')}>BACK</button>
            </div>
          )}

          {type && !done && question && (
            <div key={step} style={{ animation: 'fadeUp 0.35s ease forwards' }}>
              <div style={{ width: '100%', height: 3, background: 'var(--border)', marginBottom: 16, position: 'relative' }}>
                <div style={{ position: 'absolute', top: 0, left: 0, height: '100%', width: `${progress}%`, background: `linear-gradient(90deg,var(--silver3),${accentColor})`, transition: 'width 0.4s ease' }} />
              </div>

              <p style={{ fontFamily: "'DM Mono',monospace", fontSize: 14, letterSpacing: 4, color: 'var(--silver3)', marginBottom: 44, textTransform: UC }}>
                {type === 'pre' ? 'Pre-Session' : 'Post-Session'} · Question {step} of {total}
              </p>

              <span style={{ display: 'flex', marginBottom: 24 }}><question.Icon size={48} color={accentColor} /></span>
              <p style={{ fontFamily: "'Syncopate',sans-serif", fontSize: 'clamp(28px, 7vw, 52px)', fontWeight: 700, letterSpacing: 2, color: 'var(--white)', lineHeight: 1.1, marginBottom: 20 }}>{question.text}</p>
              <p style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 22, color: 'var(--silver2)', marginBottom: 48, lineHeight: 1.6 }}>{question.sub}</p>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginBottom: 48 }}>
                {question.options.map((option, index) => {
                  const selected = answers[question.id] === option.value
                  return (
                    <div key={option.value} onClick={() => pick(question.id, option.value)} style={{ background: selected ? 'var(--black3)' : 'var(--black2)', padding: '22px clamp(18px, 5vw, 48px)', cursor: 'pointer', transition: 'background 0.2s', display: 'flex', alignItems: 'center', gap: 18, borderLeft: selected ? `6px solid ${accentColor}` : '6px solid transparent' }}>
                      <span style={{ fontFamily: "'DM Mono',monospace", fontSize: 16, letterSpacing: 2, color: selected ? accentColor : 'var(--silver4)', minWidth: 32, flexShrink: 0 }}>{index + 1}</span>
                      <span style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 'clamp(18px, 4.8vw, 24px)', fontWeight: selected ? 600 : 400, color: selected ? 'var(--white)' : 'var(--silver)', lineHeight: 1.4, minWidth: 0 }}>{option.label}</span>
                      {selected && <span style={{ marginLeft: 'auto', display: 'flex' }}><IconCheckin size={26} color={accentColor} /></span>}
                    </div>
                  )
                })}
              </div>

              {type === 'pre' && question.id === 'soreness' && (
                <div style={{ background: 'rgba(8,10,14,0.92)', border: '1px solid var(--border)', padding: '28px 28px 24px', marginBottom: 48 }}>
                  <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 11, letterSpacing: 4, color: 'var(--cyan)', marginBottom: 18, textTransform: UC }}>
                    Soreness Details
                  </div>

                  <div style={{ marginBottom: 24 }}>
                    <div style={{ fontFamily: "'Syncopate',sans-serif", fontSize: 14, fontWeight: 700, letterSpacing: 2, color: 'var(--white)', marginBottom: 14 }}>
                      WHERE DOES IT HURT?
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                      {SORENESS_AREAS.map((area) => {
                        const selected = sorenessAreas.includes(area)
                        return (
                          <button
                            key={area}
                            type="button"
                            onClick={() => toggleSorenessArea(area)}
                            style={{
                              fontFamily: "'DM Mono',monospace",
                              fontSize: 11,
                              letterSpacing: 2,
                              color: selected ? 'var(--white)' : 'var(--silver2)',
                              background: selected ? 'rgba(0,180,216,0.16)' : 'rgba(255,255,255,0.03)',
                              border: selected ? '1px solid var(--cyan)' : '1px solid var(--border)',
                              padding: '10px 14px',
                              cursor: 'pointer',
                              textTransform: UC,
                            }}
                          >
                            {area}
                          </button>
                        )
                      })}
                    </div>
                  </div>

                  <div style={{ marginBottom: 24 }}>
                    <div style={{ fontFamily: "'Syncopate',sans-serif", fontSize: 14, fontWeight: 700, letterSpacing: 2, color: 'var(--white)', marginBottom: 10 }}>
                      HOW MUCH? {sorenessSeverity}/10
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="10"
                      step="1"
                      value={sorenessSeverity}
                      onChange={(event) => setSorenessSeverity(parseInt(event.target.value, 10))}
                      style={{ width: '100%', accentColor }}
                    />
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 10, fontFamily: "'DM Mono',monospace", fontSize: 10, color: 'var(--silver4)' }}>
                      <span>0</span>
                      <span>5</span>
                      <span>10</span>
                    </div>
                  </div>

                  <div>
                    <div style={{ fontFamily: "'Syncopate',sans-serif", fontSize: 14, fontWeight: 700, letterSpacing: 2, color: 'var(--white)', marginBottom: 10 }}>
                      NOTES
                    </div>
                    <textarea
                      value={sorenessNotes}
                      onChange={(event) => setSorenessNotes(event.target.value)}
                      placeholder="Optional note, e.g. left hip pinch, lower back tight on bending..."
                      rows={3}
                      style={{
                        width: '100%',
                        background: 'var(--black2)',
                        color: 'var(--silver2)',
                        border: '1px solid var(--border)',
                        padding: '14px 16px',
                        fontFamily: "'DM Sans',sans-serif",
                        fontSize: 16,
                        lineHeight: 1.6,
                        resize: 'vertical',
                      }}
                    />
                  </div>
                </div>
              )}

              {saveError && (
                <div style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 14, color: '#ff9f9f', marginBottom: 18, padding: '12px 14px', border: '1px solid rgba(255,143,143,0.18)', background: 'rgba(255,143,143,0.06)' }}>
                  {saveError}
                </div>
              )}

              <div className="mg-mobile-stack">
                <button className="btn-outline" onClick={back}>BACK</button>
                <button className="btn-primary" disabled={answers[question.id] === undefined} onClick={next}>
                  {step === total ? (saving ? 'SAVING...' : 'FINISH') : 'CONTINUE'}
                </button>
              </div>
            </div>
          )}

          {done && (
            <div style={{ animation: 'fadeUp 0.5s ease forwards' }}>
              <p style={{ fontFamily: "'DM Mono',monospace", fontSize: 15, letterSpacing: 6, color: 'var(--cyan)', marginBottom: 32, textTransform: UC }}>
                {type === 'pre' ? 'Pre-Session' : 'Post-Session'} Complete
              </p>
              <p style={{ fontFamily: "'Syncopate',sans-serif", fontSize: 'clamp(34px, 10vw, 72px)', fontWeight: 700, letterSpacing: 2, color: 'var(--white)', lineHeight: 1.05, marginBottom: 32 }}>
                {type === 'pre' ? 'LET’S GO' : 'WELL DONE'}
              </p>

              <div style={{ background: 'var(--black2)', border: '1px solid var(--border)', padding: '48px', marginBottom: 48 }}>
                <p style={{ fontFamily: "'DM Mono',monospace", fontSize: 13, letterSpacing: 3, color: 'var(--cyan)', marginBottom: 16, textTransform: UC }}>
                  {type === 'pre' ? 'Your session is ready' : 'Session logged'}
                </p>
                <p style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 22, color: 'var(--silver2)', lineHeight: 1.7 }}>
                  {type === 'pre'
                    ? 'Your pre-session check-in is logged. Use that sleep, soreness, and mood snapshot to keep today honest.'
                    : postFeedbackSynced
                      ? 'Great work today. Your post-session feedback is saved and your dashboard is ready for the next step.'
                      : 'Great work today. Your workout is complete and your dashboard is ready for the next step. The optional post-session feedback did not sync this time, but your stats are unaffected.'}
                </p>
              </div>

              {saveError && (
                <div style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 14, color: '#ffcf9f', marginBottom: 18, padding: '12px 14px', border: '1px solid rgba(255,207,159,0.22)', background: 'rgba(255,207,159,0.08)' }}>
                  {saveError}
                </div>
              )}

              <div className="mg-mobile-stack">
                {type === 'pre' && <button className="btn-primary" onClick={() => router.push('/quiz')}>START ROUTINE</button>}
                {type === 'post' && <button className="btn-primary" onClick={() => router.push('/dashboard')}>RETURN TO DASHBOARD</button>}
                {type === 'post' && <button className="btn-outline" onClick={() => router.push('/results')}>VIEW MY RESULTS</button>}
                {type === 'pre' && <button className="btn-outline" onClick={() => router.push('/dashboard')}>DASHBOARD</button>}
                <button className="btn-outline" onClick={reset}>NEW CHECK-IN</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

