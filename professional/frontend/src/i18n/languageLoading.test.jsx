import { act, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { isLanguageLoaded } from './dictionaries.js'
import { LanguageProvider, preloadSavedLanguage, useLanguage } from './LanguageContext.jsx'
import { translate } from './translate.js'

function Sample() {
  const { t, language, setLanguage } = useLanguage()
  return (
    <div>
      <p data-testid="text">{t('dash.common.sendRequest')}</p>
      <p data-testid="language">{language}</p>
      <button type="button" onClick={() => setLanguage('hi')}>hi</button>
      <button type="button" onClick={() => setLanguage('ta')}>ta</button>
      <button type="button" onClick={() => setLanguage('en')}>en</button>
    </div>
  )
}

const renderSample = () => render(<LanguageProvider><Sample /></LanguageProvider>)

// The order matters: a language, once downloaded, stays for the page's life.
describe('interface languages', () => {
  it('starts in English with only English downloaded', () => {
    renderSample()
    expect(screen.getByTestId('text')).toHaveTextContent('Send Request')
    for (const code of ['ar', 'te', 'hi', 'ta', 'kn', 'ml']) expect(isLanguageLoaded(code)).toBe(false)
  })

  it('downloads a language when it is picked, and switches once it is here', async () => {
    renderSample()
    act(() => screen.getByRole('button', { name: 'hi' }).click())
    // Until Hindi arrives the page stays in English (no half-translated page).
    expect(screen.getByTestId('language')).toHaveTextContent('en')
    await waitFor(() => expect(screen.getByTestId('language')).toHaveTextContent('hi'))
    expect(screen.getByTestId('text')).toHaveTextContent('अनुरोध भेजें')
    expect(translate('dash.common.sendRequest')).toBe('अनुरोध भेजें')
    expect(localStorage.getItem('crewnbuild_language')).toBe('hi')
    expect(localStorage.getItem('crewnbuild_language_manual')).toBe('1')
    expect(isLanguageLoaded('hi')).toBe(true)
    expect(isLanguageLoaded('ta')).toBe(false)

    // Back to English: at once, it is always here.
    act(() => screen.getByRole('button', { name: 'en' }).click())
    await waitFor(() => expect(screen.getByTestId('text')).toHaveTextContent('Send Request'))
  })

  it('keeps the last pick when two are made quickly', async () => {
    renderSample()
    act(() => {
      screen.getByRole('button', { name: 'ta' }).click()
      screen.getByRole('button', { name: 'hi' }).click()
    })
    await waitFor(() => expect(screen.getByTestId('language')).toHaveTextContent('hi'))
    await waitFor(() => expect(isLanguageLoaded('ta')).toBe(true))
    expect(screen.getByTestId('language')).toHaveTextContent('hi')
  })

  it('falls back to English for a key a language lacks', async () => {
    renderSample()
    act(() => screen.getByRole('button', { name: 'hi' }).click())
    await waitFor(() => expect(screen.getByTestId('language')).toHaveTextContent('hi'))
    // Hindi has no text for the Store Manager's Buy button; English is shown, as before.
    expect(translate('store.buy.pay')).toBe('Pay with Razorpay (TEST)')
  })

  it("opens a returning visitor's saved language from the first render", async () => {
    localStorage.setItem('crewnbuild_language_manual', '1')
    localStorage.setItem('crewnbuild_language', 'kn')
    await preloadSavedLanguage()
    expect(isLanguageLoaded('kn')).toBe(true)
    renderSample()
    expect(screen.getByTestId('language')).toHaveTextContent('kn')
    expect(screen.getByTestId('text')).not.toHaveTextContent('Send Request')
  })
})
