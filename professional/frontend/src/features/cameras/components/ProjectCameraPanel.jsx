/**
 * The project camera, and the one-time setup that stands in front of it.
 *
 * A project has ONE recorder and one set of cameras. The House Owner, the
 * Builder and the Site Engineer all end up looking at that same recorder; what
 * each of them must do first is verify it once. The backend decides whether
 * that has happened (GET /cctv/projects/{id}/camera-setup) -- this component
 * only renders the answer, so a user cannot reach the cameras by editing state
 * in the browser.
 *
 * The form asks for the five things a person actually knows: device type,
 * address, port, username, password. No RTSP URL, no stream path, no channel
 * number, no profile token, no gateway URL -- the backend reads all of that
 * from the recorder during discovery.
 *
 * The password lives in this component's state for the duration of the request
 * and is cleared as soon as it resolves. It is never written to localStorage,
 * sessionStorage, a URL or the console.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2, Lock, RefreshCw, ShieldCheck, Video } from 'lucide-react'
import { EmptyState } from '../../../shared/dashboard/RoleDashboardUi.jsx'
import ProjectCameraViewer from './ProjectCameraViewer.jsx'
import { connectProjectCamera, fetchProjectCameraDevices, fetchProjectCameraSetup } from '../camerasApi.js'
import { useLanguage } from '../../../i18n/LanguageContext.jsx'

const inputClass =
  'h-11 w-full rounded-xl border border-oc-line bg-white px-3 text-sm font-semibold text-oc-ink outline-none transition focus:border-oc-green focus:ring-4 focus:ring-ocbrand-50'
const labelClass = 'grid gap-1.5 text-xs font-extrabold uppercase tracking-wide text-oc-muted'
const cardClass = 'rounded-2xl border border-oc-line bg-white p-5 shadow-[0_14px_40px_-30px_rgba(15,23,42,0.35)]'

/**
 * The message the API sent, or a plain fallback. Never a stack trace.
 *
 * The server writes its `detail` in English. Returning it as it stood produced
 * a sentence in two languages at once — the server's English followed by a
 * translated suffix — so the API's own words now go through `td`, which
 * machine-translates them for display. Nothing is sent or stored differently;
 * this only decides what the reader sees.
 */
function apiMessage(error, fallback, t, td) {
  const detail = error?.response?.data?.detail
  if (typeof detail === 'string') return td(detail)
  if (detail?.message) {
    const field = Array.isArray(detail.fields) && detail.fields.length ? ` ${detail.fields[0].message}` : ''
    return td(`${detail.message}${field}`)
  }
  // A 500 answers with plain text and a dropped connection answers with
  // nothing, so neither carries a `detail` to show. Saying which of the two
  // happened is the difference between a message somebody can act on and one
  // that only says something went wrong.
  if (!error?.response) return `${fallback} ${t('ui.cctv.serverUnreachable')}`
  if (error.response.status >= 500) return `${fallback} ${t('ui.cctv.serverReturnedError', { status: error.response.status })}`
  return fallback
}

// --- setup form --------------------------------------------------------------

// DVR and NVR are acronyms, not words: they are written the same way in all
// seven languages (the interface's own copy already says "DVR/NVR" through
// `ui.cctv.connectDvrNvr`), and the value is what is sent to the backend. Both
// stay exactly as they are.
const DEVICE_TYPES = [
  { value: 'DVR', label: 'DVR' },
  { value: 'NVR', label: 'NVR' },
]

