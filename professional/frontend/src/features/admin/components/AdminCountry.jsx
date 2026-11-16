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
