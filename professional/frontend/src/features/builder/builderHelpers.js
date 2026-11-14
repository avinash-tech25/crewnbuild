export const splitEditableList = (value) => String(value || '').split(',').map((item) => item.trim()).filter(Boolean)
// The builder's portfolio limits, the same ones the backend applies.
export const PORTFOLIO_MAX_PROJECTS = 4
export const PORTFOLIO_MAX_IMAGES = 6

export function normalizePortfolioProjects(projects) {
  return (Array.isArray(projects) ? projects : [])
    .map((project) => ({
      title: String(project?.title || '').trim(),
      location: String(project?.location || '').trim(),
      description: String(project?.description || '').trim(),
      // Only this project's own uploaded photos.
      images: (Array.isArray(project?.images) ? project.images : [])
        .map((image) => String(image || '').trim())
        .filter((image, index, list) => /^\/files\/\d+$/.test(image) && list.indexOf(image) === index)
        .slice(0, PORTFOLIO_MAX_IMAGES),
    }))
    .filter((project) => project.title || project.location || project.description)
    .slice(0, PORTFOLIO_MAX_PROJECTS)
}

export function profileListString(value) {
  if (Array.isArray(value)) return value.join(', ')
  return String(value || '')
}

export function nearbyClientsStorageKey(accountKey, pincode) {
  return `crewnbuild_seen_contractor_clients_v2_${accountKey || 'guest'}_${pincode || 'all'}`
}

export function clientIdentity(client) {
  return [
    client.client_type || 'PROJECT',
    client.owner_id || client.user_id || 'owner',
    client.project_id || client.id || 'profile',
  ].join(':')
}

export function requestBoardIdentity(request) {
  return [
    String(request.project_title || '').trim().toLowerCase(),
    String(request.sender_name || request.profile_title || '').trim().toLowerCase(),
    String(request.project_address || '').trim().toLowerCase(),
    String(request.project_pincode || '').trim(),
    String(request.land_area || '').trim(),
  ].join('|')
}

export function readSeenClientKeys(userId, pincode) {
  try {
    return JSON.parse(localStorage.getItem(nearbyClientsStorageKey(userId, pincode)) || '[]')
  } catch {
    localStorage.removeItem(nearbyClientsStorageKey(userId, pincode))
    return []
  }
}

export function saveSeenClientKeys(userId, pincode, keys) {
  localStorage.setItem(nearbyClientsStorageKey(userId, pincode), JSON.stringify([...new Set(keys)]))
}

import { formatMoney } from '../../shared/utils/countryConfig.js'
import { formatCalendarDate, todayCalendarDate } from '../../shared/utils/formatters.js'
import { translatorFrom } from '../../i18n/translate.js'

export function inr(value, country) {
  return formatMoney(value, country)
}

export function formatProjectDate(value, t) {
  // The month name follows the selected language; "Not set" comes from the key
  // table rather than an English literal.
  return formatCalendarDate(value, translatorFrom(t)('dash.common.notSet'))
}

// Display label for a stored building type code ('RESIDENTIAL', 'VILLA', ...).
// The stored code is never changed; an unknown code is shown as stored.
const BUILDING_TYPE_KEYS = {
  RESIDENTIAL: 'dash.common.residential',
  COMMERCIAL: 'dash.common.commercial',
  VILLA: 'dash.common.villa',
  DUPLEX: 'dash.common.duplex',
}

export function buildingTypeText(value, t) {
  const key = BUILDING_TYPE_KEYS[String(value || '').toUpperCase()]
  return key ? translatorFrom(t)(key) : (value || '')
}

// Display label for a stored project status code ('active', 'completed', ...).
// The code itself is never changed; unknown codes are shown as stored.
const PROJECT_STATUS_KEYS = {
  pending: 'ui.status.pending',
  accepted: 'ui.status.accepted',
  rejected: 'ui.status.rejected',
  completed: 'ui.status.completed',
  active: 'ui.status.active',
  in_progress: 'ui.status.inProgress',
  closed: 'ui.status.closed',
  open: 'ui.status.open',
}

export function projectStatusText(status, t) {
  const key = PROJECT_STATUS_KEYS[String(status || '').toLowerCase()]
  return key ? translatorFrom(t)(key) : status
}

// Project categorisation for the Projects section.
//
// Uses the project's own end date (`end_date`, a calendar date the owner
// entered) and the existing `status` / `completion_percentage` fields. A
// project whose end date is not set is never Previous because of a date.

