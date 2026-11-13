/**
 * Sign-in screen.
 *
 * The presentation is the landing design (AuthShell split layout, oc-*
 * palette). The e-mail and password sign-in is the existing stable
 * implementation, unchanged: the same redux actions, the same role-based
 * redirect and the same i18n keys. The page offers no Google/Microsoft sign-in.
 *
 * Where the API turns the WhatsApp check on, signing in is one form for every
 * account: the registered +91 number and its WhatsApp code (PhoneLogin). The API
 * finds the account the verified number belongs to -- users.phone for marketplace
 * accounts, admin_profiles.phone for administrators -- and its role decides the
 * dashboard. Nobody picks a role here.
 * Deployments without the check keep the e-mail and password form unchanged.
 * Only the API's own answer picks that form: while it has not answered, neither
 * form is shown (usePhoneConfig).
 */
import { useEffect, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { ArrowRight, Eye, EyeOff, Lock, Mail, ShieldCheck } from 'lucide-react'
import { AuthField, AuthShell } from '../components/AuthShell.jsx'
import { buttonClass, siteMonitorUrl } from '../../public-site/components/landing/shared.jsx'
import { ADMIN_ROLES } from '../../../shared/auth/roles.js'
import { afterSignInPath } from '../../../shared/auth/accountPaths.js'
import { PhoneConfigWait } from '../components/PhoneConfigWait.jsx'
import { PhoneLogin } from '../components/PhoneLogin.jsx'
import { usePhoneConfig } from '../../../shared/hooks/usePhoneConfig.js'
import { loginWithCredentials, logoutUser } from '../../../shared/auth/authSlice.js'
import { useLanguage } from '../../../i18n/LanguageContext.jsx'

export default function LoginPage() {
  const { t, translateMessage } = useLanguage()
  const dispatch = useDispatch()
  const navigate = useNavigate()
  const location = useLocation()
  const { status, errorMessage } = useSelector((state) => state.auth)
  const [credentials, setCredentials] = useState({ email: '', password: '' })
  const [showPassword, setShowPassword] = useState(false)
  // 'whatsapp' where the API turns the WhatsApp sign-in on, 'password' where it
  // is off; null until it answers, so neither form flashes.
  const { config: phoneConfig, unreachable, retry } = usePhoneConfig()
  const method = phoneConfig ? (phoneConfig.login === true ? 'whatsapp' : 'password') : null

  useEffect(() => {
    // Opening Login is an explicit account switch; do not retain another role's token.
    dispatch(logoutUser())
  }, [dispatch])

  // The same landing decision as signup and OAuth (postAuthPath): admins to
  // /admin, an account without a pincode to the pincode step, else the
  // dashboard. An unfinished profile is asked for later, by the action.
  // R7: a visitor sent here from a protected page goes back to it (returnTo), unless a
  // step comes first (afterSignInPath).
  const landSignedIn = (user) => {
    const destination = afterSignInPath(user, location.state?.returnTo)
    navigate(destination, ADMIN_ROLES.includes(user.role) ? { replace: true } : undefined)
  }

  const submitLogin = async (event) => {
    event.preventDefault()
    const result = await dispatch(loginWithCredentials(credentials))
    if (!result.payload?.user) return
    landSignedIn(result.payload.user)
  }

  const intro = method === 'whatsapp' ? t('login.introWhatsApp') : t('login.intro')

  const passwordForm = (
    <form className="mt-5 flex flex-col gap-[9px]" onSubmit={submitLogin}>
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
            onClick={() => setShowPassword((currentValue) => !currentValue)}
            aria-label={showPassword ? t('shared.hidePassword') : t('shared.showPassword')}
            className="absolute end-3 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-lg text-oc-muted transition-colors duration-200 hover:bg-oc-mint hover:text-oc-green"
          >
            {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        }
      />

      <div className="flex items-center justify-between text-[11px]">
        <label className="flex items-center gap-2 font-semibold text-oc-muted">
          <input type="checkbox" className="h-4 w-4 rounded border-oc-line accent-oc-green" />
          {t('login.remember')}
        </label>
        <Link to="/forgot-password" className="font-extrabold text-oc-green transition-colors duration-200 hover:text-oc-deep">
          {t('login.forgot')}
        </Link>
      </div>

      <button type="submit" disabled={status === 'loading'} className={`${buttonClass} mt-1 w-full disabled:opacity-45 disabled:hover:translate-y-0 disabled:hover:bg-oc-green`}>
        {status === 'loading' ? t('login.loading') : t('login.submit')}
        <ArrowRight size={16} className="rtl:-scale-x-100" />
      </button>

      {errorMessage && (
        <p role="alert" className="rounded-xl border border-warm/30 bg-warm/10 px-3 py-2 text-[11px] font-bold text-warm">
          {translateMessage(errorMessage)}
        </p>
      )}
    </form>
  )

  return (
    <AuthShell
      eyebrow={t('login.eyebrow')}
      headline={t('login.welcome')}
      highlight={t('login.highlight')}
      aside={t('auth.aside.login')}
      character={siteMonitorUrl}
    >
      {method && <p className="mt-3 text-xs leading-[1.7] text-oc-muted">{intro}</p>}


      {method === null ? (
        <PhoneConfigWait unreachable={unreachable} onRetry={retry} />
      ) : method === 'whatsapp' ? <PhoneLogin onSignedIn={landSignedIn} /> : passwordForm}

      <p className="mt-5 flex items-center gap-2 rounded-xl border border-oc-line bg-oc-sunken px-3 py-2.5 text-[11px] font-bold text-oc-muted">
        <ShieldCheck size={15} className="shrink-0 text-oc-green" />
        {t('shared.security')}
      </p>

      <p className="mt-3 text-xs text-oc-muted">
        {t('login.new')}{' '}
        <Link to="/signup" className="font-extrabold text-oc-green transition-colors duration-200 hover:text-oc-deep">
          {t('login.create')}
        </Link>
      </p>
    </AuthShell>
  )
}
