/**
 * A safety net around a pop-up. If anything inside it throws while rendering,
 * the rest of the dashboard keeps working: instead of React unmounting the
 * whole application (a blank white page), the pop-up shows a short message
 * with a Close button, and the real error is logged to the console so it can
 * be traced. Rendering only -- no data, request or flow is involved.
 */
import { Component } from 'react'

export default class ModalErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error(`[${this.props.name || 'Pop-up'}] failed to render:`, error, info?.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="fixed inset-0 z-[150] flex items-center justify-center bg-slate-900/40 p-4" role="alertdialog" aria-modal="true">
        <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-5 text-center shadow-2xl">
          <p className="font-display text-base font-extrabold text-slate-950">{this.props.title || 'Something went wrong'}</p>
          <p className="mt-1.5 text-sm text-slate-500">{this.props.message || 'This window could not be opened. Please close it and try again.'}</p>
          <p className="mt-2 break-words text-[11px] text-slate-400">{String(this.state.error?.message || this.state.error)}</p>
          <button
            type="button"
            onClick={() => { this.setState({ error: null }); this.props.onClose?.() }}
            className="mt-4 inline-flex h-10 items-center justify-center rounded-lg bg-brand-600 px-6 text-sm font-extrabold text-white transition hover:bg-brand-700"
          >
            {this.props.closeLabel || 'Close'}
          </button>
        </div>
      </div>
    )
  }
}
