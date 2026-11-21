import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Skeleton, SkeletonGrid, SkeletonList, SkeletonStatus } from './Skeleton.jsx'

describe('Skeleton', () => {
  it('is a single decorative block', () => {
    const { container } = render(<Skeleton className="h-10" />)
    const block = container.firstChild
    expect(block).toHaveAttribute('aria-hidden', 'true')
    expect(block.className).toContain('animate-pulse')
    expect(block.className).toContain('h-10')
  })

  it('SkeletonList and SkeletonGrid are one busy status with a hidden label and N blocks', () => {
    render(
      <>
        <SkeletonList count={3} label="Loading jobs" testId="list" />
        <SkeletonGrid count={4} label="Loading services" testId="grid" />
      </>,
    )
    for (const [id, label, count] of [['list', 'Loading jobs', 3], ['grid', 'Loading services', 4]]) {
      const status = screen.getByTestId(id)
      expect(status).toHaveAttribute('role', 'status')
      expect(status).toHaveAttribute('aria-busy', 'true')
      expect(within(status).getByText(label)).toHaveClass('sr-only')
      expect(status.querySelectorAll('[aria-hidden="true"]')).toHaveLength(count)
    }
  })

  it('SkeletonStatus defaults its label to "Loading"', () => {
    render(<SkeletonStatus><Skeleton /></SkeletonStatus>)
    expect(within(screen.getByRole('status')).getByText('Loading')).toBeInTheDocument()
  })
})
