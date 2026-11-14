import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { assertProfileImage } from '../../../shared/utils/profileImageRules.js'
import { useDispatch, useSelector } from 'react-redux'
import { useLocation, useNavigate } from 'react-router-dom'
import { ArrowLeft, ArrowRight, Home, Lock } from 'lucide-react'
import Logo from '../../../shared/ui/Logo.jsx'
import { usePincodeAreaLookup } from '../../../shared/hooks/usePincodeAreaLookup.js'
import { findBranchByDisplay, lookupBranchList, onlyBranchOf } from '../../../shared/utils/pincodeBranches.js'
import { uploadLocalFile } from '../../../shared/api/uploadApi.js'
import { setAuthenticatedUser } from '../../../shared/auth/authSlice.js'
import EmailVerificationSection from '../../accounts/components/EmailVerificationSection.jsx'
import PhoneChangeSection from '../../accounts/components/PhoneChangeSection.jsx'
import { completeUserProfile } from '../../auth/authApi.js'
import { fetchContractorProfile, fetchSupplierProfile } from '../../accounts/publicProfileApi.js'
import { budgetNumberFromEstimate, floorCountFromEstimate, isValidPhoneForCountry, isValidPostalCodeForCountry, missingContractorProfileFields, normalizePhone, phoneMaxLengthForCountry, readPendingEstimate, rolePath, savedPincodeLocationKept, saveOwnerEstimate } from '../../../shared/auth/accountPaths.js'
import { apiErrorMessage, apiFieldErrors } from '../../../shared/auth/accountPaths.js'
import { contractorSteps, isStoreManagerCategory } from '../profileConstants.js'
import { ContractorProfileSteps } from '../components/BuilderProfileSteps.jsx'
import { SupplierProfileSteps } from '../components/SupplierProfileSteps.jsx'
import { supplierKind, supplierTextKeys } from '../supplierProfileKinds.js'
import { OwnerProfileSteps } from '../components/OwnerProfileSteps.jsx'
import EngineerProfileSteps from '../components/EngineerProfileSteps.jsx'
import { useLanguage } from '../../../i18n/LanguageContext.jsx'
import { floorCountFor } from '../../../shared/utils/floorOptions.js'
import { DOCUMENT_TYPE_KEYS, optionLabel } from '../../../i18n/optionKeys.js'
import { lookupPincodeArea } from '../locationApi.js'
import useBuilderSubscription from '../../billing/subscription/useBuilderSubscription.js'
import { locationUsage, maxLocationsMessage, promptPlan, serviceLocationCap as locationCapFor } from '../../billing/subscription/planLimits.js'
import { branchLocationEntry } from '../../billing/subscription/locationEntries.js'

// The account's role code as the role name the rest of the app shows.
const SETUP_ROLE_KEYS = {
  OWNER: 'role.owner',
  BUILDER: 'role.contractor',
  SUPPLIER: 'role.supplier',
  ENGINEER: 'role.engineer',
}

