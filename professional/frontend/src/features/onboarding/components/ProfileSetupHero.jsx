import { useLanguage } from '../../../i18n/LanguageContext.jsx'

export function ContractorSetupHero({
  step,
  setupLabel: setupLabelProp,
  subtitle: subtitleProp,
  trackerLabel: trackerLabelProp,
  totalSteps = 4,
}) {
  const { t } = useLanguage()
  // Same defaults as before, now translated.
  const setupLabel = setupLabelProp === undefined ? t('ps.con.setupLabel') : setupLabelProp
  const subtitle = subtitleProp === undefined ? t('ui.profile.contractorHeroIntro') : subtitleProp
  const trackerLabel = trackerLabelProp === undefined ? t('ps.con.completionTracker') : trackerLabelProp
  const percent = Math.round((step / totalSteps) * 100)
  return (
    <div className="relative mx-auto w-full max-w-6xl overflow-hidden rounded-2xl border border-white/10 bg-[#0d1322] px-6 py-7 text-white shadow-[0_18px_50px_-38px_rgba(2,6,23,0.9)] sm:px-10">
      {/* Ambient glows + dotted construction grid texture (matches DashboardHero) */}
      <div className="pointer-events-none absolute -right-20 -top-24 h-72 w-72 rounded-full bg-brand-500/15 blur-3xl" aria-hidden="true" />
      <div className="pointer-events-none absolute -bottom-24 -left-20 h-72 w-72 rounded-full bg-violet-500/10 blur-3xl" aria-hidden="true" />
      <div
        className="pointer-events-none absolute inset-0"
        style={{ backgroundImage: 'radial-gradient(rgba(255,255,255,0.06) 1px, transparent 1px)', backgroundSize: '22px 22px' }}
        aria-hidden="true"
      />
      <div className="relative flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
        <div className="relative max-w-3xl">
          <span className="inline-flex items-center gap-2 rounded-full bg-brand-500/15 px-4 py-1.5 text-xs font-extrabold uppercase tracking-wide text-brand-300">
            <span className="h-2 w-2 rounded-full bg-brand-400" /> {setupLabel}
          </span>
          <h1 className="mt-4 font-display text-2xl font-extrabold leading-tight tracking-normal text-white sm:text-3xl">{t('ps.con.completeProfile')}</h1>
          <p className="mt-3 max-w-2xl text-sm font-medium leading-relaxed text-slate-300/80">
            {subtitle}
          </p>
        </div>
        <div className="relative flex w-fit items-center gap-4 rounded-xl border border-white/10 bg-white/10 px-4 py-3 shadow-inner">
          <span className="grid h-14 w-14 place-items-center rounded-full border-4 border-brand-500 text-sm font-extrabold text-white">{percent}%</span>
          <div>
            <p className="text-xs font-extrabold uppercase tracking-wide text-brand-300">{trackerLabel}</p>
            <p className="mt-1 text-lg font-extrabold text-white">{t('site.estimate.step', { current: step, total: totalSteps })}</p>
          </div>
        </div>
      </div>
    </div>
  )
}
