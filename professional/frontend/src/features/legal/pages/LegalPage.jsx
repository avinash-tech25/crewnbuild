/**
 * The public Terms (/terms) and Privacy Policy (/privacy) pages: the landing site's
 * header and footer around the document. Open to everyone; a signed-in visitor stays
 * signed in. The header and footer are left out when printing.
 */
import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { SiteHeader } from '../../public-site/components/landing/SiteHeader.jsx'
import { SiteFooter } from '../../public-site/components/landing/SiteFooter.jsx'
import { useLanguage } from '../../public-site/components/landing/useLanguage.js'
import { LegalDocument } from '../components/LegalDocument.jsx'
import { privacy, terms } from '../legalDocuments.js'

function LegalPage({ doc }) {
  const { language, setLanguage, text } = useLanguage()
  const { hash } = useLocation()

  useEffect(() => {
    const previous = document.title
    document.title = `${doc.title} | CREWNBUILD`
    return () => { document.title = previous }
  }, [doc.title])

  // A deep link (/terms#section-id) lands on its section once the page is drawn.
  useEffect(() => {
    if (!hash) return
    document.getElementById(decodeURIComponent(hash.slice(1)))?.scrollIntoView?.({ block: 'start' })
  }, [hash])

  return (
    <div className="min-h-screen overflow-x-clip bg-oc-paper font-display text-oc-ink print:bg-white print:text-black" id="top">
      <div className="print:hidden"><SiteHeader text={text} brandHref="/" /></div>
      <main className="px-4 pb-20 pt-[96px] max-wide:pt-[84px] print:p-0">
        <div className="mx-auto max-w-[860px] rounded-2xl border border-oc-line bg-white px-5 py-8 shadow-sm sm:px-10 sm:py-10 print:max-w-none print:border-0 print:p-0 print:shadow-none">
          <LegalDocument doc={doc} />
        </div>
      </main>
      <div className="print:hidden"><SiteFooter text={text} language={language} onSelectLanguage={setLanguage} /></div>
    </div>
  )
}

export function TermsPage() {
  return <LegalPage doc={terms} />
}

export function PrivacyPage() {
  return <LegalPage doc={privacy} />
}
