/**
 * Password recovery screen.
 *
 * Presentation is the landing design (AuthShell split layout, oc-* palette)
 * and the flow is the reference one: prove the address with a six digit code, then set
 * a new password. The code is issued and checked by the API, so reaching the save step
 * means the address really did receive the e-mail.
 *
 * The character art follows the state — locked out while the code is still being
 * proven, out of the way during the password steps, celebrating once it is saved.
 */
import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ArrowRight, Mail, ShieldCheck } from 'lucide-react'
import { AuthField, AuthShell } from '../components/AuthShell.jsx'
import { buttonClass, lockedOutUrl, resetDoneUrl } from '../../public-site/components/landing/shared.jsx'
import { PasswordReset } from '../components/PasswordReset.jsx'
import { resetPassword } from '../passwordResetApi.js'
import { useLanguage } from '../../../i18n/LanguageContext.jsx'

// Opened from the development recovery page (?from=recovery), the way back is
// that page: the normal sign-in has no password form to use the new password in.
function useSignInPath() {
  const [searchParams] = useSearchParams()
  return searchParams.get('from') === 'recovery' ? '/account-recovery' : '/login'
}

function ResetSaved() {
  const { t } = useLanguage()
  const signInPath = useSignInPath()
  return (
    <div className="mt-5">
      <p className="flex items-center gap-2 rounded-xl border border-oc-green/40 bg-oc-mint/60 px-3 py-3 text-xs font-extrabold text-oc-green">
        <ShieldCheck size={16} />
        {t('reset.savedTitle')}
      </p>
      <p className="mt-2 text-xs leading-[1.7] text-oc-muted">{t('reset.savedBody')}</p>
      <Link to={signInPath} className={`${buttonClass} mt-4 w-full`}>{t('reset.signIn')}</Link>
    </div>
  )
}

export default function ForgotPasswordPage() {
  const { t } = useLanguage()
  const signInPath = useSignInPath()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [codeVerified, setCodeVerified] = useState(false)
  const [passwordReady, setPasswordReady] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')

  const handleSubmit = async (event) => {
    event.preventDefault()
    if (!passwordReady) return
    setSaving(true)
    setErrorMessage('')
    try {
      await resetPassword(email.trim().toLowerCase(), password)
      setSaved(true)
    } catch (error) {
      const detail = error?.response?.data?.detail
      setErrorMessage(typeof detail === 'string' ? detail : t('reset.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  // Locked out while the code is still being proven, celebrating once the password is
  // saved, and out of the way during the steps in between.
  const character = saved ? resetDoneUrl : codeVerified ? undefined : lockedOutUrl

  const shellProps = {
    eyebrow: t('reset.eyebrow'),
    headline: t('reset.headline'),
    highlight: t('reset.highlight'),
    aside: t('auth.aside.reset'),
    character,
  }

  if (saved) {
    return (
      <AuthShell {...shellProps}>
        <ResetSaved />
      </AuthShell>
    )
  }

  return (
    <AuthShell {...shellProps}>
      <form className="mt-5 flex flex-col gap-[9px]" onSubmit={handleSubmit}>
        <AuthField
          label={t('reset.emailLabel')}
          icon={Mail}
          type="email"
          placeholder={t('reset.emailPlaceholder')}
          value={email}
          onChange={(value) => { setEmail(value); setErrorMessage('') }}
          autoComplete="email"
          locked={codeVerified}
        />

        <PasswordReset
          email={email}
          onCodeVerified={setCodeVerified}
          onPasswordReady={setPasswordReady}
          onPasswordChange={setPassword}
        />

        {errorMessage && (
          <div role="alert" className="rounded-xl border border-warm/30 bg-warm/10 px-3 py-2 text-[11px] font-bold text-warm">
            {errorMessage}
          </div>
        )}

        <button
          type="submit"
          disabled={!passwordReady || saving}
          className={`${buttonClass} mt-1 w-full disabled:opacity-45 disabled:hover:translate-y-0 disabled:hover:bg-oc-green`}
        >
          {saving ? t('reset.saving') : t('reset.submit')}
          <ArrowRight size={16} className="rtl:-scale-x-100" />
        </button>
      </form>

      <p className="mt-3 text-xs text-oc-muted">
        {t('reset.remembered')}{' '}
        <Link to={signInPath} className="font-extrabold text-oc-green transition-colors duration-200 hover:text-oc-deep">
          {t('reset.signIn')}
        </Link>
      </p>
    </AuthShell>
  )
}
