/**
 * Every list card is as tall as its content: cards of different kinds (a project with
 * progress, a request with rows and actions, a bare record, a tile with a picture) carry
 * no set height, no stretching part and no scrolling part, and the grid never stretches
 * them to match.
 */
import { readFileSync } from 'node:fs'
import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { CardChip, CardGrid, CardStatus, ListCard, cardButtonClass } from './ListCard.jsx'

const FORCED = /(^|\s)(h-\[|min-h-|h-full|flex-1|grow)/

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

const SCROLLING = /\boverflow(-[xy])?-(auto|scroll)\b/

const cardOf = (element) => {
  const { container } = render(element)
  return container.querySelector('[data-card="list"]')
}

describe('list card size', () => {
  it('sets no height on any kind of card: it is as tall as its content', () => {
    Object.entries(KINDS).forEach(([kind, element]) => {
      const card = cardOf(element)
      expect(card, kind).toHaveClass('w-full')
      ;[card, card.querySelector('[data-card-part="body"]')].forEach((node) => {
        expect(node.className, kind).not.toMatch(FORCED)
      })
      expect([...card.children].map((part) => part.getAttribute('data-card-part')).slice(0, 2), kind).toEqual(['header', 'body'])
    })
  })

  it('never stretches cards in a row to match: the grid aligns them to the top', () => {
    const { container } = render(<CardGrid>{[<ListCard key="a" title="A" />, <ListCard key="b" title="B" rows={[{ key: 'r', label: 'Row', value: '1' }]} />]}</CardGrid>)
    const grid = container.querySelector('[data-card-grid]')
    expect(grid).toHaveClass('items-start')
    expect(grid).not.toHaveClass('items-stretch')
    grid.querySelectorAll(':scope > li').forEach((item) => expect(item).not.toHaveClass('flex'))
  })

  it('never scrolls inside a card: no overflow auto / scroll anywhere', () => {
    Object.entries(KINDS).forEach(([kind, element]) => {
      const card = cardOf(element)
      ;[card, ...card.querySelectorAll('*')].forEach((node) => {
        expect(String(node.getAttribute('class') || ''), `${kind}: ${node.tagName}`).not.toMatch(SCROLLING)
      })
    })
  })

  it('draws a footer only for a card with actions, and no empty parts', () => {
    expect(cardOf(KINDS.request).querySelector('[data-card-part="footer"]')).not.toBeNull()
    const bare = cardOf(KINDS.bare)
    expect(bare.querySelector('[data-card-part="footer"]')).toBeNull()
    expect(bare.querySelector('[data-card-part="chips"]')).toBeNull()
    expect(bare.querySelector('[data-card-part="progress"]')).toBeNull()
  })

  it('never shows more than four detail rows, and keeps long text to one line with a tooltip', () => {
    const card = cardOf(KINDS.request)
    expect(card.querySelectorAll('dt')).toHaveLength(4)
    const title = card.querySelector('h3')
    expect(title).toHaveClass('truncate')
    expect(title).toHaveAttribute('title', expect.stringContaining('A builder with a very long name'))
    expect(card.querySelector('[data-card-part="header"] p')).toHaveClass('truncate')
  })

  it('has no shared height variable any more', () => {
    const css = readFileSync(`${process.cwd()}/src/index.css`, 'utf8')
    expect(css).not.toMatch(/--list-card-height/)
  })
})
