import { Suspense, lazy } from 'react'

// The map library (Leaflet) is downloaded when a map is first shown -- on a job or a
// booking being tracked -- not with the dashboard. Meanwhile an empty frame of the map's
// own size holds its place, so nothing moves.
const TrackingMap = lazy(() => import('./TrackingMap.jsx'))

export default function LazyTrackingMap(props) {
  const className = props.className ?? 'h-[320px] sm:h-[420px]'
  return (
    <Suspense fallback={<div aria-hidden="true" className={`overflow-hidden rounded-2xl border border-oc-line bg-oc-paper ${className}`} />}>
      <TrackingMap {...props} />
    </Suspense>
  )
}
