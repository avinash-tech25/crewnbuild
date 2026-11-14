import ReactDOM from 'react-dom/client'
import App from './app/App.jsx'
import AppProviders from './app/AppProviders.jsx'
import './index.css'
import { preloadSavedLanguage } from './i18n/LanguageContext.jsx'

// The saved language's text first (it is downloaded separately), then the app.
preloadSavedLanguage().then(() => {
  ReactDOM.createRoot(document.getElementById('root')).render(
    <AppProviders>
      <App />
    </AppProviders>,
  )
})
