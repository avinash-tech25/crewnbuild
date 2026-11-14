import { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import {
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  Clock,
  BriefcaseBusiness,
  FileText,
  Home,
  LayoutGrid,
  List,
  Copy,
  HardHat,
  Mail,
  MapPin,
  MessageCircle,
  Phone,
  Search,
  Send,
  Star,
  Trash2,
  Truck,
  UserRound,
  Users,
  X,
} from 'lucide-react'
import { SmartImage } from '../../../shared/ui/ui.jsx'
import { EntityAvatar } from '../../../shared/ui/EntityPill.jsx'
import { userAvatarSrc } from '../../../shared/ui/avatars.js'
import { useLanguage } from '../../../i18n/LanguageContext.jsx'
import { optionLabel, SUPPLIER_CATEGORY_KEYS } from '../../../i18n/optionKeys.js'
import { ENGINEER_CATEGORY_LABEL_KEYS, isStoreManagerCategory } from '../../onboarding/profileConstants.js'
import { formatDate } from '../../../shared/utils/formatters.js'
import { projectStatusText } from '../builderHelpers.js'

function CopyButton({ text, label }) {
  const { t } = useLanguage()
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    } catch {
      setCopied(false)
    }
  }
  return (
    <button
      type="button"
      onClick={copy}
      className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-extrabold text-slate-700 transition hover:border-brand-300 hover:bg-brand-50 hover:text-brand-800"
    >
      {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
      {copied ? t('ce.copied') : label}
    </button>
  )
}

// Experience bands for the filter, in years.
const EXPERIENCE_BANDS = [
  { id: '0-2', from: 0, to: 2 },
  { id: '3-5', from: 3, to: 5 },
  { id: '6-10', from: 6, to: 10 },
  { id: '10+', from: 11, to: Infinity },
]

// One filter dropdown. Module level, so a change never rebuilds it.
// On a phone each filter keeps a usable width and the (wrapping) row puts them
// two to a line; they were squeezed to ~27px each on one line and overlapped.
function FilterSelect({ value, onChange, label, children }) {
  return (
    <label className="relative min-w-[min(100%,8.5rem)] flex-1 sm:min-w-0 sm:flex-none">
      <span className="sr-only">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-label={label}
        className="h-9 w-full min-w-0 appearance-none rounded-lg border border-slate-200 bg-white pl-3 pr-8 text-xs font-bold text-slate-700 outline-none transition focus:border-brand-400 sm:w-auto"
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
    </label>
  )
}

/**
 * The builder's own site engineers: search, filters, and a grid of cards or a
 * list. Busy means the engineer holds at least one project here; Active means
 * none -- the only two states the data carries. Every action is the one the
 * old cards used: open the profile, Assign Project, Unassign.
 */
