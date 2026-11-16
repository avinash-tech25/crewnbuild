/**
 * Every "View details" window in the application shares one frame: the size class of the
 * House Owner's request details window (90vw up to 1280px, at most 85vh, at least 60vh),
 * its header (small label, title, status line) and a body that scrolls inside the window.
 */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { installFakeServer } from '../../test/fakeServer.js'
import { renderApp, signedInAs } from '../../test/renderApp.jsx'
import { DETAIL_DIALOG_SIZE, DetailDialog, DetailSection } from './DetailDialog.jsx'
import { LanguageProvider } from '../../i18n/LanguageContext.jsx'
import { OWNER, PROJECT_ID, aProject, ownerDashboardServer } from '../../features/owner/ownerTestData.js'
import { STORE_MANAGER, STORE_REQUEST_ID, aSiteRequest, storeDashboardServer } from '../../features/engineer/engineerTestData.js'
import { USER_ID, aUserRow, adminServer, anAdminAccount, anIdentity } from '../../features/admin/adminTestData.js'

const FIND = { timeout: 15000 }
const SIZE = DETAIL_DIALOG_SIZE.split(' ')

const expectSharedFrame = (dialog) => {
  expect(dialog).toHaveAttribute('data-detail-dialog')
  SIZE.forEach((name) => expect(dialog).toHaveClass(name))
  expect(dialog.querySelector('[data-detail-dialog-body]')).toHaveClass('overflow-y-auto')
}

describe('details windows', () => {
  it('the shared frame: one size class, the header lines, a body that scrolls inside', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(
      <LanguageProvider>
        <DetailDialog label="Request details" title="Rao Family Home" status={<span>Pending</span>} onClose={onClose}>
          <DetailSection title="Who">Asha</DetailSection>
          <DetailSection title="Reply"><textarea aria-label="Reply" /></DetailSection>
        </DetailDialog>
      </LanguageProvider>,
    )
    const dialog = screen.getByRole('dialog', { name: 'Rao Family Home' })
    expectSharedFrame(dialog)
    expect(dialog).toHaveTextContent('Request details')
    expect(dialog).toHaveTextContent('Pending')
    // Escape while typing a reply keeps the window (and the text) open.
    await user.type(screen.getByLabelText('Reply'), 'Half a reply')
    await user.keyboard('{Escape}')
    expect(onClose).not.toHaveBeenCalled()
    await user.click(dialog.querySelector('h3'))
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalled()
  })

  it("the House Owner's request details window uses it", async () => {
    const user = userEvent.setup()
    installFakeServer(ownerDashboardServer({
      'GET /owners/projects': { data: [aProject()] },
      'GET /project-requests/incoming': {
        data: [{
          id: '0190a8b2-4c1e-7aa0-9f00-00000000c0f1', project_id: PROJECT_ID, project_title: 'Rao Family Home',
          sender_id: OWNER.id, receiver_id: '0190a8b2-4c1e-7aa0-9f00-0000000000f5', sender_name: 'Indra', sender_role: 'SUPPLIER',
          profile_role: 'SUPPLIER', profile_name: 'Indra', profile_title: 'Indra Steel & Cement', profile_pincode: '560002',
          profile_rating: 0, profile_phone: '', profile_email: '', can_view_contact: false, request_type: 'OWNER_TO_SUPPLIER',
          status: 'pending', is_sender: true, created_at: '2026-11-14T16:00:00+05:30',
        }],
      },
      [`GET /projects/${PROJECT_ID}/award`]: { data: { award: null } },
      [`GET /projects/${PROJECT_ID}/photos`]: { data: [] },
      'GET /contractors/nearby': { data: [] },
    }))
    renderApp(`/owner/projects/${PROJECT_ID}/requests`, { auth: signedInAs(OWNER) })
    await screen.findByText('Indra Steel & Cement', {}, FIND)
    await user.click(screen.getByRole('button', { name: /View/ }))
    expectSharedFrame(await screen.findByRole('dialog', {}, FIND))
  })

  it("an administrator's account details window uses it", async () => {
    installFakeServer(adminServer(anIdentity('global'), {
      'GET /admin/users': { data: { users: [aUserRow()], total: 1 } },
      [`GET /admin/users/${USER_ID}`]: { data: { ...aUserRow(), verification: null } },
    }))
    renderApp(`/admin/users/${USER_ID}`, { auth: signedInAs(anAdminAccount('global')) })
    expectSharedFrame(await screen.findByRole('dialog', {}, FIND))
  })

  it("the Store Manager's request details window uses it", async () => {
    installFakeServer(storeDashboardServer({ 'GET /store-manager/requests': { data: [aSiteRequest()] } }))
    renderApp(`/store-manager/requests?request=${STORE_REQUEST_ID}`, { auth: signedInAs(STORE_MANAGER) })
    expectSharedFrame(await screen.findByRole('dialog', {}, FIND))
  })
})
