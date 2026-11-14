import en from './locales/en.js'

/**
 * The interface text, one dictionary per language. English is always here: it is the
 * fallback for any key a language lacks. Every other language is downloaded when it is
 * first used (the saved choice at start-up, or a pick in the selector), once.
 */
const LOADERS = {
  ar: () => import('./locales/ar.js'),
  te: () => import('./locales/te.js'),
  hi: () => import('./locales/hi.js'),
  ta: () => import('./locales/ta.js'),
  kn: () => import('./locales/kn.js'),
  ml: () => import('./locales/ml.js'),
}

const loaded = { en }
const pending = {}

export const ENGLISH = en

export function isLanguageLoaded(code) {
  return Boolean(loaded[code])
}

/** Resolves once `code`'s dictionary is here (English, or an unknown code, at once). */
export function loadLanguage(code) {
  if (loaded[code] || !LOADERS[code]) return Promise.resolve()
  if (!pending[code]) {
    pending[code] = LOADERS[code]()
      .then((module) => {
        loaded[code] = module.default
      })
      .finally(() => {
        delete pending[code]
      })
  }
  return pending[code]
}

/** The text for `key` in `code`, else English, else the key itself (as before). */
export function lookup(code, key) {
  return loaded[code]?.[key] ?? en[key] ?? key
}
