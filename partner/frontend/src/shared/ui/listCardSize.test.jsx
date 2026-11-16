/**
 * Every list card is the same size: cards of different kinds (a project with progress, a
 * request with rows and actions, a bare record, a tile with a picture) all carry the one
 * fixed-height class, the same slots in the same order, and a footer pinned to the bottom.
 */
import { readFileSync } from 'node:fs'
import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { CardChip, CardStatus, ListCard, cardButtonClass } from './ListCard.jsx'

const HEIGHT = 'h-[var(--list-card-height)]'
const KINDS = {
  project: (
    <ListCard
      title="Rao Family Home"
      subtitle="12 MG Road 560001"
      status={<CardStatus status="active">Active</CardStatus>}
      chips={[<CardChip key="a" tone="blue">1800 sq.ft</CardChip>]}
      rows={[{ key: 's', label: 'Start', value: '1 Nov' }]}
      progress={{ label: 'Progress: 40%', amount: '₹45,00,000', percent: 40 }}
      meta={{ text: 'Schedule: on time' }}
    />
  ),
  request: (
    <ListCard
      title={'A builder with a very long name '.repeat(6)}
      subtitle={'A long address '.repeat(12)}
      rows={[1, 2, 3, 4, 5, 6].map((n) => ({ key: n, label: `Row ${n}`, value: 'x'.repeat(200) }))}
      secondary={<button type="button" className={cardButtonClass('danger')}>Reject</button>}
      primary={<button type="button" className={cardButtonClass('primary')}>Accept</button>}
    />
  ),
  bare: <ListCard title="Supplier" />,
  tile: (
    <ListCard title="Cement 50 kg">
      <img src="/cement.png" alt="" className="h-14 w-full object-cover" />
    </ListCard>
  ),
}

const shape = (card) => ({
  height: card.classList.contains(HEIGHT),
  parts: [...card.children].map((part) => part.getAttribute('data-card-part')),
  slots: [...card.querySelector('[data-card-part="body"]').children].map((slot) => slot.getAttribute('data-card-slot')),
})

describe('list card size', () => {
  it('renders every kind of card with the same fixed height and the same slots', () => {
    const shapes = Object.entries(KINDS).map(([kind, element]) => {
      const { container, unmount } = render(element)
      const result = { kind, ...shape(container.querySelector('[data-card="list"]')) }
      unmount()
      return result
    })
    shapes.forEach((result) => {
      expect(result).toEqual({ kind: result.kind, height: true, parts: ['header', 'body', 'footer'], slots: ['chips', 'details', 'progress'] })
    })
  })

  it('never shows more than four detail rows, and keeps long text to one line with a tooltip', () => {
    const { container } = render(KINDS.request)
    expect(container.querySelectorAll('dt')).toHaveLength(4)
    const title = container.querySelector('h3')
    expect(title).toHaveClass('truncate')
    expect(title).toHaveAttribute('title', expect.stringContaining('A builder with a very long name'))
    expect(container.querySelector('[data-card-part="header"] p')).toHaveClass('truncate')
  })

  it('takes its height from one shared variable', () => {
    const css = readFileSync(`${process.cwd()}/src/index.css`, 'utf8')
    expect(css).toMatch(/--list-card-height:\s*\d+px/)
  })
})
