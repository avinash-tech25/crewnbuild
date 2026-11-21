/**
 * The engineer supplier area keeps discovery, the catalog, and the project cart together.
 * Site Engineer payment history is linked from the main dashboard navigation.
 */
import { useCallback, useEffect, useState } from 'react'
import { useSelector } from 'react-redux'
import { ArrowLeft, Boxes, ChevronRight, Construction, HardHat, PackageSearch, Search, ShoppingBag, ShoppingCart, Warehouse } from 'lucide-react'
import EngineerSuppliersSection from './EngineerSuppliersSection.jsx'
import ProductCatalogPage from '../../shop/components/ProductCatalogPage.jsx'
import EngineerOrdersPanel from './EngineerOrdersPanel.jsx'
import EngineerLaborPanel from './EngineerLaborPanel.jsx'
import EngineerEquipmentPanel from './EngineerEquipmentPanel.jsx'
import CartPanel from '../../shop/components/CartPanel.jsx'
import { selectCartCount } from '../../shop/cartSlice.js'
import { fetchShopProducts } from '../../catalog/supplierProductsApi.js'
import { useLanguage } from '../../../i18n/LanguageContext.jsx'

const joinedFirstCard = [
  '[&>*:first-child]:rounded-t-none [&>*:first-child]:border-t-0',
  '[&>*:first-child>*:first-child]:rounded-t-none [&>*:first-child>*:first-child]:border-t-0',
].join(' ')

// Which supplier type each tab belongs to.
const MATERIAL_TABS = ['suppliers', 'catalog', 'cart', 'orders']
export const supplierTypeOfTab = (tab) => {
  if (tab === 'labor') return 'labor'
  if (tab === 'equipment') return 'equipment'
  if (MATERIAL_TABS.includes(tab)) return 'material'
  return null
}

// The products of /shop/products, grouped by their supplier: the shape the
// Product Catalog reads its offers from (each supplier with its listings).
function suppliersOfProducts(products = []) {
  const bySupplier = new Map()
  for (const product of products) {
    if (!bySupplier.has(product.supplier_id)) {
      bySupplier.set(product.supplier_id, { user_id: product.supplier_id, name: product.supplier_name, store_name: product.store_name, products: [] })
    }
    bySupplier.get(product.supplier_id).products.push(product)
  }
  return [...bySupplier.values()]
}

const SUPPLIER_TYPES = [
  { id: 'material', tab: 'suppliers', icon: Warehouse, labelKey: 'dash.engineer.suppliers.type.material', subKey: 'dash.engineer.suppliers.type.materialSub', tone: 'bg-brand-50 text-brand-700 ring-brand-100' },
  { id: 'labor', tab: 'labor', icon: HardHat, labelKey: 'dash.engineer.suppliers.type.labor', subKey: 'dash.engineer.suppliers.type.laborSub', tone: 'bg-amber-50 text-amber-700 ring-amber-100' },
  { id: 'equipment', tab: 'equipment', icon: Construction, labelKey: 'dash.engineer.suppliers.type.equipment', subKey: 'dash.engineer.suppliers.type.equipmentSub', tone: 'bg-sky-50 text-sky-700 ring-sky-100' },
]

