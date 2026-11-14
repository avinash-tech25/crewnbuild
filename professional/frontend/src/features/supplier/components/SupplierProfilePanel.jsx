import { useCallback, useEffect, useRef, useState } from 'react'
import { useSelector } from 'react-redux'
import { Camera, FileText, Package, Pencil, Save, Settings, UserRound, X } from 'lucide-react'
import { Card, EmptyState } from '../../../shared/dashboard/RoleDashboardUi.jsx'
import { avatarFromPath } from '../../../shared/ui/avatars.js'
import { SmartImage } from '../../../shared/ui/ui.jsx'
import { imageUrl } from '../../../shared/api/apiClient.js'
import { uploadLocalFile } from '../../../shared/api/uploadApi.js'
import { supplierDocumentTypes } from '../supplierConstants.js'
import { splitEditableList } from '../supplierHelpers.js'
import { splitDocumentEntry, typedDocumentEntry } from '../../../shared/utils/documentEntries.js'
import { useLanguage } from '../../../i18n/LanguageContext.jsx'
import { supplierTypeOptions } from '../../onboarding/profileConstants.js'
import { supplierKind, supplierTextKeys } from '../../onboarding/supplierProfileKinds.js'
import { RequiredMark, requiredProfileFields } from '../../accounts/components/ProfileCompletionMeter.jsx'
import { optionLabel, BUSINESS_TYPE_KEYS, DOCUMENT_TYPE_KEYS, SUPPLIER_CATEGORY_KEYS, SUPPLIER_TYPE_KEYS } from '../../../i18n/optionKeys.js'
import FieldError from '../../../shared/ui/FieldError.jsx'
import PincodeAreaHint from '../../../shared/ui/PincodeAreaHint.jsx'
import { usePincodeAreaLookup } from '../../../shared/hooks/usePincodeAreaLookup.js'
import { INVALID_FIELD_CLASS, profileErrorMessage, useProfileFormErrors } from '../../../shared/hooks/useProfileFormErrors.js'
import ProfileImageHint from '../../../shared/ui/ProfileImageHint.jsx'
import { PROFILE_IMAGE_ACCEPT } from '../../../shared/utils/profileImageRules.js'

/**
 * One read-only field: the label, and its value immediately beside it.
 *
 * A fixed label column rather than `justify-between`, which pushed the value to
 * the opposite edge of the card and left a stretch of white space between the
 * two halves of the same fact.
 */
function SectionRow({ label, value, required = false }) {
  return (
    <div className="grid grid-cols-1 gap-x-3 border-b border-slate-100 py-1.5 last:border-0 sm:grid-cols-[minmax(0,140px)_minmax(0,1fr)] sm:items-baseline">
      <span className="text-[11px] font-extrabold uppercase tracking-wide text-graphite/45">{label}{required && <RequiredMark satisfied={value !== null && value !== undefined && value !== ''} />}</span>
      <span className="min-w-0 break-words text-sm font-bold text-graphite">{value || '—'}</span>
    </div>
  )
}

/** The one entry point into editing. Every editable card follows this button. */
function EditButton({ onClick }) {
  const { t } = useLanguage()
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-slate-800 px-3 text-xs font-extrabold text-white transition hover:-translate-y-0.5 hover:bg-slate-900"
    >
      <Pencil className="h-3.5 w-3.5" /> {t('dash.common.edit')}
    </button>
  )
}

const labelClass = 'text-[10px] font-extrabold uppercase tracking-wide text-graphite/50'
const inputClass = 'mt-1.5 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-graphite outline-none placeholder:text-graphite/40 focus:border-brand-400 focus:ring-2 focus:ring-brand-100'
const textareaClass = 'mt-1.5 min-h-[72px] w-full resize-none rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-graphite outline-none placeholder:text-graphite/40 focus:border-brand-400 focus:ring-2 focus:ring-brand-100'

// The order these fields are read on screen, so "the first invalid one" is the
// first the supplier would reach rather than the first the backend happened to
// serialise. `service_locations` is the key the API uses for what this screen
// calls Delivery Locations — the backend writes it to delivery_locations.
const SUPPLIER_FIELD_ORDER = [
  'name', 'phone', 'pincode', 'address',
  'store_name', 'supplier_category', 'business_type', 'gstin', 'pan', 'website',
  'registration_year', 'categories', 'about', 'service_locations',
]

