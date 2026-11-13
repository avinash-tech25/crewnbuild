import {
  Building2, Check, FileText, HardHat, Mail, MapPin, Phone, Plus, ShieldCheck, Upload, UserRound, Wrench, X,
} from 'lucide-react'
import PincodeAreaHint from '../../../shared/ui/PincodeAreaHint.jsx'
import ProfileImageHint from '../../../shared/ui/ProfileImageHint.jsx'
import { PROFILE_IMAGE_ACCEPT } from '../../../shared/utils/profileImageRules.js'
import CountryOfResidenceField from './CountryField.jsx'
import UpgradePrompt from '../../billing/subscription/UpgradePrompt.jsx'
import { RequiredMark, requiredProfileFields } from '../../accounts/components/ProfileCompletionMeter.jsx'
import { imageUrl } from '../../../shared/api/apiClient.js'
import { businessTypeOptions, contractorDocumentTypes, contractorEquipmentOptions, contractorServiceNotes, contractorServiceOptions } from '../profileConstants.js'
import { useLanguage } from '../../../i18n/LanguageContext.jsx'
import { optionLabel, BUSINESS_TYPE_KEYS, CONTRACTOR_STEP_KEYS, DOCUMENT_TYPE_KEYS, EQUIPMENT_OPTION_KEYS, SERVICE_NOTE_KEYS, SERVICE_OPTION_KEYS } from '../../../i18n/optionKeys.js'

const compactInput = 'h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-900 outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-100'
const stepCardClass = 'rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_14px_40px_-30px_rgba(15,23,42,0.35)] sm:p-5'
const fieldLabelClass = 'block text-[11px] font-extrabold uppercase tracking-wide text-slate-600'

