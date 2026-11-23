import { Suspense, lazy, useEffect, useRef, useState } from 'react'
import { useSelector } from 'react-redux'
import { useLocation } from 'react-router-dom'
import { useLanguage } from '../../i18n/LanguageContext.jsx'
import { Helmet } from './Helmet.jsx'

/**
 * Where Viswa's bubble appears, and the bubble itself (bottom right, as in Kuwait-Version).
 *
 * Visitors on the public pages and every signed-in role on every page of their dashboard
 * (House Owner, Builder, Engineer, Supplier, Administrator); what Viswa can look up depends
 * on the role and is decided by the server. Hidden on the sign-in, sign-up and set-up
 * screens. While the bubble is on screen, <html data-assistant="on"> and
 * --assistant-offset tell the page to keep its toasts and its last buttons clear of it
 * (index.css, NewRequestToast). The chat panel is lazy-loaded the first time the bubble is
 * clicked, so the pages pay only for this small button. VITE_ASSISTANT_ENABLED=false hides it.
 */
const ChatPanel = lazy(() => import('./ChatPanel.jsx'))

// Sign-in, sign-up and the set-up steps that come before a dashboard.
const HIDDEN_PREFIXES = [
  '/login', '/signup', '/forgot-password', '/account-recovery', '/oauth', '/complete-profile', '/pincode', '/invite',
  '/supplier-category', '/engineer-category',
] // prettier-ignore
const BUBBLE_SPACE = '96px' // the 60px bubble, its 28px margin and a little air

export default function AssistantMount() {
  const user = useSelector((state) => state.auth.user)
  const sessionStatus = useSelector((state) => state.auth.sessionStatus)
  const { pathname } = useLocation()
  if (import.meta.env.VITE_ASSISTANT_ENABLED === 'false') return null
  if (sessionStatus === 'verifying') return null
  if (HIDDEN_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) return null
  // A new chat per account: signing in, out or as someone else never shows another's answers.
  return <AssistantBubble key={user?.id ? String(user.id) : 'guest'} user={user} />
}

function AssistantBubble({ user }) {
  const { t } = useLanguage()
  const [open, setOpen] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const bubbleRef = useRef(null)
  // Tell the page the bubble is there, so toasts and the last buttons of a page move clear of it.
  useEffect(() => {
    const root = document.documentElement
    root.dataset.assistant = 'on'
    root.style.setProperty('--assistant-offset', BUBBLE_SPACE)
    return () => {
      delete root.dataset.assistant
      root.style.removeProperty('--assistant-offset')
    }
  }, [])
  const toggle = () => {
    setLoaded(true)
    setOpen((value) => !value)
  }
  const close = () => {
    setOpen(false)
    bubbleRef.current?.focus()
  }
  return (
    <>
      {loaded && (
        <Suspense fallback={null}>
          <ChatPanel open={open} user={user} onClose={close} />
        </Suspense>
      )}
      <button
        ref={bubbleRef}
        type="button"
        onClick={toggle}
        aria-label={open ? t('assistant.close') : t('assistant.open')}
        aria-expanded={open}
        aria-haspopup="dialog"
        className={`fixed bottom-7 end-7 z-toast h-[60px] w-[60px] place-items-center rounded-full bg-oc-green shadow-[0_10px_28px_rgba(18,107,69,0.28)] transition-transform hover:-translate-y-0.5 hover:bg-oc-deep focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-4 focus-visible:outline-oc-green motion-reduce:transition-none motion-reduce:hover:translate-y-0 max-sm:bottom-4 max-sm:end-4 ${open ? 'hidden sm:grid' : 'grid'}`}
      >
        {open ? (
          <svg className="h-[22px] w-[22px]" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
            <path d="M6 6 L18 18 M18 6 L6 18" />
          </svg>
        ) : (
          <Helmet className="h-8 w-8" stroke="#ffffff" />
        )}
      </button>
    </>
  )
}
