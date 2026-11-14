import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { aSession, installFakeServer } from '../../test/fakeServer.js'
import { renderApp, technicianSignedIn } from '../../test/renderApp.jsx'
import { AVAILABLE, FIND, JOB_ID, aJob, anOffer, execution, openDashboard, summary, withDeviceStandIns } from '../../test/technicianDashboard.js'

withDeviceStandIns()

// ---- the job itself: checklist, notes and the work bill (IN_PROGRESS) ----

const STEPS = [
  { id: 'step-1', title: 'Turn off the water supply', completed: false },
  { id: 'step-2', title: 'Replace the pipe joint', completed: false },
]
const inProgress = (overrides = {}) => ({ ...execution('IN_PROGRESS'), steps: STEPS, steps_total: 2, steps_completed: 0, ...overrides })
const aBill = (overrides = {}) => ({
  booking_id: JOB_ID, booking_status: 'IN_PROGRESS', status: null, currency: 'INR', service_price: '499.00', materials: [], labour: [],
  materials_total: '0.00', additional_labour_total: '0.00', bill_total: '499.00', notes: null, attachments: [], finalized_at: null, updated_at: null,
  can_edit: true, can_submit: false, limits: { items: 50, material_photos: 3, attachments: 6 }, ...overrides,
})
const working = (extra = {}) => ({
  'GET /technicians/me/dashboard': { data: summary({ active_jobs: 1 }) },
  'GET /technicians/me/jobs': (request) => ({ data: request.params?.bucket === 'active' ? [aJob('IN_PROGRESS')] : [] }),
  [`GET /technicians/me/jobs/${JOB_ID}/execution`]: { data: inProgress() },
  [`GET /technicians/me/jobs/${JOB_ID}/bill`]: { data: aBill() },
  ...extra,
})

async function openActiveJob(user, extra) {
  const opened = openDashboard(AVAILABLE, working(extra))
  await user.click(await screen.findByRole('button', { name: /Active Jobs/ }, FIND))
  await screen.findByTestId('job-card', {}, FIND)
  return opened
}

describe('the job checklist and service notes', () => {
  it('ticks a step on the server and shows the answer the server gives', async () => {
    const user = userEvent.setup()
    const { server } = await openActiveJob(user, {
      [`PATCH /technicians/me/jobs/${JOB_ID}/steps/step-1`]: {
        data: inProgress({ steps: [{ ...STEPS[0], completed: true }, STEPS[1]], steps_completed: 1 }),
      },
    })
    const steps = await screen.findAllByTestId('job-step', {}, FIND)
    expect(steps[0]).toHaveAttribute('aria-checked', 'false')
    await user.click(steps[0])
    await waitFor(() => expect(screen.getAllByTestId('job-step')[0]).toHaveAttribute('aria-checked', 'true'))
    expect(JSON.parse(server.calls(`PATCH /technicians/me/jobs/${JOB_ID}/steps/step-1`)[0].data)).toEqual({ completed: true })
    expect(screen.getByTestId('steps-progress')).toHaveTextContent('1 of 2 completed')
  })

  it('saves the service notes trimmed, once', async () => {
    const user = userEvent.setup()
    const { server } = await openActiveJob(user, {
      [`PUT /technicians/me/jobs/${JOB_ID}/notes`]: (request) => ({ data: inProgress({ service_notes: JSON.parse(request.data).notes }) }),
    })
    await user.type(await screen.findByTestId('notes-input', {}, FIND), '  Joint replaced; no leak after 10 minutes.  ')
    await user.click(screen.getByTestId('save-notes'))
    await waitFor(() => expect(server.calls(`PUT /technicians/me/jobs/${JOB_ID}/notes`)).toHaveLength(1))
    expect(JSON.parse(server.calls(`PUT /technicians/me/jobs/${JOB_ID}/notes`)[0].data)).toEqual({ notes: 'Joint replaced; no leak after 10 minutes.' })
    expect(await screen.findByText('Service notes saved.')).toBeInTheDocument()
  })
})

