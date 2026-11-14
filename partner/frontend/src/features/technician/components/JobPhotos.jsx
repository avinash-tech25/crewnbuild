import { useEffect, useRef, useState } from 'react'
import { ImageOff, ImagePlus, Trash2, X } from 'lucide-react'
import { Spinner } from '../../../shared/ui/ui.jsx'
import { PHOTO_ACCEPT } from '../jobExecutionRules.js'

/**
 * One kind of job photo (before work, after work, or the customer's), shown from
 * private object URLs. Adding and removing are offered only when the server says
 * so for this job right now; it checks again on every request.
 */
export default function JobPhotos({
  title, kind, photos, urls, limit, canAdd, addHint, uploading, deletingId, onAdd, onDelete, emptyText,
}) {
  const input = useRef(null)
  const [viewing, setViewing] = useState(null)
  const [confirming, setConfirming] = useState(null)

  const pick = (event) => {
    const files = Array.from(event.target.files || [])
    event.target.value = '' // the same file can be chosen again after an error
    if (files.length) onAdd(files)
  }

  return (
    <section className="rounded-xl border border-oc-line bg-white p-4" data-testid={`photos-${kind}`} aria-label={title}>
      <div className="flex items-center justify-between gap-2">
        <h4 className="font-display text-sm font-extrabold uppercase tracking-wide text-oc-ink">{title}</h4>
        {limit ? <span className="text-xs font-bold text-oc-muted" data-testid={`photo-count-${kind}`}>{photos.length}/{limit}</span> : null}
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
        {photos.map((photo) => {
          const url = urls[photo.id]
          const removing = deletingId === photo.id
          return (
            <div key={photo.id} className="group relative aspect-square overflow-hidden rounded-lg border border-oc-line bg-oc-sunken">
              {url && url !== 'error' ? (
                <button type="button" className="h-full w-full" onClick={() => setViewing(url)} aria-label={`View ${title.toLowerCase()} photo`}>
                  <img src={url} alt="" className="h-full w-full object-cover" data-testid="job-photo" />
                </button>
              ) : (
                <div className="grid h-full w-full place-items-center text-oc-muted">
                  {url === 'error' ? <ImageOff className="h-5 w-5" aria-label="Photo unavailable" /> : <Spinner className="h-4 w-4" />}
                </div>
              )}
              {photo.can_delete && (
                confirming === photo.id ? (
                  <div className="absolute inset-0 grid place-items-center gap-1 bg-black/60 p-1 text-center">
                    <button type="button" className="rounded-md bg-red-600 px-2 py-1 text-[11px] font-extrabold text-white"
                      onClick={() => { setConfirming(null); onDelete(photo) }} data-testid="confirm-remove-photo">
                      Remove
                    </button>
                    <button type="button" className="text-[11px] font-bold text-white underline" onClick={() => setConfirming(null)}>Cancel</button>
                  </div>
                ) : (
                  <button type="button" disabled={Boolean(deletingId)} onClick={() => setConfirming(photo.id)}
                    className="absolute right-1 top-1 grid h-7 w-7 place-items-center rounded-full bg-white/90 text-red-700 shadow"
                    aria-label="Remove photo" data-testid="remove-photo">
                    {removing ? <Spinner className="h-3.5 w-3.5" /> : <Trash2 className="h-3.5 w-3.5" />}
                  </button>
                )
              )}
            </div>
          )
        })}

        {uploading && (
          <div className="grid aspect-square place-items-center rounded-lg border border-dashed border-oc-green bg-oc-mint/40 p-2 text-center" data-testid={`uploading-${kind}`}>
            <div className="w-full">
              <Spinner className="mx-auto h-4 w-4" />
              <div className="mt-2 h-1 overflow-hidden rounded-full bg-white">
                <div className="h-full bg-oc-green transition-all" style={{ width: `${uploading.percent ?? 5}%` }} />
              </div>
              <p className="mt-1 text-[11px] font-bold text-oc-green">{uploading.percent ?? 0}%</p>
            </div>
          </div>
        )}

        {canAdd && !uploading && (
          <>
            <button type="button" onClick={() => input.current?.click()}
              className="grid aspect-square place-items-center rounded-lg border-2 border-dashed border-oc-line text-oc-green transition hover:border-oc-green hover:bg-oc-mint/40"
              data-testid={`add-photo-${kind}`}>
              <span className="flex flex-col items-center gap-1 text-xs font-extrabold">
                <ImagePlus className="h-5 w-5" /> Add photo
              </span>
            </button>
            <input ref={input} type="file" accept={PHOTO_ACCEPT} multiple hidden onChange={pick} data-testid={`photo-input-${kind}`} />
          </>
        )}
      </div>

      {photos.length === 0 && !canAdd && !uploading && <p className="mt-1 text-sm text-oc-muted">{emptyText}</p>}
      {addHint && <p className="mt-2 text-xs text-oc-muted">{addHint}</p>}

      {viewing && <PhotoViewer url={viewing} title={title} onClose={() => setViewing(null)} />}
    </section>
  )
}

function PhotoViewer({ url, title, onClose }) {
  useEffect(() => {
    const onKey = (event) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/80 p-4" role="dialog" aria-modal="true" aria-label={title} onClick={onClose} data-testid="photo-viewer">
      <button type="button" onClick={onClose} className="absolute right-4 top-4 grid h-10 w-10 place-items-center rounded-full bg-white text-oc-ink" aria-label="Close photo">
        <X className="h-5 w-5" />
      </button>
      <img src={url} alt="" className="max-h-full max-w-full rounded-lg object-contain" onClick={(event) => event.stopPropagation()} />
    </div>
  )
}
