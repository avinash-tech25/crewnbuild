/**
 * The public Legal hub (/legal): a welcome card, one card per policy (a short summary of
 * what it covers, its version and effective date, and a link to the full text), and a
 * Contact card. The landing site's header and footer around it, as on /terms and /privacy.
 * The summaries are ours, not the policies' wording; the policies themselves are only on
 * /terms and /privacy.
 */
import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, FileText, Mail, Phone, ShieldCheck } from 'lucide-react'
import { SiteHeader } from '../../public-site/components/landing/SiteHeader.jsx'
import { SiteFooter } from '../../public-site/components/landing/SiteFooter.jsx'
import { useLanguage } from '../../public-site/components/landing/useLanguage.js'
import { useLanguage as useAppLanguage } from '../../../i18n/LanguageContext.jsx'
import { SUPPORT_PHONE, phoneHref } from '../../../shared/constants/support.js'
import { privacy, terms } from '../legalDocuments.js'

export const SUPPORT_EMAIL = 'support@crewnbuild.com'

const POLICIES = [
  { doc: terms, to: '/terms', icon: FileText, titleKey: 'legal.hub.termsTitle', summaryKey: 'legal.hub.termsSummary', linkKey: 'legal.hub.termsLink' },
  { doc: privacy, to: '/privacy', icon: ShieldCheck, titleKey: 'legal.hub.privacyTitle', summaryKey: 'legal.hub.privacySummary', linkKey: 'legal.hub.privacyLink' },
]

const card = 'rounded-2xl border border-oc-line bg-white p-6 shadow-sm sm:p-8'

export function LegalHubPage() {
  const { language, setLanguage, text } = useLanguage()
  const { t } = useAppLanguage()

  useEffect(() => {
    const previous = document.title
    document.title = `${t('legal.hub.title')} | CREWNBUILD`
    window.scrollTo(0, 0)
    return () => { document.title = previous }
  }, [t])

  return (
    <div className="min-h-screen overflow-x-clip bg-oc-paper font-display text-oc-ink">
      <SiteHeader text={text} brandHref="/" />
      <main className="px-4 pb-20 pt-[96px] max-wide:pt-[84px]">
        <div className="mx-auto grid max-w-[860px] gap-5">
          <h1 className="text-[clamp(1.9rem,1.5rem+1.6vw,2.6rem)] font-extrabold leading-tight tracking-[-.02em] text-oc-deep">
            {t('legal.hub.title')}
          </h1>

          <section aria-label={t('legal.hub.welcome')} className={`${card} border-s-4 border-s-oc-amber`}>
            <p className="text-lg font-extrabold text-oc-deep">{t('legal.hub.welcome')}</p>
            <p className="mt-2 text-[15px] leading-relaxed text-oc-muted">{t('legal.hub.intro')}</p>
          </section>

          {POLICIES.map(({ doc, to, icon: Icon, titleKey, summaryKey, linkKey }) => (
            <section key={doc.id} aria-labelledby={`legal-hub-${doc.id}`} className={card}>
              <div className="flex items-start gap-4">
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-oc-mint text-oc-green" aria-hidden="true">
                  <Icon className="h-5 w-5" />
                </span>
                <div className="min-w-0">
                  <h2 id={`legal-hub-${doc.id}`} className="text-xl font-extrabold text-oc-deep">{t(titleKey)}</h2>
                  <p className="mt-1 text-[13px] text-oc-muted">
                    {t('legal.version')}: {doc.version} · {t('legal.effectiveDate')}: {doc.effectiveDate}
                  </p>
                  <p className="mt-3 text-[15px] leading-relaxed text-oc-ink/85">{t(summaryKey)}</p>
                  <Link
                    to={to}
                    className="mt-5 inline-flex items-center gap-2 rounded-full bg-oc-green px-5 py-2.5 text-sm font-bold text-white transition hover:bg-oc-deep focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-oc-amber focus-visible:ring-offset-2"
                  >
                    {t(linkKey)} <ArrowRight className="h-4 w-4 rtl:rotate-180" aria-hidden="true" />
                  </Link>
                </div>
              </div>
            </section>
          ))}

          <section aria-labelledby="legal-hub-contact" className="rounded-2xl bg-oc-deep p-6 text-white sm:p-8">
            <h2 id="legal-hub-contact" className="text-xl font-extrabold">{t('legal.hub.contactTitle')}</h2>
            <p className="mt-2 text-[15px] text-white/75">{t('legal.hub.contactText')}</p>
            <ul className="mt-4 grid gap-3 text-[15px] font-semibold sm:grid-cols-2">
              <li className="flex items-center gap-2.5">
                <Mail className="h-4 w-4 shrink-0 text-oc-amber" aria-hidden="true" />
                <a href={`mailto:${SUPPORT_EMAIL}`} className="hover:text-oc-amber hover:underline" dir="ltr">{SUPPORT_EMAIL}</a>
              </li>
              <li className="flex items-center gap-2.5">
                <Phone className="h-4 w-4 shrink-0 text-oc-amber" aria-hidden="true" />
                <a href={phoneHref(SUPPORT_PHONE)} className="hover:text-oc-amber hover:underline" dir="ltr">{SUPPORT_PHONE}</a>
              </li>
            </ul>
          </section>
        </div>
      </main>
      <SiteFooter text={text} language={language} onSelectLanguage={setLanguage} />
    </div>
  )
}

export default LegalHubPage
