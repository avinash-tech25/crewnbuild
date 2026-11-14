/**
 * Free Delivery · 60 Mins · Pay on Delivery -- the marketplace service
 * information, one component for product cards and product pages. Display
 * only; the values come from PRODUCT_SERVICE_DEFAULTS.
 *
 *   size="sm"  compact chips, for product cards (wraps on narrow cards)
 *   size="md"  the product-page row at the top of the information column:
 *              [Free Delivery] | 60 Mins | Pay on Delivery
 *              -- a filled chip for Free Delivery, the others inline, thin
 *              dividers between; wraps on small screens.
 */
import { Clock3, IndianRupee, Truck } from 'lucide-react'
import { PRODUCT_SERVICE_DEFAULTS, productServiceItems } from '../../../shared/utils/productServiceDefaults.js'

const ICONS = { freeDelivery: Truck, deliveryTime: Clock3, payOnDelivery: IndianRupee }

function DetailItem({ item }) {
  if (item.key === 'freeDelivery') {
    return (
      <span className="inline-flex flex-wrap items-center gap-1.5">
        <span className="inline-flex items-center gap-1 rounded-md bg-brand-700 px-2 py-0.5 text-sm font-extrabold text-white">
          <Truck className="h-4 w-4" aria-hidden="true" /> {item.label}
        </span>
        {item.detail && <span className="text-sm font-semibold text-brand-700">{item.detail}</span>}
      </span>
    )
  }
  if (item.key === 'payOnDelivery') {
    return (
      <span className="inline-flex items-center gap-1.5 text-sm font-extrabold text-brand-800">
        <span className="grid h-5 w-5 place-items-center rounded-full border-[1.5px] border-brand-700 text-brand-700" aria-hidden="true">
          <IndianRupee className="h-3 w-3" />
        </span>
        {item.label}
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-sm font-extrabold text-brand-800">
      <Clock3 className="h-[18px] w-[18px] text-brand-700" aria-hidden="true" /> {item.label}
    </span>
  )
}

export function ProductServiceBadges({ config = PRODUCT_SERVICE_DEFAULTS, size = 'sm', className = '' }) {
  const items = productServiceItems(config)
  if (!items.length) return null

  if (size === 'md') {
    return (
      <ul aria-label="Delivery and payment" className={`flex flex-wrap items-center gap-x-3 gap-y-2 ${className}`}>
        {items.map((item, index) => (
          <li key={item.key} className="flex items-center gap-3">
            {index > 0 && <span className="h-5 w-px bg-slate-300" aria-hidden="true" />}
            <DetailItem item={item} />
          </li>
        ))}
      </ul>
    )
  }

  return (
    <ul aria-label="Delivery and payment" className={`flex flex-wrap items-center gap-1 ${className}`}>
      {items.map(({ key, label }) => {
        const Icon = ICONS[key]
        return (
          <li key={key} className="inline-flex items-center gap-1 rounded-full border border-brand-100 bg-brand-50/70 px-1.5 py-0.5 text-[10px] font-bold text-brand-800">
            <Icon className={`h-3 w-3 shrink-0 ${key === 'deliveryTime' ? 'text-oc-amber' : 'text-brand-700'}`} aria-hidden="true" />
            {label}
          </li>
        )
      })}
    </ul>
  )
}
