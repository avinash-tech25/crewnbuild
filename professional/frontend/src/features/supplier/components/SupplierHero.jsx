import DashboardHero from '../../../shared/dashboard/DashboardHero.jsx'
import HeroConstructionScene from '../../../shared/dashboard/HeroConstructionScene.jsx'
import { avatarFromPath } from '../../../shared/ui/avatars.js'
import { useLanguage } from '../../../i18n/LanguageContext.jsx'

export function SupplierDashboardHero({ user, profile, productCount = 0, subtitle }) {
  const { t } = useLanguage()
  const profileName = profile?.store_name || user?.name || t('role.supplier')
  // The store logo has always led here, because this banner is the shop's
  // own front. Behind it the shared rule applies: the supplier's uploaded
  // picture, then the Supplier default.
  const profileImage = profile?.store_logo_url || user?.profileImageUrl || ''
  return (
    <DashboardHero
      avatar={{ image: avatarFromPath(profileImage, 'SUPPLIER'), name: profileName.slice(0, 2).toUpperCase() }}
      title={t('dash.supplier.hero.welcome', { name: `, ${user?.name || profileName}` })}
      // A Labor or Equipment Supplier passes its own line; every other supplier keeps the default.
      subtitle={subtitle || t('dash.supplier.hero.sub')}
      illustration={<HeroConstructionScene className="h-full w-full" />}
      // The House Owner's banner treatment, shared by all four dashboards,
      // with the owner's grey-to-green shading and dark green edge.
      variant="cream"
      tint="mist"
      extra={productCount === 0 && (
        <div className="mt-2.5 max-w-2xl rounded-xl border border-brand-200 bg-brand-50 px-4 py-2 text-xs font-bold leading-5 text-brand-900">
          {t('dash.supplier.hero.noProducts', { name: user?.name || profileName })}
        </div>
      )}
    />
  )
}
