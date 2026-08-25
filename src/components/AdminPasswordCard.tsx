'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'

const UC = 'uppercase' as const

type Props = {
  // Address of the signed-in owner, shown so it is obvious which account is
  // about to change.
  email: string
  // The local preview has no Supabase session to update.
  demoMode: boolean
}

export default function AdminPasswordCard({ email, demoMode }: Props) {
  const supabase = createClient()

  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  async function handleSave() {
    setError('')
    setSaved(false)

    if (password.length < 6) {
      setError('Please use a password with at least 6 characters.')
      return
    }

    if (password !== confirmPassword) {
      setError('The two passwords do not match.')
      return
    }

    setSaving(true)
    const { error: updateError } = await supabase.auth.updateUser({ password })

    if (updateError) {
      setError(updateError.message)
      setSaving(false)
      return
    }

    // Supabase keeps the current session valid, so there is nothing to sign
    // back into -- only the next sign-in needs the new password.
    setPassword('')
    setConfirmPassword('')
    setSaved(true)
    setSaving(false)
  }

  return (
    <section style={{ marginBottom: 36 }}>
      <div style={{ fontFamily: "'Syncopate',sans-serif", fontSize: 18, letterSpacing: 3, color: 'var(--white)', marginBottom: 16 }}>
        OWNER PASSWORD
      </div>
      <div style={{ background: 'rgba(8,10,14,0.96)', border: '1px solid rgba(255,255,255,0.08)', padding: 20, maxWidth: 520 }}>
        <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, letterSpacing: 3, color: 'var(--cyan)', textTransform: UC, marginBottom: 6 }}>
          Signed in as
        </div>
        <div style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 15, color: 'var(--white)', marginBottom: 22, wordBreak: 'break-all' }}>
          {email || 'unknown account'}
        </div>

        {demoMode ? (
          <div style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 14, color: '#ffce78' }}>
            The local demo preview has no real account, so there is no password to change.
          </div>
        ) : (
          <>
            <div className="form-group">
              <label className="form-label">New Password</label>
              <div style={{ position: 'relative' }}>
                <input className="form-input" type={showPassword ? 'text' : 'password'} autoComplete="new-password"
                  placeholder="Minimum 6 characters"
                  value={password} onChange={e => setPassword(e.target.value)}
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

            <div className="form-group">
              <label className="form-label">Confirm New Password</label>
              <input className="form-input" type={showPassword ? 'text' : 'password'} autoComplete="new-password"
                placeholder="Re-enter the new password"
                value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSave()} />
            </div>

            <button className="btn-primary" onClick={handleSave} disabled={saving}
              style={{ width: '100%', marginTop: 12, padding: 16 }}>
              {saving ? 'SAVING...' : 'SAVE NEW PASSWORD'}
            </button>

            {saved && (
              <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 11, color: 'var(--cyan)', marginTop: 12, padding: '10px 14px', borderLeft: '2px solid var(--cyan)', background: 'rgba(0,180,216,0.06)' }}>
                Password updated. You stay signed in here; the new one is needed next time.
              </div>
            )}
            {error && <div className="auth-error">{error}</div>}
          </>
        )}
      </div>
    </section>
  )
}
