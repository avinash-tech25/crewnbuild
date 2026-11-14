// Display helpers for the progress fields every project payload carries.
//
// The backend calculates both measurements (progress_service.py); nothing is
// recalculated here. `completion_percentage` is verified construction
// completion and is null while it cannot be measured -- shown as "Not
// available", never as 0%. The schedule fields say how much of the planned
// duration has elapsed, which is a different thing and is labelled as such.

// Verified completion as a 0-100 number, or null when it is not available.
export function completionPercent(project) {
  const value = project?.completion_percentage
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? Math.max(0, Math.min(100, number)) : null
}

// Bar width: an unavailable completion draws an empty bar beside its label.
export const completionWidth = (project) => completionPercent(project) ?? 0

export const formatPercent = (value) => `${Number.isInteger(value) ? value : Number(value).toFixed(1)}%`

export function completionText(project, t) {
  const percent = completionPercent(project)
  return percent === null ? t('progress.notAvailable') : formatPercent(percent)
}

// Average over the projects whose completion is known; null when none is.
export function averageCompletion(projects) {
  const known = (projects || []).map(completionPercent).filter((value) => value !== null)
  if (!known.length) return null
  return Math.round((known.reduce((sum, value) => sum + value, 0) / known.length) * 10) / 10
}

// Bar width for elapsed planned time: the same figure the schedule text shows
// in brackets, full once the end date has passed, empty otherwise.
export function scheduleWidth(project) {
  if (project?.schedule_status === 'end_date_passed') return 100
  if (project?.schedule_status !== 'in_progress') return 0
  const number = Number(project.schedule_progress_percentage)
  return Number.isFinite(number) ? Math.max(0, Math.min(100, number)) : 0
}

// Average elapsed planned time over the projects that have a schedule figure
// (in progress or past their end date); null when none has.
export function averageSchedule(projects) {
  const known = (projects || []).filter((project) => ['in_progress', 'end_date_passed'].includes(project?.schedule_status)).map(scheduleWidth)
  if (!known.length) return null
  return Math.round((known.reduce((sum, value) => sum + value, 0) / known.length) * 10) / 10
}

// "Day 12 of 92 (13%)", or the reason there is no schedule figure.
export function scheduleText(project, t) {
  switch (project?.schedule_status) {
    case 'in_progress':
      return t('progress.scheduleDays', { elapsed: project.schedule_elapsed_days, total: project.schedule_total_days, percent: formatPercent(project.schedule_progress_percentage) })
    case 'end_date_passed':
      return t('progress.scheduleEnded', { total: project.schedule_total_days })
    case 'not_started':
      return t('progress.scheduleNotStarted')
    case 'dates_invalid':
      return t('progress.scheduleInvalid')
    case 'dates_missing':
      return t('progress.scheduleNoDates')
    default:
      return ''
  }
}
