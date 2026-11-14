import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowRight,
  BadgeCheck,
  BellRing,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  Hammer,
  Home,
  MapPin,
  Search,
  ToggleRight,
  UserPlus,
} from 'lucide-react'
import SiteHeader from '../components/SiteHeader.jsx'
import SiteFooter from '../components/SiteFooter.jsx'
import CategoryCard from '../../../shared/ui/CategoryCard.jsx'
import { TECHNICIAN_TYPES } from '../../../shared/constants/technicianTypes.js'
import heroRoom from '../../../assets/landing/hero-room.jpg'

/**
 * The hero backdrop's readability scrim.
 *
 * the Professional app's landing hero covers its first screenful with a photograph and
 * lays a dark-green gradient over it -- near-opaque where the headline sits,
 * thinning towards the side the character stands on, so the picture is still
 * visible there. These are the same stops, held back a little less at the far
 * end because Partner's figure is lit brighter than the Professional app's.
 *
 * `heroRoom` is Partner's own backdrop: a room with the four trades in it,
 * composed from the same renders the hero shows and blurred, rather than
 * the Professional app's construction-site photo, whose subject is not this page's.
 */
const HERO_SCRIM =
  'rgba(6,45,31,.94) 0%, rgba(6,45,31,.86) 38%, rgba(6,45,31,.62) 60%, rgba(6,45,31,.39) 80%, rgba(6,45,31,.32) 100%'

// How long each trade holds the hero before the next one comes in. the Professional app's
// landing hero sits on each role character for 5200ms; Partner turns over
// faster, because four trades at that pace read as a hero that has stalled.
// This is the one number to change if the cycle wants slowing down again.
const TRADE_ROTATION_MS = 3200

const OWNER_STEPS = [
  { icon: Home, title: 'Open Book Technician', body: 'From your CREWNBUILD House Owner or Site Engineer dashboard, choose the service you need.' },
  { icon: MapPin, title: 'Matched by your PIN code', body: 'We look in your PIN code first, then the nearest localities around it.' },
  { icon: ClipboardCheck, title: 'Book in one tap', body: 'Pick a technician and send the request. You are told as soon as they accept.' },
]

const TECHNICIAN_STEPS = [
  { icon: UserPlus, title: 'Register in minutes', body: 'Name, contact, your trade and your service area. Nothing more.' },
  { icon: ToggleRight, title: 'Go available', body: 'Switch availability on when you can take work, off when you cannot.' },
  { icon: BellRing, title: 'Accept and complete jobs', body: 'Review new requests, accept the ones you want and track them to completion.' },
]

/**
 * The hero's prev/next control, and the trade selector beside it.
 *
 * Both follow the Professional app's landing hero: a bare circular arrow that brightens and
 * grows on hover rather than a filled button, and a row of tabs whose selected
 * one turns amber and lifts. the Professional app numbers its tabs 1-5 because its slides
 * are roles; Partner's four slides are trades, so they are named — the styling,
 * the states and the keyboard behaviour are the same.
 */
function SlideArrow({ icon: Icon, label, onClick, className }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={`pointer-events-auto absolute top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full
                  border-0 bg-transparent text-white/85 drop-shadow-[0_2px_10px_rgba(0,0,0,.55)]
                  transition-[color,transform] duration-200 ease-soft hover:scale-110 hover:text-white
                  focus-visible:outline focus-visible:outline-2 focus-visible:outline-oc-amber
                  sm:h-12 sm:w-12 ${className}`}
    >
      <Icon className="h-7 w-7" />
    </button>
  )
}

