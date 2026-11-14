import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { AlertTriangle, CreditCard, History, PackageCheck, ShoppingBag, ShoppingCart, Trash2 } from 'lucide-react'
import EmptyState from '../../../shared/dashboard/EmptyState.jsx'
import StatusPill from '../../../shared/dashboard/StatusPill.jsx'
import QuantityField from '../../shop/components/QuantityField.jsx'
import { useLiveRefresh } from '../../../shared/hooks/useLiveRefresh.js'
import { useLanguage } from '../../../i18n/LanguageContext.jsx'
import { imageUrl } from '../../../shared/api/apiClient.js'
import { fetchStoreBuyProducts, receiveStorePurchaseLine } from '../storeManagerApi.js'
import { formatDateTime } from '../../../shared/utils/formatters.js'
import { isCountUnit } from '../../../shared/utils/quantityUnits.js'
import { STORE_MANAGER_PATH } from '../../../shared/auth/accountPaths.js'
import { formatQty, money } from '../../site-work/components/EngineerAnalyticsSection.jsx'
import { OrderPill, PurchaseDetail, SupplierOrderStatus } from './StorePaymentsSection.jsx'
import { buyQuantityProblem, groupLinesBySupplier, matchesSearch, purchaseRef, supplierAvailable, transactionRef, validQuantity } from '../storeHelpers.js'
import { useStorePurchaseCheckout } from './StorePurchaseCheckout.jsx'
import { DetailModal, Notice, Panel, inputClass, labelClass, primaryButton, refusalText, secondaryButton } from './StoreUi.jsx'

// An order line: the supplier's offer with the quantity being bought. The offer's
// own stock figures are kept apart (`supplier_stock`, `available_quantity`), since
// `quantity` on a line is what is ordered.
const orderLine = (product, quantity) => ({ ...product, supplier_stock: product.supplier_stock ?? product.quantity, quantity: String(quantity) })

// Buying: the products are those of the suppliers the selected project's builder
// has accepted, and each supplier's lines are paid through the existing Razorpay
// TEST checkout. The server prices the order and verifies the payment; only a
// verified payment creates the purchase, and the goods enter the Catalog when
// they are received (the Purchase History tab, once the supplier has accepted).
const BUY_PATH = `${STORE_MANAGER_PATH}/buy`
const HISTORY_PATH = `${BUY_PATH}/history`

