import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { aTechnician } from '../../test/fakeServer.js'
import { location } from '../../test/renderApp.jsx'
import { AVAILABLE, FIND, JOB_ID, aJob, anOffer, execution, openDashboard, soon, summary, withDeviceStandIns } from '../../test/technicianDashboard.js'

const device = withDeviceStandIns()

describe('live location', () => {
  it('asks for the position and sends it only while the technician is available', async () => {
    const { server } = openDashboard(AVAILABLE)
    await waitFor(() => expect(server.calls('POST /technicians/me/location').length).toBeGreaterThan(0), FIND)
    const body = JSON.parse(server.calls('POST /technicians/me/location')[0].data)
    expect(body).toMatchObject({ latitude: 12.97, longitude: 77.59, accuracy: 10 })
    expect(localStorage.length + sessionStorage.length).toBe(0)
  })

  it('never asks for the position of an offline technician with no job', async () => {
    const { server } = openDashboard(aTechnician({ work_status: 'OFFLINE' }))
    expect(await screen.findByText('Welcome, Ramesh', {}, FIND)).toBeInTheDocument()
    await waitFor(() => expect(server.calls('GET /technicians/me/dashboard').length).toBeGreaterThan(0))
    expect(device.geolocation.getCurrentPosition).not.toHaveBeenCalled()
    expect(device.geolocation.watchPosition).not.toHaveBeenCalled()
    expect(server.calls('POST /technicians/me/location')).toHaveLength(0)
  })

  it('going offline stops the watcher and has the server forget the position', async () => {
    const user = userEvent.setup()
    const { server } = openDashboard(AVAILABLE, {
      'PATCH /technicians/me/availability': { data: aTechnician({ work_status: 'OFFLINE', is_available: false }) },
    })
    await waitFor(() => expect(device.geolocation.watchPosition).toHaveBeenCalled(), FIND)
    await user.click(screen.getByTestId('work-status-offline'))
    await waitFor(() => expect(device.geolocation.clearWatch).toHaveBeenCalledWith(7))
    expect(JSON.parse(server.calls('PATCH /technicians/me/availability')[0].data)).toEqual({ status: 'OFFLINE' })
  })

  it('signing out stops the location first, then ends the session', async () => {
    const user = userEvent.setup()
    const { server } = openDashboard(AVAILABLE)
    await waitFor(() => expect(device.geolocation.watchPosition).toHaveBeenCalled(), FIND)
    await user.click(screen.getByRole('button', { name: /Logout/ }))
    await waitFor(() => expect(location.current.pathname).toBe('/login'))
    expect(device.geolocation.clearWatch).toHaveBeenCalled()
    expect(server.calls('DELETE /technicians/me/location')).toHaveLength(1)
  })
})

describe('job requests', () => {
  it('shows a waiting request without any customer detail, and accepting it moves to Accepted Jobs', async () => {
    const user = userEvent.setup()
    const { server } = openDashboard(AVAILABLE, {
      'GET /technicians/me/offers': { data: [anOffer()] },
      [`POST /technicians/me/offers/${JOB_ID}/accept`]: { data: { booking_id: JOB_ID, status: 'ACCEPTED' } },
      'GET /technicians/me/jobs': (request) => ({ data: request.params?.bucket === 'accepted' ? [aJob('ACCEPTED')] : [] }),
    })
    const card = await screen.findByTestId('offer-card', {}, FIND)
    expect(within(card).getByText('Pipe Leakage Repair')).toBeInTheDocument()
    expect(within(card).getByTestId('offer-estimate')).toHaveTextContent('₹449.1')
    expect(card.textContent).not.toContain('Asha')
    expect(card.textContent).not.toContain('9000000001')
    await user.click(within(card).getByRole('button', { name: /Accept/ }))
    await waitFor(() => expect(server.calls(`POST /technicians/me/offers/${JOB_ID}/accept`)).toHaveLength(1))
    expect(await screen.findByText(/Job accepted\. The customer can see you/)).toBeInTheDocument()
    expect(await screen.findByTestId('job-card', {}, FIND)).toHaveAttribute('data-status', 'ACCEPTED')
  })

  it('declining a request removes its card', async () => {
    const user = userEvent.setup()
    const { server } = openDashboard(AVAILABLE, {
      'GET /technicians/me/offers': { data: [anOffer()] },
      [`POST /technicians/me/offers/${JOB_ID}/decline`]: { data: { booking_id: JOB_ID } },
    })
    const card = await screen.findByTestId('offer-card', {}, FIND)
    await user.click(within(card).getByRole('button', { name: /Decline|Reject/ }))
    await waitFor(() => expect(screen.queryByTestId('offer-card')).not.toBeInTheDocument())
    expect(server.calls(`POST /technicians/me/offers/${JOB_ID}/decline`)).toHaveLength(1)
  })

  it('does not load requests until the server says the technician is reachable', async () => {
    const { server } = openDashboard(AVAILABLE, {
      'GET /technicians/me/presence': { data: { ready_for_nearby_jobs: false } },
      'POST /technicians/me/location': { data: { ready_for_nearby_jobs: false, update_interval_seconds: 3 } },
      'GET /technicians/me/offers': { data: [anOffer()] },
    })
    expect(await screen.findByText('Welcome, Ramesh', {}, FIND)).toBeInTheDocument()
    await waitFor(() => expect(server.calls('POST /technicians/me/location').length).toBeGreaterThan(0))
    expect(server.calls('GET /technicians/me/offers')).toHaveLength(0)
    expect(screen.queryByTestId('offer-card')).not.toBeInTheDocument()
  })
})

