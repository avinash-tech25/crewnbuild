export default function DashboardCard({ title, icon: Icon, action, children, className = '' }) {
  return (
    <section className={`flex h-full flex-col rounded-2xl border border-slate-200 bg-white p-6 shadow-[0_16px_50px_-40px_rgba(15,23,42,0.55)] transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-[0_22px_65px_-42px_rgba(15,23,42,0.68)] ${className}`}>
      {(title || action) && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          {title ? (
            <h3 className="flex min-w-0 items-center gap-2 font-display text-[15px] font-bold text-graphite">
              {Icon && <Icon className="h-[18px] w-[18px] shrink-0 text-brand-600" />}
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
