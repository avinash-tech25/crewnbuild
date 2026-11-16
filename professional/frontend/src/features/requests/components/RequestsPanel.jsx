import { useMemo, useState } from 'react'
import { BadgeCheck, Phone, Star } from 'lucide-react'
import { imageUrl } from '../../../shared/api/apiClient.js'
import { userAvatarSrc } from '../../../shared/ui/avatars.js'
import { CardAvatar, CardChip, CardGrid, CardStatus, ListCard, cardButtonClass } from '../../../shared/ui/ListCard.jsx'
import { constructionTypeLabel, requestTypeLabel } from '../../../shared/utils/roleLabels.js'
import { formatMoney as countryFormatMoney } from '../../../shared/utils/countryConfig.js'
import { useLanguage } from '../../../i18n/LanguageContext.jsx'
import BudgetInWords from '../../../shared/ui/BudgetInWords.jsx'
// The one status map, shared with StatusPill. This file used to keep its own
// shorter copy, which lacked the five property statuses and so printed a
// property enquiry's status as its raw stored code.
import { statusLabel } from '../../../shared/dashboard/StatusPill.jsx'
import { formatDate } from '../../../shared/utils/formatters.js'
import { SERVICE_OPTION_KEYS, SUPPLIER_CATEGORY_KEYS, optionLabel } from '../../../i18n/optionKeys.js'

// The sender's role code as the role name the rest of the app shows.
const SENDER_ROLE_KEYS = {
  OWNER: 'role.owner',
  CONTRACTOR: 'role.contractor',
  BUILDER: 'role.contractor',
  SUPPLIER: 'role.supplier',
  ENGINEER: 'role.engineer',
}

function formatMoney(value, country) {
  return countryFormatMoney(value, country)
}

function requestAgeLabel(createdAt) {
  if (!createdAt) return ''
  return createdAt
}

function requestSortValue(request) {
  const pendingRank = request.status === 'pending' ? 0 : 1
  const createdAt = Date.parse(request.created_at_iso || request.created_at || '') || 0
  return { pendingRank, createdAt }
}

function profileList(value) {
  if (Array.isArray(value)) return value.filter(Boolean)
  return String(value || '').split(',').map((item) => item.trim()).filter(Boolean)
}

function mediaValue(item) {
  if (!item) return ''
  if (typeof item === 'string') return item
  return item.url || item.image_url || item.file_url || item.storage_key || ''
}

function mediaLabel(item, fallback) {
  if (!item) return fallback
  if (typeof item === 'string') return item.split('/').pop() || fallback
  return item.title || item.name || item.filename || fallback
}

function ContactValue({ value, visible }) {
  const { t } = useLanguage()
  return <span className={visible ? '' : 'select-none blur-sm'}>{visible ? value || t('ui.requests.notSet') : value || t('ui.requests.locked')}</span>
}

