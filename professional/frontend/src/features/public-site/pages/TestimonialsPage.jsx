import SiteLayout from '../components/SiteLayout.jsx'
import PageHero from '../components/site/PageHero.jsx'
import TestimonialsSection from '../components/site/TestimonialsSection.jsx'
import StatsSection from '../components/site/StatsSection.jsx'
import CTASection from '../components/site/CTASection.jsx'
import { IMG } from '../components/site/data.js'
import { useLanguage } from '../../../i18n/LanguageContext.jsx'

export default function Testimonials() {
  const { t } = useLanguage()
  return (
    <SiteLayout>
      <PageHero
        eyebrow={t('site.testi.hero.eyebrow')}
        title={t('site.testi.hero.title')}
        highlight={t('site.testi.hero.highlight')}
        sub={t('site.testi.hero.sub')}
        image={IMG.heroEngineer}
      />
      <TestimonialsSection />
      <StatsSection />
      <CTASection />
    </SiteLayout>
  )
}
