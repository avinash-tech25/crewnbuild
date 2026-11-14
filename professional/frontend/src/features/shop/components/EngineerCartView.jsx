/**
 * The Site Engineer's cart, laid out as the Cart reference design: one card
 * per supplier with its lines, and an Order Summary on the right.
 *
 * Layout only. Every value and action comes from CartPanel, which keeps the
 * cart state, the per-supplier Send Buy Request and its profile gate unchanged.
 */
import {
  ArrowLeft, ArrowRight, Boxes, ChevronRight, Info, Package, ReceiptText,
  Send, Store, Trash2, Wallet,
} from 'lucide-react'
import { SmartImage } from '../../../shared/ui/ui.jsx'
import { SavedQuantityField } from './QuantityField.jsx'
import { imageUrl } from '../../../shared/api/apiClient.js'
import { formatMoney as countryFormatMoney } from '../../../shared/utils/countryConfig.js'
import { formatNumber } from '../../../shared/utils/formatters.js'
import { SUPPLIER_CATEGORY_KEYS, optionLabel } from '../../../i18n/optionKeys.js'
import { useLanguage } from '../../../i18n/LanguageContext.jsx'

const card = 'rounded-2xl border border-slate-200 bg-white shadow-[0_14px_40px_-34px_rgba(15,23,42,0.35)]'

function CartLineRow({ line, busy, onChangeQuantity, onRemove }) {
  const { t, td } = useLanguage()
  const inStock = Number(line.available_quantity) > 0
  return (
    <div className="flex flex-wrap items-center gap-4 rounded-xl border border-slate-100 bg-white p-3 sm:flex-nowrap">
      <SmartImage
        src={line.image_url ? imageUrl(line.image_url) : ''}
        alt={td(line.name)}
        className="h-24 w-24 shrink-0 rounded-xl border border-slate-100 object-cover"
      />
      <div className="min-w-0 flex-1">
        {/* Product name, brand, size and unit are the supplier's own words. */}
        <p className="truncate text-base font-bold text-graphite">{td(line.name)}</p>
        <p className="truncate text-[13px] text-graphite/55">
          {td([line.brand, line.size].filter(Boolean).join(' • ')) || optionLabel(t, SUPPLIER_CATEGORY_KEYS, line.category)}
        </p>
        <p className="mt-1 text-sm font-semibold text-graphite/75">
          {countryFormatMoney(line.price)} {t('dash.supplier.per')} {td(line.unit)}
        </p>
        {line.bulk_tier && (
          <p className="text-xs font-bold text-brand-700">
            Bulk price applied ({line.bulk_tier.min_quantity}{line.bulk_tier.max_quantity == null ? '+' : `–${line.bulk_tier.max_quantity}`}) · normal {countryFormatMoney(line.normal_price)}
          </p>
        )}
        <p className={`text-[13px] font-semibold ${inStock ? 'text-emerald-600' : 'text-rose-600'}`}>
          {inStock ? `${formatNumber(line.available_quantity)} ${td(line.unit)} ${t('shop.inStock')}` : t('dash.supplier.outOfStock')}
        </p>
      </div>

      <SavedQuantityField quantity={line.quantity} unit={line.unit} disabled={busy} large label={`${t('store.quantity')} ${td(line.name)}`} onSave={(quantity) => onChangeQuantity(line, quantity)} />

      <p className="w-24 shrink-0 text-right text-lg font-bold text-graphite">{countryFormatMoney(line.line_total)}</p>

      <button type="button" disabled={busy} onClick={() => onRemove(line)} aria-label={t('dash.common.delete')} className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-rose-50 text-rose-500 transition hover:bg-rose-500 hover:text-white disabled:opacity-40">
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
  )
}

function SummaryRow({ icon: Icon, label, value }) {
  return (
    <div className="flex items-center gap-3 py-2">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-slate-50 text-graphite/80 ring-1 ring-slate-100">
        <Icon className="h-[18px] w-[18px]" />
      </span>
      <dt className="flex-1 text-[15px] font-medium text-graphite/65">{label}</dt>
      <dd className="text-[15px] font-bold text-graphite">{value}</dd>
    </div>
  )
}