export default function StoreBuySection({ projects, purchases, purchasesFailed = false, searchQuery, country, guard, onChanged, prefill, onPrefillUsed, onBackToRequest }) {
  const { t, td } = useLanguage()
  // Which tab is open is in the address, so a refresh or a pasted link keeps it.
  const location = useLocation()
  const navigate = useNavigate()
  const tab = location.pathname.replace(/\/+$/, '') === HISTORY_PATH ? 'history' : 'products'
  // The purchase whose details window is open, by request_code.
  const [openedCode, setOpenedCode] = useState(null)
  // The details window's own message, so one from Buy never shows against another purchase.
  const [detailNotice, setDetailNotice] = useState(null)
  const openedOrder = openedCode ? purchases.find((order) => order.request_code === openedCode) : null
  const [products, setProducts] = useState([])
  const [projectId, setProjectId] = useState('')
  const [lines, setLines] = useState([])
  const [payingSupplier, setPayingSupplier] = useState(null)
  const [notice, setNotice] = useState(null)
  // Buying a Site Engineer request's shortfall: { id, supplierId, backTo }.
  const [forRequest, setForRequest] = useState(null)
  const productRequest = useRef(0)
  const activeProjectId = projectId || (projects[0] ? String(projects[0].id) : '')
  const [category, setCategory] = useState('')
  // What the order's lines and the receipts typed so far say: { [order line id]: quantity }.
  const [receiveQty, setReceiveQty] = useState({})
  // One key per Mark received until it succeeds: a retry or double click is the same receipt.
  const [receiptKeys, setReceiptKeys] = useState({})
  const [receivingId, setReceivingId] = useState(null)
  const categories = [...new Set(products.map((product) => product.category).filter(Boolean))].sort()
  const visible = products.filter((product) => (!category || product.category === category) && matchesSearch(product, searchQuery))
  // The offers grouped by catalog product, however many of the builder's suppliers
  // sell it and in whatever sizes, so they show side by side: each supplier's listing
  // stays its own offer, bought from that supplier only.
  const productGroups = [...visible.reduce((groups, product) => {
    const key = product.master_product_id ? `m${product.master_product_id}` : `${product.name}|${product.brand || ''}`.toLowerCase()
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(product)
    return groups
  }, new Map()).values()]

  // The offers' latest stock figures, onto the order's lines as well: a line always
  // shows (and is checked against) what the supplier can supply now.
  const applyProducts = (list) => {
    setProducts(list)
    const byId = new Map(list.map((product) => [product.id, product]))
    setLines((current) => current.map((line) => {
      const latest = byId.get(line.id)
      return latest ? { ...line, supplier_stock: latest.quantity, available_quantity: latest.available_quantity } : line
    }))
    return byId
  }
  const loadProducts = () => {
    if (!activeProjectId) return Promise.resolve(null)
    const requestId = ++productRequest.current
    return fetchStoreBuyProducts(activeProjectId)
      .then((data) => (requestId === productRequest.current ? applyProducts(data.products || []) : null))
      .catch(() => { if (requestId === productRequest.current) setProducts([]); return null })
  }
  useEffect(() => { loadProducts() }, [activeProjectId])
  // A supplier the builder has just accepted, or stock another Buy took: shown without a reload.
  useLiveRefresh(loadProducts)

  // Opened from a request's "Purchase missing stock": that project, that product, the shortfall.
  useEffect(() => {
    if (!prefill) return
    setProjectId(String(prefill.projectId))
    setLines([orderLine(prefill.product, prefill.quantity)])
    setForRequest({ id: prefill.requestId, ref: prefill.requestRef || '', supplierId: String(prefill.product.supplier_id), backTo: prefill.backTo || 'requests' })
    setNotice(null)
    onPrefillUsed?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill])

  // Another project can mean another builder, and so other suppliers.
  const chooseProject = (value) => {
    setProjectId(value)
    setLines([])
    setForRequest(null)
  }
  // Add opens a quantity window for the offer: the exact quantity is typed, checked
  // against what the supplier can supply as it is typed, and only a valid one goes in.
  const [adding, setAdding] = useState(null)
  const openAdd = (product) => {
    const existing = lines.find((line) => line.id === product.id)
    setAdding({ product, text: existing ? existing.quantity : '' })
  }
  const confirmAdd = () => {
    const { product, text } = adding
    if (buyQuantityProblem(text, supplierAvailable(product), product.unit)) return
    setLines((current) => (current.some((line) => line.id === product.id)
      ? current.map((line) => (line.id === product.id ? { ...line, quantity: String(text).trim() } : line))
      : [...current, orderLine(product, String(text).trim())]))
    setAdding(null)
  }
  const setQuantity = (id, quantity) => setLines((current) => current.map((line) => (line.id === id ? { ...line, quantity } : line)))
  const removeLine = (id) => setLines((current) => current.filter((line) => line.id !== id))
  // What is wrong with a quantity, in words, or ''.
  const problemText = (problem, available, unit) => ({
    none: t('store.buy.noSupplierStock'),
    exceeds: t('store.buy.insufficientSupplierStock', { quantity: formatQty(available), unit: td(unit) }),
    whole: t('store.quantityWhole', { unit: td(unit) }),
    invalid: t('store.quantityInvalid'),
  }[problem] || '')
  const lineProblem = (line) => buyQuantityProblem(line.quantity, supplierAvailable(line), line.unit)

  // One payment per supplier, as one order goes to one supplier.
  const supplierGroups = groupLinesBySupplier(lines).map((group) => {
    const groupLines = lines.filter((line) => String(line.supplier_id) === String(group.supplier_id))
    const first = groupLines[0]
    return {
      ...group,
      lines: groupLines,
      name: first.store_name || first.supplier_name,
      // An estimate at the listed price; the server applies any bulk tier and charges that.
      estimate: groupLines.reduce((sum, line) => sum + (validQuantity(line.quantity) ? Number(line.quantity) * Number(line.price || 0) : 0), 0),
      // A line over (or with no) supplier stock keeps this supplier's Pay disabled.
      blocked: groupLines.some((line) => lineProblem(line)),
    }
  })

  const paid = (group, result) => {
    const order = result.payment
    // Paid while the supplier's stock fell short: recorded (the money is not lost) and said plainly.
    setNotice(result.stock_warning
      ? { text: `${t('store.buy.paid', { reference: order.reference_code, amount: money(order.amount, country) })} ${td(result.stock_warning)} ${t('store.buy.stockWarningTail')}`, error: true }
      : { text: t('store.buy.paid', { reference: order.reference_code, amount: money(order.amount, country) }) })
    setLines((current) => current.filter((line) => String(line.supplier_id) !== String(group.supplier_id)))
    loadProducts()
    onChanged()
  }

  // The existing checkout, shared with Catalog's Purchase from Supplier.
  const checkout = useStorePurchaseCheckout({ country, notify: setNotice, onChanged })

  const pay = async (group) => {
    if (guard()) return
    if (!activeProjectId) {
      setNotice({ text: t('store.buy.selectProject'), error: true })
      return
    }
    if (group.lines.some((line) => !validQuantity(line.quantity))) {
      setNotice({ text: t('store.quantityInvalid'), error: true })
      return
    }
    setPayingSupplier(group.supplier_id)
    setNotice(null)
    try {
      // The suppliers' stock read again just before paying: another Buy may have taken some.
      const latest = await loadProducts()
      const stale = latest && group.lines.find((line) => {
        const fresh = latest.get(line.id)
        return !fresh || buyQuantityProblem(line.quantity, supplierAvailable(fresh), line.unit)
      })
      if (stale) {
        const fresh = latest.get(stale.id)
        const available = fresh ? supplierAvailable(fresh) : 0
        setNotice({ text: `${td(stale.name)}: ${problemText(buyQuantityProblem(stale.quantity, available, stale.unit), available, stale.unit)} ${t('store.buy.stockUpdated')}`, error: true })
        return
      }
      const coversRequest = forRequest && String(group.supplier_id) === forRequest.supplierId
      await checkout.start({
        project_id: activeProjectId, supplier_id: group.supplier_id, items: group.items,
        ...(coversRequest ? { site_request_id: forRequest.id } : {}),
      }, { onPaid: (result) => paid(group, result) })
    } catch (error) {
      // The server's own count refused it: its latest figure goes onto the line.
      const detail = error?.response?.data?.detail
      if (detail?.code === 'INSUFFICIENT_SUPPLIER_STOCK' && detail.product_id != null) {
        setLines((current) => current.map((line) => (line.id === detail.product_id ? { ...line, available_quantity: detail.available } : line)))
      }
      setNotice({ text: refusalText(error, td, t('store.saveFailed')), error: true })
    } finally {
      setPayingSupplier(null)
    }
  }

  // What actually arrived of a line: by default all that is still pending; a part
  // leaves the rest pending, received later. Never more than is pending (the server checks).
  const receive = async (line) => {
    if (guard() || receivingId) return
    setNotice(null)
    const typed = String(receiveQty[line.id] ?? '').trim()
    if (typed && !validQuantity(typed)) {
      setNotice({ text: t('store.quantityInvalid'), error: true })
      return
    }
    const key = receiptKeys[line.id] || `rk-${line.id}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
    setReceiptKeys((current) => ({ ...current, [line.id]: key }))
    setReceivingId(line.id)
    try {
      await receiveStorePurchaseLine(line.id, typed || undefined, key)
      setReceiptKeys((current) => { const next = { ...current }; delete next[line.id]; return next })
      setReceiveQty((current) => { const next = { ...current }; delete next[line.id]; return next })
      setNotice({ text: t('store.buy.receivedQty2', { quantity: formatQty(typed || line.pending_quantity), unit: td(line.unit), name: td(line.material_name) }) })
      onChanged()
    } catch (error) {
      setNotice({ text: refusalText(error, td, t('store.saveFailed')), error: true })
    } finally {
      setReceivingId(null)
    }
  }

  return (
    <div className="space-y-3">
      <div role="tablist" aria-label={t('store.nav.buy')} className="flex flex-wrap gap-1.5">
        {[
          ['products', 'store.buy.tabProducts', ShoppingCart, BUY_PATH, null],
          ['history', 'store.buy.tabHistory', History, HISTORY_PATH, purchases.length],
        ].map(([id, key, Icon, path, count]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => { if (tab !== id) { setNotice(null); navigate(path) } }}
            className={`inline-flex h-9 items-center gap-1.5 rounded-full px-3.5 text-xs font-extrabold transition ${tab === id ? 'bg-brand-700 text-white' : 'bg-slate-100 text-graphite/60 hover:bg-slate-200'}`}>
            <Icon className="h-3.5 w-3.5" />
            {t(key)}
            {count > 0 && <span className={`grid h-4 min-w-4 place-items-center rounded-full px-1 text-[10px] font-bold ${tab === id ? 'bg-white/20 text-white' : 'bg-white text-graphite/60'}`}>{count}</span>}
          </button>
        ))}
      </div>
      <Notice message={notice} onClose={() => setNotice(null)} />
      {tab === 'products' && forRequest && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800">
          <span>{t('store.buy.forRequest', { id: forRequest.ref })}</span>
          <button type="button" onClick={() => onBackToRequest?.(forRequest.backTo)} className={secondaryButton}>{t('store.buy.backToRequest', { id: forRequest.ref })}</button>
        </div>
      )}
      {tab !== 'products' ? null : !projects.length ? (
        <Panel><EmptyState icon={ShoppingCart} title={t('store.buy.noProjects')} message={t('store.buy.noProjectsSub')} /></Panel>
      ) : (
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_340px]">
          <Panel title={t('store.buy.products')}>
            {categories.length > 1 && (
              <div className="mb-3 flex gap-1.5 overflow-x-auto">
                {['', ...categories].map((value) => (
                  <button key={value || 'all'} type="button" aria-pressed={category === value} onClick={() => setCategory(value)}
                    className={`h-8 shrink-0 rounded-full px-3 text-xs font-extrabold transition ${category === value ? 'bg-brand-700 text-white' : 'bg-slate-100 text-graphite/60 hover:bg-slate-200'}`}>
                    {value ? td(value) : t('store.engineer.allCategories')}
                  </button>
                ))}
              </div>
            )}
            {productGroups.length ? (
              // The Catalog's card, one per supplier offer: the offers of one product sit
              // side by side, each with its own size, supplier, price, stock and Add.
              <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 2xl:grid-cols-4">
                {productGroups.flat().map((product) => {
                  const added = lines.find((line) => line.id === product.id)
                  const available = supplierAvailable(product)
                  const supplier = td(product.store_name || product.supplier_name)
                  return (
                    <li key={product.id} className="group flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-md">
                      <div className="relative grid aspect-square place-items-center bg-slate-50">
                        {product.image_url
                          ? <img src={imageUrl(product.image_url)} alt={td(product.name)} loading="lazy" className="h-full w-full object-contain p-2 transition duration-300 group-hover:scale-[1.03]" />
                          : <span className="grid h-full w-full place-items-center text-slate-300"><ShoppingBag className="h-8 w-8" /></span>}
                        {available <= 0 && <span className="absolute start-2 top-2 rounded-md bg-rose-600 px-2 py-0.5 text-[10px] font-extrabold uppercase text-white">{t('store.buy.outOfStock')}</span>}
                        {added && <span className="absolute end-2 top-2 rounded-md bg-brand-700 px-2 py-0.5 text-[10px] font-extrabold uppercase text-white">{t('store.buy.inOrder', { quantity: formatQty(added.quantity), unit: td(product.unit) })}</span>}
                      </div>
                      <div className="flex flex-1 flex-col gap-1 p-2.5">
                        <span className="truncate text-[10px] font-extrabold uppercase tracking-wide text-brand-700">{product.brand ? td(product.brand) : t('store.catalog.noBrand')}</span>
                        <span className="line-clamp-2 text-xs font-extrabold leading-snug text-graphite" title={td(product.name)}>{td(product.name)}</span>
                        <span className="truncate text-[11px] font-semibold text-graphite/50">{[product.category, product.subcategory].filter(Boolean).map((value) => td(value)).join(' · ')}</span>
                        {product.size && <span className="truncate text-[11px] font-bold text-graphite/70">{t('store.buy.sizeLabel', { size: td(product.size) })}</span>}
                        {product.description && <span className="line-clamp-2 text-[11px] font-medium text-graphite/55">{td(product.description)}</span>}
                        <span className="mt-auto truncate pt-1 text-[11px] font-bold text-graphite/70" title={supplier}>{t('store.buy.supplierLabel', { name: supplier })}</span>
                        <span className="text-sm font-extrabold text-graphite">{t('store.buy.pricePer', { price: money(product.price, country), unit: td(product.unit) })}</span>
                        {/* The supplier's own stock, less what other orders have already taken. */}
                        <span className={`text-[11px] font-extrabold ${available > 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                          {available > 0 ? t('store.buy.supplierAvailable', { quantity: formatQty(available), unit: td(product.unit) }) : t('store.buy.noSupplierStock')}
                        </span>
                        <div className="pt-1.5">
                          <button type="button" onClick={() => openAdd(product)} disabled={available <= 0} aria-label={`${t('store.buy.add')} ${td(product.name)} ${product.size ? td(product.size) : ''} ${supplier}`} className={`${primaryButton} !h-8 w-full !px-2`}>
                            <ShoppingCart className="h-3.5 w-3.5" />{added ? t('store.buy.changeQuantity') : t('store.buy.add')}
                          </button>
                        </div>
                      </div>
                    </li>
                  )
                })}
              </ul>
            ) : (
              <EmptyState icon={ShoppingCart} title={t('store.buy.noProducts')} message={t('store.buy.noProductsSub')} />
            )}
          </Panel>
          <Panel title={t('store.buy.order')}>
            <label className="block">
              <span className={labelClass}>{t('store.buy.project')}</span>
              <select className={`mt-1 ${inputClass}`} value={activeProjectId} onChange={(event) => chooseProject(event.target.value)}>
                {projects.map((project) => <option key={project.id} value={project.id}>{td(project.title)}</option>)}
              </select>
            </label>
            {supplierGroups.map((group) => (
              <section key={group.supplier_id} className="mt-3 rounded-xl border border-slate-200 p-2.5">
                <p className="truncate text-xs font-extrabold text-graphite">{td(group.name)}</p>
                <ul className="mt-2 space-y-2.5">
                  {group.lines.map((line) => {
                    const available = supplierAvailable(line)
                    const problem = lineProblem(line)
                    return (
                      <li key={line.id} className={`rounded-lg border p-2 ${problem ? 'border-rose-300 bg-rose-50/60' : 'border-slate-100'}`}>
                        <div className="flex items-start gap-2">
                          <span className="min-w-0 flex-1 text-xs font-bold text-graphite">
                            <span className="block break-words">{td(line.name)}</span>
                            {line.size && <span className="block text-[11px] font-semibold text-graphite/60">{t('store.buy.sizeLabel', { size: td(line.size) })}</span>}
                          </span>
                          <button type="button" onClick={() => removeLine(line.id)} aria-label={`${t('store.remove')} ${td(line.name)}`} title={t('store.remove')} className={`${secondaryButton} !h-7 !px-2`}><Trash2 className="h-3.5 w-3.5" /></button>
                        </div>
                        <div className="mt-1.5 flex flex-wrap items-center gap-2">
                          <QuantityField value={line.quantity} unit={line.unit} label={`${t('store.quantity')} ${td(line.name)}`} onChange={(text) => setQuantity(line.id, text)} />
                        </div>
                        <dl className="mt-1.5 grid grid-cols-3 gap-1 text-[11px]">
                          <div><dt className="font-semibold text-graphite/50">{t('store.buy.lineAvailable')}</dt><dd className={`font-extrabold ${available > 0 ? 'text-graphite' : 'text-rose-700'}`}>{formatQty(available)} {td(line.unit)}</dd></div>
                          <div><dt className="font-semibold text-graphite/50">{t('store.col.unitPrice')}</dt><dd className="font-extrabold text-graphite">{money(line.price, country)}</dd></div>
                          <div><dt className="font-semibold text-graphite/50">{t('store.col.lineTotal')}</dt><dd className="font-extrabold text-graphite">{validQuantity(line.quantity) ? money(Number(line.quantity) * Number(line.price || 0), country) : '—'}</dd></div>
                        </dl>
                        {problem && (
                          <p role="alert" className="mt-1.5 flex items-start gap-1 text-[11px] font-extrabold text-rose-700">
                            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                            <span>
                              {problemText(problem, available, line.unit)}
                              {problem === 'exceeds' && (
                                <button type="button" onClick={() => setQuantity(line.id, String(isCountUnit(line.unit) ? Math.floor(available) : available))} className="ms-1 underline">{t('store.buy.useMaximum', { quantity: formatQty(isCountUnit(line.unit) ? Math.floor(available) : available), unit: td(line.unit) })}</button>
                              )}
                            </span>
                          </p>
                        )}
                      </li>
                    )
                  })}
                </ul>
                <p className="mt-2 flex items-center justify-between text-xs font-extrabold text-graphite">
                  <span>{t('store.buy.total')}</span><span>{money(group.estimate, country)}</span>
                </p>
                <p className="text-[10px] font-semibold text-graphite/50">{t('store.buy.totalNote')}</p>
                {group.blocked && <p className="mt-1 text-[11px] font-extrabold text-rose-700">{t('store.buy.fixOrder')}</p>}
                <button type="button" onClick={() => pay(group)} disabled={payingSupplier !== null || group.blocked} className={`mt-2 w-full ${primaryButton}`}>
                  <CreditCard className="h-3.5 w-3.5" />
                  {payingSupplier === group.supplier_id ? t('dash.common.saving') : t('store.buy.pay')}
                </button>
              </section>
            ))}
            {!lines.length && <p className="mt-3 text-xs font-semibold text-graphite/55">{t('store.buy.emptyOrder')}</p>}
          </Panel>
        </div>
      )}

      {adding && (() => {
        const { product, text } = adding
        const available = supplierAvailable(product)
        const typed = String(text || '').trim()
        const problem = typed ? buyQuantityProblem(typed, available, product.unit) : (available > 0 ? '' : 'none')
        const most = isCountUnit(product.unit) ? Math.floor(available) : available
        const editing = lines.some((line) => line.id === product.id)
        return (
          <DetailModal width="max-w-lg" title={td(product.name)} subtitle={[product.size && t('store.buy.sizeLabel', { size: td(product.size) }), t('store.buy.supplierLabel', { name: td(product.store_name || product.supplier_name) })].filter(Boolean).join(' · ')} onClose={() => setAdding(null)}>
            <div className="space-y-3 pb-1">
              <dl className="grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-lg bg-slate-50 p-2"><dt className={labelClass}>{t('store.col.unitPrice')}</dt><dd className="font-extrabold text-graphite">{t('store.buy.pricePer', { price: money(product.price, country), unit: td(product.unit) })}</dd></div>
                <div className="rounded-lg bg-slate-50 p-2"><dt className={labelClass}>{t('store.buy.lineAvailable')}</dt><dd className={`font-extrabold ${available > 0 ? 'text-emerald-700' : 'text-rose-700'}`}>{formatQty(available)} {td(product.unit)}</dd></div>
              </dl>
              <div>
                <span className={labelClass}>{t('store.buy.quantityToBuy', { unit: td(product.unit) })}</span>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <QuantityField large value={text} unit={product.unit} label={`${t('store.quantity')} ${td(product.name)}`} onChange={(value) => setAdding((current) => ({ ...current, text: value }))} />
                  {available > 0 && <span className="text-xs font-bold text-graphite/60">{t('store.buy.maxAvailable', { quantity: formatQty(most), unit: td(product.unit) })}</span>}
                </div>
              </div>
              {problem && (
                <p role="alert" className="flex items-start gap-1.5 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-extrabold text-rose-700">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>
                    {problemText(problem, available, product.unit)}
                    {problem === 'exceeds' && most > 0 && (
                      <button type="button" onClick={() => setAdding((current) => ({ ...current, text: String(most) }))} className="ms-1 underline">{t('store.buy.useMaximum', { quantity: formatQty(most), unit: td(product.unit) })}</button>
                    )}
                  </span>
                </p>
              )}
              {typed && !problem && (
                <p className="text-xs font-bold text-graphite/70">{t('store.col.lineTotal')}: {money(Number(typed) * Number(product.price || 0), country)}</p>
              )}
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setAdding(null)} className={secondaryButton}>{t('store.cancel')}</button>
                <button type="button" onClick={confirmAdd} disabled={!typed || Boolean(problem)} className={primaryButton}>
                  <ShoppingCart className="h-3.5 w-3.5" />{t(editing ? 'store.buy.updateOrder' : 'store.buy.addToOrder')}
                </button>
              </div>
            </div>
          </DetailModal>
        )
      })()}

      {checkout.dialog}

      {tab === 'history' && (
      <div id="store-purchases" className="scroll-mt-20">
      <Panel title={t('store.buy.purchases')}>
        {purchasesFailed && !purchases.length ? (
          <Notice message={{ text: t('store.loadFailed'), error: true }} />
        ) : purchases.length ? (
          <ul className="space-y-2">
            {purchases.map((order) => (
              <li key={order.request_code} className="rounded-xl border border-slate-200 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="min-w-0 truncate text-sm font-extrabold text-graphite">{t('store.buy.purchaseId', { id: purchaseRef(order) })} · {td(order.supplier_name)} · {td(order.project_name)}</p>
                  <span className="flex items-center gap-2">
                    <span className="text-xs font-extrabold text-graphite">{money(order.total, country)}</span>
                    <button type="button" onClick={() => setOpenedCode(order.request_code)} className={`${secondaryButton} !h-7 whitespace-nowrap !px-2 !text-[11px]`}>{t('store.viewDetails')}</button>
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-1">
                  <OrderPill kind="paymentStatus" status={order.payment_status} />
                  <SupplierOrderStatus order={order} />
                  <OrderPill kind="receiptStatus" status={order.receipt_status} />
                </div>
                <p className="text-[11px] font-semibold text-graphite/55">
                  {t('store.buy.orderedOn', { date: formatDateTime(order.created_at) })}
                  {order.builder_name && ` · ${t('store.requests.builder')}: ${td(order.builder_name)}`}
                  {' · '}{t(`store.buy.paymentStatus.${order.payment_status}`)}
                  {' · '}{t(`store.buy.receiptStatus.${order.receipt_status}`)}
                </p>
                {/* The payments for this purchase, with the gateway's own identifiers. */}
                {order.payments?.map((payment) => (
                  <p key={payment.id} className="text-[11px] font-semibold text-graphite/55">
                    {t('store.payments.recordId', { id: transactionRef(payment) })} · {t(`store.payments.method.${payment.method}`)} · {t(`store.payments.status.${payment.status}`)} · {money(payment.amount, country)}
                    {payment.razorpay_payment_id && ` · ${payment.razorpay_payment_id}`}
                    {payment.paid_at && ` · ${t('store.payments.paidOn', { date: formatDateTime(payment.paid_at) })}`}
                  </p>
                ))}
                <ul className="mt-2 divide-y divide-slate-100 rounded-lg bg-slate-50/70 px-3">
                  {order.lines.map((line) => (
                    <li key={line.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5 text-xs">
                      <span className="min-w-0">
                        <span className="block font-bold text-graphite">{td(line.material_name)}{line.size ? ` · ${td(line.size)}` : ''} × {formatQty(line.quantity)} {td(line.unit)}</span>
                        <span className="block text-[11px] font-semibold text-graphite/55">
                          {t('store.buy.orderLineId', { id: line.id })}
                          {line.received && ` · ${t('store.buy.receivedOn', { quantity: formatQty(line.received_quantity), unit: td(line.unit), date: formatDateTime(line.received_at) })}`}
                          {line.received && line.pending_quantity > 0 && line.status !== 'REJECTED' && ` · ${t('store.buy.stillPending', { quantity: formatQty(line.pending_quantity), unit: td(line.unit) })}`}
                        </span>
                      </span>
                      <span className="flex flex-wrap items-center gap-2">
                        <StatusPill status={line.status} soft />
                        {line.fully_received && <span className="font-extrabold text-emerald-700">{t('store.buy.inStock')}</span>}
                        {line.status === 'PENDING' && <span className="font-semibold text-amber-700">{t('store.buy.awaitingSupplier')}</span>}
                        {line.can_receive && <span className="font-semibold text-amber-700">{t('store.buy.notInStockYet')}</span>}
                        {line.can_receive && (
                          <input className={`${inputClass} !h-9 !w-20`} inputMode="decimal" aria-label={`${t('store.buy.receivedQty')} ${td(line.material_name)}`} title={t('store.buy.receivedQty')}
                            value={receiveQty[line.id] ?? String(line.pending_quantity ?? line.quantity)} onChange={(event) => setReceiveQty((current) => ({ ...current, [line.id]: event.target.value }))} />
                        )}
                        {line.can_receive && <button type="button" onClick={() => receive(line)} disabled={receivingId !== null} className={primaryButton}><PackageCheck className="h-3.5 w-3.5" />{t('store.buy.receive')}</button>}
                      </span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState icon={ShoppingBag} title={t('store.buy.noPurchases')} message={t('store.buy.noPurchasesSub')} />
        )}
      </Panel>
      </div>
      )}

      {/* The same details window as a transaction's under Payments. */}
      {tab === 'history' && openedOrder && (
        <DetailModal
          placement="right"
          width="max-w-4xl"
          badge={t('store.payments.purchaseBadge')}
          title={t('store.col.purchaseId')}
          subtitle={td(openedOrder.supplier_name)}
          onClose={() => { setOpenedCode(null); setDetailNotice(null) }}
        >
          {detailNotice && <div className="mb-2"><Notice message={detailNotice} onClose={() => setDetailNotice(null)} /></div>}
          <PurchaseDetail order={openedOrder} country={country} guard={guard} onRecorded={() => { setDetailNotice({ text: t('store.payments.recorded') }); onChanged() }} />
        </DetailModal>
      )}
    </div>
  )
}
