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
    <article
      onClick={(event) => { if (!event.target.closest('button, input')) onOpen(product) }}
      className="group flex cursor-pointer flex-col overflow-hidden rounded-xl border border-slate-200 bg-white
                 shadow-[0_10px_30px_-24px_rgba(15,23,42,0.4)] transition duration-200
                 hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-[0_20px_40px_-24px_rgba(15,23,42,0.45)]"
    >
      <div className="relative aspect-[4/3] overflow-hidden bg-slate-50">
        {product.image_url ? (
          <img
            src={imageUrl(product.image_url)}
            alt={td(product.name)}
            className="h-full w-full object-contain p-2 transition duration-300 group-hover:scale-105"
          />
        ) : (
          <span className="grid h-full place-items-center text-slate-300"><Package className="h-7 w-7" /></span>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-1.5 p-2.5">
        {/* One line, ellipsised: a long name must not make the card taller. */}
        {/* The name the supplier gave their product. */}
        <h3 className="truncate font-display text-[13px] font-extrabold leading-tight text-graphite" title={td(product.name)}>
          {td(product.name)}
        </h3>
        <PriceTag price={product.price} discountPercentage={product.discount_percentage} size="sm" />

        {/* One control, in one place: Add to Cart until the product is in the
            basket, then the basket's own quantity stepper. None without
            onAddToCart (a browse-only catalogue). */}
        {onAddToCart && <div className="mt-auto pt-0.5">
          {inCart ? (
            <div className="flex h-8 w-full items-center justify-between overflow-hidden rounded-lg border border-brand-200 bg-brand-50">
              <button type="button" disabled={busy} onClick={() => step(-1)} aria-label={t('shop.decrease')} className="grid h-full w-8 place-items-center text-brand-800 transition hover:bg-brand-100 disabled:opacity-40">
                <Minus className="h-3.5 w-3.5" />
              </button>
              <span className="text-xs font-extrabold text-brand-900" aria-label={t('shop.quantity')}>{Number(line.quantity)}</span>
              <button type="button" disabled={busy || Number(line.quantity) >= available} onClick={() => step(1)} aria-label={t('shop.increase')} className="grid h-full w-8 place-items-center text-brand-800 transition hover:bg-brand-100 disabled:opacity-40">
                <Plus className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              disabled={outOfStock || busy}
              onClick={() => onAddToCart(product, 1)}
              className="inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-lg bg-brand-700 px-2 text-[11px] font-extrabold text-white transition hover:bg-brand-800 disabled:opacity-45"
            >
              <ShoppingCart className="h-3.5 w-3.5" />
              {t('shop.addToCart')}
            </button>
          )}
        </div>}
      </div>
    </article>
  )
}
