import { useCallback, useEffect, useState } from 'react'
import { Check, CheckCircle2, Star } from 'lucide-react'
import { Spinner } from '../../../shared/ui/ui.jsx'
import { apiErrorMessage } from '../../../shared/api/apiClient.js'
import { fetchRating, submitRating } from '../bookingApi.js'
import { keepCompatible, optionsFor, toggleTag } from '../rating.js'

function Stars({ value, size = 'h-6 w-6' }) {
  return (
    <span className="inline-flex gap-0.5 text-oc-amber" aria-label={`${value} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((n) => <Star key={n} className={`${size} ${n <= value ? 'fill-current' : 'text-slate-300'}`} />)}
    </span>
  )
}

/**
 * "How was your service?" on the customer's own COMPLETED booking: whole stars
 * and optional predefined tags, submitted once. No text box -- this is not a
 * review. Skipping is fine: it stays here until the customer rates.
 *
 * The tag vocabulary and which stars allow which tags come from the backend.
 */
export default function RateTechnicianCard({ bookingId, onRated }) {
  const [view, setView] = useState(null)
  const [stars, setStars] = useState(0)
  const [tags, setTags] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try {
      setView(await fetchRating(bookingId))
    } catch (loadError) {
      setError(apiErrorMessage(loadError, 'The rating could not be loaded.'))
    }
  }, [bookingId])

  useEffect(() => { load() }, [load])

  if (!view && !error) return null
  if (view && view.state === 'NOT_YET') return null

  const chooseStars = (value) => {
    setStars(value)
    setTags((current) => keepCompatible(current, value, view.star_groups, view.tag_options))
    setError('')
  }

  const submit = async () => {
    setBusy(true)
    setError('')
    try {
      const saved = await submitRating(bookingId, { stars, tags })
      setView(saved)
      onRated?.(saved)
    } catch (submitError) {
      setError(apiErrorMessage(submitError, 'Your rating could not be submitted. Please try again.'))
      if (submitError?.response?.status === 409) load()
    } finally {
      setBusy(false)
    }
  }

  if (view?.state === 'RATED') {
    return (
      <section className="card p-5 text-center sm:p-6" data-testid="rating-thanks">
        <CheckCircle2 className="mx-auto h-8 w-8 text-oc-green" />
        <h2 className="mt-2 font-display text-xl font-extrabold text-oc-ink">Thanks for your rating!</h2>
        <div className="mt-2 flex justify-center"><Stars value={view.stars} /></div>
        {view.tags.length > 0 && (
          <ul className="mt-3 flex flex-wrap justify-center gap-1.5" data-testid="rating-thanks-tags">
            {view.tags.map((tag) => <li key={tag.key} className="rounded-full bg-oc-mint px-3 py-1 text-xs font-bold text-oc-deep">{tag.label}</li>)}
          </ul>
        )}
        <p className="mt-3 text-sm text-oc-muted">Your feedback has been submitted.</p>
      </section>
    )
  }

  const options = view ? optionsFor(stars, view.star_groups, view.tag_options) : []
  const name = view?.technician_name || 'your technician'

  return (
    <section className="card overflow-hidden" aria-labelledby="rate-title" data-testid="rating-card">
      <div className="flex items-center gap-2 bg-emerald-50 px-5 py-2.5 text-emerald-900">
        <CheckCircle2 className="h-4 w-4" />
        <span className="font-display text-sm font-extrabold uppercase tracking-wide">Job completed</span>
      </div>
      <div className="space-y-4 p-5 text-center sm:p-6">
        <div>
          <h2 id="rate-title" className="font-display text-xl font-extrabold text-oc-ink">How was your service?</h2>
          <p className="text-sm text-oc-muted">Rate {name}</p>
        </div>

        <div className="flex justify-center gap-1 sm:gap-2" role="radiogroup" aria-label="Stars">
          {[1, 2, 3, 4, 5].map((value) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={stars === value}
              aria-label={`${value} ${value === 1 ? 'star' : 'stars'}`}
              onClick={() => chooseStars(value)}
              className="rounded-xl p-1.5 transition hover:scale-110 focus-visible:outline-2 focus-visible:outline-oc-amber"
              data-testid="rating-star"
            >
              <Star className={`h-9 w-9 sm:h-10 sm:w-10 ${value <= stars ? 'fill-oc-amber text-oc-amber' : 'text-slate-300'}`} />
            </button>
          ))}
        </div>
        {!stars && <p className="text-xs text-oc-muted">Tap 1–5 stars.</p>}

        {options.length > 0 && (
          <div>
            <p className="mb-2 text-xs font-bold uppercase tracking-wide text-oc-muted">What stood out? (optional)</p>
            <ul className="flex flex-wrap justify-center gap-2" data-testid="rating-tags">
              {options.map((option) => {
                const on = tags.includes(option.key)
                return (
                  <li key={option.key}>
                    <button
                      type="button"
                      aria-pressed={on}
                      onClick={() => setTags((current) => toggleTag(current, option.key))}
                      className={`inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-sm font-bold transition ${
                        on ? 'border-oc-green bg-oc-green text-white' : 'border-oc-line bg-white text-oc-ink hover:border-oc-green'
                      }`}
                      data-testid="rating-tag"
                    >
                      {on && <Check className="h-3.5 w-3.5" />} {option.label}
                    </button>
                  </li>
                )
              })}
            </ul>
          </div>
        )}

        {error && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm font-bold text-red-800" data-testid="rating-error">{error}</p>}

        <button type="button" className="btn-primary w-full py-3 sm:w-auto sm:px-10" disabled={!stars || busy} onClick={submit} data-testid="rating-submit">
          {busy ? <Spinner className="h-4 w-4" /> : <Star className="h-4 w-4" />} Submit Rating
        </button>
      </div>
    </section>
  )
}

export { Stars }
