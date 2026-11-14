/**
 * Category discovery: circular category pictures with the name underneath, in
 * one horizontally scrollable row. Categories come from the caller (the
 * catalog API) -- never from a list in this file. A category without a
 * picture shows its initial.
 *
 * categories       [{ id, name, image_url }]
 * selectedId       the chosen category's id ('' / null = none)
 * onSelect(id)     id as a string, or '' for "All"
 * allLabel         shows an "All" circle first when given
 * renderBelow(cat) optional extra under a circle (e.g. the admin's upload button)
 *
 * CategoryImage is the one category picture every catalog view uses (this
 * strip, the supplier storefront sidebar, the supplier Add Product picker):
 * master_categories.image_url, or the category's initial when there is none
 * or it fails to load. Shape and size come from the caller's className.
 */
import { useEffect, useState } from 'react'
import { LayoutGrid } from 'lucide-react'
import { imageUrl } from '../../../shared/api/apiClient.js'

export function CategoryImage({ src, name, className = '', fallbackClassName = 'bg-brand-50 text-brand-700' }) {
  const [broken, setBroken] = useState(false)
  useEffect(() => setBroken(false), [src])
  if (src && !broken) {
    return <img src={imageUrl(src)} alt="" onError={() => setBroken(true)} className={`bg-white object-cover ${className}`} />
  }
  return (
    <span aria-hidden="true" className={`grid place-items-center font-extrabold ${fallbackClassName} ${className}`}>
      {String(name || '?').trim().charAt(0).toUpperCase() || '?'}
    </span>
  )
}

function Circle({ src, name, selected }) {
  const ring = selected ? 'ring-4 ring-brand-500 ring-offset-2' : 'ring-1 ring-slate-200 group-hover:ring-brand-300'
  return (
    <CategoryImage
      src={src}
      name={name}
      className={`h-16 w-16 rounded-full transition sm:h-20 sm:w-20 ${ring}`}
      fallbackClassName="bg-brand-50 text-xl text-brand-700"
    />
  )
}

export function CategoryStrip({ categories = [], selectedId = '', onSelect, allLabel, renderBelow, emptyLabel = 'No categories yet.' }) {
  if (!categories.length && !allLabel) {
    return <p className="text-xs font-semibold text-graphite/45">{emptyLabel}</p>
  }
  return (
    <div role="list" aria-label="Categories" className="-mx-1 flex snap-x gap-3 overflow-x-auto px-1 pb-2 pt-1 sm:gap-5">
      {allLabel && (
        <div role="listitem" className="shrink-0 snap-start">
          <button type="button" onClick={() => onSelect('')} aria-pressed={!selectedId} className="group flex w-20 flex-col items-center gap-2 sm:w-24">
            <span
              className={`grid h-16 w-16 place-items-center rounded-full bg-graphite text-white transition sm:h-20 sm:w-20 ${
                !selectedId ? 'ring-4 ring-brand-500 ring-offset-2' : 'ring-1 ring-slate-200'
              }`}
            >
              <LayoutGrid className="h-6 w-6" />
            </span>
            <span className={`text-center text-[11px] font-extrabold leading-tight sm:text-xs ${!selectedId ? 'text-brand-800' : 'text-graphite'}`}>{allLabel}</span>
          </button>
        </div>
      )}
      {categories.map((category) => {
        const selected = String(selectedId) === String(category.id)
        return (
          <div role="listitem" key={category.id} className="shrink-0 snap-start">
            <button type="button" onClick={() => onSelect(String(category.id))} aria-pressed={selected} className="group flex w-20 flex-col items-center gap-2 sm:w-24">
              <Circle src={category.image_url} name={category.name} selected={selected} />
              <span className={`line-clamp-2 text-center text-[11px] font-extrabold leading-tight sm:text-xs ${selected ? 'text-brand-800' : 'text-graphite'}`}>
                {category.name}
              </span>
            </button>
            {renderBelow && <div className="mt-1 flex justify-center">{renderBelow(category)}</div>}
          </div>
        )
      })}
    </div>
  )
}
