/**
 * `t`, for code that is not a component.
 *
 * Helper modules -- `utils/roleLabels.js`, `utils/floorOptions.js` and others --
 * take `t` as an optional argument and fall back to an English string when it is
 * not passed. Six of the eight call sites of `constructionTypeLabel` omit it, so
 * those labels rendered in English whatever language was selected.
 *
 * Making the argument required would mean editing every call site to thread a
 * value that is already unambiguous: there is one provider and one selection.
 * This reads that selection directly, so a helper translates correctly whether
 * or not its caller remembered to pass `t`.
 *
 * Identical lookup and interpolation to `t` in LanguageContext.jsx: selected
 * language, then English, then the key itself.
 */

import { lookup } from './dictionaries.js'
import { getActiveLanguage } from './activeLanguage.js'

export function translate(key, values = {}) {
  const template = lookup(getActiveLanguage(), key)
  return Object.entries(values).reduce(
    (translatedText, [name, value]) => translatedText.replaceAll(`{${name}}`, String(value)),
    template,
  )
}

/**
 * Prefer the `t` a caller passed, else translate from the active language.
 * Helpers use this so an existing `t` argument keeps working unchanged.
 */
export function translatorFrom(t) {
  return typeof t === 'function' ? t : translate
}
