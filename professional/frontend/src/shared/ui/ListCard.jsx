/**
 * The one card every list in the application draws, whatever it lists: projects,
 * requests of every type, partners, site engineers, suppliers, listings, orders,
 * bookings, jobs, admin records.
 *
 * One compact size for every card in the application: the same width (the grid column)
 * and the same height (--list-card-height in index.css). The parts stack tightly in
 * this order, and a card simply leaves out the ones it has nothing for:
 *
 *   header       48px thumbnail · bold title (one line) · grey subtitle (location + PIN)
 *   chips        the status chip first (with its icon), then size, type and the rest
 *   description  one grey line
 *   rows         up to four label / value lines (cards that list facts)
 *   progress     "Progress: ..." left, the amount right, a thin bar under them
 *   meta         a small line left ("Schedule: ..."), a link on the right (View Analysis)
 *   footer       secondary actions left (outlined / red outline), the main one right
 *
 * Content never makes a card taller and never scrolls inside it: titles, subtitles, chips
 * and values are cut with an ellipsis and kept whole as a tooltip; at most four detail
 * rows; anything past the card's height is hidden. The footer sits at the bottom edge.
 * Only a card showing something to work with right there (an open form, a map, a work
 * bill) passes `expanded`, and then grows from that height instead of hiding it.
 * Hovering or focusing anything in a card turns it the brand's warm yellow (the
 * `list-card` rules in index.css), with the text kept readable.
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

const textOfChildren = (children) => (Array.isArray(children) ? children : [children])
  .filter((part) => typeof part === 'string' || typeof part === 'number').join('') || undefined

/**
 * The card's status chip, first in the chip row: `status` picks the tone, `icon` is
 * optional, `children` is the word shown (whole as a tooltip when it is cut).
 */
export function CardStatus({ status, tone, icon: Icon, children }) {
  const classes = TONE_CLASSES[tone || statusTone(status)] || TONE_CLASSES.grey
  return (
    <span
      data-card-part="status"
      className={`inline-flex max-w-full shrink-0 items-center gap-1 truncate rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${classes}`}
      title={textOfChildren(children)}
    >
      {Icon && <Icon aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />}
      <span className="truncate">{children}</span>
    </span>
  )
}

/**
 * A chip in the card body (a size, a category, a trade, a count). `outline` draws only
 * the border on white (the type / floors chip).
 */
export function CardChip({ tone = 'grey', icon: Icon, outline = false, children }) {
  const classes = TONE_CLASSES[tone] || TONE_CLASSES.grey
  const shown = outline ? `${classes.split(' ').filter((name) => !name.startsWith('bg-')).join(' ')} bg-white` : classes
  return (
    <span
      className={`inline-flex max-w-full items-center gap-1 truncate rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${shown}`}
      title={textOfChildren(children)}
    >
      {Icon && <Icon aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />}
      <span className="truncate">{children}</span>
    </span>
  )
}

// ---- actions -----------------------------------------------------------------------

const BUTTON_BASE = 'inline-flex h-8 min-w-0 shrink-0 items-center justify-center gap-1.5 rounded-lg px-3 text-xs font-extrabold transition '
  + 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-oc-green focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50'

/**
 * Card button classes: `primary` (filled, the footer's right side), `secondary`
 * (outlined) and `danger` (outlined, red text), both on the left.
 */
export const cardButtonClass = (variant = 'primary') => `${BUTTON_BASE} ${{
  // Light green, as in the design; still AA (emerald-800 on emerald-50).
  primary: 'border border-emerald-200 bg-emerald-50 text-emerald-800 hover:border-emerald-300 hover:bg-emerald-100',
  secondary: 'border border-slate-300 bg-white text-oc-ink hover:bg-slate-50',
  danger: 'border border-rose-300 bg-white text-rose-700 hover:bg-rose-50',
}[variant] || ''}`

// ---- the card ------------------------------------------------------------------------

const textOf = (value) => (typeof value === 'string' || typeof value === 'number' ? String(value) : undefined)

/** A 48px round avatar or logo; `fallback` (initials, an icon) when there is no image. */
export function CardAvatar({ src, alt = '', fallback = null }) {
  return (
    <span data-card-part="avatar" className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-xl border border-oc-line bg-oc-mint text-sm font-extrabold text-oc-green">
      {src ? <img src={src} alt={alt} className="h-full w-full object-cover" /> : fallback}
    </span>
  )
}

/**
 * @param avatar     a node, usually <CardAvatar>; 48px
 * @param title      the card's name (truncated; the full text is its tooltip)
 * @param subtitle   one line under the title
 * @param status     a <CardStatus>, the first chip
 * @param chips      nodes for the chip row, after the status
 * @param description one grey line
 * @param rows       up to four { key?, label, value, title? } rows (more are not drawn)
 * @param progress   { label, amount, percent }: label left, amount right, a bar (0-100)
 * @param meta       { text, action }: a small line left, a link / button right
 * @param secondary  footer actions on the left (outlined / red text)
 * @param primary    footer actions on the right (filled)
 * @param expanded   the card is showing content to act on (a form, a map) that must not be
 *                   hidden: it may grow taller than the standard height while it does
 * @param onClick    opens the card; buttons and links inside keep their own clicks.
 *                   The title becomes a button, the card's keyboard target.
 * @param children   extra body content, for what is neither a row nor a chip
 */
