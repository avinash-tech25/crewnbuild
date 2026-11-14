import { Lock } from 'lucide-react'
import { useLanguage } from '../../../i18n/LanguageContext.jsx'

export function AccentDot({ className = '' }) {
  return (
    <span className={`inline-flex h-2.5 w-2.5 rounded-full bg-brand-500 shadow-[0_0_0_4px_rgba(46,125,85,0.2)] ${className}`} />
  )
}

export function DetailItem({ label, value }) {
  const { t } = useLanguage()
  return (
    <p className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-[13px] shadow-[inset_0_1px_0_rgba(255,255,255,0.75)]">
      <span className="block text-[10px] font-extrabold uppercase tracking-wide text-slate-400">{label}</span>
      <span className="mt-0.5 block font-extrabold text-slate-900">{value || t('dash.common.notSet')}</span>
    </p>
  )
}

// What a locked tile shows in place of a contact that has not been unlocked.
// It used to be a fabricated email address and phone number, chosen by comparing
// the label against the English word "Email" -- a test that only ever matched in
// English, so every other language was shown the invented phone number whatever
// the field was. A neutral mask carries no language and invents no contact.
const MASKED_CONTACT = '••••••••••'

export function ContactDetail({ icon: Icon, label, value, canView }) {
  const { t } = useLanguage()
  // The value is passed already prepared by the caller: contact details such as
  // an address are translated there, while an email, a website or a phone number
  // are shown exactly as stored.
  const displayValue = value || MASKED_CONTACT
  return (
    <div className="rounded-2xl border border-brand-100 bg-white px-4 py-3">
      <p className="flex items-center gap-2 text-[11px] font-bold uppercase text-graphite/45">
        <Icon className="h-3.5 w-3.5 text-brand-700" /> {label}
      </p>
      <p className={`mt-1 font-bold text-graphite ${canView ? '' : 'select-none blur-sm'}`}>{displayValue}</p>
      {!canView && <p className="mt-1 flex items-center gap-1 text-[10px] font-bold text-slate-500"><Lock className="h-3 w-3" /> {t('dash.contractor.visibleAfterAcceptance')}</p>}
    </div>
  )
}
