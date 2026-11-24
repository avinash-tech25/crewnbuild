import { DisclaimerNote } from '../../../shared/ui/DisclaimerNote.jsx'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { ArrowRight, BrickWall, Check, CheckCircle2, HardHat, Home, IndianRupee, Send, Tractor, Truck, X } from 'lucide-react'
import { EmptyState } from '../../../shared/dashboard/RoleDashboardUi.jsx'
import { avatarFromPath } from '../../../shared/ui/avatars.js'
import { CardAvatar, CardChip, CardGrid, CardStatus, ListCard, cardButtonClass } from '../../../shared/ui/ListCard.jsx'
import { DETAIL_DIALOG_SIZE } from '../../../shared/ui/DetailDialog.jsx'
import BudgetInWords from '../../../shared/ui/BudgetInWords.jsx'
import { buildingTypeText, inr, OWNER_REQUEST_TYPES } from '../builderHelpers.js'
import { ClientProfilePanel, SupplierProfilePanel } from './BuilderProfilePanels.jsx'
import { useLanguage } from '../../../i18n/LanguageContext.jsx'
import { formatNumber } from '../../../shared/utils/formatters.js'
import { optionLabel, SUPPLIER_CATEGORY_KEYS, SUPPLIER_TYPE_KEYS } from '../../../i18n/optionKeys.js'

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
}) {
  const { t } = useLanguage()
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
          { id: 'suppliers', label: t('ui.suppliers'), count: openSupplierClientList.length, icon: Truck },
        ].map((tab) => (
          <button
            key={tab.id}
            aria-pressed={activeFindClientTab === tab.id}
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
          />
        )}

        {activeFindClientTab === 'suppliers' && (
          <SupplierLeadList
            supplierList={openSupplierClientList}
            clientRequestState={clientRequestState}
            findClientRequest={findClientRequest}
            sendingReceiverId={sendingReceiverId}
            openSupplierProfile={openSupplierProfile}
            onSendRequest={(supplier) => onSendRequest(supplier, 'CONTRACTOR_TO_SUPPLIER')}
          />
        )}
      </div>
    </section>
  )
}

function HomeownerLeadList({ clientList, clientRequestState, findClientRequest, sendingReceiverId, onAcceptRequest, onRejectRequest, onSelectClient, onSendRequest }) {
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
      {/* No height cap: the page is the only scroller. */}
      <CardGrid testId="builder-owner-lead-cards">
        {clientList.map((project) => {
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
          const quoting = quotingClientId === project.id
          return (
            <ListCard
              key={project.id}
              // The whole card opens the owner's details, as before; a click on
              // one of its own buttons or the quotation field does not.
              onClick={() => onSelectClient(project)}
              highlighted={accepted}
              avatar={<CardAvatar src={avatarFromPath(project.owner_profile_image_url, 'OWNER')} alt={displayOwnerName} />}
              title={displayOwnerName}
              subtitle={displayProjectTitle === displayOwnerName ? null : displayProjectTitle}
              status={accepted ? <CardStatus status="accepted">{t('ui.status.accepted')}</CardStatus> : null}
              rows={[
                { key: 'area', label: t('dash.contractor.sqftUnit'), value: area ? formatNumber(area) : t('dash.contractor.notShared') },
                { key: 'budget', label: t('dash.contractor.budgetAmount'), value: budget > 0 ? inr(budget, project.project_country) : t('dash.contractor.notShared') },
                { key: 'location', label: t('ce.col.location'), value: location },
              ]}
              // The building type the owner gave.
              chips={project.building_type ? [<CardChip key="type" tone="green">{buildingTypeText(project.building_type, t)}</CardChip>] : []}
              secondary={accepted ? (
                <span className="text-xs text-oc-muted">{t('dash.contractor.contactUnlockedProfile')}</span>
              ) : incomingPending ? (
                quoting ? (
                  <button type="button" onClick={cancelQuote} className={cardButtonClass('danger')}>
                    <X className="h-3 w-3" /> {t('dash.common.cancel')}
                  </button>
                ) : (
                  <button type="button" onClick={() => { if (window.confirm(t('dash.contractor.confirmReject'))) onRejectRequest(matchedRequest.id) }} className={cardButtonClass('danger')}>
                    {t('dash.contractor.notInterested')}
                  </button>
                )
              ) : null}
              primary={accepted ? null : incomingPending ? (
                quoting ? (
                  <button
                    type="button"
                    onClick={() => {
                      if (Number(quotationAmount || 0) <= 0) return setQuoteError(t('ui.requests.quoteRequired'))
                      onAcceptRequest(matchedRequest.id, quotationAmount)
                      cancelQuote()
                    }}
                    className={cardButtonClass('primary')}
                  >
                    <Check className="h-3 w-3" /> {t('dash.common.accept')}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setQuoteError('')
                      setQuotationAmount('')
                      setQuotingClientId(project.id)
                    }}
                    className={cardButtonClass('primary')}
                  >
                    {t('dash.contractor.quoteAccept')} <ArrowRight className="h-3 w-3" />
                  </button>
                )
              ) : (
                <button
                  type="button"
                  disabled={sendingReceiverId === project.owner_id || requestSent}
                  onClick={() => onSendRequest(project)}
                  className={cardButtonClass('primary')}
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
              )}
            >
              {/* The owner's request is waiting on this builder: accepting it
                  needs a quotation amount, as on the Requests board. */}
              {!accepted && incomingPending && (quoteError || quoting) && (
                <div className="mt-auto space-y-1.5">
                  {quoteError && <p className="text-[11px] font-bold text-rose-600">{quoteError}</p>}
                  {quoting && (
                    <div className="min-w-0">
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
                  )}
                </div>
              )}
            </ListCard>
          )
        })}
      </CardGrid>
      {!clientList.length && <EmptyState title={t('dash.contractor.noClientsTitle')} message={t('dash.contractor.noClientsSub')} />}
      <DisclaimerNote kind="leads" className="mt-3" />
    </>
  )
}

