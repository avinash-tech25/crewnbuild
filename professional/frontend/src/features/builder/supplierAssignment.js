// Which of the builder's projects an Assign Supplier drawer must leave out.
//
// A project can hold several suppliers at once (Material, Labor, Equipment, or
// more than one of a kind), so for EVERY supplier category only the projects
// THIS supplier is already actively assigned to are left out; that keeps a
// duplicate from being started from the drawer. Sources: this supplier's
// `assigned_projects` from /contractors/my-suppliers, and each project's
// `assigned_suppliers` (by supplier user id). Other suppliers on a project do
// not hide it.

export const SUPPLY_SUPPLIER_CATEGORIES = ['Labor Supplier', 'Equipment Supplier']

export const isSupplySupplier = (supplier) => SUPPLY_SUPPLIER_CATEGORIES.includes(supplier?.supplier_category)

export function takenProjectIdsFor({ supplier, projectList = [], contractorSuppliers = [] }) {
  const supplierId = String(supplier?.user_id || supplier?.id || '')
  const current = contractorSuppliers.find((item) => String(item.user_id || item.id) === supplierId) || supplier

  return new Set([
    ...(current?.assigned_projects || []).map((assignment) => String(assignment.project_id)),
    ...projectList
      .filter((project) => (project.assigned_suppliers || []).some((item) => String(item.user_id) === supplierId))
      .map((project) => String(project.id)),
  ])
}

/**
 * How much of the builder's project list this supplier is on, for its card: 'none',
 * 'some' or 'all' of the `total` projects, the projects it is on (by title), and how many
 * are still open to it. The same projects the Assign drawer leaves out
 * (takenProjectIdsFor), so the card and the drawer never disagree. With no projects at
 * all the state is 'none': Assign then says there is nothing to assign yet, as before.
 */
export function assignmentCoverage({ supplier, projectList = [], contractorSuppliers = [] }) {
  const taken = takenProjectIdsFor({ supplier, projectList, contractorSuppliers })
  const onList = projectList.filter((project) => taken.has(String(project.id)))
  const total = projectList.length
  const assigned = onList.length
  const state = total === 0 || assigned === 0 ? 'none' : assigned >= total ? 'all' : 'some'
  return { state, assigned, total, remaining: total - assigned, projects: onList }
}
