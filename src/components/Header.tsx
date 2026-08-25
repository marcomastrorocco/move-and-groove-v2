'use client'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { endDemoSession, isDemoSessionActive } from '@/lib/demo-session'
import { useEffect, useState } from 'react'
import type { User } from '@supabase/supabase-js'

type Props = {
  // Overrides where the logo goes. The default destination depends on a
  // session lookup that only resolves after first paint, so a click landing in
  // that window falls through to the public homepage -- wrong on a surface
  // like /admin, which is only reachable while signed in.
  homeHref?: string
}

export default function Header({ homeHref }: Props = {}) {
  const router = useRouter()
  const supabase = createClient()
  const [user, setUser] = useState<User | null>(null)
  const [demoSession, setDemoSession] = useState(() => isDemoSessionActive())

  useEffect(() => {
    supabase.auth.getUser()
      .then(({ data }) => setUser(data.user))
      .catch(() => setUser(null))
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => {
      setUser(session?.user ?? null)
    })
    return () => subscription.unsubscribe()
  }, [supabase])

  async function signOut() {
    if (demoSession) {
      endDemoSession()
      setDemoSession(false)
      router.push('/')
      return
    }
    await supabase.auth.signOut()
    router.push('/')
  }
  const signedIn = Boolean(user) || demoSession
const fullName = user?.user_metadata?.full_name
const firstName = demoSession
  ? 'Demo Athlete'
  : fullName
  ? fullName.split(' ')[0]
  : 'Athlete'
const initials = demoSession
  ? 'DA'
  : fullName
  ? fullName.split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2)
  : user?.email?.slice(0, 2).toUpperCase() || 'MG'

  
  return (
    <header style={{
      position: 'fixed', top: 0, left: 0, right: 0, zIndex: 500,
      height: 64, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '0 48px',
      background: 'rgba(0,0,0,0.95)',
      backdropFilter: 'blur(24px)',
      borderBottom: '1px solid var(--border)',
    }}>
      <Link href={homeHref ?? (signedIn ? '/dashboard' : '/')} style={{ textDecoration: 'none', cursor: 'pointer', minWidth: 0 }}>
        <div style={{
          fontFamily: "'Syncopate', sans-serif",
          fontSize: 'clamp(13px, 3.4vw, 17px)', fontWeight: 700, letterSpacing: 5,
          background: 'linear-gradient(90deg, var(--white) 0%, var(--white) 40%, var(--cyan) 100%)',
          WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
          textTransform: 'uppercase', lineHeight: 1,
        }}>
          MOVE<span style={{ WebkitTextFillColor: 'var(--cyan)' }}>&</span>GROOVE
        </div>
   <span className="mg-header-brand-tagline" style={{
  fontFamily: "'DM Mono', monospace", fontSize: 9,
  letterSpacing: 3, color: 'var(--silver2)', display: 'block', marginTop: 3,
}}>
  TRUSTED BY ELITE ATHLETES / CRAFTED FOR YOU
</span>
      </Link>

      <div style={{
        display: 'flex', gap: 20,
        position: 'absolute', left: '50%', transform: 'translateX(-50%)',
      }} className="hide-mobile">
        {['RELEASE', 'ACTIVATION', 'RANGE'].map((tag, i) => (
          <div key={tag} style={{
            fontFamily: "'Syncopate', sans-serif", fontSize: 9, fontWeight: 700,
            letterSpacing: 3, textTransform: 'uppercase',
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '7px 16px',
            border: `1px solid ${i === 2 ? 'rgba(0,180,216,0.3)' : 'rgba(200,205,212,0.2)'}`,
            borderRadius: 2,
            color: i === 2 ? 'var(--cyan)' : 'var(--silver)',
            background: i === 2 ? 'rgba(0,180,216,0.04)' : 'rgba(200,205,212,0.04)',
          }}>
            <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'currentColor', display: 'inline-block' }} />
            {tag}
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        {signedIn ? (
          <div className="mg-header-user-pill" style={{
            display: 'flex', alignItems: 'center', gap: 10,
            background: 'var(--black3)', border: '1px solid var(--border)',
            padding: '6px 14px 6px 8px', borderRadius: 30,
          }}>
            <div style={{
              width: 28, height: 28, borderRadius: '50%',
              background: 'linear-gradient(135deg, var(--cyan3), var(--cyan))',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontFamily: "'Syncopate', sans-serif", fontSize: 9, fontWeight: 700,
              color: 'var(--black)',
            }}>
              {initials}
            </div>
            <span className="mg-header-user-name" style={{
              fontFamily: "'DM Mono', monospace", fontSize: 10,
              letterSpacing: 2, color: 'var(--silver2)',
            }}>
              {firstName}
            </span>
            <button className="btn-ghost" onClick={signOut}>SIGN OUT</button>
          </div>
        ) : (
          <Link href="/auth" className="btn-outline" style={{ padding: '8px 20px', fontSize: 9 }}>
            SIGN IN
          </Link>
        )}
      </div>
    </header>
  )
}