export function ListCard({
  avatar = null,
  title,
  subtitle = null,
  status = null,
  rows = [],
  chips = [],
  description = null,
  progress = null,
  meta = null,
  secondary = null,
  primary = null,
  onClick,
  highlighted = false,
  // Shown but not available (busy elsewhere, say): the body is dimmed, the actions are not.
  dimmed = false,
  expanded = false,
  label,
  testId,
  children,
}) {
  const interactive = typeof onClick === 'function'
  const shownRows = rows.filter(Boolean).slice(0, 4)
  const shownChips = Children.toArray(chips).filter(Boolean)
  return (
    <article
      data-card="list"
      data-testid={testId}
      aria-label={label || textOf(title)}
      // A click anywhere on the card opens it, except on a button, link or field inside
      // it. Keyboard and screen-reader users open it with the title's button.
      onClick={interactive ? (event) => { if (!event.target.closest('button, a, input, select, textarea, label')) onClick(event) } : undefined}
      // `list-card`: the warm hover / focus surface (index.css), the same on every card.
      className={`list-card flex w-full min-w-0 flex-col overflow-hidden rounded-2xl border p-4 shadow-ocsoft ${expanded ? 'min-h-[var(--list-card-height)]' : 'h-[var(--list-card-height)]'}
        ${highlighted ? 'border-oc-green bg-ocbrand-50' : 'border-oc-line bg-white'}
        ${interactive ? 'cursor-pointer' : ''}`}
    >
      <header data-card-part="header" className="flex min-w-0 shrink-0 items-start gap-3">
        {avatar}
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[15px] font-extrabold leading-snug text-oc-ink" title={textOf(title)}>
            {interactive ? (
              // The card's keyboard and screen-reader target; looks like the plain title.
              <button
                type="button"
                onClick={onClick}
                className="max-w-full truncate rounded text-start align-top focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-oc-green focus-visible:ring-offset-2"
              >
                {title}
              </button>
            ) : title}
          </h3>
          {subtitle && <p className="mt-0.5 truncate text-xs text-oc-muted" title={textOf(subtitle)}>{subtitle}</p>}
        </div>
      </header>

      <div data-card-part="body" className={`mt-3 flex min-h-0 min-w-0 flex-1 flex-col gap-2 ${expanded ? '' : 'overflow-hidden'} ${dimmed ? 'opacity-50 blur-[0.5px]' : ''}`}>
        {(status || shownChips.length > 0) && (
          // One line; a chip that does not fit is cut, its full text on hover.
          <div data-card-part="chips" className="flex min-w-0 shrink-0 flex-nowrap gap-1.5 overflow-hidden">{status}{shownChips}</div>
        )}
        {description && (
          <p data-card-part="description" className="shrink-0 truncate text-xs text-oc-muted" title={textOf(description)}>{description}</p>
        )}
        {shownRows.length > 0 && (
          <dl className="grid min-w-0 shrink-0 grid-cols-[minmax(0,auto)_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
            {shownRows.map((row, index) => (
              <div key={row.key || (typeof row.label === 'string' ? row.label : index)} className="contents">
                <dt className="truncate font-semibold text-oc-muted">{row.label}</dt>
                <dd className="truncate text-end font-bold text-oc-ink" title={row.title || textOf(row.value)}>{row.value ?? '–'}</dd>
              </div>
            ))}
          </dl>
        )}
        {progress && (
          <div data-card-part="progress" className="min-w-0 shrink-0">
            <div className="flex min-w-0 items-baseline justify-between gap-3 text-xs">
              <span className="truncate font-semibold text-oc-muted" title={textOf(progress.label)}>{progress.label}</span>
              {progress.amount != null && <span className="shrink-0 truncate text-sm font-extrabold text-oc-ink">{progress.amount}</span>}
            </div>
            <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-200" aria-hidden="true">
              <div className="h-full rounded-full bg-emerald-500" style={{ width: `${Math.max(0, Math.min(100, Number(progress.percent) || 0))}%` }} />
            </div>
          </div>
        )}
        {meta && (meta.text || meta.action) && (
          <div data-card-part="meta" className="flex min-w-0 shrink-0 items-center justify-between gap-3 text-[11px]">
            <span className="truncate font-semibold text-oc-muted" title={textOf(meta.text)}>{meta.text}</span>
            {meta.action && <span className="shrink-0">{meta.action}</span>}
          </div>
        )}
        {children}
      </div>

      {(secondary || primary) && (
        // At the bottom edge, never scrolling: several actions wrap instead.
        <footer data-card-part="footer" className="mt-3 flex min-w-0 shrink-0 flex-wrap items-center justify-between gap-2 overflow-hidden border-t border-oc-line pt-3">
          <div className="flex min-w-0 flex-wrap items-center gap-2">{secondary}</div>
          <div className="ms-auto flex min-w-0 flex-wrap items-center justify-end gap-2">{primary}</div>
        </footer>
      )}
    </article>
  )
}

/**
 * The grid every card list uses: one column on a phone, two from 768px, three from
 * 1280px, 20px apart; equal widths, every card the same fixed height.
 */
export function CardGrid({ children, label, testId }) {
  const items = Children.toArray(children).filter(isValidElement)
  return (
    <ul data-card-grid="" data-testid={testId} aria-label={label} className="grid grid-cols-1 items-stretch gap-5 md:grid-cols-2 xl:grid-cols-3">
      {items.map((child) => (
        <li key={child.key} className="flex min-w-0">{child}</li>
      ))}
    </ul>
  )
}
