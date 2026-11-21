import React from 'react'
import { MotionConfig } from 'framer-motion'
import { Provider } from 'react-redux'
import { LanguageProvider } from '../i18n/LanguageContext.jsx'
import { ThemeProvider } from '../theme/ThemeContext.jsx'
import { store as appStore } from './store.js'

export default function AppProviders({ children, store = appStore }) {
  return (
    <React.StrictMode>
      <Provider store={store}>
        <ThemeProvider>
          {/* framer-motion animations follow the visitor's reduced-motion setting (WCAG 2.3.3);
              CSS animations follow the matching rule in index.css. */}
          <MotionConfig reducedMotion="user">
            <LanguageProvider>{children}</LanguageProvider>
          </MotionConfig>
        </ThemeProvider>
      </Provider>
    </React.StrictMode>
  )
}