export default function CompleteProfilePage() {
  const { t } = useLanguage()
  const { user } = useSelector((state) => state.auth)
  const pendingEstimate = useMemo(readPendingEstimate, [])
  const dispatch = useDispatch()
  const navigate = useNavigate()
  const location = useLocation()
  const ownerProfile = user?.owner_profile || {}
  const isOwnerEstimateMode = user?.role === 'OWNER' && new URLSearchParams(location.search).get('mode') === 'estimate'
  // Set by useProfileGate when an action sent the user here. Saving returns
  // them to that screen, where the action they started resumes on its own.
  const returnTo = location.state?.returnTo || ''
  const initialEstimate = isOwnerEstimateMode ? null : pendingEstimate
  // An engineer's saved details come with the signed-in user, so the form opens
  // on them; otherwise a re-save sent the blank defaults back (experience 0).
  const savedEngineer = user?.role === 'ENGINEER' ? (user?.engineer_profile || {}) : {}
  const [profileDetails, setProfileDetails] = useState({
    name: user?.name || '',
    phone: user?.phone || '',
    address: isOwnerEstimateMode ? '' : user?.address || '',
    pincode: isOwnerEstimateMode ? '' : user?.pincode || initialEstimate?.pincode || '',
    location: isOwnerEstimateMode ? '' : user?.location || initialEstimate?.area || '',
    building_type: isOwnerEstimateMode ? '' : initialEstimate?.buildingType || ownerProfile.building_type || 'RESIDENTIAL',
    construction_type: isOwnerEstimateMode ? '' : initialEstimate?.constructionType || ownerProfile.construction_type || 'CONTRACTOR',
    budget: isOwnerEstimateMode ? '' : initialEstimate ? budgetNumberFromEstimate(initialEstimate?.budget) : ownerProfile.budget || 0,
    land_area: isOwnerEstimateMode ? '' : initialEstimate ? Number(initialEstimate?.landArea || 0) : ownerProfile.land_area || 0,
    floors: isOwnerEstimateMode ? '' : initialEstimate ? floorCountFromEstimate(initialEstimate?.floors) : ownerProfile.floors || 1,
    // The exact configuration, when one was saved. An older profile has none
    // and simply starts unselected; its numeric `floors` is untouched.
    floor_type: ownerProfile.floor_type || '',
    project_title: isOwnerEstimateMode ? '' : initialEstimate ? `${initialEstimate.area || 'Home'} construction` : ownerProfile.project_title || '',
    project_description: isOwnerEstimateMode ? '' : ownerProfile.project_description || '',
    site_status: ownerProfile.site_status || '',
    start_timeline: isOwnerEstimateMode ? '' : ownerProfile.start_timeline || '',
    design_status: ownerProfile.design_status || '',
    contact_preference: ownerProfile.contact_preference || '',
    company_name: '',
    company_logo_url: '',
    license_number: savedEngineer.license_number || '',
    experience_years: savedEngineer.experience_years ?? 0,
    profile_image_url: '',
    about: savedEngineer.about || '',
    gstin: '',
    pan: '',
    website: '',
    business_type: '',
    supplier_category: '',
    registration_year: '',
    team_size: '',
    insurance_available: false,
    service_locations: '',
    services_offered: '',
    equipment_owned: '',
    documents: '',
    gallery: '',
    store_name: '',
    store_logo_url: '',
    categories: '',
    qualification: user?.engineer_profile?.qualification || '',
    specialization: user?.engineer_profile?.specialization || '',
    country_of_residence: user?.country_of_residence || 'India',
  })
  const profileCountry = profileDetails.country_of_residence || 'India'
  const [errorMessage, setErrorMessage] = useState('')
  const [validationErrors, setValidationErrors] = useState({})
  const [uploadMessage, setUploadMessage] = useState('')
  const [serviceLocationInputs, setServiceLocationInputs] = useState([
    // A builder's service locations are only ever what the builder saved or
    // adds; their street address is not quietly offered as one.
    isOwnerEstimateMode || user?.role === 'BUILDER' ? '' : user?.address || initialEstimate?.area || '',
    '',
    '',
  ])
  const [selectedServices, setSelectedServices] = useState([])
  const [selectedEquipment, setSelectedEquipment] = useState([])
  const [selectedSupplierCategories, setSelectedSupplierCategories] = useState([])
  // The Supplier Category saved on the server ('' while none is saved yet).
  const [savedSupplierCategory, setSavedSupplierCategory] = useState('')
  // Each gallery image's preview and uploaded address travel together, so a
  // removal or a failed upload can never pair one image's preview with
  // another's address. `url` stays empty until that file's upload succeeds.
  const [galleryItems, setGalleryItems] = useState([])
  const untypedDocumentsRef = useRef([])
  const galleryImagePreviews = galleryItems.map((item) => item.preview)
  const galleryImageUrls = galleryItems.filter((item) => item.url).map((item) => item.url)
  const [profileImagePreview, setProfileImagePreview] = useState('')
  const [businessLogoPreview, setBusinessLogoPreview] = useState('')
  const [documentUploads, setDocumentUploads] = useState({})
  const [documentUploadStatus, setDocumentUploadStatus] = useState({})
  const [contractorStep, setContractorStep] = useState(1)
  // The estimate form is step 2 of the owner layout; the profile itself is one step.
  const ownerStep = isOwnerEstimateMode ? 2 : 1
  const [contractorLocationDraft, setContractorLocationDraft] = useState('')
  const contractorFormTopRef = useRef(null)
  const contractorSubmitIntentRef = useRef(false)
  const isContractorRole = user?.role === 'BUILDER'
  // India builders add each service location by its pincode (leads are matched on
  // it), within their plan's location limit (the server's `usage`; null =
  // unlimited). Elsewhere the existing free-text, up-to-3 list is unchanged.
  const builderSubscription = useBuilderSubscription({ enabled: isContractorRole })
  const pincodeLocations = isContractorRole && String(profileCountry).trim().toLowerCase() === 'india'
  const [locationLookupBusy, setLocationLookupBusy] = useState(false)
  const isSupplierRole = user?.role === 'SUPPLIER'
  // A builder's saved profile is loaded before anything can be saved, so a
  // save can never overwrite saved details with the blank starting form.
  //   loading  the saved profile is being fetched
  //   ready    saved details (if any) are in the form
  //   failed   it could not be loaded; saving stays blocked
  const [savedProfileState, setSavedProfileState] = useState(isContractorRole || isSupplierRole ? 'loading' : 'ready')
  // Which required fields were still empty when the saved profile loaded.
  const [missingContractorFields, setMissingContractorFields] = useState([])
  const [hasSavedDocuments, setHasSavedDocuments] = useState(false)
  const [selectedPincodeBranch, setSelectedPincodeBranch] = useState(null)
  const savedLocationRef = useRef({ pincode: user?.pincode || '', location: user?.location || '' })
  // The address the pincode last filled in. While Address is empty or still
  // holds that value it follows the pincode; once the account holder types
  // their own, it is theirs and is never replaced.
  // An address the pincode step saved (it equals the saved location) still
  // counts as filled in from the pincode.
  const autoAddressRef = useRef(user?.address && user.address === user?.location ? user.address : '')
  // The supplier's first Delivery Location the pincode last filled in, under
  // the same rule as Address.
  const autoServiceLocationRef = useRef('')
  // Address follows the pincode while it is empty or still holds what the
  // pincode last put there (`lastAutoAddress`); text typed is never replaced.
  // Pure, because React may run a state updater twice: callers read the ref
  // before updating and record the new value after.
  const followPincodeAddress = (currentAddress, display, lastAutoAddress) => {
    if (String(currentAddress || '').trim() && currentAddress !== lastAutoAddress) return currentAddress
    return display
  }
  // Owners, engineers and suppliers: the first Delivery Location follows the
  // chosen post office while every location is empty or it still holds what
  // the pincode last filled in. Builders' service locations are only typed.
  const followPincodeServiceLocation = (display) => {
    if (isContractorRole) return
    const lastAutoLocation = autoServiceLocationRef.current
    setServiceLocationInputs((currentLocations) => {
      const firstIsAuto = Boolean(lastAutoLocation) && currentLocations[0] === lastAutoLocation
      if (!firstIsAuto && currentLocations.some((location) => location.trim())) return currentLocations
      return [display, ...currentLocations.slice(1)]
    })
    autoServiceLocationRef.current = display
  }
  // The pincode resolves its post offices. With several, nothing is taken from
  // the first one India Post lists: the list is shown, and the one picked fills
  // Location, Address and the first Delivery Location. A single post office is
  // picked for the account holder. Values the previous pincode filled in are
  // cleared; typed ones, and a saved location for the saved pincode, stay.
  const applyResolvedArea = useCallback((areaDetails) => {
    const branches = lookupBranchList(areaDetails)
    const awaitingPick = branches.length > 1
    const isSavedPincode = areaDetails.pincode === savedLocationRef.current.pincode
    const savedBranch = isSavedPincode ? findBranchByDisplay(branches, savedLocationRef.current.location) : null
    setSelectedPincodeBranch(onlyBranchOf(branches) || savedBranch)
    const pincodeDisplay = awaitingPick ? (savedBranch?.display || '') : (areaDetails.display || '')
    const lastAutoAddress = autoAddressRef.current
    setProfileDetails((currentProfileDetails) => {
      // Re-resolving the pincode that is already saved keeps the saved
      // location (and address) rather than replacing them.
      const keepSavedLocation = isSavedPincode && Boolean(currentProfileDetails.location)
      const addressUnchanged = keepSavedLocation || (!awaitingPick && !pincodeDisplay)
      return {
        ...currentProfileDetails,
        location: keepSavedLocation
          ? currentProfileDetails.location
          : pincodeDisplay || (awaitingPick ? '' : currentProfileDetails.location),
        address: addressUnchanged
          ? currentProfileDetails.address
          : followPincodeAddress(currentProfileDetails.address, pincodeDisplay, lastAutoAddress),
        pincode: areaDetails.pincode || currentProfileDetails.pincode,
        service_locations: isContractorRole
          ? currentProfileDetails.service_locations
          : currentProfileDetails.service_locations || pincodeDisplay,
      }
    })
    autoAddressRef.current = pincodeDisplay
    followPincodeServiceLocation(pincodeDisplay)
    // The two helpers only read refs and state setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isContractorRole])
  const pincodeLookupState = usePincodeAreaLookup(profileDetails.pincode, applyResolvedArea, profileDetails.country_of_residence)
  const selectPincodeBranch = (branch) => {
    const lastAutoAddress = autoAddressRef.current
    setSelectedPincodeBranch(branch)
    setProfileDetails((currentProfileDetails) => ({
      ...currentProfileDetails,
      location: branch.display,
      address: followPincodeAddress(currentProfileDetails.address, branch.display, lastAutoAddress),
    }))
    autoAddressRef.current = branch.display
    followPincodeServiceLocation(branch.display)
    clearValidationError('pincode')
  }
  // Several post offices under the pincode and none chosen yet. A location
  // saved earlier for this same pincode still counts as chosen.
  // A builder's step 1 opens (for the phone, say) on the pincode and post office
  // the PIN code step already saved: those are not asked for again, so the post
  // office list is offered only once the pincode or location is changed.
  const pincodeLocationKept = savedPincodeLocationKept(profileDetails, savedLocationRef.current)
  const pincodeBranchMissing = pincodeLookupState.status === 'success'
    && (pincodeLookupState.branches || []).length > 1
    && !selectedPincodeBranch
    && !(profileDetails.pincode === savedLocationRef.current.pincode
      && Boolean(profileDetails.location)
      && profileDetails.location === savedLocationRef.current.location)

  // Prefill a builder's form from what is saved on the server.
  useEffect(() => {
    if (!isContractorRole || !user?.id) return undefined
    let cancelled = false
    const listOf = (value) => (Array.isArray(value) ? value : String(value || '').split(','))
      .map((item) => String(item).trim())
      .filter(Boolean)
    const applySavedProfile = (saved) => {
      const savedServices = listOf(saved?.services_offered)
      const savedLocations = listOf(saved?.service_locations)
      const savedGallery = listOf(saved?.gallery)
      const savedDocuments = {}
      const untypedDocuments = []
      listOf(saved?.documents).forEach((entry) => {
        const separatorIndex = entry.indexOf(': ')
        if (separatorIndex > 0) savedDocuments[entry.slice(0, separatorIndex).trim()] = entry.slice(separatorIndex + 2).trim()
        else untypedDocuments.push(entry)
      })
      // Documents an older Settings screen saved without a type are not shown
      // here, but they are written back unchanged instead of being dropped.
      untypedDocumentsRef.current = untypedDocuments
      const savedPhone = saved?.phone || user?.phone || ''
      const savedAddress = saved?.address || user?.address || ''
      const savedPincode = saved?.pincode || user?.pincode || ''
      savedLocationRef.current = { pincode: savedPincode, location: user?.location || '' }
      setProfileDetails((currentProfileDetails) => ({
        ...currentProfileDetails,
        phone: savedPhone,
        address: savedAddress,
        pincode: savedPincode,
        location: user?.location || currentProfileDetails.location || '',
        profile_image_url: saved?.profile_image_url || user?.profile_image_url || '',
        company_name: saved?.company_name || '',
        company_logo_url: saved?.company_logo_url || '',
        license_number: saved?.license_number || '',
        experience_years: saved?.experience_years || '',
        about: saved?.about || '',
        gstin: saved?.gstin || '',
        pan: saved?.pan || '',
        website: saved?.website || '',
        business_type: saved?.business_type || '',
        registration_year: saved?.registration_year || '',
        team_size: saved?.team_size || '',
        insurance_available: Boolean(saved?.insurance_available),
      }))
      setSelectedServices(savedServices)
      setSelectedEquipment(listOf(saved?.equipment_owned))
      setServiceLocationInputs([...savedLocations, '', '', ''].slice(0, Math.max(3, savedLocations.length)))
      setGalleryItems(savedGallery.map((url) => ({ key: url, preview: url, url })))
      setDocumentUploads(savedDocuments)
      setDocumentUploadStatus(Object.fromEntries(Object.keys(savedDocuments).map((documentType) => [documentType, 'uploaded'])))
      setHasSavedDocuments(Object.keys(savedDocuments).length > 0)
      // The same required fields, and the same presence rules, as
      // User.profile_completion_fields() on the server.
      const missing = missingContractorProfileFields(saved, user)
      setMissingContractorFields(missing)
      return missing
    }
    fetchContractorProfile(user.id)
      .then((saved) => {
        if (cancelled) return
        applySavedProfile(saved)
        setSavedProfileState('ready')
      })
      .catch((error) => {
        if (cancelled) return
        // No builder profile exists yet: there is nothing saved to keep.
        if (error.response?.status === 404) {
          applySavedProfile(null)
          setSavedProfileState('ready')
          return
        }
        setSavedProfileState('failed')
      })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isContractorRole, user?.id])

  // Prefill a supplier's form from what is saved on the server, the same way
  // the builder's is: a returning supplier sees their store name, about text,
  // categories and delivery locations instead of an empty form, and a save can
  // never send blanks over them.
  useEffect(() => {
    if (!isSupplierRole || !user?.id) return undefined
    let cancelled = false
    const listOf = (value) => (Array.isArray(value) ? value : String(value || '').split(','))
      .map((item) => String(item).trim())
      .filter(Boolean)
    fetchSupplierProfile(user.id)
      .then((saved) => {
        if (cancelled) return
        const savedLocations = listOf(saved?.delivery_locations).slice(0, 3)
        setProfileDetails((currentProfileDetails) => ({
          ...currentProfileDetails,
          store_name: saved?.store_name || '',
          store_logo_url: saved?.store_logo_url || '',
          about: saved?.about || '',
          gstin: saved?.gstin || '',
          pan: saved?.pan || '',
          website: saved?.website || '',
          business_type: saved?.business_type || '',
          supplier_category: saved?.supplier_category || '',
          registration_year: saved?.registration_year || '',
          profile_image_url: saved?.profile_image_url || user?.profile_image_url || '',
        }))
        // The category on the server decides which supplier form is shown; it
        // is chosen once, so a saved one is shown read-only.
        setSavedSupplierCategory(saved?.supplier_category || '')
        setSelectedSupplierCategories(listOf(saved?.categories))
        if (savedLocations.length) setServiceLocationInputs([...savedLocations, '', '', ''].slice(0, 3))
        setSavedProfileState('ready')
      })
      .catch((error) => {
        if (cancelled) return
        // No supplier profile exists yet: there is nothing saved to keep.
        setSavedProfileState(error.response?.status === 404 ? 'ready' : 'failed')
      })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSupplierRole, user?.id])

  // The steps this builder still has to go through: only those holding a
  // missing required field, plus the documents step while no document is
  // saved. With nothing missing, every step is open for review.
  const contractorStepSequence = useMemo(() => {
    const stepFields = {
      1: ['phone', 'address', 'pincode'],
      2: ['company_name', 'license_number', 'experience_years', 'about'],
      3: ['service_locations', 'services_offered'],
    }
    const needed = [1, 2, 3].filter((step) => stepFields[step].some((field) => missingContractorFields.includes(field)))
    if (!needed.length) return [1, 2, 3, 4]
    return hasSavedDocuments ? needed : [...needed, 4]
  }, [missingContractorFields, hasSavedDocuments])
  const nextContractorStep = contractorStepSequence.find((step) => step > contractorStep) ?? null
  const previousContractorStep = [...contractorStepSequence].reverse().find((step) => step < contractorStep) ?? null

  // Open on the first step that still needs something.
  useEffect(() => {
    if (isContractorRole && savedProfileState === 'ready') setContractorStep(contractorStepSequence[0])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isContractorRole, savedProfileState])

  // A number verified in the Mobile number section above is the account's
  // number now; the form sends it back unchanged rather than the empty field.
  useEffect(() => {
    if (user?.phone) setProfileDetails((current) => (current.phone ? current : { ...current, phone: user.phone }))
  }, [user?.phone])

  const updateProfileField = (field, value) => {
    setProfileDetails((currentProfileDetails) => ({ ...currentProfileDetails, [field]: field === 'phone' ? normalizePhone(value, phoneMaxLengthForCountry(profileCountry)) : value }))
    setValidationErrors((currentErrors) => {
      if (!currentErrors[field]) return currentErrors
      const nextErrors = { ...currentErrors }
      delete nextErrors[field]
      return nextErrors
    })
  }

  const clearValidationError = (field) => {
    setValidationErrors((currentErrors) => {
      if (!currentErrors[field]) return currentErrors
      const nextErrors = { ...currentErrors }
      delete nextErrors[field]
      return nextErrors
    })
  }

  const fieldHasError = (field) => Boolean(validationErrors[field])

  const fieldInputClass = (field, extraClass = '') => `${extraClass} rounded-md border px-3 text-sm outline-none transition ${
    fieldHasError(field) ? 'border-red-500 bg-red-50 ring-1 ring-red-200 focus:border-red-500 focus:ring-2 focus:ring-red-100' : 'border-slate-200 bg-white focus:border-brand-400 focus:ring-2 focus:ring-brand-100'
  }`

  const fieldTextareaClass = (field) => `mt-1.5 min-h-20 w-full rounded-md border px-3 py-2 text-sm outline-none transition ${
    fieldHasError(field) ? 'border-red-500 bg-red-50 ring-1 ring-red-200 focus:border-red-500 focus:ring-2 focus:ring-red-100' : 'border-slate-200 bg-white focus:border-brand-400 focus:ring-2 focus:ring-brand-100'
  }`

  const optionGroupClass = (field, extraClass = '') => `${extraClass} ${
    fieldHasError(field) ? 'rounded-xl border border-red-500 bg-red-50 p-2 ring-1 ring-red-200' : ''
  }`

  const FieldError = ({ field }) => (
    fieldHasError(field) ? <p className="mt-1 text-[11px] font-bold text-red-600">{validationErrors[field]}</p> : null
  )

  const toggleListValue = (value, selectedValues, setSelectedValues, validationField) => {
    setSelectedValues((currentValues) => (
      currentValues.includes(value)
        ? currentValues.filter((currentValue) => currentValue !== value)
        : [...currentValues, value]
    ))
    if (validationField) clearValidationError(validationField)
  }

  const updateServiceLocation = (index, value) => {
    setServiceLocationInputs((currentLocations) => currentLocations.map((location, locationIndex) => (
      locationIndex === index ? value : location
    )))
    if (value.trim()) clearValidationError('service_locations')
  }

  const savedLocationCount = serviceLocationInputs.filter((location) => location.trim()).length
  const serviceLocationUsage = pincodeLocations ? locationUsage(builderSubscription.status, savedLocationCount) : null
  // The cap the add button keeps to (planLimits.serviceLocationCap).
  const serviceLocationCap = locationCapFor(serviceLocationUsage, pincodeLocations)
  // The post offices the typed pincode resolved to (India builders), one of which
  // the builder picks to add.
  const [locationBranches, setLocationBranches] = useState([])
  const updateContractorLocationDraft = (value) => {
    setContractorLocationDraft(value)
    setLocationBranches([])
  }
  const serviceLocationsFull = () => {
    if (serviceLocationCap === null || savedLocationCount < serviceLocationCap) return false
    // The plan's own cap (1 on Free, 3 on Pro; Plus and Premium never reach here).
    const message = maxLocationsMessage(serviceLocationCap)
    setValidationErrors((currentErrors) => ({ ...currentErrors, service_locations: t(message.key, message.values) }))
    return true
  }

  const addContractorServiceLocation = async () => {
    const draft = contractorLocationDraft.trim()
    if (!draft) return
    if (serviceLocationsFull()) return
    if (pincodeLocations) {
      // India: look the pincode up and list its post offices; one is added only
      // when the builder picks it (addServiceLocationBranch).
      let branches
      setLocationLookupBusy(true)
      try {
        branches = lookupBranchList(await lookupPincodeArea(draft.replace(/\s/g, '')))
      } catch {
        branches = []
      } finally {
        setLocationLookupBusy(false)
      }
      setLocationBranches(branches)
      if (!branches.length) {
        setValidationErrors((currentErrors) => ({ ...currentErrors, service_locations: t('subscription.location.pincodeNotFound') }))
      }
      return
    }
    appendServiceLocation(draft)
  }

  const addServiceLocationBranch = (branch) => {
    if (serviceLocationsFull()) return
    const nextLocation = branchLocationEntry(branch)
    if (!nextLocation) {
      setValidationErrors((currentErrors) => ({ ...currentErrors, service_locations: t('subscription.location.pincodeNotFound') }))
      return
    }
    setLocationBranches([])
    if (serviceLocationInputs.some((location) => location.trim() === nextLocation)) {
      setContractorLocationDraft('')
      return
    }
    appendServiceLocation(nextLocation)
  }

  const appendServiceLocation = (nextLocation) => {
    setServiceLocationInputs((currentLocations) => {
      const emptyIndex = currentLocations.findIndex((location) => !location.trim())
      if (emptyIndex === -1) return [...currentLocations, nextLocation]
      return currentLocations.map((location, index) => (index === emptyIndex ? nextLocation : location))
    })
    setContractorLocationDraft('')
    clearValidationError('service_locations')
  }

  const removeGalleryImage = (indexToRemove) => {
    setGalleryItems((currentItems) => currentItems.filter((_, index) => index !== indexToRemove))
  }

  const removeContractorServiceLocation = (index) => {
    setServiceLocationInputs((currentLocations) => currentLocations.map((location, locationIndex) => (
      locationIndex === index ? '' : location
    )))
  }

  const goToContractorStep = (nextStep) => {
    const resolvedStep = Math.min(4, Math.max(1, nextStep))
    setContractorStep(resolvedStep)
    window.setTimeout(() => {
      contractorFormTopRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 0)
  }

  const contractorStepForErrors = (errors) => {
    const fields = Object.keys(errors)
    if (fields.some((field) => ['phone', 'address', 'pincode'].includes(field))) return 1
    if (fields.some((field) => ['company_name', 'license_number', 'experience_years', 'about'].includes(field))) return 2
    if (fields.some((field) => ['service_locations', 'services_offered'].includes(field))) return 3
    return contractorStep
  }

  const validateContractorStep = (step) => {
    const selectedServiceLocations = serviceLocationInputs.map((location) => location.trim()).filter(Boolean)
    const nextValidationErrors = {}
    if (step === 1) {
      if (!isValidPhoneForCountry(normalizePhone(profileDetails.phone), profileCountry)) nextValidationErrors.phone = t('validation.phone')
      if (!String(profileDetails.address || '').trim()) nextValidationErrors.address = t('cp.val.address')
      if (!isValidPostalCodeForCountry(String(profileDetails.pincode || '').replace(/\D/g, ''), profileCountry)) nextValidationErrors.pincode = t('validation.pincode')
    }
    if (step === 2) {
      if (!String(profileDetails.company_name || '').trim()) nextValidationErrors.company_name = t('cp.val.companyName')
      if (!String(profileDetails.license_number || '').trim()) nextValidationErrors.license_number = t('cp.val.licenseNumber')
      // Whole years, at least 1 -- the same rule the backend applies.
      if (!String(profileDetails.experience_years ?? '').trim()) nextValidationErrors.experience_years = t('cp.val.experienceYears')
      else if (!/^\d+$/.test(String(profileDetails.experience_years).trim()) || Number(profileDetails.experience_years) < 1) nextValidationErrors.experience_years = t('cp.val.experienceWhole')
      if (!String(profileDetails.about || '').trim()) nextValidationErrors.about = t('cp.val.aboutCompany')
    }
    if (step === 3) {
      if (selectedServiceLocations.length < 1) nextValidationErrors.service_locations = t('cp.val.serviceLocation')
      if (!selectedServices.length) nextValidationErrors.services_offered = t('cp.val.serviceOffered')
    }
    if (Object.keys(nextValidationErrors).length) {
      setValidationErrors(nextValidationErrors)
      setErrorMessage(t('cp.val.completeFields'))
      return false
    }
    setValidationErrors({})
    setErrorMessage('')
    return true
  }

  const isContractorProfile = user?.role === 'BUILDER'
  const isOwnerProfile = user?.role === 'OWNER'
  const isSupplierProfile = user?.role === 'SUPPLIER'
  const isEngineerProfile = user?.role === 'ENGINEER'
  const isCompactProfile = isContractorProfile || isSupplierProfile || isEngineerProfile
  const usesSetupLayout = isContractorProfile || isOwnerProfile || isSupplierProfile

  const uploadGalleryImages = async (files) => {
    const selectedFiles = Array.from(files || [])
    if (!selectedFiles.length) return
    const pendingItems = selectedFiles.map((file) => ({ key: `${Date.now()}-${Math.random()}`, preview: URL.createObjectURL(file), url: '' }))
    setGalleryItems((currentItems) => [...currentItems, ...pendingItems])
    setUploadMessage(t('cp.msg.uploadingGallery'))
    // Each file on its own: one refused or failed file no longer throws away
    // the others. A file that fails leaves no preview behind.
    const results = await Promise.allSettled(selectedFiles.map(async (file) => {
      assertProfileImage(file, t)
      return uploadLocalFile(file)
    }))
    const failedKeys = new Set()
    const uploadedByKey = {}
    let firstError = null
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') uploadedByKey[pendingItems[index].key] = result.value.url
      else {
        failedKeys.add(pendingItems[index].key)
        firstError = firstError || result.reason
      }
    })
    pendingItems.filter((item) => failedKeys.has(item.key)).forEach((item) => URL.revokeObjectURL(item.preview))
    setGalleryItems((currentItems) => currentItems
      .filter((item) => !failedKeys.has(item.key))
      .map((item) => (uploadedByKey[item.key] ? { ...item, url: uploadedByKey[item.key] } : item)))
    if (failedKeys.size) {
      const reason = firstError?.userMessage || firstError?.response?.data?.detail || t('ui.profile.imageUploadFailed')
      setUploadMessage(t('cps.uploadSomeFailed', { failed: failedKeys.size, total: selectedFiles.length, reason: typeof reason === 'string' ? reason : '' }))
      return
    }
    setUploadMessage(t('cp.msg.galleryUploaded'))
  }

  const uploadDocument = async (documentType, file) => {
    if (!file) return
    setDocumentUploadStatus((currentStatus) => ({ ...currentStatus, [documentType]: 'uploading' }))
    setUploadMessage(t('ui.profile.uploadingDocument', { document: optionLabel(t, DOCUMENT_TYPE_KEYS, documentType) }))
    try {
      const uploadedFile = await uploadLocalFile(file)
      setDocumentUploads((currentUploads) => ({ ...currentUploads, [documentType]: uploadedFile.url }))
      setDocumentUploadStatus((currentStatus) => ({ ...currentStatus, [documentType]: 'uploaded' }))
      setUploadMessage(t('ui.profile.documentUploaded', { document: optionLabel(t, DOCUMENT_TYPE_KEYS, documentType) }))
    } catch (error) {
      setDocumentUploadStatus((currentStatus) => ({ ...currentStatus, [documentType]: 'failed' }))
      throw error
    }
  }

  const uploadProfileImage = async (file) => {
    if (!file) return
    assertProfileImage(file, t)
    const localPreview = URL.createObjectURL(file)
    setProfileImagePreview(localPreview)
    setUploadMessage(t('dash.msg.uploadingProfileImage'))
    const uploadedFile = await uploadLocalFile(file)
    setProfileImagePreview(uploadedFile.previewUrl || localPreview)
    updateProfileField('profile_image_url', uploadedFile.url)
    setUploadMessage(t('cp.msg.profileImageUploaded'))
  }

  const uploadBusinessLogo = async (field, file) => {
    if (!file) return
    assertProfileImage(file, t)
    const localPreview = URL.createObjectURL(file)
    setBusinessLogoPreview(localPreview)
    setUploadMessage(t('cp.msg.uploadingLogo'))
    const uploadedFile = await uploadLocalFile(file)
    setBusinessLogoPreview(uploadedFile.previewUrl || localPreview)
    updateProfileField(field, uploadedFile.url)
    setUploadMessage(t('cp.msg.logoUploaded'))
  }

  const submitProfile = async (event) => {
    event.preventDefault()
    if ((user?.role === 'BUILDER' || user?.role === 'SUPPLIER') && savedProfileState !== 'ready') {
      contractorSubmitIntentRef.current = false
      setErrorMessage(t(savedProfileState === 'failed' ? 'cp.loadSavedFailed' : 'cp.loadingSaved'))
      return
    }
    if (user?.role === 'BUILDER' && (nextContractorStep !== null || !contractorSubmitIntentRef.current)) {
      contractorSubmitIntentRef.current = false
      if (validateContractorStep(contractorStep)) goToContractorStep(nextContractorStep ?? contractorStep)
      return
    }
    contractorSubmitIntentRef.current = false
    // A phone-first account has no e-mail yet, and the completion rule needs
    // one: it is added and verified in the section above the form.
    if (!isOwnerEstimateMode && !user?.email) {
      setErrorMessage(t('emailVerify.needEmail'))
      window.scrollTo({ top: 0, behavior: 'smooth' })
      return
    }
    const selectedServiceLocations = serviceLocationInputs.map((location) => location.trim()).filter(Boolean)
    const nextValidationErrors = {}

    if (isOwnerEstimateMode) {
      if (!String(profileDetails.project_title || '').trim()) nextValidationErrors.project_title = t('cp.val.projectTitle')
      if (!String(profileDetails.building_type || '').trim()) nextValidationErrors.building_type = t('cp.val.buildingType')
      if (!String(profileDetails.construction_type || '').trim()) nextValidationErrors.construction_type = t('cp.val.constructionType')
      if (Number(profileDetails.budget || 0) <= 0) nextValidationErrors.budget = t('cp.val.budget')
      if (Number(profileDetails.land_area || 0) <= 0) nextValidationErrors.land_area = t('cp.val.landArea')
      if (!profileDetails.floor_type) nextValidationErrors.floors = t('cp.val.floors')
      if (Object.keys(nextValidationErrors).length) {
        setValidationErrors(nextValidationErrors)
        setErrorMessage(t('cp.val.completeFields'))
        return
      }
      saveOwnerEstimate(user?.id, {
        ...profileDetails,
        owner_email: user?.email || '',
        address: profileDetails.address || user?.address || '',
        pincode: profileDetails.pincode || user?.pincode || '',
        project_description: profileDetails.project_description || 'New estimate',
      })
      setValidationErrors({})
      setErrorMessage('')
      sessionStorage.setItem('crewnbuild_pending_dashboard_tab', 'estimates')
      window.scrollTo({ top: 0, behavior: 'auto' })
      navigate('/owner', { replace: true })
      return
    }

    if (!isValidPhoneForCountry(normalizePhone(profileDetails.phone), profileCountry)) nextValidationErrors.phone = t('validation.phone')
    if (!String(profileDetails.address || '').trim()) nextValidationErrors.address = t('cp.val.address')
    if (!isValidPostalCodeForCountry(String(profileDetails.pincode || '').replace(/\D/g, ''), profileCountry)) nextValidationErrors.pincode = t('validation.pincode')
    // Owners, engineers and suppliers pick their post office when the pincode has several.
    if (!nextValidationErrors.pincode && !isContractorRole && pincodeBranchMissing) nextValidationErrors.pincode = t('location.prompt.selectBranch')

    // A House Owner's profile is only name, email, phone, address and pincode
    // (checked above); project details belong to the project creation form.

    if (user?.role === 'BUILDER') {
      if (!String(profileDetails.company_name || '').trim()) nextValidationErrors.company_name = t('cp.val.companyName')
      if (!String(profileDetails.license_number || '').trim()) nextValidationErrors.license_number = t('cp.val.licenseNumber')
      // Whole years, at least 1 -- the same rule the backend applies.
      if (!String(profileDetails.experience_years ?? '').trim()) nextValidationErrors.experience_years = t('cp.val.experienceYears')
      else if (!/^\d+$/.test(String(profileDetails.experience_years).trim()) || Number(profileDetails.experience_years) < 1) nextValidationErrors.experience_years = t('cp.val.experienceWhole')
      if (!String(profileDetails.about || '').trim()) nextValidationErrors.about = t('cp.val.aboutCompany')
      if (selectedServiceLocations.length < 1) nextValidationErrors.service_locations = t('cp.val.serviceLocation')
      if (!selectedServices.length) nextValidationErrors.services_offered = t('cp.val.serviceOffered')
    }
    if (user?.role === 'ENGINEER') {
      if (!String(profileDetails.specialization || '').trim()) nextValidationErrors.specialization = t('cp.val.specialization')
      if (isStoreManagerCategory(profileDetails.specialization)) {
        if (!String(profileDetails.qualification || '').trim()) nextValidationErrors.qualification = t('store.val.qualification')
        if (!nextValidationErrors.pincode && !String(profileDetails.location || '').trim()) nextValidationErrors.location = t('location.prompt.selectBranch')
      }
    }
    if (user?.role === 'SUPPLIER') {
      // Worded for the supplier's own category (material / labour / equipment).
      const supplierText = supplierTextKeys(supplierKind(profileDetails.supplier_category))
      if (!String(profileDetails.store_name || '').trim()) nextValidationErrors.store_name = t(supplierText.valName)
      if (!String(profileDetails.about || '').trim()) nextValidationErrors.about = t(supplierText.valAbout)
      if (selectedServiceLocations.length < 1) nextValidationErrors.service_locations = t(supplierText.valLocation)
      if (!selectedSupplierCategories.length) nextValidationErrors.categories = t(supplierText.valSupply)
      // Required by the account's completion rule; without it a supplier could
      // finish this form and still be sent back here on every login.
      if (!String(profileDetails.supplier_category || '').trim()) nextValidationErrors.supplier_category = t('cp.val.supplierCategory')
    }

    if (Object.keys(nextValidationErrors).length) {
      setValidationErrors(nextValidationErrors)
      if (user?.role === 'BUILDER') {
        const errorStep = contractorStepForErrors(nextValidationErrors)
        goToContractorStep(errorStep)
        setErrorMessage(t('cp.val.completeFieldsStep', { step: errorStep }))
      } else {
        setErrorMessage(t('cp.val.completeFields'))
      }
      return
    }
    try {
      setErrorMessage('')
      sessionStorage.removeItem('crewnbuild_pending_dashboard_tab')
      const normalizedPhone = normalizePhone(profileDetails.phone, phoneMaxLengthForCountry(profileCountry))
      const updatedUser = await completeUserProfile({
        ...profileDetails,
        phone: normalizedPhone,
        service_locations: selectedServiceLocations.join(', '),
        services_offered: selectedServices.join(', '),
        equipment_owned: selectedEquipment.join(', '),
        categories: selectedSupplierCategories.join(', ') || profileDetails.categories,
        gallery: galleryImageUrls.join(', '),
        documents: [...Object.entries(documentUploads).map(([documentType, url]) => `${documentType}: ${url}`), ...untypedDocumentsRef.current].join(', '),
        budget: profileDetails.budget === '' ? 0 : Number(profileDetails.budget || 0),
        land_area: profileDetails.land_area === '' ? 0 : Number(profileDetails.land_area || 0),
        // `floors` stays exactly what it was: a number, derived from the
        // chosen configuration so every existing consumer is unaffected.
        // `floor_type` records which configuration produced it.
        floors: floorCountFor(profileDetails.country_of_residence, profileDetails.floor_type, profileDetails.floors === '' ? 1 : profileDetails.floors),
        floor_type: profileDetails.floor_type || null,
        experience_years: profileDetails.experience_years === '' ? 0 : Number(profileDetails.experience_years || 0),
        registration_year: profileDetails.registration_year === '' ? null : Number(profileDetails.registration_year),
      })
      dispatch(setAuthenticatedUser({ user: updatedUser }))
      localStorage.removeItem('crewnbuild_pending_estimate')
      sessionStorage.removeItem('crewnbuild_pending_dashboard_tab')
      window.scrollTo({ top: 0, behavior: 'auto' })
      navigate(returnTo || rolePath(updatedUser.role), { replace: true })
      window.setTimeout(() => window.scrollTo({ top: 0, behavior: 'auto' }), 0)
    } catch (error) {
      const apiErrors = apiFieldErrors(error, t('ui.profile.invalidValue'))
      if (Object.keys(apiErrors).length) {
        setValidationErrors(apiErrors)
        if (user?.role === 'BUILDER') {
          goToContractorStep(contractorStepForErrors(apiErrors))
        }
      }
      setErrorMessage(apiErrorMessage(error, t('cp.err.completeProfile')))
    }
  }

  const form = {
    user, profileDetails, updateProfileField, fieldInputClass, fieldTextareaClass, optionGroupClass,
    FieldError, pincodeLookupState, profileImagePreview, businessLogoPreview,
    uploadProfileImage, uploadBusinessLogo, uploadGalleryImages, uploadDocument,
    uploadMessage, setUploadMessage, selectedServices, toggleListValue,
    setSelectedServices, selectedEquipment, setSelectedEquipment,
    serviceLocationInputs, updateServiceLocation,
    addContractorServiceLocation, removeContractorServiceLocation,
    contractorLocationDraft, setContractorLocationDraft: updateContractorLocationDraft,
    locationBranches, addServiceLocationBranch,
    pincodeLocations, locationLookupBusy, serviceLocationUsage, serviceLocationCap,
    locationPlan: promptPlan(builderSubscription.status), builderSubscriptionStatus: builderSubscription.status,
    galleryImagePreviews, galleryImageUrls, removeGalleryImage, documentUploads, documentUploadStatus,
    selectedSupplierCategories, setSelectedSupplierCategories, savedSupplierCategory, clearValidationError,
    savedProfileState, missingContractorFields, contractorStepSequence,
    selectedPincodeBranch, selectPincodeBranch, pincodeLocationKept,
  }

  return (
    <main className="relative grid min-h-screen grid-rows-[64px_minmax(0,1fr)] overflow-x-hidden bg-slate-50 text-graphite">
      <div className="absolute inset-0 bg-[linear-gradient(180deg,#fffdf7_0%,#fff7e6_42%,#f8fafc_100%)]" />

      <header className="relative z-10 flex items-center justify-between border-b border-slate-200 bg-white px-5 lg:px-10">
        <Logo />
        <a href="/" className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-200 bg-white px-4 text-sm font-semibold transition hover:border-brand-300 hover:bg-brand-50">
          <ArrowLeft className="h-4 w-4" /> {t('shared.backHome')}
        </a>
      </header>

      <section className={`relative z-10 mx-auto w-full px-5 lg:px-8 ${usesSetupLayout ? 'max-w-[1580px] py-3' : isCompactProfile ? 'max-w-[1580px] py-3' : 'max-w-[1480px] py-4'}`}>
        {!usesSetupLayout && (
        <div className={`relative mb-3 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-[0_14px_50px_-42px_rgba(15,23,42,0.35)] ${isCompactProfile ? 'min-h-[126px]' : ''}`}>
          <div className="absolute inset-y-0 right-0 hidden w-1/2 bg-[url('/login-background.png')] bg-cover bg-[center_38%] opacity-35 lg:block" />
          <div className="absolute inset-y-0 right-0 hidden w-1/2 bg-gradient-to-r from-white via-white/70 to-white/20 lg:block" />
          <div className={`relative p-4 ${isCompactProfile ? 'lg:p-4' : 'lg:p-5'}`}>
            <div className="flex items-start gap-4">
              <span className="mt-1 hidden h-16 w-1 rounded-full bg-brand-500 sm:block" />
              <div>
            <p className="mb-2 inline-flex rounded-full bg-brand-50 px-3 py-1 text-[10px] font-bold uppercase tracking-wide text-brand-800 ring-1 ring-brand-200">
              {t('ui.profile.roleSetup', { role: SETUP_ROLE_KEYS[user?.role] ? t(SETUP_ROLE_KEYS[user?.role]) : (user?.role?.toLowerCase() || t('ui.profile')) })}
            </p>
            <h1 className={`font-display text-3xl font-extrabold leading-tight text-slate-950 ${isCompactProfile ? 'lg:text-[34px]' : 'lg:text-4xl'}`}>
              {isOwnerEstimateMode ? t('cp.hero.createEstimate') : t('cp.hero.completeProfile')}
            </h1>
            <p className={`max-w-3xl text-sm font-medium leading-relaxed text-slate-600 ${isCompactProfile ? 'mt-1' : 'mt-2'}`}>
              {isOwnerEstimateMode ? t('ps.owner.subtitleEstimate') : t('ps.sup.setupSubtitle')}
            </p>
              </div>
            </div>
          </div>
          {!isOwnerEstimateMode && pendingEstimate && (
            <div className="mx-5 mb-5 rounded-lg border border-slate-200 bg-slate-50 p-3 lg:w-80">
              <p className="text-xs font-bold uppercase tracking-wider text-brand-700">{t('cp.savedEstimate')}</p>
              <p className="mt-2 text-sm text-slate-600">
                {pendingEstimate.landArea || 0} {t('dash.owner.profile.sqFt')}, {pendingEstimate.floors}, {pendingEstimate.budget}, {pendingEstimate.constructionType}
              </p>
            </div>
          )}
        </div>
        )}

        <div className={usesSetupLayout ? 'overflow-visible bg-transparent' : `overflow-hidden rounded-lg border border-slate-200 bg-white/95 shadow-[0_16px_60px_-45px_rgba(15,23,42,0.35)] ${isCompactProfile ? 'p-3 lg:p-3' : 'p-4 lg:p-5'}`}>
          <div className="mb-4 hidden flex-col gap-3 border-b border-slate-100 pb-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="font-display text-2xl font-semibold leading-tight text-slate-950">
                {isOwnerEstimateMode ? t('cp.estimateDetails') : t('cp.profileDetails')}
              </h2>
              <p className="mt-1 text-sm text-slate-500">{isOwnerEstimateMode ? t('cp.estimateHint') : t('cp.profileHint')}</p>
            </div>
            <span className="grid h-10 w-10 place-items-center rounded-lg bg-brand-50 text-brand-700 ring-1 ring-brand-200">
              <Home className="h-5 w-5 fill-current" />
            </span>
          </div>

          {!isOwnerEstimateMode && !user?.phone && (
            // Where the WhatsApp check is on, a number is added only once verified;
            // elsewhere this renders nothing and the form's own field is used.
            <PhoneChangeSection className={usesSetupLayout ? 'mx-auto mb-6 max-w-6xl' : 'mb-4'} />
          )}
          {!isOwnerEstimateMode && !user?.email && (
            <EmailVerificationSection className={usesSetupLayout ? 'mx-auto mb-6 max-w-6xl' : 'mb-4'} />
          )}

          <form onSubmit={submitProfile} className={usesSetupLayout ? 'space-y-9' : isCompactProfile ? 'space-y-2.5' : 'space-y-3'}>
            {user?.role === 'BUILDER' ? (
              <ContractorProfileSteps
                form={form}
                contractorStep={contractorStep}
                contractorSteps={contractorSteps}
                goToContractorStep={goToContractorStep}
                formTopRef={contractorFormTopRef}
              />
            ) : user?.role === 'SUPPLIER' ? (
              <SupplierProfileSteps form={form} formTopRef={contractorFormTopRef} />
            ) : user?.role === 'ENGINEER' ? (
              <EngineerProfileSteps form={form} formTopRef={contractorFormTopRef} />
            ) : (
              <OwnerProfileSteps form={form} ownerStep={ownerStep} isOwnerEstimateMode={isOwnerEstimateMode} formTopRef={contractorFormTopRef} />
            )}

            {usesSetupLayout ? (
              <div className="mx-auto flex max-w-6xl flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_18px_50px_-42px_rgba(15,23,42,0.35)] sm:flex-row sm:items-center sm:justify-between">
                {user?.role === 'BUILDER' ? (
                  <button
                    type="button"
                    disabled={previousContractorStep === null}
                    onClick={() => goToContractorStep(previousContractorStep ?? contractorStep)}
                    className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-5 text-sm font-extrabold text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-400"
                  >
                    <ArrowLeft className="h-4 w-4" /> {t('cp.previousStep')}
                  </button>
                ) : (
                  <span className="hidden sm:block" />
                )}
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                  <span className="inline-flex h-9 items-center justify-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-4 text-xs font-extrabold text-slate-700">
                    <Lock className="h-3.5 w-3.5 text-brand-700" /> {t('ui.profile.oauthVerifiedAccount')}
                  </span>
                  {user?.role === 'BUILDER' && nextContractorStep !== null ? (
                    <button
                      type="button"
                      onClick={() => {
                        if (validateContractorStep(contractorStep)) goToContractorStep(nextContractorStep)
                      }}
                      className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-brand-500 px-6 text-sm font-extrabold text-brand-950 shadow-[0_14px_30px_-20px_rgba(35,102,69,0.6)] transition hover:bg-brand-400"
                    >
                      {t('ui.profile.nextStep')} <ArrowRight className="h-4 w-4" />
                    </button>
                  ) : (
                    <button
                      type="submit"
                      onClick={() => {
                        contractorSubmitIntentRef.current = user?.role === 'BUILDER' && nextContractorStep === null
                      }}
                      className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-brand-500 px-6 text-sm font-extrabold text-brand-950 shadow-[0_14px_30px_-20px_rgba(35,102,69,0.6)] transition hover:bg-brand-400"
                    >
                      {isOwnerEstimateMode ? t('cp.saveEstimate') : user?.role === 'BUILDER' ? t('cp.submitProfile') : t('cp.completeProfileBtn')} <ArrowRight className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <button type="submit" className="inline-flex h-11 w-full items-center justify-center gap-3 rounded-md bg-brand-500 text-base font-extrabold text-brand-950 shadow-[0_18px_40px_-24px_rgba(35,102,69,0.6)] transition hover:-translate-y-0.5 hover:bg-brand-400">
                {isOwnerEstimateMode ? t('cp.saveEstimate') : t('cp.completeProfileBtn')} <ArrowRight className="h-4 w-4" />
              </button>
            )}
            {errorMessage && <p className="text-xs font-semibold text-red-600">{errorMessage}</p>}
          </form>

          {!usesSetupLayout && <div className="mt-3 flex items-center justify-center gap-3 rounded-md border border-slate-200 bg-white/80 px-4 py-2 text-sm font-medium text-slate-600">
            <Lock className="h-4 w-4 shrink-0 text-brand-600" />
            {t('cp.oauthNote')}
          </div>}
        </div>
      </section>
    </main>
  )
}
