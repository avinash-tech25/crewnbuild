import ReactDOM from 'react-dom/client'
import App from './app/App.jsx'
import AppProviders from './app/AppProviders.jsx'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <AppProviders>
    <App />
  </AppProviders>,
)
