/**
 * CREWNBUILD logo | deliver-to pincode | large search. The search bar is the
 * input; focusing it opens the search dropdown right under it (SearchOverlay,
 * anchored to searchRef). No cart: a supplier sells here, never buys.
 */
import { MapPin, Search, X } from 'lucide-react'

export function StorefrontHeader({ query, pincode, searchRef, searchOpen, onOpenSearch, onType, onSubmit, onCloseSearch, onClearSearch }) {
  return (
    <header className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2.5 shadow-[0_1px_2px_rgba(15,23,42,0.04)] sm:gap-5 sm:px-5">
      {/* The CREWNBUILD mark (the same asset as the app's Logo), without its
          link to the landing page: this header must not leave the dashboard. */}
      <span className="flex shrink-0 items-center gap-2 select-none md:pr-1">
        <img src="/crew and build logo.png" alt="CREWNBUILD" className="h-12 w-[78px] object-contain" />
        <span className="hidden text-xl font-extrabold tracking-tighter text-brand-800 md:block">CREWNBUILD</span>
      </span>
      {/* The supplier's own stored pincode (their account); never a made-up one. */}
      {pincode && (
        <span className="hidden shrink-0 border-x border-slate-200 px-5 leading-tight sm:block">
          <span className="block text-[11px] font-semibold text-graphite/50">Deliver to</span>
          <span className="flex items-center gap-1 text-base font-extrabold text-graphite">
            <MapPin className="h-4 w-4 text-brand-700" aria-hidden="true" /> {pincode}
          </span>
        </span>
      )}
      <div
        ref={searchRef}
        className={`flex h-11 min-w-0 flex-1 items-center gap-3 rounded-lg border bg-white px-4 transition ${searchOpen ? 'border-brand-500 ring-2 ring-brand-100' : 'border-slate-200 hover:border-slate-300'}`}
      >
        <Search className="h-5 w-5 shrink-0 text-graphite" />
        <input
          value={query}
          onFocus={onOpenSearch}
          onClick={onOpenSearch}
          onChange={(event) => onType(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') { event.preventDefault(); onSubmit(); event.currentTarget.blur() }
            if (event.key === 'Escape') { onCloseSearch(); event.currentTarget.blur() }
          }}
          placeholder="Search products, brands or materials..."
          aria-label="Search products, brands or materials"
          autoComplete="off"
          className="h-full min-w-0 flex-1 bg-transparent !text-sm font-medium text-graphite outline-none placeholder:font-normal placeholder:text-slate-400 sm:!text-[15px]"
        />
        {(searchOpen || query) && (
          <button
            type="button"
            onClick={searchOpen ? onCloseSearch : onClearSearch}
            aria-label={searchOpen ? 'Close search' : 'Clear search'}
            className="text-slate-400 hover:text-slate-600"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
    </header>
  )
}
