import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './app/App.jsx'
// Self-hosted Manrope and Inter (no font host in the Content Security Policy).
import './assets/fonts/fonts.css'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
