/**
 * Storefront product card — compact.
 *
 * The whole card is the interaction target — clicking it (the image included)
 * opens the product details, unchanged. Add to Cart sits inside it so a buyer
 * who already knows what they want never has to open the details at all.
 *
 * A card carries one control, not two: Add to Cart while the product is not in
 * the basket, and the basket's own quantity stepper once it is. The number in
 * that stepper is read from the cart state and the buttons drive the existing
 * cart thunks, so the card holds no quantity of its own that could disagree
 * with the cart — and stepping below one removes the line, the same rule
 * `CartPanel` applies.
 *
 * The card deliberately carries only image, name, price, quantity and Add to
 * Cart, so many products fit on one screen. Everything else the product
 * record holds — description, category, brand, specification, unit, stock on
 * hand, store — is still returned by the API and still shown in the detail
 * view this card opens (`BuyerProductCard`); it is simply not repeated here.
 */
import { useDispatch, useSelector } from 'react-redux'
import { Minus, Package, Plus, ShoppingCart } from 'lucide-react'
import { imageUrl } from '../../../shared/api/apiClient.js'
import { changeCartQuantity, removeProductFromCart } from '../cartSlice.js'
import { PriceTag } from '../../catalog/components/PriceTag.jsx'
import { useLanguage } from '../../../i18n/LanguageContext.jsx'
import { CardAvatar, ListCard, cardButtonClass } from '../../../shared/ui/ListCard.jsx'

export default function ProductCard({ product, busy, onOpen, onAddToCart }) {
  const { t, td } = useLanguage()
  const dispatch = useDispatch()
  const available = Number(product.quantity || 0)
  const outOfStock = available <= 0

  // This product's line in the existing cart, if it is in there. The stepper
  // is shown only once it is, and the number it shows is the cart's own
  // quantity — the card keeps no count of its own to drift out of step.
  const line = useSelector((state) => state.cart.items.find((item) => item.product_id === product.id))
  const inCart = Boolean(line)

  // The same rule CartPanel applies: stepping below one removes the line.
  const step = (delta) => {
    if (!line) return undefined
    const next = Number(line.quantity) + delta
    if (next < 1) return dispatch(removeProductFromCart({ itemId: line.id }))
    if (next > available) return undefined
    return dispatch(changeCartQuantity({ itemId: line.id, quantity: next }))
  }

  return (
    <ListCard
      onClick={() => onOpen(product)}
      avatar={(
        <CardAvatar
          src={product.image_url ? imageUrl(product.image_url) : null}
          alt=""
          fallback={<Package aria-hidden="true" className="h-5 w-5" />}
        />
      )}
      // The name the supplier gave their product; one line, ellipsised.
      title={td(product.name)}
      // One control, in one place: Add to Cart until the product is in the
      // basket, then the basket's own quantity stepper. None without
      // onAddToCart (a browse-only catalogue).
      primary={onAddToCart ? (inCart ? (
        <div className="flex h-9 items-center justify-between overflow-hidden rounded-lg border border-brand-200 bg-brand-50">
          <button type="button" disabled={busy} onClick={() => step(-1)} aria-label={t('shop.decrease')} className="grid h-full w-9 place-items-center text-brand-800 transition hover:bg-brand-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-oc-green disabled:opacity-40">
            <Minus className="h-3.5 w-3.5" />
          </button>
          <span className="min-w-[2rem] text-center text-xs font-extrabold text-brand-900" aria-label={t('shop.quantity')}>{Number(line.quantity)}</span>
          <button type="button" disabled={busy || Number(line.quantity) >= available} onClick={() => step(1)} aria-label={t('shop.increase')} className="grid h-full w-9 place-items-center text-brand-800 transition hover:bg-brand-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-oc-green disabled:opacity-40">
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : (
        <button
          type="button"
          disabled={outOfStock || busy}
          onClick={() => onAddToCart(product, 1)}
          className={cardButtonClass('primary')}
        >
          <ShoppingCart className="h-3.5 w-3.5" />
          {t('shop.addToCart')}
        </button>
      )) : null}
    >
      {/* The product photo, whole, at one height on every card. */}
      {product.image_url ? (
        <img
          src={imageUrl(product.image_url)}
          alt={td(product.name)}
          className="h-32 w-full rounded-xl bg-slate-50 object-contain p-2"
        />
      ) : (
        <span className="grid h-32 w-full place-items-center rounded-xl bg-slate-50 text-slate-300"><Package className="h-7 w-7" /></span>
      )}
      <PriceTag price={product.price} discountPercentage={product.discount_percentage} size="sm" />
    </ListCard>
  )
}
