// Receipt display helpers. Every value comes from the backend's verified receipt.

export function formatRupees(paise) {
  if (paise === null || paise === undefined) return '—'
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 0, maximumFractionDigits: 2 })
    .format(Number(paise) / 100)
}

export function formatReceiptDate(isoUtc) {
  if (!isoUtc) return '—'
  // The backend stores UTC without a zone marker.
  const value = new Date(/[zZ]|[+-]\d\d:\d\d$/.test(isoUtc) ? isoUtc : `${isoUtc}Z`)
  return value.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })
}

export function paymentMethodLabel(method) {
  if (!method) return '—'
  const known = { upi: 'UPI', card: 'Card', netbanking: 'Netbanking', wallet: 'Wallet', emi: 'EMI', paylater: 'Pay Later' }
  return known[String(method).toLowerCase()] || String(method)
}

export function receiptRows(receipt) {
  return [
    ['Receipt Number', receipt.receipt_number],
    ['Booking ID', receipt.booking_reference],
    ['Date/Time', formatReceiptDate(receipt.issued_at)],
    ['House Owner', receipt.house_owner || '—'],
    ['Technician', receipt.technician || '—'],
    ['Technician Role', receipt.technician_role],
    ['Selected Service', receipt.selected_service || '—'],
    ['Service Amount', formatRupees(receipt.service_amount_paise)],
    ['Total Paid', formatRupees(receipt.total_paid_paise)],
    ['Payment Method', paymentMethodLabel(receipt.payment_method)],
    ['Razorpay Payment ID', receipt.razorpay_payment_id],
    ['Razorpay Order ID', receipt.razorpay_order_id],
    ['Payment Status', receipt.payment_status],
  ]
}

const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]
))

/** A clean printable receipt in its own window, then the browser's print dialog. */
export function printReceipt(receipt) {
  const rows = receiptRows(receipt)
    .map(([label, value]) => `<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`)
    .join('')
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(receipt.receipt_number)}</title>
<style>
  body{font-family:Arial,Helvetica,sans-serif;color:#111;margin:32px}
  .box{max-width:560px;margin:0 auto;border:1px solid #ccc;border-radius:8px;padding:24px}
  h1{margin:0;font-size:22px;letter-spacing:.06em} h2{margin:4px 0 16px;font-size:14px;color:#555;font-weight:600;text-transform:uppercase}
  table{width:100%;border-collapse:collapse;font-size:13px} th{text-align:left;color:#555;font-weight:600;padding:6px 8px 6px 0;width:45%}
  td{padding:6px 0;word-break:break-all} tr{border-bottom:1px solid #eee}
  .test{margin-top:18px;border:2px dashed #b45309;color:#b45309;text-align:center;padding:10px;font-weight:700;letter-spacing:.04em}
</style></head><body><div class="box">
<h1>CREWNBUILD</h1><h2>Payment Receipt</h2><table>${rows}</table>
<div class="test">TEST MODE<br>${escapeHtml(receipt.notice || 'TEST PAYMENT — NO REAL MONEY TRANSFERRED')}</div>
</div></body></html>`
  const printWindow = window.open('', '_blank', 'width=720,height=900')
  if (!printWindow) return false
  printWindow.document.open()
  printWindow.document.write(html)
  printWindow.document.close()
  printWindow.focus()
  // document.write does not always fire onload, so a short timer backs it up; the
  // flag keeps the print dialog to one.
  let printed = false
  const printOnce = () => {
    if (printed) return
    printed = true
    try { printWindow.print() } catch { /* window closed */ }
  }
  printWindow.onload = printOnce
  setTimeout(printOnce, 400)
  return true
}
