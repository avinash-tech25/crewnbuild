import { anAccount } from '../../test/fakeServer.js'

// Server answers for the Builder tests, shaped like the backend's.
export const BUILDER = anAccount({
  role: 'BUILDER',
  id: '0190a8b2-4c1e-7aa0-9f00-0000000000b1',
  name: 'Ravi Builders',
  email: 'ravi@example.in',
  phone: '9876500000',
})
export const OWNER_ID = '0190a8b2-4c1e-7aa0-9f00-000000000001'
export const PROJECT_ID = '0190a8b2-4c1e-7aa0-9f00-0000000000a1'
export const REQUEST_ID = '0190a8b2-4c1e-7aa0-9f00-0000000000c1'

/** One entry of GET /contractors/find-clients: an open project near the builder. */
export const anOwnerLead = (overrides = {}) => ({
  id: PROJECT_ID,
  client_type: 'PROJECT',
  owner_id: OWNER_ID,
  project_id: PROJECT_ID,
  title: 'Rao Family Home',
  owner_name: 'Asha Rao',
  owner_profile_image_url: '',
  email: '',
  phone: '',
  can_view_contact: false,
  project_title: 'Rao Family Home',
  project_description: 'Two-storey house',
  address: '12 MG Road',
  pincode: '560001',
  budget: 4500000,
  land_area: 1200,
  floors: 2,
  building_type: 'Residential',
  construction_type: 'CONTRACTOR',
  cover_image_url: null,
  created_at: '2026-11-01T10:00:00+05:30',
  start_date: null,
  end_date: null,
  ...overrides,
})

/** GET /builder/portfolio. */
export const aPortfolio = () => ({
  advanced: true,
  summary: { project_count: 1, active_projects: 1, average_completion: 40, recorded_days: 12, photo_count: 30 },
  projects: [{
    project_id: PROJECT_ID, title: 'Rao Family Home', owner_name: 'Asha Rao', status: 'active', project_country: 'India',
    completion_percentage: 40, contract_or_budget: 4200000, recorded_days: 12, adjusted_days: 0, photo_count: 30,
    last_record_date: '2026-11-13', original_spent: 0, adjusted_spent: 0, original_totals: {}, adjusted_totals: {},
  }],
})

export const anOwnerRequest = (overrides = {}) => ({
  id: REQUEST_ID,
  project_id: PROJECT_ID,
  project_title: 'Rao Family Home',
  sender_id: OWNER_ID,
  receiver_id: BUILDER.id,
  sender_name: 'Asha Rao',
  receiver_name: BUILDER.name,
  sender_role: 'OWNER',
  receiver_role: 'BUILDER',
  request_type: 'OWNER_TO_CONTRACTOR',
  status: 'pending',
  quotation_amount: null,
  message: 'Please quote for my house.',
  is_sender: false,
  budget: 4500000,
  created_at: '2026-11-02T10:00:00+05:30',
  ...overrides,
})

/** Every call the builder dashboard makes on load, answered empty unless given. */
export const builderDashboardServer = (overrides = {}) => ({
  'GET /notifications': { data: [] },
  'GET /ads': { data: [] },
  'GET /contractors/find-clients': { data: [] },
  'GET /engineers/find': { data: [] },
  'GET /project-requests/incoming': { data: [] },
  'GET /contractors/my-suppliers': { data: [] },
  'GET /owners/projects': { data: [] },
  'GET /engineers/my-team': { data: { active: [], pending_requests: [], outgoing_requests: [], invitations: [] } },
  'GET /messages/conversations': { data: [] },
  [`GET /contractors/${BUILDER.id}/profile`]: { data: { id: BUILDER.id, name: BUILDER.name, role: 'BUILDER', projects: [], reviews: [] } },
  'GET /weather/summary': { data: null },
  ...overrides,
})
