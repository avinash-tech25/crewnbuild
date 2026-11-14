/**
 * Brands, shown with their logos.
 *
 *   BrandLogo    a brand's logo, or its initials in a neutral tile when the
 *                admin has uploaded none (or the image fails to load).
 *   BrandPicker  a searchable, visual brand selector: logo + name tiles.
 *                `value` / `onChange` carry the brand id as a string, exactly
 *                like the select it replaces, so selection logic is unchanged.
 */
import { useEffect, useState } from 'react'
import { Check, Search } from 'lucide-react'
import { imageUrl } from '../../../shared/api/apiClient.js'

const SIZES = { xs: 'h-6 w-6 text-[9px]', sm: 'h-8 w-8 text-[10px]', md: 'h-10 w-10 text-xs', lg: 'h-14 w-14 text-sm' }

export function BrandLogo({ src, name = '', size = 'sm', className = '' }) {
  const [broken, setBroken] = useState(false)
  useEffect(() => setBroken(false), [src])
  const box = `${SIZES[size] || SIZES.sm} shrink-0 rounded-lg border border-slate-200 bg-white ${className}`
  if (src && !broken) {
    return <img src={imageUrl(src)} alt={name ? `${name} logo` : ''} onError={() => setBroken(true)} className={`${box} object-contain p-0.5`} />
  }
  const initials = String(name || '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0])
    .join('')
    .toUpperCase()
  return (
    <span aria-hidden="true" className={`${box} grid place-items-center font-extrabold text-slate-400`}>
      {initials || '?'}
    </span>
  )
}

/**
 * brands        [{ id, name, logo_url }]
 * value         the selected id as a string ('' for none)
 * onChange(id)  called with the id as a string
 * leading       options shown before the brands, e.g. [{ value: '', label: 'All brands' }]
 * trailing      options shown after, e.g. [{ value: 'generic', label: 'Generic (no brand)' }]
 */
export function BrandPicker({ brands = [], value, onChange, leading = [], trailing = [], disabled = false, emptyLabel = 'No brands yet.' }) {
  const [query, setQuery] = useState('')
  const term = query.trim().toLowerCase()
  const options = [
    ...leading.map((option) => ({ ...option, special: true })),
    ...brands.map((brand) => ({ value: String(brand.id), label: brand.name, logo: brand.logo_url })),
    ...trailing.map((option) => ({ ...option, special: true })),
  ].filter((option) => !term || option.label.toLowerCase().includes(term))

  return (
    <div className={disabled ? 'pointer-events-none opacity-50' : ''}>
      <label className="flex h-10 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 focus-within:border-brand-400 focus-within:ring-2 focus-within:ring-brand-100">
        <Search className="h-4 w-4 shrink-0 text-graphite/40" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search brands…"
          aria-label="Search brands"
          disabled={disabled}
          className="min-w-0 flex-1 bg-transparent text-sm font-semibold text-graphite outline-none placeholder:text-graphite/40"
        />
      </label>
      <div role="listbox" aria-label="Brands" className="mt-2 grid max-h-64 grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-3">
        {options.map((option) => {
          const selected = String(value ?? '') === String(option.value)
          return (
            <button
              key={`${option.special ? 's' : 'b'}-${option.value}`}
              type="button"
              role="option"
              aria-selected={selected}
              onClick={() => onChange(String(option.value))}
              className={`flex min-w-0 items-center gap-2 rounded-xl border px-2.5 py-2 text-left transition ${
                selected ? 'border-brand-500 bg-brand-50 ring-2 ring-brand-200' : 'border-slate-200 bg-white hover:border-brand-300 hover:bg-slate-50'
              }`}
            >
              {option.special ? (
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-dashed border-slate-300 text-[10px] font-extrabold text-slate-400">
                  {option.icon || '—'}
                </span>
              ) : (
                <BrandLogo src={option.logo} name={option.label} />
              )}
              <span className="min-w-0 flex-1 truncate text-xs font-extrabold text-graphite">{option.label}</span>
              {selected && <Check className="h-4 w-4 shrink-0 text-brand-700" aria-hidden="true" />}
            </button>
          )
        })}
        {options.length === 0 && <p className="col-span-full px-1 py-2 text-xs font-semibold text-graphite/45">{term ? 'No matching brands.' : emptyLabel}</p>}
      </div>
    </div>
  )
}
