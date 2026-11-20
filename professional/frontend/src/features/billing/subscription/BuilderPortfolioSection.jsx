import { useCallback, useEffect, useState } from 'react'
import { Activity, BarChart3, CalendarDays, Camera, Download, FileSpreadsheet, FolderKanban, Gauge, RefreshCw } from 'lucide-react'
import { useLanguage } from '../../../i18n/LanguageContext.jsx'
import { formatMoney } from '../../../shared/utils/countryConfig.js'
import { activeLocale } from '../../../shared/utils/formatters.js'
import { downloadPortfolioExport, downloadProjectSummary, fetchBuilderPortfolio, formatReportDate } from '../builderReportsApi.js'

const COST_FIELDS = [
  ['labour_cost', 'se.labourCost'],
  ['material_cost', 'se.materialCost'],
  ['equipment_cost', 'se.equipmentCost'],
  ['total_expenses', 'se.otherExpenses'],
]

function ProgressBar({ value }) {
  const width = Math.max(0, Math.min(100, Number(value) || 0))
  return (
    <span className="mt-1 block h-1.5 w-full overflow-hidden rounded-full bg-slate-100" aria-hidden="true">
      <span className="block h-full rounded-full bg-emerald-500" style={{ width: `${width}%` }} />
    </span>
  )
}

export default function BuilderPortfolioSection({ onOpenProjects = null }) {
  const { t } = useLanguage()
  const [data, setData] = useState(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setBusy(true)
    setMessage('')
    setLoadFailed(false)
    try {
      setData(await fetchBuilderPortfolio())
    } catch {
      setLoadFailed(true)
    } finally {
      setBusy(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const download = async (task) => {
    setMessage('')
    try { await task() } catch {
      setMessage(t('subscription.portfolio.downloadFailed'))
    }
  }


  const locale = activeLocale()
  const summary = data?.summary
  const sum = (totals) => COST_FIELDS.reduce((total, [field]) => total + Number(totals?.[field] || 0), 0)

  return (
    <div className="grid gap-5">
      <section className="rounded-2xl border p-5 shadow-sm border-slate-800 bg-slate-900 text-white">
        <div className="flex flex-wrap items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-amber-300 text-slate-950" aria-hidden="true">
            <BarChart3 className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="min-w-0 text-lg font-extrabold [overflow-wrap:anywhere] text-white">{t('subscription.portfolio.title')}</h2>
            </div>
          </div>
          <button type="button" onClick={load} className="grid h-9 w-9 place-items-center rounded-lg border border-slate-600 text-slate-200 hover:bg-slate-800" aria-label={t('subscription.panel.refresh')}>
            <RefreshCw className={`h-4 w-4 ${busy ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {loadFailed && (
          <div role="alert" className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3">
            <p className="min-w-0 flex-1 text-sm font-bold text-rose-800">{t('award.error')}</p>
            <button type="button" onClick={load} className="inline-flex h-8 items-center rounded-lg border border-rose-300 bg-white px-3 text-xs font-extrabold text-rose-800 hover:bg-rose-100">{t('subscription.retry')}</button>
          </div>
        )}
        {message && <p role="status" className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-bold text-rose-800">{message}</p>}

        {!summary && busy && (
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5" aria-busy="true" aria-label={t('subscription.panel.loading')}>
            {[0, 1, 2, 3, 4].map((index) => <div key={index} className="h-[74px] animate-pulse rounded-xl bg-slate-800" />)}
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
              <div key={key} className="rounded-xl p-3 bg-slate-800">
                <p className="flex items-center gap-1.5 text-[11px] font-extrabold uppercase tracking-wide text-slate-300">
                  <Icon className="h-3.5 w-3.5 text-amber-300" aria-hidden="true" />{t(key)}
                </p>
                <p className="mt-1 text-2xl font-extrabold text-white">{value}</p>
                {key === 'subscription.portfolio.avgCompletion' && <ProgressBar value={summary.average_completion} />}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* The portfolio-wide report: the whole-portfolio CSV and cost summary. */}
      {summary?.original_totals ? (
        <section aria-labelledby="portfolio-report-title" className="rounded-2xl border border-amber-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-start gap-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-slate-900 text-amber-300" aria-hidden="true"><FileSpreadsheet className="h-4 w-4" /></span>
            <div className="min-w-0 flex-1">
              <h3 id="portfolio-report-title" className="text-base font-extrabold text-slate-950">{t('subscription.portfolio.reportTitle')}</h3>
              <p className="mt-0.5 text-xs font-semibold text-slate-500">{t('subscription.portfolio.reportHint')}</p>
            </div>
            <button type="button" onClick={() => download(downloadPortfolioExport)} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-slate-900 px-4 text-xs font-extrabold text-white hover:bg-slate-800">
              <Download className="h-3.5 w-3.5 text-amber-300" aria-hidden="true" />{t('subscription.portfolio.exportAll')}
            </button>
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
      ) : null}

      <section aria-labelledby="portfolio-register-title" className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-3">
          <h3 id="portfolio-register-title" className="text-base font-extrabold text-slate-950">{t('subscription.portfolio.registerTitle')}</h3>
          <p className="mt-0.5 text-xs font-semibold text-slate-500">{t('subscription.portfolio.registerHint')}</p>
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
                  <th className="py-2 pe-3">{t('subscription.portfolio.colSpent')}</th>
                  <th className="py-2" />
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
                    <td className="py-3 pe-3 text-slate-600">{row.last_record_date ? formatReportDate(`${row.last_record_date}T00:00:00Z`, locale) : '—'}</td>
                    <td className="py-3 pe-3 text-slate-900">
                      {formatMoney(row.adjusted_spent, row.project_country)}
                      {row.adjusted_spent !== row.original_spent && <span className="block text-[11px] text-slate-500">{t('subscription.portfolio.original')}: {formatMoney(row.original_spent, row.project_country)}</span>}
                    </td>
                    <td className="py-3 text-end">
                      <button type="button" onClick={() => download(() => downloadProjectSummary(row.project_id))}
                        aria-label={t('subscription.portfolio.exportProjectFor', { project: row.title })}
                        className="inline-flex h-8 items-center gap-1 whitespace-nowrap rounded-lg border border-emerald-200 bg-emerald-50 px-3 text-xs font-extrabold text-emerald-800 hover:bg-emerald-100">
                        <Download className="h-3.5 w-3.5" aria-hidden="true" />{t('subscription.portfolio.exportProject')}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data?.projects?.length > 0 && (
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
