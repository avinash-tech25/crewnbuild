/**
 * Direction rules and the scoring engine for the Vastu Calculator.
 *
 * Kept apart from the component for the same reason `constants.js` is: the
 * methodology can be reviewed, corrected or replaced in one place, and the
 * screen that renders it holds no rule of its own.
 *
 * Nothing here is CREWNBUILD business data. There are no products, suppliers,
 * prices, users or properties in this file — it is a fixed table of traditional
 * directional preferences and the arithmetic over it.
 *
 * ---------------------------------------------------------------------------
 * Where the numbers come from
 * ---------------------------------------------------------------------------
 * The directional methodology is the one used by the reference implementation
 * at vastucheck.appspot.com's direction calculator. Each house component gets a
 * preference score of 3 (least favoured) to 10 (most favoured) for each of the
 * eight directions. The tables below were read off that reference and then
 * checked against its running behaviour — all 80 component x direction pairs
 * were exercised and matched — so they are transcribed, not guessed, and not
 * invented to make the arithmetic come out.
 *
 * Nine of the ten tables also agree with orthodox Vastu Shastra placement:
 * entrance to the North-East/East, kitchen in the South-East (the Agni corner),
 * master bedroom and the built mass of the house to the South-West, water to
 * the North-East, sanitary areas to the North-West/West and away from the
 * North-East.
 *
 * TWO ODDITIES IN THE REFERENCE, recorded rather than silently corrected:
 *
 *   1. Its `guest room` and `garage` tables are identical in all eight
 *      directions. That looks like duplication in the reference's own data
 *      rather than a distinct principle.
 *   2. Its `dining room` table ties North and West at 9 and has no 5, so that
 *      row ranks eight directions across seven values.
 *
 * Both are reproduced exactly as the reference has them, because the brief was
 * to follow its methodology rather than to invent a tidier one. If either row is
 * ever revised, this note explains why it looked odd in the first place.
 *
 * The scale therefore runs 30-100, not 0-100: the least favourable placement
 * still scores 3, so an average can never fall below 3. The screen says so
 * rather than implying a 0-100 reading.
 */

// ------------------------------------------------------------------ directions
export const VASTU_DIRECTIONS = [
  { key: 'n', label: 'North' },
  { key: 'ne', label: 'North-East' },
  { key: 'e', label: 'East' },
  { key: 'se', label: 'South-East' },
  { key: 's', label: 'South' },
  { key: 'sw', label: 'South-West' },
  { key: 'w', label: 'West' },
  { key: 'nw', label: 'North-West' },
]

// --------------------------------------------------------------- house components
/**
 * `required` marks the parts of a home that essentially every house has. The
 * rest are genuinely optional — not every home has a well, a garage, a guest
 * room or a children's room — and the screen labels them so. A score is only
 * produced once every required component has been answered, so a half-filled
 * form can never be read as a compliance figure.
 *
 * `principle` is the one-line traditional reason behind the row, shown beside
 * each result so a verdict is never just a number.
 */
export const VASTU_COMPONENTS = [
  {
    key: 'mainDoor',
    label: 'Main Door',
    required: true,
    principle: 'The entrance is traditionally placed towards the North-East, East or North, where the morning sun enters; the South-West is the least favoured corner for it.',
    scores: { n: 8, ne: 10, e: 9, se: 6, s: 4, sw: 3, w: 5, nw: 7 },
  },
  {
    key: 'kitchen',
    label: 'Kitchen',
    required: true,
    principle: 'Agni, the fire element, governs the South-East, which is the traditional place for a kitchen; the North-East is the least favoured.',
    scores: { n: 5, ne: 3, e: 8, se: 10, s: 6, sw: 4, w: 7, nw: 9 },
  },
  {
    key: 'masterBedroom',
    label: 'Master Bedroom',
    required: true,
    principle: 'The South-West is associated with weight and stability and is the traditional place for the head of the household; the North-East is the least favoured.',
    scores: { n: 6, ne: 3, e: 5, se: 4, s: 9, sw: 10, w: 8, nw: 7 },
  },
  {
    key: 'childrensBedroom',
    label: "Children's Bedroom",
    required: false,
    principle: 'The North-West and South-East are the traditional choices for a children’s room; the South-West, reserved for the head of the household, is the least favoured.',
    scores: { n: 8, ne: 6, e: 7, se: 9, s: 4, sw: 3, w: 5, nw: 10 },
  },
  {
    key: 'guestRoom',
    label: 'Guest Room',
    required: false,
    principle: 'The North-West is associated with movement and short stays, which suits a guest room; the South-West is the least favoured.',
    scores: { n: 9, ne: 7, e: 8, se: 6, s: 4, sw: 3, w: 5, nw: 10 },
  },
  {
    key: 'diningRoom',
    label: 'Dining Room',
    required: true,
    principle: 'A dining space traditionally sits to the East or North, close to the kitchen; the South-West is the least favoured.',
    scores: { n: 9, ne: 8, e: 10, se: 7, s: 4, sw: 3, w: 9, nw: 6 },
  },
  {
    key: 'well',
    label: 'Well / Underground Tank',
    required: false,
    principle: 'Water sources are traditionally placed in the North-East, the direction associated with water; the South-West is the least favoured.',
    scores: { n: 8, ne: 10, e: 9, se: 4, s: 5, sw: 3, w: 6, nw: 7 },
  },
  {
    key: 'toilet',
    label: 'Toilet / Bathroom',
    required: true,
    principle: 'Sanitary areas are traditionally kept to the North-West or West and away from the North-East, which is treated as the most sacred corner.',
    scores: { n: 7, ne: 3, e: 6, se: 5, s: 8, sw: 4, w: 9, nw: 10 },
  },
  {
    key: 'garage',
    label: 'Garage',
    required: false,
    principle: 'Vehicle parking is traditionally kept to the North-West; the South-West is the least favoured.',
    scores: { n: 9, ne: 7, e: 8, se: 6, s: 4, sw: 3, w: 5, nw: 10 },
  },
  {
    key: 'houseInPlot',
    label: 'House / Plot Direction',
    required: true,
    principle: 'The built mass traditionally sits towards the South-West of the plot, leaving the open space to the North-East.',
    scores: { n: 5, ne: 3, e: 4, se: 6, s: 9, sw: 10, w: 8, nw: 7 },
  },
]

