/**
 * Builder > My Partners > My Suppliers: each supplier card says how many of the
 * builder's projects the supplier is on, which ones, and offers Assign Project only
 * while a project is left -- the same projects the Assign drawer leaves out.
 */
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { installFakeServer } from '../../test/fakeServer.js'
import { renderApp, signedInAs } from '../../test/renderApp.jsx'
import { BUILDER, builderDashboardServer } from './builderTestData.js'

const FIND = { timeout: 15000 }
const SUPPLIER_ID = '0190a8b2-4c1e-7aa0-9f00-0000000000f5'
const project = (n, title) => ({ id: `0190a8b2-4c1e-7aa0-9f00-00000000a00${n}`, title, status: 'active', pincode: '560001', budget: 0 })
const PROJECTS = [project(1, 'Vasudeva Sarvam Idam'), project(2, 'Lake View Villa'), project(3, 'Rao Family Home')]

const aSupplier = (onProjects) => ({
  id: SUPPLIER_ID,
  user_id: SUPPLIER_ID,
  name: 'Indra',
  store_name: 'Indra Steel & Cement',
  supplier_category: 'Material Supplier',
  categories: ['Cement'],
  pincode: '560002',
  address: '12 Market Road, Bengaluru',
  rating: 4,
  assigned_projects: onProjects.map((item) => ({ project_id: item.id, project_title: item.title })),
})

function routes(onProjects) {
  const perProject = Object.fromEntries(
    PROJECTS.flatMap((item) => [
      [`GET /projects/${item.id}/engineer`, { data: { engineer: null } }],
      [
        `GET /projects/${item.id}/suppliers`,
        { data: onProjects.includes(item) ? [{ user_id: SUPPLIER_ID, name: 'Indra' }] : [] },
      ],
    ]),
  )
  return builderDashboardServer({
    'GET /owners/projects': { data: PROJECTS },
    'GET /contractors/my-suppliers': { data: [aSupplier(onProjects)] },
    ...perProject,
  })
}

async function openMySuppliers(onProjects, { list = false } = {}) {
  const user = userEvent.setup()
  installFakeServer(routes(onProjects))
  renderApp('/contractor/my-site-engineers', { auth: signedInAs(BUILDER) })
  await user.click(await screen.findByRole('button', { name: /My Suppliers/ }, FIND))
  if (list) await user.click(await screen.findByRole('button', { name: /List/ }, FIND))
  const name = await screen.findByText('Indra Steel & Cement', {}, FIND)
  return { user, card: name.closest('article, tr') }
}

describe('My Suppliers: how many projects a supplier is on', () => {
  it('on none: Assign Project, and no count', async () => {
    const { card } = await openMySuppliers([])
    expect(within(card).getByRole('button', { name: /Assign Project/ })).toBeEnabled()
    expect(within(card).queryByTestId('supplier-coverage')).not.toBeInTheDocument()
    expect(within(card).queryByRole('button', { name: /Unassign/ })).not.toBeInTheDocument()
  })

  it('on some: "Assigned to N of M projects", which ones, and Assign Project for the rest', async () => {
    const { card } = await openMySuppliers([PROJECTS[0]])
    const coverage = await within(card).findByTestId('supplier-coverage', {}, FIND)
    expect(coverage).toHaveTextContent('Assigned to 1 of 3 projects')
    expect(coverage).toHaveTextContent('Vasudeva Sarvam Idam')
    expect(within(card).getByRole('button', { name: /Assign Project/ })).toBeEnabled()
    expect(within(card).getByRole('button', { name: /Unassign/ })).toBeInTheDocument()
  })

  it('on all: a disabled "Assigned to all projects" instead of Assign Project', async () => {
    const { card } = await openMySuppliers(PROJECTS)
    const coverage = await within(card).findByTestId('supplier-coverage', {}, FIND)
    expect(coverage).toHaveTextContent('Assigned to all projects')
    expect(coverage).toHaveTextContent('Vasudeva Sarvam Idam, Lake View Villa, Rao Family Home')
    expect(within(card).getByRole('button', { name: /Assigned to all projects/ })).toBeDisabled()
    expect(within(card).queryByRole('button', { name: /Assign Project/ })).not.toBeInTheDocument()
    // Unassign stays: taking the supplier off a project is still possible.
    expect(within(card).getByRole('button', { name: /Unassign/ })).toBeEnabled()
  })

  it('in the list view: the Projects column reads N / M, and the same buttons', async () => {
    const { card } = await openMySuppliers([PROJECTS[0], PROJECTS[1]], { list: true })
    expect(card.tagName).toBe('TR')
    expect(await within(card).findByTestId('supplier-coverage', {}, FIND)).toHaveTextContent('2 / 3')
    expect(within(card).getByRole('button', { name: /Assign Project/ })).toBeEnabled()
  })
})
