import { useCallback, useEffect, useState } from 'react'
import { BarChart3, IndianRupee, ReceiptText, RotateCw } from 'lucide-react'
import { Alert, EmptyState, Spinner, formatDate } from '../../../shared/ui/ui.jsx'
import { apiErrorMessage } from '../../../shared/api/apiClient.js'
import { earningsApi } from '../earningsApi.js'
import { formatRupees } from '../../../shared/utils/money.js'
import { SUMMARY_CARDS, coversWeek, earningTitle, formatPercent, isZeroCommission, toPaise, weeklySeries } from '../earningsFormat.js'

const PAGE = 50
// The weekly chart reads this week's records from the same history endpoint, in
// pages of the server's maximum, and gives up (showing no chart) rather than
// drawing a partial week.
const WEEK_PAGE = 100
const WEEK_MAX_PAGES = 10

/**
 * This week's recorded earnings by India day, or null when they cannot all be
 * read. The chart is drawn only if its total equals the server's own "This Week"
 * figure, so it can never disagree with the card above it.
 */
async function loadWeek(nowMs) {
  const rows = []
  for (let page = 0; page < WEEK_MAX_PAGES; page += 1) {
    const batch = await earningsApi.history({ limit: WEEK_PAGE, offset: rows.length })
    rows.push(...batch)
    const more = batch.length === WEEK_PAGE
    if (coversWeek(rows, more, nowMs)) return weeklySeries(rows, nowMs)
    if (!more) break
  }
  return null
}

/**
 * What the technician has earned: one record per completed, priced job, made by
 * the server when the job was completed. Each shows the job's service price, the
 * platform commission taken from it (at the rate that applied then) and the net.
 *
 * Read-only. There are no payouts yet, so nothing here withdraws, transfers or
 * claims that money has been paid.
 */
export default function EarningsPanel() {
  const [summary, setSummary] = useState(null)
  const [items, setItems] = useState(null)
  const [error, setError] = useState('')
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [week, setWeek] = useState(null)

  const load = useCallback(async () => {
    setError('')
    try {
      const [totals, page] = await Promise.all([earningsApi.summary(), earningsApi.history({ limit: PAGE, offset: 0 })])
      setSummary(totals)
      setItems(page)
      setHasMore(page.length === PAGE)
      // The chart is extra: if it cannot be read, the rest of the page stands.
      loadWeek(Date.now())
        .then((series) => setWeek(series && series.totalPaise === toPaise(totals.week_net) ? series : null))
        .catch(() => setWeek(null))
    } catch (loadError) {
      setError(apiErrorMessage(loadError, 'Your earnings could not be loaded.'))
    }
  }, [])

  useEffect(() => { load() }, [load])

  const loadMore = async () => {
    setLoadingMore(true)
    try {
      const page = await earningsApi.history({ limit: PAGE, offset: items.length })
      setItems((current) => [...current, ...page])
      setHasMore(page.length === PAGE)
    } catch (loadError) {
      setError(apiErrorMessage(loadError, 'More earnings could not be loaded.'))
    } finally {
      setLoadingMore(false)
    }
  }

  if (error && !summary) {
    return (
      <div className="card space-y-3 p-6" data-testid="earnings">
        <Alert tone="error">{error}</Alert>
        <button type="button" className="btn-ghost px-3 py-2" onClick={load}><RotateCw className="h-4 w-4" /> Try again</button>
      </div>
    )
  }
  if (!summary || !items) {
    return (
      <div className="card p-6" data-testid="earnings">
        <p className="flex items-center gap-2 text-sm text-oc-muted" data-testid="earnings-loading"><Spinner className="h-4 w-4" /> Loading your earnings…</p>
      </div>
    )
  }

  return (
    <div className="space-y-5" data-testid="earnings">
      <section className="relative overflow-hidden rounded-[24px] bg-oc-deep px-5 py-5 text-white sm:px-6" data-testid="earnings-hero">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_90%_20%,rgba(244,183,64,.25),transparent_40%)]" />
        <div className="relative flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-oc-amber">This month</p>
            <p className="mt-1 font-display text-3xl font-extrabold tracking-tight sm:text-4xl">{formatRupees(summary.month_net)}</p>
            <p className="mt-1 text-xs text-[#b9d8c5]">Net earnings recorded for completed jobs</p>
          </div>
          <dl className="flex gap-5 text-right">
            <div>
              <dt className="text-[11px] font-bold uppercase tracking-wide text-[#b9d8c5]">Today</dt>
              <dd className="font-display text-lg font-extrabold">{formatRupees(summary.today_net)}</dd>
            </div>
            <div>
              <dt className="text-[11px] font-bold uppercase tracking-wide text-[#b9d8c5]">This week</dt>
              <dd className="font-display text-lg font-extrabold">{formatRupees(summary.week_net)}</dd>
            </div>
          </dl>
        </div>
      </section>

      {week && <WeekChart week={week} />}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {SUMMARY_CARDS.map((card) => (
          <div key={card.key} className="card p-4" data-testid={`earnings-${card.key}`}>
            <p className="text-[11px] font-bold uppercase tracking-wide text-oc-muted">{card.label}</p>
            <p className="mt-1 font-display text-xl font-extrabold text-oc-ink">{formatRupees(summary[card.key])}</p>
          </div>
        ))}
      </div>

      <section className="card p-5" aria-label="Earnings breakdown" data-testid="earnings-breakdown">
        <dl className="grid gap-3 sm:grid-cols-3">
          <Figure label="Gross Service Amount" value={formatRupees(summary.total_gross)} testid="earnings-total-gross" />
          <Figure label="Platform Commission" value={formatRupees(summary.total_commission)} testid="earnings-total-commission" />
          <Figure label="Net Earnings" value={formatRupees(summary.total_net)} testid="earnings-total-net" strong />
        </dl>
        <p className="mt-3 text-xs text-oc-muted">
          Earnings are recorded when you complete a priced job: its service price, less the platform commission that applied
          when you completed it. “Today”, “This Week” and “This Month” follow India time.
        </p>
      </section>

      {error && <Alert tone="error">{error}</Alert>}

      {items.length === 0 ? (
        <EmptyState icon={IndianRupee} title="No earnings yet">Complete a priced job and what you earned from it appears here.</EmptyState>
      ) : (
        <section className="card p-5" aria-labelledby="earnings-history-title">
          <h3 id="earnings-history-title" className="flex items-center gap-2 font-display text-base font-extrabold text-oc-ink">
            <ReceiptText className="h-4 w-4 text-oc-green" /> Earning history
          </h3>
          <ul className="mt-3 divide-y divide-oc-line">
            {items.map((earning) => (
              <li key={earning.id} className="grid gap-2 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center" data-testid="earning-row">
                <div className="min-w-0">
                  <p className="truncate font-display text-sm font-extrabold text-oc-ink">{earningTitle(earning)}</p>
                  <p className="text-xs text-oc-muted">Completed {formatDate(earning.earned_at)}</p>
                </div>
                <dl className="grid grid-cols-3 gap-3 text-right text-xs sm:w-[420px]">
                  <Amount label="Service price" value={formatRupees(earning.gross_amount)} />
                  <Amount
                    label={`Commission ${formatPercent(earning.commission_rate)}`}
                    value={isZeroCommission(earning.commission_rate) ? `${formatRupees(earning.commission_amount)} (none)` : `− ${formatRupees(earning.commission_amount)}`}
                    testid="earning-commission"
                  />
                  <Amount label="You earned" value={formatRupees(earning.net_amount)} strong testid="earning-net" />
                </dl>
              </li>
            ))}
          </ul>
          {hasMore && (
            <button type="button" className="btn-ghost mt-3 w-full" onClick={loadMore} disabled={loadingMore} data-testid="earnings-more">
              {loadingMore ? <Spinner className="h-4 w-4" /> : null} Show more
            </button>
          )}
        </section>
      )}
    </div>
  )
}

