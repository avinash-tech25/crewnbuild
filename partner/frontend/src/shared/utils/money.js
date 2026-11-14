// Partner is an India-only application. One currency, no conversion, no
// country switch -- so this formats rupees and nothing else.
//
// The server sends an exact decimal (NUMERIC(12,2)); JSON carries it as a
// string or a number. It is formatted for display only. The amount that is
// charged is the one stored on the booking, never anything computed here.
const RUPEES = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  // Whole rupees stay whole (299 reads "₹299", not "₹299.00"); paise show if a
  // price ever has them, rather than being silently rounded away.
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
})

export function formatRupees(amount) {
  const value = Number(amount)
  if (!Number.isFinite(value)) return ''
  return RUPEES.format(value)
}
