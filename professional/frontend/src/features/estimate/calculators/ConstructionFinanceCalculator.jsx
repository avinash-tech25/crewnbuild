/**
 * Construction Finance Planner.
 *
 * Frontend-only construction cash-flow planning: the user's budget, funds and
 * stage allocations, walked stage by stage to show where a funding gap could
 * appear. No budget, stage percentage or rate lives here — every amount starts
 * empty. It is not an EMI calculator; bank approval and disbursement rules are
 * not evaluated. The arithmetic is in `constructionFinance.js`.
 */
import { useMemo, useState } from 'react'
import { Wallet } from 'lucide-react'
import {
  EMPTY_INPUTS, STAGES, calculateConstructionFinance, convertStageValues, formatInr, formatSignedInr, planningBudgetOf, plannedPeriod,
} from './constructionFinance.js'
import { Headline, MethodNote, cardClass, inputClass, labelClass, selectClass } from './ui.jsx'
import { useLanguage } from '../../../i18n/LanguageContext.jsx'

const K = (key) => `site.calculators.constructionFinance.${key}`
const errorText = 'mt-1 block text-[11px] font-bold leading-4 text-[#b45309]'
const hintText = 'mt-1 block text-[11px] font-medium leading-4 text-oc-faint'
const sectionTitle = 'text-xs font-extrabold uppercase tracking-wide text-oc-faint sm:col-span-2 lg:col-span-3'
const warnBorder = '!border-[#d97706]'
const OK_TONE = 'bg-oc-mint text-oc-deep'
const WARN_TONE = 'bg-[#fef3cd] text-[#856404]'
const GAP_TONE = 'bg-[#fde8e1] text-[#9a3412]'
const pct = (value) => `${Number(value.toFixed(2)).toLocaleString('en-IN')}%`

function NumberInput({ label, value, onChange, error, prefix, suffix, placeholder, hint, step = 'any' }) {
  return (
    <label className={labelClass}>
      {label}
      <span className="relative mt-2 block">
        {prefix && <span className="pointer-events-none absolute inset-y-0 start-3 flex items-center text-sm font-bold text-oc-muted">{prefix}</span>}
        <input
          type="number"
          inputMode="decimal"
          min="0"
          step={step}
          value={value}
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
          aria-invalid={Boolean(error)}
          className={`${inputClass} !mt-0 ${prefix ? 'ps-7' : ''} ${suffix ? 'pe-16' : ''} ${error ? warnBorder : ''}`}
        />
        {suffix && <span className="pointer-events-none absolute inset-y-0 end-3 flex items-center text-sm font-bold text-oc-muted">{suffix}</span>}
      </span>
      {error ? <span className={errorText}>{error}</span> : hint && <span className={hintText}>{hint}</span>}
    </label>
  )
}

function SelectInput({ label, value, onChange, options, hint }) {
  return (
    <label className={labelClass}>
      {label}
      <select value={value} onChange={(event) => onChange(event.target.value)} className={selectClass}>
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
      {hint && <span className={hintText}>{hint}</span>}
    </label>
  )
}

function Row({ label, value, strong = false, tone = '' }) {
  return (
    <li className={`flex items-center gap-3 py-2 text-sm ${tone}`}>
      <span className={tone ? '' : 'text-oc-muted'}>{label}</span>
      <span className={`ms-auto text-end ${strong ? 'font-extrabold' : 'font-bold'} ${tone ? '' : 'text-oc-ink'}`}>{value}</span>
    </li>
  )
}

const Pill = ({ tone, children }) => <span className={`inline-block rounded-full px-3 py-1 text-[11px] font-extrabold ${tone}`}>{children}</span>
const rupeeHint = (value) => (value !== '' && Number(value) > 0 ? formatInr(Number(value)) : '')

