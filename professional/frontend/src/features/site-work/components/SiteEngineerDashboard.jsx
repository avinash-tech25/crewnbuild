import { forwardRef, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useSelector } from 'react-redux'
import { useNavigate } from 'react-router-dom'
import { CalendarDays, Camera, ChevronDown, ChevronLeft, ChevronRight, CirclePlay, DoorOpen, FileText, Film, History as HistoryIcon, Image as ImageIcon, Loader2, Lock, Plus, RefreshCw, RotateCcw, Save, Search, X } from 'lucide-react'
import { deleteProjectPhoto, fetchProjectPhotos, fetchProjectTimelineEntries, saveDailyWorkflow } from '../../projects/projectsApi.js'
import { completionPercent, completionText, scheduleText } from '../../../shared/utils/projectProgress.js'
import { fetchCostToolSummary } from '../../projects/costToolApi.js'
import { imageUrl } from '../../../shared/api/apiClient.js'
import { formatMoney as countryFormatMoney } from '../../../shared/utils/countryConfig.js'
import PhotoViewer from '../../../shared/ui/PhotoViewer.jsx'
import { useLanguage } from '../../../i18n/LanguageContext.jsx'
import BudgetInWords from '../../../shared/ui/BudgetInWords.jsx'
import { activeLocale, formatDate } from '../../../shared/utils/formatters.js'
import { optionLabel } from '../../../i18n/optionKeys.js'
import BuilderCostAdjustments from '../../billing/subscription/BuilderCostAdjustments.jsx'
import LockedFeature from '../../billing/subscription/LockedFeature.jsx'
import { builderAccessPaused, lockedReason } from '../../billing/subscription/subscriptionFormat.js'
import { fetchLaborDailyRecords, fetchProjectLaborRequests } from '../../labour/labourApi.js'
import { fetchEquipmentUsage, fetchProjectEquipmentRequests } from '../../equipment/equipmentApi.js'
import { agreedPurchases, canRecordOnDate, dailyCostSummary, hasResourceOnDate, labourRequestsForDate, recordForDate, rentalChargeForDate, rentalsForDate } from '../siteResources.js'
import { LabourCards, PaymentsList, PurchasedEquipment, ReceivedMaterials, RentalCards, Tag } from './SiteDayResources.jsx'
import { EMPTY_HISTORY_FILTERS, buildMaterialHistory, filterMaterialHistory, hasActiveFilters, isMaterialCostOverride, sortLatestFirst, summarizeMaterialHistory, todayUsageSummary, usageChanges } from '../siteMaterialHistory.js'

