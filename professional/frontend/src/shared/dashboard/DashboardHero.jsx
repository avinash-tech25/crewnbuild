import { motion } from 'framer-motion'
import { useLanguage } from '../../i18n/LanguageContext.jsx'

/*
 * DashboardHero — compact welcome banner for the role dashboards
 * (Homeowner / Builder / Supplier). Dark navy canvas (#0d1322) with
 * green accents, greeting heading + description, optional extra
 * callout, and optional metric cards along the bottom. Deliberately
 * clean: no status pills, badges, or action buttons.
 *
 * Props:
 *   title       greeting heading
 *   subtitle    supporting paragraph
 *   extra       ReactNode rendered under the subtitle (e.g. warnings)
 *   avatar      { image?, name? } profile chip on the left
 *   metrics     [{ icon, label, value, note, tone }] metric cards at bottom
 *   illustration  decorative artwork for the right edge. It is a flex sibling
 *                 of the greeting, so it can never sit on top of the text, and
 *                 it is absolutely placed inside its own box so it contributes
 *                 no height of its own -- the banner stays as tall as its
 *                 words. Whether there is room at all is decided by the
 *                 `.oc-hero-art` container query in index.css, keyed on the
 *                 banner's own width rather than the viewport.
 */

export default function DashboardHero({
  title,
  subtitle,
  extra,
  action = null,
  avatar,
  metrics = [],
  // Accepted and ignored since the banner took a photograph:
  // that photo already fills the right edge this decorative vector scene used
  // to occupy, and drawing both stacked two construction scenes on each other.
  // The prop stays so the four callers keep working untouched.
  illustration = null, // eslint-disable-line no-unused-vars
  // 'cream': a warm cream/golden banner with dark text, the photo blended in
  // from the left. Any other value keeps the green banner every console uses.
  variant = 'default',
  // Optional content for the banner's right side (the House Owner's figures).
  // It sits beside the greeting from `md` up and drops below it on a phone.
  aside = null,
  // Opt-in for the cream banner only: 'mist' swaps its orange/peach shading for
  // a soft grey-to-green one (background, edge, underline and avatar ring).
  // Without it the cream banner is exactly as before.
  tint = null,
}) {
  const { t } = useLanguage()
  const cream = variant === 'cream'
  const mist = cream && tint === 'mist'
  return (
    <section
      // The cream banner's 1px edge is orange, with a faint ring of the same
      // orange outside it (a shadow, so it takes no space).
      className={`oc-hero relative isolate overflow-hidden rounded-2xl ${mist
        ? 'border border-[#083E2B] shadow-[0_18px_50px_-40px_rgba(8,62,43,0.45)] ring-1 ring-[#083E2B]/25'
        : cream
          ? 'border border-orange-500 shadow-[0_18px_50px_-40px_rgba(140,100,20,0.45)] ring-1 ring-orange-500/25'
          : 'border border-white/10 bg-[#083E2B] shadow-[0_18px_50px_-38px_rgba(8,62,43,0.9)]'}`}
      style={mist ? {
        backgroundImage: 'linear-gradient(100deg, #F3F4F6 0%, #EEF4F0 55%, #DFF0E6 100%)',
      } : cream ? {
        backgroundImage: 'linear-gradient(100deg, #F3F0E3 0%, #FEF6E9 58%, #FCF2E1 100%)',
      } : undefined}
    >
      {/* The site-engineer photograph, larger and reaching further left than a
          full-frame fit allows. Its box is 1280:325 -- the photo's full width
          against the rows from just above the helmet (row ~115 of 440) to the
          bottom -- so `object-cover`, anchored to the bottom, only trims empty
          sky: the engineer, the cranes and the buildings stay whole and in
          proportion. A long, soft fade on its left lets the skyline dissolve
          into the banner instead of ending at an edge. Where the banner is
          narrower than the box, the engineer (x 64-78%) stays in frame. It and
          the scrim sit at -z-10 inside the `isolate` stacking context so they
          paint behind the greeting and the metric cards. */}
      {/* The cream banner has no picture for now: one continuous background. */}
      {!cream && (
        <img
          src="/landing/dashboard-hero-engineer.jpg"
          alt=""
          aria-hidden="true"
          decoding="async"
          data-hero-photo=""
          className="pointer-events-none absolute inset-y-0 right-0 -z-10 h-full w-auto max-w-full select-none object-cover"
          style={{
            aspectRatio: '1280 / 325',
            objectPosition: '72% 100%',
            WebkitMaskImage: 'linear-gradient(90deg, transparent 0%, rgba(0,0,0,.45) 14%, rgba(0,0,0,.85) 30%, #000 42%)',
            maskImage: 'linear-gradient(90deg, transparent 0%, rgba(0,0,0,.45) 14%, rgba(0,0,0,.85) 30%, #000 42%)',
          }}
        />
      )}
      {/* Readability scrim over the photo, with the stops the banner already
          used. The cream banner has no photo, so no scrim either. */}
      {!cream && (
        <div
          className="pointer-events-none absolute inset-0 -z-10"
          style={{ backgroundImage: 'linear-gradient(90deg, rgba(6,45,31,.9) 0%, rgba(6,45,31,.82) 38%, rgba(6,45,31,.55) 60%, rgba(6,45,31,.2) 80%, rgba(6,45,31,.12) 100%)' }}
          aria-hidden="true"
        />
      )}
      {/* Ambient glows + construction grid texture */}
      <div className={`pointer-events-none absolute -right-20 -top-24 h-72 w-72 rounded-full blur-3xl ${cream ? 'bg-transparent' : 'bg-oc-amber/20'}`} aria-hidden="true" />
      <div className="pointer-events-none absolute -bottom-24 -left-20 h-72 w-72 rounded-full bg-oc-green/10 blur-3xl" aria-hidden="true" />
      <div
        className="pointer-events-none absolute inset-0"
        style={{ backgroundImage: 'radial-gradient(rgba(255,255,255,0.06) 1px, transparent 1px)', backgroundSize: '22px 22px' }}
        aria-hidden="true"
      />

      <motion.div
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
        // The cream banner is a little tighter: less padding top and bottom,
        // and no reserved minimum height under the subtitle.
        className={`relative ${cream ? 'px-3.5 py-2 sm:px-5 sm:py-2' : 'px-4 py-3 sm:px-6 sm:py-4'}`}
      >
        <div className={`flex flex-wrap items-center gap-x-4 gap-y-2 lg:gap-x-5 ${aside ? 'md:flex-nowrap' : 'lg:flex-nowrap'}`}>
          {avatar && (
            <div className="flex shrink-0 items-center">
              {avatar.image ? (
                <img src={avatar.image} alt="" className={`${cream ? 'h-8 w-8' : 'h-9 w-9'} rounded-full object-cover object-top ring-2 ${mist ? 'ring-[#126b45]/40' : 'ring-oc-amber/50'}`} />
              ) : (
                <span className={`grid ${cream ? 'h-8 w-8' : 'h-9 w-9'} place-items-center rounded-full bg-gradient-to-br from-oc-green to-oc-deep text-xs font-extrabold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.35),0_8px_20px_-10px_rgba(18,107,69,0.8)]`}>
                  {/* No initials yet: the first letter of this language's own
                      word for a person, rather than a Latin "U" that read as an
                      English letter in all seven. */}
                  {avatar.name || t('ui.shared.user').slice(0, 1).toUpperCase()}
                </span>
              )}
            </div>
          )}

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              {/* Fixed hex colours on the cream banner, not the theme tokens:
                  the banner stays cream in dark mode, where those tokens turn
                  light. */}
              <h1 className={`font-display font-extrabold leading-[1.15] tracking-tight text-balance ${cream ? 'text-base sm:text-lg text-[#083E2B]' : 'text-lg sm:text-xl lg:text-[1.3rem] text-white'}`}>
                {title}
              </h1>
              {action && <span className="-my-1 shrink-0">{action}</span>}
            </div>
            <div className={`${cream ? 'mt-0.5' : 'mt-1'} h-1 w-6 rounded-full bg-gradient-to-r ${mist ? 'from-[#2fa26e] to-[#126b45]' : 'from-oc-amber to-ocaccent-600'}`} />
            {subtitle && (
              <p className={`max-w-2xl ${cream ? 'mt-0.5 text-[11px] leading-4 sm:text-xs text-[#3d5246]' : 'mt-1.5 text-xs leading-5 sm:text-[13px] sm:min-h-10 text-[#b9d8c5]'}`}>{subtitle}</p>
            )}
          </div>

          {aside && <div className={`w-full md:w-[300px] md:shrink-0 lg:w-[380px] ${cream ? 'xl:w-[560px]' : ''}`}>{aside}</div>}
        </div>

        {extra}
      </motion.div>

      {metrics.length > 0 && (
        <div className="grid gap-2 border-t border-white/10 bg-white/[0.04] px-4 py-2 sm:grid-cols-2 sm:gap-2.5 sm:px-6 sm:py-2">
          {metrics.map((metric) => (
            <div
              key={metric.label}
              className="flex items-center gap-2.5 rounded-lg border border-white/10 bg-white/[0.06] px-3 py-1.5 transition hover:-translate-y-0.5 hover:border-oc-amber/40 hover:bg-white/[0.09]"
            >
              <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-md text-white ${metric.tone || 'bg-oc-green'}`}>
                {metric.icon && <metric.icon className="h-3.5 w-3.5" />}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[10px] font-semibold text-[#b9d8c5]/80">{metric.label}</p>
                <p className="mt-0.5 font-display text-sm font-extrabold leading-tight text-white">{metric.value}</p>
              </div>
              {metric.note && (
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${metric.noteTone || 'bg-oc-amber/15 text-oc-amber'}`}>
                  {metric.note}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