function StepList({ steps, accent }) {
  return (
    <ol className="space-y-5">
      {steps.map((step, index) => (
        <li key={step.title} className="flex gap-4">
          <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-2xl ${accent}`}>
            <step.icon className="h-5 w-5" />
          </span>
          <div>
            <p className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-oc-muted">Step {index + 1}</p>
            <p className="font-display text-lg font-extrabold text-oc-ink">{step.title}</p>
            <p className="text-sm leading-relaxed text-oc-muted">{step.body}</p>
          </div>
        </li>
      ))}
    </ol>
  )
}

export default function LandingPage() {
  // Which trade the hero is showing. Presentation only -- nothing here is read
  // by, sent to, or stored by the backend.
  const [activeTrade, setActiveTrade] = useState(0)
  const trade = TECHNICIAN_TYPES[activeTrade]
  const showPreviousTrade = () =>
    setActiveTrade((current) => (current + TECHNICIAN_TYPES.length - 1) % TECHNICIAN_TYPES.length)
  const showNextTrade = () => setActiveTrade((current) => (current + 1) % TECHNICIAN_TYPES.length)

  // Only the selected figure is in the DOM, so without this the first switch to
  // each trade would show an empty space while half a megabyte of PNG arrives.
  // Fetching the other three after mount keeps the first paint as light as it
  // was -- the browser has them cached by the time anyone clicks.
  useEffect(() => {
    TECHNICIAN_TYPES.forEach((type) => {
      const preload = new Image()
      preload.src = type.heroImage
    })
  }, [])

  // The hero moves through the trades on its own, the way the Professional app's moves
  // through its roles. Watching `activeTrade` restarts the clock whenever the
  // selection changes, so picking a trade by hand gives you a full turn with it
  // rather than however much of one was left -- the Professional app lets its timer run on
  // regardless, which can snatch the slide away moments after you choose it.
  useEffect(() => {
    const timer = window.setInterval(() => {
      setActiveTrade((current) => (current + 1) % TECHNICIAN_TYPES.length)
    }, TRADE_ROTATION_MS)
    return () => window.clearInterval(timer)
  }, [activeTrade])

  // Left/right keys move through the slides while focus is inside the hero,
  // matching the Professional app's landing hero.
  const handleArrowKeys = (event) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    if (event.key === 'ArrowRight') showNextTrade()
    else showPreviousTrade()
  }

  return (
    <div className="min-h-screen">
      <SiteHeader />

      {/* Hero */}
      <section
        className="relative overflow-hidden bg-oc-deep bg-cover bg-center bg-no-repeat text-white"
        style={{ backgroundImage: `linear-gradient(90deg, ${HERO_SCRIM}), url(${heroRoom})` }}
      >
        {/* Narrow screens put the copy over the middle of the picture, where the
            horizontal scrim is at its thinnest, so they get a vertical one too. */}
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(6,45,31,.55),rgba(6,45,31,.82))] lg:hidden" />
        <div className="pointer-events-none absolute end-[6%] top-[8%] h-[340px] w-[340px] rounded-full bg-[rgba(244,183,64,.14)] opacity-40 blur-[2px]" />
        <div className="pointer-events-none absolute bottom-[10%] start-[4%] h-[260px] w-[260px] rounded-full bg-[rgba(18,107,69,.10)] opacity-40 blur-[2px]" />
        <div
          onKeyDown={handleArrowKeys}
          className="container-x relative grid items-center gap-12 pb-14 pt-8 lg:min-h-[calc(100svh-4rem)] lg:grid-cols-[1.05fr_1fr] lg:pb-20 lg:pt-10"
        >
          {/* Pulled towards the edge on wide screens, where the centred
              container leaves a gutter the copy does not need. The whole column
              moves, not the headline alone: the eyebrow, the paragraph, the
              trade tabs and the stat row all hang off the same left edge, and
              shifting one of them would simply break that line.

              The offsets stay within the gutter they are cancelling -- 32px
              against `sm:px-8` from 1024px, 48px once there is centring slack to
              spend at 1280px -- so nothing is ever pushed under the clip. */}
          <div className="animate-fadeUp lg:-ms-8 xl:-ms-12">
            {/* The shared `.eyebrow`, `.btn-ghost` and card styles are built for
                the light page below, so the hero states its own light-on-dark
                versions instead of overriding them -- every other page keeps the
                classes exactly as they were. */}
            <span className="inline-flex items-center gap-2 rounded-full border border-white/30 bg-white/15 px-3 py-1 text-[11px] font-extrabold uppercase tracking-[0.14em] text-white backdrop-blur-[10px]">
              <BadgeCheck className="h-3.5 w-3.5" /> Local technicians for CREWNBUILD homes
            </span>
            <h1 className="mt-5 text-[clamp(1.6rem,min(7.4vw,5.4vh),3rem)] min-[701px]:text-[clamp(2rem,min(4.4vw,6.6vh),5rem)] font-extrabold leading-[1.05] tracking-[-0.045em] text-white drop-shadow-[0_2px_18px_rgba(6,45,31,.45)]">
              The right technician,
              <br />
              <span className="text-oc-amber">right around the corner.</span>
            </h1>
            <p className="mt-5 max-w-xl text-sm leading-relaxed text-white/85 sm:text-base">
              Painters, plumbers, electricians and carpenters matched to your PIN code. House Owners and Site Engineers book straight from
              their CREWNBUILD dashboard; technicians get steady, nearby work.
            </p>
            {/* Trade selector. Chooses which trade the hero image shows, exactly
                as the Professional app's numbered tabs choose which role its hero shows.
                The selected tab turns amber and lifts; the rest are outlined and
                lift on hover. */}
            <div
              role="tablist"
              aria-label="Choose a trade"
              className="mt-7 flex flex-wrap gap-2"
            >
              {TECHNICIAN_TYPES.map((type, index) => (
                <button
                  key={type.code}
                  type="button"
                  role="tab"
                  id={`trade-tab-${type.slug}`}
                  aria-selected={activeTrade === index}
                  aria-controls="trade-panel"
                  onClick={() => setActiveTrade(index)}
                  className={`rounded-full border px-4 py-2 text-[11px] font-extrabold tracking-wide transition-[transform,background,color,border-color] duration-200 ease-soft
                              ${activeTrade === index
                                ? '-translate-y-[3px] border-oc-amber bg-oc-amber text-oc-deep shadow-[0_10px_22px_rgba(244,183,64,.28)]'
                                : 'border-white/30 bg-white/15 text-white backdrop-blur-[10px] hover:-translate-y-[3px] hover:border-oc-amber hover:bg-oc-amber hover:text-oc-deep'}`}
                >
                  {type.label}
                </button>
              ))}
            </div>

            {/* What the selected trade actually covers. Partner's own existing
                copy (TECHNICIAN_TYPES[].description, the same text the service
                cards below already show) -- nothing new is invented here. The
                fixed min-height stops the four different lengths from nudging
                the buttons underneath as the selection changes. */}
            <p
              key={trade.code}
              className="mt-4 max-w-md animate-fadeUp text-sm leading-relaxed text-white/75 sm:min-h-[2.75rem]"
            >
              {trade.description}
            </p>

            {/* The hero's own Register / Login pair has been removed. Both
                actions are still one click away in the header, which is sticky,
                so nothing became unreachable -- and the service cards below
                still carry a "Join as ..." action per trade. */}
            <dl className="mt-8 grid max-w-md grid-cols-3 gap-4">
              {[['4', 'trades'], ['PIN', 'code matching'], ['1 tap', 'booking']].map(([value, label]) => (
                <div key={label} className="rounded-2xl border border-white/25 bg-white/10 px-3 py-3 text-center backdrop-blur-[10px]">
                  <dt className="font-display text-xl font-extrabold text-white">{value}</dt>
                  <dd className="text-xs font-semibold text-white/70">{label}</dd>
                </div>
              ))}
            </dl>
          </div>

          <div className="relative mx-auto w-full max-w-[520px] lg:-mt-6 lg:self-start">
            {/* One trade at a time, standing in the room behind it -- the same
                place the Professional app's role character stands in its hero, and the
                reason the backdrop keeps its own blurred figures to the left.
                Remounting on `key` replays the entry animation on every switch,
                which is what framer-motion's keyed transition does there.
                object-contain keeps each artwork at its own aspect ratio. */}
            <div className="relative grid place-items-center p-10">
              <div
                id="trade-panel"
                role="tabpanel"
                aria-labelledby={`trade-tab-${trade.slug}`}
                aria-live="polite"
                className="relative"
              >
                {/* No panel, no frame, no fill. The renders carry their own alpha,
                    so the figure stands directly on the page. The only thing
                    drawn behind it is this soft ellipse at the feet, which stops
                    it looking like it is hovering -- the same job the shadow
                    under the Professional app's role character does.

                    Sized by height with `w-auto`, so each render keeps its own
                    aspect ratio and nothing is stretched. */}
                {/* The shadow stays put while the figure moves over it. */}
                <div className="absolute inset-x-10 bottom-1 h-[22px] rounded-full bg-black/35 blur-[12px]" />
                {/* Two layers, because both animations drive `transform` and the
                    inner one would otherwise simply overwrite the entry. The
                    outer plays the arrival once -- remounted on `key`, which is
                    what framer-motion's keyed transition does in the Professional app's
                    hero -- and the inner keeps this trade's own idle loop going
                    for as long as it is the one showing. */}
                <div key={trade.code} className="relative animate-heroPop motion-reduce:animate-none">
                  <img
                    src={trade.heroImage}
                    alt={`${trade.label} with their tools`}
                    loading="eager"
                    className={`h-[300px] w-auto origin-[50%_82%] object-contain drop-shadow-[0_20px_12px_rgba(0,0,0,.22)] motion-reduce:animate-none sm:h-[380px] lg:h-[430px] ${trade.motion}`}
                  />
                </div>
              </div>

              <div className="pointer-events-none absolute inset-0">
                <SlideArrow
                  icon={ChevronLeft}
                  label="Previous trade"
                  onClick={showPreviousTrade}
                  className="left-0 sm:-left-1"
                />
                <SlideArrow
                  icon={ChevronRight}
                  label="Next trade"
                  onClick={showNextTrade}
                  className="right-0 sm:-right-1"
                />
              </div>
            </div>
            <div className="absolute -bottom-2 left-1/2 flex -translate-x-1/2 items-center gap-2 whitespace-nowrap rounded-full border border-oc-line bg-white px-4 py-2 text-xs font-extrabold text-oc-deep shadow-card">
              <Search className="h-3.5 w-3.5 text-oc-green" /> Matched by PIN code &amp; locality
            </div>
          </div>
        </div>
      </section>

      {/* Categories */}
      <section id="services" className="scroll-mt-20 py-16 lg:py-20">
        <div className="container-x">
          <div className="mb-10 flex flex-col justify-between gap-4 md:flex-row md:items-end">
            <div>
              <span className="eyebrow"><Hammer className="h-3.5 w-3.5" /> Services</span>
              <h2 className="mt-4 text-[clamp(1.9rem,3.4vw,2.8rem)] font-extrabold tracking-[-0.035em] text-oc-deep">Four trades. One trusted place.</h2>
            </div>
            <p className="max-w-md text-sm leading-relaxed text-oc-muted">
              Every technician chooses one trade and one service area, so the people you see are the people who actually do that work where you live.
            </p>
          </div>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {TECHNICIAN_TYPES.map((type) => (
              <CategoryCard
                key={type.code}
                type={type}
                image={type.heroImage}
                actionLabel={`Join as ${type.label.toLowerCase()}`}
                to={`/register?type=${type.slug}`}
              />
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section id="how-it-works" className="scroll-mt-20 bg-white py-16 lg:py-20">
        <div className="container-x">
          <div className="mx-auto mb-12 max-w-2xl text-center">
            <span className="eyebrow">How it works</span>
            <h2 className="mt-4 text-[clamp(1.9rem,3.4vw,2.8rem)] font-extrabold tracking-[-0.035em] text-oc-deep">Simple for both sides of the job</h2>
          </div>
          <div className="grid gap-6 lg:grid-cols-2">
            <div className="card p-7">
              <p className="mb-6 font-display text-xl font-extrabold text-oc-deep">For House Owners &amp; Site Engineers</p>
              <StepList steps={OWNER_STEPS} accent="bg-oc-mint text-oc-green" />
            </div>
            <div className="card p-7">
              <p className="mb-6 font-display text-xl font-extrabold text-oc-deep">For technicians</p>
              <StepList steps={TECHNICIAN_STEPS} accent="bg-amber-100 text-amber-700" />
            </div>
          </div>
        </div>
      </section>

      {/* Registration CTA */}
      <section id="join" className="scroll-mt-20 py-16 lg:py-20">
        <div className="container-x">
          <div className="relative overflow-hidden rounded-[32px] bg-oc-deep px-7 py-12 text-white sm:px-12">
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_15%_20%,rgba(95,182,130,.3),transparent_40%),radial-gradient(circle_at_90%_85%,rgba(244,183,64,.22),transparent_35%)]" />
            <div className="relative grid items-center gap-8 md:grid-cols-[1.4fr_1fr]">
              <div>
                <h2 className="text-[clamp(1.8rem,3.2vw,2.6rem)] font-extrabold tracking-[-0.035em]">Are you a painter, plumber, electrician or carpenter?</h2>
                <p className="mt-3 max-w-xl text-sm leading-relaxed text-[#b9d8c5] sm:text-base">
                  Register once, set yourself available, and receive booking requests from House Owners and Site Engineers in your locality.
                </p>
              </div>
              <div className="flex flex-col gap-3 sm:flex-row md:flex-col lg:flex-row md:justify-end">
                <Link to="/register" className="btn-amber px-6 py-3">Register now <ArrowRight className="h-4 w-4" /></Link>
                <Link to="/login" className="btn border border-white/30 px-6 py-3 text-white hover:bg-white/10">I already have an account</Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      <SiteFooter />
    </div>
  )
}
