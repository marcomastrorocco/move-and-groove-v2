'use client'

import { useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'

const UC = 'uppercase' as const

type Props = {
  // true once a session exists but the account carries no is_admin flag.
  denied: boolean
  // Address of the signed-in account, shown only in the denied state.
  signedInAs: string
  // Ask the admin page to re-run its session and is_admin check.
  onSessionChange: () => void
}

export default function AdminLoginGate({ denied, signedInAs, onSessionChange }: Props) {
  const supabase = createClient()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleUnlock() {
    setError('')

    const address = email.trim().toLowerCase()
    if (!address || !password) {
      setError('Enter the owner email and password.')
      return
    }

    setLoading(true)
    const { error: signInError } = await supabase.auth.signInWithPassword({ email: address, password })

    if (signInError) {
      // An unconfirmed address is worth naming: the owner has already proved
      // the password, so hiding it only leaves them guessing at a state they
      // can fix from their inbox. Everything else stays generic so a wrong
      // guess never confirms which accounts exist.
      setError(
        signInError.message.toLowerCase().includes('not confirmed')
          ? 'That account has not confirmed its email yet. Open the confirmation link, then sign in again.'
          : 'Those credentials were not accepted.',
      )
      setLoading(false)
      return
    }

    setPassword('')
    setLoading(false)
    onSessionChange()
  }

  async function handleSignOut() {
    setLoading(true)
    await supabase.auth.signOut()
    setLoading(false)
    onSessionChange()
  }

  return (
    <>
      <div style={{ position: 'fixed', inset: 0, zIndex: 0, pointerEvents: 'none', background: '#000000' }}>
        <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(circle at top, rgba(0,180,216,0.1) 0%, rgba(0,0,0,0) 36%), linear-gradient(to bottom, rgba(4,6,9,0.98) 0%, rgba(0,0,0,1) 100%)' }} />
      </div>

      <main style={{ position: 'relative', zIndex: 2 }}>
        <section style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          minHeight: '100vh', padding: 40,
        }}>
          <div style={{ width: '100%', maxWidth: 420 }}>
            <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 9, letterSpacing: 4, color: 'var(--cyan3)', marginBottom: 16, textTransform: UC }}>
              {'// Owner Access'}
            </div>
            <div style={{ fontFamily: "'Syncopate',sans-serif", fontSize: 24, fontWeight: 700, letterSpacing: 4, color: 'var(--white)', marginBottom: 18, lineHeight: 1.3 }}>
              MASTER<br />ADMIN
            </div>
            <div style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 14, color: 'var(--silver3)', lineHeight: 1.7, marginBottom: 34, paddingBottom: 26, borderBottom: '1px solid var(--border)' }}>
              This panel is restricted to the account that owns Move &amp; Groove. It is not the athlete sign-in.
            </div>

            {denied ? (
              <div>
                <div className="auth-error" style={{ marginTop: 0 }}>
                  This account has no owner access.
                </div>
                <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 11, color: 'var(--silver3)', marginTop: 14, lineHeight: 1.8 }}>
                  SIGNED IN AS
                  <div style={{ color: 'var(--white)', letterSpacing: 1, wordBreak: 'break-all' }}>{signedInAs}</div>
                </div>
                <button className="btn-primary" onClick={handleSignOut} disabled={loading}
                  style={{ width: '100%', marginTop: 22, padding: 18 }}>
                  {loading ? 'SIGNING OUT...' : 'SIGN OUT & USE OWNER ACCOUNT'}
                </button>
              </div>
            ) : (
              <div>
                <div className="form-group">
                  <label className="form-label">Owner Email</label>
                  <input className="form-input" type="email" autoComplete="username" placeholder="you@example.com"
                    value={email} onChange={e => setEmail(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleUnlock()} />
                </div>
                <div className="form-group">
                  <label className="form-label">Password</label>
                  <div style={{ position: 'relative' }}>
                    <input className="form-input" type={showPassword ? 'text' : 'password'} autoComplete="current-password" placeholder="********"
                      value={password} onChange={e => setPassword(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && handleUnlock()}
                      style={{ paddingRight: 100 }} />
                    <button
                      type="button"
                      className="btn-ghost"
                      onClick={() => setShowPassword((value) => !value)}
                      style={{ position: 'absolute', top: '50%', right: 10, transform: 'translateY(-50%)', fontSize: 9, letterSpacing: 2, color: 'var(--cyan3)' }}
                    >
                      {showPassword ? 'HIDE' : 'SHOW'}
                    </button>
                  </div>
                </div>
                <button className="btn-primary" onClick={handleUnlock} disabled={loading}
                  style={{ width: '100%', marginTop: 12, padding: 18 }}>
                  {loading ? 'UNLOCKING...' : 'UNLOCK PANEL'}
                </button>
                {error && <div className="auth-error">{error}</div>}
              </div>
            )}

            <div style={{ marginTop: 30, paddingTop: 22, borderTop: '1px solid var(--border)' }}>
              <Link href="/" style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, letterSpacing: 2, color: 'var(--silver3)', textDecoration: 'none', textTransform: UC }}>
                &larr; Back to site
              </Link>
            </div>
          </div>
        </section>
      </main>
    </>
  )
}
