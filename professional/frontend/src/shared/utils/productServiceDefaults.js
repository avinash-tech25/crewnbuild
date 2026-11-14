/**
 * Marketplace service information shown on every product (cards and product
 * pages) -- one place for all of it. These are global display defaults, not
 * product data: nothing is stored per product, and changing a value here (for
 * example '60 Mins' -> '90 Mins') changes it everywhere.
 *
 * Kept as plain data so it can later be replaced by supplier-, location- or
 * product-specific values without touching the components that render it.
 */
export const PRODUCT_SERVICE_DEFAULTS = {
  freeDelivery: true,
  freeDeliveryText: '', // optional text beside "Free Delivery" on product pages; empty = none
  deliveryTime: '60 Mins',
  payOnDelivery: true,
}

/** The badges to show, in order, from a service configuration. */
export function productServiceItems(config = PRODUCT_SERVICE_DEFAULTS) {
  return [
    config.freeDelivery && { key: 'freeDelivery', label: 'Free Delivery', detail: config.freeDeliveryText || '' },
    config.deliveryTime && { key: 'deliveryTime', label: config.deliveryTime },
    config.payOnDelivery && { key: 'payOnDelivery', label: 'Pay on Delivery' },
  ].filter(Boolean)
}
