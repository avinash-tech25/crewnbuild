// The Engineer Category an engineer has chosen but the server has not yet
// confirmed, so a failed save or a refresh does not lose it. The same hand-off
// pendingSupplierCategory.js makes for a supplier; once saved, the server's answer
// is the only source.

import { engineerCategoryOptions } from './profileConstants.js'

const KEY = 'crewnbuild_pending_engineer_category'

export function readPendingEngineerCategory(userId) {
  try {
    const stored = window.localStorage.getItem(`${KEY}:${userId}`)
    return engineerCategoryOptions.includes(stored) ? stored : ''
  } catch {
    return ''
  }
}

export function clearPendingEngineerCategory(userId) {
  try { window.localStorage.removeItem(`${KEY}:${userId}`) } catch { /* storage unavailable */ }
}

/** Saves through `saveToServer`; the remembered choice goes only once that succeeds. */
export async function submitEngineerCategory(userId, category, saveToServer) {
  if (userId && engineerCategoryOptions.includes(category)) {
    try { window.localStorage.setItem(`${KEY}:${userId}`, category) } catch { /* storage unavailable */ }
  }
  const saved = await saveToServer(category)
  clearPendingEngineerCategory(userId)
  return saved
}
