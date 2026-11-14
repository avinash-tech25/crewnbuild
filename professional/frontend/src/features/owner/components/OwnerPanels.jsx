import DashboardHero from '../../../shared/dashboard/DashboardHero.jsx'
import HeroConstructionScene from '../../../shared/dashboard/HeroConstructionScene.jsx'
import { avatarFromPath } from '../../../shared/ui/avatars.js'
import { useLanguage } from '../../../i18n/LanguageContext.jsx'

// `compact` tightens only the padding and the header gap — same border, radius,
// shadow and colours. It exists for the dashboard panels that have to share one
// screen height; every other caller omits it and renders exactly as before.
export function Card({ title, icon: Icon, action, children, className = '', compact = false, id }) {
  return (
    <section id={id} className={`flex h-full flex-col rounded-2xl border border-oc-line bg-white ${compact ? 'p-3' : 'p-5'} shadow-[0_14px_40px_-30px_rgba(15,23,42,0.35)] transition hover:-translate-y-0.5 hover:border-ocbrand-200 hover:shadow-[0_20px_50px_-32px_rgba(15,23,42,0.45)] ${className}`}>
      {(title || action) && (
        <div className={`${compact ? 'mb-2' : 'mb-4'} flex flex-wrap items-center justify-between gap-3`}>
          {title ? (
            <h3 className="flex min-w-0 items-center gap-2 font-display text-[15px] font-bold text-oc-ink">
              {Icon && <Icon className="h-[18px] w-[18px] shrink-0 text-oc-green" />}
              <span className="min-w-0">{title}</span>
            </h3>
          ) : <span />}
          {action}
        </div>
      )}
      {children}
    </section>
  )
}

export function EmptyState({ title, message }) {
  return (
    <div className="grid place-items-center rounded-2xl border border-dashed border-oc-line bg-oc-sunken px-4 py-12 text-center">
      <p className="font-display text-sm font-bold text-oc-ink">{title}</p>
      <p className="mt-1 max-w-sm text-xs leading-relaxed text-oc-muted">{message}</p>
    </div>
  )
}

// Each figure's colour in the banner: soft tints that sit on the cream rather
// than four loud cards. Fixed classes, not the theme tokens, because the cream
// banner stays cream in dark mode.
const STAT_TONES = {
  indigo: 'bg-indigo-50 text-indigo-600 ring-indigo-100',
  green: 'bg-emerald-50 text-emerald-600 ring-emerald-100',
  blue: 'bg-sky-50 text-sky-600 ring-sky-100',
  rose: 'bg-rose-50 text-rose-500 ring-rose-100',
}

/** The owner's figures as a compact 2 x 2 panel for the banner's right side. */
function HeroStats({ stats }) {
  return (
    <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4 md:grid-cols-2 xl:grid-cols-4">
      {stats.map((stat) => (
        // Each figure opens the place where its items are worked on.
        <button
          key={stat.label}
          type="button"
          onClick={stat.onClick}
          disabled={!stat.onClick}
          data-testid={`owner-stat-${stat.tone}`}
          className="flex min-w-0 items-center gap-2 rounded-xl border border-[rgba(8,62,43,0.08)] bg-[rgba(255,255,255,0.72)] px-2 py-1 text-left transition hover:-translate-y-0.5 hover:border-[rgba(8,62,43,0.2)] hover:bg-[#fff] focus:outline-none focus-visible:ring-2 focus-visible:ring-oc-green/40 disabled:cursor-default disabled:hover:translate-y-0"
        >
          <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-lg ring-1 ${STAT_TONES[stat.tone] || STAT_TONES.green}`}>
            <stat.icon aria-hidden="true" className="h-3 w-3" strokeWidth={2.2} />
          </span>
          <span className="min-w-0">
            <span className="block text-[9.5px] font-extrabold uppercase leading-tight tracking-wide text-[#5b6b62]">{stat.label}</span>
            <span className="block font-display text-sm font-extrabold leading-tight text-[#17201c]">{stat.value}</span>
          </span>
        </button>
      ))}
    </div>
  )
}

export function Hero({ user, metrics = [], stats = [] }) {
  const { t } = useLanguage()
  return (
    <DashboardHero
      avatar={{
        image: avatarFromPath(user.profileImageUrl, 'OWNER'),
        // The initials the caller derived from the displayed name. A neutral
        // mark rather than English letters when there is no name to read.
        name: user.initials || '•',
      }}
      title={t('dash.owner.hero.welcome', { name: user.name ? `, ${user.name}` : '' })}
      subtitle={t('dash.owner.hero.sub')}
      metrics={metrics}
      illustration={<HeroConstructionScene className="h-full w-full" />}
      variant="cream"
      // The House Owner's banner: grey-to-green shading instead of orange.
      tint="mist"
      aside={stats.length > 0 ? <HeroStats stats={stats} /> : null}
    />
  )
}
