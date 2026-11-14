/**
 * The rules the job-execution screen checks before it asks the server.
 *
 * These mirror the backend (Stage A) so the technician hears about an obvious
 * problem at once instead of after an upload. They are a convenience only: the
 * server decides, and every refusal it sends is shown as it sends it. The file
 * type here comes from the browser; the server identifies the real format from
 * the file's own bytes.
 *
 * No imports: this module is loaded by the unit tests under plain Node.
 */

export const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp']
export const PHOTO_ACCEPT = PHOTO_TYPES.join(',')
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024
export const NOTES_MAX_LENGTH = 2000

export const KIND_BEFORE = 'BEFORE'
export const KIND_AFTER = 'AFTER'
export const KIND_CUSTOMER = 'CUSTOMER'

// Used only if the server's own limits are missing from a response.
const FALLBACK_LIMITS = { CUSTOMER: 5, BEFORE: 6, AFTER: 6 }

export function photosOf(execution, kind) {
  return (execution?.media || []).filter((item) => item.kind === kind)
}

export function photoLimit(execution, kind) {
  return execution?.media_limits?.[kind] ?? FALLBACK_LIMITS[kind]
}

export function canUpload(execution, kind) {
  return Boolean(execution?.can_upload?.includes(kind)) && photosOf(execution, kind).length < photoLimit(execution, kind)
}

/** Why this file cannot be sent, or null. `count` is how many photos of the kind exist. */
export function photoProblem(file, { count, limit }) {
  if (count >= limit) return `You can add at most ${limit} photos here.`
  if (!file) return 'Choose a photo to upload.'
  if (!PHOTO_TYPES.includes(file.type)) return 'Choose a JPG, PNG or WebP photo.'
  if (file.size === 0) return 'This file is empty. Choose another photo.'
  if (file.size > MAX_PHOTO_BYTES) return 'Choose a photo smaller than 5 MB.'
  return null
}

/** Exactly what the server stores: trimmed, and empty means no notes at all. */
export function cleanNotes(value) {
  const trimmed = (value ?? '').trim()
  return trimmed === '' ? null : trimmed
}

/** The length the server checks against NOTES_MAX_LENGTH (after trimming). */
export function notesLength(value) {
  return (value ?? '').trim().length
}

export function notesProblem(value, label = 'Service notes') {
  return notesLength(value) > NOTES_MAX_LENGTH
    ? `${label} can be at most ${NOTES_MAX_LENGTH} characters.`
    : null
}

/** What is still open when the technician chooses Mark completed. Informational
 *  only: completing is never blocked here, and the server does not block it. */
export function completionWarnings(execution) {
  if (!execution) return []
  const warnings = []
  const open = (execution.steps_total || 0) - (execution.steps_completed || 0)
  if (open > 0) warnings.push(`${open} of ${execution.steps_total} job steps ${open === 1 ? 'is' : 'are'} not ticked.`)
  if (photosOf(execution, KIND_AFTER).length === 0) warnings.push('No after-work photo has been added.')
  return warnings
}
