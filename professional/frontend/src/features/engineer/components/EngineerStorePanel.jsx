/**
 * A Site Engineer's requests to the Store Manager on their builder's team: browse
 * that store's products for one assigned project, choose a product's size or
 * variant, put it in a cart and send the cart as one request. Reached from the
 * Suppliers hub; the stores come from the hub. What happens to a request is
 * followed under Store Requests (EngineerStoreRequestsSection).
 *
 * This is the only way a Site Engineer asks for material: the request goes to the
 * Store Manager, who buys any shortage from the builder's suppliers. The Material
 * Suppliers screens are for browsing; a Site Engineer cannot buy from them. The
 * cart here is the store's own and never reaches the supplier cart.
 *
 * The store lists only what its Store Manager has received: goods a supplier has
 * accepted are not stock until then, and the panel says so.
 */
import { useEffect, useState } from 'react'
import { ClipboardList, Package, Search, ShoppingCart, Trash2, Truck, X } from 'lucide-react'
import EmptyState from '../../../shared/dashboard/EmptyState.jsx'
import QuantityField from '../../shop/components/QuantityField.jsx'
import { useLiveRefresh } from '../../../shared/hooks/useLiveRefresh.js'
import { useProfileGate } from '../../../shared/hooks/useProfileGate.js'
import { useLanguage } from '../../../i18n/LanguageContext.jsx'
import { imageUrl } from '../../../shared/api/apiClient.js'
import { createSiteRequest } from '../../store/storeManagerApi.js'
import { quantityProblem } from '../../../shared/utils/quantityUnits.js'
import { STOCK_STATE_KEYS, matchesSearch } from '../../store/storeHelpers.js'
import { Notice, Panel, inputClass, labelClass, primaryButton, refusalText, secondaryButton } from '../../store/components/StoreUi.jsx'
import { formatQty } from '../../site-work/components/EngineerAnalyticsSection.jsx'

// The cart survives a reload or a visit to another tab, per project and store, in
// this browser only. It is a convenience: the request itself is what the server saves.
const cartKey = (projectId, storeId) => `crewbuild.storeCart.${projectId}.${storeId}`
const readCart = (key) => {
  try {
    const saved = JSON.parse(window.sessionStorage.getItem(key) || '{}')
    return saved && typeof saved === 'object' ? saved : {}
  } catch {
    return {}
  }
}
const writeCart = (key, cart) => {
  try {
    if (Object.keys(cart).length) window.sessionStorage.setItem(key, JSON.stringify(cart))
    else window.sessionStorage.removeItem(key)
  } catch {
    /* storage blocked: the cart still works until the page closes */
  }
}

const STATE_TONES = { IN_STOCK: 'text-emerald-700', LOW_STOCK: 'text-amber-700', OUT_OF_STOCK: 'text-rose-700' }

// One product as the engineer picks it: a name and brand, kept in one or more
// sizes or variants, each a store item with its own stock.
const productKey = (item) => [item.name, item.brand || '', item.category || ''].map((value) => String(value).trim().toLowerCase()).join('|')
const groupProducts = (items) => {
  const groups = new Map()
  items.forEach((item) => {
    const key = productKey(item)
    if (!groups.has(key)) groups.set(key, { key, items: [] })
    groups.get(key).items.push(item)
  })
  return [...groups.values()]
}

function ProductImage({ item, large = false }) {
  const size = large ? 'h-40 w-full rounded-xl' : 'h-14 w-14 shrink-0 rounded-lg'
  return item?.image_url
    ? <img src={imageUrl(item.image_url)} alt="" loading="lazy" className={`${size} border border-slate-100 bg-slate-50 object-contain p-1`} />
    : <span className={`${size} grid place-items-center bg-slate-50 text-graphite/40`}><Package className={large ? 'h-8 w-8' : 'h-5 w-5'} /></span>
}

/** What the store holds, and, when the quantity asked is more, by how much it falls short. */
function StockLine({ item, quantity }) {
  const { t, td } = useLanguage()
  const asked = quantityProblem(quantity, item.unit) ? 0 : Number(quantity)
  const short = asked - Number(item.quantity)
  return (
    <span className="block text-xs font-semibold text-graphite/60">
      {t('store.requests.available', { quantity: `${formatQty(item.quantity)} ${td(item.unit)}` })}
      {item.stock_state && <span className={`font-extrabold ${STATE_TONES[item.stock_state] || ''}`}> · {t(STOCK_STATE_KEYS[item.stock_state])}</span>}
      {short > 0 && <span className="block font-extrabold text-amber-700">{t('store.engineer.cartShort', { quantity: `${formatQty(short)} ${td(item.unit)}` })}</span>}
    </span>
  )
}

