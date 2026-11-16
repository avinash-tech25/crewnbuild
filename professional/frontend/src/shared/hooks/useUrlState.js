import { useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'

/**
 * A tab, filter or list choice kept in the address's query string instead of in memory,
 * so a refresh, Back / Forward and a bookmark all restore the same view.
 *
 *   const [tab, setTab] = useUrlState('tab', 'current', ['current', 'previous', 'upcoming'])
 *
 * - Only a value in `allowed` (when given) is read; anything else reads as `fallback`,
 *   so a hand-edited or stale address never shows a view that does not exist.
 * - The fallback is never written, so the default view keeps its short address.
 * - A change is a new history entry (Back returns to the previous tab), unless
 *   `{ replace: true }` is passed to the setter.
 * - Other query parameters on the address are kept.
 *
 * Never put a name, a phone number or other personal data in a value: ids (UUIDs) and
 * fixed choices only.
 */
/**
 * Several query values changed as one move (one history entry), e.g. a tab and the filter
 * it resets: `patch({ tab: 'previous', status: null })`. An empty value removes the word.
 */
export function useUrlParams() {
  const [params, setParams] = useSearchParams()
  const patch = useCallback((changes, { replace = false } = {}) => {
    setParams((current) => {
      const updated = new URLSearchParams(current)
      Object.entries(changes).forEach(([key, value]) => {
        if (value === null || value === undefined || value === '') updated.delete(key)
        else updated.set(key, String(value))
      })
      return updated
    }, { replace })
  }, [setParams])
  return [params, patch]
}

export default function useUrlState(name, fallback, allowed = null) {
  const [params, setParams] = useSearchParams()
  const raw = params.get(name)
  const value = raw !== null && (!allowed || allowed.includes(raw)) ? raw : fallback

  const setValue = useCallback(
    (next, { replace = false } = {}) => {
      setParams(
        (current) => {
          const updated = new URLSearchParams(current)
          const resolved = typeof next === 'function' ? next(value) : next
          if (resolved === null || resolved === undefined || resolved === '' || resolved === fallback) updated.delete(name)
          else updated.set(name, String(resolved))
          return updated
        },
        { replace },
      )
    },
    [setParams, name, fallback, value],
  )

  return [value, setValue]
}
