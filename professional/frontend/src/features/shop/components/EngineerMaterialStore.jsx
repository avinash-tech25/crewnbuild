/**
 * The Site Engineer's Store (/engineer/store): the selected project's materials, one card per
 * product and variant, drawn like the Supplier's Products (the shared ListCard grid).
 *
 *   In stock (big number + unit), Received total, Used total, last updated, and the stock
 *   status pill (In stock / Low stock / Out of stock).
 *   Low-stock level  set by the assigned Site Engineer or the builder, in the stock's unit;
 *                  "Low stock" shows at or below it (0 turns it off).
 *   Record usage   quantity, date and an optional note; the server refuses more than is in
 *                  stock, zero or less, another unit, and anyone but the assigned engineer.
 *   History        every movement (received from an order or a daily-record purchase, used
 *                  from the Store or a daily record) in a dialog, ?movements=<stock id>.
 *   Reorder        the supplier catalog on the product (?product=<listing id>).
 *
 * Stock goes up when the supplier delivers an order line, not when it is accepted. Usage
 * recorded here and in the daily record lowers the same balance. Orders stay on Orders.
 * Project, filter and sort are in the address (?project=, ?stock=, ?sort=); the search is not.
 */
import { useMemo, useState } from 'react'
import { BellRing, History, ImageOff, Minus, PackageOpen, RefreshCw, Search } from 'lucide-react'
import { useLanguage } from '../../../i18n/LanguageContext.jsx'
import { apiErrorMessage } from '../../../shared/auth/accountPaths.js'
import { imageUrl } from '../../../shared/api/apiClient.js'
import useUrlState from '../../../shared/hooks/useUrlState.js'
import useUrlDialog from '../../../shared/hooks/useUrlDialog.js'
import AppLink from '../../../shared/navigation/AppLink.jsx'
import { CardAvatar, CardChip, CardGrid, ListCard, cardButtonClass } from '../../../shared/ui/ListCard.jsx'
import { DetailDialog, DetailSection } from '../../../shared/ui/DetailDialog.jsx'
import { Skeleton } from '../../../shared/ui/Skeleton.jsx'
import { formatDate, formatDateTime, formatNumber } from '../../../shared/utils/formatters.js'
import { StockCardStatus, stockState } from '../../catalog/components/StockBadge.jsx'
import { recordMaterialUsage, setMaterialThreshold, useMaterialMovementsQuery, useMaterialStoreQuery } from '../materialStoreApi.js'

const FILTERS = ['all', 'in', 'low', 'out']
const FILTER_KEYS = { all: 'store.filter.all', in: 'store.filter.in', low: 'store.filter.low', out: 'store.filter.out' }
const SORTS = ['name', 'most', 'least', 'recent']
const SORT_KEYS = { name: 'store.sort.name', most: 'store.sort.most', least: 'store.sort.least', recent: 'store.sort.recent' }
const field = 'h-10 rounded-xl border border-slate-200 bg-white px-2.5 text-sm font-semibold text-graphite focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100'
const todayIso = () => {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}
const time = (value) => (value ? new Date(value).getTime() || 0 : 0)
const quantity = (value) => formatNumber(Math.round(Number(value || 0) * 1000) / 1000, '0')

