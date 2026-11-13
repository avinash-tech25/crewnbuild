// Option lists whose English strings double as stored values (they are posted
// to the API and matched against saved records). The values must stay exactly
// as they are — only what the user reads is localised, via these maps.
//
// Usage:  optionLabel(t, SERVICE_OPTION_KEYS, value)

export const SERVICE_OPTION_KEYS = {
  'Residential Construction': 'opt.service.residential',
  'Commercial Construction': 'opt.service.commercial',
  'Renovation & Remodeling': 'opt.service.renovation',
  'Interior Work': 'opt.service.interior',
  'Structural Work': 'opt.service.structural',
  'Plumbing & Electrical': 'opt.service.plumbingElectrical',
}

export const SERVICE_NOTE_KEYS = {
  'Residential Construction': 'opt.serviceNote.residential',
  'Commercial Construction': 'opt.serviceNote.commercial',
  'Renovation & Remodeling': 'opt.serviceNote.renovation',
  'Interior Work': 'opt.serviceNote.interior',
  'Structural Work': 'opt.serviceNote.structural',
  'Plumbing & Electrical': 'opt.serviceNote.plumbingElectrical',
}

export const EQUIPMENT_OPTION_KEYS = {
  'Concrete Mixer': 'opt.equipment.concreteMixer',
  Excavator: 'opt.equipment.excavator',
  Scaffolding: 'opt.equipment.scaffolding',
  'Bar Bending Machine': 'opt.equipment.barBending',
  'Concrete Vibrator': 'opt.equipment.concreteVibrator',
  'Safety Equipment': 'opt.equipment.safety',
}

export const DOCUMENT_TYPE_KEYS = {
  'Business License': 'opt.document.businessLicense',
  'Company Registration': 'opt.document.companyRegistration',
  'GST Certificate': 'opt.document.gstCertificate',
  'PAN Card': 'opt.document.panCard',
  'Insurance Certificate': 'opt.document.insuranceCertificate',
  'ISO Certificate': 'opt.document.isoCertificate',
  'Shop License': 'opt.document.shopLicense',
  'Trade License': 'opt.document.tradeLicense',
  'Material Quality Certificate': 'opt.document.materialQuality',
  'Labour Licence': 'opt.document.labourLicence',
  'Equipment Fitness Certificate': 'opt.document.equipmentFitness',
}

export const SUPPLIER_CATEGORY_KEYS = {
  Cement: 'opt.category.cement',
  Iron: 'opt.category.iron',
  Steel: 'opt.category.steel',
  Sand: 'opt.category.sand',
  Bricks: 'opt.category.bricks',
  Tiles: 'opt.category.tiles',
  Paint: 'opt.category.paint',
  Electrical: 'opt.category.electrical',
  Plumbing: 'opt.category.plumbing',
  Wood: 'opt.category.wood',
  Furnitures: 'opt.category.furnitures',
  Interior: 'opt.category.interior',
  Machines: 'opt.category.machines',
  // The remaining material trades the listing form offers. Plumbing,
  // Electrical, Paint and Tiles above are shared with the profile category
  // list, so they are not repeated here.
  'Steel/TMT': 'opt.category.steelTmt',
  Aggregates: 'opt.category.aggregates',
  Concrete: 'opt.category.concrete',
  Blocks: 'opt.category.blocks',
  'Lighting & Fans': 'opt.category.lightingFans',
  Waterproofing: 'opt.category.waterproofing',
  Stone: 'opt.category.stone',
  Roofing: 'opt.category.roofing',
  Hardware: 'opt.category.hardware',
  Safety: 'opt.category.safety',
  'Glass & Boards': 'opt.category.glassBoards',
  // The stored value stays "Other Construction Materials" — this only
  // shortens what the category button and filter chip display, which the
  // full name was too long to fit on.
  'Other Construction Materials': 'opt.category.otherMaterials',
}

export const SUPPLIER_TYPE_KEYS = {
  'Material Supplier': 'opt.supplierType.material',
  'Labor Supplier': 'opt.supplierType.labor',
  'Equipment Supplier': 'opt.supplierType.equipment',
}

// What a supplier of each category publishes. The buyer UI is shared by all
// three categories, so the wording around a supplier's catalogue follows the
// supplier's own saved category instead of calling everything "materials".
// Keyed by the same values as SUPPLIER_TYPE_KEYS above - one vocabulary.
export const SUPPLIER_OFFERING_KEYS = {
  'Material Supplier': {
    none: 'dash.engineer.suppliers.noMaterials',
    empty: 'dash.engineer.suppliers.noPublishedMaterials',
  },
  'Labor Supplier': {
    none: 'dash.engineer.suppliers.noServices',
    empty: 'dash.engineer.suppliers.noPublishedServices',
  },
  'Equipment Supplier': {
    none: 'dash.engineer.suppliers.noEquipment',
    empty: 'dash.engineer.suppliers.noPublishedEquipment',
  },
}

// A supplier who has not chosen a category yet keeps the wording the screen
// has always used.
export const DEFAULT_SUPPLIER_OFFERING_KEYS = SUPPLIER_OFFERING_KEYS['Material Supplier']

export const BUSINESS_TYPE_KEYS = {
  Proprietorship: 'opt.business.proprietorship',
  Partnership: 'opt.business.partnership',
  LLP: 'opt.business.llp',
  'Private Limited': 'opt.business.privateLimited',
  'Public Limited': 'opt.business.publicLimited',
  'One Person Company': 'opt.business.onePerson',
  'Trust / Society': 'opt.business.trustSociety',
}

export const CONTRACTOR_STEP_KEYS = {
  'Personal Details': 'opt.step.personalDetails',
  'Company Details': 'opt.step.companyDetails',
  Capabilities: 'opt.step.capabilities',
  'Credentials & Media': 'opt.step.credentialsMedia',
}

export const FLOOR_TYPE_KEYS = {
  G: 'opt.floor.g',
  'G+1': 'opt.floor.g1',
  'G+2': 'opt.floor.g2',
  'G+3': 'opt.floor.g3',
  // No longer offered, but a record saved with it still shows a label instead
  // of the raw stored code "G+4" in all seven languages.
  'G+4': 'opt.floor.g4',
  'G-1': 'opt.floor.gm1',
  'G-2': 'opt.floor.gm2',
  'G-3': 'opt.floor.gm3',
  DUPLEX: 'opt.floor.duplex',
  MANSION: 'opt.floor.mansion',
}

export const COMPLIANCE_STATUS_KEYS = {
  'Pending Verification': 'opt.compliance.pendingVerification',
  Eligible: 'opt.compliance.eligible',
  'Additional Documents Required': 'opt.compliance.additionalDocuments',
  'Review Required': 'opt.compliance.reviewRequired',
}

/** Translate a stored option value for display, falling back to the raw value. */
export function optionLabel(t, map, value) {
  const key = map[value]
  return key ? t(key) : value
}
