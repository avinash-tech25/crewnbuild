// The other party on a request that has no project -- a supplier or a builder -- shown
// by who they are rather than by the project fields a House Owner's request has (budget,
// area, building type, construction), which never apply to them.
//
// Everything here comes from the request row the server sends
// (/project-requests/incoming): the public business details it adds for a supplier or a
// builder (profile_supplier_category, profile_location, profile_verified,
// profile_member_since, profile_offer). Phone and e-mail are not read here: the server
// sends them only once the request is accepted, and the screens show them as before.
import { SUPPLIER_TYPE_KEYS, optionLabel } from '../../i18n/optionKeys.js'
import { formatDate } from '../../shared/utils/formatters.js'

const PARTY_ROLES = ['SUPPLIER', 'BUILDER', 'CONTRACTOR']

/** The other party's role on this row. */
export function counterpartyRole(request) {
  return String(request?.profile_role || request?.sender_role || '').toUpperCase()
}

/**
 * Whether the request is about the other party itself, not a project: a supplier's or a
 * builder's request with no project. A House Owner's project request is never one.
 */
export function isPartyRequest(request) {
  return Boolean(request) && !request.project_id && PARTY_ROLES.includes(counterpartyRole(request))
}

/** The heading: the store or business name, else the person's name. */
export function partyHeading(request, td = (value) => value) {
  return td(request?.profile_title) || td(request?.profile_name || request?.sender_name) || ''
}

/** "Material Supplier" etc. in the reader's language; '' when none is saved. */
export function supplierCategoryLabel(request, t) {
  const category = String(request?.profile_supplier_category || '').trim()
  return category ? optionLabel(t, SUPPLIER_TYPE_KEYS, category) : ''
}

/** "Since Nov 2026". */
export function memberSinceLabel(request, t) {
  const since = formatDate(request?.profile_member_since, '', { month: 'short', year: 'numeric' })
  return since ? t('req.party.memberSinceValue', { date: since }) : ''
}

/**
 * What a supplier offers, in one line: a Material Supplier's published listings and up to
 * three catalog categories, a Labour Supplier's trades, an Equipment Supplier's equipment
 * types. '' when there is nothing to say (no listings, trades or items yet).
 */
export function offerSummary(request, t) {
  const offer = request?.profile_offer
  if (!offer) return ''
  if (Array.isArray(offer.trades)) return offer.trades.join(', ')
  if (Array.isArray(offer.equipment_types)) return offer.equipment_types.join(', ')
  if (typeof offer.active_listings === 'number') {
    const count = t(offer.active_listings === 1 ? 'req.party.listingsOne' : 'req.party.listingsMany', { count: offer.active_listings })
    const categories = (offer.categories || []).slice(0, 3).join(', ')
    return categories ? `${count} · ${categories}` : count
  }
  return ''
}

/** The label for the offer row, by what the supplier supplies. */
export function offerLabel(request, t) {
  const offer = request?.profile_offer || {}
  if (Array.isArray(offer.trades)) return t('req.party.trades')
  if (Array.isArray(offer.equipment_types)) return t('req.party.equipmentTypes')
  return t('req.party.offers')
}

/** Where they are: the place they named, else their address and PIN code. */
export function partyLocation(request, td = (value) => value) {
  const place = td(request?.profile_location)
  if (place) return request?.profile_pincode ? `${place} ${request.profile_pincode}` : place
  return [td(request?.profile_address || request?.sender_address), request?.profile_pincode || request?.sender_pincode].filter(Boolean).join(', ')
}

/**
 * The rows of a party request's View details, in order, each [label, value]. Only rows
 * that apply to this party are listed, and only with a value -- never a "Not set" row.
 * Contact rows appear only when the server sent contact (after acceptance).
 */
export function partyDetailRows(request, t, td = (value) => value) {
  const role = counterpartyRole(request)
  const supplier = role === 'SUPPLIER'
  const rows = [
    [t(supplier ? 'req.party.supplierName' : 'req.party.builderName'), td(request.profile_name || request.sender_name)],
    supplier ? null : [t('req.party.company'), request.profile_title && request.profile_title !== (request.profile_name || request.sender_name) ? td(request.profile_title) : ''],
    supplier ? [t('req.party.supplierCategory'), supplierCategoryLabel(request, t)] : null,
    [t('dash.msg.location'), partyLocation(request, td)],
    supplier ? [offerLabel(request, t), offerSummary(request, t)] : null,
    [t('req.party.verified'), typeof request.profile_verified === 'boolean' ? t(request.profile_verified ? 'req.party.verifiedYes' : 'req.party.verifiedNo') : ''],
    [t('req.party.memberSince'), memberSinceLabel(request, t)],
    request.project_id ? [t('dash.common.project'), td(request.project_title)] : null,
    request.profile_phone ? [t('req.party.phone'), request.profile_phone] : null,
    request.profile_email ? [t('req.party.email'), request.profile_email] : null,
  ]
  return rows.filter((row) => row && row[1])
}
