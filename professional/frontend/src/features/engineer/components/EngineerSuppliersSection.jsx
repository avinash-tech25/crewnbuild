/**
 * The Site Engineer's supplier browsing.
 *
 * The Material screen shows every supplier accepted by the Builder of each of
 * the engineer's projects (the accepted Builder <-> Supplier request), plus any
 * the Builder assigned to this engineer there. The other screens still show
 * only suppliers the Builder explicitly assigned through project_suppliers.
 */
import { useCallback } from 'react'
import SupplierBrowser from '../../shop/components/SupplierBrowser.jsx'
import { fetchProjectSuppliers, fetchProjectTeamSuppliers } from '../../engineers/engineersApi.js'
import { fetchProjectLaborSupplierServices, LABOR_SUPPLIER_CATEGORY } from '../../labour/labourApi.js'
import { EQUIPMENT_SUPPLIER_CATEGORY, fetchProjectEquipmentItems } from '../../equipment/equipmentApi.js'
import { useLiveVersion } from '../../../shared/hooks/useLiveRefresh.js'

// Labor and Equipment Suppliers have their own screens. Only a supplier whose
// saved category is exactly one of those two is kept off the Material screens;
// an uncategorised or Material supplier shows there exactly as before.
export const isMaterialScreenSupplier = (supplier) => (
  supplier?.supplier_category !== LABOR_SUPPLIER_CATEGORY && supplier?.supplier_category !== EQUIPMENT_SUPPLIER_CATEGORY
)

// A Labor or Equipment Supplier sells no material products, so its card shows
// what it actually offers: its active trades or equipment, read through the
// engineer's own project-scoped endpoints (only for a supplier assigned to this
// engineer on that project). `offerings` stays unset when they cannot be read.
async function withOfferings(supplier, projectId) {
  try {
    if (supplier.supplier_category === LABOR_SUPPLIER_CATEGORY) {
      const services = await fetchProjectLaborSupplierServices(projectId, supplier.user_id)
      return { ...supplier, offerings: [...new Set((services || []).map((service) => service.trade).filter(Boolean))] }
    }
    if (supplier.supplier_category === EQUIPMENT_SUPPLIER_CATEGORY) {
      const items = await fetchProjectEquipmentItems(projectId, supplier.user_id)
      return { ...supplier, offerings: [...new Set((items || []).map((item) => item.name).filter(Boolean))] }
    }
  } catch {
    // Leave the card on its default wording.
  }
  return supplier
}

// Only Builder-assigned suppliers for the engineer's projects, each once even
// when assigned to several projects. Shared by the Suppliers and Catalog tabs;
// the Suppliers tab also asks for each Labor/Equipment supplier's offerings.
// `teamSuppliers` (the Material Suppliers screen) instead reads every supplier
// accepted by each project's own Builder, so a newly accepted one shows
// without being assigned to this engineer first.
export async function fetchAssignedSuppliers(projects, { includeOfferings = false, teamSuppliers = false } = {}) {
  const allSuppliers = []
  const seenIds = new Set()
  for (const project of projects) {
    try {
      const assigned = await (teamSuppliers ? fetchProjectTeamSuppliers : fetchProjectSuppliers)(project.id)
      for (const supplier of assigned) {
        if (!seenIds.has(supplier.user_id)) {
          seenIds.add(supplier.user_id)
          allSuppliers.push(includeOfferings ? await withOfferings(supplier, project.id) : supplier)
        }
      }
    } catch {
      // Skip projects where the engineer has no access
    }
  }
  return allSuppliers
}

// `materialOnly` (opt-in) leaves out Labor and Equipment Suppliers, for the
// Suppliers hub's Material screen; `supplierCategory` (opt-in) narrows the list
// to one supplier type. 'Material Supplier' uses the same Material-screen rule
// as `materialOnly` (uncategorised suppliers stay visible). Either one hides the
// type filter. Without both the list is every assigned supplier, as before.
export default function EngineerSuppliersSection({ projects, activeProjectId = null, onProjectChange, onOpenCart, openSupplierId = null, onSupplierOpened, materialOnly = false, canBuy = true, onOpenSupplierTab, supplierCategory = null, searchValue, onSearchChange }) {
  const materialScreen = materialOnly || supplierCategory === 'Material Supplier'
  const singleType = materialScreen || Boolean(supplierCategory)
  const loadAssignedSuppliers = useCallback(async () => {
    // Offerings are only read for Labor / Equipment suppliers, so the Material
    // screen does not need them.
    const assigned = await fetchAssignedSuppliers(projects, { includeOfferings: !materialScreen, teamSuppliers: materialScreen })
    if (materialScreen) return assigned.filter(isMaterialScreenSupplier)
    if (supplierCategory) return assigned.filter((supplier) => supplier.supplier_category === supplierCategory)
    return assigned
  }, [projects, materialScreen, supplierCategory])
  // The Builder assigning or unassigning a supplier sends this engineer a live
  // hint; the list re-reads quietly.
  const liveVersion = useLiveVersion()
  // Labor and Equipment suppliers sell no material products: their card opens
  // the existing Labor / Equipment tab. Material suppliers keep the catalogue.
  const openSupplier = (supplier) => {
    const tab = { [LABOR_SUPPLIER_CATEGORY]: 'labor', [EQUIPMENT_SUPPLIER_CATEGORY]: 'equipment' }[supplier?.supplier_category]
    if (!tab || !onOpenSupplierTab) return false
    onOpenSupplierTab(tab, supplier.user_id)
    return true
  }

  return (
    <SupplierBrowser
      projects={projects}
      activeProjectId={activeProjectId}
      onProjectChange={onProjectChange}
      loadSuppliers={loadAssignedSuppliers}
      // The supplier feed is built by looping over `projects`. On a direct hit
      // to /engineer/my-supplies that list is still empty on the first render,
      // so this re-runs the load once it arrives. A string, so it is stable by
      // value across the parent's re-renders.
      reloadKey={projects.map((project) => project.id).join(',')}
      refreshKey={liveVersion}
      onOpenSupplier={openSupplier}
      onOpenCart={onOpenCart}
      canBuy={canBuy}
      warnWithoutProjects
      showSupplierTypeFilter={!singleType}
      // A caller that shows the search box itself (the hub's Material tab row)
      // hands the text in; otherwise the field stays in the list as before.
      hideSearch={searchValue !== undefined}
      searchValue={searchValue}
      onSearchChange={onSearchChange}
      // The Suppliers reference layout for the cards and type tabs.
      referenceCards
      // Search field only: no heading, project picker or category filter.
      hideHeading
      searchOnly
      // Choosing a supplier here opens their catalogue in place of this list
      // rather than unfolding it underneath. Scoping is unchanged: a supplier
      // still has to come from `loadAssignedSuppliers` above to be opened at
      // all, so only Builder-assigned suppliers are ever reachable.
      catalogAsView
      openSupplierId={openSupplierId}
      onSupplierOpened={onSupplierOpened}
    />
  )
}
