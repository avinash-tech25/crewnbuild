// The back of an owner's project card: budget, recorded spend and schedule for
// that one project, from the existing cost summary. Figures come from
// analysisFigures (ownerProjectAnalysis.js); nothing here invents a value.
import { forwardRef } from 'react'
import { AlertTriangle, Loader2, RotateCcw } from 'lucide-react'
import { useLanguage } from '../../../i18n/LanguageContext.jsx'
import { formatPercent, scheduleText, scheduleWidth } from '../../../shared/utils/projectProgress.js'
import { analysisFigures } from '../ownerProjectAnalysis.js'
import { money } from '../ownerHelpers.js'

const USED = '#126b45'
const OVER = '#dc2626'

// Budget used against remaining, with the utilization in the centre.
function BudgetDonut({ utilization, label }) {
  const radius = 24
  const circumference = 2 * Math.PI * radius
  const share = utilization === null ? 0 : Math.min(100, utilization)
  const color = utilization !== null && utilization > 100 ? OVER : USED
  return (
    <div className="relative h-[60px] w-[60px] shrink-0" role="img" aria-label={label}>
      <svg viewBox="0 0 60 60" className="h-full w-full -rotate-90">
        <circle cx="30" cy="30" r={radius} fill="none" stroke="currentColor" strokeWidth="7" className="text-slate-200" />
        {share > 0 && <circle cx="30" cy="30" r={radius} fill="none" stroke={color} strokeWidth="7" strokeLinecap="round" strokeDasharray={`${(share / 100) * circumference} ${circumference}`} />}
      </svg>
      <span className="absolute inset-0 grid place-items-center text-[11px] font-extrabold text-oc-ink">{utilization === null ? '–' : formatPercent(utilization)}</span>
    </div>
  )
}

function Metric({ label, value, tone = '' }) {
  return (
    <div className="min-w-0">
      <p className="truncate text-[10px] font-semibold text-oc-muted">{label}</p>
      <p className={`truncate text-xs font-bold ${tone || 'text-oc-ink'}`} title={value}>{value}</p>
    </div>
  )
}

