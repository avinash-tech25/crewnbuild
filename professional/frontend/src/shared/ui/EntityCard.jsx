/**
 * The application's standard profile / entity card.
 *
 * This is the landing page's "Requirement" card (Inside the Platform) turned into
 * a reusable component: same 18px radius, same oc-line border on white, the same
 * soft shadow, the same eyebrow-with-icon header, the same 40px round avatar
 * beside a title, the same pill row, and the same divider before the footer.
 *
 * Only the content differs per entity — a builder, a supplier, a site engineer,
 * a house owner or a project all render through this one component so no screen
 * grows its own card style.
 */
import { EntityPill } from './EntityPill.jsx'

export function EntityCard({
  icon: Icon,
  label,
  action,
  avatar,
  title,
  subtitle,
  pills = [],
  footerLabel,
  footerValue,
  meta,
  highlighted = false,
  compact = false,
  // Optional leading visual — a media column placed BESIDE the card body rather
  // than above it. Every existing caller omits it, and when it is absent this
  // component renders exactly what it always has: the header and body sit
  // directly inside the article with no extra wrapper and no new classes. The
  // caller sizes its own media; this only decides where the column sits.
  media = null,
  // Makes the card fill its grid row and lay its body out as a column, so a row
  // of cards ends level however much text each one carries, and a child marked
  // `mt-auto` (an action bar, say) sits on the bottom edge of every card. Every
  // existing caller omits it and renders exactly as it always has.
  fill = false,
  // Lets a non-interactive card still carry the dashboard's shared gold hover
  // surface (used by screens whose cards only act through inner buttons).
  goldHover = false,
  // Drops the body's top margin when this card renders no header at all (no
  // icon, no label, no action). A card that dropped its eyebrow row would
  // otherwise keep the gap that row used to sit under, leaving blank space
  // above the title. Off by default, so every card that already omits a header
  // keeps the spacing it has today; only a caller that asks for it tightens up.
  tightTop = false,
  onClick,
  children,
}) {
  const interactive = typeof onClick === 'function'
  const hasHeader = Boolean(Icon || label || action)
  const bodyTop = hasHeader || !tightTop ? (compact ? 'mt-2' : 'mt-4') : ''

  // The landing card turns amber when the visitor is on it. A dashboard card is
  // hovered rather than scrolled to, so hover carries the same amber surface,
  // with the two grey tones darkened the way the landing card darkens them.
  const hoverSurface = 'hover:-translate-y-0.5 hover:border-[rgba(8,62,43,.22)] '
    + 'hover:bg-[linear-gradient(180deg,#f9c85f_0%,#f4b740_52%,#e9a92f_100%)] '
    + 'hover:shadow-[0_18px_40px_-24px_rgba(23,32,28,0.35)] '
    + '[&:hover_.text-oc-muted]:text-oc-deep [&:hover_.text-oc-faint]:text-oc-deep/75'

  // The card's own content, unchanged. Held in a variable only so it can be
  // placed either on its own (no media) or as the second column beside one.
  const cardBody = (
    <>
      {(Icon || label || action) && (
        <header className="flex items-center gap-2.5">
          {Icon && (
            <span className={`grid shrink-0 place-items-center rounded-lg bg-ocbrand-50 text-oc-green ${compact ? 'h-5 w-5' : 'h-7 w-7'}`}>
              <Icon aria-hidden="true" className={compact ? 'h-3 w-3' : 'h-3.5 w-3.5'} strokeWidth={2} />
            </span>
          )}
          {label && (
            <h3 className="text-[11px] font-bold uppercase tracking-[.14em] text-oc-faint rtl:tracking-normal">{label}</h3>
          )}
          {action && <div className="ms-auto">{action}</div>}
        </header>
      )}

      <div className={`${bodyTop} ${fill ? 'flex min-h-0 flex-1 flex-col' : ''}`}>
        <div className="flex items-center gap-3">
          {avatar}
          <div className="min-w-0">
            <p className={`truncate font-bold text-oc-ink ${compact ? 'text-sm' : 'text-title'}`}>{title}</p>
            {subtitle && <p className={`mt-0.5 truncate leading-normal text-oc-muted ${compact ? 'text-[11px]' : 'text-xs'}`}>{subtitle}</p>}
          </div>
        </div>

        {pills.length > 0 && (
          <ul className={`${compact ? 'mt-1.5 gap-1' : 'mt-3 gap-1.5'} flex flex-wrap`}>
            {pills.map((pill) => (
              <li key={typeof pill === 'string' ? pill : pill.key || pill.text}>
                {typeof pill === 'string'
                  ? <EntityPill>{pill}</EntityPill>
                  : <EntityPill tone={pill.tone} dot={pill.dot} icon={pill.icon}>{pill.text}</EntityPill>}
              </li>
            ))}
          </ul>
        )}

        {children}

        {(footerLabel || footerValue) && (
          <div className={`${compact ? 'mt-2.5 pt-2.5' : 'mt-5 pt-4'} flex flex-wrap items-center justify-between gap-3 border-t border-oc-line`}>
            {footerLabel && <span className="text-xs font-medium leading-normal text-oc-faint">{footerLabel}</span>}
            {footerValue}
          </div>
        )}

        {meta && <p className={`${compact ? 'mt-1.5' : 'mt-3'} text-xs leading-normal text-oc-faint`}>{meta}</p>}
      </div>
    </>
  )

  return (
    <article
      onClick={interactive ? (event) => { if (!event.target.closest('button, a, input, select, textarea')) onClick(event) } : undefined}
      className={`oc-entity-card rounded-[18px] border shadow-ocsoft transition-[background,border-color,transform,box-shadow] duration-300 ease-soft
                  ${fill ? 'flex h-full flex-col' : ''}
                  ${compact ? 'p-3 max-wide:p-2.5' : 'p-5 max-wide:p-4'}
                  ${highlighted
                    ? 'border-[rgba(8,62,43,.22)] bg-[linear-gradient(180deg,#f9c85f_0%,#f4b740_52%,#e9a92f_100%)] [&_.text-oc-muted]:text-oc-deep [&_.text-oc-faint]:text-oc-deep/75'
                    : 'border-oc-line bg-white'}
                  ${goldHover ? 'dash-gold-hover' : ''}
                  ${interactive ? `cursor-pointer ${hoverSurface}` : ''}`}
    >
      {media ? (
        // Media column beside the body. Stacks on the narrowest screens and
        // sits to the side from `sm` up, so a card in a one-per-row list reads
        // as a horizontal listing without the body ever being squeezed.
        <div className={`flex flex-col gap-3 sm:flex-row sm:items-start sm:gap-4 ${fill ? 'min-h-0 flex-1' : ''}`}>
          <div className="shrink-0">{media}</div>
          <div className={`min-w-0 flex-1 ${fill ? 'flex flex-col' : ''}`}>{cardBody}</div>
        </div>
      ) : cardBody}
    </article>
  )
}