export default function EngineerCartView({
  cart,
  busy,
  projectId,
  totalQuantity,
  messages,
  onChangeQuantity,
  onRemove,
  onClearCart,
  onSendGroup,
  onContinueShopping,
  onViewSupplier,
}) {
  const { t, td } = useLanguage()
  const single = cart.suppliers.length === 1

  const continueButton = onContinueShopping && (
    <button type="button" onClick={onContinueShopping} className="inline-flex h-12 items-center gap-2.5 rounded-xl bg-brand-50 px-6 text-[15px] font-bold text-brand-900 transition hover:bg-brand-100">
      <ArrowLeft className="h-4 w-4" /> {t('shop.ec.continueShopping')}
    </button>
  )
  const clearButton = (
    <button type="button" disabled={busy} onClick={onClearCart} className="inline-flex h-12 items-center gap-2.5 rounded-xl bg-rose-50 px-6 text-[15px] font-bold text-rose-600 ring-1 ring-rose-100 transition hover:bg-rose-100 disabled:opacity-40">
      <Trash2 className="h-4 w-4" /> {t('shop.clearCart')}
    </button>
  )

  return (
    <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(300px,360px)]">
      <div className="min-w-0 space-y-5">
        {messages}

        {cart.suppliers.map((group, index) => {
          const name = td(group.store_name || group.supplier_name)
          const last = index === cart.suppliers.length - 1
          return (
            <div key={group.supplier_id} className={`${card} p-5`}>
              <div className="flex flex-wrap items-center gap-4 pb-4">
                <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-brand-50 text-brand-800">
                  <Store className="h-6 w-6" />
                </span>
                <div className="min-w-0 flex-1">
                  {onViewSupplier ? (
                    <button type="button" onClick={() => onViewSupplier(group.supplier_id)} className="inline-flex max-w-full items-center gap-1.5 text-lg font-bold text-graphite hover:text-brand-800">
                      <span className="truncate">{name}</span> <ChevronRight className="h-4 w-4 shrink-0" />
                    </button>
                  ) : (
                    <p className="truncate text-lg font-bold text-graphite">{name}</p>
                  )}
                  <p className="text-[13px] text-graphite/55">{t('shop.soldBy')}</p>
                </div>
                {onViewSupplier && (
                  <button type="button" onClick={() => onViewSupplier(group.supplier_id)} className="inline-flex h-11 items-center gap-2 rounded-xl bg-brand-50 px-5 text-[15px] font-bold text-brand-900 transition hover:bg-brand-100">
                    {t('shop.ec.viewSupplier')} <ArrowRight className="h-4 w-4" />
                  </button>
                )}
              </div>

              <div className="space-y-2">
                {group.items.map((line) => (
                  <CartLineRow key={line.id} line={line} busy={busy} onChangeQuantity={onChangeQuantity} onRemove={onRemove} />
                ))}
              </div>

              {/* Several suppliers: each still gets its own request, sent from its own card. */}
              {!single && (
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
                  <p className="text-sm font-bold text-graphite">{t('shop.supplierTotal')}: {countryFormatMoney(group.total)}</p>
                  <button
                    type="button"
                    disabled={busy || !projectId}
                    onClick={() => onSendGroup(group.supplier_id)}
                    className="inline-flex h-11 items-center gap-2 rounded-xl bg-brand-500 px-5 text-sm font-bold text-white transition hover:bg-brand-600 disabled:opacity-50"
                  >
                    <Send className="h-4 w-4" /> {t('shop.sendBuyRequest')}
                  </button>
                </div>
              )}

              {last && (
                <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
                  {continueButton || <span />}
                  {clearButton}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Order Summary */}
      <aside className={`${card} p-5 lg:sticky lg:top-4`}>
        <div className="flex items-center gap-3 rounded-xl bg-[#fcf3e3] px-4 py-4">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[#fde3bc] text-graphite">
            <ReceiptText className="h-5 w-5" />
          </span>
          <p className="text-lg font-bold text-graphite">{t('shop.ec.orderSummary')}</p>
        </div>

        <dl className="mt-3 border-b border-slate-100 px-1 pb-3">
          <SummaryRow icon={Package} label={t('shop.products')} value={formatNumber(cart.item_count)} />
          <SummaryRow icon={Boxes} label={t('shop.totalQuantity')} value={formatNumber(totalQuantity)} />
          <SummaryRow icon={Wallet} label={t('shop.subtotal')} value={countryFormatMoney(cart.total)} />
        </dl>

        {single ? (
          <>
            <button
              type="button"
              disabled={busy || !projectId}
              onClick={() => onSendGroup(cart.suppliers[0].supplier_id)}
              className="mt-5 inline-flex h-14 w-full items-center justify-center gap-3 rounded-xl bg-brand-500 px-5 text-base font-bold text-white shadow-sm transition hover:bg-brand-600 disabled:opacity-50"
            >
              <Send className="h-5 w-5" /> {t('shop.sendBuyRequest')}
            </button>
            <p className="mt-4 flex items-start gap-2 text-[13px] text-graphite/60">
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-graphite/45" /> {t('shop.ec.sendNote')}
            </p>
          </>
        ) : (
          <p className="mt-4 flex items-start gap-2 text-[13px] text-graphite/60">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-graphite/45" /> {t('shop.ec.perSupplierNote', { count: formatNumber(cart.suppliers.length) })}
          </p>
        )}
      </aside>
    </div>
  )
}
