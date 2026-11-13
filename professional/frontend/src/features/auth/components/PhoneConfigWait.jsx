import { Loader2 } from 'lucide-react'
import { useLanguage } from '../../../i18n/LanguageContext.jsx'

// Shown in place of a form until the API has said which form this deployment uses.
export function PhoneConfigWait({ unreachable, onRetry }) {
  const { t } = useLanguage()
  if (!unreachable) {
    return (
      <p role="status" aria-label="Loading" className="mt-6 flex justify-center text-oc-muted">
        <Loader2 size={18} className="animate-spin" />
      </p>
    )
  }
  return (
    <div role="status" data-config-unavailable className="mt-6 flex flex-col items-center gap-2 text-center text-xs font-semibold leading-[1.6] text-oc-muted">
      <Loader2 size={18} className="animate-spin" />
      <p>{t('auth.serverWaiting')}</p>
      <button type="button" onClick={onRetry} className="font-extrabold text-oc-green transition-colors duration-200 hover:text-oc-deep">
        {t('auth.serverRetry')}
      </button>
    </div>
  )
}
