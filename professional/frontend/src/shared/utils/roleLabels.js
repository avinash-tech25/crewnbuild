// Friendly display labels for codes stored in the database. The stored values
// (CONTRACTOR / SELF_CONSTRUCTION / OWNER_TO_CONTRACTOR …) are internal API
// contracts; these helpers render them as user-facing names.

import { translatorFrom } from '../../i18n/translate.js'

export const CONSTRUCTION_TYPE_LABELS = {
  CONTRACTOR: 'Builder',
  SELF_CONSTRUCTION: 'Self construction',
}

export const REQUEST_TYPE_LABELS = {
  OWNER_TO_CONTRACTOR: 'Builder Request',
  CONTRACTOR_TO_OWNER: 'Builder Request',
  OWNER_TO_SUPPLIER: 'Supplier Request',
  CONTRACTOR_TO_SUPPLIER: 'Supplier Request',
  OWNER_TO_PROFESSIONAL: 'Professional Request',
  PROFESSIONAL_TO_OWNER: 'Professional Request',
  CONTRACTOR_TO_PROFESSIONAL: 'Professional Request',
  SITE_ENGINEER_TO_SPECIALIST: 'Project Team Request',
  PROFESSIONAL_TO_CONTRACTOR: 'Professional Request',
  PROPERTY_BUYER_TO_SELLER: 'Property Enquiry',
}

// Translation keys for the labels above. Passing `t` localises the label;
// without it the English label is returned exactly as before.
const CONSTRUCTION_TYPE_LABEL_KEYS = {
  CONTRACTOR: 'role.builder',
  SELF_CONSTRUCTION: 'ui.shared.selfConstruction',
}

const REQUEST_TYPE_LABEL_KEYS = {
  OWNER_TO_CONTRACTOR: 'dash.common.builderRequest',
  CONTRACTOR_TO_OWNER: 'dash.common.builderRequest',
  OWNER_TO_SUPPLIER: 'dash.common.supplierRequest',
  CONTRACTOR_TO_SUPPLIER: 'dash.common.supplierRequest',
  OWNER_TO_PROFESSIONAL: 'ui.shared.professionalRequest',
  PROFESSIONAL_TO_OWNER: 'ui.shared.professionalRequest',
  CONTRACTOR_TO_PROFESSIONAL: 'ui.shared.professionalRequest',
  SITE_ENGINEER_TO_SPECIALIST: 'ui.shared.projectTeamRequest',
  PROFESSIONAL_TO_CONTRACTOR: 'ui.shared.professionalRequest',
  PROPERTY_BUYER_TO_SELLER: 'ui.shared.propertyEnquiry',
  // These four codes are sent by the app but were absent here, so each screen
  // either kept a private copy of the mapping or fell through to the raw enum
  // and rendered "SUPPLIER TO OWNER".
  SUPPLIER_TO_OWNER: 'dash.common.supplierRequest',
  SUPPLIER_TO_CONTRACTOR: 'dash.common.supplierRequest',
  SUPPLIER_TO_SUPPLIER: 'dash.common.supplierRequest',
  OWNER_TO_ENGINEER: 'ui.owner.engineerRequest',
}

// `t` stays an accepted argument so existing callers are unchanged, but it is no
// longer what decides whether the label is translated: six of the eight call
// sites never passed it, and those labels stayed English in every language.
// Without it the active language is read directly instead.
export const constructionTypeLabel = (value, t) =>
  (CONSTRUCTION_TYPE_LABEL_KEYS[value] ? translatorFrom(t)(CONSTRUCTION_TYPE_LABEL_KEYS[value]) : CONSTRUCTION_TYPE_LABELS[value]) || value || ''

export const requestTypeLabel = (value, t) =>
  (REQUEST_TYPE_LABEL_KEYS[value] ? translatorFrom(t)(REQUEST_TYPE_LABEL_KEYS[value]) : REQUEST_TYPE_LABELS[value]) || value || ''
