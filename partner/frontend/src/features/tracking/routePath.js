// A route's path for the map, and its identity for re-framing. Plain data: no map library.

/** GeoJSON [lng, lat] -> Leaflet [lat, lng]. The classic map bug lives here, once. */
export function toLatLngPath(geometry) {
  if (!geometry?.coordinates?.length) return []
  return geometry.coordinates.map(([lng, lat]) => [lat, lng])
}

/** Identifies a route for re-framing: a replanned route rarely keeps both its length and its start. */
export function routeKey(path) {
  return path.length ? `${path.length}@${path[0][0].toFixed(5)},${path[0][1].toFixed(5)}` : 'none'
}
