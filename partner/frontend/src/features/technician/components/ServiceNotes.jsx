import { useEffect, useState } from 'react'
import { NotebookPen, Save } from 'lucide-react'
import { Spinner } from '../../../shared/ui/ui.jsx'
import { NOTES_MAX_LENGTH, cleanNotes, notesLength, notesProblem } from '../jobExecutionRules.js'

/**
 * What the technician writes about the work. Editable only while the server says
 * so (the job is in progress); afterwards it is shown as the record of the job.
 * The counter and limit follow the server's rule: trimmed, at most 2000 characters.
 *
 * Also used for the work bill's notes, which are kept apart from these: `title`,
 * `testId` and the texts name which notes are shown.
 */
export default function ServiceNotes({
  saved, savedAt, editable, saving, onSave,
  title = 'Service notes', testId = 'service-notes', testIdPrefix = '',
  placeholder = 'What did you find, and what did you do? e.g. Replaced the damaged pipe joint and tested the water flow.',
  emptyText = 'No service notes were added.',
}) {
  const [draft, setDraft] = useState(saved || '')

  // A new value from the server (saved, or reloaded) replaces the draft.
  useEffect(() => { setDraft(saved || '') }, [saved])

  const problem = notesProblem(draft, title)
  const dirty = cleanNotes(draft) !== (saved ?? null)
  const length = notesLength(draft)

  return (
    <section className="rounded-xl border border-oc-line bg-white p-4" data-testid={testId} aria-labelledby={`${testId}-title`}>
      <h4 id={`${testId}-title`} className="flex items-center gap-2 font-display text-sm font-extrabold uppercase tracking-wide text-oc-ink">
        <NotebookPen className="h-4 w-4 text-oc-green" /> {title}
      </h4>

      {editable ? (
        <form className="mt-3 space-y-2" onSubmit={(event) => { event.preventDefault(); if (!problem && dirty) onSave(draft) }}>
          <textarea
            className="field-input min-h-[110px] resize-y"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={placeholder}
            aria-label={title}
            aria-invalid={Boolean(problem)}
            data-testid={`${testIdPrefix}notes-input`}
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className={`text-xs font-bold ${problem ? 'text-red-700' : 'text-oc-muted'}`} data-testid={`${testIdPrefix}notes-counter`}>
              {length}/{NOTES_MAX_LENGTH}
            </span>
            <button type="submit" className="btn-primary px-4 py-2" disabled={saving || !dirty || Boolean(problem)} data-testid={`${testIdPrefix}save-notes`}>
              {saving ? <Spinner className="h-4 w-4" /> : <Save className="h-4 w-4" />} Save notes
            </button>
          </div>
          {problem && <p className="text-xs font-bold text-red-700" role="alert">{problem}</p>}
        </form>
      ) : saved ? (
        <p className="mt-2 whitespace-pre-wrap break-words text-sm text-oc-ink" data-testid={`${testIdPrefix}notes-readonly`}>{saved}</p>
      ) : (
        <p className="mt-2 text-sm text-oc-muted" data-testid={`${testIdPrefix}notes-readonly`}>{emptyText}</p>
      )}
      {!editable && savedAt && saved && <p className="mt-1 text-[11px] text-oc-muted">Last updated {new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(savedAt) ? savedAt : `${savedAt}Z`).toLocaleString()}</p>}
    </section>
  )
}
