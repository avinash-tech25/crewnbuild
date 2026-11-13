/**
 * Development-only account recovery.
 *
 * Normal sign-in is a WhatsApp code to the account's registered number. An
 * account whose number is missing or wrong (the administrators have none) cannot
 * receive that code, so on a development server -- and only there -- this
 * separate page offers the existing e-mail + password sign-in and the existing
 * e-mail password reset. Nothing here is new authentication: the same /auth/login
 * and the same reset, unchanged. The API says whether the page is on
 * (DEV_ACCOUNT_RECOVERY_ENABLED on an ENVIRONMENT=development server); otherwise
 * the page shows that recovery is unavailable and offers the normal sign-in.
 *
 * After signing in, a marketplace account goes to its Profile Settings with the
 * Mobile number section open: a new number is saved only once it passes the
 * WhatsApp check. Administrators go to the admin area, as password sign-in did.
 */
import { useEffect, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowRight, Eye, EyeOff, Loader2, Lock, Mail, ShieldAlert } from 'lucide-react'
import { AuthField, AuthShell } from '../components/AuthShell.jsx'
import { buttonClass, siteMonitorUrl } from '../../public-site/components/landing/shared.jsx'
import { ADMIN_ROLES } from '../../../shared/auth/roles.js'
import { accountSettingsPath } from '../../../shared/auth/accountPaths.js'
import { readAccountRecoveryConfig } from '../authApi.js'
import { loginWithCredentials, logoutUser } from '../../../shared/auth/authSlice.js'
import { useLanguage } from '../../../i18n/LanguageContext.jsx'

// Read once by the Mobile number section, which then opens itself.
export const RECOVERY_PHONE_PROMPT_KEY = 'crewnbuild_recovery_phone_prompt'

export default function AccountRecoveryPage() {
  const { t, translateMessage } = useLanguage()
  const dispatch = useDispatch()
  const navigate = useNavigate()
  const { status, errorMessage } = useSelector((state) => state.auth)
  const [enabled, setEnabled] = useState(null)
  const [credentials, setCredentials] = useState({ email: '', password: '' })
  const [showPassword, setShowPassword] = useState(false)

  useEffect(() => {
    // Opening a sign-in page is an explicit account switch.
    dispatch(logoutUser())
  }, [dispatch])

  useEffect(() => {
    let active = true
    readAccountRecoveryConfig()
      .then((config) => { if (active) setEnabled(config?.enabled === true) })
      .catch(() => { if (active) setEnabled(false) })
    return () => { active = false }
  }, [])

  const submitRecovery = async (event) => {
    event.preventDefault()
    if (status === 'loading') return
    const result = await dispatch(loginWithCredentials(credentials))
    const user = result.payload?.user
    if (!user) return
    if (ADMIN_ROLES.includes(user.role)) {
      navigate('/admin', { replace: true })
      return
    }
    try {
      window.sessionStorage.setItem(RECOVERY_PHONE_PROMPT_KEY, '1')
    } catch {
      /* the section simply starts closed */
    }
    navigate(accountSettingsPath(user), { replace: true })
  }

  return (
    <AuthShell
      eyebrow={t('recovery.eyebrow')}
      headline={t('recovery.headline')}
      highlight={t('recovery.highlight')}
      aside={t('auth.aside.login')}
      character={siteMonitorUrl}
    >
      {enabled === null ? (
        <p role="status" aria-label="Loading" className="mt-6 flex justify-center text-oc-muted">
          <Loader2 size={18} className="animate-spin" />
        </p>
      ) : !enabled ? (
        <div className="mt-5">
          <p role="alert" className="rounded-xl border border-oc-line bg-oc-sunken px-3 py-3 text-xs font-bold text-oc-muted">
            {t('recovery.unavailable')}
          </p>
          <Link to="/login" className={`${buttonClass} mt-4 w-full`}>{t('reset.signIn')}</Link>
        </div>
      ) : (
        <>
          <p className="mt-3 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-[11px] font-bold leading-[1.6] text-amber-900">
            <ShieldAlert size={15} className="mt-0.5 shrink-0" />
            {t('recovery.notice')}
          </p>

          <form className="mt-4 flex flex-col gap-[9px]" onSubmit={submitRecovery}>
            <AuthField
              label={t('login.email')}
              icon={Mail}
              type="text"
              placeholder={t('login.emailPlaceholder')}
              value={credentials.email}
              onChange={(value) => setCredentials({ ...credentials, email: value })}
              autoComplete="email"
            />
            <AuthField
              label={t('login.password')}
              icon={Lock}
              type={showPassword ? 'text' : 'password'}
              placeholder={t('login.passwordPlaceholder')}
              value={credentials.password}
              onChange={(value) => setCredentials({ ...credentials, password: value })}
              autoComplete="current-password"
              protectClipboard
              trailing={
                <button
                  type="button"
                  onClick={() => setShowPassword((current) => !current)}
                  aria-label={showPassword ? t('shared.hidePassword') : t('shared.showPassword')}
                  className="absolute end-3 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-lg text-oc-muted transition-colors duration-200 hover:bg-oc-mint hover:text-oc-green"
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              }
            />
            <div className="flex justify-end text-[11px]">
              <Link to="/forgot-password?from=recovery" className="font-extrabold text-oc-green transition-colors duration-200 hover:text-oc-deep">
                {t('login.forgot')}
              </Link>
            </div>
            <button type="submit" disabled={status === 'loading'} className={`${buttonClass} mt-1 w-full disabled:opacity-45 disabled:hover:translate-y-0 disabled:hover:bg-oc-green`}>
              {status === 'loading' ? t('login.loading') : t('recovery.submit')}
              <ArrowRight size={16} className="rtl:-scale-x-100" />
            </button>
            {errorMessage && (
              <p role="alert" className="rounded-xl border border-warm/30 bg-warm/10 px-3 py-2 text-[11px] font-bold text-warm">
                {translateMessage(errorMessage)}
              </p>
            )}
          </form>

          <p className="mt-3 text-xs text-oc-muted">
            <Link to="/login" className="font-extrabold text-oc-green transition-colors duration-200 hover:text-oc-deep">
              {t('recovery.backToWhatsApp')}
            </Link>
          </p>
        </>
      )}
    </AuthShell>
  )
}