const productTitle = (item, td) => `${td(item.name)}${item.variant ? ` · ${td(item.variant)}` : ''}`

export default function EngineerStorePanel({ projects, stores, activeProjectId, onProjectChange, onStoresChanged }) {
  const { t, td } = useLanguage()
  const { requireCompleteProfile } = useProfileGate()
  const [note, setNote] = useState('')
  const [sending, setSending] = useState(false)
  const [notice, setNotice] = useState(null)
  const [category, setCategory] = useState('')
  const [search, setSearch] = useState('')
  const [view, setView] = useState('products')
  // The product opened in its details window, the variant chosen there and the quantity typed.
  const [openProduct, setOpenProduct] = useState(null)
  const [chosenId, setChosenId] = useState(null)
  const [draft, setDraft] = useState('')
  const [draftError, setDraftError] = useState('')
  const projectStores = stores.filter((store) => store.project_ids.some((id) => String(id) === String(activeProjectId)))
  const [storeId, setStoreId] = useState('')
  const store = projectStores.find((item) => String(item.store_manager_id) === storeId) || projectStores[0]
  const storeItems = store?.items || []
  const categories = [...new Set(storeItems.map((item) => item.category).filter(Boolean))].sort()
  const shownProducts = groupProducts(storeItems.filter((item) => (!category || item.category === category) && matchesSearch(item, search)))
  const chosen = openProduct?.items.find((item) => item.id === chosenId) || null

  // The cart: the quantity typed for each product variant, as typed; it is sent exactly so.
  const key = store ? cartKey(activeProjectId, store.store_manager_id) : ''
  const [cart, setCart] = useState({})
  useEffect(() => { setCart(key ? readCart(key) : {}) }, [key])
  const updateCart = (change) => setCart((current) => {
    const next = change(current)
    if (key) writeCart(key, next)
    return next
  })
  // Only products the store still lists; one it has since archived drops out.
  const cartLines = Object.entries(cart)
    .map(([itemId, quantity]) => ({ item: storeItems.find((item) => String(item.id) === itemId), quantity }))
    .filter((line) => line.item)
  const cartCount = cartLines.length

  // A Store Manager's change (new stock, an issue) reloads the stores' stock.
  useLiveRefresh(() => { onStoresChanged() })

  const openDetails = (product) => {
    // One variant is chosen for the engineer; among several, they choose.
    const only = product.items.length === 1 ? product.items[0] : null
    setOpenProduct(product)
    setChosenId(only ? only.id : null)
    setDraft(only ? cart[only.id] || '' : '')
    setDraftError('')
  }
  const chooseVariant = (item) => {
    setChosenId(item.id)
    setDraft(cart[item.id] || '')
    setDraftError('')
  }
  const quantityMessage = (quantity, unit) => (quantityProblem(quantity, unit) === 'whole' ? t('store.quantityWhole', { unit: td(unit) }) : t('store.quantityInvalid'))
  const addToCart = () => {
    if (!chosen) {
      setDraftError(t('store.engineer.chooseVariant'))
      return
    }
    if (quantityProblem(draft, chosen.unit)) {
      setDraftError(quantityMessage(draft, chosen.unit))
      return
    }
    const name = productTitle(chosen, td)
    updateCart((current) => ({ ...current, [chosen.id]: String(draft).trim() }))
    setOpenProduct(null)
    setNotice({ text: t('store.engineer.addedToCart', { name }) })
  }
  const removeFromCart = (itemId) => updateCart((current) => {
    const next = { ...current }
    delete next[itemId]
    return next
  })

  const send = async () => {
    if (requireCompleteProfile('storeRequest')) return
    const wrong = cartLines.find((line) => quantityProblem(line.quantity, line.item.unit))
    if (!cartLines.length || wrong) {
      setNotice({ text: wrong ? `${productTitle(wrong.item, td)}: ${quantityMessage(wrong.quantity, wrong.item.unit)}` : t('store.quantityInvalid'), error: true })
      return
    }
    setSending(true)
    setNotice(null)
    try {
      // Shown as sent only once the server has saved it and answered with its number.
      const saved = await createSiteRequest({
        project_id: activeProjectId,
        store_manager_id: store.store_manager_id,
        items: cartLines.map((line) => ({ item_id: line.item.id, quantity: String(line.quantity).trim() })),
        note: note.trim() || null,
      })
      updateCart(() => ({}))
      setNote('')
      setView('products')
      setNotice({ text: t('store.engineer.sentNumbered', { id: saved.public_request_id, name: td(saved.store_manager_name) }) })
      onStoresChanged()
    } catch (error) {
      setNotice({ text: refusalText(error, td, t('store.saveFailed')), error: true })
    } finally {
      setSending(false)
    }
  }

  const cartButton = store && storeItems.length > 0 && (
    <button
      type="button"
      onClick={() => setView(view === 'cart' ? 'products' : 'cart')}
      aria-pressed={view === 'cart'}
      className={view === 'cart' ? primaryButton : secondaryButton}
    >
      <ShoppingCart className="h-3.5 w-3.5" />
      {t('store.engineer.cart')}
      <span className={`grid h-5 min-w-5 place-items-center rounded-full px-1.5 text-[10px] font-extrabold ${view === 'cart' ? 'bg-white/20 text-white' : 'bg-brand-100 text-brand-800'}`}>{cartCount}</span>
    </button>
  )

  // Goods a supplier has accepted for this store but the Store Manager has not yet
  // received: said plainly, since they are not stock and cannot be requested yet.
  const awaiting = store?.awaiting_receipt || 0
  const awaitingNote = awaiting > 0 && (
    <div role="note" className="flex items-start gap-2 rounded-xl border border-sky-200 bg-sky-50 px-3 py-2.5 text-xs">
      <Truck className="mt-0.5 h-4 w-4 shrink-0 text-sky-700" />
      <span>
        <span className="block font-extrabold text-sky-900">{t('store.engineer.awaitingTitle', { count: awaiting })}</span>
        <span className="block font-semibold text-sky-800">{t('store.engineer.awaitingSub')}</span>
      </span>
    </div>
  )

  return (
    <div className="space-y-3">
      <Panel title={t('store.engineer.type')} action={cartButton}>
        <div className="space-y-3">
          <Notice message={notice} onClose={() => setNotice(null)} />
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className={labelClass}>{t('store.buy.project')}</span>
              <select className={`mt-1 ${inputClass}`} value={activeProjectId ?? ''} onChange={(event) => { onProjectChange(event.target.value || null); setView('products') }}>
                {projects.map((project) => <option key={project.id} value={project.id}>{td(project.title)}</option>)}
              </select>
            </label>
            {projectStores.length > 1 && (
              <label className="block">
                <span className={labelClass}>{t('store.engineer.store')}</span>
                <select className={`mt-1 ${inputClass}`} value={store ? String(store.store_manager_id) : ''} onChange={(event) => { setStoreId(event.target.value); setView('products') }}>
                  {projectStores.map((item) => <option key={item.store_manager_id} value={item.store_manager_id}>{td(item.store_manager_name)}</option>)}
                </select>
              </label>
            )}
          </div>
          {/* No Store Manager on this project's builder team: say so. A request is
              never sent to a supplier instead. */}
          {!store ? (
            <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-3 text-xs">
              <p className="font-extrabold text-rose-800">{t('store.engineer.noStoreManager')}</p>
              <p className="mt-0.5 font-semibold text-rose-700">{t('store.engineer.noStoreManagerSub')}</p>
            </div>
          ) : !storeItems.length ? (
            <>
              {awaitingNote}
              <EmptyState icon={ClipboardList} title={t('store.engineer.noItems')} message={t('store.engineer.noItemsSub')} />
            </>
          ) : view === 'cart' ? (
            <section aria-label={t('store.engineer.cart')} className="space-y-3">
              <p className="text-xs font-semibold text-graphite/60">{t('store.engineer.cartFor', { name: td(store.store_manager_name) })}</p>
              {cartLines.length ? (
                <>
                  <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 px-3">
                    {cartLines.map(({ item, quantity }) => (
                      <li key={item.id} className="flex flex-wrap items-center gap-3 py-2.5">
                        <ProductImage item={item} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-extrabold text-graphite">{productTitle(item, td)}</span>
                          <span className="block truncate text-[11px] font-semibold text-graphite/55">{[item.brand, item.category].filter(Boolean).map((value) => td(value)).join(' · ')}</span>
                          <StockLine item={item} quantity={quantity} />
                          {!quantityProblem(quantity, item.unit) && (
                            <span className="block text-xs font-extrabold text-graphite">{t('store.engineer.cartRequested', { quantity: `${formatQty(Number(quantity))} ${td(item.unit)}` })}</span>
                          )}
                        </span>
                        <QuantityField
                          value={quantity}
                          unit={item.unit}
                          label={`${t('store.quantity')} ${productTitle(item, td)}`}
                          onChange={(text) => updateCart((current) => ({ ...current, [item.id]: text }))}
                        />
                        <button type="button" onClick={() => removeFromCart(item.id)} aria-label={`${t('store.remove')} ${productTitle(item, td)}`} title={t('store.remove')} className={secondaryButton}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </li>
                    ))}
                  </ul>
                  {/* A request may ask for more than the store holds: the Store Manager
                      buys the rest and hands it over when it arrives. */}
                  <p className="text-[11px] font-semibold text-graphite/55">{t('store.engineer.moreThanStock')}</p>
                  <input className={inputClass} aria-label={t('store.note')} placeholder={t('store.note')} maxLength={500} value={note} onChange={(event) => setNote(event.target.value)} />
                  <div className="flex flex-wrap justify-end gap-2">
                    <button type="button" onClick={() => setView('products')} className={secondaryButton}>{t('store.engineer.continueBrowsing')}</button>
                    <button type="button" onClick={send} disabled={sending} className={primaryButton}>{sending ? t('dash.common.saving') : t('store.engineer.submitCart', { count: cartCount })}</button>
                  </div>
                </>
              ) : (
                <EmptyState icon={ShoppingCart} title={t('store.engineer.cartEmpty')} message={t('store.engineer.cartEmptySub')} />
              )}
            </section>
          ) : (
            <>
              {awaitingNote}
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <div className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto">
                  {['', ...categories].map((value) => (
                    <button
                      key={value || 'all'}
                      type="button"
                      aria-pressed={category === value}
                      onClick={() => setCategory(value)}
                      className={`h-8 shrink-0 rounded-full px-3 text-xs font-extrabold transition ${category === value ? 'bg-brand-700 text-white' : 'bg-slate-100 text-graphite/60 hover:bg-slate-200'}`}
                    >
                      {value ? td(value) : t('store.engineer.allCategories')}
                    </button>
                  ))}
                </div>
                <div className="relative sm:w-56">
                  <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input type="search" className={`${inputClass} ps-9`} aria-label={t('store.searchPlaceholder')} placeholder={t('store.searchPlaceholder')} value={search} onChange={(event) => setSearch(event.target.value)} />
                </div>
              </div>
              {/* The product catalog's card: picture, brand, name, category, then each
                  size the store holds with its stock. The whole card opens the details. */}
              <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
                {shownProducts.map((product) => {
                  const first = product.items[0]
                  const pictured = product.items.find((item) => item.image_url)
                  const described = product.items.find((item) => item.description)
                  const inCart = product.items.filter((item) => cart[item.id])
                  return (
                    <li key={product.key}>
                      <article onClick={() => openDetails(product)} className="group flex h-full cursor-pointer flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-md">
                        <div className="relative grid aspect-square place-items-center bg-slate-50">
                          {pictured
                            ? <img src={imageUrl(pictured.image_url)} alt={td(first.name)} loading="lazy" className="h-full w-full object-contain p-2 transition duration-300 group-hover:scale-[1.03]" />
                            : <span className="grid h-full w-full place-items-center text-slate-300"><Package className="h-8 w-8" /></span>}
                          {inCart.length > 0 && <span className="absolute end-2 top-2 rounded-md bg-brand-700 px-2 py-0.5 text-[10px] font-extrabold uppercase text-white">{t('store.engineer.inCartBadge')}</span>}
                        </div>
                        <div className="flex flex-1 flex-col gap-1 p-2.5">
                          <span className="truncate text-[10px] font-extrabold uppercase tracking-wide text-brand-700">{first.brand ? td(first.brand) : t('store.catalog.noBrand')}</span>
                          <span className="line-clamp-2 text-xs font-extrabold leading-snug text-graphite" title={td(first.name)}>{td(first.name)}</span>
                          <span className="truncate text-[11px] font-semibold text-graphite/50">{[first.category, first.subcategory].filter(Boolean).map((value) => td(value)).join(' · ')}</span>
                          {described && <span className="line-clamp-2 text-[11px] font-medium text-graphite/55">{td(described.description)}</span>}
                          <span className="mt-auto space-y-0.5 pt-1">
                            {product.items.map((item) => (
                              <span key={item.id} className="block text-[11px] font-semibold text-graphite/60">
                                {item.variant && <span className="font-extrabold text-graphite">{td(item.variant)}: </span>}
                                {t('store.requests.available', { quantity: `${formatQty(item.quantity)} ${td(item.unit)}` })}
                                {item.stock_state && <span className={`font-extrabold ${STATE_TONES[item.stock_state] || ''}`}> · {t(STOCK_STATE_KEYS[item.stock_state])}</span>}
                              </span>
                            ))}
                          </span>
                          <button type="button" onClick={(event) => { event.stopPropagation(); openDetails(product) }} aria-label={`${t('store.engineer.addToCart')} ${td(first.name)}`}
                            className="mt-1.5 inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-lg bg-brand-700 px-2 text-[11px] font-extrabold text-white transition hover:bg-brand-800">
                            <ShoppingCart className="h-3.5 w-3.5" />
                            {inCart.length ? t('store.engineer.inCart', { quantity: inCart.map((item) => `${cart[item.id]} ${td(item.unit)}`).join(' + ') }) : t('store.engineer.addToCart')}
                          </button>
                        </div>
                      </article>
                    </li>
                  )
                })}
              </ul>
            </>
          )}
        </div>
      </Panel>

      {openProduct && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/40 p-4" role="dialog" aria-modal="true" aria-label={td(openProduct.items[0].name)}>
          <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-4 shadow-xl">
            <div className="mb-3 flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-base font-extrabold text-graphite">{td(openProduct.items[0].name)}</p>
                <p className="text-[11px] font-semibold text-graphite/55">{[openProduct.items[0].brand, openProduct.items[0].category].filter(Boolean).map((value) => td(value)).join(' · ')}</p>
              </div>
              <button type="button" onClick={() => setOpenProduct(null)} aria-label={t('store.engineer.close')} className={secondaryButton}><X className="h-3.5 w-3.5" /></button>
            </div>
            <ProductImage item={chosen?.image_url ? chosen : openProduct.items.find((item) => item.image_url) || openProduct.items[0]} large />
            {(chosen || openProduct.items[0]).description && <p className="mt-3 whitespace-pre-line text-xs font-medium text-graphite/70">{td((chosen || openProduct.items[0]).description)}</p>}
            <div className="mt-3">
              <span className={labelClass}>{t('store.engineer.variant')}</span>
              <div role="radiogroup" aria-label={t('store.engineer.variant')} className="mt-1 flex flex-wrap gap-1.5">
                {openProduct.items.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    role="radio"
                    aria-checked={chosenId === item.id}
                    onClick={() => chooseVariant(item)}
                    className={`rounded-lg border px-3 py-1.5 text-start text-xs font-extrabold transition ${chosenId === item.id ? 'border-brand-600 bg-brand-50 text-brand-800' : 'border-slate-200 text-graphite/70 hover:bg-slate-50'}`}
                  >
                    {td(item.variant || item.unit)}
                    <span className="block text-[10px] font-semibold text-graphite/55">{formatQty(item.quantity)} {td(item.unit)}</span>
                  </button>
                ))}
              </div>
            </div>
            {chosen && (
              <>
                <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded-lg bg-slate-50 p-2"><dt className={labelClass}>{t('store.catalog.unit')}</dt><dd className="font-extrabold text-graphite">{td(chosen.unit)}</dd></div>
                  <div className="rounded-lg bg-slate-50 p-2"><dt className={labelClass}>{t('store.engineer.inStore')}</dt><dd className="font-extrabold text-graphite">{formatQty(chosen.quantity)} {td(chosen.unit)}</dd></div>
                </dl>
                <div className="mt-3">
                  <span className={labelClass}>{t('store.engineer.quantityToRequest', { unit: td(chosen.unit) })}</span>
                  <div className="mt-1">
                    <QuantityField large value={draft} unit={chosen.unit} label={`${t('store.quantity')} ${productTitle(chosen, td)}`} onChange={(text) => { setDraft(text); setDraftError('') }} />
                  </div>
                  <div className="mt-1"><StockLine item={chosen} quantity={draft} /></div>
                </div>
              </>
            )}
            {draftError && <p role="alert" className="mt-2 text-xs font-extrabold text-rose-700">{draftError}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setOpenProduct(null)} className={secondaryButton}>{t('store.engineer.close')}</button>
              <button type="button" onClick={addToCart} className={primaryButton}>
                <ShoppingCart className="h-3.5 w-3.5" />{chosen && cart[chosen.id] ? t('store.engineer.updateCart') : t('store.engineer.addToCart')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
