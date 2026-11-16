import { expect } from 'vitest'

/**
 * Every card in one list has the same anatomy: header (with the same parts), body, and
 * a footer if any card has one, in that order; and the list is the shared CardGrid.
 */
export function expectUniformCards(grid) {
  expect(grid).toHaveAttribute('data-card-grid')
  const cards = [...grid.querySelectorAll(':scope > li > [data-card="list"]')]
  expect(cards.length).toBeGreaterThan(0)
  // The parts in order, whether the header carries an avatar, and the card's size rules.
  const shape = (card) => ({
    parts: [...card.children].map((part) => part.getAttribute('data-card-part')),
    avatar: Boolean(card.querySelector('[data-card-part="header"] > [data-card-part="avatar"]')),
    fills: card.classList.contains('h-[var(--list-card-height)]') && card.classList.contains('w-full'),
  })
  const first = shape(cards[0])
  expect(first.parts.slice(0, 2)).toEqual(['header', 'body'])
  expect(first.fills).toBe(true)
  cards.slice(1).forEach((card) => expect(shape(card)).toEqual(first))
  return cards
}
