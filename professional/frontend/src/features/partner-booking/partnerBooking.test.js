import { waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { createAppStore } from '../../app/store.js'
import { anAccount, installFakeServer } from '../../test/fakeServer.js'
import { HANDOFF_READY, HANDOFF_TOKEN, canBookPartner, openPartnerBooking } from './partnerBooking.js'

const PARTNER = 'http://partner.test'
const OWNER = anAccount({ role: 'OWNER' })

function fakePartnerWindow() {
  return { closed: false, focus: vi.fn(), postMessage: vi.fn() }
}

function messageFrom(source, origin, data) {
  window.dispatchEvent(new MessageEvent('message', { source, origin, data }))
}

describe('Book Technician hand-off', () => {
  it('is offered to House Owners and Site Engineers only (handoff:create)', () => {
    expect(canBookPartner(OWNER)).toBe(true)
    expect(canBookPartner(anAccount({ role: 'ENGINEER', engineer_profile: { specialization: 'Site Engineer' } }))).toBe(true)
    expect(canBookPartner(anAccount({ role: 'ENGINEER', engineer_profile: { specialization: 'Structural Engineer' } }))).toBe(false)
    expect(canBookPartner(anAccount({ role: 'BUILDER' }))).toBe(false)
    expect(canBookPartner(null)).toBe(false)
    expect(openPartnerBooking(null, anAccount({ role: 'SUPPLIER' }))).toBe(false)
  })

  it('opens the trade page and answers only that window, from Partner, with the unchanged message names', async () => {
    createAppStore()
    const server = installFakeServer({ 'POST /auth/partner-handoff': { data: { handoff_token: 'one-time', expires_in_seconds: 60 } } })
    const partnerWindow = fakePartnerWindow()
    const open = vi.spyOn(window, 'open').mockReturnValue(partnerWindow)
    expect(openPartnerBooking('plumber', OWNER)).toBe(true)
    expect(open).toHaveBeenCalledWith(`${PARTNER}/book-technician/plumber`, 'crewnbuild-partner-booking')

    messageFrom(fakePartnerWindow(), PARTNER, { type: HANDOFF_READY }) // another window
    messageFrom(partnerWindow, 'http://evil.test', { type: HANDOFF_READY }) // another origin
    messageFrom(partnerWindow, PARTNER, { type: 'SOMETHING_ELSE' })
    expect(server.calls('POST /auth/partner-handoff')).toHaveLength(0)

    messageFrom(partnerWindow, PARTNER, { type: HANDOFF_READY })
    await waitFor(() => expect(partnerWindow.postMessage).toHaveBeenCalledTimes(1))
    expect(partnerWindow.postMessage).toHaveBeenCalledWith({ type: HANDOFF_TOKEN, handoffToken: 'one-time' }, PARTNER)
    expect(HANDOFF_READY).toBe('PARTNER_BOOKING_READY')
    expect(HANDOFF_TOKEN).toBe('OCTABUILD_HOUSE_OWNER_HANDOFF')

    // One token per window: asking again gets nothing.
    messageFrom(partnerWindow, PARTNER, { type: HANDOFF_READY })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(server.calls('POST /auth/partner-handoff')).toHaveLength(1)
    open.mockRestore()
  })
})
