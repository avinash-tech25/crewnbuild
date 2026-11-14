export default function EmptyState({ title, message, icon: Icon }) {
  return (
    <div className="grid place-items-center rounded-xl border border-dashed border-brand-100 bg-cream/35 px-4 py-10 text-center">
      {Icon && <span className="grid h-11 w-11 place-items-center rounded-xl bg-brand-50 text-brand-700"><Icon className="h-5 w-5" /></span>}
      <p className="mt-3 font-display text-sm font-bold text-graphite">{title}</p>
      <p className="mt-1 max-w-sm text-xs leading-relaxed text-graphite/55">{message}</p>
    </div>
  )
}
