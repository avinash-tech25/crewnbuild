/**
 * Small helpers shared by the storefront pieces. Every value comes from the
 * supplier's own listing; nothing here invents a price, discount or stock.
 *
 *   original price  the listing's price (what the supplier set)
 *   selling price   that price less the listing's discount_percentage
 */
import { useDispatch, useSelector } from 'react-redux'
import { discountedPrice } from '../catalog/components/PriceTag.jsx'
import { formatMoney } from '../../shared/utils/countryConfig.js'
import { selectPreviewCart, setPreviewCartQuantity, clearPreviewCart } from '../catalog/supplierCatalogSlice.js'

export const sellingPrice = (listing) => discountedPrice(listing.price, listing.discount_percentage)
export const discountOf = (listing) => Number(listing?.discount_percentage || 0)
export const money = (value, country) => formatMoney(Number(value || 0), country)
export const sizeOf = (listing) => listing.size || listing.unit || ''

/** The buyer-preview basket (browser only; see supplierCatalogSlice). */
export function usePreviewCart(productList = []) {
  const dispatch = useDispatch()
  const basket = useSelector(selectPreviewCart)
  const lines = Object.entries(basket)
    .map(([id, quantity]) => ({ listing: productList.find((row) => String(row.id) === String(id)), quantity }))
    .filter((line) => line.listing)
  return {
    quantityOf: (id) => Number(basket[id] || 0),
    setQuantity: (id, quantity) => dispatch(setPreviewCartQuantity({ id, quantity })),
    clear: () => dispatch(clearPreviewCart()),
    lines,
    count: lines.length,
    total: lines.reduce((sum, line) => sum + sellingPrice(line.listing) * line.quantity, 0),
  }
}

/** Whether a listing matches every typed word (name, brand, category,
 *  subcategory, size). Runs over this supplier's own listings only. */
export const matchesWords = (listing, words) => {
  const haystack = [listing.name, listing.brand, listing.category, listing.subcategory_name, listing.size, listing.unit]
    .map((value) => String(value || '').toLowerCase())
    .join(' ')
  return String(words).toLowerCase().split(/\s+/).filter(Boolean).every((word) => haystack.includes(word))
}
