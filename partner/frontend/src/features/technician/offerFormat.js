/**
 * Display helpers for a job request card. No imports: unit-tested under Node.
 */

/** Seconds left to answer as "00:52" / "01:05". Nothing negative, nothing fractional. */
export function formatCountdown(seconds) {
  const value = Number(seconds)
  if (!Number.isFinite(value)) return ''
  const whole = Math.max(0, Math.ceil(value))
  const minutes = Math.floor(whole / 60)
  const rest = whole % 60
  return `${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`
}

/** True when the offer carries an estimate the server worked out; never computed here. */
export function hasEstimate(offer) {
  const value = offer?.estimated_net_amount
  return value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value))
}
