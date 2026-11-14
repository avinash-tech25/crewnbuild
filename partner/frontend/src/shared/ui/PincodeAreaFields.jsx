import { useEffect, useState } from 'react'
import { apiErrorMessage } from '../api/apiClient.js'
import { lookupPincodeAreas } from '../../features/technician/technicianApi.js'

/**
 * Pincode + area (India Post branch) picker, the same step the Professional app uses.
 * The areas come from the Partner backend's pincode lookup; the district and
 * block are resolved on the server when the form is saved.
 */
export default function PincodeAreaFields({ pincode, area, onChange, disabled = false }) {
  const [lookup, setLookup] = useState({ status: 'idle', areas: [], message: '' })

  useEffect(() => {
    const cleaned = String(pincode || '').replace(/\s/g, '')
    if (!cleaned) {
      setLookup({ status: 'idle', areas: [], message: '' })
      return undefined
    }
    if (!/^\d{6}$/.test(cleaned)) {
      setLookup({ status: 'invalid', areas: [], message: 'A PIN code has exactly 6 digits.' })
      return undefined
    }
    let cancelled = false
    setLookup({ status: 'loading', areas: [], message: 'Finding areas for this PIN code…' })
    const timer = window.setTimeout(() => {
      lookupPincodeAreas(cleaned)
        .then((result) => {
          if (cancelled) return
          setLookup({ status: 'success', areas: result.areas, message: `${result.district}, ${result.state}` })
          const names = result.areas.map((item) => item.name)
          if (!names.includes(area)) onChange({ area: names.length === 1 ? names[0] : '' })
        })
        .catch((error) => {
          if (cancelled) return
          setLookup({ status: 'error', areas: [], message: apiErrorMessage(error, 'This PIN code could not be found.') })
        })
    }, 400)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
    // `area` and `onChange` are read, not watched: only a new pincode starts a lookup.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pincode])

  const messageTone = lookup.status === 'success' ? 'text-oc-green' : lookup.status === 'loading' ? 'text-oc-muted' : 'text-red-700'

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <label className="block">
        <span className="field-label">PIN code</span>
        <input
          className="field-input"
          inputMode="numeric"
          maxLength={6}
          required
          disabled={disabled}
          value={pincode}
          onChange={(event) => onChange({ pincode: event.target.value.replace(/\D/g, '').slice(0, 6) })}
          placeholder="6 digit PIN code"
        />
        {lookup.message && <span className={`mt-1 block text-xs font-semibold ${messageTone}`}>{lookup.message}</span>}
      </label>
      <label className="block">
        <span className="field-label">Area</span>
        <select
          className="field-input"
          required
          disabled={disabled || lookup.status !== 'success'}
          value={area}
          onChange={(event) => onChange({ area: event.target.value })}
        >
          <option value="">{lookup.status === 'success' ? 'Select your area' : 'Enter PIN code first'}</option>
          {lookup.areas.map((item) => (
            <option key={item.name} value={item.name}>
              {item.name}{item.block ? ` · ${item.block}` : ''}
            </option>
          ))}
        </select>
      </label>
    </div>
  )
}
