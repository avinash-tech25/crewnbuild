import { anAccount } from '../../test/fakeServer.js'

// Server answers for the House Owner tests, shaped like the backend's (UUID ids, a
// builder's role BUILDER, request types unchanged).
export const OWNER = anAccount({ role: 'OWNER', owner_profile: { construction_type: 'CONTRACTOR' } })
export const BUILDER_ID = '0190a8b2-4c1e-7aa0-9f00-0000000000b1'
export const PROJECT_ID = '0190a8b2-4c1e-7aa0-9f00-0000000000a1'
export const REQUEST_ID = '0190a8b2-4c1e-7aa0-9f00-0000000000c1'

export const aProject = (overrides = {}) => ({
  id: PROJECT_ID,
  owner_id: OWNER.id,
  owner_name: OWNER.name,
  contractor_id: null,
  title: 'Rao Family Home',
  description: 'Two-storey house',
  address: '12 MG Road',
  pincode: '560001',
  project_country: 'India',
  project_state: 'Karnataka',
  project_city: 'Bengaluru',
  building_type: 'Residential',
  construction_type: 'CONTRACTOR',
  budget: 4500000,
  land_area: 1200,
  floors: 2,
  floor_type: 'G+1',
  status: 'planning',
  compliance_status: null,
  completion_percentage: 0,
  completion_basis: 'none',
  cover_image_url: null,
  estimated_cost: null,
  estimated_duration_days: null,
  start_date: null,
  end_date: null,
  created_at: '2026-11-01T10:00:00+05:30',
  original_budget: 4500000,
  contract_amount: null,
  awarded_request_id: null,
  contract_status: 'none',
  ...overrides,
})

export const aQuotation = (overrides = {}) => ({
  id: REQUEST_ID,
  project_id: PROJECT_ID,
  project_title: 'Rao Family Home',
  sender_id: BUILDER_ID,
  receiver_id: OWNER.id,
  sender_name: 'Ravi Builders',
  receiver_name: OWNER.name,
  sender_role: 'BUILDER',
  receiver_role: 'OWNER',
  request_type: 'CONTRACTOR_TO_OWNER',
  status: 'accepted',
  quotation_amount: 4200000,
  message: 'We can start next month.',
  is_sender: false,
  created_at: '2026-11-02T10:00:00+05:30',
  ...overrides,
})

/** Every call the owner dashboard makes on load, answered empty unless given. */
export const ownerDashboardServer = (overrides = {}) => ({
  'GET /notifications': { data: [] },
  'GET /ads': { data: [] },
  'GET /shop/products': { data: [] },
  'GET /payments/technician-bookings': { data: [] },
  'GET /owners/projects': { data: [] },
  'GET /messages/conversations': { data: [] },
  'GET /cart': { data: { groups: [], item_count: 0 } },
  'GET /weather/summary': { data: null },
  'GET /project-requests/incoming': { data: [] },
  ...overrides,
})
