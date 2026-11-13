/**
 * Shared split layout for the public authentication screens.
 *
 * Visual design adapted from the landing reference: a paper-coloured
 * form column beside a photo/video panel carrying the wordmark. Purely
 * presentational — every screen keeps its own submit handler, API calls and
 * navigation, so nothing here touches application state.
 *
 * Colour tokens are the `oc-*` landing palette already declared in
 * tailwind.config.js, so the dashboard palette (brand-*, forest-*, slate-* …)
 * is never shadowed.
 */
import { useEffect, useRef } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowLeft, Check } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Brand, RoleCharacter, brandBadgeClass, townUrl } from '../../public-site/components/landing/shared.jsx'
import LanguageSelector from '../../../shared/ui/LanguageSelector.jsx'
import { useLanguage } from '../../../i18n/LanguageContext.jsx'
import { RequiredMark } from '../../accounts/components/ProfileCompletionMeter.jsx'
import PublicWeatherIndicator from '../../weather/components/PublicWeatherIndicator.jsx'

const scrim =
  'linear-gradient(180deg, rgba(6,45,31,.72) 0%, rgba(6,45,31,.55) 45%, rgba(6,45,31,.8) 100%)'

export const controlClass =
  'w-full min-h-[46px] rounded-xl bg-white border border-oc-line text-sm text-oc-ink ' +
  'transition-[border-color,box-shadow] duration-200 ' +
  'focus:outline-none focus:border-oc-green focus:shadow-[0_0_0_4px_rgba(18,107,69,.12)]'

export const labelClass =
  'block mb-1.5 text-[11px] font-extrabold uppercase tracking-[.12em] text-oc-deep rtl:tracking-normal'

export function AuthField({
  label,
  icon: Icon,
  type = 'text',
  placeholder,
  value,
  onChange,
  autoComplete,
  locked,
  inputMode,
  maxLength,
  trailing,
  hint,
  protectClipboard = false,
  // Marks the label with the application's required "*" from the start, so a
  // mandatory field is known before Next or Submit is pressed.
  required = false,
}) {
  // Password fields refuse copy, cut and paste. `protectClipboard` keeps that
  // in force when a password is temporarily revealed as plain text.
  const clipboardGuard = protectClipboard || type === 'password'
    ? {
        onCopy: (event) => event.preventDefault(),
        onCut: (event) => event.preventDefault(),
        onPaste: (event) => event.preventDefault(),
      }
    : {}
  return (
    <label className="block">
      <span className={labelClass}>{label}{required && <RequiredMark />}</span>
      <span className="relative block">
        {Icon && <Icon size={17} className="absolute start-4 top-1/2 -translate-y-1/2 text-oc-green" />}
        <input
          {...clipboardGuard}
          className={`${controlClass} ${Icon ? 'ps-[46px]' : 'ps-4'} ${trailing ? 'pe-12' : 'pe-4'} placeholder:text-oc-muted/70 disabled:bg-oc-mint/40 disabled:text-oc-muted`}
          type={type}
          placeholder={placeholder}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          autoComplete={autoComplete}
          inputMode={inputMode}
          maxLength={maxLength}
          disabled={locked}
        />
        {trailing}
      </span>
      {hint}
    </label>
  )
}

/**
 * Role picker built from the landing sprite sheet rather than a dropdown. Takes the
 * same `roleMeta` crops the landing page uses, so the characters stay in proportion.
 */
export function AuthRolePicker({ label, value, onChange, options, locked, required = false }) {
  return (
    <fieldset className="m-0 block border-0 p-0">
      <legend className={labelClass}>{label}{required && <RequiredMark />}</legend>
      {/* Four equal square-style cards: the role's own illustration, centred at
          a size where the figure reads (it was drawn ~15-35px wide inside a 44px
          circle), with its name underneath. The chosen card is green-bordered on
          mint with a small tick; the top padding leaves room for that tick. */}
      <div className="grid grid-cols-4 gap-2.5 pt-1.5">
        {options.map((option) => {
          const selected = value === option.key
          return (
            <button
              type="button"
              key={option.key}
              onClick={() => onChange(option.key)}
              disabled={locked}
              aria-pressed={selected}
              className={`group relative flex min-h-[92px] min-w-0 flex-col items-center justify-center gap-1 rounded-xl border-2 px-1 pb-1.5 pt-2 ease-soft
                          transition-[border-color,background,box-shadow,transform] duration-300
                          ${selected
                            ? 'border-oc-green bg-oc-mint shadow-[0_7px_16px_rgba(18,107,69,.22)]'
                            : `border-oc-line bg-white ${locked ? '' : 'group-hover:border-oc-green/40 hover:border-oc-green/40 hover:-translate-y-[2px]'}`}
                          ${locked && !selected ? 'opacity-40' : ''}`}
            >
              {selected && (
                <span aria-hidden="true" className="absolute -end-2 -top-2 grid h-5 w-5 place-items-center rounded-full bg-oc-green text-white shadow-sm">
                  <Check size={12} strokeWidth={3} />
                </span>
              )}
              <span className="flex h-[58px] w-full items-center justify-center">
                <RoleCharacter image={option.image} className="!h-[58px] max-w-full" />
              </span>
              <span
                className={`max-w-full text-center text-[11px] font-extrabold leading-tight transition-colors duration-200 ${selected ? 'text-oc-green' : 'text-oc-muted'}`}
              >
                {option.title}
              </span>
            </button>
          )
        })}
      </div>
    </fieldset>
  )
}

