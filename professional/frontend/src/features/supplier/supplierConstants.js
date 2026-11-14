import { Building2, ClipboardList, Construction, HardHat, LayoutGrid, Package, ShoppingBag, Truck, UserSearch, Wrench } from 'lucide-react'

// `labelKey` is the only label: the dashboard resolves it through `t` before
// rendering, so an English `label` beside it was dead copy that could only ever
// disagree with the key.
// `bareIcon`: the icons without their small box, the same style as the other
// dashboards' navigation (see SidebarNavItem in DashboardShell).
export const baseNav = [
  { id: 'requests', labelKey: 'shop.dashboard', icon: LayoutGrid, bareIcon: true },
  { id: 'myProjects', labelKey: 'ui.myProjects', icon: Building2, bareIcon: true },
  { id: 'findClients', labelKey: 'ui.findClients', icon: UserSearch, bareIcon: true },
  // Incoming and outgoing partnership requests, grouped by who the other party
  // is. The id is not 'requests' because that one already belongs to the
  // Dashboard entry above.
  { id: 'incomingRequests', labelKey: 'ui.requests', icon: ClipboardList, bareIcon: true },
  { id: 'products', labelKey: 'ui.products', icon: Package, bareIcon: true },
  { id: 'orders', labelKey: 'shop.orders', icon: ShoppingBag, bareIcon: true },
]

// A Labor Supplier's navigation (supplier_category "Labor Supplier"). The
// shared entries keep baseNav's ids, so their screens and addresses are the
// same; the Material catalogue (Products, Orders) is replaced by the labor
// screens. baseNav itself is untouched and still serves every other supplier.
export const laborNav = [
  ...baseNav.filter((item) => ['requests', 'myProjects', 'findClients', 'incomingRequests'].includes(item.id)),
  { id: 'laborServices', labelKey: 'labor.services.title', icon: Wrench, bareIcon: true },
  { id: 'laborAssignments', labelKey: 'labor.nav.assignments', icon: HardHat, bareIcon: true },
]

// An Equipment Supplier's navigation (supplier_category "Equipment Supplier"),
// built the same way: baseNav's shared entries, then the equipment screens in
// place of the Material catalogue.
export const equipmentNav = [
  ...baseNav.filter((item) => ['requests', 'myProjects', 'findClients', 'incomingRequests'].includes(item.id)),
  { id: 'equipmentInventory', labelKey: 'equipment.inventory.title', icon: Construction, bareIcon: true },
  { id: 'equipmentAssignments', labelKey: 'labor.nav.assignments', icon: Truck, bareIcon: true },
]

export const defaultProjectImage = 'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=900&q=80'
export const supplierDocumentTypes = [
  'Shop License',
  'GST Certificate',
  'PAN Card',
  'Trade License',
  'Material Quality Certificate',
  'Insurance Certificate',
]
// Display keys for the stored unit values. The value stays as it is (it is what
// the API stores); only the label a user reads is translated.
export const UNIT_LABEL_KEYS = {
  bag: 'ui.supplier.unitBag',
  kg: 'ui.supplier.unitKg',
  piece: 'ui.supplier.unitPiece',
  ton: 'ui.supplier.unitTon',
  litre: 'ui.supplier.unitLitre',
  'cubic foot': 'sup.unit.cubicFoot',
  'cubic metre': 'sup.unit.cubicMetre',
}