const OwnerProjectAnalysisPanel = forwardRef(function OwnerProjectAnalysisPanel({ project, country, state, onRetry, onBack }, backRef) {
  const { t, translateMessage } = useLanguage()
  const figures = state?.status === 'ready' ? analysisFigures(state.data?.dashboard) : null
  const notAvailable = t('progress.notAvailable')
  const schedule = scheduleText(project, t)

  return (
    <div className="flex h-full min-h-0 flex-col p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="truncate text-xs font-black uppercase tracking-[.1em] text-oc-ink rtl:tracking-normal">{t('owner.analysis.title')}</p>
        <button
          ref={backRef}
          type="button"
          onClick={onBack}
          className="inline-flex h-7 shrink-0 items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 text-[11px] font-extrabold text-oc-ink transition hover:bg-slate-50"
        >
          <RotateCcw className="h-3 w-3" /> {t('owner.analysis.back')}
        </button>
      </div>

      {state?.status === 'ready' && !figures && <p className="my-auto text-center text-[11px] font-semibold text-oc-muted" role="alert">{t('owner.analysis.err.missing')}</p>}
      {(!state || state.status === 'loading') && (
        <p className="my-auto flex items-center justify-center gap-2 text-[11px] font-semibold text-oc-muted"><Loader2 className="h-3.5 w-3.5 animate-spin" />{t('owner.analysis.loading')}</p>
      )}
      {state?.status === 'error' && (
        <div className="my-auto text-center" role="alert">
          <p className="text-[11px] font-semibold text-oc-muted">{t(`owner.analysis.err.${state.error?.kind || 'unknown'}`)}</p>
          {state.error?.message && <p className="mt-0.5 text-[10px] font-medium text-oc-muted">{translateMessage(state.error.message)}</p>}
          {state.error?.status && <p className="text-[9px] font-semibold text-oc-faint">{`HTTP ${state.error.status}${state.error.code ? ` · ${state.error.code}` : ''}`}</p>}
          <button type="button" onClick={onRetry} className="mt-1.5 inline-flex h-7 items-center rounded-lg border border-slate-200 bg-white px-2.5 text-[11px] font-extrabold text-oc-ink hover:bg-slate-50">{t('owner.analysis.retry')}</button>
        </div>
      )}

      {figures && (
        <div className="mt-2 flex min-h-0 flex-1 flex-col overflow-y-auto">
          <div className="flex items-center gap-3">
            <BudgetDonut utilization={figures.utilization} label={`${t('owner.analysis.utilization')}: ${figures.utilization === null ? notAvailable : formatPercent(figures.utilization)}`} />
            <div className="grid min-w-0 flex-1 grid-cols-2 gap-x-3 gap-y-1">
              <Metric label={t('owner.analysis.budget')} value={figures.budget === null ? notAvailable : money(figures.budget, country)} />
              <Metric label={t('owner.analysis.spent')} value={money(figures.spent, country)} />
              <Metric
                label={t('owner.analysis.remaining')}
                value={figures.remaining === null ? notAvailable : figures.overrun ? `-${money(figures.overrun, country)}` : money(figures.remaining, country)}
                tone={figures.overrun ? 'text-red-600' : ''}
              />
              <Metric label={t('owner.analysis.utilization')} value={figures.utilization === null ? notAvailable : formatPercent(figures.utilization)} tone={figures.overrun ? 'text-red-600' : ''} />
            </div>
          </div>
          {figures.overrun > 0 && (
            <p className="mt-1.5 flex items-center gap-1 text-[10px] font-bold text-red-600"><AlertTriangle className="h-3 w-3 shrink-0" />{t('owner.analysis.overrun', { amount: money(figures.overrun, country) })}</p>
          )}

          {/* Spending by the categories the site records, as one stacked bar. */}
          <div className="mt-2">
            <p className="text-[10px] font-semibold text-oc-muted">{t('owner.analysis.breakdown')}</p>
            {figures.categories.length ? (
              <>
                <div className="mt-1 flex h-2 w-full overflow-hidden rounded-full bg-slate-200" role="img" aria-label={figures.categories.map((category) => `${t(category.labelKey)} ${money(category.value, country)}`).join(', ')}>
                  {figures.categories.map((category) => <span key={category.key} className="h-full" style={{ width: `${(category.value / figures.spent) * 100}%`, backgroundColor: category.color }} />)}
                </div>
                <div className="mt-1 flex flex-wrap gap-x-2.5 gap-y-0.5">
                  {figures.categories.map((category) => (
                    <span key={category.key} className="inline-flex items-center gap-1 text-[10px] font-semibold text-oc-muted" title={money(category.value, country)}>
                      <span aria-hidden="true" className="h-2 w-2 rounded-full" style={{ backgroundColor: category.color }} />
                      {`${t(category.labelKey)} ${formatPercent(Math.round((category.value / figures.spent) * 1000) / 10)}`}
                    </span>
                  ))}
                </div>
              </>
            ) : (
              <p className="mt-0.5 text-[10px] font-semibold text-oc-faint">{t('owner.analysis.noSpend')}</p>
            )}
          </div>

          {/* The same schedule figure the front of the card draws. */}
          <div className="mt-auto pt-2">
            <div className="h-1 w-full overflow-hidden rounded-full bg-slate-200"><div className="h-full rounded-full bg-emerald-500" style={{ width: `${scheduleWidth(project)}%` }} /></div>
            <p className="mt-1 truncate text-[10px] font-semibold text-oc-muted">{`${t('progress.schedule')}: ${schedule || notAvailable}`}</p>
          </div>
        </div>
      )}
    </div>
  )
})

export default OwnerProjectAnalysisPanel
