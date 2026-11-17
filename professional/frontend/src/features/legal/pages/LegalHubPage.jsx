/**
 * The public Legal hub (/legal): one card with an introduction, a short summary of each
 * policy with a link to it (Terms, Privacy, and the Cancellation & Refund Policy, which is
 * section 10 of the Terms), and a Contact box. The summaries are ours; the policies'
 * wording is only on /terms and /privacy.
 */
import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Mail, Phone } from 'lucide-react'
import { useLanguage } from '../../../i18n/LanguageContext.jsx'
import { SUPPORT_PHONE, phoneHref } from '../../../shared/constants/support.js'
import { LegalShell } from '../components/LegalShell.jsx'

export const SUPPORT_EMAIL = 'support@crewnbuild.com'

const POLICIES = [
  { id: 'terms', to: '/terms', titleKey: 'legal.hub.termsTitle', summaryKey: 'legal.hub.termsSummary', linkKey: 'legal.hub.termsLink' },
  { id: 'privacy', to: '/privacy', titleKey: 'legal.hub.privacyTitle', summaryKey: 'legal.hub.privacySummary', linkKey: 'legal.hub.privacyLink' },
  { id: 'refunds', to: '/terms#cancellations', titleKey: 'legal.hub.refundTitle', summaryKey: 'legal.hub.refundSummary', linkKey: 'legal.hub.refundLink' },
]

const LINK =
  'mt-3 inline-block font-bold text-oc-amber underline decoration-2 underline-offset-4 transition hover:text-white ' +
  'focus-visible:rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-oc-amber'

export function LegalHubPage() {
  const { t } = useLanguage()

  useEffect(() => {
    const previous = document.title
    document.title = `${t('legal.hub.title')} | CREWNBUILD`
    window.scrollTo(0, 0)
    return () => { document.title = previous }
  }, [t])

  return (
    <LegalShell title={t('legal.hub.heading')}>
      <div className="mx-auto max-w-[75ch] text-[16px] leading-[1.7] text-white/90">
        <p>{t('legal.hub.intro')}</p>

        {POLICIES.map(({ id, to, titleKey, summaryKey, linkKey }) => (
          <section key={id} aria-labelledby={`legal-hub-${id}`} className="mt-8 border-t border-white/15 pt-7">
            <h2 id={`legal-hub-${id}`} className="text-[1.3rem] font-extrabold text-white">{t(titleKey)}</h2>
            <p className="mt-2">{t(summaryKey)}</p>
            <Link to={to} className={LINK}>{t(linkKey)}</Link>
          </section>
        ))}

        <section aria-labelledby="legal-hub-contact" className="mt-9 rounded-2xl border border-oc-amber/60 bg-oc-amber/10 p-5 sm:p-6">
          <h2 id="legal-hub-contact" className="text-[1.2rem] font-extrabold text-oc-amber">{t('legal.hub.contactTitle')}</h2>
          <p className="mt-1">{t('legal.hub.contactText')}</p>
          <ul className="mt-3 grid gap-2 font-semibold sm:grid-cols-2">
            <li className="flex items-center gap-2.5">
              <Mail className="h-4 w-4 shrink-0 text-oc-amber" aria-hidden="true" />
              <a href={`mailto:${SUPPORT_EMAIL}`} className="text-white underline-offset-4 hover:text-oc-amber hover:underline" dir="ltr">{SUPPORT_EMAIL}</a>
            </li>
            <li className="flex items-center gap-2.5">
              <Phone className="h-4 w-4 shrink-0 text-oc-amber" aria-hidden="true" />
              <a href={phoneHref(SUPPORT_PHONE)} className="text-white underline-offset-4 hover:text-oc-amber hover:underline" dir="ltr">{SUPPORT_PHONE}</a>
            </li>
          </ul>
        </section>
      </div>
    </LegalShell>
  )
}

export default LegalHubPage