const localDateKey = (value = new Date()) => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
const emptyForm = { work_title: '', activity_category: '', boq_reference: '', activity_unit: '', planned_quantity: '', completed_quantity: '', detailed_remarks: '', labour_worker_count: '', labour_cost: '', material_cost: '', equipment_cost: '', total_expenses: '', material_used: '', equipment_used: '', inspection_remarks: '' }
const numericFields = new Set(['labour_worker_count', 'labour_cost', 'material_cost', 'equipment_cost', 'total_expenses'])
// Datalist suggestions for the BOQ activity fields. These are the standard
// division and unit labels construction BOQs use; both inputs stay free text
// and are merged with whatever this project has already recorded.
const BASE_ACTIVITY_CATEGORIES = ['Concrete', 'Masonry', 'Finishes', 'Excavation', 'Reinforcement', 'Formwork', 'Plaster', 'Tiling', 'Painting', 'Waterproofing', 'Boundary Wall', 'MEP']
const BASE_ACTIVITY_UNITS = ['m2', 'm3', 'm', 'kg', 'ton', 'bags', 'nos']
// The suggestions above are STORED VALUES: whatever the engineer picks is posted
// to saveDailyWorkflow and matched against saved records, so the value itself
// stays English in every language. These maps translate only the label the
// datalist shows beside it. m2/m3/m/kg are symbols and are the same everywhere,
// so only the three unit words have entries.
const ACTIVITY_CATEGORY_KEYS = {
  Concrete: 'opt.category.concrete',
  Masonry: 'opt.activity.masonry',
  Finishes: 'opt.activity.finishes',
  Excavation: 'opt.activity.excavation',
  Reinforcement: 'opt.activity.reinforcement',
  Formwork: 'opt.activity.formwork',
  Plaster: 'opt.activity.plaster',
  Tiling: 'opt.activity.tiling',
  Painting: 'opt.activity.painting',
  Waterproofing: 'opt.category.waterproofing',
  'Boundary Wall': 'opt.activity.boundaryWall',
  MEP: 'opt.activity.mep',
}
const ACTIVITY_UNIT_KEYS = { ton: 'opt.unit.ton', bags: 'opt.unit.bags', nos: 'opt.unit.nos' }
// Units that are symbols rather than words read the same in every language and
// must never be sent to the machine translator, which would happily turn "m"
// into a word. Anything else a project recorded is a word and is translated.
const UNIT_SYMBOLS = new Set(['m', 'm2', 'm3', 'mm', 'cm', 'km', 'sqm', 'sqft', 'cum', 'cft', 'rmt', 'kg', 'g', 'mt', 'l', 'ltr', 'ml', '%'])
const STATUS_LABEL_KEYS = { OPEN: 'ui.status.open', IN_PROGRESS: 'ui.status.inProgress', CLOSED: 'ui.status.closed', COMPLETED: 'ui.status.closed', Photos: 'se.statusPhotos', Videos: 'se.cal.video', PhotosVideos: 'se.cal.photoVideo' }
// A calendar day's label names exactly what that day holds for this view:
// text (the day's record), photos and videos, each counted on its own. Keyed by
// text/photo/video presence ("1" / "0").
const CONTENT_LABEL_KEYS = {
  '100': 'se.cal.text',
  '110': 'se.cal.textPhoto',
  '101': 'se.cal.textVideo',
  '111': 'se.cal.textMedia',
  '010': 'se.cal.photo',
  '001': 'se.cal.video',
  '011': 'se.cal.photoVideo',
}
// Cell colours by what the day holds: text + photo + video purple, any other video
// orange, photos only blue, text only pink, today
// with nothing yet green.
const CELL_TONES = { open: ['#CFEBDD', '#03572E'], all: ['#F3E8FD', '#9146D8'], video: ['#F6EADB', '#F58A00'], photo: ['#E7F0FD', '#1683E8'], text: ['#FCE7F3', '#DB2777'] }
// The small calendar's cells are too narrow for weekday names in every language,
// so it heads each column with the first letter (a whole letter, vowel signs included).
const LETTERS = Intl.Segmenter ? new Intl.Segmenter() : null
const weekdayInitial = (label) => (LETTERS ? [...LETTERS.segment(label)][0]?.segment : label[0]) || label
// A date's place in the project's working sequence from its start date: every
// day from the start through `date`, Sundays (site holiday) excluded.
const workingDayNumber = (startDate, date) => {
  if (!startDate || !date || date < String(startDate).slice(0, 10)) return null
  const [y, m, d] = String(startDate).slice(0, 10).split('-').map(Number)
  const cursor = new Date(y, m - 1, d)
  let count = 0
  while (localDateKey(cursor) <= date) {
    if (cursor.getDay() !== 0) count += 1
    cursor.setDate(cursor.getDate() + 1)
  }
  return count || null
}
// A status the map does not know used to be painted on screen as its raw API
// code (a bare "ARCHIVED" among translated pills); it now reads as Unknown in
// the selected language instead.
const statusLabel = (status, t) => {
  if (STATUS_LABEL_KEYS[status]) return t(STATUS_LABEL_KEYS[status])
  return status ? t('ui.status.unknown') : t('ui.status.open')
}
const apiErrorMessage = (error, fallback) => {
  const detail = error.response?.data?.detail
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail)) return detail.map((item) => item.msg).filter(Boolean).join(' ') || fallback
  return fallback
}
const money = (value, country) => countryFormatMoney(value, country)
// The site clock, not the viewer's. The workflow cutoff this screen enforces is
// decided in site time, so the IST zone is kept deliberately; only the locale
// moves to the selected language, which is what printed "AM"/"PM" and English
// digits grouping in all seven. `hour12` is dropped so each language uses its
// own convention rather than being forced into the English one.
const formatDisplayTime = (iso) => {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  const options = { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit' }
  try {
    return date.toLocaleTimeString(activeLocale(), options)
  } catch {
    return date.toLocaleTimeString(undefined, options)
  }
}
// A day's own work text. The auto-generated "Site Media: ..." line is a
// description of the attachments, not something the engineer typed, so it is
// stripped before deciding whether the day really carries text. Without this a
// media-only day would always count as text too and could never read as blue.
const MEDIA_CAPTION = /Site Media:[^.]*\.?/gi
const hasEnteredText = (row) => Boolean(row && [row.work_type, row.progress_note, row.inspection_remarks, row.material_used, row.equipment_used]
  .some((value) => String(value || '').replace(MEDIA_CAPTION, '').trim()))
const formatQty = (value) => { const number = Number(value || 0); return Number.isInteger(number) ? String(number) : String(Number(number.toFixed(2))) }
const stockStatusKey = (remaining, minimumStock) => (Number(remaining || 0) <= 0 ? 'out' : Number(minimumStock || 0) && Number(remaining || 0) <= Number(minimumStock || 0) ? 'low' : 'in')
const STOCK_TONES = { out: 'bg-rose-100 text-rose-700', low: 'bg-brand-100 text-brand-800', in: 'bg-emerald-100 text-emerald-700' }

const HISTORY_PAGE_SIZE = 20
// Translucent tints of each content colour, so a recorded day reads at a glance
// on the light and the dark dashboard alike. The legend uses the same tints.
const tint = (tone) => `${tone[1]}1F`
const normalizeUsage = (usage) => Object.fromEntries(Object.entries(usage || {}).map(([material, value]) => [material, Number(value) || 0]))
const snapshotOf = (form, usage) => JSON.stringify({ form, usage: normalizeUsage(usage) })

function Field({ label, children, wide = false, required = false, optional = false, hint = '', error = '', t, as: Tag = 'label' }) {
  return <Tag className={`grid content-start gap-1 text-xs font-bold text-slate-600 ${wide ? 'md:col-span-2' : ''}`}>
    <span>{label}{required && <span aria-hidden="true" className="ml-0.5 text-rose-600">*</span>}{optional && <span className="ml-1 font-semibold text-slate-400">({t('se.form.optional')})</span>}</span>
    {children}
    {error ? <span role="alert" className="text-[11px] font-bold text-rose-600">{error}</span> : hint ? <span className="text-[11px] font-semibold text-slate-400">{hint}</span> : null}
  </Tag>
}
const Input = forwardRef(function Input({ invalid = false, ...props }, ref) { return <input ref={ref} aria-invalid={invalid || undefined} {...props} className={`h-10 w-full rounded-lg border bg-white px-3 text-sm font-semibold outline-none placeholder:font-medium placeholder:text-slate-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-100 disabled:bg-slate-50 disabled:text-slate-700 ${invalid ? 'border-rose-400' : 'border-slate-200'}`} /> })
function TextArea(props) { return <textarea {...props} className="min-h-20 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold outline-none placeholder:font-medium placeholder:text-slate-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-100 disabled:bg-slate-50 disabled:text-slate-700" /> }
// One titled block of the daily record. Sections only group fields; nothing in
// them changes what is posted.
function FormSection({ title, aside = null, children }) {
  return <section className="rounded-xl border border-slate-200 p-4">
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-extrabold text-slate-900">{title}</h3>{aside}</div>
    {children}
  </section>
}
function GlanceStat({ label, value, sub = '' }) {
  return <div className="min-w-0 rounded-lg bg-slate-50 px-3 py-2">
    <p className="text-[10px] font-extrabold uppercase tracking-wide text-slate-500">{label}</p>
    <p className="truncate text-sm font-extrabold text-slate-900" title={typeof value === 'string' ? value : undefined}>{value}</p>
    {sub && <p className="truncate text-[11px] font-semibold text-slate-500">{sub}</p>}
  </div>
}
const NOTICE_TONES = { success: 'border-emerald-200 bg-emerald-50 text-emerald-800', error: 'border-rose-200 bg-rose-50 text-rose-700', info: 'border-brand-200 bg-brand-50 text-brand-800' }
function Notice({ notice, className = '', children = null }) {
  if (!notice?.text) return null
  return <div role={notice.tone === 'error' ? 'alert' : 'status'} className={`flex flex-wrap items-center justify-between gap-2 rounded-xl border px-4 py-3 text-sm font-bold ${NOTICE_TONES[notice.tone] || NOTICE_TONES.info} ${className}`}><span>{notice.text}</span>{children}</div>
}

// Project-wide material history: newest first, filterable, paged.
// `collapsible`: the heading toggles the content, shown only while `open`.
function MaterialHistoryPanel({ entries, filters, setFilters, touched, todayKey, country, panelRef, t, td, unitLabel, wide = false, collapsible = false, open = true, onToggle = null }) {
  const bodyId = useId()
  const [limit, setLimit] = useState(HISTORY_PAGE_SIZE)
  const labelOf = useCallback((name) => td(name), [td])
  const filtered = useMemo(() => sortLatestFirst(filterMaterialHistory(entries, filters, { todayKey, touched, labelOf }), touched), [entries, filters, todayKey, touched, labelOf])
  const summary = useMemo(() => summarizeMaterialHistory(filtered), [filtered])
  const materialOptions = useMemo(() => [...new Set(entries.map((entry) => entry.material))].sort((a, b) => a.localeCompare(b)), [entries])
  const active = hasActiveFilters(filters)
  // A new filter starts again from the first page.
  useEffect(() => { setLimit(HISTORY_PAGE_SIZE) }, [filters])
  const setFilter = (key, value) => setFilters((current) => ({ ...current, [key]: value }))
  const visible = filtered.slice(0, limit)
  const filterClass = 'h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-semibold outline-none focus:border-brand-500'
  let previousDate = ''
  return <section ref={panelRef} className={`scroll-mt-4 w-full ${wide ? '' : 'mx-auto max-w-4xl'} rounded-2xl border border-slate-200 bg-white p-4 sm:p-5`}>
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div><h2 className="flex items-center gap-2 text-base font-extrabold text-slate-900">{collapsible
        ? <button type="button" onClick={onToggle} aria-expanded={open} aria-controls={bodyId} className="flex items-center gap-2 text-left"><HistoryIcon className="h-4 w-4 text-brand-700" />{t('se.hist.title')}<ChevronDown aria-hidden="true" className={`h-4 w-4 text-slate-500 transition-transform ${open ? 'rotate-180' : ''}`} /></button>
        : <><HistoryIcon className="h-4 w-4 text-brand-700" />{t('se.hist.title')}</>}</h2><p className="mt-0.5 text-xs font-semibold text-slate-500">{t('se.hist.subtitle')}</p></div>
      {open && active && <button type="button" onClick={() => setFilters(EMPTY_HISTORY_FILTERS)} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 px-3 text-xs font-extrabold text-slate-700 hover:bg-slate-50"><RotateCcw className="h-3.5 w-3.5" />{t('se.hist.reset')}</button>}
    </div>
    {open && <div id={bodyId}>
    {entries.length > 0 && <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-[1.4fr_1.2fr_1fr_1fr_1fr]">
      <label className="relative col-span-2 md:col-span-1"><span className="sr-only">{t('se.hist.searchPlaceholder')}</span><Search aria-hidden="true" className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" /><input type="search" value={filters.search} onChange={(event) => setFilter('search', event.target.value)} placeholder={t('se.hist.searchPlaceholder')} className={`${filterClass} pl-8`} /></label>
      <label className="col-span-2 md:col-span-1"><span className="sr-only">{t('se.material')}</span><select value={filters.material} onChange={(event) => setFilter('material', event.target.value)} className={filterClass}><option value="">{t('se.hist.allMaterials')}</option>{materialOptions.map((name) => <option key={name} value={name}>{td(name)}</option>)}</select></label>
      <label className="grid gap-0.5 text-[10px] font-extrabold uppercase text-slate-500">{t('se.hist.from')}<input type="date" value={filters.from} max={filters.to || undefined} onChange={(event) => setFilter('from', event.target.value)} className={filterClass} /></label>
      <label className="grid gap-0.5 text-[10px] font-extrabold uppercase text-slate-500">{t('se.hist.to')}<input type="date" value={filters.to} min={filters.from || undefined} onChange={(event) => setFilter('to', event.target.value)} className={filterClass} /></label>
      <label className="col-span-2 grid gap-0.5 text-[10px] font-extrabold uppercase text-slate-500 md:col-span-1">{t('se.hist.period')}<select value={filters.recent} onChange={(event) => setFilter('recent', event.target.value)} className={filterClass}><option value="all">{t('se.hist.allTime')}</option><option value="7d">{t('se.hist.last7')}</option><option value="30d">{t('se.hist.last30')}</option>{(Object.keys(touched).length > 0 || filters.recent === 'session') && <option value="session">{t('se.hist.session')}</option>}</select></label>
    </div>}
    {filtered.length > 0 && <p className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-xs font-bold text-slate-600">
      <span>{t('se.hist.entries', { count: summary.entryCount })}</span>
      <span>{t('se.hist.materials', { count: summary.materialCount })}</span>
      {summary.quantity && <span>{t('se.hist.totalQty', { qty: formatQty(summary.quantity.amount), unit: unitLabel(summary.quantity.unit) })}</span>}
      {summary.totalCost > 0 && <span className="text-slate-900">{t('se.hist.totalCost', { amount: money(summary.totalCost, country) })}</span>}
      {summary.unpricedCount > 0 && <span className="font-semibold text-slate-400">{t('se.hist.unpriced', { count: summary.unpricedCount })}</span>}
    </p>}
    {!entries.length && <p className="mt-3 rounded-xl border border-dashed border-slate-200 px-4 py-8 text-center text-sm font-bold text-slate-500">{t('se.hist.empty')}</p>}
    {entries.length > 0 && !filtered.length && <div className="mt-3 rounded-xl border border-dashed border-slate-200 px-4 py-8 text-center"><p className="text-sm font-bold text-slate-500">{t('se.hist.emptyFiltered')}</p><button type="button" onClick={() => setFilters(EMPTY_HISTORY_FILTERS)} className="mt-2 text-xs font-extrabold text-brand-700 underline">{t('se.hist.reset')}</button></div>}
    {visible.length > 0 && <ol className="mt-3 divide-y divide-slate-100 rounded-xl border border-slate-200">
      {visible.map((entry) => {
        const change = touched[entry.key]?.change
        const showDate = entry.workDate !== previousDate
        previousDate = entry.workDate
        const recordedSameDay = entry.recordedAt && String(entry.recordedAt).slice(0, 10) === entry.workDate
        return <li key={entry.key} className={`px-3 py-2.5 sm:px-4 ${change ? 'bg-brand-50' : ''}`}>
          {showDate && <p className="mb-1 text-[10px] font-extrabold uppercase tracking-wide text-slate-500">{formatDate(entry.workDate, entry.workDate, { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' })}</p>}
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="flex flex-wrap items-center gap-2 font-extrabold text-slate-900">{td(entry.material)}{change && <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-extrabold text-emerald-800">{t(change === 'added' ? 'se.hist.added' : 'se.hist.updated')}</span>}</p>
              <p className="mt-0.5 truncate text-[11px] font-semibold text-slate-500">{[entry.workTitle ? td(entry.workTitle) : '', entry.recordedAt ? t('se.hist.recordedAt', { time: recordedSameDay ? formatDisplayTime(entry.recordedAt) : `${formatDate(entry.recordedAt, '')} ${formatDisplayTime(entry.recordedAt)}` }) : ''].filter(Boolean).join(' · ')}</p>
            </div>
            <div className="shrink-0 text-right">
              <p className="font-extrabold tabular-nums text-slate-900">{formatQty(entry.quantity)} <span className="text-xs text-slate-500">{unitLabel(entry.unit)}</span></p>
              <p className="text-[11px] font-semibold tabular-nums text-slate-500">{entry.rate != null ? <>{money(entry.rate, country)}/{unitLabel(entry.unit)} · <b className="text-slate-800">{money(entry.amount, country)}</b></> : t('se.hist.noRate')}</p>
            </div>
          </div>
        </li>
      })}
    </ol>}
    {filtered.length > visible.length && <button type="button" onClick={() => setLimit((current) => current + HISTORY_PAGE_SIZE)} className="mt-3 inline-flex h-9 w-full items-center justify-center rounded-lg border border-slate-200 text-xs font-extrabold text-slate-700 hover:bg-slate-50">{t('se.hist.showMore', { count: filtered.length - visible.length })}</button>}
    </div>}
  </section>
}

export default function SiteEngineerDashboard({ projectList = [], viewMode = 'calendar', photoOnly = false, onLiveCamera = null, showBackToCalendar = false }) {
  const { user } = useSelector((state) => state.auth)
  const { t, td } = useLanguage()
  const readOnly = user?.role !== 'ENGINEER'
  const historyOnly = viewMode === 'logs'
  const [projectId, setProjectId] = useState('')
  const [workDate, setWorkDate] = useState('')
  const [month, setMonth] = useState(() => new Date())
  const [daySummary, setDaySummary] = useState({ registers: [], workflow: {} })
  const [allSummary, setAllSummary] = useState({ registers: [], workflow: {} })
  const [timeline, setTimeline] = useState([])
  const [form, setForm] = useState(emptyForm)
  const [usedToday, setUsedToday] = useState({})
  const [photos, setPhotos] = useState([])
  const [videos, setVideos] = useState([])
  const [notice, setNotice] = useState(null)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState('')
  // '' when idle, else the action being saved ('IN_PROGRESS' or 'CLOSED').
  const [saving, setSaving] = useState('')
  const [fieldErrors, setFieldErrors] = useState({})
  // Which project + date the form currently holds. The form is only shown when
  // it matches the selection, so a slow load never shows the previous day's
  // values under the new date.
  const [loadedKey, setLoadedKey] = useState('')
  const [photoViewerIndex, setPhotoViewerIndex] = useState(null)
  const [locked, setLocked] = useState(null)
  const navigate = useNavigate()
  const [usageSearch, setUsageSearch] = useState('')
  const [usedOnly, setUsedOnly] = useState(false)
  // The optional BOQ block starts open when the loaded day has BOQ values, and
  // afterwards stays as the engineer left it (clearing a value does not fold it).
  const [boqOpen, setBoqOpen] = useState(false)
  const [historyFilters, setHistoryFilters] = useState(EMPTY_HISTORY_FILTERS)
  // History entries changed by a save on this screen: { [entryKey]: { change, at } }.
  const [touched, setTouched] = useState({})
  // The project's labour requests and equipment requests (existing supply
  // flows), and the attendance / usage logged against them by request id.
  const [supply, setSupply] = useState({ projectId: '', labour: [], equipment: [], error: '' })
  const [supplyLogs, setSupplyLogs] = useState({ labour: {}, equipment: {} })
  // Unsaved edits in the labour / rental cards, and a counter that resets them.
  const [resourceDirty, setResourceDirty] = useState({})
  const [resourceReset, setResourceReset] = useState(0)
  const dailyRecordRef = useRef(null)
  const historyRef = useRef(null)
  // Material History starts collapsed on the calendar. The open one is kept by
  // project id, so another project always starts collapsed.
  const [historyOpenFor, setHistoryOpenFor] = useState(null)
  const workTitleRef = useRef(null)
  const shouldFocusDailyRecord = useRef(false)
  const requestSeq = useRef(0)
  // What the server held when the day was loaded: the dirty check compares
  // against it and Discard restores it.
  const savedSnapshot = useRef({ form: emptyForm, usage: {} })
  const pendingTouch = useRef(null)
  const project = projectList.find((item) => String(item.id) === String(projectId))
  const register = daySummary.registers?.[0] || null
  const viewKey = `${projectId}|${workDate}`
  const dayReady = loadedKey === viewKey

  const notify = (text, tone = 'info') => setNotice(text ? { text, tone } : null)

  useEffect(() => { if (!projectId && projectList.length === 1) setProjectId(String(projectList[0].id)) }, [projectId, projectList])
  const refresh = useCallback(async () => {
    if (!projectId) return false
    const seq = requestSeq.current + 1
    requestSeq.current = seq
    const key = `${projectId}|${workDate}`
    setLoading(true)
    setLoadError('')
    setLocked(null)
    try {
      if (photoOnly) {
        const photoRecords = await fetchProjectPhotos(projectId)
        if (seq !== requestSeq.current) return false
        setDaySummary({ registers: [], workflow: {} })
        setAllSummary({ registers: [], workflow: {} })
        setTimeline(photoRecords || [])
        setForm(emptyForm)
        setUsedToday({})
        setPhotos([]); setVideos([]); setNotice(null)
        setLoadedKey(key)
        return true
      }
      const [day, all, entries] = await Promise.all([workDate ? fetchCostToolSummary(projectId, workDate) : Promise.resolve({ registers: [], workflow: {} }), fetchCostToolSummary(projectId), fetchProjectTimelineEntries(projectId)])
      // A newer selection started while this one was loading: drop these results.
      if (seq !== requestSeq.current) return false
      setDaySummary(day); setAllSummary(all); setTimeline(entries || [])
      const row = day.registers?.[0]
      const sameDayTimeline = workDate ? (entries || []).find((item) => String(item.date).slice(0, 10) === workDate && item.title !== 'Material Request') || (entries || []).find((item) => String(item.date).slice(0, 10) === workDate) : null
      const savedUsage = Object.fromEntries((day.materials || []).map((item) => [item.material, Number(item.used_today || 0)]))
      const usageCost = (day.materials || []).reduce((sum, item) => sum + (Number(item.used_today || 0) || 0) * (Number(item.rate || 0) || 0), 0)
      // A saved material cost equal to the usage total was the calculated
      // figure, so it is left blank and keeps following the quantities. Only a
      // different amount is kept as a typed override.
      const savedMaterialCost = Number(row?.material_cost || 0)
      const nextForm = row ? { work_title: row.work_type || '', activity_category: row.activity_category || '', boq_reference: row.boq_reference || '', activity_unit: row.activity_unit || '', planned_quantity: row.planned_quantity ?? '', completed_quantity: row.completed_quantity ?? '', detailed_remarks: row.progress_note || '', labour_worker_count: Number(row.labour_worker_count || day.dashboard?.total_workers || 0), labour_cost: Number(row.labour_cost || day.dashboard?.labour_cost || 0), material_cost: isMaterialCostOverride(savedMaterialCost, usageCost) ? savedMaterialCost : '', equipment_cost: Number(row.equipment_cost || day.dashboard?.machinery_cost || 0), total_expenses: Number(row.total_expenses || day.dashboard?.expenses || 0), material_used: row.material_used || (day.material_usages || []).filter((item) => Number(item.quantity_used) > 0).map((item) => `${item.material} ${item.quantity_used} ${item.unit}`).join(', '), equipment_used: row.equipment_used || (day.machinery_usages || []).map((item) => `${item.machine} ${item.hours} hours`).join(', '), inspection_remarks: row.inspection_remarks || sameDayTimeline?.description || '' } : emptyForm
      setForm(nextForm)
      setUsedToday(savedUsage)
      savedSnapshot.current = { form: nextForm, usage: savedUsage }
      setPhotos([]); setVideos([]); setNotice(null); setFieldErrors({})
      setBoqOpen(Boolean(nextForm.activity_category || nextForm.boq_reference || nextForm.activity_unit || String(nextForm.planned_quantity ?? '') !== '' || String(nextForm.completed_quantity ?? '') !== ''))
      setLoadedKey(key)
      return true
    } catch (error) {
      if (seq !== requestSeq.current) return false
      // A builder whose plan has lapsed sees the locked notice; a paused owner view says so.
      const reason = user?.role === 'BUILDER' ? lockedReason(error) : null
      if (reason) setLocked(reason)
      else if (builderAccessPaused(error)) setLoadError(t('subscription.ownerPaused'))
      else setLoadError(apiErrorMessage(error, t('se.errLoad')))
      return false
    } finally {
      if (seq === requestSeq.current) setLoading(false)
    }
  }, [projectId, workDate, photoOnly])
  useEffect(() => { refresh() }, [refresh])
  // Brings the opened day into view where it sits below the calendar (phones,
  // tablets, the owner's photo view). On desktop the day already sits beside
  // the small calendar, so the page is left where it is.
  const scrollToDay = () => {
    const besideCalendar = !photoOnly && !historyOnly && window.matchMedia('(min-width: 1024px)').matches
    if (!besideCalendar) dailyRecordRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
  useEffect(() => {
    if (!workDate || !shouldFocusDailyRecord.current || !dayReady) return
    shouldFocusDailyRecord.current = false
    const frame = window.requestAnimationFrame(() => {
      scrollToDay()
      window.setTimeout(() => workTitleRef.current?.focus({ preventScroll: true }), 350)
    })
    return () => window.cancelAnimationFrame(frame)
  }, [workDate, dayReady])
  // History filters belong to one project.
  useEffect(() => { setHistoryFilters(EMPTY_HISTORY_FILTERS); setTouched({}) }, [projectId])

  const workflow = allSummary.workflow || daySummary.workflow || {}
  const beforeCutoff = workDate === workflow.local_date && String(workflow.local_time || '99:99') < String(workflow.cutoff || '24:00')
  const editable = !historyOnly && !readOnly && beforeCutoff && !['COMPLETED', 'CLOSED'].includes(register?.status)
  const recordsByDate = useMemo(() => Object.fromEntries((allSummary.registers || []).map((item) => [item.work_date, item])), [allSummary.registers])
  const photosByDate = useMemo(() => {
    const grouped = {}
    // Photos only. Videos are attachments too, but counting them here made a
    // video-only day read as "Text + Photo + Video"; they are counted in
    // videosByDate below.
    if (photoOnly) {
      ;(timeline || []).forEach((photo) => {
        const key = String(photo.work_date || '').slice(0, 10)
        if (!key || photo.media_type === 'video') return
        ;(grouped[key] = grouped[key] || []).push(photo)
      })
      return grouped
    }
    ;(timeline || []).forEach((entry) => {
      const key = String(entry.date || '').slice(0, 10)
      const images = (entry.images || []).filter((item) => item.media_type !== 'video')
      if (!key || images.length === 0) return
      grouped[key] = (grouped[key] || []).concat(images)
    })
    return grouped
  }, [timeline, photoOnly])
  const videosByDate = useMemo(() => {
    const grouped = {}
    ;(timeline || []).forEach((entry) => {
      const key = photoOnly ? String(entry.work_date || '').slice(0, 10) : String(entry.date || '').slice(0, 10)
      const mediaItems = photoOnly ? [entry] : (entry.images || [])
      const videoCount = mediaItems.filter((item) => item.media_type === 'video').length
      if (!key || videoCount === 0) return
      grouped[key] = (grouped[key] || 0) + videoCount
    })
    return grouped
  }, [timeline, photoOnly])
  const materials = useMemo(() => {
    const source = (daySummary.materials && daySummary.materials.length ? daySummary.materials : allSummary.materials) || []
    return source.map((item) => {
      const available = Number(item.available ?? item.remaining ?? 0) || 0
      const used = Number(usedToday[item.material] ?? item.used_today ?? 0) || 0
      return { ...item, available, usedToday: used, remaining: available - used }
    })
  }, [daySummary, allSummary, usedToday])
  // Every recorded use of every material on this project (not just this day).
  const historyEntries = useMemo(() => buildMaterialHistory(allSummary.materials || [], allSummary.registers || []), [allSummary.materials, allSummary.registers])
  // After a save, the materials it added or changed are marked so they rise to
  // the top of the history with an "Added / Updated just now" badge.
  useEffect(() => {
    const pending = pendingTouch.current
    if (!pending) return
    pendingTouch.current = null
    const marks = {}
    historyEntries.forEach((entry) => {
      const change = pending.changes[entry.material]
      if (!change || entry.workDate !== pending.workDate) return
      if (pending.registerId != null && entry.registerId != null && entry.registerId !== pending.registerId) return
      marks[entry.key] = { change, at: pending.at }
    })
    if (Object.keys(marks).length) setTouched((current) => ({ ...current, ...marks }))
  }, [historyEntries])
  const calendarCells = useMemo(() => { const result = []; const year = month.getFullYear(); const value = month.getMonth(); for (let blank = 0; blank < new Date(year, value, 1).getDay(); blank += 1) result.push(null); for (let day = 1; day <= new Date(year, value + 1, 0).getDate(); day += 1) result.push(new Date(year, value, day)); return result }, [month])
  // Day N is the date's working day in the project (from its start date,
  // Sundays excluded), the same for every role. Counting only record or media
  // days gave the owner and the builder different numbers for the same date.
  // Without a start date, a record day's place among the record days.
  const recordDates = [...new Set((allSummary.registers || []).map((item) => item.work_date))].sort()
  const dayNumber = project?.start_date
    ? workingDayNumber(project.start_date, workDate)
    : recordDates.includes(workDate) ? recordDates.indexOf(workDate) + 1 : null
  const uploadedMedia = useMemo(() => photoOnly
    ? (timeline || []).filter((item) => String(item.work_date || '').slice(0, 10) === workDate)
    : (timeline || []).filter((item) => String(item.date).slice(0, 10) === workDate).flatMap((item) => item.images || []), [timeline, workDate, photoOnly])
  // Photos keep their existing list and behaviour; videos are simply the
  // attachments the server reports as video, so old rows stay photos.
  const uploadedImages = useMemo(() => uploadedMedia.filter((item) => item.media_type !== 'video'), [uploadedMedia])
  const uploadedVideos = useMemo(() => uploadedMedia.filter((item) => item.media_type === 'video'), [uploadedMedia])
  const selectedPreviews = useMemo(() => photos.map((photo) => URL.createObjectURL(photo)), [photos])
  useEffect(() => () => selectedPreviews.forEach((url) => URL.revokeObjectURL(url)), [selectedPreviews])
  const todayKey = workflow.local_date || localDateKey(new Date())
  const displayedStatus = photoOnly
    ? uploadedImages.length > 0 && uploadedVideos.length > 0 ? 'PhotosVideos' : uploadedImages.length > 0 ? 'Photos' : uploadedVideos.length > 0 ? 'Videos' : workDate === todayKey ? 'OPEN' : 'CLOSED'
    : register?.status || (workDate === workflow.local_date ? 'OPEN' : 'CLOSED')
  // Suggestions only — the field stays free text. Divisions and units already
  // recorded on this project come first, so the list reflects real project data
  // rather than a fixed catalogue.
  const activityCategoryOptions = useMemo(() => {
    const used = (allSummary.registers || []).map((item) => item.activity_category).filter(Boolean)
    return [...new Set([...used, ...BASE_ACTIVITY_CATEGORIES])]
  }, [allSummary.registers])
  const activityUnitOptions = useMemo(() => {
    const used = [
      ...(allSummary.registers || []).map((item) => item.activity_unit),
      ...(allSummary.inventory || []).map((item) => item.unit),
    ].filter(Boolean)
    return [...new Set([...used, ...BASE_ACTIVITY_UNITS])]
  }, [allSummary.registers, allSummary.inventory])

  // Remaining and progress follow the recorded quantities. The server supplies
  // the cumulative figure for the BOQ reference; today's typed value replaces
  // today's saved value so the reading updates while the engineer types.
  const activitySummary = useMemo(() => {
    const planned = Number(form.planned_quantity)
    const completedToday = Number(form.completed_quantity)
    const saved = register?.boq_activity
    const savedToDate = Number(saved?.completed_to_date ?? 0) || 0
    const savedToday = Number(saved?.completed_today ?? 0) || 0
    const reference = (form.boq_reference || '').trim()
    const priorDays = reference && saved?.boq_reference === reference ? Math.max(0, savedToDate - savedToday) : 0
    const completedToDate = priorDays + (Number.isFinite(completedToday) ? completedToday : 0)
    if (!Number.isFinite(planned) || planned <= 0) {
      return { planned: null, completedToDate, remaining: null, percent: null }
    }
    return {
      planned,
      completedToDate,
      remaining: Math.max(0, planned - completedToDate),
      percent: Math.min(100, Math.round((completedToDate / planned) * 100)),
    }
  }, [form.planned_quantity, form.completed_quantity, form.boq_reference, register])

  const usage = todayUsageSummary(materials, usedToday)
  const materialCostFromUsage = usage.cost
  const materialCostOverridden = form.material_cost !== '' && form.material_cost != null
  const materialCost = Number(form.material_cost || 0) > 0 ? Number(form.material_cost || 0) : materialCostFromUsage
  const resourceIsDirty = Object.values(resourceDirty).some(Boolean)
  const dirty = resourceIsDirty || editable && dayReady && (snapshotOf(form, usedToday) !== snapshotOf(savedSnapshot.current.form, savedSnapshot.current.usage) || photos.length > 0 || videos.length > 0)
  const country = project?.project_country
  // Labour and equipment for the selected date. Loaded for the engineer and the
  // builder (both may read them); never for the owner's photo-only view.
  useEffect(() => {
    if (!projectId || photoOnly) { setSupply({ projectId: '', labour: [], equipment: [], error: '' }); return undefined }
    let current = true
    setSupplyLogs({ labour: {}, equipment: {} })
    setResourceDirty({})
    Promise.allSettled([fetchProjectLaborRequests(projectId), fetchProjectEquipmentRequests(projectId)]).then(([labour, equipment]) => {
      if (!current) return
      setSupply({
        projectId,
        labour: labour.status === 'fulfilled' ? labour.value || [] : [],
        equipment: equipment.status === 'fulfilled' ? equipment.value || [] : [],
        error: labour.status === 'rejected' || equipment.status === 'rejected' ? t('se.res.loadError') : '',
      })
    })
    return () => { current = false }
  }, [projectId, photoOnly])
  const supplyReady = supply.projectId === projectId
  const dayLabour = useMemo(() => (workDate ? labourRequestsForDate(supply.labour, workDate) : []), [supply.labour, workDate])
  const dayRentals = useMemo(() => (workDate ? rentalsForDate(supply.equipment, workDate) : []), [supply.equipment, workDate])
  const purchases = useMemo(() => agreedPurchases(supply.equipment), [supply.equipment])
  const loadLabourLogs = useCallback(async (id) => {
    const records = await fetchLaborDailyRecords(id)
    setSupplyLogs((current) => ({ ...current, labour: { ...current.labour, [id]: records || [] } }))
  }, [])
  const loadRentalLogs = useCallback(async (id) => {
    const logs = await fetchEquipmentUsage(id)
    setSupplyLogs((current) => ({ ...current, equipment: { ...current.equipment, [id]: logs || [] } }))
  }, [])
  // Logs are fetched once per request, when a date first shows it.
  useEffect(() => {
    const failed = () => setSupply((current) => ({ ...current, error: t('se.res.loadError') }))
    dayLabour.filter((request) => !supplyLogs.labour[request.id]).forEach((request) => loadLabourLogs(request.id).catch(failed))
    dayRentals.filter((rental) => !supplyLogs.equipment[rental.id]).forEach((rental) => loadRentalLogs(rental.id).catch(failed))
  }, [dayLabour, dayRentals])
  const markResourceDirty = useCallback((key, value) => setResourceDirty((current) => (Boolean(current[key]) === value ? current : { ...current, [key]: value })), [])
  // Attendance and rental hours may be recorded for any date inside their
  // request period by the request's own engineer; the backend checks the same.
  const canRecord = (request) => !historyOnly && canRecordOnDate(request, { userId: user?.id, role: user?.role, date: workDate, todayKey })
  const rentalCharges = dayRentals.map((rental) => {
    const log = recordForDate(supplyLogs.equipment[rental.id] || [], workDate, 'usage_date')
    return rentalChargeForDate(rental, workDate, log ? log.hours_used : null)
  })
  const costSummary = dailyCostSummary({ materialCost, labourCost: Number(form.labour_cost || 0), otherEquipmentCost: Number(form.equipment_cost || 0), otherExpenses: Number(form.total_expenses || 0), rentalCharges })
  const crew = dayLabour.reduce((totals, request) => {
    const record = recordForDate(supplyLogs.labour[request.id] || [], workDate)
    return { present: totals.present + (record ? Number(record.present_count || 0) + Number(record.half_day_count || 0) : 0), allocated: totals.allocated + Number(request.workers_allocated || 0) }
  }, { present: 0, allocated: 0 })
  const receivedOrders = daySummary.received_orders || []
  const receivedValue = receivedOrders.reduce((total, order) => total + (Number(order.amount) || 0), 0)
  const paidOutToday = (daySummary.payments || []).filter((payment) => String(payment.direction).toUpperCase() === 'OUT').reduce((total, payment) => total + (Number(payment.amount) || 0), 0)
  const recordableResources = [...dayLabour, ...dayRentals].some(canRecord)
  // Desktop: compact calendar on the left, the selected day on the right.
  const workspace = Boolean(workDate) && !photoOnly && !historyOnly
  // The small calendar sticks exactly where it sits on the page, so it does not
  // travel up before it stops when the day is scrolled. If that place would
  // push its foot off the screen, it sticks just high enough to stay in view.
  const workspaceRef = useRef(null)
  const calendarStickRef = useRef(null)
  const [calendarTop, setCalendarTop] = useState(null)
  useLayoutEffect(() => {
    if (!workspace) { setCalendarTop(null); return undefined }
    const measure = () => {
      const grid = workspaceRef.current
      const calendar = calendarStickRef.current
      if (!grid || !calendar) return
      const naturalTop = grid.getBoundingClientRect().top + window.scrollY
      const fitTop = window.innerHeight - calendar.offsetHeight - 8
      // Never above the sticky top bar (56px) and, when present, the green
      // navigation strip that stays with it (53px), plus a 16px gap.
      const floor = document.querySelector('.dash-nav-strip') ? 125 : 72
      setCalendarTop(Math.round(Math.max(floor, Math.min(naturalTop, fitTop))))
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [workspace])

  // Leaving the page with unsaved edits asks first.
  useEffect(() => {
    if (!dirty) return undefined
    const warn = (event) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])
  const confirmLeave = () => !dirty || window.confirm(t('se.form.confirmDiscard'))

  // What a unit READS as. The stored unit is untouched everywhere it is posted
  // or used as a lookup key; this is only for the screen.
  const unitLabel = (unit) => {
    const value = String(unit || '')
    if (!value) return ''
    if (ACTIVITY_UNIT_KEYS[value]) return t(ACTIVITY_UNIT_KEYS[value])
    return UNIT_SYMBOLS.has(value.toLowerCase()) ? value : td(value)
  }
  const update = (key, value) => {
    setForm((current) => ({ ...current, [key]: value }))
    if (fieldErrors[key]) setFieldErrors((current) => ({ ...current, [key]: '' }))
  }
  const updateUsage = (material, value) => {
    setUsedToday((current) => ({ ...current, [material]: value }))
    if (fieldErrors.materials?.[material]) setFieldErrors((current) => ({ ...current, materials: { ...current.materials, [material]: '' } }))
  }
  const selectCalendarDate = (dateKey) => {
    if (dateKey !== workDate && !confirmLeave()) return
    shouldFocusDailyRecord.current = true
    setWorkDate(dateKey)
    if (dateKey === workDate) {
      window.requestAnimationFrame(() => {
        scrollToDay()
        window.setTimeout(() => workTitleRef.current?.focus({ preventScroll: true }), 350)
      })
    }
  }
  // Back from the day workspace to the full calendar: keeps the month shown
  // and returns focus to the day that was open.
  const backToCalendar = () => {
    if (!confirmLeave()) return
    const previous = workDate
    setWorkDate('')
    window.requestAnimationFrame(() => document.querySelector(`[data-date="${previous}"]`)?.focus())
  }
  const selectProject = (value) => {
    if (!confirmLeave()) return
    setProjectId(value)
    setWorkDate('')
  }
  const reload = () => { if (confirmLeave()) refresh() }
  const discardChanges = () => {
    const saved = savedSnapshot.current
    setForm(saved.form); setUsedToday(saved.usage)
    setPhotos([]); setVideos([]); setFieldErrors({}); setNotice(null)
    setResourceReset((count) => count + 1)
  }
  const showHistoryFor = (material) => {
    setHistoryFilters({ ...EMPTY_HISTORY_FILTERS, material })
    setHistoryOpenFor(projectId)
    window.requestAnimationFrame(() => historyRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }
  // Arrow keys move between days in the calendar grid.
  const moveCalendarFocus = (event) => {
    const steps = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }
    const step = steps[event.key]
    const from = event.target?.dataset?.date
    if (!step || !from) return
    const [y, m, d] = from.split('-').map(Number)
    const target = event.currentTarget.querySelector(`[data-date="${localDateKey(new Date(y, m - 1, d + step))}"]`)
    if (target) { event.preventDefault(); target.focus() }
  }
  const validate = () => {
    const errors = {}
    if (!String(form.work_title || '').trim()) errors.work_title = t('se.form.errWorkTitle')
    const materialErrors = {}
    for (const item of materials) {
      const used = Number(usedToday[item.material] ?? 0) || 0
      if (used > item.available) materialErrors[item.material] = t('se.errOnlyAvailable', { qty: formatQty(item.available), unit: unitLabel(item.unit), material: td(item.material) })
      else if (used < 0) materialErrors[item.material] = t('se.errNegative', { material: td(item.material) })
    }
    if (Object.keys(materialErrors).length) errors.materials = materialErrors
    return errors
  }
  const save = async (action) => {
    if (!editable || saving) return
    const errors = validate()
    if (Object.keys(errors).length) {
      setFieldErrors(errors)
      notify(errors.work_title || t('se.form.errFix'), 'error')
      if (errors.work_title) workTitleRef.current?.focus()
      else if (errors.materials) { setUsageSearch(''); setUsedOnly(false) }
      return
    }
    if (action === 'CLOSED' && !window.confirm(t('se.form.confirmCloseDay'))) return
    const payload = new FormData()
    payload.set('work_date', workDate); payload.set('action', action)
    Object.entries(form).forEach(([key, value]) => payload.set(key, numericFields.has(key) ? String(Number(value) || 0) : String(value ?? '')))
    payload.set('material_cost', String(materialCost))
    payload.set('material_usage', JSON.stringify(materials.map((item) => ({ product_id: item.product_id ?? null, material_name: item.material, unit: item.unit || '', quantity_used: Number(usedToday[item.material] ?? 0) || 0 }))))
    photos.forEach((photo) => payload.append('images', photo))
    videos.forEach((video) => payload.append('videos', video))
    const submittedUsage = Object.fromEntries(materials.map((item) => [item.material, Number(usedToday[item.material] ?? 0) || 0]))
    const changes = usageChanges(savedSnapshot.current.usage, submittedUsage)
    setSaving(action)
    setNotice(null)
    try {
      await saveDailyWorkflow(projectId, payload)
      // Overall project progress is calculated by the server; saving a day
      // never sends a percentage.
      pendingTouch.current = Object.keys(changes).length ? { changes, workDate, registerId: register?.id ?? null, at: Date.now() } : null
      await refresh()
      notify(action === 'CLOSED' ? t('se.dayClosed') : t('se.progressSaved'), 'success')
    }
    catch (error) { notify(apiErrorMessage(error, t('se.errSave')), 'error') } finally { setSaving('') }
  }
  const deletePhoto = async (photo) => {
    if (!editable) return
    if (!window.confirm(t('se.confirmDeletePhoto'))) return
    setSaving('MEDIA')
    try {
      await deleteProjectPhoto(photo.id)
      // Deleting reloads the day; edits typed so far are kept by restoring them.
      const keep = { form, usedToday, photos, videos }
      await refresh()
      setForm(keep.form); setUsedToday(keep.usedToday); setPhotos(keep.photos); setVideos(keep.videos)
      notify(t('se.photoDeleted'), 'success')
    } catch (error) { notify(apiErrorMessage(error, t('se.errDeletePhoto')), 'error') } finally { setSaving('') }
  }

  const usageRows = materials.filter((item) => {
    const used = Number(usedToday[item.material] ?? 0) || 0
    if ((usedOnly || !editable) && used <= 0 && !fieldErrors.materials?.[item.material]) return false
    const search = usageSearch.trim().toLowerCase()
    return !search || item.material.toLowerCase().includes(search) || String(td(item.material)).toLowerCase().includes(search)
  })
  const legend = [
    { key: 'text', label: t('se.cal.text'), tone: CELL_TONES.text },
    { key: 'photo', label: t('se.cal.photo'), tone: CELL_TONES.photo },
    { key: 'video', label: t('se.cal.video'), tone: CELL_TONES.video },
    { key: 'all', label: t('se.cal.textMedia'), tone: CELL_TONES.all },
    { key: 'open', label: t('ui.status.open'), tone: CELL_TONES.open },
  ]

  return <div className="space-y-4 bg-[#FEF9F3]">
    {/* The project picker shows only when there is more than one project to
        pick; with a single project the effect above selects it automatically. */}
    {projectList.length > 1 && (
      <div className="flex flex-wrap items-center justify-end gap-2">
        <label className="sr-only" htmlFor="se-project-picker">{t('se.selectProject')}</label>
        <select id="se-project-picker" value={projectId} onChange={(event) => selectProject(event.target.value)} className="h-10 rounded-lg border px-3 text-sm font-bold">
          <option value="">{t('se.selectProject')}</option>
          {projectList.map((item) => <option key={item.id} value={item.id}>{td(item.title)}</option>)}
        </select>
        <button type="button" onClick={reload} disabled={!projectId || loading} aria-label={t('se.form.reload')} title={t('se.form.reload')} className="grid h-10 w-10 place-items-center rounded-lg border"><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /></button>
      </div>
    )}
    {locked && <LockedFeature reason={locked} onViewPlans={() => navigate('/contractor/subscription')} />}
    {!workDate && <Notice notice={notice} />}
    {loadError && !workDate && <Notice notice={{ text: loadError, tone: 'error' }}><button type="button" onClick={refresh} className="rounded-lg border border-rose-300 bg-white px-3 py-1 text-xs font-extrabold">{t('se.form.retry')}</button></Notice>}
    {projectId && !locked && <div ref={workspaceRef} className={workspace ? 'se-day-workspace grid gap-4 lg:grid-cols-[216px_minmax(0,1fr)] lg:items-start lg:gap-3' : 'space-y-4'}>
      {!historyOnly && <div ref={calendarStickRef} className={workspace ? 'se-day-calendar lg:sticky lg:top-[72px] lg:z-10' : ''} style={workspace && calendarTop !== null ? { top: calendarTop } : undefined}><section className={`rounded-3xl border border-slate-200 bg-white ${workspace ? 'p-3 lg:rounded-2xl lg:p-2' : 'p-4'} shadow-sm`} aria-label={t('se.siteCalendar')}>
        <div className={`flex flex-wrap items-center justify-between gap-2 ${workspace ? 'mb-2 lg:mb-1 lg:gap-x-1 lg:gap-y-0.5' : 'mb-3'}`}>
          <h2 className={`flex items-center gap-2 font-extrabold text-slate-900 ${workspace ? 'text-sm lg:!text-xs' : 'text-base sm:text-lg'}`}><CalendarDays className={`h-4 w-4 text-[#03572E] sm:h-5 sm:w-5 ${workspace ? 'lg:hidden' : ''}`} />{`${t(`se.month.${month.getMonth()}`)} ${month.getFullYear()}`}</h2>
          <div className={`flex gap-2 ${workspace ? 'lg:gap-0.5 lg:[&>button]:h-6 lg:[&>button]:rounded-md' : ''}`}>
            <button type="button" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} aria-label={t('se.cal.prevMonth')} title={t('se.cal.prevMonth')} className={`grid h-8 w-8 place-items-center rounded-lg border border-slate-200 bg-white shadow-sm hover:bg-slate-50 ${workspace ? 'lg:w-6' : ''}`}><ChevronLeft className="h-4 w-4" /></button>
            <button type="button" onClick={() => { const [y, m] = todayKey.split('-').map(Number); setMonth(new Date(y, m - 1, 1)) }} className={`h-8 rounded-lg border border-slate-200 bg-white px-3 text-xs font-extrabold shadow-sm hover:bg-slate-50 ${workspace ? 'lg:px-1.5 lg:text-[10px]' : ''}`}>{t('se.cal.today')}</button>
            <button type="button" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} aria-label={t('se.cal.nextMonth')} title={t('se.cal.nextMonth')} className={`grid h-8 w-8 place-items-center rounded-lg border border-slate-200 bg-white shadow-sm hover:bg-slate-50 ${workspace ? 'lg:w-6' : ''}`}><ChevronRight className="h-4 w-4" /></button>
          </div>
        </div>
        <div className={`grid grid-cols-7 gap-1 text-center text-[10px] font-extrabold uppercase text-slate-800 ${workspace ? 'lg:gap-0.5 lg:rounded-md lg:bg-[#03572E1F] lg:py-0.5' : ''}`} aria-hidden="true">{['sun','mon','tue','wed','thu','fri','sat'].map((day) => <span key={day} title={t(`se.weekday.${day}`)} className={`rounded-md bg-[#03572E1F] py-1 ${workspace ? 'lg:bg-transparent lg:py-0' : ''}`}>{workspace ? <><span className="lg:hidden">{t(`se.weekday.${day}`)}</span><span className="hidden lg:inline">{weekdayInitial(t(`se.weekday.${day}`))}</span></> : t(`se.weekday.${day}`)}</span>)}</div>
        {/* Every date cell has one fixed size (h-16 / sm:h-[4.5rem], or lg:h-7
            in the small calendar), whatever it holds; a long label is cut to
            one line and stays readable from the cell's tooltip. */}
        <div className={`mt-2 grid auto-rows-fr grid-cols-7 gap-1 ${workspace ? 'lg:mt-0.5 lg:gap-0.5' : ''}`} onKeyDown={moveCalendarFocus}>{calendarCells.map((date, index) => {
          if (!date) return <span key={`blank-${index}`} />
          const key = localDateKey(date); const row = recordsByDate[key]; const photoCount = (photosByDate[key] || []).length; const videoCount = videosByDate[key] || 0; const hasPhotos = photoCount > 0; const hasVideo = videoCount > 0; const current = key === todayKey; const future = key > todayKey; const closed = key < todayKey || ['CLOSED','COMPLETED'].includes(row?.status); const hasText = hasEnteredText(row); const hasMedia = hasPhotos || hasVideo
          // Sunday is a site holiday: always closed, never selectable.
          const isSunday = date.getDay() === 0
          // The owner's view is media only and loads no daily records, so a
          // day without media is simply empty there -- not "Closed".
          const isClosed = isSunday || (!photoOnly && closed && !hasText && !hasMedia)
          // Text, photos and videos are each counted on their own (photo
          // counts never include videos), and the label names exactly those
          // present. The owner's media view has no record text (hasText is
          // false there), so it never claims Text.
          const contentKey = CONTENT_LABEL_KEYS[`${hasText ? 1 : 0}${hasPhotos ? 1 : 0}${hasVideo ? 1 : 0}`]
          const isOpen = current && !isSunday && !hasText && !hasMedia
          const tone = isOpen ? CELL_TONES.open : hasText && hasPhotos && hasVideo ? CELL_TONES.all : hasVideo ? CELL_TONES.video : hasPhotos ? CELL_TONES.photo : hasText ? CELL_TONES.text : null
          const activityText = isOpen ? statusLabel('OPEN', t) : contentKey ? t(contentKey) : ''
          // Corner badge: the same content the label names, as an icon.
          const badge = isSunday ? [Lock] : isOpen ? [DoorOpen] : hasPhotos && hasVideo ? [ImageIcon, CirclePlay] : hasVideo ? [CirclePlay] : hasPhotos ? [ImageIcon] : hasText ? [FileText] : []
          const badgeColor = tone ? tone[1] : '#94a3b8'
          // A past day with neither a record nor media has nothing to open.
          // A past day with nothing to open -- unless a labour request or rental
          // covers it, when attendance or hours can still be recorded or read.
          const empty = key < todayKey && !row && !hasMedia && !hasResourceOnDate(supply.labour, supply.equipment, key)
          const selected = key === workDate
          const stateText = isSunday ? t('se.cal.holiday') : activityText || (isClosed ? statusLabel('CLOSED', t) : t('se.cal.noEntry'))
          return <button key={key} type="button" data-date={key} disabled={future || isSunday || empty} onClick={() => selectCalendarDate(key)} aria-pressed={selected} aria-current={current ? 'date' : undefined} aria-label={`${formatDate(key, key, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}, ${stateText}${current ? `, ${t('se.cal.today')}` : ''}`} title={stateText} className={`flex h-16 flex-col overflow-hidden rounded-lg border p-1 text-left shadow-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 sm:h-[4.5rem] sm:rounded-xl sm:p-1.5 ${workspace ? 'lg:h-7 lg:items-center lg:justify-center lg:gap-0 lg:rounded-md lg:p-0' : ''} ${selected ? 'border-brand-600 ring-2 ring-brand-500' : 'border-slate-200'} bg-white ${future || isSunday ? 'cursor-not-allowed opacity-45' : empty ? 'cursor-default' : 'hover:border-brand-400 hover:shadow-md'}`}>
            <span className={`flex items-start justify-between gap-1 ${workspace ? 'lg:w-full lg:justify-center' : ''}`}><b className={`grid h-6 w-6 place-items-center rounded-full text-[13px] leading-none ${workspace ? 'lg:h-4 lg:w-4 lg:text-[11px]' : ''} ${current ? 'bg-[#03572E] text-white' : 'text-slate-800'}`}>{date.getDate()}</b>{badge.length > 0 && <span aria-hidden="true" className={`hidden h-6 shrink-0 items-center justify-center gap-0.5 rounded-full px-1.5 lg:flex ${workspace ? 'lg:hidden' : ''}`} style={{ backgroundColor: `${badgeColor}26`, color: badgeColor, minWidth: '1.5rem' }}>{badge.map((Icon, at) => <Icon key={at} className="h-3.5 w-3.5" />)}</span>}</span>
            {tone && <span className={`mt-1 flex min-w-0 items-center gap-1 ${workspace ? 'lg:mt-0 lg:justify-center' : ''}`}><span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${workspace ? 'lg:h-1.5 lg:w-1.5' : ''}`} style={{ backgroundColor: tone[1] }} /><span className={`hidden min-w-0 truncate text-[10px] font-extrabold leading-tight sm:block ${workspace ? 'lg:hidden' : ''}`} style={{ color: tone[1] }}>{activityText}</span></span>}
            {isClosed && !tone && <span className={`mt-1 hidden text-[10px] font-extrabold text-slate-400 sm:inline ${workspace ? 'lg:hidden' : ''}`}>{statusLabel('CLOSED', t)}</span>}
          </button>
        })}</div>
        <div className={`flex w-fit max-w-full flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border ${workspace ? 'mt-2 lg:mt-1 lg:w-full lg:gap-x-2 lg:gap-y-0.5 lg:rounded-md lg:p-1 lg:text-[10px] lg:[&>span]:gap-1' : 'mt-3'} border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-500 shadow-sm`}>
          {legend.map((item) => <span key={item.key} className="inline-flex items-center gap-1.5"><span aria-hidden="true" className={`grid h-4 w-4 place-items-center rounded-sm ${workspace ? 'lg:h-3 lg:w-3 lg:rounded-full' : ''}`} style={{ backgroundColor: tint(item.tone) }}><span className={`h-2.5 w-2.5 rounded-full ${workspace ? 'lg:h-2 lg:w-2' : ''}`} style={{ backgroundColor: item.tone[1] }} /></span><span className={workspace ? 'lg:!text-slate-700' : ''} style={{ color: item.tone[1] }}>{item.label}</span></span>)}
          <span className={`inline-flex items-center gap-1.5 ${workspace ? 'lg:text-slate-700' : ''}`}><span aria-hidden="true" className={`h-4 w-4 rounded-sm border border-slate-200 bg-white ${workspace ? 'lg:h-3 lg:w-3 lg:rounded-full lg:border-slate-300' : ''}`} />{t('se.cal.closed')}</span>
        </div>
      </section></div>}
      <div className="min-w-0 space-y-4">
      {historyOnly && <section className="rounded-2xl border border-slate-200 bg-white p-4"><h2 className="flex items-center gap-2 font-extrabold"><CalendarDays className="h-4 w-4 text-brand-700" />{t('se.savedDailyRecords')}</h2>{(allSummary.registers || []).length ? <div className="mt-3 divide-y divide-slate-100 rounded-xl border border-slate-200">{[...(allSummary.registers || [])].sort((first, second) => String(second.work_date).localeCompare(String(first.work_date))).map((row) => <button key={row.id || row.work_date} type="button" onClick={() => selectCalendarDate(row.work_date)} aria-pressed={workDate === row.work_date} className={`flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition hover:bg-brand-50 ${workDate === row.work_date ? 'bg-brand-50' : 'bg-white'}`}><div><p className="font-extrabold text-slate-950">{td(row.work_type) || t('se.dailySiteRecord')}</p><p className="mt-0.5 text-xs font-semibold text-slate-500">{formatDate(row.work_date, row.work_date)}{row.last_updated_at ? ` · ${t('se.lastUpdated')}: ${formatDisplayTime(row.last_updated_at)}` : ''}{row.created_by_name ? ` · ${td(row.created_by_name)}` : ''} · {t('se.workers', { count: row.labour_worker_count || 0 })}</p></div><span className={`rounded-full px-3 py-1 text-xs font-extrabold ${['CLOSED','COMPLETED'].includes(row.status) ? 'bg-blue-100 text-blue-800' : 'bg-brand-100 text-brand-800'}`}>{statusLabel(row.status, t)}</span></button>)}</div> : <p className="mt-3 rounded-xl border border-dashed border-slate-200 px-4 py-8 text-center text-sm font-bold text-slate-500">{t('se.noDailyLogs')}</p>}</section>}
      {!workDate && !historyOnly && <p className="rounded-xl border border-dashed border-brand-200 bg-white px-4 py-8 text-center text-sm font-bold text-slate-500">{photoOnly ? t('se.selectBlueDate') : t('se.clickAvailableDate')}</p>}
      {workDate && <>
      <section ref={dailyRecordRef} aria-busy={loading || undefined} className={`scroll-mt-4 w-full ${workspace ? '' : 'mx-auto max-w-4xl'} rounded-2xl border border-slate-200 bg-white shadow-sm`}>
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-4 sm:px-5">
          <div className="min-w-0">
            {/* With Back to Calendar, the project name shares its row and the
                date reads underneath; otherwise the date comes first as before. */}
            {showBackToCalendar && workspace ? (
              <>
                <div className="flex min-w-0 items-center gap-3">
                  <button type="button" onClick={backToCalendar} className="inline-flex h-8 shrink-0 items-center gap-1 rounded-lg border border-slate-200 px-2.5 text-xs font-extrabold text-[#03572E] hover:bg-slate-50"><ChevronLeft className="h-4 w-4 rtl:rotate-180" />{t('se.cal.backToCalendar')}</button>
                  <h2 className="min-w-0 truncate font-display !text-[15px] font-extrabold text-slate-900" title={td(project?.title)}>{td(project?.title)}</h2>
                </div>
                <p className="mt-1.5 text-xs font-extrabold uppercase tracking-wide text-brand-700">{dayNumber ? `${t('se.day')} ${dayNumber} · ` : ''}{formatDate(workDate, workDate, { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })}</p>
              </>
            ) : (
              <>
                <p className="text-xs font-extrabold uppercase tracking-wide text-brand-700">{dayNumber ? `${t('se.day')} ${dayNumber} · ` : ''}{formatDate(workDate, workDate, { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })}</p>
                <h2 className="mt-0.5 font-display text-xl font-extrabold text-slate-900">{td(project?.title)}</h2>
              </>
            )}
            {dayReady && (register?.last_updated_at || register?.created_by_name) && <p className="mt-1 text-xs font-semibold text-slate-500">{register?.last_updated_at ? `${t('se.lastUpdated')}: ${formatDisplayTime(register.last_updated_at)}` : ''}{register?.last_updated_at && register?.created_by_name ? ' · ' : ''}{register?.created_by_name ? `${t('se.siteEngineer')}: ${td(register.created_by_name)}` : ''}</p>}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {dayReady && <span className={`rounded-full px-3 py-1.5 text-xs font-extrabold ${photoOnly ? (['Photos', 'Videos', 'PhotosVideos'].includes(displayedStatus) ? 'bg-blue-100 text-blue-800' : displayedStatus === 'OPEN' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-700') : ['CLOSED','COMPLETED'].includes(displayedStatus) ? 'bg-blue-100 text-blue-800' : displayedStatus === 'IN_PROGRESS' ? 'bg-brand-100 text-brand-800' : 'bg-emerald-100 text-emerald-800'}`}>{statusLabel(displayedStatus, t)}</span>}
            {onLiveCamera && project ? <button type="button" onClick={() => onLiveCamera(project.id)} className="live-camera-blink inline-flex h-9 shrink-0 items-center gap-2 rounded-lg border border-red-700 bg-red-600 px-3 text-xs font-black text-white transition hover:bg-red-700"><Camera className="h-4 w-4" /> {t('dash.engineer.hero.liveCamera')}</button> : null}
          </div>
        </header>
        {!dayReady ? (
          loadError
            ? <div className="p-5"><Notice notice={{ text: loadError, tone: 'error' }}><button type="button" onClick={refresh} className="rounded-lg border border-rose-300 bg-white px-3 py-1 text-xs font-extrabold">{t('se.form.retry')}</button></Notice></div>
            : <p className="flex items-center justify-center gap-2 px-5 py-12 text-sm font-bold text-slate-500"><Loader2 className="h-4 w-4 animate-spin" />{t('se.form.loadingDay')}</p>
        ) : photoOnly ? (
        <div className="p-5">
          {uploadedImages.length > 0 && (
            <>
              <div className="mb-3 flex items-center justify-between"><p className="text-xs font-bold text-slate-600">{t('se.sitePhotos')}</p><span className="text-[11px] font-semibold text-slate-400">{t('se.availableCount', { count: uploadedImages.length })}</span></div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {uploadedImages.map((image, index) => (
                  <button type="button" key={image.id || image.image_url} onClick={() => setPhotoViewerIndex(index)} className="group overflow-hidden rounded-xl border border-slate-200 text-left">
                    <img src={imageUrl(image.image_url)} alt={t('se.sitePhotoAlt', { date: formatDate(workDate, workDate), index: index + 1 })} className="h-40 w-full rounded-xl object-cover transition group-hover:scale-[1.02]" />
                  </button>
                ))}
              </div>
              <button type="button" onClick={() => setPhotoViewerIndex(0)} className="mt-3 inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-brand-200 bg-white px-4 text-xs font-extrabold text-brand-700 transition hover:bg-brand-50">{t('se.viewAllPhotos', { count: uploadedImages.length })}</button>
            </>
          )}
          {uploadedVideos.length > 0 && (
            <>
              <div className="mb-3 mt-5 flex items-center justify-between"><p className="text-xs font-bold text-slate-600">{t('se.siteVideos')}</p><span className="text-[11px] font-semibold text-slate-400">{t('se.availableCount', { count: uploadedVideos.length })}</span></div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {uploadedVideos.map((video) => (
                  <div key={video.id || video.image_url} className="overflow-hidden rounded-xl border border-slate-200">
                    <video src={imageUrl(video.image_url)} controls preload="metadata" className="h-48 w-full object-cover bg-slate-900" />
                  </div>
                ))}
              </div>
            </>
          )}
          {uploadedImages.length === 0 && uploadedVideos.length === 0 && (
            <p className="rounded-xl border border-dashed border-slate-200 px-4 py-8 text-center text-xs font-bold text-slate-400">{t('se.noSiteMedia')}</p>
          )}
        </div>
      ) : (
        <div className="space-y-4 p-4 sm:p-5">
          {/* The day at a glance: what was recorded, what it used, how far along. */}
          <div className="grid grid-cols-2 gap-2 md:grid-cols-3 2xl:grid-cols-6">
            <GlanceStat label={t('se.glance.work')} value={form.work_title ? td(form.work_title) : t('se.glance.noWork')} />
            {/* Completion while it can be measured; until then the schedule,
                once work has actually started on site (`work_started`). */}
            <GlanceStat label={t('se.glance.progress')} value={!project ? '—' : completionPercent(project) !== null ? completionText(project, t) : project.work_started !== true ? t('progress.scheduleNotStarted') : scheduleText(project, t) || '—'} sub={activitySummary.percent !== null ? `${t('se.activityProgress')}: ${activitySummary.percent}%` : project && completionPercent(project) !== null ? scheduleText(project, t) : ''} />
            <GlanceStat label={t('se.glance.materials')} value={usage.usedCount ? money(materialCost, country) : t('se.glance.none')} sub={usage.usedCount ? t('se.res.materialCount', { count: usage.usedCount }) : ''} />
            <GlanceStat label={t('se.res.glanceLabour')} value={dayLabour.length ? t('se.res.presentOf', { present: crew.present, allocated: crew.allocated }) : String(Number(form.labour_worker_count) || 0)} sub={dayLabour.length ? t('se.res.crewCount', { count: dayLabour.length }) : t('se.glance.workers')} />
            <GlanceStat label={t('se.res.glanceEquipment')} value={money(costSummary.rental + costSummary.otherEquipment, country)} sub={costSummary.unpricedRentals ? t('se.res.unpricedShort', { count: costSummary.unpricedRentals }) : dayRentals.length ? t('se.res.rentalCount', { count: dayRentals.length }) : ''} />
            <GlanceStat label={t('se.res.dayTotal')} value={money(costSummary.total, country)} sub={paidOutToday > 0 ? t('se.res.paidOutShort', { amount: money(paidOutToday, country) }) : ''} />
          </div>
          {supply.error && <Notice notice={{ text: supply.error, tone: 'error' }} />}
          {editable && <p className="text-[11px] font-semibold text-slate-500"><span className="text-rose-600">*</span> {t('se.form.requiredHint')}</p>}

          <FormSection title={t('se.form.sectionWork')}>
            <div className="grid gap-3">
              <Field t={t} label={t('se.form.workTitle')} required={editable} error={fieldErrors.work_title}><Input ref={workTitleRef} value={form.work_title} onChange={(event) => update('work_title', event.target.value)} disabled={!editable} invalid={Boolean(fieldErrors.work_title)} placeholder={editable ? t('se.form.workTitlePlaceholder') : ''} maxLength={200} /></Field>
              <Field t={t} label={t('se.form.workDescription')} optional={editable}><TextArea value={form.detailed_remarks} onChange={(event) => update('detailed_remarks', event.target.value)} disabled={!editable} placeholder={editable ? t('se.form.workDescriptionPlaceholder') : ''} /></Field>
              <Field t={t} label={t('se.inspectionRemarks')} optional={editable}><TextArea value={form.inspection_remarks} onChange={(event) => update('inspection_remarks', event.target.value)} disabled={!editable} placeholder={editable ? t('se.form.inspectionPlaceholder') : ''} /></Field>
            </div>
          </FormSection>

          <FormSection title={t('se.form.sectionProgress')}>
            <div className="grid gap-3 md:grid-cols-2">
              {/* Overall project progress, read-only. The server calculates it
                  (progress_service.py) and every dashboard shows the same
                  values; the daily record no longer sets a percentage. */}
              {/* Shown only once completion can be measured. */}
              {project && completionPercent(project) !== null && (
                <Field t={t} as="div" label={t('progress.completion')} hint={t('progress.autoHint')}>
                  <p className="text-sm font-extrabold text-slate-800">{completionText(project, t)}</p>
                </Field>
              )}
              <Field t={t} as="div" label={t('progress.schedule')}>
                <p className="text-sm font-extrabold text-slate-800">{(project && scheduleText(project, t)) || '—'}</p>
              </Field>
            </div>
            {/* BOQ item this day's work belongs to. Every field is optional, so a
                day can still be recorded exactly as before without one. Folded
                away until used, so it does not crowd the everyday form. */}
            <details open={boqOpen} onToggle={(event) => setBoqOpen(event.currentTarget.open)} className="group mt-3 rounded-lg border border-slate-200 bg-slate-50/60">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2.5 text-xs font-extrabold text-slate-700">
                <span>{t('se.form.boqTitle')} <span className="font-semibold text-slate-400">({t('se.form.optional')})</span></span>
                <span className="flex items-center gap-2 text-slate-500">{activitySummary.percent !== null && <span className="tabular-nums">{activitySummary.percent}%</span>}<ChevronDown className="h-4 w-4 transition group-open:rotate-180" /></span>
              </summary>
              <div className="grid gap-3 border-t border-slate-200 p-3 md:grid-cols-2">
                <p className="text-[11px] font-semibold text-slate-500 md:col-span-2">{t('se.form.boqHint')}</p>
                <Field t={t} label={t('se.activityCategory')}><Input list="se-activity-categories" value={form.activity_category} onChange={(event) => update('activity_category', event.target.value)} disabled={!editable} /></Field>
                {/* `value` is what the field receives and what is posted, so it stays
                    the English division name; `label` is only what the suggestion
                    reads as. A division this project recorded itself has no key and
                    is shown as the engineer typed it. */}
                <datalist id="se-activity-categories">{activityCategoryOptions.map((option) => { const label = optionLabel(t, ACTIVITY_CATEGORY_KEYS, option); return <option key={option} value={option} label={label === option ? undefined : label} /> })}</datalist>
                <Field t={t} label={t('se.boqReference')}><Input value={form.boq_reference} onChange={(event) => update('boq_reference', event.target.value)} disabled={!editable} /></Field>
                <Field t={t} label={t('se.plannedQuantity')}><Input type="number" min="0" step="any" value={form.planned_quantity} onChange={(event) => update('planned_quantity', event.target.value)} disabled={!editable} /></Field>
                <Field t={t} label={t('se.form.completedToday')}><Input type="number" min="0" step="any" value={form.completed_quantity} onChange={(event) => update('completed_quantity', event.target.value)} disabled={!editable} /></Field>
                <Field t={t} label={t('se.activityUnit')}><Input list="se-activity-units" value={form.activity_unit} onChange={(event) => update('activity_unit', event.target.value)} disabled={!editable} /></Field>
                <datalist id="se-activity-units">{activityUnitOptions.map((option) => { const label = optionLabel(t, ACTIVITY_UNIT_KEYS, option); return <option key={option} value={option} label={label === option ? undefined : label} /> })}</datalist>
                {/* One read-out for the activity: bar, done, planned and remaining. */}
                <div className="grid content-end gap-1 text-xs font-bold text-slate-600">
                  <span>{t('se.activityProgress')}</span>
                  <div className="flex h-10 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3">
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-brand-50"><div className="h-full rounded-full bg-[linear-gradient(90deg,#236645,#2e7d55)]" style={{ width: `${activitySummary.percent ?? 0}%` }} /></div>
                    <span className="shrink-0 text-sm font-extrabold tabular-nums text-slate-900">{activitySummary.percent === null ? '—' : `${activitySummary.percent}%`}</span>
                  </div>
                </div>
                <p className="text-[11px] font-semibold text-slate-500 md:col-span-2">{activitySummary.remaining === null ? t('se.remainingNotSet') : t('se.form.activityReadout', { done: formatQty(activitySummary.completedToDate), planned: formatQty(activitySummary.planned), remaining: formatQty(activitySummary.remaining), unit: unitLabel(form.activity_unit) })}</p>
              </div>
            </details>
          </FormSection>

          <FormSection title={t('se.form.sectionMaterials')} aside={materials.length > 0 && <p className="text-xs font-bold text-slate-500">{t('se.mat.summary', { used: usage.usedCount, total: usage.stockCount })}{usage.cost > 0 ? ` · ${money(usage.cost, country)}` : ''}</p>}>
            {materials.length > 0 && editable && <div className="mb-3 flex flex-wrap items-center gap-2">
              <label className="relative min-w-0 flex-1"><span className="sr-only">{t('se.mat.search')}</span><Search aria-hidden="true" className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" /><input type="search" value={usageSearch} onChange={(event) => setUsageSearch(event.target.value)} placeholder={t('se.mat.search')} className="h-9 w-full rounded-lg border border-slate-200 bg-white pl-8 pr-2.5 text-xs font-semibold outline-none focus:border-brand-500" /></label>
              <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-lg border border-slate-200 px-3 text-xs font-extrabold text-slate-700"><input type="checkbox" checked={usedOnly} onChange={(event) => setUsedOnly(event.target.checked)} className="h-4 w-4 accent-[#03572E]" />{t('se.mat.usedOnly')}</label>
            </div>}
            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full min-w-[520px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-[10px] font-extrabold uppercase tracking-wider text-slate-500">
                    <th scope="col" className="px-3 py-2 text-left">{t('se.material')}</th>
                    <th scope="col" className="px-3 py-2 text-right">{t('se.rate')}</th>
                    <th scope="col" className="px-3 py-2 text-right">{t('se.usedToday')}</th>
                    <th scope="col" className="px-3 py-2 text-right">{t('dash.contractor.amount')}</th>
                    <th scope="col" className="px-3 py-2 text-right">{t('se.statusCol')}</th>
                  </tr>
                </thead>
                <tbody>
                  {usageRows.map((item) => {
                    const usedQty = Number(usedToday[item.material] ?? 0) || 0
                    const rate = Number(item.rate ?? 0) || 0
                    const rowError = fieldErrors.materials?.[item.material]
                    const stockKey = stockStatusKey(item.remaining, item.minimum_stock)
                    return (
                      <tr key={item.material} className={`border-b border-slate-100 last:border-b-0 ${rowError ? 'bg-rose-50' : usedQty > 0 ? 'bg-brand-50/40' : ''}`}>
                        <td className="px-3 py-2.5 text-left align-top">
                          <p className="font-extrabold text-slate-900">{td(item.material)}</p>
                          {(item.specification || item.supplier_name) && <p className="text-[11px] font-semibold text-slate-500">{[item.specification ? td(item.specification) : '', item.supplier_name ? td(item.supplier_name) : ''].filter(Boolean).join(' · ')}</p>}
                          <p className="text-[11px] font-semibold text-slate-500">{usedQty > 0 ? t('se.mat.leftAfter', { qty: formatQty(item.remaining), unit: unitLabel(item.unit) }) : t('se.mat.inStock', { qty: formatQty(item.available), unit: unitLabel(item.unit) })}</p>
                          {rowError && <p role="alert" className="text-[11px] font-bold text-rose-600">{rowError}</p>}
                          {historyEntries.some((entry) => entry.material === item.material) && <button type="button" onClick={() => showHistoryFor(item.material)} className="mt-0.5 inline-flex items-center gap-1 text-[11px] font-extrabold text-brand-700 hover:underline"><HistoryIcon className="h-3 w-3" />{t('se.mat.viewHistory')}</button>}
                        </td>
                        <td className="px-3 py-2.5 text-right align-top font-bold text-slate-600">{rate > 0 ? <>{money(rate, country)}<span className="text-[10px] text-slate-400">/{unitLabel(item.unit)}</span></> : '—'}</td>
                        <td className="px-3 py-2.5 text-right align-top">
                          {editable ? (
                            <span className="inline-flex items-center gap-1"><input type="number" min="0" step="any" inputMode="decimal" aria-label={`${t('se.usedToday')}: ${td(item.material)} (${unitLabel(item.unit)})`} aria-invalid={Boolean(rowError) || undefined} value={usedToday[item.material] ?? 0} onFocus={(event) => event.target.select()} onChange={(event) => updateUsage(item.material, event.target.value)} className={`h-9 w-20 rounded-lg border bg-white px-2 text-right text-sm font-extrabold outline-none focus:border-brand-500 ${rowError ? 'border-rose-400' : 'border-slate-200'}`} /><span className="w-8 text-left text-[10px] font-semibold text-slate-400">{unitLabel(item.unit)}</span></span>
                          ) : (
                            <span className="font-extrabold text-slate-900">{formatQty(usedQty)} <span className="text-[10px] text-slate-400">{unitLabel(item.unit)}</span></span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-right align-top font-extrabold text-slate-900">{rate > 0 && usedQty > 0 ? money(usedQty * rate, country) : <span className="text-slate-400">—</span>}</td>
                        <td className="px-3 py-2.5 text-right align-top"><span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-extrabold ${STOCK_TONES[stockKey]}`}>{t(`se.stock.${stockKey}`)}</span></td>
                      </tr>
                    )
                  })}
                  {!usageRows.length && (
                    <tr><td colSpan="5" className="px-4 py-6 text-center text-xs font-bold text-slate-400">
                      {!materials.length ? t('se.noMaterials') : usageSearch.trim() ? <>{t('se.mat.noMatch')} <button type="button" onClick={() => setUsageSearch('')} className="text-brand-700 underline">{t('se.mat.clearSearch')}</button></> : t('se.mat.noneUsed')}
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              {/* Total material cost for the day. It follows the quantities
                  above; a different amount can still be typed, as before. */}
              <Field t={t} as="div" label={t('se.form.materialCost')} hint={!materialCostOverridden ? t('se.form.materialCostAuto') : ''}>
                {editable && materialCostOverridden
                  ? <><Input type="number" min="0" step="any" value={form.material_cost} onChange={(event) => update('material_cost', event.target.value)} /><button type="button" onClick={() => update('material_cost', '')} className="justify-self-start text-[11px] font-extrabold text-brand-700 hover:underline">{t('se.form.materialCostUseAuto', { amount: money(materialCostFromUsage, country) })}</button></>
                  : <div className="flex h-10 items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3"><span className="text-sm font-extrabold tabular-nums text-slate-900">{money(materialCost, country)}</span>{editable && <button type="button" onClick={() => update('material_cost', String(materialCostFromUsage))} className="text-[11px] font-extrabold text-brand-700 hover:underline">{t('se.form.materialCostEdit')}</button>}</div>}
                <BudgetInWords value={materialCost} country={country} />
              </Field>
              <Field t={t} label={t('se.form.materialNotes')} optional={editable} hint={editable ? t('se.form.materialNotesHint') : ''}><Input value={form.material_used} onChange={(event) => update('material_used', event.target.value)} disabled={!editable} /></Field>
            </div>
            <ReceivedMaterials orders={receivedOrders} country={country} unitLabel={unitLabel} />
          </FormSection>

          <FormSection title={t('se.form.sectionLabour')} aside={dayLabour.length > 0 && <p className="text-xs font-bold text-slate-500">{t('se.res.presentOf', { present: crew.present, allocated: crew.allocated })}</p>}>
            {/* Supplier crews: one card per accepted labour request covering this
                date. Attendance saves straight to the labour-supply endpoint. */}
            {supplyReady ? <LabourCards requests={dayLabour} date={workDate} recordsById={supplyLogs.labour} canRecord={canRecord} onSaved={loadLabourLogs} onDirtyChange={markResourceDirty} resetSignal={resourceReset} /> : <p className="flex items-center gap-2 py-3 text-xs font-bold text-slate-500"><Loader2 className="h-4 w-4 animate-spin" />{t('se.res.loading')}</p>}
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <Field t={t} label={t('se.form.workers')}><Input type="number" inputMode="numeric" min="0" value={form.labour_worker_count} onChange={(event) => update('labour_worker_count', event.target.value)} disabled={!editable} /></Field>
              {/* Labour requests store no agreed rate, so the day's labour cost is
                  still the amount entered here, labelled as such. */}
              <Field t={t} label={<span className="inline-flex items-center gap-1.5">{t('se.form.labourCost')}<Tag tone="entered">{t('se.res.entered')}</Tag></span>} hint={t('se.res.labourManualHint')}><Input type="number" min="0" step="any" value={form.labour_cost} onChange={(event) => update('labour_cost', event.target.value)} disabled={!editable} /><BudgetInWords value={form.labour_cost} country={country} /></Field>
            </div>
            <PaymentsList payments={daySummary.payments || []} country={country} />
          </FormSection>

          <FormSection title={t('se.form.sectionEquipment')} aside={dayRentals.length > 0 && <p className="text-xs font-bold text-slate-500">{t('se.res.rentalsToday', { amount: money(costSummary.rental, country) })}</p>}>
            {/* Supplier rentals covering this date, charged by their agreed terms. */}
            {supplyReady ? <RentalCards rentals={dayRentals} date={workDate} logsById={supplyLogs.equipment} canRecord={canRecord} country={country} onSaved={loadRentalLogs} onDirtyChange={markResourceDirty} resetSignal={resourceReset} /> : <p className="flex items-center gap-2 py-3 text-xs font-bold text-slate-500"><Loader2 className="h-4 w-4 animate-spin" />{t('se.res.loading')}</p>}
            {purchases.length > 0 && <div className="mt-3"><PurchasedEquipment purchases={purchases} country={country} /></div>}
            {/* Anything not rented through a supplier above. Kept separate so a
                rental is never charged twice. */}
            <div className="mt-3 grid gap-3 rounded-lg border border-slate-200 bg-slate-50/60 p-3 md:grid-cols-2">
              <Field t={t} label={t('se.res.otherEquipment')} optional={editable} hint={editable ? t('se.res.otherEquipmentHint') : ''}><Input value={form.equipment_used} onChange={(event) => update('equipment_used', event.target.value)} disabled={!editable} placeholder={editable ? t('se.form.equipmentPlaceholder') : ''} /></Field>
              <Field t={t} label={<span className="inline-flex items-center gap-1.5">{t('se.res.otherEquipmentCost')}<Tag tone="entered">{t('se.res.entered')}</Tag></span>}><Input type="number" min="0" step="any" value={form.equipment_cost} onChange={(event) => update('equipment_cost', event.target.value)} disabled={!editable} /><BudgetInWords value={form.equipment_cost} country={country} /></Field>
            </div>
          </FormSection>

          <FormSection title={t('se.form.sectionMedia')}>
            <p className="mb-2 text-[11px] font-semibold text-slate-500">{t('se.res.photosHint')}</p>
            {editable && <label className="flex min-h-14 cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed border-brand-300 bg-brand-50/50 px-3 text-sm font-bold text-brand-700 transition hover:bg-brand-50"><span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brand-600 text-white shadow-sm"><Plus className="h-5 w-5" /></span>{photos.length ? t('se.photosSelected', { count: photos.length }) : t('se.addSitePhotos')}<input type="file" accept="image/*" multiple onChange={(event) => setPhotos([...event.target.files])} className="sr-only" /></label>}
            {photos.length > 0 && <div className="mt-2"><p className="mb-1 text-xs font-extrabold text-brand-700">{t('se.photosReady', { count: photos.length })}</p><div className="grid grid-cols-3 gap-2">{selectedPreviews.map((preview, index) => <div key={index} className="relative"><img src={preview} alt={t('se.selectedPhoto', { index: index + 1 })} className="h-20 w-full rounded-lg border border-slate-200 object-cover" /><button type="button" title={t('se.removePhoto')} aria-label={t('se.removePhoto')} onClick={() => setPhotos((current) => current.filter((_, i) => i !== index))} className="absolute -right-1.5 -top-1.5 grid h-6 w-6 place-items-center rounded-full bg-rose-600 text-white shadow-sm transition hover:bg-rose-700"><X className="h-3.5 w-3.5" /></button></div>)}</div></div>}
            {uploadedImages.length > 0 && <div className="mt-2 rounded-xl border border-emerald-200 bg-emerald-50/60 p-2"><p className="mb-1 px-1 text-xs font-extrabold text-emerald-700">✓ {t('se.photosUploaded', { count: uploadedImages.length })}</p><div className="grid grid-cols-3 gap-2">{uploadedImages.slice(0, 6).map((image, index) => <div key={image.id || image.image_url} className="relative"><button type="button" onClick={() => setPhotoViewerIndex(index)} className="block w-full"><img src={imageUrl(image.image_url)} alt={t('se.uploadedSitePhoto')} className="h-20 w-full rounded-lg border border-white object-cover" /></button>{editable && <button type="button" title={t('se.deletePhoto')} aria-label={t('se.deletePhoto')} onClick={() => deletePhoto(image)} disabled={Boolean(saving)} className="absolute -right-1.5 -top-1.5 grid h-6 w-6 place-items-center rounded-full bg-rose-600 text-white shadow-sm transition hover:bg-rose-700"><X className="h-3.5 w-3.5" /></button>}</div>)}</div><button type="button" onClick={() => setPhotoViewerIndex(0)} className="mt-2 inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-brand-200 bg-white px-4 text-xs font-extrabold text-brand-700 transition hover:bg-brand-50">{t('se.viewAllPhotos', { count: uploadedImages.length })}</button>{editable && <p className="mt-1.5 px-1 text-[10px] font-semibold text-slate-500">{t('se.tapToDelete')}</p>}</div>}
            {!editable && uploadedImages.length === 0 && <p className="rounded-xl border border-dashed border-slate-200 px-3 py-4 text-center text-xs font-bold text-slate-400">{t('se.noSitePhotos')}</p>}
            {/* Site videos. Same control and styling as Add Site Photos above. */}
            {editable && <label className="mt-2 flex min-h-14 cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed border-brand-300 bg-brand-50/50 px-3 text-sm font-bold text-brand-700 transition hover:bg-brand-50"><span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brand-600 text-white shadow-sm"><Plus className="h-5 w-5" /></span>{videos.length ? t('se.videosSelected', { count: videos.length }) : t('se.addSiteVideos')}<input type="file" accept="video/mp4,video/quicktime,video/webm" multiple onChange={(event) => setVideos([...event.target.files])} className="sr-only" /></label>}
            {videos.length > 0 && <div className="mt-2"><p className="mb-1 text-xs font-extrabold text-brand-700">{t('se.videosReady', { count: videos.length })}</p><div className="grid grid-cols-1 gap-2">{videos.map((video, index) => <div key={`${video.name}-${index}`} className="relative flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2"><span className="truncate text-xs font-semibold text-slate-700">{video.name}</span><button type="button" title={t('se.removeVideo')} aria-label={t('se.removeVideo')} onClick={() => setVideos((current) => current.filter((_, i) => i !== index))} className="ml-auto grid h-6 w-6 shrink-0 place-items-center rounded-full bg-rose-600 text-white shadow-sm transition hover:bg-rose-700"><X className="h-3.5 w-3.5" /></button></div>)}</div></div>}
            {uploadedVideos.length > 0 && <div className="mt-2 rounded-xl border border-emerald-200 bg-emerald-50/60 p-2"><p className="mb-1 px-1 text-xs font-extrabold text-emerald-700">✓ {t('se.videosUploaded', { count: uploadedVideos.length })}</p><div className="grid grid-cols-1 gap-2 sm:grid-cols-2">{uploadedVideos.map((video) => <div key={video.id || video.image_url} className="relative"><video src={imageUrl(video.image_url)} controls preload="metadata" className="h-32 w-full rounded-lg border border-white bg-slate-900 object-cover" />{editable && <button type="button" title={t('se.deleteVideo')} aria-label={t('se.deleteVideo')} onClick={() => deletePhoto(video)} disabled={Boolean(saving)} className="absolute -right-1.5 -top-1.5 grid h-6 w-6 place-items-center rounded-full bg-rose-600 text-white shadow-sm transition hover:bg-rose-700"><X className="h-3.5 w-3.5" /></button>}</div>)}</div></div>}
            {!editable && uploadedVideos.length === 0 && <p className="mt-2 rounded-xl border border-dashed border-slate-200 px-3 py-4 text-center text-xs font-bold text-slate-400">{t('se.noSiteVideos')}</p>}
          </FormSection>

          <FormSection title={t('se.res.sectionOtherExpenses')}>
            <div className="grid gap-3 md:grid-cols-2">
              <Field t={t} label={<span className="inline-flex items-center gap-1.5">{t('se.form.otherExpenses')}<Tag tone="entered">{t('se.res.entered')}</Tag></span>}><Input type="number" min="0" step="any" value={form.total_expenses} onChange={(event) => update('total_expenses', event.target.value)} disabled={!editable} /><BudgetInWords value={form.total_expenses} country={country} /></Field>
            </div>
          </FormSection>

          {/* The day's cost, built from the sections above. */}
          <section className="rounded-xl border border-slate-200">
            <h3 className="border-b border-slate-200 px-4 py-2.5 text-sm font-extrabold text-slate-900">{t('se.form.sectionTotal')}</h3>
            <dl className="divide-y divide-slate-100 text-sm">
              {[
                [t('se.res.costMaterials'), costSummary.material, materialCostOverridden ? 'entered' : 'calc'],
                [t('se.res.costLabour'), costSummary.labour, 'entered'],
                [t('se.res.costRentals'), costSummary.rental, 'calc'],
                [t('se.res.costOtherEquipment'), costSummary.otherEquipment, 'entered'],
                [t('se.res.costOtherExpenses'), costSummary.otherExpenses, 'entered'],
              ].map(([label, value, source]) => <div key={label} className="flex items-center justify-between gap-2 px-4 py-2"><dt className="flex items-center gap-1.5 font-bold text-slate-600">{label}<Tag tone={source}>{t(source === 'calc' ? 'se.res.calculated' : 'se.res.entered')}</Tag></dt><dd className="font-extrabold tabular-nums text-slate-900">{money(value, country)}</dd></div>)}
            </dl>
            <div className="flex items-center justify-between border-t border-brand-200 bg-brand-50 px-4 py-3"><p className="text-sm font-extrabold text-brand-800">{t('se.res.dayTotal')}</p><p className="text-xl font-extrabold tabular-nums text-brand-950">{money(costSummary.total, country)}</p></div>
            <div className="space-y-1 px-4 py-2.5 text-[11px] font-semibold text-slate-500">
              {costSummary.unpricedRentals > 0 && <p className="font-bold text-rose-600">{t('se.res.unpricedNote', { count: costSummary.unpricedRentals })}</p>}
              {(costSummary.rental > 0 || costSummary.unpricedRentals > 0) && <p>{t('se.res.rentalsNotSaved')}</p>}
              <p>{t('se.res.outsideTotal', { paid: money(paidOutToday, country), received: money(receivedValue, country) })}</p>
            </div>
          </section>
          {/* Builder only: audited corrections kept beside this record. The figures
              above stay exactly as the Site Engineer recorded them. */}
          {user?.role === 'BUILDER' && register?.id && (
            <BuilderCostAdjustments registerId={register.id} money={(value) => money(Number(value || 0), project?.project_country)} />
          )}
        </div>
      )}
        {dayReady && loadError && <Notice notice={{ text: loadError, tone: 'error' }} className="mx-4 mb-4 sm:mx-5"><button type="button" onClick={refresh} className="rounded-lg border border-rose-300 bg-white px-3 py-1 text-xs font-extrabold">{t('se.form.retry')}</button></Notice>}
        <Notice notice={notice} className="mx-4 mb-4 sm:mx-5" />
        {editable && dayReady && <footer className="sticky bottom-0 flex flex-wrap items-center justify-between gap-3 rounded-b-2xl border-t border-slate-100 bg-white px-4 py-3 sm:px-5">
          <div className="flex min-h-9 items-center gap-2">{dirty && <><span className="inline-flex items-center gap-1.5 text-xs font-extrabold text-brand-800"><span aria-hidden="true" className="h-2 w-2 rounded-full bg-brand-500" />{t('se.form.unsaved')}</span><button type="button" onClick={discardChanges} disabled={Boolean(saving)} className="h-9 rounded-lg border border-slate-200 px-3 text-xs font-extrabold text-slate-700 hover:bg-slate-50 disabled:opacity-40">{t('se.form.discard')}</button></>}</div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <button type="button" onClick={() => save('CLOSED')} disabled={Boolean(saving)} title={t('se.form.closeDayHint')} className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 text-sm font-extrabold text-slate-800 hover:bg-slate-50 disabled:opacity-40">{saving === 'CLOSED' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />}{saving === 'CLOSED' ? t('se.form.saving') : t('se.form.closeDay')}</button>
            <button type="button" onClick={() => save('IN_PROGRESS')} disabled={Boolean(saving)} className="inline-flex h-11 min-w-40 items-center justify-center gap-2 rounded-xl border-2 border-brand-600 bg-brand-500 px-5 text-sm font-extrabold text-slate-950 shadow-sm disabled:opacity-40">{saving === 'IN_PROGRESS' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}{saving === 'IN_PROGRESS' ? t('se.form.saving') : t('se.form.saveProgress')}</button>
          </div>
        </footer>}
        {!editable && !readOnly && dayReady && <p className="rounded-b-2xl border-t border-brand-100 bg-brand-50 px-5 py-3 text-sm font-bold text-brand-800">{historyOnly ? t('se.readOnlyLogs') : t('se.readOnlyDay')}{!historyOnly && recordableResources ? ` ${t('se.res.pastDayHint')}` : ''}</p>}
      </section>
      </>}
      {!photoOnly && (workDate || historyOnly) && <MaterialHistoryPanel entries={historyEntries} filters={historyFilters} setFilters={setHistoryFilters} touched={touched} todayKey={todayKey} country={country} panelRef={historyRef} t={t} td={td} unitLabel={unitLabel} wide={workspace} collapsible={!historyOnly} open={historyOnly || historyOpenFor === projectId} onToggle={() => setHistoryOpenFor((current) => (current === projectId ? null : projectId))} />}
      </div>
    </div>}
    <PhotoViewer photos={uploadedImages} activeIndex={photoViewerIndex} onChange={setPhotoViewerIndex} onBack={() => setPhotoViewerIndex(null)} title={t('se.projectSitePhotos', { project: td(project?.title) || t('se.projectFallback') })} />
  </div>
}