describe('the work bill', () => {
  it('adds a material line, shows the totals the server works out, and submits only after confirming', async () => {
    const user = userEvent.setup()
    const line = { id: 'item-1', kind: 'MATERIAL', name: 'PVC joint', quantity: '2', unit: 'pcs', unit_price: '60.00', amount: '120.00', description: null, work_date: null, photos: [] }
    const withLine = aBill({ status: 'DRAFT', materials: [line], materials_total: '120.00', bill_total: '619.00', can_submit: true })
    const { server } = await openActiveJob(user, {
      [`POST /technicians/me/jobs/${JOB_ID}/bill/items`]: { status: 201, data: withLine },
      [`POST /technicians/me/jobs/${JOB_ID}/bill/submit`]: {
        data: { ...withLine, status: 'FINALIZED', finalized_at: '2026-11-14T11:00:00', can_edit: false, can_submit: false },
      },
    })
    await user.click(await screen.findByTestId('bill-add-MATERIAL', {}, FIND))
    const form = screen.getByTestId('bill-form-MATERIAL')
    await user.type(within(form).getByTestId('bill-item-name'), 'PVC joint')
    // The form starts with a quantity and unit filled in.
    await user.clear(within(form).getByTestId('bill-item-quantity'))
    await user.type(within(form).getByTestId('bill-item-quantity'), '2')
    await user.clear(within(form).getByTestId('bill-item-unit'))
    await user.type(within(form).getByTestId('bill-item-unit'), 'pcs')
    await user.type(within(form).getByTestId('bill-item-price'), '60')
    await user.click(within(form).getByTestId('bill-item-save'))
    await waitFor(() => expect(server.calls(`POST /technicians/me/jobs/${JOB_ID}/bill/items`)).toHaveLength(1))
    expect(JSON.parse(server.calls(`POST /technicians/me/jobs/${JOB_ID}/bill/items`)[0].data)).toEqual({
      kind: 'MATERIAL', name: 'PVC joint', quantity: '2', unit: 'pcs', unit_price: '60', description: null, work_date: null,
    })
    expect(await screen.findByTestId('bill-line-name')).toHaveTextContent('PVC joint')
    expect(screen.getByTestId('bill-total')).toHaveTextContent('₹619')

    await user.click(screen.getByTestId('bill-submit'))
    expect(server.calls(`POST /technicians/me/jobs/${JOB_ID}/bill/submit`)).toHaveLength(0)
    await user.click(screen.getByTestId('bill-submit-yes'))
    await waitFor(() => expect(screen.getByTestId('work-bill')).toHaveAttribute('data-bill-status', 'FINALIZED'))
    expect(server.calls(`POST /technicians/me/jobs/${JOB_ID}/bill/submit`)).toHaveLength(1)
    expect(screen.queryByTestId('bill-line-edit')).not.toBeInTheDocument()
  })

  it('removes a line only after confirming', async () => {
    const user = userEvent.setup()
    const line = { id: 'item-1', kind: 'LABOUR', name: 'Extra hour', quantity: '1', unit: 'hour', unit_price: '200.00', amount: '200.00', description: null, work_date: '2026-11-14', photos: [] }
    const { server } = await openActiveJob(user, {
      [`GET /technicians/me/jobs/${JOB_ID}/bill`]: { data: aBill({ status: 'DRAFT', labour: [line], additional_labour_total: '200.00', bill_total: '699.00', can_submit: true }) },
      [`DELETE /technicians/me/jobs/${JOB_ID}/bill/items/item-1`]: { data: aBill({ status: 'DRAFT' }) },
    })
    await user.click(await screen.findByTestId('bill-line-remove', {}, FIND))
    expect(server.calls(`DELETE /technicians/me/jobs/${JOB_ID}/bill/items/item-1`)).toHaveLength(0)
    await user.click(screen.getByTestId('bill-line-confirm-remove'))
    await waitFor(() => expect(screen.queryByTestId('bill-line')).not.toBeInTheDocument())
    expect(server.calls(`DELETE /technicians/me/jobs/${JOB_ID}/bill/items/item-1`)).toHaveLength(1)
  })
})

// ---- profile: work preferences and password ----

async function openProfile(user, extra = {}) {
  const opened = openDashboard(AVAILABLE, {
    'GET /technicians/me/bank-account': { status: 404, data: { detail: 'No bank account' } },
    'GET /technicians/me/catalog': {
      data: [
        { id: 's1', service_name: 'Pipe Leakage Repair', slug: 'pipe-leakage-repair', trade: 'PLUMBER' },
        { id: 's2', service_name: 'Tap Repair', slug: 'tap-repair', trade: 'PLUMBER' },
      ],
    },
    'GET /technicians/me/work-preferences': { data: { offers_all_services: true, service_ids: [], service_radius_km: 10, working_schedule_enabled: false, working_days: [] } },
    ...extra,
  })
  await user.click(within(await screen.findByRole('navigation', { name: 'Dashboard sections' }, FIND)).getByRole('button', { name: /Profile/ }))
  return opened
}

