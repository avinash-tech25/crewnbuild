export const contractorServiceOptions = [
  'Residential Construction',
  'Commercial Construction',
  'Renovation & Remodeling',
  'Interior Work',
  'Structural Work',
  'Plumbing & Electrical',
]

export const contractorEquipmentOptions = [
  'Concrete Mixer',
  'Excavator',
  'Scaffolding',
  'Bar Bending Machine',
  'Concrete Vibrator',
  'Safety Equipment',
]

export const contractorDocumentTypes = [
  'Business License',
  'Company Registration',
  'GST Certificate',
  'PAN Card',
  'Insurance Certificate',
  'ISO Certificate',
]

export const contractorSteps = [
  { id: 1, label: 'Personal Details' },
  { id: 2, label: 'Company Details' },
  { id: 3, label: 'Capabilities' },
  { id: 4, label: 'Credentials & Media' },
]

export const contractorServiceNotes = {
  'Residential Construction': 'Villas, apartments & homes',
  'Commercial Construction': 'Offices, retail & storage',
  'Renovation & Remodeling': 'Structural alterations & repairs',
  'Interior Work': 'Modular fittings & design',
  'Structural Work': 'Foundation, pillars & beams',
  'Plumbing & Electrical': 'Wiring, piping & connections',
}

export const supplierCategoryOptions = [
  'Cement',
  'Iron',
  'Sand',
  'Bricks',
  'Tiles',
  'Paint',
  'Electrical',
  'Plumbing',
  'Wood',
  'Furnitures',
  'Interior',
]

export const supplierDocumentTypes = [
  'Shop License',
  'GST Certificate',
  'PAN Card',
  'Trade License',
  'Material Quality Certificate',
  'Insurance Certificate',
]

// What kind of supplier this is. Distinct from supplierCategoryOptions above,
// which lists the products a supplier sells.
export const supplierTypeOptions = [
  'Material Supplier',
  'Labor Supplier',
  'Equipment Supplier',
]

export const businessTypeOptions = [
  'Proprietorship',
  'Partnership',
  'LLP',
  'Private Limited',
  'Public Limited',
  'One Person Company',
  'Trust / Society',
]

// Engineer is the ROLE; the Engineer Category below is a PROFILE FIELD, stored
// in the existing engineer_profiles.specialization column. There is one Engineer
// account and one Engineer dashboard — a category never becomes a separate role,
// and "Site Engineer" is one category among the fifteen, not a role of its own.
// The Builder assignment flow will later match engineers on this value. Store
// Manager is the one category with a dashboard of its own (dashboardPath).
export const STORE_MANAGER_CATEGORY = 'Store Manager'

export const engineerCategoryOptions = [
  'Site Engineer',
  'Soil Engineer',
  'Survey Engineer',
  'Architecture',
  'Structural Engineer',
  'Civil Engineer',
  'Electrical Engineer',
  'Plumbing',
  'Mechanical Engineer',
  'HVAC',
  'Quantity Surveyor',
  'Safety',
  'Construction Safety',
  'Finishing / Painter',
  STORE_MANAGER_CATEGORY,
]

export function isStoreManagerCategory(category) {
  return String(category || '').trim().toLowerCase() === STORE_MANAGER_CATEGORY.toLowerCase()
}

// What the category control offers. The server refuses a saved category moving
// to or from Store Manager, so the choice that would be refused is not shown. A
// value saved before this list existed stays as an extra option, so opening a
// form never silently rewrites it.
export function engineerCategoryChoices(savedCategory, currentCategory) {
  const saved = String(savedCategory || '').trim()
  if (isStoreManagerCategory(saved)) return [saved]
  const choices = saved ? engineerCategoryOptions.filter((category) => !isStoreManagerCategory(category)) : engineerCategoryOptions
  const current = String(currentCategory || '').trim()
  return current && !choices.includes(current) ? [...choices, current] : choices
}

// Display keys for the categories above. The stored value stays the English
// string; only what the form shows is translated.
export const ENGINEER_CATEGORY_LABEL_KEYS = {
  'Site Engineer': 'role.engineer',
  'Soil Engineer': 'ui.profile.engCat.soilEngineer',
  'Survey Engineer': 'ui.profile.engCat.surveyEngineer',
  Architecture: 'ui.profile.engCat.architecture',
  'Structural Engineer': 'ui.profile.engCat.structuralEngineer',
  'Civil Engineer': 'ui.profile.engCat.civilEngineer',
  'Electrical Engineer': 'ui.profile.engCat.electricalEngineer',
  Plumbing: 'opt.category.plumbing',
  'Mechanical Engineer': 'ui.profile.engCat.mechanicalEngineer',
  HVAC: 'ui.profile.engCat.hvac',
  'Quantity Surveyor': 'ui.profile.engCat.quantitySurveyor',
  Safety: 'opt.category.safety',
  'Construction Safety': 'ui.profile.engCat.constructionSafety',
  'Finishing / Painter': 'ui.profile.engCat.finishingPainter',
  [STORE_MANAGER_CATEGORY]: 'ui.profile.engCat.storeManager',
}
