// Renders a generated legal document (content/terms.js, content/privacy.js). The text is shown
// exactly as written: a [bracketed placeholder] is kept as it is, only marked so it stands out.
const PLACEHOLDER = /(\[[^\]]+\])/

function Text({ value }) {
  return value.split(PLACEHOLDER).map((piece, index) =>
    PLACEHOLDER.test(piece) && index % 2 === 1 ? (
      <mark key={index} className="rounded bg-amber-100 px-0.5 text-inherit print:bg-transparent">{piece}</mark>
    ) : (
      piece
    ),
  )
}

function Parts({ parts }) {
  return parts.map((part, index) =>
    typeof part === 'string' ? (
      <Text key={index} value={part} />
    ) : (
      <strong key={index} className="font-bold text-oc-ink"><Text value={part.b} /></strong>
    ),
  )
}

function Block({ block }) {
  if (block.type === 'list') {
    return (
      <ul className="my-3 list-disc space-y-1.5 pl-6">
        {block.items.map((item, index) => <li key={index}><Parts parts={item} /></li>)}
      </ul>
    )
  }
  return <p className="my-3"><Parts parts={block.parts} /></p>
}

export const sectionHeading = (section) => (section.number ? `${section.number}. ${section.title}` : section.title)

/**
 * The full document: title, meta line, table of contents and every section. `idPrefix` keeps
 * anchor ids unique when the same document is shown inside a dialog on another page.
 */
export default function LegalDocument({ doc, idPrefix = '', headingId }) {
  const anchor = (id) => `${idPrefix}${id}`
  return (
    <article className="text-[15px] leading-relaxed text-oc-ink/90 print:text-[11pt] print:text-black">
      <h1 id={headingId} className="text-2xl font-extrabold text-oc-deep sm:text-3xl print:text-black">{doc.title}</h1>
      <dl className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm text-oc-muted print:text-black">
        <div><dt className="inline">Effective date: </dt><dd className="inline"><Text value={doc.effectiveDate} /></dd></div>
        <div><dt className="inline">Version: </dt><dd className="inline">{doc.version}</dd></div>
        <div><dt className="inline">Last updated: </dt><dd className="inline"><Text value={doc.lastUpdated} /></dd></div>
      </dl>
      <p className="mt-1 text-sm text-oc-muted print:text-black"><Text value={doc.company} /> · {doc.site}</p>

      <nav aria-label="Contents" className="mt-6 rounded-xl border border-oc-line bg-oc-sunken/60 p-4 print:break-after-page print:border-0 print:bg-transparent print:p-0">
        <h2 className="text-xs font-extrabold uppercase tracking-[0.14em] text-oc-deep print:text-black">Contents</h2>
        <ol className="mt-2 grid gap-1 text-sm sm:grid-cols-2">
          {doc.sections.map((section) => (
            <li key={section.id}>
              <a href={`#${anchor(section.id)}`} className="text-oc-green hover:underline print:text-black print:no-underline">{sectionHeading(section)}</a>
            </li>
          ))}
        </ol>
      </nav>

      {doc.sections.map((section) => (
        <section key={section.id} aria-labelledby={anchor(section.id)} className="mt-8 print:break-inside-auto">
          <h2 id={anchor(section.id)} className="scroll-mt-20 text-lg font-extrabold text-oc-deep print:break-after-avoid print:text-black">
            {sectionHeading(section)}
          </h2>
          {section.blocks.map((block, index) => <Block key={index} block={block} />)}
        </section>
      ))}
    </article>
  )
}
