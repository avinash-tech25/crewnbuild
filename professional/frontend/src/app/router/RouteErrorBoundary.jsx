import { Component } from 'react'

/**
 * One per route (FE-07): a screen that throws while rendering shows a recovery screen,
 * not a blank page, and the rest of the app keeps working.
 */
export default class RouteErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { failed: false }
  }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  render() {
    if (!this.state.failed) return this.props.children
    return (
      <div className="flex min-h-svh flex-col items-center justify-center gap-4 bg-oc-paper px-6 text-center text-oc-ink" role="alert">
        <h1 className="font-display text-2xl font-extrabold">Something went wrong on this page.</h1>
        <p className="text-oc-muted">Reload to try again. Your work on other pages is not affected.</p>
        <button
          type="button"
          className="rounded-full bg-oc-green px-6 py-3 font-bold text-white"
          onClick={() => window.location.reload()}
        >
          Reload
        </button>
      </div>
    )
  }
}
