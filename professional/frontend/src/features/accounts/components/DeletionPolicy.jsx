import { POLICY_SECTIONS, POLICY_TITLE } from './deletionPolicy.js'
import { useLanguage } from '../../../i18n/LanguageContext.jsx'

function Paragraph({ value }) {
  const parts = Array.isArray(value) ? value : [value]
  return (
    <p>
      {parts.map((part, index) => (typeof part === 'string'
        ? <span key={index}>{part}</span>
        : <strong key={index} className="font-bold text-oc-ink">{part.strong}</strong>))}
    </p>
  )
}

/**
 * The account deletion policy, rendered the same way wherever it appears: the
 * Delete Account form (Profile Settings and /delete-account) and the
 * /delete-account page before sign-in. The text is in deletionPolicy.js.
 */
export default function DeletionPolicy() {
  const { t } = useLanguage()
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs leading-5 text-slate-700">
      <p className="text-xs font-extrabold uppercase tracking-wide text-oc-muted">{t('account.deletePolicy')}</p>
      {t('account.deletePolicyNote') && <p className="mt-0.5 italic text-oc-muted">{t('account.deletePolicyNote')}</p>}
      <div dir="ltr" lang="en" className="mt-2 space-y-3">
        <p className="text-sm font-extrabold text-oc-ink">{POLICY_TITLE}</p>
        {POLICY_SECTIONS.map((section) => (
          <section key={section.id} className="space-y-1">
            <h4 className="font-bold text-oc-ink">{section.title}</h4>
            {section.intro && <p>{section.intro}</p>}
            {section.items && (
              <ul className="space-y-1">
                {section.items.map((item) => (
                  <li key={item.label} className="flex gap-2">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-rose-400" />
                    <span><strong className="font-bold text-oc-ink">{item.label}:</strong> {item.text}</span>
                  </li>
                ))}
              </ul>
            )}
            {section.paragraphs?.map((paragraph, index) => <Paragraph key={index} value={paragraph} />)}
            {section.outro && <p>{section.outro}</p>}
            {section.quote && <blockquote className="border-l-2 border-rose-300 pl-3 italic">“{section.quote}”</blockquote>}
          </section>
        ))}
      </div>
    </div>
  )
}
