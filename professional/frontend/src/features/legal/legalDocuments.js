/**
 * The two legal documents and what a sign-up sends to say they were accepted.
 *
 * The texts are generated from the Word files (content/*.js); their `version`
 * fields are the versions an account accepts. The API requires these three fields
 * on every path that creates an account.
 */
import terms from './content/terms.js'
import privacy from './content/privacy.js'

export { terms, privacy }

export const LEGAL_DOCUMENTS = { terms, privacy }

/** Sent with a sign-up, and only once the consent box has been ticked. */
export function legalAcceptanceFields() {
  return { accept_terms: true, terms_version: terms.version, privacy_version: privacy.version }
}
