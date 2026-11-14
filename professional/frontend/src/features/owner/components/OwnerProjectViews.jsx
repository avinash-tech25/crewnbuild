import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, Calculator, Calendar, Globe2, HardHat, Home, IndianRupee, MapPin, Pencil, Plus, RotateCw, Save, Trash2, X } from 'lucide-react'
import PincodeAreaHint from '../../../shared/ui/PincodeAreaHint.jsx'
import BudgetInWords from '../../../shared/ui/BudgetInWords.jsx'
import StatusPill from '../../../shared/dashboard/StatusPill.jsx'
import { EntityCard } from '../../../shared/ui/EntityCard.jsx'
import { EntityAvatar } from '../../../shared/ui/EntityPill.jsx'
import { usePincodeAreaLookup } from '../../../shared/hooks/usePincodeAreaLookup.js'
import { SmartImage } from '../../../shared/ui/ui.jsx'
import ProjectCameraPanel from '../../cameras/components/ProjectCameraPanel.jsx'
import { imageUrl } from '../../../shared/api/apiClient.js'
import { cancelAward, fetchProjectAward } from '../../requests/requestsApi.js'
import { useLiveVersion } from '../../../shared/hooks/useLiveRefresh.js'
import { createProjectRequest, updateProjectRequirement } from '../../projects/projectsApi.js'
import { calculatePublicEstimate } from '../../estimate/estimateApi.js'
import { PROJECT_COUNTRIES, projectCityOptions, projectStateOptions } from '../../../shared/utils/projectLocations.js'
import SiteEngineerDashboard from '../../site-work/components/SiteEngineerDashboard.jsx'
import { builderIdOnRequest, buildingTypeText, constructionTypeText, countryText, formatProjectDate, money, normalizeEstimateText, projectBuilderContext, projectScheduleProblem } from '../ownerHelpers.js'
import { Card, EmptyState } from './OwnerPanels.jsx'
import { useLanguage } from '../../../i18n/LanguageContext.jsx'
import { fetchOwnerProjectAnalysis } from '../../projects/costToolApi.js'
import { analysisError } from '../ownerProjectAnalysis.js'
import OwnerProjectAnalysisPanel from './OwnerProjectAnalysisPanel.jsx'
import OwnerProjectAnalysisView from './OwnerProjectAnalysisView.jsx'
import { floorCountFor, floorOptionsForCountry, floorTypeForCount, floorTypeLabel } from '../../../shared/utils/floorOptions.js'
import { completionPercent, completionText, formatPercent, scheduleText, scheduleWidth } from '../../../shared/utils/projectProgress.js'
import { COMPLIANCE_STATUS_KEYS, FLOOR_TYPE_KEYS, optionLabel } from '../../../i18n/optionKeys.js'

