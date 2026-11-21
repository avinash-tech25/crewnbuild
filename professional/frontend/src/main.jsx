import { useEffect } from 'react'
import ReactDOM from 'react-dom/client'
import App from './app/App.jsx'
import AppProviders from './app/AppProviders.jsx'
// Self-hosted Manrope and Inter (no font host in the Content Security Policy).
import './assets/fonts/fonts.css'
import './index.css'
import { preloadSavedLanguage } from './i18n/LanguageContext.jsx'

// Once the app has rendered, the start-up screen (index.html) may fade out: it does so when
// its logo animation has finished.
function StartupReady() {
  useEffect(() => {
    window.__CREWNBUILD_INTRO__?.appReady()
  }, [])
  return null
}

// The saved language's text first (it is downloaded separately), then the app.
preloadSavedLanguage().then(() => {
  ReactDOM.createRoot(document.getElementById('root')).render(
    <AppProviders>
      <App />
      <StartupReady />
    </AppProviders>,
  )
})
