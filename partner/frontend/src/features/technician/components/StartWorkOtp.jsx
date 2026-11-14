import { useEffect, useRef, useState } from 'react'
import { KeyRound, Play, X } from 'lucide-react'
import { Spinner } from '../../../shared/ui/ui.jsx'
import { apiErrorMessage } from '../../../shared/api/apiClient.js'
import { startWorkWithOtp } from '../technicianApi.js'
import { OTP_LENGTH, fillDigits, isComplete } from '../startOtp.js'

/**
 * Customer verification before work starts: the technician asks the customer
 * for the Start Work code shown on the customer's booking, and enters it here.
 * The server alone decides; this screen never knows the right code.
 */
export default function StartWorkOtp({ job, onStarted, onCancel }) {
  const [digits, setDigits] = useState(() => Array(OTP_LENGTH).fill(''))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const boxes = useRef([])

  useEffect(() => { boxes.current[0]?.focus() }, [])

  const change = (index, value) => {
    const next = fillDigits(digits, index, value)
    setDigits(next)
    setError('')
    const typed = String(value).replace(/\D/g, '').length
    if (typed) boxes.current[Math.min(index + typed, OTP_LENGTH - 1)]?.focus()
  }

  const keyDown = (index, event) => {
    if (event.key === 'Backspace' && !digits[index] && index > 0) boxes.current[index - 1]?.focus()
  }

  const submit = async (event) => {
    event.preventDefault()
    if (!isComplete(digits)) {
      setError('Enter all 6 digits of the customer\'s code.')
      return
    }
    setBusy(true)
    setError('')
    try {
      const started = await startWorkWithOtp(job.id, digits.join(''))
      onStarted(started)
    } catch (requestError) {
      setError(apiErrorMessage(requestError, 'The code could not be checked. Please try again.'))
      setDigits(Array(OTP_LENGTH).fill(''))
      boxes.current[0]?.focus()
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="rounded-2xl border border-oc-green/40 bg-oc-mint/30 p-4" data-testid="start-otp-form" aria-labelledby={`start-otp-${job.id}`}>
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-oc-green text-white"><KeyRound className="h-5 w-5" /></span>
        <div className="min-w-0">
          <h4 id={`start-otp-${job.id}`} className="font-display text-base font-extrabold text-oc-ink">Customer verification</h4>
          <p className="text-sm text-oc-muted">Ask the customer for their Start Work OTP. It is shown on their booking now that you have arrived.</p>
        </div>
      </div>

      <div className="mt-4 flex justify-center gap-1.5 sm:gap-2" role="group" aria-label="Start Work OTP">
        {digits.map((digit, index) => (
          <input
            key={index}
            ref={(element) => { boxes.current[index] = element }}
            value={digit}
            onChange={(event) => change(index, event.target.value)}
            onKeyDown={(event) => keyDown(index, event)}
            onFocus={(event) => event.target.select()}
            inputMode="numeric"
            autoComplete={index === 0 ? 'one-time-code' : 'off'}
            pattern="[0-9]*"
            maxLength={OTP_LENGTH}
            aria-label={`Digit ${index + 1}`}
            className="h-12 w-10 rounded-xl border border-oc-line bg-white text-center font-display text-xl font-extrabold text-oc-ink outline-none focus:border-oc-green focus:ring-4 focus:ring-oc-green/15 sm:h-14 sm:w-12"
            data-testid="start-otp-digit"
          />
        ))}
      </div>

      {error && <p role="alert" className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm font-bold text-red-800" data-testid="start-otp-error">{error}</p>}

      <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button type="button" className="btn-ghost" onClick={onCancel} disabled={busy}><X className="h-4 w-4" /> Not now</button>
        <button type="submit" className="btn-primary px-6 py-3" disabled={busy || !isComplete(digits)} data-testid="start-otp-submit">
          {busy ? <Spinner className="h-4 w-4" /> : <Play className="h-4 w-4" />} Verify &amp; Start Work
        </button>
      </div>
    </form>
  )
}
