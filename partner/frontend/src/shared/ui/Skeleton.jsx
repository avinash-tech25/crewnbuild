/**
 * Loading placeholders shaped like the content that replaces them, so a list or
 * panel keeps its size while it loads instead of collapsing to a centred spinner
 * and then jumping when the data arrives.
 *
 * The blocks are decoration (aria-hidden); the wrapper is the one live status a
 * screen reader hears, with a visually hidden label. The pulse stops under
 * prefers-reduced-motion through the global rule in index.css.
 */

const BLOCK = 'animate-pulse rounded-xl bg-oc-sunken'

/** One grey block. Size it with `className` (height, width, radius). */
export function Skeleton({ className = '' }) {
  return <div aria-hidden="true" data-skeleton="" className={`${BLOCK} ${className}`} />
}

/** The status wrapper around any arrangement of Skeleton blocks. */
export function SkeletonStatus({ label = 'Loading', className = '', testId, children }) {
  return (
    <div role="status" aria-busy="true" aria-live="polite" className={className} data-testid={testId}>
      <span className="sr-only">{label}</span>
      {children}
    </div>
  )
}

/** A column of same-sized rows: a list of cards. */
export function SkeletonList({ count = 3, itemClassName = 'h-28', className = 'space-y-3', label, testId }) {
  return (
    <SkeletonStatus label={label} className={className} testId={testId}>
      {Array.from({ length: count }, (_, index) => <Skeleton key={index} className={`w-full ${itemClassName}`} />)}
    </SkeletonStatus>
  )
}

/** A grid of same-sized tiles. Pass the same grid classes the loaded content uses. */
export function SkeletonGrid({ count = 6, itemClassName = 'h-36', className = 'grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3', label, testId }) {
  return (
    <SkeletonStatus label={label} className={className} testId={testId}>
      {Array.from({ length: count }, (_, index) => <Skeleton key={index} className={`w-full ${itemClassName}`} />)}
    </SkeletonStatus>
  )
}
