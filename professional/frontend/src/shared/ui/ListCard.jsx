/**
 * The one card every list in the application draws, whatever it lists: projects,
 * requests of every type, partners, site engineers, suppliers, listings, orders,
 * bookings, jobs, admin records.
 *
 * Fixed anatomy, so cards in a list line up and read the same everywhere:
 *
 *   header  avatar / logo (48px) · title · subtitle · status pill (top right)
 *   body    up to four label / value rows, then a chip row
 *   footer  actions pinned to the bottom: secondary on the left, primary on the right
 *
 * Inside a <CardGrid> every card in a row stretches to the row's height and the footer
 * sits on the bottom edge. Long text never grows a card: titles, subtitles and values
 * are truncated with an ellipsis and carry the full text as a tooltip.
 *
 * Only the layout lives here. What a card shows and what its buttons do stay with the
 * screen that renders it.
 */
import { Children, isValidElement } from 'react'

// ---- status: one colour scheme for every card ------------------------------------

const TONE_CLASSES = {
  // AA on white: every text colour is a 700/800 shade on a 50 background.
  amber: 'border-amber-200 bg-amber-50 text-amber-800',
  green: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  blue: 'border-sky-200 bg-sky-50 text-sky-800',
  red: 'border-rose-200 bg-rose-50 text-rose-700',
  grey: 'border-slate-200 bg-slate-100 text-slate-700',
  violet: 'border-violet-200 bg-violet-50 text-violet-800',
}

/**
 * Which tone a status reads in, by its stored code (any case). Waiting is amber, agreed
 * or done is green, under way is blue, refused or failed is red, ended or withdrawn is
 * grey. A code not listed here reads grey.
 */
export const STATUS_TONES = {
  // waiting on someone
  new: 'amber', pending: 'amber', open: 'amber', offered: 'amber', searching: 'amber', requested: 'amber',
  more_info_requested: 'amber', under_review: 'amber', partially_available: 'amber', partially_issued: 'amber',
  partially_fulfilled: 'amber', procurement_pending: 'violet', awaiting_payment: 'amber', trial: 'amber',
  // agreed or finished well
  accepted: 'green', approved: 'green', completed: 'green', fulfilled: 'green', issued: 'green',
  delivered: 'green', paid: 'green', resolved: 'green', available: 'green', verified: 'green', sold: 'green',
  // under way
  active: 'blue', assigned: 'blue', in_progress: 'blue', ongoing: 'blue', busy: 'blue', en_route: 'blue',
  arrived: 'blue', listed: 'blue', under_offer: 'blue', shipped: 'blue', current: 'blue', upcoming: 'amber',
  // refused or failed
  declined: 'red', rejected: 'red', failed: 'red', expired: 'red', no_technician_found: 'red', suspended: 'red',
  // ended or taken back
  withdrawn: 'grey', cancelled: 'grey', canceled: 'grey', closed: 'grey', draft: 'grey', inactive: 'grey',
  offline: 'grey', paused: 'grey', previous: 'grey', deleted: 'grey',
}

export const statusTone = (status) => STATUS_TONES[String(status || '').trim().toLowerCase().replace(/[\s-]+/g, '_')] || 'grey'

/** The status pill of a card: `status` picks the tone, `children` is the word shown. */
export function CardStatus({ status, tone, children }) {
  const classes = TONE_CLASSES[tone || statusTone(status)] || TONE_CLASSES.grey
  return (
    <span
      data-card-part="status"
      className={`inline-flex max-w-[9rem] shrink-0 items-center truncate rounded-full border px-2.5 py-0.5 text-[11px] font-extrabold uppercase tracking-wide rtl:tracking-normal ${classes}`}
      title={typeof children === 'string' ? children : undefined}
    >
      {children}
    </span>
  )
}

/** A chip in the card body (a category, a trade, a count). */
export function CardChip({ tone = 'grey', icon: Icon, children }) {
  return (
    <span className={`inline-flex max-w-full items-center gap-1 truncate rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${TONE_CLASSES[tone] || TONE_CLASSES.grey}`}>
      {Icon && <Icon aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />}
      <span className="truncate">{children}</span>
    </span>
  )
}

// ---- actions -----------------------------------------------------------------------

const BUTTON_BASE = 'inline-flex h-9 min-w-0 shrink-0 items-center justify-center gap-1.5 rounded-lg px-3.5 text-xs font-extrabold transition '
  + 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-oc-green focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50'

/**
 * Card button classes: `primary` (filled, the footer's right side), `secondary`
 * (outlined) and `danger` (outlined, red text), both on the left.
 */
export const cardButtonClass = (variant = 'primary') => `${BUTTON_BASE} ${{
  primary: 'bg-oc-green text-white hover:bg-oc-deep',
  secondary: 'border border-slate-300 bg-white text-oc-ink hover:bg-slate-50',
  danger: 'border border-rose-200 bg-white text-rose-700 hover:bg-rose-50',
}[variant] || ''}`

// ---- the card ------------------------------------------------------------------------

