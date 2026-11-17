/**
 * The public Terms (/terms) and Privacy Policy (/privacy) pages, one section at a time.
 *
 * The section shown is the one in the address (/terms#section-id; a short form such as
 * #cancellations reaches "cancellations-and-refunds"); without one, the first. Choosing a
 * section replaces the address rather than adding a history entry, so a link to any section
 * works and one Back always leaves the page. The page opens scrolled to the top. Open to
 * everyone; a signed-in visitor stays signed in.
 */
import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useLanguage } from '../../../i18n/LanguageContext.jsx'
import { LegalDocument, sectionFor } from '../components/LegalDocument.jsx'
import { LegalShell } from '../components/LegalShell.jsx'
import { LEGAL_TITLE_KEYS, privacy, terms } from '../legalDocuments.js'

function LegalPage({ doc }) {
  const { t } = useLanguage()
  const { hash } = useLocation()
  const navigate = useNavigate()
  const title = t(LEGAL_TITLE_KEYS[doc.id])
  const section = sectionFor(doc, hash)

  useEffect(() => {
    const previous = document.title
    document.title = `${title} | CREWNBUILD`
    return () => { document.title = previous }
  }, [title])

  // Always open at the top: the first section's start, not wherever the last page was.
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [doc.id])

  return (
    <LegalShell title={title}>
      <LegalDocument doc={doc} activeId={section.id} onSelect={(id) => navigate({ hash: id }, { replace: true })} />
    </LegalShell>
  )
}

export function TermsPage() {
  return <LegalPage doc={terms} />
}

export function PrivacyPage() {
  return <LegalPage doc={privacy} />
}
