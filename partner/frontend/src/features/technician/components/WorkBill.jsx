import { useCallback, useEffect, useState } from 'react'
import { CalendarDays, FileCheck2, Pencil, Plus, ReceiptText, RotateCw, Send, Trash2 } from 'lucide-react'
import { Alert, Spinner } from '../../../shared/ui/ui.jsx'
import { usePrivatePhotos } from '../../../shared/hooks/usePrivatePhotos.js'
import { apiErrorMessage } from '../../../shared/api/apiClient.js'
import { formatRupees } from '../../../shared/utils/money.js'
import BillItemForm from './BillItemForm.jsx'
import JobPhotos from './JobPhotos.jsx'
import ServiceNotes from './ServiceNotes.jsx'
import { cleanNotes, photoProblem } from '../jobExecutionRules.js'
import {
  KIND_BILL, KIND_LABOUR, KIND_MATERIAL, billLimit, billStatusLabel, emptyItem, formatQuantity, indiaToday, itemForm, itemPayload,
} from '../workBillRules.js'

const asUtc = (value) => new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(value) ? value : `${value}Z`)
const money = (value) => (value === null || value === undefined ? '—' : formatRupees(value))

/**
 * The work bill: materials and additional labour on top of the service price.
 *
 * Informational only -- it does not move the job and is not a payment. The
 * technician edits a DRAFT while the job is in progress and may submit it,
 * which locks it; completing the job submits a draft too. The requester sees
 * the same bill read-only (`readOnly`, with the requester's read-only `api`).
 *
 * What may be changed comes from the server (`can_edit`, `can_submit`, each
 * photo's `can_delete`), and every change is shown as the server returns it.
 */
