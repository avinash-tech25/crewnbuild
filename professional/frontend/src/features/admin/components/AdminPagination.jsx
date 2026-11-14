/**
 * The pager shared by every admin list.
 *
 * It reads `total`, `limit` and `offset` straight off the API response rather
 * than counting rows on screen, so the count is the number of records that exist
 * in scope — not the number that happened to be returned.
 */

import { ChevronLeft, ChevronRight } from 'lucide-react'

export const PAGE_SIZE = 50

export function Pagination({ data, offset, onChange, loading }) {
  // Nothing to page through, or nothing loaded yet — the control would be noise.
  if (!data || (data.total ?? 0) <= (data.limit ?? PAGE_SIZE)) return null

  const limit = data.limit ?? PAGE_SIZE
  const total = data.total ?? 0
  const first = total === 0 ? 0 : offset + 1
  const last = Math.min(offset + limit, total)
  const page = Math.floor(offset / limit) + 1
  const pages = Math.max(1, Math.ceil(total / limit))

  const step = (direction) => onChange(Math.max(0, offset + direction * limit))

  const button =
    'inline-flex h-8 items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 text-xs font-extrabold text-oc-ink transition hover:bg-oc-sunken disabled:cursor-not-allowed disabled:opacity-40'

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-6 py-3">
      <p className="text-xs font-medium tabular-nums text-oc-muted">
        Showing <b className="text-oc-ink">{first}</b>–<b className="text-oc-ink">{last}</b> of{' '}
        <b className="text-oc-ink">{total}</b>
      </p>
      <div className="flex items-center gap-2">
        <span className="text-xs font-bold tabular-nums text-oc-faint">
          Page {page} of {pages}
        </span>
        <button
          type="button"
          className={button}
          disabled={offset === 0 || loading}
          onClick={() => step(-1)}
        >
          <ChevronLeft className="h-3.5 w-3.5" /> Previous
        </button>
        <button
          type="button"
          className={button}
          disabled={last >= total || loading}
          onClick={() => step(1)}
        >
          Next <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  )
}
