/**
 * Optional supplier bulk pricing -- the supplier's own quantity tiers for ONE
 * listing (never the master product).
 *
 *   BulkPricingEditor  "Offer bulk pricing" toggle + Min / Max / Price rows
 *   BulkPricingPanel   the editor wired to GET/PUT /supplier-products/{id}/bulk-pricing
 *   BulkPricingList    read-only: "10–49 Bag ₹275 · 50+ Bag ₹250"
 *   BulkTierBuilder    Add Product's simple form: "10+ -> ₹250" rows, with a
 *                      preview of what buyers will see
 *
 * The server validates and computes every price (cart and Buy). The checks
 * here only point out a mistake before saving.
 */
import { useEffect, useState } from 'react'
import { Loader2, Plus, Tags, Trash2 } from 'lucide-react'
import { fetchBulkPricing, saveBulkPricing } from '../supplierProductsApi.js'
import { formatMoney } from '../../../shared/utils/countryConfig.js'

const blankTier = () => ({ min_quantity: '', max_quantity: '', unit_price: '' })
const field = 'h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-sm font-semibold text-graphite outline-none focus:border-brand-500'

/** The tiers as the API takes them: numbers, empty max = no upper limit. */
export const tiersForApi = (tiers = []) => tiers
  .filter((tier) => String(tier.min_quantity).trim() !== '' || String(tier.unit_price).trim() !== '')
  .map((tier) => ({
    min_quantity: Number(tier.min_quantity),
    max_quantity: String(tier.max_quantity ?? '').trim() === '' ? null : Number(tier.max_quantity),
    unit_price: Number(tier.unit_price),
  }))

/** The first problem in a set of tiers (the same rules the server applies), or ''. */
export function tierProblem(tiers = []) {
  const clean = tiersForApi(tiers)
  for (const [index, tier] of clean.entries()) {
    const n = index + 1
    if (!Number.isFinite(tier.min_quantity) || tier.min_quantity < 1) return `Tier ${n}: minimum quantity must be at least 1.`
    if (tier.max_quantity !== null && (!Number.isFinite(tier.max_quantity) || tier.max_quantity < tier.min_quantity)) return `Tier ${n}: maximum must be empty or at least the minimum.`
    if (!Number.isFinite(tier.unit_price) || tier.unit_price <= 0) return `Tier ${n}: price per unit must be greater than 0.`
  }
  const sorted = [...clean].sort((a, b) => a.min_quantity - b.min_quantity)
  for (let i = 1; i < sorted.length; i += 1) {
    const previous = sorted[i - 1]
    const current = sorted[i]
    if (current.min_quantity === previous.min_quantity) return `Two tiers start at ${current.min_quantity}.`
    if (previous.max_quantity === null || current.min_quantity <= previous.max_quantity) return 'Quantity ranges must not overlap.'
  }
  return ''
}

const rangeLabel = (tier, unit) => `${tier.min_quantity}${tier.max_quantity == null ? '+' : `–${tier.max_quantity}`}${unit ? ` ${unit}` : ''}`

