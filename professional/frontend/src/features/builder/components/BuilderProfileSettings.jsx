import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AlertTriangle, ArrowLeft, Boxes, BriefcaseBusiness, CheckCircle2, ExternalLink,
  FileText, GalleryVerticalEnd, HardHat, ImagePlus, Images, Info, Loader2, MapPin, Pencil, Plus, Save, ShieldCheck, Trash2, UserRound, X,
} from 'lucide-react'
import ProfileImageUpload from '../../../shared/ui/ProfileImageUpload.jsx'
import { EmptyState } from '../../../shared/dashboard/RoleDashboardUi.jsx'
import { avatarFromPath } from '../../../shared/ui/avatars.js'
import { SmartImage } from '../../../shared/ui/ui.jsx'
import { imageUrl } from '../../../shared/api/apiClient.js'
import { uploadLocalFile } from '../../../shared/api/uploadApi.js'
import {
  businessTypeOptions,
  contractorDocumentTypes,
  contractorEquipmentOptions,
  contractorServiceOptions,
} from '../../onboarding/profileConstants.js'
import { normalizePortfolioProjects, PORTFOLIO_MAX_IMAGES, PORTFOLIO_MAX_PROJECTS, profileListString, splitEditableList } from '../builderHelpers.js'
import { assertProfileImage, PROFILE_IMAGE_ACCEPT } from '../../../shared/utils/profileImageRules.js'
import { useSelector } from 'react-redux'
import { useLanguage } from '../../../i18n/LanguageContext.jsx'
import { RequiredMark, requiredProfileFields } from '../../accounts/components/ProfileCompletionMeter.jsx'
import { optionLabel, BUSINESS_TYPE_KEYS, DOCUMENT_TYPE_KEYS, EQUIPMENT_OPTION_KEYS, SERVICE_OPTION_KEYS } from '../../../i18n/optionKeys.js'
import FieldError from '../../../shared/ui/FieldError.jsx'
import PincodeAreaHint from '../../../shared/ui/PincodeAreaHint.jsx'
import { usePincodeAreaLookup } from '../../../shared/hooks/usePincodeAreaLookup.js'
import { lookupPincodeArea } from '../../onboarding/locationApi.js'
import UpgradePrompt from '../../billing/subscription/UpgradePrompt.jsx'
import { locationUsage, promptPlan } from '../../billing/subscription/planLimits.js'
import { branchLocationEntry, pincodeLocationEntry } from '../../billing/subscription/locationEntries.js'
import { lookupBranchList } from '../../../shared/utils/pincodeBranches.js'
import { INVALID_FIELD_CLASS, profileErrorMessage, useProfileFormErrors } from '../../../shared/hooks/useProfileFormErrors.js'

const inputClasses = 'h-10 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm font-semibold text-slate-900 outline-none transition focus:border-brand-400 focus:bg-white'
const areaClasses = 'min-h-20 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-900 outline-none transition focus:border-brand-400 focus:bg-white'

// The order these fields are read on screen, so "the first invalid one" is the
// first the builder would reach rather than the first the backend happened to
// serialise.
const CONTRACTOR_FIELD_ORDER = [
  'name', 'phone', 'address', 'pincode',
  'company_name', 'license_number', 'gstin', 'pan', 'website', 'business_type',
  'registration_year', 'team_size', 'experience_years', 'about',
  'services_offered', 'service_locations', 'equipment_owned', 'insurance_available', 'completed_project_details',
]

/** A small counter block, as the portfolio section has always shown them. */
function SummaryTile({ label, value }) {
  return (
    <div className="min-w-0 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5">
      <p className="truncate text-[11px] font-extrabold uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-0.5 truncate font-display text-lg font-extrabold text-slate-950">{value || '—'}</p>
    </div>
  )
}

/**
 * One row of the profile: its label, and either the saved value or — once the
 * builder has clicked Edit — the input and its validation message.
 *
 * It replaces the per-field editor that used to live here, each with its own
 * Edit and Save. There is now one Save for the whole profile at the bottom of
 * the screen, so this component holds no state and saves nothing on its own.
 */
// Whether a read-mode row actually shows a saved value. `display` is usually a
// <ReadValue value={...} />, which renders "Not set" for an empty value, so the
// element itself is always present; the value it was given is what counts.
function displayHasValue(display) {
  const value = display?.props && 'value' in display.props ? display.props.value : display
  if (Array.isArray(value)) return value.length > 0
  return value !== null && value !== undefined && value !== false && String(value).trim() !== ''
}

function FormRow({ label, required = false, hint, error, editing, display, children }) {
  return (
    <div className={`grid grid-cols-1 gap-x-3 sm:grid-cols-[minmax(0,150px)_minmax(0,1fr)] ${
      editing ? 'gap-2 py-2 sm:items-start' : 'py-1.5 sm:items-baseline'
    }`}>
      <p className={`text-[11px] font-extrabold uppercase tracking-wide text-slate-400 ${editing ? 'pt-2.5' : ''}`}>{label}{required && <RequiredMark satisfied={!editing && displayHasValue(display)} />}</p>
      <div className="min-w-0">
        {editing ? (
          <>
            {children}
            {hint && <p className="mt-1 text-[11px] font-medium text-slate-400">{hint}</p>}
            <FieldError message={error} />
          </>
        ) : display}
      </div>
    </div>
  )
}

/** A value in read mode, with the project's existing "not set" wording. */
function ReadValue({ value }) {
  const { t } = useLanguage()
  return <p className="text-sm font-bold text-slate-900">{String(value ?? '').trim() || t('cpp.notSet')}</p>
}

/**
 * A saved list, read as chips.
 *
 * `keys` is the option map the list's values come from, so a service reads as a
 * service and a piece of equipment as equipment; every list used to be read
 * through SERVICE_OPTION_KEYS, so equipment names stayed English. A value the
 * map does not hold -- a service location the builder typed, say -- goes through
 * `td`.
 */
