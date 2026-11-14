// How a builder's rating reads everywhere it is shown. A builder with no
// reviews has not been rated: "New", rather than a "0.0" that reads as a bad
// score. `reviewCount` is used when the response carries it; otherwise a zero
// rating is taken as unrated.
export function hasRating(rating, reviewCount) {
  if (reviewCount !== undefined && reviewCount !== null && Number(reviewCount) === 0) return false
  return Number(rating || 0) > 0
}

export function ratingLabel(rating, reviewCount, t) {
  return hasRating(rating, reviewCount) ? Number(rating).toFixed(1) : t('dash.common.new')
}