// Two place names are the same place when they differ only in case, spacing,
// punctuation or "&" for "and" ("Jammu & Kashmir" / "Jammu and Kashmir"). Used
// to compare the form's State and City with what India Post returned.
function placeKey(value) {
  return String(value || '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]/g, '')
}
function samePlace(a, b) {
  return Boolean(placeKey(a)) && placeKey(a) === placeKey(b)
}
// India Post still spells a few states and union territories by older names.
// These are name changes only (no pincode or place data): the India Post name
// on the left may mean any form State on the right.
const INDIA_POST_STATE_NAMES = {
  chattisgarh: ['Chhattisgarh'],
  pondicherry: ['Puducherry'],
  andamanandnicobar: ['Andaman and Nicobar Islands'],
  dadraandnagarhaveli: ['Dadra and Nagar Haveli and Daman and Diu'],
  damananddiu: ['Dadra and Nagar Haveli and Daman and Diu'],
  // Ladakh's pincodes are still filed under Jammu & Kashmir.
  jammuandkashmir: ['Jammu and Kashmir', 'Ladakh'],
}
function sameState(indiaPostState, formState) {
  return samePlace(indiaPostState, formState)
    || (INDIA_POST_STATE_NAMES[placeKey(indiaPostState)] || []).some((name) => samePlace(name, formState))
}
function uniquePlaces(values) {
  const seen = new Map()
  values.filter(Boolean).forEach((value) => { if (!seen.has(placeKey(value))) seen.set(placeKey(value), value) })
  return [...seen.values()]
}

export function ProjectForm({ onProjectCreated, defaultCountry: accountCountry = 'India' }) {
  const { t, td } = useLanguage()
  // Projects are created in India only; an account's older residence never
  // preselects a country the form no longer offers.
  const defaultCountry = PROJECT_COUNTRIES.some((country) => country.value === accountCountry) ? accountCountry : 'India'
  const [projectDetails, setProjectDetails] = useState({
    title: '',
    description: '',
    address: '',
    pincode: '',
    project_country: defaultCountry,
    project_state: '',
    project_city: '',
    building_type: 'RESIDENTIAL',
    construction_type: 'CONTRACTOR',
    budget: '',
    land_area: '',
    floors: 1,
    floor_type: '',
    start_date: '',
    end_date: '',
  })
  const [projectFormMessage, setProjectFormMessage] = useState('')
  // The estimate belongs to THIS draft and nothing else. It lives beside
  // projectDetails in this component's state, so a second project started
  // afterwards begins with both cleared and can never inherit the first one's
  // figures. Nothing is sent to the server until Create Project is submitted.
  //
  // `estimateResult` is what the calculator last returned and is only being
  // reviewed; `acceptedEstimate` is the one the person said yes to, and it is
  // the only thing the create payload ever carries.
  const [finishingType, setFinishingType] = useState('standard')
  const [estimateResult, setEstimateResult] = useState(null)
  const [acceptedEstimate, setAcceptedEstimate] = useState(null)
  const [isEstimating, setIsEstimating] = useState(false)
  const [estimateMessage, setEstimateMessage] = useState('')
  const [isCreatingProject, setIsCreatingProject] = useState(false)
  const [projectImageFile, setProjectImageFile] = useState(null)
  const [selectedPincodeBranch, setSelectedPincodeBranch] = useState(null)
  // Set by a Create attempt, so a location left unfinished is shown in red.
  const [showLocationErrors, setShowLocationErrors] = useState(false)
  // City and Address the pincode filled in (not typed or picked by the owner).
  // Those follow the pincode and are cleared when it changes; anything the
  // owner chose themselves is kept, and checked against the pincode instead.
  const cityFromPincodeRef = useRef(false)
  const autoAddressRef = useRef('')
  // The State the pincode filled in; it follows the pincode the same way.
  const stateFromPincodeRef = useRef(false)

  const updateProjectField = (field, value) => {
    setProjectDetails((currentProjectDetails) => ({ ...currentProjectDetails, [field]: value }))
  }

  // Location values that were derived from a pincode and no longer apply.
  // Worked out here, in the event handler, so the state updates stay pure.
  const staleLocationReset = () => {
    const reset = {}
    if (cityFromPincodeRef.current) reset.project_city = ''
    if (stateFromPincodeRef.current) reset.project_state = ''
    if (autoAddressRef.current && projectDetails.address === autoAddressRef.current) reset.address = ''
    cityFromPincodeRef.current = false
    stateFromPincodeRef.current = false
    autoAddressRef.current = ''
    return reset
  }

  const handleCountryChange = (country) => {
    const reset = staleLocationReset()
    setSelectedPincodeBranch(null)
    setProjectDetails((currentProjectDetails) => ({ ...currentProjectDetails, ...reset, project_country: country, project_state: '', project_city: '' }))
  }

  // A new State re-checks the pincode against it; the branch, city and address
  // picked under the old State no longer stand.
  const handleStateChange = (state) => {
    const reset = staleLocationReset()
    setSelectedPincodeBranch(null)
    setProjectDetails((currentProjectDetails) => ({ ...currentProjectDetails, ...reset, project_state: state, project_city: '' }))
  }

  // A new pincode means a new lookup: the old branch, and the city and address
  // it filled in, are cleared rather than left looking valid.
  // The pincode comes first. Six digits is an Indian pincode, recognised as it
  // is typed; the lookup then fills State/City from it.
  const switchCountryForPincode = (pincode, country) => {
    setProjectDetails((currentProjectDetails) => (
      country && country !== currentProjectDetails.project_country
        ? { ...currentProjectDetails, pincode, project_country: country, project_state: '', project_city: '' }
        : { ...currentProjectDetails, pincode }
    ))
  }
  const handlePincodeChange = (pincode) => {
    const reset = staleLocationReset()
    setSelectedPincodeBranch(null)
    setProjectDetails((currentProjectDetails) => ({ ...currentProjectDetails, ...reset }))
    switchCountryForPincode(pincode, /^\d{6}$/.test(String(pincode || '').trim()) ? 'India' : null)
  }
  const handleCityChange = (city) => {
    cityFromPincodeRef.current = false
    updateProjectField('project_city', city)
  }

  // Picking a postal branch fills City from it. Site Address is always typed
  // by the owner; nothing fills it in.
  const selectPincodeBranch = (branch) => {
    if (branch.city) cityFromPincodeRef.current = true
    setSelectedPincodeBranch(branch)
    setProjectDetails((currentProjectDetails) => ({
      ...currentProjectDetails,
      project_city: branch.city || currentProjectDetails.project_city,
    }))
  }

  const applyResolvedArea = useCallback((areaDetails) => {
    setProjectDetails((currentProjectDetails) => {
      // India: the pincode is entered first, so its State is filled in from
      // India Post, and its City too when every branch shares one. A State the
      // owner then changes is checked against the pincode, and a mismatch is
      // shown rather than "corrected". Site Address is never filled in.
      const branches = Array.isArray(areaDetails.post_offices) ? areaDetails.post_offices : []
      const lookupStateNames = uniquePlaces(branches.map((branch) => branch.state))
      const lookupCityNames = uniquePlaces(branches.map((branch) => branch.city))
      const matchingState = projectStateOptions('India').find((state) => lookupStateNames.some((name) => sameState(name, state))) || ''
      const onlyCity = lookupCityNames.length === 1 ? lookupCityNames[0] : ''
      if (matchingState) stateFromPincodeRef.current = true
      if (onlyCity) cityFromPincodeRef.current = true
      return {
        ...currentProjectDetails,
        pincode: areaDetails.pincode || currentProjectDetails.pincode,
        ...(matchingState ? { project_state: matchingState } : {}),
        ...(onlyCity ? { project_city: onlyCity } : {}),
      }
    })
  }, [])
  const pincodeLookupState = usePincodeAreaLookup(projectDetails.pincode, applyResolvedArea, projectDetails.project_country)

  // How the State, Postal branch and City agree with the India Post result for
  // this pincode. India Post is the only source: nothing here knows any place.
  const isIndiaProject = (projectDetails.project_country || defaultCountry) === 'India'
  const lookupBranches = isIndiaProject && pincodeLookupState.status === 'success' ? pincodeLookupState.branches || [] : []
  const lookupStates = uniquePlaces(lookupBranches.map((branch) => branch.state))
  const lookupCities = uniquePlaces(lookupBranches.map((branch) => branch.city))
  const stateMismatch = lookupBranches.length > 0 && Boolean(projectDetails.project_state)
    && !lookupStates.some((state) => sameState(state, projectDetails.project_state))
  const branchMismatch = Boolean(selectedPincodeBranch) && lookupBranches.length > 0
    && !lookupBranches.some((branch) => branch.name === selectedPincodeBranch.name && branch.pincode === selectedPincodeBranch.pincode)
  const cityMismatch = lookupBranches.length > 0 && Boolean(projectDetails.project_city)
    && !lookupCities.some((city) => samePlace(city, projectDetails.project_city))
  // Branches can be chosen once the State agrees with the pincode.
  const branchesSelectable = lookupBranches.length > 0 && Boolean(projectDetails.project_state) && !stateMismatch
  const missingState = isIndiaProject && showLocationErrors && !projectDetails.project_state
  const missingBranch = isIndiaProject && showLocationErrors && branchesSelectable && !selectedPincodeBranch
  const missingCity = isIndiaProject && showLocationErrors && !projectDetails.project_city
  // Only the cities India Post returned (plus a city chosen earlier that does
  // not match, so it can be seen and corrected); the State's list until then.
  const cityOptions = lookupBranches.length > 0
    ? [...lookupCities, ...(projectDetails.project_city && cityMismatch ? [projectDetails.project_city] : [])]
    : projectCityOptions(projectDetails.project_country, projectDetails.project_state)

  // A pincode with a single branch has nothing to choose between.
  const onlyBranch = branchesSelectable && lookupBranches.length === 1 ? lookupBranches[0] : null
  useEffect(() => {
    if (onlyBranch && !selectedPincodeBranch) selectPincodeBranch(onlyBranch)
    // selectPincodeBranch only writes state; listing it would re-run every render.
  }, [onlyBranch, selectedPincodeBranch])

  const locationFieldClass = (invalid, extraClass = '') => `${extraClass} rounded-xl border px-3 py-2 text-sm outline-none ${
    invalid ? 'border-red-500 bg-red-50 ring-1 ring-red-200 focus:border-red-500' : 'border-oc-line focus:border-ocbrand-400'
  }`

  // Always the values in the form right now: read at click time, never cached,
  // so changing a field and asking again returns a figure for the new values.
  const requestEstimate = async () => {
    setEstimateMessage('')
    const plotArea = Number(projectDetails.land_area || 0)
    if (plotArea <= 0) {
      setEstimateMessage(t('cp.val.landArea'))
      return
    }
    setIsEstimating(true)
    // A fresh calculation replaces whatever was accepted before, so what is
    // accepted always matches what is on screen.
    setAcceptedEstimate(null)
    try {
      const country = projectDetails.project_country || defaultCountry
      setEstimateResult(await calculatePublicEstimate({
        country,
        location: [projectDetails.project_city, projectDetails.project_state].filter(Boolean).join(', '),
        pincode: projectDetails.pincode,
        plot_area: plotArea,
        floors: floorCountFor(country, projectDetails.floor_type, projectDetails.floors === '' ? 1 : projectDetails.floors),
        floor_type: projectDetails.floor_type || null,
        construction_type: projectDetails.construction_type,
        building_type: projectDetails.building_type,
        finishing_type: finishingType,
        budget: Number(projectDetails.budget || 0),
      }))
    } catch (error) {
      setEstimateResult(null)
      setEstimateMessage(error.response?.data?.detail || t('site.estimate.errCalc'))
    } finally {
      setIsEstimating(false)
    }
  }

  const acceptEstimate = () => setAcceptedEstimate(estimateResult)
  // Declining keeps the project draft exactly as it was: nothing is accepted,
  // so the create payload carries no estimate and the four columns stay NULL.
  const declineEstimate = () => {
    setAcceptedEstimate(null)
    setEstimateResult(null)
  }

  const submitProject = async (event) => {
    event.preventDefault()
    setProjectFormMessage('')
    // An Indian project pincode must be six digits that India Post knows and
    // maps to a district and state; each failure says which one it was.
    if ((projectDetails.project_country || defaultCountry) === 'India' && pincodeLookupState.status !== 'success') {
      const pincodeMessageKeys = {
        loading: 'location.fetching',
        unknown: 'location.unknown',
        unmapped: 'location.unmapped',
        unavailable: 'location.unavailable',
      }
      setProjectFormMessage(t(pincodeMessageKeys[pincodeLookupState.status] || 'location.invalid'))
      return
    }
    // ...and the State, Postal branch and City must all be the pincode's own.
    if (isIndiaProject) {
      const locationProblem = stateMismatch ? 'location.stateMismatch'
        : branchMismatch ? 'location.branchMismatch'
          : cityMismatch ? 'location.cityMismatch'
            : (!projectDetails.project_state || !selectedPincodeBranch || !projectDetails.project_city) ? 'location.selectValid'
              : ''
      if (locationProblem) {
        setShowLocationErrors(true)
        setProjectFormMessage(t(locationProblem))
        return
      }
    }
    const scheduleProblem = projectScheduleProblem(projectDetails.start_date, projectDetails.end_date)
    if (scheduleProblem) {
      setProjectFormMessage(t(scheduleProblem))
      return
    }
    setIsCreatingProject(true)

    const projectPayload = {
      title: projectDetails.title.trim(),
      description: projectDetails.description.trim(),
      address: projectDetails.address.trim(),
      pincode: projectDetails.pincode.trim(),
      project_country: projectDetails.project_country || defaultCountry,
      project_state: projectDetails.project_state || '',
      project_city: projectDetails.project_city || '',
      building_type: projectDetails.building_type,
      construction_type: projectDetails.construction_type,
      budget: projectDetails.budget === '' ? 0 : Number(projectDetails.budget),
      land_area: projectDetails.land_area === '' ? 0 : Number(projectDetails.land_area),
      // Derived so the numeric column and every existing consumer are unchanged.
      floors: floorCountFor(projectDetails.project_country, projectDetails.floor_type, projectDetails.floors === '' ? 1 : projectDetails.floors),
      floor_type: projectDetails.floor_type || null,
      // The owner's schedule, as entered ("YYYY-MM-DD").
      start_date: projectDetails.start_date,
      end_date: projectDetails.end_date,
      // Only when one was accepted. Omitted otherwise, so the API applies its
      // existing defaults and the project is created exactly as it always was.
      ...(acceptedEstimate ? {
        estimated_cost: acceptedEstimate.estimated_cost,
        estimated_duration_days: acceptedEstimate.estimated_duration_days,
        material_estimate: acceptedEstimate.material_estimate,
        labour_estimate: acceptedEstimate.labour_estimate,
      } : {}),
    }

    try {
      let createProjectPayload = projectPayload
      if (projectImageFile) {
        createProjectPayload = new FormData()
        // An unset value is left out: FormData would send null as the text "null".
        Object.entries(projectPayload).forEach(([key, value]) => {
          if (value !== null && value !== undefined) createProjectPayload.append(key, value)
        })
        createProjectPayload.append('image', projectImageFile)
      }

      const createdProject = await createProjectRequest(createProjectPayload)
      setProjectDetails({
        title: '',
        description: '',
        address: '',
        pincode: '',
        project_country: defaultCountry,
        project_state: '',
        project_city: '',
        building_type: 'RESIDENTIAL',
        construction_type: 'CONTRACTOR',
        budget: '',
        land_area: '',
        floors: 1,
        floor_type: '',
        start_date: '',
        end_date: '',
      })
      setProjectImageFile(null)
      setSelectedPincodeBranch(null)
      setShowLocationErrors(false)
      cityFromPincodeRef.current = false
      autoAddressRef.current = ''
      // The estimate belonged to the project just created. The next project
      // starts with nothing accepted.
      setEstimateResult(null)
      setAcceptedEstimate(null)
      setEstimateMessage('')
      setFinishingType('standard')
      setProjectFormMessage(t('dash.owner.projectForm.created'))
      await onProjectCreated(createdProject)
    } catch (error) {
      const errorDetail = error.response?.data?.detail
      setProjectFormMessage(Array.isArray(errorDetail) ? errorDetail[0]?.msg || t('dash.owner.projectForm.createError') : errorDetail || t('dash.owner.projectForm.createError'))
    } finally {
      setIsCreatingProject(false)
    }
  }

  const estimateCountry = projectDetails.project_country || defaultCountry
  const estimateRows = estimateResult ? [
    [t('site.estimate.result.total'), money(estimateResult.estimated_cost, estimateCountry)],
    [t('site.estimate.result.perSqft'), money(estimateResult.rate_per_sqft, estimateCountry)],
    [t('site.estimate.result.builtUp'), `${Number(estimateResult.built_up_area || 0).toLocaleString('en-IN')} ${t('dash.owner.profile.sqFt')}`],
    [t('site.estimate.result.materials'), money(estimateResult.material_estimate, estimateCountry)],
    [t('site.estimate.result.labour'), money(estimateResult.labour_estimate, estimateCountry)],
    [t('site.estimate.result.duration'), t('site.estimate.result.days', { days: estimateResult.estimated_duration_days })],
  ] : []

  return (
    <div className="grid grid-cols-1 items-start gap-3 xl:grid-cols-[minmax(0,1fr)_330px]">
    <Card title={t('dash.common.createProject')} icon={Home}>
      <form onSubmit={submitProject} className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {projectFormMessage && (
          <div className="rounded-xl border border-oc-line bg-oc-mint px-4 py-3 text-sm font-semibold text-oc-deep md:col-span-2">
            {projectFormMessage}
          </div>
        )}
        <div className="md:col-span-2">
          <p className="flex items-center gap-2 font-display text-sm font-extrabold text-oc-ink">
            <Globe2 className="h-4 w-4 text-oc-green" /> {t('dash.owner.projectForm.location')}
          </p>
          <p className="mt-0.5 text-xs font-medium text-oc-muted">{t('dash.owner.projectForm.where')}</p>
        </div>
        {/* Pincode -> (Country) -> State -> Postal branch -> City -> Address.
            The pincode is entered first; it sets the country by its format and
            fills State and City from the postal lookup. The State, branch and
            City are checked against the India Post result for the pincode; a
            mismatch is shown in red and blocks Create. */}
        <div>
          <input
            required
            value={projectDetails.pincode}
            onChange={(event) => handlePincodeChange(event.target.value)}
            placeholder={t('dash.common.pincode')}
            aria-invalid={stateMismatch}
            className={locationFieldClass(stateMismatch, 'w-full')}
          />
          {stateMismatch && <p role="alert" className="mt-1 text-[11px] font-semibold text-red-600">{t('location.stateMismatch')}</p>}
        </div>
        <select
          value={projectDetails.project_country}
          onChange={(event) => handleCountryChange(event.target.value)}
          className="rounded-xl border border-oc-line px-3 py-2 text-sm outline-none focus:border-ocbrand-400"
        >
          {PROJECT_COUNTRIES.map((country) => (
            <option key={country.value} value={country.value}>{countryText(country.value, t) || country.label}</option>
          ))}
        </select>
        <div>
          <select
            value={projectDetails.project_state}
            onChange={(event) => handleStateChange(event.target.value)}
            aria-invalid={stateMismatch || missingState}
            className={locationFieldClass(stateMismatch || missingState, 'w-full')}
          >
            <option value="">{t('dash.owner.projectForm.selectState')}</option>
            {/* The stored value stays the English place name; only the option's
                text follows the selected language. */}
            {projectStateOptions(projectDetails.project_country).map((state) => (
              <option key={state} value={state}>{td(state)}</option>
            ))}
          </select>
        </div>
        {isIndiaProject && (
          <div>
            <select
              value={selectedPincodeBranch?.name || ''}
              onChange={(event) => {
                const branch = lookupBranches.find((item) => item.name === event.target.value)
                if (branch) selectPincodeBranch(branch)
              }}
              disabled={!branchesSelectable}
              aria-label={t('location.branch')}
              aria-invalid={branchMismatch || missingBranch}
              className={locationFieldClass(branchMismatch || missingBranch, 'w-full disabled:cursor-not-allowed disabled:bg-oc-sunken disabled:opacity-60')}
            >
              <option value="">{t('location.selectBranch')}</option>
              {(branchesSelectable ? lookupBranches : []).map((branch) => (
                <option key={`${branch.pincode}-${branch.name}`} value={branch.name}>{td(branch.name)}</option>
              ))}
            </select>
            {branchMismatch && <p role="alert" className="mt-1 text-[11px] font-semibold text-red-600">{t('location.branchMismatch')}</p>}
          </div>
        )}
        {/* While no branch is chosen: every branch under the pincode, full width
            so its city, district and state stay readable. Once one is chosen
            (or the State does not match) the list is not rendered at all; the
            choice shows in the Postal branch field. Outside India, the
            existing lookup line. */}
        {(!isIndiaProject || pincodeLookupState.status !== 'success' || (branchesSelectable && !selectedPincodeBranch)) && (
          <div className="md:col-span-2 -mt-2 empty:hidden">
            <PincodeAreaHint
              lookupState={pincodeLookupState}
              selectedBranch={selectedPincodeBranch}
              onSelectBranch={selectPincodeBranch}
            />
          </div>
        )}
        <div>
          <select
            value={projectDetails.project_city}
            onChange={(event) => handleCityChange(event.target.value)}
            disabled={!projectDetails.project_state}
            aria-invalid={cityMismatch || missingCity}
            className={locationFieldClass(cityMismatch || missingCity, 'w-full disabled:cursor-not-allowed disabled:bg-oc-sunken disabled:opacity-60')}
          >
            <option value="">{t('dash.owner.projectForm.selectCity')}</option>
            {cityOptions.map((city) => (
              <option key={city} value={city}>{td(city)}</option>
            ))}
          </select>
          {cityMismatch && <p role="alert" className="mt-1 text-[11px] font-semibold text-red-600">{t('location.cityMismatch')}</p>}
        </div>
        <input required value={projectDetails.address} onChange={(event) => updateProjectField('address', event.target.value)} placeholder={t('dash.owner.projectForm.addressPh')} className="rounded-xl border border-oc-line px-3 py-2 text-sm outline-none focus:border-ocbrand-400" />
        <input required value={projectDetails.title} onChange={(event) => updateProjectField('title', event.target.value)} placeholder={t('dash.owner.projectForm.titlePh')} className="rounded-xl border border-oc-line px-3 py-2 text-sm outline-none focus:border-ocbrand-400 md:col-span-2" />
        <textarea required value={projectDetails.description} onChange={(event) => updateProjectField('description', event.target.value)} placeholder={t('dash.owner.projectForm.descriptionPh')} className="min-h-24 rounded-xl border border-oc-line px-3 py-2 text-sm outline-none focus:border-ocbrand-400 md:col-span-2" />
        <label className="flex min-h-28 cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-ocbrand-200 bg-ocbrand-50/40 px-3 py-4 text-center text-sm font-semibold text-oc-deep md:col-span-2">
          <input
            type="file"
            accept="image/*"
            onChange={(event) => setProjectImageFile(event.target.files?.[0] || null)}
            className="sr-only"
          />
          {projectImageFile ? projectImageFile.name : t('dash.owner.projectForm.uploadImage')}
          <span className="mt-1 text-xs font-medium text-oc-faint">{t('dash.owner.projectForm.imageNote')}</span>
        </label>
        <select value={projectDetails.construction_type} onChange={(event) => updateProjectField('construction_type', event.target.value)} className="rounded-xl border border-oc-line px-3 py-2 text-sm">
          <option value="CONTRACTOR">{t('dash.owner.projectForm.hireBuilder')}</option>
          <option value="SELF_CONSTRUCTION">{t('dash.owner.profile.selfConstruction')}</option>
        </select>
        <select value={projectDetails.building_type} onChange={(event) => updateProjectField('building_type', event.target.value)} className="rounded-xl border border-oc-line px-3 py-2 text-sm">
          <option value="RESIDENTIAL">{t('dash.common.residential')}</option>
          <option value="COMMERCIAL">{t('dash.common.commercial')}</option>
        </select>
        <input type="number" value={projectDetails.land_area} onChange={(event) => updateProjectField('land_area', event.target.value)} placeholder={t('dash.owner.projectForm.plotAreaPh')} className="rounded-xl border border-oc-line px-3 py-2 text-sm outline-none focus:border-ocbrand-400" />
        <select value={projectDetails.floor_type || ''} onChange={(event) => updateProjectField('floor_type', event.target.value)} className="rounded-xl border border-oc-line px-3 py-2 text-sm outline-none focus:border-ocbrand-400">
          <option value="">{t('cps.selectField', { label: t('dash.common.floors') })}</option>
          {floorOptionsForCountry(projectDetails.project_country).map((option) => (
            <option key={option.value} value={option.value}>{floorTypeLabel(option.value)}</option>
          ))}
        </select>
        <label className="block">
          <span className="text-xs font-bold text-oc-muted">{t('dash.owner.projectDetails.startDate')}</span>
          <input type="date" required value={projectDetails.start_date} max={projectDetails.end_date || undefined} onChange={(event) => updateProjectField('start_date', event.target.value)} className="mt-1 w-full rounded-xl border border-oc-line px-3 py-2 text-sm outline-none focus:border-ocbrand-400" />
        </label>
        <label className="block">
          <span className="text-xs font-bold text-oc-muted">{t('dash.owner.projectDetails.endDate')}</span>
          <input type="date" required value={projectDetails.end_date} min={projectDetails.start_date || undefined} onChange={(event) => updateProjectField('end_date', event.target.value)} className="mt-1 w-full rounded-xl border border-oc-line px-3 py-2 text-sm outline-none focus:border-ocbrand-400" />
        </label>
        <div className="md:col-span-2">
          <input type="number" value={projectDetails.budget} onChange={(event) => updateProjectField('budget', event.target.value)} placeholder={t('dash.common.budget')} className="w-full rounded-xl border border-oc-line px-3 py-2 text-sm outline-none focus:border-ocbrand-400" />
          <BudgetInWords value={projectDetails.budget} country={projectDetails.project_country || defaultCountry} />
        </div>
        <button disabled={isCreatingProject} className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-oc-green px-4 text-sm font-extrabold text-white shadow-[0_11px_25px_rgba(18,107,69,.18)] transition hover:-translate-y-0.5 hover:bg-oc-deep disabled:cursor-not-allowed disabled:opacity-60 md:col-span-2">
          {isCreatingProject ? t('dash.owner.projectForm.creating') : t('dash.owner.projectForm.create')}
        </button>
      </form>
    </Card>

    {/* Get Estimate — the right-hand column of the Create Project row. It reads
        the form state beside it and writes only to this draft; the project is
        created by the form's own button, exactly as before. */}
    <Card title={t('dash.owner.projectForm.getEstimate')} icon={Calculator}>
      <label className="block">
        <span className="text-[11px] font-bold text-oc-muted">{t('site.estimate.finishing')}</span>
        <select
          value={finishingType}
          onChange={(event) => setFinishingType(event.target.value)}
          className="mt-1 w-full rounded-xl border border-oc-line px-3 py-2 text-sm outline-none focus:border-ocbrand-400"
        >
          <option value="standard">{t('site.estimate.finStd')}</option>
          <option value="premium">{t('site.estimate.finPrem')}</option>
        </select>
      </label>

      <button
        type="button"
        onClick={requestEstimate}
        disabled={isEstimating}
        className="mt-3 inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-oc-green px-4 text-sm font-extrabold text-white transition hover:bg-oc-deep disabled:cursor-not-allowed disabled:opacity-60"
      >
        <Calculator className="h-4 w-4" />
        {isEstimating ? t('site.estimate.calculating') : t('dash.owner.projectForm.getEstimate')}
      </button>

      {estimateMessage && (
        <p className="mt-2 rounded-xl border border-oc-line bg-oc-sunken px-3 py-2 text-xs font-semibold text-oc-muted">{estimateMessage}</p>
      )}

      {estimateResult && (
        <div className="mt-3 rounded-xl border border-oc-line bg-oc-sunken p-3">
          <dl className="space-y-1.5">
            {estimateRows.map(([label, value]) => (
              <div key={label} className="flex items-baseline justify-between gap-3">
                <dt className="text-[11px] font-medium text-oc-muted">{label}</dt>
                <dd className="text-right text-xs font-extrabold text-oc-ink">{value}</dd>
              </div>
            ))}
          </dl>

          {acceptedEstimate ? (
            <p className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-[11px] font-bold text-emerald-700 ring-1 ring-emerald-100">
              <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              {t('ui.status.accepted')}
            </p>
          ) : (
            <>
              <p className="mt-3 text-[11px] font-bold text-oc-ink">{t('dash.owner.projectForm.applyEstimate')}</p>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={acceptEstimate}
                  className="inline-flex h-8 items-center justify-center rounded-full bg-oc-green px-3 text-xs font-bold text-white transition hover:bg-oc-deep"
                >
                  {t('dash.common.yes')}
                </button>
                <button
                  type="button"
                  onClick={declineEstimate}
                  className="inline-flex h-8 items-center justify-center rounded-full border border-oc-line bg-white px-3 text-xs font-bold text-oc-muted transition hover:bg-oc-sunken"
                >
                  {t('dash.common.no')}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </Card>
    </div>
  )
}

// Assigned Builders leads, so the builder side of the project is the first
// thing the owner reads. It holds what used to sit above the hero as "Accepted
// Quotations" -- same data, moved rather than duplicated.
//
// Each tab carries its key and nothing else. The English `label` that used to
// sit beside it was already dead -- the row reads `labelKey` -- and leaving it
// there was an invitation for the next tab to be added with a label and no key,
// which would ship English to all seven languages.
export const projectDetailTabs = [
  { id: 'assignedBuilders', labelKey: 'ui.assignedBuilders' },
  { id: 'timeline', labelKey: 'ui.siteActivity' },
  // Beside Site Activity, because the camera is how the owner sees that
  // activity happening. One tab; the panel itself is the shared component the
  // Builder and the Site Engineer also use.
  { id: 'liveCamera', labelKey: 'ui.liveCamera' },
  { id: 'details', labelKey: 'ui.details' },
  { id: 'analysis', labelKey: 'owner.analysis.title' },
  { id: 'payments', labelKey: 'ui.payments' },
]

export function ProjectDetailRow({ icon: Icon, label, value }) {
  const { t } = useLanguage()
  // `value` arrives already translated by the caller, which is the only place
  // that knows whether it is a stored option, free text or a number.
  return (
    <div className="grid grid-cols-[1.25rem_minmax(0,1fr)_minmax(0,1.3fr)] items-start gap-2 border-t border-oc-line py-2 text-sm">
      <Icon className="mt-0.5 h-4 w-4 text-oc-deep" />
      <span className="text-oc-muted">{label}</span>
      <span className="break-words font-bold text-oc-ink">{value || t('dash.common.notSet')}</span>
    </div>
  )
}

export const defaultProjectImage = 'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=900&q=80'
// The Overview's Edit form, filled from the project as it is now. Only the
// fields PATCH /projects/{id}/requirement already saves are offered; pincode,
// country and construction type stay as they are (see the form below).
function overviewDraftFrom(project) {
  const country = project?.project_country || 'India'
  // The Floors dropdown shows the stored code, or for a project without one the
  // option matching its floor count. Only a choice the owner actually changes
  // is saved, so opening and saving never writes a code nobody picked.
  const floorTypeShown = project?.floor_type || floorTypeForCount(country, project?.floors) || ''
  return {
    title: project?.title || '',
    description: project?.description || '',
    address: project?.address || '',
    building_type: project?.building_type || 'RESIDENTIAL',
    // A 0 opens as an empty box (saved back as 0), so it never has to be cleared first.
    budget: project?.budget || '',
    land_area: project?.land_area || '',
    floor_type: floorTypeShown,
    floor_type_initial: floorTypeShown,
    // '' when the project has none yet ("Not set").
    start_date: project?.start_date || '',
    end_date: project?.end_date || '',
  }
}

export function ProjectDetailPanel({ project, ownerName, activeTab, onRequestUpdate, requestingUpdate, updateRequestMessage, quotations = [], onAssignBuilder, assigningBuilderId = null, assignMessage = '', onProjectSaved, startEditing = false, onEditStarted }) {
  const { t, td } = useLanguage()
  const [overviewEditing, setOverviewEditing] = useState(false)
  const landAreaInputRef = useRef(null)
  const [overviewDraft, setOverviewDraft] = useState(() => overviewDraftFrom(project))
  const [overviewSaving, setOverviewSaving] = useState(false)
  const [overviewMessage, setOverviewMessage] = useState('')
  const [descriptionOpen, setDescriptionOpen] = useState(false)
  // Quotations whose builder declined this project's assignment: not offered again.
  const [declinedRequestIds, setDeclinedRequestIds] = useState([])
  // The quotation picked in the Assign Builder dropdown (its request id).
  const [selectedQuotationId, setSelectedQuotationId] = useState('')
  // The project's current award (who is negotiating, what the owner may do),
  // and a counter that reloads it after an Assign from this tab. Only read
  // here: its details are shown in the request.
  const [currentAward, setCurrentAward] = useState(null)
  const [panelVersion, setPanelVersion] = useState(0)
  // Re-read when the builder answers a negotiation or confirms (live hint).
  const liveVersion = useLiveVersion()
  useEffect(() => {
    let alive = true
    fetchProjectAward(project.id)
      .then((response) => {
        if (!alive) return
        setDeclinedRequestIds(response?.declined_request_ids || [])
        setCurrentAward(response?.award || null)
      })
      .catch(() => { if (alive) setCurrentAward(null) })
    return () => { alive = false }
  }, [project.id, project.contractor_id, panelVersion, liveVersion])
  // The quotation whose Assign Builder dialog is open, with the amount it would
  // be assigned at. This tab is the only place a builder is assigned.
  const [assignTarget, setAssignTarget] = useState(null)
  const [assignBusy, setAssignBusy] = useState(false)
  // Unassign: the owner's existing cancel (/awards/{id}/cancel) on the assigned
  // builder's award. The server refuses it once work is recorded or the builder
  // has assigned a Site Engineer, and says which in `unassign_blocked`.
  const [unassignOpen, setUnassignOpen] = useState(false)
  const [unassignBusy, setUnassignBusy] = useState(false)
  const [unassignError, setUnassignError] = useState('')
  // An award not yet assigned (negotiating, waiting on the builder's
  // confirmation, or confirmed) holds the project's one live award: other
  // quotations wait until it is cancelled.
  const liveNegotiation = currentAward && currentAward.assigned === false && ['negotiating', 'awaiting_builder', 'confirmed'].includes(currentAward.status)
    ? currentAward
    : null
  // The Assign Builder dropdown: this project's accepted quotations, one per
  // builder, with the same rules the backend's assign applies. A builder who
  // declined this project is left out. With no live award, choosing a builder
  // sends their quotation for confirmation; a builder is assignable only once
  // they have confirmed (the server's 'assign' action). While an award is
  // live, every other builder is listed but disabled.
  const builderChoices = []
  const seenBuilderIds = new Set()
  const orderedQuotations = liveNegotiation
    ? [...quotations].sort((a, b) => (b.id === liveNegotiation.request_id) - (a.id === liveNegotiation.request_id))
    : quotations
  for (const quotation of orderedQuotations) {
    const builderId = builderIdOnRequest(quotation)
    if (builderId == null || seenBuilderIds.has(builderId) || declinedRequestIds.includes(quotation.id)) continue
    seenBuilderIds.add(builderId)
    const negotiatingThis = liveNegotiation?.request_id === quotation.id
    const canAssign = negotiatingThis && (liveNegotiation.actions || []).includes('assign')
    const disabled = negotiatingThis ? !canAssign : Boolean(liveNegotiation)
    // An assignable builder is listed by name alone. Only a builder who
    // cannot be picked carries a reason: confirmed but not assignable (e.g.
    // work has started), in negotiation, or waiting for their confirmation.
    const noteKey = !negotiatingThis || canAssign
      ? null
      : liveNegotiation.status === 'confirmed'
        ? 'quote.builderConfirmedOption'
        : liveNegotiation.status === 'negotiating' ? 'quote.inNegotiation' : 'quote.waitingConfirmation'
    builderChoices.push({ quotation, disabled, noteKey, mode: canAssign ? 'assign' : 'request' })
  }
  const selectedChoice = builderChoices.find((choice) => String(choice.quotation.id) === selectedQuotationId && !choice.disabled) || null
  // The assigned builder's award, read from the same award the panel loads.
  const assignedAward = currentAward && currentAward.assigned ? currentAward : null
  const canUnassign = Boolean(assignedAward) && ['unassign', 'cancel'].some((action) => (assignedAward.actions || []).includes(action))
  const unassignBlocked = assignedAward?.unassign_blocked || null
  const assignedBuilderName = project.contractor_id
    ? (quotations.find((quotation) => builderIdOnRequest(quotation) === project.contractor_id)?.sender_name || currentAward?.builder_name || '')
    : ''
  const projectCountry = project.project_country || 'India'
  const startOverviewEdit = () => {
    setOverviewDraft(overviewDraftFrom(project))
    setOverviewMessage('')
    setOverviewEditing(true)
  }
  // Opened from a project card's Edit: start in edit mode on the land area.
  useEffect(() => {
    if (!startEditing || activeTab !== 'details') return
    startOverviewEdit()
    onEditStarted?.()
    window.requestAnimationFrame(() => {
      landAreaInputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      landAreaInputRef.current?.focus({ preventScroll: true })
    })
  }, [startEditing, activeTab])
  // Cancel throws the draft away; the next Edit starts from the saved project.
  const cancelOverviewEdit = () => {
    setOverviewEditing(false)
    setOverviewMessage('')
  }
  const updateOverviewField = (field, value) => setOverviewDraft((current) => ({ ...current, [field]: value }))
  const saveOverview = async (event) => {
    event.preventDefault()
    if (!overviewDraft.title.trim() || !overviewDraft.description.trim() || !overviewDraft.address.trim()) {
      setOverviewMessage(t('cp.val.completeFields'))
      return
    }
    // A project with no dates may stay that way; once either date is entered
    // (or the project already has them) both are needed, end not before start.
    const datesTouched = Boolean(overviewDraft.start_date || overviewDraft.end_date || project.start_date || project.end_date)
    const scheduleProblem = datesTouched ? projectScheduleProblem(overviewDraft.start_date, overviewDraft.end_date) : ''
    if (scheduleProblem) {
      setOverviewMessage(t(scheduleProblem))
      return
    }
    setOverviewSaving(true)
    setOverviewMessage('')
    try {
      // The fields this form does not edit are sent exactly as saved, so the
      // existing endpoint leaves them unchanged.
      await updateProjectRequirement(project.id, {
        title: overviewDraft.title.trim(),
        description: overviewDraft.description.trim(),
        address: overviewDraft.address.trim(),
        pincode: project.pincode || '',
        building_type: overviewDraft.building_type,
        construction_type: project.construction_type || 'CONTRACTOR',
        budget: overviewDraft.budget === '' ? 0 : Number(overviewDraft.budget),
        land_area: overviewDraft.land_area === '' ? 0 : Number(overviewDraft.land_area),
        // Floors only when the owner changed them; otherwise the saved values
        // go back as they are (a null floor_type leaves the stored one alone).
        ...(overviewDraft.floor_type !== overviewDraft.floor_type_initial
          ? { floors: floorCountFor(projectCountry, overviewDraft.floor_type, project.floors || 1), floor_type: overviewDraft.floor_type || null }
          : { floors: project.floors || 1, floor_type: null }),
        // Sent only when there are dates; otherwise the API leaves them alone.
        ...(datesTouched ? { start_date: overviewDraft.start_date, end_date: overviewDraft.end_date } : {}),
      })
      await onProjectSaved?.()
      setOverviewEditing(false)
      setOverviewMessage(t('dash.owner.estimates.editSaved'))
    } catch (error) {
      setOverviewMessage(error.response?.data?.detail || t('ui.owner.updateRequirementFailed'))
    } finally {
      setOverviewSaving(false)
    }
  }
  const projectTitle = td(project.title)
  const budgetLabel = project.budget ? money(project.budget, project.project_country) : t('dash.common.notSet')
  // Present only once the awarded builder has confirmed; shown above the
  // original budget, which stays as entered and is what Edit changes.
  const contractValueLabel = project.contract_amount != null ? money(project.contract_amount, project.project_country) : null
  // Until a contract is confirmed, the awarded builder's applicable quotation.
  const awardedQuotationLabel = project.contract_amount == null && project.awarded_amount != null ? money(project.awarded_amount, project.project_country) : null
  // The estimate accepted on the Create Project form, read straight off the
  // project the API already returns -- no new endpoint, field or column.
  //
  // The four values are written together by one accepted estimate and are NULL
  // together (revision 0011), so one of them decides whether there is anything
  // to show. A project created without accepting an estimate -- which is every
  // project made before 0011 -- contributes no cards at all, rather than four
  // reading "Not set".
  const savedEstimateCards = project.estimated_cost == null ? [] : [
    [t('site.estimate.result.total'), money(project.estimated_cost, project.project_country)],
    [t('site.estimate.result.materials'), money(project.material_estimate, project.project_country)],
    [t('site.estimate.result.labour'), money(project.labour_estimate, project.project_country)],
    [t('site.estimate.result.duration'), t('site.estimate.result.days', { days: project.estimated_duration_days })],
  ]

  return (
    <section>
      {/* No header row of its own: Back to Projects and these views
          (Assign Builders, Site Activity, Live Camera, the overview and
          Payments) are reached from the project's navigation above
          (OwnerProjectWorkspace), which sets `activeTab`. */}
      {/* One column. The project image and summary used to sit in a
          permanent left rail, so every section opened on them and its own
          content began below the fold. They describe the project rather
          than any one section, and now live inside Details. */}
      <div className="grid grid-cols-1 gap-5">
        <div className="rounded-2xl border border-oc-line bg-white p-4 shadow-sm sm:p-6">
          {/* Assign Builder: only choosing and assigning a builder. Quotations,
              negotiation and request history stay in the Requests tab. */}
          {activeTab === 'assignedBuilders' && (
            <div className="rounded-2xl border border-oc-line bg-white p-4">
              <p className="font-display text-base font-extrabold text-oc-ink">{t('quote.assignBuilder')}</p>

              {project.contractor_id ? (
                <>
                <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-oc-line bg-oc-paper p-3">
                  <p className="text-sm font-medium text-oc-muted">
                    {t('award.builder')}: <b className="font-extrabold text-oc-ink">{td(assignedBuilderName) || t('dash.common.notSet')}</b>
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-extrabold text-emerald-700 ring-1 ring-emerald-100">
                      <span className="h-2 w-2 rounded-full bg-emerald-500" /> {t('quote.builderAssigned')}
                    </span>
                    {canUnassign && (
                      <button
                        type="button"
                        disabled={Boolean(unassignBlocked) || unassignBusy}
                        onClick={() => { setUnassignError(''); setUnassignOpen(true) }}
                        title={unassignBlocked ? t(unassignBlocked === 'engineer' ? 'quote.unassignBlockedEngineer' : 'quote.unassignBlockedWork') : undefined}
                        className="inline-flex h-8 items-center gap-1 rounded-lg border border-red-200 bg-white px-3 text-xs font-extrabold text-red-600 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400"
                      >
                        <X className="h-3.5 w-3.5" /> {t('quote.unassign')}
                      </button>
                    )}
                  </div>
                </div>
                {canUnassign && unassignBlocked && (
                  <p className="mt-2 text-xs font-semibold text-oc-muted">
                    {t(unassignBlocked === 'engineer' ? 'quote.unassignBlockedEngineer' : 'quote.unassignBlockedWork')}
                  </p>
                )}
                {unassignError && <p className="mt-2 rounded-xl bg-red-50 px-3 py-2 text-xs font-semibold text-red-700 ring-1 ring-red-100">{unassignError}</p>}
                {unassignOpen && currentAward && (
                  <div className="fixed inset-0 z-[140] grid place-items-center overflow-y-auto bg-slate-900/50 p-4 backdrop-blur-sm" role="dialog" aria-modal="true">
                    <div className="w-full max-w-md rounded-2xl bg-white p-5 text-oc-ink shadow-xl">
                      <p className="font-display text-lg font-extrabold">{t('quote.unassignTitle')}</p>
                      <dl className="mt-3 grid gap-1 text-sm">
                        <div className="flex justify-between gap-3"><dt className="text-oc-muted">{t('award.builder')}</dt><dd className="text-right font-bold">{td(assignedBuilderName)}</dd></div>
                        <div className="flex justify-between gap-3"><dt className="text-oc-muted">{t('award.project')}</dt><dd className="text-right font-bold">{td(project.title)}</dd></div>
                      </dl>
                      <p className="mt-3 text-sm text-oc-muted">{t('quote.unassignBody', { name: td(assignedBuilderName) })}</p>
                      <div className="mt-4 flex flex-wrap justify-end gap-2">
                        <button type="button" disabled={unassignBusy} onClick={() => setUnassignOpen(false)} className="inline-flex min-h-10 items-center justify-center rounded-xl border border-oc-line bg-white px-4 py-2 text-sm font-extrabold text-oc-ink transition hover:bg-oc-sunken disabled:cursor-not-allowed disabled:opacity-50">
                          {t('award.dialog.back')}
                        </button>
                        <button
                          type="button"
                          disabled={unassignBusy}
                          onClick={async () => {
                            if (unassignBusy) return
                            setUnassignBusy(true)
                            setUnassignError('')
                            try {
                              await cancelAward(currentAward.id)
                              setUnassignOpen(false)
                            } catch (error) {
                              const detail = error?.response?.data?.detail
                              setUnassignError(typeof detail === 'string' ? detail : detail?.message || t('quote.unassignFailed'))
                              setUnassignOpen(false)
                            } finally {
                              setUnassignBusy(false)
                              // Either way, show the project as it now stands.
                              await onProjectSaved?.()
                              setPanelVersion((version) => version + 1)
                            }
                          }}
                          className="inline-flex min-h-10 items-center justify-center gap-1 rounded-xl bg-red-600 px-4 py-2 text-sm font-extrabold text-white shadow-sm transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {t('quote.unassign')}
                        </button>
                      </div>
                    </div>
                  </div>
                )}
                </>
              ) : builderChoices.length === 0 ? (
                <p className="mt-3 text-xs font-medium text-oc-muted">{t('quote.noneYet')}</p>
              ) : (
                <>
                  {/* The planned start date has arrived but no work is recorded:
                      assigning is still allowed, with this warning. */}
                  {project.work_started !== true && ['today', 'passed'].includes(project.planned_start_notice) && (
                    <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800 ring-1 ring-amber-200">
                      {t(project.planned_start_notice === 'today' ? 'quote.plannedStartToday' : 'quote.plannedStartPassed')}
                    </p>
                  )}
                  <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
                    <select
                      value={selectedChoice ? String(selectedChoice.quotation.id) : ''}
                      onChange={(event) => setSelectedQuotationId(event.target.value)}
                      disabled={assignBusy || project.work_started === true}
                      aria-label={t('quote.assignBuilder')}
                      className="min-w-0 flex-1 rounded-xl border border-oc-line px-3 py-2 text-sm outline-none focus:border-ocbrand-400 disabled:cursor-not-allowed disabled:bg-slate-100"
                    >
                      <option value="">{t('site.contact.f.select')}</option>
                      {builderChoices.map(({ quotation, disabled, noteKey }) => (
                        <option key={quotation.id} value={String(quotation.id)} disabled={disabled}>
                          {td(quotation.sender_name)}{noteKey ? ` (${t(noteKey)})` : ''}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      // Not once work has started: the backend refuses it. A planned
                      // start date that has arrived only shows the warning above.
                      disabled={!selectedChoice || assignBusy || project.work_started === true || assigningBuilderId != null}
                      onClick={() => setAssignTarget(selectedChoice)}
                      className="inline-flex h-10 items-center justify-center rounded-xl bg-oc-green px-4 text-sm font-extrabold text-white transition hover:bg-oc-deep disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
                    >
                      {t(selectedChoice?.mode === 'request' ? 'quote.requestConfirmation' : 'quote.assignBuilder')}
                    </button>
                  </div>
                  {/* Sent for confirmation or agreed in negotiation: the builder
                      must confirm before Assign is offered. */}
                  {liveNegotiation?.status === 'awaiting_builder' && (
                    <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800 ring-1 ring-amber-200">
                      {td(liveNegotiation.builder_name)}: {t('quote.waitingConfirmation')}
                    </p>
                  )}
                  {liveNegotiation && builderChoices.some(({ quotation }) => quotation.id !== liveNegotiation.request_id) && (
                    <p className="mt-3 text-xs font-semibold text-oc-muted">{t('quote.negotiationActive', { name: td(liveNegotiation.builder_name) })}</p>
                  )}
                </>
              )}
              {assignMessage && (
                <p className="mt-3 rounded-xl border border-ocbrand-100 bg-ocbrand-50 px-4 py-2.5 text-sm font-bold text-oc-deep">{assignMessage}</p>
              )}
              {assignTarget && (
                // The existing assignment (onAssignBuilder -> /project-requests/assign),
                // confirmed first. Busy state blocks a second submission.
                <div className="fixed inset-0 z-[140] grid place-items-center overflow-y-auto bg-slate-900/50 p-4 backdrop-blur-sm" role="dialog" aria-modal="true">
                  <div className="w-full max-w-md rounded-2xl bg-white p-5 text-oc-ink shadow-xl">
                    <p className="font-display text-lg font-extrabold">{t(assignTarget.mode === 'request' ? 'quote.requestConfirmation' : 'quote.assignBuilder')}</p>
                    <dl className="mt-3 grid gap-1 text-sm">
                      <div className="flex justify-between gap-3"><dt className="text-oc-muted">{t('award.builder')}</dt><dd className="text-right font-bold">{td(assignTarget.quotation.sender_name)}</dd></div>
                      <div className="flex justify-between gap-3"><dt className="text-oc-muted">{t('award.project')}</dt><dd className="text-right font-bold">{td(project.title)}</dd></div>
                    </dl>
                    {assignTarget.mode === 'request' && (
                      <p className="mt-3 text-sm text-oc-muted">{t('quote.requestConfirmationBody', { name: td(assignTarget.quotation.sender_name) })}</p>
                    )}
                    <div className="mt-4 flex flex-wrap justify-end gap-2">
                      <button type="button" disabled={assignBusy} onClick={() => setAssignTarget(null)} className="inline-flex min-h-10 items-center justify-center rounded-xl border border-oc-line bg-white px-4 py-2 text-sm font-extrabold text-oc-ink transition hover:bg-oc-sunken disabled:cursor-not-allowed disabled:opacity-50">
                        {t('award.dialog.back')}
                      </button>
                      <button
                        type="button"
                        disabled={assignBusy}
                        onClick={async () => {
                          if (assignBusy) return
                          setAssignBusy(true)
                          try {
                            await onAssignBuilder?.(assignTarget.quotation.id)
                          } finally {
                            setAssignBusy(false)
                            setAssignTarget(null)
                            setSelectedQuotationId('')
                            setPanelVersion((version) => version + 1)
                          }
                        }}
                        className="inline-flex min-h-10 items-center justify-center rounded-xl bg-oc-green px-4 py-2 text-sm font-extrabold text-white shadow-sm transition hover:bg-oc-deep disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {t(assignTarget.mode === 'request' ? 'quote.requestConfirmation' : 'quote.assignBuilder')}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* The project's shared camera. The panel decides for itself whether
              this owner has completed the DVR/NVR verification and shows either
              the setup screen or the cameras; nothing about the tab changes. */}
          {activeTab === 'liveCamera' && (
            <ProjectCameraPanel projectId={project.id} projectTitle={projectTitle} />
          )}

          {/* Project Analysis: read-only figures for this project only. */}
          {activeTab === 'analysis' && <OwnerProjectAnalysisView project={project} />}

          {activeTab === 'timeline' && (
            <div>
              {/* Wraps: a long translated Request Update goes under the label on a
                  phone instead of past the screen edge. */}
              <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm font-bold text-oc-muted">{t('ui.siteActivity')}</p>
                <button
                  onClick={() => onRequestUpdate(project)}
                  disabled={requestingUpdate}
                  className="inline-flex max-w-full items-center gap-2 rounded-xl bg-oc-green px-4 py-2 text-start text-xs font-bold text-white shadow-sm disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <Plus className="h-4 w-4 shrink-0" /> {t('dash.owner.projectDetails.requestUpdate')}
                </button>
              </div>
              {updateRequestMessage && (
                <p className="mb-4 rounded-xl border border-oc-line bg-oc-mint px-4 py-3 text-sm font-semibold text-oc-deep">
                  {updateRequestMessage}
                </p>
              )}
              <div className="site-calendar-dark"><SiteEngineerDashboard projectList={[project]} photoOnly /></div>
            </div>
          )}

          {activeTab === 'details' && (
            <div>
              {/* Edit, at the top of the Overview. Saves through the existing
                  PATCH /projects/{id}/requirement; the dashboard then reloads
                  the project, so the Overview below shows the saved values. */}
              {overviewMessage && !overviewEditing && (
                <p className="mb-3 rounded-xl bg-oc-mint px-3 py-2 text-xs font-bold text-oc-deep">{overviewMessage}</p>
              )}
              {overviewEditing && (
                <form onSubmit={saveOverview} className="mb-5 space-y-3 rounded-2xl border border-oc-line bg-ocbrand-50/30 p-4">
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    <label className="block md:col-span-2">
                      <span className="text-xs font-bold uppercase text-oc-faint">{t('dash.common.projectName')}</span>
                      <input value={overviewDraft.title} onChange={(event) => updateOverviewField('title', event.target.value)} className="mt-1 w-full rounded-xl border border-oc-line bg-white px-3 py-2 text-sm outline-none focus:border-ocbrand-400" />
                    </label>
                    <label className="block md:col-span-2">
                      <span className="text-xs font-bold uppercase text-oc-faint">{t('dash.common.description')}</span>
                      <textarea value={overviewDraft.description} onChange={(event) => updateOverviewField('description', event.target.value)} className="mt-1 min-h-24 w-full rounded-xl border border-oc-line bg-white px-3 py-2 text-sm outline-none focus:border-ocbrand-400" />
                    </label>
                    <label className="block md:col-span-2">
                      <span className="text-xs font-bold uppercase text-oc-faint">{t('dash.common.address')}</span>
                      <input value={overviewDraft.address} onChange={(event) => updateOverviewField('address', event.target.value)} className="mt-1 w-full rounded-xl border border-oc-line bg-white px-3 py-2 text-sm outline-none focus:border-ocbrand-400" />
                    </label>
                    <label className="block">
                      <span className="text-xs font-bold uppercase text-oc-faint">{t('dash.common.buildingType')}</span>
                      <select value={overviewDraft.building_type} onChange={(event) => updateOverviewField('building_type', event.target.value)} className="mt-1 w-full rounded-xl border border-oc-line bg-white px-3 py-2 text-sm">
                        <option value="RESIDENTIAL">{t('dash.common.residential')}</option>
                        <option value="COMMERCIAL">{t('dash.common.commercial')}</option>
                        {!['RESIDENTIAL', 'COMMERCIAL'].includes(overviewDraft.building_type) && (
                          <option value={overviewDraft.building_type}>{buildingTypeText(overviewDraft.building_type, t)}</option>
                        )}
                      </select>
                    </label>
                    <label className="block">
                      <span className="text-xs font-bold uppercase text-oc-faint">{t('dash.common.floors')}</span>
                      <select value={overviewDraft.floor_type} onChange={(event) => updateOverviewField('floor_type', event.target.value)} className="mt-1 w-full rounded-xl border border-oc-line bg-white px-3 py-2 text-sm">
                        <option value="">{t('cps.selectField', { label: t('dash.common.floors') })}</option>
                        {floorOptionsForCountry(projectCountry).map((option) => (
                          <option key={option.value} value={option.value}>{floorTypeLabel(option.value)}</option>
                        ))}
                      </select>
                    </label>
                    <label className="block">
                      <span className="text-xs font-bold uppercase text-oc-faint">{t('dash.common.originalBudget')}</span>
                      <input type="number" min="0" value={overviewDraft.budget} onChange={(event) => updateOverviewField('budget', event.target.value)} className="mt-1 w-full rounded-xl border border-oc-line bg-white px-3 py-2 text-sm outline-none focus:border-ocbrand-400" />
                      <BudgetInWords value={overviewDraft.budget} country={projectCountry} />
                    </label>
                    <label className="block">
                      <span className="text-xs font-bold uppercase text-oc-faint">{t('dash.common.landArea')}</span>
                      <input ref={landAreaInputRef} type="number" min="0" value={overviewDraft.land_area} onChange={(event) => updateOverviewField('land_area', event.target.value)} className="mt-1 w-full rounded-xl border border-oc-line bg-white px-3 py-2 text-sm outline-none focus:border-ocbrand-400" />
                    </label>
                    <label className="block">
                      <span className="text-xs font-bold uppercase text-oc-faint">{t('dash.owner.projectDetails.startDate')}</span>
                      <input type="date" value={overviewDraft.start_date} max={overviewDraft.end_date || undefined} onChange={(event) => updateOverviewField('start_date', event.target.value)} className="mt-1 w-full rounded-xl border border-oc-line bg-white px-3 py-2 text-sm outline-none focus:border-ocbrand-400" />
                    </label>
                    <label className="block">
                      <span className="text-xs font-bold uppercase text-oc-faint">{t('dash.owner.projectDetails.endDate')}</span>
                      <input type="date" value={overviewDraft.end_date} min={overviewDraft.start_date || undefined} onChange={(event) => updateOverviewField('end_date', event.target.value)} className="mt-1 w-full rounded-xl border border-oc-line bg-white px-3 py-2 text-sm outline-none focus:border-ocbrand-400" />
                    </label>
                  </div>
                  {overviewMessage && <p role="alert" className="text-xs font-bold text-red-600">{overviewMessage}</p>}
                  <div className="flex flex-wrap justify-end gap-2">
                    <button type="button" onClick={cancelOverviewEdit} className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-oc-line bg-white px-3.5 text-xs font-extrabold text-oc-muted transition hover:bg-slate-50">
                      <X className="h-3.5 w-3.5" /> {t('dash.common.cancel')}
                    </button>
                    <button type="submit" disabled={overviewSaving} className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-oc-green px-4 text-xs font-extrabold text-white transition hover:bg-oc-deep disabled:cursor-not-allowed disabled:opacity-60">
                      <Save className="h-3.5 w-3.5" /> {overviewSaving ? t('dash.common.saving') : t('dash.common.save')}
                    </button>
                  </div>
                </form>
              )}
              {/* Header: the cover, the project's name and status, its owner and
                  location, and Edit -- one compact row instead of a hero. */}
              <div className="flex items-start gap-3 sm:gap-4">
                <SmartImage
                  src={project.cover_image_url ? imageUrl(project.cover_image_url) : defaultProjectImage}
                  alt={projectTitle}
                  className="h-14 w-14 shrink-0 rounded-xl object-cover sm:h-20 sm:w-20 sm:rounded-2xl"
                  fallback="from-ocbrand-100 to-ocbrand-50"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <h3 className="min-w-0 break-words font-display text-lg font-extrabold leading-snug text-oc-ink sm:text-xl">{projectTitle}</h3>
                    <StatusPill status={project.status || 'active'} />
                  </div>
                  <p className="mt-0.5 text-sm font-semibold text-oc-ink">{td(ownerName) || t('dash.owner.profile.homeOwner')}</p>
                  <p className="mt-0.5 flex items-start gap-1 text-sm text-oc-muted">
                    <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-label={t('dash.owner.projectDetails.location')} />
                    <span className="min-w-0 break-words">{`${td(project.address) || ''} ${project.pincode || ''}`.trim() || t('dash.common.notSet')}</span>
                  </p>
                </div>
                {!overviewEditing && (
                  <button
                    type="button"
                    onClick={startOverviewEdit}
                    className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-xl border border-oc-line bg-white px-3 text-xs font-extrabold text-oc-deep shadow-sm transition hover:bg-oc-deep hover:text-white"
                  >
                    <Pencil className="h-3.5 w-3.5" /> <span className="hidden sm:inline">{t('dash.common.edit')}</span>
                  </button>
                )}
              </div>

              {/* Key facts at a glance. The active amount (contract value, or the
                  awarded builder's quotation) is the highlighted tile. */}
              <dl className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
                {[
                  contractValueLabel
                    ? [t('dash.common.contractValue'), contractValueLabel, true]
                    : awardedQuotationLabel ? [t('request.flow.builderQuotation'), awardedQuotationLabel, true] : null,
                  [t('dash.common.originalBudget'), budgetLabel],
                  [t('dash.owner.projectDetails.startDate'), formatProjectDate(project.start_date, t)],
                  [t('dash.owner.projectDetails.endDate'), formatProjectDate(project.end_date, t)],
                  [t('dash.common.landArea'), `${project.land_area || 0} ${t('dash.owner.profile.sqFt')}`],
                  [t('dash.owner.projectDetails.projectType'), `${Number(project.floors || 1) === 1 ? t('dash.owner.contractors.floorsOne', { n: project.floors || 1 }) : t('dash.owner.contractors.floorsMany', { n: project.floors || 1 })} ${buildingTypeText(project.building_type, t)}`.trim()],
                ].filter(Boolean).map(([label, value, highlight]) => (
                  <div key={label} className={`min-w-0 rounded-xl px-3 py-2.5 ${highlight ? 'bg-oc-mint ring-1 ring-oc-green/25' : 'bg-oc-sunken'}`}>
                    <dt className="text-[11px] font-semibold text-oc-muted">{label}</dt>
                    <dd className={`mt-0.5 break-words font-display text-[15px] font-extrabold leading-snug ${highlight ? 'text-oc-deep' : 'text-oc-ink'}`}>{value || t('dash.common.notSet')}</dd>
                  </div>
                ))}
              </dl>

              {/* The owner's own description, readable in full on demand. */}
              {td(project.description) && (
                <div className="mt-5">
                  <h4 className="text-sm font-extrabold text-oc-ink">{t('dash.common.description')}</h4>
                  <p className={`mt-1 whitespace-pre-line text-sm leading-6 text-oc-muted ${descriptionOpen ? '' : 'line-clamp-3'}`}>{td(project.description)}</p>
                  {String(project.description || '').length > 160 && (
                    <button type="button" onClick={() => setDescriptionOpen((open) => !open)} className="mt-1 py-1 text-xs font-extrabold text-oc-green hover:text-oc-deep">
                      {descriptionOpen ? t('catalog.showLess') : t('catalog.showMore')}
                    </button>
                  )}
                </div>
              )}

              {/* Every remaining field as a plain label / value list: one column
                  on a phone, two from tablet up. */}
              <div className="mt-5">
                <h4 className="text-sm font-extrabold text-oc-ink">{t('site.estimate.details')}</h4>
                <dl className="mt-1 grid grid-cols-1 gap-x-8 sm:grid-cols-2">
                  {[
                    [t('dash.common.projectName'), projectTitle],
                    [t('dash.common.address'), td(project.address)],
                    [t('dash.common.pincode'), project.pincode],
                    [t('dash.owner.projectDetails.projectCountry'), countryText(project.project_country || 'India', t)],
                    [t('dash.common.constructionType'), constructionTypeText(project.construction_type, t)],
                    [t('dash.common.buildingType'), buildingTypeText(project.building_type, t)],
                    [t('dash.common.floors'), project.floors],
                    // A stored status code, so it reads through the shared option
                    // map rather than being printed as the API returned it.
                    [t('dash.owner.projectDetails.compliance'), project.compliance_status
                      ? optionLabel(t, COMPLIANCE_STATUS_KEYS, project.compliance_status)
                      : t('dash.owner.projectDetails.pendingVerification')],
                  ].map(([label, value]) => (
                    <div key={label} className="flex items-start justify-between gap-4 border-b border-oc-line/70 py-2.5 text-sm">
                      <dt className="shrink-0 text-oc-muted">{label}</dt>
                      <dd className="min-w-0 break-words text-end font-semibold text-oc-ink">{value || t('dash.common.notSet')}</dd>
                    </div>
                  ))}
                </dl>
              </div>

              {/* The accepted estimate, when there is one (same four figures). */}
              {savedEstimateCards.length > 0 && (
                <div className="mt-5">
                  <h4 className="text-sm font-extrabold text-oc-ink">{t('cp.savedEstimate')}</h4>
                  <dl className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {savedEstimateCards.map(([label, value]) => (
                      <div key={label} className="min-w-0 rounded-xl bg-oc-sunken px-3 py-2.5">
                        <dt className="text-[11px] font-semibold text-oc-muted">{label}</dt>
                        <dd className="mt-0.5 break-words text-sm font-extrabold text-oc-ink">{value || t('dash.common.notSet')}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              )}
            </div>
          )}

          {activeTab === 'payments' && (
            <div className="space-y-3">
              {(project.escrow_milestones || []).map((milestone) => (
                <div key={milestone.id} className="flex items-center justify-between rounded-xl border border-oc-line p-4">
                  <div>
                    <p className="font-bold text-oc-ink">{td(milestone.name)}</p>
                    <p className="text-xs text-oc-muted">{t('dash.owner.projectDetails.escrowMilestone')}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-display text-lg font-extrabold text-oc-deep">{money(milestone.amount, project.project_country)}</p>
                    <StatusPill status={milestone.status} />
                  </div>
                </div>
              ))}
              {!project.escrow_milestones?.length && <EmptyState title={t('dash.owner.projectDetails.noMilestones')} message={t('dash.owner.projectDetails.milestonesHint')} />}
            </div>
          )}
        </div>
      </div>
    </section>
  )
}

/**
 * The Projects catalogue — one card per project, and only one.
 *
 * A project used to be listed twice: once here as a project card and again
 * below as a saved requirement carrying its Edit and Delete actions. Those two
 * lists are now this one, so each entry arrives as a pair:
 *
 *   project   what the card shows — title, location, builder, progress
 *   estimate  what its actions act on, which is what the requirement card
 *             always passed to them, so no handler changed
 *
 * A draft that never became a project is an entry too. It has no project page
 * to open, so its card does not navigate; it offers Convert To Project instead,
 * exactly as the requirement card did.
 */
export function ProjectListTable({
  entries = [],
  onSelect,
  defaultCountry = 'India',
  onConvertEstimate,
  convertingEstimateId = null,
  convertMessage = '',
  onDeleteEstimate,
  deletingEstimateId = null,
  deleteMessage = '',
  // Opens this project's existing Assigned Builders section (see OwnerDashboard).
  onAssignBuilder,
  // Opens this project's Overview in edit mode (see OwnerDashboard).
  onEditProject,
}) {
  const { t, td } = useLanguage()
  const [pendingDelete, setPendingDelete] = useState(null)
  // The card the last delete was asked for, so its message shows on that card.
  const [deleteTargetId, setDeleteTargetId] = useState(null)
  // Project Analysis: which cards are turned over, each on its own, and each
  // project's cost summary, fetched the first time its card is turned.
  const [flippedIds, setFlippedIds] = useState(() => new Set())
  const [analysisById, setAnalysisById] = useState({})
  const analysisToggleRefs = useRef({})
  const analysisBackRefs = useRef({})
  const loadAnalysis = (projectId) => {
    setAnalysisById((current) => ({ ...current, [projectId]: { status: 'loading' } }))
    fetchOwnerProjectAnalysis(projectId)
      .then((data) => setAnalysisById((current) => ({ ...current, [projectId]: { status: 'ready', data } })))
      .catch((error) => setAnalysisById((current) => ({ ...current, [projectId]: { status: 'error', error: analysisError(error) } })))
  }
  const setFlipped = (projectId, flipped) => {
    setFlippedIds((current) => {
      const next = new Set(current)
      if (flipped) next.add(projectId); else next.delete(projectId)
      return next
    })
    if (flipped && (!analysisById[projectId] || analysisById[projectId].status === 'error')) loadAnalysis(projectId)
    // Focus follows the visible side.
    window.requestAnimationFrame(() => (flipped ? analysisBackRefs : analysisToggleRefs).current[projectId]?.focus({ preventScroll: true }))
  }
  // Convert to Project asks for the project's dates on the draft's own card
  // first; the conversion is sent only with both, end not before start.
  const [convertDatesFor, setConvertDatesFor] = useState(null)
  const [convertDates, setConvertDates] = useState({ start_date: '', end_date: '' })
  const [convertDatesMessage, setConvertDatesMessage] = useState('')
  const openConvertDates = (estimate) => {
    setConvertDatesFor(estimate.id)
    setConvertDates({ start_date: '', end_date: '' })
    setConvertDatesMessage('')
  }
  const closeConvertDates = () => {
    setConvertDatesFor(null)
    setConvertDatesMessage('')
  }
  const submitConvertDates = async (event, estimate) => {
    event.preventDefault()
    const problem = projectScheduleProblem(convertDates.start_date, convertDates.end_date)
    if (problem) {
      setConvertDatesMessage(t(problem))
      return
    }
    setConvertDatesMessage('')
    // The estimate as before, plus the dates; the dashboard sends them with it.
    await onConvertEstimate({ ...estimate, start_date: convertDates.start_date, end_date: convertDates.end_date })
    setConvertDatesFor(null)
  }


  if (!entries.length) return null

  const entryKey = (estimate) => estimate?.project_id || estimate?.id
  const deleteSucceeded = deleteMessage === t('dash.msg.projectDeleted')
  // A refused delete leaves the card in place: the reason shows on it. Once the
  // card is gone (deleted), the confirmation floats at the top instead.
  const deleteMessageOnCard = Boolean(deleteMessage) && entries.some(({ estimate }) => entryKey(estimate) === deleteTargetId)

  return (
    <>
      {/* Every project card is the same size whatever it says. Rows are equal
          (auto-rows-fr) and never shorter than the card with all its content
          (title, address, pills, the description line, completion/budget,
          progress and actions): 211px in the one-column phone layout, 215px
          from two columns up. Each card fills its row (EntityCard `fill`), so a
          short project no longer comes out shorter than the others. */}
      <div className="owner-project-cards grid auto-rows-[minmax(211px,1fr)] grid-cols-1 gap-3 sm:auto-rows-[minmax(215px,1fr)] sm:grid-cols-2 lg:grid-cols-3">
        {entries.map(({ project, estimate }) => {
          const elapsed = scheduleWidth(project)
          const schedule = scheduleText(project, t)
          const builderContext = projectBuilderContext(project)
          // A draft is a saved requirement with no project behind it yet, so
          // there is nothing to open and nothing to edit — only convert or
          // discard, which is what it has always offered.
          const isDraft = !estimate?.project_id
          const isDeleting = deletingEstimateId === (estimate?.project_id || estimate?.id)
          const estimateCountry = estimate?.project_country || project.project_country || defaultCountry
          // The active amount: the finalized contract once the awarded builder
          // has confirmed, otherwise the stored budget, or "Not set". Never an
          // invented amount.
          const activeBudget = project.contract_amount ?? project.awarded_amount ?? estimate?.budget
          const budgetLabel = Number(activeBudget) > 0
            ? money(activeBudget, estimateCountry)
            : t('dash.common.notSet')
          // Many projects are saved with the title repeated as the description,
          // which rendered the name twice on the card. Only a description that
          // actually says something new is worth a second line.
          const describes = estimate?.project_description
            && normalizeEstimateText(estimate.project_description) !== normalizeEstimateText(estimate.project_title)
          const builderText = isDraft
            ? t('dash.owner.estimates.savedDraft')
            : builderContext.kind === 'self'
              ? constructionTypeText(project.construction_type, t)
              : builderContext.kind === 'builder'
                ? `${t('dash.common.builder')}: ${td(builderContext.name)}`
                : t('dash.owner.estimates.lookingForBuilder')
          const cardTitle = td(project.title)
          const flipped = !isDraft && flippedIds.has(project.id)
          return (
            // Front: the project card as it was. Back (real projects only):
            // its Project Analysis. Each card turns on its own.
            <div key={project.id} className="relative h-full [perspective:1200px]">
            {deleteMessageOnCard && entryKey(estimate) === deleteTargetId && (
              <p
                role={deleteSucceeded ? 'status' : 'alert'}
                className={`absolute inset-x-2 bottom-2 z-10 rounded-lg border px-3 py-2 text-center text-xs font-bold shadow-md ${deleteSucceeded ? 'border-emerald-100 bg-emerald-50 text-emerald-800' : 'border-red-100 bg-red-50 text-red-700'}`}
              >
                {deleteMessage}
              </p>
            )}
            <div className={`relative h-full transition-transform duration-300 ease-out [transform-style:preserve-3d] motion-reduce:transition-none ${flipped ? '[transform:rotateY(180deg)]' : ''}`}>
            <div className="h-full [backface-visibility:hidden]" aria-hidden={flipped || undefined} inert={flipped ? '' : undefined}>
            <EntityCard
              compact
              // Fills its grid row, so every card is the row's (fixed) height
              // rather than the height of its own text. The content keeps its
              // place at the top; a shorter card has the room below it.
              fill
              onClick={isDraft ? undefined : () => onSelect(project)}
              // No `action`, so EntityCard renders no header row at all. That
              // row existed only to carry the budget in its top corner, and
              // with nothing beside it the card opened on a band of empty
              // space. The budget now sits low in the body instead, and the
              // title starts at the top of the card.
              avatar={
                <EntityAvatar
                  src={project.cover_image_url ? imageUrl(project.cover_image_url) : defaultProjectImage}
                  alt={cardTitle}
                  // The first letter of the name as it is READ, so the mark
                  // matches the title beside it instead of an English "P".
                  fallback={cardTitle.trim().slice(0, 1).toUpperCase() || '•'}
                />
              }
              title={cardTitle}
              // The location the requirement card listed as its third fact. It
              // is the card's subtitle here rather than a pill, so the address
              // is not printed twice on one card.
              subtitle={`${td(project.address) || t('dash.owner.estimates.locationNotSet')} ${project.pincode || ''}`.trim()}
              pills={[
                { key: 'builder', text: builderText, icon: MapPin, tone: 'positive' },
                { key: 'area', text: t('dash.owner.sqft', { area: estimate?.land_area ?? project.land_area ?? 0 }), tone: 'info' },
                {
                  key: 'build',
                  tone: 'accent',
                  text: (estimate?.floor_type ? optionLabel(t, FLOOR_TYPE_KEYS, estimate.floor_type) : '')
                    || buildingTypeText(project.building_type, t)
                    || t('dash.owner.floorsCount', { floors: project.floors || 1 }),
                },
              ]}
            >
              {describes && <p className="mt-1.5 line-clamp-1 text-[11px] font-medium text-oc-muted">{td(estimate.project_description)}</p>}

              {/* Completion on the left, the amount on the right of the same
                  row — the amount no longer has a line of its own lower down.
                  Both keep the chip they already used. `justify-between` puts
                  the amount on the right edge, and the row wraps rather than
                  overlapping when the card gets narrow. */}
              {/* `mt-auto` pins this row, the bar, the schedule line and the
                  actions to the foot of the card, so Edit / Delete sit in the
                  same place on every card however much text is above them. */}
              <div className="mt-auto flex flex-wrap items-center justify-between gap-x-2 gap-y-1 pt-2">
                {/* Completion once it can be measured; until then Progress, the
                    schedule percentage the bar shows -- but only once work has
                    actually started on site (`work_started`, the app's one
                    rule). Before that a passed start date is no progress, so
                    the card says "Not started yet". "Not set" without usable
                    dates. A draft has no project, so it shows none; the empty
                    span keeps the amount on the right. */}
                <span className="text-[11px] font-semibold text-oc-muted">{isDraft
                  ? ''
                  : completionPercent(project) !== null
                    ? `${t('dash.owner.projectList.completion')}: ${completionText(project, t)}`
                    : project.work_started !== true
                      ? `${t('dash.contractor.progress')}: ${t('progress.scheduleNotStarted')}`
                      : `${t('dash.contractor.progress')}: ${['in_progress', 'end_date_passed', 'not_started'].includes(project.schedule_status) ? formatPercent(elapsed) : t('dash.common.notSet')}`}</span>
                <span className="text-sm font-extrabold text-oc-ink">
                  {budgetLabel}
                </span>
              </div>

              {/* The progress bar sits directly under that row and doubles as
                  the rule above the actions, so the card carries one line
                  there rather than the bar and a separate divider. It fills to
                  the schedule figure on the line below (elapsed planned time). */}
              <div className="owner-project-progress mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
                <div className="h-full rounded-full bg-emerald-500" style={{ width: `${project.work_started === true ? elapsed : 0}%` }} />
              </div>
              {/* Elapsed planned time, labelled as schedule: it is not completion.
                  The line keeps its height when there is no schedule, so the
                  actions below do not move up. */}
              <div className="mt-1 flex min-h-[15px] items-center gap-2">
                <p aria-hidden={schedule ? undefined : true} className="min-w-0 flex-1 truncate text-[10px] font-semibold text-oc-muted">{schedule ? `${t('progress.schedule')}: ${schedule}` : ''}</p>
                {/* Turns this card over to its Project Analysis. A button, so
                    EntityCard does not treat the click as opening the project. */}
                {!isDraft && (
                  <button
                    ref={(node) => { analysisToggleRefs.current[project.id] = node }}
                    type="button"
                    onClick={(event) => { event.stopPropagation(); setFlipped(project.id, true) }}
                    className="inline-flex shrink-0 items-center gap-1 rounded text-[10px] font-extrabold text-oc-green hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-oc-green/40"
                  >
                    {t('owner.analysis.view')} <RotateCw aria-hidden="true" className="h-3 w-3" />
                  </button>
                )}
              </div>

              {/* The actions the requirement card carried, on the one card that
                  is left. EntityCard ignores clicks that land on a button, so
                  none of these opens the project. They sit at the foot of the
                  card with the block above them (see `mt-auto`). */}
              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                {isDraft && (
                  <span className="text-[10px] font-medium text-oc-muted">{t('dash.owner.estimates.draftSyncNote')}</span>
                )}
                {isDraft && convertDatesFor !== estimate.id && (
                  <button
                    type="button"
                    disabled={convertingEstimateId === estimate.id}
                    onClick={() => openConvertDates(estimate)}
                    className="inline-flex h-7 items-center gap-1.5 rounded-lg bg-oc-deep px-2.5 text-[11px] font-extrabold text-white transition hover:bg-oc-green disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <Plus className="h-3 w-3" /> {convertingEstimateId === estimate.id ? t('dash.owner.estimates.converting') : t('dash.owner.estimates.convertToProject')}
                  </button>
                )}
                {isDraft && convertDatesFor === estimate.id && (
                  <form onSubmit={(event) => submitConvertDates(event, estimate)} className="flex w-full flex-wrap items-end gap-2">
                    <label className="block">
                      <span className="block text-[10px] font-bold text-oc-muted">{t('dash.owner.projectDetails.startDate')}</span>
                      <input type="date" required value={convertDates.start_date} max={convertDates.end_date || undefined} onChange={(event) => setConvertDates((current) => ({ ...current, start_date: event.target.value }))} className="mt-0.5 h-7 rounded-lg border border-oc-line bg-white px-2 text-[11px] outline-none focus:border-ocbrand-400" />
                    </label>
                    <label className="block">
                      <span className="block text-[10px] font-bold text-oc-muted">{t('dash.owner.projectDetails.endDate')}</span>
                      <input type="date" required value={convertDates.end_date} min={convertDates.start_date || undefined} onChange={(event) => setConvertDates((current) => ({ ...current, end_date: event.target.value }))} className="mt-0.5 h-7 rounded-lg border border-oc-line bg-white px-2 text-[11px] outline-none focus:border-ocbrand-400" />
                    </label>
                    <button
                      type="submit"
                      disabled={convertingEstimateId === estimate.id}
                      className="inline-flex h-7 items-center gap-1.5 rounded-lg bg-oc-deep px-2.5 text-[11px] font-extrabold text-white transition hover:bg-oc-green disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <Plus className="h-3 w-3" /> {convertingEstimateId === estimate.id ? t('dash.owner.estimates.converting') : t('dash.owner.projectForm.create')}
                    </button>
                    <button type="button" onClick={closeConvertDates} className="inline-flex h-7 items-center rounded-lg border border-oc-line bg-white px-2.5 text-[11px] font-extrabold text-oc-muted transition hover:bg-slate-50">
                      {t('dash.common.cancel')}
                    </button>
                    {convertDatesMessage && <p role="alert" className="w-full text-[10px] font-bold text-red-600">{convertDatesMessage}</p>}
                  </form>
                )}
                {!isDraft && (
                  <button
                    type="button"
                    onClick={() => onEditProject?.(project)}
                    className="owner-card-btn-edit inline-flex h-7 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 text-[11px] font-extrabold text-oc-ink transition hover:bg-slate-50"
                  >
                    <Pencil className="h-3 w-3" /> {t('dash.owner.estimates.edit')}
                  </button>
                )}
                <button
                  type="button"
                  disabled={isDeleting}
                  onClick={() => setPendingDelete(estimate)}
                  className="owner-card-btn-delete inline-flex h-7 items-center gap-1.5 rounded-lg border border-red-100 bg-red-50 px-2.5 text-[11px] font-extrabold text-red-600 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <Trash2 className="h-3 w-3" /> {isDeleting ? t('dash.common.deleting') : t('dash.common.delete')}
                </button>
                {/* A shortcut into this project's existing Assigned Builders
                    section -- the same accepted quotations and the same Assign
                    Project action as opening the project. Only on a real
                    project that is built by a builder: a draft has no project
                    yet, and a self-construction project takes no builder. */}
                {!isDraft && project.construction_type !== 'SELF_CONSTRUCTION' && onAssignBuilder && (
                  <button
                    type="button"
                    onClick={() => onAssignBuilder(project)}
                    className="owner-card-btn-assign ms-auto inline-flex h-7 items-center gap-1.5 rounded-lg border border-emerald-100 bg-emerald-50 px-2.5 text-[11px] font-extrabold text-oc-deep transition hover:bg-emerald-100"
                  >
                    {/* Assigned means awarded: projects.contractor_id, the same
                        field the Assigned Builders section reads -- not merely
                        an accepted quotation. The list reloads after an
                        assignment, so the label follows the saved state. */}
                    <HardHat className="h-3 w-3" /> {project.contractor_id ? t('quote.builderAssignedButton') : t('quote.assignBuilder')}
                  </button>
                )}
              </div>
            </EntityCard>
            </div>
            {!isDraft && (
              <div className="absolute inset-0 overflow-hidden rounded-[18px] border border-oc-line bg-white shadow-ocsoft [backface-visibility:hidden] [transform:rotateY(180deg)]" aria-hidden={!flipped || undefined} inert={flipped ? undefined : ''}>
                {(flipped || analysisById[project.id]) && (
                  <OwnerProjectAnalysisPanel
                    ref={(node) => { analysisBackRefs.current[project.id] = node }}
                    project={project}
                    country={estimateCountry}
                    state={analysisById[project.id]}
                    onRetry={() => loadAnalysis(project.id)}
                    onBack={() => setFlipped(project.id, false)}
                  />
                )}
              </div>
            )}
            </div>
            </div>
          )
        })}
      </div>

      {convertMessage && <p className="rounded-xl border border-oc-line bg-oc-mint px-4 py-2.5 text-sm font-bold text-oc-deep">{convertMessage}</p>}
      {/* Only when the card itself is gone; otherwise the message is on the
          card. It clears itself after a few seconds (OwnerDashboard). */}
      {deleteMessage && !deleteMessageOnCard && (
        <p
          role={deleteSucceeded ? 'status' : 'alert'}
          className={`fixed left-1/2 top-20 z-[125] w-[min(92vw,30rem)] -translate-x-1/2 rounded-xl border px-4 py-2.5 text-center text-sm font-bold shadow-lg ${deleteSucceeded ? 'border-emerald-100 bg-emerald-50 text-emerald-800' : 'border-red-100 bg-red-50 text-red-700'}`}
        >
          {deleteMessage}
        </p>
      )}

      {pendingDelete && (
        <div className="fixed inset-0 z-[120] grid place-items-center bg-oc-night/50 p-4 backdrop-blur-sm" role="dialog" aria-modal="true">
          <div className="w-full max-w-md rounded-2xl border border-oc-line bg-white p-5 shadow-2xl">
            <div className="flex items-start gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-red-50 text-red-600 ring-1 ring-red-100">
                <AlertTriangle className="h-5 w-5" />
              </span>
              <div className="min-w-0 flex-1">
                <h3 className="font-display text-lg font-extrabold text-oc-ink">{t('dash.owner.estimates.deleteTitle')}</h3>
                <p className="mt-1 text-sm leading-5 text-oc-muted">{t('dash.owner.estimates.deleteBody')}</p>
                <p className="mt-2 truncate text-xs font-bold text-oc-muted">{td(pendingDelete.project_title) || t('dash.common.untitledEstimate')}</p>
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPendingDelete(null)}
                className="h-9 rounded-lg border border-oc-line bg-white px-4 text-xs font-extrabold text-oc-ink transition hover:bg-ocbrand-50"
              >
                {t('dash.common.cancel')}
              </button>
              <button
                type="button"
                disabled={deletingEstimateId !== null}
                onClick={() => {
                  const estimateToDelete = pendingDelete
                  setPendingDelete(null)
                  setDeleteTargetId(entryKey(estimateToDelete))
                  onDeleteEstimate(estimateToDelete)
                }}
                className="h-9 rounded-lg bg-red-600 px-4 text-xs font-extrabold text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {t('dash.common.delete')}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
