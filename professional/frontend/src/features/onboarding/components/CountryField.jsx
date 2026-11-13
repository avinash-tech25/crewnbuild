/**
 * Country of Residence selector for the Complete Profile screens.
 *
 * This is the account holder's own country. It is deliberately separate from a
 * project's location country, which is chosen when a project is created.
 *
 * Collected here rather than at signup so registration stays to the minimum a
 * new account needs.
 */
import { MapPin } from 'lucide-react'
import { useLanguage } from '../../../i18n/LanguageContext.jsx'

const fieldLabelClass = 'block text-[11px] font-extrabold uppercase tracking-wide text-slate-600'

export const RESIDENCE_COUNTRIES = ['India']

// Display keys for the stored country values above.
const RESIDENCE_COUNTRY_KEYS = {
  India: 'country.india',
}

export default function CountryOfResidenceField({ form, className = '' }) {
  const { t } = useLanguage()
  const { profileDetails, updateProfileField, FieldError } = form

  return (
    <label className={`block ${className}`}>
      <span className={fieldLabelClass}>{t('signup.countryOfResidence')}</span>
      <span className="mt-1.5 flex h-10 items-center gap-2.5 rounded-lg border border-slate-200 bg-white px-3">
        <MapPin className="h-4 w-4 shrink-0 text-slate-400" />
        <select
          value={profileDetails.country_of_residence || 'India'}
          onChange={(event) => updateProfileField('country_of_residence', event.target.value)}
          className="w-full bg-transparent text-sm font-semibold text-slate-900 outline-none"
        >
          {RESIDENCE_COUNTRIES.map((country) => (
            <option key={country} value={country}>{RESIDENCE_COUNTRY_KEYS[country] ? t(RESIDENCE_COUNTRY_KEYS[country]) : country}</option>
          ))}
        </select>
      </span>
      <FieldError field="country_of_residence" />
      <span className="mt-1 block text-[11px] font-medium text-slate-500">
        {t('signup.countryOfResidenceHint')}
      </span>
    </label>
  )
}
