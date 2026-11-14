/**
 * The shared plumbing behind the single Save button on every profile-settings
 * screen.
 *
 * It is deliberately NOT a second error-handling system. Reading an API error
 * stays the job of `apiErrorMessage` and `apiFieldErrors`, which already
 * understand the exact shape the backend sends:
 *
 *     { detail: { message: "...", fields: { phone: "Phone number is required." } } }
 *
 * What lives here is the part those two helpers do not do, and that all four
 * screens otherwise had to reinvent: keeping the field map, pointing the user at
 * the first field that is wrong, and clearing one field's error as it is
 * corrected.
 *
 * Two things it guarantees, because both were real failures:
 *
 *   * a message handed to JSX is always a string. `apiErrorMessage` returns
 *     `detail` untouched when it is neither a string nor an object carrying
 *     `message`, and rendering that object is what turned a failed save into a
 *     blank page.
 *   * the caller keeps the rejection. Nothing here swallows it, so a parent can
 *     never mistake a refused save for a saved one.
 */
import { useCallback, useRef, useState } from 'react'
import { apiErrorMessage, apiFieldErrors } from '../auth/accountPaths.js'

/** `apiErrorMessage`, guaranteed to hand back something JSX can render. */
export function profileErrorMessage(error, fallbackMessage) {
  const message = apiErrorMessage(error, fallbackMessage)
  return typeof message === 'string' && message.trim() ? message : fallbackMessage
}

/** One field's message, whatever shape the backend expressed it in. */
function readFieldMessage(value, fallbackMessage) {
  if (typeof value === 'string' && value.trim()) return value
  if (value && typeof value === 'object') {
    const nested = value.msg || value.message || value.detail
    if (typeof nested === 'string' && nested.trim()) return nested
  }
  return fallbackMessage
}

export function useProfileFormErrors() {
  const [fieldErrors, setFieldErrors] = useState({})
  const [formError, setFormError] = useState('')
  // Populated by `registerField`, so focusing a field never needs a DOM query.
  const fieldElements = useRef({})

  const registerField = useCallback((field) => (element) => {
    if (element) fieldElements.current[field] = element
    else delete fieldElements.current[field]
  }, [])

  const clearErrors = useCallback(() => {
    setFieldErrors({})
    setFormError('')
  }, [])

  const clearFieldError = useCallback((field) => {
    setFieldErrors((currentErrors) => {
      if (!currentErrors[field]) return currentErrors
      const nextErrors = { ...currentErrors }
      delete nextErrors[field]
      return nextErrors
    })
  }, [])

  /**
   * Bring one field into view and put the cursor in it.
   *
   * The scroll is animated, so focusing straight away would fight it —
   * `preventScroll` plus a short delay lets the page settle first. A field that
   * has no input on screen (the backend can name one this form does not show)
   * simply reports false, and the general message carries the explanation.
   */
  const focusField = useCallback((field) => {
    const element = fieldElements.current[field]
    if (!element) return false
    element.scrollIntoView({ behavior: 'smooth', block: 'center' })
    window.setTimeout(() => {
      try {
        element.focus({ preventScroll: true })
      } catch {
        element.focus()
      }
    }, 150)
    return true
  }, [])

  /**
   * Record a refused save: the per-field messages, the general one, and the
   * jump to the first field the person actually has to fix.
   *
   * `fieldOrder` is the order the fields appear on screen, so "first invalid"
   * means first as read, not first as the backend happened to serialise it.
   */
  const applyError = useCallback((error, fallbackMessage, fieldOrder = []) => {
    const rawErrors = apiFieldErrors(error) || {}
    const nextErrors = {}
    Object.keys(rawErrors).forEach((field) => {
      nextErrors[field] = readFieldMessage(rawErrors[field], fallbackMessage)
    })
    setFieldErrors(nextErrors)
    setFormError(profileErrorMessage(error, fallbackMessage))

    const failedFields = Object.keys(nextErrors)
    const firstFailed = fieldOrder.find((field) => failedFields.includes(field)) || failedFields[0]
    if (firstFailed) window.setTimeout(() => focusField(firstFailed), 0)
    return nextErrors
  }, [focusField])

  return {
    fieldErrors,
    formError,
    setFormError,
    registerField,
    clearErrors,
    clearFieldError,
    applyError,
    focusField,
  }
}

/** The invalid-field treatment, appended to a field's own classes. */
export const INVALID_FIELD_CLASS = 'border-red-500 bg-red-50 ring-1 ring-red-200 focus:border-red-500 focus:ring-2 focus:ring-red-100'
