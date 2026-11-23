/**
 * Every screen the Disclaimer names carries its short note (or, for the Verified badge, the
 * tooltip), and each kind of note renders its text with a "Read disclaimer" link to its
 * section. The calculators, adverts, Viswa and the language switchers are also rendered in
 * disclaimer.test.jsx; the dashboard screens are checked here by their source.
 */
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { LanguageProvider } from '../../i18n/LanguageContext.jsx'
import en from '../../i18n/locales/en.js'
import { DISCLAIMER_NOTES, DisclaimerNote, disclaimerHref } from '../../shared/ui/DisclaimerNote.jsx'

const sources = import.meta.glob('../**/*.jsx', { query: '?raw', import: 'default', eager: true })
const source = (path) => {
  const found = sources[`../${path}`]
  if (!found) throw new Error(`missing ${path}`)
  return found
}

const PLACEMENTS = [
  ['shop/components/ProductCatalogPage.jsx', 'prices'],
  ['storefront/components/SupplierStorefront.jsx', 'prices'],
  ['storefront/components/StorefrontProductDetail.jsx', 'prices'],
  ['property/components/PropertyBuySellHub.jsx', 'property'],
  ['builder/components/BuilderFindClients.jsx', 'leads'],
  ['supplier/components/SupplierSections.jsx', 'leads'],
  ['builder/components/BuilderRequestViews.jsx', 'leads'],
  ['requests/components/AwardPanel.jsx', 'payments'],
  ['owner/components/OwnerProjectViews.jsx', 'payments'],
  ['builder/components/BuilderProjectViews.jsx', 'payments'],
  ['site-work/components/SiteDayResources.jsx', 'payments'],
  ['site-work/components/SiteDayResources.jsx', 'labour'],
  ['labour/components/SupplierLaborSections.jsx', 'labour'],
  ['owner/components/OwnerDiscovery.jsx', 'technician'],
  ['engineer/pages/EngineerDashboardPage.jsx', 'technician'],
  ['public-site/components/landing/SiteFooter.jsx', 'language'],
  ['assistant/ChatPanel.jsx', 'assistant'],
]

const VERIFIED_BADGES = [
  'owner/components/OwnerSections.jsx',
  'builder/components/BuilderProfileDetails.jsx',
  'builder/components/BuilderProfileSettings.jsx',
  'builder/components/BuilderRequestViews.jsx',
]

describe('Disclaimer short notes on each screen', () => {
  it.each(PLACEMENTS)('%s shows the %s note', (path, kind) => {
    expect(source(path)).toContain(`<DisclaimerNote kind="${kind}"`)
  })

  it.each(VERIFIED_BADGES)('%s explains the Verified badge in its tooltip', (path) => {
    expect(source(path)).toContain("t('disclaimer.note.verified')")
  })

  it.each(Object.keys(DISCLAIMER_NOTES))('the %s note shows its text and links to its section', (kind) => {
    render(<MemoryRouter><LanguageProvider><DisclaimerNote kind={kind} /></LanguageProvider></MemoryRouter>)
    const note = screen.getByTestId('disclaimer-note')
    expect(note).toHaveTextContent(en[DISCLAIMER_NOTES[kind].key])
    expect(within(note).getByRole('link', { name: 'Read disclaimer' })).toHaveAttribute('href', disclaimerHref(kind))
  })
})
