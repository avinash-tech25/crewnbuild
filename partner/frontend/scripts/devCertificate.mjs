import { X509Certificate } from 'node:crypto'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

// The locally trusted certificate `npm run dev:https` serves. Created per computer by
// `npm run dev:cert`; the .certs folder is git-ignored and must never be committed.
export const CERT_DIR = fileURLToPath(new URL('../.certs/', import.meta.url))
export const CERT_FILE = `${CERT_DIR}partner-dev.pem`
export const KEY_FILE = `${CERT_DIR}partner-dev-key.pem`

// This computer's current IPv4 addresses other devices can use (no loopback, no link-local).
export function lanIPv4Addresses() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((entry) => entry && (entry.family === 'IPv4' || entry.family === 4) && !entry.internal && !entry.address.startsWith('169.254.'))
    .map((entry) => entry.address)
}

// LAN addresses a browser would reject this certificate for -- the LAN address changed since dev:cert.
export function lanAddressesMissingFrom(certificatePem) {
  const covered = [...new X509Certificate(certificatePem).subjectAltName?.matchAll(/IP Address:([^,\s]+)/g) ?? []].map((match) => match[1])
  return lanIPv4Addresses().filter((address) => !covered.includes(address))
}