function ConnectForm({ projectTitle, hasDevice, busy, stage, message, onSubmit }) {
  const { t, td } = useLanguage()
  const [deviceType, setDeviceType] = useState('DVR')
  const [host, setHost] = useState('')
  const [port, setPort] = useState('')
  // Optional. Blank means "the standard 554", which the backend applies as its
  // own default, so a recorder on 554 is configured exactly as it always was.
  const [rtspPort, setRtspPort] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')

  const submit = async (event) => {
    event.preventDefault()
    const ok = await onSubmit({ deviceType, host: host.trim(), port, rtspPort: rtspPort.trim(), username: username.trim(), password })
    // Whatever the outcome, the secret does not stay in memory afterwards.
    setPassword('')
    if (ok) {
      setHost('')
      setPort('')
      setRtspPort('')
      setUsername('')
    }
  }

  return (
    <form onSubmit={submit} className={`${cardClass} mx-auto w-full max-w-md`}>
      <div className="mb-4 text-center">
        <p className="text-[11px] font-extrabold uppercase tracking-[0.18em] text-oc-muted">{t('ui.cctv.connectDvrNvr')}</p>
        <h3 className="mt-1 font-display text-xl font-extrabold text-oc-ink">{td(projectTitle)}</h3>
        {hasDevice && (
          <p className="mt-2 text-xs font-semibold text-oc-muted">
            {t('ui.cctv.existingRecorderNote')}
          </p>
        )}
      </div>

      <div className="grid gap-3">
        <label className={labelClass}>
          <span>{t('ui.cctv.deviceType')}</span>
          <select value={deviceType} onChange={(event) => setDeviceType(event.target.value)} className={inputClass} disabled={busy}>
            {DEVICE_TYPES.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
        <label className={labelClass}>
          <span>{t('ui.cctv.ipAddressHost')}</span>
          {/* An example IP address, not a word: it has no letters to
              translate and must stay recognisable as an address. */}
          <input value={host} onChange={(event) => setHost(event.target.value)} className={inputClass}
                 placeholder="192.168.1.100" autoComplete="off" required disabled={busy} />
        </label>
        <label className={labelClass}>
          <span>{t('ui.cctv.port')}</span>
          {/* The default HTTP port. A number, the same in every language. */}
          <input value={port} onChange={(event) => setPort(event.target.value)} className={inputClass}
                 inputMode="numeric" placeholder="80" autoComplete="off" required disabled={busy} />
        </label>
        <label className={labelClass}>
          <span>{t('ui.cctv.rtspPort')}</span>
          {/* Optional, and not `required`: almost every recorder serves RTSP on
              554, so asking for it outright would add a question nobody can
              answer to the one form a customer has to get through. Typing one
              is what a non-standard deployment needs. */}
          <input value={rtspPort} onChange={(event) => setRtspPort(event.target.value)} className={inputClass}
                 inputMode="numeric" placeholder="554" autoComplete="off" disabled={busy} />
          <span className="text-[10px] font-semibold normal-case tracking-normal text-oc-faint">
            {t('ui.cctv.rtspPortHint')}
          </span>
        </label>
        <label className={labelClass}>
          <span>{t('ui.cctv.username')}</span>
          <input value={username} onChange={(event) => setUsername(event.target.value)} className={inputClass}
                 autoComplete="off" required disabled={busy} />
        </label>
        <label className={labelClass}>
          <span>{t('login.password')}</span>
          <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} className={inputClass}
                 autoComplete="new-password" required disabled={busy} />
        </label>
      </div>

      <button type="submit" disabled={busy}
              className="mt-4 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-oc-green px-4 text-sm font-extrabold text-white shadow-[0_10px_22px_-12px_rgba(18,107,69,0.85)] transition hover:bg-oc-deep disabled:opacity-60">
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
        {busy ? (stage === 'discovering' ? t('ui.cctv.discoveringCameras') : t('ui.cctv.verifyingDvrNvr')) : t('ui.cctv.verifyDevice')}
      </button>

      {message && (
        <p className={`mt-3 rounded-xl px-3 py-2 text-center text-xs font-bold ${
          message.tone === 'error' ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-700'
        }`}>
          {message.text}
        </p>
      )}

      <p className="mt-3 flex items-center justify-center gap-1.5 text-[11px] font-semibold text-oc-faint">
        <Lock className="h-3 w-3" /> {t('ui.cctv.credentialsNote')}
      </p>
    </form>
  )
}

// --- panel -------------------------------------------------------------------

/**
 * `onAccessGranted` lets a host screen that has its own camera list (the Site
 * Engineer's Live Camera page) reload itself once setup succeeds, instead of
 * this panel taking that screen over.
 */
