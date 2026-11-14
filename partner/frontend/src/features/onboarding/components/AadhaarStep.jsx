import { useRef, useState } from 'react'
import { IdCard, ShieldCheck } from 'lucide-react'
import { Alert, Spinner } from '../../../shared/ui/ui.jsx'
import { apiErrorMessage } from '../../../shared/api/apiClient.js'
import { submitAadhaar } from '../../technician/technicianApi.js'

// Verhoeff checksum -- the format check UIDAI numbers carry. Only an early hint
// for typing mistakes; the server repeats the check, and neither is verification.
const D = [[0,1,2,3,4,5,6,7,8,9],[1,2,3,4,0,6,7,8,9,5],[2,3,4,0,1,7,8,9,5,6],[3,4,0,1,2,8,9,5,6,7],[4,0,1,2,3,9,5,6,7,8],[5,9,8,7,6,0,4,3,2,1],[6,5,9,8,7,1,0,4,3,2],[7,6,5,9,8,2,1,0,4,3],[8,7,6,5,9,3,2,1,0,4],[9,8,7,6,5,4,3,2,1,0]]
const P = [[0,1,2,3,4,5,6,7,8,9],[1,5,7,6,2,8,3,0,9,4],[5,8,0,3,7,9,6,1,4,2],[8,9,1,6,0,4,3,5,2,7],[9,4,5,3,1,2,6,8,7,0],[4,2,8,6,5,7,3,9,0,1],[2,7,9,3,8,0,6,4,1,5],[7,0,4,6,9,1,3,2,5,8]]

function looksValid(digits) {
  if (!/^[2-9]\d{11}$/.test(digits)) return false
  let checksum = 0
  digits.split('').reverse().forEach((digit, position) => { checksum = D[checksum][P[position % 8][Number(digit)]] })
  return checksum === 0
}

const grouped = (digits) => digits.replace(/(\d{4})(?=\d)/g, '$1 ')

/**
 * Aadhaar details, step 5.
 *
 * The number is typed into a masked-style field, sent once, and from then on
 * shown only as XXXX XXXX 1234. It is not claimed to be verified.
 */
export default function AadhaarStep({ onDone }) {
  const [digits, setDigits] = useState('')
  const [consent, setConsent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  // The number in the field right now, read when a submission answers.
  const currentDigits = useRef('')
  const complete = digits.length === 12
  const valid = complete && looksValid(digits)

  const changeDigits = (event) => {
    const next = event.target.value.replace(/\D/g, '').slice(0, 12)
    // A server error (e.g. "already linked") describes the number that was sent, not
    // this one: drop it as soon as the number changes. Validity is derived from `digits`.
    if (next !== currentDigits.current) setMessage('')
    currentDigits.current = next
    setDigits(next)
  }

  const submit = async (event) => {
    event.preventDefault()
    if (busy || !consent || !valid) return
    const sent = digits
    setBusy(true)
    setMessage('')
    try {
      const user = await submitAadhaar(sent)
      currentDigits.current = ''
      setDigits('')
      onDone(user)
    } catch (error) {
      // Edited while the request was out: this answer belongs to a number no longer in the field.
      if (currentDigits.current === sent) {
        setMessage(apiErrorMessage(error, 'Your Aadhaar details could not be saved. Please try again.'))
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4" autoComplete="off">
      <div className="rounded-2xl border border-oc-line bg-oc-sunken p-4 text-sm">
        <p className="flex items-center gap-2 font-extrabold text-oc-deep"><ShieldCheck className="h-4 w-4 text-oc-green" /> How your Aadhaar number is protected</p>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-oc-muted">
          <li>It is encrypted before it is stored and is never shown again in full.</li>
          <li>You and Partner see only the last four digits, like XXXX XXXX 1234.</li>
          <li>It is used only to confirm your identity and to stop duplicate accounts.</li>
        </ul>
        <label className="mt-3 flex cursor-pointer items-start gap-2 font-semibold text-oc-ink">
          <input type="checkbox" className="mt-1 h-4 w-4 accent-oc-green" checked={consent} onChange={(event) => setConsent(event.target.checked)} />
          I consent to Partner storing my Aadhaar number securely for identity verification.
        </label>
      </div>

      <Alert tone="error">{message}</Alert>

      <label className="block">
        <span className="field-label">Aadhaar number</span>
        <div className="relative">
          <IdCard className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-oc-muted" />
          <input
            className="field-input pl-11 font-display text-lg tracking-[0.2em]"
            inputMode="numeric"
            autoComplete="off"
            name="partner-aadhaar"
            required
            value={grouped(digits)}
            onChange={changeDigits}
            placeholder="0000 0000 0000"
          />
        </div>
        {complete && !valid && <span className="mt-1 block text-xs font-semibold text-red-700">This does not look like a valid Aadhaar number. Check the digits.</span>}
      </label>

      <button type="submit" className="btn-primary w-full py-3" disabled={busy || !consent || !valid}>
        {busy ? <Spinner className="h-4 w-4" /> : <ShieldCheck className="h-4 w-4" />} Save Aadhaar details
      </button>
    </form>
  )
}
