/**
 * Site Engineer - Live Camera (with Recorded playback).
 *
 * A dedicated page reached from the Live Camera button in the dashboard hero.
 * It is deliberately self-contained: nothing here touches the calendar, daily
 * workflow, site photos/videos or any other project data.
 *
 * Cameras come from the backend: the engineer's projects from
 * GET /engineers/my-projects, and each project's cameras from
 * GET /cctv/projects/{project_id}/devices, which authorizes the engineer's
 * ACTIVE assignment on every request. Each enabled channel is one camera.
 *
 * Both modes are rendered by the shared ProjectCameraViewer, which the House
 * Owner's and Builder's panels use too, so all three roles get the same Live
 * and Recorded behaviour from one implementation.
 *
 * Two modes share the same camera list:
 *  - Live: HD(=MAIN)/SD(=SUB) live playback (LiveCameraPlayer), unchanged.
 *  - Recorded: search the DVR's own recordings for a camera + local-time window,
 *    then play a real recorded segment with seek and 1x/1.5x/2x/3x speed
 *    (RecordedCameraPlayer). Speed is applied DVR-side, not faked in the browser.
 *
 * Playback, renewal and cleanup live in the player components. Nothing about a
 * camera is stored in the browser, and no camera address, stream path,
 * credential or playback token is ever shown or kept here.
 */
import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Building2, Clock, Radio, Settings, Video } from 'lucide-react'
import { fetchEngineerProjects } from '../../engineers/engineersApi.js'
import { fetchProjectCameraDevices, fetchProjectCameraSetup } from '../camerasApi.js'
import { useLanguage } from '../../../i18n/LanguageContext.jsx'
import ProjectCameraPanel from '../components/ProjectCameraPanel.jsx'
import ProjectCameraViewer from '../components/ProjectCameraViewer.jsx'

const inputClass = 'h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold outline-none focus:border-brand-500'
const cardClass = 'rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_14px_40px_-30px_rgba(15,23,42,0.35)]'

