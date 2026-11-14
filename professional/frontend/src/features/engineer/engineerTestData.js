import { anAccount } from '../../test/fakeServer.js'

// Server answers for the Site Engineer, live camera and Store Manager tests, shaped like
// the backend's.
export const SITE_ENGINEER = anAccount({
  role: 'ENGINEER',
  id: '0190a8b2-4c1e-7aa0-9f00-0000000000e1',
  name: 'Meena Iyer',
  email: 'meena@example.in',
  engineer_profile: { specialization: 'Site Engineer', category: 'SITE_ENGINEER', experience_years: 6 },
})
export const STRUCTURAL_ENGINEER = anAccount({
  role: 'ENGINEER',
  id: '0190a8b2-4c1e-7aa0-9f00-0000000000e2',
  name: 'Kiran Das',
  engineer_profile: { specialization: 'Structural Engineer', category: null, experience_years: 9 },
})
export const STORE_MANAGER = anAccount({
  role: 'ENGINEER',
  id: '0190a8b2-4c1e-7aa0-9f00-0000000000e3',
  name: 'Suresh Nair',
  engineer_profile: { specialization: 'Store Manager', category: 'STORE_MANAGER', experience_years: 4 },
})

export const PROJECT_ID = '0190a8b2-4c1e-7aa0-9f00-0000000000a1'
export const BUILDER_ID = '0190a8b2-4c1e-7aa0-9f00-0000000000b1'
export const CHANNEL_ID = '0190a8b2-4c1e-7aa0-9f00-0000000000d2'
export const STORE_REQUEST_ID = '0190a8b2-4c1e-7aa0-9f00-0000000000c5'
export const SUPPLIER_ID = '0190a8b2-4c1e-7aa0-9f00-0000000000f5'

/** One entry of GET /engineers/my-projects. */
export const anAssignedProject = (overrides = {}) => ({
  id: PROJECT_ID,
  title: 'Rao Family Home',
  description: 'Two-storey house',
  address: '12 MG Road',
  pincode: '560001',
  budget: 4500000,
  building_type: 'Residential',
  construction_type: 'CONTRACTOR',
  contractor_id: BUILDER_ID,
  contractor_name: 'Ravi Builders',
  company_name: 'Ravi Constructions',
  owner_name: 'Asha Rao',
  cover_image_url: null,
  status: 'active',
  start_date: '2026-11-01',
  end_date: '2027-06-01',
  assigned_at: '2026-11-02T10:00:00+05:30',
  created_at: '2026-11-01T10:00:00+05:30',
  work_started: true,
  ...overrides,
})

/** Every call the engineer dashboard makes on load, answered empty unless given. */
export const engineerDashboardServer = (overrides = {}) => ({
  'GET /notifications': { data: [] },
  'GET /ads': { data: [] },
  'GET /cart': { data: { groups: [], item_count: 0 } },
  'GET /engineers/my-projects': { data: [] },
  'GET /engineers/my-team': { data: { active: [], pending_requests: [], outgoing_requests: [], invitations: [] } },
  'GET /project-requests/incoming': { data: [] },
  'GET /engineers/opportunities': { data: [] },
  'GET /material-requests/mine': { data: [] },
  'GET /contractors/nearby': { data: [] },
  'GET /weather/summary': { data: null },
  ...overrides,
})

