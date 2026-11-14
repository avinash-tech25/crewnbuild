/**
 * One project, in full.
 *
 * Same drawer pattern as the account view: an administrator reviewing a list is
 * checking one project against the others, and a separate page loses their
 * place, their filter and their scroll position.
 *
 * The owner's country and the site's country are shown side by side and labelled
 * as different things. They differ often, and the distinction is the rule the
 * whole administrative scope rests on. Presenting them as one field is how that
 * gets forgotten.
 */

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Flag, HardHat, MapPin, User, X } from 'lucide-react'
import { fetchProjectDetail } from '../adminApi.js'
import { completionPercent, formatPercent } from '../../../shared/utils/projectProgress.js'

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

function Person({ icon: Icon, role, person }) {
  return (
    <div className="flex items-center gap-2.5 rounded-xl bg-slate-50 px-3 py-2">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-white text-brand-600">
        <Icon className="h-4 w-4" />
      </span>
      <span className="min-w-0">
        <span className="block text-[10px] font-extrabold uppercase tracking-[0.12em] text-slate-400">
          {role}
        </span>
        {person ? (
          <>
            <span className="block truncate text-sm font-semibold text-graphite">{person.name}</span>
            <span className="block truncate text-[11px] text-slate-500">
              {person.country || '—'}
              {person.status !== 'ACTIVE' && ' · suspended'}
            </span>
          </>
        ) : (
          <span className="block text-sm font-medium text-slate-400">Not assigned</span>
        )}
      </span>
    </div>
  )
}

export function ProjectDetailDrawer({ projectId, onClose }) {
  const [detail, setDetail] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!projectId) return undefined
    let cancelled = false
    setDetail(null)
    setError('')
    fetchProjectDetail(projectId)
      .then((data) => !cancelled && setDetail(data))
      .catch((loadError) =>
        !cancelled && setError(loadError.response?.data?.detail || 'Could not load this project.'),
      )
    return () => {
      cancelled = true
    }
  }, [projectId])

  useEffect(() => {
    const onKey = (event) => event.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  if (!projectId) return null

  return createPortal(
    <div className="fixed inset-0 z-50 flex justify-end">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-slate-900/30 backdrop-blur-[2px]"
      />
      <div className="relative flex h-full w-full max-w-lg flex-col overflow-y-auto bg-white shadow-2xl">
        <header className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-slate-200 bg-white px-6 py-4">
          <div className="min-w-0">
            <p className="font-display text-lg font-bold text-graphite">
              {detail?.title || 'Loading…'}
            </p>
            {detail && (
              <p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                <span className="rounded-md bg-slate-100 px-2 py-0.5 font-bold text-slate-600">
                  #{detail.id}
                </span>
                <span className="rounded-md bg-oc-mint px-2 py-0.5 font-bold text-oc-deep">
                  {detail.status}
                </span>
                <span className="tabular-nums">{completionPercent(detail) === null ? 'Completion not available' : `${formatPercent(completionPercent(detail))} complete`}</span>
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
            <Section title="Where it is">
              <div className="flex items-start gap-2.5">
                <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" />
                <div>
                  <p className="text-sm font-semibold text-graphite">
                    {[detail.project_city, detail.project_state, detail.project_country]
                      .filter(Boolean)
                      .join(', ')}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {detail.address} · {detail.pincode}
                  </p>
                  {/* Stated outright, because it is the rule the scope rests on. */}
                  <p className="mt-1.5 text-[11px] font-medium text-slate-400">
                    This project is administered by {detail.project_country || 'India'} because that
                    is where the site is
                    {detail.owner && detail.owner.country !== detail.project_country
                      ? `, not ${detail.owner.country} where its owner lives.`
                      : '.'}
                  </p>
                </div>
              </div>
            </Section>

            <Section title="Who is on it">
              <div className="grid gap-2">
                <Person icon={User} role="House Owner" person={detail.owner} />
                <Person icon={HardHat} role="Builder" person={detail.contractor} />
                {detail.engineers?.map((engineer) => (
                  <Person key={engineer.id} icon={HardHat} role="Site Engineer" person={engineer} />
                ))}
              </div>
            </Section>

            <Section title="The brief">
              <dl className="grid grid-cols-2 gap-3">
                <Field label="Budget">{detail.budget ? detail.budget.toLocaleString() : '—'}</Field>
                <Field label="Land area">{detail.land_area || '—'}</Field>
                <Field label="Floors">{detail.floors}</Field>
                <Field label="Building type">{detail.building_type}</Field>
                <Field label="Construction type">{detail.construction_type}</Field>
                <Field label="Compliance">{detail.compliance_status}</Field>
                <Field label="Created">
                  {new Date(detail.created_at).toLocaleDateString()}
                </Field>
              </dl>
              <p className="mt-3 text-xs text-slate-500">{detail.description}</p>
            </Section>

            {detail.reports?.length > 0 && (
              <Section title="Disputes">
                <ul className="grid gap-2">
                  {detail.reports.map((report) => (
                    <li key={report.id} className="rounded-xl bg-amber-50/70 px-3 py-2">
                      <p className="flex items-center gap-1.5 text-xs font-extrabold text-amber-800">
                        <Flag className="h-3 w-3" /> {report.category.replace(/_/g, ' ')} ·{' '}
                        {report.status.replace(/_/g, ' ')}
                      </p>
                      <p className="mt-0.5 text-xs text-slate-600">{report.description}</p>
                    </li>
                  ))}
                </ul>
              </Section>
            )}

            <Section title="Site activity">
              {detail.timeline?.length ? (
                <ol className="grid gap-2.5">
                  {detail.timeline.map((entry) => (
                    <li key={entry.id} className="border-l-2 border-slate-200 pl-3">
                      <p className="text-sm font-semibold text-graphite">{entry.title}</p>
                      <p className="text-[11px] text-slate-400">
                        {new Date(entry.date).toLocaleDateString()} · {entry.completion_status}
                      </p>
                      {entry.description && (
                        <p className="mt-0.5 text-xs text-slate-500">{entry.description}</p>
                      )}
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="text-xs font-medium text-slate-400">
                  Nothing has been recorded on site yet.
                </p>
              )}
            </Section>
          </>
        )}
      </div>
    </div>,
    document.body,
  )
}
