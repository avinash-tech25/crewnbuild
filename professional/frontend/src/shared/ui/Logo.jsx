import { useLanguage } from '../../i18n/LanguageContext.jsx'

/**
 * "CREWNBUILD" is deliberately NOT translated, here or in the image's alt text.
 *
 * It is the product's name, and a name is the same word in every language — a
 * reader who is told about CREWNBUILD has to be able to find CREWNBUILD.
 * Machine-translating it would give a different brand per language, and the
 * wordmark beside it would not match what the text said. The tagline under it
 * IS translated (`shared.tagline`), which is the right split: the name is a
 * name, the sentence about it is copy.
 */
export default function Logo({ light = false, withTagline = true, compact = false, small = false, taglineClassName = '' }) {
  const { t } = useLanguage()
  const text = light ? 'text-white' : 'text-brand-800'
  const tag = light ? 'text-slate-300' : 'text-brand-700'
  const isSmall = small || compact
  return (
    <a href="/" className={`flex items-center select-none ${compact ? 'justify-center gap-0' : isSmall ? 'gap-2' : 'gap-2'}`} title={compact ? 'CREWNBUILD' : undefined}>
      <span className={`grid shrink-0 place-items-center ${isSmall ? 'h-12 w-[78px]' : 'h-16 w-[104px]'}`}>
        {/* Transparent C&B mark, cropped to the artwork; the box matches its
            landscape shape (about 1.62 : 1) so nothing is clipped. */}
        <img src="/crew and build logo.png" alt="CREWNBUILD" className="h-full w-full object-contain" />
      </span>
      {!compact && (
        <span className="leading-none">
          <span className={`block font-display font-extrabold tracking-tighter ${text} ${isSmall ? 'text-lg' : 'text-xl'}`}>
            CREWNBUILD
          </span>
          {withTagline && (
            <span className={`block text-[10px] font-bold tracking-[0.16em] uppercase ${tag} ${taglineClassName}`}>
              {t('shared.tagline')}
            </span>
          )}
        </span>
      )}
    </a>
  )
}