function Chips({ items, keys }) {
  const { t, td } = useLanguage()
  const list = splitEditableList(items)
  if (!list.length) return <p className="text-sm font-semibold text-slate-400">{t('cpp.notSet')}</p>
  return (
    <div className="flex flex-wrap gap-1.5">
      {list.map((item) => (
        <span key={item} className="rounded-lg border border-slate-200 bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-700">{keys && keys[item] ? t(keys[item]) : td(item)}</span>
      ))}
    </div>
  )
}

function SectionCard({ title, icon: Icon, children, action }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_14px_40px_-30px_rgba(15,23,42,0.35)]">
      {/* Wraps: a long translated title plus Edit / Add project ran past the
          card and the screen on a phone; the action now goes under the title. */}
      <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
        <h3 className="flex min-w-0 items-center gap-2 font-display text-[15px] font-bold text-slate-950">
          {Icon && <Icon className="h-[18px] w-[18px] shrink-0 text-brand-600" />}
          {title}
        </h3>
        {action}
      </div>
      {children}
    </section>
  )
}

/** The one entry point into editing. Every editable card follows this button. */
function EditButton({ onClick }) {
  const { t } = useLanguage()
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-brand-600 px-3.5 text-xs font-extrabold text-white transition hover:-translate-y-0.5 hover:bg-brand-700"
    >
      <Pencil className="h-3.5 w-3.5" /> {t('cps.edit')}
    </button>
  )
}

function documentFileName(documentUrl) {
  const cleanedUrl = String(documentUrl || '').split('?')[0]
  const fileName = cleanedUrl.split('/').pop() || documentUrl
  return decodeURIComponent(fileName)
}

// A stored document is "<Type>: <url>" -- the form Complete Profile and the
// admin verification queue read -- or a bare "<url>" from an older upload here.
function splitDocumentEntry(entry) {
  const text = String(entry || '').trim()
  const separatorIndex = text.indexOf(': ')
  if (separatorIndex > 0 && !text.startsWith('/') && !text.startsWith('http')) {
    return { type: text.slice(0, separatorIndex).trim(), url: text.slice(separatorIndex + 2).trim() }
  }
  return { type: '', url: text }
}

// A field error in the shape the backend sends, so a check made here before
// saving is shown exactly like one the server returned.
function localFieldError(message, fields) {
  return { response: { data: { detail: { message, fields } } } }
}