/** A project recorder with one camera (GET /cctv/projects/:id/devices). */
export const aRecorder = () => [{
  id: '0190a8b2-4c1e-7aa0-9f00-0000000000d1',
  project_id: PROJECT_ID,
  name: 'Site NVR',
  device_type: 'NVR',
  manufacturer: 'Hikvision',
  model: null,
  firmware_version: null,
  serial_number: null,
  connection_method: 'ONVIF',
  onvif_configured: true,
  status: 'ONLINE',
  status_detail: null,
  last_verification_result: 'OK',
  last_checked_at: '2026-11-14T09:00:00+05:30',
  last_online_at: '2026-11-14T09:00:00+05:30',
  is_active: true,
  has_credentials: true,
  credentials_last_verified_at: '2026-11-14T09:00:00+05:30',
  channel_count: 1,
  channels: [{
    id: CHANNEL_ID,
    device_id: '0190a8b2-4c1e-7aa0-9f00-0000000000d1',
    project_id: PROJECT_ID,
    channel_number: 1,
    name: 'Gate camera',
    location_label: 'Main gate',
    has_main_stream: true,
    has_sub_stream: true,
    main_codec: 'H264',
    sub_codec: 'H264',
    main_width: 1920,
    main_height: 1080,
    sub_width: 640,
    sub_height: 360,
    preferred_stream: 'SUB',
    is_enabled: true,
    status: 'ONLINE',
    status_detail: null,
    last_checked_at: '2026-11-14T09:00:00+05:30',
  }],
  created_at: '2026-11-01T10:00:00+05:30',
  updated_at: '2026-11-14T09:00:00+05:30',
}]

/** Every call the Store Manager dashboard makes on load, answered empty unless given. */
export const storeDashboardServer = (overrides = {}) => ({
  'GET /notifications': { data: [] },
  'GET /ads': { data: [] },
  'GET /store-manager/overview': { data: {} },
  'GET /store-manager/items': { data: [] },
  'GET /store-manager/requests': { data: [] },
  'GET /store-manager/purchases': { data: [] },
  'GET /store-manager/payments': { data: [] },
  'GET /store-manager/projects': { data: [{ id: PROJECT_ID, title: 'Rao Family Home', pincode: '560001', project_city: 'Bengaluru' }] },
  'GET /engineers/my-team': { data: { active: [], pending_requests: [], outgoing_requests: [], invitations: [] } },
  'GET /contractors/nearby': { data: [] },
  'GET /weather/summary': { data: null },
  ...overrides,
})

/** A Site Engineer's pending request to the store (GET /store-manager/requests). */
export const aSiteRequest = (overrides = {}) => ({
  id: STORE_REQUEST_ID,
  public_request_id: 'SR-0001',
  status: 'PENDING',
  stage: 'PENDING',
  procurement_status: 'NONE',
  purchases: [],
  note: 'Needed for slab work',
  decision_note: null,
  approved_by: null,
  received_by: null,
  issued_quantity: {},
  short: false,
  timeline: [],
  project_id: PROJECT_ID,
  project_name: 'Rao Family Home',
  builder_id: BUILDER_ID,
  builder_name: 'Ravi Builders',
  engineer_id: SITE_ENGINEER.id,
  engineer_name: 'Meena Iyer',
  created_at: '2026-11-13T10:00:00+05:30',
  lines: [{
    id: '0190a8b2-4c1e-7aa0-9f00-0000000000c6',
    item_id: '0190a8b2-4c1e-7aa0-9f00-0000000000c7',
    item_name: 'UltraTech Cement',
    variant: '50 kg',
    category: 'Cement',
    unit: 'bag',
    quantity: 20,
    approved_quantity: 0,
    issued: 0,
    remaining: 20,
    available: 40,
    shortage: 0,
    ordered: 0,
    received: 0,
    on_order: 0,
    to_procure: 0,
  }],
  ...overrides,
})

/** One product a Store Manager can buy (GET /store-manager/buy/products). */
export const aSupplierProduct = (overrides = {}) => ({
  id: '0190a8b2-4c1e-7aa0-9f00-0000000000f6',
  name: 'UltraTech Cement',
  brand: 'UltraTech',
  category: 'Cement',
  subcategory: 'OPC',
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
  available_quantity: 500,
  low_stock_threshold: 10,
  stock_status: 'IN_STOCK',
  stock_state: 'IN_STOCK',
  is_published: true,
  image_url: null,
  product_type: 'MATERIAL',
  master_product_id: null,
  master_variant_id: null,
  supplier_id: SUPPLIER_ID,
  supplier_name: 'Lakshmi Traders',
  store_name: 'Lakshmi Traders',
  created_at: '2026-11-01T10:00:00+05:30',
  ...overrides,
})
