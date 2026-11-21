/**
 * Loading placeholders that reserve the space the content will take (layout stability):
 * a list, a card grid or a panel keeps its size while it loads, instead of a spinner that
 * collapses the area and makes everything below jump when the data arrives.
 *
 *   <Skeleton className="h-24" />            one block of a given size
 *   <SkeletonList rows={3} rowClassName="h-24" />   a loading list, announced once
 *   <SkeletonGrid count={6} itemClassName="h-[246px]" className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" />
 *
 * The blocks are hidden from assistive technology; the wrapper says "Loading" once.
 */
import { useLanguage } from '../../i18n/LanguageContext.jsx'

export function Skeleton({ className = '' }) {
  return <div aria-hidden="true" className={`animate-pulse rounded-xl bg-slate-200/70 dark:bg-white/10 ${className}`} />
}

function Loading({ className, children }) {
  const { t } = useLanguage()
  return (
    <div role="status" aria-busy="true" className={className}>
      <span className="sr-only">{t('loader.label')}</span>
      {children}
    </div>
  )
}

export function SkeletonList({ rows = 3, rowClassName = 'h-24', className = 'grid gap-3' }) {
  return (
    <Loading className={className}>
      {Array.from({ length: rows }, (_, index) => <Skeleton key={index} className={rowClassName} />)}
    </Loading>
  )
}

export function SkeletonGrid({ count = 6, itemClassName = 'h-60', className = 'grid gap-4 md:grid-cols-2 xl:grid-cols-3' }) {
  return (
    <Loading className={className}>
      {Array.from({ length: count }, (_, index) => <Skeleton key={index} className={itemClassName} />)}
    </Loading>
  )
}

export default Skeleton