export default function ConstructionFinanceCalculator() {
  const { t } = useLanguage()
  // Every amount and stage starts empty; nothing is planned until budget, duration and own funds are in.
  const [form, setForm] = useState(EMPTY_INPUTS)
  const set = (field) => (value) => setForm((current) => ({ ...current, [field]: value }))
  const setStage = (group, stage) => (value) => setForm((current) => ({ ...current, [group]: { ...current[group], [stage]: value } }))
  // One stored value per stage: switching the mode converts it with the planning budget.
  const setStageMode = (mode) => setForm((current) => ({
    ...current, stageMode: mode, stages: convertStageValues(current.stages, current.stageMode, mode, planningBudgetOf(current)),
  }))
  const { status, errors, result } = useMemo(() => calculateConstructionFinance(form), [form])
  const err = (field) => (errors[field] ? t(K(errors[field])) : '')
  const stageName = (stage) => t(K(`stage.${stage}`))
  const percentMode = form.stageMode === 'percent'
  const progressive = form.loanMethod === 'progressive'
  const plan = result?.plan
  const period = result ? plannedPeriod(result.startMonth, result.durationMonths) : null

  return (
    <div className="min-w-0 space-y-4">
      <div className={cardClass}>
        <div className="flex items-center gap-2">
          <Wallet className="h-4 w-4 text-oc-green" />
          <h1 className="font-display text-lg font-extrabold text-oc-ink">{t(K('title'))}</h1>
        </div>
        <p className="mt-1 text-sm leading-6 text-oc-muted">{t(K('intro'))}</p>

        <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <p className={sectionTitle}>{t(K('sectionProject'))}</p>
          <NumberInput label={t(K('budget'))} prefix="₹" value={form.budget} onChange={set('budget')} error={err('budget')} placeholder={t(K('budgetPlaceholder'))} hint={rupeeHint(form.budget)} />
          <NumberInput label={t(K('duration'))} suffix={t(K('months'))} value={form.durationMonths} onChange={set('durationMonths')} error={err('durationMonths')} placeholder={t(K('durationPlaceholder'))} step="1" />
          <label className={labelClass}>
            {t(K('startMonth'))}
            <input type="month" value={form.startMonth} onChange={(event) => set('startMonth')(event.target.value)} className={inputClass} />
            {err('startMonth') ? <span className={errorText}>{err('startMonth')}</span> : <span className={hintText}>{t(K('startMonthHint'))}</span>}
          </label>
          <NumberInput label={t(K('contingency'))} suffix="%" value={form.contingencyPercent} onChange={set('contingencyPercent')} error={err('contingencyPercent')} placeholder={t(K('optional'))} hint={t(K('contingencyHint'))} step="0.1" />

          <p className={sectionTitle}>{t(K('sectionFunds'))}</p>
          <NumberInput label={t(K('ownFunds'))} prefix="₹" value={form.ownFunds} onChange={set('ownFunds')} error={err('ownFunds')} placeholder={t(K('ownFundsPlaceholder'))} hint={rupeeHint(form.ownFunds)} />
          <NumberInput label={t(K('loan'))} prefix="₹" value={form.constructionLoan} onChange={set('constructionLoan')} error={err('constructionLoan')} placeholder={t(K('optional'))} hint={rupeeHint(form.constructionLoan) || t(K('noLoan'))} />
          <NumberInput label={t(K('otherFunds'))} prefix="₹" value={form.otherFunds} onChange={set('otherFunds')} error={err('otherFunds')} placeholder={t(K('optional'))} hint={rupeeHint(form.otherFunds) || t(K('otherFundsHint'))} />
          <SelectInput
            label={t(K('loanMethod'))}
            value={form.loanMethod}
            onChange={set('loanMethod')}
            options={[{ value: 'start', label: t(K('loanStart')) }, { value: 'progressive', label: t(K('loanProgressive')) }]}
            hint={progressive ? t(K('loanProgressiveHint')) : t(K('loanStartHint'))}
          />

          <p className={sectionTitle}>{t(K('sectionStages'))}</p>
          <SelectInput
            label={t(K('stageMode'))}
            value={form.stageMode}
            onChange={setStageMode}
            options={[{ value: 'percent', label: t(K('modePercent')) }, { value: 'amount', label: t(K('modeAmount')) }]}
            hint={t(K('stageModeHint'))}
          />
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {STAGES.map((stage, index) => (
            <fieldset key={stage} className="min-w-0 rounded-xl border border-[rgba(8,62,43,.1)] p-3">
              <legend className="px-1 text-xs font-extrabold text-oc-ink">{index + 1}. {stageName(stage)}</legend>
              <div className={`grid gap-3 ${progressive ? 'grid-cols-2' : ''}`}>
                <NumberInput
                  label={percentMode ? t(K('stagePercent')) : t(K('stageAmount'))}
                  prefix={percentMode ? undefined : '₹'}
                  suffix={percentMode ? '%' : undefined}
                  value={form.stages[stage]}
                  onChange={setStage('stages', stage)}
                  error={err(`stage.${stage}`)}
                  placeholder={percentMode ? t(K('stagePercentPlaceholder')) : t(K('stageAmountPlaceholder'))}
                  hint={percentMode ? '' : rupeeHint(form.stages[stage])}
                />
                {progressive && (
                  <NumberInput
                    label={t(K('drawPercent'))}
                    suffix="%"
                    value={form.loanDraws[stage]}
                    onChange={setStage('loanDraws', stage)}
                    error={err(`draw.${stage}`)}
                    placeholder={t(K('stagePercentPlaceholder'))}
                  />
                )}
              </div>
            </fieldset>
          ))}
        </div>

        {result && (
          <div className="mt-4 flex flex-wrap items-center gap-2 text-xs font-bold text-oc-muted">
            <span>{percentMode ? t(K('allocatedPercent'), { percent: pct(result.allocatedPercent) }) : t(K('allocatedAmount'), { amount: formatInr(result.allocated), budget: formatInr(result.planningBudget) })}</span>
            {result.overAllocated
              ? <Pill tone={GAP_TONE}>{percentMode ? t(K('overAllocatedPercent')) : t(K('overAllocatedAmount'))}</Pill>
              : result.fullyAllocated
                ? <Pill tone={OK_TONE}>{t(K('fullyAllocated'))}</Pill>
                : result.allocated > 0 && <Pill tone={WARN_TONE}>{t(K('notAllocated'), { percent: pct(100 - result.allocatedPercent) })}</Pill>}
            {progressive && (
              <>
                <span className="ms-2">{t(K('drawAllocated'), { percent: pct(result.drawTotalPercent) })}</span>
                {result.drawsOver && <Pill tone={GAP_TONE}>{t(K('drawsOver'))}</Pill>}
                {result.loanPartlyUndrawn && <Pill tone={WARN_TONE}>{t(K('loanUndrawn'))}</Pill>}
              </>
            )}
          </div>
        )}
      </div>

      {status !== 'ok' && (
        <div className={`${cardClass} text-center`}>
          <p className={`text-sm font-bold ${status === 'invalid' ? 'text-[#b45309]' : 'text-oc-muted'}`}>
            {{ empty: t(K('emptyState')), incomplete: t(K('incompleteState')), invalid: t(K('invalidState')) }[status]}
          </p>
        </div>
      )}

      {status === 'ok' && result && (
        <>
          <Headline
            label={t(K('headline'))}
            value={result.fullyFunded ? t(K('fullyFunded')) : formatInr(result.fundingGap)}
            sub={result.fullyFunded ? t(K('sufficient')) : t(K('headlineGapSub'))}
          />

          <div className="grid gap-4 lg:grid-cols-2">
            <div className={cardClass}>
              <h2 className="font-display text-base font-extrabold text-oc-ink">{t(K('budgetTitle'))}</h2>
              <ul className="mt-3 divide-y divide-[rgba(8,62,43,.08)]">
                <Row label={t(K('baseBudget'))} value={formatInr(result.budget)} />
                <Row label={result.contingencyEntered ? t(K('contingencyReserve'), { percent: pct(result.contingencyPercent) }) : t(K('contingencyNone'))} value={formatInr(result.contingency)} />
                <Row label={t(K('planningBudget'))} value={formatInr(result.planningBudget)} strong />
                <Row label={t(K('duration'))} value={`${result.durationMonths} ${t(K('months'))}`} />
                {period && <Row label={t(K('plannedPeriod'))} value={period} />}
              </ul>
            </div>

            <div className={cardClass}>
              <h2 className="font-display text-base font-extrabold text-oc-ink">{t(K('fundingTitle'))}</h2>
              <ul className="mt-3 divide-y divide-[rgba(8,62,43,.08)]">
                <Row label={t(K('ownFunds'))} value={formatInr(result.ownFunds)} />
                <Row label={t(K('loan'))} value={result.loanEntered ? formatInr(result.constructionLoan) : t(K('noLoan'))} />
                <Row label={t(K('otherFunds'))} value={formatInr(result.otherFunds)} />
                <Row label={t(K('totalFunding'))} value={formatInr(result.totalFunding)} strong />
                <Row label={t(K('coverage'))} value={result.fundingCoverage > 100 ? '100%+' : `${result.fundingCoverage.toFixed(1)}%`} />
                {result.fullyFunded
                  ? result.fundingSurplus > 0 && <Row label={t(K('surplus'))} value={formatInr(result.fundingSurplus)} strong tone={`rounded-lg px-2 ${OK_TONE}`} />
                  : <Row label={t(K('potentialGap'))} value={formatInr(result.fundingGap)} strong tone={`rounded-lg px-2 ${GAP_TONE}`} />}
              </ul>
              <p className={`mt-3 text-xs font-bold ${result.fullyFunded ? 'text-oc-deep' : 'text-[#9a3412]'}`}>{result.fullyFunded ? t(K('sufficient')) : t(K('gapNote'))}</p>
              <p className={hintText}>{t(K('noApproval'))}</p>
            </div>
          </div>

          {!plan ? (
            <div className={`${cardClass} text-center`}>
              <p className={`text-sm font-bold ${result.planIssue === 'noStages' ? 'text-oc-muted' : 'text-[#b45309]'}`}>{t(K(`planIssue.${result.planIssue}`))}</p>
            </div>
          ) : (
            <>
              <div className={cardClass}>
                <h2 className="font-display text-base font-extrabold text-oc-ink">{t(K('stageBreakdownTitle'))}</h2>
                <div className="mt-4 space-y-3">
                  {result.stageAmounts.filter((item) => item.entered).map((item) => {
                    const share = (item.amount / result.planningBudget) * 100
                    return (
                      <div key={item.stage}>
                        <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
                          <span className="font-bold text-oc-muted">{stageName(item.stage)}</span>
                          <span className="font-extrabold text-oc-ink">{formatInr(item.amount)} <span className="font-bold text-oc-muted">· {pct(share)}</span></span>
                        </div>
                        <div className="mt-1.5 h-2.5 w-full overflow-hidden rounded-full bg-oc-sunken">
                          <div className="h-full rounded-full bg-oc-green" style={{ width: `${Math.min(Math.max(share, item.amount > 0 ? 1 : 0), 100)}%` }} />
                        </div>
                      </div>
                    )
                  })}
                </div>
                <ul className="mt-4 border-t-2 border-[rgba(8,62,43,.15)]">
                  <Row label={t(K('allocatedTotal'))} value={`${formatInr(result.allocated)} · ${pct(result.allocatedPercent)}`} strong />
                  {result.unallocated > 0 && <Row label={t(K('unallocated'))} value={formatInr(result.unallocated)} strong tone={`rounded-lg px-2 ${WARN_TONE}`} />}
                </ul>
                {result.unallocated > 0 && <p className={hintText}>{t(K('unallocatedNote'))}</p>}
              </div>

              <div className={cardClass}>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h2 className="font-display text-base font-extrabold text-oc-ink">{t(K('cashFlowTitle'))}</h2>
                  {plan.firstGapStage ? <Pill tone={GAP_TONE}>{t(K('potentialGap'))}</Pill> : <Pill tone={OK_TONE}>{t(K('allStagesFunded'))}</Pill>}
                </div>
                <div className="mt-3 grid gap-3 sm:grid-cols-3">
                  <div className="rounded-xl bg-oc-sunken p-3">
                    <p className="text-[11px] font-bold uppercase tracking-wide text-oc-faint">{t(K('peakRequirement'))}</p>
                    <p className="mt-1 font-display text-lg font-extrabold text-oc-ink">{formatInr(plan.peakFundingRequirement)}</p>
                  </div>
                  <div className={`rounded-xl p-3 ${plan.peakGap > 0 ? GAP_TONE : 'bg-oc-sunken'}`}>
                    <p className="text-[11px] font-bold uppercase tracking-wide opacity-80">{t(K('peakGap'))}</p>
                    <p className="mt-1 font-display text-lg font-extrabold">{formatInr(plan.peakGap)}</p>
                  </div>
                  <div className="rounded-xl bg-oc-sunken p-3">
                    <p className="text-[11px] font-bold uppercase tracking-wide text-oc-faint">{t(K('firstGapStage'))}</p>
                    <p className="mt-1 font-display text-lg font-extrabold text-oc-ink">{plan.firstGapStage ? stageName(plan.firstGapStage) : t(K('none'))}</p>
                  </div>
                </div>
                <p className={hintText}>{t(K('peakNote'))}</p>

                <div className="mt-4 overflow-x-auto rounded-xl border border-[rgba(8,62,43,.1)]" data-testid="cash-flow-table">
                  <table className="w-full min-w-[620px] text-sm">
                    <thead className="bg-oc-sunken text-start text-[11px] font-extrabold uppercase tracking-wide text-oc-faint">
                      <tr>
                        <th className="px-3 py-2 text-start">{t(K('colStage'))}</th>
                        <th className="px-3 py-2 text-end">{t(K('colCost'))}</th>
                        <th className="px-3 py-2 text-end">{t(K('colFunding'))}</th>
                        <th className="px-3 py-2 text-end">{t(K('colRemaining'))}</th>
                        <th className="px-3 py-2 text-start">{t(K('colStatus'))}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[rgba(8,62,43,.08)]">
                      {plan.rows.map((row) => {
                        const first = row.stage === plan.firstGapStage
                        return (
                          <tr key={row.stage} data-first-gap={first || undefined} className={first ? 'bg-[#fde8e1] outline outline-2 -outline-offset-2 outline-[#ea580c]' : row.status === 'gap' ? 'bg-[#fff7f3]' : ''}>
                            <td className="px-3 py-2 font-bold text-oc-ink">
                              {stageName(row.stage)}
                              {first && <span className="ms-2 text-[10px] font-extrabold uppercase text-[#9a3412]">{t(K('firstGapTag'))}</span>}
                            </td>
                            <td className="px-3 py-2 text-end font-semibold text-oc-ink">{row.entered ? formatInr(row.amount) : '—'}</td>
                            <td className="px-3 py-2 text-end font-semibold text-oc-muted">{formatInr(row.fundingAvailable)}</td>
                            <td className={`px-3 py-2 text-end font-extrabold ${row.remaining < 0 ? 'text-[#9a3412]' : 'text-oc-ink'}`}>{formatSignedInr(row.remaining)}</td>
                            <td className="px-3 py-2">
                              {row.status === 'gap'
                                ? <Pill tone={GAP_TONE}>{t(K('statusGap'), { amount: formatInr(row.gap) })}</Pill>
                                : <Pill tone={OK_TONE}>{t(K('statusFunded'))}</Pill>}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
                <MethodNote>{progressive ? t(K('assumptionProgressive')) : t(K('assumptionStart'))}</MethodNote>
              </div>
            </>
          )}

          <MethodNote>{t(K('method'))}</MethodNote>
          <MethodNote>{t(K('disclosure'))} {t(K('noApproval'))}</MethodNote>
        </>
      )}
    </div>
  )
}