describe('work preferences', () => {
  it('saves the services ticked and the radius chosen as one replacement', async () => {
    const user = userEvent.setup()
    const { server } = await openProfile(user, {
      'PUT /technicians/me/work-preferences': (request) => ({ data: JSON.parse(request.data) }),
    })
    const options = await screen.findAllByTestId('service-option', {}, FIND)
    await user.click(options[1])
    await user.selectOptions(screen.getByTestId('radius-select'), '5')
    await user.click(screen.getByTestId('work-preferences-save'))
    await waitFor(() => expect(server.calls('PUT /technicians/me/work-preferences')).toHaveLength(1))
    expect(JSON.parse(server.calls('PUT /technicians/me/work-preferences')[0].data)).toMatchObject({
      offers_all_services: false, service_ids: ['s1'], service_radius_km: 5, working_schedule_enabled: false,
    })
    expect(await screen.findByText(/Work preferences saved/)).toBeInTheDocument()
  })

  it('refuses to save with no service ticked, without asking the server', async () => {
    const user = userEvent.setup()
    const { server } = await openProfile(user)
    for (const option of await screen.findAllByTestId('service-option', {}, FIND)) await user.click(option)
    await user.click(screen.getByTestId('work-preferences-save'))
    expect(await screen.findByText('Select at least one service you provide.')).toBeInTheDocument()
    expect(server.calls('PUT /technicians/me/work-preferences')).toHaveLength(0)
  })
})

describe('change password', () => {
  const fill = async (user, current, next, confirm = next) => {
    await user.type(await screen.findByTestId('password-currentPassword', {}, FIND), current)
    await user.type(screen.getByTestId('password-newPassword'), next)
    await user.type(screen.getByTestId('password-confirmPassword'), confirm)
    await user.click(screen.getByTestId('change-password-submit'))
  }

  it('sends the current and new password once in the body, then clears the form', async () => {
    const user = userEvent.setup()
    const { server } = await openProfile(user, { 'PUT /technicians/me/password': { data: { message: 'Your password has been changed.' } } })
    await fill(user, 'Old!Passw0rd', 'N3w!Password1')
    await waitFor(() => expect(server.calls('PUT /technicians/me/password')).toHaveLength(1))
    expect(JSON.parse(server.calls('PUT /technicians/me/password')[0].data)).toEqual({
      current_password: 'Old!Passw0rd', new_password: 'N3w!Password1', confirm_new_password: 'N3w!Password1',
    })
    expect(await screen.findByText('Your password has been changed.')).toBeInTheDocument()
    for (const name of ['currentPassword', 'newPassword', 'confirmPassword']) expect(screen.getByTestId(`password-${name}`)).toHaveValue('')
    expect(localStorage.length + sessionStorage.length).toBe(0)
  })

  it('says why when the current password is wrong, and forgets what was typed for it', async () => {
    const user = userEvent.setup()
    await openProfile(user, { 'PUT /technicians/me/password': { status: 400, data: { detail: 'Your current password is not right.' } } })
    await fill(user, 'Wrong!Passw0rd', 'N3w!Password1')
    expect(await screen.findByText('Your current password is not right.')).toBeInTheDocument()
    expect(screen.getByTestId('password-currentPassword')).toHaveValue('')
  })

  it('checks the new password before sending anything', async () => {
    const user = userEvent.setup()
    const { server } = await openProfile(user)
    await fill(user, 'Old!Passw0rd', 'N3w!Password1', 'N3w!Password2')
    expect(screen.getByTestId('password-confirmPassword')).toHaveAttribute('aria-invalid', 'true')
    expect(server.calls('PUT /technicians/me/password')).toHaveLength(0)
  })
})

// ---- the weather page ----

const WEATHER = {
  location_required: false,
  job_location_available: true,
  location: { source: 'JOB', name: 'MG Road, Bengaluru', latitude: 12.97, longitude: 77.59 },
  status: { available: true, stale: false, message: null, last_updated_at: null },
  current: {
    observed_at: '2026-11-14T10:00:00+05:30', condition: 'RAIN', is_day: true, temperature_c: 24, feels_like_c: 26, humidity_pct: 80,
    wind_speed_kmh: 12, wind_gust_kmh: null, precipitation_probability_pct: 70, precipitation_mm: 1.2,
  },
  hourly: [{ time: '2026-11-14T11:00:00+05:30', condition: 'RAIN', temperature_c: 23, precipitation_probability_pct: 65, precipitation_mm: 0.5 }],
  daily: [],
  alerts: [
    { event_key: 'a-1', severity: 'WARNING', alert_type: 'RAIN', title: 'Heavy rain expected', message: 'Carry rain gear.', recommendations: ['Cover your tools'], expected_start: null },
    { event_key: 'a-2', severity: 'INFO', alert_type: 'RAIN', title: 'Light drizzle', message: 'Nothing to do.', recommendations: [] },
  ],
}

