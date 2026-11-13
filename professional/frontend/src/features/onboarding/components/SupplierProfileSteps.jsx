import { useEffect, useMemo, useState } from 'react'
import {
  Camera, FileText, HardHat, Mail, MapPin, Package, Phone, Plus, Store, Upload, UserRound, Wrench,
} from 'lucide-react'
import { fetchLaborTrades } from '../../labour/labourApi.js'
import { fetchEquipmentItems } from '../../equipment/equipmentApi.js'
import {
  EQUIPMENT, LABOUR, MATERIAL, includesValue, supplierDocumentsFor, supplierKind, supplierTextKeys, supplyOptions, toggleValue,
} from '../supplierProfileKinds.js'
import PincodeAreaHint from '../../../shared/ui/PincodeAreaHint.jsx'
import ProfileImageHint from '../../../shared/ui/ProfileImageHint.jsx'
import { PROFILE_IMAGE_ACCEPT } from '../../../shared/utils/profileImageRules.js'
import CountryOfResidenceField from './CountryField.jsx'
import { RequiredMark, requiredProfileFields } from '../../accounts/components/ProfileCompletionMeter.jsx'
import { imageUrl } from '../../../shared/api/apiClient.js'
import { businessTypeOptions, contractorEquipmentOptions, supplierTypeOptions } from '../profileConstants.js'
import { ContractorSetupHero } from './ProfileSetupHero.jsx'
import { useLanguage } from '../../../i18n/LanguageContext.jsx'
import { optionLabel, BUSINESS_TYPE_KEYS, DOCUMENT_TYPE_KEYS, EQUIPMENT_OPTION_KEYS, SUPPLIER_CATEGORY_KEYS, SUPPLIER_TYPE_KEYS } from '../../../i18n/optionKeys.js'

// The label of one "what you supply" choice: material categories and the known
// equipment names are translated; trades and supplier-entered equipment
// categories are shown as stored, the way the Labour and Equipment screens do.
function supplyLabel(t, kind, value) {
  if (kind === MATERIAL) return optionLabel(t, SUPPLIER_CATEGORY_KEYS, value)
  if (kind === EQUIPMENT) return optionLabel(t, EQUIPMENT_OPTION_KEYS, value)
  return value
}

const SUPPLY_ICON = { [MATERIAL]: Package, [LABOUR]: HardHat, [EQUIPMENT]: Wrench }

/**
 * The "what you supply" choices for this supplier's kind. Labour reads the
 * trades the backend accepts; Equipment reads the categories of the supplier's
 * own equipment items (empty for a new supplier). A failed lookup leaves only
 * the saved values and the built-in suggestions, never an error on the form.
 */
function useSupplyChoices(kind, saved) {
  const [trades, setTrades] = useState([])
  const [equipmentCategories, setEquipmentCategories] = useState([])
  useEffect(() => {
    let alive = true
    if (kind === LABOUR) {
      fetchLaborTrades().then((list) => { if (alive) setTrades(Array.isArray(list) ? list : []) }).catch(() => {})
    }
    if (kind === EQUIPMENT) {
      fetchEquipmentItems()
        .then((items) => { if (alive) setEquipmentCategories((Array.isArray(items) ? items : []).map((item) => item?.category)) })
        .catch(() => {})
    }
    return () => { alive = false }
  }, [kind])
  return useMemo(
    () => supplyOptions(kind, { trades, equipmentCategories, equipmentSuggestions: contractorEquipmentOptions, saved }),
    [kind, trades, equipmentCategories, saved],
  )
}

const fieldLabelClass = 'block text-[11px] font-extrabold uppercase tracking-wide text-slate-600'
const compactInputClass = 'mt-1.5 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-100'
const stepCardClass = 'rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_14px_40px_-30px_rgba(15,23,42,0.35)] sm:p-5'

function CompactStepHeader({ icon: Icon, title, subtitle }) {
  return (
    <div className="flex items-center gap-3 border-b border-slate-100 pb-3">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-700">
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0">
        <h2 className="font-display text-base font-extrabold leading-tight text-slate-950">{title}</h2>
        <p className="truncate text-[11px] font-medium text-slate-500">{subtitle}</p>
      </div>
    </div>
  )
}