function MyTeamEngineers({ engineers, onViewEngineer, onAssignProject, onUnassignProject, search: sharedSearch, onSearchChange, onInvite = null }) {
  const { t, td } = useLanguage()
  const [localSearch, setLocalSearch] = useState('')
  // The header search box drives this list when the dashboard passes it in.
  const search = sharedSearch ?? localSearch
  const setSearch = onSearchChange ?? setLocalSearch
  const [location, setLocation] = useState('')
  const [experience, setExperience] = useState('')
  const [projects, setProjects] = useState('')
  const [status, setStatus] = useState('')
  const [view, setViewState] = useState(() => {
    try { return localStorage.getItem('crewnbuild_builder_engineers_view') === 'list' ? 'list' : 'grid' } catch { return 'grid' }
  })
  const setView = (next) => {
    setViewState(next)
    try { localStorage.setItem('crewnbuild_builder_engineers_view', next) } catch { /* storage unavailable */ }
  }

  const pincodes = useMemo(() => [...new Set(engineers.map((engineer) => engineer.pincode).filter(Boolean))].sort(), [engineers])
  // Busy is the server's one rule (`working_on_project`): an ACTIVE assignment on
  // a project that is still running -- the same rule the House Owner screens and
  // the assignment check use. The older count-based test stays only as a
  // fallback for a payload without the flag.
  const isBusy = (engineer) => (typeof engineer.working_on_project === 'boolean'
    ? engineer.working_on_project
    : Number(engineer.project_count || 0) > 0 || (engineer.assigned_projects || []).length > 0)
  // Working on a running project that is not one of this builder's: there is
  // nothing for this builder to assign or unassign until that project lets go.
  const isWorkingElsewhere = (engineer) => Boolean(engineer.working_on_other_project)

  const shown = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return engineers.filter((engineer) => {
      if (needle && ![engineer.name, engineer.pincode, engineer.address].some((value) => String(value || '').toLowerCase().includes(needle))) return false
      if (location && engineer.pincode !== location) return false
      if (experience) {
        const band = EXPERIENCE_BANDS.find((item) => item.id === experience)
        const years = Number(engineer.experience_years || 0)
        if (band && (years < band.from || years > band.to)) return false
      }
      if (projects === 'on' && !isBusy(engineer)) return false
      if (projects === 'off' && isBusy(engineer)) return false
      if (status === 'busy' && !isBusy(engineer)) return false
      if (status === 'active' && isBusy(engineer)) return false
      return true
    })
  }, [engineers, search, location, experience, projects, status])


  const statusPill = (engineer) => (isBusy(engineer)
    ? <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-bold text-amber-700"><span className="h-1.5 w-1.5 rounded-full bg-amber-500" />{t('ce.busy')}</span>
    : <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-700"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />{t('ce.active')}</span>)

  // A Store Manager runs the store for all of this builder's projects and is
  // never a project's Site Engineer (the server refuses that assignment), so
  // the card names their category instead of offering Assign Project.
  const actionButton = (engineer, wide = true) => (isStoreManagerCategory(engineer.specialization) ? (
    <span className={`inline-flex h-8 items-center justify-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-3 text-center text-[11px] font-extrabold text-slate-600 ${wide ? 'w-full' : ''}`}>
      {optionLabel(t, ENGINEER_CATEGORY_LABEL_KEYS, engineer.specialization)}
    </span>
  ) : isWorkingElsewhere(engineer) ? (
    <span
      role="note"
      onClick={(event) => event.stopPropagation()}
      className={`inline-flex h-8 cursor-not-allowed items-center justify-center gap-1 rounded-lg border border-amber-200 bg-amber-50 px-3 text-center text-[11px] font-extrabold text-amber-700 ${wide ? 'w-full' : ''}`}
    >
      {t('ce.workingOnAnotherProject')}
    </span>
  ) : (engineer.assigned_projects || []).length > 0 ? (
    <button
      type="button"
      onClick={(event) => { event.stopPropagation(); onUnassignProject(engineer) }}
      className={`inline-flex h-8 items-center justify-center gap-1 rounded-lg border border-rose-200 bg-rose-50 px-3 text-xs font-extrabold text-rose-600 transition hover:bg-rose-100 ${wide ? 'w-full' : ''}`}
    >
      <X className="h-3.5 w-3.5" /> {t('ce.unassign')}
    </button>
  ) : (
    <button
      type="button"
      onClick={(event) => { event.stopPropagation(); onAssignProject(engineer) }}
      className={`inline-flex h-8 items-center justify-center gap-1 rounded-lg bg-brand-800 px-3 text-xs font-extrabold text-white transition hover:bg-brand-900 ${wide ? 'w-full' : ''}`}
    >
      <HardHat className="h-3.5 w-3.5" /> {t('ce.assignProject')}
    </button>
  ))

  return (
    <div className="space-y-3">
      {/* Search, filters and the grid / list switch */}
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
        <label className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3">
          <Search className="h-4 w-4 shrink-0 text-slate-400" />
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t('ce.filter.searchPh')}
            aria-label={t('ce.filter.searchPh')}
            className="min-w-0 flex-1 bg-transparent text-xs text-slate-800 outline-none placeholder:text-slate-400"
          />
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <FilterSelect value={location} onChange={setLocation} label={t('ce.filter.allLocations')}>
            <option value="">{t('ce.filter.allLocations')}</option>
            {pincodes.map((pincode) => <option key={pincode} value={pincode}>{pincode}</option>)}
          </FilterSelect>
          <FilterSelect value={experience} onChange={setExperience} label={t('ce.filter.experience')}>
            <option value="">{t('ce.filter.experience')}</option>
            {EXPERIENCE_BANDS.map((band) => (
              <option key={band.id} value={band.id}>
                {band.to === Infinity ? t('ce.filter.yearsPlus', { from: band.from - 1 }) : t('ce.filter.yearsRange', { from: band.from, to: band.to })}
              </option>
            ))}
          </FilterSelect>
          <FilterSelect value={projects} onChange={setProjects} label={t('ce.filter.projects')}>
            <option value="">{t('ce.filter.projects')}</option>
            <option value="on">{t('ce.filter.onProject')}</option>
            <option value="off">{t('ce.filter.notOnProject')}</option>
          </FilterSelect>
          <FilterSelect value={status} onChange={setStatus} label={t('ce.filter.status')}>
            <option value="">{t('ce.filter.status')}</option>
            <option value="active">{t('ce.active')}</option>
            <option value="busy">{t('ce.busy')}</option>
          </FilterSelect>
          <div className="flex h-9 items-center rounded-lg border border-slate-200 bg-white p-0.5" role="group" aria-label={`${t('ce.view.grid')} / ${t('ce.view.list')}`}>
            {[{ id: 'grid', icon: LayoutGrid, label: t('ce.view.grid') }, { id: 'list', icon: List, label: t('ce.view.list') }].map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => setView(option.id)}
                aria-pressed={view === option.id}
                title={option.label}
                className={`inline-flex h-7 items-center gap-1 rounded-md px-2.5 text-xs font-extrabold transition ${view === option.id ? 'bg-brand-800 text-white' : 'text-slate-500 hover:text-slate-800'}`}
              >
                <option.icon className="h-3.5 w-3.5" /> <span className="hidden sm:inline">{option.label}</span>
              </button>
            ))}
          </div>
          {/* Invite sits after the grid / list switch. */}
          {onInvite && (
            <button
              type="button"
              onClick={() => onInvite({})}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-brand-600 px-4 text-xs font-extrabold text-white transition hover:bg-brand-700"
            >
              <UserRound className="h-3.5 w-3.5" /> {t('ce.inviteEngineer')}
            </button>
          )}
        </div>
      </div>

      {engineers.length === 0 ? (
        <p className="rounded-xl border border-dashed border-oc-line bg-oc-sunken p-6 text-center text-sm font-semibold text-oc-faint">{t('ce.noActiveEngineers')}</p>
      ) : shown.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-200 bg-white p-6 text-center text-sm font-semibold text-slate-500">{t('ce.filter.noMatch')}</p>
      ) : view === 'list' ? (
        <div className="dash-scroll overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full min-w-[720px] text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/90 text-[9px] font-extrabold uppercase tracking-wide text-slate-400">
                <th className="px-3 py-1.5">{t('role.engineer')}</th>
                <th className="px-3 py-1.5">{t('ce.col.location')}</th>
                <th className="px-3 py-1.5">{t('ce.filter.experience')}</th>
                <th className="px-3 py-1.5">{t('ce.filter.projects')}</th>
                <th className="px-3 py-1.5">{t('ce.filter.status')}</th>
                <th className="px-3 py-1.5 text-right">{t('dash.common.action')}</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((engineer) => (
                <tr key={engineer.user_id} onClick={() => onViewEngineer(engineer)} className="cursor-pointer border-b border-slate-100 last:border-b-0 hover:bg-slate-50/70">
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <EntityAvatar user={engineer} role="ENGINEER" alt={engineer.name} className="!h-7 !w-7" />
                      <span className="font-bold text-slate-900">{td(engineer.name)}</span>
                    </div>
                  </td>
                  <td className="px-3 py-2 text-slate-600"><span className="font-bold text-slate-800">{engineer.pincode || '—'}</span>{engineer.address ? <span className="block max-w-[200px] truncate text-[11px]" title={td(engineer.address)}>{td(engineer.address)}</span> : null}</td>
                  <td className="px-3 py-2 text-slate-700">{t('ce.yearsCount', { years: engineer.experience_years || 0 })}</td>
                  <td className="px-3 py-2 text-slate-700">{engineer.project_count || 0}</td>
                  <td className="px-3 py-2">{statusPill(engineer)}</td>
                  <td className="px-3 py-2 text-right">{actionButton(engineer, false)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2 lg:grid-cols-3">
          {shown.map((engineer) => {
            const busy = isBusy(engineer)
            const elsewhere = isWorkingElsewhere(engineer)
            const assigned = engineer.assigned_projects || []
            return (
              <article
                key={engineer.user_id}
                role="button"
                tabIndex={0}
                onClick={() => onViewEngineer(engineer)}
                onKeyDown={(event) => { if (event.key === 'Enter' && event.target === event.currentTarget) onViewEngineer(engineer) }}
                className="relative flex cursor-pointer flex-col overflow-hidden rounded-xl border border-slate-200 bg-white p-3 pl-4 shadow-[0_14px_40px_-32px_rgba(15,23,42,0.45)] transition hover:-translate-y-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
              >
                {/* Status colour down the left edge: green Active, amber Busy. */}
                <span className={`absolute inset-y-0 left-0 w-1 ${busy ? 'bg-amber-400' : 'bg-emerald-500'}`} aria-hidden="true" />
                <div className="flex items-start gap-2.5">
                  <EntityAvatar user={engineer} role="ENGINEER" alt={engineer.name} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-extrabold text-slate-900">{td(engineer.name)}</p>
                    <p className="truncate text-[11px] text-slate-500">{isStoreManagerCategory(engineer.specialization) ? optionLabel(t, ENGINEER_CATEGORY_LABEL_KEYS, engineer.specialization) : t('role.engineer')}</p>
                  </div>
                  {statusPill(engineer)}
                </div>
                {/* An engineer working on someone else's project is shown, but
                    their details are dimmed and the action is replaced by the
                    reason it is not available. */}
                <div className={`mt-2.5 grid grid-cols-3 gap-2 text-[11px] ${elsewhere ? 'pointer-events-none opacity-50 blur-[0.5px]' : ''}`}>
                  <div className="flex min-w-0 items-start gap-1.5">
                    <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-500" />
                    <div className="min-w-0"><p className="truncate font-extrabold text-slate-900">{engineer.pincode || '—'}</p><p className="truncate text-slate-500" title={td(engineer.address || '')}>{td(String(engineer.address || '').split(',').map((part) => part.trim()).filter(Boolean).pop() || '') || '—'}</p></div>
                  </div>
                  <div className="flex min-w-0 items-start gap-1.5">
                    <CalendarDays className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-500" />
                    <div className="min-w-0"><p className="truncate font-extrabold text-slate-900">{t('ce.yearsCount', { years: engineer.experience_years || 0 })}</p><p className="truncate text-slate-500">{t('ce.filter.experience')}</p></div>
                  </div>
                  <div className="flex min-w-0 items-start gap-1.5">
                    <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-500" />
                    <div className="min-w-0"><p className="truncate font-extrabold text-slate-900">{engineer.project_count || 0}</p><p className="truncate text-slate-500">{t('ce.filter.projects')}</p></div>
                  </div>
                </div>
                {/* The project(s) this engineer holds, from the same assigned_projects data. */}
                {assigned.length > 0 && !elsewhere && (
                  <p className="mt-1.5 truncate text-[11px] text-slate-500" title={assigned.map((project) => td(project.title)).join(', ')}>{assigned.map((project) => td(project.title)).join(', ')}</p>
                )}
                <div className="mt-auto pt-2.5">{actionButton(engineer)}</div>
              </article>
            )
          })}
        </div>
      )}
    </div>
  )
}

/**
 * Find Site Engineers: the nearby engineers for a pincode, narrowed by
 * location, experience and skill (their engineer category). The pincode box
 * and Find run the same search as before; Send Request is the same request.
 */
