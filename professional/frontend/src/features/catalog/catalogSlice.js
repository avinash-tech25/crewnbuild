import { createAsyncThunk, createSlice } from '@reduxjs/toolkit'
import {
  createAdminCatalogBrand,
  createAdminCatalogCategory,
  createAdminCatalogProduct,
  createAdminCatalogSubcategory,
  fetchAdminCatalogBrands,
  fetchAdminCatalogCategories,
  fetchAdminCatalogProduct,
  fetchAdminCatalogProducts,
  fetchAdminCatalogSubcategories,
  fetchAdminCatalogUnits,
  fetchCatalogBrands,
  fetchCatalogCategories,
  fetchCatalogProduct,
  fetchCatalogProducts,
  fetchCatalogSubcategories,
  searchCatalog,
  updateAdminCatalogCategory,
  updateAdminCatalogProduct,
  uploadAdminCatalogBrandLogo,
  uploadAdminCatalogCategoryImage,
  uploadAdminCatalogSubcategoryImage,
} from './catalogApi.js'

// Master catalog state, in one place.
//
//   admin   Admin > Master Catalog: its lists, filters, the chosen product.
//   picker  Supplier > Add Product: the Category > Subcategory > Brand >
//           Product lists the dropdowns are built from.
//   browse  The product catalog buyers browse (search, categories, product
//           page): master products, plus the OFFERS -- supplier listings --
//           the viewer may buy from. Offers come only from the caller's own
//           supplier feed (location/approval rules already applied by the
//           server); a master product is never treated as an offer.
//
// Every request goes through services/catalog.js; nothing here talks to the
// API itself. What a supplier has listed (their own products) is not here: it
// stays with the supplier dashboard, which owns every change made to it.
//
// Each list remembers the request that last asked for it and ignores any older
// answer, so a slow reply for a previous choice cannot replace the current one.

function apiErrorMessage(error, fallbackMessage) {
  const detail = error.response?.data?.detail
  if (Array.isArray(detail)) return detail[0]?.msg || fallbackMessage
  if (detail?.message) return detail.message
  return detail || fallbackMessage
}

function catalogThunk(name, run, fallbackMessage) {
  return createAsyncThunk(`catalog/${name}`, async (argument, { rejectWithValue }) => {
    try {
      return await run(argument)
    } catch (error) {
      return rejectWithValue(apiErrorMessage(error, fallbackMessage))
    }
  })
}

// ---- Admin -------------------------------------------------------------------
export const loadAdminCatalogReference = catalogThunk(
  'loadAdminCatalogReference',
  async () => {
    const [categories, brands] = await Promise.all([fetchAdminCatalogCategories(), fetchAdminCatalogBrands()])
    return { categories, brands }
  },
  'The catalog could not be loaded.',
)
export const loadAdminCatalogSubcategories = catalogThunk(
  'loadAdminCatalogSubcategories',
  (categoryId) => fetchAdminCatalogSubcategories(categoryId),
  'Those subcategories could not be loaded.',
)
export const loadAdminCatalogProducts = catalogThunk(
  'loadAdminCatalogProducts',
  (filters) => fetchAdminCatalogProducts(filters),
  'Those products could not be loaded.',
)
export const loadAdminCatalogProduct = catalogThunk(
  'loadAdminCatalogProduct',
  (productId) => fetchAdminCatalogProduct(productId),
  'That product could not be opened.',
)

