// `npm run dev:cert`: a locally trusted certificate for `npm run dev:https`, made by mkcert
// for localhost and this computer's current LAN addresses. Nothing is hardcoded, so run it
// again whenever the LAN address changes.
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import { CERT_DIR, CERT_FILE, KEY_FILE, lanIPv4Addresses } from './devCertificate.mjs'

const caRoot = spawnSync('mkcert', ['-CAROOT'], { encoding: 'utf8' })
if (caRoot.error || caRoot.status !== 0) {
  console.error('mkcert was not found. Install it once (winget install FiloSottile.mkcert), open a new terminal, run `mkcert -install`, then run `npm run dev:cert` again.')
  process.exit(1)
}

const addresses = lanIPv4Addresses()
const names = ['localhost', '127.0.0.1', '::1', ...addresses]
fs.mkdirSync(CERT_DIR, { recursive: true })
const result = spawnSync('mkcert', ['-cert-file', CERT_FILE, '-key-file', KEY_FILE, ...names], { stdio: 'inherit' })
if (result.status !== 0) process.exit(result.status ?? 1)

console.log(`
Certificate for: ${names.join(', ')}
Start Partner:   npm run dev:https
Open:            https://localhost:5373${addresses.map((address) => `, https://${address}:5373`).join('')}

A phone or another computer must trust this computer's mkcert CA once: install
rootCA.pem from ${caRoot.stdout.trim()} on that device as a trusted CA certificate.
Never copy rootCA-key.pem anywhere.
`)
