'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Header from '@/components/Header'
import PreSessionReadinessModal from '@/components/PreSessionReadinessModal'
import { Icon, type IconName } from '@/components/Icons'
import { readTodayPreSessionReadiness } from '@/lib/readiness-storage'
import { SPORT_PROFILES } from '@/lib/sports'
import { createClient } from '@/lib/supabase/client'
import { hasPreSessionCheckinToday } from '@/lib/session-flow'

const SPORTS: { id: string; label: string; icon: IconName }[] = [...SPORT_PROFILES]
  .sort((a, b) => a.label.localeCompare(b.label))
  .map((sport) => ({
    id: sport.id,
    label: sport.label,
    icon: sport.icon,
  }))

const AREAS: { id: string; label: string; icon: IconName; sub: string }[] = [
  { id: 'hips', label: 'HIPS', icon: 'hips', sub: 'Hip flexors / Adductors / Glutes / Piriformis' },
  { id: 'shoulders', label: 'SHOULDERS', icon: 'shoulders', sub: 'Rotator cuff / Capsule / AC joint / Thoracic link' },
  { id: 'spine', label: 'SPINE', icon: 'spine', sub: 'Cervical / Thoracic / Lumbar / Facet joints' },
]

const GOALS: { id: string; label: string; icon: IconName; sub: string }[] = [
  { id: 'flexibility', label: 'More Flexibility', icon: 'mobility', sub: 'I feel stiff or restricted in movement' },
  { id: 'strength', label: 'More Strength', icon: 'general', sub: 'I need more control at end range' },
  { id: 'balanced', label: 'Balanced', icon: 'balance', sub: 'Equal focus across all three pillars' },
  { id: 'performance', label: 'Performance', icon: 'performance', sub: 'Pre or post training session' },
]

type Mode = 'sport' | 'area' | null
type Step = 1 | '2a' | '2b' | 3 | 4 | 5

const API = '/api'
const ROUTINE_GENERATION_TIMEOUT_MS = 40000

function isAbortLikeError(error: unknown) {
  if (!(error instanceof Error)) {
    return false
  }

  return error.name === 'AbortError'
    || error.message === 'This operation was aborted'
    || error.message.includes('aborted')
    || error.message.includes('signal is aborted')
}

