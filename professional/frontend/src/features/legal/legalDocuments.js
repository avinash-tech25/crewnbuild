/**
 * The legal documents (Terms, Privacy Policy, Disclaimer) and what a sign-up sends to say
 * the first two were accepted (the Disclaimer is read, not accepted).
 *
 * The texts are generated from the Word files (content/*.js); their `version`
 * fields are the versions an account accepts. The API requires these three fields
 * on every path that creates an account.
 */
import terms from './content/terms.js'
import privacy from './content/privacy.js'
import disclaimer from './content/disclaimer.js'

export { terms, privacy, disclaimer }

export const LEGAL_DOCUMENTS = { terms, privacy, disclaimer }

/** The short title each document is shown under (page heading, dialog title). */
export const LEGAL_TITLE_KEYS = {
  terms: 'legal.hub.termsTitle',
  privacy: 'legal.hub.privacyTitle',
  disclaimer: 'legal.hub.disclaimerTitle',
}

/** Sent with a sign-up, and only once the consent box has been ticked. */
export function legalAcceptanceFields() {
  return { accept_terms: true, terms_version: terms.version, privacy_version: privacy.version }
}