function CompactImageUpload({ label, preview, note, uploadLabel, onUpload, onCapture, fallback }) {
  const { t } = useLanguage()
  return (
    <div className="mt-4">
      <p className={fieldLabelClass}>{label}</p>
      <div className="mt-2 flex flex-col gap-4 rounded-xl border border-dashed border-slate-300 bg-slate-50/50 p-4 sm:flex-row sm:items-center">
        <span className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-xl border border-slate-200 bg-slate-100 text-slate-400 shadow-sm">
          {preview ? (
            <img src={preview.startsWith('blob:') ? preview : imageUrl(preview)} alt="" className="h-full w-full object-cover" />
          ) : fallback}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-extrabold text-slate-950">{note}</p>
          <ProfileImageHint className="mt-0.5" />
          <div className="mt-2.5 flex flex-wrap gap-2">
            <label className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-md bg-brand-500 px-4 text-xs font-extrabold text-brand-950 transition hover:bg-brand-400">
              <Upload className="h-3.5 w-3.5" /> {uploadLabel}
              <input type="file" accept={PROFILE_IMAGE_ACCEPT} onChange={(event) => { onUpload(event); event.target.value = '' }} className="sr-only" />
            </label>
            <label className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-md border border-slate-200 bg-white px-4 text-xs font-extrabold text-slate-700 transition hover:bg-slate-50">
              <Camera className="h-3.5 w-3.5" /> {t('ps.camera')}
              <input type="file" accept="image/*" capture="environment" onChange={(event) => { onCapture(event); event.target.value = '' }} className="sr-only" />
            </label>
          </div>
        </div>
      </div>
    </div>
  )
}

