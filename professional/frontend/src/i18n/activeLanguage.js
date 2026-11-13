/**
 * The language currently selected, readable outside React.
 *
 * `useLanguage()` is the way components get this. But dates, times and numbers
 * are formatted inside plain helper functions -- `formatProjectDate(value, t)`,
 * `timeAgo(value, t)` and friends -- which are not components, cannot call a
 * hook, and are invoked from well over a hundred places. Threading a `language`
 * argument through all of them would be a large edit for no behavioural gain.
 *
 * So the provider publishes the selection here as it changes, and the
 * formatters read it. There is exactly one provider and one selection, so there
 * is nothing to keep in sync: this is that value, not a second copy of it.
 */

let activeLanguage = 'en'

export function setActiveLanguage(language) {
  if (typeof language === 'string' && language) activeLanguage = language
}

export function getActiveLanguage() {
  return activeLanguage
}
