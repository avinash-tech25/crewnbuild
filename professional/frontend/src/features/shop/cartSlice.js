import { createAsyncThunk, createSlice } from '@reduxjs/toolkit'
import {
  addCartItem,
  checkoutCart,
  clearCart,
  fetchCart,
  removeCartItem,
  updateCartItem,
} from './cartApi.js'

// The server owns the cart, so every thunk returns the whole basket and the
// reducer simply adopts it. That keeps the web app and the mobile app in step
// without either of them recomputing totals.

function apiErrorMessage(error, fallbackMessage) {
  const detail = error.response?.data?.detail
  if (Array.isArray(detail)) return detail[0]?.msg || fallbackMessage
  if (detail?.message) return detail.message
  return detail || fallbackMessage
}

function cartThunk(name, run, fallbackMessage) {
  return createAsyncThunk(`cart/${name}`, async (argument, { rejectWithValue }) => {
    try {
      return await run(argument)
    } catch (error) {
      return rejectWithValue(apiErrorMessage(error, fallbackMessage))
    }
  })
}

export const loadCart = cartThunk('loadCart', (projectId) => fetchCart(projectId), 'Unable to load your cart.')

export const addProductToCart = cartThunk(
  'addProductToCart',
  ({ projectId, productId, quantity }) => addCartItem(projectId, productId, quantity),
  'Unable to add this product to your cart.',
)

export const changeCartQuantity = cartThunk(
  'changeCartQuantity',
  ({ itemId, quantity }) => updateCartItem(itemId, quantity),
  'Unable to update the quantity.',
)

export const removeProductFromCart = cartThunk(
  'removeProductFromCart',
  ({ itemId }) => removeCartItem(itemId),
  'Unable to remove this item.',
)

export const emptyCart = cartThunk('emptyCart', (projectId) => clearCart(projectId), 'Unable to clear your cart.')

export const sendBuyRequest = createAsyncThunk(
  'cart/sendBuyRequest',
  async ({ projectId, supplierId }, { rejectWithValue }) => {
    try {
      return await checkoutCart(projectId, supplierId)
    } catch (error) {
      return rejectWithValue(apiErrorMessage(error, 'Unable to send the buy request.'))
    }
  },
)

const emptyState = { items: [], suppliers: [], item_count: 0, total: 0 }

const cartSlice = createSlice({
  name: 'cart',
  initialState: {
    ...emptyState,
    status: 'idle',
    errorMessage: '',
    lastRequestCode: '',
  },
  reducers: {
    clearCartMessage(state) {
      state.errorMessage = ''
      state.lastRequestCode = ''
    },
    resetCart(state) {
      Object.assign(state, emptyState, { status: 'idle', errorMessage: '', lastRequestCode: '' })
    },
  },
  extraReducers: (builder) => {
    const adopt = (state, cart) => {
      state.items = cart?.items || []
      state.suppliers = cart?.suppliers || []
      state.item_count = cart?.item_count || 0
      state.total = cart?.total || 0
    }

    builder
      .addCase(sendBuyRequest.fulfilled, (state, action) => {
        state.status = 'succeeded'
        state.errorMessage = ''
        state.lastRequestCode = action.payload?.request_code || ''
        adopt(state, action.payload?.cart)
      })
      .addMatcher(
        (action) => action.type.startsWith('cart/') && action.type.endsWith('/pending'),
        (state) => {
          state.status = 'loading'
          state.errorMessage = ''
        },
      )
      .addMatcher(
        (action) => action.type.startsWith('cart/') && action.type.endsWith('/rejected'),
        (state, action) => {
          state.status = 'failed'
          state.errorMessage = action.payload || 'Something went wrong with your cart.'
        },
      )
      .addMatcher(
        (action) => action.type.startsWith('cart/')
          && action.type.endsWith('/fulfilled')
          && action.type !== sendBuyRequest.fulfilled.type,
        (state, action) => {
          state.status = 'succeeded'
          state.errorMessage = ''
          adopt(state, action.payload)
        },
      )
  },
})

export const { clearCartMessage, resetCart } = cartSlice.actions

export const selectCart = (state) => state.cart
export const selectCartCount = (state) => state.cart.item_count
export const selectCartSuppliers = (state) => state.cart.suppliers
export const selectCartQuantityFor = (productId) => (state) =>
  state.cart.items.find((item) => item.product_id === productId)?.quantity || 0

export default cartSlice.reducer
