import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import Logo from '../../../shared/ui/Logo.jsx'
import { technicianTypeByCode } from '../../../shared/constants/technicianTypes.js'
import PublicWeatherIndicator from '../../weather/components/PublicWeatherIndicator.jsx'

// The aside shows one trade at a time, in this order. It is not the order
// TECHNICIAN_TYPES declares (that one runs Painter, Plumber, Electrician,
// Carpenter), so the sequence is named here and resolved through the existing
// lookup rather than by re-importing the artwork.
const CAROUSEL_TRADES = ['PAINTER', 'PLUMBER', 'CARPENTER', 'ELECTRICIAN']
  .map((code) => technicianTypeByCode(code))
  .filter(Boolean)

// Slower than the landing hero's 3200ms. This panel sits beside a password
// field, and something that changes while a person is typing should not be the
// thing pulling their eye.
const TRADE_INTERVAL_MS = 3600

/**
 * The two-column shell behind every auth screen.
 *
 * `dense` tightens the vertical rhythm so a short page fits a laptop viewport without
 * scrolling. It is opt-in and defaults to false. Sign-in and the three registration stages
 * ask for it: each is a couple of fields and a button, so the aside, not the form, is what
 * used to push them past the fold. Onboarding keeps the default -- its steps carry an
 * Aadhaar form and a camera frame, and they scroll whatever we do here.
 */
export default function AuthLayout({ title, subtitle, children, footer, dense = false }) {
  // Decoration only. Nothing here is read by the form, sent to the backend or
  // kept anywhere -- it picks which of the four illustrations the aside shows.
  const [tradeIndex, setTradeIndex] = useState(0)
  const trade = CAROUSEL_TRADES[tradeIndex]

  useEffect(() => {
    const timer = window.setInterval(() => {
      setTradeIndex((current) => (current + 1) % CAROUSEL_TRADES.length)
    }, TRADE_INTERVAL_MS)
    return () => window.clearInterval(timer)
  }, [])

  return (
    <div className="grid min-h-screen lg:grid-cols-[1fr_1.1fr]">
      {/* Sticky at one screen's height: a long form (onboarding) scrolls past
          while the panel and its figure stay where they are. */}
      <aside className={`relative hidden overflow-hidden bg-oc-deep text-white lg:sticky lg:top-0 lg:flex lg:h-screen lg:flex-col lg:self-start ${dense ? 'p-8 [@media(min-height:820px)]:p-10' : 'p-10'}`}>
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_15%,rgba(95,182,130,.3),transparent_40%),radial-gradient(circle_at_85%_90%,rgba(244,183,64,.22),transparent_35%)]" />
        <div className="relative"><Logo tone="light" /></div>
        <div className="relative my-auto">
          {/* One trade at a time, replacing the 2x2 grid of all four. Sized by
              height with `w-auto`, so each illustration keeps its own aspect
              ratio and none is stretched, and smaller than any single tile of
              the grid it replaces. `key` remounts on every change so the entry
              animation replays -- the same `animate-heroPop` the landing hero
              swaps its figures with. */}
          <div className="mx-auto flex flex-col items-center">
            <img
              key={trade.code}
              src={trade.heroImage}
              alt=""
              className="h-[300px] w-auto animate-heroPop object-contain drop-shadow-[0_16px_16px_rgba(0,0,0,.35)] motion-reduce:animate-none [@media(min-height:700px)]:h-[400px] [@media(min-height:820px)]:h-[510px] [@media(min-height:940px)]:h-[620px] [@media(min-height:1100px)]:h-[740px]"
            />
            <p
              key={`${trade.code}-label`}
              className="mt-3 animate-fadeUp text-sm font-bold tracking-wide text-[#b9d8c5] motion-reduce:animate-none"
            >
              {trade.label}
            </p>
          </div>
        </div>
        {/* The two lines sit at the foot of the panel rather than trailing the
            figure, which is as far down as they can go. The block above keeps
            `my-auto`, so it takes the space left between the logo and these and
            centres the figure in it -- no margin needs choosing per screen
            height, and a tall window pushes these down by itself.

            `mt-8` is only a floor: on a short window -- a 1024x600 laptop still
            shows this column, since the aside appears on width -- the free space
            runs out, `my-auto` collapses, and without it the heading would come
            up against the figure. */}
        <div className="relative mt-8">
          <p className="text-center font-display text-2xl font-extrabold tracking-tight">Work that comes to your locality.</p>
          <p className="mt-2 text-center text-sm text-[#b9d8c5]">House Owners and Site Engineers near you book technicians through CREWNBUILD.</p>
        </div>
      </aside>
      <main className={`flex min-w-0 flex-col px-5 sm:px-10 ${dense ? 'py-6' : 'py-8'}`}>
        <div className="flex items-center justify-between lg:justify-end">
          <span className="lg:hidden"><Logo /></span>
          {/* The weather indicator sits beside Back to home, as in the landing header. */}
          <span className="flex items-center gap-3">
            <PublicWeatherIndicator />
            <Link to="/" className="text-sm font-bold text-oc-muted hover:text-oc-deep">Back to home</Link>
          </span>
        </div>
        <div className={`mx-auto my-auto w-full ${dense ? 'max-w-[480px] py-2' : 'max-w-lg py-8'}`}>
          <h1 className="text-3xl font-extrabold tracking-[-0.03em] text-oc-deep">{title}</h1>
          {subtitle && <p className="mt-2 text-sm text-oc-muted">{subtitle}</p>}
          <div className={dense ? 'mt-5' : 'mt-7'}>{children}</div>
          {footer && <div className={`text-center text-sm text-oc-muted ${dense ? 'mt-4' : 'mt-6'}`}>{footer}</div>}
        </div>
      </main>
    </div>
  )
}
