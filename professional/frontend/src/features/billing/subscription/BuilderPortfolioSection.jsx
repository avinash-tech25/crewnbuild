import { useCallback, useEffect, useState } from 'react'
import { Activity, BarChart3, CalendarDays, Camera, Download, FileSpreadsheet, FolderKanban, Gauge, Lock, RefreshCw } from 'lucide-react'
import { useLanguage } from '../../../i18n/LanguageContext.jsx'
import { formatMoney } from '../../../shared/utils/countryConfig.js'
import { activeLocale } from '../../../shared/utils/formatters.js'
import { downloadPortfolioExport, downloadProjectSummary, fetchBuilderPortfolio } from '../subscriptionApi.js'
import LockedFeature from './LockedFeature.jsx'
import TierBadge from './TierBadge.jsx'
import { currentTier, featureSummary } from './planComparison.js'
import { formatPlanDate, hasFeature, isPremium, lockedReason } from './subscriptionFormat.js'

const COST_FIELDS = [
  ['labour_cost', 'se.labourCost'],
  ['material_cost', 'se.materialCost'],
  ['equipment_cost', 'se.equipmentCost'],
  ['total_expenses', 'se.otherExpenses'],
]
// The portfolio-level lines a Professional plan does not include.
const PORTFOLIO_REPORT_FEATURES = ['advanced_cost_summary', 'consolidated_export']

function ProgressBar({ value }) {
  const width = Math.max(0, Math.min(100, Number(value) || 0))
  return (
    <span className="mt-1 block h-1.5 w-full overflow-hidden rounded-full bg-slate-100" aria-hidden="true">
      <span className="block h-full rounded-full bg-emerald-500" style={{ width: `${width}%` }} />
    </span>
  )
}

