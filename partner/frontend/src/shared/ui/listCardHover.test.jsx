/**
 * Every list card carries the one hover / keyboard-focus surface: the `list-card` class,
 * whose rule turns the whole card the brand's yellow on :hover and :focus-within, keeps
 * grey text readable on it, and drops the lift and transition for reduced motion.
 */
import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { ListCard } from './ListCard.jsx'

// The stylesheet as written (the test runner does not load CSS into the page).
const compact = readFileSync(`${process.cwd()}/src/index.css`, 'utf8').replace(/\s+/g, ' ')

describe('list card hover and focus', () => {
  it.each([
    ['a card that opens', { onClick: () => {} }],
    ['a card that only shows', {}],
  ])('%s carries the warm surface class', (_, props) => {
    const { container } = render(<ListCard title="Card" {...props} />)
    expect(container.querySelector('[data-card="list"]')).toHaveClass('list-card')
  })

  it('turns yellow on hover and on keyboard focus, keeps text readable, and respects reduced motion', () => {
    expect(compact).toMatch(/\.list-card\.list-card:is\(:hover, :focus-within\) \{ background: linear-gradient\(180deg, #f9c85f 0%, #f4b740 52%, #e9a92f 100%\);/)
    expect(compact).toMatch(/\.list-card\.list-card:is\(:hover, :focus-within\) :is\(\.text-oc-muted[^)]*\) \{ color: #083e2b; \}/)
    expect(compact).toMatch(/@media \(prefers-reduced-motion: reduce\) \{ \.list-card \{ transition: none; \} \.list-card\.list-card:is\(:hover, :focus-within\) \{ transform: none; \} \}/)
  })
})
