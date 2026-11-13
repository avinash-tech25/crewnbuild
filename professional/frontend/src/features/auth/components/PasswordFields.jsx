import { useState } from 'react'
import { ArrowLeft, Check, Eye, EyeOff, Lock } from 'lucide-react'
import { controlClass, labelClass } from './AuthShell.jsx'
import { RequiredMark } from '../../accounts/components/ProfileCompletionMeter.jsx'

// Pieces shared by the sign-up password check and the forgot-password reset, so both
// flows look and behave the same.

// One slot swaps its contents in place: the old panel leaves before the new one arrives.
export const swap = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
  transition: { duration: 0.22, ease: [0.23, 1, 0.32, 1] },
}

export const actionButton =
  'w-full min-h-[46px] rounded-xl border border-oc-green/40 bg-oc-mint/50 text-oc-green text-xs font-extrabold ' +
  'transition-[background,border-color] duration-200 hover:bg-oc-mint disabled:opacity-60'

export function StatusLine({ tone, children }) {
  return (
    <p className={`mt-1.5 flex items-center gap-1.5 text-[11px] font-bold ${tone === 'warning' ? 'text-[#b56a17]' : 'text-oc-green'}`}>
      {tone === 'success' && <Check size={13} />}
      {children}
    </p>
  )
}

export function BackLink({ label, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mt-1.5 inline-flex items-center gap-1.5 text-[11px] font-extrabold text-oc-muted transition-colors duration-200 hover:text-oc-green"
    >
      <ArrowLeft size={13} className="rtl:-scale-x-100" />
      {label}
    </button>
  )
}

// Password inputs refuse copy, cut and paste, so a password is always typed and
// cannot be lifted out of the field (including while it is revealed).
export const blockClipboard = {
  onCopy: (event) => event.preventDefault(),
  onCut: (event) => event.preventDefault(),
  onPaste: (event) => event.preventDefault(),
}

export function PasswordField({ label, placeholder, value, onChange, tone, trailing, inputRef, revealLabel, hint, required = false }) {
  const [revealed, setRevealed] = useState(false)

  const toneClass =
    tone === 'warning' ? 'border-[#d98324] focus:border-[#d98324] focus:shadow-[0_0_0_4px_rgba(217,131,36,.14)]'
      : tone === 'success' ? 'border-oc-green bg-oc-mint/40'
        : 'border-oc-line focus:border-oc-green'

  return (
    <div>
      <span className={labelClass}>{label}{required && <RequiredMark />}</span>
      <span className="relative block">
        <Lock size={17} className="absolute start-4 top-1/2 -translate-y-1/2 text-oc-green" />
        <input
          ref={inputRef}
          className={`${controlClass} ps-[46px] pe-[84px] placeholder:text-oc-muted/70 ${toneClass}`}
          type={revealed ? 'text' : 'password'}
          placeholder={placeholder}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          autoComplete="new-password"
          {...blockClipboard}
        />
        <button
          type="button"
          onClick={() => setRevealed((shown) => !shown)}
          aria-label={revealLabel}
          aria-pressed={revealed}
          className="absolute end-[44px] top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-lg text-oc-muted
                     transition-colors duration-200 hover:text-oc-green"
        >
          {revealed ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
        {trailing}
      </span>
      {hint}
    </div>
  )
}
