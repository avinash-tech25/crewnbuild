import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { LANGUAGES, TRANSLATIONS } from './translations.js'
import { COUNTRY_CONFIG } from '../shared/utils/countryConfig.js'
import { BATCH_DELAY, cachedTranslation, fetchTranslations, isTranslatableText } from './dynamicTranslation.js'
import { setActiveLanguage } from './activeLanguage.js'

const STORAGE_KEY = 'crewnbuild_language'
const MANUAL_STORAGE_KEY = 'crewnbuild_language_manual'
const COUNTRY_STORAGE_KEY = 'crewnbuild_country'
const SUPPORTED_CODES = new Set(LANGUAGES.map(({ code }) => code))
const LanguageContext = createContext(null)
const MESSAGE_KEYS = {
  'Unable to login. Please check your credentials.': 'error.login',
  'Invalid username/email or password': 'error.credentials',
  'Unable to create account. Please check the form.': 'error.signup',
  'Email already registered': 'error.emailRegistered',
}

// Language is purely a UI preference. It is NEVER derived from country,
// browser, device, or location. A new user (or anyone without a saved choice)
// always gets English; only an explicit saved selection overrides that.
function getInitialLanguage() {
  // Only a deliberately saved selection counts. The old country→language
  // coupling auto-wrote values without ever asking the user; those leftovers
  // are treated as no preference.
  if (!window.localStorage.getItem(MANUAL_STORAGE_KEY)) return 'en'
  const storedLanguage = window.localStorage.getItem(STORAGE_KEY)
  return SUPPORTED_CODES.has(storedLanguage) ? storedLanguage : 'en'
}

function getInitialCountry() {
  const storedCountry = window.localStorage.getItem(COUNTRY_STORAGE_KEY)
  return COUNTRY_CONFIG[storedCountry] ? storedCountry : ''
}

export function LanguageProvider({ children }) {
  const [language, setLanguageState] = useState(getInitialLanguage)
  const [country, setCountryState] = useState(getInitialCountry)

  // Published before the first render, not in an effect: the formatters in
  // utils/formatters.js read this while that first render is being built, and
  // an effect runs afterwards -- which would format the opening paint of every
  // reload in English regardless of the saved selection.
  setActiveLanguage(language)

  // setLanguage is only ever called by the user picking a language in the
  // selector. Record that this was a deliberate choice so it persists and
  // overrides the English default.
  const setLanguage = useCallback((value) => {
    if (!SUPPORTED_CODES.has(value)) return
    window.localStorage.setItem(MANUAL_STORAGE_KEY, '1')
    setLanguageState(value)
  }, [])

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, language)
    document.documentElement.lang = language
    // Only Arabic requires right-to-left layout; all other supported
    // languages (including English) are left-to-right.
    document.documentElement.dir = language === 'ar' ? 'rtl' : 'ltr'
  }, [language])

  const setCountry = useCallback((value) => {
    const normalized = COUNTRY_CONFIG[value] ? value : ''
    setCountryState((current) => (current === normalized ? current : normalized))
    window.localStorage.setItem(COUNTRY_STORAGE_KEY, normalized)
  }, [])

  const t = useCallback((key, values = {}) => {
    const template = TRANSLATIONS[language]?.[key] ?? TRANSLATIONS.en[key] ?? key
    return Object.entries(values).reduce(
      (translatedText, [name, value]) => translatedText.replaceAll(`{${name}}`, String(value)),
      template,
    )
  }, [language])

  const translateMessage = useCallback((message) => {
    if (!message) return ''
    const key = MESSAGE_KEYS[String(message).trim()]
    return key ? t(key) : message
  }, [t])

  // --- Text people typed -------------------------------------------------
  //
  // `t` covers the interface's own words. `td` covers the rest: a project
  // description, a company name, a person's name. Those have no key, so they
  // are translated on demand and the answers are cached.
  //
  // `td` is called during render and must return synchronously, so an unknown
  // string is queued and its *original* is returned. When the batch comes back,
  // `dynamicVersion` changes, every consumer re-renders, and the same call now
  // finds the translation in the cache.
  const [dynamicVersion, setDynamicVersion] = useState(0)
  const pendingRef = useRef(new Set())
  const timerRef = useRef(null)

  // English is what is stored, so nothing needs asking for.
  const translatesDynamicText = language !== 'en'

  const flushPending = useCallback(async () => {
    timerRef.current = null
    const texts = [...pendingRef.current]
    pendingRef.current = new Set()
    if (!texts.length) return
    const changed = await fetchTranslations(language, texts)
    if (changed) setDynamicVersion((version) => version + 1)
  }, [language])

  const td = useCallback((value) => {
    if (value === null || value === undefined) return ''
    const text = typeof value === 'string' ? value : String(value)
    if (!translatesDynamicText || !text.trim() || !isTranslatableText(text)) return text

    const cached = cachedTranslation(language, text)
    if (cached !== undefined) return cached

    // Queueing only touches a ref and schedules a timer, so calling this during
    // render neither updates state nor repeats work: the Set discards duplicates
    // and React's double-render in development queues the same string twice.
    pendingRef.current.add(text)
    if (timerRef.current === null) {
      timerRef.current = window.setTimeout(flushPending, BATCH_DELAY)
    }
    return text
  }, [language, translatesDynamicText, flushPending, dynamicVersion])

  // A language change abandons a batch queued for the previous language; those
  // strings are re-queued by the render that follows.
  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current)
        timerRef.current = null
      }
      pendingRef.current = new Set()
    }
  }, [language])

  // All 7 supported languages are always offered, regardless of country.
  // Country configures project business settings (currency, providers) —
  // it never restricts or forces the UI language.
  const languages = LANGUAGES

  const value = useMemo(
    () => ({ language, setLanguage, country, setCountry, languages, t, translateMessage, td }),
    [language, setLanguage, t, translateMessage, country, td],
  )
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>
}

export function useLanguage() {
  const context = useContext(LanguageContext)
  if (!context) throw new Error('useLanguage must be used inside LanguageProvider')
  return context
}
