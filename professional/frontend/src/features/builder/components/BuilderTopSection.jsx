import { HardHat } from 'lucide-react'
import DashboardHero from '../../../shared/dashboard/DashboardHero.jsx'
import HeroConstructionScene from '../../../shared/dashboard/HeroConstructionScene.jsx'
import { avatarFromPath } from '../../../shared/ui/avatars.js'
import { useLanguage } from '../../../i18n/LanguageContext.jsx'

export function ContractorTopSection({
  userShell,
}) {
  const { t, td } = useLanguage()
  return (
    <div className="space-y-2">
      <DashboardHero
        avatar={{
          // Their own picture when they have uploaded one, the Builder
          // default when they have not.
          image: avatarFromPath(userShell.profileImageUrl, 'BUILDER'),
          name: <HardHat className="h-4 w-4" aria-label={userShell.name} />,
        }}
        title={t('dash.contractor.hero.welcome', { name: td(userShell.name) })}
        subtitle={t('dash.contractor.hero.sub')}
        illustration={<HeroConstructionScene className="h-full w-full" />}
        // The House Owner's banner treatment, shared by all four dashboards,
        // with the owner's grey-to-green shading and dark green edge.
        variant="cream"
        tint="mist"
      />
    </div>
  )
}
