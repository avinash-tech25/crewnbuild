import { Suspense, lazy } from 'react'

// The booking form's map (Leaflet) is its own download; an empty frame of the map's size
// holds its place until it arrives.
const ServiceLocationPicker = lazy(() => import('./ServiceLocationPicker.jsx'))

export default function LazyServiceLocationPicker(props) {
  const className = props.className ?? 'h-[300px] sm:h-[360px]'
  return (
    <Suspense fallback={<div aria-hidden="true" className={`overflow-hidden rounded-2xl border border-oc-line bg-oc-paper ${className}`} />}>
      <ServiceLocationPicker {...props} />
    </Suspense>
  )
}
