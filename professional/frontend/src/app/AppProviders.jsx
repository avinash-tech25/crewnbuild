import React from 'react'
import { Provider } from 'react-redux'
import { LanguageProvider } from '../i18n/LanguageContext.jsx'
import { ThemeProvider } from '../theme/ThemeContext.jsx'
import { store as appStore } from './store.js'

export default function AppProviders({ children, store = appStore }) {
  return (
    <React.StrictMode>
      <Provider store={store}>
        <ThemeProvider>
          <LanguageProvider>{children}</LanguageProvider>
        </ThemeProvider>
      </Provider>
    </React.StrictMode>
  )
}