export default function WorkBill({ jobId, status, api, readOnly = false }) {
  const [bill, setBill] = useState(null)
  const [loadError, setLoadError] = useState('')
  const [message, setMessage] = useState({ tone: 'info', text: '' })
  const [editing, setEditing] = useState(null) // { kind, item? }
  const [busy, setBusy] = useState('') // 'save' | 'notes' | 'submit' | `delete:<id>`
  const [confirm, setConfirm] = useState('') // 'submit' | `delete:<id>`
  const [uploading, setUploading] = useState(null) // { key, percent }
  const [deletingId, setDeletingId] = useState(null)
  const today = indiaToday()

  const load = useCallback(async () => {
    try {
      setBill(await api.load(jobId))
      setLoadError('')
    } catch (error) {
      setLoadError(apiErrorMessage(error, 'The work bill could not be loaded.'))
    }
  }, [api, jobId])

  useEffect(() => { load() }, [load, status])

  // A bill that can no longer be changed closes any open form.
  useEffect(() => { if (bill && !bill.can_edit) { setEditing(null); setConfirm('') } }, [bill])

  const photoIds = bill ? [...bill.materials.flatMap((item) => item.photos), ...bill.attachments].map((photo) => photo.id) : []
  const loadBlob = useCallback((mediaId, signal) => api.photoBlob(jobId, mediaId, signal), [api, jobId])
  const urls = usePrivatePhotos(loadBlob, photoIds)

  const fail = (error, fallback) => {
    setMessage({ tone: 'error', text: apiErrorMessage(error, fallback) })
    // A refusal usually means the job or the bill moved on meanwhile.
    if ([403, 404, 409].includes(error?.response?.status)) load()
  }

  const run = async (key, work, fallback, success) => {
    setBusy(key)
    setMessage({ tone: 'info', text: '' })
    try {
      const next = await work()
      if (next) setBill(next)
      if (success) setMessage({ tone: 'success', text: success })
      return true
    } catch (error) {
      fail(error, fallback)
      return false
    } finally {
      setBusy('')
    }
  }

  const saveItem = async (form) => {
    const { kind, item } = editing
    const done = await run(
      'save',
      () => (item
        ? api.updateItem(jobId, item.id, itemPayload(form, kind, { withKind: false }))
        : api.addItem(jobId, itemPayload(form, kind))),
      'The line could not be saved.',
      item ? 'Line updated.' : kind === KIND_MATERIAL ? 'Material added.' : 'Labour added.',
    )
    if (done) setEditing(null)
  }

  const removeItem = (item) => {
    setConfirm('')
    run(`delete:${item.id}`, () => api.deleteItem(jobId, item.id), 'The line could not be removed.', 'Line removed.')
  }

  const saveNotes = (draft) => run('notes', () => api.saveNotes(jobId, cleanNotes(draft)), 'The bill notes could not be saved.', 'Bill notes saved.')

  const submit = () => {
    setConfirm('')
    run('submit', () => api.submit(jobId), 'The bill could not be submitted.', 'Bill submitted. The job is still in progress: mark it completed when the work is done.')
  }

  const addPhotos = async (key, files, count, limit, upload) => {
    setMessage({ tone: 'info', text: '' })
    let added = 0
    for (const file of files) {
      const problem = photoProblem(file, { count: count + added, limit })
      if (problem) {
        setMessage({ tone: 'error', text: files.length > 1 ? `${file.name}: ${problem}` : problem })
        if (count + added >= limit) break
        continue
      }
      setUploading({ key, percent: 0 })
      try {
        await upload(file, (percent) => setUploading({ key, percent }))
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
      await api.deletePhoto(jobId, photo.id)
      await load()
      setMessage({ tone: 'success', text: 'Photo removed.' })
    } catch (error) {
      fail(error, 'The photo could not be removed.')
    } finally {
      setDeletingId(null)
    }
  }

  if (!bill) {
    return (
      <section className="rounded-xl border border-oc-line bg-white p-4" data-testid="work-bill">
        {loadError ? (
          <div className="space-y-2">
            <Alert tone="error">{loadError}</Alert>
            <button type="button" className="btn-ghost px-3 py-2" onClick={load}><RotateCw className="h-4 w-4" /> Try again</button>
          </div>
        ) : (
          <p className="flex items-center gap-2 text-sm text-oc-muted"><Spinner className="h-4 w-4" /> Loading the work bill…</p>
        )}
      </section>
    )
  }

  const editable = !readOnly && bill.can_edit
  const lineCount = bill.materials.length + bill.labour.length
  const canAddLine = editable && lineCount < billLimit(bill, 'items') && !editing
  const finalized = bill.status === 'FINALIZED'
  const nothingBilled = bill.status === null

  const line = (item, index) => {
    const photoLimit = billLimit(bill, 'material_photos')
    const key = `material-${index + 1}`
    const removing = busy === `delete:${item.id}`
    if (editing?.item?.id === item.id) {
      return (
        <li key={item.id}>
          <BillItemForm kind={item.kind} initial={itemForm(item)} today={today} saving={busy === 'save'} onSave={saveItem} onCancel={() => setEditing(null)} />
        </li>
      )
    }
    return (
      <li key={item.id} className="rounded-lg border border-oc-line p-3" data-testid="bill-line" data-kind={item.kind}>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <p className="break-words font-bold text-oc-ink" data-testid="bill-line-name">{item.name}</p>
            <p className="text-sm text-oc-muted" data-testid="bill-line-math">
              {formatQuantity(item.quantity)} {item.unit} × {formatRupees(item.unit_price)}
              {item.kind === KIND_LABOUR && item.work_date && (
                <span className="ml-2 inline-flex items-center gap-1"><CalendarDays className="h-3.5 w-3.5" />{item.work_date}</span>
              )}
            </p>
            {item.description && <p className="mt-1 whitespace-pre-wrap break-words text-sm text-oc-ink">{item.description}</p>}
          </div>
          <p className="font-display text-base font-extrabold text-oc-ink" data-testid="bill-line-amount">{formatRupees(item.amount)}</p>
        </div>

        {editable && (
          confirm === `delete:${item.id}` ? (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-sm" role="alertdialog" aria-label="Remove this line?">
              <span className="font-bold text-red-700">Remove this line{item.photos.length ? ' and its photos' : ''}?</span>
              <button type="button" className="btn-danger px-3 py-1.5" onClick={() => removeItem(item)} data-testid="bill-line-confirm-remove">Remove</button>
              <button type="button" className="btn-ghost px-3 py-1.5" onClick={() => setConfirm('')}>Keep</button>
            </div>
          ) : (
            <div className="mt-2 flex gap-2">
              <button type="button" className="btn-ghost px-3 py-1.5 text-sm" disabled={Boolean(busy) || Boolean(editing)}
                onClick={() => setEditing({ kind: item.kind, item })} data-testid="bill-line-edit">
                <Pencil className="h-3.5 w-3.5" /> Edit
              </button>
              <button type="button" className="btn-ghost px-3 py-1.5 text-sm text-red-700" disabled={Boolean(busy) || Boolean(editing)}
                onClick={() => setConfirm(`delete:${item.id}`)} data-testid="bill-line-remove">
                {removing ? <Spinner className="h-3.5 w-3.5" /> : <Trash2 className="h-3.5 w-3.5" />} Remove
              </button>
            </div>
          )
        )}

        {item.kind === KIND_MATERIAL && (editable || item.photos.length > 0) && (
          <div className="mt-3">
            <JobPhotos
              kind={key}
              title={`Photos of ${item.name}`}
              photos={item.photos}
              urls={urls}
              limit={photoLimit}
              canAdd={editable && item.photos.length < photoLimit}
              uploading={uploading?.key === key ? uploading : null}
              deletingId={deletingId}
              onAdd={(files) => addPhotos(key, files, item.photos.length, photoLimit, (file, progress) => api.uploadMaterialPhoto(jobId, item.id, file, progress))}
              onDelete={deletePhoto}
              emptyText=""
            />
          </div>
        )}
      </li>
    )
  }

  const section = (kind, title, items, addLabel, emptyText) => (
    <div className="space-y-2" data-testid={`bill-${kind.toLowerCase()}`}>
      <div className="flex items-center justify-between gap-2">
        <h5 className="text-xs font-extrabold uppercase tracking-wide text-oc-muted">{title}</h5>
        {canAddLine && (
          <button type="button" className="btn-ghost px-3 py-1.5 text-sm" onClick={() => setEditing({ kind })} data-testid={`bill-add-${kind}`}>
            <Plus className="h-4 w-4" /> {addLabel}
          </button>
        )}
      </div>
      {items.length > 0 && <ul className="space-y-2">{items.map(line)}</ul>}
      {editable && editing && !editing.item && editing.kind === kind && (
        <BillItemForm kind={kind} initial={emptyItem(kind, today)} today={today} saving={busy === 'save'} onSave={saveItem} onCancel={() => setEditing(null)} />
      )}
      {items.length === 0 && !(editing?.kind === kind && !editing.item) && <p className="text-sm text-oc-muted">{emptyText}</p>}
    </div>
  )

  const attachmentLimit = billLimit(bill, 'attachments')

  return (
    <section className="space-y-4 rounded-xl border border-oc-line bg-white p-4" data-testid="work-bill" data-bill-status={bill.status || 'NONE'} aria-labelledby={`work-bill-${jobId}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 id={`work-bill-${jobId}`} className="flex items-center gap-2 font-display text-sm font-extrabold uppercase tracking-wide text-oc-ink">
          <ReceiptText className="h-4 w-4 text-oc-green" /> Work bill
        </h4>
        <span className={`rounded-full px-2.5 py-1 text-[11px] font-extrabold uppercase tracking-wide ${finalized ? 'bg-oc-green text-white' : 'bg-oc-sunken text-oc-muted'}`} data-testid="bill-status">
          {billStatusLabel(bill)}
        </span>
      </div>

      {message.text && <Alert tone={message.tone}>{message.text}</Alert>}
      {finalized && bill.finalized_at && (
        <p className="flex items-center gap-1.5 text-xs font-bold text-oc-green" data-testid="bill-finalized-at">
          <FileCheck2 className="h-4 w-4" /> Submitted {asUtc(bill.finalized_at).toLocaleString()} · read-only
        </p>
      )}

      {nothingBilled && !editable ? (
        <p className="text-sm text-oc-muted" data-testid="bill-empty">
          {readOnly && status === 'IN_PROGRESS' ? 'The technician has not added anything to the bill yet.' : 'No materials or additional labour were billed.'}
        </p>
      ) : (
        <>
          {section(KIND_MATERIAL, 'Materials', bill.materials, 'Add material', 'No materials.')}
          {section(KIND_LABOUR, 'Additional labour', bill.labour, 'Add labour', 'No additional labour.')}
          {(editable || bill.attachments.length > 0) && (
            <JobPhotos
              kind={KIND_BILL}
              title="Bill attachments"
              photos={bill.attachments}
              urls={urls}
              limit={attachmentLimit}
              canAdd={editable && bill.attachments.length < attachmentLimit}
              addHint={editable ? 'Photos of receipts or the invoice for materials. Images only.' : ''}
              uploading={uploading?.key === KIND_BILL ? uploading : null}
              deletingId={deletingId}
              onAdd={(files) => addPhotos(KIND_BILL, files, bill.attachments.length, attachmentLimit, (file, progress) => api.uploadAttachment(jobId, file, progress))}
              onDelete={deletePhoto}
              emptyText=""
            />
          )}
          {(editable || bill.notes) && (
            <ServiceNotes
              saved={bill.notes}
              savedAt={bill.updated_at}
              editable={editable}
              saving={busy === 'notes'}
              onSave={saveNotes}
              title="Bill notes"
              testId="bill-notes"
              testIdPrefix="bill-"
              placeholder="Anything the customer should know about this bill, e.g. Customer supplied the tap."
              emptyText="No bill notes."
            />
          )}
        </>
      )}

      <dl className="space-y-1.5 rounded-lg bg-oc-sunken p-3 text-sm" data-testid="bill-totals">
        <div className="flex justify-between gap-2" data-testid="bill-service-price"><dt className="text-oc-muted">Service price</dt><dd className="font-bold text-oc-ink">{money(bill.service_price)}</dd></div>
        <div className="flex justify-between gap-2" data-testid="bill-materials-total"><dt className="text-oc-muted">Materials</dt><dd className="font-bold text-oc-ink">{money(bill.materials_total)}</dd></div>
        <div className="flex justify-between gap-2" data-testid="bill-labour-total"><dt className="text-oc-muted">Additional labour</dt><dd className="font-bold text-oc-ink">{money(bill.additional_labour_total)}</dd></div>
        <div className="flex justify-between gap-2 border-t border-oc-line pt-1.5" data-testid="bill-total">
          <dt className="font-extrabold text-oc-ink">Work bill total</dt>
          <dd className="font-display text-base font-extrabold text-oc-ink">{nothingBilled && bill.service_price == null ? '—' : money(bill.bill_total)}</dd>
        </div>
      </dl>

      {!readOnly && bill.can_submit && (
        confirm === 'submit' ? (
          <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900" role="alertdialog" aria-label="Submit this bill?" data-testid="bill-submit-confirm">
            <p>After submitting, the bill can no longer be changed. The job stays in progress until you mark it completed.</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn-primary px-4 py-2" onClick={submit} data-testid="bill-submit-yes">
                {busy === 'submit' ? <Spinner className="h-4 w-4" /> : <Send className="h-4 w-4" />} Submit bill
              </button>
              <button type="button" className="btn-ghost px-3 py-2" onClick={() => setConfirm('')}>Keep editing</button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-oc-muted">Submitting is optional: completing the job submits the bill as it is.</p>
            <button type="button" className="btn-primary px-4 py-2" disabled={Boolean(busy) || Boolean(editing)} onClick={() => setConfirm('submit')} data-testid="bill-submit">
              <Send className="h-4 w-4" /> Submit bill
            </button>
          </div>
        )
      )}
    </section>
  )
}