describe('on site', () => {
  const onSite = (status, extra = {}) => ({
    'GET /technicians/me/dashboard': { data: summary({ active_jobs: 1 }) },
    'GET /technicians/me/jobs': (request) => ({ data: request.params?.bucket === 'active' ? [aJob(status)] : [] }),
    [`GET /technicians/me/jobs/${JOB_ID}/execution`]: { data: execution(status) },
    ...extra,
  })

  it("starts the work only with the customer's code, sent once in the body", async () => {
    const user = userEvent.setup()
    const { server } = openDashboard(AVAILABLE, onSite('ARRIVED', {
      [`POST /technicians/me/jobs/${JOB_ID}/start`]: { data: aJob('IN_PROGRESS') },
    }))
    await user.click(await screen.findByRole('button', { name: /Active Jobs/ }, FIND))
    const card = await screen.findByTestId('job-card', {}, FIND)
    await user.click(within(card).getByRole('button', { name: /Start work/i }))
    const form = await screen.findByTestId('start-otp-form')
    await user.click(within(form).getAllByTestId('start-otp-digit')[0])
    await user.paste('482913')
    await user.click(within(form).getByTestId('start-otp-submit'))
    await waitFor(() => expect(server.calls(`POST /technicians/me/jobs/${JOB_ID}/start`)).toHaveLength(1))
    const call = server.calls(`POST /technicians/me/jobs/${JOB_ID}/start`)[0]
    expect(JSON.parse(call.data)).toEqual({ otp: '482913' })
    expect(call.params).toBeUndefined()
    expect(call.headers['X-CSRF-Token']).toBe('csrf-technician')
    expect(await screen.findByText('Work started.')).toBeInTheDocument()
  })

  it("says so when the customer's code is wrong, and clears the boxes", async () => {
    const user = userEvent.setup()
    openDashboard(AVAILABLE, onSite('ARRIVED', {
      [`POST /technicians/me/jobs/${JOB_ID}/start`]: { status: 400, data: { detail: 'That code is not right.' } },
    }))
    await user.click(await screen.findByRole('button', { name: /Active Jobs/ }, FIND))
    await user.click(within(await screen.findByTestId('job-card', {}, FIND)).getByRole('button', { name: /Start work/i }))
    const form = await screen.findByTestId('start-otp-form')
    await user.click(within(form).getAllByTestId('start-otp-digit')[0])
    await user.paste('111111')
    await user.click(within(form).getByTestId('start-otp-submit'))
    expect(await screen.findByTestId('start-otp-error')).toHaveTextContent('That code is not right.')
    for (const box of within(form).getAllByTestId('start-otp-digit')) expect(box).toHaveValue('')
  })

  it('uploads a before photo in the request body and shows it from memory, never browser storage', async () => {
    const user = userEvent.setup()
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:photo-1')
    let media = []
    const { server } = openDashboard(AVAILABLE, onSite('ARRIVED', {
      [`GET /technicians/me/jobs/${JOB_ID}/execution`]: () => ({ data: execution('ARRIVED', media) }),
      [`POST /technicians/me/jobs/${JOB_ID}/media`]: () => {
        media = [{ id: 'm-1', kind: 'BEFORE', content_type: 'image/jpeg', byte_size: 10, created_at: soon(0), can_delete: true }]
        return { data: execution('ARRIVED', media) }
      },
      [`GET /technicians/me/jobs/${JOB_ID}/media/m-1/content`]: { data: new Blob(['jpeg'], { type: 'image/jpeg' }) },
    }))
    await user.click(await screen.findByRole('button', { name: /Active Jobs/ }, FIND))
    await screen.findByTestId('photos-BEFORE', {}, FIND)
    const photo = new File(['jpeg-bytes'], 'before.jpg', { type: 'image/jpeg' })
    await user.upload(screen.getByTestId('photo-input-BEFORE'), photo)
    await waitFor(() => expect(server.calls(`POST /technicians/me/jobs/${JOB_ID}/media`)).toHaveLength(1))
    const form = server.calls(`POST /technicians/me/jobs/${JOB_ID}/media`)[0].data
    expect(form).toBeInstanceOf(FormData)
    expect(form.get('kind')).toBe('BEFORE')
    expect(form.get('file')).toBeInstanceOf(File)
    expect(await screen.findByTestId('job-photo', {}, FIND)).toHaveAttribute('src', 'blob:photo-1')
    expect(createObjectURL).toHaveBeenCalled()
    // Fetched with the session cookie, not a token in the address.
    expect(server.calls(`GET /technicians/me/jobs/${JOB_ID}/media/m-1/content`)[0].principal).toBe('technician')
    expect(localStorage.length + sessionStorage.length).toBe(0)
  })
})

