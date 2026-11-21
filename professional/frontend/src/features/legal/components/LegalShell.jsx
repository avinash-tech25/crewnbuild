/**
 * The frame every legal page shares (/legal, /terms, /privacy): the landing site's header
 * and footer around a dark green section with one "Back" button, a centred title and one
 * rounded card. Printing keeps only the title and the card's text, in black on white.
 *
 * Back returns to the page the visitor came from (the landing page's footer, sign-up, a
 * dashboard), at the place they left it; the landing page when there is none on this site.
 */
import { ArrowLeft } from 'lucide-react'
import { useLanguage as useAppLanguage } from '../../../i18n/LanguageContext.jsx'
import { useBackNavigation } from '../../../shared/navigation/scrollMemory.js'
import { SiteHeader } from '../../public-site/components/landing/SiteHeader.jsx'
import { SiteFooter } from '../../public-site/components/landing/SiteFooter.jsx'
import { useLanguage } from '../../public-site/components/landing/useLanguage.js'

const BACK =
  'inline-flex items-center gap-2 rounded-full px-1 py-1 text-[14px] font-bold text-white/85 transition hover:text-oc-amber ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-oc-amber'

export function LegalShell({ title, children }) {
  const { language, setLanguage, text } = useLanguage()
  const { t } = useAppLanguage()
  const goBack = useBackNavigation()
  const arrow = <ArrowLeft className="h-5 w-5 rtl:rotate-180" aria-hidden="true" />

  return (
    <div className="min-h-screen overflow-x-clip bg-oc-deep font-display print:bg-white">
      <div className="print:hidden"><SiteHeader text={text} brandHref="/" /></div>
      <main className="px-4 pb-20 pt-[104px] text-white max-wide:pt-[92px] print:p-0 print:text-black">
        <div className="mx-auto max-w-page">
          <div className="print:hidden">
            <button type="button" onClick={goBack} className={BACK}>{arrow}{t('legal.back')}</button>
          </div>
          <h1 className="mt-4 text-center text-[clamp(1.9rem,1.4rem+2vw,2.9rem)] font-extrabold leading-tight tracking-[-.02em] text-white print:mt-0 print:text-start print:text-black">
            {title}
          </h1>
          <div className="mx-auto mt-3 h-1 w-16 rounded-full bg-oc-amber print:hidden" aria-hidden="true" />
          <div className="mt-8 rounded-3xl border border-white/10 bg-white/[0.06] p-5 shadow-[0_24px_60px_rgba(0,0,0,.25)] sm:p-8 lg:p-10 print:mt-4 print:border-0 print:bg-transparent print:p-0 print:shadow-none">
            {children}
          </div>
        </div>
      </main>
      <div className="print:hidden"><SiteFooter text={text} language={language} onSelectLanguage={setLanguage} /></div>
    </div>
  )
}

export default LegalShell
