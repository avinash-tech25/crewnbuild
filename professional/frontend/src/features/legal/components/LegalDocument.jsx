/**
 * One legal document (Terms, Privacy) as readable, printable text: the title, the
 * effective date / version / last updated line, a table of contents, then every
 * section under an <h2 id={section.id}> so /terms#section-id deep-links to it.
 *
 * The text is shown exactly as generated. [Bracketed placeholders] still waiting for
 * legal review are kept as they are, only marked so they are easy to spot.
 *
 * `inDialog`: the contents list scrolls inside the window instead of changing the
 * page's address, so a sign-up form behind the window is not disturbed.
 */
import { useLanguage } from '../../../i18n/LanguageContext.jsx'

const PLACEHOLDER = /(\[[^\]]+\])/

function Text({ value }) {
  return String(value).split(PLACEHOLDER).map((piece, index) => (
    index % 2 === 1
      ? <mark key={index} className="rounded bg-amber-100 px-0.5 text-inherit print:bg-transparent">{piece}</mark>
      : piece
  ))
}

function Parts({ parts }) {
  return parts.map((part, index) => (
    typeof part === 'string'
      ? <Text key={index} value={part} />
      : <strong key={index} className="font-bold text-slate-950 print:text-black"><Text value={part.b} /></strong>
  ))
}

const sectionLabel = (section) => (section.number ? `${section.number}. ${section.title}` : section.title)

export function LegalDocument({ doc, inDialog = false }) {
  const { t } = useLanguage()
  const jumpTo = (event, id) => {
    if (!inDialog) return
    event.preventDefault()
    event.currentTarget.closest('[data-legal-document]')?.querySelector(`[id="${id}"]`)?.scrollIntoView?.({ block: 'start' })
  }

  return (
    <article data-legal-document="" className="mx-auto max-w-[70ch] text-[15px] leading-[1.75] text-slate-800 print:max-w-none print:text-[11pt] print:text-black">
      <header className="border-b border-slate-200 pb-5 print:border-black">
        <h1 className="font-display text-[clamp(1.5rem,1.2rem+1.2vw,2.15rem)] font-extrabold leading-tight tracking-[-.02em] text-slate-950 print:text-black">
          {doc.title}
        </h1>
        <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-slate-600 print:text-black">
          <span>{t('legal.effectiveDate')}: <Text value={doc.effectiveDate} /></span>
          <span>{t('legal.version')}: {doc.version}</span>
          <span>{t('legal.lastUpdated')}: <Text value={doc.lastUpdated} /></span>
        </p>
        <p className="mt-1 text-[13px] text-slate-600 print:text-black">
          <Text value={doc.company} /> · {doc.site}
        </p>
      </header>

      <nav aria-label={t('legal.contents')} className="my-6 rounded-xl border border-slate-200 bg-slate-50 px-5 py-4 print:hidden">
        <h2 className="text-[11px] font-extrabold uppercase tracking-wide text-slate-500">{t('legal.contents')}</h2>
        <ol className="mt-2 grid gap-1 text-[14px] leading-snug">
          {doc.sections.map((section) => (
            <li key={section.id}>
              <a href={`#${section.id}`} onClick={(event) => jumpTo(event, section.id)} className="text-oc-green hover:underline">
                {sectionLabel(section)}
              </a>
            </li>
          ))}
        </ol>
      </nav>

      {doc.sections.map((section) => (
        <section key={section.id} aria-labelledby={section.id} className="mt-8 first-of-type:mt-6">
          <h2 id={section.id} className="scroll-mt-24 font-display text-[1.2rem] font-extrabold leading-snug text-slate-950 print:break-after-avoid print:text-black">
            {sectionLabel(section)}
          </h2>
          {section.blocks.map((block, index) => (
            block.type === 'list' ? (
              <ul key={index} className="mt-3 list-disc space-y-2 ps-6">
                {block.items.map((item, itemIndex) => (
                  <li key={itemIndex} className="break-inside-avoid"><Parts parts={item} /></li>
                ))}
              </ul>
            ) : (
              <p key={index} className="mt-3"><Parts parts={block.parts} /></p>
            )
          ))}
        </section>
      ))}
    </article>
  )
}

export default LegalDocument