export function BulkPricingEditor({ enabled, onToggle, tiers, onChange, unit = '', normalPrice = null, country }) {
  const set = (index, key) => (event) => onChange(tiers.map((tier, i) => (i === index ? { ...tier, [key]: event.target.value } : tier)))
  const problem = enabled ? tierProblem(tiers) : ''
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3">
      <label className="flex w-fit cursor-pointer items-center gap-2">
        <input type="checkbox" checked={enabled} onChange={(event) => onToggle(event.target.checked)} className="h-4 w-4 rounded border-slate-300 accent-brand-600" />
        <span className="text-sm font-extrabold text-graphite">Offer bulk pricing</span>
        <span className="text-xs font-semibold text-graphite/45">Optional</span>
      </label>
      {!enabled ? (
        <p className="mt-1 text-xs text-graphite/50">No bulk pricing: every quantity sells at your normal price{normalPrice != null ? ` (${formatMoney(normalPrice, country)}${unit ? ` / ${unit}` : ''})` : ''}.</p>
      ) : (
        <div className="mt-3 space-y-2">
          <div className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2 text-[11px] font-extrabold uppercase tracking-wide text-graphite/45">
            <span>Minimum qty</span><span>Maximum qty</span><span>Price / {unit || 'unit'}</span><span className="w-8" />
          </div>
          {tiers.map((tier, index) => (
            <div key={index} className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2">
              <input type="number" min="1" inputMode="decimal" value={tier.min_quantity} onChange={set(index, 'min_quantity')} placeholder="10" aria-label={`Tier ${index + 1} minimum quantity`} className={field} />
              <input type="number" min="1" inputMode="decimal" value={tier.max_quantity ?? ''} onChange={set(index, 'max_quantity')} placeholder="No limit" aria-label={`Tier ${index + 1} maximum quantity`} className={field} />
              <input type="number" min="0" step="0.01" inputMode="decimal" value={tier.unit_price} onChange={set(index, 'unit_price')} placeholder="₹" aria-label={`Tier ${index + 1} price per unit`} className={field} />
              <button type="button" onClick={() => onChange(tiers.filter((_, i) => i !== index))} aria-label={`Remove tier ${index + 1}`} className="grid h-9 w-8 place-items-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600">
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
          <button type="button" onClick={() => onChange([...tiers, blankTier()])} className="inline-flex h-8 items-center gap-1 rounded-lg border border-dashed border-brand-300 px-3 text-xs font-extrabold text-brand-800 hover:bg-brand-50">
            <Plus className="h-3.5 w-3.5" /> Add Bulk Tier
          </button>
          <p className="text-[11px] text-graphite/50">Leave Maximum empty for “and above”. A quantity not covered by a tier sells at your normal price.</p>
          {problem && <p className="rounded-lg bg-rose-50 px-2.5 py-1.5 text-xs font-bold text-rose-700">{problem}</p>}
        </div>
      )}
    </div>
  )
}

/** The editor for an existing listing, with its own Save. */
export function BulkPricingPanel({ productId, unit = '', normalPrice = null, country }) {
  const [enabled, setEnabled] = useState(false)
  const [tiers, setTiers] = useState([blankTier()])
  const [state, setState] = useState({ loading: true, saving: false, tone: '', text: '' })

  useEffect(() => {
    let live = true
    fetchBulkPricing(productId)
      .then((data) => {
        if (!live) return
        const rows = data?.tiers || []
        setEnabled(rows.length > 0)
        setTiers(rows.length ? rows.map((tier) => ({ min_quantity: String(tier.min_quantity), max_quantity: tier.max_quantity == null ? '' : String(tier.max_quantity), unit_price: String(tier.unit_price) })) : [blankTier()])
        setState((current) => ({ ...current, loading: false }))
      })
      .catch((failure) => live && setState({ loading: false, saving: false, tone: 'error', text: failure.response?.data?.detail || 'Bulk pricing could not be loaded.' }))
    return () => { live = false }
  }, [productId])

  const save = async () => {
    const problem = enabled ? tierProblem(tiers) : ''
    if (problem) { setState((current) => ({ ...current, tone: 'error', text: problem })); return }
    setState((current) => ({ ...current, saving: true, tone: '', text: '' }))
    try {
      const saved = await saveBulkPricing(productId, enabled ? tiersForApi(tiers) : [])
      setState({ loading: false, saving: false, tone: 'success', text: saved.tiers.length ? `Bulk pricing saved (${saved.tiers.length} tier${saved.tiers.length === 1 ? '' : 's'}).` : 'Bulk pricing turned off.' })
    } catch (failure) {
      setState({ loading: false, saving: false, tone: 'error', text: failure.response?.data?.detail || 'Bulk pricing could not be saved.' })
    }
  }

  if (state.loading) return <p className="flex items-center gap-2 text-xs font-semibold text-graphite/50"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading bulk pricing…</p>
  return (
    <section aria-label="Bulk pricing" className="space-y-2">
      <BulkPricingEditor enabled={enabled} onToggle={setEnabled} tiers={tiers} onChange={setTiers} unit={unit} normalPrice={normalPrice} country={country} />
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={save} disabled={state.saving} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-brand-700 px-4 text-xs font-extrabold text-white hover:bg-brand-800 disabled:opacity-50">
          {state.saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Tags className="h-3.5 w-3.5" />} Save bulk pricing
        </button>
        {state.text && <span className={`text-xs font-bold ${state.tone === 'error' ? 'text-rose-700' : 'text-emerald-700'}`}>{state.text}</span>}
      </div>
    </section>
  )
}

/** The supplier's tiers, read-only. Renders nothing when there are none. */
export function BulkPricingList({ tiers = [], unit = '', country, compact = false, className = '' }) {
  if (!tiers?.length) return null
  if (compact) {
    return (
      <p className={`flex flex-wrap items-center gap-x-1.5 text-[10px] font-bold text-brand-800 ${className}`}>
        <Tags className="h-3 w-3" aria-hidden="true" /> Bulk:
        {tiers.map((tier, index) => (
          <span key={tier.min_quantity}>{index > 0 ? '· ' : ''}{rangeLabel(tier, '')} {formatMoney(tier.unit_price, country)}</span>
        ))}
      </p>
    )
  }
  return (
    <div className={`rounded-lg border border-brand-100 bg-brand-50/60 px-3 py-2 ${className}`}>
      <p className="flex items-center gap-1.5 text-xs font-extrabold text-brand-800"><Tags className="h-3.5 w-3.5" /> Bulk pricing</p>
      <ul className="mt-1 space-y-0.5">
        {tiers.map((tier) => (
          <li key={tier.min_quantity} className="flex justify-between gap-3 text-xs font-semibold text-graphite">
            <span>{rangeLabel(tier, unit)}</span>
            <span className="font-extrabold">{formatMoney(tier.unit_price, country)}{unit ? ` / ${unit}` : ''}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

// ---------------------------------------------------------------- Add Product: minimum-quantity tiers
//
// The supplier types only "from this quantity, this price". Saved as ranges:
// each tier runs up to one below the next tier's minimum; the last is open.

export const blankSimpleTier = () => ({ min_quantity: '', unit_price: '' })

const filledSimple = (tiers = []) => tiers.filter((tier) => String(tier.min_quantity).trim() !== '' || String(tier.unit_price).trim() !== '')

/** Tiers in quantity order, as numbers. */
export const sortedSimpleTiers = (tiers = []) => filledSimple(tiers)
  .map((tier) => ({ min_quantity: Number(tier.min_quantity), unit_price: Number(tier.unit_price) }))
  .sort((a, b) => a.min_quantity - b.min_quantity)

/** The API's tiers: 10+ and 20+ become 10-19 and 20 and above. */
export const simpleTiersForApi = (tiers = []) => {
  const sorted = sortedSimpleTiers(tiers)
  return sorted.map((tier, index) => ({
    min_quantity: tier.min_quantity,
    max_quantity: index < sorted.length - 1 ? sorted[index + 1].min_quantity - 1 : null,
    unit_price: tier.unit_price,
  }))
}

/** The first problem in the tiers, or ''. normalPrice: the listing's selling price. */
export function simpleTierProblem(tiers = [], normalPrice = null) {
  const rows = filledSimple(tiers)
  if (!rows.length) return 'Add at least one pricing tier, or turn bulk pricing off.'
  for (const [index, tier] of rows.entries()) {
    const minimum = Number(tier.min_quantity)
    const price = Number(tier.unit_price)
    const n = index + 1
    if (String(tier.min_quantity).trim() === '' || !Number.isFinite(minimum) || minimum <= 1) return `Tier ${n}: minimum quantity must be greater than 1.`
    if (String(tier.unit_price).trim() === '' || !Number.isFinite(price) || price <= 0) return `Tier ${n}: bulk price must be greater than 0.`
    if (normalPrice != null && Number.isFinite(normalPrice) && normalPrice > 0 && price >= normalPrice) return `Tier ${n}: bulk price must be lower than your selling price.`
  }
  const sorted = sortedSimpleTiers(tiers)
  for (let i = 1; i < sorted.length; i += 1) {
    if (sorted[i].min_quantity === sorted[i - 1].min_quantity) return `Two tiers start at ${sorted[i].min_quantity}. Each tier needs its own minimum quantity.`
    if (sorted[i].unit_price > sorted[i - 1].unit_price) return `The ${sorted[i].min_quantity}+ price should not be higher than the ${sorted[i - 1].min_quantity}+ price.`
  }
  return ''
}

export function BulkTierBuilder({ enabled, onToggle, tiers, onChange, unit = '', normalPrice = null, country }) {
  const set = (index, key) => (event) => onChange(tiers.map((tier, i) => (i === index ? { ...tier, [key]: event.target.value } : tier)))
  const problem = enabled ? simpleTierProblem(tiers, normalPrice) : ''
  const preview = sortedSimpleTiers(tiers).filter((tier) => tier.min_quantity > 1 && tier.unit_price > 0)
  const per = unit ? ` / ${unit}` : ''
  return (
    <div className="space-y-3">
      <label className="flex w-fit cursor-pointer items-center gap-2.5">
        <input type="checkbox" checked={enabled} onChange={(event) => onToggle(event.target.checked)} className="h-4 w-4 rounded border-slate-300 accent-brand-600" aria-label="Offer bulk pricing" />
        <span className="text-sm font-extrabold text-graphite">Offer bulk pricing</span>
      </label>
      {!enabled ? (
        <p className="text-xs text-graphite/55">Every quantity sells at your normal selling price.</p>
      ) : (
        <>
          <div className="space-y-2">
            <div className="hidden grid-cols-[1fr_1fr_auto] gap-2 text-[10px] font-extrabold uppercase tracking-wide text-graphite/50 sm:grid">
              <span>Minimum quantity</span><span>Price / {unit || 'unit'}</span><span className="w-9" />
            </div>
            {tiers.map((tier, index) => (
              <div key={index} className="grid grid-cols-1 gap-2 rounded-xl border border-slate-200 bg-white p-2 sm:grid-cols-[1fr_1fr_auto] sm:border-0 sm:bg-transparent sm:p-0">
                <label className="block">
                  <span className="text-[10px] font-extrabold uppercase tracking-wide text-graphite/50 sm:hidden">Minimum quantity</span>
                  <div className="relative">
                    <input type="number" min="2" step="1" inputMode="numeric" value={tier.min_quantity} onChange={set(index, 'min_quantity')} placeholder="10" aria-label={`Tier ${index + 1} minimum quantity`} className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 pr-12 text-sm font-semibold text-graphite outline-none focus:border-brand-500" />
                    <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-graphite/40">+{unit ? ` ${unit}` : ''}</span>
                  </div>
                </label>
                <label className="block">
                  <span className="text-[10px] font-extrabold uppercase tracking-wide text-graphite/50 sm:hidden">Price / {unit || 'unit'}</span>
                  <div className="relative">
                    <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm font-extrabold text-graphite/45">₹</span>
                    <input type="number" min="0" step="0.01" inputMode="decimal" value={tier.unit_price} onChange={set(index, 'unit_price')} placeholder="250" aria-label={`Tier ${index + 1} price per unit`} className="h-10 w-full rounded-lg border border-slate-200 bg-white pl-7 pr-3 text-sm font-semibold text-graphite outline-none focus:border-brand-500" />
                  </div>
                </label>
                <button type="button" onClick={() => onChange(tiers.length > 1 ? tiers.filter((_, i) => i !== index) : [blankSimpleTier()])} aria-label={`Remove tier ${index + 1}`} className="grid h-10 w-full place-items-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600 sm:w-9">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
            <button type="button" onClick={() => onChange([...tiers, blankSimpleTier()])} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-dashed border-brand-300 px-3 text-xs font-extrabold text-brand-800 hover:bg-brand-50">
              <Plus className="h-3.5 w-3.5" /> Add pricing tier
            </button>
          </div>
          {problem && <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700">{problem}</p>}
          {/* What buyers will see */}
          <div aria-label="Bulk pricing preview" className="rounded-xl border border-brand-100 bg-brand-50/60 px-3 py-2.5">
            <p className="text-[10px] font-extrabold uppercase tracking-wide text-brand-800">Buyers will see</p>
            <p className="mt-1 text-sm font-semibold text-graphite">
              Normal price: <span className="font-extrabold">{normalPrice != null && normalPrice > 0 ? `${formatMoney(normalPrice, country)}${per}` : '—'}</span>
            </p>
            {preview.length > 0 ? (
              <ul className="mt-1 space-y-0.5">
                {preview.map((tier) => (
                  <li key={tier.min_quantity} className="text-sm font-semibold text-graphite">
                    {tier.min_quantity}+{unit ? ` ${unit}` : ''} → <span className="font-extrabold text-brand-800">{formatMoney(tier.unit_price, country)}{per}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-xs text-graphite/50">Add a minimum quantity and a price to see the tiers here.</p>
            )}
          </div>
        </>
      )}
    </div>
  )
}
