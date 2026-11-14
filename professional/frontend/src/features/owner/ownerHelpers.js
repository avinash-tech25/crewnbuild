import { formatMoney } from '../../shared/utils/countryConfig.js'
import { translate, translatorFrom } from '../../i18n/translate.js'
import { formatCalendarDate, formatRelativeTime } from '../../shared/utils/formatters.js'

// Currency always comes from the PROJECT country, never the customer's residence.
export const money = (value, projectCountry) => formatMoney(value, projectCountry)

/**
 * A project's current amount: the confirmed contract value, else the awarded
 * quotation, else the stored budget -- the rule the project cards already use.
 * All three come from the project payload (/owners/projects); nothing is
 * computed here. Null when none is set, so callers show "Not set".
 */
export function currentProjectAmount(project) {
  const amount = project?.contract_amount ?? project?.awarded_amount ?? project?.budget
  return Number(amount) > 0 ? Number(amount) : null
}

export function listText(value, t) {
  if (Array.isArray(value)) return value.filter(Boolean).join(', ')
  return value || translatorFrom(t)('cpp.notSet')
}

export function formatProjectDate(value, t) {
  // The selected language, not 'en-IN': this printed "Sep" in all seven.
  return formatCalendarDate(value, translatorFrom(t)('cpp.notSet'))
}

// The owner's schedule is two calendar dates ("YYYY-MM-DD"), so comparing the
// text compares the days. One rule for Create Project, Convert to Project and
// the Overview edit; the API applies the same one. Returns the message key of
// what is wrong, or '' when the pair is fine.
export function projectScheduleProblem(startDate, endDate) {
  if (!startDate || !endDate) return 'dash.owner.projectForm.datesRequired'
  if (endDate < startDate) return 'dash.owner.projectForm.endBeforeStart'
  return ''
}

// The two request types that carry a House Owner <-> Builder quotation. Either
// side may open the conversation; the row that results means the same thing
// both ways round, so both belong in the owner's Accepted Quotations list.
// Mirrors OWNER_BUILDER_REQUEST_TYPES in the backend's services/project_request_service.py.
export const OWNER_BUILDER_REQUEST_TYPES = ['OWNER_TO_CONTRACTOR', 'CONTRACTOR_TO_OWNER']

// Which side of the request is the builder depends on who sent it, so a payload
// field alone cannot answer it.
export function builderIdOnRequest(request) {
  if (request?.request_type === 'OWNER_TO_CONTRACTOR') return request.receiver_id
  if (request?.request_type === 'CONTRACTOR_TO_OWNER') return request.sender_id
  return null
}

// Display labels for stored project codes. The stored values stay as they are;
// only the text on screen is localised, and an unknown code is shown as-is.
const BUILDING_TYPE_KEYS = {
  RESIDENTIAL: 'dash.common.residential',
  COMMERCIAL: 'dash.common.commercial',
  VILLA: 'dash.common.villa',
  DUPLEX: 'dash.common.duplex',
}

const CONSTRUCTION_TYPE_KEYS = {
  CONTRACTOR: 'dash.common.builder',
  BUILDER: 'dash.common.builder',
  SELF_CONSTRUCTION: 'ui.owner.selfConstructionLabel',
}

const COUNTRY_KEYS = {
  India: 'country.india',
}

export function buildingTypeText(value, t) {
  const key = BUILDING_TYPE_KEYS[String(value || '').toUpperCase()]
  return key ? t(key) : (value || '')
}

export function constructionTypeText(value, t) {
  const key = CONSTRUCTION_TYPE_KEYS[value]
  return key ? t(key) : (value || '')
}

export function countryText(value, t) {
  const key = COUNTRY_KEYS[value || 'India']
  return key ? t(key) : value
}

// The engine's own relative-time rule, not a singular/plural pair: English has
// two forms, Arabic has six, and the key table cannot express either choice.
export function timeAgo(value) {
  return formatRelativeTime(value, '')
}

export function timelineDayLabel(entry, index, timelineEntries) {
  const dayWord = translate('se.day')
  if (!entry.date || !timelineEntries[0]?.date) return `${dayWord} ${index + 1}`
  const firstDate = new Date(timelineEntries[0].date)
  const entryDate = new Date(entry.date)
  const dayOffset = Math.max(1, Math.round((entryDate - firstDate) / 86400000) + 1)
  return `${dayWord} ${dayOffset}`
}

export function estimateStorageKey(userId) {
  return `crewnbuild_owner_estimates_${userId || 'guest'}`
}

export function piePoint(cx, cy, radius, percent) {
  const angle = (percent * 360 - 90) * (Math.PI / 180)
  return {
    x: cx + radius * Math.cos(angle),
    y: cy + radius * Math.sin(angle),
  }
}

export function pieSlicePath(startPercent, endPercent, radius = 86) {
  const start = piePoint(120, 120, radius, startPercent)
  const end = piePoint(120, 120, radius, endPercent)
  const largeArc = endPercent - startPercent > 0.5 ? 1 : 0
  return `M 120 120 L ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArc} 1 ${end.x} ${end.y} Z`
}

