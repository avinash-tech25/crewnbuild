import { useEffect } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import SiteHeader from '../../site/components/SiteHeader.jsx'
import SiteFooter from '../../site/components/SiteFooter.jsx'
import LegalDocument from '../components/LegalDocument.jsx'
import terms from '../content/terms.js'
import privacy from '../content/privacy.js'

const DOCUMENTS = { terms, privacy }

/**
 * /terms and /privacy: public, with the landing page's header and footer and a Back link to the
 * Legal hub (/legal); all three are left out of print. The page opens at the top, or at the
 * section a deep link (/terms#section-id) names.
 */
export default function LegalPage({ document: name }) {
  const doc = DOCUMENTS[name]
  const { hash } = useLocation()

  useEffect(() => {
    const section = hash ? window.document.getElementById(decodeURIComponent(hash.slice(1))) : null
    if (section) section.scrollIntoView?.({ block: 'start' })
    else window.scrollTo(0, 0)
    // A contents link scrolls by itself (it changes the address, not the router's location).
  }, [name, hash])

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
        <div className="mx-auto mb-4 max-w-3xl print:hidden">
          <Link to="/legal" className="inline-flex items-center gap-1.5 text-sm font-bold text-oc-green hover:underline">
            <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back to Legal
          </Link>
        </div>
        <div className="mx-auto max-w-3xl rounded-2xl border border-oc-line bg-white p-6 shadow-ocsoft sm:p-10 print:max-w-none print:border-0 print:p-0 print:shadow-none">
          <LegalDocument doc={doc} />
        </div>
      </main>
      <div className="contents print:hidden"><SiteFooter /></div>
    </div>
  )
}