export default function ContractorProfileSettings({
  profile,
  user,
  errorMessage,
  onSaveField,
  onProfileImageUpload,
  onCompanyLogoUpload,
  onBack,
  uploadMessage = '',
  subscriptionStatus = null,
}) {
  // The signed-in account. `user` above is the dashboard's display shell, which
  // carries no country, and the pincode lookup needs the real one.
  const account = useSelector((state) => state.auth.user)
  // Mandatory labels follow the API's profile_completion definition; this file
  // keeps no required-field list of its own.
  const requiredFields = requiredProfileFields(account)
  const { t, td } = useLanguage()
  const [notice, setNotice] = useState(null)
  const [listBusy, setListBusy] = useState('')
  // The type a document is uploaded as; uploads here used to drop it.
  const [documentType, setDocumentType] = useState('')
  // The profile reads as plain information until the builder asks to change it.
  // One flag for the whole screen, so every card opens together and there is
  // exactly one Save for all of them.
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({})
  const { fieldErrors, formError, registerField, clearErrors, clearFieldError, applyError } = useProfileFormErrors()
  // The dashboard rebuilds the `profile` object on every render, so seeding on
  // its identity would throw away whatever the builder has typed. Seeding is
  // keyed on which account the profile belongs to, and skipped while the editor
  // is open or there are unsaved edits.
  const hasUnsavedEdits = useRef(false)
  const profileRef = useRef(profile)
  profileRef.current = profile
  const editingRef = useRef(editing)
  editingRef.current = editing
  const profileKey = profile ? String(profile.user_id ?? profile.id ?? '') : ''

  const seedForm = useCallback((source) => {
    if (!source) return
    setForm({
      name: source.name || '',
      phone: source.phone || '',
      address: source.address || '',
      pincode: source.pincode || '',
      company_name: source.company_name || '',
      license_number: source.license_number || '',
      gstin: source.gstin || '',
      pan: source.pan || '',
      website: source.website || '',
      business_type: source.business_type || '',
      registration_year: source.registration_year ?? '',
      team_size: source.team_size || '',
      experience_years: source.experience_years ?? '',
      about: source.about || '',
      services_offered: profileListString(source.services_offered),
      service_locations: profileListString(source.service_locations),
      equipment_owned: profileListString(source.equipment_owned),
      insurance_available: Boolean(source.insurance_available),
      gallery: profileListString(source.gallery),
      documents: profileListString(source.documents),
      // The builder's own previous work -- not the projects awarded through
      // CREWNBUILD, which live on the Projects page.
      completed_project_details: normalizePortfolioProjects(source.completed_project_details || []),
    })
  }, [])

  useEffect(() => {
    if (!profileKey || editingRef.current || hasUnsavedEdits.current) return
    seedForm(profileRef.current)
  }, [profileKey, seedForm])

  const updateField = (field, value) => {
    hasUnsavedEdits.current = true
    setForm((current) => ({ ...current, [field]: value }))
    clearFieldError(field)
  }

  // The pincode resolves the area. It fills Service Locations only when that
  // field is still empty, so anything the builder typed is never overwritten.
  const applyResolvedArea = useCallback((areaDetails) => {
    setForm((current) => (
      current.service_locations
        ? current
        : { ...current, service_locations: pincodeLocationEntry(areaDetails) || areaDetails.display || current.service_locations || '' }
    ))
  }, [])
  const pincodeLookupState = usePincodeAreaLookup(editing ? form.pincode : '', applyResolvedArea, account?.country_of_residence)

  // India builders add a service location by its pincode (leads are matched on
  // it), within the plan's location limit; the server checks the limit again.
  const pincodeLocations = String(account?.country_of_residence || 'India').trim().toLowerCase() === 'india'
  const [locationPincode, setLocationPincode] = useState('')
  const [locationBusy, setLocationBusy] = useState(false)
  const editedLocations = splitEditableList(editing ? form.service_locations : profileListString(profile?.service_locations))
  const serviceLocationUsage = pincodeLocations ? locationUsage(subscriptionStatus, editedLocations.length) : null
  // The post offices the typed pincode resolved to; the builder picks one to add.
  const [locationBranches, setLocationBranches] = useState([])
  const addLocationByPincode = async () => {
    const pincode = locationPincode.replace(/\s/g, '')
    if (!pincode || serviceLocationUsage?.atLimit) return
    setLocationBusy(true)
    let branches
    try { branches = lookupBranchList(await lookupPincodeArea(pincode)) } catch { branches = [] }
    setLocationBusy(false)
    setLocationBranches(branches)
    if (!branches.length) showNotice('error', t('subscription.location.pincodeNotFound'))
  }
  const addLocationBranch = (branch) => {
    if (serviceLocationUsage?.atLimit) return
    const entry = branchLocationEntry(branch)
    if (!entry) { showNotice('error', t('subscription.location.pincodeNotFound')); return }
    if (!editedLocations.includes(entry)) updateField('service_locations', [...editedLocations, entry].join(', '))
    setLocationBranches([])
    setLocationPincode('')
  }

  const showNotice = (type, text) => {
    setNotice({ type, text })
    window.setTimeout(() => setNotice(null), 4000)
  }

  const startEditing = () => {
    clearErrors()
    setNotice(null)
    seedForm(profileRef.current)
    hasUnsavedEdits.current = false
    setEditing(true)
  }

  // --- Services: the same six choices Complete Profile offers. A saved value
  // outside them stays listed and selected rather than being dropped.
  const toggleService = (service) => {
    const current = splitEditableList(form.services_offered)
    const next = current.includes(service) ? current.filter((item) => item !== service) : [...current, service]
    updateField('services_offered', next.join(', '))
  }

  // --- Portfolio: projects the builder completed before or outside CREWNBUILD.
  const portfolio = Array.isArray(form.completed_project_details) ? form.completed_project_details : []
  const setPortfolio = (updater) => {
    hasUnsavedEdits.current = true
    setForm((current) => {
      const currentList = Array.isArray(current.completed_project_details) ? current.completed_project_details : []
      return { ...current, completed_project_details: updater(currentList) }
    })
    clearFieldError('completed_project_details')
  }
  const addPortfolioProject = () => {
    if (!editing) startEditing()
    setPortfolio((list) => (list.length >= PORTFOLIO_MAX_PROJECTS ? list : [...list, { title: '', location: '', description: '', images: [] }]))
  }
  const updatePortfolioProject = (index, field, value) => {
    setPortfolio((list) => list.map((project, projectIndex) => (projectIndex === index ? { ...project, [field]: value } : project)))
  }
  const removePortfolioProject = (index) => {
    setPortfolio((list) => list.filter((_, projectIndex) => projectIndex !== index))
  }
  const removePortfolioPhoto = (index, image) => {
    setPortfolio((list) => list.map((project, projectIndex) => (
      projectIndex === index ? { ...project, images: (project.images || []).filter((item) => item !== image) } : project
    )))
  }

  // Uploads each file on its own and reports any that failed, keeping the ones
  // that succeeded. Images are checked against the upload rules first.
  const uploadEach = async (files, { images = false } = {}) => {
    const selected = Array.from(files || [])
    const results = await Promise.allSettled(selected.map(async (file) => {
      if (images) assertProfileImage(file, t)
      return (await uploadLocalFile(file)).url
    }))
    const urls = results.filter((result) => result.status === 'fulfilled').map((result) => result.value)
    const failures = results.filter((result) => result.status === 'rejected')
    if (failures.length) {
      const reason = profileErrorMessage(failures[0].reason, t('cps.uploadFailed'))
      showNotice('error', selected.length > 1
        ? t('cps.uploadSomeFailed', { failed: failures.length, total: selected.length, reason })
        : reason)
    }
    return { urls, failed: failures.length }
  }

  const uploadPortfolioPhotos = async (index, files) => {
    if (!files?.length || listBusy) return
    const room = PORTFOLIO_MAX_IMAGES - ((portfolio[index]?.images || []).length)
    const selected = Array.from(files).slice(0, Math.max(room, 0))
    if (!selected.length) return
    setListBusy(`portfolio-${index}`)
    try {
      const { urls } = await uploadEach(selected, { images: true })
      if (urls.length) {
        setPortfolio((list) => list.map((project, projectIndex) => (
          projectIndex === index ? { ...project, images: [...(project.images || []), ...urls].slice(0, PORTFOLIO_MAX_IMAGES) } : project
        )))
      }
    } finally {
      setListBusy('')
    }
  }

  const saveProfile = async () => {
    if (saving) return
    clearErrors()
    setNotice(null)
    // The same rules the backend applies, checked first so the builder is
    // taken straight to the field: whole years of experience, at least one,
    // and a title on every portfolio project.
    const localErrors = {}
    const experienceText = String(form.experience_years ?? '').trim()
    if (!experienceText) localErrors.experience_years = t('cp.val.experienceYears')
    else if (!/^\d+$/.test(experienceText) || Number(experienceText) < 1) localErrors.experience_years = t('cp.val.experienceWhole')
    if (portfolio.some((project) => !String(project.title || '').trim())) localErrors.completed_project_details = t('cps.portfolio.titleRequired')
    if (Object.keys(localErrors).length) {
      applyError(localFieldError(t('cp.val.completeFields'), localErrors), t('cps.errSaveChanges'), CONTRACTOR_FIELD_ORDER)
      return
    }
    setSaving(true)
    try {
      // The complete profile in one request, through the existing API.
      await onSaveField(form)
      hasUnsavedEdits.current = false
      setEditing(false)
      showNotice('success', t('dash.msg.profileSaved'))
    } catch (error) {
      // Nothing is closed, reset or reverted: the builder keeps everything they
      // entered and is taken to the first field the backend refused.
      applyError(error, t('cps.errSaveChanges'), CONTRACTOR_FIELD_ORDER)
    } finally {
      setSaving(false)
    }
  }

  const cancelEdits = () => {
    hasUnsavedEdits.current = false
    seedForm(profileRef.current)
    clearErrors()
    setNotice(null)
    setEditing(false)
  }

  // Gallery and document files are uploaded straight away — that is what
  // produces the URL — but the profile itself is only written by the single
  // Save at the bottom, so the list stays part of the one payload.
  const uploadListFiles = async (field, files) => {
    if (!files?.length || listBusy) return
    // A document is saved with its type, as Complete Profile saves it.
    if (field === 'documents' && !documentType) {
      showNotice('error', t('cps.selectField', { label: t('cps.documentType') }))
      return
    }
    setListBusy(field)
    try {
      const { urls, failed } = await uploadEach(files, { images: field === 'gallery' })
      if (!urls.length) return
      const entries = field === 'documents' ? urls.map((url) => `${documentType}: ${url}`) : urls
      hasUnsavedEdits.current = true
      setForm((current) => {
        let existing = splitEditableList(current[field])
        // One file per document type: a new upload replaces that type's file.
        if (field === 'documents') existing = existing.filter((entry) => splitDocumentEntry(entry).type !== documentType)
        return { ...current, [field]: [...existing, ...entries].join(', ') }
      })
      if (!failed) showNotice('success', field === 'gallery' ? t('cps.galleryAdded') : t('cps.documentUploaded'))
      if (field === 'documents') setDocumentType('')
    } finally {
      setListBusy('')
    }
  }

  const removeListItem = (field, item) => {
    hasUnsavedEdits.current = true
    setForm((current) => ({
      ...current,
      [field]: splitEditableList(current[field]).filter((existingItem) => existingItem !== item).join(', '),
    }))
  }

  const fieldClass = (field) => (
    fieldErrors[field]
      ? `${inputClasses.replace('border-slate-200 ', '').replace('bg-slate-50 ', '')} ${INVALID_FIELD_CLASS}`
      : inputClasses
  )
  const areaClass = (field) => (
    fieldErrors[field]
      ? `${areaClasses.replace('border-slate-200 ', '').replace('bg-slate-50 ', '')} ${INVALID_FIELD_CLASS}`
      : areaClasses
  )

  if (errorMessage) {
    return (
      <div className="space-y-4">
        <EmptyState title={t('cps.profileNotLoaded')} message={errorMessage} />
        <button onClick={onBack} className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-brand-700">{t('cps.backToDashboard')}</button>
      </div>
    )
  }
  if (!profile) {
    return <EmptyState title={t('cps.loadingProfile')} message={t('cpp.fetchingProfile')} />
  }

  // While editing, the lists shown are the ones the pending save will write.
  const galleryImages = splitEditableList(editing ? form.gallery : profileListString(profile.gallery))
  const documentList = splitEditableList(editing ? form.documents : profileListString(profile.documents))
  const portfolioProjects = editing ? portfolio : normalizePortfolioProjects(profile.completed_project_details || [])
  const profileHeroImage = profile.company_logo_url || profile.profile_image_url

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-3 border-b border-slate-200 pb-3 sm:flex-row sm:items-center sm:justify-between">
        {/* Wraps: with a long translated Back label the title goes under the
            button on a phone instead of running off the right edge. */}
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1 text-start text-xs font-extrabold leading-tight text-brand-700 shadow-sm transition hover:bg-brand-50"
          >
            <ArrowLeft className="h-3.5 w-3.5 shrink-0" /> {t('cps.backToDashboardShort')}
          </button>
          <div className="min-w-0">
            <p className="text-[11px] font-extrabold uppercase tracking-wide text-brand-800">{t('ui.profileSettings')}</p>
            <h1 className="font-display text-lg font-extrabold text-slate-950">{t('ps.con.builderProfile')}</h1>
          </div>
        </div>
      </div>

      {notice && (
        <div className={`flex items-center gap-2 rounded-xl border px-4 py-3 text-sm font-bold ${
          notice.type === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-red-200 bg-red-50 text-red-700'
        }`}>
          {notice.type === 'success' ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <AlertTriangle className="h-4 w-4 shrink-0" />}
          {notice.text}
        </div>
      )}

      {/* Header card */}
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_18px_55px_-44px_rgba(15,23,42,0.7)]">
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[96px_minmax(0,1fr)] lg:items-center">
          <SmartImage
            src={avatarFromPath(profileHeroImage, 'BUILDER')}
            alt={profile.company_name || profile.name}
            className="h-20 w-20 rounded-xl object-cover shadow-[0_18px_45px_-28px_rgba(15,23,42,0.9)] ring-1 ring-slate-200"
          />
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-display text-lg font-extrabold text-slate-950">{td(profile.company_name || profile.name) || t('role.builder')}</h2>
              {/* Only a live verification decision from the backend earns the badge. */}
              {profile.is_verified === true && (
                <span data-testid="verified-partner-badge" className="inline-flex rounded-full border border-brand-200 bg-brand-50 px-2.5 py-0.5 text-xs font-extrabold text-brand-800">{t('cps.verifiedPartner')}</span>
              )}
            </div>
            <p className="mt-1 text-[13px] font-medium text-slate-500">{td(profile.name || user?.name)} · {profile.license_number ? t('cps.licenseNumberValue', { number: profile.license_number }) : t('cps.licenseNotSet')}</p>
            <p className="mt-1.5 max-w-3xl text-[13px] leading-6 text-slate-600">{td(profile.about) || t('cps.noCompanyDescription')}</p>
          </div>
        </div>
      </section>

      {/* Profile image & logo */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <ProfileImageUpload role="BUILDER" imageSource={profile.profile_image_url} title={t('ps.profileImage')} note={t('cps.updateProfilePhoto')} onUpload={onProfileImageUpload} />
        <ProfileImageUpload imageSource={profile.company_logo_url} title={t('ps.con.companyLogo')} note={t('cps.updateCompanyLogo')} onUpload={onCompanyLogoUpload} />
      </div>
      {uploadMessage && (
        <p role="status" className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm font-bold text-slate-700">
          <Info className="h-4 w-4 shrink-0 text-brand-600" /> {uploadMessage}
        </p>
      )}

      {/* Personal Information */}
      <SectionCard
        title={t('cps.personalInformation')}
        icon={UserRound}
        action={!editing && <EditButton onClick={startEditing} />}
      >
        <div className="divide-y divide-slate-100">
          <FormRow label={t('ps.name')} required={requiredFields.has('name')} error={fieldErrors.name} editing={editing} display={<ReadValue value={profile.name} />}>
            <input ref={registerField('name')} value={form.name || ''} onChange={(event) => updateField('name', event.target.value)} className={fieldClass('name')} />
          </FormRow>
          <FormRow label={t('ps.email')} required={requiredFields.has('email')} editing={editing} display={<ReadValue value={profile.email} />}>
            {/* The account's email. It is not editable in any profile screen, so
                it stays out of the form state and out of the save payload. */}
            <input value={profile.email || ''} disabled className={`${inputClasses} cursor-not-allowed text-slate-500`} />
          </FormRow>
          <FormRow label={t('ps.phoneShort')} required={requiredFields.has('phone')} error={fieldErrors.phone} editing={editing} display={<ReadValue value={profile.phone} />}>
            <input ref={registerField('phone')} type="tel" value={form.phone || ''} onChange={(event) => updateField('phone', event.target.value)} className={fieldClass('phone')} />
          </FormRow>
          <FormRow label={t('ps.address')} required={requiredFields.has('address')} error={fieldErrors.address} editing={editing} display={<ReadValue value={profile.address} />}>
            <input ref={registerField('address')} value={form.address || ''} onChange={(event) => updateField('address', event.target.value)} className={fieldClass('address')} />
          </FormRow>
          <FormRow label={t('ps.pincode')} required={requiredFields.has('pincode')} error={fieldErrors.pincode} editing={editing} display={<ReadValue value={profile.pincode} />}>
            <input ref={registerField('pincode')} value={form.pincode || ''} onChange={(event) => updateField('pincode', event.target.value)} className={fieldClass('pincode')} />
            <PincodeAreaHint lookupState={pincodeLookupState} />
          </FormRow>
        </div>
      </SectionCard>

      {/* Professional Information */}
      <SectionCard
        title={t('cps.professionalInformation')}
        icon={BriefcaseBusiness}
        action={!editing && <EditButton onClick={startEditing} />}
      >
        <div className="divide-y divide-slate-100">
          <FormRow label={t('ps.con.companyName')} required={requiredFields.has('company_name')} error={fieldErrors.company_name} editing={editing} display={<ReadValue value={profile.company_name} />}>
            <input ref={registerField('company_name')} value={form.company_name || ''} onChange={(event) => updateField('company_name', event.target.value)} className={fieldClass('company_name')} />
          </FormRow>
          <FormRow label={t('ps.con.licenseNumber')} required={requiredFields.has('license_number')} error={fieldErrors.license_number} editing={editing} display={<ReadValue value={profile.license_number} />}>
            <input ref={registerField('license_number')} value={form.license_number || ''} onChange={(event) => updateField('license_number', event.target.value)} className={fieldClass('license_number')} />
          </FormRow>
          <FormRow label={t('ps.gstin')} required={requiredFields.has('gstin')} error={fieldErrors.gstin} editing={editing} display={<ReadValue value={profile.gstin} />}>
            <input ref={registerField('gstin')} value={form.gstin || ''} onChange={(event) => updateField('gstin', event.target.value)} className={fieldClass('gstin')} />
          </FormRow>
          <FormRow label={t('ps.pan')} required={requiredFields.has('pan')} error={fieldErrors.pan} editing={editing} display={<ReadValue value={profile.pan} />}>
            <input ref={registerField('pan')} value={form.pan || ''} onChange={(event) => updateField('pan', event.target.value)} className={fieldClass('pan')} />
          </FormRow>
          <FormRow label={t('ps.website')} required={requiredFields.has('website')} hint={t('cps.websiteHint')} error={fieldErrors.website} editing={editing} display={<ReadValue value={profile.website} />}>
            <input ref={registerField('website')} value={form.website || ''} onChange={(event) => updateField('website', event.target.value)} className={fieldClass('website')} />
          </FormRow>
          <FormRow label={t('ps.businessType')} required={requiredFields.has('business_type')} error={fieldErrors.business_type} editing={editing} display={<ReadValue value={profile.business_type ? optionLabel(t, BUSINESS_TYPE_KEYS, profile.business_type) : profile.business_type} />}>
            <select ref={registerField('business_type')} value={form.business_type || ''} onChange={(event) => updateField('business_type', event.target.value)} className={`${fieldClass('business_type')} appearance-none`}>
              <option value="">{t('cps.selectField', { label: t('ps.businessType') })}</option>
              {businessTypeOptions.map((option) => <option key={option} value={option}>{optionLabel(t, BUSINESS_TYPE_KEYS, option)}</option>)}
            </select>
          </FormRow>
          <FormRow label={t('ps.registrationYear')} required={requiredFields.has('registration_year')} error={fieldErrors.registration_year} editing={editing} display={<ReadValue value={profile.registration_year} />}>
            <input ref={registerField('registration_year')} type="number" value={form.registration_year ?? ''} onChange={(event) => updateField('registration_year', event.target.value)} className={fieldClass('registration_year')} />
          </FormRow>
          <FormRow label={t('ps.con.teamSize')} required={requiredFields.has('team_size')} error={fieldErrors.team_size} editing={editing} display={<ReadValue value={profile.team_size} />}>
            <input ref={registerField('team_size')} value={form.team_size || ''} onChange={(event) => updateField('team_size', event.target.value)} className={fieldClass('team_size')} />
          </FormRow>
          <FormRow label={t('cps.yearsOfExperience')} required={requiredFields.has('experience_years')} error={fieldErrors.experience_years} editing={editing} display={<ReadValue value={profile.experience_years} />}>
            <input ref={registerField('experience_years')} type="number" min="1" step="1" inputMode="numeric" value={form.experience_years ?? ''} onChange={(event) => updateField('experience_years', event.target.value)} className={fieldClass('experience_years')} />
          </FormRow>
          <FormRow label={t('ps.eng.about')} required={requiredFields.has('about')} error={fieldErrors.about} editing={editing} display={<ReadValue value={profile.about} />}>
            <textarea ref={registerField('about')} rows={3} value={form.about || ''} onChange={(event) => updateField('about', event.target.value)} className={areaClass('about')} />
          </FormRow>
        </div>
      </SectionCard>

      {/* Services & Work */}
      <SectionCard
        title={t('cps.servicesWork')}
        icon={HardHat}
        action={!editing && <EditButton onClick={startEditing} />}
      >
        <div className="divide-y divide-slate-100">
          <FormRow
            label={t('ps.con.servicesOffered')}
            required={requiredFields.has('services_offered')}
            error={fieldErrors.services_offered}
            editing={editing}
            display={<Chips items={profile.services_offered} keys={SERVICE_OPTION_KEYS} />}
          >
            {/* The same six choices Complete Profile offers. A saved service
                outside them is kept, listed after them, and can be unticked. */}
            <div ref={registerField('services_offered')} tabIndex={-1} className="flex flex-wrap gap-1.5 outline-none">
              {[...contractorServiceOptions, ...splitEditableList(form.services_offered).filter((item) => !contractorServiceOptions.includes(item))].map((service) => {
                const selected = splitEditableList(form.services_offered).includes(service)
                return (
                  <button
                    key={service}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => toggleService(service)}
                    className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-bold transition ${
                      selected ? 'border-brand-500 bg-brand-50 text-brand-800' : 'border-slate-200 bg-white text-slate-600 hover:border-brand-300'
                    }`}
                  >
                    {selected && <CheckCircle2 className="h-3.5 w-3.5" />}
                    {optionLabel(t, SERVICE_OPTION_KEYS, service)}
                  </button>
                )
              })}
            </div>
          </FormRow>
          <FormRow
            label={t('ps.con.serviceLocations')}
            required={requiredFields.has('service_locations')}
            hint={t('cps.serviceLocationsHint')}
            error={fieldErrors.service_locations}
            editing={editing}
            display={<Chips items={profile.service_locations} />}
          >
            <input ref={registerField('service_locations')} value={form.service_locations || ''} onChange={(event) => updateField('service_locations', event.target.value)} className={fieldClass('service_locations')} />
            {pincodeLocations && (
              <div className="mt-2 flex gap-2">
                <input value={locationPincode} onChange={(event) => { setLocationPincode(event.target.value); setLocationBranches([]) }} inputMode="numeric" maxLength={6}
                  onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addLocationByPincode() } }}
                  placeholder={t('subscription.location.pincodePlaceholder')} disabled={Boolean(serviceLocationUsage?.atLimit)}
                  className="h-10 min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold outline-none focus:border-emerald-500 disabled:bg-slate-100" />
                <button type="button" onClick={addLocationByPincode} disabled={locationBusy || Boolean(serviceLocationUsage?.atLimit)}
                  className="inline-flex h-10 shrink-0 items-center rounded-lg bg-slate-900 px-4 text-sm font-bold text-white hover:bg-slate-800 disabled:opacity-50">
                  {t('subscription.location.add')}
                </button>
              </div>
            )}
            {/* Every post office under the pincode; the one picked is added. */}
            {pincodeLocations && locationBranches.length > 0 && (
              <PincodeAreaHint
                lookupState={{ status: 'success', branches: locationBranches, message: locationBranches[0].display }}
                onSelectBranch={addLocationBranch}
              />
            )}
          </FormRow>
          {serviceLocationUsage && (
            <div className="grid gap-2 px-1 pb-2">
              <p className="text-xs font-bold text-slate-600">
                {serviceLocationUsage.limit === null ? t('subscription.usage.locationsUnlimited', { used: serviceLocationUsage.used })
                  : t('subscription.usage.locations', { used: serviceLocationUsage.used, limit: serviceLocationUsage.limit, remaining: serviceLocationUsage.remaining })}
              </p>
              {serviceLocationUsage.atLimit && (
                <UpgradePrompt kind="locations" planCode={promptPlan(subscriptionStatus)} limit={serviceLocationUsage.limit} status={subscriptionStatus} compact />
              )}
            </div>
          )}
          <FormRow
            label={t('ps.con.equipmentOwned')}
            required={requiredFields.has('equipment_owned')}
            hint={contractorEquipmentOptions.slice(0, 3).map((e) => optionLabel(t, EQUIPMENT_OPTION_KEYS, e)).join(', ') + '…'}
            error={fieldErrors.equipment_owned}
            editing={editing}
            display={<Chips items={profile.equipment_owned} keys={EQUIPMENT_OPTION_KEYS} />}
          >
            <input ref={registerField('equipment_owned')} value={form.equipment_owned || ''} onChange={(event) => updateField('equipment_owned', event.target.value)} className={fieldClass('equipment_owned')} />
          </FormRow>
          <FormRow
            label={t('cps.insurance')}
            required={requiredFields.has('insurance_available')}
            error={fieldErrors.insurance_available}
            editing={editing}
            display={
              <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${profile.insurance_available ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                {profile.insurance_available ? t('cps.available') : t('cps.notAvailable')}
              </span>
            }
          >
            <label className="flex h-10 items-center gap-2 text-sm font-bold text-slate-700">
              <input
                ref={registerField('insurance_available')}
                type="checkbox"
                checked={Boolean(form.insurance_available)}
                onChange={(event) => updateField('insurance_available', event.target.checked)}
                className="h-4 w-4 rounded border-brand-200 accent-brand-600"
              />
              {form.insurance_available ? t('cps.insuranceAvailable') : t('cps.insuranceNotAvailable')}
            </label>
          </FormRow>
        </div>
      </SectionCard>

      {/* Projects & Portfolio */}
      <SectionCard
        title={t('cps.projectsPortfolio')}
        icon={Boxes}
        // Adds a portfolio project here. The old "Manage in Projects" button
        // opened the construction projects awarded through CREWNBUILD, which
        // are not the portfolio and stay on the Projects page.
        action={portfolioProjects.length < PORTFOLIO_MAX_PROJECTS && (
          <button
            type="button"
            onClick={addPortfolioProject}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-brand-600 px-3.5 text-xs font-extrabold text-white transition hover:bg-brand-700"
          >
            <Plus className="h-3.5 w-3.5" /> {t('cps.portfolio.add')}
          </button>
        )}
      >
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <SummaryTile label={t('cps.completedProjects')} value={portfolioProjects.length} />
            <SummaryTile label={t('ps.documents')} value={documentList.length} />
          </div>

          <div>
            <p className="mb-1 text-xs font-extrabold uppercase tracking-wide text-slate-400">{t('cps.completedProjectDetails')}</p>
            <p className="mb-2 text-[11px] font-medium text-slate-400">{t('cps.portfolio.limit', { count: PORTFOLIO_MAX_PROJECTS, photos: PORTFOLIO_MAX_IMAGES })}</p>
            <FieldError message={fieldErrors.completed_project_details} />
            {portfolioProjects.length ? (
              <div className="grid grid-cols-1 gap-2.5 lg:grid-cols-2">
                {portfolioProjects.map((project, index) => (
                  <div key={`portfolio-${index}`} className="rounded-xl border border-slate-200 p-3.5">
                    {editing ? (
                      <div className="space-y-2">
                        <div className="flex items-start gap-2">
                          <input
                            ref={index === 0 ? registerField('completed_project_details') : undefined}
                            value={project.title}
                            onChange={(event) => updatePortfolioProject(index, 'title', event.target.value)}
                            placeholder={t('dash.owner.projectForm.titlePh')}
                            aria-label={t('dash.owner.projectForm.titlePh')}
                            className={!String(project.title || '').trim() && fieldErrors.completed_project_details ? `${inputClasses.replace('border-slate-200 ', '').replace('bg-slate-50 ', '')} ${INVALID_FIELD_CLASS}` : inputClasses}
                          />
                          <button
                            type="button"
                            onClick={() => removePortfolioProject(index)}
                            title={t('shop.remove')}
                            aria-label={t('shop.remove')}
                            className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-slate-200 text-slate-400 transition hover:border-red-200 hover:bg-red-50 hover:text-red-600"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                        <input
                          value={project.location}
                          onChange={(event) => updatePortfolioProject(index, 'location', event.target.value)}
                          placeholder={t('ps.location')}
                          aria-label={t('ps.location')}
                          className={inputClasses}
                        />
                        <textarea
                          rows={2}
                          value={project.description}
                          onChange={(event) => updatePortfolioProject(index, 'description', event.target.value)}
                          placeholder={t('dash.common.description')}
                          aria-label={t('dash.common.description')}
                          className={areaClasses}
                        />
                      </div>
                    ) : (
                      <>
                        <p className="text-sm font-extrabold text-slate-900">{td(project.title) || t('ui.requests.project', { n: index + 1 })}</p>
                        {project.location && <p className="mt-0.5 flex items-center gap-1 text-xs font-bold text-brand-700"><MapPin className="h-3 w-3" /> {td(project.location)}</p>}
                        {project.description && <p className="mt-1 text-xs leading-5 text-slate-600">{td(project.description)}</p>}
                      </>
                    )}
                    {/* This project's own photos. */}
                    {(project.images?.length > 0 || editing) && (
                      <div className="mt-2.5 grid grid-cols-3 gap-1.5 sm:grid-cols-4">
                        {(project.images || []).map((image) => (
                          <div key={image} className="group relative overflow-hidden rounded-lg border border-slate-200">
                            <SmartImage src={imageUrl(image)} alt="" className="h-16 w-full object-cover" />
                            {editing && (
                              <button
                                type="button"
                                onClick={() => removePortfolioPhoto(index, image)}
                                className="absolute right-1 top-1 grid h-5 w-5 place-items-center rounded-full bg-slate-900/70 text-white"
                                title={t('ps.con.removeImage')}
                                aria-label={t('ps.con.removeImage')}
                              >
                                <X className="h-3 w-3" />
                              </button>
                            )}
                          </div>
                        ))}
                        {editing && (project.images || []).length < PORTFOLIO_MAX_IMAGES && (
                          <label className="grid h-16 cursor-pointer place-items-center rounded-lg border border-dashed border-slate-300 bg-slate-50 text-center text-[10px] font-extrabold text-brand-700 transition hover:bg-brand-50">
                            {listBusy === `portfolio-${index}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <span className="grid place-items-center gap-0.5"><ImagePlus className="h-4 w-4" />{t('cps.portfolio.addPhotos')}</span>}
                            <input type="file" multiple accept={PROFILE_IMAGE_ACCEPT} className="sr-only" onChange={(event) => { const files = Array.from(event.target.files || []); event.target.value = ''; uploadPortfolioPhotos(index, files) }} />
                          </label>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="rounded-lg border border-dashed border-slate-200 bg-slate-50/60 px-3 py-4 text-center text-xs font-semibold text-slate-400">{t('cps.portfolio.empty')}</p>
            )}
          </div>

          <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
            {/* Gallery */}
            <div>
              <div className="mb-2 flex items-center justify-between gap-3">
                <p className="flex items-center gap-1.5 text-xs font-extrabold uppercase tracking-wide text-slate-400"><Images className="h-3.5 w-3.5" /> {t('cps.gallery')}</p>
                {editing && (
                  <label className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-[11px] font-extrabold text-brand-700 transition hover:border-brand-300 hover:bg-brand-50">
                    {listBusy === 'gallery' ? <Loader2 className="h-3 w-3 animate-spin" /> : <GalleryVerticalEnd className="h-3 w-3" />} {t('cps.upload')}
                    <input type="file" multiple accept={PROFILE_IMAGE_ACCEPT} className="sr-only" onChange={(event) => { const files = Array.from(event.target.files || []); event.target.value = ''; uploadListFiles('gallery', files) }} />
                  </label>
                )}
              </div>
              {galleryImages.length ? (
                <div className="grid grid-cols-3 gap-2">
                  {galleryImages.map((image) => (
                    <div key={image} className="group relative overflow-hidden rounded-lg border border-slate-200">
                      <SmartImage src={imageUrl(image)} alt="" className="h-16 w-full object-cover" />
                      {editing && (
                        <button
                          type="button"
                          onClick={() => removeListItem('gallery', image)}
                          className="absolute right-1 top-1 grid h-5 w-5 place-items-center rounded-full bg-slate-900/70 text-white opacity-0 transition group-hover:opacity-100"
                          title={t('ps.con.removeImage')}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="rounded-lg border border-dashed border-slate-200 bg-slate-50/60 px-3 py-4 text-center text-xs font-semibold text-slate-400">{t('cps.noGalleryImages')}</p>
              )}
            </div>

            {/* Documents */}
            <div>
              <div className="mb-2 flex items-center justify-between gap-3">
                <p className="flex items-center gap-1.5 text-xs font-extrabold uppercase tracking-wide text-slate-400"><FileText className="h-3.5 w-3.5" /> {t('ps.documents')}</p>
              </div>
              {editing && (
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <select
                    value={documentType}
                    onChange={(event) => setDocumentType(event.target.value)}
                    aria-label={t('cps.documentType')}
                    className="h-8 min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-2 text-xs font-bold text-slate-700 outline-none focus:border-brand-400"
                  >
                    <option value="">{t('cps.selectField', { label: t('cps.documentType') })}</option>
                    {contractorDocumentTypes.map((type) => <option key={type} value={type}>{optionLabel(t, DOCUMENT_TYPE_KEYS, type)}</option>)}
                  </select>
                  <label className={`inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-[11px] font-extrabold text-brand-700 transition ${documentType ? 'cursor-pointer hover:border-brand-300 hover:bg-brand-50' : 'cursor-not-allowed opacity-50'}`}>
                    {listBusy === 'documents' ? <Loader2 className="h-3 w-3 animate-spin" /> : <ShieldCheck className="h-3 w-3" />} {t('cps.upload')}
                    <input type="file" disabled={!documentType} accept=".pdf,.jpg,.jpeg,.png,.webp" className="sr-only" onChange={(event) => { const files = Array.from(event.target.files || []); event.target.value = ''; uploadListFiles('documents', files) }} />
                  </label>
                </div>
              )}
              {documentList.length ? (
                <div className="space-y-1.5">
                  {documentList.map((documentUrl) => {
                    const { type, url } = splitDocumentEntry(documentUrl)
                    return (
                    <div key={documentUrl} className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50/70 px-3 py-2">
                      <span className="flex min-w-0 items-center gap-2 text-xs font-bold text-slate-700">
                        <FileText className="h-3.5 w-3.5 shrink-0 text-brand-600" />
                        <span className="truncate">{type ? optionLabel(t, DOCUMENT_TYPE_KEYS, type) : documentFileName(url)}</span>
                      </span>
                      {url && (
                        <a href={imageUrl(url)} target="_blank" rel="noreferrer" title={documentFileName(url)} className="ml-auto grid h-5 w-5 shrink-0 place-items-center rounded-full text-brand-700 transition hover:bg-brand-50">
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                      {editing && (
                        <button
                          type="button"
                          onClick={() => removeListItem('documents', documentUrl)}
                          className="grid h-5 w-5 shrink-0 place-items-center rounded-full text-slate-400 transition hover:bg-red-50 hover:text-red-600"
                          title={t('cps.removeDocument')}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                    )
                  })}
                </div>
              ) : (
                <p className="rounded-lg border border-dashed border-slate-200 bg-slate-50/60 px-3 py-4 text-center text-xs font-semibold text-slate-400">{t('cps.noDocumentsUploaded')}</p>
              )}
            </div>
          </div>
        </div>
      </SectionCard>

      {/* One Save for the whole profile, at the bottom of the edit section, and
          only while editing. No field saves on its own. */}
      {editing && (
        <div className="flex flex-wrap items-center justify-end gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-[0_14px_40px_-30px_rgba(15,23,42,0.35)]">
          {formError && (
            <p className="mr-auto flex min-w-0 items-center gap-2 text-sm font-bold text-red-700">
              <AlertTriangle className="h-4 w-4 shrink-0" /> {formError}
            </p>
          )}
          <button
            type="button"
            onClick={cancelEdits}
            disabled={saving}
            className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-extrabold text-slate-600 transition hover:bg-slate-50 disabled:opacity-60"
          >
            <X className="h-3.5 w-3.5" /> {t('ce.cancel')}
          </button>
          <button
            type="button"
            onClick={saveProfile}
            disabled={saving}
            className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-brand-600 px-4 text-xs font-extrabold text-white transition hover:bg-brand-700 disabled:opacity-60"
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            {saving ? t('dash.common.saving') : t('cps.save')}
          </button>
        </div>
      )}
    </div>
  )
}
