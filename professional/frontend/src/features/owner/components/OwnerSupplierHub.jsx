/**
 * The House Owner's supplier area, as three tabs.
 *
 * The same shape as the Site Engineer's supplier hub — Suppliers, Orders and
 * Cart behind one sidebar entry — because it is one journey: browse, add to the
 * cart, send the buy request, then watch its status. The owner's own rules stay
 * with the owner: their supplier list is the one matching their project pincode,
 * and only they can send a supplier a partnership request.
 */
import { Boxes, PackageSearch, ShoppingBag } from 'lucide-react'
import SupplierBrowser from '../../shop/components/SupplierBrowser.jsx'
import ProductCatalogPage from '../../shop/components/ProductCatalogPage.jsx'
import CartPanel from '../../shop/components/CartPanel.jsx'
import OrdersPanel from '../../shop/components/OrdersPanel.jsx'
import OwnerMarketplace from '../../shop/components/OwnerMarketplace.jsx'
import { fetchNearbySuppliers } from '../../projects/projectsApi.js'
import { useLanguage } from '../../../i18n/LanguageContext.jsx'

export default function OwnerSupplierHub({
  projects = [],
  currentProjectId,
  pincode,
  country,
  activeTab = 'suppliers',
  onTabChange,
  requestMessage,
  sendingReceiverId,
  onSendRequest,
}) {
  const { t } = useLanguage()

  // Only show self-construction projects in the supplier project dropdown
  const selfConstructionProjects = projects.filter((project) => project.construction_type === 'SELF_CONSTRUCTION')
  // A Self Construction project's Suppliers tab is its materials marketplace:
  // local suppliers' published products, bought without a request. Any other
  // project keeps the supplier request browser below, unchanged.
  const isSelfConstruction = selfConstructionProjects.some((project) => project.id === currentProjectId)

  const tabs = [
    { id: 'suppliers', label: t('ui.suppliers'), icon: PackageSearch },
    // A Self Construction project's Suppliers tab IS its product marketplace,
    // so the separate master-catalog Product Catalog tab is not offered there.
    ...(isSelfConstruction ? [] : [{ id: 'catalog', label: t('ui.productCatalog'), icon: Boxes }]),
    { id: 'orders', label: t('shop.orders'), icon: ShoppingBag },
    // No Cart tab here. The cart belongs to the supplier being shopped from, so
    // its entry point is the button at the top right of that supplier's page.
    // The panel below still renders when that button switches to it.
  ]

  return (
    <div className="space-y-4">
      {/* Scrolls sideways rather than wrapping, so the row stays one line on a phone. */}
      <div className="flex gap-1 overflow-x-auto rounded-2xl border border-slate-200 bg-white p-1">
        {tabs.map((tab) => {
          const active = activeTab === tab.id
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onTabChange(tab.id)}
              aria-pressed={active}
              className={`inline-flex h-9 shrink-0 items-center gap-1.5 rounded-xl px-3.5 text-xs font-extrabold transition ${
                active ? 'bg-brand-700 text-white shadow-sm' : 'text-graphite/55 hover:bg-slate-50 hover:text-graphite'
              }`}
            >
              <tab.icon className="h-3.5 w-3.5" />
              {tab.label}
              {Boolean(tab.badge) && (
                <span className={`grid h-4 min-w-4 place-items-center rounded-full px-1 text-[9px] font-extrabold ${
                  active ? 'bg-white/20 text-white' : 'bg-brand-100 text-brand-800'
                }`}>
                  {tab.badge}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {(activeTab === 'suppliers' || activeTab === 'catalog') && isSelfConstruction && (
        <OwnerMarketplace
          projectId={currentProjectId}
          pincode={pincode}
          country={country}
          onOpenCart={() => onTabChange('cart')}
        />
      )}
      {activeTab === 'suppliers' && !isSelfConstruction && (
        <SupplierBrowser
          projects={selfConstructionProjects}
          loadSuppliers={() => fetchNearbySuppliers(pincode, country, currentProjectId)}
          reloadKey={`${pincode || ''}-${country || ''}`}
          activeProjectId={currentProjectId}
          onOpenCart={() => onTabChange('cart')}
          searchOnly
          hideSearch
          // Opening a supplier replaces this list with that supplier's own
          // page -- Back to Suppliers plus the live cart at the top right --
          // instead of expanding the catalogue underneath the card.
          catalogAsView
          onSendRequest={onSendRequest}
          sendingReceiverId={sendingReceiverId}
          requestMessage={requestMessage}
        />
      )}
      {activeTab === 'catalog' && !isSelfConstruction && (
        <ProductCatalogPage
          title={t('ui.productCatalog')}
          // The same supplier feed as the Suppliers tab: the project's pincode
          // and country decide who is offered, exactly as there.
          loadSuppliers={() => fetchNearbySuppliers(pincode, country, currentProjectId)}
          reloadKey={`${pincode || ''}-${country || ''}-${currentProjectId || ''}`}
          cartProjectId={currentProjectId}
          canAddToCart
          onOpenCart={() => onTabChange('cart')}
        />
      )}
      {activeTab === 'orders' && <OrdersPanel projectId={currentProjectId} />}
      {activeTab === 'cart' && <CartPanel projectId={currentProjectId} buyLabel="Buy" buyAll />}
    </div>
  )
}
