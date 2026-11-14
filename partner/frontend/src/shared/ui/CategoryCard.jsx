import { ArrowRight } from 'lucide-react'
import { Link } from 'react-router-dom'

/**
 * A technician category: 3D illustration, name, short description, one action.
 *
 * `image` defaults to the full-figure render the landing hero uses, so every
 * screen that draws these cards carries the same trade artwork. Pass `image`
 * to show something else.
 */
export default function CategoryCard({ type, actionLabel, to, onAction, image = type.heroImage }) {
  const actionClass = 'btn-primary mt-auto w-full'
  return (
    <article className="group flex flex-col overflow-hidden rounded-3xl border border-oc-line bg-white shadow-ocsoft transition duration-300 ease-soft hover:-translate-y-1 hover:shadow-lift">
      <div className={`relative bg-gradient-to-b ${type.tint} px-6 pt-6`}>
        <span className="absolute inset-x-10 bottom-3 h-6 rounded-full bg-oc-deep/20 blur-lg" aria-hidden="true" />
        {/* The box keeps its 40/47 ratio whichever artwork is passed, so the
            card is exactly the height it has always been. `object-contain` then
            fits the whole figure inside it -- the taller full-figure render
            lands on the box's height and leaves a little air at its sides,
            rather than being cropped to fill the width. */}
        <img
          src={image}
          alt={`3D illustration of a ${type.label.toLowerCase()}`}
          loading="lazy"
          className="relative mx-auto aspect-[40/47] w-full max-w-[220px] object-contain transition duration-500 ease-soft group-hover:-translate-y-1 group-hover:scale-[1.03]"
        />
      </div>
      <div className="flex flex-1 flex-col gap-2 p-5">
        <h3 className="text-xl font-extrabold text-oc-ink">{type.label}</h3>
        <p className="mb-4 text-sm leading-relaxed text-oc-muted">{type.description}</p>
        {to ? (
          <Link to={to} className={actionClass}>
            {actionLabel} <ArrowRight className="h-4 w-4" />
          </Link>
        ) : (
          <button type="button" onClick={onAction} className={actionClass}>
            {actionLabel} <ArrowRight className="h-4 w-4" />
          </button>
        )}
      </div>
    </article>
  )
}
