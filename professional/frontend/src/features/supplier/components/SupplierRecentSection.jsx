/**
 * Compact recent-activity panels for the supplier home dashboard.
 *
 * Two cards built entirely from records the dashboard already holds, so no new
 * API or fabricated rows are involved:
 *  - Recent Requests lists the latest partnership requests (owners/builders),
 *    with the same requester/status vocabulary the Requests page uses.
 *  - Recent Activity merges the newest real events from the supplier's own
 *    orders, catalogue additions and project assignments, sorted by their
 *    stored timestamps. An entry only exists when the underlying record does.
 */

import { useMemo } from 'react'
import { Activity, ArrowRight, ChevronRight, ClipboardList, FolderKanban, Package, ShoppingCart } from 'lucide-react'
import { useLanguage } from '../../../i18n/LanguageContext.jsx'
import { userAvatarSrc } from '../../../shared/ui/avatars.js'
import { formatDate as formatLocalisedDate, formatRelativeTime } from '../../../shared/utils/formatters.js'
import { SUPPLIER_CATEGORY_KEYS, optionLabel } from '../../../i18n/optionKeys.js'

// The same day/month/year shape as before, but in the selected language: the
// pinned 'en-GB' printed "Sep" in all seven.
const formatDate = (value) => formatLocalisedDate(value, '—')

// Request statuses, exactly as the Requests page reads them (lowercase), with
// the same labels, so a card never disagrees with the page.
const REQUEST_STATUS_KEYS = {
  pending: 'ui.status.pending',
  accepted: 'ui.requests.accepted',
  rejected: 'ui.requests.rejected',
  withdrawn: 'ui.shared.statusWithdrawn',
}
// Filled status pills for the request rows.
const REQUEST_PILLS = {
  pending: 'bg-amber-50 text-amber-700',
  accepted: 'bg-emerald-50 text-emerald-700',
  rejected: 'bg-rose-50 text-rose-700',
  withdrawn: 'bg-slate-100 text-slate-600',
  sent: 'bg-sky-50 text-sky-700',
}

const KIND_META = {
  order: { icon: ShoppingCart, tile: 'bg-amber-50 text-amber-700', labelKey: 'dash.supplier.actOrder' },
  product: { icon: Package, tile: 'bg-emerald-50 text-emerald-700', labelKey: 'dash.supplier.actProduct' },
  project: { icon: FolderKanban, tile: 'bg-sky-50 text-sky-700', labelKey: 'dash.supplier.actProject' },
}

