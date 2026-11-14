import { Provider } from 'react-redux'
import { BrowserRouter } from 'react-router-dom'
import AppRouter from './router/AppRouter.jsx'
import { store } from './store.js'

export default function App() {
  return (
    <Provider store={store}>
      <BrowserRouter>
        <AppRouter />
      </BrowserRouter>
    </Provider>
  )
}