export default function RequestsPanel({ requestList, onAccept, onReject, requireQuotation = false, variant = 'default', compact = false }) {
  const { t, td, country } = useLanguage()
  // A stored option value that has a written label (SERVICE_OPTION_KEYS /
  // SUPPLIER_CATEGORY_KEYS) uses it; anything a supplier typed themselves has no
  // key to look up, so it is machine-translated for display instead of printed
  // as the English it was entered in. This is the same treatment the request
  // profile dashboard gives the identical field.
  const profileTagLabel = (item, senderRole) => {
    const map = senderRole === 'SUPPLIER' ? SUPPLIER_CATEGORY_KEYS : SERVICE_OPTION_KEYS
    const label = optionLabel(t, map, item)
    return label === item ? td(item) : label
  }
  const [activeStatus, setActiveStatus] = useState('all')
  const [expandedRequestId, setExpandedRequestId] = useState(null)
  const [quotationAmounts, setQuotationAmounts] = useState({})
  const [actionError, setActionError] = useState('')

  const filteredRequests = useMemo(() => {
    // Only the status tabs filter the list now; the location, budget and
    // search filters were removed from this panel.
    return requestList.filter((request) => activeStatus === 'all' || request.status === activeStatus).sort((firstRequest, secondRequest) => {
      const first = requestSortValue(firstRequest)
      const second = requestSortValue(secondRequest)
      if (first.pendingRank !== second.pendingRank) return first.pendingRank - second.pendingRank
      return second.createdAt - first.createdAt
    })
  }, [activeStatus, requestList])

  const expandedRequest = filteredRequests.find((request) => request.id === expandedRequestId) || null
  // The full details of one request: who sent it and what it asks for.
  const renderDetails = (request) => {
    const canViewContact = request.status === 'accepted'
    const profileGallery = profileList(request.profile_gallery || request.gallery)
    const profileDocuments = profileList(request.profile_documents || request.documents)
    return (
      <section aria-label={t('ui.requests.requestDetails')} className="overflow-hidden rounded-2xl border border-oc-line bg-white shadow-ocsoft">
            <div className={`border-t border-slate-100 bg-slate-50 ${compact ? 'px-4 py-3' : 'px-5 py-4'}`}>
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
                <div className={`rounded-xl border border-slate-200 bg-white ${compact ? 'p-3' : 'p-4'}`}>
                  <div className="flex items-start gap-4">
                    {/* The sender's own avatar, resolved from the
                        request row itself (`profile_image_url` +
                        `sender_role`) so it is theirs, not the
                        reader's. */}
                    <img
                      src={userAvatarSrc(request)}
                      alt=""
                      className="h-16 w-16 shrink-0 rounded-xl object-cover ring-1 ring-brand-100"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h4 className="truncate font-display text-lg font-extrabold text-graphite">{td(request.profile_title || request.sender_name)}</h4>
                        <span className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2 py-1 text-[10px] font-bold uppercase text-brand-700">
                          <BadgeCheck className="h-3 w-3" />
                          {request.profile_subtitle
                            ? td(request.profile_subtitle)
                            : (SENDER_ROLE_KEYS[request.sender_role] ? t(SENDER_ROLE_KEYS[request.sender_role]) : td(request.sender_role))}
                        </span>
                      </div>
                      <p className="mt-1 text-sm font-semibold text-graphite/55">{td(request.profile_name)}</p>
                      {request.profile_about && <p className="mt-2 line-clamp-3 text-sm leading-relaxed text-graphite/65">{td(request.profile_about)}</p>}
                    </div>
                  </div>
                  <div className="mt-4 grid grid-cols-1 gap-2 text-sm sm:grid-cols-3">
                    <p className="rounded-lg bg-brand-50 px-3 py-2"><span className="block text-xs font-bold text-graphite/45">{t('ui.requests.rating')}</span><b className="inline-flex items-center gap-1"><Star className="h-3.5 w-3.5 fill-current text-gold" />{request.profile_rating || 0}</b></p>
                    <p className="rounded-lg bg-brand-50 px-3 py-2"><span className="block text-xs font-bold text-graphite/45">{t('ui.requests.pincode')}</span><b>{request.profile_pincode || request.sender_pincode || t('ui.requests.notSet')}</b></p>
                    <p className="rounded-lg bg-brand-50 px-3 py-2"><span className="block text-xs font-bold text-graphite/45">{t('ui.requests.phone')}</span><b className="inline-flex items-center gap-1"><Phone className="h-3.5 w-3.5" /><ContactValue value={request.profile_phone} visible={canViewContact} /></b></p>
                  </div>
                  {!canViewContact && <p className="mt-2 text-xs font-semibold text-graphite/50">{t('ui.requests.acceptToView')}</p>}
                  {Number(request.profile_experience_years || 0) > 0 && (
                    <div className="mt-3 grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
                      <p className="rounded-lg bg-white px-3 py-2 ring-1 ring-slate-100"><span className="block text-xs font-bold text-graphite/45">{t('ui.requests.experience')}</span><b>{t('ui.requests.years', { years: request.profile_experience_years })}</b></p>
                      <p className="rounded-lg bg-white px-3 py-2 ring-1 ring-slate-100"><span className="block text-xs font-bold text-graphite/45">{t('ui.requests.completedProjects')}</span><b>{request.profile_completed_projects || 0}</b></p>
                    </div>
                  )}
                  {profileList(request.profile_services || request.profile_categories).length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {/* The same values the request profile dashboard
                          shows, now through the same labels rather than
                          as the raw stored English. */}
                      {profileList(request.profile_services || request.profile_categories).map((item) => (
                        <span key={item} className="rounded-full bg-cream px-3 py-1 text-xs font-bold text-brand-800">{profileTagLabel(item, request.sender_role)}</span>
                      ))}
                    </div>
                  )}
                  {Array.isArray(request.profile_completed_project_details) && request.profile_completed_project_details.length > 0 && (
                    <div className="mt-3 rounded-xl border border-brand-100 bg-brand-50 p-3">
                      <p className="text-xs font-extrabold uppercase tracking-wide text-brand-700">{t('ui.requests.completedProjects')}</p>
                      <div className="mt-2 grid grid-cols-1 gap-2">
                        {request.profile_completed_project_details.slice(0, 4).map((project, index) => (
                          <div key={`${project.title || 'project'}-${index}`} className="rounded-lg bg-white px-3 py-2 text-sm ring-1 ring-brand-100">
                            <p className="font-bold text-graphite">{project.title ? td(project.title) : t('ui.requests.project', { n: index + 1 })}</p>
                            {project.location && <p className="mt-0.5 text-xs font-semibold text-graphite/55">{td(project.location)}</p>}
                            {project.description && <p className="mt-1 text-xs leading-relaxed text-graphite/65">{td(project.description)}</p>}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {profileGallery.length > 0 && (
                    <div className="mt-3 rounded-xl border border-slate-100 bg-white p-3">
                      <p className="text-xs font-extrabold uppercase tracking-wide text-brand-700">{t('ui.requests.gallery')}</p>
                      <div className="mt-2 grid grid-cols-3 gap-2">
                        {profileGallery.slice(0, 6).map((item, index) => {
                          const src = mediaValue(item)
                          if (!src) return null
                          return <img key={`${src}-${index}`} src={imageUrl(src)} alt="" className="h-20 w-full rounded-lg object-cover ring-1 ring-slate-100" />
                        })}
                      </div>
                    </div>
                  )}
                  {profileDocuments.length > 0 && (
                    <div className="mt-3 rounded-xl border border-slate-100 bg-white p-3">
                      <p className="text-xs font-extrabold uppercase tracking-wide text-brand-700">{t('ui.requests.documents')}</p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {profileDocuments.map((item, index) => (
                          <span key={`${mediaLabel(item, t('ui.requests.document'))}-${index}`} className="rounded-full bg-slate-50 px-3 py-1 text-xs font-bold text-graphite ring-1 ring-slate-100">
                            {/* A document title or file name the sender
                                uploaded, or our own numbered fallback. */}
                            {td(mediaLabel(item, t('ui.requests.documentN', { n: index + 1 })))}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
                <div className={`rounded-xl border border-slate-200 bg-white ${compact ? 'p-3' : 'p-4'}`}>
                  <h4 className="font-display text-base font-extrabold text-graphite">{t('ui.requests.requestDetails')}</h4>
                  <div className="mt-3 grid grid-cols-1 gap-3 text-sm md:grid-cols-2">
                    <p><span className="text-graphite/45">{t('ui.requests.requestType')}</span><br /><b>{requestTypeLabel(request.request_type, t) || t('ui.requests.notSet')}</b></p>
                    <p><span className="text-graphite/45">{t('ui.requests.construction')}</span><br /><b>{constructionTypeLabel(request.construction_type, t) || t('ui.requests.notSet')}</b></p>
                    {/* `building_type` is free text on the backend, so
                        there is no key to look it up by. */}
                    <p><span className="text-graphite/45">{t('ui.requests.building')}</span><br /><b>{td(request.building_type) || t('ui.requests.notSet')}</b></p>
                    <p><span className="text-graphite/45">{t('ui.requests.pincode')}</span><br /><b>{request.project_pincode || request.sender_pincode || t('ui.requests.notSet')}</b></p>
                    <p className="md:col-span-2"><span className="text-graphite/45">{t('ui.requests.address')}</span><br /><b>{td(request.project_address || request.sender_address) || t('ui.requests.notSet')}</b></p>
                  </div>
                </div>
              </div>
            </div>
      </section>
    )
  }

  const counts = {
    all: requestList.length,
    pending: requestList.filter((request) => request.status === 'pending').length,
    accepted: requestList.filter((request) => request.status === 'accepted').length,
    rejected: requestList.filter((request) => request.status === 'rejected').length,
    withdrawn: requestList.filter((request) => request.status === 'withdrawn').length,
  }

  const tabs = [
    { id: 'all', label: t('ui.requests.title'), count: counts.all },
    { id: 'pending', label: t('ui.requests.new'), count: counts.pending },
    { id: 'accepted', label: t('ui.requests.accepted'), count: counts.accepted },
    { id: 'rejected', label: t('ui.requests.rejected'), count: counts.rejected },
    // Taken back by the sender -- its own filter, never folded into Rejected.
    { id: 'withdrawn', label: t('ui.shared.statusWithdrawn'), count: counts.withdrawn },
  ]
  const command = variant === 'sunrise' || variant === 'command'
  const sunrise = command

  return (
    <section className={`requests-panel overflow-hidden border ${compact ? 'rounded-lg shadow-[0_16px_46px_-36px_rgba(15,23,42,0.65)]' : 'rounded-[1.35rem] shadow-[0_28px_80px_-56px_rgba(15,23,42,0.82)]'} ${
      sunrise
        ? 'border-slate-200 bg-white'
        : 'border-slate-200 bg-white'
    }`}>
      {/* No header: the Requests tab the engineer just clicked already names
          this panel, and the New tab below carries the pending count, so the
          title, subtitle and pending tile were all removed. `title` /
          `subtitle` stay accepted props but are no longer drawn. */}
      <div className={`${sunrise ? 'bg-white' : 'overflow-hidden rounded-xl border border-slate-200'}`}>
        <div className={`dash-scroll flex overflow-x-auto border-b ${sunrise ? `border-slate-200 bg-white ${compact ? 'px-5' : 'px-6'}` : 'border-slate-200 bg-white'}`}>
          {tabs.map((tab) => {
            const active = activeStatus === tab.id
            return (
              <button
                key={tab.id}
                onClick={() => setActiveStatus(tab.id)}
                className={`shrink-0 border-b-2 ${compact ? 'px-6 py-3 text-xs' : 'px-8 py-4 text-sm'} font-extrabold ${
                  active
                    ? sunrise ? 'border-brand-800 text-brand-900' : 'border-brand-600 text-brand-700'
                    : 'border-transparent text-graphite/55 hover:text-brand-700'
                }`}
              >
                {tab.label} ({tab.count})
              </button>
            )
          })}
        </div>

        <div className={`space-y-3 bg-oc-paper ${compact ? 'p-4' : 'p-5'}`}>
          {filteredRequests.length > 0 && (
          <CardGrid testId="request-cards" label={t('ui.requests.title')}>
          {filteredRequests.map((request) => {
            const pending = request.status === 'pending'
            const expanded = expandedRequestId === request.id
            const needsQuotation = requireQuotation && request.request_type === 'OWNER_TO_CONTRACTOR'
            const canAct = pending && !request.is_sender
            // Everything here was typed by the sender: the title of their
            // project, its address.
            const title = td(request.property_title || request.project_title) || td(request.sender_name)
            return (
              // One card per request: picture, project and location; sender,
              // area, amount and date; View Details and the actions. Same
              // fields, same handlers and the same details as before.
              <ListCard
                key={request.id}
                // The quotation field (or the action error under it) stays visible.
                expanded={Boolean((canAct && needsQuotation) || (actionError && expanded))}
                // A property enquiry shows the property it is about; every
                // other request shows the sender's own avatar.
                avatar={<CardAvatar src={request.property_image_url ? imageUrl(request.property_image_url) : userAvatarSrc(request)} />}
                title={title}
                subtitle={td(request.project_address || request.sender_address || request.project_pincode) || t('ui.requests.locationNotSet')}
                // Where the request stands, once it is not waiting on this reader.
                status={canAct ? null : <CardStatus status={request.status}>{statusLabel(request.status, t)}</CardStatus>}
                rows={[
                  { key: 'sender', label: t('dash.common.name'), value: td(request.profile_title || request.sender_name) },
                  Number(request.land_area || 0) > 0 ? { key: 'area', label: t('dash.common.landArea'), value: `${request.land_area} ${t('ui.shared.sqFtUnit')}` } : null,
                  Number(request.property_price || 0) > 0
                    ? { key: 'amount', label: t('property.price'), value: formatMoney(request.property_price) }
                    : Number(request.budget || 0) > 0 ? { key: 'amount', label: t('dash.common.budget'), value: formatMoney(request.budget) } : null,
                  { key: 'posted', label: t('dash.common.date'), value: formatDate(request.created_at_iso, requestAgeLabel(request.created_at)) },
                ]}
                chips={[
                  Number(request.quotation_amount || 0) > 0 && (
                    <CardChip key="quotation" tone="green">{t('ui.requests.quotation', { amount: formatMoney(request.quotation_amount) })}</CardChip>
                  ),
                ]}
                secondary={(
                  <>
                    <button type="button" onClick={() => setExpandedRequestId(expanded ? null : request.id)} aria-expanded={expanded} className={cardButtonClass('secondary')}>
                      {t('ui.requests.viewDetails')}
                    </button>
                    {canAct && (
                      <button type="button" onClick={() => onReject(request.id)} className={cardButtonClass('danger')}>
                        {t('ui.requests.reject')}
                      </button>
                    )}
                  </>
                )}
                primary={canAct ? (
                  <button
                    type="button"
                    onClick={() => {
                      const quotationAmount = quotationAmounts[request.id] || ''
                      if (needsQuotation && Number(quotationAmount || 0) <= 0) {
                        setExpandedRequestId(request.id)
                        setActionError(t('ui.requests.quoteRequired'))
                        return
                      }
                      onAccept(request.id, needsQuotation ? quotationAmount : undefined)
                    }}
                    className={cardButtonClass('primary')}
                  >
                    {t('ui.requests.accept')}
                  </button>
                ) : null}
              >
                {(canAct && needsQuotation) || (actionError && expanded) ? (
                  <div className="mt-auto">
                    {actionError && expanded && <p className="mb-1.5 text-xs font-bold text-red-600">{actionError}</p>}
                    {canAct && needsQuotation && (
                      <>
                        <input
                          type="number"
                          min="1"
                          value={quotationAmounts[request.id] || ''}
                          onChange={(event) => {
                            setActionError('')
                            setQuotationAmounts((currentAmounts) => ({ ...currentAmounts, [request.id]: event.target.value }))
                          }}
                          placeholder={t('ui.requests.quotePh')}
                          className="w-full rounded-xl border border-oc-line bg-white px-3 py-2 text-sm font-bold text-oc-ink outline-none focus:border-emerald-300"
                        />
                        <BudgetInWords value={quotationAmounts[request.id] || ''} country={request.project_country || country} />
                      </>
                    )}
                  </div>
                ) : null}
              </ListCard>
            )
          })}
          </CardGrid>
          )}

          {/* The opened request's details, under the cards. */}
          {expandedRequest && renderDetails(expandedRequest)}

          {!filteredRequests.length && (
            <div className="px-5 py-16 text-center">
              <p className="font-display text-base font-bold text-graphite">{t('ui.requests.noRequests')}</p>
              <p className="mt-1 text-sm text-graphite/50">{t('ui.requests.noRequestsSub')}</p>
            </div>
          )}
        </div>
      </div>

    </section>
  )
}