function StoreCard({ item, canRecord, canSetThreshold, onRecord, onThreshold, onHistory }) {
  const { t, td } = useLanguage()
  const low = stockState(item.in_stock, item.minimum_stock) === 'low'
  return (
    <ListCard
      testId="store-card"
      label={item.name}
      avatar={<CardAvatar src={item.image_url ? imageUrl(item.image_url) : null} alt="" fallback={<ImageOff aria-hidden="true" className="h-5 w-5" />} />}
      title={td(item.name)}
      subtitle={[item.brand, item.size].filter(Boolean).join(' · ') || null}
      status={<StockCardStatus quantity={item.in_stock} threshold={item.minimum_stock} unit={item.unit} />}
      chips={[low && <CardChip key="low" tone="amber">{t('store.lowBadge')}</CardChip>]}
      rows={[
        { label: t('store.received'), value: `${quantity(item.received_total)} ${item.unit}` },
        { label: t('store.used'), value: `${quantity(item.used_total)} ${item.unit}` },
        { label: t('store.threshold'), value: Number(item.minimum_stock) > 0 ? `${quantity(item.minimum_stock)} ${item.unit}` : t('store.thresholdOff') },
        { label: t('store.updated'), value: formatDateTime(item.updated_at) || '—' },
      ]}
      primary={canRecord ? (
        <button type="button" onClick={onRecord} disabled={item.in_stock <= 0} className={cardButtonClass('primary')}>
          <Minus aria-hidden="true" className="h-3.5 w-3.5" /> {t('store.recordUsage')}
        </button>
      ) : null}
      secondary={(
        <>
          {canSetThreshold && (
            <button type="button" onClick={onThreshold} aria-label={`${t('store.setThreshold')}: ${td(item.name)}`} title={t('store.setThreshold')} className={cardButtonClass('secondary')}>
              <BellRing aria-hidden="true" className="h-3.5 w-3.5" />
            </button>
          )}
          <button type="button" onClick={onHistory} className={cardButtonClass('secondary')}>
            <History aria-hidden="true" className="h-3.5 w-3.5" /> {t('store.history')}
          </button>
          {item.listing_id && (
            <AppLink href={`/engineer/my-supplies?tab=suppliers&product=${encodeURIComponent(item.listing_id)}`} className={cardButtonClass('secondary')}>
              <RefreshCw aria-hidden="true" className="h-3.5 w-3.5" /> {t('store.reorder')}
            </AppLink>
          )}
        </>
      )}
    >
      <p className="flex items-baseline gap-1.5" data-testid="store-in-stock">
        <span className="font-display text-3xl font-extrabold leading-none tracking-[-0.02em] text-graphite">{quantity(item.in_stock)}</span>
        <span className="text-sm font-bold text-graphite/70">{item.unit}</span>
        <span className="ms-1 text-xs font-semibold text-graphite/60">{t('store.inStock')}</span>
      </p>
    </ListCard>
  )
}

