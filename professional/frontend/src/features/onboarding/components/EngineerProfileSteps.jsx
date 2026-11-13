import { Award, ClipboardCheck, GraduationCap, Phone, UserRound } from 'lucide-react'
import ProfileImageHint from '../../../shared/ui/ProfileImageHint.jsx'
import { PROFILE_IMAGE_ACCEPT } from '../../../shared/utils/profileImageRules.js'
import PincodeAreaHint from '../../../shared/ui/PincodeAreaHint.jsx'
import CountryOfResidenceField from './CountryField.jsx'
import { RequiredMark, requiredProfileFields } from '../../accounts/components/ProfileCompletionMeter.jsx'
import { imageUrl } from '../../../shared/api/apiClient.js'
import { useLanguage } from '../../../i18n/LanguageContext.jsx'
import { ENGINEER_CATEGORY_LABEL_KEYS, engineerCategoryChoices } from '../profileConstants.js'
import { optionLabel } from '../../../i18n/optionKeys.js'

const compactInput = 'h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-900 outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-100'
const fieldLabelClass = 'block text-[11px] font-extrabold uppercase tracking-wide text-slate-600'

export default function EngineerProfileSteps({ form, formTopRef }) {
  const { t } = useLanguage()
  const {
    user, profileDetails, updateProfileField,
    FieldError, pincodeLookupState, profileImagePreview, uploadProfileImage, uploadMessage, setUploadMessage,
    selectedPincodeBranch = null, selectPincodeBranch,
  } = form
  // The account's own required-field list (User.profile_completion_fields on
  // the server), so a mandatory field shows its * before Submit is pressed.
  const requiredFields = requiredProfileFields(user)
  const req = (field) => requiredFields.has(field) && <RequiredMark />
  const categoryChoices = engineerCategoryChoices(user?.engineer_profile?.specialization, profileDetails.specialization)
  return (
    <div ref={formTopRef} className="mx-auto max-w-3xl scroll-mt-4 space-y-4">
      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_14px_40px_-30px_rgba(15,23,42,0.35)] sm:p-5">
        <div className="flex items-center gap-3 border-b border-slate-100 pb-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-700">
            <ClipboardCheck className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <h2 className="font-display text-base font-extrabold leading-tight text-slate-950">{t('ps.eng.title')}</h2>
            <p className="truncate text-[11px] font-medium text-slate-500">{t('ps.eng.subtitle')}</p>
          </div>
        </div>

        <div className="mt-4">
          <p className={fieldLabelClass}>{t('ps.eng.profilePhoto')}</p>
          <div className="mt-2 flex flex-col gap-4 rounded-xl border border-dashed border-slate-300 bg-slate-50/50 p-4 sm:flex-row sm:items-center">
            <span className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-full border border-slate-200 bg-slate-100 text-xs font-extrabold text-slate-400 shadow-sm">
              {(profileImagePreview || user?.profile_image_url) ? (
                <img src={(profileImagePreview || user.profile_image_url).startsWith('blob:') ? profileImagePreview : imageUrl(profileImagePreview || user.profile_image_url)} alt="" className="h-full w-full object-cover" />
              ) : '👷'}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-extrabold text-slate-950">{t('ps.eng.addPhoto')}</p>
              <p className="mt-0.5 text-xs font-medium text-slate-500">{t('ps.eng.photoHint')}</p>
              <ProfileImageHint className="mt-0.5" />
              <div className="mt-2.5 flex flex-wrap gap-2">
                <label className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-md bg-brand-500 px-4 text-xs font-extrabold text-brand-950 transition hover:bg-brand-400">
                  {t('ps.eng.uploadPhoto')}
                  {/* uploadProfileImage takes the File, not the change event, and
                      the upload types are the ones the API accepts. */}
                  <input
                    type="file"
                    accept={PROFILE_IMAGE_ACCEPT}
                    onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; uploadProfileImage(file).catch((error) => setUploadMessage(error.userMessage || error.response?.data?.detail || t('ps.uploadFailed'))) }}
                    className="sr-only"
                  />
                </label>
              </div>
            </div>
          </div>
          {uploadMessage && <p className="mt-2 text-xs font-bold text-brand-700">{uploadMessage}</p>}
        </div>

        <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="block">
            <span className={fieldLabelClass}>{t('ps.fullName')}{req('name')}</span>
            <span className="mt-1.5 flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3">
              <UserRound className="h-4 w-4 shrink-0 text-brand-600" />
              <input className="h-10 w-full bg-transparent text-sm font-semibold text-slate-900 outline-none" value={profileDetails.name || ''} onChange={(event) => updateProfileField('name', event.target.value)} placeholder={t('ps.fullNamePlaceholder')} />
            </span>
            <FieldError field="name" />
          </label>
          <label className="block">
            <span className={fieldLabelClass}>{t('ps.phoneShort')}{req('phone')}</span>
            <span className="mt-1.5 flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3">
              <Phone className="h-4 w-4 shrink-0 text-brand-600" />
              <input className="h-10 w-full bg-transparent text-sm font-semibold text-slate-900 outline-none" value={profileDetails.phone || ''} onChange={(event) => updateProfileField('phone', event.target.value.replace(/\D/g, '').slice(-10))} placeholder="9876543210" />
            </span>
            <FieldError field="phone" />
          </label>
          <CountryOfResidenceField form={form} />
          <label className="block">
            <span className={fieldLabelClass}>{t('ps.pincode')}{req('pincode')}</span>
            <input className={`mt-1.5 ${compactInput}`} value={profileDetails.pincode || ''} onChange={(event) => updateProfileField('pincode', event.target.value.replace(/\D/g, '').slice(-6))} placeholder="500001" />
            <FieldError field="pincode" />
          </label>
          {/* Every branch under the pincode; the one picked becomes Location. */}
          <div className="sm:col-span-2 empty:hidden">
            <PincodeAreaHint lookupState={pincodeLookupState} selectedBranch={selectedPincodeBranch} onSelectBranch={selectPincodeBranch} />
          </div>
          <label className="block">
            <span className={fieldLabelClass}>{t('ps.location')}{req('location')}</span>
            <input className={`mt-1.5 ${compactInput}`} value={profileDetails.location || ''} onChange={(event) => updateProfileField('location', event.target.value)} placeholder={t('ps.locationPlaceholder')} />
            <FieldError field="location" />
          </label>
          <label className="block">
            <span className={fieldLabelClass}>{t('ps.address')}{req('address')}</span>
            <input className={`mt-1.5 ${compactInput}`} value={profileDetails.address || ''} onChange={(event) => updateProfileField('address', event.target.value)} placeholder={t('ps.addressPlaceholder')} />
            <FieldError field="address" />
          </label>
          <label className="block">
            <span className={fieldLabelClass}>{t('ps.eng.experience')}</span>
            <span className="mt-1.5 flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3">
              <Award className="h-4 w-4 shrink-0 text-brand-600" />
              <input className="h-10 w-full bg-transparent text-sm font-semibold text-slate-900 outline-none" type="number" min="0" value={profileDetails.experience_years ?? 0} onChange={(event) => updateProfileField('experience_years', event.target.value)} placeholder="5" />
            </span>
            <FieldError field="experience_years" />
          </label>
          <label className="block">
            <span className={fieldLabelClass}>{t('ps.eng.qualification')}{req('qualification')}</span>
            <span className="mt-1.5 flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3">
              <GraduationCap className="h-4 w-4 shrink-0 text-brand-600" />
              <input className="h-10 w-full bg-transparent text-sm font-semibold text-slate-900 outline-none" value={profileDetails.qualification || ''} onChange={(event) => updateProfileField('qualification', event.target.value)} placeholder={t('ps.eng.qualificationPlaceholder')} />
            </span>
            <FieldError field="qualification" />
          </label>
          <label className="block">
            <span className={fieldLabelClass}>{t('profile.engineerCategory')}{req('specialization')}</span>
            {/* Stored in the existing engineer_profiles.specialization column.
                A value saved before this list existed is kept as an extra option
                so opening the form never silently rewrites it. */}
            <select className={`mt-1.5 ${compactInput}`} value={profileDetails.specialization || ''} onChange={(event) => updateProfileField('specialization', event.target.value)}>
              <option value="">{t('profile.engineerCategorySelect')}</option>
              {categoryChoices.map((category) => (
                <option key={category} value={category}>{optionLabel(t, ENGINEER_CATEGORY_LABEL_KEYS, category)}</option>
              ))}
            </select>
            <FieldError field="specialization" />
          </label>
          <label className="block">
            <span className={fieldLabelClass}>{t('ps.eng.license')}</span>
            <input className={`mt-1.5 ${compactInput}`} value={profileDetails.license_number || ''} onChange={(event) => updateProfileField('license_number', event.target.value)} placeholder={t('ps.optional')} />
          </label>
        </div>
        <label className="mt-3 block">
          <span className={fieldLabelClass}>{t('ps.eng.about')}</span>
          <textarea className={`mt-1.5 min-h-20 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900 outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-100`} value={profileDetails.about || ''} onChange={(event) => updateProfileField('about', event.target.value)} placeholder={t('ps.eng.aboutPlaceholder')} />
        </label>
      </section>
    </div>
  )
}