export function projectIsCompleted(project) {
  return String(project?.status || '').toLowerCase() === 'completed'
    || Number(project?.completion_percentage || 0) >= 100
}

// Whether a Site Engineer is currently assigned to this project. Reads the
// existing assignment the dashboard already attaches to every project from
// /projects/{id}/engineer, which is null once an engineer is unassigned.
export function projectHasAssignedEngineer(project) {
  const assignedEngineer = project?.assigned_engineer
  return Boolean(assignedEngineer && (assignedEngineer.user_id || assignedEngineer.id))
}

// Returns exactly one of 'current' | 'previous' | 'upcoming' so a project can
// never land in two categories.
export function projectCategory(project, now = Date.now()) {
  // Previous: completed, or the end date is before today. On its end date a
  // project is still running. Calendar dates ("YYYY-MM-DD") compare as text.
  if (projectIsCompleted(project)) return 'previous'

  if (project?.end_date && project.end_date < todayCalendarDate(new Date(now))) return 'previous'

  // Current vs Upcoming follows the Site Engineer assignment: a project becomes
  // current the moment an engineer is assigned to it, and returns to upcoming
  // if that engineer is unassigned.
  return projectHasAssignedEngineer(project) ? 'current' : 'upcoming'
}

export function groupProjectsByCategory(projectList, now = Date.now()) {
  const groups = { current: [], previous: [], upcoming: [] }
  ;(Array.isArray(projectList) ? projectList : []).forEach((project) => {
    groups[projectCategory(project, now)].push(project)
  })
  return groups
}

// Request / proposal matching for Find Clients.
//
// Matching is by id, never by project title or person name. Titles are not
// unique (the same builder can see several projects called "4BHK VILLA"), so
// title matching attached a request to the wrong lead and left the real one
// showing "Send Request". sender_id, receiver_id and project_id come straight
// from /project-requests/incoming, so the status shown is always the stored one.
export const OWNER_REQUEST_TYPES = ['CONTRACTOR_TO_OWNER', 'OWNER_TO_CONTRACTOR']
export const SUPPLIER_REQUEST_TYPES = ['CONTRACTOR_TO_SUPPLIER', 'SUPPLIER_TO_CONTRACTOR']

const REQUEST_STATUS_PRIORITY = { accepted: 0, pending: 1, rejected: 2, withdrawn: 3 }

const sameId = (left, right) => left !== null && left !== undefined && right !== null && right !== undefined && String(left) === String(right)

export function requestTypesForClient(client) {
  return client?.client_type === 'SUPPLIER' ? SUPPLIER_REQUEST_TYPES : OWNER_REQUEST_TYPES
}

// Both directions are considered: a request the builder sent and one the owner or
// supplier sent to the builder describe the same relationship, so an accepted
// incoming request must not still offer "Send Request".
export function findClientRequest(requestList, client, requestTypes) {
  const types = requestTypes?.length ? requestTypes : requestTypesForClient(client)
  const counterpartyId = client?.owner_id
  const matches = (Array.isArray(requestList) ? requestList : []).filter((request) => {
    if (!types.includes(request.request_type)) return false
    if (!sameId(request.sender_id, counterpartyId) && !sameId(request.receiver_id, counterpartyId)) return false
    // A project lead is matched only by its own project, so a request for one
    // project never marks a different project from the same owner as contacted.
    if (client?.project_id) return sameId(request.project_id, client.project_id)
    return true
  })
  if (!matches.length) return undefined
  // Accepted outranks pending outranks rejected outranks withdrawn when several requests exist.
  return [...matches].sort(
    (left, right) => (REQUEST_STATUS_PRIORITY[left.status] ?? 3) - (REQUEST_STATUS_PRIORITY[right.status] ?? 3),
  )[0]
}

// 'accepted' | 'rejected' | 'withdrawn' | 'sent' (the builder sent it and is
// waiting on them) | 'pending' (they sent it and are waiting on the builder) | 'none'
export function clientRequestState(requestList, client, requestTypes) {
  const matchedRequest = findClientRequest(requestList, client, requestTypes)
  if (matchedRequest?.status === 'accepted') return 'accepted'
  if (matchedRequest?.status === 'rejected') return 'rejected'
  if (matchedRequest?.status === 'withdrawn') return 'withdrawn'
  if (matchedRequest?.status === 'pending') return matchedRequest.is_sender ? 'sent' : 'pending'
  return 'none'
}
