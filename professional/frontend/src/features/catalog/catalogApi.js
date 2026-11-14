import { scoped } from '../../shared/api/adminScope.js'
import { baseApi } from '../../shared/api/baseApi.js'
import { runMutation, runQuery } from '../../shared/api/callEndpoint.js'

// The master catalog. Every option in the supplier's cascade and every product a buyer
// browses comes from these calls, so a new catalog seed shows up with nothing here
// changing. The administrator calls further down need a catalog permission; the server
// takes the country from the administrator's own scope (`scoped` only passes the Global
// Super Admin's country switch).
const get = (url, params) => ({ url, params })
const send = (method, url, data, params) => ({ url, method, data, params })
const fileForm = (file) => {
  const form = new FormData()
  form.append('file', file)
  return form
}

export const catalogApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    categories: build.query({ query: () => get('/catalog/categories') }),
    subcategories: build.query({ query: (categoryId) => get('/catalog/subcategories', { category_id: categoryId }) }),
    brands: build.query({ query: (params) => get('/catalog/brands', params) }),
    products: build.query({ query: (params) => get('/catalog/products', params) }),
    product: build.query({ query: (productId) => get(`/catalog/products/${productId}`) }),
    variants: build.query({ query: (productId) => get(`/catalog/products/${productId}/variants`) }),
    search: build.query({ query: ({ query, limit }) => get('/catalog/search', { q: query, limit }) }),
    offers: build.query({ query: (productId) => get(`/catalog/products/${productId}/offers`) }),
    addSupplierListing: build.mutation({ query: (payload) => send('POST', '/supplier-products/from-catalog', payload) }),
    // Administrators
    adminRead: build.query({ query: ({ url, params }) => get(url, params) }),
    adminWrite: build.mutation({ query: ({ method, url, data, params }) => send(method, url, data, params) }),
  }),
})

const { endpoints } = catalogApi
const adminRead = (url, params) => runQuery(endpoints.adminRead, { url, params })
const adminWrite = (method, url, data, params) => runMutation(endpoints.adminWrite, { method, url, data, params })

export const fetchCatalogCategories = () => runQuery(endpoints.categories)
export const fetchCatalogSubcategories = (categoryId) => runQuery(endpoints.subcategories, categoryId)
export const fetchCatalogBrands = ({ categoryId, subcategoryId } = {}) =>
  runQuery(endpoints.brands, { category_id: categoryId, subcategory_id: subcategoryId })
export const fetchCatalogProducts = ({ categoryId, subcategoryId, brandId, search } = {}) =>
  runQuery(endpoints.products, { category_id: categoryId, subcategory_id: subcategoryId, brand_id: brandId, search: search || undefined })
export const fetchCatalogProduct = (productId) => runQuery(endpoints.product, productId)
export const fetchCatalogVariants = (productId) => runQuery(endpoints.variants, productId)
// Plain-words search over the account's own country's catalog ("10kg ultratech cement
// bag"). Best match first; each result carries the variant that matched
// (`matched_variant`) and whether every word matched (`exact`).
export const searchCatalog = (query, limit = 12) => runQuery(endpoints.search, { query, limit })
// One catalog product with every supplier's price against it.
export const fetchCatalogOffers = (productId) => runQuery(endpoints.offers, productId)
// The supplier's side: pick a product, name a price.
export const addSupplierCatalogListing = (payload) => runMutation(endpoints.addSupplierListing, payload)

// ---- Administrators ----
export const fetchAdminCatalogCategories = () => adminRead('/admin/catalog/categories', scoped())
export const fetchAdminCatalogSubcategories = (categoryId) => adminRead('/admin/catalog/subcategories', scoped({ category_id: categoryId }))
export const fetchAdminCatalogBrands = () => adminRead('/admin/catalog/brands')
export const fetchAdminCatalogUnits = () => adminRead('/admin/catalog/units')
export const fetchAdminCatalogProducts = ({ categoryId, subcategoryId, brandId, search } = {}) =>
  adminRead(
    '/admin/catalog/products',
    scoped({ category_id: categoryId, subcategory_id: subcategoryId, brand_id: brandId, search: search || undefined }),
  )
export const fetchAdminCatalogProduct = (productId) => adminRead(`/admin/catalog/products/${productId}`)
export const createAdminCatalogProduct = (payload) => adminWrite('POST', '/admin/catalog/products', payload)
export const updateAdminCatalogProduct = (productId, payload) => adminWrite('PATCH', `/admin/catalog/products/${productId}`, payload)
export const createAdminCatalogVariant = (productId, payload) => adminWrite('POST', `/admin/catalog/products/${productId}/variants`, payload)
export const updateAdminCatalogVariant = (variantId, payload) => adminWrite('PATCH', `/admin/catalog/variants/${variantId}`, payload)
export const uploadAdminCatalogImage = (productId, file) => adminWrite('POST', `/admin/catalog/products/${productId}/image`, fileForm(file))
// The product video: one per product, uploading replaces it.
export const uploadAdminCatalogVideo = (productId, file) => adminWrite('POST', `/admin/catalog/products/${productId}/video`, fileForm(file))
export const deleteAdminCatalogVideo = (productId) => adminWrite('DELETE', `/admin/catalog/products/${productId}/video`)
// A new category belongs to the administrator's country (or the one the Global Super
// Admin chose).
export const createAdminCatalogCategory = (payload) => adminWrite('POST', '/admin/catalog/categories', payload, scoped())
export const updateAdminCatalogCategory = (categoryId, payload) => adminWrite('PATCH', `/admin/catalog/categories/${categoryId}`, payload)
export const createAdminCatalogSubcategory = (payload) => adminWrite('POST', '/admin/catalog/subcategories', payload)
export const createAdminCatalogBrand = (payload) => adminWrite('POST', '/admin/catalog/brands', payload)
export const updateAdminCatalogBrand = (brandId, payload) => adminWrite('PATCH', `/admin/catalog/brands/${brandId}`, payload)
export const uploadAdminCatalogCategoryImage = (categoryId, file) =>
  adminWrite('POST', `/admin/catalog/categories/${categoryId}/image`, fileForm(file))
export const uploadAdminCatalogSubcategoryImage = (subcategoryId, file) =>
  adminWrite('POST', `/admin/catalog/subcategories/${subcategoryId}/image`, fileForm(file))
export const uploadAdminCatalogBrandLogo = (brandId, file) => adminWrite('POST', `/admin/catalog/brands/${brandId}/logo`, fileForm(file))
// The product's image ids in display order.
export const reorderAdminCatalogImages = (productId, imageIds) =>
  adminWrite('PATCH', `/admin/catalog/products/${productId}/images/order`, { image_ids: imageIds })
export const setAdminCatalogPrimaryImage = (imageId) => adminWrite('PATCH', `/admin/catalog/images/${imageId}/primary`)
export const deleteAdminCatalogImage = (imageId) => adminWrite('DELETE', `/admin/catalog/images/${imageId}`)