// parts: which panels to draw ('requests', 'activity'); the dashboard lays them out.
export default function SupplierRecentSection({ requestList = [], materialRequestList = [], productList = [], myProjectsList = [], onNavigate, parts = ['requests', 'activity'] }) {
  const { t, td } = useLanguage()

  const requesterLabel = (request) => (request.sender_role === 'OWNER' ? t('role.owner') : t('role.builder'))
  const recentRequests = useMemo(() => (
    [...requestList]
      .sort((first, second) => String(second.created_at || '').localeCompare(String(first.created_at || '')))
      .slice(0, 4)
  ), [requestList])

  // The activity feed: one entry per real order (checkout), product or project
  // assignment, each carrying the timestamp its record stores.
  const activityItems = useMemo(() => {
    const events = []
    const ordersByCode = new Map()
    materialRequestList.forEach((row) => {
      const code = row.request_code || `row-${row.id}`
      const existing = ordersByCode.get(code)
      if (existing) {
        existing.lines += 1
      } else {
        ordersByCode.set(code, { ...row, lines: 1 })
      }
    })
    ordersByCode.forEach((order) => {
      events.push({
        at: order.created_at,
        kind: 'order',
        title: td(order.engineer_name || order.owner_name) || t('dash.supplier.requester'),
        context: td(order.project_name || ''),
        // The count only ever reads the plural because the branch is entered
        // only above one; a single line shows the material's own name instead.
        detail: order.lines > 1 ? `${order.lines} ${t('shop.itemMany')}` : td(order.material_name || ''),
        status: order.status,
      })
    })
    productList
      .slice()
      .sort((first, second) => String(second.created_at || '').localeCompare(String(first.created_at || '')))
      .slice(0, 5)
      .forEach((product) => {
        events.push({
          at: product.created_at,
          kind: 'product',
          title: product.name ? td(product.name) : t('dash.supplier.actProduct'),
          context: optionLabel(t, SUPPLIER_CATEGORY_KEYS, product.category) || '',
          detail: '',
        })
      })
    myProjectsList.forEach((project) => {
      events.push({
        at: project.assigned_on,
        kind: 'project',
        title: project.title ? td(project.title) : t('dash.supplier.actProject'),
        context: td(project.requester?.name || ''),
        detail: '',
      })
    })
    return events
      .filter((event) => event.at)
      .sort((first, second) => String(second.at).localeCompare(String(first.at)))
      .slice(0, 5)
    // `td` is a dependency because its identity changes when a batch of
    // translations arrives; without it the feed would keep the originals it
    // was built from.
  }, [materialRequestList, myProjectsList, productList, t, td])

  // The requester's own avatar, from the request row their name came from.
  const requestAvatar = (request) => {
    const name = td(request.profile_name || request.sender_name) || 'R'
    return (
      <span className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-full bg-brand-50 ring-1 ring-brand-100">
        <img src={userAvatarSrc(request)} alt={name} className="h-full w-full object-cover" />
      </span>
    )
  }

  const viewAll = (sectionId) => (
    <button
      type="button"
      onClick={() => onNavigate?.(sectionId)}
      className="inline-flex shrink-0 items-center gap-1 text-xs font-extrabold text-brand-700 transition hover:text-brand-800"
    >
      {t('dash.viewAll')}
      <ArrowRight className="h-3.5 w-3.5 rtl:-scale-x-100" />
    </button>
  )

  return (
    <>
      {/* Recent Requests — the same records the Requests page lists. */}
      {parts.includes('requests') && (
        <div className="flex flex-col rounded-2xl border border-slate-200 bg-white px-4 py-3.5 shadow-[0_14px_40px_-30px_rgba(15,23,42,0.35)]">
          <div className="mb-2 flex items-center justify-between gap-3">
            <p className="flex items-center gap-2 font-display text-[15px] font-extrabold text-graphite">
              <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand-50 text-brand-700 ring-1 ring-brand-100">
                <ClipboardList className="h-4 w-4" />
              </span>
              {t('dash.supplier.recentRequests')}
            </p>
            {requestList.length > 0 && viewAll('incomingRequests')}
          </div>
          {recentRequests.length ? (
            <div className="divide-y divide-slate-100">
              {recentRequests.map((request) => {
                const status = request.is_sender && String(request.status || '').toLowerCase() === 'pending' ? 'sent' : String(request.status || '').toLowerCase()
                const name = td(request.profile_name || request.sender_name) || t('dash.supplier.requester')
                return (
                  <button
                    key={request.id}
                    type="button"
                    onClick={() => onNavigate?.('incomingRequests')}
                    className="group flex w-full items-center gap-3 py-2.5 text-left transition hover:bg-slate-50/60"
                  >
                    {requestAvatar(request)}
                    <span className="min-w-0 flex-[1.1]">
                      <span className="block truncate text-[13px] font-bold text-graphite">{name}</span>
                      <span className="block truncate text-[11px] text-graphite/55">{requesterLabel(request)}</span>
                    </span>
                    <span className="hidden min-w-0 flex-1 truncate text-[13px] text-graphite/75 sm:block">{td(request.project_title || '')}</span>
                    <span className={`shrink-0 rounded-lg px-2.5 py-1 text-[11px] font-semibold ${REQUEST_PILLS[status] || REQUEST_PILLS.withdrawn}`}>
                      {status === 'sent' ? t('dash.sent') : (REQUEST_STATUS_KEYS[status] ? t(REQUEST_STATUS_KEYS[status]) : status)}
                    </span>
                    <span className="hidden w-24 shrink-0 text-right text-[11px] text-graphite/50 md:block">{formatDate(request.created_at)}</span>
                    <ChevronRight className="h-4 w-4 shrink-0 text-graphite/40 transition group-hover:translate-x-0.5 rtl:-scale-x-100" />
                  </button>
                )
              })}
            </div>
          ) : (
            <p className="rounded-xl bg-slate-50/70 px-3 py-6 text-center text-xs font-semibold text-graphite/45">
              {t('ui.requests.noRequests')}
            </p>
          )}
        </div>
      )}

      {/* Recent Activity — newest real orders, products and project assignments, as a timeline. */}
      {parts.includes('activity') && (
        <div className="flex flex-col rounded-2xl border border-slate-200 bg-white px-4 py-3.5 shadow-[0_14px_40px_-30px_rgba(15,23,42,0.35)]">
          <div className="mb-2 flex items-center justify-between gap-3">
            <p className="flex items-center gap-2 font-display text-[15px] font-extrabold text-graphite">
              <span className="grid h-8 w-8 place-items-center rounded-lg bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100">
                <Activity className="h-4 w-4" />
              </span>
              {t('dash.common.recentActivity')}
            </p>
            {materialRequestList.length > 0 && viewAll('orders')}
          </div>
          {activityItems.length ? (
            <ol className="relative">
              {activityItems.map((event, index) => {
                const meta = KIND_META[event.kind] || KIND_META.order
                const Icon = meta.icon
                const last = index === activityItems.length - 1
                return (
                  <li key={`${event.kind}-${event.title}-${event.at}`} className="relative flex items-start gap-3 py-2 ps-5">
                    {/* The timeline: a dot per entry joined by a line. */}
                    {!last && <span className="absolute start-[5px] top-5 h-full w-px bg-emerald-200" aria-hidden="true" />}
                    <span className="absolute start-0 top-[18px] h-[11px] w-[11px] rounded-full border-2 border-white bg-emerald-600 ring-1 ring-emerald-200" aria-hidden="true" />
                    <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ring-1 ${meta.tile}`}>
                      <Icon className="h-4 w-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-bold text-graphite">{t(meta.labelKey)}</p>
                      <p className="truncate text-[11px] text-graphite/55">
                        {event.title}
                        {event.context ? ` · ${event.context}` : ''}
                        {event.detail ? ` · ${event.detail}` : ''}
                      </p>
                    </div>
                    <span className="shrink-0 whitespace-nowrap pt-0.5 text-[11px] text-graphite/50">{formatRelativeTime(event.at)}</span>
                  </li>
                )
              })}
            </ol>
          ) : (
            <p className="rounded-xl bg-slate-50/70 px-3 py-6 text-center text-xs font-semibold text-graphite/45">
              {t('dash.common.noRecentActivity')}
            </p>
          )}
        </div>
      )}
    </>
  )
}
