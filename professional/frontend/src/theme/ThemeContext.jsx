import { createContext, useContext, useEffect, useState } from 'react'

// NOTE: keep this key in sync with the inline script in index.html,
// which pre-applies the dark class before React mounts to avoid a flash.
//
// The app opens in the light theme. Dark is used only when the visitor has
// chosen it with the theme toggle, and only that explicit choice is saved.
// The previous key ('crewnbuild_theme') was written on every load — including
// when the value merely came from the OS dark-mode setting — so a saved 'dark'
// there does not mean anybody picked it. It is ignored and cleared.
export const THEME_STORAGE_KEY = 'crewnbuild_theme_preference'
const LEGACY_THEME_STORAGE_KEY = 'crewnbuild_theme'

const ThemeContext = createContext(null)

function readInitialTheme() {
  try {
    window.localStorage.removeItem(LEGACY_THEME_STORAGE_KEY)
    if (window.localStorage.getItem(THEME_STORAGE_KEY) === 'dark') return 'dark'
  } catch {
    /* noop */
  }
  return 'light'
}

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(readInitialTheme)

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
  }, [theme])

  const toggleTheme = () => setTheme((current) => {
    const next = current === 'dark' ? 'light' : 'dark'
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next)
    } catch {
      /* noop */
    }
    return next
  })

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  const context = useContext(ThemeContext)
  if (!context) throw new Error('useTheme must be used inside a ThemeProvider')
  return context
}
