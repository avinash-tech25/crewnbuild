import { Fragment, useEffect, useState } from 'react'
import { AlertTriangle, Archive, ArchiveRestore, CreditCard, History, Package, PackagePlus, Pencil, Search } from 'lucide-react'
import { imageUrl } from '../../../shared/api/apiClient.js'
import EmptyState from '../../../shared/dashboard/EmptyState.jsx'
import QuantityField from '../../shop/components/QuantityField.jsx'
import { useLanguage } from '../../../i18n/LanguageContext.jsx'
import { createStoreItem, fetchStoreBuyProducts, fetchStoreMovements, updateStoreItem, updateStoreStock } from '../storeManagerApi.js'
import { formatDateTime } from '../../../shared/utils/formatters.js'
import { isCountUnit } from '../../../shared/utils/quantityUnits.js'
import { formatQty, money } from '../../site-work/components/EngineerAnalyticsSection.jsx'
import { MOVEMENT_KEYS, STOCK_STATE_KEYS, STORE_CATEGORIES, buyQuantityProblem, matchesSearch, supplierAvailable, validAmount, validQuantity } from '../storeHelpers.js'
import { useStorePurchaseCheckout } from './StorePurchaseCheckout.jsx'
import { Notice, Panel, inputClass, labelClass, primaryButton, refusalText, secondaryButton } from './StoreUi.jsx'

// No opening stock: a product added here starts empty, and stock only ever enters
// by receiving a paid supplier purchase.
const EMPTY_FORM = { name: '', category: STORE_CATEGORIES[0], brand: '', variant: '', unit: '', unit_cost: '0', low_stock_threshold: '0' }
const STATE_TONES = { IN_STOCK: 'bg-emerald-50 text-emerald-700', LOW_STOCK: 'bg-amber-50 text-amber-700', OUT_OF_STOCK: 'bg-rose-50 text-rose-700' }

