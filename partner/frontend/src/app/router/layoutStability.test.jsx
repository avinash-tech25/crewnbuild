/**
 * Layout-shift guard for the technician dashboard.
 *
 * jsdom has no layout engine: nothing here measures a box, a width or a shift, and
 * Tailwind's CSS is not loaded. What it can check is the structure that keeps the real
 * layout still -- the frame survives a section change as the same DOM nodes with the
 * same classes, the page column uses the shared max-w-page width, a loading list holds
 * its place with a skeleton instead of collapsing to a spinner, and tab badges keep a
 * slot at 0 so a count arriving never moves the tabs beside it.
 */
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { AVAILABLE, FIND, aJob, openDashboard, summary, withDeviceStandIns } from '../../test/technicianDashboard.js'

withDeviceStandIns()

function held() {
  let release
  const gate = new Promise((resolve) => { release = resolve })
  return { gate, release: () => release() }
}

describe('technician dashboard layout stability', () => {
  it('keeps the nav and page column as the same nodes, with the same classes, across sections', async () => {
    const user = userEvent.setup()
    const { container } = openDashboard(AVAILABLE)
    const nav = await screen.findByRole('navigation', { name: 'Dashboard sections' }, FIND)
    const main = container.querySelector('main')
    const navClass = nav.className
    const mainClass = main.className
    expect(mainClass).toContain('max-w-page')
    expect(mainClass).not.toMatch(/max-w-\[/)
    // The header row uses the same column as the page below it.
    expect(container.querySelector('header > div').className).toContain('max-w-page')

    for (const label of [/Accepted Jobs/, /Completed Jobs/, /Earnings/, /Profile/, /New Requests/]) {
      await user.click(within(nav).getByRole('link', { name: label }))
      expect(within(nav).getByRole('link', { name: label })).toHaveAttribute('aria-current', 'page')
      expect(screen.getByRole('navigation', { name: 'Dashboard sections' })).toBe(nav)
      expect(container.querySelector('main')).toBe(main)
      expect(nav.className).toBe(navClass)
      expect(main.className).toBe(mainClass)
    }
    // Only one section is marked current at a time.
    expect(nav.querySelectorAll('[aria-current="page"]')).toHaveLength(1)
  })

  it('shows a skeleton status while a job list loads, then the list in its place', async () => {
    const user = userEvent.setup()
    const reply = held()
    openDashboard(AVAILABLE, {
      'GET /technicians/me/jobs': async (request) => {
        if (request.params?.bucket === 'accepted') await reply.gate
        return { data: request.params?.bucket === 'accepted' ? [aJob('ACCEPTED')] : [] }
      },
    })
    await user.click(await screen.findByRole('link', { name: /Accepted Jobs/ }, FIND))
    const loading = await screen.findByTestId('job-list-loading')
    expect(loading).toHaveAttribute('role', 'status')
    expect(loading).toHaveAttribute('aria-busy', 'true')
    expect(within(loading).getByText('Loading jobs')).toHaveClass('sr-only')
    const blocks = loading.querySelectorAll('[data-skeleton]')
    expect(blocks.length).toBeGreaterThan(0)
    for (const block of blocks) {
      expect(block).toHaveAttribute('aria-hidden', 'true')
      expect(block.className).toContain('animate-pulse')
    }
    reply.release()
    expect(await screen.findByTestId('job-card', {}, FIND)).toBeInTheDocument()
    expect(screen.queryByTestId('job-list-loading')).not.toBeInTheDocument()
  })

  it('keeps a fixed-width badge slot on every counted tab, hidden at 0', async () => {
    openDashboard(AVAILABLE, {
      'GET /technicians/me/dashboard': { data: summary({ accepted_jobs: 2 }) },
    })
    const nav = await screen.findByRole('navigation', { name: 'Dashboard sections' }, FIND)
    const accepted = within(nav).getByRole('link', { name: /Accepted Jobs/ })
    await waitFor(() => expect(within(accepted).getByTestId('tab-badge')).toHaveTextContent('2'))

    // The five job tabs carry a slot; Earnings and Profile have no count and no slot.
    const badges = within(nav).getAllByTestId('tab-badge')
    expect(badges).toHaveLength(5)
    for (const badge of badges) {
      expect(badge.className).toContain('min-w-[1.5rem]')
      expect(badge.className).toContain('tabular-nums')
    }
    const shown = within(accepted).getByTestId('tab-badge')
    expect(shown).not.toHaveAttribute('aria-hidden')
    expect(shown.className).not.toContain('invisible')

    const empty = within(within(nav).getByRole('link', { name: /Completed Jobs/ })).getByTestId('tab-badge')
    expect(empty).toHaveAttribute('aria-hidden', 'true')
    expect(empty.className).toContain('invisible')
    // A hidden slot is not read out as part of the tab's name.
    expect(within(nav).getByRole('link', { name: /Completed Jobs/ })).toHaveAccessibleName('Completed Jobs')
  })
})