export function SupplierProfilePanel({
  profile,
  errorMessage,
  uploadMessage,
  onProfileImageUpload,
  onStoreLogoUpload,
  onSaveProfile,
}) {
  // The signed-in account. The supplier profile payload carries no country, and
  // the pincode lookup needs the real one.
  const account = useSelector((state) => state.auth.user)
  // Mandatory labels follow the API's profile_completion definition; this file
  // keeps no list of its own.
  const requiredFields = requiredProfileFields(account)
  const { t, td } = useLanguage()
  // The profile reads as plain information until the supplier asks to change
  // it. One flag for the whole section, so every editable card opens together
  // and there is exactly one Save for all of them.
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editDetails, setEditDetails] = useState({})
  // Labels in the supplier's own category's words (store / agency / business,
  // products / trades / equipment, delivery / service locations), the same
  // wording Complete Profile uses. Only labels change; every field is the same.
  const text = supplierTextKeys(supplierKind(profile?.supplier_category || editDetails?.supplier_category))
  const { fieldErrors, formError, setFormError, registerField, clearErrors, clearFieldError, applyError } = useProfileFormErrors()
  // The dashboard rebuilds the `profile` object on every render and refreshes it
  // on a timer, so seeding on the object's identity threw away whatever the
  // supplier had typed — which is why a newly chosen Supplier Category never
  // reached the save. Seeding is keyed on which account the profile belongs to,
  // and is skipped outright while the editor is open or there are unsaved edits.
  const hasUnsavedEdits = useRef(false)
  const profileKey = profile ? String(profile.user_id ?? profile.id ?? '') : ''

  const seedForm = useCallback((source) => {
    if (!source) return
    setEditDetails({
      name: source.name || '',
      phone: source.phone || '',
      address: source.address || '',
      pincode: source.pincode || '',
      store_name: source.store_name || '',
      about: source.about || '',
      gstin: source.gstin || '',
      pan: source.pan || '',
      website: source.website || '',
      business_type: source.business_type || '',
      supplier_category: source.supplier_category || '',
      registration_year: source.registration_year || '',
      categories: (source.categories || []).join(', '),
      service_locations: (source.delivery_locations || []).join(', '),
      documents: (source.documents || []).join(', '),
      gallery: (source.gallery || []).join(', '),
    })
  }, [])

  // `profileRef` keeps the latest profile reachable without making it a
  // dependency, which is what would reintroduce the per-render re-seed.
  const profileRef = useRef(profile)
  profileRef.current = profile
  const editingRef = useRef(editing)
  editingRef.current = editing

  useEffect(() => {
    if (!profileKey || editingRef.current || hasUnsavedEdits.current) return
    seedForm(profileRef.current)
  }, [profileKey, seedForm])

  const updateEditField = (field, value) => {
    hasUnsavedEdits.current = true
    setEditDetails((currentDetails) => ({ ...currentDetails, [field]: value }))
    clearFieldError(field)
  }

  // The pincode resolves the area. It fills Delivery Locations only when that
  // field is still empty, so anything the supplier typed is never overwritten.
  const applyResolvedArea = useCallback((areaDetails) => {
    setEditDetails((currentDetails) => (
      currentDetails.service_locations
        ? currentDetails
        : { ...currentDetails, service_locations: areaDetails.display || currentDetails.service_locations || '' }
    ))
  }, [])
  const pincodeLookupState = usePincodeAreaLookup(
    editing ? editDetails.pincode : '',
    applyResolvedArea,
    account?.country_of_residence,
  )

  const startEditing = () => {
    clearErrors()
    seedForm(profileRef.current)
    hasUnsavedEdits.current = false
    setEditing(true)
  }

  const saveProfile = async () => {
    if (saving) return
    setSaving(true)
    clearErrors()
    try {
      // The whole profile in one request, Supplier Category included, through
      // the existing complete-profile call.
      await onSaveProfile(editDetails)
      hasUnsavedEdits.current = false
      setEditing(false)
    } catch (error) {
      // Nothing is closed, reset or reverted: the supplier keeps everything they
      // entered and is taken to the first field the backend refused.
      applyError(error, t('dash.owner.profile.saveError'), SUPPLIER_FIELD_ORDER)
    } finally {
      setSaving(false)
    }
  }

  const cancelEdits = () => {
    hasUnsavedEdits.current = false
    seedForm(profileRef.current)
    clearErrors()
    setEditing(false)
  }

  // Document and gallery files are uploaded straight away — that is what
  // produces the URL — but the profile itself is only written by the single Save
  // at the bottom, so the list stays part of the one payload.
  // A document keeps the type whose button it was uploaded from, saved as
  // "<Type>: /files/<id>" (see utils/documentEntries.js); gallery images stay bare.
  const uploadSectionFile = async (field, file, documentType = '') => {
    if (!file) return
    try {
      const uploadedFile = await uploadLocalFile(file)
      const entry = field === 'documents' ? typedDocumentEntry(documentType, uploadedFile.url) : uploadedFile.url
      hasUnsavedEdits.current = true
      setEditDetails((currentDetails) => ({
        ...currentDetails,
        [field]: [currentDetails[field], entry].filter(Boolean).join(', '),
      }))
    } catch (error) {
      // Said out loud rather than left as an unhandled rejection: a file that
      // silently failed to upload reads as one that saved.
      setFormError(profileErrorMessage(error, t('cps.uploadFailed')))
    }
  }

  const fieldClass = (field) => (
    fieldErrors[field]
      ? `${inputClass.replace('border-slate-200 ', '').replace('bg-white ', '')} ${INVALID_FIELD_CLASS}`
      : inputClass
  )
  const areaClass = (field) => (
    fieldErrors[field]
      ? `${textareaClass.replace('border-slate-200 ', '').replace('bg-white ', '')} ${INVALID_FIELD_CLASS}`
      : textareaClass
  )

  if (errorMessage) {
    return <Card title={t('dash.common.settings')} icon={Settings}><EmptyState title={t('dash.supplier.profile.notLoaded')} message={errorMessage} /></Card>
  }
  if (!profile) {
    return <Card title={t('dash.common.settings')} icon={Settings}><EmptyState title={t('dash.supplier.profile.loading')} message={t('dash.supplier.profile.loadingSub')} /></Card>
  }

  // While editing, the lists shown are the ones the pending save will write.
  const galleryImages = splitEditableList(editing ? editDetails.gallery : (profile.gallery || []).join(', '))
  const documentList = splitEditableList(editing ? editDetails.documents : (profile.documents || []).join(', '))

  return (
    <div className="space-y-3">
      <Card title={t('dash.common.settings')} icon={Settings}>
        {uploadMessage && <p className="mb-3 text-xs font-semibold text-brand-700">{uploadMessage}</p>}
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
          <SmartImage
            src={avatarFromPath(profile.profile_image_url, 'SUPPLIER')}
            alt={td(profile.store_name)}
            className="h-24 w-24 shrink-0 rounded-2xl object-cover object-top ring-1 ring-slate-200"
          />
          <div className="min-w-0 flex-1">
            <h2 className="font-display text-xl font-extrabold text-graphite">{td(profile.store_name)}</h2>
            <p className="mt-0.5 text-sm font-semibold text-graphite/60">
              {td(profile.name) || t('role.supplier')} · {td(profile.address) || '—'} · {profile.pincode || '—'}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-lg bg-slate-800 px-3 text-xs font-extrabold text-white transition hover:bg-slate-900">
                <Camera className="h-3.5 w-3.5" /> {profile.profile_image_url ? t('dash.common.changeImage') : t('dash.common.addImage')}
                <input type="file" accept={PROFILE_IMAGE_ACCEPT} className="sr-only" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; onProfileImageUpload?.(file) }} />
              </label>
              <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-xs font-extrabold text-graphite/70 transition hover:bg-slate-50">
                <Camera className="h-3.5 w-3.5" /> {t('dash.supplier.profile.storeLogo')}
                <input type="file" accept={PROFILE_IMAGE_ACCEPT} className="sr-only" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; onStoreLogoUpload?.(file) }} />
              </label>
            </div>
            <ProfileImageHint className="mt-1.5" />
          </div>
        </div>
      </Card>

      <Card
        title={t('dash.common.personalInformation')}
        icon={UserRound}
        action={!editing && <EditButton onClick={startEditing} />}
      >
        {editing ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label>
              <span className={labelClass}>{t('dash.common.name')}{requiredFields.has('name') && <RequiredMark />}</span>
              <input ref={registerField('name')} value={editDetails.name || ''} onChange={(event) => updateEditField('name', event.target.value)} className={fieldClass('name')} />
              <FieldError message={fieldErrors.name} />
            </label>
            <label>
              <span className={labelClass}>{t('dash.common.phone')}{requiredFields.has('phone') && <RequiredMark />}</span>
              <input ref={registerField('phone')} value={editDetails.phone || ''} onChange={(event) => updateEditField('phone', event.target.value)} className={fieldClass('phone')} />
              <FieldError message={fieldErrors.phone} />
            </label>
            <label>
              <span className={labelClass}>{t('dash.common.pincode')}{requiredFields.has('pincode') && <RequiredMark />}</span>
              <input ref={registerField('pincode')} value={editDetails.pincode || ''} onChange={(event) => updateEditField('pincode', event.target.value)} className={fieldClass('pincode')} />
              <PincodeAreaHint lookupState={pincodeLookupState} />
              <FieldError message={fieldErrors.pincode} />
            </label>
            <label>
              <span className={labelClass}>{t('dash.common.email')}{requiredFields.has('email') && <RequiredMark />}</span>
              <input value={profile.email || ''} disabled className={`${inputClass} bg-slate-50 text-graphite/50`} />
            </label>
            <label className="sm:col-span-2">
              <span className={labelClass}>{t('dash.common.address')}{requiredFields.has('address') && <RequiredMark />}</span>
              <input ref={registerField('address')} value={editDetails.address || ''} onChange={(event) => updateEditField('address', event.target.value)} className={fieldClass('address')} />
              <FieldError message={fieldErrors.address} />
            </label>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-x-8 gap-y-0 md:grid-cols-2">
            <SectionRow required={requiredFields.has('name')} label={t('dash.common.name')} value={td(profile.name)} />
            {/* Phone and email are identifiers, not words: they are shown
                exactly as stored. */}
            <SectionRow required={requiredFields.has('phone')} label={t('dash.common.phone')} value={profile.phone} />
            <SectionRow required={requiredFields.has('email')} label={t('dash.common.email')} value={profile.email} />
            <SectionRow required={requiredFields.has('pincode')} label={t('dash.common.pincode')} value={profile.pincode} />
            <SectionRow required={requiredFields.has('address')} label={t('dash.common.address')} value={td(profile.address)} />
          </div>
        )}
      </Card>

      <Card
        title={t('dash.supplier.profile.businessInformation')}
        icon={Package}
        action={!editing && <EditButton onClick={startEditing} />}
      >
        {editing ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label>
              <span className={labelClass}>{t(text.name)}{requiredFields.has('store_name') && <RequiredMark />}</span>
              <input ref={registerField('store_name')} value={editDetails.store_name || ''} onChange={(event) => updateEditField('store_name', event.target.value)} className={fieldClass('store_name')} />
              <FieldError message={fieldErrors.store_name} />
            </label>
            <label>
              <span className={labelClass}>{t('dash.supplier.profile.supplierCategory')}{requiredFields.has('supplier_category') && <RequiredMark />}</span>
              {/* Chosen once. Once the supplier has saved a category the field
                  is shown read-only instead of as a dropdown, the same way the
                  email field above is. `editDetails.supplier_category` still
                  carries the saved value, so the single Save resends it
                  unchanged and the backend treats it as a no-op. The backend is
                  what actually enforces this; the read-only field here just
                  stops the dashboard offering a change it would refuse. */}
              {profile.supplier_category ? (
                <input value={optionLabel(t, SUPPLIER_TYPE_KEYS, profile.supplier_category)} disabled className={`${inputClass} bg-slate-50 text-graphite/50`} />
              ) : (
                <select ref={registerField('supplier_category')} value={editDetails.supplier_category || ''} onChange={(event) => updateEditField('supplier_category', event.target.value)} className={fieldClass('supplier_category')}>
                  <option value="" disabled>{t('ps.selectSupplierCategory')}</option>
                  {supplierTypeOptions.map((supplierType) => (
                    <option key={supplierType} value={supplierType}>{optionLabel(t, SUPPLIER_TYPE_KEYS, supplierType)}</option>
                  ))}
                </select>
              )}
              <FieldError message={fieldErrors.supplier_category} />
            </label>
            <label>
              <span className={labelClass}>{t('dash.supplier.profile.businessType')}</span>
              <input ref={registerField('business_type')} value={editDetails.business_type || ''} onChange={(event) => updateEditField('business_type', event.target.value)} className={fieldClass('business_type')} />
              <FieldError message={fieldErrors.business_type} />
            </label>
            <label>
              <span className={labelClass}>{t('ps.gstin')}</span>
              <input ref={registerField('gstin')} value={editDetails.gstin || ''} onChange={(event) => updateEditField('gstin', event.target.value)} className={fieldClass('gstin')} />
              <FieldError message={fieldErrors.gstin} />
            </label>
            <label>
              <span className={labelClass}>{t('ps.pan')}</span>
              <input ref={registerField('pan')} value={editDetails.pan || ''} onChange={(event) => updateEditField('pan', event.target.value)} className={fieldClass('pan')} />
              <FieldError message={fieldErrors.pan} />
            </label>
            <label>
              <span className={labelClass}>{t('dash.supplier.profile.website')}</span>
              <input ref={registerField('website')} value={editDetails.website || ''} onChange={(event) => updateEditField('website', event.target.value)} className={fieldClass('website')} />
              <FieldError message={fieldErrors.website} />
            </label>
            <label>
              <span className={labelClass}>{t('dash.supplier.profile.registrationYear')}</span>
              <input ref={registerField('registration_year')} type="number" value={editDetails.registration_year || ''} onChange={(event) => updateEditField('registration_year', event.target.value)} className={fieldClass('registration_year')} />
              <FieldError message={fieldErrors.registration_year} />
            </label>
            <label className="sm:col-span-2">
              <span className={labelClass}>{t('dash.supplier.profile.commaSeparated', { label: t(text.supply) })}{requiredFields.has('categories') && <RequiredMark />}</span>
              <input ref={registerField('categories')} value={editDetails.categories || ''} onChange={(event) => updateEditField('categories', event.target.value)} placeholder={t('ui.supplier.categoriesPlaceholder')} className={fieldClass('categories')} />
              <FieldError message={fieldErrors.categories} />
            </label>
            <label className="sm:col-span-2">
              <span className={labelClass}>{t(text.about)}{requiredFields.has('about') && <RequiredMark />}</span>
              <textarea ref={registerField('about')} value={editDetails.about || ''} onChange={(event) => updateEditField('about', event.target.value)} placeholder={t('dash.supplier.profile.aboutStorePh')} className={areaClass('about')} />
              <FieldError message={fieldErrors.about} />
            </label>
            <label className="sm:col-span-2">
              <span className={labelClass}>{t('dash.supplier.profile.commaSeparated', { label: t(text.locations) })}{requiredFields.has('delivery_locations') && <RequiredMark />}</span>
              <textarea ref={registerField('service_locations')} value={editDetails.service_locations || ''} onChange={(event) => updateEditField('service_locations', event.target.value)} placeholder={t('ui.supplier.deliveryLocationsPlaceholder')} className={`${areaClass('service_locations')} min-h-[56px]`} />
              <FieldError message={fieldErrors.service_locations} />
            </label>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-x-8 gap-y-0 md:grid-cols-2">
            <SectionRow required={requiredFields.has('store_name')} label={t(text.name)} value={td(profile.store_name)} />
            <SectionRow
              required={requiredFields.has('supplier_category')}
              label={t('dash.supplier.profile.supplierCategory')}
              value={profile.supplier_category ? optionLabel(t, SUPPLIER_TYPE_KEYS, profile.supplier_category) : '—'}
            />
            <SectionRow label={t('dash.supplier.profile.businessType')} value={optionLabel(t, BUSINESS_TYPE_KEYS, profile.business_type)} />
            <SectionRow label={t('ps.gstin')} value={profile.gstin} />
            <SectionRow label={t('ps.pan')} value={profile.pan} />
            <SectionRow label={t('dash.supplier.profile.website')} value={profile.website} />
            <SectionRow label={t('dash.supplier.profile.registrationYear')} value={profile.registration_year} />
            <SectionRow required={requiredFields.has('categories')} label={t(text.supply)} value={profile.categories?.map((category) => optionLabel(t, SUPPLIER_CATEGORY_KEYS, category)).join(', ')} />
            <SectionRow required={requiredFields.has('about')} label={t('dash.msg.about')} value={td(profile.about)} />
            <SectionRow required={requiredFields.has('delivery_locations')} label={t(text.locations)} value={profile.delivery_locations?.map(td).join(', ')} />
          </div>
        )}
      </Card>

      <Card title={t('dash.common.documentGallery')} icon={FileText}>
        <div>
          {editing && (
            <>
              <p className="mb-3 text-xs font-semibold text-graphite/45">{t('dash.supplier.profile.documentsHint')}</p>
              <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                {supplierDocumentTypes.map((documentType) => (
                  <label key={documentType} className="flex h-10 cursor-pointer items-center justify-between rounded-lg border border-slate-200 bg-white px-3 text-xs font-bold text-graphite/65 transition hover:border-brand-200 hover:bg-brand-50/40">
                    <span className="flex min-w-0 items-center gap-2"><FileText className="h-3.5 w-3.5 shrink-0 text-slate-500" /> <span className="truncate">{optionLabel(t, DOCUMENT_TYPE_KEYS, documentType)}</span></span>
                    <span className="shrink-0 text-brand-700">{t('dash.common.upload')}</span>
                    <input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" className="sr-only" onChange={(event) => uploadSectionFile('documents', event.target.files?.[0], documentType)} />
                  </label>
                ))}
              </div>
              <label className="mt-3 inline-flex h-9 cursor-pointer items-center gap-2 rounded-lg border border-dashed border-slate-300 bg-cream/40 px-3 text-xs font-extrabold text-brand-700 transition hover:bg-cream/70">
                {t('dash.supplier.profile.uploadGalleryImages')}
                <input type="file" multiple accept="image/*" className="sr-only" onChange={(event) => Array.from(event.target.files || []).forEach((file) => uploadSectionFile('gallery', file))} />
              </label>
            </>
          )}
          {documentList.length > 0 ? (
            <div className="mt-4 grid grid-cols-1 gap-2 md:grid-cols-2">
              {documentList.map((documentName) => {
                // A typed entry shows its type; an older bare entry shows as before.
                const { type } = splitDocumentEntry(documentName)
                return (
                  <div key={documentName} className="truncate rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-xs font-bold text-graphite/70">{type ? optionLabel(t, DOCUMENT_TYPE_KEYS, type) : documentName}</div>
                )
              })}
            </div>
          ) : (
            <p className="mt-4 text-sm font-semibold text-graphite/45">{t('dash.common.documentsNone')}</p>
          )}
          {galleryImages.length > 0 && (
            <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
              {galleryImages.map((image) => <SmartImage key={image} src={imageUrl(image)} alt="" className="h-24 rounded-xl object-cover" />)}
            </div>
          )}
        </div>
      </Card>

      {/* One Save for the whole profile, at the bottom of the edit section, and
          only while editing. No field saves on its own. */}
      {editing && (
        <div className="flex flex-wrap items-center justify-end gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-[0_14px_40px_-30px_rgba(15,23,42,0.35)]">
          {formError && (
            <p className="mr-auto min-w-0 text-sm font-bold text-rose-700">{formError}</p>
          )}
          <button
            type="button"
            onClick={cancelEdits}
            disabled={saving}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-extrabold text-graphite/60 transition hover:bg-slate-50 disabled:opacity-50"
          >
            <X className="h-3.5 w-3.5" /> {t('dash.common.cancel')}
          </button>
          <button
            type="button"
            onClick={saveProfile}
            disabled={saving}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-brand-700 px-4 text-xs font-extrabold text-white transition hover:bg-brand-800 disabled:opacity-50"
          >
            <Save className="h-3.5 w-3.5" /> {saving ? t('dash.common.saving') : t('dash.common.save')}
          </button>
        </div>
      )}
    </div>
  )
}