/** Seven bars, Monday first, of this week's recorded net earnings. */
function WeekChart({ week }) {
  const max = Math.max(...week.days.map((day) => day.paise), 0)
  return (
    <section className="card p-5" aria-labelledby="earnings-week-title" data-testid="earnings-week-chart">
      <div className="flex items-baseline justify-between gap-3">
        <h3 id="earnings-week-title" className="flex items-center gap-2 font-display text-base font-extrabold text-oc-ink">
          <BarChart3 className="h-4 w-4 text-oc-green" /> Earnings this week
        </h3>
        <p className="text-sm text-oc-muted">Total <strong className="font-display text-oc-ink" data-testid="earnings-week-total">{formatRupees(week.totalPaise / 100)}</strong></p>
      </div>
      <ol className="mt-4 grid h-44 grid-cols-7 items-end gap-1.5 sm:gap-3">
        {week.days.map((day) => {
          const height = max > 0 ? Math.max(4, Math.round((day.paise / max) * 100)) : 4
          const amount = formatRupees(day.paise / 100)
          return (
            <li key={day.label} className="flex h-full min-w-0 flex-col items-center gap-1" data-testid="earnings-week-day" aria-label={`${day.label}: ${amount}`}>
              <span className={`w-full truncate text-center text-[10px] font-bold sm:text-xs ${day.paise > 0 ? 'text-oc-ink' : 'text-transparent'}`}>{amount}</span>
              <span className="flex min-h-0 w-full flex-1 items-end justify-center">
                <span
                  className={`w-full max-w-[44px] rounded-t-lg ${day.paise > 0 ? (day.isToday ? 'bg-oc-amber' : 'bg-oc-green') : 'bg-oc-sunken'}`}
                  style={{ height: `${height}%` }}
                />
              </span>
              <span className={`text-[11px] font-bold ${day.isToday ? 'text-oc-green' : 'text-oc-muted'}`}>{day.label}</span>
            </li>
          )
        })}
      </ol>
      <p className="mt-3 text-xs text-oc-muted">Monday to Sunday, India time. Each bar adds up the net earnings recorded that day.</p>
    </section>
  )
}

function Figure({ label, value, strong = false, testid }) {
  return (
    <div className={`rounded-xl border px-4 py-3 ${strong ? 'border-oc-green bg-oc-mint/40' : 'border-oc-line'}`} data-testid={testid}>
      <dt className="text-[11px] font-bold uppercase tracking-wide text-oc-muted">{label}</dt>
      <dd className="mt-0.5 font-display text-lg font-extrabold text-oc-ink">{value}</dd>
    </div>
  )
}

function Amount({ label, value, strong = false, testid }) {
  return (
    <div data-testid={testid}>
      <dt className="text-[10px] font-bold uppercase tracking-wide text-oc-muted">{label}</dt>
      <dd className={`font-display ${strong ? 'text-sm font-extrabold text-oc-green' : 'text-sm font-bold text-oc-ink'}`}>{value}</dd>
    </div>
  )
}
