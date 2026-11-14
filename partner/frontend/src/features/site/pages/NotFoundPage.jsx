import { Link } from 'react-router-dom'
import Logo from '../../../shared/ui/Logo.jsx'

export default function NotFound() {
  return (
    <div className="relative grid min-h-screen place-items-center px-5">
      {/* Top-left, as on every other Partner page, rather than stacked above the message. */}
      <div className="absolute left-5 top-6 sm:left-8"><Logo /></div>
      <div className="text-center">
        <h1 className="text-5xl font-extrabold text-oc-deep">404</h1>
        <p className="mt-2 text-oc-muted">This page does not exist.</p>
        <Link to="/" className="btn-primary mt-6">Back to Partner</Link>
      </div>
    </div>
  )
}
