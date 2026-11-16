// A list table's header and cell classes.
export const thClass = 'whitespace-nowrap px-2.5 py-2 text-[10px] font-extrabold uppercase tracking-wide text-slate-500 rtl:tracking-normal'
export const tdClass = 'px-2.5 py-2 align-top text-xs font-semibold text-graphite/80'

// A table that scrolls sideways inside its own frame on a narrow screen, never the page.
export function DataTable({ head, minWidth = 'min-w-[860px]', children }) {
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div className="dash-scroll overflow-x-auto">
        <table className={`w-full ${minWidth} border-collapse text-start`}>
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50/90 text-start">{head}</tr>
          </thead>
          <tbody className="divide-y divide-slate-100">{children}</tbody>
        </table>
      </div>
    </div>
  )
}