export default function QuizPage() {
  const router = useRouter()
  const supabase = createClient()

  const [step, setStep] = useState<Step>(1)
  const [mode, setMode] = useState<Mode>(null)
  const [sport, setSport] = useState<string | null>(null)
  const [areas, setAreas] = useState<string[]>([])
  const [duration, setDuration] = useState(20)
  const [goal, setGoal] = useState<string | null>(null)
  const [includeFoamRoll, setIncludeFoamRoll] = useState<boolean | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [dailyLimitReached, setDailyLimitReached] = useState(false)
  const [showReadinessGate, setShowReadinessGate] = useState(false)
  const [readinessConfirmedForCurrentBuild, setReadinessConfirmedForCurrentBuild] = useState(false)
  const readinessSnapshot = readTodayPreSessionReadiness()

  const progress = { 1: 20, '2a': 40, '2b': 40, 3: 60, 4: 80, 5: 95 }[step] || 20
  const backgroundImage = 'https://images.unsplash.com/photo-1518611012118-696072aa579a?auto=format&fit=crop&w=1800&q=80'

  function toggleArea(id: string) {
    setAreas((prev) => (prev.includes(id) ? prev.filter((area) => area !== id) : [...prev, id]))
  }

  async function generateRoutine() {
    setLoading(true)
    setError('')
    setDailyLimitReached(false)

    const { data: { session } } = await supabase.auth.getSession()

    const payload = {
      userId: session?.user?.id || null,
      mode,
      sport,
      areas,
      duration,
      goal,
      includeFoamRoll: includeFoamRoll === true,
      readiness: readTodayPreSessionReadiness(),
    }

    const controller = new AbortController()
    const timeoutId = window.setTimeout(() => controller.abort(), ROUTINE_GENERATION_TIMEOUT_MS)

    try {
      const response = await fetch(`${API}/routines/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      })
      if (response.status === 429) {
        const payload = await response.json().catch(() => null)
        if (payload?.error === 'DAILY_LIMIT_REACHED') {
          setDailyLimitReached(true)
          setLoading(false)
          return
        }
      }

      if (!response.ok) {
        const text = await response.text()
        throw new Error(`Server error ${response.status}: ${text}`)
      }

      const routine = await response.json()
      if (routine.error) {
        throw new Error(routine.error)
      }

      localStorage.setItem(
        'mg_routine',
        JSON.stringify({
          routine,
          mode,
          sport,
          areas,
          duration,
          goal,
          readiness: readTodayPreSessionReadiness(),
        }),
      )

      router.push('/routine')
    } catch (err: unknown) {
      console.error('Generation error:', err)
      const message = err instanceof Error ? err.message : 'Failed to connect to server'
      setError(controller.signal.aborted || isAbortLikeError(err) ? 'Routine generation took too long. Please try again.' : message)
      setLoading(false)
    } finally {
      window.clearTimeout(timeoutId)
    }
  }

  async function handleGenerateClick() {
    const { data: { session } } = await supabase.auth.getSession()
    const uid = session?.user?.id

    if (!uid) {
      void generateRoutine()
      return
    }

    try {
      if (!readinessConfirmedForCurrentBuild) {
        setShowReadinessGate(true)
        return
      }

      const ready = await hasPreSessionCheckinToday(supabase as never, uid)
      if (!ready && !readTodayPreSessionReadiness()) {
        setReadinessConfirmedForCurrentBuild(false)
        setShowReadinessGate(true)
        return
      }
    } catch (gateError) {
      console.error(gateError)
    }

    void generateRoutine()
  }

  const baseCard = {
    background: 'var(--black2)',
    padding: 28,
    cursor: 'pointer',
    transition: 'background 0.2s',
    textAlign: 'center' as const,
    position: 'relative' as const,
  }

  const selectedStyle = {
    background: 'var(--black3)',
    borderBottom: '4px solid var(--cyan)',
    boxShadow: '0 0 16px rgba(0,180,216,0.15)',
  }

  const Q = ({ children }: { children: React.ReactNode }) => (
    <div style={{ fontFamily: "'Syncopate',sans-serif", fontSize: 'clamp(26px,4.5vw,44px)', fontWeight: 700, letterSpacing: 3, color: 'var(--white)', lineHeight: 1.15, marginBottom: 12 }}>
      {children}
    </div>
  )

  const Sub = ({ children }: { children: React.ReactNode }) => (
    <p style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 16, color: 'var(--silver2)', marginBottom: 36, lineHeight: 1.6 }}>
      {children}
    </p>
  )

  const Nav = ({ back, next, nextDisabled, nextLabel }: { back: () => void; next?: () => void; nextDisabled?: boolean; nextLabel?: string }) => (
    <div className="mg-mobile-stack" style={{ marginTop: 44 }}>
      <button className="btn-outline" onClick={back}>BACK</button>
      {next && (
        <button className="btn-primary" disabled={nextDisabled} onClick={next}>
          {nextLabel || 'CONTINUE'}
        </button>
      )}
    </div>
  )

  return (
    <>
      <div
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 0,
          pointerEvents: 'none',
          background: '#000',
        }}
      >
        <div
          style={{
            position: 'absolute',
            inset: 0,
            backgroundImage: `url(${backgroundImage})`,
            backgroundSize: 'cover',
            backgroundRepeat: 'no-repeat',
            backgroundPosition: 'center',
            opacity: 0.5,
          }}
        />
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to bottom,rgba(0,0,0,0.64) 0%,rgba(0,0,0,0.6) 40%,rgba(0,0,0,0.78) 100%)' }} />
      </div>

      <Header />

      <main style={{ position: 'relative', zIndex: 2, paddingTop: 64 }}>
        <div className="mg-page-shell" style={{ maxWidth: 820 }}>
          <div style={{ width: '100%', height: 1, background: 'var(--border)', marginBottom: 52, position: 'relative' }}>
            <div
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                height: '100%',
                background: 'linear-gradient(90deg,var(--silver3),var(--cyan))',
                transition: 'width 0.4s cubic-bezier(0.16,1,0.3,1)',
                width: `${progress}%`,
              }}
            />
          </div>

          {step === 1 && (
            <div>
              <Q>SPORT OR<br />BODY AREA?</Q>
              <Sub>Select your sport for a sport relevant routine, or choose specific joints to work on.</Sub>
              <div className="mg-grid-2" style={{ gap: 1, background: 'var(--border)', border: '1px solid var(--border)' }}>
                {[
                  { id: 'sport', icon: 'sport' as IconName, label: 'Sport Relevant', sub: "Tailored to your sport's biomechanical demands" },
                  { id: 'area', icon: 'focus' as IconName, label: 'Body Area Focus', sub: 'Choose which joints you want to work on' },
                ].map((option) => (
                  <div
                    key={option.id}
                    onClick={() => setMode(option.id as Mode)}
                    style={{ ...baseCard, ...(mode === option.id ? selectedStyle : {}) }}
                    onMouseEnter={(event) => {
                      if (mode !== option.id) {
                        event.currentTarget.style.background = 'var(--black3)'
                      }
                    }}
                    onMouseLeave={(event) => {
                      if (mode !== option.id) {
                        event.currentTarget.style.background = 'var(--black2)'
                      }
                    }}
                  >
                    <span style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}>
                      <Icon name={option.icon} size={24} color="var(--cyan)" />
                    </span>
                    <div style={{ fontFamily: "'Syncopate',sans-serif", fontSize: 10, fontWeight: 700, letterSpacing: 2, color: mode === option.id ? 'var(--cyan)' : 'var(--silver)', marginBottom: 8, textTransform: 'uppercase' }}>
                      {option.label}
                    </div>
                    <div style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 14, color: 'var(--silver2)', lineHeight: 1.6 }}>{option.sub}</div>
                  </div>
                ))}
              </div>
              <Nav back={() => router.push('/dashboard')} next={() => setStep(mode === 'sport' ? '2a' : '2b')} nextDisabled={!mode} />
            </div>
          )}

          {step === '2a' && (
            <div>
              <Q>SELECT<br />YOUR SPORT</Q>
              <Sub>Each sport profile is built from peer-reviewed biomechanical and injury research.</Sub>
              <div className="mg-grid-4" style={{ gap: 1, background: 'var(--border)', border: '1px solid var(--border)' }}>
                {SPORTS.map((item) => (
                  <div
                    key={item.id}
                    onClick={() => setSport(item.id)}
                    style={{ ...baseCard, ...(sport === item.id ? selectedStyle : {}) }}
                    onMouseEnter={(event) => {
                      if (sport !== item.id) {
                        event.currentTarget.style.background = 'var(--black3)'
                      }
                    }}
                    onMouseLeave={(event) => {
                      if (sport !== item.id) {
                        event.currentTarget.style.background = 'var(--black2)'
                      }
                    }}
                  >
                    <span style={{ display: 'flex', justifyContent: 'center', marginBottom: 8 }}>
                      <Icon name={item.icon} size={22} color="var(--cyan)" />
                    </span>
                    <div style={{ fontFamily: "'Syncopate',sans-serif", fontSize: 10, fontWeight: 700, letterSpacing: 2, color: sport === item.id ? 'var(--cyan)' : 'var(--silver)', textTransform: 'uppercase' }}>
                      {item.label}
                    </div>
                  </div>
                ))}
              </div>
              <Nav back={() => setStep(1)} next={() => setStep(3)} nextDisabled={!sport} />
            </div>
          )}

          {step === '2b' && (
            <div>
              <Q>WHICH AREAS<br />TO WORK?</Q>
              <Sub>Select one or more areas to focus on.</Sub>
              <div className="mg-grid-3" style={{ gap: 1, background: 'var(--border)', border: '1px solid var(--border)' }}>
                {AREAS.map((area) => (
                  <div
                    key={area.id}
                    onClick={() => toggleArea(area.id)}
                    style={{ ...baseCard, padding: '40px 20px', ...(areas.includes(area.id) ? selectedStyle : {}) }}
                    onMouseEnter={(event) => {
                      if (!areas.includes(area.id)) {
                        event.currentTarget.style.background = 'var(--black3)'
                      }
                    }}
                    onMouseLeave={(event) => {
                      if (!areas.includes(area.id)) {
                        event.currentTarget.style.background = 'var(--black2)'
                      }
                    }}
                  >
                    <span style={{ display: 'flex', justifyContent: 'center', marginBottom: 16 }}>
                      <Icon name={area.icon} size={30} color="var(--cyan)" />
                    </span>
                    <div style={{ fontFamily: "'Syncopate',sans-serif", fontSize: 14, fontWeight: 700, letterSpacing: 3, color: areas.includes(area.id) ? 'var(--cyan)' : 'var(--silver)', marginBottom: 12 }}>
                      {area.label}
                    </div>
                    <div style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 13, color: 'var(--silver2)', lineHeight: 1.6 }}>{area.sub}</div>
                  </div>
                ))}
              </div>
              <Nav back={() => setStep(1)} next={() => setStep(3)} nextDisabled={areas.length === 0} />
            </div>
          )}

          {step === 3 && (
            <div>
              <Q>HOW LONG<br />TODAY?</Q>
              <Sub>Exercise volume and hold times are scaled to fit your available window.</Sub>
              <div style={{ border: '1px solid var(--border)', padding: 44, background: 'var(--black2)' }}>
                <div style={{ fontFamily: "'Syncopate',sans-serif", fontSize: 'clamp(64px, 20vw, 108px)', fontWeight: 700, letterSpacing: 4, color: 'var(--white)', lineHeight: 1, marginBottom: 4 }}>
                  {duration}
                </div>
                <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 13, letterSpacing: 5, color: 'var(--silver2)', marginBottom: 36, textTransform: 'uppercase' }}>
                  minutes
                </div>
                <input
                  type="range"
                  min="15"
                  max="45"
                  step="5"
                  value={duration}
                  onChange={(event) => setDuration(parseInt(event.target.value, 10))}
                  style={{ width: '100%', height: 1, background: 'var(--silver4)', outline: 'none', cursor: 'pointer', WebkitAppearance: 'none' as never }}
                />
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 14, fontFamily: "'DM Mono',monospace", fontSize: 9, color: 'var(--silver4)' }}>
                  {[15, 20, 25, 30, 35, 40, 45].map((value) => (
                    <span key={value}>{value}</span>
                  ))}
                </div>
              </div>
              <Nav back={() => setStep(mode === 'sport' ? '2a' : '2b')} next={() => setStep(4)} />
            </div>
          )}

          {step === 4 && (
            <div>
              <Q>WHAT&apos;S YOUR<br />MAIN FOCUS?</Q>
              <Sub>This determines how the three pillars are weighted for your session.</Sub>
              <div className="mg-grid-2" style={{ gap: 1, background: 'var(--border)', border: '1px solid var(--border)' }}>
                {GOALS.map((item) => (
                  <div
                    key={item.id}
                    onClick={() => setGoal(item.id)}
                    style={{ ...baseCard, ...(goal === item.id ? selectedStyle : {}) }}
                    onMouseEnter={(event) => {
                      if (goal !== item.id) {
                        event.currentTarget.style.background = 'var(--black3)'
                      }
                    }}
                    onMouseLeave={(event) => {
                      if (goal !== item.id) {
                        event.currentTarget.style.background = 'var(--black2)'
                      }
                    }}
                  >
                    <span style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}>
                      <Icon name={item.icon} size={24} color="var(--cyan)" />
                    </span>
                    <div style={{ fontFamily: "'Syncopate',sans-serif", fontSize: 10, fontWeight: 700, letterSpacing: 2, color: goal === item.id ? 'var(--cyan)' : 'var(--silver)', marginBottom: 8, textTransform: 'uppercase' }}>
                      {item.label}
                    </div>
                    <div style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 14, color: 'var(--silver2)', lineHeight: 1.6 }}>{item.sub}</div>
                  </div>
                ))}
              </div>
              <Nav back={() => setStep(3)} next={() => setStep(5)} nextDisabled={!goal} />
            </div>
          )}

          {step === 5 && (
            <div>
              <Q>INCLUDE FOAM<br />ROLL PREP?</Q>
              <Sub>A short myofascial release phase before your session reduces tissue tension and prepares your joints for loading.</Sub>
              <div className="mg-grid-2" style={{ gap: 1, background: 'var(--border)', border: '1px solid var(--border)', marginBottom: 44 }}>
                {[
                  { val: true, icon: 'recovery' as IconName, label: 'YES - Include Prep', sub: 'Adds foam roll exercises before release. Duration adjusted automatically.' },
                  { val: false, icon: 'general' as IconName, label: 'NO - Skip to Release', sub: 'Jump straight into stretching and mobility work.' },
                ].map((option) => (
                  <div
                    key={String(option.val)}
                    onClick={() => setIncludeFoamRoll(option.val)}
                    style={{ ...baseCard, ...(includeFoamRoll === option.val ? selectedStyle : {}) }}
                    onMouseEnter={(event) => {
                      if (includeFoamRoll !== option.val) {
                        event.currentTarget.style.background = 'var(--black3)'
                      }
                    }}
                    onMouseLeave={(event) => {
                      if (includeFoamRoll !== option.val) {
                        event.currentTarget.style.background = 'var(--black2)'
                      }
                    }}
                  >
                    <span style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}>
                      <Icon name={option.icon} size={26} color="var(--cyan)" />
                    </span>
                    <div style={{ fontFamily: "'Syncopate',sans-serif", fontSize: 10, fontWeight: 700, letterSpacing: 2, color: includeFoamRoll === option.val ? 'var(--cyan)' : 'var(--silver)', marginBottom: 8, textTransform: 'uppercase' }}>
                      {option.label}
                    </div>
                    <div style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 14, color: 'var(--silver2)', lineHeight: 1.6 }}>{option.sub}</div>
                  </div>
                ))}
              </div>

              {error && (
                <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 11, color: '#e74c3c', marginBottom: 16, padding: '10px 14px', borderLeft: '2px solid #e74c3c', background: 'rgba(231,76,60,0.06)' }}>
                  {error}
                </div>
              )}
              {dailyLimitReached && (
                <div style={{ marginBottom: 18, border: '1px solid rgba(0,180,216,0.18)', background: 'rgba(0,180,216,0.08)', padding: '14px 16px' }}>
                  <div style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 15, color: 'var(--silver2)', lineHeight: 1.7, marginBottom: 12 }}>
                    You&apos;ve used your 2 free routines today. Want unlimited routines? Premium is coming soon.
                  </div>
                  <button className="btn-primary" onClick={() => router.push('/dashboard')}>
                    BACK TO DASHBOARD
                  </button>
                </div>
              )}
              {readinessSnapshot && (
                <div style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 14, color: 'var(--silver2)', marginBottom: 16, padding: '12px 14px', borderLeft: '2px solid var(--cyan)', background: 'rgba(0,180,216,0.06)', lineHeight: 1.65 }}>
                  {readinessSnapshot.userMessage}
                </div>
              )}

              <div className="mg-mobile-stack">
                <button className="btn-outline" onClick={() => setStep(4)}>BACK</button>
                <button className="btn-primary" disabled={includeFoamRoll === null || loading} onClick={handleGenerateClick}>
                  {loading ? 'GENERATING...' : 'GENERATE ROUTINE'}
                </button>
              </div>
            </div>
          )}
        </div>
      </main>
      <PreSessionReadinessModal
        open={showReadinessGate}
        onComplete={() => {
          setShowReadinessGate(false)
          setReadinessConfirmedForCurrentBuild(true)
          void generateRoutine()
        }}
      />
    </>
  )
}
