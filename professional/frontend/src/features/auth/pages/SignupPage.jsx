/**
 * Registration screen.
 *
 * The presentation is the landing design (AuthShell split layout, the
 * sprite-sheet role picker, oc-* palette).
 *
 * Where the API turns the WhatsApp check on (Indian deployments), registration is
 * phone-first: one page with Full Name, Joining As, the +91 mobile number, its
 * WhatsApp code, and Create Account. No e-mail and no password: the account
 * signs in later with a WhatsApp code to the same number, and the e-mail is added
 * and verified in Profile Settings. The API creates the account only with the
 * one-time token the WhatsApp check returned for exactly that number, and the
 * reply already carries the session, so the new account is signed in at once.
 *
 * Everywhere else registration is what it was: name, e-mail, role and a verified
 * password, with the e-mail code checked by the API (PasswordVerification), plus
 * an optional phone number with its country. Only the API's own answer picks
 * that form: while it has not answered, neither form is shown (usePhoneConfig).
 *
 * Either way, address and pincode are collected later: a new account goes from
 * here to the pincode step and then straight to its dashboard, and Complete
 * Profile opens only when an action first needs it. A new supplier chooses a
 * Supplier Category first (SupplierCategoryPage).
 */
import { useEffect, useRef, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowRight, ClipboardCheck, Loader2, Mail, UserRound } from 'lucide-react'
import { AuthField, AuthRolePicker, AuthShell } from '../components/AuthShell.jsx'
import { RequiredMark } from '../../accounts/components/ProfileCompletionMeter.jsx'
import { buttonClass, signupVideoUrl } from '../../public-site/components/landing/shared.jsx'
import { PasswordVerification } from '../components/PasswordVerification.jsx'
import { PhoneConfigWait } from '../components/PhoneConfigWait.jsx'
import { PhoneVerification } from '../components/PhoneVerification.jsx'
import { usePhoneConfig } from '../../../shared/hooks/usePhoneConfig.js'
import { isValidPhoneForCountry, postSignupPath } from '../../../shared/auth/accountPaths.js'
import { signupWithProfile } from '../../../shared/auth/authSlice.js'
import { useLanguage } from '../../../i18n/LanguageContext.jsx'
import { signupRoleFromLink } from '../signupRole.js'
import { LegalDialog } from '../../legal/components/LegalDialog.jsx'
import { LEGAL_DOCUMENTS, legalAcceptanceFields } from '../../legal/legalDocuments.js'

// The roles a visitor can register as. A /signup?role= link preselects one of them
// (signupRole.signupRoleFromLink: the landing key or the role code).
const SIGNUP_ROLES = [
  { apiRole: 'OWNER', labelKey: 'role.owner', image: '/landing/roles/home.png' },
  { apiRole: 'BUILDER', labelKey: 'role.contractor', image: '/landing/roles/builder.png' },
  { apiRole: 'ENGINEER', labelKey: 'role.engineerSignup', image: '/landing/roles/engineer.png' },
  { apiRole: 'SUPPLIER', labelKey: 'role.supplier', image: '/landing/roles/supplier.png' },
]

