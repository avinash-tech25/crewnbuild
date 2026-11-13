/**
 * DEVELOPMENT-ONLY test panel for POST /vastu/plan-analysis.
 *
 * Rendered only in a Vite dev build (`import.meta.env.DEV`), so it never ships
 * in the production bundle and the public screen is unchanged. It exists to
 * exercise the automatic analysis end to end while the manual workflow above
 * stays the real one. Wording is English-only for that reason.
 *
 * Scoring: the backend never scores. When — and only when — it answers
 * `status: "success"` with `readyForScoring`, its `directionMapping` is handed
 * to the existing `evaluateVastu()`, the same engine the manual calculator
 * uses. Any other status shows the reasons and no score.
 */
import { useState } from 'react'
import { ScanSearch } from 'lucide-react'
import { evaluateVastu } from './vastuRules.js'
import { Headline, cardClass, labelClass } from './ui.jsx'
import { analyseVastuPlan } from '../vastuApi.js'

const STATUS_TONE = {
  success: 'bg-oc-mint text-oc-deep',
  insufficient_data: 'bg-[#fef3cd] text-[#856404]',
  needs_page_selection: 'bg-[#fef3cd] text-[#856404]',
}

export default function VastuAutoAnalysis() {
  const [file, setFile] = useState(null)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)

  const run = async () => {
    if (!file || busy) return
    setBusy(true)
    setResult(null)
    try {
      setResult(await analyseVastuPlan(file))
    } finally {
      setBusy(false)
    }
  }

  const score = result?.status === 'success' && result.readyForScoring
    ? evaluateVastu(result.directionMapping)
    : null

  return (
    <div className={cardClass} data-testid="vastu-auto-analysis">
      <div className="flex items-center gap-2">
        <ScanSearch className="h-4 w-4 text-oc-green" />
        <h2 className="font-display text-lg font-extrabold text-oc-ink">Automatic plan analysis (development test)</h2>
      </div>
      <p className="mt-1 text-sm leading-6 text-oc-muted">
        Visible in development builds only. Sends the plan to the backend for automatic analysis; a score is shown only
        when every required component is reliably determined.
      </p>

      <label className={`${labelClass} mt-4 block`}>
        Floor plan (JPG, PNG or single-page PDF, up to 10 MB)
        <input
          type="file"
          accept="image/jpeg,image/png,application/pdf"
          onChange={(event) => { setFile(event.target.files?.[0] || null); setResult(null) }}
          className="mt-2 block w-full cursor-pointer rounded-xl border border-[rgba(8,62,43,.15)] bg-white p-2 text-sm font-semibold text-oc-ink file:mr-3 file:rounded-lg file:border-0 file:bg-oc-mint file:px-3 file:py-2 file:text-xs file:font-extrabold file:text-oc-deep"
        />
      </label>
      <button
        type="button"
        onClick={run}
        disabled={!file || busy}
        className="mt-4 inline-flex h-11 items-center justify-center rounded-xl bg-oc-green px-5 text-sm font-extrabold text-white transition hover:bg-oc-deep disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy ? 'Analyzing plan…' : 'Analyse automatically'}
      </button>
      {busy && <p className="mt-2 text-xs text-oc-muted" role="status">Analyzing plan… this can take up to a few minutes.</p>}

      {result && (
        <div className="mt-4 space-y-3 text-sm" data-testid="vastu-auto-result">
          <p>
            <span className={`rounded-full px-2.5 py-1 text-[11px] font-extrabold ${STATUS_TONE[result.status] || 'bg-[#fdecea] text-[#a12622]'}`}>
              {result.status}
            </span>
            {result.reason && <span className="ms-2 text-oc-muted">{result.reason}</span>}
          </p>

          {score?.ready && (
            <Headline label="Vastu compliance — automatic analysis" value={`${score.percent}% · ${score.band.label}`}
              sub={`Scored by the existing rules engine from ${score.placements.length} detected placements`} />
          )}

          {/* Same look as ErrorNote, but a <div>: a list cannot sit inside its <p>. */}
          {result.missingRequirements?.length > 0 && (
            <div className="rounded-xl bg-[#fef3cd] px-4 py-3 text-sm font-bold text-[#856404]">
              Missing or uncertain:
              <ul className="ms-4 list-disc font-semibold">{result.missingRequirements.map((item) => <li key={item}>{item}</li>)}</ul>
            </div>
          )}

          {result.orientation && (
            <p className="text-oc-muted">
              North: {result.orientation.north_angle_degrees ?? '—'}° (calculated from the arrow; model reading{' '}
              {result.orientation.model_claimed_angle_degrees ?? '—'}°) · Brahmasthan:{' '}
              {result.brahmasthan ? `${result.brahmasthan.px.x}, ${result.brahmasthan.px.y} px` : '—'}
            </p>
          )}

          {result.rooms?.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-start text-xs">
                <thead className="text-oc-faint">
                  <tr><th className="py-1 text-start">Label</th><th className="text-start">Category</th><th className="text-start">Direction</th><th className="text-start">Angle</th><th className="text-start">From edge</th><th className="text-start">Uncertain</th></tr>
                </thead>
                <tbody>
                  {[...result.rooms, ...(result.mainDoor?.found ? [{ ...result.mainDoor, label: 'Main door', category: 'mainDoor' }] : [])].map((room, index) => (
                    <tr key={`${room.label}-${index}`} className="border-t border-[rgba(8,62,43,.08)]">
                      <td className="py-1 font-bold text-oc-ink">{String(room.label).replace(/\s+/g, ' ')}</td>
                      <td>{room.category}</td>
                      <td>{room.direction ?? '—'}</td>
                      <td>{room.angle_degrees ?? '—'}</td>
                      <td>{room.boundary_distance_degrees ?? '—'}</td>
                      <td>{room.uncertain ? 'yes' : room.uncertain === false ? 'no' : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {result.warnings?.length > 0 && (
            <ul className="ms-4 list-disc text-xs text-oc-muted">{result.warnings.map((item) => <li key={item}>{item}</li>)}</ul>
          )}
        </div>
      )}
    </div>
  )
}
