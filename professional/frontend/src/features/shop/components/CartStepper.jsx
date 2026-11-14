/**
 * "Add to Cart", then [ − 1 + ] once the offer is in the cart.
 *
 * Only the EXISTING cart: the cartSlice thunks and their endpoints
 * (POST /cart/items, PATCH/DELETE /cart/items/{id}). Stepping below one
 * removes the line, the same rule CartPanel applies. The cart belongs to a
 * project, so without one the button explains that instead of adding.
 */
import { useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { Loader2, Minus, Plus, ShoppingCart } from 'lucide-react'
import { addProductToCart, changeCartQuantity, removeProductFromCart, selectCart } from '../cartSlice.js'

export function CartStepper({ offer, projectId, onMessage, full = false, size = 'md' }) {
  const dispatch = useDispatch()
  const line = useSelector((state) => selectCart(state).items.find((item) => item.product_id === offer?.id)) || null
  const [busy, setBusy] = useState(false)
  const outOfStock = !offer || offer.stock_status === 'OUT_OF_STOCK' || Number(offer.quantity || 0) <= 0
  const height = size === 'sm' ? 'h-8' : 'h-10'

  const run = async (action, success) => {
    setBusy(true)
    const result = await dispatch(action)
    setBusy(false)
    onMessage?.(result.meta.requestStatus === 'fulfilled' ? success : result.payload)
  }

  const add = () => {
    if (!projectId) {
      onMessage?.('Choose a project first; the cart belongs to a project.')
      return
    }
    run(addProductToCart({ projectId, productId: offer.id, quantity: 1 }), `${offer.name} added to your cart.`)
  }
  const step = (quantity) =>
    quantity < 1
      ? run(removeProductFromCart({ itemId: line.id }), `${offer.name} removed from your cart.`)
      : run(changeCartQuantity({ itemId: line.id, quantity }), '')

  if (!line) {
    return (
      <button
        type="button"
        onClick={add}
        disabled={busy || outOfStock}
        className={`inline-flex ${height} items-center justify-center gap-1.5 rounded-lg bg-brand-700 px-3 text-xs font-extrabold text-white transition hover:bg-brand-800 disabled:bg-slate-300 ${full ? 'w-full' : ''}`}
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShoppingCart className="h-3.5 w-3.5" />}
        {outOfStock ? 'Out of stock' : 'Add to Cart'}
      </button>
    )
  }
  return (
    <div className={`inline-flex ${height} items-center justify-between rounded-lg border-2 border-brand-600 bg-white ${full ? 'w-full' : ''}`} role="group" aria-label={`${offer.name} in cart`}>
      <button type="button" disabled={busy} onClick={() => step(Number(line.quantity) - 1)} aria-label="Decrease quantity" className="grid h-full w-9 place-items-center text-brand-800 disabled:opacity-40">
        <Minus className="h-3.5 w-3.5" />
      </button>
      <span className="min-w-[2.5rem] text-center text-sm font-extrabold text-graphite">
        {busy ? <Loader2 className="mx-auto h-3.5 w-3.5 animate-spin" /> : Number(line.quantity).toLocaleString('en-IN', { maximumFractionDigits: 2 })}
      </span>
      <button
        type="button"
        disabled={busy}
        onClick={() => step(Number(line.quantity) + 1)}
        aria-label="Increase quantity"
        className="grid h-full w-9 place-items-center text-brand-800 disabled:opacity-40"
      >
        <Plus className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}
