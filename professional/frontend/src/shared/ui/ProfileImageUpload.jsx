import { Upload, UserRound } from 'lucide-react'
import { avatarSrc, avatarFromPath } from './avatars.js'
import { useLanguage } from '../../i18n/LanguageContext.jsx'
import ProfileImageHint from './ProfileImageHint.jsx'
import { PROFILE_IMAGE_ACCEPT } from '../utils/profileImageRules.js'

/**
 * `role` makes the empty state this person's own role avatar instead of a
 * generic outline, so the picture in settings is the one the rest of the app
 * shows for them. Callers that pass no role keep the generic outline.
 */
export default function ProfileImageUpload({ imageSource, previewSource = '', title: titleProp, note: noteProp, onUpload, className = '', role = null }) {
  const { t } = useLanguage()
  const title = titleProp === undefined ? t('ps.profileImage') : titleProp
  const note = noteProp === undefined ? t('ui.shared.uploadClearProfileImage') : noteProp
  const displaySource = previewSource || imageSource || ''
  return (
    <div className={`rounded-xl border border-slate-200 bg-white p-4 ${className}`}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        {displaySource || role ? (
          <img
            src={displaySource.startsWith('blob:') ? avatarSrc(displaySource, role) : avatarFromPath(displaySource, role)}
            alt=""
            className="h-16 w-16 shrink-0 rounded-xl object-cover ring-1 ring-slate-200"
          />
        ) : (
          /* No role given -- this slot is not a person (a company logo, say),
             so it keeps the generic outline it always had. */
          <span className="grid h-16 w-16 place-items-center rounded-xl bg-slate-50 text-forest-700 ring-1 ring-slate-200">
            <UserRound className="h-7 w-7" />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-graphite">{title}</p>
          <p className="mt-0.5 text-xs text-graphite/55">{note}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-forest-700 transition hover:border-forest-200 hover:bg-forest-50">
              <Upload className="h-4 w-4" /> {t('dash.common.upload')}
              <input type="file" accept={PROFILE_IMAGE_ACCEPT} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; onUpload?.(file) }} className="sr-only" />
            </label>
            {/* No separate camera button: it was a second file picker that
                opened the rear camera on phones and did nothing different on a
                computer. A phone's own picker already offers "Take photo". */}
          </div>
          <ProfileImageHint className="mt-1.5" />
        </div>
      </div>
    </div>
  )
}
