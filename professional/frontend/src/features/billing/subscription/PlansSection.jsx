import { useEffect, useState } from 'react'
import { useLanguage } from '../../../i18n/LanguageContext.jsx'
import { fetchSubscriptionPlans } from '../subscriptionApi.js'
import PlanCards from './PlanCards.jsx'
import { clearPendingPlan, savePendingPlan } from './pendingPlan.js'
import { subscriptionErrorMessage } from './subscriptionFormat.js'
import { PAID_PLAN_BUTTON } from './subscriptionOffers.js'

// Public landing section (#plans). Visitors here are signed out, so choosing a paid
// option remembers the choice and leads to builder sign-up (or sign-in); after the
// account exists and the e-mail is verified, the builder's Plan & billing page
// offers that choice for payment. Free sign-up never involves a payment.
//
// The Get Started builder sign-up shows the same section as its plan step, before
// the account is created: it passes onChoose / onChooseFree and the cards then
// hand the choice back to the sign-up form instead of opening /signup or /login.
export default function PlansSection({ onChoose = null, onChooseFree = null, busy = false }) {
  const { t } = useLanguage()
  const [catalogue, setCatalogue] = useState(null)
  // The server's own explanation when the plans cannot be loaded (e.g. the
  // subscription tables are not migrated yet), never a silent generic message.
  const [failure, setFailure] = useState('')

  useEffect(() => {
    let live = true
    fetchSubscriptionPlans()
      .then((data) => { if (live) setCatalogue(data) })
      .catch((error) => { if (live) setFailure(subscriptionErrorMessage(error, t('subscription.plans.loadFailed'))) })
    return () => { live = false }
  }, [t])

  const choose = (planCode, durationCode) => {
    if (onChoose) { onChoose(planCode, durationCode); return }
    savePendingPlan(planCode, durationCode)
    window.location.assign(`/signup?role=builder&plan=${planCode}&billing=${durationCode}`)
  }
  const signIn = (planCode, durationCode) => {
    savePendingPlan(planCode, durationCode)
    window.location.assign('/login')
  }

  return (
    <section id="plans" aria-labelledby="plans-title" className="scroll-mt-24 px-4 py-16 sm:py-20">
      <div className="mx-auto max-w-6xl">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-xs font-extrabold uppercase tracking-widest text-emerald-700">{t('subscription.plans.kicker')}</p>
          <h2 id="plans-title" className="mt-2 text-3xl font-extrabold text-oc-ink sm:text-4xl">{t('subscription.plans.title')}</h2>
          <p className="mt-3 text-sm font-semibold text-slate-600 sm:text-base">{t('subscription.plans.intro')}</p>
          <p className="mt-2 text-[11px] font-bold text-amber-700">{t('subscription.plans.testMode')}</p>
        </div>
        <div className="mt-10">
          {failure && <p role="alert" className="mx-auto max-w-xl rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-center text-sm font-bold text-rose-800">{failure}</p>}
          {!failure && !catalogue && <p className="text-center text-sm font-bold text-slate-400">{t('subscription.panel.loading')}</p>}
          {catalogue && (
            <PlanCards
              catalogue={catalogue}
              renderFreeAction={() => (onChooseFree ? (
                <button type="button" disabled={busy} onClick={onChooseFree}
                  className="inline-flex h-11 w-full items-center justify-center rounded-lg border border-slate-300 text-sm font-extrabold text-slate-800 transition hover:bg-slate-50 disabled:opacity-45">
                  {t('subscription.cta.signup')}
                </button>
              ) : (
                <a href="/signup?role=builder&plan=FREE" onClick={clearPendingPlan}
                  className="inline-flex h-11 w-full items-center justify-center rounded-lg border border-slate-300 text-sm font-extrabold text-slate-800 transition hover:bg-slate-50">
                  {t('subscription.cta.signup')}
                </a>
              ))}
              renderAction={(offer, action) => (
                action === 'unavailable' ? (
                  <span className="inline-flex h-11 w-full items-center justify-center rounded-lg bg-slate-100 text-xs font-extrabold text-slate-500">
                    {t('subscription.cta.unavailable')}
                  </span>
                ) : (
                  <div className="grid gap-1.5">
                    <button type="button" disabled={busy} onClick={() => choose(offer.planCode, offer.durationCode)}
                      className={`inline-flex h-11 w-full items-center justify-center rounded-lg text-sm font-extrabold transition disabled:opacity-45 ${PAID_PLAN_BUTTON}`}>
                      {t('subscription.cta.chooseNamed', { plan: t(`subscription.offer.${offer.id}.name`) })}
                    </button>
                    {!onChoose && (
                      <button type="button" onClick={() => signIn(offer.planCode, offer.durationCode)} className="text-center text-[11px] font-bold text-emerald-700 hover:underline">
                        {t('subscription.cta.signin')}
                      </button>
                    )}
                  </div>
                )
              )}
            />
          )}        </div>
      </div>
    </section>
  )
}
