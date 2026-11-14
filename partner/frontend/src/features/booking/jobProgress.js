/**
 * What the requester's job-progress panel shows, from the existing read-only
 * execution response. No imports: unit-tested under Node.
 *
 * Deliberately left out: `service_notes` (the technician's working notes) and
 * every "can_*" permission -- the requester's page only reads.
 */

// From acceptance on the technician holds the job and its checklist exists.
export const PROGRESS_STATUSES = ['ACCEPTED', 'EN_ROUTE', 'ARRIVED', 'IN_PROGRESS', 'COMPLETED']
// While the technician is on site, progress changes; refresh it.
export const LIVE_PROGRESS_STATUSES = ['ARRIVED', 'IN_PROGRESS']

export const PHOTO_GROUPS = [
  { kind: 'BEFORE', label: 'Before work' },
  { kind: 'AFTER', label: 'After work' },
  { kind: 'CUSTOMER', label: 'Your photos' },
]

/** The parts of the response the panel may show, and nothing else. */
export function progressView(execution) {
  if (!execution) return null
  const steps = (execution.steps || [])
    .slice()
    .sort((a, b) => a.position - b.position)
    .map((step) => ({ id: step.id, title: step.title, completed: Boolean(step.completed), completedAt: step.completed_at || null }))
  const total = Number.isFinite(execution.steps_total) ? execution.steps_total : steps.length
  const done = Number.isFinite(execution.steps_completed) ? execution.steps_completed : steps.filter((step) => step.completed).length
  const photos = PHOTO_GROUPS.map((group) => ({
    ...group,
    items: (execution.media || []).filter((item) => item.kind === group.kind).map((item) => ({ id: item.id, createdAt: item.created_at })),
  })).filter((group) => group.items.length > 0)
  return { steps, total, done, percent: total > 0 ? Math.round((done / total) * 100) : 0, photos }
}

/** One line for where the job is, in the requester's words. */
export function stageLabel(status) {
  return {
    ACCEPTED: 'Technician accepted your job',
    EN_ROUTE: 'Technician is on the way',
    ARRIVED: 'Technician has arrived',
    IN_PROGRESS: 'Work in progress',
    COMPLETED: 'Job completed',
  }[status] || ''
}