// Fills the panel with a looping video when one is given, otherwise the construction photo.
function AuthPanelBackdrop({ videoUrl }) {
  if (!videoUrl) {
    return (
      <div
        className="absolute inset-0 bg-cover bg-center"
        style={{ backgroundImage: `${scrim}, url(${townUrl})` }}
      />
    )
  }
  return <AuthPanelVideo videoUrl={videoUrl} />
}

function AuthPanelVideo({ videoUrl }) {
  const videoRef = useRef(null)

  // React sets `muted` as a property but not as an attribute, and browsers only allow
  // autoplay on a muted video — so mute it here and start it explicitly.
  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    video.muted = true
    video.play().catch(() => {
      // Autoplay refused; the poster frame still shows behind the scrim.
    })
  }, [videoUrl])

  return (
    <>
      <video
        ref={videoRef}
        className="absolute inset-0 h-full w-full object-cover"
        src={videoUrl}
        poster={townUrl}
        autoPlay
        muted
        loop
        playsInline
        preload="auto"
        aria-hidden="true"
      />
      <div className="absolute inset-0" style={{ background: scrim }} />
    </>
  )
}

/**
 * A character standing on the panel, above the wordmark. Swapping the picture crossfades
 * it, so a page can change the character as the visitor moves through a flow.
 */
function AuthPanelCharacter({ url }) {
  return (
    <div className="absolute inset-x-0 top-[5%] bottom-[27%] flex items-center justify-center px-10">
      <AnimatePresence mode="wait">
        {url && (
          <motion.img
            key={url}
            src={url}
            alt=""
            aria-hidden="true"
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -18 }}
            transition={{ duration: 0.35, ease: [0.23, 1, 0.32, 1] }}
            className="max-h-full max-w-[62%] object-contain drop-shadow-[0_26px_44px_rgba(4,26,18,.55)]"
          />
        )}
      </AnimatePresence>
    </div>
  )
}

export function AuthShell({ eyebrow, headline, highlight, aside, videoUrl, character, children }) {
  const { t } = useLanguage()

  return (
    <div className="grid h-svh grid-cols-[1.05fr_1fr] overflow-hidden bg-oc-paper text-oc-ink max-mid:grid-cols-1">
      <div className="flex flex-col overflow-y-auto px-[8%] py-4 max-wide:px-6 max-wide:py-5">
        {/* On the smallest phones the logo scales down as it does in the landing
            header, and the row may wrap (language under the logo) rather than
            the language pill sitting on top of the wordmark at 320px. */}
        <div className="flex flex-wrap items-center justify-between gap-3 gap-y-2">
          <span className="max-[380px]:[&_img]:h-[44px] max-[380px]:[&_img]:w-[71px]">
            <Brand logoOnly />
          </span>
          {/* The weather indicator sits beside the language selector, as in the
              landing header. */}
          <span className="ms-auto flex items-center gap-2">
            <PublicWeatherIndicator />
            <LanguageSelector compact variant="light" />
          </span>
        </div>

        {/* Auto margins centre this when there is room and collapse when there is not —
            unlike justify-center, which lets tall content spill up over the brand row. */}
        <div className="mx-auto my-auto flex w-full max-w-[420px] flex-col py-6">
          {eyebrow && (
            <div className="flex items-center gap-[9px] text-[10px] font-extrabold uppercase tracking-[.14em] text-oc-green rtl:tracking-normal">
              <span className="h-2 w-2 rounded-full bg-oc-amber shadow-[0_0_0_5px_rgba(244,183,64,.14)]" />
              {eyebrow}
            </div>
          )}

          <h1 className="mt-2 text-[clamp(1.8rem,2.9vw,2.3rem)] font-extrabold leading-[1.05] tracking-[-.05em] rtl:leading-[1.3] rtl:tracking-normal">
            {headline}
            {highlight && (
              <>
                <br />
                <span className="text-oc-green">{highlight}</span>
              </>
            )}
          </h1>

          {children}
        </div>

        <Link
          className="inline-flex items-center gap-2 text-[11px] font-extrabold text-oc-muted transition-colors duration-200 hover:text-oc-green"
          to="/"
        >
          <ArrowLeft size={14} className="rtl:-scale-x-100" />
          {t('shared.backHome')}
        </Link>
      </div>

      <div className="relative overflow-hidden max-mid:hidden">
        <AuthPanelBackdrop videoUrl={videoUrl} />
        <AuthPanelCharacter url={character} />
        <div className="absolute inset-x-0 bottom-0 p-12 text-white">
          <span className={`${brandBadgeClass} items-center px-5 py-3`}>
            <Brand logoOnly />
          </span>
          <p className="mt-4 max-w-[320px] text-sm leading-[1.7] text-[#d6ecdd]">{aside}</p>
        </div>
      </div>
    </div>
  )
}
