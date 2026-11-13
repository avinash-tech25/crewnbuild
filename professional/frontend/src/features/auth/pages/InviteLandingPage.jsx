import { useEffect, useState } from 'react'
import { Navigate, useParams } from 'react-router-dom'
import Logo from '../../../shared/ui/Logo.jsx'
import { HardHat, UserRound } from 'lucide-react'

export default function InviteLanding() {
  const { code } = useParams()
  const [ready, setReady] = useState(false)

  useEffect(() => {
    try {
      window.localStorage.setItem('crewnbuild_pending_invite', (code || '').trim().toUpperCase())
    } catch {
      /* noop */
    }
    const timer = window.setTimeout(() => setReady(true), 900)
    return () => window.clearTimeout(timer)
  }, [code])

  if (ready) {
    return <Navigate to={`/signup?role=ENGINEER&invite=${encodeURIComponent((code || '').trim().toUpperCase())}`} replace />
  }

  return (
    <main className="auth-shell">
      <img src="/auth-architecture-bg.png" alt="" className="auth-backdrop fixed" />
      <div className="auth-overlay fixed" />
      <div className="pointer-events-none fixed inset-0 bg-grid opacity-[0.07]" />
      <header className="relative z-20 flex items-center justify-between border-b border-white/10 px-4 py-4 sm:px-6 lg:px-10">
        <Logo light withTagline={false} small />
      </header>
      <section className="relative z-10 grid min-h-[70vh] place-items-center px-4">
        <div className="auth-anim-fade-up auth-panel w-full max-w-md !p-7 text-center">
          <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-brand-400/15 text-brand-300 ring-1 ring-brand-400/25">
            <HardHat className="h-7 w-7" />
          </span>
          <h1 className="mt-4 font-display text-2xl font-extrabold tracking-tight text-brand-950">
            You&apos;ve been invited to join a Site Engineer team
          </h1>
          <p className="mt-2 text-sm leading-6 text-graphite/65">
            A builder invited you to their CREWNBUILD team. Your invitation code is
            <span className="mx-1.5 rounded-md bg-brand-50 px-2 py-0.5 font-mono text-sm font-extrabold tracking-wider text-brand-800">
              {(code || '').trim().toUpperCase()}
            </span>
          </p>
          <div className="mt-4 flex items-center justify-center gap-2 rounded-xl border border-brand-100/80 bg-brand-50/70 px-4 py-3 text-xs font-bold text-brand-800">
            <UserRound className="h-4 w-4" />
            Opening the Site Engineer signup…
          </div>
          <p className="mt-4 text-xs text-graphite/55">
            Already have an account? <a href="/login" className="font-bold text-brand-700">Sign in</a> and open Join Team with this code.
          </p>
        </div>
      </section>
    </main>
  )
}