function ItemForm({ item, onDone, onCancel, guard }) {
  const { t, td } = useLanguage()
  const [form, setForm] = useState(item ? { ...item, brand: item.brand || '', variant: item.variant || '', unit_cost: String(item.unit_cost), low_stock_threshold: String(item.low_stock_threshold) } : EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState(null)
  const update = (field) => (event) => setForm((current) => ({ ...current, [field]: event.target.value }))
  const categories = STORE_CATEGORIES.includes(form.category) ? STORE_CATEGORIES : [...STORE_CATEGORIES, form.category]

  const submit = async (event) => {
    event.preventDefault()
    if (guard()) return
    const numbersValid = (form.unit_cost === '0' || validAmount(form.unit_cost)) && validQuantity(form.low_stock_threshold, { allowZero: true })
    if (form.name.trim().length < 2 || !form.unit.trim() || !numbersValid) {
      setNotice({ text: t('store.catalog.formInvalid'), error: true })
      return
    }
    const details = {
      name: form.name.trim(), category: form.category, brand: form.brand.trim() || null, variant: form.variant.trim() || null, unit: form.unit.trim(),
      unit_cost: form.unit_cost, low_stock_threshold: form.low_stock_threshold,
    }
    setSaving(true)
    try {
      if (item) await updateStoreItem(item.id, details)
      else await createStoreItem(details)
      onDone(t(item ? 'store.catalog.updated' : 'store.catalog.added'))
    } catch (error) {
      setNotice({ text: refusalText(error, td, t('store.saveFailed')), error: true })
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-xl border border-slate-200 bg-slate-50/60 p-3">
      <Notice message={notice} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <label className="block"><span className={labelClass}>{t('store.catalog.name')}</span><input className={`mt-1 ${inputClass}`} value={form.name} onChange={update('name')} maxLength={160} /></label>
        <label className="block">
          <span className={labelClass}>{t('store.catalog.category')}</span>
          <select className={`mt-1 ${inputClass}`} value={form.category} onChange={update('category')}>
            {categories.map((category) => <option key={category} value={category}>{td(category)}</option>)}
          </select>
        </label>
        <label className="block"><span className={labelClass}>{t('store.catalog.brand')}</span><input className={`mt-1 ${inputClass}`} value={form.brand} onChange={update('brand')} maxLength={120} /></label>
        <label className="block"><span className={labelClass}>{t('store.catalog.variant')}</span><input className={`mt-1 ${inputClass}`} value={form.variant} onChange={update('variant')} maxLength={120} placeholder={t('store.catalog.variantPlaceholder')} /></label>
        <label className="block"><span className={labelClass}>{t('store.catalog.unit')}</span><input className={`mt-1 ${inputClass}`} value={form.unit} onChange={update('unit')} maxLength={40} placeholder={t('store.catalog.unitPlaceholder')} /></label>
        <label className="block"><span className={labelClass}>{t('store.catalog.unitCost')}</span><input className={`mt-1 ${inputClass}`} inputMode="decimal" value={form.unit_cost} onChange={update('unit_cost')} /></label>
        <label className="block"><span className={labelClass}>{t('store.catalog.threshold')}</span><input className={`mt-1 ${inputClass}`} inputMode="decimal" value={form.low_stock_threshold} onChange={update('low_stock_threshold')} /></label>
      </div>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className={secondaryButton}>{t('store.cancel')}</button>
        <button type="submit" disabled={saving} className={primaryButton}>{saving ? t('dash.common.saving') : t('store.save')}</button>
      </div>
    </form>
  )
}

// A manual correction, which can only lower stock: damaged, lost or used stock
// removed, or a lower physical count. Never a purchase.
function ReduceStockForm({ item, onDone, onCancel, guard }) {
  const { t, td } = useLanguage()
  const [mode, setMode] = useState('REMOVE')
  const [quantity, setQuantity] = useState('')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState(null)

  const submit = async (event) => {
    event.preventDefault()
    if (guard()) return
    if (!validQuantity(quantity, { allowZero: mode === 'SET' })) {
      setNotice({ text: t('store.quantityInvalid'), error: true })
      return
    }
    if (mode === 'SET' && Number(quantity) > Number(item.quantity)) {
      setNotice({ text: t('store.replenish.countOnlyLower', { quantity: formatQty(item.quantity), unit: td(item.unit) }), error: true })
      return
    }
    setSaving(true)
    try {
      await updateStoreStock(item.id, { mode, quantity, note: note.trim() || null })
      onDone(t('store.catalog.stockUpdated'))
    } catch (error) {
      setNotice({ text: refusalText(error, td, t('store.saveFailed')), error: true })
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit} className="mt-2 space-y-2 rounded-xl border border-slate-200 bg-slate-50/60 p-3">
      <Notice message={notice} />
      <p className="text-[11px] font-semibold text-graphite/60">{t('store.replenish.reduceSub')}</p>
      <div className="grid gap-2 sm:grid-cols-3">
        <select className={inputClass} aria-label={t('store.replenish.reduceStock')} value={mode} onChange={(event) => setMode(event.target.value)}>
          <option value="REMOVE">{t('store.catalog.modeRemove')}</option>
          <option value="SET">{t('store.catalog.modeSet')}</option>
        </select>
        <input className={inputClass} inputMode="decimal" aria-label={t('store.quantity')} placeholder={t('store.quantity')} value={quantity} onChange={(event) => setQuantity(event.target.value)} />
        <input className={inputClass} aria-label={t('store.note')} placeholder={t('store.note')} value={note} maxLength={500} onChange={(event) => setNote(event.target.value)} />
      </div>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className={secondaryButton}>{t('store.cancel')}</button>
        <button type="submit" disabled={saving} className={primaryButton}>{saving ? t('dash.common.saving') : t('store.save')}</button>
      </div>
    </form>
  )
}

// Purchase from Supplier: the builder's suppliers selling this exact product, size
// and unit, each with what it can supply now. The order goes through the existing
// checkout; the supplier receives it only once the payment is verified, and the
// stock rises only when the goods are marked received (Buy -> Your purchases).
function ReplenishPanel({ item, projects, country, guard, onChanged }) {
  const { t, td } = useLanguage()
  const [projectId, setProjectId] = useState(projects[0] ? String(projects[0].id) : '')
  const [offers, setOffers] = useState(null)
  const [failed, setFailed] = useState(false)
  const [offerId, setOfferId] = useState(null)
  const [quantity, setQuantity] = useState('')
  const [notice, setNotice] = useState(null)
  const [paying, setPaying] = useState(false)
  const checkout = useStorePurchaseCheckout({ country, notify: setNotice, onChanged })

  const load = () => {
    if (!projectId) return Promise.resolve(null)
    setFailed(false)
    return fetchStoreBuyProducts(projectId, item.id)
      .then((data) => {
        const list = data.products || []
        setOffers(list)
        setOfferId((current) => (list.some((offer) => offer.id === current) ? current : (list.find((offer) => supplierAvailable(offer) > 0) || list[0])?.id ?? null))
        return list
      })
      .catch(() => { setOffers([]); setFailed(true); return null })
  }
  useEffect(() => { load() }, [projectId, item.id])

  const offer = offers?.find((row) => row.id === offerId) || null
  const available = offer ? supplierAvailable(offer) : 0
  const typed = String(quantity || '').trim()
  const problem = offer && typed ? buyQuantityProblem(typed, available, offer.unit) : ''
  const most = offer ? (isCountUnit(offer.unit) ? Math.floor(available) : available) : 0
  const problemText = (kind) => ({
    none: t('store.buy.noSupplierStock'),
    exceeds: t('store.buy.insufficientSupplierStock', { quantity: formatQty(available), unit: td(offer.unit) }),
    whole: t('store.quantityWhole', { unit: td(offer.unit) }),
    invalid: t('store.quantityInvalid'),
  }[kind] || '')

  const pay = async () => {
    if (guard() || !offer || !typed || problem) return
    setPaying(true)
    setNotice(null)
    try {
      // The supplier's stock read again just before paying: another Buy may have taken some.
      const latest = await load()
      const fresh = latest?.find((row) => row.id === offer.id)
      const freshProblem = fresh ? buyQuantityProblem(typed, supplierAvailable(fresh), fresh.unit) : 'none'
      if (freshProblem) {
        setNotice({ text: `${freshProblem === 'none' ? t('store.buy.noSupplierStock') : t('store.buy.insufficientSupplierStock', { quantity: formatQty(fresh ? supplierAvailable(fresh) : 0), unit: td(offer.unit) })} ${t('store.buy.stockUpdated')}`, error: true })
        return
      }
      await checkout.start(
        { project_id: projectId, supplier_id: offer.supplier_id, items: [{ product_id: offer.id, quantity: typed }] },
        {
          onPaid: (result) => {
            const order = result.payment
            setQuantity('')
            setNotice({
              text: `${t('store.replenish.paid', { reference: order.reference_code, amount: money(order.amount, country), supplier: td(order.supplier_name) })}${result.stock_warning ? ` ${td(result.stock_warning)} ${t('store.buy.stockWarningTail')}` : ''}`,
              error: Boolean(result.stock_warning),
            })
            load()
            onChanged()
          },
        },
      )
    } catch (error) {
      const detail = error?.response?.data?.detail
      if (detail?.code === 'INSUFFICIENT_SUPPLIER_STOCK' && detail.product_id != null) {
        setOffers((current) => current?.map((row) => (row.id === detail.product_id ? { ...row, available_quantity: detail.available } : row)))
      }
      setNotice({ text: refusalText(error, td, t('store.saveFailed')), error: true })
    } finally {
      setPaying(false)
    }
  }

  return (
    <div className="mt-2 space-y-3 rounded-xl border border-slate-200 bg-slate-50/60 p-3">
      <Notice message={notice} onClose={() => setNotice(null)} />
      <p className="text-[11px] font-semibold text-graphite/60">{t('store.replenish.sub')}</p>
      {!projects.length ? (
        <p className="text-xs font-bold text-amber-800">{t('store.buy.noProjectsSub')}</p>
      ) : (
        <>
          <div className="grid gap-2 sm:grid-cols-3">
            <label className="block">
              <span className={labelClass}>{t('store.buy.project')}</span>
              <select className={`mt-1 ${inputClass}`} value={projectId} onChange={(event) => { setProjectId(event.target.value); setOffers(null) }}>
                {projects.map((project) => <option key={project.id} value={project.id}>{td(project.title)}</option>)}
              </select>
            </label>
            <div className="rounded-lg bg-white p-2 text-xs">
              <span className={labelClass}>{t('store.replenish.storeStock')}</span>
              <span className="mt-1 block font-extrabold text-graphite">{formatQty(item.quantity)} {td(item.unit)}</span>
            </div>
            <div className="rounded-lg bg-white p-2 text-xs">
              <span className={labelClass}>{t('store.catalog.variant')}</span>
              <span className="mt-1 block font-extrabold text-graphite">{item.variant ? td(item.variant) : '—'} · {td(item.unit)}</span>
            </div>
          </div>
          {offers === null ? (
            <p className="text-xs font-semibold text-graphite/55">{t('store.loading')}</p>
          ) : !offers.length ? (
            <p role="alert" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800">
              {failed ? t('store.saveFailed') : t('store.replenish.noSupplier', { name: td(item.name), variant: item.variant ? ` ${td(item.variant)}` : '', unit: td(item.unit) })}
            </p>
          ) : (
            <>
              <div role="radiogroup" aria-label={t('store.replenish.chooseSupplier')} className="grid gap-2 sm:grid-cols-2">
                {offers.map((row) => {
                  const left = supplierAvailable(row)
                  const chosen = row.id === offerId
                  return (
                    <button
                      key={row.id}
                      type="button"
                      role="radio"
                      aria-checked={chosen}
                      disabled={left <= 0}
                      onClick={() => setOfferId(row.id)}
                      className={`rounded-lg border bg-white p-2.5 text-start text-xs transition disabled:cursor-not-allowed disabled:opacity-60 ${chosen ? 'border-brand-500 ring-2 ring-brand-100' : 'border-slate-200 hover:border-brand-300'}`}
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span className="truncate font-extrabold text-graphite">{td(row.store_name || row.supplier_name)}</span>
                        {left <= 0 && <span className="shrink-0 rounded-md bg-rose-600 px-1.5 py-0.5 text-[10px] font-extrabold uppercase text-white">{t('store.buy.outOfStock')}</span>}
                      </span>
                      <span className="block font-semibold text-graphite/60">{td(row.name)}{row.size ? ` · ${t('store.buy.sizeLabel', { size: td(row.size) })}` : ''}</span>
                      <span className="block font-extrabold text-graphite">{t('store.buy.pricePer', { price: money(row.price, country), unit: td(row.unit) })}</span>
                      <span className={`block font-bold ${left > 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                        {left > 0 ? t('store.buy.supplierAvailable', { quantity: formatQty(left), unit: td(row.unit) }) : t('store.buy.noSupplierStock')}
                      </span>
                    </button>
                  )
                })}
              </div>
              {offer && available > 0 && (
                <div className="space-y-2">
                  <span className={labelClass}>{t('store.buy.quantityToBuy', { unit: td(offer.unit) })}</span>
                  <div className="flex flex-wrap items-center gap-2">
                    <QuantityField value={quantity} unit={offer.unit} label={`${t('store.replenish.quantityLabel')} ${td(item.name)}`} onChange={setQuantity} />
                    <span className="text-xs font-bold text-graphite/60">{t('store.buy.maxAvailable', { quantity: formatQty(most), unit: td(offer.unit) })}</span>
                  </div>
                  {problem && (
                    <p role="alert" className="flex items-start gap-1.5 text-xs font-extrabold text-rose-700">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      <span>
                        {problemText(problem)}
                        {problem === 'exceeds' && most > 0 && <button type="button" onClick={() => setQuantity(String(most))} className="ms-1 underline">{t('store.buy.useMaximum', { quantity: formatQty(most), unit: td(offer.unit) })}</button>}
                      </span>
                    </p>
                  )}
                  <dl className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
                    <div className="rounded-lg bg-white p-2"><dt className={labelClass}>{t('store.col.unitPrice')}</dt><dd className="font-extrabold text-graphite">{t('store.buy.pricePer', { price: money(offer.price, country), unit: td(offer.unit) })}</dd></div>
                    <div className="rounded-lg bg-white p-2"><dt className={labelClass}>{t('store.replenish.total')}</dt><dd className="font-extrabold text-graphite">{typed && !problem ? money(Number(typed) * Number(offer.price || 0), country) : '—'}</dd></div>
                    <div className="rounded-lg bg-white p-2"><dt className={labelClass}>{t('store.replenish.afterReceipt')}</dt><dd className="font-extrabold text-graphite">{typed && !problem ? `${formatQty(Number(item.quantity) + Number(typed))} ${td(item.unit)}` : '—'}</dd></div>
                  </dl>
                  <p className="text-[11px] font-semibold text-graphite/55">{t('store.replenish.stockNote')}</p>
                  <div className="flex justify-end">
                    <button type="button" onClick={pay} disabled={paying || !typed || Boolean(problem)} className={primaryButton}>
                      <CreditCard className="h-3.5 w-3.5" />{paying ? t('dash.common.saving') : t('store.replenish.continue')}
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </>
      )}
      {checkout.dialog}
    </div>
  )
}

// Update stock: buying more from a supplier (paid, then received), or lowering it by hand.
function UpdateStockPanel({ item, projects, country, guard, onDone, onCancel, onChanged }) {
  const { t } = useLanguage()
  const [view, setView] = useState('purchase')
  return (
    <div className="mt-2">
      <div role="tablist" className="flex flex-wrap gap-1.5">
        {[['purchase', 'store.replenish.purchase'], ['reduce', 'store.replenish.reduceStock']].map(([id, key]) => (
          <button key={id} type="button" role="tab" aria-selected={view === id} onClick={() => setView(id)}
            className={`h-8 rounded-full px-3 text-xs font-extrabold transition ${view === id ? 'bg-brand-700 text-white' : 'bg-slate-100 text-graphite/60 hover:bg-slate-200'}`}>
            {t(key)}
          </button>
        ))}
      </div>
      {view === 'purchase'
        ? <ReplenishPanel item={item} projects={projects} country={country} guard={guard} onChanged={onChanged} />
        : <ReduceStockForm item={item} guard={guard} onDone={onDone} onCancel={onCancel} />}
    </div>
  )
}

function MovementList({ item }) {
  const { t, td } = useLanguage()
  const [rows, setRows] = useState(null)
  useEffect(() => {
    fetchStoreMovements(item.id).then(setRows).catch(() => setRows([]))
  }, [item.id, item.quantity])
  if (rows === null) return <p className="mt-2 text-xs font-semibold text-graphite/55">{t('store.loading')}</p>
  if (!rows.length) return <p className="mt-2 text-xs font-semibold text-graphite/55">{t('store.catalog.noMovements')}</p>
  return (
    <ul className="mt-2 divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white px-3">
      {rows.map((row) => (
        <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-xs">
          <span className="font-bold text-graphite">{t(MOVEMENT_KEYS[row.reason])}{row.reference ? ` · ${row.reference}` : ''}{row.note ? ` · ${td(row.note)}` : ''}</span>
          <span className="font-semibold text-graphite/55">
            <span className={row.change < 0 ? 'text-rose-700' : 'text-emerald-700'}>{row.change > 0 ? '+' : ''}{formatQty(row.change)}</span>
            {' → '}{formatQty(row.balance_after)} {td(item.unit)} · {formatDateTime(row.created_at)}
          </span>
        </li>
      ))}
    </ul>
  )
}

export default function StoreCatalogSection({ items, projects = [], searchQuery, country, guard, onChanged }) {
  const { t, td } = useLanguage()
  const [panel, setPanel] = useState(null) // { kind: 'new' | 'edit' | 'stock' | 'history', id }
  const [notice, setNotice] = useState(null)
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('')
  // Only what the store holds: products received from suppliers or added here.
  const categories = [...new Set(items.map((item) => item.category).filter(Boolean))].sort()
  const visible = items.filter((item) => (!category || item.category === category) && matchesSearch(item, searchQuery) && matchesSearch(item, search))
  const finished = (text) => { setPanel(null); setNotice({ text }); onChanged() }
  const toggle = (kind, id) => setPanel((current) => (current?.kind === kind && current.id === id ? null : { kind, id }))

  const setArchived = async (item, archived) => {
    if (guard()) return
    try {
      await updateStoreItem(item.id, { is_active: !archived })
      finished(t(archived ? 'store.catalog.archived' : 'store.catalog.restored'))
    } catch (error) {
      setNotice({ text: refusalText(error, td, t('store.saveFailed')), error: true })
    }
  }

  return (
    <div className="space-y-3">
      <Notice message={notice} onClose={() => setNotice(null)} />
      <Panel
        title={t('store.nav.catalog')}
        action={<button type="button" onClick={() => toggle('new')} className={primaryButton}><PackagePlus className="h-4 w-4" />{t('store.catalog.add')}</button>}
      >
        {panel?.kind === 'new' && <div className="mb-3"><ItemForm guard={guard} onDone={finished} onCancel={() => setPanel(null)} /></div>}
        {/* Search and categories, as on the product catalog. */}
        <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto">
            {['', ...categories].map((value) => (
              <button key={value || 'all'} type="button" aria-pressed={category === value} onClick={() => setCategory(value)}
                className={`h-8 shrink-0 rounded-full px-3 text-xs font-extrabold transition ${category === value ? 'bg-brand-700 text-white' : 'bg-slate-100 text-graphite/60 hover:bg-slate-200'}`}>
                {value ? td(value) : t('store.engineer.allCategories')}
              </button>
            ))}
          </div>
          <div className="relative sm:w-64">
            <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input type="search" className={`${inputClass} ps-9`} aria-label={t('store.catalog.search')} placeholder={t('store.catalog.search')} value={search} onChange={(event) => setSearch(event.target.value)} />
          </div>
        </div>
        {visible.length ? (
          // The product catalog's card: picture, brand, name, category and size, then
          // the store's own figures and the Store Manager's actions.
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
            {visible.map((item) => (
              <Fragment key={item.id}>
                <li className={`group flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-md ${item.is_active ? '' : 'opacity-60'}`}>
                  <div className="relative grid aspect-square place-items-center bg-slate-50">
                    {/* The picture of the supplier product received into this item. */}
                    {item.image_url
                      ? <img src={imageUrl(item.image_url)} alt={td(item.name)} loading="lazy" className="h-full w-full object-contain p-2 transition duration-300 group-hover:scale-[1.03]" />
                      : <span className="grid h-full w-full place-items-center text-slate-300"><Package className="h-8 w-8" /></span>}
                    <span className={`absolute start-2 top-2 rounded-md px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide ${STATE_TONES[item.stock_state]}`}>{t(STOCK_STATE_KEYS[item.stock_state])}</span>
                    {!item.is_active && <span className="absolute end-2 top-2 rounded-md bg-slate-700 px-2 py-0.5 text-[10px] font-extrabold uppercase text-white">{t('store.catalog.archivedBadge')}</span>}
                  </div>
                  <div className="flex flex-1 flex-col gap-1 p-2.5">
                    <span className="truncate text-[10px] font-extrabold uppercase tracking-wide text-brand-700">{item.brand ? td(item.brand) : t('store.catalog.noBrand')}</span>
                    <span className="line-clamp-2 text-xs font-extrabold leading-snug text-graphite" title={td(item.name)}>{td(item.name)}</span>
                    <span className="truncate text-[11px] font-semibold text-graphite/50">{[item.category, item.subcategory, item.variant].filter(Boolean).map((value) => td(value)).join(' · ')}</span>
                    {item.description && <span className="line-clamp-2 text-[11px] font-medium text-graphite/55">{td(item.description)}</span>}
                    <span className="mt-auto pt-1 text-sm font-extrabold text-graphite">{formatQty(item.quantity)} {td(item.unit)}</span>
                    <span className="text-[11px] font-semibold text-graphite/55">{t('store.catalog.perUnit', { price: money(item.unit_cost, country), unit: td(item.unit) })}</span>
                    <div className="flex flex-wrap gap-1 pt-1.5">
                      <button type="button" onClick={() => toggle('stock', item.id)} aria-expanded={panel?.id === item.id && panel.kind === 'stock'} className={`${secondaryButton} !h-8 flex-1 !px-2`}>{t('store.catalog.updateStock')}</button>
                      <button type="button" onClick={() => toggle('edit', item.id)} aria-label={t('store.edit')} title={t('store.edit')} className={`${secondaryButton} !h-8 !px-2`}><Pencil className="h-3.5 w-3.5" /></button>
                      <button type="button" onClick={() => toggle('history', item.id)} aria-label={t('store.catalog.history')} title={t('store.catalog.history')} className={`${secondaryButton} !h-8 !px-2`}><History className="h-3.5 w-3.5" /></button>
                      <button type="button" onClick={() => setArchived(item, item.is_active)} aria-label={t(item.is_active ? 'store.catalog.archive' : 'store.catalog.restore')} title={t(item.is_active ? 'store.catalog.archive' : 'store.catalog.restore')} className={`${secondaryButton} !h-8 !px-2`}>
                        {item.is_active ? <Archive className="h-3.5 w-3.5" /> : <ArchiveRestore className="h-3.5 w-3.5" />}
                      </button>
                    </div>
                  </div>
                </li>
                {/* The chosen action opens full width under its card's row. */}
                {panel?.id === item.id && (
                  <li className="col-span-full rounded-2xl border border-brand-200 bg-white p-3">
                    <p className="text-xs font-extrabold text-graphite">{td(item.name)}{item.variant ? ` · ${td(item.variant)}` : ''}</p>
                    {panel.kind === 'stock' && <UpdateStockPanel item={item} projects={projects} country={country} guard={guard} onDone={finished} onCancel={() => setPanel(null)} onChanged={onChanged} />}
                    {panel.kind === 'edit' && <div className="mt-2"><ItemForm item={item} guard={guard} onDone={finished} onCancel={() => setPanel(null)} /></div>}
                    {panel.kind === 'history' && <MovementList item={item} />}
                  </li>
                )}
              </Fragment>
            ))}
          </ul>
        ) : (
          <EmptyState icon={PackagePlus} title={t('store.catalog.none')} message={t('store.catalog.noneSub')} />
        )}
      </Panel>
    </div>
  )
}