export default function EngineerSupplierHub({ projects = [], activeTab = 'home', onTabChange, hasSupplierOrders = false }) {
  const { t } = useLanguage()
  // `undefined` means the engineer has not picked a project yet, which is not
  // the same as picking the blank option (null). Until they pick, the active
  // project follows the first one loaded -- derived during render, so it is
  // right on the first paint and again when `projects` arrives after it.
  const [selectedProjectId, setSelectedProjectId] = useState(undefined)
  const effectiveProjectId = selectedProjectId === undefined ? (projects[0]?.id ?? null) : selectedProjectId
  // A supplier to open in the Suppliers tab's catalogue.
  const [supplierToOpen, setSupplierToOpen] = useState(null)
  // A Labor or Equipment supplier's card opens its own tab, not the material
  // catalogue; for Equipment the panel starts with that supplier unfolded.
  const [equipmentSupplierToOpen, setEquipmentSupplierToOpen] = useState(null)
  // The Material Suppliers search, drawn in the tab row beside Cart; the list
  // below filters on it exactly as its own search field did.
  const [materialSearch, setMaterialSearch] = useState('')
  const openSupplierTab = (tab, supplierId) => {
    if (tab === 'equipment') setEquipmentSupplierToOpen(supplierId)
    onTabChange(tab)
  }

  const cartCount = useSelector(selectCartCount)
  const supplierTypes = SUPPLIER_TYPES

  const supplierType = supplierTypeOfTab(activeTab)
  const typeInfo = supplierTypes.find((type) => type.id === supplierType)

  // What the chosen project may order (the Catalog tab): its suppliers'
  // products, or why there are none (no project chosen, no supplier assigned).
  const [shop, setShop] = useState({ projectId: undefined, reply: null, version: 0 })
  useEffect(() => {
    if (activeTab !== 'catalog') return undefined
    let live = true
    const adopt = (reply) => { if (live) setShop((current) => ({ projectId: effectiveProjectId, reply, version: current.version + 1 })) }
    fetchShopProducts(effectiveProjectId ? { project_id: effectiveProjectId } : undefined)
      .then(adopt)
      .catch(() => adopt({ products: [] }))
    return () => { live = false }
  }, [activeTab, effectiveProjectId])
  const shopReply = shop.projectId === effectiveProjectId ? shop.reply : null
  const loadProjectSuppliers = useCallback(async () => suppliersOfProducts(shopReply?.products), [shopReply])

  // ------------------------------------------------------------ landing
  if (!typeInfo) {
    return (
      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          {supplierTypes.map((type) => (
            <button
              key={type.id}
              type="button"
              onClick={() => onTabChange(type.tab)}
              className="group flex min-w-0 items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 text-start transition hover:-translate-y-0.5 hover:border-brand-200 hover:shadow-[0_14px_30px_-24px_rgba(15,23,42,0.45)] focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
            >
              <span className={`grid h-12 w-12 shrink-0 place-items-center rounded-xl ring-1 ${type.tone}`}><type.icon className="h-6 w-6" /></span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-extrabold text-graphite">{t(type.labelKey)}</span>
                <span className="mt-0.5 block text-xs font-semibold leading-snug text-graphite/55">{t(type.subKey)}</span>
              </span>
              <ChevronRight className="h-4 w-4 shrink-0 text-graphite/35 transition group-hover:translate-x-0.5 group-hover:text-brand-700 rtl:-scale-x-100" />
            </button>
          ))}
        </div>
      </section>
    )
  }

  // The open type's heading, with the way back to the three choices.
  const typeHeader = (
    <div className={`flex min-w-0 items-center gap-2 rounded-t-2xl border border-slate-200 bg-white px-3 py-2.5 ${supplierType === 'material' ? 'border-b-0' : 'border-b-slate-100'}`}>
      <button
        type="button"
        onClick={() => onTabChange('home')}
        className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 text-xs font-extrabold text-graphite/70 transition hover:bg-slate-50 hover:text-graphite"
      >
        <ArrowLeft className="h-3.5 w-3.5 rtl:-scale-x-100" /> <span className="hidden sm:inline">{t('dash.engineer.suppliers.type.allTypes')}</span>
      </button>
      <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ring-1 ${typeInfo.tone}`}><typeInfo.icon className="h-4 w-4" /></span>
      <h2 className="min-w-0 truncate font-display text-base font-extrabold text-graphite">{t(typeInfo.labelKey)}</h2>
    </div>
  )

  // ------------------------------------------------------------ Labor / Equipment
  if (supplierType !== 'material') {
    return (
      <div>
        {typeHeader}
        <div className={joinedFirstCard}>
          {supplierType === 'labor' && (
            <EngineerLaborPanel
              projects={projects}
              activeProjectId={effectiveProjectId}
              onProjectChange={setSelectedProjectId}
            />
          )}
          {supplierType === 'equipment' && (
            <EngineerEquipmentPanel
              projects={projects}
              activeProjectId={effectiveProjectId}
              onProjectChange={setSelectedProjectId}
              openSupplierOnLoad={equipmentSupplierToOpen}
            />
          )}
        </div>
      </div>
    )
  }

  // ------------------------------------------------------------ Material
  const tabs = [
    { id: 'suppliers', label: t('ui.suppliers'), icon: PackageSearch },
    { id: 'catalog', label: t('ui.productCatalog'), icon: Boxes },
    { id: 'cart', label: t('shop.cart'), icon: ShoppingCart, badge: cartCount },
    ...(!hasSupplierOrders ? [{ id: 'orders', label: t('shop.orders'), icon: ShoppingBag }] : []),
  ]
  // Why the chosen project has nothing to order, in place of the Catalog.
  const catalogNotice = shopReply?.needs_project ? t('dash.engineer.suppliers.selectProject')
    : shopReply?.no_suppliers ? t('shop.engineer.noSupplier') : ''

  return (
    <div>
      {typeHeader}
      <div className="flex flex-col gap-1.5 border border-slate-200 border-b-slate-100 bg-white p-1.5 sm:flex-row sm:items-center">
      <div className="flex min-w-0 flex-wrap gap-1.5">
        {tabs.map((tab) => {
          const active = activeTab === tab.id
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onTabChange(tab.id)}
              aria-pressed={active}
              className={`inline-flex h-10 shrink-0 items-center gap-1.5 rounded-xl px-2 text-xs sm:gap-2 sm:px-4 font-extrabold transition ${
                active ? 'bg-brand-700 text-white shadow-sm' : 'text-graphite/55 hover:bg-slate-50 hover:text-graphite'
              }`}
            >
              <tab.icon className="h-4 w-4" />
              {tab.label}
              {/* Always in place (hidden at 0), so a count arriving never moves the tabs. */}
              {tab.badge !== undefined && (
                <span aria-hidden={tab.badge ? undefined : 'true'} className={`grid h-5 min-w-5 place-items-center rounded-full px-1.5 text-[10px] font-extrabold tabular-nums ${
                  active ? 'bg-white/20 text-white' : 'bg-brand-100 text-brand-800'
                } ${tab.badge ? '' : 'invisible'}`}>
                  {tab.badge || 0}
                </span>
              )}
            </button>
          )
        })}
      </div>
        {/* The project used by the catalog and cart. */}
        {projects.length > 1 && (
          <label className="block w-full sm:w-64 sm:shrink-0">
            <span className="sr-only">{t('labor.project')}</span>
            <select
              className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-800 outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
              value={effectiveProjectId ?? ''}
              onChange={(event) => setSelectedProjectId(event.target.value || null)}
            >
              {projects.map((project) => <option key={project.id} value={project.id}>{project.title}</option>)}
            </select>
          </label>
        )}
        {/* Search sits beside Cart while the supplier list is open. */}
        {activeTab === 'suppliers' && (
          <div className="relative min-w-0 sm:max-w-md sm:flex-1">
            <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              value={materialSearch}
              onChange={(event) => setMaterialSearch(event.target.value)}
              aria-label={t('dash.engineer.suppliers.searchSupplier')}
              placeholder={t('dash.engineer.suppliers.searchPlaceholder')}
              className="h-10 w-full rounded-xl border border-slate-200 bg-white pe-3 ps-9 text-sm font-semibold text-slate-800 outline-none transition placeholder:font-medium placeholder:text-slate-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
            />
          </div>
        )}
      </div>

      {/* Each tab's first white card loses its top corners and top border so
          it joins the tab bar above. The card is the panel's root (Catalog)
          or the root's first child (Suppliers, Orders, Cart). */}
      <div className={joinedFirstCard}>
        {activeTab === 'suppliers' && (
          <EngineerSuppliersSection
            projects={projects}
            activeProjectId={effectiveProjectId}
            onProjectChange={setSelectedProjectId}
            openSupplierId={supplierToOpen}
            onSupplierOpened={() => setSupplierToOpen(null)}
            materialOnly
            onOpenCart={() => onTabChange('cart')}
            onOpenSupplierTab={openSupplierTab}
            searchValue={materialSearch}
            onSearchChange={setMaterialSearch}
          />
        )}
        {activeTab === 'catalog' && catalogNotice && (
          <section role="status" className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm font-extrabold text-rose-800">
            {catalogNotice}
          </section>
        )}
        {activeTab === 'catalog' && shopReply && !catalogNotice && (
          <ProductCatalogPage
            title={t('ui.productCatalog')}
            loadSuppliers={loadProjectSuppliers}
            reloadKey={`${effectiveProjectId || ''}-${shop.version}`}
            cartProjectId={effectiveProjectId}
            canAddToCart
            onOpenCart={() => onTabChange('cart')}
            compactHeader
          />
        )}
        {activeTab === 'cart' && (
          <CartPanel
            projectId={effectiveProjectId}
            engineerLayout
            onContinueShopping={() => onTabChange('catalog')}
            onViewSupplier={(supplierId) => { setSupplierToOpen(supplierId); onTabChange('suppliers') }}
          />
        )}
        {!hasSupplierOrders && activeTab === 'orders' && (
          <EngineerOrdersPanel projectId={effectiveProjectId} />
        )}
      </div>
    </div>
  )
}
