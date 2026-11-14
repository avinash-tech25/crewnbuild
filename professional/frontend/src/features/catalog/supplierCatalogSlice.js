import { useCallback } from 'react'
import { useDispatch, useSelector, useStore } from 'react-redux'
import { createSlice } from '@reduxjs/toolkit'
import { loginWithCredentials, logoutUser } from '../../shared/auth/authSlice.js'

// The signed-in supplier's OWN catalog: their listings, the filters over them,
// and the Add Product form.
//
// Kept apart from catalogSlice on purpose. catalogSlice holds the admin's
// master catalog; this holds only what GET /supplier-products returned for this
// supplier -- listings the server has already limited to theirs. Nothing here
// is ever filled from the master catalog, so a master product can never appear
// as something this supplier sells.
//
// A listing carries only the supplier's commercial values (price, stock,
// low-stock threshold, discount); its description, images and brand are read
// from the master product.

export const EMPTY_SUPPLIER_PRODUCT_FORM = {
  price: '',
  quantity: '',
  lowStockThreshold: '',
  discountPercentage: '',
  isPublished: true,
}

const initialState = {
  supplierProducts: [],
  supplierProductFilters: {
    category: 'All',
    status: 'All',
    lowStockOnly: false,
    // 'relevance' keeps the server's order (newest listing first).
    sort: 'relevance',
    subcategory: 'All',
    brand: 'All',
    discountOnly: false,
    priceMin: '',
    priceMax: '',
    // The storefront: catalog category / subcategory ids ('' = all), the
    // search words and stock availability ('All' | 'in' | 'low' | 'out').
    storeCategory: '',
    storeSubcategory: '',
    search: '',
    availability: 'All',
  },
  supplierProductForm: EMPTY_SUPPLIER_PRODUCT_FORM,
  // The storefront's buyer-preview basket: { listingId: quantity }. Kept in
  // the browser only -- suppliers cannot use the real (buyer) cart.
  previewCart: {},
}

const supplierCatalogSlice = createSlice({
  name: 'supplierCatalog',
  initialState,
  reducers: {
    setSupplierProducts(state, action) {
      state.supplierProducts = action.payload
    },
    setSupplierProductFilter(state, action) {
      const { key, value } = action.payload
      state.supplierProductFilters[key] = value
    },
    setSupplierProductFormField(state, action) {
      const { key, value } = action.payload
      state.supplierProductForm[key] = value
    },
    setPreviewCartQuantity(state, action) {
      const { id, quantity } = action.payload
      if (!state.previewCart) state.previewCart = {}
      if (quantity > 0) state.previewCart[id] = quantity
      else delete state.previewCart[id]
    },
    clearPreviewCart(state) {
      state.previewCart = {}
    },
    resetSupplierProductForm(state) {
      state.supplierProductForm = EMPTY_SUPPLIER_PRODUCT_FORM
    },
    // Signing out (or into another supplier) must not show the last one's list.
    resetSupplierCatalog() {
      return initialState
    },
  },
  // A new session never starts with the previous account's listings.
  extraReducers: (builder) => {
    builder.addCase(logoutUser, () => initialState).addCase(loginWithCredentials.fulfilled, () => initialState)
  },
})

export const {
  setSupplierProducts,
  setSupplierProductFilter,
  setSupplierProductFormField,
  resetSupplierProductForm,
  resetSupplierCatalog,
  setPreviewCartQuantity,
  clearPreviewCart,
} = supplierCatalogSlice.actions

export const selectSupplierProducts = (state) => state.supplierCatalog.supplierProducts
export const selectSupplierProductFilters = (state) => state.supplierCatalog.supplierProductFilters
export const selectSupplierProductForm = (state) => state.supplierCatalog.supplierProductForm
export const selectPreviewCart = (state) => state.supplierCatalog.previewCart || {}

/**
 * [value, setValue] pairs over this slice, with useState's contract: the setter
 * takes a value or an updater function. Lets the supplier dashboard keep every
 * one of its existing `setProductList((items) => ...)` calls unchanged.
 */
function useSlicePair(select, write) {
  const dispatch = useDispatch()
  const store = useStore()
  const value = useSelector(select)
  const setValue = useCallback(
    (next) => {
      const resolved = typeof next === 'function' ? next(select(store.getState())) : next
      dispatch(write(resolved))
    },
    [dispatch, store, select, write],
  )
  return [value, setValue]
}

const filterSelector = (key) => (state) => state.supplierCatalog.supplierProductFilters[key]
const FILTER_KEYS = ['category', 'status', 'lowStockOnly', 'sort', 'subcategory', 'brand', 'discountOnly', 'priceMin', 'priceMax', 'storeCategory', 'storeSubcategory', 'search', 'availability']
const FILTER_SELECTORS = Object.fromEntries(FILTER_KEYS.map((key) => [key, filterSelector(key)]))
const filterWriter = (key) => (value) => setSupplierProductFilter({ key, value })
const FILTER_WRITERS = Object.fromEntries(FILTER_KEYS.map((key) => [key, filterWriter(key)]))

export function useSupplierProducts() {
  return useSlicePair(selectSupplierProducts, setSupplierProducts)
}

export function useSupplierProductFilter(key) {
  return useSlicePair(FILTER_SELECTORS[key], FILTER_WRITERS[key])
}

export default supplierCatalogSlice.reducer
