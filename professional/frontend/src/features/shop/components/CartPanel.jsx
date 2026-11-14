/**
 * Cart review and checkout, shared by the House Owner and the Site Engineer.
 *
 * A cart can hold products from several suppliers, and each supplier is sent its
 * own buy request, so the lines are grouped by supplier and confirmed one group
 * at a time. The project the materials are for is chosen here, because that is
 * what the supplier is told to deliver against.
 */
import { useEffect, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { CheckCircle2, ShoppingCart, Store, Trash2 } from 'lucide-react'
import { SmartImage } from '../../../shared/ui/ui.jsx'
import { SavedQuantityField } from './QuantityField.jsx'
import { imageUrl } from '../../../shared/api/apiClient.js'
import {
  changeCartQuantity,
  emptyCart,
  loadCart,
  removeProductFromCart,
  selectCart,
  sendBuyRequest,
} from '../cartSlice.js'
import { formatMoney as countryFormatMoney } from '../../../shared/utils/countryConfig.js'
import { useLanguage } from '../../../i18n/LanguageContext.jsx'
import { CART_GATED_ACTIONS, useProfileGate, useResumeGatedAction } from '../../../shared/hooks/useProfileGate.js'
import { formatNumber } from '../../../shared/utils/formatters.js'
import EngineerCartView from './EngineerCartView.jsx'
import { SUPPLIER_CATEGORY_KEYS, optionLabel } from '../../../i18n/optionKeys.js'

function CartLine({ line, onChangeQuantity, onRemove, busy }) {
  const { t, td } = useLanguage()
  return (
    <div className="flex items-center gap-3 border-t border-slate-100 py-3 first:border-t-0">
      <SmartImage
        src={line.image_url ? imageUrl(line.image_url) : ''}
        alt={td(line.name)}
        className="h-14 w-14 shrink-0 rounded-lg object-cover ring-1 ring-slate-200"
      />
      <div className="min-w-0 flex-1">
        {/* Product name, brand, size and unit are the supplier's own words. */}
        <p className="truncate text-sm font-extrabold text-graphite">{td(line.name)}</p>
        <p className="truncate text-[11px] font-semibold text-graphite/50">
          {td([line.brand, line.size].filter(Boolean).join(' · ')) || optionLabel(t, SUPPLIER_CATEGORY_KEYS, line.category)}
        </p>
        <p className="mt-0.5 text-[11px] font-bold text-graphite/60">
          {countryFormatMoney(line.price)} {t('dash.supplier.per')} {td(line.unit)}
        </p>
        {line.bulk_tier && (
          <p className="text-[11px] font-extrabold text-brand-700">
            Bulk price applied ({line.bulk_tier.min_quantity}{line.bulk_tier.max_quantity == null ? '+' : `–${line.bulk_tier.max_quantity}`}) · normal {countryFormatMoney(line.normal_price)}
          </p>
        )}
        <p className={`text-[11px] font-bold ${Number(line.available_quantity) > 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
          {Number(line.available_quantity) > 0
            /* Was pinned to en-IN, so the grouping ignored the reader. */
            ? `${formatNumber(line.available_quantity)} ${td(line.unit)} ${t('shop.inStock')}`
            : t('dash.supplier.outOfStock')}
        </p>
      </div>

      <SavedQuantityField quantity={line.quantity} unit={line.unit} disabled={busy} label={`${t('store.quantity')} ${td(line.name)}`} onSave={(quantity) => onChangeQuantity(line, quantity)} />

      <p className="w-24 shrink-0 text-right text-sm font-extrabold text-graphite">
        {countryFormatMoney(line.line_total)}
      </p>

      <button type="button" disabled={busy} onClick={() => onRemove(line)} aria-label={t('dash.common.delete')} className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-red-100 bg-red-50 text-red-600 transition hover:bg-red-600 hover:text-white disabled:opacity-40">
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

// buyLabel: the per-supplier button's label (the House Owner's cart says
// "Buy"). buyAll: also offer one Buy for every supplier in the cart -- each
// supplier still gets its own request with only its own lines.
// engineerLayout: the Site Engineer's cart layout (EngineerCartView). Same data
// and actions; onContinueShopping / onViewSupplier are its two links.
export default function CartPanel({ projectId = null, buyLabel = null, buyAll = false, engineerLayout = false, onContinueShopping, onViewSupplier }) {
  const { t, td } = useLanguage()
  const { requireCompleteProfile } = useProfileGate()
  const dispatch = useDispatch()
  const cart = useSelector(selectCart)
  const [sentCode, setSentCode] = useState('')
  // Per-supplier outcome of the last Buy: [{ supplier, ok, detail }].
  const [outcomes, setOutcomes] = useState([])

  // The active project comes from the Suppliers section, which already chose
  // it. Changing it there swaps the basket shown here.
  useEffect(() => { dispatch(loadCart(projectId)) }, [dispatch, projectId])

  const busy = cart.status === 'loading'
  const totalQuantity = cart.items.reduce((sum, line) => sum + Number(line.quantity || 0), 0)

  const changeQuantity = (line, quantity) => {
    // Exactly what was typed (12.5 kg is kept); 0 is the - button stepping below one.
    if (quantity <= 0) return dispatch(removeProductFromCart({ itemId: line.id }))
    return dispatch(changeCartQuantity({ itemId: line.id, quantity }))
  }

  // Buy sends the supplier a purchase request, so it needs a complete profile.
  // The project (and supplier) go with the gated action: the cart itself is
  // kept on the server, so after Complete Profile the same Buy simply resumes.
  const submitGroup = async (supplierId, targetProjectId = projectId) => {
    if (!targetProjectId) return
    if (requireCompleteProfile(CART_GATED_ACTIONS[0], { projectId: targetProjectId, supplierId })) return
    const group = cart.suppliers.find((row) => row.supplier_id === supplierId)
    const result = await dispatch(sendBuyRequest({ projectId: targetProjectId, supplierId }))
    const ok = result.meta.requestStatus === 'fulfilled'
    if (ok) setSentCode(result.payload?.request_code || '')
    if (buyAll) setOutcomes([{ supplier: td(group?.store_name || group?.supplier_name || ''), ok, detail: ok ? String(result.payload?.request_code || '').slice(0, 8).toUpperCase() : result.payload }])
  }

  // One Buy for the whole cart: one request per supplier, in turn, each with
  // only that supplier's lines. A supplier that fails keeps its lines in the
  // cart; the others still go through.
  const submitAll = async (targetProjectId = projectId) => {
    if (!targetProjectId) return
    if (requireCompleteProfile(CART_GATED_ACTIONS[1], { projectId: targetProjectId })) return
    const groups = [...cart.suppliers]
    const results = []
    for (const group of groups) {
      const result = await dispatch(sendBuyRequest({ projectId: targetProjectId, supplierId: group.supplier_id }))
      const ok = result.meta.requestStatus === 'fulfilled'
      if (ok) setSentCode(result.payload?.request_code || '')
      results.push({ supplier: td(group.store_name || group.supplier_name), ok, detail: ok ? String(result.payload?.request_code || '').slice(0, 8).toUpperCase() : result.payload })
    }
    setOutcomes(results)
  }

  const [buyFromSupplier, buyWholeCart] = CART_GATED_ACTIONS
  useResumeGatedAction({
    [buyFromSupplier]: ({ projectId: savedProjectId, supplierId }) => submitGroup(supplierId, savedProjectId),
    [buyWholeCart]: ({ projectId: savedProjectId }) => submitAll(savedProjectId),
  })

  const outcomeList = outcomes.length > 0 && (
    <ul className="space-y-1.5" aria-label="Buy results">
      {outcomes.map((row) => (
        <li key={row.supplier} className={`rounded-xl border px-3 py-2 text-xs font-bold ${row.ok ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-rose-200 bg-rose-50 text-rose-700'}`}>
          {row.ok
            ? `Order ${row.detail} sent to ${row.supplier}. You will get a message when they accept it.`
            : `${row.supplier}: ${td(row.detail || 'The order could not be sent.')} These items are still in your cart.`}
        </li>
      ))}
    </ul>
  )

  if (!cart.item_count) {
    return (
      <section className="rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-[0_14px_40px_-30px_rgba(15,23,42,0.35)]">
        <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-brand-50 text-brand-700">
          <ShoppingCart className="h-5 w-5" />
        </span>
        <p className="mt-3 font-display text-lg font-extrabold text-graphite">{t('shop.cartEmpty')}</p>
        <p className="mt-1 text-sm font-medium text-graphite/55">{t('shop.cartEmptyHint')}</p>
        {sentCode && !outcomes.length && (
          <p className="mx-auto mt-4 inline-flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-extrabold text-emerald-800">
            <CheckCircle2 className="h-4 w-4" />
            {t('shop.requestSent')}
          </p>
        )}
        {outcomeList && <div className="mx-auto mt-4 max-w-md text-left">{outcomeList}</div>}
      </section>
    )
  }

  const errorNote = cart.errorMessage && !outcomes.length && (
    /* The server writes its refusals in English. */
    <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700">{td(cart.errorMessage)}</p>
  )

  if (engineerLayout) {
    return (
      <EngineerCartView
        cart={cart}
        busy={busy}
        projectId={projectId}
        totalQuantity={totalQuantity}
        messages={(outcomeList || errorNote) ? <div className="space-y-2">{outcomeList}{errorNote}</div> : null}
        onChangeQuantity={changeQuantity}
        onRemove={(item) => dispatch(removeProductFromCart({ itemId: item.id }))}
        onClearCart={() => dispatch(emptyCart(projectId))}
        onSendGroup={(supplierId) => submitGroup(supplierId)}
        onContinueShopping={onContinueShopping}
        onViewSupplier={onViewSupplier}
      />
    )
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3">
        <div>
          <p className="font-display text-lg font-extrabold text-graphite">{t('shop.reviewCart')}</p>
          <p className="text-xs font-semibold text-graphite/50">
            {t('shop.itemsFromSuppliers', { items: cart.item_count, suppliers: cart.suppliers.length })}
          </p>
        </div>
        <button type="button" disabled={busy} onClick={() => dispatch(emptyCart(projectId))} className="h-9 rounded-lg border border-slate-200 px-3 text-xs font-extrabold text-graphite/60 transition hover:bg-slate-50 disabled:opacity-40">
          {t('shop.clearCart')}
        </button>
      </div>

      {outcomeList}

      {errorNote}

      {cart.suppliers.map((group) => (
        <div key={group.supplier_id} className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="flex items-center gap-3 border-b border-slate-100 pb-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-700">
              <Store className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <p className="text-[10px] font-extrabold uppercase tracking-wide text-graphite/40">{t('shop.soldBy')}</p>
              <p className="truncate text-sm font-extrabold text-graphite">{td(group.store_name || group.supplier_name)}</p>
            </div>
          </div>

          {group.items.map((line) => (
            <CartLine
              key={line.id}
              line={line}
              busy={busy}
              onChangeQuantity={changeQuantity}
              onRemove={(item) => dispatch(removeProductFromCart({ itemId: item.id }))}
            />
          ))}

          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3">
            <p className="text-sm font-extrabold text-graphite">
              {t('shop.supplierTotal')}: {countryFormatMoney(group.total)}
            </p>
            <button
              type="button"
              disabled={busy || !projectId}
              onClick={() => submitGroup(group.supplier_id)}
              className="h-11 rounded-xl bg-brand-700 px-5 text-sm font-extrabold text-white transition hover:bg-brand-800 disabled:opacity-50"
            >
              {buyLabel || t('shop.sendBuyRequest')}
            </button>
          </div>
        </div>
      ))}

      <div className="rounded-2xl border border-slate-200 bg-white p-4">
        <p className="font-display text-base font-extrabold text-graphite">{t('shop.orderSummary')}</p>
        <dl className="mt-3 space-y-2 text-sm">
          <div className="flex items-center justify-between">
            <dt className="font-semibold text-graphite/55">{t('shop.subtotal')}</dt>
            <dd className="font-extrabold text-graphite">{countryFormatMoney(cart.total)}</dd>
          </div>
          <div className="flex items-center justify-between">
            <dt className="font-semibold text-graphite/55">{t('shop.products')}</dt>
            <dd className="font-extrabold text-graphite">{formatNumber(cart.item_count)}</dd>
          </div>
          <div className="flex items-center justify-between">
            <dt className="font-semibold text-graphite/55">{t('shop.totalQuantity')}</dt>
            <dd className="font-extrabold text-graphite">{formatNumber(totalQuantity)}</dd>
          </div>
          <div className="flex items-center justify-between border-t border-slate-100 pt-2">
            <dt className="font-extrabold text-graphite">{t('shop.estimatedTotal')}</dt>
            <dd className="font-display text-xl font-extrabold text-graphite">{countryFormatMoney(cart.total)}</dd>
          </div>
        </dl>
        {buyAll && cart.suppliers.length > 1 && (
          <button
            type="button"
            disabled={busy || !projectId}
            onClick={() => submitAll()}
            className="mt-4 h-11 w-full rounded-xl bg-brand-700 px-5 text-sm font-extrabold text-white transition hover:bg-brand-800 disabled:opacity-50"
          >
            {buyLabel || t('shop.sendBuyRequest')} — {cart.suppliers.length} suppliers, {countryFormatMoney(cart.total)}
          </button>
        )}
      </div>
    </section>
  )
}
