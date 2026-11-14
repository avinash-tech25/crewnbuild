/**
 * "For better experience, download the CREWNBUILD app now": the promotion at
 * the foot of a product page  (supplier storefront and buyer product pages
 * only -- never the catalog pickers, listings or admin screens).
 *
 * Everything is CREWNBUILD's own: the phone is drawn here, its screen built
 * from the project's own logo, wordmark, category photographs and product
 * cut-outs in /public. Nothing is loaded from outside.
 *
 * Store links: VITE_PLAY_STORE_URL / VITE_APP_STORE_URL when they are set.
 * Until CREWNBUILD's apps are published they are not, and the badges are shown
 * without a link ("Coming soon") -- never pointing anywhere else.
 */
import { Search } from 'lucide-react'

const PLAY_STORE_URL = import.meta.env.VITE_PLAY_STORE_URL || ''
const APP_STORE_URL = import.meta.env.VITE_APP_STORE_URL || ''

const LOGO = '/crew and build logo.png'

function GooglePlayIcon() {
  return (
    <svg viewBox="0 0 24 26" aria-hidden="true" className="h-6 w-6 shrink-0">
      <path fill="#00d7fe" d="M1.1.6C.8.9.6 1.4.6 2v22c0 .6.2 1.1.5 1.4l.1.1L13.5 13.2v-.3L1.2.5z" />
      <path fill="#ffce00" d="M17.6 17.3l-4.1-4.1v-.3l4.1-4.1.1.1 4.9 2.8c1.4.8 1.4 2.1 0 2.9l-4.9 2.8z" />
      <path fill="#ff3a44" d="M17.7 17.3L13.5 13 1.1 25.4c.5.5 1.2.5 2.1.1l14.5-8.2" />
      <path fill="#00f076" d="M17.7 8.7L3.2.5C2.3 0 1.6.1 1.1.6L13.5 13z" />
    </svg>
  )
}

function AppleIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-6 w-6 shrink-0 fill-white">
      <path d="M16.37 12.62c-.03-2.64 2.16-3.91 2.26-3.97-1.23-1.8-3.15-2.05-3.83-2.08-1.63-.17-3.18.96-4.01.96-.83 0-2.1-.94-3.46-.91-1.78.03-3.42 1.03-4.34 2.62-1.85 3.2-.47 7.94 1.33 10.54.88 1.27 1.93 2.7 3.3 2.65 1.33-.05 1.83-.86 3.43-.86 1.6 0 2.05.86 3.45.83 1.43-.02 2.33-1.29 3.2-2.57 1.01-1.47 1.42-2.9 1.45-2.97-.03-.01-2.77-1.06-2.78-4.24zM13.73 4.85c.73-.89 1.23-2.12 1.09-3.35-1.05.04-2.33.7-3.08 1.58-.68.78-1.27 2.03-1.11 3.23 1.17.09 2.37-.6 3.1-1.46z" />
    </svg>
  )
}

/** A store badge in the familiar black style: a link when its URL is set. */
function StoreBadge({ href, icon, small, big, store }) {
  const body = (
    <>
      {icon}
      <span className="flex flex-col items-start leading-none">
        <span className="text-[9px] font-semibold uppercase tracking-wide text-white/80">{small}</span>
        <span className="mt-0.5 text-sm font-bold tracking-tight text-white sm:text-[15px]">{big}</span>
      </span>
    </>
  )
  const className = 'inline-flex h-12 min-w-[8.5rem] items-center gap-2 rounded-xl border border-white/15 bg-black px-3 sm:min-w-[9.5rem] sm:gap-2.5 sm:px-3.5 shadow-sm transition'
  if (href) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" aria-label={`Get the CREWNBUILD app on ${store}`} className={`${className} hover:-translate-y-0.5 hover:shadow-md`}>
        {body}
      </a>
    )
  }
  return (
    <span role="img" aria-label={`CREWNBUILD on ${store}: coming soon`} title="Coming soon" className={`${className} cursor-default`}>
      {body}
    </span>
  )
}

