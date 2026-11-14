/**
 * Everything about one order, opened by clicking it.
 *
 * An order is the set of rows sharing a request code, so this shows the whole
 * basket that was sent in one go: who it is between, which project it is for,
 * every line with its quantity and price, and what the order came to.
 */
import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { CalendarDays, Download, Hash, Home, Package, Store, User, X } from 'lucide-react'
import { SmartImage } from '../../../shared/ui/ui.jsx'
import { imageUrl } from '../../../shared/api/apiClient.js'
import { formatMoney as countryFormatMoney } from '../../../shared/utils/countryConfig.js'
import { useLanguage } from '../../../i18n/LanguageContext.jsx'
import { activeLocale, formatDate, formatDateTime, formatNumber } from '../../../shared/utils/formatters.js'
import { SUPPLIER_CATEGORY_KEYS, optionLabel } from '../../../i18n/optionKeys.js'

/**
 * Which of two written forms a count takes.
 *
 * `count === 1 ? one : many` is the English rule, and only the English rule. In
 * French zero takes the singular; in several of the languages here the split
 * falls in a different place again. `Intl.PluralRules` knows each language's own
 * rule, so the engine decides which form applies rather than this file assuming
 * English. The two keys the table holds are still only two forms — Arabic has
 * six — so this is as close as the existing copy can get; see the note in the
 * hand-off about what a full six-form treatment would need.
 */
function plural(count, one, many) {
  try {
    return new Intl.PluralRules(activeLocale()).select(Number(count)) === 'one' ? one : many
  } catch {
    return Number(count) === 1 ? one : many
  }
}

const STATUS_TONES = {
  PENDING: 'bg-amber-50 text-amber-700 ring-amber-200',
  ACCEPTED: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  FULFILLED: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  REJECTED: 'bg-rose-50 text-rose-700 ring-rose-200',
}

function Fact({ icon: Icon, label, value }) {
  if (!value) return null
  return (
    <div className="flex items-center gap-2.5 rounded-xl border border-slate-100 bg-slate-50 px-3 py-2.5">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-white text-brand-700 ring-1 ring-slate-200">
        <Icon className="h-3.5 w-3.5" />
      </span>
      <div className="min-w-0">
        <p className="text-[10px] font-extrabold uppercase tracking-wide text-graphite/40">{label}</p>
        <p className="truncate text-sm font-extrabold text-graphite">{value}</p>
      </div>
    </div>
  )
}

