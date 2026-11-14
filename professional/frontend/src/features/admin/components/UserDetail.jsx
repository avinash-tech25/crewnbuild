/**
 * One account, in full.
 *
 * A drawer rather than a separate page: an administrator working a list is
 * checking one account against the others, and sending them to a new screen
 * loses their place, their filter and their scroll position.
 */

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, Copy, ExternalLink, FileText, ShieldCheck, X } from 'lucide-react'
import { imageUrl } from '../../../shared/api/apiClient.js'
import { fetchUserDetail } from '../adminApi.js'

function Field({ label, children }) {
  if (children === null || children === undefined || children === '') return null
  return (
    <div>
      <dt className="text-[10px] font-extrabold uppercase tracking-[0.12em] text-slate-400">
        {label}
      </dt>
      <dd className="mt-0.5 text-sm font-semibold text-graphite">{children}</dd>
    </div>
  )
}

function Section({ title, children }) {
  return (
    <section className="border-t border-slate-100 px-6 py-4">
      <h3 className="text-[11px] font-extrabold uppercase tracking-[0.12em] text-slate-400">
        {title}
      </h3>
      <div className="mt-2.5">{children}</div>
    </section>
  )
}

// Copies a value to the clipboard and says so for a moment. Falls back to a
// hidden textarea where the async Clipboard API is unavailable (plain http on
// a LAN address, older browsers).
function CopyButton({ value, label }) {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return undefined
    const timer = setTimeout(() => setCopied(false), 1500)
    return () => clearTimeout(timer)
  }, [copied])
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value)
    } catch {
      const area = document.createElement('textarea')
      area.value = value
      area.setAttribute('readonly', '')
      area.style.position = 'fixed'
      area.style.opacity = '0'
      document.body.appendChild(area)
      area.select()
      document.execCommand('copy')
      document.body.removeChild(area)
    }
    setCopied(true)
  }
  return (
    <button
      type="button"
      onClick={copy}
      aria-label={label}
      title={copied ? 'Copied' : label}
      className={`inline-flex h-7 shrink-0 items-center gap-1 rounded-lg border px-2 text-[11px] font-bold transition ${
        copied
          ? 'border-ocbrand-100 bg-ocbrand-50 text-ocbrand-700'
          : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:text-graphite'
      }`}
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      {copied ? 'Copied' : 'Copy'}
    </button>
  )
}

const VERIFICATION_TONE = {
  APPROVED: 'bg-ocbrand-50 text-ocbrand-700',
  REJECTED: 'bg-red-50 text-red-600',
  MORE_INFO_REQUESTED: 'bg-amber-50 text-amber-700',
  PENDING: 'bg-slate-100 text-slate-500',
}

