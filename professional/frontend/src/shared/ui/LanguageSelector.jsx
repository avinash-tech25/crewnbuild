import { Globe } from 'lucide-react'
import { useLanguage } from '../../i18n/LanguageContext.jsx'

export default function LanguageSelector({ compact = false, variant = 'dark' }) {
  const { language, setLanguage, languages, t } = useLanguage()
  const light = variant === 'light'

  const containerClass = light
    ? 'border-slate-200 bg-white text-graphite hover:border-brand-300 hover:bg-brand-50/60 focus-within:border-brand-400 focus-within:ring-2 focus-within:ring-brand-100'
    : 'border-white/50 bg-slate-950/40 text-white hover:border-white/70 hover:bg-slate-900/60 focus-within:border-white/80 focus-within:ring-2 focus-within:ring-brand-400/60'

  return (
    <label className={`group relative inline-flex items-center rounded-full border font-semibold backdrop-blur transition ${containerClass} ${compact ? 'h-9 gap-1.5 px-2 text-[12px]' : 'h-11 gap-2.5 px-3 text-sm'}`}>
      <span aria-hidden="true" className={`relative grid shrink-0 place-items-center ${compact ? 'h-4 w-4' : 'h-5 w-5'}`}>
        <Globe className={`h-full w-full ${light ? 'text-brand-700' : 'text-white'}`} strokeWidth={2.25} />
      </span>
      <span className="sr-only">{t('language.label')}</span>
      <select
        value={language}
        onChange={(event) => setLanguage(event.target.value)}
        aria-label={t('language.label')}
        className={`cursor-pointer appearance-none bg-transparent font-semibold outline-none [&_option]:text-graphite ${light ? 'text-graphite' : 'text-white'} ${compact ? 'max-w-20 pr-4' : 'max-w-32 pr-5'}`}
      >
        {languages.map(({ code, name }) => <option key={code} value={code}>{name}</option>)}
      </select>
      <span className={`pointer-events-none absolute top-1/2 -translate-y-1/2 text-[9px] ${light ? 'text-graphite/50' : 'text-white/70'} ${compact ? 'right-2.5' : 'right-3'}`}>▼</span>
    </label>
  )
}
