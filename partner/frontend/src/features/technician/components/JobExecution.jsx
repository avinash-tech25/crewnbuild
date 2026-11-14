import { useCallback, useEffect, useState } from 'react'
import { RotateCw } from 'lucide-react'
import { Alert, Spinner } from '../../../shared/ui/ui.jsx'
import { usePrivatePhotos } from '../../../shared/hooks/usePrivatePhotos.js'
import { apiErrorMessage } from '../../../shared/api/apiClient.js'
import { jobExecutionApi } from '../jobExecutionApi.js'
import JobChecklist from './JobChecklist.jsx'
import JobPhotos from './JobPhotos.jsx'
import ServiceNotes from './ServiceNotes.jsx'
import {
  KIND_AFTER, KIND_BEFORE, KIND_CUSTOMER, canUpload, cleanNotes, completionWarnings, photoLimit, photoProblem, photosOf,
} from '../jobExecutionRules.js'

/**
 * The work itself, for a job the technician is on site for: the checklist, the
 * before and after photos and the service notes (Stage A endpoints).
 *
 * Nothing here moves the job's status -- Start work and Mark completed stay the
 * card's own buttons. What may be changed comes from the server's answer
 * (`can_edit_steps`, `can_edit_notes`, `can_upload`, each photo's `can_delete`),
 * and every change is shown as the server returns it, never assumed.
 */
export default function JobExecution({ job, onSummary }) {
  const [execution, setExecution] = useState(null)
  const [loadError, setLoadError] = useState('')
  const [message, setMessage] = useState({ tone: 'info', text: '' })
  const [busyStepId, setBusyStepId] = useState(null)
  const [savingNotes, setSavingNotes] = useState(false)
  const [uploading, setUploading] = useState(null) // { kind, percent }
  const [deletingId, setDeletingId] = useState(null)

  const load = useCallback(async () => {
    try {
      setExecution(await jobExecutionApi.load(job.id))
      setLoadError('')
    } catch (error) {
      setLoadError(error?.response?.status === 404
        ? 'The details of this job are no longer available.'
        : apiErrorMessage(error, 'The job details could not be loaded.'))
    }
  }, [job.id])

  // Again whenever the status moves on: what may be edited changes with it.
  useEffect(() => { load() }, [load, job.status])

  useEffect(() => { onSummary?.(execution ? completionWarnings(execution) : null) }, [execution, onSummary])

  const loadBlob = useCallback((mediaId, signal) => jobExecutionApi.photoBlob(job.id, mediaId, signal), [job.id])
  const urls = usePrivatePhotos(loadBlob, (execution?.media || []).map((item) => item.id))

  const fail = (error, fallback) => {
    setMessage({ tone: 'error', text: apiErrorMessage(error, fallback) })
    // A refusal usually means the job moved on meanwhile: show it as it is now.
    if ([403, 404, 409].includes(error?.response?.status)) load()
  }

  const toggleStep = async (step) => {
    setBusyStepId(step.id)
    setMessage({ tone: 'info', text: '' })
    try {
      setExecution(await jobExecutionApi.setStep(job.id, step.id, !step.completed))
    } catch (error) {
      fail(error, 'The step could not be updated.')
    } finally {
      setBusyStepId(null)
    }
  }

  const saveNotes = async (draft) => {
    setSavingNotes(true)
    setMessage({ tone: 'info', text: '' })
    try {
      setExecution(await jobExecutionApi.saveNotes(job.id, cleanNotes(draft)))
      setMessage({ tone: 'success', text: 'Service notes saved.' })
    } catch (error) {
      fail(error, 'The notes could not be saved.')
    } finally {
      setSavingNotes(false)
    }
  }

  const addPhotos = async (kind, files) => {
    setMessage({ tone: 'info', text: '' })
    let count = photosOf(execution, kind).length
    const limit = photoLimit(execution, kind)
    let added = 0
    for (const file of files) {
      const problem = photoProblem(file, { count, limit })
      if (problem) {
        setMessage({ tone: 'error', text: files.length > 1 ? `${file.name}: ${problem}` : problem })
        if (count >= limit) break
        continue
      }
      setUploading({ kind, percent: 0 })
      try {
        await jobExecutionApi.uploadPhoto(job.id, kind, file, (percent) => setUploading({ kind, percent }))
        count += 1
        added += 1
      } catch (error) {
        fail(error, 'The photo could not be uploaded.')
        break
      }
    }
    setUploading(null)
    if (added) {
      await load()
      setMessage((current) => (current.tone === 'error' ? current : { tone: 'success', text: added === 1 ? 'Photo added.' : `${added} photos added.` }))
    }
  }

  const deletePhoto = async (photo) => {
    setDeletingId(photo.id)
    setMessage({ tone: 'info', text: '' })
    try {
      await jobExecutionApi.deletePhoto(job.id, photo.id)
      await load()
      setMessage({ tone: 'success', text: 'Photo removed.' })
    } catch (error) {
      fail(error, 'The photo could not be removed.')
    } finally {
      setDeletingId(null)
    }
  }

  if (!execution) {
    return (
      <div className="rounded-xl border border-oc-line bg-white p-4" data-testid="job-execution">
        {loadError ? (
          <div className="space-y-2">
            <Alert tone="error">{loadError}</Alert>
            <button type="button" className="btn-ghost px-3 py-2" onClick={load}><RotateCw className="h-4 w-4" /> Try again</button>
          </div>
        ) : (
          <p className="flex items-center gap-2 text-sm text-oc-muted"><Spinner className="h-4 w-4" /> Loading the job steps and photos…</p>
        )}
      </div>
    )
  }

  const status = execution.status
  const customerPhotos = photosOf(execution, KIND_CUSTOMER)
  const photoSection = (kind, title, hint, emptyText) => (
    <JobPhotos
      kind={kind}
      title={title}
      photos={photosOf(execution, kind)}
      urls={urls}
      limit={photoLimit(execution, kind)}
      canAdd={canUpload(execution, kind)}
      addHint={hint}
      uploading={uploading?.kind === kind ? uploading : null}
      deletingId={deletingId}
      onAdd={(files) => addPhotos(kind, files)}
      onDelete={deletePhoto}
      emptyText={emptyText}
    />
  )

  return (
    <div className="space-y-3" data-testid="job-execution" data-status={status}>
      {message.text && <Alert tone={message.tone}>{message.text}</Alert>}

      <JobChecklist
        execution={execution}
        busyStepId={busyStepId}
        onToggle={toggleStep}
        hint={status === 'ARRIVED' && execution.steps_total > 0 ? 'Start work to tick off the steps.' : ''}
      />

      {customerPhotos.length > 0 && (
        <JobPhotos kind={KIND_CUSTOMER} title="Photos from the customer" photos={customerPhotos} urls={urls} canAdd={false} deletingId={deletingId} onAdd={() => {}} onDelete={() => {}} />
      )}

      <div className="grid gap-3 lg:grid-cols-2">
        {photoSection(KIND_BEFORE, 'Before work', '', 'No before-work photos.')}
        {photoSection(
          KIND_AFTER,
          'After work',
          status === 'ARRIVED' ? 'After-work photos can be added once you start work.' : '',
          'No after-work photos.',
        )}
      </div>

      {status !== 'ARRIVED' && (
        <ServiceNotes
          saved={execution.service_notes}
          savedAt={execution.service_notes_updated_at}
          editable={execution.can_edit_notes}
          saving={savingNotes}
          onSave={saveNotes}
        />
      )}
    </div>
  )
}
