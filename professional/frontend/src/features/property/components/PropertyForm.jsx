/**
 * Create or edit a property listing.
 *
 * One component for both, because the fields are identical and two copies would
 * drift. Every input maps to a field the backend schema already accepts — there
 * is no field here the API would ignore, and none it needs that is missing.
 *
 * `seller_id` is never on this form. The server takes the seller from the
 * authenticated token, so there is nothing here to enter, forge or hardcode.
 *
 * Photos go through the application's existing `uploadLocalFile` (POST
 * /files/upload). This form stores the URLs it returns; it never uploads twice
 * and never introduces a second upload path.
 */
import { useCallback, useRef, useState } from 'react'
import { Home, Loader2, Plus, Send, X } from 'lucide-react'
import PincodeAreaHint from '../../../shared/ui/PincodeAreaHint.jsx'
import BudgetInWords from '../../../shared/ui/BudgetInWords.jsx'
import { SmartImage } from '../../../shared/ui/ui.jsx'
import { usePincodeAreaLookup } from '../../../shared/hooks/usePincodeAreaLookup.js'
import { followAutoAddress, lookupBranchList, onlyBranchOf, sharedBranchValue } from '../../../shared/utils/pincodeBranches.js'
import { imageUrl } from '../../../shared/api/apiClient.js'
import { uploadLocalFile } from '../../../shared/api/uploadApi.js'
import { useLanguage } from '../../../i18n/LanguageContext.jsx'
import { floorCountFor, floorOptionsForCountry, floorTypeLabel } from '../../../shared/utils/floorOptions.js'
import { facingLabel } from './PropertyCard.jsx'

// Stored codes, shown with readable labels. Free text on the backend, so adding
// one here needs no migration — matching how building_type already works.
const PROPERTY_TYPES = ['HOUSE', 'INDEPENDENT_HOUSE', 'VILLA', 'APARTMENT', 'PLOT', 'COMMERCIAL']
const LISTING_TYPES = ['SALE', 'RENT']
const FURNISHING_TYPES = ['UNFURNISHED', 'SEMI_FURNISHED', 'FULLY_FURNISHED']
const FACING_TYPES = ['EAST', 'WEST', 'NORTH', 'SOUTH', 'NORTH_EAST', 'NORTH_WEST', 'SOUTH_EAST', 'SOUTH_WEST']

const FIELD_CLASS = 'h-10 rounded-xl border border-oc-line bg-white px-3 text-sm text-oc-ink outline-none transition placeholder:text-oc-faint focus:border-ocbrand-400 focus:ring-2 focus:ring-ocbrand-100'

function blankListing(defaultCountry) {
  return {
    title: '',
    description: '',
    property_type: 'HOUSE',
    listing_type: 'SALE',
    address: '',
    pincode: '',
    country: defaultCountry || 'India',
    state: '',
    city: '',
    price: '',
    is_negotiable: false,
    carpet_area: '',
    built_up_area: '',
    land_area: '',
    bedrooms: '',
    bathrooms: '',
    floors: 1,
    floor_type: '',
    furnishing: '',
    age_years: '',
    facing: '',
    source_project_id: '',
  }
}

/** An existing listing, mapped into the shape this form edits. */
function listingToForm(listing) {
  const asText = (value) => (value === null || value === undefined ? '' : String(value))
  return {
    title: listing.title || '',
    description: listing.description || '',
    property_type: listing.property_type || 'HOUSE',
    listing_type: listing.listing_type || 'SALE',
    address: listing.address || '',
    pincode: listing.pincode || '',
    country: listing.country || 'India',
    state: listing.state || '',
    city: listing.city || '',
    price: asText(listing.price),
    is_negotiable: Boolean(listing.is_negotiable),
    carpet_area: asText(listing.carpet_area),
    built_up_area: asText(listing.built_up_area),
    land_area: asText(listing.land_area),
    bedrooms: asText(listing.bedrooms),
    bathrooms: asText(listing.bathrooms),
    floors: asText(listing.floors) || 1,
    floor_type: listing.floor_type || '',
    furnishing: listing.furnishing || '',
    age_years: asText(listing.age_years),
    facing: listing.facing || '',
    source_project_id: asText(listing.source_project_id),
  }
}

