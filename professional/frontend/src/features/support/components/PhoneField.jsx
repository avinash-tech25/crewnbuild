/**
 * Phone number with its country code, for the countries GET /support/config
 * lists (the ones the application serves). Flags are drawn here: Windows does
 * not render flag emoji, so an emoji flag would show as two letters.
 */
import { ChevronDown } from 'lucide-react'

function IndiaFlag() {
  return (
    <svg viewBox="0 0 30 20" className="h-[14px] w-[21px] shrink-0 rounded-[2px] ring-1 ring-black/10" aria-hidden="true">
      <rect width="30" height="20" fill="#fff" />
      <rect width="30" height="6.67" fill="#FF9933" />
      <rect y="13.33" width="30" height="6.67" fill="#138808" />
      <circle cx="15" cy="10" r="2.6" fill="none" stroke="#000080" strokeWidth="0.8" />
      <circle cx="15" cy="10" r="0.6" fill="#000080" />
    </svg>
  )
}

const FLAGS = { IN: IndiaFlag }

export function CountryFlag({ code }) {
  const Flag = FLAGS[code]
  return Flag ? <Flag /> : null
}

export default function PhoneField({ id, countries, dialCode, phone, onChange, error, readOnly = false, inputClass }) {
  const selected = countries.find((country) => country.dial_code === dialCode) || countries[0]
  const describedBy = error ? `${id}-error` : undefined
  return (
    <div>
      <div
        className={`flex h-11 items-stretch overflow-hidden rounded-xl border bg-white transition-[border-color,box-shadow]
                    focus-within:border-oc-green focus-within:ring-4 focus-within:ring-[rgba(18,107,69,.08)]
                    ${error ? 'border-red-400' : 'border-[rgba(8,62,43,.15)]'} ${readOnly ? 'bg-oc-sunken' : ''}`}
      >
        <label className="relative flex shrink-0 items-center gap-2 border-e border-[rgba(8,62,43,.12)] ps-3 pe-7">
          <span className="sr-only">Country code</span>
          {selected && <CountryFlag code={selected.code} />}
          <span className="text-sm font-bold text-oc-ink" dir="ltr">{selected?.dial_code}</span>
          {!readOnly && <ChevronDown size={14} className="pointer-events-none absolute end-2 text-oc-muted" aria-hidden="true" />}
          <select
            value={selected?.dial_code || ''}
            disabled={readOnly}
            onChange={(event) => onChange({ dialCode: event.target.value, phone })}
            className="absolute inset-0 cursor-pointer opacity-0 disabled:cursor-default"
            aria-label="Country code"
          >
            {countries.map((country) => (
              <option key={country.dial_code} value={country.dial_code}>
                {country.name} ({country.dial_code})
              </option>
            ))}
          </select>
        </label>
        <input
          id={id}
          type="tel"
          inputMode="tel"
          autoComplete="tel-national"
          dir="ltr"
          value={phone}
          readOnly={readOnly}
          onChange={(event) => onChange({ dialCode: selected?.dial_code || '', phone: event.target.value })}
          placeholder={selected ? `${selected.digits}-digit number` : 'Phone number'}
          aria-invalid={Boolean(error)}
          aria-describedby={describedBy}
          className={`${inputClass} !h-full min-w-0 flex-1 !rounded-none !border-0 !ring-0 ${readOnly ? '!bg-oc-sunken' : ''}`}
        />
      </div>
      {error && <p id={describedBy} className="mt-1 text-xs font-semibold text-red-600">{error}</p>}
    </div>
  )
}