// Each supplier card's category chip follows the supplier's own category:
// one icon and colour per category.
const SUPPLIER_CARD_THEMES = {
  'Material Supplier': { icon: BrickWall, tone: 'green' },
  'Equipment Supplier': { icon: Tractor, tone: 'violet' },
  'Labor Supplier': { icon: HardHat, tone: 'blue' },
}
const OTHER_SUPPLIER_CARD_THEME = { icon: Truck, tone: 'grey' }
const SHOWN_OFFERINGS = 2

function SupplierLeadList({ supplierList, clientRequestState, findClientRequest, sendingReceiverId, openSupplierProfile, onSendRequest }) {
  const { t, td } = useLanguage()
  // Already filtered by the caller, which counts this very same list on the tab.
  return (
    <>
      {/* The same grid as the House Owner list, so cards on both tabs are the
          same size; the page is the only scroller. */}
      <CardGrid testId="builder-supplier-lead-cards">
        {supplierList.map((supplier) => {
          const requestState = clientRequestState(supplier, 'CONTRACTOR_TO_SUPPLIER')
          const requestSent = requestState !== 'none'
          const accepted = requestState === 'accepted'
          // The supplier asked this builder: answered on the Requests board.
          const incomingPending = requestState === 'pending' && findClientRequest?.(supplier, 'CONTRACTOR_TO_SUPPLIER')?.is_sender === false
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
          // The products/services list the supplier offers.
          const offerings = (Array.isArray(supplier.categories) ? supplier.categories : String(supplier.categories || '').split(','))
            .map((category) => String(category).trim()).filter(Boolean)
            .map((category) => optionLabel(t, SUPPLIER_CATEGORY_KEYS, category))
          return (
            <ListCard
              key={supplier.id}
              // The whole card opens the supplier's profile, as before; a click
              // on the Send Request button does not.
              onClick={() => openSupplierProfile(supplier)}
              highlighted={accepted}
              // `cover_image_url` on a supplier lead is that supplier's own
              // store logo or profile picture, which is what this card has
              // always shown; the Supplier default stands in when they have neither.
              avatar={<CardAvatar src={avatarFromPath(supplier.cover_image_url, 'SUPPLIER')} alt={supplierName} />}
              title={supplierName}
              subtitle={storeName && storeName !== supplierName ? storeName : null}
              rows={[
                { key: 'location', label: t('ce.col.location'), value: supplier.pincode || t('dash.owner.estimates.locationNotSet') },
                // Products / services — the first ones and how many more; the full list
                // shows on hover and in the profile the card opens.
                {
                  key: 'offerings',
                  label: t('ui.products'),
                  title: offerings.join(', ') || undefined,
                  value: offerings.length === 0 ? t('dash.contractor.servicesNotListed') : offerings.length <= SHOWN_OFFERINGS ? offerings.join(', ') : (
                    <span className="flex min-w-0 justify-end gap-1">
                      <span className="truncate">{offerings.slice(0, SHOWN_OFFERINGS).join(', ')}</span>
                      <span className="shrink-0">{t('dash.contractor.moreCount', { count: offerings.length - SHOWN_OFFERINGS })}</span>
                    </span>
                  ),
                },
              ]}
              status={incomingPending ? <CardStatus status="pending">{t('dash.contractor.wantsToWork')}</CardStatus> : null}
              // The supplier's category, in its own colour.
              chips={[<CardChip key="category" tone={theme.tone} icon={theme.icon}>{categoryLabel}</CardChip>]}
              primary={accepted ? (
                // Where Send Request was: the request is accepted.
                <span className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-emerald-50 px-3.5 text-xs font-extrabold text-emerald-800 ring-1 ring-emerald-200">
                  <CheckCircle2 className="h-3.5 w-3.5" /> {t('ui.status.accepted')}
                </span>
              ) : incomingPending ? (
                <Link to="/contractor/requests?tab=supplier" className={cardButtonClass('primary')}>
                  {t('dash.contractor.respond')} <ArrowRight className="h-3.5 w-3.5 rtl:-scale-x-100" />
                </Link>
              ) : (
                <button
                  type="button"
                  disabled={sendingReceiverId === supplier.owner_id || requestSent}
                  onClick={() => onSendRequest(supplier)}
                  className={cardButtonClass('primary')}
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
            />
          )
        })}
      </CardGrid>
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
  const heading = data.client_type === 'SUPPLIER' ? (td(data.store_name || data.title) || t('dash.common.supplier')) : (td(data.project_title || data.title) || t('dash.contractor.homeownerProject'))

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
    <div className="fixed inset-0 z-dialog grid place-items-center p-3 sm:p-6">
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
        aria-label={heading}
        data-detail-dialog=""
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 16 }}
        transition={{ duration: 0.2 }}
        className={`detail-dialog relative flex ${DETAIL_DIALOG_SIZE} flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl`}
      >
        {/* Header: small label and title. */}
        <div className="shrink-0 border-b border-slate-100">
        <div className="flex w-full items-start justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{t('dash.contractor.clientDetails')}</p>
            <h3 className="truncate font-display text-base font-extrabold text-slate-950">
              {heading}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('dash.contractor.closeClientDetails')}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        </div>

        {/* Body: grey and scrolling. */}
        <div data-detail-dialog-body="" className="dash-scroll min-h-0 flex-1 overflow-y-auto bg-slate-50/50">
        <div className="w-full space-y-3 p-3 sm:p-5">
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
    <div className="fixed inset-0 z-dialog-nested sm:flex sm:items-center sm:justify-center sm:p-6">
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