describe('profile', () => {
  it('shows the saved bank account only masked and sends a new number once in the body', async () => {
    const user = userEvent.setup()
    const saved = { account_holder_name: 'Ramesh Kumar', bank_name: 'State Bank of India', account_number_last4: '4321', ifsc_code: 'SBIN0001234', verification_status: 'PENDING' }
    const { server } = openDashboard(AVAILABLE, {
      'GET /technicians/me/bank-account': { data: { ...saved, account_number_last4: '9876' } },
      'PUT /technicians/me/bank-account': { data: saved },
      'GET /technicians/me/work-preferences': { data: { services: [], working_days: [], working_schedule_enabled: false } },
      'GET /technicians/me/catalog': { data: [] },
    })
    await user.click(within(await screen.findByRole('navigation', { name: 'Dashboard sections' }, FIND)).getByRole('button', { name: /Profile/ }))
    expect(await screen.findByTestId('bank-masked', {}, FIND)).toHaveTextContent('••••••9876')
    await user.click(screen.getByTestId('bank-edit'))
    expect(screen.getByTestId('bank-account_number')).toHaveValue('')
    await user.type(screen.getByTestId('bank-account_number'), '123456784321')
    await user.type(screen.getByTestId('bank-confirm_account_number'), '123456784321')
    await user.click(screen.getByTestId('bank-save'))
    await waitFor(() => expect(server.calls('PUT /technicians/me/bank-account')).toHaveLength(1))
    expect(JSON.parse(server.calls('PUT /technicians/me/bank-account')[0].data)).toMatchObject({ account_number: '123456784321', ifsc: 'SBIN0001234' })
    expect(await screen.findByTestId('bank-masked')).toHaveTextContent('••••••4321')
    expect(document.body.textContent).not.toContain('123456784321')
    expect(localStorage.length + sessionStorage.length).toBe(0)
  })
})

describe('earnings', () => {
  it("shows the server's totals and each recorded earning, without working any of it out", async () => {
    const user = userEvent.setup()
    const totals = { currency: 'INR', today_net: '449.10', week_net: '449.10', month_net: '449.10', total_net: '449.10', total_gross: '499.00', total_commission: '49.90', earnings_count: 1 }
    const row = { id: 'e-1', booking_id: JOB_ID, service_name: 'Pipe Leakage Repair', gross_amount: '499.00', commission_amount: '49.90', net_amount: '449.10', commission_rate: '10.00', currency: 'INR', earned_at: soon(-60) }
    openDashboard(AVAILABLE, {
      'GET /technicians/me/earnings/summary': { data: totals },
      'GET /technicians/me/earnings': { data: [row] },
    })
    await user.click(await screen.findByTestId('stat-today-earnings', {}, FIND))
    expect(await screen.findByTestId('earnings-total-gross', {}, FIND)).toHaveTextContent('₹499')
    expect(screen.getByTestId('earnings-total-commission')).toHaveTextContent('₹49.9')
    expect(screen.getByTestId('earnings-total-net')).toHaveTextContent('₹449.1')
    expect(within(screen.getByTestId('earning-row')).getByTestId('earning-net')).toHaveTextContent('₹449.1')
  })
})