export default function EngineerLiveCamera() {
  const { t, td } = useLanguage()
  const navigate = useNavigate()
  // The project the user was already inside when they pressed Live Camera.
  // Present when they came from a project's own page; absent when they came
  // from the dashboard hero, which is the one case where a project still has to
  // be chosen here.
  const [searchParams] = useSearchParams()
  const requestedProjectId = searchParams.get('project') || ''
  const [projectList, setProjectList] = useState([])
  const [projectsStatus, setProjectsStatus] = useState('loading')
  const [projectId, setProjectId] = useState(requestedProjectId)
  const [devices, setDevices] = useState([])
  const [camerasStatus, setCamerasStatus] = useState('idle')
  const [reloadKey, setReloadKey] = useState(0)
  // Live / Recorded. The switch stays in this page's header row; everything the
  // two modes actually do now lives in ProjectCameraViewer.
  const [mode, setMode] = useState('live')

  useEffect(() => {
    let cancelled = false
    fetchEngineerProjects()
      .then((rows) => {
        if (cancelled) return
        const list = Array.isArray(rows) ? rows : []
        setProjectList(list)
        // A project named in the address wins; only fall back to the first
        // when the user arrived without one.
        setProjectId((current) => current || (list[0] ? String(list[0].id) : ''))
        setProjectsStatus('ready')
      })
      .catch(() => {
        if (cancelled) return
        setProjectList([])
        setProjectsStatus('error')
      })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    // A project change closes any open view first; its session is ended by the player.
    setDevices([])
    if (!projectId) {
      setCamerasStatus('idle')
      return undefined
    }
    let cancelled = false
    setCamerasStatus('loading')
    // The same question the House Owner's and the Builder's panels ask, answered
    // by the same endpoint: has THIS user verified THIS project's recorder? It
    // is asked outright rather than inferred from an error on the devices call,
    // so every role reaches the setup screen the same way.
    fetchProjectCameraSetup(projectId)
      .then((setupStatus) => {
        if (cancelled) return null
        if (!setupStatus?.access_granted) {
          setCamerasStatus('setup')
          return null
        }
        return fetchProjectCameraDevices(projectId).then((rows) => {
          if (cancelled) return null
          setDevices(Array.isArray(rows) ? rows : [])
          setCamerasStatus('ready')
          return null
        })
      })
      .catch((error) => {
        if (cancelled) return
        const status = error?.response?.status
        const code = error?.response?.data?.detail?.code
        // Kept as a safety net: a 409 from any CCTV call still means "verify first".
        if (code === 'CCTV_SETUP_REQUIRED') setCamerasStatus('setup')
        else setCamerasStatus(status === 403 || status === 404 ? 'unavailable' : 'error')
      })
    return () => { cancelled = true }
  }, [projectId, reloadKey])

  // The title is what the Builder or Owner typed, so it is translated for
  // display here; `td` is a dependency because its identity changes when the
  // translation for that title arrives, which is what repaints the header.
  const projectTitle = useMemo(() => {
    const match = projectList.find((project) => String(project.id) === String(projectId))
    return td(match?.title || '')
  }, [projectList, projectId, td])

  const cameras = useMemo(() => devices.flatMap((device) => (device.channels || [])
    .filter((channel) => channel.is_enabled)
    .map((channel) => ({
      channel,
      available: device.is_active && device.status === 'ONLINE',
    }))), [devices])

  const switchMode = (next) => {
    if (next === mode) return
    setMode(next)
  }

  // Live / Recorded as two buttons with icons, filled green when chosen.
  const modeButton = (value, label, Icon) => (
    <button
      type="button"
      aria-pressed={mode === value}
      onClick={() => switchMode(value)}
      className={`inline-flex h-11 items-center gap-2 rounded-xl border px-6 text-sm font-bold transition ${
        mode === value ? 'border-oc-green bg-oc-green text-white shadow-sm' : 'border-slate-200 bg-white text-slate-500 hover:text-slate-900'
      }`}
    >
      <Icon className="h-4 w-4" /> {label}
    </button>
  )

  return (
    <div className="min-h-screen bg-slate-100 px-4 py-6 sm:px-6">
      <div className="mx-auto max-w-6xl space-y-4">
        <section className="relative overflow-hidden rounded-2xl bg-[linear-gradient(135deg,#0b5233,#083e2b)] shadow-[0_18px_50px_-38px_rgba(2,6,23,0.9)]">
          <div className="pointer-events-none absolute -right-20 -top-24 h-72 w-72 rounded-full bg-emerald-300/10 blur-3xl" aria-hidden="true" />
          <div className="relative flex flex-wrap items-center gap-4 px-4 py-4 sm:px-6 sm:py-5">
            <button
              type="button"
              onClick={() => navigate('/engineer')}
              className="inline-flex h-11 shrink-0 items-center gap-2 rounded-xl border border-white/15 bg-white/10 px-4 text-sm font-bold text-white transition hover:bg-white/15"
            >
              <ArrowLeft className="h-4 w-4" /> {t('dash.engineer.liveCamera.back')}
            </button>
            <span aria-hidden="true" className="hidden h-10 w-px bg-white/20 sm:block" />
            <Video className="hidden h-7 w-7 shrink-0 text-white sm:block" />
            <div className="min-w-0">
              <h1 className="truncate font-display text-xl font-extrabold leading-tight tracking-tight text-white sm:text-2xl">
                {t('dash.engineer.liveCamera.title')}
              </h1>
              <p className="mt-1 text-xs leading-5 text-white/75 sm:text-sm">
                {/* Arriving from a project, the selector is gone, so the header
                    is what says which site is on screen. */}
                {requestedProjectId && projectTitle ? projectTitle : t('dash.engineer.liveCamera.subtitle')}
              </p>
            </div>
            <span className="ml-auto inline-flex h-11 shrink-0 items-center gap-2 rounded-xl border border-white/15 bg-white/10 px-4 text-sm font-bold text-white">
              <Video className="h-4 w-4 text-emerald-300" />
              {t('dash.engineer.liveCamera.count', { count: cameras.length })}
            </span>
          </div>
        </section>

        {/* The picker row. Hidden entirely while first-time setup is due -- there
            is nothing to pick between yet -- and the project selector is hidden
            whenever the user arrived from a project's own page, because they
            have already chosen it and must not be asked twice. */}
        {camerasStatus !== 'setup' && (
        <section className={cardClass}>
          <div className="flex flex-wrap items-end gap-x-6 gap-y-4">
            {!requestedProjectId && (
            <label className="grid min-w-[min(100%,16rem)] flex-1 grid-cols-1 gap-2 text-sm font-bold text-oc-green md:border-e md:border-slate-200 md:pe-6">
              <span className="flex items-center gap-2"><Building2 className="h-4 w-4" /> {t('dash.engineer.liveCamera.project')}</span>
              <select
                className={`${inputClass} h-11 w-full min-w-0 rounded-xl text-[15px] text-oc-ink`}
                value={projectId}
                onChange={(event) => setProjectId(event.target.value)}
                disabled={projectsStatus !== 'ready' || projectList.length === 0}
              >
                {projectList.length === 0 && <option value="">{t('dash.engineer.liveCamera.selectProject')}</option>}
                {projectList.map((project) => (
                  <option key={project.id} value={project.id}>{td(project.title)}</option>
                ))}
              </select>
              {projectsStatus === 'loading' && <span className="text-[11px] font-medium text-slate-400">{t('dash.engineer.liveCamera.loadingProjects')}</span>}
              {projectsStatus === 'error' && <span className="text-[11px] font-semibold text-rose-600">{t('dash.engineer.liveCamera.projectsError')}</span>}
            </label>
            )}
            <div className="grid gap-2 text-sm font-bold text-oc-green">
              <span className="flex items-center gap-2"><Settings className="h-4 w-4" /> {t('dash.engineer.recorded.mode')}</span>
              <div role="group" aria-label={t('dash.engineer.recorded.mode')} className="flex flex-wrap items-center gap-3">
                {modeButton('live', t('dash.engineer.recorded.live'), Radio)}
                {modeButton('recorded', t('dash.engineer.recorded.recorded'), Clock)}
              </div>
            </div>
          </div>
        </section>
        )}

        {/* Verification comes before either mode. Until this engineer has
            verified the project's recorder there is nothing to play and nothing
            to search, so the setup panel replaces both rather than sitting
            inside the live list. */}
        {camerasStatus === 'setup' ? (
          <section className={cardClass}>
            <ProjectCameraPanel
              projectId={projectId}
              projectTitle={projectTitle}
              onAccessGranted={() => setReloadKey((value) => value + 1)}
            />
          </section>
        ) : null}

        {camerasStatus !== 'setup' && (
          <ProjectCameraViewer
            devices={devices}
            projectTitle={projectTitle}
            status={
              projectsStatus === 'ready' && projectList.length === 0 ? 'noProjects'
              : (camerasStatus === 'loading' || projectsStatus === 'loading') ? 'loading'
              : camerasStatus === 'unavailable' ? 'unavailable'
              : camerasStatus === 'error' ? 'error'
              : 'ready'
            }
            onReload={() => setReloadKey((value) => value + 1)}
            // The engineer's own switch stays in the header row above, so the
            // mode is controlled from here and this page's layout is unchanged.
            mode={mode}
            onModeChange={switchMode}
          />
        )}

      </div>
    </div>
  )
}
