/**
 * Technical constants and unit conversions for the three material calculators.
 *
 * Everything here is either an exact unit conversion or a published
 * construction/paint figure with its source recorded beside it. None of it is
 * CREWNBUILD business data: there are no products, brands, suppliers, prices or
 * stock figures in this file, and the calculators that use it never quote a
 * cost. Keeping the figures here — rather than inline in the components — means
 * the methodology can be reviewed, corrected or replaced in one place.
 *
 * Every published figure below is a RANGE, and the calculators report ranges,
 * because that is what the sources actually support. Presenting a single exact
 * number would be inventing precision the methodology does not have.
 */

// ---------------------------------------------------------------- conversions
// Exact definitions, not estimates.
export const SQ_FT_PER_SQ_METRE = 10.7639
export const FEET_PER_METRE = 3.28084
export const CUBIC_FEET_PER_CUBIC_METRE = 35.3147

export const UNIT_FT = 'FT'
export const UNIT_M = 'M'

// ------------------------------------------------------------- raw materials
/**
 * Consumption per SQUARE FOOT OF BUILT-UP AREA for ordinary RCC-framed
 * residential construction — the standard Indian "thumb rule" quantities.
 *
 * Source: widely published Indian construction thumb rules, consistent across
 *   https://civiconcepts.com/blog/thumb-rules-for-civil-engineering
 *   https://www.bricknbolt.com/blogs-and-articles/construction-guide/construction-material-quantity-estimation-for-1000-sqft-of-house-construction
 *   https://www.houseyog.com/blog/construction-material-estimation-india-beginner-boq-guide/
 *
 * These are planning figures. Real quantities come from structural drawings, a
 * bar bending schedule and a BOQ — which is why the UI labels the output an
 * estimate and says so.
 */
export const MATERIAL_RATES = [
  { key: 'cement', label: 'Cement', unit: 'bags', low: 0.40, high: 0.50 },
  { key: 'steel', label: 'Steel / TMT', unit: 'kg', low: 3.5, high: 4.5 },
  { key: 'sand', label: 'Sand', unit: 'cft', low: 0.80, high: 1.00 },
  { key: 'aggregate', label: 'Aggregate', unit: 'cft', low: 1.00, high: 1.20 },
  { key: 'bricks', label: 'Bricks / blocks', unit: 'nos', low: 8, high: 10 },
]

// ---------------------------------------------------------------------- paint
/**
 * Spreading rate in SQUARE FEET PER LITRE, PER COAT, by paint type.
 *
 * Source: Nerolac, "What is Paint Coverage"
 *   https://www.nerolac.com/wall-paint/what-is-paint-coverage
 * which publishes ~90 sq.ft/L for emulsion, 50–60 for enamel, 130–150 for
 * distemper and 40–50 for epoxy. One manufacturer is used throughout rather
 * than mixing sources, so the methodology stays internally consistent.
 *
 * A real tin's spreading rate is on its own technical data sheet and varies
 * with surface and application. CREWNBUILD's `supplier_products` table holds no
 * coverage field, so no supplier product can be quoted here — the UI says the
 * figure is a general estimate, not a product claim.
 */
export const PAINT_TYPES = [
  { key: 'emulsion', label: 'Emulsion', low: 90, high: 90 },
  { key: 'enamel', label: 'Enamel', low: 50, high: 60 },
  { key: 'distemper', label: 'Distemper', low: 130, high: 150 },
  { key: 'epoxy', label: 'Epoxy', low: 40, high: 50 },
]

// ------------------------------------------------------------------ ready mix
/**
 * Concrete is ordered by volume, so the calculation is geometry plus an
 * allowance for spillage, over-excavation and pump losses.
 *
 * The 5–10% wastage allowance is the range the same construction references
 * above give ("always add 5–10% wastage"). It is offered as an input rather
 * than hidden, so the user chooses it and can see its effect.
 *
 * No mix ratio is claimed anywhere: ready-mix is bought as a finished m³ of a
 * specified grade, and the grade is the supplier's mix design, not something
 * this calculator should assert.
 */
export const WASTAGE_CHOICES = [0, 5, 7.5, 10]
export const DEFAULT_WASTAGE = 5
