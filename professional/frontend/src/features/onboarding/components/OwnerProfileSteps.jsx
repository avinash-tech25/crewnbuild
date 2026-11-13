import {
  Camera, Home, Mail, MapPin, Phone, Upload, UserRound,
} from 'lucide-react'
import PincodeAreaHint from '../../../shared/ui/PincodeAreaHint.jsx'
import ProfileImageHint from '../../../shared/ui/ProfileImageHint.jsx'
import { PROFILE_IMAGE_ACCEPT } from '../../../shared/utils/profileImageRules.js'
import { RequiredMark, requiredProfileFields } from '../../accounts/components/ProfileCompletionMeter.jsx'
import BudgetInWords from '../../../shared/ui/BudgetInWords.jsx'
import CountryOfResidenceField from './CountryField.jsx'
import { imageUrl } from '../../../shared/api/apiClient.js'
import { ContractorSetupHero } from './ProfileSetupHero.jsx'
import { useLanguage } from '../../../i18n/LanguageContext.jsx'
import { floorOptionsForCountry, floorTypeLabel } from '../../../shared/utils/floorOptions.js'

const fieldLabelClass = 'block text-[11px] font-extrabold uppercase tracking-wide text-slate-600'
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

export function OwnerProfileSteps({ form, ownerStep, isOwnerEstimateMode, formTopRef }) {
  const { t } = useLanguage()
  const {
    user, profileDetails, updateProfileField, fieldInputClass, fieldTextareaClass,
    FieldError, pincodeLookupState, profileImagePreview,
    uploadProfileImage, setUploadMessage,
    selectedPincodeBranch = null, selectPincodeBranch,
  } = form
  // Which of these fields are mandatory, straight from the backend's single
  // definition (`profile_completion.required_fields`) -- the same source the
  // House Owner's Profile Settings panel marks its labels from. Nothing here
  // decides what is required; it only shows what already is, from the moment
  // the form opens rather than after the fact.
  const requiredFields = requiredProfileFields(user)
  return (
    <div ref={formTopRef} className="mx-auto max-w-4xl scroll-mt-4 space-y-4">
      <ContractorSetupHero
        step={ownerStep}
        setupLabel={t('ps.owner.setupLabel')}
        subtitle={isOwnerEstimateMode ? t('ps.owner.subtitleEstimate') : t('ps.owner.subtitleProfile')}
        trackerLabel={isOwnerEstimateMode ? t('ps.owner.trackerEstimate') : t('ps.owner.trackerProfile')}
        // The profile is one step: name, email, phone, address, pincode. The
        // second step (project details) is only the estimate's.
        totalSteps={isOwnerEstimateMode ? 2 : 1}
      />

      {/* Compact 2-step indicator (estimate only) */}
      {isOwnerEstimateMode && <div className="flex items-center gap-3">
        <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-extrabold uppercase tracking-wide ${ownerStep === 1 ? 'bg-brand-100 text-brand-800 ring-1 ring-brand-200' : 'bg-slate-100 text-slate-500'}`}>
          <span className={`grid h-4 w-4 place-items-center rounded-full ${ownerStep === 1 ? 'bg-brand-600 text-white' : 'bg-slate-300 text-white'}`}><UserRound className="h-2.5 w-2.5" /></span>
          {t('ps.owner.step1')}
        </span>
        <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-extrabold uppercase tracking-wide ${ownerStep === 2 ? 'bg-brand-100 text-brand-800 ring-1 ring-brand-200' : 'bg-slate-100 text-slate-500'}`}>
          <span className={`grid h-4 w-4 place-items-center rounded-full ${ownerStep === 2 ? 'bg-brand-600 text-white' : 'bg-slate-300 text-white'}`}><Home className="h-2.5 w-2.5" /></span>
          {t('ps.owner.step2')}
        </span>
      </div>}

      {ownerStep === 1 && (
        <section className={stepCardClass}>
          <CompactStepHeader icon={UserRound} title={t('ps.profileDetails')} subtitle={t('ps.profileDetailsSub')} />
          <div className="mt-4">
            <p className={fieldLabelClass}>{t('ps.profileImage')}</p>
            <div className="mt-2 flex flex-col gap-4 rounded-xl border border-dashed border-slate-300 bg-slate-50/50 p-4 sm:flex-row sm:items-center">
              <span className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-full border border-slate-200 bg-slate-100 text-xs font-extrabold text-slate-400 shadow-sm">
                {profileImagePreview || profileDetails.profile_image_url ? (
                  <img src={(profileImagePreview || profileDetails.profile_image_url).startsWith('blob:') ? (profileImagePreview || profileDetails.profile_image_url) : imageUrl(profileImagePreview || profileDetails.profile_image_url)} alt="" className="h-full w-full object-cover" />
                ) : t('ps.profileFallback')}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-extrabold text-slate-950">{t('ps.uploadPhoto')}</p>
                <ProfileImageHint className="mt-0.5" />
                <div className="mt-2.5 flex flex-wrap gap-2">
                  <label className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-md bg-brand-500 px-4 text-xs font-extrabold text-brand-950 transition hover:bg-brand-400">
                    <Upload className="h-3.5 w-3.5" /> {t('ps.uploadImage')}
                    <input type="file" accept={PROFILE_IMAGE_ACCEPT} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; return uploadProfileImage(file).catch((error) => setUploadMessage(error.userMessage || error.response?.data?.detail || t('ps.uploadFailed'))) }} className="sr-only" />
                  </label>
                  <label className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-md border border-slate-200 bg-white px-4 text-xs font-extrabold text-slate-700 transition hover:bg-slate-50">
                    <Camera className="h-3.5 w-3.5" /> {t('ps.captureLive')}
                    <input type="file" accept="image/*" capture="environment" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; return uploadProfileImage(file).catch((error) => setUploadMessage(error.userMessage || error.response?.data?.detail || t('ps.uploadFailed'))) }} className="sr-only" />
                  </label>
                </div>
              </div>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-1 gap-3.5 md:grid-cols-2">
            <label className="block">
              <span className={fieldLabelClass}>{t('ps.name')}{requiredFields.has('name') && <RequiredMark />}</span>
              <span className="mt-1.5 flex h-10 items-center gap-2.5 rounded-lg border border-slate-200 bg-slate-50 px-3">
                <UserRound className="h-4 w-4 text-slate-400" />
                <input value={user?.name || ''} disabled className="w-full bg-transparent text-sm font-semibold outline-none" />
              </span>
            </label>
            <label className="block">
              <span className={fieldLabelClass}>{t('ps.email')}{requiredFields.has('email') && <RequiredMark />}</span>
              <span className="mt-1.5 flex h-10 items-center gap-2.5 rounded-lg border border-slate-200 bg-slate-50 px-3">
                <Mail className="h-4 w-4 text-slate-400" />
                <input value={user?.email || ''} disabled className="w-full bg-transparent text-sm font-semibold outline-none" />
              </span>
            </label>
            <label className="block">
              <span className={fieldLabelClass}>{t('ps.phone')}{requiredFields.has('phone') && <RequiredMark />}</span>
              <span className="mt-1.5 flex h-10 items-center gap-2.5 rounded-lg border border-slate-200 bg-white px-3">
                <Phone className="h-4 w-4 text-slate-400" />
                <input type="tel" maxLength={10} inputMode="numeric" value={profileDetails.phone} onChange={(event) => updateProfileField('phone', event.target.value)} placeholder="9876543210" className="w-full bg-transparent text-sm font-semibold outline-none placeholder:text-slate-400" />
              </span>
              <FieldError field="phone" />
            </label>
            <CountryOfResidenceField form={form} />
            <label className="block">
              <span className={fieldLabelClass}>{t('ps.pincode')}{requiredFields.has('pincode') && <RequiredMark />}</span>
              <span className="mt-1.5 flex h-10 items-center gap-2.5 rounded-lg border border-slate-200 bg-white px-3">
                <MapPin className="h-4 w-4 text-slate-400" />
                <input value={profileDetails.pincode} onChange={(event) => updateProfileField('pincode', event.target.value)} placeholder="500001" className="w-full bg-transparent text-sm font-semibold outline-none placeholder:text-slate-400" />
              </span>
              <FieldError field="pincode" />
            </label>
            {/* Every branch under the pincode; the one picked becomes Location. */}
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
              <span className={fieldLabelClass}>{t('ps.address')}{requiredFields.has('address') && <RequiredMark />}</span>
              <span className="mt-1.5 flex h-10 items-center gap-2.5 rounded-lg border border-slate-200 bg-white px-3">
                <MapPin className="h-4 w-4 text-slate-400" />
                <input value={profileDetails.address} onChange={(event) => updateProfileField('address', event.target.value)} placeholder={t('ps.addressPlaceholder')} className="w-full bg-transparent text-sm font-semibold outline-none placeholder:text-slate-400" />
              </span>
              <FieldError field="address" />
            </label>
          </div>
        </section>
      )}

      {ownerStep === 2 && (
        <section className={stepCardClass}>
          <CompactStepHeader icon={Home} title={t('ps.owner.houseProfile')} subtitle={t('ps.owner.houseProfileSub')} />
          <div className="mt-4 grid grid-cols-1 gap-3.5 md:grid-cols-2">
            <label className="block">
              <span className={fieldLabelClass}>{t('ps.owner.projectTitle')}{requiredFields.has('project_title') && <RequiredMark />}</span>
              <input value={profileDetails.project_title} onChange={(event) => updateProfileField('project_title', event.target.value)} placeholder={t('ps.owner.projectTitlePlaceholder')} className={fieldInputClass('project_title', 'mt-1.5 h-10 w-full border-slate-200 text-sm font-semibold')} />
              <FieldError field="project_title" />
            </label>
            <label className="block">
              <span className={fieldLabelClass}>{t('ps.owner.startTimeline')}</span>
              <select value={profileDetails.start_timeline} onChange={(event) => updateProfileField('start_timeline', event.target.value)} className="mt-1.5 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-100">
                <option value="">{t('ps.owner.selectTimeline')}</option>
                <option value="Immediately">{t('ps.timeline.immediately')}</option>
                <option value="Within 1 month">{t('ps.timeline.within1')}</option>
                <option value="1-3 months">{t('ps.timeline.m1to3')}</option>
                <option value="3-6 months">{t('ps.timeline.m3to6')}</option>
              </select>
            </label>
            <label className="block md:col-span-2">
              <span className={fieldLabelClass}>{t('ps.owner.projectDescription')}{requiredFields.has('project_description') && <RequiredMark />}</span>
              <textarea value={profileDetails.project_description} onChange={(event) => updateProfileField('project_description', event.target.value)} placeholder={t('ps.owner.projectDescPlaceholder')} className={`${fieldTextareaClass('project_description')} min-h-24 border-slate-200 text-sm font-semibold`} />
              <FieldError field="project_description" />
            </label>
            <label className="block">
              <span className={fieldLabelClass}>{t('ps.owner.buildingType')}{requiredFields.has('building_type') && <RequiredMark />}</span>
              <select value={profileDetails.building_type} onChange={(event) => updateProfileField('building_type', event.target.value)} className={fieldInputClass('building_type', 'mt-1.5 h-10 w-full border-slate-200 text-sm font-semibold')}>
                <option value="">{t('ps.owner.selectBuildingType')}</option>
                <option value="RESIDENTIAL">{t('ps.building.residential')}</option>
                <option value="COMMERCIAL">{t('ps.building.commercial')}</option>
                <option value="VILLA">{t('ps.building.villa')}</option>
                <option value="DUPLEX">{t('ps.building.duplex')}</option>
              </select>
              <FieldError field="building_type" />
            </label>
            <label className="block">
              <span className={fieldLabelClass}>{t('ps.owner.constructionType')}{requiredFields.has('construction_type') && <RequiredMark />}</span>
              <select value={profileDetails.construction_type} onChange={(event) => updateProfileField('construction_type', event.target.value)} className={fieldInputClass('construction_type', 'mt-1.5 h-10 w-full border-slate-200 text-sm font-semibold')}>
                <option value="">{t('ps.owner.selectConstructionType')}</option>
                <option value="CONTRACTOR">{t('ps.construction.contractor')}</option>
                <option value="SELF_CONSTRUCTION">{t('ps.construction.self')}</option>
              </select>
              <FieldError field="construction_type" />
            </label>
            <label className="block">
              <span className={fieldLabelClass}>{t('ps.owner.budget')}{requiredFields.has('budget') && <RequiredMark />}</span>
              <input type="number" min="1" value={profileDetails.budget} onChange={(event) => updateProfileField('budget', event.target.value)} placeholder="2500000" className={fieldInputClass('budget', 'mt-1.5 h-10 w-full border-slate-200 text-sm font-semibold')} />
              <BudgetInWords value={profileDetails.budget} country={profileDetails.country_of_residence} />
              <FieldError field="budget" />
            </label>
            <label className="block">
              <span className={fieldLabelClass}>{t('ps.owner.landArea')}{requiredFields.has('land_area') && <RequiredMark />}</span>
              <input type="number" min="1" value={profileDetails.land_area} onChange={(event) => updateProfileField('land_area', event.target.value)} placeholder="1200" className={fieldInputClass('land_area', 'mt-1.5 h-10 w-full border-slate-200 text-sm font-semibold')} />
              <FieldError field="land_area" />
            </label>
            <label className="block md:col-span-2 lg:col-span-1">
              <span className={fieldLabelClass}>{t('ps.owner.floors')}{requiredFields.has('floors') && <RequiredMark />}</span>
              {/* The same canonical options the estimate calculator offers, and
                  the same control the two fields above already use. The code is
                  what the user picked; the numeric `floors` beside it is derived
                  in CompleteProfilePage so existing consumers are unaffected. */}
              <select value={profileDetails.floor_type || ''} onChange={(event) => updateProfileField('floor_type', event.target.value)} className={fieldInputClass('floors', 'mt-1.5 h-10 w-full border-slate-200 text-sm font-semibold')}>
                <option value="">{t('cps.selectField', { label: t('ps.owner.floors') })}</option>
                {floorOptionsForCountry(profileDetails.country_of_residence).map((option) => (
                  <option key={option.value} value={option.value}>{floorTypeLabel(option.value)}</option>
                ))}
              </select>
              <FieldError field="floors" />
            </label>
          </div>
        </section>
      )}
    </div>
  )
}