// The Professional/Business portfolio. The server decides access (403 -> locked
// notice); the status is only used to label buttons, never to grant anything.
export default function BuilderPortfolioSection({ subscription, onViewPlans, onOpenProjects = null }) {
  const { t } = useLanguage()
  const [data, setData] = useState(null)
  const [locked, setLocked] = useState(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const status = subscription?.status
  const statusKeyForReload = `${status?.status}-${status?.plan_code}`

  const load = useCallback(async () => {
    setBusy(true)
    setMessage('')
    setLoadFailed(false)
    try {
      setData(await fetchBuilderPortfolio())
      setLocked(null)
    } catch (error) {
      const reason = lockedReason(error)
      if (reason) { setLocked(reason); setData(null) } else setLoadFailed(true)
    } finally {
      setBusy(false)
    }
  }, [t])

  useEffect(() => { load() }, [load, statusKeyForReload])

  const download = async (task) => {
    setMessage('')
    try { await task() } catch (error) {
      const reason = lockedReason(error)
      setMessage(reason ? (reason.kind === 'expired' ? t('subscription.locked.expired') : t('subscription.locked.required', { plan: t(`subscription.plan.${reason.requiredPlan}`) })) : t('subscription.portfolio.downloadFailed'))
    }
  }

  if (locked) return <LockedFeature reason={locked} onViewPlans={onViewPlans} />

  const locale = activeLocale()
  const canExportProject = hasFeature(status, 'project_summary_export')
  const canExportAll = hasFeature(status, 'consolidated_export')
  const canCorrect = hasFeature(status, 'bill_adjustments')
  const advanced = Boolean(data?.advanced)
  const summary = data?.summary
  const reportMissing = featureSummary(status).missing.filter((line) => PORTFOLIO_REPORT_FEATURES.includes(line.id))
  const tierKey = advanced ? 'BUSINESS' : 'PROFESSIONAL'
  // The header's look only: the server's answer once loaded, the plan in force before.
  const dark = data ? advanced : currentTier(status) === 'BUSINESS'
  const sum = (totals) => COST_FIELDS.reduce((total, [field]) => total + Number(totals?.[field] || 0), 0)

  return (
    <div className="grid gap-5">
      <section className={`rounded-2xl border p-5 shadow-sm ${dark ? 'border-slate-800 bg-slate-900 text-white' : 'border-emerald-200 bg-white'}`}>
        <div className="flex flex-wrap items-start gap-3">
          <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${dark ? 'bg-amber-300 text-slate-950' : 'bg-emerald-50 text-emerald-700'}`} aria-hidden="true">
            <BarChart3 className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className={`min-w-0 text-lg font-extrabold [overflow-wrap:anywhere] ${dark ? 'text-white' : 'text-slate-950'}`}>{t('subscription.portfolio.title')}</h2>
              {isPremium(status) && status.badge && <TierBadge tier={status.badge} size="md" />}
            </div>
            {data && <p className={`mt-0.5 text-sm font-semibold ${dark ? 'text-slate-300' : 'text-slate-500'}`}>{t(`subscription.portfolio.subtitle.${tierKey}`)}</p>}
          </div>
          <button type="button" onClick={load} className={`grid h-9 w-9 place-items-center rounded-lg border ${dark ? 'border-slate-600 text-slate-200 hover:bg-slate-800' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`} aria-label={t('subscription.panel.refresh')}>
            <RefreshCw className={`h-4 w-4 ${busy ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {loadFailed && (
          <div role="alert" className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3">
            <p className="min-w-0 flex-1 text-sm font-bold text-rose-800">{t('subscription.panel.loadFailed')}</p>
            <button type="button" onClick={load} className="inline-flex h-8 items-center rounded-lg border border-rose-300 bg-white px-3 text-xs font-extrabold text-rose-800 hover:bg-rose-100">{t('subscription.retry')}</button>
          </div>
        )}
        {message && <p role="status" className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-bold text-rose-800">{message}</p>}

        {!summary && busy && (
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5" aria-busy="true" aria-label={t('subscription.panel.loading')}>
            {[0, 1, 2, 3, 4].map((index) => <div key={index} className={`h-[74px] animate-pulse rounded-xl ${dark ? 'bg-slate-800' : 'bg-slate-100'}`} />)}
          </div>
        )}
        {summary && (
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
            {[
              ['subscription.portfolio.projects', summary.project_count, FolderKanban],
              ['subscription.portfolio.activeProjects', summary.active_projects, Activity],
              ['subscription.portfolio.avgCompletion', `${summary.average_completion}%`, Gauge],
              ['subscription.portfolio.recordedDays', summary.recorded_days, CalendarDays],
              ['subscription.portfolio.photos', summary.photo_count, Camera],
            ].map(([key, value, Icon]) => (
              <div key={key} className={`rounded-xl p-3 ${dark ? 'bg-slate-800' : 'border border-slate-100 bg-slate-50'}`}>
                <p className={`flex items-center gap-1.5 text-[11px] font-extrabold uppercase tracking-wide ${dark ? 'text-slate-300' : 'text-slate-500'}`}>
                  <Icon className={`h-3.5 w-3.5 ${dark ? 'text-amber-300' : 'text-emerald-600'}`} aria-hidden="true" />{t(key)}
                </p>
                <p className={`mt-1 text-2xl font-extrabold ${dark ? 'text-white' : 'text-slate-950'}`}>{value}</p>
                {key === 'subscription.portfolio.avgCompletion' && <ProgressBar value={summary.average_completion} />}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* The portfolio-wide report: the whole-portfolio CSV and cost summary, when
          the server sent them (Business). Otherwise what the plan lacks, with the
          way to the plans -- never a button that cannot work. */}
      {advanced && summary?.original_totals ? (
        <section aria-labelledby="portfolio-report-title" className="rounded-2xl border border-amber-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-start gap-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-slate-900 text-amber-300" aria-hidden="true"><FileSpreadsheet className="h-4 w-4" /></span>
            <div className="min-w-0 flex-1">
              <h3 id="portfolio-report-title" className="text-base font-extrabold text-slate-950">{t('subscription.portfolio.reportTitle')}</h3>
              <p className="mt-0.5 text-xs font-semibold text-slate-500">{t('subscription.portfolio.reportHint')}</p>
            </div>
            {canExportAll && (
              <button type="button" onClick={() => download(downloadPortfolioExport)} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-slate-900 px-4 text-xs font-extrabold text-white hover:bg-slate-800">
                <Download className="h-3.5 w-3.5 text-amber-300" aria-hidden="true" />{t('subscription.portfolio.exportAll')}
              </button>
            )}
          </div>
          <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_16rem]">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[420px] text-left text-sm">
                <caption className="pb-2 text-left text-xs font-extrabold uppercase tracking-wide text-slate-500">{t('subscription.portfolio.costSummary')}</caption>
                <thead className="text-[11px] uppercase tracking-wide text-slate-500">
                  <tr><th className="py-2 pe-3" /><th className="py-2 pe-3">{t('subscription.portfolio.original')}</th><th className="py-2">{t('subscription.portfolio.adjusted')}</th></tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {COST_FIELDS.map(([field, labelKey]) => (
                    <tr key={field}>
                      <th scope="row" className="py-2 pe-3 font-bold text-slate-700">{t(labelKey)}</th>
                      <td className="py-2 pe-3 text-slate-900">{formatMoney(summary.original_totals[field])}</td>
                      <td className="py-2 font-extrabold text-slate-950">{formatMoney(summary.adjusted_totals[field])}</td>
                    </tr>
                  ))}
                  <tr className="border-t-2 border-slate-200">
                    <th scope="row" className="py-2 pe-3 font-extrabold text-slate-950">{t('subscription.portfolio.total')}</th>
                    <td className="py-2 pe-3 font-bold text-slate-900">{formatMoney(sum(summary.original_totals))}</td>
                    <td className="py-2 font-extrabold text-slate-950">{formatMoney(sum(summary.adjusted_totals))}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            {summary.contract_or_budget !== undefined && (
              <div className="rounded-xl bg-slate-900 p-4 text-white">
                <p className="text-[11px] font-extrabold uppercase tracking-wide text-slate-300">{t('subscription.portfolio.totalBudget')}</p>
                <p className="mt-1 text-2xl font-extrabold text-amber-300">{formatMoney(summary.contract_or_budget)}</p>
              </div>
            )}
          </div>
        </section>
      ) : data && reportMissing.length > 0 && (
        <section className="rounded-2xl border border-dashed border-slate-300 bg-slate-50/70 p-5">
          <div className="flex flex-wrap items-start gap-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-white text-slate-500 ring-1 ring-slate-200" aria-hidden="true"><Lock className="h-4 w-4" /></span>
            {/* A floor on the width so that on a phone Compare plans wraps under
                the list instead of squeezing the list to a few letters a line. */}
            <div className="min-w-[min(100%,12rem)] flex-1">
              <h3 className="text-base font-extrabold text-slate-800">{t('subscription.portfolio.reportTitle')}</h3>
              <p className="mt-0.5 text-xs font-semibold text-slate-500">{t('subscription.summary.notOnPlan')}</p>
              <ul className="mt-2 grid grid-cols-1 gap-1 text-sm text-slate-600">
                {reportMissing.map((line) => <li key={line.id} className="flex items-center gap-2"><Lock className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden="true" /><span className="min-w-0">{t(line.labelKey)}</span></li>)}
              </ul>
            </div>
            {onViewPlans && (
              <button type="button" onClick={onViewPlans} className="inline-flex h-9 items-center rounded-lg border border-slate-300 bg-white px-4 text-xs font-extrabold text-slate-800 hover:bg-slate-100">
                {t('subscription.summary.comparePlans')}
              </button>
            )}
          </div>
        </section>
      )}

      <section aria-labelledby="portfolio-register-title" className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-3">
          <h3 id="portfolio-register-title" className="text-base font-extrabold text-slate-950">{t('subscription.portfolio.registerTitle')}</h3>
          {canExportProject && <p className="mt-0.5 text-xs font-semibold text-slate-500">{t('subscription.portfolio.registerHint')}</p>}
        </div>
        {!data?.projects?.length ? (
          busy ? (
            <div className="grid gap-2" aria-busy="true" aria-label={t('subscription.panel.loading')}>
              {[0, 1, 2].map((index) => <div key={index} className="h-10 animate-pulse rounded-lg bg-slate-100" />)}
            </div>
          ) : !loadFailed && (
            // A failed load is already reported (with Try again) at the top.
            <p className="rounded-xl border border-dashed border-slate-200 bg-slate-50/60 px-4 py-6 text-center text-sm font-semibold text-slate-500">
              {t('subscription.portfolio.empty')}
            </p>
          )
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-left text-sm">
              <thead className="border-b border-slate-200 text-[11px] uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="py-2 pe-3">{t('subscription.portfolio.colProject')}</th>
                  <th className="py-2 pe-3">{t('subscription.portfolio.colOwner')}</th>
                  <th className="w-36 py-2 pe-3">{t('subscription.portfolio.colProgress')}</th>
                  <th className="py-2 pe-3">{t('subscription.portfolio.colBudget')}</th>
                  <th className="py-2 pe-3">{t('subscription.portfolio.recordedDays')}</th>
                  <th className="py-2 pe-3">{t('subscription.portfolio.colCorrected')}</th>
                  <th className="py-2 pe-3">{t('subscription.portfolio.colLastRecord')}</th>
                  {advanced && <th className="py-2 pe-3">{t('subscription.portfolio.colSpent')}</th>}
                  {canExportProject && <th className="py-2" />}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.projects.map((row) => (
                  <tr key={row.project_id} className="hover:bg-slate-50/70">
                    <td className="py-3 pe-3 font-bold text-slate-900">{row.title}</td>
                    <td className="py-3 pe-3 text-slate-600">{row.owner_name || '—'}</td>
                    <td className="py-3 pe-3 text-slate-900">
                      <span className="font-bold">{row.completion_percentage ?? 0}%</span>
                      <ProgressBar value={row.completion_percentage} />
                    </td>
                    <td className="py-3 pe-3 text-slate-900">{formatMoney(row.contract_or_budget, row.project_country)}</td>
                    <td className="py-3 pe-3 text-slate-600">{row.recorded_days}</td>
                    <td className="py-3 pe-3 text-slate-600">{row.adjusted_days ?? 0}</td>
                    <td className="py-3 pe-3 text-slate-600">{row.last_record_date ? formatPlanDate(`${row.last_record_date}T00:00:00Z`, locale) : '—'}</td>
                    {advanced && (
                      <td className="py-3 pe-3 text-slate-900">
                        {formatMoney(row.adjusted_spent, row.project_country)}
                        {row.adjusted_spent !== row.original_spent && <span className="block text-[11px] text-slate-500">{t('subscription.portfolio.original')}: {formatMoney(row.original_spent, row.project_country)}</span>}
                      </td>
                    )}
                    {canExportProject && (
                      <td className="py-3 text-end">
                        <button type="button" onClick={() => download(() => downloadProjectSummary(row.project_id))}
                          aria-label={t('subscription.portfolio.exportProjectFor', { project: row.title })}
                          className="inline-flex h-8 items-center gap-1 whitespace-nowrap rounded-lg border border-emerald-200 bg-emerald-50 px-3 text-xs font-extrabold text-emerald-800 hover:bg-emerald-100">
                          <Download className="h-3.5 w-3.5" aria-hidden="true" />{t('subscription.portfolio.exportProject')}
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {canCorrect && data?.projects?.length > 0 && (
          <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-emerald-100 bg-emerald-50/60 px-4 py-3">
            <p className="min-w-0 flex-1 text-xs font-semibold text-emerald-900">{t('subscription.hint.corrections')}</p>
            {onOpenProjects && (
              <button type="button" onClick={onOpenProjects} className="inline-flex h-8 items-center rounded-lg border border-emerald-300 bg-white px-3 text-xs font-extrabold text-emerald-800 hover:bg-emerald-100">
                {t('subscription.portfolio.openProjects')}
              </button>
            )}
          </div>
        )}
      </section>
    </div>
  )
}