function FindEngineers({ engineers, pincode, onPincodeChange, onFind, onViewEngineer, onSendRequest, onRespond, sentEngineerIds, sendingEngineerId, search = '', onSearchChange }) {
  const { t, td } = useLanguage()
  // One box for both: digits look up engineers near that pincode, as before;
  // anything else narrows the loaded results by name, skill or address.
  const boxValue = search || pincode || ''
  const changeBox = (value) => {
    if (/^\d*$/.test(value)) {
      onSearchChange?.('')
      onPincodeChange?.(value.slice(0, 6))
    } else {
      onSearchChange?.(value)
    }
  }
  const clearBox = () => {
    onSearchChange?.('')
    onPincodeChange?.('')
  }
  const [location, setLocation] = useState('')
  const [experience, setExperience] = useState('')
  const [skill, setSkill] = useState('')
  const list = engineers || []
  const pincodes = useMemo(() => [...new Set(list.map((engineer) => engineer.pincode).filter(Boolean))].sort(), [list])
  const skills = useMemo(() => [...new Set(list.map((engineer) => engineer.specialization).filter(Boolean))].sort(), [list])
  const needle = search.trim().toLowerCase()
  const shown = useMemo(() => list.filter((engineer) => {
    if (needle && ![engineer.name, engineer.pincode, engineer.address, engineer.specialization].some((value) => String(value || '').toLowerCase().includes(needle))) return false
    // A pincode still being typed narrows what is loaded; six digits fetch afresh.
    if (pincode && !String(engineer.pincode || '').startsWith(pincode)) return false
    if (location && engineer.pincode !== location) return false
    if (experience) {
      const band = EXPERIENCE_BANDS.find((item) => item.id === experience)
      const years = Number(engineer.experience_years || 0)
      if (band && (years < band.from || years > band.to)) return false
    }
    if (skill && engineer.specialization !== skill) return false
    return true
  }), [list, needle, pincode, location, experience, skill])
  const skillLabel = (value) => optionLabel(t, ENGINEER_CATEGORY_LABEL_KEYS, value)
  const cityOf = (address) => String(address || '').split(',').map((part) => part.trim()).filter(Boolean).pop() || ''

  return (
    <div className="space-y-3">
      {/* Pincode search, filters and Find */}
      <div className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-white p-2 lg:flex-row lg:items-center">
        <label className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3">
          <Search className="h-4 w-4 shrink-0 text-slate-400" />
          <input
            value={boxValue}
            onChange={(event) => changeBox(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter' && !search) onFind?.() }}
            placeholder={t('ce.findSearchPh')}
            aria-label={t('ce.findSearchPh')}
            className="min-w-0 flex-1 bg-transparent text-xs font-bold text-slate-800 outline-none placeholder:font-semibold placeholder:text-slate-400"
          />
          {boxValue && (
            <button type="button" onClick={clearBox} aria-label={t('dash.common.close')} className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-slate-200 text-slate-600 hover:bg-slate-300">
              <X className="h-3 w-3" />
            </button>
          )}
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <FilterSelect value={location} onChange={setLocation} label={t('ce.filter.allLocations')}>
            <option value="">{t('ce.filter.allLocations')}</option>
            {pincodes.map((value) => <option key={value} value={value}>{value}</option>)}
          </FilterSelect>
          <FilterSelect value={experience} onChange={setExperience} label={t('ce.filter.allExperience')}>
            <option value="">{t('ce.filter.allExperience')}</option>
            {EXPERIENCE_BANDS.map((band) => (
              <option key={band.id} value={band.id}>
                {band.to === Infinity ? t('ce.filter.yearsPlus', { from: band.from - 1 }) : t('ce.filter.yearsRange', { from: band.from, to: band.to })}
              </option>
            ))}
          </FilterSelect>
          <FilterSelect value={skill} onChange={setSkill} label={t('ce.filter.allSkills')}>
            <option value="">{t('ce.filter.allSkills')}</option>
            {skills.map((value) => <option key={value} value={value}>{skillLabel(value)}</option>)}
          </FilterSelect>
          <button
            type="button"
            onClick={() => onFind?.()}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-brand-800 px-4 text-xs font-extrabold text-white transition hover:bg-brand-900"
          >
            <Search className="h-3.5 w-3.5" /> {t('ce.find')}
          </button>
        </div>
      </div>

      {list.length === 0 ? (
        <section className="rounded-xl border border-dashed border-brand-200 bg-white p-8 text-center shadow-[0_14px_40px_-30px_rgba(15,23,42,0.35)]">
          <HardHat className="mx-auto mb-2.5 h-8 w-8 text-brand-400" />
          <h2 className="font-display text-base font-extrabold text-slate-950">{t('ce.noEngineersFound')}</h2>
          <p className="mx-auto mt-1 max-w-md text-[13px] font-medium text-slate-500">{t('ui.contractor.engineersInPincodeHint')}</p>
        </section>
      ) : shown.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-200 bg-white p-6 text-center text-sm font-semibold text-slate-500">{t('ce.filter.noMatch')}</p>
      ) : (
        <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2 lg:grid-cols-3">
          {shown.map((engineer) => {
            // request_status comes from the engineer's pending membership row:
            // INCOMING (the engineer asked to join) or SENT (this builder asked).
            const incoming = engineer.request_status === 'INCOMING' && engineer.relationship_id
            const requestSent = engineer.request_status === 'SENT' || sentEngineerIds?.has(engineer.user_id)
            const isSending = sendingEngineerId === engineer.user_id
            const projects = Number(engineer.project_count || 0)
            return (
              <article
                key={engineer.user_id}
                role="button"
                tabIndex={0}
                onClick={() => onViewEngineer(engineer)}
                onKeyDown={(event) => { if (event.key === 'Enter' && event.target === event.currentTarget) onViewEngineer(engineer) }}
                className="flex cursor-pointer flex-col rounded-xl border border-slate-200 bg-white p-3 shadow-[0_14px_40px_-32px_rgba(15,23,42,0.45)] transition hover:-translate-y-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
              >
                <div className="flex items-start gap-2.5">
                  <EntityAvatar user={engineer} role="ENGINEER" alt={engineer.name} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-extrabold text-slate-900">{td(engineer.name)}</p>
                    <p className="truncate text-[11px] text-slate-500">{engineer.specialization ? skillLabel(engineer.specialization) : t('role.engineer')}</p>
                  </div>
                  {incoming
                    ? <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-sky-50 px-2 py-0.5 text-[11px] font-bold text-sky-700"><span className="h-1.5 w-1.5 rounded-full bg-sky-500" />{t('ui.status.pending')}</span>
                    : <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-700"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />{t('ce.available')}</span>}
                </div>
                <div className="mt-2.5 grid grid-cols-3 gap-2 border-b border-slate-100 pb-2.5 text-[11px]">
                  <div className="flex min-w-0 items-start gap-1.5">
                    <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-500" />
                    <div className="min-w-0"><p className="truncate font-extrabold text-slate-900">{engineer.pincode || '—'}</p><p className="truncate text-slate-500" title={td(engineer.address || '')}>{td(cityOf(engineer.address)) || '—'}</p></div>
                  </div>
                  <div className="flex min-w-0 items-start gap-1.5">
                    <CalendarDays className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-500" />
                    <div className="min-w-0"><p className="truncate font-extrabold text-slate-900">{t('ce.yearsCount', { years: engineer.experience_years || 0 })}</p><p className="truncate text-slate-500">{t('ce.filter.experience')}</p></div>
                  </div>
                  <div className="flex min-w-0 items-start gap-1.5">
                    <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-500" />
                    <div className="min-w-0"><p className="truncate font-extrabold text-slate-900">{projects}</p><p className="truncate text-slate-500">{t('ce.filter.projects')}</p></div>
                  </div>
                </div>
                <div className="mt-auto pt-2.5">
                  {incoming ? (
                    // The same Accept / Reject as Pending Requests, on the same membership row.
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={(event) => { event.stopPropagation(); onRespond?.(engineer.relationship_id, 'REJECT') }}
                        className="inline-flex h-8 items-center justify-center gap-1 rounded-lg border border-rose-200 bg-rose-50 text-xs font-extrabold text-rose-600 transition hover:bg-rose-100"
                      >
                        <X className="h-3.5 w-3.5" /> {t('ce.reject')}
                      </button>
                      <button
                        type="button"
                        onClick={(event) => { event.stopPropagation(); onRespond?.(engineer.relationship_id, 'ACCEPT') }}
                        className="inline-flex h-8 items-center justify-center gap-1 rounded-lg bg-brand-800 text-xs font-extrabold text-white transition hover:bg-brand-900"
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" /> {t('ce.accept')}
                      </button>
                    </div>
                  ) : requestSent ? (
                    <div className="inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-lg bg-brand-50 text-xs font-bold text-brand-700 ring-1 ring-brand-100">
                      <Check className="h-3.5 w-3.5" /> {t('ce.requestSent')}
                    </div>
                  ) : (
                    <button
                      type="button"
                      disabled={isSending}
                      onClick={(event) => { event.stopPropagation(); onSendRequest?.(engineer) }}
                      className="inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-lg bg-brand-800 text-xs font-extrabold text-white transition hover:bg-brand-900 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <Send className="h-3.5 w-3.5" /> {isSending ? t('ce.sending') : t('ce.sendRequest')}
                    </button>
                  )}
                </div>
              </article>
            )
          })}
        </div>
      )}
    </div>
  )
}

// The stripe down a supplier card's left edge, by the supplier's own type.
const SUPPLIER_STRIPES = {
  'Material Supplier': 'bg-emerald-500',
  'Labor Supplier': 'bg-amber-400',
  'Equipment Supplier': 'bg-sky-500',
}

/**
 * My Suppliers: the builder's accepted suppliers, searchable and filterable,
 * as cards or a list. Assign Project and Unassign are the same actions the old
 * cards used; a click on the card opens the supplier's profile.
 */
function MySuppliers({ suppliers, onOpenSupplierProfile, onAssignSupplier, onUnassignSupplier, search: sharedSearch, onSearchChange }) {
  const { t, td } = useLanguage()
  const [localSearch, setLocalSearch] = useState('')
  const search = sharedSearch ?? localSearch
  const setSearch = onSearchChange ?? setLocalSearch
  const [location, setLocation] = useState('')
  const [service, setService] = useState('')
  const [ratingOrder, setRatingOrder] = useState('')
  const [view, setViewState] = useState(() => {
    try { return localStorage.getItem('crewnbuild_builder_suppliers_view') === 'list' ? 'list' : 'grid' } catch { return 'grid' }
  })
  const setView = (next) => {
    setViewState(next)
    try { localStorage.setItem('crewnbuild_builder_suppliers_view', next) } catch { /* storage unavailable */ }
  }
  const list = suppliers || []
  const pincodes = useMemo(() => [...new Set(list.map((supplier) => supplier.pincode).filter(Boolean))].sort(), [list])
  const services = useMemo(() => [...new Set(list.flatMap((supplier) => supplier.categories || []).filter(Boolean))].sort(), [list])
  const serviceLabel = (value) => optionLabel(t, SUPPLIER_CATEGORY_KEYS, value)
  const cityOf = (address) => String(address || '').split(',').map((part) => part.trim()).filter(Boolean).pop() || ''
  const nameOf = (supplier) => td(supplier.store_name || supplier.name) || t('role.supplier')

  const shown = useMemo(() => {
    const needle = search.trim().toLowerCase()
    let result = list.filter((supplier) => {
      if (needle && ![supplier.store_name, supplier.name, supplier.pincode, supplier.address, ...(supplier.categories || []).map(serviceLabel)]
        .some((value) => String(value || '').toLowerCase().includes(needle))) return false
      if (location && supplier.pincode !== location) return false
      if (service && !(supplier.categories || []).includes(service)) return false
      return true
    })
    if (ratingOrder) {
      result = [...result].sort((a, b) => (ratingOrder === 'high' ? 1 : -1) * (Number(b.rating || 0) - Number(a.rating || 0)))
    }
    return result
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list, search, location, service, ratingOrder])

  const buttons = (supplier, compact = false) => {
    const assignments = supplier.assigned_projects || []
    return (
      <div className={`flex items-center gap-2 ${compact ? 'justify-end' : ''}`}>
        {assignments.length > 0 && (
          <button
            type="button"
            onClick={(event) => { event.stopPropagation(); onUnassignSupplier?.(supplier) }}
            className={`inline-flex h-8 items-center justify-center gap-1 rounded-lg border border-rose-200 bg-rose-50 px-3 text-xs font-extrabold text-rose-600 transition hover:bg-rose-100 ${compact ? '' : 'flex-1'}`}
          >
            <X className="h-3.5 w-3.5" /> {t('ce.unassign')}
          </button>
        )}
        <button
          type="button"
          onClick={(event) => { event.stopPropagation(); onAssignSupplier?.(supplier) }}
          className={`inline-flex h-8 items-center justify-center gap-1 rounded-lg bg-brand-800 px-3 text-xs font-extrabold text-white transition hover:bg-brand-900 ${compact ? '' : 'flex-[1.4]'}`}
        >
          <BriefcaseBusiness className="h-3.5 w-3.5" /> {t('ce.assignProject')}
        </button>
      </div>
    )
  }

  const acceptedPill = (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-700"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />{t('ui.status.accepted')}</span>
  )

  return (
    <div className="space-y-3">
      {/* Search, filters and the grid / list switch */}
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
        <label className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3">
          <Search className="h-4 w-4 shrink-0 text-slate-400" />
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t('ce.sup.searchPh')}
            aria-label={t('ce.sup.searchPh')}
            className="min-w-0 flex-1 bg-transparent text-xs text-slate-800 outline-none placeholder:text-slate-400"
          />
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <FilterSelect value={location} onChange={setLocation} label={t('ce.filter.allLocations')}>
            <option value="">{t('ce.filter.allLocations')}</option>
            {pincodes.map((value) => <option key={value} value={value}>{value}</option>)}
          </FilterSelect>
          <FilterSelect value={service} onChange={setService} label={t('ce.sup.allServices')}>
            <option value="">{t('ce.sup.allServices')}</option>
            {services.map((value) => <option key={value} value={value}>{serviceLabel(value)}</option>)}
          </FilterSelect>
          <FilterSelect value={ratingOrder} onChange={setRatingOrder} label={t('ce.sup.rating')}>
            <option value="">{t('ce.sup.rating')}</option>
            <option value="high">{t('ce.sup.ratingHigh')}</option>
            <option value="low">{t('ce.sup.ratingLow')}</option>
          </FilterSelect>
          <div className="flex h-9 items-center rounded-lg border border-slate-200 bg-white p-0.5" role="group" aria-label={`${t('ce.view.grid')} / ${t('ce.view.list')}`}>
            {[{ id: 'grid', icon: LayoutGrid, label: t('ce.view.grid') }, { id: 'list', icon: List, label: t('ce.view.list') }].map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => setView(option.id)}
                aria-pressed={view === option.id}
                title={option.label}
                className={`inline-flex h-7 items-center gap-1 rounded-md px-2.5 text-xs font-extrabold transition ${view === option.id ? 'bg-brand-800 text-white' : 'text-slate-500 hover:text-slate-800'}`}
              >
                <option.icon className="h-3.5 w-3.5" /> <span className="hidden sm:inline">{option.label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {list.length === 0 ? (
        <section className="rounded-xl border border-dashed border-slate-200 bg-white p-8 text-center shadow-[0_14px_40px_-30px_rgba(15,23,42,0.35)]">
          <Truck className="mx-auto mb-2.5 h-8 w-8 text-slate-300" />
          <h2 className="text-base font-extrabold text-slate-950">{t('ce.noAcceptedSuppliers')}</h2>
          <p className="mx-auto mt-1 max-w-md text-[13px] font-medium text-slate-500">{t('ce.noAcceptedSuppliersSub')}</p>
        </section>
      ) : shown.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-200 bg-white p-6 text-center text-sm font-semibold text-slate-500">{t('ce.filter.noMatch')}</p>
      ) : view === 'list' ? (
        <div className="dash-scroll overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full min-w-[760px] text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/90 text-[9px] font-extrabold uppercase tracking-wide text-slate-400">
                <th className="px-3 py-1.5">{t('role.supplier')}</th>
                <th className="px-3 py-1.5">{t('ce.col.location')}</th>
                <th className="px-3 py-1.5">{t('ce.sup.rating')}</th>
                <th className="px-3 py-1.5">{t('ce.filter.projects')}</th>
                <th className="px-3 py-1.5">{t('ce.filter.status')}</th>
                <th className="px-3 py-1.5 text-right">{t('dash.common.action')}</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((supplier) => (
                <tr key={supplier.id} onClick={() => onOpenSupplierProfile?.(supplier)} className="cursor-pointer border-b border-slate-100 last:border-b-0 hover:bg-slate-50/70">
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <EntityAvatar user={supplier} role="SUPPLIER" alt={nameOf(supplier)} className="!h-7 !w-7" />
                      <div className="min-w-0">
                        <p className="truncate font-bold text-slate-900">{nameOf(supplier)}</p>
                        <p className="max-w-[220px] truncate text-[11px] text-slate-500">{(supplier.categories || []).map(serviceLabel).join(', ')}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2"><span className="font-bold text-slate-800">{supplier.pincode || '—'}</span><span className="block text-[11px] text-slate-500">{td(cityOf(supplier.address))}</span></td>
                  <td className="px-3 py-2 text-slate-700">{Number(supplier.rating || 0).toFixed(1)}</td>
                  <td className="px-3 py-2 text-slate-700">{(supplier.assigned_projects || []).length}</td>
                  <td className="px-3 py-2">{acceptedPill}</td>
                  <td className="px-3 py-2">{buttons(supplier, true)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2 lg:grid-cols-3">
          {shown.map((supplier) => {
            const assignments = supplier.assigned_projects || []
            const servicesText = (supplier.categories || []).map(serviceLabel).join(', ')
            return (
              <article
                key={supplier.id}
                role="button"
                tabIndex={0}
                onClick={() => onOpenSupplierProfile?.(supplier)}
                onKeyDown={(event) => { if (event.key === 'Enter' && event.target === event.currentTarget) onOpenSupplierProfile?.(supplier) }}
                className="relative flex cursor-pointer flex-col overflow-hidden rounded-xl border border-slate-200 bg-white p-3 pl-4 shadow-[0_14px_40px_-32px_rgba(15,23,42,0.45)] transition hover:-translate-y-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
              >
                <span className={`absolute inset-y-0 left-0 w-1 ${SUPPLIER_STRIPES[supplier.supplier_category] || 'bg-slate-300'}`} aria-hidden="true" />
                <div className="flex items-start gap-2.5">
                  <EntityAvatar user={supplier} role="SUPPLIER" alt={nameOf(supplier)} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-extrabold text-slate-900">{nameOf(supplier)}</p>
                    <p className="truncate text-[11px] text-slate-500" title={servicesText}>{servicesText || t('role.supplier')}</p>
                  </div>
                  {acceptedPill}
                </div>
                <div className="mt-2.5 grid grid-cols-3 gap-2 border-b border-slate-100 pb-2.5 text-[11px]">
                  <div className="flex min-w-0 items-start gap-1.5">
                    <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-500" />
                    <div className="min-w-0"><p className="truncate font-extrabold text-slate-900">{supplier.pincode || '—'}</p><p className="truncate text-slate-500" title={td(supplier.address || '')}>{td(cityOf(supplier.address)) || '—'}</p></div>
                  </div>
                  <div className="flex min-w-0 items-start gap-1.5">
                    <Star className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-500" />
                    <div className="min-w-0"><p className="truncate font-extrabold text-slate-900">{Number(supplier.rating || 0).toFixed(1)}</p><p className="truncate text-slate-500">{t('ce.sup.rating')}</p></div>
                  </div>
                  <div className="flex min-w-0 items-start gap-1.5">
                    <BriefcaseBusiness className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-500" />
                    <div className="min-w-0"><p className="truncate font-extrabold text-slate-900">{assignments.length}</p><p className="truncate text-slate-500">{t('ce.filter.projects')}</p></div>
                  </div>
                </div>
                {/* The project(s) this supplier is assigned to, from assigned_projects. */}
                {assignments.length > 0 && (
                  <p className="mt-2 flex min-w-0 items-center gap-1.5 text-[11px] text-slate-600" title={assignments.map((project) => td(project.project_title)).join(', ')}>
                    <Home className="h-3.5 w-3.5 shrink-0 text-slate-500" />
                    <span className="truncate">{assignments.map((project) => td(project.project_title)).join(', ')}</span>
                  </p>
                )}
                <div className="mt-auto pt-2.5">{buttons(supplier)}</div>
              </article>
            )
          })}
        </div>
      )}
    </div>
  )
}

/**
 * Pending Requests in the same card style as the other tabs: engineers asking
 * to join (Accept / Reject), invitations not yet used (code, share, Revoke),
 * and requests this builder sent. Every action is the one the tab already had.
 */
function PendingPartnerRequests({ pendingRequests, invitations, outgoingRequests, shareFrom, onRespond, onViewEngineer, onRevokeInvitation, search: sharedSearch, onSearchChange }) {
  const { t, td } = useLanguage()
  const [localSearch, setLocalSearch] = useState('')
  const search = sharedSearch ?? localSearch
  const setSearch = onSearchChange ?? setLocalSearch
  const [type, setType] = useState('')
  const needle = search.trim().toLowerCase()
  const matches = (...values) => !needle || values.some((value) => String(value || '').toLowerCase().includes(needle))
  const joinShown = (type === '' || type === 'join') ? pendingRequests.filter((engineer) => matches(engineer.name, engineer.pincode, engineer.address)) : []
  const inviteShown = (type === '' || type === 'invite') ? invitations.filter((invitation) => matches(invitation.phone, invitation.email, invitation.invite_code)) : []
  const sentShown = (type === '' || type === 'sent') ? outgoingRequests.filter((engineer) => matches(engineer.name, engineer.pincode, engineer.address)) : []
  const nothingAtAll = pendingRequests.length === 0 && invitations.length === 0 && outgoingRequests.length === 0
  const cityOf = (address) => String(address || '').split(',').map((part) => part.trim()).filter(Boolean).pop() || ''

  const pill = (tone, text) => (
    <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold ${tone}`}><span className="h-1.5 w-1.5 rounded-full bg-current" />{text}</span>
  )
  const SectionTitle = ({ title, count }) => (
    <div className="flex items-center gap-2">
      <p className="text-xs font-extrabold uppercase tracking-wide text-slate-400">{title}</p>
      <span className="grid h-5 min-w-5 place-items-center rounded-full bg-slate-100 px-1.5 text-[10px] font-extrabold text-slate-600">{count}</span>
    </div>
  )
  const engineerCard = (engineer, { stripe, status, children, dateLabel }) => (
    <article
      key={engineer.relationship_id || engineer.user_id}
      role="button"
      tabIndex={0}
      onClick={() => onViewEngineer(engineer)}
      onKeyDown={(event) => { if (event.key === 'Enter' && event.target === event.currentTarget) onViewEngineer(engineer) }}
      className="relative flex cursor-pointer flex-col overflow-hidden rounded-xl border border-slate-200 bg-white p-3 pl-4 shadow-[0_14px_40px_-32px_rgba(15,23,42,0.45)] transition hover:-translate-y-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
    >
      <span className={`absolute inset-y-0 left-0 w-1 ${stripe}`} aria-hidden="true" />
      <div className="flex items-start gap-2.5">
        <EntityAvatar user={engineer} role="ENGINEER" alt={engineer.name} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-extrabold text-slate-900">{td(engineer.name)}</p>
          <p className="truncate text-[11px] text-slate-500">{t('role.engineer')}</p>
        </div>
        {status}
      </div>
      <div className={`mt-2.5 grid grid-cols-3 gap-2 text-[11px] ${children ? 'border-b border-slate-100 pb-2.5' : ''}`}>
        <div className="flex min-w-0 items-start gap-1.5">
          <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-500" />
          <div className="min-w-0"><p className="truncate font-extrabold text-slate-900">{engineer.pincode || '—'}</p><p className="truncate text-slate-500" title={td(engineer.address || '')}>{td(cityOf(engineer.address)) || '—'}</p></div>
        </div>
        <div className="flex min-w-0 items-start gap-1.5">
          <CalendarDays className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-500" />
          <div className="min-w-0"><p className="truncate font-extrabold text-slate-900">{t('ce.yearsCount', { years: engineer.experience_years || 0 })}</p><p className="truncate text-slate-500">{t('ce.filter.experience')}</p></div>
        </div>
        <div className="flex min-w-0 items-start gap-1.5">
          <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-500" />
          <div className="min-w-0"><p className="truncate font-extrabold text-slate-900">{formatDate(engineer.created_at, '—')}</p><p className="truncate text-slate-500">{dateLabel || t('ce.pend.received')}</p></div>
        </div>
      </div>
      {children && <div className="mt-auto pt-2.5">{children}</div>}
    </article>
  )

  return (
    <div className="space-y-3">
      {/* Search and type */}
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
        <label className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3">
          <Search className="h-4 w-4 shrink-0 text-slate-400" />
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t('ce.pend.searchPh')}
            aria-label={t('ce.pend.searchPh')}
            className="min-w-0 flex-1 bg-transparent text-xs text-slate-800 outline-none placeholder:text-slate-400"
          />
        </label>
        <FilterSelect value={type} onChange={setType} label={t('ce.pend.allTypes')}>
          <option value="">{t('ce.pend.allTypes')}</option>
          <option value="join">{t('ce.pendingJoinRequests')} ({pendingRequests.length})</option>
          <option value="invite">{t('ce.pendingInvitations')} ({invitations.length})</option>
          <option value="sent">{t('ce.sentRequests')} ({outgoingRequests.length})</option>
        </FilterSelect>
      </div>

      {nothingAtAll ? (
        <p className="rounded-xl border border-dashed border-oc-line bg-oc-sunken p-6 text-center text-sm font-semibold text-oc-faint">{t('ce.noPendingRequests')}</p>
      ) : joinShown.length === 0 && inviteShown.length === 0 && sentShown.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-200 bg-white p-6 text-center text-sm font-semibold text-slate-500">{t('ce.filter.noMatch')}</p>
      ) : null}

      {/* Engineers asking to join */}
      {joinShown.length > 0 && (
        <section className="space-y-2">
          <SectionTitle title={t('ce.pendingJoinRequests')} count={joinShown.length} />
          <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2 lg:grid-cols-3">
            {joinShown.map((engineer) => engineerCard(engineer, {
              stripe: 'bg-sky-500',
              status: pill('bg-sky-50 text-sky-700', t('ui.status.pending')),
              children: (
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={(event) => { event.stopPropagation(); onRespond(engineer.relationship_id, 'REJECT') }}
                    className="inline-flex h-8 items-center justify-center gap-1 rounded-lg border border-rose-200 bg-rose-50 text-xs font-extrabold text-rose-600 transition hover:bg-rose-100"
                  >
                    <X className="h-3.5 w-3.5" /> {t('ce.reject')}
                  </button>
                  <button
                    type="button"
                    onClick={(event) => { event.stopPropagation(); onRespond(engineer.relationship_id, 'ACCEPT') }}
                    className="inline-flex h-8 items-center justify-center gap-1 rounded-lg bg-brand-800 text-xs font-extrabold text-white transition hover:bg-brand-900"
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" /> {t('ce.accept')}
                  </button>
                </div>
              ),
            }))}
          </div>
        </section>
      )}

      {/* Invitations not yet used */}
      {inviteShown.length > 0 && (
        <section className="space-y-2">
          <SectionTitle title={t('ce.pendingInvitations')} count={inviteShown.length} />
          <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2 lg:grid-cols-3">
            {inviteShown.map((invitation) => (
              <article key={invitation.id} className="relative flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white p-3 pl-4 shadow-[0_14px_40px_-32px_rgba(15,23,42,0.45)]">
                <span className="absolute inset-y-0 left-0 w-1 bg-violet-500" aria-hidden="true" />
                <div className="flex items-start gap-2.5">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-violet-50 text-violet-700"><Mail className="h-4 w-4" /></span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-extrabold text-slate-900">{invitation.phone || invitation.email || t('ce.waitingForEngineer')}</p>
                    <p className="truncate text-[11px] text-slate-500">{t('ce.pend.inviteCode')}: <span className="font-mono font-extrabold tracking-wider text-brand-800">{invitation.invite_code}</span></p>
                  </div>
                  {pill('bg-violet-50 text-violet-700', t('ui.status.pending'))}
                </div>
                <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-2.5">
                  <CopyButton text={invitation.invite_code} label={t('ce.copyCode')} />
                  <CopyButton text={invitation.invite_link} label={t('ce.copyLink')} />
                  <a
                    href={`https://wa.me/?text=${encodeURIComponent(t('ce.shareMessage', { name: shareFrom, code: invitation.invite_code, link: invitation.invite_link }))}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex h-8 items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-extrabold text-slate-700 transition hover:bg-slate-50"
                  >
                    <MessageCircle className="h-3.5 w-3.5" /> {t('ce.whatsapp')}
                  </a>
                  <a
                    href={`sms:?body=${encodeURIComponent(t('ui.contractor.smsInviteMessage', { code: invitation.invite_code, name: shareFrom, link: invitation.invite_link }))}`}
                    className="inline-flex h-8 items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-extrabold text-slate-700 transition hover:bg-slate-50"
                  >
                    <Send className="h-3.5 w-3.5" /> {t('ui.contractor.sms')}
                  </a>
                  {onRevokeInvitation && (
                    <button
                      type="button"
                      onClick={() => onRevokeInvitation(invitation.id)}
                      className="inline-flex h-8 items-center gap-1 rounded-lg border border-rose-200 bg-rose-50 px-2.5 text-xs font-extrabold text-rose-600 transition hover:bg-rose-100"
                    >
                      <Trash2 className="h-3.5 w-3.5" /> {t('ui.contractor.revoke')}
                    </button>
                  )}
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      {/* Requests this builder sent */}
      {sentShown.length > 0 && (
        <section className="space-y-2">
          <SectionTitle title={t('ce.sentRequests')} count={sentShown.length} />
          <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2 lg:grid-cols-3">
            {sentShown.map((engineer) => engineerCard(engineer, {
              stripe: 'bg-amber-400',
              status: pill('bg-amber-50 text-amber-700', t('ce.requestSent')),
              dateLabel: t('dash.contractor.filter.sent'),
            }))}
          </div>
        </section>
      )}
    </div>
  )
}

export function MySiteEngineersSection({
  teamData,
  contractorName,
  onInvite,
  onRespond,
  onViewEngineer,
  onAssignProject,
  onUnassignProject,
  onRevokeInvitation,
  message,
  // New props for 3-tab layout
  activeTab = 'team',
  onTabChange,
  // Find Engineers props
  engineers,
  engineersPincode,
  onPincodeChange,
  onSendEngineerRequest,
  sentEngineerIds,
  sendingEngineerId,
  onRefreshNearbyEngineers,
  // Supplier props
  contractorSuppliers,
  onOpenSupplierProfile,
  onAssignSupplier,
  onUnassignSupplier,
  // The dashboard header's search box, shared with every tab's own search.
  searchQuery,
  onSearchChange,
}) {
  const { t } = useLanguage()
  const active = teamData.active || []
  const pendingRequests = teamData.pending_requests || []
  const invitations = teamData.invitations || []
  const outgoingRequests = teamData.outgoing_requests || []
  const shareFrom = contractorName || t('ce.yourBuilder')
  const tabs = [
    { id: 'team', label: t('ui.siteEngineers'), icon: Users, count: active.length },
    { id: 'find', label: t('ui.findEngineers'), icon: Search },
    { id: 'suppliers', label: t('ce.mySuppliers'), icon: Truck },
    { id: 'pending', label: t('ce.pendingRequests'), icon: Clock },
  ]
  return (
    <div className="space-y-4">
      {/* The caption that sat here said "My Site Engineers" directly under the
          navigation item of the same name. Invite Site Engineer moved up with
          it, onto the page header row, the slot this shell already gives an
          action -- the same place the House Owner's Create New Project sits. */}
      {/* Tab bar — full width on its own row, so all four tabs fit and the
          strip never has to scroll sideways. */}
      <div className="flex gap-1.5 overflow-x-auto rounded-2xl border border-slate-200 bg-white p-1.5">
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onTabChange?.(tab.id)}
              className={`inline-flex h-10 shrink-0 items-center gap-2 rounded-xl px-4 text-xs font-extrabold transition ${
                isActive ? 'bg-brand-700 text-white shadow-sm' : 'text-graphite/55 hover:bg-slate-50 hover:text-graphite'
              }`}
            >
              <tab.icon className="h-4 w-4" />
              {tab.label}
              {tab.count !== undefined && (
                <span className={`grid h-5 min-w-5 place-items-center rounded-full px-1.5 text-[10px] font-extrabold ${isActive ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-600'}`}>{tab.count}</span>
              )}
            </button>
          )
        })}
      </div>

      {message && <p className="rounded-xl border border-brand-100 bg-brand-50 px-4 py-2.5 text-sm font-bold text-brand-800">{message}</p>}

      {/* Tab: My Team — the builder's own site engineers */}
      {activeTab === 'team' && (
        <MyTeamEngineers
          engineers={active}
          onViewEngineer={onViewEngineer}
          onAssignProject={onAssignProject}
          onUnassignProject={onUnassignProject}
          search={searchQuery}
          onSearchChange={onSearchChange}
          onInvite={onInvite}
        />
      )}

      {/* Tab: Find Site Engineers */}
      {activeTab === 'find' && (
        <FindEngineers
          engineers={engineers}
          pincode={engineersPincode}
          onPincodeChange={onPincodeChange}
          onFind={onRefreshNearbyEngineers}
          onViewEngineer={onViewEngineer}
          onSendRequest={onSendEngineerRequest}
          onRespond={onRespond}
          sentEngineerIds={sentEngineerIds}
          sendingEngineerId={sendingEngineerId}
          search={searchQuery}
          onSearchChange={onSearchChange}
        />
      )}

      {/* Tab: My Suppliers — the builder's accepted suppliers */}
      {activeTab === 'suppliers' && (
        <MySuppliers
          suppliers={contractorSuppliers}
          onOpenSupplierProfile={onOpenSupplierProfile}
          onAssignSupplier={onAssignSupplier}
          onUnassignSupplier={onUnassignSupplier}
          search={searchQuery}
          onSearchChange={onSearchChange}
        />
      )}

      {/* Tab: Pending Requests — join requests, invitations and sent requests */}
      {activeTab === 'pending' && (
        <PendingPartnerRequests
          pendingRequests={pendingRequests}
          invitations={invitations}
          outgoingRequests={outgoingRequests}
          shareFrom={shareFrom}
          onRespond={onRespond}
          onViewEngineer={onViewEngineer}
          onRevokeInvitation={onRevokeInvitation}
          search={searchQuery}
          onSearchChange={onSearchChange}
        />
      )}
    </div>
  )
}

