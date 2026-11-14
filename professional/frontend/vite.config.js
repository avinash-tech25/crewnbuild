import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  // strictPort: Vite fails instead of quietly moving to another port. The API accepts only
  // the origin it is configured with, so a changed port would surface as a CORS error.
  server: {
    host: true,
    port: 5173,
    strictPort: true,
    open: true,
  },
  // No source maps in the production build (FE-10).
  build: { sourcemap: false },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.js'],
    css: false,
    // The dashboards are large lazy pages; their first load in jsdom takes seconds.
    testTimeout: 20000,
    env: { VITE_API_BASE_URL: 'http://api.test/api/v1', VITE_PARTNER_URL: 'http://partner.test' },
  },
})