export function estimateFromDetails(details, fallback = {}) {
  return {
    id: fallback.id || `estimate-${Date.now()}`,
    project_id: details.id ?? fallback.project_id ?? null,
    source: fallback.source || 'Draft',
    phone: details.phone || fallback.phone || '',
    address: details.address || fallback.address || '',
    pincode: details.pincode || fallback.pincode || '',
    project_country: details.project_country || fallback.project_country || 'India',
    // Left in English on purpose: this value is put into the Edit Requirement
    // field and posted back to the API as the project's title, so it is stored
    // text rather than interface copy. What the screen shows is translated
    // where it is rendered.
    project_title: details.project_title || details.title || fallback.project_title || 'Untitled estimate',
    contractor_name: details.contractor?.name || details.contractor_name || fallback.contractor_name || '',
    start_timeline: details.start_timeline || fallback.start_timeline || '',
    project_description: details.project_description || details.description || fallback.project_description || '',
    building_type: details.building_type || fallback.building_type || 'RESIDENTIAL',
    construction_type: details.construction_type || fallback.construction_type || 'CONTRACTOR',
    budget: details.budget || fallback.budget || 0,
    land_area: details.land_area || fallback.land_area || 0,
    floors: details.floors || fallback.floors || 1,
    // Carried with the count it belongs to. Without it every project-derived
    // requirement arrived with no configuration code at all, so the Edit
    // Requirement dropdown sat on its placeholder even for a project that has
    // one stored -- and a save then had nothing to send back.
    floor_type: details.floor_type || fallback.floor_type || '',
    created_at: details.created_at || fallback.created_at || '',
  }
}

/**
 * What a project card should put in its builder slot, from the project itself.
 *
 * A self-construction project has no builder to name; a builder-based project
 * names the one actually assigned; anything else is still waiting for one. Both
 * owner project cards ask this, so the two can never drift apart. The caller
 * renders its own wording, so no card's existing copy changes.
 */
export function projectBuilderContext(project) {
  if ((project?.construction_type || '') === 'SELF_CONSTRUCTION') return { kind: 'self' }
  const builderName = project?.contractor?.name || project?.contractor_name || ''
  return builderName ? { kind: 'builder', name: builderName } : { kind: 'unassigned' }
}

// A draft estimate drawn as a project card. Nothing here is ever posted or
// stored -- the actions on that card act on the estimate, not on this object --
// so its two fallbacks are interface copy and are translated as such.
export function projectFromEstimate(estimate) {
  return {
    id: `estimate-project-${estimate.id}`,
    title: estimate.project_title || translate('dash.common.untitledProject'),
    description: estimate.project_description || translate('dash.common.createdFromEstimate'),
    address: estimate.address || '',
    pincode: estimate.pincode || '',
    building_type: estimate.building_type || 'RESIDENTIAL',
    construction_type: estimate.construction_type || 'CONTRACTOR',
    budget: Number(estimate.budget || 0),
    land_area: Number(estimate.land_area || 0),
    floors: Number(estimate.floors || 1),
    status: 'active',
    // A draft has no project yet, so there is no completion to show.
    completion_percentage: null,
    cover_image_url: '',
    created_at: estimate.created_at || new Date().toISOString(),
    from_estimate: true,
  }
}

export function normalizeEstimateText(value) {
  return String(value || '').trim().toLowerCase()
}

export function readLocalEstimates(user) {
  try {
    const savedEstimates = JSON.parse(localStorage.getItem(estimateStorageKey(user?.id)) || '[]')
    return savedEstimates.filter((estimate) => (
      estimate.owner_id === user?.id
      || (estimate.owner_email && estimate.owner_email === user?.email)
    ))
  } catch {
    localStorage.removeItem(estimateStorageKey(user?.id))
    return []
  }
}

export function removeLocalEstimate(userId, estimateId) {
  try {
    const savedEstimates = JSON.parse(localStorage.getItem(estimateStorageKey(userId)) || '[]')
    const remaining = savedEstimates.filter((estimate) => estimate.id !== estimateId)
    localStorage.setItem(estimateStorageKey(userId), JSON.stringify(remaining))
    return true
  } catch {
    return false
  }
}

export function seenContractorsKey(userId, pincode) {
  return `crewnbuild_seen_contractors_${userId || 'guest'}_${pincode || 'all'}`
}

export function readSeenContractorIds(userId, pincode) {
  try {
    return JSON.parse(localStorage.getItem(seenContractorsKey(userId, pincode)) || '[]')
  } catch {
    localStorage.removeItem(seenContractorsKey(userId, pincode))
    return []
  }
}

export function saveSeenContractorIds(userId, pincode, contractorIds) {
  localStorage.setItem(seenContractorsKey(userId, pincode), JSON.stringify([...new Set(contractorIds)]))
}

export function seenSuppliersKey(userId, pincode) {
  return `crewnbuild_seen_suppliers_${userId || 'guest'}_${pincode || 'all'}`
}

export function readSeenSupplierIds(userId, pincode) {
  try {
    return JSON.parse(localStorage.getItem(seenSuppliersKey(userId, pincode)) || '[]')
  } catch {
    localStorage.removeItem(seenSuppliersKey(userId, pincode))
    return []
  }
}

export function saveSeenSupplierIds(userId, pincode, supplierIds) {
  localStorage.setItem(seenSuppliersKey(userId, pincode), JSON.stringify([...new Set(supplierIds)]))
}
