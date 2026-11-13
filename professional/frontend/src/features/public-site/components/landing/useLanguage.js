/**
 * Language access for the CREWNBUILD landing page.
 *
 * The reference project kept its own two-language state in localStorage and wrote
 * `lang`/`dir` onto the document itself. This application already has a language
 * provider that does exactly that, so this adapter delegates to it rather than
 * running a second, competing copy. The returned shape is unchanged, so every
 * ported landing component works without edits.
 *
 * The copy itself now comes from the shared key table in src/i18n/translations.js
 * under `landing.*`, the same table the rest of the application reads through
 * `t()`. It previously came from a second table in ./content.js that held only
 * English and Arabic, so Telugu, Hindi, Tamil, Kannada and Malayalam silently
 * fell back to English. The nested shape below is rebuilt from those flat keys,
 * so the components keep receiving exactly the object they always did.
 */
import { useMemo } from 'react'
import { useLanguage as useApplicationLanguage } from '../../../../i18n/LanguageContext.jsx'
import { TRANSLATIONS } from '../../../../i18n/translations.js'

const PREFIX = 'landing.'

// The key list is taken from English, which is the table guaranteed to be
// complete; `t()` then resolves each one in the selected language.
const LANDING_KEYS = Object.keys(TRANSLATIONS.en).filter((key) => key.startsWith(PREFIX))

/**
 * Rebuilds `landing.a.b.0.c` keys into the nested object the landing components
 * read. A path segment that is a number becomes an array index, so the lists the
 * components map over (`sceneFooter`, `bridge`, `roles`, `points`) stay arrays.
 */
function nest(translate) {
  const root = {}
  for (const key of LANDING_KEYS) {
    const path = key.slice(PREFIX.length).split('.')
    let node = root
    for (let index = 0; index < path.length - 1; index += 1) {
      const segment = path[index]
      const nextIsIndex = /^\d+$/.test(path[index + 1])
      if (node[segment] === undefined) node[segment] = nextIsIndex ? [] : {}
      node = node[segment]
    }
    node[path[path.length - 1]] = translate(key)
  }
  return root
}

export function useLanguage() {
  const { language, setLanguage, t } = useApplicationLanguage()
  // Only Arabic is right-to-left. This was a value in the old table; it is a
  // property of the language rather than copy, so it is derived here instead of
  // being carried as a translatable string.
  const direction = language === 'ar' ? 'rtl' : 'ltr'
  // Rebuilt only when the language changes, so the landing components receive a
  // stable object between renders exactly as they did from the old table.
  const text = useMemo(() => ({ ...nest(t), direction }), [t, direction])
  return { language, setLanguage, text, isArabic: direction === 'rtl' }
}
