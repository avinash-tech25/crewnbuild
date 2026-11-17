import { useEffect } from 'react'
import SiteHeader from '../../site/components/SiteHeader.jsx'
import SiteFooter from '../../site/components/SiteFooter.jsx'
import LegalDocument from '../components/LegalDocument.jsx'
import terms from '../content/terms.js'
import privacy from '../content/privacy.js'

const DOCUMENTS = { terms, privacy }

/** /terms and /privacy: public, with the landing page's header and footer (left out of print). */
export default function LegalPage({ document: name }) {
  const doc = DOCUMENTS[name]

  useEffect(() => {
    const previous = window.document.title
    window.document.title = doc.title
    return () => {
      window.document.title = previous
    }
  }, [doc])

  return (
    <div className="min-h-screen bg-oc-paper print:bg-white">
      <div className="contents print:hidden"><SiteHeader /></div>
      <main className="container-x py-10 sm:py-14 print:max-w-none print:p-0">
        <div className="mx-auto max-w-3xl rounded-2xl border border-oc-line bg-white p-6 shadow-ocsoft sm:p-10 print:max-w-none print:border-0 print:p-0 print:shadow-none">
          <LegalDocument doc={doc} />
        </div>
      </main>
      <div className="contents print:hidden"><SiteFooter /></div>
    </div>
  )
}