export default function OrderDetailCard({ order, counterpartyLabel, counterparty, onClose, actions, invoiceFrom }) {
  const { t, td } = useLanguage()

  useEffect(() => {
    const closeOnEscape = (event) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', closeOnEscape)
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', closeOnEscape)
      document.body.style.overflow = previousOverflow
    }
  }, [onClose])

  const lineTotal = (item) => Number(item.price || 0) * Number(item.quantity || 0)
  const total = order.items.reduce((sum, item) => sum + lineTotal(item), 0)
  const totalQuantity = order.items.reduce((sum, item) => sum + Number(item.quantity || 0), 0)

  // The invoice is written from the order already open in this view, so the file
  // can only ever contain what the viewer was already served. There is no lookup
  // by id and no request, so no other order is reachable from here.
  const escapeText = (value) => String(value ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))
  const downloadInvoice = () => {
    // Was `toLocaleDateString()` with no locale, so the invoice was dated in
    // whatever language the BROWSER was set to rather than the one the reader
    // chose. The formatter follows the selection.
    const placed = formatDate(order.placedAt)
    const rows = order.items.map((item) => `<tr>
        <td>${escapeText(td(item.material_name))}</td>
        <td class="n">${escapeText(item.quantity)} ${escapeText(td(item.unit || ''))}</td>
        <td class="n">${escapeText(countryFormatMoney(Number(item.price || 0)))}</td>
        <td class="n">${escapeText(countryFormatMoney(lineTotal(item)))}</td>
      </tr>`).join('')
    const meta = [
      invoiceFrom ? [t('role.supplier'), td(invoiceFrom)] : null,
      counterparty ? [counterpartyLabel || t('shop.orderedBy'), td(counterparty)] : null,
      order.project ? [t('dash.common.project'), td(order.project)] : null,
      order.owner ? [t('role.owner'), td(order.owner)] : null,
      placed ? [t('dash.common.date'), placed] : null,
      order.code ? [t('shop.orderCode'), order.code] : null,
    ].filter(Boolean).map(([label, value]) => `<p><b>${escapeText(label)}:</b> ${escapeText(value)}</p>`).join('')
    const html = `<!doctype html><html><head><meta charset="utf-8">
<title>${escapeText(t('shop.orderDetails'))} ${escapeText(order.code || '')}</title>
<style>body{font-family:system-ui,'Noto Sans','Noto Sans Devanagari','Noto Sans Telugu','Noto Sans Tamil','Noto Sans Kannada','Noto Sans Malayalam','Noto Naskh Arabic','Segoe UI',Arial,sans-serif;color:#0f172a;margin:32px}
h1{font-size:20px;margin:0 0 16px}p{margin:2px 0;font-size:13px}
table{border-collapse:collapse;width:100%;margin-top:18px;font-size:13px}
th,td{border:1px solid #e2e8f0;padding:8px;text-align:left}
th{background:#f8fafc}.n{text-align:right}tfoot td{font-weight:700}</style></head><body>
<h1>${escapeText(t('shop.orderDetails'))}</h1>${meta}
<table><thead><tr>
<th>${escapeText(t('dash.supplier.product'))}</th><th class="n">${escapeText(t('dash.common.quantity'))}</th>
<th class="n">${escapeText(t('dash.supplier.price'))}</th><th class="n">${escapeText(t('shop.estimatedTotal'))}</th>
</tr></thead><tbody>${rows}</tbody>
<tfoot><tr><td colspan="3">${escapeText(t('shop.estimatedTotal'))}</td>
<td class="n">${escapeText(countryFormatMoney(total))}</td></tr></tfoot></table>
</body></html>`
    const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    // The word in front of the order code was the English "invoice" whatever
    // language the invoice itself was written in. The code keeps its own
    // characters exactly; only the word is translated.
    link.download = `${t('shop.invoiceFilename')}-${String(order.code || '').replace(/[^A-Za-z0-9_-]+/g, '-') || 'order'}.html`
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
  }

  const status = order.status

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('shop.orderDetails')}
      onClick={onClose}
      className="fixed inset-0 z-[150] flex justify-center bg-slate-900/60 backdrop-blur-sm sm:items-center sm:p-4"
    >
      <div
        onClick={(event) => event.stopPropagation()}
        className="flex h-[100dvh] w-full flex-col overflow-hidden bg-white shadow-2xl
                   sm:h-[min(90dvh,760px)] sm:max-w-3xl sm:rounded-2xl sm:border sm:border-slate-200"
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-100 p-5">
          <div className="min-w-0">
            <p className="text-[10px] font-extrabold uppercase tracking-wide text-graphite/40">{t('shop.orderDetails')}</p>
            <h4 className="mt-1 font-display text-xl font-extrabold text-graphite">
              {formatNumber(order.items.length)} {plural(order.items.length, t('shop.itemOne'), t('shop.itemMany'))}
            </h4>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={downloadInvoice}
              className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-[11px] font-extrabold text-graphite transition hover:bg-slate-50"
            >
              <Download className="h-3.5 w-3.5" /> {t('shop.downloadInvoice')}
            </button>
            {status && (
              <span className={`rounded-full px-3 py-1 text-[11px] font-extrabold uppercase tracking-wide ring-1 ${STATUS_TONES[status] || STATUS_TONES.PENDING}`}>
                {t(`shop.status.${String(status).toLowerCase()}`)}
              </span>
            )}
            <button type="button" onClick={onClose} aria-label={t('dash.common.close')} className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-slate-500 ring-1 ring-slate-200 transition hover:text-slate-900">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          <div className="grid gap-2.5 sm:grid-cols-2">
            <Fact icon={counterpartyLabel === t('shop.soldBy') ? Store : User} label={counterpartyLabel} value={td(counterparty)} />
            <Fact icon={Home} label={t('shop.deliverToProject')} value={td(order.project)} />
            {/* `toLocaleString()` with no locale followed the browser, not the
                reader; `formatDateTime` follows the selected language. */}
            <Fact icon={CalendarDays} label={t('shop.placedOn')} value={formatDateTime(order.placedAt)} />
            <Fact icon={Hash} label={t('shop.orderReference')} value={String(order.code || '').slice(0, 8)} />
          </div>

          <p className="mt-5 text-[10px] font-extrabold uppercase tracking-wide text-graphite/40">{t('shop.itemsOrdered')}</p>
          <div className="mt-2 overflow-hidden rounded-xl border border-slate-200">
            {order.items.map((item, index) => (
              <div key={item.id} className={`flex items-center gap-3 px-3 py-3 ${index ? 'border-t border-slate-100' : ''}`}>
                {item.image_url ? (
                  <SmartImage
                    src={imageUrl(item.image_url)}
                    alt={td(item.material_name)}
                    className="h-16 w-16 shrink-0 rounded-xl bg-slate-50 object-contain p-1 ring-1 ring-slate-200"
                  />
                ) : (
                  <span className="grid h-16 w-16 shrink-0 place-items-center rounded-xl bg-slate-50 text-slate-300 ring-1 ring-slate-200">
                    <Package className="h-6 w-6" />
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  {/* The product name, its brand, its size and its unit are
                      all typed by the supplier. */}
                  <p className="truncate text-sm font-extrabold text-graphite">{td(item.material_name)}</p>
                  <p className="truncate text-[11px] font-semibold text-graphite/50">
                    {td([item.brand, item.size].filter(Boolean).join(' · ')) || optionLabel(t, SUPPLIER_CATEGORY_KEYS, item.category)}
                  </p>
                  <p className="text-[11px] font-semibold text-graphite/50">
                    {countryFormatMoney(item.price)} {t('dash.supplier.per')} {td(item.unit)}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-sm font-extrabold text-graphite">{formatNumber(item.quantity)} {td(item.unit)}</p>
                  <p className="text-[11px] font-bold text-graphite/50">{countryFormatMoney(lineTotal(item))}</p>
                </div>
              </div>
            ))}
          </div>

          <dl className="mt-4 space-y-2 rounded-xl border border-slate-200 p-3 text-sm">
            <div className="flex items-center justify-between">
              <dt className="font-semibold text-graphite/55">{t('shop.totalQuantity')}</dt>
              {/* Was pinned to en-IN, so the grouping never followed the reader. */}
              <dd className="font-extrabold text-graphite">{formatNumber(totalQuantity)}</dd>
            </div>
            <div className="flex items-center justify-between border-t border-slate-100 pt-2">
              <dt className="font-extrabold text-graphite">{t('shop.estimatedTotal')}</dt>
              <dd className="font-display text-xl font-extrabold text-graphite">{countryFormatMoney(total)}</dd>
            </div>
          </dl>
        </div>

        {actions && <div className="shrink-0 border-t border-slate-100 bg-white p-4">{actions}</div>}
      </div>
    </div>,
    document.body,
  )
}