/** The phone: a CREWNBUILD home screen drawn with the project's own images. */
function PhoneMockup() {
  const categories = [
    ['Cement', '/landing/categories/cement.jpg'],
    ['Paint', '/landing/categories/paint.jpg'],
    ['Tiles', '/landing/categories/tiles.jpg'],
    ['Steel', '/landing/categories/steel-tmt.jpg'],
  ]
  const products = [
    ['/landing/cutouts/cement.png', 'OPC 53 Cement', '50 kg Bag'],
    ['/landing/cutouts/paint.png', 'Interior Emulsion', '20 L'],
  ]
  return (
    <div aria-hidden="true" className="relative w-[15rem] select-none">
      {/* Frame */}
      <div className="rounded-[2.4rem] bg-graphite p-2 shadow-[0_22px_40px_-20px_rgba(15,23,42,0.6)] ring-1 ring-black/10">
        <div className="relative overflow-hidden rounded-[1.95rem] bg-[#f6f8f6]">
          {/* Notch */}
          <div className="absolute left-1/2 top-1.5 z-10 h-4 w-20 -translate-x-1/2 rounded-full bg-graphite" />
          {/* App header */}
          <div className="bg-brand-800 px-3 pb-3 pt-7">
            <div className="flex items-center gap-1.5">
              <img src={LOGO} alt="" className="h-9 w-[58px] object-contain" />
            </div>
            <div className="mt-2.5 flex h-7 items-center gap-1.5 rounded-lg bg-white px-2 text-[8px] font-semibold text-graphite/40">
              <Search className="h-2.5 w-2.5" /> Search cement, paint, tiles…
            </div>
          </div>
          {/* Offer strip */}
          <div className="mx-2.5 mt-2.5 rounded-lg bg-oc-amber px-2.5 py-1.5">
            <p className="text-[8px] font-extrabold uppercase tracking-wide text-graphite/70">Site delivery</p>
            <p className="text-[10px] font-extrabold leading-tight text-graphite">Materials from verified suppliers</p>
          </div>
          {/* Categories */}
          <div className="mt-2.5 grid grid-cols-4 gap-1.5 px-2.5">
            {categories.map(([name, src]) => (
              <div key={name} className="flex flex-col items-center gap-1">
                <img src={src} alt="" className="h-9 w-9 rounded-full object-cover ring-1 ring-slate-200" />
                <span className="text-[7px] font-bold text-graphite">{name}</span>
              </div>
            ))}
          </div>
          {/* Product cards */}
          <div className="mt-2.5 grid grid-cols-2 gap-1.5 px-2.5 pb-3">
            {products.map(([src, name, unit]) => (
              <div key={name} className="rounded-lg bg-white p-1.5 shadow-sm ring-1 ring-slate-100">
                <img src={src} alt="" className="mx-auto h-12 w-full object-contain" />
                <p className="mt-1 truncate text-[8px] font-extrabold text-graphite">{name}</p>
                <p className="text-[7px] font-semibold text-graphite/50">{unit}</p>
                <span className="mt-1 block rounded bg-brand-700 py-0.5 text-center text-[7px] font-extrabold text-white">ADD</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

export function AppDownloadBanner({ className = '' }) {
  return (
    <section
      aria-label="Download the CREWNBUILD app"
      className={`relative overflow-hidden rounded-2xl border border-brand-100 bg-gradient-to-br from-brand-50 via-white to-amber-50/70 ${className}`}
    >
      {/* Soft brand shapes behind the content */}
      <div aria-hidden="true" className="pointer-events-none absolute -right-16 -top-20 h-64 w-64 rounded-full bg-oc-amber/25 blur-2xl" />
      <div aria-hidden="true" className="pointer-events-none absolute -bottom-24 left-1/3 h-56 w-56 rounded-full bg-brand-200/40 blur-2xl" />

      <div className="relative flex flex-col items-center gap-6 px-5 py-7 text-center sm:px-8 md:flex-row md:justify-between md:gap-10 md:px-12 md:py-6 md:text-left">
        <div>
          <h2 className="!text-[1.45rem] font-extrabold !leading-tight !tracking-tight text-graphite sm:!text-[1.75rem]">
            For better experience, download
            <br className="hidden sm:block" /> the <span className="text-brand-700">CREWNBUILD</span> app now
          </h2>
          <div className="mt-5 flex flex-wrap items-center justify-center gap-2 sm:gap-3 md:justify-start">
            <StoreBadge href={PLAY_STORE_URL} store="Google Play" icon={<GooglePlayIcon />} small="Get it on" big="Google Play" />
            <StoreBadge href={APP_STORE_URL} store="the App Store" icon={<AppleIcon />} small="Download on the" big="App Store" />
          </div>
        </div>
        {/* The whole phone, scaled down as one piece: always complete, never cropped. */}
        <div className="h-[15.4rem] w-[10.5rem] shrink-0 md:mr-6">
          <div className="origin-top-left scale-[0.7]">
            <PhoneMockup />
          </div>
        </div>
      </div>
    </section>
  )
}