function StepHeading({ icon: Icon, title, subtitle }) {
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

function CompactImageUpload({ label, preview, note, uploadLabel, onUpload, fallback }) {
  return (
    <div className="mt-4">
      <p className={fieldLabelClass}>{label}</p>
      <div className="mt-2 flex flex-col gap-4 rounded-xl border border-dashed border-slate-300 bg-slate-50/50 p-4 sm:flex-row sm:items-center">
        <span className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-full border border-slate-200 bg-slate-100 text-xs font-extrabold text-slate-400 shadow-sm">
          {preview ? (
            <img src={preview.startsWith('blob:') ? preview : imageUrl(preview)} alt="" className="h-full w-full object-cover" />
          ) : fallback}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-extrabold text-slate-950">{note}</p>
          {/* The real limit, the same line every profile image upload shows. */}
          <ProfileImageHint className="mt-0.5" />
          <div className="mt-2.5 flex flex-wrap gap-2">
            <label className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-md bg-brand-500 px-4 text-xs font-extrabold text-brand-950 transition hover:bg-brand-400">
              <Upload className="h-3.5 w-3.5" /> {uploadLabel}
              <input type="file" accept={PROFILE_IMAGE_ACCEPT} onChange={(event) => { onUpload(event); event.target.value = '' }} className="sr-only" />
            </label>
            {/* No separate "Capture live" button: it was a second file picker
                that opened the rear camera on phones. A phone's own picker
                already offers the camera. */}
          </div>
        </div>
      </div>
    </div>
  )
}

export function ContractorProfileSteps({ form, contractorStep, contractorSteps, goToContractorStep, formTopRef }) {
  const { t } = useLanguage()
  const {
    user, profileDetails, updateProfileField, fieldInputClass, fieldTextareaClass, optionGroupClass,
    FieldError, pincodeLookupState, profileImagePreview, businessLogoPreview,
    uploadProfileImage, uploadBusinessLogo, uploadGalleryImages, uploadDocument,
    uploadMessage, setUploadMessage, selectedServices, setSelectedServices, toggleListValue,
    selectedEquipment, setSelectedEquipment, serviceLocationInputs, addContractorServiceLocation,
    removeContractorServiceLocation, contractorLocationDraft, setContractorLocationDraft,
    pincodeLocations = false, locationLookupBusy = false, serviceLocationUsage = null, serviceLocationCap = 3,
    locationBranches = [], addServiceLocationBranch,
    locationPlan = 'FREE', builderSubscriptionStatus = null,
    galleryImagePreviews, galleryImageUrls, removeGalleryImage, documentUploads, documentUploadStatus,
    savedProfileState = 'ready', missingContractorFields = [], contractorStepSequence = [1, 2, 3, 4],
    selectedPincodeBranch = null, selectPincodeBranch, pincodeLocationKept = false,
  } = form
  // The account's own required-field list (User.profile_completion_fields on
  // the server), so a mandatory field shows its * before Next is pressed.
  const requiredFields = requiredProfileFields(user)
  const req = (field) => requiredFields.has(field) && <RequiredMark />
  // Progress through the steps this builder actually has to fill in.
  const stepsBeforeCurrent = contractorStepSequence.filter((step) => step < contractorStep).length
  const stepPosition = contractorStepSequence.includes(contractorStep) ? stepsBeforeCurrent + 1 : stepsBeforeCurrent
  const percent = Math.round((Math.max(stepPosition, 1) / contractorStepSequence.length) * 100)
  const missingFieldLabels = {
    phone: 'ps.phone',
    address: 'ps.address',
    pincode: 'ps.pincode',
    company_name: 'ps.con.companyName',
    license_number: 'ps.con.licenseNumber',
    experience_years: 'ps.con.experienceYears',
    about: 'ps.con.aboutCompany',
    service_locations: 'ps.con.serviceLocations',
    services_offered: 'ps.con.servicesOffered',
  }
  return (
    <div ref={formTopRef} className="mx-auto max-w-4xl scroll-mt-4 space-y-4">
      {/* Hero — matches the Contractor dashboard hero (dark navy canvas + brand-orange accents) */}
      <section className="relative overflow-hidden rounded-2xl border border-white/10 bg-[#0d1322] p-4 shadow-[0_18px_50px_-38px_rgba(2,6,23,0.9)] sm:p-5">
        <div className="pointer-events-none absolute -right-20 -top-24 h-72 w-72 rounded-full bg-brand-500/15 blur-3xl" aria-hidden="true" />
        <div className="pointer-events-none absolute -bottom-24 -left-20 h-72 w-72 rounded-full bg-violet-500/10 blur-3xl" aria-hidden="true" />
        <div
          className="pointer-events-none absolute inset-0"
          style={{ backgroundImage: 'radial-gradient(rgba(255,255,255,0.06) 1px, transparent 1px)', backgroundSize: '22px 22px' }}
          aria-hidden="true"
        />
        <div className="relative flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-brand-400 to-brand-600 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.35),0_8px_20px_-10px_rgba(35,102,69,0.8)]">
              <HardHat className="h-5 w-5" />
            </span>
            <div>
              <p className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-brand-300">{t('ps.con.setupLabel')}</p>
              <h1 className="font-display text-lg font-extrabold leading-tight text-white">{t('ps.con.completeProfile')}</h1>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-right">
              <p className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-slate-400">{t('ps.con.completionTracker')}</p>
              <p className="text-sm font-extrabold text-white">{t('site.estimate.step', { current: Math.max(stepPosition, 1), total: contractorStepSequence.length })}</p>
            </div>
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full border-4 border-brand-500 text-sm font-extrabold text-white">
              {percent}%
            </span>
          </div>
        </div>

        {/* Progress bar */}
        <div className="relative mt-3 h-1.5 overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full rounded-full bg-gradient-to-r from-brand-400 to-brand-600 transition-all duration-500"
            style={{ width: `${percent}%` }}
          />
        </div>

        {/* Compact stepper */}
        <div className="relative mt-4 flex items-center">
          {contractorSteps.map((stepItem, index) => {
            // A step with nothing left to fill in counts as done.
            const done = !contractorStepSequence.includes(stepItem.id) || stepItem.id < contractorStep
            const current = stepItem.id === contractorStep
            return (
              <div key={stepItem.id} className="flex min-w-0 flex-1 items-center last:flex-none">
                {index > 0 && (
                  <div className={`mx-1 h-0.5 flex-1 rounded-full sm:mx-2 ${stepItem.id <= contractorStep ? 'bg-brand-500' : 'bg-white/15'}`} />
                )}
                <button
                  type="button"
                  onClick={() => goToContractorStep(stepItem.id)}
                  className="flex flex-col items-center gap-1"
                >
                  <span className={`grid h-8 w-8 place-items-center rounded-full text-xs font-extrabold transition-all duration-300 ${
                    done ? 'bg-brand-500 text-brand-950' : current ? 'bg-brand-600 text-white ring-4 ring-brand-500/30' : 'bg-white/10 text-slate-300 hover:bg-white/20'
                  }`}>
                    {done ? <Check className="h-4 w-4" /> : stepItem.id}
                  </span>
                  <span className={`hidden text-[10px] font-extrabold uppercase tracking-wide sm:block ${
                    current ? 'text-brand-300' : done ? 'text-brand-300/80' : 'text-slate-400'
                  }`}>
                    {optionLabel(t, CONTRACTOR_STEP_KEYS, stepItem.label)}
                  </span>
                </button>
              </div>
            )
          })}
        </div>

        <p className="relative mt-3 text-xs font-medium leading-5 text-slate-300/80">
          {t('ui.profile.contractorHeroIntro')}
        </p>
      </section>

      {/* What is saved is already in the form; this says what is still needed. */}
      <div
        data-testid="profile-missing-fields"
        className={`rounded-2xl border px-4 py-3 text-sm ${
          savedProfileState === 'failed' ? 'border-red-200 bg-red-50 text-red-700' : 'border-brand-200 bg-brand-50/60 text-slate-800'
        }`}
      >
        {savedProfileState === 'loading' && <p className="font-bold">{t('cp.loadingSaved')}</p>}
        {savedProfileState === 'failed' && <p className="font-bold">{t('cp.loadSavedFailed')}</p>}
        {savedProfileState === 'ready' && (missingContractorFields.length ? (
          <>
            <p className="font-extrabold">{t('cp.missing.title')}</p>
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {missingContractorFields.map((field) => (
                <li key={field} className="rounded-full border border-amber-300 bg-amber-50 px-2.5 py-0.5 text-xs font-extrabold text-amber-800">
                  {t(missingFieldLabels[field])}
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="font-bold">{t('cp.missing.none')}</p>
        ))}
      </div>

      {contractorStep === 1 && (
        <section className={stepCardClass}>
          <StepHeading icon={UserRound} title={t('ps.profileDetails')} subtitle={t('ps.con.profileDetailsSub')} />
          <CompactImageUpload
            label={t('ps.profileImage')}
            preview={profileImagePreview || profileDetails.profile_image_url}
            note={t('ps.con.profileImageNote')}
            uploadLabel={t('ps.uploadImage')}
            fallback={<HardHat className="h-7 w-7 text-brand-600" aria-label={t('ps.profileFallback')} />}
            onUpload={(event) => uploadProfileImage(event.target.files?.[0]).catch((error) => setUploadMessage(error.userMessage || error.response?.data?.detail || t('ps.uploadFailed')))}
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
            {/* Every branch under the pincode; the one picked becomes Location. Not
                offered again while the saved pincode and post office are unchanged. */}
            {!pincodeLocationKept && (
              <div className="md:col-span-2 empty:hidden">
                <PincodeAreaHint lookupState={pincodeLookupState} selectedBranch={selectedPincodeBranch} onSelectBranch={selectPincodeBranch} />
              </div>
            )}
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
      )}

      {contractorStep === 2 && (
        <section className={stepCardClass}>
          <StepHeading icon={Building2} title={t('ps.con.builderProfile')} subtitle={t('ps.con.builderProfileSub')} />
          <CompactImageUpload
            label={t('ps.con.companyLogo')}
            preview={businessLogoPreview || profileDetails.company_logo_url}
            note={t('ps.con.logoNote')}
            uploadLabel={t('ps.con.uploadLogo')}
            fallback={t('ps.con.logoFallback')}
            onUpload={(event) => uploadBusinessLogo('company_logo_url', event.target.files?.[0]).catch((error) => setUploadMessage(error.userMessage || error.response?.data?.detail || t('ps.con.logoUploadFailed')))}
          />
          <div className="mt-4 grid grid-cols-1 gap-3.5 md:grid-cols-3">
            <label className="block md:col-span-2">
              <span className={fieldLabelClass}>{t('ps.con.companyName')}{req('company_name')}</span>
              <input value={profileDetails.company_name} onChange={(event) => updateProfileField('company_name', event.target.value)} placeholder={t('ps.con.companyNamePlaceholder')} className={fieldInputClass('company_name', 'mt-1.5 h-10 w-full border-slate-200 text-sm font-semibold')} />
              <FieldError field="company_name" />
            </label>
            <label className="block">
              <span className={fieldLabelClass}>{t('ps.con.experienceYears')}{req('experience_years')}</span>
              <input type="number" min="1" step="1" inputMode="numeric" value={profileDetails.experience_years} onChange={(event) => updateProfileField('experience_years', event.target.value)} className={fieldInputClass('experience_years', 'mt-1.5 h-10 w-full border-slate-200 text-sm font-semibold')} />
              <FieldError field="experience_years" />
            </label>
            <label className="block">
              <span className={fieldLabelClass}>{t('ps.con.licenseNumber')}{req('license_number')}</span>
              <input value={profileDetails.license_number} onChange={(event) => updateProfileField('license_number', event.target.value)} placeholder={t('ps.con.licensePlaceholder')} className={fieldInputClass('license_number', 'mt-1.5 h-10 w-full border-slate-200 text-sm font-semibold')} />
              <FieldError field="license_number" />
            </label>
            <label className="block">
              <span className={fieldLabelClass}>{t('ps.gstin')}</span>
              <input value={profileDetails.gstin} onChange={(event) => updateProfileField('gstin', event.target.value)} placeholder={t('ps.gstinPlaceholder')} className={`${compactInput} mt-1.5`} />
            </label>
            <label className="block">
              <span className={fieldLabelClass}>{t('ps.pan')}</span>
              <input value={profileDetails.pan} onChange={(event) => updateProfileField('pan', event.target.value)} placeholder={t('ps.panPlaceholder')} className={`${compactInput} mt-1.5`} />
            </label>
            <label className="block md:col-span-3">
              <span className={fieldLabelClass}>{t('ps.website')}</span>
              <input value={profileDetails.website} onChange={(event) => updateProfileField('website', event.target.value)} placeholder={t('ps.con.websitePlaceholder')} className={`${compactInput} mt-1.5`} />
            </label>
            <label className="block">
              <span className={fieldLabelClass}>{t('ps.businessType')}</span>
              <select value={profileDetails.business_type} onChange={(event) => updateProfileField('business_type', event.target.value)} className={`${compactInput} mt-1.5 appearance-none`}>
                <option value="" disabled>{t('ps.selectBusinessType')}</option>
                {businessTypeOptions.map((businessType) => <option key={businessType} value={businessType}>{optionLabel(t, BUSINESS_TYPE_KEYS, businessType)}</option>)}
              </select>
            </label>
            <label className="block">
              <span className={fieldLabelClass}>{t('ps.registrationYear')}</span>
              <input type="number" value={profileDetails.registration_year} onChange={(event) => updateProfileField('registration_year', event.target.value)} placeholder={t('ps.con.yearPlaceholder')} className={`${compactInput} mt-1.5`} />
            </label>
            <label className="block">
              <span className={fieldLabelClass}>{t('ps.con.teamSize')}</span>
              <input value={profileDetails.team_size} onChange={(event) => updateProfileField('team_size', event.target.value)} placeholder={t('ps.con.teamSizePlaceholder')} className={`${compactInput} mt-1.5`} />
            </label>
            <label className="block md:col-span-3">
              <span className={fieldLabelClass}>{t('ps.con.aboutCompany')}{req('about')}</span>
              <textarea value={profileDetails.about} onChange={(event) => updateProfileField('about', event.target.value)} placeholder={t('ps.con.aboutPlaceholder')} className={`${fieldTextareaClass('about')} mt-1.5 min-h-24 border-slate-200 text-sm font-semibold`} />
              <FieldError field="about" />
            </label>
          </div>
        </section>
      )}

      {contractorStep === 3 && (
        <section className={stepCardClass}>
          <StepHeading icon={Wrench} title={t('ps.con.services')} subtitle={t('ps.con.servicesSub')} />
          <div className="mt-4">
            <h3 className="text-sm font-extrabold text-slate-950">{t('ps.con.servicesOffered')}{req('services_offered')}</h3>
            <p className="mt-0.5 text-xs font-medium text-slate-500">{t('ps.con.servicesHint')}</p>
            <div className={optionGroupClass('services_offered', 'mt-3 grid grid-cols-1 gap-2.5 md:grid-cols-2 xl:grid-cols-3')}>
              {contractorServiceOptions.map((service) => (
                <label key={service} className="flex min-h-14 cursor-pointer items-start gap-3 rounded-xl border border-slate-200 bg-white p-3 text-slate-950 transition hover:border-brand-300 hover:bg-brand-50/40">
                  <input type="checkbox" checked={selectedServices.includes(service)} onChange={() => toggleListValue(service, selectedServices, setSelectedServices, 'services_offered')} className="mt-0.5 h-4 w-4 accent-brand-600" />
                  <span className="min-w-0">
                    <span className="block text-sm font-extrabold">{optionLabel(t, SERVICE_OPTION_KEYS, service)}</span>
                    <span className="mt-0.5 block text-xs font-medium text-slate-500">{SERVICE_NOTE_KEYS[service] ? t(SERVICE_NOTE_KEYS[service]) : contractorServiceNotes[service]}</span>
                  </span>
                </label>
              ))}
            </div>
            <FieldError field="services_offered" />
          </div>
          <div className="mt-4 border-t border-slate-100 pt-4">
            <h3 className="text-sm font-extrabold text-slate-950">{t('ps.con.equipmentOwned')}</h3>
            <p className="mt-0.5 text-xs font-medium text-slate-500">{t('ps.con.equipmentHint')}</p>
            <div className="mt-3 grid grid-cols-1 gap-2.5 md:grid-cols-2 xl:grid-cols-3">
              {contractorEquipmentOptions.map((equipment) => (
                <label key={equipment} className="flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 text-sm font-extrabold text-slate-950 transition hover:border-brand-300 hover:bg-brand-50/40">
                  <input type="checkbox" checked={selectedEquipment.includes(equipment)} onChange={() => toggleListValue(equipment, selectedEquipment, setSelectedEquipment)} className="h-4 w-4 accent-brand-600" />
                  {optionLabel(t, EQUIPMENT_OPTION_KEYS, equipment)}
                </label>
              ))}
            </div>
          </div>
          <div className="mt-4 border-t border-slate-100 pt-4">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-extrabold text-slate-950">{t('ps.con.serviceLocations')}{req('service_locations')}</h3>
              {/* India: the plan's limit once the server has reported it (never a
                  guessed 3, so Plus and Premium read unlimited); elsewhere the existing 1-3. */}
              {(serviceLocationUsage || !pincodeLocations) && (
                <span className="rounded-full border border-brand-200 bg-brand-50 px-2.5 py-0.5 text-[10px] font-extrabold text-brand-700">
                  {!serviceLocationUsage ? t('ps.minMax3Caps')
                    : serviceLocationUsage.limit === null ? t('subscription.usage.locationsUnlimited', { used: serviceLocationUsage.used })
                      : t('subscription.usage.locations', { used: serviceLocationUsage.used, limit: serviceLocationUsage.limit, remaining: serviceLocationUsage.remaining })}
                </span>
              )}
            </div>
            <p className="mt-0.5 text-xs font-medium text-slate-500">{pincodeLocations ? t('subscription.location.pincodeHint') : t('ps.con.locationsHint')}</p>
            <div className="mt-3 flex gap-2">
              <span className="flex h-10 flex-1 items-center gap-2.5 rounded-lg border border-slate-200 bg-white px-3">
                <MapPin className="h-4 w-4 text-slate-400" />
                <input value={contractorLocationDraft} onChange={(event) => setContractorLocationDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addContractorServiceLocation() } }} placeholder={pincodeLocations ? t('subscription.location.pincodePlaceholder') : t('ps.con.locationPlaceholder')} inputMode={pincodeLocations ? 'numeric' : undefined} maxLength={pincodeLocations ? 6 : undefined} className="w-full bg-transparent text-sm font-semibold outline-none placeholder:text-slate-400" />
              </span>
              <button type="button" onClick={addContractorServiceLocation} disabled={locationLookupBusy} className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-brand-500 text-brand-950 transition hover:bg-brand-400 disabled:opacity-60">
                <Plus className="h-5 w-5" />
              </button>
            </div>
            {/* India: every post office under the typed pincode; the one picked is added. */}
            {pincodeLocations && locationBranches.length > 0 && (
              <PincodeAreaHint
                lookupState={{ status: 'success', branches: locationBranches, message: locationBranches[0].display }}
                onSelectBranch={addServiceLocationBranch}
              />
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              {serviceLocationInputs.map((location, index) => location.trim() ? (
                <span key={`${location}-${index}`} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-extrabold text-slate-700">
                  {location}
                  <button type="button" onClick={() => removeContractorServiceLocation(index)} className="text-slate-400 transition hover:text-slate-700"><X className="h-3.5 w-3.5" /></button>
                </span>
              ) : null)}
            </div>
            <FieldError field="service_locations" />
            {serviceLocationUsage?.atLimit && (
              <div className="mt-3">
                <UpgradePrompt kind="locations" planCode={locationPlan} limit={serviceLocationCap} status={builderSubscriptionStatus} compact />
              </div>
            )}
          </div>
        </section>
      )}

      {contractorStep === 4 && (
        <section className={stepCardClass}>
          <StepHeading icon={ShieldCheck} title={t('ps.con.credentials')} subtitle={t('ps.con.credentialsSub')} />
          <div className="mt-4 flex items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-extrabold text-slate-950">{t('ps.con.galleryImages')}</h3>
              <p className="mt-0.5 text-xs font-medium text-slate-500">{t('ps.con.galleryHint')}</p>
            </div>
            <span className="shrink-0 text-xs font-extrabold text-slate-500">{galleryImagePreviews.length ? t('ui.profile.selectedCount', { count: galleryImagePreviews.length }) : t('ui.profile.zeroUploaded')}</span>
          </div>
          <div className="mt-3 grid grid-cols-1 gap-2.5 sm:max-w-xs">
            <label className="grid min-h-24 cursor-pointer place-items-center rounded-xl border border-dashed border-slate-300 bg-slate-50 p-3 text-center transition hover:bg-slate-100">
              <span>
                <span className="mx-auto grid h-9 w-9 place-items-center rounded-lg bg-white text-brand-600 shadow-sm"><Upload className="h-4 w-4" /></span>
                <span className="mt-2 block text-sm font-extrabold text-slate-800">{t('ps.con.uploadImages')}</span>
                <span className="mt-0.5 block text-xs font-medium text-slate-400">{t('ps.con.pngJpg')}</span>
              </span>
              <input type="file" accept={PROFILE_IMAGE_ACCEPT} multiple onChange={(event) => { const files = Array.from(event.target.files || []); event.target.value = ''; uploadGalleryImages(files).catch((error) => setUploadMessage(error.userMessage || error.response?.data?.detail || t('ui.profile.imageUploadFailed'))) }} className="sr-only" />
            </label>
            {/* The "Take photo" tile that sat here was a plain single-file
                picker under a camera label; the one above covers it. */}
          </div>
          {galleryImagePreviews.length > 0 && (
            <>
              <p className="mt-3 text-xs font-bold text-brand-700">
                {galleryImageUrls.length >= galleryImagePreviews.length ? t('ps.con.imagesUploaded', { count: galleryImagePreviews.length }) : t('ps.con.imagesSelected', { count: galleryImagePreviews.length })}
              </p>
              <div className="mt-3 grid grid-cols-3 gap-2.5 sm:grid-cols-4 lg:grid-cols-5">
                {galleryImagePreviews.map((image, index) => (
                  <div key={`${image}-${index}`} className="group relative">
                    <img src={image.startsWith('blob:') ? image : imageUrl(image)} alt="" className="h-24 w-full rounded-lg border border-slate-200 object-cover shadow-sm" />
                    <button type="button" onClick={() => removeGalleryImage(index)} aria-label={t('ps.con.removeImage')} className="absolute right-1.5 top-1.5 grid h-6 w-6 place-items-center rounded-full bg-white text-slate-700 shadow-md ring-1 ring-slate-200 transition hover:bg-red-50 hover:text-red-600">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}
          <div className="mt-5 border-t border-slate-100 pt-4">
            <h3 className="text-sm font-extrabold text-slate-950">{t('ps.con.documentsVerification')}</h3>
            <p className="mt-0.5 text-xs font-medium text-slate-500">{t('ps.con.documentsHint')}</p>
            <div className="mt-3 grid grid-cols-1 gap-2.5 md:grid-cols-2">
              {contractorDocumentTypes.map((documentType) => {
                const uploadStatus = documentUploadStatus[documentType]
                const isUploading = uploadStatus === 'uploading'
                const isUploaded = Boolean(documentUploads[documentType]) || uploadStatus === 'uploaded'
                const isFailed = uploadStatus === 'failed'
                const statusText = isUploading ? t('ps.doc.uploading') : isUploaded ? t('ps.doc.uploaded') : isFailed ? t('ps.doc.failed') : t('ps.doc.none')
                const actionText = isUploading ? t('ps.doc.actionUploading') : isUploaded ? t('ps.doc.actionUploaded') : isFailed ? t('ps.doc.actionRetry') : t('ps.doc.actionUpload')
                const cardClass = isUploaded ? 'border-brand-200 bg-brand-50/50' : isUploading ? 'border-brand-200 bg-brand-50/60' : isFailed ? 'border-red-200 bg-red-50/60' : 'border-slate-200 bg-white'
                const actionClass = isUploaded ? 'border-brand-200 bg-brand-100 text-brand-800' : isUploading ? 'border-brand-200 bg-brand-100 text-brand-700' : isFailed ? 'border-red-200 bg-red-100 text-red-700' : 'border-slate-200 bg-white text-brand-700'
                return (
                  <label key={documentType} className={`flex min-h-14 cursor-pointer items-center justify-between gap-3 rounded-xl border p-3 transition hover:border-brand-300 hover:bg-brand-50/30 ${cardClass}`}>
                    <span className="flex min-w-0 items-center gap-3">                        <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${isUploaded ? 'bg-brand-100 text-brand-700' : isFailed ? 'bg-red-100 text-red-600' : 'bg-brand-50 text-brand-600'}`}>
                        <FileText className="h-4 w-4" />
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-extrabold text-slate-950">{optionLabel(t, DOCUMENT_TYPE_KEYS, documentType)}</span>
                        <span className={`mt-0.5 block text-xs font-medium ${isUploaded ? 'text-brand-700' : isFailed ? 'text-red-600' : isUploading ? 'text-brand-700' : 'text-slate-400'}`}>{statusText}</span>
                      </span>
                    </span>
                    <span className={`shrink-0 rounded-lg border px-3 py-1.5 text-xs font-extrabold shadow-sm ${actionClass}`}>{actionText}</span>
                    <input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" onChange={(event) => uploadDocument(documentType, event.target.files?.[0]).catch((error) => setUploadMessage(error.userMessage || error.response?.data?.detail || t('ps.doc.uploadFailed')))} className="sr-only" />
                  </label>
                )
              })}
            </div>
          </div>
          <label className="mt-4 flex min-h-14 cursor-pointer items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 text-slate-950">
            <input type="checkbox" checked={profileDetails.insurance_available} onChange={(event) => updateProfileField('insurance_available', event.target.checked)} className="h-4 w-4 accent-brand-600" />
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-brand-100 text-brand-700"><ShieldCheck className="h-4 w-4" /></span>
            <span>
              <span className="block text-sm font-extrabold">{t('ps.con.insuranceAvailable')}</span>
              <span className="mt-0.5 block text-xs font-medium text-slate-500">{t('ps.con.insuranceHint')}</span>
            </span>
          </label>
          {uploadMessage && <p className="mt-3 text-xs font-semibold text-brand-700">{uploadMessage}</p>}
        </section>
      )}
    </div>
  )
}
