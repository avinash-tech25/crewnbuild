import SiteLayout from '../components/SiteLayout.jsx'
import PageHero from '../components/site/PageHero.jsx'
import ProcessSection from '../components/site/ProcessSection.jsx'
import FaqSection from '../components/site/FaqSection.jsx'
import CTASection from '../components/site/CTASection.jsx'
import { IMG } from '../components/site/data.js'
import { useLanguage } from '../../../i18n/LanguageContext.jsx'

export default function Process() {
  const { t } = useLanguage()
  return (
    <SiteLayout>
      <PageHero
        eyebrow={t('site.process.hero.eyebrow')}
        title={t('site.process.hero.title')}
        highlight={t('site.process.hero.highlight')}
        sub={t('site.process.hero.sub')}
        image={IMG.planning}
      />
      <ProcessSection />
      <FaqSection />
      <CTASection />
    </SiteLayout>
  )
}