export function UserDetailDrawer({ userId, onClose }) {
  const [detail, setDetail] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!userId) return undefined
    let cancelled = false
    setDetail(null)
    setError('')
    fetchUserDetail(userId)
      .then((data) => !cancelled && setDetail(data))
      .catch((loadError) =>
        !cancelled && setError(loadError.response?.data?.detail || 'Could not load this account.'),
      )
    return () => {
      cancelled = true
    }
  }, [userId])

  // Escape closes it, because a panel that can only be dismissed with the mouse
  // is a panel somebody gets stuck in.
  useEffect(() => {
    const onKey = (event) => event.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  if (!userId) return null

  const verification = detail?.verification

  return createPortal(
    // Centred in the viewport rather than docked to the right edge. The list
    // behind it stays where it was, so the administrator still keeps their
    // place, filter and scroll position.
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-slate-900/30 backdrop-blur-[2px]"
      />
      <div role="dialog" aria-modal="true" className="relative flex max-h-[90vh] w-full max-w-lg flex-col overflow-y-auto rounded-2xl bg-white shadow-2xl">
        <header className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-slate-200 bg-white px-6 py-4">
          <div className="min-w-0">
            <p className="font-display text-lg font-bold text-graphite">
              {detail?.name || 'Loading…'}
            </p>
            {detail && (
              <p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                <span className="rounded-md bg-slate-100 px-2 py-0.5 font-bold text-slate-600">
                  {detail.supplier_category || detail.role}
                </span>
                {detail.verification?.verified && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-ocbrand-50 px-2 py-0.5 font-extrabold text-ocbrand-700">
                    <ShieldCheck className="h-3 w-3" /> Verified
                  </span>
                )}
                <span
                  className={`rounded-full px-2 py-0.5 font-extrabold ${
                    detail.status === 'ACTIVE'
                      ? 'bg-ocbrand-50 text-ocbrand-700'
                      : 'bg-red-50 text-red-600'
                  }`}
                >
                  {detail.status === 'ACTIVE' ? 'Active' : 'Suspended'}
                </span>
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        {error && <p className="px-6 py-10 text-center text-sm text-slate-500">{error}</p>}
        {!error && !detail && (
          <p className="px-6 py-10 text-center text-sm text-slate-500">Loading…</p>
        )}

        {detail && (
          <>
            <Section title="Account">
              <dl className="grid grid-cols-2 gap-3">
                <Field label="Email">
                  {detail.email && (
                    <span className="inline-flex max-w-full items-center gap-2">
                      <span className="truncate">{detail.email}</span>
                      <CopyButton value={detail.email} label="Copy email" />
                    </span>
                  )}
                </Field>
                <Field label="Phone">{detail.phone || '—'}</Field>
                <Field label="Country">{detail.country || '—'}</Field>
                <Field label="Pincode">{detail.pincode || '—'}</Field>
                <Field label="Joined">{new Date(detail.created_at).toLocaleDateString()}</Field>
                <Field label="Profile">
                  {detail.profile_complete ? 'Complete' : 'Incomplete'}
                </Field>
              </dl>
              <p className="mt-3 text-xs text-slate-500">{detail.address}</p>
            </Section>

            {detail.profile && (
              <Section title="Business">
                <dl className="grid grid-cols-2 gap-3">
                  {Object.entries(detail.profile).map(([key, value]) =>
                    value === null || value === '' ? null : (
                      <Field key={key} label={key.replace(/_/g, ' ')}>
                        {String(value)}
                      </Field>
                    ),
                  )}
                </dl>
              </Section>
            )}

            {verification?.status && (
              <Section title="Verification">
                <span
                  className={`inline-block rounded-full px-2.5 py-0.5 text-[11px] font-extrabold ${
                    VERIFICATION_TONE[verification.status] || 'bg-slate-100 text-slate-500'
                  }`}
                >
                  {verification.status.replace(/_/g, ' ')}
                </span>
                {verification.reviewer_email && (
                  <p className="mt-2 text-xs text-slate-500">
                    Reviewed by {verification.reviewer_email} on{' '}
                    {new Date(verification.reviewed_at).toLocaleDateString()}
                    {verification.expires_on &&
                      ` · expires ${new Date(verification.expires_on).toLocaleDateString()}`}
                  </p>
                )}
                {verification.notes && (
                  <p className="mt-1.5 text-xs font-medium text-amber-700">{verification.notes}</p>
                )}
              </Section>
            )}

            {detail.documents?.length > 0 && (
              <Section title="Documents">
                <ul className="grid gap-1.5">
                  {detail.documents.map((document) => (
                    <li key={`${document.label}-${document.url}`}>
                      <a
                        href={imageUrl(document.url)}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-bold text-graphite hover:border-brand-400"
                      >
                        <FileText className="h-3.5 w-3.5 text-slate-400" />
                        {document.label}
                        <ExternalLink className="h-3 w-3 text-slate-300" />
                      </a>
                    </li>
                  ))}
                </ul>
              </Section>
            )}

            {(detail.projects_owned?.length > 0 || detail.projects_building?.length > 0) && (
              <Section title="Projects">
                {[
                  ['Owns', detail.projects_owned],
                  ['Building', detail.projects_building],
                ].map(([label, list]) =>
                  list?.length ? (
                    <div key={label} className="mb-2.5 last:mb-0">
                      <p className="text-[11px] font-bold text-slate-400">{label}</p>
                      <ul className="mt-1 grid gap-1">
                        {list.map((project) => (
                          <li
                            key={project.id}
                            className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-1.5 text-xs"
                          >
                            <span className="font-semibold text-graphite">{project.title}</span>
                            <span className="text-slate-500">{project.status}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null,
                )}
              </Section>
            )}
          </>
        )}
      </div>
    </div>,
    document.body,
  )
}
