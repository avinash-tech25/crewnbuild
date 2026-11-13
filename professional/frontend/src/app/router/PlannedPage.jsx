/**
 * A page of the old app that is not in this one yet (R7 moves it in parts). Its address
 * already answers, behind the same access rules it will have, so links and bookmarks keep
 * working; this says plainly what is coming instead of an empty screen.
 */
import { ArrowLeft } from 'lucide-react'
import { Link, useLocation } from 'react-router-dom'
import { Brand, buttonClass, underDevelopmentUrl } from '../../features/public-site/components/landing/shared.jsx'
import LanguageSelector from '../../shared/ui/LanguageSelector.jsx'

export default function PlannedPage({ title, part }) {
  const { pathname } = useLocation()
  return (
    <div className="flex min-h-svh flex-col bg-oc-paper px-[8%] py-5 text-oc-ink max-wide:px-6" data-testid="planned-page">
      <div className="flex flex-wrap items-center justify-between gap-3 gap-y-2">
        <Brand />
        <span className="ms-auto">
          <LanguageSelector compact variant="light" />
        </span>
      </div>
      <div className="mx-auto my-auto flex w-full max-w-[560px] flex-col items-center py-8 text-center">
        <img src={underDevelopmentUrl} alt="" aria-hidden="true" className="max-h-[32svh] w-auto object-contain" />
        <span className="text-[11px] font-extrabold uppercase tracking-[.22em] text-oc-muted">Coming in part {part}</span>
        <h1 className="mt-3 font-display text-3xl font-extrabold">{title}</h1>
        <p className="mt-3 text-oc-muted">
          This page is being moved to the new CREWNBUILD app. It will be back here, at the same address, with the same
          screens as before.
        </p>
        <code className="mt-4 rounded-full bg-white px-4 py-1.5 text-xs text-oc-muted shadow-sm">{pathname}</code>
        <Link to="/" className={`${buttonClass} mt-6`}>
          <ArrowLeft className="h-4 w-4" /> Home
        </Link>
      </div>
    </div>
  )
}
