import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { ArrowLeft, Check, CheckCircle2, HardHat, Truck, X } from 'lucide-react'
import { useLanguage } from '../../../i18n/LanguageContext.jsx'
import { projectStatusText } from '../builderHelpers.js'
import { takenProjectIdsFor } from '../supplierAssignment.js'

export function AssignSupplierDrawer({ supplier, projectList, teamData, contractorSuppliers = [], onClose, onAssign, busy, successProject, error }) {
  const { t, td } = useLanguage()
  const [selectedProject, setSelectedProject] = useState(null)
  const [selectedEngineer, setSelectedEngineer] = useState(null)
  const supplierName = td(supplier?.store_name || supplier?.name) || t('role.supplier')
  const engineers = teamData?.active || []

  // A project can hold several suppliers at once (Material, Labor, Equipment,
  // or more than one of a kind), so only projects THIS supplier is already
  // actively assigned to are left out; that keeps a duplicate from being
  // started here. Sources: this supplier's `assigned_projects` from
  // /contractors/my-suppliers, and each project's `assigned_suppliers` (by
  // supplier user id). Other suppliers on a project do not hide it. See
  // supplierAssignment.js for the rule.
  const takenProjectIds = takenProjectIdsFor({ supplier, projectList, contractorSuppliers })
  const availableProjects = projectList.filter((project) => !takenProjectIds.has(String(project.id)))

  // Desktop: a compact dialog in the middle of the screen. Phone: the panel it
  // has always been, sliding in at full width. Only the container changes.
  const isDesktop = typeof window !== 'undefined' && window.matchMedia('(min-width: 640px)').matches

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  const handleConfirm = () => {
    if (selectedProject && selectedEngineer) {
      onAssign(selectedProject, selectedEngineer.user_id)
    }
  }

  return (
    <div className="fixed inset-0 z-[130] sm:flex sm:items-center sm:justify-center sm:p-6">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.18 }}
        className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
        onClick={onClose}
      />
      <motion.aside
        role="dialog"
        aria-modal="true"
        initial={isDesktop ? { opacity: 0, scale: 0.96 } : { x: '100%' }}
        animate={isDesktop ? { opacity: 1, scale: 1 } : { x: 0 }}
        exit={isDesktop ? { opacity: 0, scale: 0.96 } : { x: '100%' }}
        transition={isDesktop ? { duration: 0.16 } : { type: 'spring', stiffness: 340, damping: 34 }}
        className="absolute inset-y-0 right-0 flex w-full max-w-md flex-col border-l border-slate-200 bg-white shadow-2xl sm:relative sm:inset-auto sm:max-h-[85vh] sm:overflow-hidden sm:rounded-2xl sm:border"
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
          <div className="min-w-0">
            <p className="text-[10px] font-extrabold uppercase tracking-wide text-slate-400">{t('ce.assignSupplier')}</p>
            <h3 className="truncate font-display text-base font-extrabold text-slate-950">{supplierName}</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('ce.closeAssignPanel')}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          {successProject ? (
            <div className="flex flex-col items-center justify-center rounded-xl border border-emerald-200 bg-emerald-50 p-6 text-center sm:p-8">
              <span className="grid h-14 w-14 place-items-center rounded-full bg-white text-emerald-600">
                <CheckCircle2 className="h-8 w-8" />
              </span>
              <h3 className="mt-4 font-display text-xl font-extrabold text-slate-950">{t('ce.supplierAssigned')}</h3>
              <p className="mt-2 text-sm font-medium leading-relaxed text-slate-500">
                {t('ui.contractor.supplierAssignedTo', { supplier: supplierName, project: td(successProject.title) })}
              </p>
              <button
                type="button"
                onClick={onClose}
                className="mt-6 inline-flex h-10 items-center justify-center rounded-lg bg-brand-600 px-7 text-sm font-extrabold text-white transition hover:bg-brand-700"
              >
                {t('ce.done')}
              </button>
            </div>
          ) : !selectedProject ? (
            <>
              <p className="text-xs font-bold text-slate-600">{t('ui.contractor.chooseProjectToAssignSupplier', { name: supplierName })}</p>
              {availableProjects.length === 0 ? (
                <p className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-8 text-center text-sm font-semibold text-slate-400">
                  {projectList.length === 0
                    ? t('ce.noProjectsYet')
                    : t('labor.assign.allAssigned', { name: supplierName })}
                </p>
              ) : (
                <div className="space-y-2">
                  {availableProjects.map((project) => (
                    <div
                      key={project.id}
                      className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3.5 transition hover:border-brand-200 hover:bg-white"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-extrabold text-slate-950">{td(project.title)}</p>
                        <p className="text-xs font-medium text-slate-500">{t('ui.contractor.pincodeStatus', { pincode: project.pincode || '—', status: projectStatusText(project.status || 'active', t) })}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setSelectedProject(project)}
                        className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-brand-600 px-4 text-xs font-extrabold text-white transition hover:bg-brand-700"
                      >
                        {t('ce.assign')}
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={onClose}
                  className="inline-flex h-9 items-center justify-center rounded-lg border border-slate-200 bg-white px-5 text-xs font-extrabold text-slate-600 transition hover:bg-slate-50"
                >
                  {t('ce.close')}
                </button>
              </div>
            </>
          ) : !selectedEngineer ? (
            <>
              <div className="rounded-xl border border-brand-200 bg-brand-50/50 p-4">
                <p className="text-sm font-extrabold text-slate-950">{t('ui.contractor.selectEngineerFor', { project: td(selectedProject.title) })}</p>
              </div>
              {engineers.length === 0 ? (
                <p className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-8 text-center text-sm font-semibold text-slate-400">
                  {t('ce.noActiveEngineers')}
                </p>
              ) : (
                <div className="space-y-2">
                  {engineers.map((engineer) => (
                    <div
                      key={engineer.user_id}
                      className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3.5 transition hover:border-brand-200 hover:bg-white"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-extrabold text-slate-950">{td(engineer.name)}</p>
                        <p className="text-xs font-medium text-slate-500">
                          {engineer.assigned_projects?.map((p) => td(p.title)).join(', ') || t('ui.contractor.noProjectsAssigned')}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setSelectedEngineer(engineer)}
                        className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-brand-600 px-4 text-xs font-extrabold text-white transition hover:bg-brand-700"
                      >
                        {t('ce.assign')}
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <button
                type="button"
                onClick={() => setSelectedProject(null)}
                className="mt-2 inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-4 text-xs font-extrabold text-slate-600 transition hover:bg-slate-50"
              >
                <ArrowLeft className="h-3.5 w-3.5 rtl:-scale-x-100" /> {t('specialist.backToProjects')}
              </button>
            </>
          ) : (
            <>
              <div className="rounded-xl border border-brand-200 bg-brand-50/50 p-4">
                <p className="text-sm font-extrabold text-slate-950">{t('ui.contractor.assignSupplierToEngineerConfirm', { supplier: supplierName, engineer: td(selectedEngineer.name) })}</p>
                <div className="mt-3 space-y-2">
                  <p className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-3.5 py-2.5 text-sm">
                    <span className="text-slate-500">{t('se.project')}</span>
                    <span className="truncate font-extrabold text-slate-950">{td(selectedProject.title)}</span>
                  </p>
                  <p className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-3.5 py-2.5 text-sm">
                    <span className="text-slate-500">{t('role.supplier')}</span>
                    <span className="truncate font-extrabold text-slate-950">{supplierName}</span>
                  </p>
                  <p className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-3.5 py-2.5 text-sm">
                    <span className="text-slate-500">{t('role.engineer')}</span>
                    <span className="truncate font-extrabold text-slate-950">{td(selectedEngineer.name)}</span>
                  </p>
                </div>
              </div>
              {error && <p className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm font-bold text-rose-700">{error}</p>}
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setSelectedEngineer(null)}
                  disabled={busy}
                  className="inline-flex h-10 items-center justify-center rounded-lg border border-slate-200 bg-white px-5 text-sm font-extrabold text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {t('ce.cancel')}
                </button>
                <button
                  type="button"
                  onClick={handleConfirm}
                  disabled={busy}
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-brand-600 px-6 text-sm font-extrabold text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <CheckCircle2 className="h-4 w-4" /> {t('ce.confirmAssignment')}
                </button>
              </div>
            </>
          )}
        </div>
      </motion.aside>
    </div>
  )
}

export function UnassignSupplierDrawer({ supplier, onClose, onUnassign, busy, successProject, error }) {
  const { t, td } = useLanguage()
  const supplierName = td(supplier?.store_name || supplier?.name) || t('role.supplier')
  const assignedProjects = supplier?.assigned_projects || []
  // With a single assigned project there is nothing to choose, so the box
  // opens straight on the confirmation. With several, the list comes first,
  // exactly as before.
  const onlyProject = assignedProjects.length === 1 ? assignedProjects[0] : null
  const [pendingProject, setPendingProject] = useState(onlyProject)

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  return (
    // A small centred confirmation box (it used to be a panel on the right).
    <div className="fixed inset-0 z-[130] flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.18 }}
        className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
        onClick={onClose}
      />
      <motion.aside
        role="dialog"
        aria-modal="true"
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.96 }}
        transition={{ duration: 0.16 }}
        className="relative flex max-h-[85vh] w-full max-w-sm flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
          <div className="min-w-0">
            <p className="text-[10px] font-extrabold uppercase tracking-wide text-slate-400">{t('ce.unassignSupplier')}</p>
            <h3 className="truncate font-display text-base font-extrabold text-slate-950">{supplierName}</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('ce.closeUnassignPanel')}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          {successProject ? (
            <div className="flex flex-col items-center justify-center rounded-xl border border-emerald-200 bg-emerald-50 p-6 text-center">
              <span className="grid h-14 w-14 place-items-center rounded-full bg-white text-emerald-600">
                <CheckCircle2 className="h-8 w-8" />
              </span>
              <h3 className="mt-4 font-display text-xl font-extrabold text-slate-950">{t('ce.supplierUnassigned')}</h3>
              <p className="mt-2 text-sm font-medium leading-relaxed text-slate-500">
                {t('ui.contractor.unassignedFrom', { name: supplierName, project: td(successProject.title) })}
              </p>
              <button
                type="button"
                onClick={onClose}
                className="mt-6 inline-flex h-10 items-center justify-center rounded-lg bg-brand-600 px-7 text-sm font-extrabold text-white transition hover:bg-brand-700"
              >
                {t('ce.done')}
              </button>
            </div>
          ) : !pendingProject ? (
            <>
              <p className="text-xs font-bold text-slate-600">{t('ui.contractor.chooseProjectToRemove', { name: supplierName })}</p>
              {assignedProjects.length === 0 ? (
                <p className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-8 text-center text-sm font-semibold text-slate-400">
                  {t('ce.noAssignedProjects')}
                </p>
              ) : (
                <div className="space-y-2">
                  {assignedProjects.map((project) => (
                    <div key={project.project_id} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3.5 transition hover:border-rose-200 hover:bg-white">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-extrabold text-slate-950">{td(project.project_title)}</p>
                        <p className="text-xs font-medium text-slate-500">{t('ui.contractor.engineerName', { name: td(project.engineer_name) })}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setPendingProject(project)}
                        className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-rose-200 bg-white px-4 text-xs font-extrabold text-rose-600 transition hover:bg-rose-50"
                      >
                        <X className="h-3.5 w-3.5" /> {t('ce.unassign')}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : (
            <>
              <div className="rounded-xl border border-rose-200 bg-rose-50/50 p-4">
                <p className="text-sm font-extrabold text-slate-950">{t('ui.contractor.unassignFromNamedProjectConfirm', { name: supplierName, project: td(pendingProject.project_title) })}</p>
                <div className="mt-3 space-y-2">
                  <p className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-3.5 py-2.5 text-sm">
                    <span className="text-slate-500">{t('se.project')}</span>
                    <span className="truncate font-extrabold text-slate-950">{td(pendingProject.project_title)}</span>
                  </p>
                  <p className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-3.5 py-2.5 text-sm">
                    <span className="text-slate-500">{t('role.engineer')}</span>
                    <span className="truncate font-extrabold text-slate-950">{td(pendingProject.engineer_name)}</span>
                  </p>
                </div>
              </div>
              {error && <p className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm font-bold text-rose-700">{error}</p>}
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => (onlyProject ? onClose() : setPendingProject(null))}
                  disabled={busy}
                  className="inline-flex h-10 items-center justify-center rounded-lg border border-slate-200 bg-white px-5 text-sm font-extrabold text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {t('ce.cancel')}
                </button>
                <button
                  type="button"
                  onClick={() => onUnassign(pendingProject, pendingProject.engineer_id)}
                  disabled={busy}
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-rose-600 px-6 text-sm font-extrabold text-white transition hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <X className="h-4 w-4" /> {t('ce.confirmUnassign')}
                </button>
              </div>
            </>
          )}
        </div>
      </motion.aside>
    </div>
  )
}
