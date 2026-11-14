import fs from 'node:fs'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { CERT_FILE, KEY_FILE, lanAddressesMissingFrom } from './scripts/devCertificate.mjs'

// Same-origin path the browser uses for the local backend in development
// (resolveApiBaseUrl in src/shared/api/apiClient.js).
const DEV_API_PROXY_PATH = '/partner-api'
// The Partner backend in development (bound to this computer only).
const PARTNER_BACKEND = 'http://127.0.0.1:8200'

// `npm run dev:https`: a camera needs a secure context, and a LAN address is one only over
// HTTPS. The certificate comes from `npm run dev:cert` (mkcert) and is never committed.
function devHttpsOptions() {
  if (!fs.existsSync(CERT_FILE) || !fs.existsSync(KEY_FILE)) {
    throw new Error('No development certificate in partner/frontend/.certs. Run `npm run dev:cert` first.')
  }
  const cert = fs.readFileSync(CERT_FILE)
  const missing = lanAddressesMissingFrom(cert)
  if (missing.length) {
    console.warn(`\n  The development certificate does not cover ${missing.join(', ')}. Run \`npm run dev:cert\` again to open Partner there.\n`)
  }
  return { cert, key: fs.readFileSync(KEY_FILE) }
}

// Port 5373 (the Professional app uses 5173). strictPort, so a busy port fails loudly: the
// Professional Book Technician button and the backend's CORS list both name this port.
export default defineConfig(({ command, mode }) => ({
  plugins: [react()],
  server: {
    host: true,
    port: 5373,
    strictPort: true,
    https: command === 'serve' && mode === 'https' ? devHttpsOptions() : undefined,
    proxy: {
      [`${DEV_API_PROXY_PATH}/`]: {
        target: PARTNER_BACKEND,
        changeOrigin: true,
        // Live tracking's and dispatch's websockets go the same way, so an https:// page
        // (which a phone needs for real GPS) reaches them as wss:// on its own origin.
        ws: true,
        rewrite: (path) => path.slice(DEV_API_PROXY_PATH.length),
        configure: (proxy) => {
          // Backend not running: answer the way the backend does, so the page names the cause.
          proxy.on('error', (_error, _request, response) => {
            if (!response || typeof response.writeHead !== 'function' || response.headersSent) return
            response.writeHead(502, { 'Content-Type': 'application/json' })
            response.end(JSON.stringify({ detail: `Partner backend could not be reached at ${PARTNER_BACKEND}. Check that it is running and try again.` }))
          })
        },
      },
    },
  },
  // No source maps in the production build (FE-10).
  build: { sourcemap: false },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.js'],
    css: false,
    testTimeout: 20000,
    env: {
      VITE_API_BASE_URL: 'http://api.test/api/v1',
      VITE_PROFESSIONAL_ORIGIN: 'http://professional.test',
    },
  },
}))
