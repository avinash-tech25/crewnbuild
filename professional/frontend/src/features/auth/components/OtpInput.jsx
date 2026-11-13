import { useRef } from 'react'

export const OTP_LENGTH = 6

export const emptyCode = () => Array(OTP_LENGTH).fill('')

const boxClass =
  'w-full aspect-square min-w-0 rounded-lg border-2 bg-white text-center text-base font-extrabold text-oc-ink ' +
  'transition-[border-color,box-shadow,background] duration-200 ' +
  'focus:outline-none focus:shadow-[0_0_0_4px_rgba(18,107,69,.12)] disabled:bg-oc-mint/50 disabled:text-oc-muted'

// Six single-character boxes that move focus along as the visitor types.
//
// The grid is capped rather than filling its column: at the sign-up column width
// full-width boxes grow past 60px each, which is what pushed the form into a
// scroll. `note` sits on the label row for the same reason.
export function OtpInput({ code, onChange, disabled, invalid, verified, label, note }) {
  const boxes = useRef([])

  const focusBox = (index) => boxes.current[index]?.focus()

  const writeDigit = (index, raw) => {
    const digit = raw.replace(/\D/g, '').slice(-1)
    const next = [...code]
    next[index] = digit
    onChange(next)
    if (digit && index < OTP_LENGTH - 1) focusBox(index + 1)
  }

  const handleKeyDown = (index, event) => {
    if (event.key === 'Backspace' && !code[index] && index > 0) {
      event.preventDefault()
      const next = [...code]
      next[index - 1] = ''
      onChange(next)
      focusBox(index - 1)
    }
    if (event.key === 'ArrowLeft' && index > 0) focusBox(index - 1)
    if (event.key === 'ArrowRight' && index < OTP_LENGTH - 1) focusBox(index + 1)
  }

  const handlePaste = (event) => {
    const digits = event.clipboardData.getData('text').replace(/\D/g, '').slice(0, OTP_LENGTH)
    if (!digits) return
    event.preventDefault()
    const next = emptyCode()
    digits.split('').forEach((digit, position) => { next[position] = digit })
    onChange(next)
    focusBox(Math.min(digits.length, OTP_LENGTH - 1))
  }

  const stateClass = verified
    ? 'border-oc-green bg-oc-mint/60'
    : invalid
      ? 'border-[#d98324] focus:border-[#d98324]'
      : 'border-oc-line focus:border-oc-green'

  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span className="shrink-0 text-[11px] font-extrabold uppercase tracking-[.12em] text-oc-deep rtl:tracking-normal">{label}</span>
        {note && <span className="min-w-0 truncate text-[11px] font-semibold text-oc-muted">{note}</span>}
      </div>
      <div className="grid max-w-[302px] grid-cols-6 gap-2" dir="ltr">
        {code.map((digit, index) => (
          <input
            key={index}
            ref={(element) => { boxes.current[index] = element }}
            className={`${boxClass} ${stateClass}`}
            value={digit}
            onChange={(event) => writeDigit(index, event.target.value)}
            onKeyDown={(event) => handleKeyDown(index, event)}
            onPaste={handlePaste}
            disabled={disabled}
            inputMode="numeric"
            autoComplete={index === 0 ? 'one-time-code' : 'off'}
            maxLength={1}
            aria-label={`${label} ${index + 1}`}
          />
        ))}
      </div>
    </div>
  )
}