const textOf = (value) => (typeof value === 'string' || typeof value === 'number' ? String(value) : undefined)

/** A 48px round avatar or logo; `fallback` (initials, an icon) when there is no image. */
export function CardAvatar({ src, alt = '', fallback = null }) {
  return (
    <span data-card-part="avatar" className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-full border border-oc-line bg-oc-mint text-sm font-extrabold text-oc-green">
      {src ? <img src={src} alt={alt} className="h-full w-full object-cover" /> : fallback}
    </span>
  )
}

/**
 * @param avatar     a node, usually <CardAvatar>; 48px
 * @param title      the card's name (truncated; the full text is its tooltip)
 * @param subtitle   one line under the title
 * @param status     a <CardStatus>, top right
 * @param rows       up to four { key?, label, value, title? } rows (more are not drawn)
 * @param chips      nodes for the chip row
 * @param secondary  footer actions on the left (outlined / red text)
 * @param primary    footer actions on the right (filled)
 * @param onClick    opens the card; buttons and links inside keep their own clicks
 * @param children   extra body content, for what is neither a row nor a chip
 */
export function ListCard({
  avatar = null,
  title,
  subtitle = null,
  status = null,
  rows = [],
  chips = [],
  secondary = null,
  primary = null,
  onClick,
  highlighted = false,
  // Shown but not available (busy elsewhere, say): the body is dimmed, the actions are not.
  dimmed = false,
  label,
  testId,
  children,
}) {
  const interactive = typeof onClick === 'function'
  const shownRows = rows.filter(Boolean).slice(0, 4)
  const shownChips = Children.toArray(chips).filter(Boolean)
  const hasFooter = Boolean(secondary || primary)
  return (
    <article
      data-card="list"
      data-testid={testId}
      aria-label={label || textOf(title)}
      onClick={interactive ? (event) => { if (!event.target.closest('button, a, input, select, textarea, label')) onClick(event) } : undefined}
      // A card that opens is reachable with Tab and opens with Enter or Space, as a
      // click does; keys pressed on a button inside it stay that button's.
      tabIndex={interactive ? 0 : undefined}
      onKeyDown={interactive ? (event) => {
        if (event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) return
        event.preventDefault()
        onClick(event)
      } : undefined}
      className={`oc-list-card flex h-full w-full min-w-0 flex-col rounded-[18px] border p-4 shadow-ocsoft transition-[border-color,box-shadow,transform] duration-200
        hover:-translate-y-0.5 hover:border-[rgba(8,62,43,.28)] hover:shadow-[0_18px_40px_-24px_rgba(23,32,28,0.35)]
        ${highlighted ? 'border-oc-green bg-ocbrand-50' : 'border-oc-line bg-white'}
        ${interactive ? 'cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-oc-green focus-visible:ring-offset-2' : ''}`}
    >
      <header data-card-part="header" className="flex min-w-0 items-start gap-3">
        {avatar}
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-extrabold leading-snug text-oc-ink" title={textOf(title)}>{title}</p>
          {subtitle && <p className="mt-0.5 truncate text-xs text-oc-muted" title={textOf(subtitle)}>{subtitle}</p>}
        </div>
        {status}
      </header>

      <div data-card-part="body" className={`mt-3 flex min-w-0 flex-1 flex-col gap-3 ${dimmed ? 'opacity-50 blur-[0.5px]' : ''}`}>
        {shownRows.length > 0 && (
          <dl className="grid min-w-0 grid-cols-[minmax(0,auto)_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-xs">
            {shownRows.map((row, index) => (
              <div key={row.key || (typeof row.label === 'string' ? row.label : index)} className="contents">
                <dt className="truncate font-semibold text-oc-muted">{row.label}</dt>
                <dd className="truncate text-end font-bold text-oc-ink" title={row.title || textOf(row.value)}>{row.value ?? '–'}</dd>
              </div>
            ))}
          </dl>
        )}
        {shownChips.length > 0 && <div data-card-part="chips" className="flex min-w-0 flex-wrap gap-1.5">{shownChips}</div>}
        {children}
      </div>

      {hasFooter && (
        <footer data-card-part="footer" className="mt-4 flex min-w-0 flex-wrap items-center justify-between gap-2 border-t border-oc-line pt-3">
          <div className="flex min-w-0 flex-wrap items-center gap-2">{secondary}</div>
          <div className="ms-auto flex min-w-0 flex-wrap items-center justify-end gap-2">{primary}</div>
        </footer>
      )}
    </article>
  )
}

/**
 * The grid every card list uses: one column on a phone, two from 768px, three from
 * 1280px; equal widths, and every card in a row as tall as the tallest.
 */
export function CardGrid({ children, label, testId }) {
  const items = Children.toArray(children).filter(isValidElement)
  return (
    <ul data-card-grid="" data-testid={testId} aria-label={label} className="grid grid-cols-1 items-stretch gap-4 md:grid-cols-2 xl:grid-cols-3">
      {items.map((child) => (
        <li key={child.key} className="flex min-w-0">{child}</li>
      ))}
    </ul>
  )
}
