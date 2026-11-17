import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, FileText, Mail, Phone, ShieldCheck } from 'lucide-react'
import SiteHeader from '../../site/components/SiteHeader.jsx'
import SiteFooter from '../../site/components/SiteFooter.jsx'
import { SUPPORT_EMAIL, SUPPORT_PHONE, phoneHref } from '../../../shared/constants/support.js'
import terms from '../content/terms.js'
import privacy from '../content/privacy.js'

const POLICIES = [
  {
    doc: terms,
    to: '/terms',
    icon: FileText,
    title: 'Terms and Conditions',
    summary:
      'The rules for using CREWNBUILD: your account, what Homeowners, Contractors, Service Professionals and Suppliers agree to, fees and refunds, and how disputes are handled.',
    link: 'View Terms and Conditions',
  },
  {
    doc: privacy,
    to: '/privacy',
    icon: ShieldCheck,
    title: 'Privacy Policy',
    summary: 'What personal data we collect, why we use it, who we share it with, how long we keep it, and your rights over it.',
    link: 'View Privacy Policy',
  },
]

const card = 'rounded-2xl border border-oc-line bg-white p-6 shadow-ocsoft sm:p-8'

/**
 * /legal: the public Legal hub. A welcome card, one card per policy (a short summary of what it
 * covers, its version and effective date, a link to the full text) and a Contact card, with the
 * landing page's header and footer. The summaries are ours; the policies' wording is only on
 * /terms and /privacy.
 */
export default function LegalHubPage() {
  useEffect(() => {
    const previous = window.document.title
    window.document.title = 'Legal | CREWNBUILD'
    window.scrollTo(0, 0)
    return () => {
      window.document.title = previous
    }
  }, [])

  return (
    <div className="min-h-screen bg-oc-paper">
      <SiteHeader />
      <main className="container-x py-10 sm:py-14">
        <div className="mx-auto grid max-w-3xl gap-5">
          <h1 className="text-3xl font-extrabold text-oc-deep sm:text-4xl">Legal</h1>

          <section aria-label="Welcome to CREWNBUILD" className={`${card} border-l-4 border-l-oc-amber`}>
            <p className="text-lg font-extrabold text-oc-deep">Welcome to CREWNBUILD</p>
            <p className="mt-2 text-[15px] leading-relaxed text-oc-muted">
              Before you use our platform, please review our legal policies. They explain the rules for using CREWNBUILD and how
              we collect, use and protect your personal data.
            </p>
          </section>

          {POLICIES.map(({ doc, to, icon: Icon, title, summary, link }) => (
            <section key={doc.id} aria-labelledby={`legal-hub-${doc.id}`} className={card}>
              <div className="flex items-start gap-4">
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-oc-mint text-oc-green" aria-hidden="true">
                  <Icon className="h-5 w-5" />
                </span>
                <div className="min-w-0">
                  <h2 id={`legal-hub-${doc.id}`} className="text-xl font-extrabold text-oc-deep">{title}</h2>
                  <p className="mt-1 text-[13px] text-oc-muted">
                    Version: {doc.version} · Effective date: {doc.effectiveDate}
                  </p>
                  <p className="mt-3 text-[15px] leading-relaxed text-oc-ink/85">{summary}</p>
                  <Link
                    to={to}
                    className="mt-5 inline-flex items-center gap-2 rounded-full bg-oc-green px-5 py-2.5 text-sm font-bold text-white transition hover:bg-oc-deep focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-oc-amber focus-visible:ring-offset-2"
                  >
                    {link} <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </Link>
                </div>
              </div>
            </section>
          ))}

          <section aria-labelledby="legal-hub-contact" className="rounded-2xl bg-oc-deep p-6 text-white sm:p-8">
            <h2 id="legal-hub-contact" className="text-xl font-extrabold">Contact</h2>
            <p className="mt-2 text-[15px] text-white/75">Questions about these policies? Write to us or call.</p>
            <ul className="mt-4 grid gap-3 text-[15px] font-semibold sm:grid-cols-2">
              <li className="flex items-center gap-2.5">
                <Mail className="h-4 w-4 shrink-0 text-oc-amber" aria-hidden="true" />
                <a href={`mailto:${SUPPORT_EMAIL}`} className="hover:text-oc-amber hover:underline">{SUPPORT_EMAIL}</a>
              </li>
              <li className="flex items-center gap-2.5">
                <Phone className="h-4 w-4 shrink-0 text-oc-amber" aria-hidden="true" />
                <a href={phoneHref(SUPPORT_PHONE)} className="hover:text-oc-amber hover:underline">{SUPPORT_PHONE}</a>
              </li>
            </ul>
          </section>
        </div>
      </main>
      <SiteFooter />
    </div>
  )
}