function UsageDialog({ projectId, item, onClose, onSaved }) {
  const { t, td } = useLanguage()
  const [amount, setAmount] = useState('')
  const [usedOn, setUsedOn] = useState(todayIso())
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const value = Number(amount)
  const tooMuch = Number.isFinite(value) && value > Number(item.in_stock)

  async function submit(event) {
    event.preventDefault()
    if (busy) return
    if (!(value > 0)) { setError(t('store.error.positive')); return }
    if (tooMuch) { setError(t('store.error.tooMuch', { stock: quantity(item.in_stock), unit: item.unit })); return }
    setBusy(true)
    setError('')
    try {
      await recordMaterialUsage({ projectId, stockId: item.id, quantity: value, unit: item.unit, used_on: usedOn, note: note.trim() || null })
      onSaved()
    } catch (failure) {
      setError(td(apiErrorMessage(failure, t('store.error.save'))))
      setBusy(false)
    }
  }

  return (
    <DetailDialog label={t('store.recordUsage')} title={td(item.name)} onClose={onClose} testId="store-usage-dialog">
      <form onSubmit={submit} noValidate className="mx-auto w-full max-w-md space-y-4">
        <p className="text-sm font-semibold text-graphite/70">
          {t('store.inStock')}: <b className="text-graphite">{quantity(item.in_stock)} {item.unit}</b>
        </p>
        <label className="block space-y-1">
          <span className="text-xs font-extrabold text-graphite">{t('store.quantityUsed')} ({item.unit})</span>
          <input
            type="number" inputMode="decimal" min="0" step="any" required autoFocus
            value={amount} onChange={(event) => setAmount(event.target.value)}
            aria-invalid={Boolean(error) || undefined} aria-describedby={error ? 'store-usage-error' : undefined}
            className={`${field} w-full`}
          />
        </label>
        <label className="block space-y-1">
          <span className="text-xs font-extrabold text-graphite">{t('store.usedOn')}</span>
          <input type="date" max={todayIso()} value={usedOn} onChange={(event) => setUsedOn(event.target.value)} className={`${field} w-full`} />
        </label>
        <label className="block space-y-1">
          <span className="text-xs font-extrabold text-graphite">{t('store.note')}</span>
          <textarea rows={2} maxLength={500} value={note} onChange={(event) => setNote(event.target.value)} className="w-full rounded-xl border border-slate-200 bg-white px-2.5 py-2 text-sm text-graphite focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100" />
        </label>
        {error && <p id="store-usage-error" role="alert" className="rounded-xl bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className={cardButtonClass('secondary')}>{t('dash.common.cancel')}</button>
          <button type="submit" disabled={busy} aria-busy={busy || undefined} className={cardButtonClass('primary')}>
            {busy ? t('store.saving') : t('store.saveUsage')}
          </button>
        </div>
      </form>
    </DetailDialog>
  )
}

function ThresholdDialog({ projectId, item, onClose, onSaved }) {
  const { t, td } = useLanguage()
  const [level, setLevel] = useState(Number(item.minimum_stock) > 0 ? String(item.minimum_stock) : '')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(event) {
    event.preventDefault()
    if (busy) return
    const value = level.trim() === '' ? 0 : Number(level)
    if (!Number.isFinite(value) || value < 0) { setError(t('store.error.thresholdNegative')); return }
    setBusy(true)
    setError('')
    try {
      await setMaterialThreshold({ projectId, stockId: item.id, minimum_stock: value, unit: item.unit })
      onSaved()
    } catch (failure) {
      setError(td(apiErrorMessage(failure, t('store.error.save'))))
      setBusy(false)
    }
  }

  return (
    <DetailDialog label={t('store.setThreshold')} title={td(item.name)} onClose={onClose} testId="store-threshold-dialog">
      <form onSubmit={submit} noValidate className="mx-auto w-full max-w-md space-y-4">
        <p className="text-sm text-graphite/70">{t('store.thresholdHint')}</p>
        <label className="block space-y-1">
          <span className="text-xs font-extrabold text-graphite">{t('store.threshold')} ({item.unit})</span>
          <input
            type="number" inputMode="decimal" min="0" step="any" autoFocus
            value={level} onChange={(event) => setLevel(event.target.value)}
            aria-invalid={Boolean(error) || undefined} aria-describedby={error ? 'store-threshold-error' : undefined}
            className={`${field} w-full`}
          />
        </label>
        {error && <p id="store-threshold-error" role="alert" className="rounded-xl bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className={cardButtonClass('secondary')}>{t('dash.common.cancel')}</button>
          <button type="submit" disabled={busy} aria-busy={busy || undefined} className={cardButtonClass('primary')}>
            {busy ? t('store.saving') : t('store.saveThreshold')}
          </button>
        </div>
      </form>
    </DetailDialog>
  )
}

const SOURCE_KEYS = { ORDER: 'store.source.order', DAILY_RECORD: 'store.source.dailyRecord', STORE_USAGE: 'store.source.store', OPENING: 'store.source.opening' }

function HistoryDialog({ projectId, stockId, fallback, onClose }) {
  const { t, td } = useLanguage()
  const history = useMaterialMovementsQuery({ projectId, stockId }, { refetchOnMountOrArgChange: true })
  const item = history.data?.item || fallback
  const movements = history.data?.movements || []
  const sourceText = (source) => {
    const label = t(SOURCE_KEYS[source.kind] || 'store.source.store')
    if (source.kind === 'ORDER') return `${label} #${source.number}`
    if (source.kind === 'DAILY_RECORD' && source.date) return `${label} · ${formatDate(source.date)}`
    return label
  }
  return (
    <DetailDialog label={t('store.history')} title={item ? td(item.name) : t('store.history')} onClose={onClose} testId="store-history-dialog"
      status={item ? <span>{t('store.inStock')}: <b className="text-graphite">{quantity(item.in_stock)} {item.unit}</b> · {t('store.received')} {quantity(item.received_total)} · {t('store.used')} {quantity(item.used_total)}</span> : null}>
      <DetailSection title={t('store.movements')}>
        {history.isLoading ? <Skeleton className="h-24" /> : history.isError ? (
          <p role="alert" className="text-sm font-bold text-rose-700">{t('store.error.load')}</p>
        ) : !movements.length ? (
          <p className="text-sm text-graphite/70">{t('store.noMovements')}</p>
        ) : (
          <ul className="divide-y divide-slate-100" aria-label={t('store.movements')}>
            {movements.map((movement) => {
              const used = movement.kind === 'USED'
              return (
                <li key={movement.id} data-testid="store-movement" className="flex flex-wrap items-start justify-between gap-2 py-2.5">
                  <div className="min-w-0">
                    <p className="text-sm font-extrabold text-graphite">{t(used ? 'store.kind.used' : movement.kind === 'OPENING' ? 'store.kind.opening' : 'store.kind.received')}</p>
                    <p className="text-xs font-semibold text-graphite/70">
                      {[sourceText(movement.source), movement.by && td(movement.by), movement.at && formatDate(movement.at)].filter(Boolean).join(' · ')}
                    </p>
                    {movement.note && <p className="mt-0.5 text-xs text-graphite/70">{movement.note}</p>}
                  </div>
                  <span className={`whitespace-nowrap text-sm font-extrabold ${used ? 'text-rose-700' : 'text-emerald-700'}`}>
                    {used ? '−' : '+'}{quantity(movement.quantity)} {movement.unit}
                  </span>
                </li>
              )
            })}
          </ul>
        )}
      </DetailSection>
    </DetailDialog>
  )
}

// `projectsLoaded`: the engineer's project list has answered (until then: skeletons, not the empty state).
export default function EngineerMaterialStore({ projects = [], projectsLoaded = true }) {
  const { t, td } = useLanguage()
  const projectIds = projects.map((project) => String(project.id))
  const [pickedProject, setProject] = useUrlState('project', projectIds[0] || '', projectIds.length ? projectIds : null)
  const projectId = projectIds.includes(pickedProject) ? pickedProject : projectIds[0] || ''
  const [filter, setFilter] = useUrlState('stock', 'all', FILTERS)
  const [sort, setSort] = useUrlState('sort', 'name', SORTS)
  const [search, setSearch] = useState('')
  const [usageFor, setUsageFor] = useState(null)
  const [thresholdFor, setThresholdFor] = useState(null)
  const [historyId, openHistory, closeHistory] = useUrlDialog('movements')
  const [saved, setSaved] = useState('')
  const store = useMaterialStoreQuery(projectId, { skip: !projectId, refetchOnMountOrArgChange: true })
  const items = useMemo(() => store.data?.items || [], [store.data])
  const canRecord = Boolean(store.data?.can_record_usage)
  const canSetThreshold = Boolean(store.data?.can_set_threshold)

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase()
    const compare = {
      name: (a, b) => String(a.name).localeCompare(String(b.name)),
      most: (a, b) => b.in_stock - a.in_stock,
      least: (a, b) => a.in_stock - b.in_stock,
      recent: (a, b) => time(b.updated_at) - time(a.updated_at),
    }[sort]
    return items
      .filter((item) => filter === 'all' || stockState(item.in_stock, item.minimum_stock) === filter)
      .filter((item) => !needle || [item.name, item.brand, item.size, item.material].filter(Boolean).some((value) => String(value).toLowerCase().includes(needle)))
      .sort(compare)
  }, [items, filter, sort, search])

  return (
    <section className="space-y-4" aria-label={t('shop.purchase.store')}>
      <div className="flex flex-wrap items-end gap-2">
        <h2 className="me-auto font-display text-lg font-extrabold">{t('shop.purchase.store')}</h2>
        <label className="flex items-center gap-2 text-xs font-bold text-graphite/70">
          <span>{t('dash.common.project')}</span>
          <select value={projectId} onChange={(event) => setProject(event.target.value)} className={field} disabled={!projects.length}>
            {projects.map((project) => <option key={project.id} value={project.id}>{td(project.title)}</option>)}
          </select>
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative min-w-[12rem] flex-1">
          <span className="sr-only">{t('store.search')}</span>
          <Search aria-hidden="true" className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t('store.search')} className={`${field} w-full ps-9`} />
        </label>
        <label className="flex items-center gap-2 text-xs font-bold text-graphite/70">
          <span>{t('store.show')}</span>
          <select value={filter} onChange={(event) => setFilter(event.target.value)} className={field}>
            {FILTERS.map((id) => <option key={id} value={id}>{t(FILTER_KEYS[id])}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-2 text-xs font-bold text-graphite/70">
          <span>{t('shop.eo.sortBy')}</span>
          <select value={sort} onChange={(event) => setSort(event.target.value)} className={field}>
            {SORTS.map((id) => <option key={id} value={id}>{t(SORT_KEYS[id])}</option>)}
          </select>
        </label>
      </div>

      {saved && <p role="status" className="rounded-xl border border-brand-200 bg-brand-50 px-3.5 py-2 text-xs font-bold text-brand-900">{saved}</p>}

      {projectsLoaded && !projects.length ? (
        <Empty title={t('store.empty')} hint={t('store.noProjects')} />
      ) : !projectsLoaded || store.isLoading || (store.isFetching && !store.data) ? (
        <div role="status" aria-busy="true">
          <span className="sr-only">{t('loader.label')}</span>
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }, (_, index) => <Skeleton key={index} className="h-[218px] rounded-2xl" />)}
          </div>
        </div>
      ) : store.isError ? (
        <p role="alert" className="rounded-xl bg-rose-50 px-4 py-3 text-sm font-bold text-rose-700">{td(apiErrorMessage(store.error, t('store.error.load')))}</p>
      ) : !items.length ? (
        <Empty title={t('store.empty')} hint={t('store.emptyHint')} />
      ) : !visible.length ? (
        <Empty title={t('store.noMatch')} />
      ) : (
        <CardGrid testId="store-cards" label={t('shop.purchase.store')}>
          {visible.map((item) => (
            <StoreCard
              key={item.id}
              item={item}
              canRecord={canRecord}
              canSetThreshold={canSetThreshold}
              onRecord={() => { setSaved(''); setUsageFor(item) }}
              onThreshold={() => { setSaved(''); setThresholdFor(item) }}
              onHistory={() => openHistory(item.id)}
            />
          ))}
        </CardGrid>
      )}

      {usageFor && (
        <UsageDialog
          projectId={projectId}
          item={usageFor}
          onClose={() => setUsageFor(null)}
          onSaved={() => {
            setSaved(t('store.usageSaved', { name: td(usageFor.name) }))
            setUsageFor(null)
            store.refetch()
          }}
        />
      )}
      {thresholdFor && (
        <ThresholdDialog
          projectId={projectId}
          item={thresholdFor}
          onClose={() => setThresholdFor(null)}
          onSaved={() => {
            setSaved(t('store.thresholdSaved', { name: td(thresholdFor.name) }))
            setThresholdFor(null)
            store.refetch()
          }}
        />
      )}
      {historyId && projectId && (
        <HistoryDialog projectId={projectId} stockId={historyId} fallback={items.find((item) => item.id === historyId)} onClose={() => closeHistory()} />
      )}
    </section>
  )
}

function Empty({ title, hint }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center">
      <PackageOpen aria-hidden="true" className="mx-auto h-9 w-9 text-slate-400" />
      <p className="mt-2 font-bold text-graphite">{title}</p>
      {hint && <p className="mx-auto mt-1 max-w-sm text-sm text-graphite/70">{hint}</p>}
    </div>
  )
}
