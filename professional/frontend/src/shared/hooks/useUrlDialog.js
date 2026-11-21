import { useCallback } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import useSearchParamsLatest from './useSearchParamsLatest.js'

/**
 * A profile or detail dialog kept in the address's query string (`?profile=<uuid>`), so the
 * browser's Back button closes it and a refresh or a pasted link opens it again.
 *
 *   const [profileId, openProfile, closeProfile] = useUrlDialog('profile')
 *
 * - Opening is a new history entry, marked in its history state, so Back closes the dialog.
 * - Closing goes back when this visit opened the dialog (its entry is the marked one), and
 *   otherwise (a deep link, a refresh) removes the parameter in place: the dialog closes
 *   without leaving the page.
 * - Only a UUID is read; anything else reads as closed. Never put a name, a phone number or
 *   other personal data in the address.
 * - Other query parameters on the address are kept.
 *
 * (Belongs beside useUrlState in src/shared/hooks; kept here while that folder is out of
 * this change's scope.)
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MARK = 'urlDialog'

export const isUuid = (value) => UUID.test(String(value ?? ''))

export default function useUrlDialog(name, accept = isUuid) {
  const [params, setParams] = useSearchParamsLatest()
  const location = useLocation()
  const navigate = useNavigate()
  const raw = params.get(name)
  const value = raw && accept(raw) ? raw : null
  const openedHere = location.state?.[MARK] === name
  const state = location.state

  const open = useCallback((id) => {
    if (!accept(String(id ?? ''))) return
    setParams((current) => {
      const updated = new URLSearchParams(current)
      updated.set(name, String(id))
      return updated
    }, { state: { ...(state && typeof state === 'object' ? state : {}), [MARK]: name } })
  }, [accept, name, setParams, state])

  // `{ replace: true }` removes the parameter in place even when this visit opened it: for
  // a close followed at once by another navigation (Back would undo that navigation).
  const close = useCallback(({ replace = false } = {}) => {
    if (openedHere && !replace) {
      navigate(-1)
      return
    }
    setParams((current) => {
      const updated = new URLSearchParams(current)
      updated.delete(name)
      return updated
    }, { replace: true, state })
  }, [name, navigate, openedHere, setParams, state])

  return [value, open, close]
}
