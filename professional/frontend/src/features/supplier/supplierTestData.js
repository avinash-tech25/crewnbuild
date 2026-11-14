import { anAccount } from '../../test/fakeServer.js'

// Server answers for the Supplier tests, shaped like the backend's.
export const SUPPLIER_ID = '0190a8b2-4c1e-7aa0-9f00-0000000000f5'
export const BUILDER_ID = '0190a8b2-4c1e-7aa0-9f00-0000000000b1'
export const PROJECT_ID = '0190a8b2-4c1e-7aa0-9f00-0000000000a1'
export const PRODUCT_ID = '0190a8b2-4c1e-7aa0-9f00-0000000000f6'
export const ENGINEER_ID = '0190a8b2-4c1e-7aa0-9f00-0000000000e1'
export const SUPPLIER = anAccount({ role: 'SUPPLIER', id: SUPPLIER_ID, name: 'Lakshmi Traders', email: 'lakshmi@example.in' })

export const MATERIAL = 'Material Supplier'
export const LABOUR = 'Labor Supplier'
export const EQUIPMENT = 'Equipment Supplier'

/** GET /suppliers/:id/profile, which tells the dashboard the supplier's category. */
export const aSupplierProfile = (category = MATERIAL) => ({
  id: SUPPLIER_ID,
  user_id: SUPPLIER_ID,
  name: 'Lakshmi Traders',
  role: 'SUPPLIER',
  supplier_category: category,
  store_name: 'Lakshmi Traders',
  pincode: '560001',
  address: '4 Market Road',
  email: 'lakshmi@example.in',
  phone: '9876511111',
})

/** One of the supplier's own listings (GET /supplier-products). */
export const aListing = (overrides = {}) => ({
  id: PRODUCT_ID,
  name: 'UltraTech Cement',
  brand: 'UltraTech',
  category: 'Cement',
  description: 'OPC 53 grade',
  grade: '53',
  size: '50 kg',
  variant: '50 kg',
  unit: 'bag',
  usage: null,
  features: [],
  price: 420,
  discount_percentage: 0,
  discounted_price: 420,
  bulk_pricing: [],
  quantity: 500,
  low_stock_threshold: 10,
  stock_status: 'IN_STOCK',
  is_published: true,
  image_url: null,
  product_type: 'MATERIAL',
  master_product_id: null,
  master_variant_id: null,
  created_at: '2026-11-01T10:00:00+05:30',
  ...overrides,
})

/** A Site Engineer's order line to this supplier (GET /supplier/material-requests). */
export const anOrderLine = (overrides = {}) => ({
  id: '0190a8b2-4c1e-7aa0-9f00-0000000000f7',
  request_code: '0190a8b2f7aa4c1e',
  project_id: PROJECT_ID,
  engineer_id: ENGINEER_ID,
  supplier_id: SUPPLIER_ID,
  product_id: PRODUCT_ID,
  material_name: 'UltraTech Cement',
  category: 'Cement',
  price: 420,
  quantity: 20,
  unit: 'bag',
  status: 'PENDING',
  created_at: '2026-11-13T10:00:00+05:30',
  fulfilled_at: null,
  project_name: 'Rao Family Home',
  engineer_name: 'Meena Iyer',
  engineer_role: 'ENGINEER',
  buyer_is_store_manager: false,
  owner_name: 'Asha Rao',
  supplier_name: 'Lakshmi Traders',
  image_url: null,
  brand: 'UltraTech',
  size: '50 kg',
  project_pincode: '560001',
  project_city: 'Bengaluru',
  subcategory_name: 'OPC',
  ...overrides,
})

/** A builder nearby (GET /suppliers/find-clients); the backend's `type` is the role. */
export const aBuilderClient = (overrides = {}) => ({
  type: 'BUILDER',
  user_id: BUILDER_ID,
  name: 'Ravi Builders',
  company_name: 'Ravi Constructions',
  email: '',
  phone: '',
  address: '7 Lake Road',
  pincode: '560001',
  profile_image_url: null,
  company_logo_url: null,
  business_type: 'Private Limited',
  construction_type: null,
  project_id: null,
  project_title: null,
  project_image_url: null,
  ...overrides,
})

/** Every call the supplier dashboard makes on load, answered empty unless given. */
export const supplierDashboardServer = (category = MATERIAL, overrides = {}) => ({
  'GET /notifications': { data: [] },
  'GET /ads': { data: [] },
  'GET /project-requests/incoming': { data: [] },
  'GET /suppliers/find-clients': { data: [] },
  'GET /supplier-products': { data: [] },
  'GET /supplier/material-requests': { data: [] },
  'GET /suppliers/my-projects': { data: [] },
  [`GET /suppliers/${SUPPLIER_ID}/profile`]: { data: aSupplierProfile(category) },
  'GET /messages/conversations': { data: [] },
  'GET /weather/summary': { data: null },
  'GET /labor/services': { data: [] },
  'GET /labor/requests': { data: [] },
  'GET /labor/trades': { data: ['Mason', 'Carpenter', 'Electrician'] },
  'GET /equipment/items': { data: [] },
  'GET /equipment/requests': { data: [] },
  ...overrides,
})
