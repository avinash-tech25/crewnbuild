// The Supplier Category a supplier has chosen but the server has not yet confirmed,
// so a failed save or a refresh does not lose it (the same localStorage hand-off the
// app already uses for plans, invites and estimates). Once saved, the server's
// answer is the only source: this copy is gone.

import { supplierTypeOptions } from './profileConstants.js'

const KEY = 'crewnbuild_pending_supplier_category'

// The onboarding screen's order. The values are supplierTypeOptions'.
export const SUPPLIER_CATEGORY_CHOICES = ['Material Supplier', 'Equipment Supplier', 'Labor Supplier']

export function savePendingSupplierCategory(userId, category) {
  if (!userId || !supplierTypeOptions.includes(category)) return false
  try {
    window.localStorage.setItem(`${KEY}:${userId}`, category)
    return true
  } catch {
    return false
  }
}

export function readPendingSupplierCategory(userId) {
  try {
    const stored = window.localStorage.getItem(`${KEY}:${userId}`)
    return supplierTypeOptions.includes(stored) ? stored : ''
  } catch {
    return ''
  }
}

export function clearPendingSupplierCategory(userId) {
  try { window.localStorage.removeItem(`${KEY}:${userId}`) } catch { /* storage unavailable */ }
}

/** Saves through `saveToServer`; the remembered choice goes only once that succeeds. */
export async function submitSupplierCategory(userId, category, saveToServer) {
  savePendingSupplierCategory(userId, category)
  const saved = await saveToServer(category)
  clearPendingSupplierCategory(userId)
  return saved
}
