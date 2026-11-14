import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { ArrowRight, BrickWall, Check, CheckCircle2, FileText, HardHat, Home, IndianRupee, MapPin, Send, Tractor, Truck, X } from 'lucide-react'
import { EmptyState } from '../../../shared/dashboard/RoleDashboardUi.jsx'
import { avatarFromPath } from '../../../shared/ui/avatars.js'
import { EntityPill } from '../../../shared/ui/EntityPill.jsx'
import BudgetInWords from '../../../shared/ui/BudgetInWords.jsx'
import { buildingTypeText, inr, OWNER_REQUEST_TYPES } from '../builderHelpers.js'
import { ClientProfilePanel, SupplierProfilePanel } from './BuilderProfilePanels.jsx'
import { useLanguage } from '../../../i18n/LanguageContext.jsx'
import { formatNumber } from '../../../shared/utils/formatters.js'
import { optionLabel, SUPPLIER_CATEGORY_KEYS, SUPPLIER_TYPE_KEYS } from '../../../i18n/optionKeys.js'
import UpgradePrompt from '../../billing/subscription/UpgradePrompt.jsx'
import { leadUsage, limitUsage } from '../../billing/subscription/planLimits.js'

export function ContractorFindClientsSection({
  clientRequestState,
  findClientRequest,
  onSendRequest,
  sendingReceiverId,
  onAcceptRequest,
  onRejectRequest,
  openSupplierProfile,
  requestMessage,
  activeFindClientTab,
  setActiveFindClientTab,
  openOwnerClientList,
  supplierClientList,
  onSelectClient,
  // The "Leads for <pincode> · Change" button, shown at the right end of the tabs.
  locationAction = null,
  // The server's subscription status: its `usage` (India builders) gives the open
  // leads per location; a location at its limit takes no new request (the server
  // refuses it too).
  subscriptionStatus = null,
}) {
  const { t } = useLanguage()
  const usage = limitUsage(subscriptionStatus)
  const leadRows = (usage?.leads || []).map((row) => leadUsage(subscriptionStatus, row.pincode)).filter(Boolean)
  // A supplier who has accepted belongs in My Suppliers, so the list below
  // leaves them out. The tab counts that same list rather than the raw leads;
  // counting the raw list is what made "Supplier Requests (3)" render a single
  // card. The Houseowner tab is already given a list that was filtered before
  // it got here.
  const openSupplierClientList = supplierClientList.filter(
    (supplier) => clientRequestState(supplier, 'CONTRACTOR_TO_SUPPLIER') !== 'accepted',
  )
  return (
    <section className="overflow-hidden rounded-[1.35rem] border border-slate-200 bg-white shadow-[0_28px_80px_-58px_rgba(15,23,42,0.85)] ring-1 ring-white">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-5">
        {[
          { id: 'houseowners', label: t('dash.contractor.tab.houseownerProjects'), count: openOwnerClientList.length, icon: Home },
          { id: 'suppliers', label: t('dash.contractor.tab.supplierRequests'), count: openSupplierClientList.length, icon: Truck },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveFindClientTab(tab.id)}
            className={`inline-flex items-center gap-1.5 border-b-2 px-3.5 py-2.5 text-[13px] font-extrabold ${activeFindClientTab === tab.id ? 'border-brand-800 text-brand-900' : 'border-transparent text-graphite/55 hover:text-brand-700'}`}
          >
            <tab.icon className="h-3.5 w-3.5" />
            {tab.label} ({tab.count})
          </button>
        ))}
        {locationAction && <div className="ms-auto py-1.5">{locationAction}</div>}
      </div>
      <div className="p-3">
        {requestMessage && (
          <div className="mb-2.5 rounded-xl border border-brand-100 bg-brand-50 px-3 py-2 text-sm font-semibold text-brand-800">
            {requestMessage}
          </div>
        )}

        {activeFindClientTab === 'houseowners' && leadRows.length > 0 && (
          <div className="mb-2.5 grid gap-2">
            <div className="flex flex-wrap gap-2">
              {leadRows.map((row) => (
                <span key={row.pincode} className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-bold ${row.atLimit ? 'border-amber-300 bg-amber-50 text-amber-900' : 'border-slate-200 bg-slate-50 text-slate-700'}`}>
                  <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
                  {row.limit ? t('subscription.usage.leads', { pincode: row.pincode, used: row.used, limit: row.limit, remaining: row.remaining }) : row.pincode}
                </span>
              ))}
            </div>
            {leadRows.filter((row) => row.atLimit).map((row) => (
              <UpgradePrompt key={row.pincode} kind="leads" limit={row.limit} pincode={row.pincode} status={subscriptionStatus} compact />
            ))}
          </div>
        )}

        {activeFindClientTab === 'houseowners' && (
          <HomeownerLeadList
            clientList={openOwnerClientList}
            clientRequestState={clientRequestState}
            findClientRequest={findClientRequest}
            sendingReceiverId={sendingReceiverId}
            onAcceptRequest={onAcceptRequest}
            onRejectRequest={onRejectRequest}
            onSelectClient={onSelectClient}
            onSendRequest={(project) => onSendRequest(project, 'CONTRACTOR_TO_OWNER')}
            subscriptionStatus={subscriptionStatus}
          />
        )}

        {activeFindClientTab === 'suppliers' && (
          <SupplierLeadList
            supplierList={openSupplierClientList}
            clientRequestState={clientRequestState}
            sendingReceiverId={sendingReceiverId}
            openSupplierProfile={openSupplierProfile}
            onSendRequest={(supplier) => onSendRequest(supplier, 'CONTRACTOR_TO_SUPPLIER')}
          />
        )}
      </div>
    </section>
  )
}

// Each lead card's soft background, in turn, as in the reference.
const LEAD_TINTS = [
  'from-emerald-50/80 to-white',
  'from-white to-slate-50',
  'from-orange-50/80 to-white',
  'from-pink-50/80 to-white',
  'from-sky-50/80 to-white',
  'from-teal-50/70 to-white',
]

function HomeownerLeadList({ clientList, clientRequestState, findClientRequest, sendingReceiverId, onAcceptRequest, onRejectRequest, onSelectClient, onSendRequest, subscriptionStatus = null }) {
  const { t, td } = useLanguage()
  const [quotingClientId, setQuotingClientId] = useState(null)
  const [quotationAmount, setQuotationAmount] = useState('')
  const [quoteError, setQuoteError] = useState('')
  const cancelQuote = () => {
    setQuotingClientId(null)
    setQuotationAmount('')
    setQuoteError('')
  }
  return (
    <>
      {/* Three to a row on a desktop, and no height cap: the list used to sit
          in its own 620px scroller, so the page scrolled and then the cards
          scrolled again inside it. The page is the only scroller now. */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
        {clientList.map((project, index) => {
          // Both owner↔builder directions: an incoming OWNER_TO_CONTRACTOR
          // request (owner contacted the builder) and an outgoing
          // CONTRACTOR_TO_OWNER request describe the same lead, and either one
          // must suppress the Send Request button.
          const requestState = clientRequestState(project, OWNER_REQUEST_TYPES)
          const requestSent = requestState !== 'none'
          // The stored request behind the state, so an incoming pending request
          // can be accepted (with a quotation) or rejected right from this card.
          const matchedRequest = findClientRequest ? findClientRequest(project, OWNER_REQUEST_TYPES) : null
          const incomingPending = requestState === 'pending' && matchedRequest && !matchedRequest.is_sender
          const displayProjectTitle = td(project.project_title || project.title) || t('dash.contractor.homeownerProject')
          const displayOwnerName = td(project.owner_name || project.profile_title) || t('dash.contractor.homeowner')
          const accepted = requestState === 'accepted'
          const area = Number(project.land_area || 0)
          const budget = Number(project.budget || 0)
          const location = `${td(project.address) || t('dash.owner.estimates.locationNotSet')}${project.pincode ? ` - ${project.pincode}` : ''}`
          const tint = LEAD_TINTS[index % LEAD_TINTS.length]
          return (
            <div
              key={project.id}
              role="button"
              tabIndex={0}
              // The whole card opens the owner's details, as before; a click on
              // one of its own buttons or the quotation field does not.
              onClick={(event) => { if (!event.target.closest('button, a, input, select, textarea')) onSelectClient(project) }}
              onKeyDown={(event) => { if (event.key === 'Enter' && event.target === event.currentTarget) onSelectClient(project) }}
              className={`group flex h-full cursor-pointer flex-col rounded-xl border bg-gradient-to-br p-3 shadow-[0_14px_40px_-30px_rgba(15,23,42,0.35)] transition hover:-translate-y-0.5 hover:shadow-[0_20px_44px_-28px_rgba(15,23,42,0.45)] focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-300 ${
                accepted ? 'border-emerald-300 from-emerald-50 to-white' : `border-slate-200 ${tint}`
              }`}
            >
              {/* Owner and project */}
              <div className="flex items-start gap-2.5">
                <img
                  src={avatarFromPath(project.owner_profile_image_url, 'OWNER')}
                  alt={displayOwnerName}
                  className="h-11 w-11 shrink-0 rounded-full bg-white object-cover ring-2 ring-white/80"
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-display text-[15px] font-extrabold leading-tight text-slate-950" title={displayOwnerName}>{displayOwnerName}</p>
                  <p className="truncate text-xs text-slate-500" title={displayProjectTitle}>{displayProjectTitle}</p>
                </div>
                {/* The building type the owner gave, small, in the corner. */}
                {project.building_type && (
                  <span className="shrink-0 rounded-full bg-white/80 px-2 py-0.5 text-[10px] font-semibold text-emerald-800 ring-1 ring-emerald-100">
                    {buildingTypeText(project.building_type, t)}
                  </span>
                )}
              </div>

              {/* Area and budget */}
              <div className="mt-2.5 flex items-center gap-2 border-b border-slate-200/70 pb-2.5">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="leading-tight">
                    <span className="block text-sm font-extrabold text-slate-950">{area ? formatNumber(area) : '—'}</span>
                    <span className="block text-[11px] text-slate-500">{t('dash.contractor.sqftUnit')}</span>
                  </span>
                </div>
                <span className="h-8 w-px shrink-0 bg-slate-200" aria-hidden="true" />
                <div className="flex min-w-0 items-center gap-2 rounded-lg bg-white/70 px-2 py-1.5 ring-1 ring-slate-100">
                  <span className="shrink-0 text-[11px] font-semibold text-slate-500">{t('dash.contractor.budgetAmount')}</span>
                  <span className="truncate text-sm font-extrabold text-slate-950">{budget > 0 ? inr(budget, project.project_country) : '—'}</span>
                </div>
              </div>

              {/* Location */}
              <p className="mt-2 flex items-start gap-1.5 text-xs leading-snug text-slate-600" title={location}>
                <MapPin className="mt-px h-3.5 w-3.5 shrink-0 text-emerald-700" />
                <span className="truncate">{location}</span>
              </p>

              {accepted && (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <EntityPill tone="positive" dot>{t('ui.status.accepted')}</EntityPill>
                  <span className="text-xs text-slate-500">{t('dash.contractor.contactUnlockedProfile')}</span>
                </div>
              )}

              {/* The request controls, unchanged, at the bottom of every card. */}
              <div className="mt-auto pt-2.5 [&>*:first-child]:mt-0">
              {!accepted && (incomingPending ? (
                // The owner's request is waiting on this builder: accept it
                // (a quotation amount is required, as on the Requests board) or
                // decline it right from this card.
                <div className="mt-2.5 space-y-1.5">
                  {quoteError && <p className="text-[11px] font-bold text-rose-600">{quoteError}</p>}
                  {quotingClientId === project.id ? (
                    <div className="flex items-start gap-1.5">
                      <div className="min-w-0 flex-1">
                      <input
                        type="number"
                        min="1"
                        autoFocus
                        value={quotationAmount}
                        onChange={(event) => {
                          setQuoteError('')
                          setQuotationAmount(event.target.value)
                        }}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            const amount = quotationAmount
                            if (Number(amount || 0) <= 0) return setQuoteError(t('ui.requests.quoteRequired'))
                            onAcceptRequest(matchedRequest.id, amount)
                            cancelQuote()
                          }
                          if (event.key === 'Escape') cancelQuote()
                        }}
                        placeholder={t('dash.contractor.amount')}
                        className="h-8 w-full min-w-0 rounded-lg border border-brand-300 bg-white px-2.5 text-xs font-bold text-slate-800 outline-none transition focus:border-brand-500 focus:ring-4 focus:ring-brand-50"
                      />
                        <BudgetInWords value={quotationAmount} country={project.project_country} />
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          if (Number(quotationAmount || 0) <= 0) return setQuoteError(t('ui.requests.quoteRequired'))
                          onAcceptRequest(matchedRequest.id, quotationAmount)
                          cancelQuote()
                        }}
                        className="inline-flex h-8 items-center justify-center gap-1 rounded-lg bg-emerald-600 px-2.5 text-xs font-extrabold text-white transition hover:bg-emerald-700"
                      >
                        <Check className="h-3 w-3" /> {t('dash.common.accept')}
                      </button>
                      <button
                        type="button"
                        onClick={cancelQuote}
                        className="inline-flex h-8 items-center justify-center rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-extrabold text-slate-600 transition hover:bg-slate-50"
                      >
                        <X className="h-3 w-3" /> {t('dash.common.cancel')}
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => {
                          setQuoteError('')
                          setQuotationAmount('')
                          setQuotingClientId(project.id)
                        }}
                        className="inline-flex h-8 flex-1 items-center justify-center gap-1 rounded-lg bg-brand-600 px-2.5 text-xs font-extrabold text-white transition hover:bg-brand-700"
                      >
                        {t('dash.contractor.quoteAccept')} <ArrowRight className="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => onRejectRequest(matchedRequest.id)}
                        className="inline-flex h-8 items-center justify-center rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-extrabold text-slate-600 transition hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600"
                      >
                        {t('dash.contractor.notInterested')}
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <button
                  // A location at its open-lead limit takes no new request (the server refuses it too).
                  disabled={sendingReceiverId === project.owner_id || requestSent || Boolean(leadUsage(subscriptionStatus, project.pincode)?.atLimit)}
                  onClick={() => onSendRequest(project)}
                  className={`mt-2.5 inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-lg px-3 text-[13px] font-bold transition disabled:cursor-not-allowed ${
                    requestSent ? 'bg-ocbrand-50 text-ocbrand-700 ring-1 ring-ocbrand-100' : 'bg-[#0f5132] text-white shadow-sm hover:bg-[#0b3f27] disabled:opacity-60'
                  }`}
                >
                  {!requestSent && <Send className="h-3.5 w-3.5" strokeWidth={2.25} />}
                  {requestState === 'rejected'
                    ? t('ui.status.rejected')
                    : requestState === 'pending'
                      ? t('ui.status.pending')
                      : requestSent
                        ? t('dash.contractor.status.proposalSent')
                        : sendingReceiverId === project.owner_id
                          ? t('dash.common.sending')
                          : t('dash.common.sendRequest')}
                </button>
              ))}
              </div>
            </div>
          )
        })}
      </div>
      {!clientList.length && <EmptyState title={t('dash.contractor.noClientsTitle')} message={t('dash.contractor.noClientsSub')} />}
    </>
  )
}

// Each supplier card's header band, icon and products box follow the
// supplier's own category, as in the reference: one colour per category.
const SUPPLIER_CARD_THEMES = {
  'Material Supplier': { icon: BrickWall, band: 'bg-emerald-50', label: 'text-emerald-800', iconTone: 'text-emerald-700', box: 'bg-emerald-50/60', avatar: 'bg-emerald-50 ring-emerald-100' },
  'Equipment Supplier': { icon: Tractor, band: 'bg-violet-50', label: 'text-slate-700', iconTone: 'text-violet-600', box: 'bg-violet-50/60', avatar: 'bg-violet-50 ring-violet-100' },
  'Labor Supplier': { icon: HardHat, band: 'bg-sky-50', label: 'text-slate-700', iconTone: 'text-sky-700', box: 'bg-sky-50/60', avatar: 'bg-sky-50 ring-sky-100' },
}
const OTHER_SUPPLIER_CARD_THEME = { icon: Truck, band: 'bg-slate-50', label: 'text-slate-700', iconTone: 'text-slate-600', box: 'bg-slate-50', avatar: 'bg-slate-50 ring-slate-100' }

function SupplierLeadList({ supplierList, clientRequestState, sendingReceiverId, openSupplierProfile, onSendRequest }) {
  const { t, td } = useLanguage()
  // Already filtered by the caller, which counts this very same list on the tab.
  return (
    <>
      {/* The same grid as the House Owner list, so cards on both tabs are the
          same size; the page is the only scroller. */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
        {supplierList.map((supplier) => {
          const requestState = clientRequestState(supplier, 'CONTRACTOR_TO_SUPPLIER')
          const requestSent = requestState !== 'none'
          const accepted = requestState === 'accepted'
          // The supplier's own name leads and their store name sits under it.
          // Both come from the discovery payload: `name` is the user's name and
          // `store_name` their supplier profile's store. The store line is
          // dropped when a supplier never named their store apart from
          // themselves, the same guard the supplier browser uses.
          const supplierName = td(supplier.name || supplier.store_name || supplier.title)
          const storeName = td(supplier.store_name || supplier.title || '')
          // The supplier's own category off their profile — "Material
          // Supplier", "Equipment Supplier", "Labor Supplier" — instead of
          // the generic "Supplier" caption every card used to repeat. Falls
          // back to that caption only for a supplier who never set one.
          const categoryLabel = supplier.supplier_category ? optionLabel(t, SUPPLIER_TYPE_KEYS, supplier.supplier_category) : t('role.supplier')
          const theme = SUPPLIER_CARD_THEMES[supplier.supplier_category] || OTHER_SUPPLIER_CARD_THEME
          const CategoryIcon = theme.icon
          // The products/services list the supplier offers.
          const offerings = (Array.isArray(supplier.categories) ? supplier.categories : String(supplier.categories || '').split(','))
            .map((category) => String(category).trim()).filter(Boolean)
            .map((category) => optionLabel(t, SUPPLIER_CATEGORY_KEYS, category)).join(', ')
          return (
            <div
              key={supplier.id}
              role="button"
              tabIndex={0}
              // The whole card opens the supplier's profile, as before; a click
              // on the Send Request button does not.
              onClick={(event) => { if (!event.target.closest('button, a, input, select, textarea')) openSupplierProfile(supplier) }}
              onKeyDown={(event) => { if (event.key === 'Enter' && event.target === event.currentTarget) openSupplierProfile(supplier) }}
              className={`group flex h-full cursor-pointer flex-col rounded-xl border bg-white p-3 shadow-[0_14px_40px_-30px_rgba(15,23,42,0.35)] transition hover:-translate-y-0.5 hover:shadow-[0_20px_44px_-28px_rgba(15,23,42,0.45)] focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-300 ${
                accepted ? 'border-emerald-300' : 'border-slate-200'
              }`}
            >
              {/* Category band */}
              {/* Kept compact so the card is the same size as a House Owner card. */}
              <div className={`flex items-center gap-2.5 rounded-lg px-2.5 pb-[7px] pt-1.5 ${theme.band}`}>
                <CategoryIcon className={`h-4 w-4 shrink-0 ${theme.iconTone}`} />
                <span className={`min-w-0 flex-1 truncate text-[11px] font-extrabold uppercase tracking-[0.18em] ${theme.label}`}>{categoryLabel}</span>
                {/* The supplier's pincode, in the band's right corner. */}
                <span className="inline-flex h-5 shrink-0 items-center gap-1 text-xs font-semibold text-slate-600">
                  <MapPin className="h-3.5 w-3.5 shrink-0 text-slate-700" />
                  {supplier.pincode || t('dash.owner.estimates.locationNotSet')}
                </span>
              </div>

              <div className="flex flex-1 flex-col pt-1.5">
                {/* Supplier and store */}
                <div className="flex items-start gap-3 border-b border-slate-200/80 px-1 pb-2">
                  {/* `cover_image_url` on a supplier lead is that supplier's own
                      store logo or profile picture, which is what this card has
                      always shown; the Supplier default stands in when they have
                      neither. */}
                  <img
                    src={avatarFromPath(supplier.cover_image_url, 'SUPPLIER')}
                    alt={supplierName}
                    className={`h-11 w-11 shrink-0 rounded-full object-cover ring-1 ${theme.avatar}`}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-display text-[15px] font-extrabold leading-tight text-slate-950" title={supplierName}>{supplierName}</p>
                    {storeName && storeName !== supplierName && (
                      <p className="truncate text-xs text-slate-600" title={storeName}>{storeName}</p>
                    )}
                  </div>
                </div>

                {/* Products / services — one line; the full list shows on hover. */}
                {offerings && (
                  <div className={`mt-2 flex items-center gap-2 rounded-lg px-2.5 py-1 ${theme.box}`}>
                    <FileText className="h-3.5 w-3.5 shrink-0 text-slate-600" />
                    <p className="truncate text-xs font-medium leading-snug text-slate-800" title={offerings}>{offerings}</p>
                  </div>
                )}

                {accepted && (
                  <div className="mt-2">
                    <EntityPill tone="positive" dot>{t('ui.status.accepted')}</EntityPill>
                  </div>
                )}

                <div className="mt-auto">
                  {!accepted && (
                    <button
                      disabled={sendingReceiverId === supplier.owner_id || requestSent}
                      onClick={() => onSendRequest(supplier)}
                      className={`mt-2 inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-lg px-3 text-[13px] font-bold transition disabled:cursor-not-allowed ${
                        requestSent ? 'bg-ocbrand-50 text-ocbrand-700 ring-1 ring-ocbrand-100' : 'bg-[#0f5132] text-white shadow-sm hover:bg-[#0b3f27] disabled:opacity-60'
                      }`}
                    >
                      {!requestSent && <Send className="h-3.5 w-3.5" strokeWidth={2.25} />}
                      {requestState === 'rejected'
                        ? t('ui.status.rejected')
                        : requestState === 'pending'
                          ? t('ui.status.pending')
                          : requestSent
                            ? t('dash.contractor.requestSent')
                            : sendingReceiverId === supplier.owner_id
                              ? t('dash.common.sending')
                              : t('dash.common.sendRequest')}
                    </button>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>
      {!supplierList.length && <EmptyState title={t('dash.owner.suppliers.emptyTitle')} message={t('dash.contractor.suppliersEmpty')} />}
    </>
  )
}

export function ClientProfileDrawer({ selectedClientProfile, clientRequestState, onSendRequest, sendingReceiverId, supplierProfileMessage, onClose }) {
  const { t, td } = useLanguage()
  const data = selectedClientProfile || {}
  const requestType = data.client_type === 'SUPPLIER' ? 'CONTRACTOR_TO_SUPPLIER' : 'CONTRACTOR_TO_OWNER'
  const requestState = clientRequestState(data, requestType)
  const canViewContact = requestState === 'accepted' || Boolean(data.can_view_contact)

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  return (
    // A large centred window, as a site engineer's profile opens, for a
    // homeowner's client details and a supplier's profile alike.
    <div className="fixed inset-0 z-[130] flex items-center justify-center p-4 sm:p-6">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.18 }}
        className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
        onClick={onClose}
      />
      <motion.aside
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 16 }}
        transition={{ duration: 0.2 }}
        className={`relative flex max-h-[90vh] w-full flex-col overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 shadow-2xl ${data.client_type === 'SUPPLIER' ? 'max-w-5xl' : 'max-w-2xl'}`}
      >
        {/* Header */}
        <div className="border-b border-slate-200 bg-white">
        <div className={`flex w-full items-center justify-between gap-3 ${data.client_type === 'SUPPLIER' ? 'px-6 py-4' : 'px-4 py-3'}`}>
          <div className="min-w-0">
            <p className="text-[10px] font-extrabold uppercase tracking-wide text-slate-400">{t('dash.contractor.clientDetails')}</p>
            <h3 className="truncate font-display text-base font-extrabold text-slate-950">
              {data.client_type === 'SUPPLIER' ? (td(data.store_name || data.title) || t('dash.common.supplier')) : (td(data.project_title || data.title) || t('dash.contractor.homeownerProject'))}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('dash.contractor.closeClientDetails')}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
        <div className={`w-full space-y-4 ${data.client_type === 'SUPPLIER' ? 'px-6 py-6' : 'p-4'}`}>
          {data.client_type === 'SUPPLIER' ? (
            <SupplierProfilePanel
              supplier={data}
              requestSent={requestState !== 'none'}
              canViewContact={canViewContact}
              loadingMessage={supplierProfileMessage}
              sending={sendingReceiverId === data.owner_id}
              onBack={onClose}
              onSendRequest={() => onSendRequest(data, requestType)}
            />
          ) : (
            <ClientProfilePanel
              client={data}
              requestSent={requestState !== 'none'}
              canViewContact={canViewContact}
              sending={sendingReceiverId === data.owner_id}
              onBack={onClose}
              onSendRequest={() => onSendRequest(data, requestType)}
            />
          )}
        </div>
        </div>
      </motion.aside>
    </div>
  )
}

export function SendRequestDrawer({ client, requestType, onClose, onSend, busy, error, success }) {
  const [amount, setAmount] = useState('')
  const isOwnerRequest = requestType === 'CONTRACTOR_TO_OWNER'
  const { t, td, country } = useLanguage()
  const displayName = td(client?.store_name || client?.owner_name || client?.title) || t('dash.contractor.thisClient')
  const projectTitle = td(client?.project_title || client?.title) || (client?.client_type === 'SUPPLIER' ? t('dash.contractor.supplierProfile') : t('dash.contractor.homeownerProject'))

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  // Desktop: a compact dialog in the middle of the screen. Phone: the panel
  // it has always been, sliding in from the right at full width. Only the
  // container moves; the form inside is unchanged.
  const isDesktop = typeof window !== 'undefined' && window.matchMedia('(min-width: 640px)').matches

  const submit = (event) => {
    event.preventDefault()
    onSend(amount)
  }

  return (
    <div className="fixed inset-0 z-[140] sm:flex sm:items-center sm:justify-center sm:p-6">
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
        transition={isDesktop ? { duration: 0.18 } : { type: 'spring', stiffness: 340, damping: 34 }}
        className="absolute inset-y-0 right-0 flex w-full max-w-md flex-col border-l border-slate-200 bg-white shadow-2xl sm:relative sm:inset-auto sm:max-h-[85vh] sm:overflow-hidden sm:rounded-2xl sm:border"
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
          <div className="min-w-0">
            <p className="text-[10px] font-extrabold uppercase tracking-wide text-slate-400">{t('dash.common.sendRequest')}</p>
            <h3 className="truncate font-display text-base font-extrabold text-slate-950">{displayName}</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('dash.contractor.closeSendRequest')}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          {success ? (
            <div className="flex h-full flex-col items-center justify-center rounded-xl border border-emerald-200 bg-emerald-50 p-8 text-center">
              <span className="grid h-14 w-14 place-items-center rounded-full bg-white text-emerald-600">
                <CheckCircle2 className="h-8 w-8" />
              </span>
              <h3 className="mt-4 font-display text-xl font-extrabold text-slate-950">{t('dash.contractor.requestSent')}</h3>
              <p className="mt-2 text-sm font-medium leading-relaxed text-slate-500">
                {t('dash.contractor.requestSentBody', { name: displayName })}
              </p>
              <button
                type="button"
                onClick={onClose}
                className="mt-6 inline-flex h-10 items-center justify-center rounded-lg bg-brand-600 px-7 text-sm font-extrabold text-white transition hover:bg-brand-700"
              >
                {t('dash.contractor.done')}
              </button>
            </div>
          ) : (
            <form className="space-y-4" onSubmit={submit}>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-semibold text-slate-500">{t('dash.common.project')}</span>
                  <span className="truncate text-sm font-extrabold text-slate-950">{projectTitle}</span>
                </div>
                <div className="mt-2 flex items-center justify-between gap-3">
                  <span className="text-sm font-semibold text-slate-500">{t('dash.contractor.recipient')}</span>
                  <span className="truncate text-sm font-extrabold text-slate-950">{displayName}</span>
                </div>
                {/* The owner's own budget for this project, the same figure the
                    lead card shows, so the quotation can be set against it. */}
                {isOwnerRequest && (
                  <div className="mt-2 flex items-center justify-between gap-3 border-t border-slate-200 pt-2">
                    <span className="text-sm font-semibold text-slate-500">{t('dash.contractor.budgetAmount')}</span>
                    <span className="truncate text-sm font-extrabold text-slate-950">
                      {Number(client?.budget || 0) > 0 ? inr(client.budget, client?.project_country || country) : t('dash.common.notSet')}
                    </span>
                  </div>
                )}
              </div>

              {isOwnerRequest && (
                <div>
                  <p className="mb-1 text-xs font-extrabold uppercase tracking-wide text-slate-400">{t('dash.contractor.quotationOptional')}</p>
                  <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3.5">
                    <IndianRupee className="h-4 w-4 shrink-0 text-brand-600" />
                    <input
                      value={amount}
                      onChange={(event) => setAmount(event.target.value.replace(/\D/g, ''))}
                      placeholder={t('ui.contractor.quotationPlaceholder')}
                      className="h-10 w-full bg-transparent text-sm font-bold text-slate-800 outline-none placeholder:font-semibold placeholder:text-slate-400"
                    />
                  </div>
                  {/* The client's own project country when the feed carries it,
                      otherwise the builder's — never a silent rupee default. */}
                  <BudgetInWords value={amount} country={client?.project_country || country} />
                  <p className="mt-1.5 text-xs font-medium text-slate-500">{t('dash.contractor.quotationHint')}</p>
                </div>
              )}

              {error && <p className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm font-bold text-rose-700">{error}</p>}

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={busy}
                  className="inline-flex h-10 items-center justify-center rounded-lg border border-slate-200 bg-white px-5 text-sm font-extrabold text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {t('dash.common.cancel')}
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-brand-600 px-6 text-sm font-extrabold text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <Send className="h-4 w-4" /> {busy ? t('dash.common.sending') : t('dash.common.sendRequest')}
                </button>
              </div>
            </form>
          )}
        </div>
      </motion.aside>
    </div>
  )
}
