import SiteLayout from '../components/SiteLayout.jsx'
import PageHero from '../components/site/PageHero.jsx'
import ProjectsSection from '../components/site/ProjectsSection.jsx'
import StatsSection from '../components/site/StatsSection.jsx'
import CTASection from '../components/site/CTASection.jsx'
import { IMG } from '../components/site/data.js'
import { useLanguage } from '../../../i18n/LanguageContext.jsx'

export default function Projects() {
  const { t } = useLanguage()
  return (
    <SiteLayout>
      <PageHero
        eyebrow={t('site.projects.hero.eyebrow')}
        title={t('site.projects.hero.title')}
        highlight={t('site.projects.hero.highlight')}
        sub={t('site.projects.hero.sub')}
        image={IMG.cranes}
      />
      <ProjectsSection />
      <StatsSection />
      <CTASection />
    </SiteLayout>
  )
}
