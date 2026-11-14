import { useCallback, useEffect, useState } from 'react'
import { RotateCw, Save, SlidersHorizontal } from 'lucide-react'
import { Alert, Spinner } from '../../../shared/ui/ui.jsx'
import { apiErrorMessage } from '../../../shared/api/apiClient.js'
import { fetchTechnicianCatalog, fetchWorkPreferences, saveWorkPreferences } from '../technicianApi.js'
import WorkPreferencesFields from './WorkPreferencesFields.jsx'
import { formFromServer, toPayload, validateForm } from '../workPreferences.js'

/**
 * Profile > Work preferences: the same services, radius and hours chosen at
 * registration, editable at any time. Saving replaces the whole set; the next
 * job offered already follows it.
 */
export default function WorkPreferencesSection({ typeMeta, onSaved }) {
  const [catalog, setCatalog] = useState(null)
  const [form, setForm] = useState(null)
  const [loadError, setLoadError] = useState('')
  const [notice, setNotice] = useState({ tone: 'info', text: '' })
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoadError('')
    try {
      const [services, saved] = await Promise.all([fetchTechnicianCatalog(), fetchWorkPreferences()])
      setCatalog(services)
      setForm(formFromServer(saved, services))
    } catch (error) {
      setLoadError(apiErrorMessage(error, 'Your work preferences could not be loaded.'))
    }
  }, [])

  useEffect(() => { load() }, [load])

  const save = async (event) => {
    event.preventDefault()
    const problem = validateForm(form, catalog)
    if (problem) {
      setNotice({ tone: 'error', text: problem })
      return
    }
    setSaving(true)
    setNotice({ tone: 'info', text: '' })
    try {
      const saved = await saveWorkPreferences(toPayload(form, catalog))
      setForm(formFromServer(saved, catalog))
      setNotice({ tone: 'success', text: 'Work preferences saved. New job requests follow them from now on.' })
      onSaved?.(saved)
    } catch (error) {
      setNotice({ tone: 'error', text: apiErrorMessage(error, 'Your work preferences could not be saved.') })
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="card space-y-4 p-5 sm:p-6" aria-labelledby="work-preferences-title" data-testid="work-preferences">
      <div>
        <h2 id="work-preferences-title" className="flex items-center gap-2 font-display text-lg font-extrabold text-oc-ink">
          <SlidersHorizontal className="h-5 w-5 text-oc-green" /> Work preferences
        </h2>
        <p className="text-sm text-oc-muted">Which jobs you are offered: your services, how far you travel and when you work.</p>
      </div>

      {loadError ? (
        <div className="space-y-3">
          <Alert tone="error">{loadError}</Alert>
          <button type="button" className="btn-ghost px-3 py-2" onClick={load}><RotateCw className="h-4 w-4" /> Try again</button>
        </div>
      ) : !form ? (
        <p className="flex items-center gap-2 text-sm text-oc-muted"><Spinner className="h-4 w-4" /> Loading your work preferences…</p>
      ) : (
        <form onSubmit={save} className="space-y-4">
          <WorkPreferencesFields catalog={catalog} form={form} onChange={setForm} tradeLabel={typeMeta?.label} />
          <Alert tone={notice.tone}>{notice.text}</Alert>
          <button type="submit" className="btn-primary w-full py-3 sm:w-auto" disabled={saving} data-testid="work-preferences-save">
            {saving ? <Spinner className="h-4 w-4" /> : <Save className="h-4 w-4" />} Save work preferences
          </button>
        </form>
      )}
    </section>
  )
}