export function InviteEngineerDrawer({ contractorName, prefill, onClose, onGenerate, inviteResult, error, busy }) {
  const { t } = useLanguage()
  const [phone, setPhone] = useState(prefill?.phone || '')
  const [email, setEmail] = useState(prefill?.email || '')
  useEffect(() => {
    if (prefill?.phone) setPhone(prefill.phone)
    if (prefill?.email) setEmail(prefill.email)
  }, [prefill])
  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])
  const shareMessage = t('ce.shareMessage', { name: contractorName, code: inviteResult?.invite_code || '', link: inviteResult?.invite_link || '' })

  return (
    <div className="fixed inset-0 z-[130] flex items-center justify-center p-4 sm:p-6">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.18 }}
        className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
        onClick={onClose}
      />
      <motion.aside
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        exit={{ x: '100%' }}
        transition={{ type: 'spring', stiffness: 340, damping: 34 }}
        className="absolute inset-y-0 right-0 flex w-full max-w-md flex-col border-l border-slate-200 bg-white shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
          <div className="min-w-0">
            <p className="text-[10px] font-extrabold uppercase tracking-wide text-slate-400">{t('ce.inviteEngineer')}</p>
            <h3 className="truncate font-display text-base font-extrabold text-slate-950">{t('ce.inviteSubtitle')}</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('ce.closeInvitePanel')}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          {!inviteResult ? (
            <form
              className="space-y-3"
              onSubmit={(event) => {
                event.preventDefault()
                onGenerate({ phone, email })
              }}
            >
              <div>
                <p className="mb-1 text-xs font-extrabold uppercase tracking-wide text-slate-400">{t('ps.phone')}</p>
                <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3.5">
                  <Phone className="h-4 w-4 shrink-0 text-brand-600" />
                  <input value={phone} onChange={(event) => setPhone(event.target.value.replace(/\D/g, '').slice(-10))} placeholder={t('ce.phonePlaceholder')} className="h-10 w-full bg-transparent text-sm font-bold text-slate-800 outline-none placeholder:font-semibold placeholder:text-slate-400" />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="h-px flex-1 bg-slate-100" />
                <span className="text-[10px] font-extrabold uppercase tracking-wide text-slate-400">{t('ce.or')}</span>
                <span className="h-px flex-1 bg-slate-100" />
              </div>
              <div>
                <p className="mb-1 text-xs font-extrabold uppercase tracking-wide text-slate-400">{t('ps.email')}</p>
                <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3.5">
                  <Mail className="h-4 w-4 shrink-0 text-brand-600" />
                  <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder={t('ce.emailPlaceholder')} className="h-10 w-full bg-transparent text-sm font-bold text-slate-800 outline-none placeholder:font-semibold placeholder:text-slate-400" />
                </div>
              </div>
              {error && <p className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm font-bold text-rose-700">{error}</p>}
              <button
                type="submit"
                disabled={busy || (!phone && !email)}
                className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-brand-600 text-sm font-extrabold text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
              >
                {busy ? t('ce.generating') : t('ce.generateInvitation')}
              </button>
            </form>
          ) : (
            <div className="space-y-4">
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-center">
                <CheckCircle2 className="mx-auto h-7 w-7 text-emerald-600" />
                <p className="mt-2 text-sm font-extrabold text-emerald-800">{t('ce.invitationGenerated')}</p>
                <p className="mt-0.5 text-xs font-medium text-emerald-700">{t('ce.shareCode')}</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-center">
                <p className="text-[10px] font-extrabold uppercase tracking-wide text-slate-400">{t('ce.teamCode')}</p>
                <p className="mt-1 font-mono text-2xl font-extrabold tracking-widest text-brand-800">{inviteResult.invite_code}</p>
                <p className="mt-2 truncate text-xs font-medium text-slate-500">{inviteResult.invite_link}</p>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <CopyButton text={inviteResult.invite_code} label={t('ce.copyCode')} />
                <CopyButton text={inviteResult.invite_link} label={t('ce.copyLink')} />
                <a
                  href={`https://wa.me/?text=${encodeURIComponent(shareMessage)}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex h-10 items-center justify-center gap-1.5 rounded-lg bg-emerald-600 text-xs font-extrabold text-white transition hover:bg-emerald-700"
                >
                  <MessageCircle className="h-4 w-4" /> {t('ce.whatsapp')}
                </a>
                <a
                  href={`sms:?body=${encodeURIComponent(shareMessage)}`}
                  className="inline-flex h-10 items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white text-xs font-extrabold text-slate-700 transition hover:border-brand-300 hover:bg-brand-50 hover:text-brand-800"
                >
                  <Send className="h-4 w-4" /> {t('ui.contractor.sms')}
                </a>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5">
                <p className="text-[10px] font-extrabold uppercase tracking-wide text-slate-400">{t('ce.invitationMessage')}</p>
                <p className="mt-1 whitespace-pre-line text-xs font-medium leading-relaxed text-slate-600">{shareMessage}</p>
              </div>
              <div className="flex justify-end gap-2">
                <button type="button" onClick={onClose} className="inline-flex h-10 items-center justify-center rounded-lg border border-slate-200 bg-white px-5 text-sm font-extrabold text-slate-600 transition hover:bg-slate-50">
                  {t('ce.done')}
                </button>
              </div>
            </div>
          )}
        </div>
      </motion.aside>
    </div>
  )
}

export function AssignProjectDrawer({ engineer, projectList, onClose, onAssign, busy, successProject, error, assignedByProject }) {
  const { t, td } = useLanguage()
  const [selectedProject, setSelectedProject] = useState(null)
  const engineerName = td(engineer?.name) || t('ce.thisEngineer')
  // One running project per Site Engineer: while they are on one, none of
  // these projects can be given to them (the server refuses it too).
  const engineerBusy = Boolean(engineer?.working_on_project)

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-[130]">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.18 }}
        className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
        onClick={onClose}
      />
      {/* A centred window, as the engineer profile opens, rather than a
          panel sliding in from the right. */}
      <motion.aside
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 16 }}
        transition={{ duration: 0.2 }}
        role="dialog"
        aria-modal="true"
        className="relative flex max-h-[90vh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
          <div className="min-w-0">
            <p className="text-[10px] font-extrabold uppercase tracking-wide text-slate-400">{t('ce.assignProject')}</p>
            <h3 className="truncate font-display text-base font-extrabold text-slate-950">{engineerName}</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('ce.closeAssignPanel')}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          {successProject ? (
            <div className="flex h-full flex-col items-center justify-center rounded-xl border border-emerald-200 bg-emerald-50 p-8 text-center">
              <span className="grid h-14 w-14 place-items-center rounded-full bg-white text-emerald-600">
                <CheckCircle2 className="h-8 w-8" />
              </span>
              <h3 className="mt-4 font-display text-xl font-extrabold text-slate-950">{t('ce.projectAssigned')}</h3>
              <p className="mt-2 text-sm font-medium leading-relaxed text-slate-500">
                {t('ui.contractor.projectAssignedTo', { project: td(successProject.title), name: engineerName })}
              </p>
              <button
                type="button"
                onClick={onClose}
                className="mt-6 inline-flex h-10 items-center justify-center rounded-lg bg-brand-600 px-7 text-sm font-extrabold text-white transition hover:bg-brand-700"
              >
                {t('ce.done')}
              </button>
            </div>
          ) : !selectedProject ? (
            <>
              <p className="text-xs font-bold text-slate-600">{t('ui.contractor.chooseProjectToAssign', { name: engineerName })}</p>
              {engineerBusy && (
                <p role="note" className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-extrabold text-amber-700">
                  {t('ce.workingOnAnotherProject')}
                </p>
              )}
              {projectList.length === 0 ? (
                <p className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-8 text-center text-sm font-semibold text-slate-400">
                  {t('ce.noProjectsYet')}
                </p>
              ) : (
                <div className="space-y-2">
                  {projectList.map((project) => {
                    const assignedTo = assignedByProject?.[project.id]
                    return (
                      <div
                        key={project.id}
                        className={`flex items-center justify-between gap-3 rounded-xl border p-3.5 transition ${
                          assignedTo
                            ? 'border-slate-200 bg-slate-50/60'
                            : 'border-slate-200 bg-slate-50 hover:border-brand-200 hover:bg-white'
                        }`}
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-extrabold text-slate-950">{td(project.title)}</p>
                          {assignedTo ? (
                            <p className="mt-0.5 inline-flex items-center gap-1 text-xs font-bold text-emerald-700">
                              <CheckCircle2 className="h-3.5 w-3.5" /> {t('ui.contractor.assignedToName', { name: td(assignedTo) })}
                            </p>
                          ) : (
                            <p className="text-xs font-medium text-slate-500">{t('ui.contractor.pincodeStatus', { pincode: project.pincode || '—', status: projectStatusText(project.status || 'active', t) })}</p>
                          )}
                        </div>
                        {assignedTo ? (
                          <span className="inline-flex h-9 shrink-0 items-center rounded-lg border border-slate-200 bg-white px-4 text-xs font-extrabold text-slate-400">
                            {t('ce.taken')}
                          </span>
                        ) : (
                          <button
                            type="button"
                            disabled={engineerBusy}
                            onClick={() => setSelectedProject(project)}
                            className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-brand-600 px-4 text-xs font-extrabold text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
                          >
                            {t('ce.assign')}
                          </button>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </>
          ) : (
            <>
              <div className="rounded-xl border border-brand-200 bg-brand-50/50 p-4">
                <p className="text-sm font-extrabold text-slate-950">{t('ui.contractor.assignProjectConfirm', { name: engineerName })}</p>
                <div className="mt-3 space-y-2">
                  <p className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-3.5 py-2.5 text-sm">
                    <span className="text-slate-500">{t('se.project')}</span>
                    <span className="truncate font-extrabold text-slate-950">{td(selectedProject.title)}</span>
                  </p>
                  <p className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-3.5 py-2.5 text-sm">
                    <span className="text-slate-500">{t('role.engineer')}</span>
                    <span className="truncate font-extrabold text-slate-950">{engineerName}</span>
                  </p>
                </div>
              </div>
              {error && <p className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm font-bold text-rose-700">{error}</p>}
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setSelectedProject(null)}
                  disabled={busy}
                  className="inline-flex h-10 items-center justify-center rounded-lg border border-slate-200 bg-white px-5 text-sm font-extrabold text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {t('ce.cancel')}
                </button>
                <button
                  type="button"
                  onClick={() => onAssign(selectedProject)}
                  disabled={busy}
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-brand-600 px-6 text-sm font-extrabold text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <CheckCircle2 className="h-4 w-4" /> {t('ce.confirmAssignment')}
                </button>
              </div>
            </>
          )}
        </div>
      </motion.aside>
    </div>
  )
}

export function UnassignProjectDrawer({ engineer, onClose, onUnassign, busy, successProject, error }) {
  const { t, td } = useLanguage()
  const engineerName = td(engineer?.name) || t('ce.thisEngineer')
  const assignedProjects = engineer?.assigned_projects || []
  // With a single assigned project there is nothing to choose, so the box
  // opens straight on the confirmation. With several, the list comes first,
  // exactly as before.
  const onlyProject = assignedProjects.length === 1 ? assignedProjects[0] : null
  const [pendingProject, setPendingProject] = useState(onlyProject)

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  return (
    // A small centred confirmation box (it used to be a panel on the right).
    <div className="fixed inset-0 z-[130] flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.18 }}
        className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
        onClick={onClose}
      />
      <motion.aside
        role="dialog"
        aria-modal="true"
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.96 }}
        transition={{ duration: 0.16 }}
        className="relative flex max-h-[85vh] w-full max-w-sm flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
          <div className="min-w-0">
            <p className="text-[10px] font-extrabold uppercase tracking-wide text-slate-400">{t('ce.unassignEngineer')}</p>
            <h3 className="truncate font-display text-base font-extrabold text-slate-950">{engineerName}</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('ce.closeUnassignPanel')}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          {successProject ? (
            <div className="flex flex-col items-center justify-center rounded-xl border border-emerald-200 bg-emerald-50 p-6 text-center">
              <span className="grid h-14 w-14 place-items-center rounded-full bg-white text-emerald-600">
                <CheckCircle2 className="h-8 w-8" />
              </span>
              <h3 className="mt-4 font-display text-xl font-extrabold text-slate-950">{t('ce.engineerUnassigned')}</h3>
              <p className="mt-2 text-sm font-medium leading-relaxed text-slate-500">
                {t('ui.contractor.unassignedFrom', { name: engineerName, project: td(successProject.title) })}
              </p>
              <button
                type="button"
                onClick={onClose}
                className="mt-6 inline-flex h-10 items-center justify-center rounded-lg bg-brand-600 px-7 text-sm font-extrabold text-white transition hover:bg-brand-700"
              >
                {t('ce.done')}
              </button>
            </div>
          ) : !pendingProject ? (
            <>
              <p className="text-xs font-bold text-slate-600">{t('ui.contractor.chooseProjectToRemove', { name: engineerName })}</p>
              {assignedProjects.length === 0 ? (
                <p className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-8 text-center text-sm font-semibold text-slate-400">
                  {t('ce.noAssignedProjects')}
                </p>
              ) : (
                <div className="space-y-2">
                  {assignedProjects.map((project) => (
                    <div key={project.id} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3.5 transition hover:border-rose-200 hover:bg-white">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-extrabold text-slate-950">{td(project.title)}</p>
                        <p className="text-xs font-medium text-slate-500">{t('ce.assignedProject')}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setPendingProject(project)}
                        className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-rose-200 bg-white px-4 text-xs font-extrabold text-rose-600 transition hover:bg-rose-50"
                      >
                        <X className="h-3.5 w-3.5" /> {t('ce.unassign')}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : (
            <>
              <div className="rounded-xl border border-rose-200 bg-rose-50/50 p-4">
                <p className="text-sm font-extrabold text-slate-950">{t('ui.contractor.unassignFromProjectConfirm', { name: engineerName })}</p>
                <div className="mt-3 space-y-2">
                  <p className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-3.5 py-2.5 text-sm">
                    <span className="text-slate-500">{t('se.project')}</span>
                    <span className="truncate font-extrabold text-slate-950">{td(pendingProject.title)}</span>
                  </p>
                  <p className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-3.5 py-2.5 text-sm">
                    <span className="text-slate-500">{t('role.engineer')}</span>
                    <span className="truncate font-extrabold text-slate-950">{engineerName}</span>
                  </p>
                </div>
              </div>
              {error && <p className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm font-bold text-rose-700">{error}</p>}
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => (onlyProject ? onClose() : setPendingProject(null))}
                  disabled={busy}
                  className="inline-flex h-10 items-center justify-center rounded-lg border border-slate-200 bg-white px-5 text-sm font-extrabold text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {t('ce.cancel')}
                </button>
                <button
                  type="button"
                  onClick={() => onUnassign(pendingProject)}
                  disabled={busy}
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-rose-600 px-6 text-sm font-extrabold text-white transition hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <X className="h-4 w-4" /> {t('ce.confirmUnassign')}
                </button>
              </div>
            </>
          )}
        </div>
      </motion.aside>
    </div>
  )
}

export function ContractorEngineerProfileDrawer({ engineer, onClose, onSendRequest, teamStatus, requestSent }) {
  const { t, td } = useLanguage()
  const data = engineer || {}
  const showSendRequest = Boolean(onSendRequest) && !teamStatus && !requestSent

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-[130] flex items-center justify-center p-4 sm:p-6">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.18 }}
        className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
        onClick={onClose}
      />
      {/* A large centred window rather than a side drawer, with the
          dashboard dimmed around it. */}
      <motion.aside
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 16 }}
        transition={{ duration: 0.2 }}
        className="relative flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 shadow-2xl"
      >
        {/* Header */}
        <div className="border-b border-slate-200 bg-white">
        <div className="flex w-full items-center justify-between gap-3 px-6 py-4">
          <div className="min-w-0">
            <p className="text-[10px] font-extrabold uppercase tracking-wide text-slate-400">{t('ps.eng.title')}</p>
            <h3 className="truncate font-display text-base font-extrabold text-slate-950">{td(data.name) || t('ce.engineerFallback')}</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('ce.closeProfile')}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
        <div className="w-full space-y-5 px-6 py-6">
          <div className="flex items-center gap-5 rounded-2xl border border-slate-200 bg-white p-5">
            <SmartImage src={userAvatarSrc(data, 'ENGINEER')} alt={data.name} className="h-24 w-24 shrink-0 rounded-full object-cover ring-1 ring-slate-200" />
            <div className="min-w-0">
              <h3 className="truncate font-display text-2xl font-extrabold text-slate-950">{td(data.name)}</h3>
              {teamStatus === 'active' && (
                <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-extrabold text-emerald-700 ring-1 ring-emerald-100">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> {t('ce.activeTeamMember')}
                </span>
              )}
              {teamStatus === 'pending' && (
                <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-brand-50 px-2 py-0.5 text-[10px] font-extrabold text-brand-700 ring-1 ring-brand-100">
                  <span className="h-1.5 w-1.5 rounded-full bg-brand-500" /> {t('ce.joinRequestPending')}
                </span>
              )}
              <p className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
                <MapPin className="h-3.5 w-3.5 text-brand-700" /> {td(data.address || '')} · {data.pincode || ''}
              </p>
              {data.specialization && <p className="mt-0.5 text-xs font-bold text-brand-700">{optionLabel(t, ENGINEER_CATEGORY_LABEL_KEYS, data.specialization)}</p>}
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3 text-center">
            <div className="rounded-xl border border-slate-200 bg-white px-2 py-4">
              <p className="text-base font-extrabold text-slate-900">{t('ui.contractor.yearsShort', { years: data.experience_years || 0 })}</p>
              <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{t('ce.experience')}</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white px-2 py-4">
              <p className="text-base font-extrabold text-slate-900">{td(data.qualification) || '—'}</p>
              <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{t('ps.eng.qualification')}</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white px-2 py-4">
              <p className="text-base font-extrabold text-slate-900">{data.project_count || 0}</p>
              <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{t('ui.projects')}</p>
            </div>
          </div>
          {(data.email || data.phone) && (
            <div className="grid gap-3 md:grid-cols-2">
              {data.email && (
                <p className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm">
                  <Mail className="h-4 w-4 shrink-0 text-brand-700" />
                  <span className="shrink-0 text-slate-500">{t('ps.email')}</span>
                  <span className="ml-auto min-w-0 truncate font-bold text-slate-800">{data.email}</span>
                </p>
              )}
              {data.phone && (
                <p className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm">
                  <Phone className="h-4 w-4 shrink-0 text-brand-700" />
                  <span className="shrink-0 text-slate-500">{t('ps.phoneShort')}</span>
                  <span className="ml-auto min-w-0 truncate font-bold text-slate-800">{data.phone}</span>
                </p>
              )}
            </div>
          )}
          {data.about && <p className="rounded-xl border border-slate-200 bg-white p-4 text-sm font-medium leading-relaxed text-slate-600">{td(data.about)}</p>}
          <div className="flex justify-end gap-2 [&>*]:max-w-[14rem]">
            <button type="button" onClick={onClose} className="inline-flex h-10 flex-1 items-center justify-center rounded-lg border border-slate-200 bg-white text-sm font-extrabold text-slate-600 transition hover:bg-slate-50">
              {t('ce.close')}
            </button>
            {showSendRequest && (
              <button type="button" onClick={() => onSendRequest(data)} className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-lg bg-brand-600 text-sm font-extrabold text-white transition hover:bg-brand-700">
                <UserRound className="h-4 w-4" /> {t('ce.sendRequest')}
              </button>
            )}
            {requestSent && (
              <span className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-lg bg-ocbrand-50 text-sm font-extrabold text-ocbrand-700 ring-1 ring-ocbrand-100">
                {t('ce.requestSent')}
              </span>
            )}
          </div>
        </div>
        </div>
      </motion.aside>
    </div>
  )
}
