/**
 * Public account deletion page: /delete-account (https://crewnbuild.com/delete-account).
 *
 * Profile Settings > Delete Account opens it, the mobile app's Account Settings
 * opens it, and it is the URL given to the app stores. It works in any browser
 * on its own -- nobody needs the app:
 *
 *   signed out   the deletion policy, and sign-in right here (the site's own
 *                WhatsApp-code sign-in, or e-mail and password where the API has
 *                that turned off) -- the page stays put once signed in;
 *   signed in    the Delete Account form, the same component Profile Settings
 *                shows (components/accountDeletion/DeleteAccountForm.jsx), calling
 *                the same endpoints;
 *   deleted      a confirmation; the browser is signed out.
 *
 * The policy is shared with Profile Settings (DeletionPolicy.jsx). The support
 * email comes from the server's configuration.
 */
import { useEffect, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { Link, useNavigate } from 'react-router-dom'
import { CheckCircle2, LogIn, Mail, ShieldCheck, Trash2 } from 'lucide-react'
import { Brand } from '../../public-site/components/landing/shared.jsx'
import { fetchAccountDeletionConfig } from '../accountDeletionApi.js'
import DeleteAccountForm from '../components/DeleteAccountForm.jsx'
import DeletionPolicy from '../components/DeletionPolicy.jsx'
import { PhoneConfigWait } from '../../auth/components/PhoneConfigWait.jsx'
import { PhoneLogin } from '../../auth/components/PhoneLogin.jsx'
import { usePhoneConfig } from '../../../shared/hooks/usePhoneConfig.js'
import { loginWithCredentials, logoutUser } from '../../../shared/auth/authSlice.js'
import { ADMIN_ROLES } from '../../../shared/auth/roles.js'
import { accountSettingsPath } from '../../../shared/auth/accountPaths.js'
import { useLanguage } from '../../../i18n/LanguageContext.jsx'

function Card({ icon: Icon, title, children }) {
  return (
    <section className="rounded-2xl bg-white p-5 text-oc-ink shadow-xl sm:p-7">
      <h2 className="flex items-center gap-2.5 text-lg font-extrabold sm:text-xl">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-rose-50 text-rose-600"><Icon className="h-[18px] w-[18px]" /></span>
        {title}
      </h2>
      <div className="mt-4 space-y-4 text-sm leading-relaxed text-oc-muted">{children}</div>
    </section>
  )
}

// The site's existing sign-in, without leaving this page: the WhatsApp code where
// the API turns it on, else e-mail and password -- the same choice /login makes.
function SignIn() {
  const { t, translateMessage } = useLanguage()
  const dispatch = useDispatch()
  const { status, errorMessage } = useSelector((state) => state.auth)
  const { config: phoneConfig, unreachable, retry } = usePhoneConfig()
  const method = phoneConfig ? (phoneConfig.login === true ? 'whatsapp' : 'password') : null
  const [credentials, setCredentials] = useState({ email: '', password: '' })

  if (method === null) return <PhoneConfigWait unreachable={unreachable} onRetry={retry} />
  // Signing in puts the account in the store, and the page shows the form.
  if (method === 'whatsapp') return <PhoneLogin onSignedIn={() => {}} />

  const field = 'mt-1.5 h-10 w-full rounded-lg border border-oc-line bg-white px-3 text-sm font-semibold text-oc-ink outline-none focus:border-oc-green'
  return (
    <form
      className="space-y-3"
      onSubmit={(event) => { event.preventDefault(); dispatch(loginWithCredentials(credentials)) }}
    >
      <label className="block text-xs font-bold text-oc-ink">{t('login.email')}
        <input className={field} type="text" autoComplete="email" value={credentials.email} onChange={(event) => setCredentials({ ...credentials, email: event.target.value })} />
      </label>
      <label className="block text-xs font-bold text-oc-ink">{t('login.password')}
        <input className={field} type="password" autoComplete="current-password" value={credentials.password} onChange={(event) => setCredentials({ ...credentials, password: event.target.value })} />
      </label>
      {errorMessage && <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700">{translateMessage(errorMessage)}</p>}
      <button type="submit" disabled={status === 'loading'} className="inline-flex h-10 items-center gap-2 rounded-lg bg-oc-green px-4 text-sm font-extrabold text-white disabled:opacity-50">
        <LogIn className="h-4 w-4" />{status === 'loading' ? t('login.loading') : t('login.submit')}
      </button>
    </form>
  )
}

export default function DeleteAccountPage() {
  const dispatch = useDispatch()
  const navigate = useNavigate()
  const { user, sessionStatus } = useSelector((state) => state.auth)
  const [config, setConfig] = useState(null)
  const [deleted, setDeleted] = useState(false)

  useEffect(() => {
    document.title = 'Delete Your Crew&Build Account'
    fetchAccountDeletionConfig().then(setConfig).catch(() => setConfig({}))
  }, [])

  const supportEmail = config?.support_email
  const handleDeleted = () => {
    setDeleted(true)
    // The server has ended every session and cleared the cookies; this clears the page's copy.
    dispatch(logoutUser())
  }

  let body
  if (deleted) {
    body = (
      <Card icon={CheckCircle2} title="Your account has been deleted">
        <p role="status" className="font-semibold text-oc-ink">Your Crew&amp;Build account has been deleted and you have been signed out on every device.</p>
        <p>The records we keep, and why, are described in the deletion policy. You can close this page.</p>
        <Link to="/" className="inline-flex font-bold text-oc-green underline">Go to the Crew&amp;Build home page</Link>
      </Card>
    )
  } else if (user && sessionStatus === 'verifying') {
    body = <Card icon={Trash2} title="Delete your account"><p>Checking your sign-in…</p></Card>
  } else if (user && ADMIN_ROLES.includes(user.role)) {
    body = (
      <Card icon={Trash2} title="Delete your account">
        <p>You are signed in as an administrator. Administrator accounts cannot be deleted here.</p>
        <button type="button" onClick={() => dispatch(logoutUser())} className="font-bold text-oc-green underline">Sign out and sign in with another account</button>
      </Card>
    )
  } else if (user) {
    body = (
      <Card icon={Trash2} title="Delete your account">
        <p>
          Signed in as <strong className="text-oc-ink">{user.name}</strong>.{' '}
          <button type="button" onClick={() => dispatch(logoutUser())} className="font-bold text-oc-green underline">Not you? Sign out</button>
        </p>
        <p>Verify your registered email address, check your details, choose a reason, read the policy and confirm. Your account is permanently deleted immediately when you press Delete Account; no administrator approval is involved.</p>
        {/* Cancel goes back to the account's own Profile Settings. */}
        <DeleteAccountForm onDeleted={handleDeleted} onCancel={() => navigate(accountSettingsPath(user))} />
      </Card>
    )
  } else {
    body = (
      <>
        <Card icon={LogIn} title="Sign in to delete your account">
          <p>
            To protect your account, sign in first with your registered details. You will then see the Delete Account
            form: verify your registered email address, check your details, choose a reason and confirm. Your account is
            permanently deleted immediately after you confirm. You do not need the Crew&amp;Build app.
          </p>
          <SignIn />
        </Card>
        <Card icon={ShieldCheck} title="Account deletion policy">
          <DeletionPolicy />
        </Card>
      </>
    )
  }

  return (
    <div className="min-h-screen bg-[#071029] text-slate-200">
      <header className="border-b border-white/10">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-4 sm:px-6">
          <span className="rounded-lg bg-white px-2.5 py-1.5"><Brand href="/" logoOnly small /></span>
          <Link to="/" className="text-sm font-semibold text-slate-300 hover:text-white">Home</Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 pb-16 pt-10 sm:px-6 sm:pt-14">
        <div className="text-center">
          <h1 className="font-display text-3xl font-extrabold tracking-tight text-white sm:text-4xl">Delete Your Crew&amp;Build Account</h1>
          <p className="mx-auto mt-3 max-w-2xl text-base text-slate-400 sm:text-lg">
            Delete your account and personal data, here in your browser or in the app under Profile Settings, then Delete Account.
          </p>
        </div>

        <div className="mt-10 space-y-5">
          {body}
          <section className="rounded-2xl border border-white/10 bg-white/[0.04] p-5 text-[15px] leading-relaxed text-slate-300 sm:p-7">
            <h2 className="flex items-center gap-2.5 text-lg font-bold text-white"><Mail className="h-[18px] w-[18px] text-emerald-300" />Contact</h2>
            <p className="mt-3">
              Questions about deleting your account or your data, or cannot sign in? Write to us
              {supportEmail
                ? <> at <a href={`mailto:${supportEmail}`} className="font-semibold text-emerald-300 underline">{supportEmail}</a></>
                : ' using the contact details on our website'}
              .
            </p>
          </section>
        </div>
      </main>
    </div>
  )
}