describe('the weather page', () => {
  it("shows the job location's current weather, the next hours and the alerts worth showing", async () => {
    installFakeServer({ 'GET /auth/me': { data: aSession(AVAILABLE) }, 'GET /technicians/me/weather': { data: WEATHER } })
    renderApp('/weather', { auth: technicianSignedIn(AVAILABLE) })
    expect(await screen.findByText('MG Road, Bengaluru', {}, FIND)).toBeInTheDocument()
    expect(screen.getByText('Current job location')).toBeInTheDocument()
    const now = screen.getByRole('region', { name: 'Current weather' })
    expect(now).toHaveTextContent('24°C')
    expect(now).toHaveTextContent('80%')
    expect(screen.getByRole('region', { name: 'Next 24 hours' })).toHaveTextContent('11:00')
    const alerts = screen.getByRole('region', { name: 'Weather alerts' })
    expect(within(alerts).getByText('Heavy rain expected')).toBeInTheDocument()
    expect(within(alerts).getByText('Cover your tools')).toBeInTheDocument()
    // INFO is not worth interrupting anyone for.
    expect(within(alerts).queryByText('Light drizzle')).not.toBeInTheDocument()
  })

  it('without a job location, asks where to show the weather', async () => {
    const server = installFakeServer({
      'GET /auth/me': { data: aSession(AVAILABLE) },
      'GET /technicians/me/weather': {
        data: { location_required: true, job_location_available: false, location: null, status: { available: false, message: 'Choose a location to see its weather.' }, current: null, hourly: [], daily: [], alerts: [] },
      },
    })
    renderApp('/weather', { auth: technicianSignedIn(AVAILABLE) })
    expect(await screen.findByText(/No job location yet/, {}, FIND)).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Current weather' })).not.toBeInTheDocument()
    expect(server.calls('GET /technicians/me/weather')).toHaveLength(1)
  })
})

// ---- the new-request sound ----

function installAudio({ allowed }) {
  const played = { notes: 0 }
  class FakeAudioContext {
    constructor() {
      this.state = 'suspended'
      this.currentTime = 0
      this.destination = {}
    }
    resume() {
      // A browser holding audio back leaves resume() waiting; the context stays suspended.
      if (!FakeAudioContext.allowed) return new Promise(() => {})
      this.state = 'running'
      this.onstatechange?.()
      return Promise.resolve()
    }
    createOscillator() {
      played.notes += 1
      return { type: '', frequency: { setValueAtTime() {} }, connect: (node) => node, start() {}, stop() {} }
    }
    createGain() {
      return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect: () => ({}) }
    }
  }
  FakeAudioContext.allowed = allowed
  window.AudioContext = FakeAudioContext
  return { played, allow: () => { FakeAudioContext.allowed = true } }
}

describe('the new job request sound', () => {
  it('says when the browser cannot play sound at all', async () => {
    openDashboard(AVAILABLE)
    expect(await screen.findByText('Sound unavailable in this browser', {}, FIND)).toBeInTheDocument()
  })

  it('offers Enable sound while the browser holds it back, and rings for a waiting request once allowed', async () => {
    const user = userEvent.setup()
    const audio = installAudio({ allowed: false })
    openDashboard(AVAILABLE, { 'GET /technicians/me/offers': { data: [anOffer()] } })
    await screen.findByTestId('offer-card', {}, FIND)
    const enable = await screen.findByRole('button', { name: /Enable sound for new job requests/ }, FIND)
    const beforeTap = audio.played.notes
    audio.allow()
    await user.click(enable)
    expect(await screen.findByText('Sound enabled', {}, FIND)).toBeInTheDocument()
    // The alert keeps ringing for the waiting request, now audibly.
    await waitFor(() => expect(audio.played.notes).toBeGreaterThan(beforeTap), { timeout: 4000 })
  })

  it('stays silent with no request waiting', async () => {
    const audio = installAudio({ allowed: true })
    openDashboard(AVAILABLE)
    expect(await screen.findByText('Sound enabled', {}, FIND)).toBeInTheDocument()
    expect(audio.played.notes).toBe(0)
  })
})