export default function ProjectCameraPanel({ projectId, projectTitle = '', onAccessGranted = null }) {
  const { t, td } = useLanguage()
  // Read through refs inside `refresh`, so a language change does not rebuild
  // the callback and re-run the setup request.
  const tRef = useRef(t)
  tRef.current = t
  const tdRef = useRef(td)
  tdRef.current = td
  const [status, setStatus] = useState(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [stage, setStage] = useState('idle')
  const [message, setMessage] = useState(null)
  const [devices, setDevices] = useState([])
  const alive = useRef(true)

  // Re-armed on mount, not just cleared on unmount. React 18's StrictMode
  // mounts an effect, tears it down and mounts it again in development; with
  // only the cleanup here, that teardown left `alive` false for the rest of the
  // component's life. Every state update below is guarded by it, so `loading`
  // was set true and never set false again -- the panel sat on "Loading project
  // camera…" forever and swallowed whatever the API had actually answered.
  useEffect(() => {
    alive.current = true
    return () => { alive.current = false }
  }, [])

  const loadCameras = useCallback(async () => {
    try {
      const rows = await fetchProjectCameraDevices(projectId)
      if (!alive.current) return
      // Raw devices, not a flattened channel list: the viewer reads
      // device.is_active / device.status to decide whether a camera is
      // watchable, exactly as the Site Engineer's page always has.
      setDevices(Array.isArray(rows) ? rows : [])
    } catch {
      if (alive.current) setDevices([])
    }
  }, [projectId])

  const refresh = useCallback(async () => {
    setLoading(true)
    setLoadError('')
    try {
      const next = await fetchProjectCameraSetup(projectId)
      if (!alive.current) return
      setStatus(next)
      if (next.access_granted) await loadCameras()
    } catch (error) {
      if (alive.current) setLoadError(apiMessage(error, tRef.current('ui.cctv.cameraUnavailable'), tRef.current, tdRef.current))
    } finally {
      if (alive.current) setLoading(false)
    }
  }, [projectId, loadCameras])

  useEffect(() => { refresh() }, [refresh])

  const submit = async (form) => {
    setBusy(true)
    setStage('verifying')
    setMessage(null)
    try {
      // One call: the server verifies the credentials, then discovers the
      // cameras if this project's recorder has none yet.
      setStage('discovering')
      const result = await connectProjectCamera(projectId, form)
      if (!alive.current) return true
      setMessage({ tone: 'ok', text: t('ui.cctv.deviceVerified') })
      setShowForm(false)
      if (result?.access_granted && onAccessGranted) {
        // The host screen owns the camera list from here.
        onAccessGranted()
        return true
      }
      await refresh()
      return Boolean(result?.access_granted)
    } catch (error) {
      if (alive.current) setMessage({ tone: 'error', text: apiMessage(error, t('ui.cctv.recorderNotVerified'), t, td) })
      return false
    } finally {
      if (alive.current) { setBusy(false); setStage('idle') }
    }
  }

  const title = status?.project_title || projectTitle

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-10 text-sm font-bold text-oc-muted">
        <Loader2 className="h-4 w-4 animate-spin" /> {t('ui.cctv.loadingProjectCamera')}
      </div>
    )
  }

  if (loadError) {
    return <EmptyState title={t('ui.cctv.projectCamera')} message={loadError} />
  }

  if (status?.access_granted) {
    return (
      <div className="grid gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-[11px] font-extrabold uppercase tracking-[0.18em] text-oc-muted">{t('ui.cctv.projectCamera')}</p>
            <h3 className="font-display text-lg font-extrabold text-oc-ink">{td(title)}</h3>
          </div>
          <button onClick={refresh}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-oc-line bg-white px-3 py-2 text-xs font-bold text-oc-deep">
            <RefreshCw className="h-3.5 w-3.5" /> {t('dash.engineer.refresh')}
          </button>
        </div>
        {/* The Site Engineer's own Live + Recorded implementation, shared so
            the House Owner and the Builder get the same thing rather than a
            second copy of it. */}
        <ProjectCameraViewer devices={devices} projectTitle={title} onReload={refresh} />
      </div>
    )
  }

  if (showForm) {
    return (
      <ConnectForm projectTitle={title} hasDevice={Boolean(status?.has_device)} busy={busy}
                   stage={stage} message={message} onSubmit={submit} />
    )
  }

  return (
    <div className={`${cardClass} mx-auto w-full max-w-md text-center`}>
      <p className="text-[11px] font-extrabold uppercase tracking-[0.18em] text-oc-muted">{t('ui.cctv.projectCamera')}</p>
      <h3 className="mt-1 font-display text-xl font-extrabold text-oc-ink">{td(title)}</h3>
      <p className="mx-auto mt-3 max-w-xs text-sm font-semibold text-oc-muted">
        {t('ui.cctv.noAccessConfigured')}
      </p>
      <button onClick={() => { setMessage(null); setShowForm(true) }}
              className="mt-4 inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-oc-green px-5 text-sm font-extrabold text-white shadow-[0_10px_22px_-12px_rgba(18,107,69,0.85)] transition hover:bg-oc-deep">
        <Video className="h-4 w-4" /> {t('ui.cctv.connectDvrNvr')}
      </button>
    </div>
  )
}