export const loadAdminCatalogUnits = catalogThunk(
  'loadAdminCatalogUnits',
  () => fetchAdminCatalogUnits(),
  'The units could not be loaded.',
)
export const saveAdminCatalogCategory = catalogThunk(
  'saveAdminCatalogCategory',
  ({ id, values }) => (id ? updateAdminCatalogCategory(id, values) : createAdminCatalogCategory(values)),
  'That category could not be saved.',
)
export const uploadAdminCategoryImage = catalogThunk(
  'uploadAdminCategoryImage',
  ({ id, file }) => uploadAdminCatalogCategoryImage(id, file),
  'That image could not be uploaded.',
)
export const uploadAdminSubcategoryImage = catalogThunk(
  'uploadAdminSubcategoryImage',
  ({ id, file }) => uploadAdminCatalogSubcategoryImage(id, file),
  'That image could not be uploaded.',
)
export const saveAdminCatalogSubcategory = catalogThunk(
  'saveAdminCatalogSubcategory',
  (values) => createAdminCatalogSubcategory(values),
  'That subcategory could not be saved.',
)
export const saveAdminCatalogBrand = catalogThunk(
  'saveAdminCatalogBrand',
  (values) => createAdminCatalogBrand(values),
  'That brand could not be saved.',
)
export const uploadAdminBrandLogo = catalogThunk(
  'uploadAdminBrandLogo',
  ({ id, file }) => uploadAdminCatalogBrandLogo(id, file),
  'That logo could not be uploaded.',
)
export const saveAdminCatalogProduct = catalogThunk(
  'saveAdminCatalogProduct',
  ({ id, values }) => (id ? updateAdminCatalogProduct(id, values) : createAdminCatalogProduct(values)),
  'That product could not be saved.',
)

// ---- Buyer browse -----------------------------------------------------------------
export const loadBrowseCategories = catalogThunk(
  'loadBrowseCategories',
  () => fetchCatalogCategories(),
  'The catalog could not be loaded.',
)
export const loadBrowseCategoryProducts = catalogThunk(
  'loadBrowseCategoryProducts',
  (categoryId) => fetchCatalogProducts({ categoryId }),
  'Those products could not be loaded.',
)
export const searchBrowseCatalog = catalogThunk(
  'searchBrowseCatalog',
  (query) => searchCatalog(query, 20),
  'The search could not be completed.',
)
export const loadBrowseProduct = catalogThunk(
  'loadBrowseProduct',
  (productId) => fetchCatalogProduct(productId),
  'That product could not be opened.',
)
// `loadSuppliers` is the page's own supplier feed (nearby / approved /
// assigned suppliers, each with their published listings). Every listing of a
// master product becomes an offer, tagged with its supplier.
export const loadBrowseOffers = catalogThunk(
  'loadBrowseOffers',
  async (loadSuppliers) => {
    const suppliers = (await loadSuppliers()) || []
    const offers = []
    for (const supplier of suppliers) {
      for (const listing of supplier.products || []) {
        if (listing.master_product_id == null || listing.is_published === false) continue
        offers.push({
          ...listing,
          supplier_user_id: supplier.user_id,
          supplier_name: supplier.store_name || supplier.name,
        })
      }
    }
    return offers
  },
  'Your suppliers could not be loaded.',
)

// ---- Supplier Add Product ----------------------------------------------------------
export const loadPickerCategories = catalogThunk(
  'loadPickerCategories',
  () => fetchCatalogCategories(),
  'The product catalog could not be loaded.',
)
export const loadPickerSubcategories = catalogThunk(
  'loadPickerSubcategories',
  (categoryId) => fetchCatalogSubcategories(categoryId),
  'Those subcategories could not be loaded.',
)
export const loadPickerBrands = catalogThunk(
  'loadPickerBrands',
  (subcategoryId) => fetchCatalogBrands({ subcategoryId }),
  'Those brands could not be loaded.',
)
export const loadPickerProducts = catalogThunk(
  'loadPickerProducts',
  (subcategoryId) => fetchCatalogProducts({ subcategoryId }),
  'Those products could not be loaded.',
)

const EMPTY_FILTERS = { categoryId: '', subcategoryId: '', brandId: '', search: '' }

const EMPTY_BROWSE = {
  categories: [],
  selectedCategoryId: null,
  categoryProducts: [],
  searchQuery: '',
  searchResults: [],
  searching: false,
  selectedProductId: null,
  selectedProduct: null,
  offers: [],
  offersLoaded: false,
  loading: false,
  error: '',
}

