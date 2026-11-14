/**
 * A supplier's price, with their optional discount.
 *
 *   no discount   ₹500 / Bag
 *   10% discount  ₹450  ₹500  10% OFF
 *
 * The base price is the listing's `price`; the discount never overwrites it.
 * The discounted price is computed here with the same formula the server uses
 * for `discounted_price`: price - price * discount / 100, rounded to 2 places.
 */
import { formatMoney } from '../../../shared/utils/countryConfig.js'

export function discountedPrice(price, discountPercentage) {
  const base = Number(price || 0)
  const discount = Number(discountPercentage || 0)
  if (!Number.isFinite(base)) return 0
  if (!Number.isFinite(discount) || discount <= 0) return Math.round(base * 100) / 100
  return Math.round((base - (base * discount) / 100) * 100) / 100
}

/** A discount as the form accepts it: '' or a number from 0 to 100. */
export function validDiscount(value) {
  if (String(value ?? '').trim() === '') return true
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 && number <= 100
}

const SIZES = {
  sm: { now: 'text-sm', was: 'text-[11px]', off: 'text-[10px]' },
  md: { now: 'text-lg', was: 'text-xs', off: 'text-[11px]' },
  lg: { now: 'text-3xl', was: 'text-sm', off: 'text-xs' },
}

export function PriceTag({ price, discountPercentage, unit = '', size = 'md', className = '' }) {
  const discount = Number(discountPercentage || 0)
  const style = SIZES[size] || SIZES.md
  const per = unit ? <span className={`${style.was} font-bold text-graphite/45`}> / {unit}</span> : null
  if (!(discount > 0)) {
    return (
      <p className={`font-display font-extrabold leading-none text-graphite ${style.now} ${className}`}>
        {formatMoney(price)}
        {per}
      </p>
    )
  }
  return (
    <div className={`flex flex-wrap items-baseline gap-x-2 gap-y-1 ${className}`}>
      <span className={`font-display font-extrabold leading-none text-graphite ${style.now}`}>
        {formatMoney(discountedPrice(price, discount))}
        {per}
      </span>
      <span className={`${style.was} font-bold text-graphite/40 line-through`}>{formatMoney(price)}</span>
      <span className={`rounded-md bg-emerald-50 px-1.5 py-0.5 ${style.off} font-extrabold uppercase text-emerald-700`}>
        {Number(discount.toFixed(2))}% OFF
      </span>
    </div>
  )
}
