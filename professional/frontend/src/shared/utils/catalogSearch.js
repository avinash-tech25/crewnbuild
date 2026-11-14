// Plain-words product matching for buyers: "10kg ultratech cement bag".
//
// The same rules as the catalog search on the server
// (backend/app/services/master_catalog_service.py, search_catalog), applied to
// the supplier listings a buyer's screen already holds. A word scores by the
// most important field it appears in:
//     name > brand > variant/size > category/subcategory > unit
//     > specifications > description
// Numbers and unit words ("10", "kg", "bag") only add to a listing that already
// matched a real word, so "bag" alone never brings in steel or bricks.

const STOP_WORDS = new Set(['a', 'an', 'and', 'the', 'of', 'for', 'in', 'with', 'to', 'per'])
const MEASURE_WORDS = new Set([
  'kg', 'g', 'gm', 'gram', 'kilogram', 'tonne', 'ton', 'mt', 'mm', 'cm', 'm', 'metre', 'meter', 'ft',
  'inch', 'bag', 'piece', 'pc', 'pcs', 'no', 'nos', 'litre', 'liter', 'l', 'ltr', 'pack', 'packet',
  'size', 'standard', 'unit', 'box', 'bundle', 'sqft', 'sq',
])

function singular(word) {
  if (['kgs', 'pcs', 'nos', 'mts'].includes(word)) return word.slice(0, -1)
  if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1)
  return word
}

export function searchWords(value) {
  const words = []
  for (const raw of String(value || '').toLowerCase().match(/[a-z]+|\d+(?:\.\d+)?/g) || []) {
    const word = singular(raw)
    if (!STOP_WORDS.has(word) && !words.includes(word)) words.push(word)
  }
  return words
}

const isMeasure = (word) => MEASURE_WORDS.has(word) || /^\d/.test(word)

// A listing's fields, strongest first. A catalog listing's copied text already
// holds its canonical values: size is the variant, product_type the
// subcategory, features the specifications.
function listingFields(listing) {
  return [
    [30, searchWords(listing.name)],
    [26, searchWords(listing.brand)],
    [22, searchWords(listing.size)],
    [16, searchWords(`${listing.category || ''} ${listing.product_type || ''}`)],
    [10, searchWords(listing.unit)],
    [8, searchWords(`${listing.features || ''} ${listing.grade || ''}`)],
    [3, searchWords(`${listing.description || ''} ${listing.usage || ''}`)],
  ]
}

/** How well one listing matches the query: 0 for not at all, higher is better. */
export function listingSearchScore(query, listing) {
  const words = searchWords(query)
  if (!words.length) return 0
  const fields = listingFields(listing)
  const realWords = words.filter((word) => !isMeasure(word))
  let score = 0
  let matchedReal = false
  let matchedAny = false
  for (const word of words) {
    const hit = fields.find(([, fieldWords]) => fieldWords.includes(word))
    if (!hit) continue
    matchedAny = true
    const [weight] = hit
    const inSize = fields[2][1].includes(word)
    score += !isMeasure(word) || inSize ? weight : Math.floor(weight / 3)
    if (!isMeasure(word)) matchedReal = true
  }
  if (realWords.length ? !matchedReal : !matchedAny) return 0
  const nameWords = searchWords(listing.name)
  if (words.join(' ') === nameWords.join(' ')) score += 200
  const numbers = words.filter((word) => /^\d/.test(word))
  if (numbers.length && numbers.every((number) => fields[2][1].includes(number))) score += 40
  return score
}
