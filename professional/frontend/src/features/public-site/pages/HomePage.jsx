/**
 * Public landing page.
 *
 * This is the landing design, ported from the reference frontend. The
 * composition below mirrors that project's Home screen exactly — same sections,
 * same order, same props, same hero rotation interval. The section components in
 * ./components/landing are verbatim copies; only the palette class names
 * were renamed onto the `oc-*` namespace (identical colour values) so the
 * dashboard palette is not shadowed.
 *
 * The wrapper carries the page background, text colour and Manrope face that the
 * reference set on `body`, scoped here so no other screen is affected.
 */
import { useEffect, useState } from 'react'
import { roleMeta } from '../components/landing/content.js'
import { useLanguage } from '../components/landing/useLanguage.js'
import { SiteHeader } from '../components/landing/SiteHeader.jsx'
import { HeroBackdrop, HeroContent } from '../components/landing/HeroSection.jsx'
import { SolutionBridge, SolutionPanel } from '../components/landing/SolutionPanel.jsx'
import { RolesSection } from '../components/landing/RolesSection.jsx'
import { HowItWorksSection } from '../components/landing/HowItWorksSection.jsx'
import { PlatformSection } from '../components/landing/PlatformSection.jsx'
import { WorldSection } from '../components/landing/WorldSection.jsx'
import { SiteFooter } from '../components/landing/SiteFooter.jsx'
import AdSlot from '../../../shared/ui/AdSlot.jsx'
import PlansSection from '../../billing/subscription/PlansSection.jsx'

const HERO_ROTATION_MS = 5200

export default function Home() {
  const { language, setLanguage, text, isArabic } = useLanguage()
  const [heroRole, setHeroRole] = useState(0)
  const [activeRole, setActiveRole] = useState(1)

  useEffect(() => {
    const timer = window.setInterval(() => {
      setHeroRole((current) => (current + 1) % roleMeta.length)
    }, HERO_ROTATION_MS)
    return () => window.clearInterval(timer)
  }, [])

  // Arriving from another page at /#roles, /#how, /#world or /#plans (the
  // header's section links on Contact Us and the other pages): the browser looks
  // for the section before this page has rendered it, so it stayed at the top.
  // Scroll once the section exists, then once more after late content (the plans)
  // settles -- unless the visitor has already scrolled on their own.
  useEffect(() => {
    const id = decodeURIComponent(window.location.hash.slice(1))
    if (!id) return undefined
    let landedAt = null
    const land = () => {
      const target = document.getElementById(id)
      if (!target) return
      // Instant: the page's smooth scrolling was cut short over this distance
      // while sections above were still loading.
      target.scrollIntoView({ block: 'start', behavior: 'instant' })
      landedAt = window.scrollY
    }
    const first = window.setTimeout(land, 50)
    const settle = window.setTimeout(() => { if (landedAt === null || window.scrollY === landedAt) land() }, 900)
    return () => { window.clearTimeout(first); window.clearTimeout(settle) }
  }, [])

  return (
    <div className="overflow-x-clip bg-oc-paper font-display text-oc-ink" id="top">
      <SiteHeader text={text} />

      <main>
        {/* A banner above the hero, for an advert placed at the top of this
            page. Nothing renders when none is. */}
        <AdSlot placement="home" position="top" className="mx-auto w-full max-w-5xl px-4 pt-4" />
        <section aria-labelledby="hero-title">
          <HeroBackdrop isArabic={isArabic}>
            <HeroContent text={text} activeIndex={heroRole} onSelect={setHeroRole} />
            <SolutionBridge text={text} />
            <SolutionPanel text={text} />
          </HeroBackdrop>
        </section>

        <RolesSection text={text} isArabic={isArabic} activeIndex={activeRole} onSelect={setActiveRole} />
        <HowItWorksSection text={text} isArabic={isArabic} />
        <PlatformSection text={text} isArabic={isArabic} />
        {/* Builder plans (#plans), linked from the header's View Plans. */}
        <PlansSection />
        <WorldSection text={text} isArabic={isArabic} />
        {/* Renders nothing at all when no advert is running here. */}
        <AdSlot placement="home" position="footer" className="mx-auto w-full max-w-5xl px-4 pb-10" />
      </main>

      <SiteFooter text={text} language={language} onSelectLanguage={setLanguage} />
    </div>
  )
}
