/**
 * Which country the console is looking at.
 *
 * Crew&Build serves India only, so there is no country switch: every screen
 * shows the administrator's whole scope and no country is sent to the API. The
 * provider stays so the screens that read it keep working unchanged.
 */

import { createContext, useContext, useEffect } from 'react'

// Where the retired country switch remembered its choice. Cleared on load, so a
// choice saved by an older version cannot narrow every request.
const STORAGE_KEY = 'crewnbuild_admin_country'

/** A country's flag, drawn rather than typed.
 *
 * Flag emoji are not an option: Windows ships no glyphs for them, so a 🇮🇳 shows
 * up as the bare letters "IN" — which is worse than the plain country name it
 * would be replacing. These are simple enough to draw and render identically
 * everywhere.
 */
export function CountryFlag({ country, className = 'h-4 w-6' }) {
  const name = (country || '').trim().toUpperCase()
  const shared = `shrink-0 rounded-[2px] ring-1 ring-black/10 ${className}`

  if (name === 'INDIA' || name === 'IN') {
    return (
      <svg viewBox="0 0 900 600" className={shared} role="img" aria-label="India">
        <rect width="900" height="200" fill="#FF9933" />
        <rect y="200" width="900" height="200" fill="#FFFFFF" />
        <rect y="400" width="900" height="200" fill="#138808" />
        <circle cx="450" cy="300" r="60" fill="none" stroke="#000080" strokeWidth="11" />
        <circle cx="450" cy="300" r="12" fill="#000080" />
      </svg>
    )
  }

  return null
}

const NO_COUNTRY = { country: '', setCountry: () => {} }
const AdminCountryContext = createContext(NO_COUNTRY)

export function AdminCountryProvider({ children }) {
  useEffect(() => {
    try {
      window.localStorage.removeItem(STORAGE_KEY)
    } catch {
      // A browser refusing storage has nothing stored to clear.
    }
  }, [])

  return <AdminCountryContext.Provider value={NO_COUNTRY}>{children}</AdminCountryContext.Provider>
}

export function useAdminCountry() {
  return useContext(AdminCountryContext)
}
