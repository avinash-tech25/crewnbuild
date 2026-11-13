import { useLanguage } from '../../i18n/LanguageContext.jsx'
import { PROFILE_IMAGE_MAX_MB } from '../utils/profileImageRules.js'

/** "JPG, PNG or WebP · Max 10 MB", shown under every profile image upload. */
export default function ProfileImageHint({ className = '' }) {
  const { t } = useLanguage()
  return (
    <p className={`text-[11px] font-semibold text-slate-500 ${className}`}>
      {t('ui.profileImage.hint', { mb: PROFILE_IMAGE_MAX_MB })}
    </p>
  )
}
