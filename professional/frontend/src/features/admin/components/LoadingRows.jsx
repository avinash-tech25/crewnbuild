import { SkeletonList } from '../../../shared/ui/Skeleton.jsx'

/**
 * A table body's loading state: one full-width cell holding row-shaped placeholders, so the
 * table keeps roughly the height its rows will take instead of collapsing to one
 * "Loading…" line and pushing the pagination and everything below it down on arrival.
 */
export default function LoadingRows({ colSpan, rows = 6 }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-4 py-3">
        <SkeletonList rows={rows} rowClassName="h-9" className="grid gap-2.5" />
      </td>
    </tr>
  )
}
