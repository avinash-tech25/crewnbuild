import { useMemo, useState } from 'react'
import { BadgeCheck, Building2, CalendarDays, MapPin, Maximize2, Phone, Star, Wallet } from 'lucide-react'
import { imageUrl } from '../../../shared/api/apiClient.js'
import { userAvatarSrc } from '../../../shared/ui/avatars.js'
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

function finalStatusClass(status) {
  if (status === 'accepted') return 'border-brand-200 bg-brand-50 text-brand-700'
  if (status === 'rejected') return 'border-red-200 bg-red-50 text-red-600'
  return 'border-brand-100 bg-brand-50 text-brand-700'
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
          {filteredRequests.map((request) => {
            const pending = request.status === 'pending'
            const expanded = expandedRequestId === request.id
            const needsQuotation = requireQuotation && request.request_type === 'OWNER_TO_CONTRACTOR'
            const canAct = pending && !request.is_sender
            const canViewContact = request.status === 'accepted'
            const profileGallery = profileList(request.profile_gallery || request.gallery)
            const profileDocuments = profileList(request.profile_documents || request.documents)
            return (
              // One card per request, laid out like the Requests reference:
              // picture, project and location | sender company, area and
              // amount | date | View Details and the actions. Same fields,
              // same handlers and the same expandable details as before.
              <article key={request.id} className="overflow-hidden rounded-2xl border border-oc-line bg-white shadow-ocsoft transition hover:border-emerald-200">
                <div className={`grid grid-cols-1 ${compact ? 'gap-4 p-4' : 'gap-5 p-5'} lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1.2fr)_minmax(0,0.7fr)_auto] lg:items-center`}>
                  <div className="flex min-w-0 items-center gap-4">
                    {/* A property enquiry shows the property it is about;
                        every other request shows the sender's own avatar,
                        which is the person this row is named after. */}
                    <span className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-xl bg-ocbrand-50 ring-1 ring-oc-line">
                      <img
                        src={request.property_image_url ? imageUrl(request.property_image_url) : userAvatarSrc(request)}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                    </span>
                    <div className="min-w-0">
                      {/* Everything here was typed by the sender: the title of
                          their project, its address. */}
                      <h3 className="truncate font-display text-base font-extrabold text-oc-ink">{td(request.property_title || request.project_title) || td(request.sender_name)}</h3>
                      <p className="mt-1 flex items-center gap-1.5 text-sm text-oc-muted"><MapPin className="h-4 w-4 shrink-0" /> <span className="truncate">{td(request.project_address || request.sender_address || request.project_pincode) || t('ui.requests.locationNotSet')}</span></p>
                    </div>
                  </div>

                  <div className="min-w-0 space-y-1.5 text-sm text-oc-ink lg:border-s lg:border-oc-line lg:ps-5">
                    <p className="flex items-center gap-2 font-semibold"><Building2 className="h-4 w-4 shrink-0 text-oc-green" /> <span className="truncate">{td(request.profile_title || request.sender_name)}</span></p>
                    <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-oc-muted">
                      {Number(request.land_area || 0) > 0 && (
                        <span className="inline-flex items-center gap-1.5"><Maximize2 className="h-4 w-4 text-oc-green" /> {request.land_area} {t('ui.shared.sqFtUnit')}</span>
                      )}
                      {Number(request.property_price || 0) > 0
                        ? <span className="inline-flex items-center gap-1.5 font-semibold text-oc-ink"><Wallet className="h-4 w-4 text-oc-green" /> {formatMoney(request.property_price)}</span>
                        : Number(request.budget || 0) > 0 && <span className="inline-flex items-center gap-1.5 font-semibold text-oc-ink"><Wallet className="h-4 w-4 text-oc-green" /> {formatMoney(request.budget)}</span>}
                    </div>
                  </div>

                  <div className="space-y-1.5 text-sm text-oc-muted lg:border-s lg:border-oc-line lg:ps-5">
                    <p className="flex items-center gap-2" title={t('ui.requests.posted')}><CalendarDays className="h-4 w-4 shrink-0 text-oc-green" /> {formatDate(request.created_at_iso, requestAgeLabel(request.created_at))}</p>
                    {!pending && <p className={`inline-flex rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${finalStatusClass(request.status)}`}>{statusLabel(request.status, t)}</p>}
                    {Number(request.quotation_amount || 0) > 0 && (
                      <p className="rounded-lg border border-emerald-100 bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-700">
                        {t('ui.requests.quotation', { amount: formatMoney(request.quotation_amount) })}
                      </p>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-2.5 lg:justify-end">
                    {actionError && expanded && <p className="w-full text-xs font-bold text-red-600">{actionError}</p>}
                    {canAct && needsQuotation && (
                      <div className="w-full">
                      <input
                        type="number"
                        min="1"
                        value={quotationAmounts[request.id] || ''}
                        onChange={(event) => {
                          setActionError('')
                          setQuotationAmounts((currentAmounts) => ({ ...currentAmounts, [request.id]: event.target.value }))
                        }}
                        placeholder={t('ui.requests.quotePh')}
                        className="w-full rounded-xl border border-oc-line bg-white px-4 py-2.5 text-sm font-bold text-oc-ink outline-none focus:border-emerald-300"
                      />
                      <BudgetInWords value={quotationAmounts[request.id] || ''} country={request.project_country || country} />
                      </div>
                    )}
                    <button onClick={() => setExpandedRequestId(expanded ? null : request.id)} className="h-11 min-w-[8.5rem] rounded-xl border border-oc-line bg-white px-5 text-sm font-bold text-oc-ink transition hover:border-emerald-200 hover:bg-emerald-50">
                      {t('ui.requests.viewDetails')}
                    </button>
                    {canAct ? (
                      <>
                        <button
                          onClick={() => {
                            const quotationAmount = quotationAmounts[request.id] || ''
                            if (needsQuotation && Number(quotationAmount || 0) <= 0) {
                              setExpandedRequestId(request.id)
                              setActionError(t('ui.requests.quoteRequired'))
                              return
                            }
                            onAccept(request.id, needsQuotation ? quotationAmount : undefined)
                          }}
                          className="h-11 min-w-[8.5rem] rounded-xl bg-oc-deep px-5 text-sm font-bold text-white transition hover:bg-oc-green"
                        >
                          {t('ui.requests.accept')}
                        </button>
                        <button onClick={() => onReject(request.id)} className="h-11 rounded-xl border border-red-100 bg-red-50 px-4 text-sm font-bold text-red-600 transition hover:bg-red-100">
                          {t('ui.requests.reject')}
                        </button>
                      </>
                    ) : (
                      <div className={`flex h-11 min-w-[8.5rem] items-center justify-center rounded-xl border px-5 text-sm font-extrabold ${finalStatusClass(request.status)}`}>
                        {statusLabel(request.status, t)}
                      </div>
                    )}
                  </div>
                </div>

                {expanded && (
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
                )}
              </article>
            )
          })}

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