const initialState = {
  browse: EMPTY_BROWSE,
  admin: {
    categories: [],
    subcategories: [],
    brands: [],
    products: [],
    filters: EMPTY_FILTERS,
    loading: false,
    error: '',
    selectedId: null,
    detail: null,
    units: [],
  },
  picker: {
    categories: [],
    categoriesLoaded: false,
    subcategories: [],
    brands: [],
    products: [],
    error: '',
  },
  // The request id each list is waiting for; older answers are dropped.
  requests: {},
}

// pending -> remember the request; fulfilled/rejected -> apply only if it is
// still the latest one for that list.
function trackLatest(builder, thunk, key, onFulfilled, onRejected, onPending) {
  builder
    .addCase(thunk.pending, (state, action) => {
      state.requests[key] = action.meta.requestId
      onPending?.(state)
    })
    .addCase(thunk.fulfilled, (state, action) => {
      if (state.requests[key] !== action.meta.requestId) return
      onFulfilled(state, action.payload, action.meta.arg)
    })
    .addCase(thunk.rejected, (state, action) => {
      if (state.requests[key] !== action.meta.requestId) return
      onRejected?.(state, action.payload || action.error.message)
    })
}

const catalogSlice = createSlice({
  name: 'catalog',
  initialState,
  reducers: {
    // A fresh admin screen: the page is remounted per country, and one
    // country's catalog must not show in the other's.
    resetAdminCatalog(state) {
      state.admin = initialState.admin
    },
    setAdminCatalogFilter(state, action) {
      const { key, value } = action.payload
      state.admin.filters[key] = value
      // Choosing a category clears a subcategory that belonged to another.
      if (key === 'categoryId') {
        state.admin.filters.subcategoryId = ''
        if (!value) state.admin.subcategories = []
      }
    },
    selectAdminCatalogProduct(state, action) {
      state.admin.selectedId = action.payload
      state.admin.detail = null
    },
    clearAdminCatalogError(state) {
      state.admin.error = ''
    },
    // Add Product: a level with no parent chosen has nothing to offer.
    clearPickerList(state, action) {
      state.picker[action.payload] = []
    },
    // Buyer browse.
    resetBrowse(state) {
      state.browse = EMPTY_BROWSE
    },
    setBrowseQuery(state, action) {
      state.browse.searchQuery = action.payload
      if (!action.payload.trim()) state.browse.searchResults = []
    },
    selectBrowseCategory(state, action) {
      state.browse.selectedCategoryId = action.payload
      state.browse.selectedProductId = null
      state.browse.selectedProduct = null
    },
    openBrowseProduct(state, action) {
      state.browse.selectedProductId = action.payload
      state.browse.selectedProduct = null
    },
    closeBrowseProduct(state) {
      state.browse.selectedProductId = null
      state.browse.selectedProduct = null
    },
  },
  extraReducers: (builder) => {
    trackLatest(builder, loadAdminCatalogReference, 'adminReference',
      (state, payload) => {
        state.admin.categories = payload.categories
        state.admin.brands = payload.brands
      },
      (state, message) => {
        state.admin.error = message
      })
    trackLatest(builder, loadAdminCatalogSubcategories, 'adminSubcategories',
      (state, payload) => {
        state.admin.subcategories = payload
      },
      (state) => {
        state.admin.subcategories = []
      })
    trackLatest(builder, loadAdminCatalogProducts, 'adminProducts',
      (state, payload) => {
        state.admin.products = payload
        state.admin.loading = false
      },
      (state, message) => {
        state.admin.error = message
        state.admin.loading = false
      },
      (state) => {
        state.admin.loading = true
      })
    trackLatest(builder, loadAdminCatalogProduct, 'adminDetail',
      (state, payload, productId) => {
        if (state.admin.selectedId === productId) state.admin.detail = payload
      },
      (state, message) => {
        state.admin.error = message
      })

    trackLatest(builder, loadAdminCatalogUnits, 'adminUnits', (state, payload) => {
      state.admin.units = payload
    })
    // A saved or re-pictured category / brand replaces its row in the lists.
    const upsert = (list, row) => {
      const index = list.findIndex((item) => item.id === row.id)
      if (index === -1) list.push(row)
      else list[index] = row
    }
    builder
      .addCase(saveAdminCatalogCategory.fulfilled, (state, action) => upsert(state.admin.categories, action.payload))
      .addCase(uploadAdminCategoryImage.fulfilled, (state, action) => upsert(state.admin.categories, action.payload))
      .addCase(saveAdminCatalogBrand.fulfilled, (state, action) => upsert(state.admin.brands, action.payload))
      .addCase(uploadAdminBrandLogo.fulfilled, (state, action) => upsert(state.admin.brands, action.payload))
      // The product filter's subcategory list holds the same rows.
      .addCase(uploadAdminSubcategoryImage.fulfilled, (state, action) => {
        const index = state.admin.subcategories.findIndex((item) => item.id === action.payload.id)
        if (index !== -1) state.admin.subcategories[index] = action.payload
      })

    trackLatest(builder, loadBrowseCategories, 'browseCategories',
      (state, payload) => {
        state.browse.categories = payload
      },
      (state, message) => {
        state.browse.error = message
      })
    trackLatest(builder, loadBrowseCategoryProducts, 'browseCategoryProducts',
      (state, payload) => {
        state.browse.categoryProducts = payload
        state.browse.loading = false
      },
      (state, message) => {
        state.browse.categoryProducts = []
        state.browse.error = message
        state.browse.loading = false
      },
      (state) => {
        state.browse.loading = true
      })
    trackLatest(builder, searchBrowseCatalog, 'browseSearch',
      (state, payload, query) => {
        if (state.browse.searchQuery.trim() === String(query).trim()) state.browse.searchResults = payload
        state.browse.searching = false
      },
      (state) => {
        state.browse.searching = false
      },
      (state) => {
        state.browse.searching = true
      })
    trackLatest(builder, loadBrowseProduct, 'browseProduct',
      (state, payload, productId) => {
        if (String(state.browse.selectedProductId) === String(productId)) state.browse.selectedProduct = payload
      },
      (state, message) => {
        state.browse.error = message
      })
    trackLatest(builder, loadBrowseOffers, 'browseOffers',
      (state, payload) => {
        state.browse.offers = payload
        state.browse.offersLoaded = true
      },
      (state, message) => {
        state.browse.offers = []
        state.browse.offersLoaded = true
        state.browse.error = message
      })

    trackLatest(builder, loadPickerCategories, 'pickerCategories',
      (state, payload) => {
        state.picker.categories = payload
        state.picker.categoriesLoaded = true
        state.picker.error = ''
      },
      (state, message) => {
        state.picker.error = message
      })
    trackLatest(builder, loadPickerSubcategories, 'pickerSubcategories',
      (state, payload) => {
        state.picker.subcategories = payload
      },
      (state) => {
        state.picker.subcategories = []
      })
    trackLatest(builder, loadPickerBrands, 'pickerBrands',
      (state, payload) => {
        state.picker.brands = payload
      },
      (state) => {
        state.picker.brands = []
      })
    trackLatest(builder, loadPickerProducts, 'pickerProducts',
      (state, payload) => {
        state.picker.products = payload
      },
      (state) => {
        state.picker.products = []
      })
  },
})

export const {
  resetAdminCatalog,
  setAdminCatalogFilter,
  selectAdminCatalogProduct,
  clearAdminCatalogError,
  clearPickerList,
  resetBrowse,
  setBrowseQuery,
  selectBrowseCategory,
  openBrowseProduct,
  closeBrowseProduct,
} = catalogSlice.actions

export const selectAdminCatalog = (state) => state.catalog.admin
export const selectCatalogPicker = (state) => state.catalog.picker
export const selectCatalogBrowse = (state) => state.catalog.browse

export default catalogSlice.reducer
