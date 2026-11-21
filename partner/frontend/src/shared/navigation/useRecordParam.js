import { useCallback } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'

/**
 * A viewer or detail dialog kept in the address as `?<name>=<record id>` (the server
 * record's UUID, never a name, phone or email), so Back closes it and a link reopens it.
 *
 *   - open(id) adds a history entry;
 *   - close() goes Back when this page opened it (so the entry it added goes away), and
 *     otherwise -- a dialog reached by a link or a refresh -- removes the parameter in
 *     place, without leaving the app.
 *
 * Other query parameters and the hash are kept. The caller decides whether the id names
 * a record it actually has; an unknown id simply opens nothing.
 */
export default function useRecordParam(name) {
  const [params] = useSearchParams()
  const location = useLocation()
  const navigate = useNavigate()
  const value = params.get(name)
  const openedHere = location.state?.openedParam === name

  const withParam = useCallback((id) => {
    const next = new URLSearchParams(location.search)
    if (id) next.set(name, id)
    else next.delete(name)
    const search = next.toString()
    return { pathname: location.pathname, search: search ? `?${search}` : '', hash: location.hash }
  }, [location.pathname, location.search, location.hash, name])

  const open = useCallback((id) => {
    navigate(withParam(id), { replace: openedHere, state: { openedParam: name } })
  }, [navigate, withParam, openedHere, name])

  const close = useCallback(() => {
    if (openedHere) navigate(-1)
    else navigate(withParam(null), { replace: true })
  }, [navigate, withParam, openedHere])

  return { value, open, close }
}