const numberOrZero = (value) => (value === '' || value === null || value === undefined ? 0 : Number(value))

export default function PropertyForm({
  listing = null,
  projects = [],
  defaultCountry = 'India',
  onSaved,
  onCancel,
}) {
  const { t, td } = useLanguage()
  const editing = Boolean(listing?.id)

  const [details, setDetails] = useState(() => (editing ? listingToForm(listing) : blankListing(defaultCountry)))
  const [coverImageUrl, setCoverImageUrl] = useState(listing?.cover_image_url || '')
  const [videoUrl, setVideoUrl] = useState(listing?.video_url || '')
  const [galleryUrls, setGalleryUrls] = useState(() => (listing?.images || []).map((image) => image.image_url))
  const [uploading, setUploading] = useState(false)
  // '' when idle, else which button is saving: 'save' or 'publish'.
  const [saving, setSaving] = useState('')
  // A new listing, or one still in draft, can be published straight from here.
  const canPublish = !editing || listing?.status === 'DRAFT'
  const [message, setMessage] = useState('')

  const updateField = (field, value) => {
    setDetails((current) => ({ ...current, [field]: value }))
  }

  // The same pincode -> area lookup the project form uses; it fills city and
  // state from the one field the seller types.
  //
  // City and state are facts about the pincode, so a resolution replaces them
  // rather than only filling them when blank. Keeping the old "only if empty"
  // rule left the first pincode's city and state in place when the seller
  // corrected the pincode, and that stale pair was then saved with the new one.
  // This only runs on a *successful* lookup, which happens only when the
  // pincode itself changes -- so a city the seller edited by hand is not
  // touched until they change the pincode again. Address stays on the
  // fill-if-empty rule because the seller writes the street line themselves.
  //
  // With several post offices nothing is taken from the first one India Post
  // lists: City and State are filled only where every branch agrees, and
  // Address waits for the seller's pick. A single branch is picked for them.
  const applyResolvedArea = useCallback((areaDetails) => {
    const branches = lookupBranchList(areaDetails)
    const onlyBranch = onlyBranchOf(branches)
    const awaitingPick = branches.length > 1
    const resolved = awaitingPick
      ? { display: '', city: sharedBranchValue(branches, 'city') || sharedBranchValue(branches, 'district'), state: sharedBranchValue(branches, 'state') }
      : { display: areaDetails.display || '', city: areaDetails.city || areaDetails.district || '', state: areaDetails.state || '' }
    // A new pincode means its post offices are new too: the earlier pick goes.
    setSelectedBranch(onlyBranch)
    // Read before the update and recorded after it: React may run the updater
    // twice, so the updater itself must not touch the ref.
    const lastAutoAddress = autoAddressRef.current
    setDetails((current) => {
      return {
        ...current,
        // An address the previous pincode filled in is replaced too; one the
        // seller typed is kept.
        address: followAutoAddress(current.address, resolved.display, lastAutoAddress),
        // Branches that disagree on the city: a saved city that is one of
        // theirs stays, anything else waits for the pick.
        city: awaitingPick
          ? resolved.city || (branches.some((branch) => current.city && (branch.city === current.city || branch.district === current.city)) ? current.city : '')
          : (resolved.city || current.city || ''),
        state: resolved.state || current.state || '',
      }
    })
    autoAddressRef.current = resolved.display
  }, [])
  const pincodeLookupState = usePincodeAreaLookup(details.pincode, applyResolvedArea, details.country)

  // The post offices India Post lists under this pincode, as the project form
  // offers them. Picking one fills City and State from it, and Address too
  // unless the seller has written their own -- the same rule the project form
  // follows. Nothing new is stored: the listing keeps its existing fields.
  const [selectedBranch, setSelectedBranch] = useState(null)
  const autoAddressRef = useRef('')
  const postOffices = pincodeLookupState.status === 'success' ? pincodeLookupState.branches || [] : []
  const selectBranch = (name) => {
    const branch = postOffices.find((item) => item.name === name) || null
    setSelectedBranch(branch)
    if (!branch) return
    const lastAutoAddress = autoAddressRef.current
    setDetails((current) => ({
      ...current,
      city: branch.city || branch.district || current.city,
      state: branch.state || current.state,
      address: followAutoAddress(current.address, branch.display || current.address, lastAutoAddress),
    }))
    autoAddressRef.current = branch.display || ''
  }

  const uploadCover = async (file) => {
    if (!file) return
    setUploading(true)
    setMessage(t('property.form.uploading'))
    try {
      const uploaded = await uploadLocalFile(file)
      setCoverImageUrl(uploaded.url)
      setMessage(t('property.form.uploaded'))
    } catch {
      setMessage(t('property.form.uploadFailed'))
    } finally {
      setUploading(false)
    }
  }

  // Same upload call the images use. The backend routes a video content type
  // to the video category it already has, so no new upload path is introduced.
  const uploadVideo = async (file) => {
    if (!file) return
    setUploading(true)
    setMessage(t('property.form.uploading'))
    try {
      const uploaded = await uploadLocalFile(file)
      setVideoUrl(uploaded.url)
      setMessage(t('property.form.uploaded'))
    } catch {
      setMessage(t('property.form.uploadFailed'))
    } finally {
      setUploading(false)
    }
  }

  const uploadGallery = async (files) => {
    const selected = Array.from(files || [])
    if (!selected.length) return
    setUploading(true)
    setMessage(t('property.form.uploading'))
    try {
      const uploaded = await Promise.all(selected.map(uploadLocalFile))
      setGalleryUrls((current) => [...current, ...uploaded.map((item) => item.url)])
      setMessage(t('property.form.uploaded'))
    } catch {
      setMessage(t('property.form.uploadFailed'))
    } finally {
      setUploading(false)
    }
  }

  const removeGalleryImage = (url) => {
    setGalleryUrls((current) => current.filter((item) => item !== url))
  }

  const submit = async (event) => {
    event.preventDefault()
    // Which of the two submit buttons was pressed. Going through the form's
    // own submit keeps the browser's required-field checks for both.
    const publish = event.nativeEvent?.submitter?.value === 'publish'
    setMessage('')
    setSaving(publish ? 'publish' : 'save')
    // Exactly the fields the backend schema declares. Nothing extra is sent.
    const payload = {
      title: details.title.trim(),
      description: details.description.trim(),
      property_type: details.property_type,
      listing_type: details.listing_type,
      address: details.address.trim(),
      pincode: details.pincode.trim(),
      country: details.country || defaultCountry,
      state: details.state || null,
      city: details.city || null,
      price: numberOrZero(details.price),
      is_negotiable: Boolean(details.is_negotiable),
      carpet_area: numberOrZero(details.carpet_area),
      built_up_area: numberOrZero(details.built_up_area),
      // An apartment has no land area of its own; one typed before switching to Apartment is not saved.
      land_area: details.property_type === 'APARTMENT' ? 0 : numberOrZero(details.land_area),
      // A plot has no BHK; one picked before switching the type to Plot is not saved.
      bedrooms: details.property_type === 'PLOT' ? 0 : numberOrZero(details.bedrooms),
      bathrooms: numberOrZero(details.bathrooms),
      // Derived, so the numeric column keeps the value it always held.
      floors: floorCountFor(details.country, details.floor_type, numberOrZero(details.floors) || 1),
      floor_type: details.floor_type || null,
      furnishing: details.furnishing || null,
      age_years: numberOrZero(details.age_years),
      facing: details.facing || null,
      cover_image_url: coverImageUrl || null,
      video_url: videoUrl || null,
      source_project_id: details.source_project_id || null,
    }
    try {
      await onSaved(payload, galleryUrls, { publish })
    } catch (error) {
      const detail = error.response?.data?.detail
      // A validation refusal arrives as a list; either way the wording is the
      // server's own English, so it is translated before it is shown.
      setMessage(Array.isArray(detail) ? td(detail[0]?.msg) || t('property.form.saveFailed') : td(detail) || t('property.form.saveFailed'))
    } finally {
      setSaving('')
    }
  }

  return (
    <section className="rounded-2xl border border-oc-line bg-white p-4 shadow-[0_10px_30px_-24px_rgba(15,23,42,0.35)] sm:p-5">
      <div className="mb-4 flex items-center justify-between gap-3 border-b border-oc-line pb-3">
        <h3 className="flex items-center gap-2 font-display text-base font-bold text-oc-ink">
          <Home className="h-[18px] w-[18px] text-oc-green" />
          {editing ? t('property.form.editTitle') : t('property.form.addTitle')}
        </h3>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg px-3 py-1.5 text-xs font-bold text-oc-muted transition hover:bg-oc-sunken hover:text-oc-ink"
          >
            {t('dash.common.cancel')}
          </button>
        )}
      </div>

      <form onSubmit={submit} className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {message && (
          <div className="rounded-xl border border-ocbrand-200 bg-oc-mint px-4 py-2.5 text-[13px] font-semibold text-oc-deep md:col-span-2">
            {message}
          </div>
        )}

        <input
          required
          value={details.title}
          onChange={(event) => updateField('title', event.target.value)}
          placeholder={t('property.form.titlePh')}
          className={`${FIELD_CLASS} md:col-span-2`}
        />

        <select value={details.property_type} onChange={(event) => updateField('property_type', event.target.value)} className={FIELD_CLASS}>
          {PROPERTY_TYPES.map((type) => (
            <option key={type} value={type}>{t(`property.type.${type}`)}</option>
          ))}
        </select>
        <select value={details.listing_type} onChange={(event) => updateField('listing_type', event.target.value)} className={FIELD_CLASS}>
          {LISTING_TYPES.map((type) => (
            <option key={type} value={type}>{t(`property.listing.${type}`)}</option>
          ))}
        </select>

        <label className="block">
          <input
            required
            value={details.pincode}
            onChange={(event) => updateField('pincode', event.target.value)}
            placeholder={t('dash.common.pincode')}
            className={`w-full ${FIELD_CLASS}`}
          />
          <PincodeAreaHint lookupState={pincodeLookupState} />
        </label>
        {/* Post office (India): listed once the pincode resolves to its branches. */}
        {String(details.country || 'India').toLowerCase() === 'india' && (
        <select
          value={selectedBranch?.name || ''}
          onChange={(event) => selectBranch(event.target.value)}
          disabled={!postOffices.length}
          aria-label={t('location.branch')}
          className={`${FIELD_CLASS} self-start disabled:cursor-not-allowed disabled:bg-oc-sunken disabled:opacity-60`}
        >
          <option value="">{t('location.selectBranch')}</option>
          {postOffices.map((branch) => (
            <option key={`${branch.pincode}-${branch.name}`} value={branch.name}>{td(branch.name)}</option>
          ))}
        </select>
        )}
        <input value={details.city} onChange={(event) => updateField('city', event.target.value)} placeholder={t('property.form.cityPh')} className={FIELD_CLASS} />
        <input value={details.state} onChange={(event) => updateField('state', event.target.value)} placeholder={t('property.form.statePh')} className={FIELD_CLASS} />
        <input required value={details.address} onChange={(event) => updateField('address', event.target.value)} placeholder={t('property.form.addressPh')} className={FIELD_CLASS} />

        <textarea
          required
          value={details.description}
          onChange={(event) => updateField('description', event.target.value)}
          placeholder={t('property.form.descriptionPh')}
          className={`${FIELD_CLASS} !h-auto min-h-24 py-2 md:col-span-2`}
        />

        <div>
          <input type="number" min="0" value={details.price} onChange={(event) => updateField('price', event.target.value)} placeholder={t('property.form.pricePh')} className={`w-full ${FIELD_CLASS}`} />
          <BudgetInWords value={details.price} country={details.country} />
        </div>
        <label className="flex h-10 items-center gap-2 rounded-xl border border-oc-line px-3 text-sm font-medium text-oc-ink">
          <input
            type="checkbox"
            checked={details.is_negotiable}
            onChange={(event) => updateField('is_negotiable', event.target.checked)}
            className="h-4 w-4 rounded border-oc-line accent-oc-green"
          />
          {t('property.negotiable')}
        </label>

        {/* BHK, in the same words as the Buy tab's "Any BHK" filter. It is the
            listing's `bedrooms`, so that filter finds what the seller picks here.
            A count saved earlier outside 1–5 stays selectable. Hidden for a plot. */}
        {details.property_type !== 'PLOT' && (
        <select value={Number(details.bedrooms) > 0 ? String(Number(details.bedrooms)) : ''} onChange={(event) => updateField('bedrooms', event.target.value)} aria-label="BHK" className={FIELD_CLASS}>
          <option value="">{t('cps.selectField', { label: 'BHK' })}</option>
          {[...new Set([1, 2, 3, 4, 5, Number(details.bedrooms) || 0])].filter((count) => count > 0).sort((a, b) => a - b).map((count) => (
            <option key={count} value={String(count)}>{t('ui.owner.bhk', { count })}</option>
          ))}
        </select>
        )}
        <input type="number" min="0" value={details.bathrooms} onChange={(event) => updateField('bathrooms', event.target.value)} placeholder={t('property.form.bathroomsPh')} className={FIELD_CLASS} />
        <input type="number" min="0" value={details.built_up_area} onChange={(event) => updateField('built_up_area', event.target.value)} placeholder={t('property.form.builtUpPh')} className={FIELD_CLASS} />
        <input type="number" min="0" value={details.carpet_area} onChange={(event) => updateField('carpet_area', event.target.value)} placeholder={t('property.form.carpetPh')} className={FIELD_CLASS} />
        {/* Hidden for an apartment, which has no land area of its own. */}
        {details.property_type !== 'APARTMENT' && (
          <input type="number" min="0" value={details.land_area} onChange={(event) => updateField('land_area', event.target.value)} placeholder={t('property.form.landPh')} className={FIELD_CLASS} />
        )}
        <select value={details.floor_type || ''} onChange={(event) => updateField('floor_type', event.target.value)} className={FIELD_CLASS}>
          <option value="">{t('cps.selectField', { label: t('dash.common.floors') })}</option>
          {floorOptionsForCountry(details.country).map((option) => (
            <option key={option.value} value={option.value}>{floorTypeLabel(option.value)}</option>
          ))}
        </select>
        <input type="number" min="0" value={details.age_years} onChange={(event) => updateField('age_years', event.target.value)} placeholder={t('property.form.agePh')} className={FIELD_CLASS} />

        <select value={details.furnishing} onChange={(event) => updateField('furnishing', event.target.value)} className={FIELD_CLASS}>
          <option value="">{t('property.form.selectFurnishing')}</option>
          {FURNISHING_TYPES.map((type) => (
            <option key={type} value={type}>{t(`property.furnishing.${type}`)}</option>
          ))}
        </select>
        <select value={details.facing} onChange={(event) => updateField('facing', event.target.value)} className={FIELD_CLASS}>
          <option value="">{t('property.form.selectFacing')}</option>
          {FACING_TYPES.map((type) => (
            <option key={type} value={type}>{facingLabel(t, type, td)}</option>
          ))}
        </select>

        {/* Optional link to a project the seller already has here. The list is
            whatever the dashboard passed in; the server re-checks ownership. */}
        {projects.length > 0 && (
          <select
            value={details.source_project_id}
            onChange={(event) => updateField('source_project_id', event.target.value)}
            className={`${FIELD_CLASS} md:col-span-2`}
          >
            <option value="">{t('property.form.noSourceProject')}</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>{td(project.title)}</option>
            ))}
          </select>
        )}

        <label className="flex min-h-20 cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-ocbrand-200 bg-ocbrand-50/40 px-3 py-3 text-center text-[13px] font-semibold text-oc-deep transition hover:border-ocbrand-400 hover:bg-ocbrand-50">
          <input type="file" accept="image/*" onChange={(event) => uploadCover(event.target.files?.[0])} className="sr-only" />
          {coverImageUrl ? t('property.form.coverSet') : t('property.form.uploadCover')}
          <span className="mt-1 text-[11px] font-medium text-oc-faint">{t('property.form.coverNote')}</span>
        </label>
        <label className="flex min-h-20 cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-ocbrand-200 bg-ocbrand-50/40 px-3 py-3 text-center text-[13px] font-semibold text-oc-deep transition hover:border-ocbrand-400 hover:bg-ocbrand-50">
          <input type="file" accept="image/*" multiple onChange={(event) => uploadGallery(event.target.files)} className="sr-only" />
          {t('property.form.uploadGallery')}
          <span className="mt-1 text-[11px] font-medium text-oc-faint">{t('property.form.galleryNote')}</span>
        </label>
        {/* One optional walkthrough video, in the same tile style as the two
            image controls above so nothing about this form is redesigned. */}
        <label className="flex min-h-20 cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-ocbrand-200 bg-ocbrand-50/40 px-3 py-3 text-center text-[13px] font-semibold text-oc-deep transition hover:border-ocbrand-400 hover:bg-ocbrand-50">
          <input type="file" accept="video/mp4,video/quicktime,video/webm" onChange={(event) => uploadVideo(event.target.files?.[0])} className="sr-only" />
          {videoUrl ? t('property.form.videoSet') : t('property.form.uploadVideo')}
          <span className="mt-1 text-[11px] font-medium text-oc-faint">{t('property.form.videoNote')}</span>
        </label>

        {(coverImageUrl || galleryUrls.length > 0) && (
          <div className="flex flex-wrap gap-2 md:col-span-2">
            {coverImageUrl && (
              <div className="relative">
                <SmartImage src={imageUrl(coverImageUrl)} alt="" className="h-16 w-24 rounded-lg border-2 border-oc-green object-cover" />
                <span className="absolute bottom-0 left-0 rounded-br-lg rounded-tr-lg bg-oc-green px-1.5 py-0.5 text-[9px] font-extrabold text-white">
                  {t('property.form.cover')}
                </span>
                <button
                  type="button"
                  onClick={() => setCoverImageUrl('')}
                  aria-label={t('shop.remove')}
                  className="absolute -right-1.5 -top-1.5 grid h-5 w-5 place-items-center rounded-full bg-white text-oc-muted shadow ring-1 ring-oc-line transition hover:text-warm"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            )}
            {galleryUrls.map((url) => (
              <div key={url} className="relative">
                <SmartImage src={imageUrl(url)} alt="" className="h-16 w-24 rounded-lg border border-oc-line object-cover" />
                <button
                  type="button"
                  onClick={() => removeGalleryImage(url)}
                  aria-label={t('shop.remove')}
                  className="absolute -right-1.5 -top-1.5 grid h-5 w-5 place-items-center rounded-full bg-white text-oc-muted shadow ring-1 ring-oc-line transition hover:text-warm"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className={`grid gap-2 md:col-span-2 ${canPublish ? 'sm:grid-cols-2' : ''}`}>
          <button
            value="save"
            disabled={Boolean(saving) || uploading}
            className={`inline-flex h-10 items-center justify-center gap-2 rounded-xl px-4 text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-60 ${
              canPublish
                ? 'border border-oc-line bg-white text-oc-ink hover:bg-oc-sunken'
                : 'bg-oc-green text-white shadow-[0_11px_25px_rgba(18,107,69,.18)] hover:-translate-y-0.5 hover:bg-oc-deep'
            }`}
          >
            {saving === 'save' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            {saving === 'save'
              ? t('property.form.saving')
              : editing
                ? t('property.form.saveChanges')
                : t('property.form.saveDraft')}
          </button>
          {/* Saves, then publishes through the same status endpoint the
              Publish button uses. Offered only while the listing is a draft;
              a live listing is already published. */}
          {canPublish && (
            <button
              value="publish"
              disabled={Boolean(saving) || uploading}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-oc-green px-4 text-sm font-bold text-white shadow-[0_11px_25px_rgba(18,107,69,.18)] transition hover:-translate-y-0.5 hover:bg-oc-deep disabled:cursor-not-allowed disabled:opacity-60"
            >
              {saving === 'publish' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              {saving === 'publish' ? t('property.form.saving') : t('property.form.saveAndPublish')}
            </button>
          )}
        </div>
      </form>
    </section>
  )
}