// ---------------------------------------------------------------------- bands
/**
 * Per-placement bands, and the overall bands the reference states in words:
 * "compliance above 70% is good, above 90% is excellent".
 */
export const PLACEMENT_BANDS = [
  { key: 'favourable', min: 9, label: 'Favourable', tone: 'good' },
  { key: 'improve', min: 6, label: 'Can be improved', tone: 'warn' },
  { key: 'attention', min: 0, label: 'Needs attention', tone: 'bad' },
]

export const OVERALL_BANDS = [
  { key: 'excellent', min: 90, label: 'Excellent' },
  { key: 'good', min: 70, label: 'Good' },
  { key: 'attention', min: 0, label: 'Needs Attention' },
]

export const directionLabel = (key) =>
  VASTU_DIRECTIONS.find((item) => item.key === key)?.label || ''

export const placementBand = (score) =>
  PLACEMENT_BANDS.find((band) => score >= band.min) || PLACEMENT_BANDS[PLACEMENT_BANDS.length - 1]

export const overallBand = (percent) =>
  OVERALL_BANDS.find((band) => percent >= band.min) || OVERALL_BANDS[OVERALL_BANDS.length - 1]

/** The direction(s) this component scores highest in — used in the advice. */
export function bestDirections(component) {
  const top = Math.max(...Object.values(component.scores))
  return VASTU_DIRECTIONS.filter((item) => component.scores[item.key] === top).map((item) => item.label)
}

/**
 * The same directions as `bestDirections`, as keys rather than English labels.
 *
 * The screens word their advice in the selected language, so they need the
 * direction's identity, not its English name. Same table, same comparison — this
 * only stops at the key instead of taking the label from it.
 */
export function bestDirectionKeys(component) {
  const top = Math.max(...Object.values(component.scores))
  return VASTU_DIRECTIONS.filter((item) => component.scores[item.key] === top).map((item) => item.key)
}

/**
 * Score one set of selections.
 *
 * `selections` is `{ [componentKey]: directionKey }`. A component with no
 * selection is simply not scored — it is never treated as a zero, which would
 * drag the percentage down for a room the house does not have.
 *
 * Pure and deterministic: the same selections always give the same result, and
 * nothing here reads a clock, a random source or any external state.
 */
export function evaluateVastu(selections = {}) {
  const missing = VASTU_COMPONENTS.filter(
    (component) => component.required && !selections[component.key],
  )
  if (missing.length) return { ready: false, missing, placements: [], total: 0, percent: 0, band: null }

  const placements = VASTU_COMPONENTS
    .filter((component) => selections[component.key])
    .map((component) => {
      const direction = selections[component.key]
      const score = component.scores[direction]
      const band = placementBand(score)
      const best = bestDirections(component)
      // Advice is derived from the same table the score came from, so the words
      // and the number can never disagree.
      const advice = band.key === 'favourable'
        ? `${directionLabel(direction)} is among the recommended placements for this.`
        : `Traditionally preferred: ${best.join(' or ')}. ${component.principle}`
      // `bestKeys` is carried alongside `best` so a screen can word the same
      // advice in the selected language. Nothing above it changed: the score,
      // the band and the English `advice` are exactly as they were.
      return { component, direction, directionLabel: directionLabel(direction), score, band, best, bestKeys: bestDirectionKeys(component), advice }
    })

  const total = placements.reduce((sum, item) => sum + item.score, 0)
  // The reference's own measure: the mean preference score expressed out of 100.
  const percent = placements.length ? Math.round((total / placements.length) * 10) : 0

  return {
    ready: true,
    missing: [],
    placements,
    total,
    percent,
    band: overallBand(percent),
    favourable: placements.filter((item) => item.band.key === 'favourable'),
    attention: placements.filter((item) => item.band.key !== 'favourable'),
  }
}