export default function SignupPage() {
  const { t, translateMessage } = useLanguage()
  const [searchParams] = useSearchParams()
  const inviteCode = (searchParams.get('invite') || '').trim().toUpperCase()
  const linkRole = signupRoleFromLink(searchParams.get('role'))
  const [selectedApiRole, setSelectedApiRole] = useState(linkRole)
  useEffect(() => { setSelectedApiRole(linkRole) }, [linkRole])
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [emailVerified, setEmailVerified] = useState(false)
  // Whether this deployment asks for a WhatsApp-verified +91 number (and then
  // signs up phone-first). Unknown until the API answers, so neither form is
  // shown before then rather than one flashing into the other.
  const { config: phoneConfig, unreachable, retry } = usePhoneConfig()
  const [phone, setPhone] = useState('')
  const [phoneCountry, setPhoneCountry] = useState('India')
  const [phoneToken, setPhoneToken] = useState(null)
  // One required consent: the Terms accepted and the Privacy Policy read.
  const [consented, setConsented] = useState(false)
  // 'terms' | 'privacy' while that document is open over the form (null: closed).
  // Reading it accepts nothing; only the checkbox does.
  const [openDocument, setOpenDocument] = useState(null)
  const [signupAlert, setSignupAlert] = useState('')
  // One account per click: set before the request leaves, cleared only if it fails.
  const submitting = useRef(false)
  const dispatch = useDispatch()
  const navigate = useNavigate()
  const { status, errorMessage } = useSelector((state) => state.auth)

  const phoneFirst = phoneConfig?.enabled === true
  const nameValid = name.trim().length >= 2
  const phoneFirstReady = nameValid && Boolean(selectedApiRole) && Boolean(phoneToken)

  const validateSignupForm = () => {
    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!nameValid) return t('validation.name')
    if (phoneFirst) {
      if (!selectedApiRole) return t('signup.needRole')
      if (!phoneToken) return t('signup.phone.verifyFirst')
      if (!consented) return t('validation.terms')
      return ''
    }
    if (!emailPattern.test(email.trim())) return t('validation.email')
    if (phone && !isValidPhoneForCountry(phone, phoneCountry)) {
      return t('validation.phone')
    }
    if (!emailVerified) return t('signup.flow.verifyFirst')
    if (!consented) return t('validation.terms')
    return ''
  }

  const submitSignup = (event) => {
    event.preventDefault()
    if (submitting.current || status === 'loading') return
    const validationMessage = validateSignupForm()
    if (validationMessage) {
      setSignupAlert(validationMessage)
      return
    }
    createAccount()
  }

  const createAccount = async () => {
    if (submitting.current || status === 'loading') return

    // Address and pincode (and a phone left blank here) are collected on the
    // Complete Profile screen, which is reached later — only when an action
    // actually needs them — rather than immediately after signing up.
    const role = selectedApiRole
    const roleDefaults = {
      role,
      building_type: 'RESIDENTIAL',
      construction_type: 'CONTRACTOR',
      budget: 0,
      land_area: 0,
      floors: 1,
      company_name: name.trim(),
      license_number: '',
      experience_years: 0,
      store_name: name.trim(),
      categories: '',
      // The consent box was ticked (validateSignupForm): accept_terms and the
      // versions of the Terms and Privacy Policy accepted.
      ...legalAcceptanceFields(),
    }
    const details = phoneFirst
      // The verified number and its token, nothing else to identify the account:
      // the API checks the token belongs to exactly this number.
      ? { name: name.trim(), ...roleDefaults, phone, phone_verification_token: phoneToken }
      : {
          name: name.trim(),
          email: email.trim().toLowerCase(),
          password,
          ...roleDefaults,
          // An optional number goes with its country, which the API validates it
          // against and records as the account's country of residence.
          ...(phone ? { phone, country_of_residence: phoneCountry } : {}),
        }

    submitting.current = true
    const result = await dispatch(signupWithProfile(details))
    if (!result.payload?.user) {
      submitting.current = false
      setSignupAlert(translateMessage(result.payload || errorMessage) || t('validation.signupFailed'))
      return
    }
    if (role === 'ENGINEER' && inviteCode) {
      try {
        window.localStorage.setItem('crewnbuild_pending_invite', inviteCode)
      } catch {
        /* noop */
      }
    }
    // Signed in already: the sign-up reply carried the session. The same landing
    // decision as login and OAuth: a new account has no pincode yet, so it goes
    // to the pincode step and from there to its role's dashboard. A new supplier
    // chooses a Supplier Category before that.
    navigate(postSignupPath(result.payload.user))
  }

  const alertMessage = signupAlert || (errorMessage ? translateMessage(errorMessage) : '')
  const alertOffersSignIn = [signupAlert, errorMessage].some((message) => {
    const text = String(message || '').toLowerCase()
    return text.includes('already registered') || text.includes('already in use')
  }) || signupAlert === t('error.emailRegistered')

  const nameField = (
    <AuthField
      label={t('signup.fullName')}
      icon={UserRound}
      type="text"
      placeholder={t('signup.namePlaceholder')}
      value={name}
      onChange={(value) => { setName(value); setSignupAlert('') }}
      autoComplete="name"
      required
    />
  )

  const roleFields = (
    <>
      <AuthRolePicker
        label={phoneFirst ? t('signup.joiningAs') : t('signup.joinAs')}
        value={selectedApiRole}
        onChange={(value) => { setSelectedApiRole(value); setSignupAlert('') }}
        options={SIGNUP_ROLES.map((role) => ({ key: role.apiRole, title: t(role.labelKey), image: role.image }))}
        required
      />
      {inviteCode && selectedApiRole === 'ENGINEER' && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-ocbrand-100 bg-ocbrand-50 px-4 py-2.5">
          <div>
            <p className="text-[10px] font-extrabold uppercase tracking-wide text-oc-green rtl:tracking-normal">Invitation Code</p>
            <p className="font-mono text-sm font-extrabold tracking-wider text-oc-deep">{inviteCode}</p>
          </div>
          <ClipboardCheck size={18} className="shrink-0 text-oc-green" />
        </div>
      )}
    </>
  )

  // "I agree to the {terms} and {privacy}.": the two names open the documents over
  // the form. They are buttons inside the checkbox's label, so a click on them is
  // kept from ticking it.
  const documentButton = (key, labelKey) => (
    <button
      key={key}
      type="button"
      onClick={(event) => { event.preventDefault(); event.stopPropagation(); setOpenDocument(key) }}
      className="inline p-0 font-extrabold text-oc-green underline underline-offset-2 hover:text-oc-deep"
    >
      {t(labelKey)}
    </button>
  )
  // "I agree to the {terms} and I have read the {privacy}": each name opens its document in
  // a window (which never ticks the box); only the box itself records the consent.
  const consentText = t('signup.termsConsent').split(/(\{terms\}|\{privacy\})/).map((piece) => {
    if (piece === '{terms}') return documentButton('terms', 'signup.consent.termsLink')
    if (piece === '{privacy}') return documentButton('privacy', 'site.footer.link.privacy')
    return piece
  })

  const termsField = (
    <label className="mt-1 flex items-start gap-2 text-[11px] font-semibold leading-[1.6] text-oc-muted">
      <input
        type="checkbox"
        checked={consented}
        required
        aria-required="true"
        onChange={(event) => { setConsented(event.target.checked); setSignupAlert('') }}
        className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded border-oc-line accent-oc-green"
      />
      <span>{consentText}<RequiredMark /></span>
    </label>
  )

  const alertBox = alertMessage && (
    <div role="alert" className="rounded-xl border border-warm/30 bg-warm/10 px-3 py-2 text-[11px] font-bold text-warm">
      {alertMessage}
      {alertOffersSignIn && (
        <Link to="/login" className="mt-1.5 block w-fit font-extrabold underline underline-offset-2">
          {t('signup.accountExists')}
        </Link>
      )}
    </div>
  )

  const submitClass = `${buttonClass} mt-1 w-full disabled:opacity-45 disabled:hover:translate-y-0 disabled:hover:bg-oc-green`

  return (
    <>
    {openDocument && <LegalDialog doc={LEGAL_DOCUMENTS[openDocument]} onClose={() => setOpenDocument(null)} />}
    <div>
    <AuthShell
      eyebrow={t('signup.eyebrow')}
      headline={t('signup.start')}
      highlight={t('signup.highlight')}
      aside={t('auth.aside.signup')}
      videoUrl={signupVideoUrl}
      videoScrimOpacity={0.55}
    >
      {!phoneConfig ? (
        <PhoneConfigWait unreachable={unreachable} onRetry={retry} />
      ) : phoneFirst ? (
        // Phone-first: one column, in this order, nothing hidden behind steps.
        <form className="mt-4 flex flex-col gap-[11px]" onSubmit={submitSignup} noValidate>
          {nameField}
          {roleFields}
          <PhoneVerification
            phone={phone}
            onPhoneChange={(value) => { setPhone(value); setSignupAlert('') }}
            onVerifiedChange={setPhoneToken}
            verificationRequired
            showCountry={false}
            label={t('signup.mobileNumber')}
          />
          {termsField}
          {alertBox}
          <button type="submit" disabled={status === 'loading' || !phoneFirstReady || !consented} className={submitClass}>
            {status === 'loading' ? t('signup.loading') : t('signup.createAccount')}
            {status === 'loading'
              ? <Loader2 size={16} className="animate-spin" />
              : <ArrowRight size={16} className="rtl:-scale-x-100" />}
          </button>
        </form>
      ) : (
        /* The old intro line told the visitor to pick a role "first"; the role
           picker now sits below name and e-mail, and the picker carries its own
           label, so the line was both wrong and spending height the form needs. */
        <form className="mt-4 flex flex-col gap-[9px]" onSubmit={submitSignup}>
          {nameField}

          <AuthField
            label={t('signup.email')}
            icon={Mail}
            type="email"
            placeholder={t('login.emailPlaceholder')}
            value={email}
            onChange={(value) => { setEmail(value); setSignupAlert('') }}
            autoComplete="email"
            required
          />

          <PhoneVerification
            phone={phone}
            onPhoneChange={(value) => { setPhone(value); setSignupAlert('') }}
            onVerifiedChange={setPhoneToken}
            country={phoneCountry}
            onCountryChange={(value) => { setPhoneCountry(value); setSignupAlert('') }}
            verificationRequired={false}
          />

          {roleFields}

          <PasswordVerification
            email={email}
            password={password}
            onPasswordChange={(value) => { setPassword(value); setSignupAlert('') }}
            onVerifiedChange={setEmailVerified}
          />

          {/* Final step: the terms and the Create Account button appear only once
              the e-mail code has been verified, so the earlier steps never show
              them. */}
          {emailVerified && termsField}

          {alertBox}

          {emailVerified && (
            <button
              type="submit"
              disabled={status === 'loading' || !consented}
              className={submitClass}
            >
              {status === 'loading' ? t('signup.loading') : t('signup.submit')}
              <ArrowRight size={16} className="rtl:-scale-x-100" />
            </button>
          )}
        </form>
      )}

      <p className="mt-3 text-xs text-oc-muted">
        {t('signup.already')}{' '}
        <Link to="/login" className="font-extrabold text-oc-green transition-colors duration-200 hover:text-oc-deep">
          {phoneConfig?.enabled === false ? t('signup.signin') : t('signup.signinPlain')}
        </Link>
      </p>
    </AuthShell>
    </div>
    </>
  )
}
