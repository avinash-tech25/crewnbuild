// A budget amount written out in words, for display under the numeric field.
// Display only: nothing here changes the value that is saved.

const ONES = [
  '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
  'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen',
]
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety']

// Larger than any construction budget; beyond it the words stop being useful.
const LARGEST_AMOUNT = 999999999999

function belowHundred(number) {
  if (number < 20) return ONES[number]
  const tens = TENS[Math.floor(number / 10)]
  const ones = ONES[number % 10]
  return ones ? `${tens}-${ones}` : tens
}

function belowThousand(number) {
  const hundreds = Math.floor(number / 100)
  const rest = number % 100
  return [hundreds ? `${ONES[hundreds]} Hundred` : '', rest ? belowHundred(rest) : ''].filter(Boolean).join(' ')
}

// Indian numbering: crore, lakh, thousand, hundred (25,00,000 = Twenty-Five Lakh).
export function indianNumberInWords(value) {
  let number = Math.floor(Number(value) || 0)
  if (number === 0) return 'Zero'
  const crore = Math.floor(number / 10000000)
  number %= 10000000
  const lakh = Math.floor(number / 100000)
  number %= 100000
  const thousand = Math.floor(number / 1000)
  number %= 1000
  return [
    crore ? `${crore >= 1000 ? indianNumberInWords(crore) : belowThousand(crore)} Crore` : '',
    lakh ? `${belowHundred(lakh)} Lakh` : '',
    thousand ? `${belowHundred(thousand)} Thousand` : '',
    number ? belowThousand(number) : '',
  ].filter(Boolean).join(' ')
}

// International numbering: billion, million, thousand, hundred.
export function internationalNumberInWords(value) {
  let number = Math.floor(Number(value) || 0)
  if (number === 0) return 'Zero'
  const scales = [[1000000000, 'Billion'], [1000000, 'Million'], [1000, 'Thousand']]
  const parts = []
  scales.forEach(([size, name]) => {
    const count = Math.floor(number / size)
    if (count) parts.push(`${belowThousand(count)} ${name}`)
    number %= size
  })
  if (number) parts.push(belowThousand(number))
  return parts.join(' ')
}

/**
 * "₹25,00,000" -> "Twenty-Five Lakh Rupees". Empty for anything that is not a
 * positive amount, so the caption only appears once there is something to read.
 */
export function budgetInWords(value, _country = 'India') {
  if (value === '' || value === null || value === undefined) return ''
  const amount = Number(value)
  if (!Number.isFinite(amount) || amount <= 0 || amount > LARGEST_AMOUNT) return ''
  const whole = Math.floor(amount)
  const fraction = Math.round((amount - whole) * 100)

  const rupees = whole ? `${indianNumberInWords(whole)} ${whole === 1 ? 'Rupee' : 'Rupees'}` : ''
  return [rupees, fraction ? `${belowHundred(fraction)} Paise` : ''].filter(Boolean).join(' and ')
}
