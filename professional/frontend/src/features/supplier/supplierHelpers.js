export const splitEditableList = (value) => String(value || '').split(',').map((item) => item.trim()).filter(Boolean)

import { formatMoney as countryFormatMoney } from '../../shared/utils/countryConfig.js'

export function formatMoney(value, country) {
  return countryFormatMoney(value, country)
}

export function initials(name) {
  return String(name || 'U').slice(0, 2).toUpperCase()
}

export function supplierClientsStorageKey(userId, pincode) {
  return `crewnbuild_seen_supplier_clients_${userId || 'guest'}_${pincode || 'all'}`
}

export function supplierClientIdentity(client) {
  return [
    client.type || 'CLIENT',
    client.user_id || 'user',
    client.project_id || client.id || 'profile',
  ].join(':')
}

export function readSeenSupplierClientKeys(userId, pincode) {
  try {
    return JSON.parse(localStorage.getItem(supplierClientsStorageKey(userId, pincode)) || '[]')
  } catch {
    localStorage.removeItem(supplierClientsStorageKey(userId, pincode))
    return []
  }
}

export function saveSeenSupplierClientKeys(userId, pincode, keys) {
  localStorage.setItem(supplierClientsStorageKey(userId, pincode), JSON.stringify([...new Set(keys)]))
}