export function SupplierProfileSteps({ form, formTopRef }) {
  const { t } = useLanguage()
  const {
    user, profileDetails, updateProfileField, fieldInputClass, fieldTextareaClass, optionGroupClass,
    FieldError, pincodeLookupState, profileImagePreview, businessLogoPreview,
    uploadProfileImage, uploadBusinessLogo, uploadDocument,
    uploadMessage, setUploadMessage, selectedSupplierCategories, setSelectedSupplierCategories,
    savedSupplierCategory = '', clearValidationError,
    serviceLocationInputs, updateServiceLocation, documentUploads,
    selectedPincodeBranch = null, selectPincodeBranch,
  } = form
  // The account's own required-field list (User.profile_completion_fields on
  // the server), so a mandatory field shows its * before Submit is pressed.
  const requiredFields = requiredProfileFields(user)
  const req = (field) => requiredFields.has(field) && <RequiredMark />
  // Which supplier form this is: the Supplier Category saved on the server, or,
  // for a supplier who has none saved yet, the one picked below. Wording, the
  // "what you supply" list and the documents all follow it.
  const kind = supplierKind(savedSupplierCategory || profileDetails.supplier_category)
  const text = supplierTextKeys(kind)
  const SupplyIcon = SUPPLY_ICON[kind] || Package
  // Every value seen in this session stays offered after it is unticked.
  const [seenSupplyValues, setSeenSupplyValues] = useState([])
  useEffect(() => {
    setSeenSupplyValues((current) => {
      const added = selectedSupplierCategories.filter((value) => !includesValue(current, value))
      return added.length ? [...current, ...added] : current
    })
  }, [selectedSupplierCategories])
  const supplyChoices = useSupplyChoices(kind, seenSupplyValues)
  const toggleSupply = (value) => {
    setSelectedSupplierCategories((current) => toggleValue(current, value))
    clearValidationError?.('categories')
  }
  // Equipment categories are free text on the supplier's items, so one that is
  // not listed can be added here.
  const [supplyDraft, setSupplyDraft] = useState('')
  const addSupplyDraft = () => {
    const value = supplyDraft.trim().slice(0, 60)
    if (!value) return
    if (!includesValue(selectedSupplierCategories, value)) toggleSupply(value)
    setSupplyDraft('')
  }
  const documentTypes = supplierDocumentsFor(kind)
  return (
    <div ref={formTopRef} className="mx-auto max-w-4xl scroll-mt-4 space-y-4">
      <ContractorSetupHero
        step={1}
        setupLabel={t('ps.sup.setupLabel')}
        subtitle={t('ps.sup.setupSubtitle')}
        trackerLabel={t('ps.owner.trackerProfile')}
        totalSteps={1}
      />

      <section className={stepCardClass}>
        <CompactStepHeader icon={Store} title={t(text.storeDetails)} subtitle={t(text.storeDetailsSub)} />
        <CompactImageUpload
          label={t(text.storeImage)}
          preview={profileImagePreview || profileDetails.profile_image_url}
          note={t(text.storeImageNote)}
          uploadLabel={t('ps.doc.actionUpload')}
          fallback={<Store className="h-6 w-6" />}
          onUpload={(event) => uploadProfileImage(event.target.files?.[0]).catch((error) => setUploadMessage(error.userMessage || error.response?.data?.detail || t('ps.uploadFailed')))}
          onCapture={(event) => uploadProfileImage(event.target.files?.[0]).catch((error) => setUploadMessage(error.userMessage || error.response?.data?.detail || t('ps.uploadFailed')))}
        />
        <div className="mt-4 grid grid-cols-1 gap-3.5 md:grid-cols-2">
          <label className="block">
            <span className={fieldLabelClass}>{t('ps.name')}{req('name')}</span>
            <span className="mt-1.5 flex h-10 items-center gap-2.5 rounded-lg border border-slate-200 bg-slate-50 px-3">
              <UserRound className="h-4 w-4 text-slate-400" />
              <input value={user?.name || ''} disabled className="w-full bg-transparent text-sm font-semibold outline-none" />
            </span>
          </label>
          <label className="block">
            <span className={fieldLabelClass}>{t('ps.email')}{req('email')}</span>
            <span className="mt-1.5 flex h-10 items-center gap-2.5 rounded-lg border border-slate-200 bg-slate-50 px-3">
              <Mail className="h-4 w-4 text-slate-400" />
              <input value={user?.email || ''} disabled className="w-full bg-transparent text-sm font-semibold outline-none" />
            </span>
          </label>
          <label className="block">
            <span className={fieldLabelClass}>{t('ps.phone')}{req('phone')}</span>
            <span className="mt-1.5 flex h-10 items-center gap-2.5 rounded-lg border border-slate-200 bg-white px-3">
              <Phone className="h-4 w-4 text-slate-400" />
              <input type="tel" maxLength={10} inputMode="numeric" value={profileDetails.phone} onChange={(event) => updateProfileField('phone', event.target.value)} placeholder="9876543210" className="w-full bg-transparent text-sm font-semibold outline-none placeholder:text-slate-400" />
            </span>
            <FieldError field="phone" />
          </label>
          <CountryOfResidenceField form={form} />
          <label className="block">
            <span className={fieldLabelClass}>{t('ps.pincode')}{req('pincode')}</span>
            <span className="mt-1.5 flex h-10 items-center gap-2.5 rounded-lg border border-slate-200 bg-white px-3">
              <MapPin className="h-4 w-4 text-slate-400" />
              <input value={profileDetails.pincode} onChange={(event) => updateProfileField('pincode', event.target.value)} placeholder="500001" className="w-full bg-transparent text-sm font-semibold outline-none placeholder:text-slate-400" />
            </span>
            <FieldError field="pincode" />
          </label>
          {/* Every branch under the pincode; the one picked becomes Location
              and, while it is empty, the first Delivery Location. */}
          <div className="md:col-span-2 empty:hidden">
            <PincodeAreaHint lookupState={pincodeLookupState} selectedBranch={selectedPincodeBranch} onSelectBranch={selectPincodeBranch} />
          </div>
          <label className="block">
            <span className={fieldLabelClass}>{t('ps.location')}</span>
            <span className="mt-1.5 flex h-10 items-center gap-2.5 rounded-lg border border-slate-200 bg-white px-3">
              <MapPin className="h-4 w-4 text-slate-400" />
              <input value={profileDetails.location || ''} onChange={(event) => updateProfileField('location', event.target.value)} placeholder={t('ps.locationPlaceholder')} className="w-full bg-transparent text-sm font-semibold outline-none placeholder:text-slate-400" />
            </span>
            <FieldError field="location" />
          </label>
          <label className="block md:col-span-2">
            <span className={fieldLabelClass}>{t('ps.address')}{req('address')}</span>
            <span className="mt-1.5 flex h-10 items-center gap-2.5 rounded-lg border border-slate-200 bg-white px-3">
              <MapPin className="h-4 w-4 text-slate-400" />
              <input value={profileDetails.address} onChange={(event) => updateProfileField('address', event.target.value)} placeholder={t('ps.addressPlaceholder')} className="w-full bg-transparent text-sm font-semibold outline-none placeholder:text-slate-400" />
            </span>
            <FieldError field="address" />
          </label>
        </div>
      </section>

      <section className={stepCardClass}>
        <CompactStepHeader icon={Store} title={t(text.profile)} subtitle={t(text.profileSub)} />
        <CompactImageUpload
          label={t(text.logo)}
          preview={businessLogoPreview || profileDetails.store_logo_url}
          note={t(text.logoNote)}
          uploadLabel={t('ps.doc.actionUpload')}
          fallback={<Store className="h-6 w-6" />}
          onUpload={(event) => uploadBusinessLogo('store_logo_url', event.target.files?.[0]).catch((error) => setUploadMessage(error.userMessage || error.response?.data?.detail || t('ps.con.logoUploadFailed')))}
          onCapture={(event) => uploadBusinessLogo('store_logo_url', event.target.files?.[0]).catch((error) => setUploadMessage(error.userMessage || error.response?.data?.detail || t('ps.con.logoUploadFailed')))}
        />
        <div className="mt-4 grid grid-cols-1 gap-3.5 md:grid-cols-3">
          <label className="block">
            <span className={fieldLabelClass}>{t(text.name)}{req('store_name')}</span>
            <input value={profileDetails.store_name} onChange={(event) => updateProfileField('store_name', event.target.value)} placeholder={t(text.namePlaceholder)} className={fieldInputClass('store_name', 'mt-1.5 h-10 w-full border-slate-200 text-sm font-semibold')} />
            <FieldError field="store_name" />
          </label>
          <label className="block">
            <span className={fieldLabelClass}>{t('ps.gstin')}</span>
            <input value={profileDetails.gstin} onChange={(event) => updateProfileField('gstin', event.target.value)} placeholder={t('ps.gstinPlaceholder')} className={compactInputClass} />
          </label>
          <label className="block">
            <span className={fieldLabelClass}>{t('ps.pan')}</span>
            <input value={profileDetails.pan} onChange={(event) => updateProfileField('pan', event.target.value)} placeholder={t('ps.panPlaceholder')} className={compactInputClass} />
          </label>
          <label className="block">
            <span className={fieldLabelClass}>{t('ps.website')}</span>
            <input value={profileDetails.website} onChange={(event) => updateProfileField('website', event.target.value)} placeholder={t('ps.sup.websitePlaceholder')} className={compactInputClass} />
          </label>
          <label className="block">
            <span className={fieldLabelClass}>{t('ps.supplierCategory')}{req('supplier_category')}</span>
            {/* Chosen once (the server refuses a change), so a saved category is
                shown read-only, as the dashboard profile shows it. */}
            {savedSupplierCategory ? (
              <input value={optionLabel(t, SUPPLIER_TYPE_KEYS, savedSupplierCategory)} disabled className={`${compactInputClass} bg-slate-50 text-slate-500`} />
            ) : (
              <select value={profileDetails.supplier_category} onChange={(event) => updateProfileField('supplier_category', event.target.value)} className={compactInputClass}>
                <option value="" disabled>{t('ps.selectSupplierCategory')}</option>
                {supplierTypeOptions.map((supplierType) => <option key={supplierType} value={supplierType}>{optionLabel(t, SUPPLIER_TYPE_KEYS, supplierType)}</option>)}
              </select>
            )}
            <FieldError field="supplier_category" />
          </label>
          <label className="block">
            <span className={fieldLabelClass}>{t('ps.businessType')}</span>
            <select value={profileDetails.business_type} onChange={(event) => updateProfileField('business_type', event.target.value)} className={compactInputClass}>
              <option value="" disabled>{t('ps.selectBusinessType')}</option>
              {businessTypeOptions.map((businessType) => <option key={businessType} value={businessType}>{optionLabel(t, BUSINESS_TYPE_KEYS, businessType)}</option>)}
            </select>
          </label>
          <label className="block">
            <span className={fieldLabelClass}>{t('ps.registrationYear')}</span>
            <input type="number" value={profileDetails.registration_year} onChange={(event) => updateProfileField('registration_year', event.target.value)} placeholder={t('ps.sup.yearPlaceholder')} className={compactInputClass} />
          </label>
          <label className="block md:col-span-2">
            <span className={fieldLabelClass}>{t(text.about)}{req('about')}</span>
            <textarea value={profileDetails.about} onChange={(event) => updateProfileField('about', event.target.value)} placeholder={t(text.aboutPlaceholder)} className={`${fieldTextareaClass('about')} min-h-24 border-slate-200 text-sm font-semibold`} />
            <FieldError field="about" />
          </label>
          <div>
            <span className={fieldLabelClass}>{t(text.locations)}{req('delivery_locations')}</span>
            <span className="ml-2 text-[11px] font-semibold text-slate-500">{t('ps.minMax3')}</span>
            <div className="mt-1.5 grid gap-2">
              {serviceLocationInputs.map((location, index) => (
                <span key={index} className="flex h-10 items-center gap-2.5 rounded-lg border border-slate-200 bg-white px-3">
                  <MapPin className="h-4 w-4 text-slate-400" />
                  <input value={location} onChange={(event) => updateServiceLocation(index, event.target.value)} placeholder={index === 0 ? t(text.primaryLocation) : t('ps.sup.optionalLocation', { index: index + 1 })} className="w-full bg-transparent text-sm font-semibold outline-none placeholder:text-slate-400" />
                </span>
              ))}
            </div>
            <FieldError field="service_locations" />
          </div>
        </div>
      </section>

      {/* What this supplier supplies, in its own category's terms: product
          categories, trades, or equipment categories. Shown once the category is
          known, so one kind's list never appears on another kind's form. */}
      {kind && (
      <section className={stepCardClass}>
        <CompactStepHeader icon={SupplyIcon} title={<>{t(text.supply)}{req('categories')}</>} subtitle={t(text.supplySub)} />
        <div className={optionGroupClass('categories', 'mt-4 grid grid-cols-1 gap-2.5 md:grid-cols-4')}>
          {supplyChoices.map((choice) => (
            <label key={choice} className="flex min-h-12 items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 text-sm font-extrabold text-slate-950 transition hover:border-brand-300 hover:bg-brand-50/30">
              <input type="checkbox" checked={includesValue(selectedSupplierCategories, choice)} onChange={() => toggleSupply(choice)} className="h-4 w-4 accent-brand-600" />
              <SupplyIcon className="h-4 w-4 text-brand-700" />
              {supplyLabel(t, kind, choice)}
            </label>
          ))}
        </div>
        {kind === EQUIPMENT && (
          <div className="mt-3 flex max-w-md flex-col items-start gap-2 sm:flex-row sm:items-center">
            <label className="sr-only" htmlFor="supplier-supply-other">{t('ps.sup.equipment.addLabel')}</label>
            <input
              id="supplier-supply-other"
              value={supplyDraft}
              maxLength={60}
              onChange={(event) => setSupplyDraft(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addSupplyDraft() } }}
              placeholder={t('ps.sup.equipment.addPlaceholder')}
              className={compactInputClass.replace('mt-1.5 ', '')}
            />
            <button type="button" onClick={addSupplyDraft} disabled={!supplyDraft.trim()} className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-extrabold text-brand-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50">
              <Plus className="h-3.5 w-3.5" /> {t('ps.sup.equipment.add')}
            </button>
          </div>
        )}
        <FieldError field="categories" />
      </section>
      )}

      {kind && (
      <section className={stepCardClass}>
        <CompactStepHeader icon={FileText} title={t('ps.documents')} subtitle={t(text.documentsHint)} />
        <div className="mt-4 grid grid-cols-1 gap-2.5 md:grid-cols-2">
          {documentTypes.map((documentType) => {
            const isUploaded = Boolean(documentUploads[documentType])
            return (
              <label
                key={documentType}
                className={`flex min-h-14 cursor-pointer items-center justify-between gap-3 rounded-xl border p-3 transition hover:border-brand-300 hover:bg-brand-50/30 ${
                  isUploaded ? 'border-brand-200 bg-brand-50' : 'border-slate-200 bg-white'
                }`}
              >
                <span className="flex min-w-0 items-center gap-3">
                  <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${isUploaded ? 'bg-brand-100 text-brand-700' : 'bg-slate-50 text-brand-600'}`}>
                    <FileText className="h-4 w-4" />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-extrabold text-slate-950">{optionLabel(t, DOCUMENT_TYPE_KEYS, documentType)}</span>
                    <span className={`mt-0.5 block text-xs font-medium ${isUploaded ? 'text-brand-700' : 'text-slate-400'}`}>{isUploaded ? t('ps.doc.uploaded') : t('ps.doc.none')}</span>
                  </span>
                </span>
                <span className={`shrink-0 rounded-lg border px-3 py-1.5 text-xs font-extrabold shadow-sm ${isUploaded ? 'border-brand-300 bg-brand-500 text-brand-950' : 'border-slate-200 bg-white text-brand-700'}`}>
                  {isUploaded ? t('ps.doc.actionUploaded') : t('ps.doc.actionUpload')}
                </span>
                <input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" onChange={(event) => uploadDocument(documentType, event.target.files?.[0]).catch((error) => setUploadMessage(error.userMessage || error.response?.data?.detail || t('ps.doc.uploadFailed')))} className="sr-only" />
              </label>
            )
          })}
        </div>
        {uploadMessage && <p className="mt-3 text-xs font-semibold text-brand-700">{uploadMessage}</p>}
      </section>
      )}
      {/* Image uploads report here until the documents section is shown. */}
      {!kind && uploadMessage && <p className="text-xs font-semibold text-brand-700">{uploadMessage}</p>}
    </div>
  )
}
