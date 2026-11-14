import { useNavigate } from 'react-router-dom'
import { Trash2 } from 'lucide-react'
import { useLanguage } from '../../../i18n/LanguageContext.jsx'

/**
 * Delete Account, at the foot of Profile Settings.
 *
 * One component for every role. The button opens the account deletion page,
 * /delete-account (pages/site/DeleteAccountPage.jsx): the same page the app
 * stores and the mobile app link to, where the signed-in account's details are
 * filled into the shared Delete Account form.
 */
export default function DeleteAccountSection() {
  const { t } = useLanguage()
  const navigate = useNavigate()

  return (
    <section className="rounded-2xl border border-rose-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-extrabold text-rose-600">{t('account.delete')}</h3>
          <p className="mt-0.5 text-xs font-semibold text-graphite/55">{t('account.deleteSub')}</p>
        </div>
        <button
          type="button"
          onClick={() => navigate('/delete-account')}
          className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-rose-300 bg-rose-50 px-4 text-xs font-extrabold text-rose-700 transition hover:bg-rose-100"
        >
          <Trash2 className="h-3.5 w-3.5" /> {t('account.delete')}
        </button>
      </div>
    </section>
  )
}
