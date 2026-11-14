import { useCallback, useRef, useState } from 'react'
import { Camera, Save, ShieldCheck } from 'lucide-react'
import PincodeAreaFields from '../../../shared/ui/PincodeAreaFields.jsx'
import { Alert, Spinner } from '../../../shared/ui/ui.jsx'
import { apiErrorMessage, assetUrl } from '../../../shared/api/apiClient.js'
import { updateTechnicianProfile, uploadProfileImage } from '../technicianApi.js'
import { isVerifiedProfessional } from '../verification.js'

// Pending means submitted and waiting for review -- never shown as verified.
const IDENTITY_BADGES = {
  VERIFIED: ['Verified', 'bg-emerald-50 text-emerald-800'],
  PENDING: ['Pending review', 'bg-amber-50 text-amber-800'],
  PENDING_VERIFICATION: ['Pending verification', 'bg-amber-50 text-amber-800'],
  FAILED: ['Not accepted', 'bg-red-50 text-red-700'],
  NOT_STARTED: ['Not submitted', 'bg-slate-100 text-slate-600'],
  NOT_SUBMITTED: ['Not submitted', 'bg-slate-100 text-slate-600'],
}

function IdentityBadge({ status }) {
  const [label, className] = IDENTITY_BADGES[status] || IDENTITY_BADGES.NOT_STARTED
  return <span className={`rounded-full px-2 py-0.5 text-[11px] font-extrabold ${className}`}>{label}</span>
}

function formFrom(user) {
  return {
    name: user.name || '',
    phone: user.phone || '',
    address: user.address || '',
    pincode: user.pincode || '',
    area: user.area || '',
    experience_years: user.experience_years ?? 0,
  }
}

// `rating` is the dashboard summary's aggregate, formatted ({ rated, text }); no extra request.
export default function ProfilePanel({ user, typeMeta, onUpdated, rating = null }) {
  const [form, setForm] = useState(() => formFrom(user))
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [message, setMessage] = useState({ tone: 'info', text: '' })
  const fileInput = useRef(null)

  const update = useCallback((changes) => setForm((current) => ({ ...current, ...changes })), [])

  const save = async (event) => {
    event.preventDefault()
    setSaving(true)
    setMessage({ tone: 'info', text: '' })
    try {
      const changes = { ...form, experience_years: Number(form.experience_years || 0) }
      // Only resend the location when it changed, so an unchanged area is never re-validated.
      if (changes.pincode === user.pincode && changes.area === user.area) {
        delete changes.pincode
        delete changes.area
      }
      const updated = await updateTechnicianProfile(changes)
      onUpdated(updated)
      setForm(formFrom(updated))
      setMessage({ tone: 'success', text: 'Profile saved.' })
    } catch (error) {
      setMessage({ tone: 'error', text: apiErrorMessage(error, 'Unable to save your profile.') })
    } finally {
      setSaving(false)
    }
  }

  const choosePhoto = async (event) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setUploading(true)
    setMessage({ tone: 'info', text: '' })
    try {
      onUpdated(await uploadProfileImage(file))
      setMessage({ tone: 'success', text: 'Photo updated.' })
    } catch (error) {
      setMessage({ tone: 'error', text: apiErrorMessage(error, 'Unable to upload this photo.') })
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[280px_1fr]">
      <div className="card flex flex-col items-center p-6 text-center">
        <div className="relative">
          <div className="grid h-32 w-32 place-items-center overflow-hidden rounded-full bg-gradient-to-b from-white to-oc-mint ring-4 ring-white shadow-card">
            {user.profile_image_url ? (
              <img src={assetUrl(user.profile_image_url)} alt={user.name} className="h-full w-full object-cover" />
            ) : (
              <img src={typeMeta.heroImage} alt="" className="mt-6 h-32 w-32 object-contain" />
            )}
          </div>
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            className="absolute bottom-1 right-1 grid h-9 w-9 place-items-center rounded-full bg-oc-green text-white shadow-lift"
            aria-label="Upload profile photo"
            disabled={uploading}
          >
            {uploading ? <Spinner className="h-4 w-4" /> : <Camera className="h-4 w-4" />}
          </button>
          <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={choosePhoto} />
        </div>
        <p className="mt-4 font-display text-lg font-extrabold text-oc-ink">{user.name}</p>
        <p className="text-sm font-bold text-oc-green">{typeMeta.label}</p>
        {rating && (
          <p className={`mt-1 text-sm font-extrabold ${rating.rated ? 'text-oc-amber' : 'text-oc-muted'}`} data-testid="profile-rating">{rating.text}</p>
        )}
        {isVerifiedProfessional(user) && (
          <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-extrabold text-emerald-800" data-testid="verified-professional">
            <ShieldCheck className="h-3.5 w-3.5" /> Verified Professional
          </p>
        )}
        <p className="mt-1 text-xs text-oc-muted">{user.email}</p>
        <p className="mt-3 text-xs text-oc-muted">{user.location}</p>
        <p className="mt-4 text-[11px] text-oc-muted">JPG, PNG or WebP, up to 3 MB.</p>

        <dl className="mt-5 w-full space-y-2 border-t border-oc-line pt-4 text-left text-sm">
          <div className="flex items-center justify-between gap-2">
            <dt className="font-bold text-oc-muted">Face verification</dt>
            <dd><IdentityBadge status={user.onboarding?.face_status} /></dd>
          </div>
          <div className="flex items-center justify-between gap-2">
            <dt className="font-bold text-oc-muted">Aadhaar</dt>
            <dd><IdentityBadge status={user.onboarding?.aadhaar_status} /></dd>
          </div>
          {user.onboarding?.aadhaar_masked && (
            <p className="text-right font-display text-xs tracking-[0.15em] text-oc-ink">{user.onboarding.aadhaar_masked}</p>
          )}
        </dl>
      </div>

      <form onSubmit={save} className="card space-y-4 p-6">
        <Alert tone={message.tone}>{message.text}</Alert>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="field-label">Full name</span>
            <input className="field-input" required value={form.name} onChange={(event) => update({ name: event.target.value })} />
          </label>
          <label className="block">
            <span className="field-label">Phone</span>
            <input className="field-input" required value={form.phone} onChange={(event) => update({ phone: event.target.value })} />
          </label>
        </div>
        <label className="block">
          <span className="field-label">Address</span>
          <input className="field-input" required value={form.address} onChange={(event) => update({ address: event.target.value })} />
        </label>
        <PincodeAreaFields pincode={form.pincode} area={form.area} onChange={update} />
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="field-label">Experience (years)</span>
            <input className="field-input" type="number" min={0} max={60} value={form.experience_years} onChange={(event) => update({ experience_years: event.target.value })} />
          </label>
          <div>
            <span className="field-label">Trade</span>
            <p className="field-input bg-oc-sunken text-oc-muted">{typeMeta.label} (set at registration)</p>
          </div>
        </div>
        <div className="flex justify-end">
          <button type="submit" className="btn-primary" disabled={saving}>
            {saving ? <Spinner className="h-4 w-4" /> : <Save className="h-4 w-4" />} Save profile
          </button>
        </div>
      </form>
    </div>
  )
}
