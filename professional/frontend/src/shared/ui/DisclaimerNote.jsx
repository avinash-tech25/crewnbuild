import { Info } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useLanguage } from '../../i18n/LanguageContext.jsx'

/**
 * The Disclaimer's short notes (docs/legal: CREWNBUILD_Disclaimer.docx, "Short-Form
 * Disclaimers for Use on the Website"): one small grey line with an info icon and a
 * "Read disclaimer" link to the section of /disclaimer it summarises. Never a popup.
 *
 * The wording is the document's own short form (brand already CREWNBUILD); where the
 * document has no short form for a place (property prices, Book Technician, adverts, the
 * language switcher, Viswa), the line quotes the section it links to.
 */
export const DISCLAIMER_NOTES = {
  general: { key: 'disclaimer.note.general', section: 'disclaimers-for-specific-tools' },
  cost: { key: 'disclaimer.note.cost', section: 'disclaimers-for-specific-tools' },
  vastu: { key: 'disclaimer.note.vastu', section: 'disclaimers-for-specific-tools' },
  loan: { key: 'disclaimer.note.loan', section: 'disclaimers-for-specific-tools' },
  tax: { key: 'disclaimer.note.tax', section: 'disclaimers-for-specific-tools' },
  quote: { key: 'disclaimer.note.quote', section: 'disclaimers-for-specific-tools' },
  prices: { key: 'disclaimer.note.prices', section: 'disclaimers-for-specific-tools' },
  property: { key: 'disclaimer.note.property', section: 'payments-pricing-and-financial-matters' },
  verified: { key: 'disclaimer.note.verified', section: 'verification-and-the-verified-badge' },
  leads: { key: 'disclaimer.note.leads', section: 'contractors-service-professionals-suppliers-and-user-content' },
  payments: { key: 'disclaimer.note.payments', section: 'payments-pricing-and-financial-matters' },
  labour: { key: 'disclaimer.note.labour', section: 'labour-and-statutory-compliance' },
  technician: { key: 'disclaimer.note.technician', section: 'read-this-first' },
  sponsored: { key: 'disclaimer.note.sponsored', section: 'contractors-service-professionals-suppliers-and-user-content' },
  language: { key: 'disclaimer.note.language', section: 'languages-and-translations' },
  assistant: { key: 'disclaimer.note.assistant', section: 'not-professional-advice' },
}

export const disclaimerHref = (kind) => `/disclaimer#${DISCLAIMER_NOTES[kind].section}`

export function DisclaimerNote({ kind, className = '', tone = 'light' }) {
  const { t } = useLanguage()
  const note = DISCLAIMER_NOTES[kind]
  if (!note) return null
  const dark = tone === 'dark'
  return (
    <p
      data-testid="disclaimer-note"
      data-note={kind}
      className={`flex items-start gap-1.5 text-[11px] leading-snug ${dark ? 'text-white/70' : 'text-slate-500'} ${className}`}
    >
      <Info aria-hidden="true" className="mt-px h-3.5 w-3.5 shrink-0" />
      <span>
        {t(note.key)}{' '}
        <Link
          to={disclaimerHref(kind)}
          className={`font-semibold underline underline-offset-2 ${dark ? 'text-white/85 hover:text-white' : 'text-slate-600 hover:text-oc-green'}`}
        >
          {t('disclaimer.read')}
        </Link>
      </span>
    </p>
  )
}
