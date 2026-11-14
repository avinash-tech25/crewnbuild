import { ChevronLeft, ChevronRight } from 'lucide-react'
import { imageUrl } from '../api/apiClient.js'
import { useLanguage } from '../../i18n/LanguageContext.jsx'

export default function PhotoViewer({ photos = [], activeIndex, onChange, onBack, title: titleProp }) {
  const { t } = useLanguage()
  const title = titleProp === undefined ? t('dash.owner.projectDetails.sitePhotos') : titleProp
  if (activeIndex == null || !photos.length) return null
  const index = Math.min(Math.max(activeIndex, 0), photos.length - 1)
  const photo = photos[index]

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/90 p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className="flex max-h-[95vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <header className="flex items-center justify-between gap-4 border-b border-slate-200 px-4 py-3">
          <button type="button" onClick={onBack} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-extrabold text-slate-800">{t('dash.common.back')}</button>
          <p className="min-w-0 truncate text-sm font-extrabold text-slate-800">{title} · {t('ui.shared.photoPosition', { current: index + 1, total: photos.length })}</p>
          <span className="w-[70px]" aria-hidden="true" />
        </header>
        <div className="relative flex min-h-0 flex-1 items-center justify-center bg-slate-950 p-3">
          <img src={imageUrl(photo.image_url)} alt={`${title} ${index + 1}`} className="max-h-[78vh] max-w-full object-contain" />
          {photos.length > 1 && (
            <>
              <button type="button" onClick={() => onChange((index - 1 + photos.length) % photos.length)} className="absolute left-4 grid h-11 w-11 place-items-center rounded-full bg-white/95 text-slate-900 shadow-lg" aria-label={t('ui.shared.previousPhoto')}><ChevronLeft className="h-6 w-6" /></button>
              <button type="button" onClick={() => onChange((index + 1) % photos.length)} className="absolute right-4 grid h-11 w-11 place-items-center rounded-full bg-white/95 text-slate-900 shadow-lg" aria-label={t('ui.shared.nextPhoto')}><ChevronRight className="h-6 w-6" /></button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
