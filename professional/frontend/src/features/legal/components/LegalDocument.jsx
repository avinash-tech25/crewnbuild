/**
 * A legal document (Terms, Privacy) read one section at a time: a list of the section
 * headings on the left (a dropdown on small screens), the chosen section beside it with
 * Previous / Next at its foot, and "Last updated" at the bottom. Used by /terms and
 * /privacy and by the sign-up dialog; the caller owns which section is shown
 * (`activeId`, `onSelect`), so the page can keep it in the address (#section-id).
 *
 * The wording is exactly the generated text. Printing shows the whole document, every
 * section in order, from a print-only copy (hidden on screen and from assistive tech).
 *
 * Dark green surface, white text, amber accents; lines stay under ~75 characters with a
 * 1.7 line height.
 */
import { useEffect, useRef } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useLanguage } from '../../../i18n/LanguageContext.jsx'

export const sectionLabel = (section) => (section.number ? `${section.number}. ${section.title}` : section.title)

/**
 * The section a hash names: its id, or the first id starting with it, so a short link
 * such as /terms#cancellations reaches "cancellations-and-refunds". Otherwise the first.
 */
export function sectionFor(doc, hash) {
  const wanted = decodeURIComponent(String(hash || '').replace(/^#/, ''))
  if (wanted) {
    const found = doc.sections.find((section) => section.id === wanted)
      || doc.sections.find((section) => section.id.startsWith(`${wanted}-`))
    if (found) return found
  }
  return doc.sections[0]
}

function Parts({ parts }) {
  return parts.map((part, index) => (
    typeof part === 'string'
      ? part
      : <strong key={index} className="font-bold text-white print:text-black">{part.b}</strong>
  ))
}

function Blocks({ section }) {
  return section.blocks.map((block, index) => {
    if (block.type !== 'list') return <p key={index} className="mt-4"><Parts parts={block.parts} /></p>
    const List = block.ordered ? 'ol' : 'ul'
    return (
      <List
        key={index}
        className={`mt-4 space-y-2 ps-6 marker:text-oc-amber print:marker:text-black ${block.ordered ? 'list-decimal' : 'list-disc'}`}
      >
        {block.items.map((item, itemIndex) => <li key={itemIndex} className="ps-1"><Parts parts={item} /></li>)}
      </List>
    )
  })
}

const BODY = 'max-w-[75ch] text-[16px] leading-[1.7] text-white/90 print:max-w-none print:text-[11pt] print:text-black'
const STEP_BUTTON =
  'group flex min-w-0 max-w-[48%] flex-col gap-0.5 rounded-xl border border-white/15 px-4 py-3 text-start transition ' +
  'hover:border-oc-amber hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-oc-amber'

export function LegalDocument({ doc, activeId, onSelect, idPrefix = '' }) {
  const { t } = useLanguage()
  const index = Math.max(0, doc.sections.findIndex((section) => section.id === activeId))
  const section = doc.sections[index]
  const previous = doc.sections[index - 1]
  const next = doc.sections[index + 1]
  const content = useRef(null)
  const heading = useRef(null)
  const shown = useRef(section.id)

  // A newly chosen section: bring its start into view and put keyboard focus on its
  // heading, so the reader (and a screen reader) continues there. Not on first open.
  useEffect(() => {
    if (shown.current === section.id) return
    shown.current = section.id
    content.current?.scrollIntoView?.({ block: 'start' })
    heading.current?.focus({ preventScroll: true })
  }, [section.id])

  const select = (event, id) => {
    event.preventDefault()
    onSelect(id)
  }
  const selectId = `${idPrefix}legal-section-select`

  return (
    <div data-legal-document="" className="text-white print:text-black">
      <div className="grid gap-6 md:grid-cols-[minmax(190px,240px)_minmax(0,1fr)] md:gap-10 print:!block">
        <div className="md:hidden print:hidden">
          <label htmlFor={selectId} className="text-[12px] font-extrabold uppercase tracking-[.14em] text-oc-amber">
            {t('legal.sections')}
          </label>
          <select
            id={selectId}
            value={section.id}
            onChange={(event) => onSelect(event.target.value)}
            className="mt-2 w-full rounded-xl border border-white/25 bg-oc-deep px-3 py-2.5 text-[15px] text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-oc-amber"
          >
            {doc.sections.map((item) => <option key={item.id} value={item.id}>{sectionLabel(item)}</option>)}
          </select>
        </div>

        <nav aria-label={t('legal.sections')} className="hidden md:block print:hidden">
          <ol className="sticky top-24 grid gap-0.5 border-s border-white/15 text-[14px] leading-snug">
            {doc.sections.map((item) => {
              const current = item.id === section.id
              return (
                <li key={item.id}>
                  <a
                    href={`#${item.id}`}
                    aria-current={current ? 'true' : undefined}
                    onClick={(event) => select(event, item.id)}
                    className={`-ms-px block border-s-2 py-1.5 ps-4 pe-2 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-oc-amber ${
                      current
                        ? 'border-oc-amber font-bold text-oc-amber'
                        : 'border-transparent text-white/80 hover:border-white/40 hover:text-white'
                    }`}
                  >
                    {sectionLabel(item)}
                  </a>
                </li>
              )
            })}
          </ol>
        </nav>

        <section ref={content} aria-labelledby={`${idPrefix}${section.id}`} className="min-w-0 scroll-mt-28 print:hidden">
          <h2
            ref={heading}
            id={`${idPrefix}${section.id}`}
            tabIndex={-1}
            className="font-display text-[1.35rem] font-extrabold leading-snug text-white focus:outline-none"
          >
            {sectionLabel(section)}
          </h2>
          <div className={BODY}><Blocks section={section} /></div>

          <div className="mt-10 flex justify-between gap-3 border-t border-white/15 pt-5">
            {previous ? (
              <button type="button" className={STEP_BUTTON} onClick={() => onSelect(previous.id)}>
                <span className="inline-flex items-center gap-1 text-[13px] font-extrabold uppercase tracking-wide text-oc-amber">
                  <ChevronLeft className="h-4 w-4 rtl:rotate-180" aria-hidden="true" /> {t('legal.previous')}
                </span>
                <span className="block max-w-full truncate text-[14px] text-white/85">{sectionLabel(previous)}</span>
              </button>
            ) : <span />}
            {next && (
              <button type="button" className={`${STEP_BUTTON} items-end text-end`} onClick={() => onSelect(next.id)}>
                <span className="inline-flex items-center gap-1 text-[13px] font-extrabold uppercase tracking-wide text-oc-amber">
                  {t('legal.next')} <ChevronRight className="h-4 w-4 rtl:rotate-180" aria-hidden="true" />
                </span>
                <span className="block max-w-full truncate text-[14px] text-white/85">{sectionLabel(next)}</span>
              </button>
            )}
          </div>
        </section>

        {/* Print: the whole document, in order. */}
        <div aria-hidden="true" className="hidden print:block">
          {doc.sections.map((item) => (
            <div key={item.id} className="mt-6 first:mt-0">
              <p className="font-display text-[13pt] font-extrabold print:break-after-avoid">{sectionLabel(item)}</p>
              <div className={BODY}><Blocks section={item} /></div>
            </div>
          ))}
        </div>
      </div>

      <p className="mt-10 border-t border-white/15 pt-4 text-[13px] text-white/75 print:border-black print:text-black">
        {t('legal.lastUpdated')}: {doc.lastUpdated}
      </p>
    </div>
  )
}

export default LegalDocument
