export function Card({ title, icon: Icon, action, children, className = '' }) {
  return (
    <section className={`flex h-full flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_14px_40px_-30px_rgba(15,23,42,0.35)] transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-[0_20px_50px_-32px_rgba(15,23,42,0.45)] ${className}`}>
      {(title || action) && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          {title ? (
            <h3 className="flex min-w-0 items-center gap-2 font-display text-[15px] font-bold text-graphite">
              {Icon && <Icon className="h-[18px] w-[18px] shrink-0 text-forest-600" />}
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
    <div className="grid place-items-center rounded-2xl border border-dashed border-slate-200 bg-slate-50/60 px-4 py-12 text-center">
      <p className="font-display text-sm font-bold text-graphite">{title}</p>
      <p className="mt-1 max-w-sm text-xs leading-relaxed text-graphite/55">{message}</p>
    </div>
  )
}
