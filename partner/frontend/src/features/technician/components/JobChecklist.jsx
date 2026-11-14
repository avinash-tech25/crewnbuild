import { Check, ListChecks } from 'lucide-react'
import { Spinner } from '../../../shared/ui/ui.jsx'

/**
 * The job's steps, copied from the service's checklist when the booking was made.
 * Ticking them is a record of the work; it never moves the job's status.
 */
export default function JobChecklist({ execution, busyStepId, onToggle, hint }) {
  const steps = execution.steps
  const editable = execution.can_edit_steps
  const done = execution.steps_completed
  const total = execution.steps_total

  return (
    <section className="rounded-xl border border-oc-line bg-white p-4" aria-labelledby="job-steps-title" data-testid="job-checklist">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 id="job-steps-title" className="flex items-center gap-2 font-display text-sm font-extrabold uppercase tracking-wide text-oc-ink">
          <ListChecks className="h-4 w-4 text-oc-green" /> Job steps
        </h4>
        {total > 0 && (
          <span className="text-xs font-extrabold text-oc-green" data-testid="steps-progress">{done} of {total} completed</span>
        )}
      </div>

      {total === 0 ? (
        <p className="mt-2 text-sm text-oc-muted">There is no checklist for this job.</p>
      ) : (
        <>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-oc-sunken" aria-hidden="true">
            <div className="h-full rounded-full bg-oc-green transition-all" style={{ width: `${Math.round((done / total) * 100)}%` }} />
          </div>
          <ol className="mt-3 space-y-1.5">
            {steps.map((step) => {
              const busy = busyStepId === step.id
              return (
                <li key={step.id}>
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={step.completed}
                    disabled={!editable || Boolean(busyStepId)}
                    onClick={() => onToggle(step)}
                    className={`flex w-full items-start gap-3 rounded-lg px-2 py-2 text-left text-sm transition ${
                      editable ? 'hover:bg-oc-sunken' : 'cursor-default'
                    } disabled:opacity-100`}
                    data-testid="job-step"
                  >
                    <span
                      className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-md border-2 ${
                        step.completed ? 'border-oc-green bg-oc-green text-white' : 'border-oc-line bg-white'
                      }`}
                    >
                      {busy ? <Spinner className="h-3 w-3" /> : step.completed && <Check className="h-3.5 w-3.5" />}
                    </span>
                    <span className={step.completed ? 'text-oc-muted line-through decoration-oc-muted/60' : 'font-semibold text-oc-ink'}>
                      {step.title}
                    </span>
                  </button>
                </li>
              )
            })}
          </ol>
        </>
      )}
      {hint && <p className="mt-2 text-xs text-oc-muted">{hint}</p>}
    </section>
  )
}
