/**
 * The catalog search bar. Focusing it opens a panel: the admin's categories
 * with their pictures ("Top categories") until the user types, then the
 * matching products. Categories and products come from the caller -- from the
 * catalog API -- never from a list in this file.
 */
import { useEffect, useRef, useState } from 'react'
import { ImageOff, Loader2, Search, X } from 'lucide-react'
import { imageUrl } from '../../../shared/api/apiClient.js'

function Thumb({ src, className }) {
  const [broken, setBroken] = useState(false)
  useEffect(() => setBroken(false), [src])
  if (!src || broken) {
    return (
      <span className={`grid place-items-center bg-slate-100 text-slate-300 ${className}`}>
        <ImageOff className="h-4 w-4" />
      </span>
    )
  }
  return <img src={imageUrl(src)} alt="" onError={() => setBroken(true)} className={`object-cover ${className}`} />
}

export function CatalogSearchOverlay({
  categories = [],
  query,
  onQueryChange,
  results = [],
  searching = false,
  onSelectCategory,
  onOpenProduct,
  placeholder = 'Search cement, UltraTech, ACC…',
}) {
  const [open, setOpen] = useState(false)
  const box = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    const close = (event) => {
      if (box.current && !box.current.contains(event.target)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  const typed = query.trim().length > 0
  const pick = (run) => {
    run()
    setOpen(false)
  }

  return (
    <div ref={box} className="relative" onKeyDown={(event) => event.key === 'Escape' && setOpen(false)}>
      <label className="flex h-12 items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 shadow-sm focus-within:border-brand-400 focus-within:ring-2 focus-within:ring-brand-100">
        <Search className="h-4 w-4 shrink-0 text-brand-800" />
        <input
          value={query}
          onFocus={() => setOpen(true)}
          onChange={(event) => {
            onQueryChange(event.target.value)
            setOpen(true)
          }}
          placeholder={placeholder}
          aria-label="Search products"
          className="min-w-0 flex-1 bg-transparent text-sm font-semibold outline-none placeholder:text-graphite/40"
        />
        {searching && <Loader2 className="h-4 w-4 animate-spin text-graphite/40" />}
        {query && (
          <button type="button" aria-label="Clear search" onClick={() => onQueryChange('')} className="text-graphite/40 hover:text-graphite">
            <X className="h-4 w-4" />
          </button>
        )}
      </label>

      {open && (
        <div role="dialog" aria-label="Search" className="absolute z-30 mt-2 w-full rounded-xl border border-slate-200 bg-white p-4 shadow-xl">
          {!typed ? (
            <>
              <p className="mb-3 text-[11px] font-extrabold uppercase tracking-wide text-graphite/50">Top categories</p>
              {categories.length === 0 ? (
                <p className="text-xs font-semibold text-graphite/45">No categories in the catalog yet.</p>
              ) : (
                <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6">
                  {categories.map((category) => (
                    <button
                      key={category.id}
                      type="button"
                      onClick={() => pick(() => onSelectCategory(category.id))}
                      className="flex flex-col items-center gap-1.5 rounded-lg p-1.5 text-center hover:bg-slate-50"
                    >
                      <Thumb src={category.image_url} className="h-16 w-16 rounded-xl border border-slate-200" />
                      <span className="line-clamp-2 text-[11px] font-bold text-graphite">{category.name}</span>
                    </button>
                  ))}
                </div>
              )}
            </>
          ) : (
            <>
              <p className="mb-2 text-[11px] font-extrabold uppercase tracking-wide text-graphite/50">Products</p>
              {results.length === 0 && !searching ? (
                <p className="text-xs font-semibold text-graphite/45">No matching products.</p>
              ) : (
                <ul className="max-h-80 space-y-1 overflow-y-auto">
                  {results.map((product) => (
                    <li key={product.id}>
                      <button
                        type="button"
                        onClick={() => pick(() => onOpenProduct(product.id))}
                        className="flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left hover:bg-slate-50"
                      >
                        <Thumb src={product.image_url} className="h-10 w-10 shrink-0 rounded-lg border border-slate-200" />
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-bold text-graphite">{product.name}</span>
                          <span className="block truncate text-[11px] font-semibold text-graphite/50">
                            {[product.brand_name, product.category_name].filter(Boolean).join(' · ')}
                          </span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
