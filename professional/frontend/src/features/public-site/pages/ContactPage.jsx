import SiteLayout from '../components/SiteLayout.jsx'
import PageHero from '../components/site/PageHero.jsx'
import ContactSection from '../components/site/ContactSection.jsx'
import FaqSection from '../components/site/FaqSection.jsx'
import { IMG } from '../components/site/data.js'
import { useLanguage } from '../../../i18n/LanguageContext.jsx'

export default function Contact() {
  const { t } = useLanguage()
  return (
    <SiteLayout>
      <PageHero
        eyebrow={t('site.contact.hero.eyebrow')}
        title={t('site.contact.hero.title')}
        highlight={t('site.contact.hero.highlight')}
        sub={t('site.contact.hero.sub')}
        image={IMG.heroEngineer}
      />
      <ContactSection />
      <FaqSection />
    </SiteLayout>
  )
}
