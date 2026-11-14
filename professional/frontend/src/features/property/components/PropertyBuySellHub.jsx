/**
 * Buy & Sell, as two tabs.
 *
 * **One component serves both the House Owner and the Builder.** They browse
 * the same published feed and manage listings in the same table through the
 * same endpoints; the only difference the caller passes is which tab opens
 * first. There is no builder property system and no owner property system.
 *
 * The tab strip is the same one OwnerSupplierHub already uses, so this reads as
 * an existing part of the dashboard rather than a new screen.
 *
 * Every property on screen comes from the API. There is no seed list, no
 * example house and no placeholder price anywhere in this file.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useSelector } from 'react-redux'
import { Loader2, Pencil, Plus, Search, Send, Store } from 'lucide-react'
import SellListingCard from './SellListingCard.jsx'
import PropertyDetailPanel from './PropertyDetailPanel.jsx'
import PropertyForm from './PropertyForm.jsx'
import BudgetInWords from '../../../shared/ui/BudgetInWords.jsx'
import EmptyState from '../../../shared/dashboard/EmptyState.jsx'
import {
  createPropertyListing,
  deletePropertyListing,
  fetchMyPropertyListings,
  fetchPropertyListing,
  fetchPropertyListings,
  updatePropertyListing,
  updatePropertyListingImages,
  updatePropertyListingStatus,
  sendPropertyRequest,
} from '../propertyApi.js'
import { useLanguage } from '../../../i18n/LanguageContext.jsx'
import { useProfileGate, useResumeGatedAction } from '../../../shared/hooks/useProfileGate.js'

const FIELD_CLASS = 'h-10 rounded-xl border border-oc-line bg-white px-3 text-sm text-oc-ink outline-none transition placeholder:text-oc-faint focus:border-ocbrand-400 focus:ring-2 focus:ring-ocbrand-100'

// Which lifecycle moves are offered as a button, per status. The server owns the
// rule; this only decides what is worth showing, and an illegal move it somehow
// offered would still be refused there.
const STATUS_ACTIONS = {
  DRAFT: [{ status: 'LISTED', labelKey: 'property.action.publish', primary: true }],
  LISTED: [
    { status: 'UNDER_OFFER', labelKey: 'property.action.markUnderOffer' },
    { status: 'SOLD', labelKey: 'property.action.markSold' },
    { status: 'WITHDRAWN', labelKey: 'property.action.withdraw' },
  ],
  UNDER_OFFER: [
    { status: 'SOLD', labelKey: 'property.action.markSold' },
    { status: 'LISTED', labelKey: 'property.action.relist' },
    { status: 'WITHDRAWN', labelKey: 'property.action.withdraw' },
  ],
  WITHDRAWN: [{ status: 'LISTED', labelKey: 'property.action.relist', primary: true }],
  SOLD: [],
}

export default function PropertyBuySellHub({
  activeTab = 'buy',
  onTabChange,
  projects = [],
  defaultCountry = 'India',
}) {
  const { t, td } = useLanguage()
  const { requireCompleteProfile } = useProfileGate()
  // The signed-in account, read from the store the rest of the app already
  // uses. Only used to hide the enquiry action on the seller's own listing;
  // the server refuses a self-request regardless.
  const currentUserId = useSelector((state) => state.auth.user?.id)

  // --- Buy
  const [feed, setFeed] = useState({ listings: [], property_types: [], cities: [] })
  const [loadingFeed, setLoadingFeed] = useState(false)
  const [searchInput, setSearchInput] = useState('')
  const [filters, setFilters] = useState({ search: '', propertyType: '', city: '', bedrooms: '', maxPrice: '' })

  // Search as you type: the search runs once typing pauses, so each keystroke
  // does not send its own request. Clearing the box brings every property back.
  useEffect(() => {
    const timer = setTimeout(() => {
      const search = searchInput.trim()
      setFilters((current) => (current.search === search ? current : { ...current, search }))
    }, 400)
    return () => clearTimeout(timer)
  }, [searchInput])

  // --- Sell
  const [myListings, setMyListings] = useState([])
  const [loadingMine, setLoadingMine] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [editingListing, setEditingListing] = useState(null)
  const [busyId, setBusyId] = useState(null)
  const [sellMessage, setSellMessage] = useState('')

  // --- Shared
  // The form renders above the listing grid, so opening it from a card lower
  // down would otherwise put it off-screen and look like nothing happened.
  const formRef = useRef(null)
  useEffect(() => {
    if (showForm) formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [showForm, editingListing])

  const [openListing, setOpenListing] = useState(null)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [offerAmount, setOfferAmount] = useState('')
  const [sendingRequest, setSendingRequest] = useState(false)
  const [requestMessage, setRequestMessage] = useState('')

  // Only the newest search may fill the grid: changing filters quickly sends
  // several requests, and an older answer arriving last must not overwrite it.
  const feedRequestRef = useRef(0)
  const loadFeed = useCallback(async () => {
    const requestId = ++feedRequestRef.current
    setLoadingFeed(true)
    try {
      const nextFeed = await fetchPropertyListings(filters)
      if (requestId === feedRequestRef.current) setFeed(nextFeed)
    } catch {
      if (requestId === feedRequestRef.current) setFeed({ listings: [], property_types: [], cities: [] })
    } finally {
      if (requestId === feedRequestRef.current) setLoadingFeed(false)
    }
  }, [filters])

  const loadMine = useCallback(async () => {
    setLoadingMine(true)
    try {
      setMyListings(await fetchMyPropertyListings())
    } catch {
      setMyListings([])
    } finally {
      setLoadingMine(false)
    }
  }, [])

  useEffect(() => {
    if (activeTab === 'buy') loadFeed()
  }, [activeTab, loadFeed])

  useEffect(() => {
    if (activeTab === 'sell') loadMine()
  }, [activeTab, loadMine])

  /** Always re-read the listing, because the detail response is the one that
      decides whether the seller's contact may be shown. */
  const openDetail = async (listing) => {
    setOfferAmount('')
    setRequestMessage('')
    setLoadingDetail(true)
    try {
      setOpenListing(await fetchPropertyListing(listing.id))
    } catch {
      setOpenListing(listing)
    } finally {
      setLoadingDetail(false)
    }
  }

  const saveListing = async (payload, galleryUrls, { publish = false } = {}) => {
    setSellMessage('')
    const saved = editingListing
      ? await updatePropertyListing(editingListing.id, payload)
      : await createPropertyListing(payload)
    // The gallery is a separate call by design: images are replaced as a whole
    // ordered list rather than edited one position at a time.
    await updatePropertyListingImages(saved.id, galleryUrls)
    let message = editingListing ? t('property.msg.updated') : t('property.msg.draftSaved')
    if (publish) {
      // Save & Publish: the same DRAFT -> LISTED move as the Publish button.
      // The listing is already saved by now, so a refusal here leaves a draft
      // and says so rather than reopening the form.
      try {
        await updatePropertyListingStatus(saved.id, 'LISTED')
        message = t('property.msg.published')
      } catch {
        message = t('property.msg.publishFailed')
      }
    }
    setShowForm(false)
    setEditingListing(null)
    setSellMessage(message)
    await loadMine()
  }

  const changeStatus = async (listing, status) => {
    setBusyId(listing.id)
    setSellMessage('')
    try {
      await updatePropertyListingStatus(listing.id, status)
      setSellMessage(t('property.msg.statusUpdated'))
      await loadMine()
    } catch (error) {
      setSellMessage(td(error.response?.data?.detail) || t('property.msg.statusFailed'))
    } finally {
      setBusyId(null)
    }
  }

  const removeListing = async (listing) => {
    setBusyId(listing.id)
    setSellMessage('')
    try {
      await deletePropertyListing(listing.id)
      setSellMessage(t('property.msg.deleted'))
      await loadMine()
    } catch (error) {
      setSellMessage(td(error.response?.data?.detail) || t('property.msg.deleteFailed'))
    } finally {
      setBusyId(null)
    }
  }

  /**
   * The seller's actions, run from the opened property rather than the card.
   *
   * Both delegate to the handlers above — the status move and the delete are
   * unchanged — and only add what an open panel needs afterwards: re-read the
   * listing so the panel shows its new status, and close it once the listing it
   * was showing no longer exists.
   */
  const changeStatusFromPanel = async (listing, status) => {
    await changeStatus(listing, status)
    try {
      setOpenListing(await fetchPropertyListing(listing.id))
    } catch {
      setOpenListing(null)
    }
  }

  const removeFromPanel = async (listing) => {
    await removeListing(listing)
    setOpenListing(null)
  }

  /**
   * Send the seller an enquiry about the open property.
   *
   * Only the listing id and an optional offer leave the browser. The seller is
   * resolved from the listing on the server, so nothing here can name a
   * different receiver. Acceptance, the conversation and contact visibility all
   * stay with the existing request flow.
   *
   * An enquiry is a request, so it needs a complete profile. The listing and
   * offer go with the gated action and are sent as they were after it.
   */
  const sendRequest = async (listingId = openListing?.id, offer = offerAmount) => {
    if (!listingId) return
    if (requireCompleteProfile('sendPropertyEnquiry', { listingId, offer })) return
    setSendingRequest(true)
    setRequestMessage('')
    try {
      await sendPropertyRequest(listingId, offer)
      setRequestMessage(t('property.request.sent'))
      // Re-read so the panel reflects the enquiry that now exists.
      setOpenListing(await fetchPropertyListing(listingId))
    } catch (error) {
      setRequestMessage(td(error.response?.data?.detail) || t('property.request.failed'))
    } finally {
      setSendingRequest(false)
    }
  }

  useResumeGatedAction({
    sendPropertyEnquiry: ({ listingId, offer }) => sendRequest(listingId, offer),
  })

  const tabs = [
    { id: 'buy', label: t('property.tab.buy'), icon: Search },
    { id: 'sell', label: t('property.tab.sell'), icon: Store },
  ]
  // Always Buy then Sell, whichever is selected: choosing a tab only changes
  // its selected styling, never where the two buttons sit. (The order used to
  // be reversed while Sell was active, which swapped the buttons on every
  // click.) The caller still decides which tab is selected first.
  const orderedTabs = tabs

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex gap-1 overflow-x-auto rounded-2xl border border-slate-200 bg-white p-1">
        {orderedTabs.map((tab) => {
          const active = activeTab === tab.id
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onTabChange(tab.id)}
              aria-pressed={active}
              className={`inline-flex h-10 shrink-0 items-center gap-2 rounded-xl px-5 text-sm font-bold transition ${
                active ? 'bg-brand-700 text-white shadow-sm' : 'text-graphite/60 hover:bg-slate-50 hover:text-graphite'
              }`}
            >
              <tab.icon className="h-4 w-4" />
              {tab.label}
            </button>
          )
        })}
      </div>
      {/* Add Property sits on the tab row while Sell is open, as in the reference. */}
      {activeTab === 'sell' && !showForm && (
        <button
          type="button"
          onClick={() => {
            setEditingListing(null)
            setShowForm(true)
          }}
          className="inline-flex h-11 items-center gap-2 rounded-xl bg-oc-deep px-5 text-sm font-bold text-white shadow-[0_11px_25px_rgba(18,107,69,.18)] transition hover:-translate-y-0.5 hover:bg-oc-green"
        >
          <Plus className="h-4 w-4" />
          {t('property.addProperty')}
        </button>
      )}
      </div>

      {/* ------------------------------------------------------------- BUY */}
      {activeTab === 'buy' && (
        <div className="space-y-4">
          <form
            onSubmit={(event) => {
              event.preventDefault()
              // Enter searches straight away instead of waiting for the pause.
              const search = searchInput.trim()
              setFilters((current) => (current.search === search ? current : { ...current, search }))
            }}
            className="grid gap-2 rounded-2xl border border-oc-line bg-white p-3 sm:grid-cols-2 lg:grid-cols-5"
          >
            <input
              type="search"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder={t('property.searchPh')}
              aria-label={t('property.searchPh')}
              className={`${FIELD_CLASS} lg:col-span-2`}
            />
            <select
              value={filters.propertyType}
              onChange={(event) => setFilters((current) => ({ ...current, propertyType: event.target.value }))}
              aria-label={t('property.type')}
              className={FIELD_CLASS}
            >
              <option value="">{t('property.filter.allTypes')}</option>
              {feed.property_types.map((type) => (
                <option key={type} value={type}>{t(`property.type.${type}`)}</option>
              ))}
            </select>
            <select
              value={filters.city}
              onChange={(event) => setFilters((current) => ({ ...current, city: event.target.value }))}
              aria-label={t('property.form.cityPh')}
              className={FIELD_CLASS}
            >
              <option value="">{t('property.filter.allCities')}</option>
              {/* City names as the sellers typed them. */}
              {feed.cities.map((city) => (
                <option key={city} value={city}>{td(city)}</option>
              ))}
            </select>
            <select
              value={filters.bedrooms}
              onChange={(event) => setFilters((current) => ({ ...current, bedrooms: event.target.value }))}
              aria-label={t('property.bedrooms')}
              className={FIELD_CLASS}
            >
              <option value="">{t('property.filter.anyBhk')}</option>
              {[1, 2, 3, 4, 5].map((count) => (
                <option key={count} value={count}>{t('ui.owner.bhkPlus', { count })}</option>
              ))}
            </select>
          </form>

          {loadingFeed ? (
            <div className="grid place-items-center py-10 text-oc-muted">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : feed.listings.length ? (
            /* The same card as Sell, so a property reads the same whether you
               are browsing the market or managing your own. */
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {feed.listings.map((listing) => (
                <SellListingCard key={listing.id} listing={listing} browse onOpen={() => openDetail(listing)} />
              ))}
            </div>
          ) : (
            <EmptyState icon={Search} title={t('property.empty.noneTitle')} message={t('property.empty.noneMessage')} />
          )}
        </div>
      )}

      {/* ------------------------------------------------------------ SELL */}
      {activeTab === 'sell' && (
        <div className="space-y-4">
          {sellMessage && (
            <div className="rounded-xl border border-ocbrand-200 bg-oc-mint px-4 py-2.5 text-[13px] font-semibold text-oc-deep">
              {sellMessage}
            </div>
          )}

          <div ref={formRef}>
            {showForm && (
              <PropertyForm
                // Keyed by listing so switching Edit from one property to
                // another remounts the form with that property's values.
                key={editingListing?.id || 'new'}
                listing={editingListing}
                projects={projects}
                defaultCountry={defaultCountry}
                onSaved={saveListing}
                onCancel={() => {
                  setShowForm(false)
                  setEditingListing(null)
                }}
              />
            )}
          </div>

          {loadingMine ? (
            <div className="grid place-items-center py-10 text-oc-muted">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : myListings.length ? (
            /* The seller's own listings: photo cards with the status on the
               photo and one "View & manage" button, which opens the same
               panel the card always opened. */
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {myListings.map((listing) => (
                <SellListingCard key={listing.id} listing={listing} onOpen={() => openDetail(listing)} />
              ))}
            </div>
          ) : (
            <EmptyState icon={Store} title={t('property.empty.mineTitle')} message={t('property.empty.mineMessage')} />
          )}
        </div>
      )}

      {loadingDetail && !openListing && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/30">
          <Loader2 className="h-6 w-6 animate-spin text-white" />
        </div>
      )}
      {openListing && (
        <PropertyDetailPanel
          listing={openListing}
          onClose={() => setOpenListing(null)}
          footer={
            // The seller's own actions live here rather than on the card, so a
            // listing tile stays a tile and every action is one place. Edit,
            // the status moves and delete all call the same handlers the card
            // used to; nothing about what they do has changed.
            openListing.seller_id === currentUserId ? (
              <div className="flex w-full flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setEditingListing(openListing)
                    setOpenListing(null)
                    onTabChange('sell')
                    setShowForm(true)
                  }}
                  className="inline-flex h-10 items-center gap-2 rounded-xl bg-oc-green px-4 text-sm font-bold text-white shadow-[0_11px_25px_rgba(18,107,69,.18)] transition hover:-translate-y-0.5 hover:bg-oc-deep"
                >
                  <Pencil className="h-4 w-4" />
                  {t('property.editProperty')}
                </button>
                {(STATUS_ACTIONS[openListing.status] || []).map((action) => (
                  <button
                    key={action.status}
                    type="button"
                    disabled={busyId === openListing.id}
                    onClick={() => changeStatusFromPanel(openListing, action.status)}
                    className={`inline-flex h-10 items-center rounded-xl px-4 text-sm font-bold transition disabled:opacity-60 ${
                      action.primary
                        ? 'bg-oc-green text-white hover:bg-oc-deep'
                        : 'border border-oc-line text-oc-ink hover:bg-oc-sunken'
                    }`}
                  >
                    {t(action.labelKey)}
                  </button>
                ))}
                <button
                  type="button"
                  disabled={busyId === openListing.id}
                  onClick={() => removeFromPanel(openListing)}
                  className="inline-flex h-10 items-center rounded-xl border border-oc-line px-4 text-sm font-bold text-warm transition hover:bg-warm/10 disabled:opacity-60"
                >
                  {t('dash.common.delete')}
                </button>
              </div>
            ) : activeTab === 'buy' ? (
              <div className="flex w-full flex-wrap items-center gap-2">
                <div className="w-40">
                  <input
                    type="number"
                    min="1"
                    value={offerAmount}
                    onChange={(event) => setOfferAmount(event.target.value)}
                    placeholder={t('property.request.offerPh')}
                    aria-label={t('property.request.offerPh')}
                    className="w-full rounded-xl border border-oc-line px-3 py-2 text-sm outline-none focus:border-ocbrand-400"
                  />
                  {/* The offer is in the property's own currency, so the words
                      follow the listing's country rather than the viewer's. */}
                  <BudgetInWords value={offerAmount} country={openListing.country} />
                </div>
                <button
                  type="button"
                  disabled={sendingRequest}
                  onClick={() => sendRequest()}
                  className="inline-flex h-10 items-center gap-2 rounded-xl bg-oc-green px-4 text-sm font-bold text-white shadow-[0_11px_25px_rgba(18,107,69,.18)] transition hover:-translate-y-0.5 hover:bg-oc-deep disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {sendingRequest ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  {t('property.request.send')}
                </button>
                {requestMessage && (
                  <span className="text-xs font-semibold text-oc-deep">{requestMessage}</span>
                )}
              </div>
            ) : null
          }
        />
      )}
    </div>
  )
}
