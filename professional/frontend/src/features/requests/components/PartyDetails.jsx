import { useState } from 'react'
import { useLanguage } from '../../../i18n/LanguageContext.jsx'
import { defaultAvatarFor, userAvatarSrc } from '../../../shared/ui/avatars.js'
import { counterpartyRole, partyDetailRows, partyHeading, supplierCategoryLabel } from '../counterparty.js'

/**
 * The other party on a request, shown by who they are (features/requests/counterparty.js):
 * their logo or picture with the store or business name and category, then only the rows
 * that apply to them, each with a value. Phone and e-mail appear only when the server
 * sent them, which is once the request is accepted; until then a line says so.
 */
export default function PartyDetails({ request }) {
  const { t, td } = useLanguage()
  const [imageFailed, setImageFailed] = useState(false)
  const name = td(request.sender_name || request.profile_name) || ''
  const role = counterpartyRole(request)
  const category = supplierCategoryLabel(request, t)
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 rounded-xl border border-slate-100 bg-white px-3 py-2.5" data-testid="party-identity">
        <img
          src={imageFailed ? defaultAvatarFor(role) : userAvatarSrc(request, role)}
          alt={name}
          className="h-11 w-11 shrink-0 rounded-full object-cover ring-1 ring-slate-200"
          onError={() => setImageFailed(true)}
        />
        <div className="min-w-0">
          <p className="truncate text-sm font-extrabold text-slate-900">{partyHeading(request, td)}</p>
          {category && <p className="truncate text-[11px] font-semibold text-slate-500">{category}</p>}
        </div>
      </div>
      <dl className="divide-y divide-slate-100 rounded-xl border border-slate-100 bg-white" data-testid="party-details">
        {partyDetailRows(request, t, td).map(([label, value]) => (
          <div key={label} className="flex items-start justify-between gap-3 px-3 py-1.5 text-xs">
            <dt className="shrink-0 text-slate-400">{label}</dt>
            <dd className="min-w-0 text-right font-semibold text-slate-800">{value}</dd>
          </div>
        ))}
      </dl>
      {!request.can_view_contact && !request.profile_phone && !request.profile_email && (
        <p className="text-[11px] font-medium text-slate-500">{t('req.party.contactAfterAccept')}</p>
      )}
    </div>
  )
}
