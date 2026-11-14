import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  BadgeCheck, BriefcaseBusiness, Building2, Download, FileText, Globe, HardHat,
  Home, Lock, Mail, MapPin, MessageSquare, Phone, ShieldCheck, Star, X,
} from 'lucide-react'
import Logo from '../../../shared/ui/Logo.jsx'
import { SmartImage } from '../../../shared/ui/ui.jsx'
import { avatarFromPath } from '../../../shared/ui/avatars.js'
import { imageUrl } from '../../../shared/api/apiClient.js'
import { fetchContractorProfile } from '../../accounts/publicProfileApi.js'
import { hasRating, ratingLabel } from '../../../shared/utils/ratingLabel.js'
import { sendConversationMessage, startConversation } from '../../messaging/messagesApi.js'
import { useLanguage } from '../../../i18n/LanguageContext.jsx'
import { BuilderTierBadge } from '../../billing/subscription/TierBadge.jsx'
import {
  optionLabel,
  BUSINESS_TYPE_KEYS,
  DOCUMENT_TYPE_KEYS,
  EQUIPMENT_OPTION_KEYS,
  SERVICE_OPTION_KEYS,
} from '../../../i18n/optionKeys.js'

// What a locked contact tile shows in place of a detail that has not been
// unlocked: a mask, in no language and resembling no real contact.
const MASKED_CONTACT = '••••••••••'

const tabs = ['overview', 'projects', 'reviews', 'services', 'documents', 'gallery', 'equipment']
// Translation keys for the tab ids above; only the label is translated.
const TAB_LABEL_KEYS = {
  overview: 'ui.overview',
  projects: 'ui.projects',
  reviews: 'ui.contractor.tabReviews',
  services: 'dash.msg.services',
  documents: 'ps.documents',
  gallery: 'cps.gallery',
  equipment: 'dash.engineer.analytics.equipment',
}

// True inside the pop-up version (House Owner > Find Builders), where every
// card, heading and line is drawn smaller than on the full profile page.
const CompactContext = createContext(false)

// The pop-up's frame: a dimmed backdrop (click it to close) and a centred,
// scrollable window with its own close button. The window keeps one fixed
// height on every tab, so it does not shrink when a shorter tab is opened. Defined here, not inside the
// profile, so typing in the window never rebuilds what is in it.
function ModalFrame({ label, closeLabel, onClose, children }) {
  return (
    <div className="fixed inset-0 z-[120] grid place-items-center bg-slate-900/50 p-3 backdrop-blur-sm sm:p-6" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <div role="dialog" aria-modal="true" aria-label={label} className="relative h-[88vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-cream shadow-2xl sm:h-[min(580px,90vh)]">
        <button type="button" onClick={onClose} aria-label={closeLabel} className="absolute right-5 top-5 z-30 grid h-7 w-7 place-items-center rounded-full border border-brand-100 bg-white text-graphite/60 shadow-sm transition hover:text-graphite">
          <X className="h-4 w-4" />
        </button>
        {children}
      </div>
    </div>
  )
}

function InfoCard({ title, children }) {
  const compact = useContext(CompactContext)
  return (
    <section className={`rounded-2xl border border-brand-100 bg-white shadow-card ${compact ? 'p-3.5' : 'p-5'}`}>
      <h3 className={`font-display font-extrabold text-graphite ${compact ? 'text-sm' : 'text-base'}`}>{title}</h3>
      <div className={compact ? 'mt-2.5' : 'mt-4'}>{children}</div>
    </section>
  )
}

function StatBox({ icon: Icon, value, label }) {
  const compact = useContext(CompactContext)
  return (
    <div className={`flex items-center rounded-xl border border-brand-100 bg-white ${compact ? 'gap-2 p-2.5' : 'gap-3 p-4'}`}>
      <span className={`grid place-items-center rounded-xl bg-brand-50 text-brand-700 ${compact ? 'h-8 w-8' : 'h-11 w-11'}`}><Icon className={compact ? 'h-4 w-4' : 'h-5 w-5'} /></span>
      <span>
        <b className={`block font-display text-graphite ${compact ? 'text-base' : 'text-xl'}`}>{value}</b>
        <small className={`text-graphite/55 ${compact ? 'text-[11px]' : ''}`}>{label}</small>
      </span>
    </div>
  )
}

function EmptyPanel({ title, message }) {
  const compact = useContext(CompactContext)
  return (
    <div className={`rounded-2xl border border-dashed border-brand-100 bg-cream/40 text-center ${compact ? 'p-4' : 'p-8'}`}>
      <p className={`font-display font-bold text-graphite ${compact ? 'text-sm' : 'text-base'}`}>{title}</p>
      <p className={`mt-1 text-graphite/55 ${compact ? 'text-xs' : 'text-sm'}`}>{message}</p>
    </div>
  )
}

function DetailLine({ label, value }) {
  const { t } = useLanguage()
  const compact = useContext(CompactContext)
  return (
    <p className={`flex items-center justify-between gap-4 border-b border-brand-50 text-graphite/70 ${compact ? 'py-1.5 text-xs' : 'py-2 text-sm'}`}>
      <span>{label}</span>
      <b className="text-right text-graphite">{value || t('cpp.notSet')}</b>
    </p>
  )
}

function Chip({ icon: Icon, children }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-xl bg-brand-50 px-3 py-2 text-xs font-bold text-brand-700">
      {Icon && <Icon className="h-4 w-4" />}
      {children}
    </span>
  )
}

/**
 * The stored document entry is "<Document Type>: <url>". Only the type is shown,
 * and it is an English value from the upload form's own list, so it is read
 * through the same key map the form uses. Anything the map does not hold falls
 * back to `td`.
 */
// A stored entry is "<Type>: <url>", or a bare "<url>" from an older upload.
function splitDocumentEntry(documentName) {
  const entry = String(documentName || '').trim()
  if (entry.startsWith('/') || entry.startsWith('http')) return { type: '', url: entry }
  const separatorIndex = entry.indexOf(': ')
  if (separatorIndex < 0) return { type: entry, url: '' }
  return { type: entry.slice(0, separatorIndex).trim(), url: entry.slice(separatorIndex + 2).trim() }
}

function documentTypeLabel(documentName, t, td) {
  const storedType = splitDocumentEntry(documentName).type
  if (!storedType) return t('cps.documentType')
  return DOCUMENT_TYPE_KEYS[storedType] ? t(DOCUMENT_TYPE_KEYS[storedType]) : td(storedType)
}

// Uploads are served from /files/<id> (older ones from /uploads/); imageUrl
// adds the viewer's token, and the backend decides whether they may open it.
function documentUrlFromLabel(documentName) {
  const possibleUrl = splitDocumentEntry(documentName).url
  return possibleUrl.startsWith('/files/') || possibleUrl.startsWith('/uploads/') || possibleUrl.startsWith('http') ? possibleUrl : ''
}

/**
 * A builder's public profile.
 *
 * As a page (route /contractors/:contractorId) it fills the screen. With
 * `variant="modal"` it opens as a centred window over the screen that opened
 * it -- House Owner > Find Builders -- with the same content drawn smaller,
 * for the builder `contractorId`, closed by `onClose`. `projectId`, when given,
 * limits contact details to that project's accepted request.
 */
export default function ContractorProfileDetails({ variant = 'page', contractorId: contractorIdProp = null, projectId = null, onClose = null }) {
  const { t, td } = useLanguage()
  const routeParams = useParams()
  const contractorId = contractorIdProp || routeParams.contractorId
  const navigate = useNavigate()
  const isModal = variant === 'modal'
  const close = () => (onClose ? onClose() : navigate(-1))

  // The window closes on Escape, and the page behind it does not scroll.
  useEffect(() => {
    if (!isModal) return undefined
    const onKeyDown = (event) => { if (event.key === 'Escape') close() }
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', onKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', onKeyDown)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isModal])
  const [profile, setProfile] = useState(null)
  const [errorMessage, setErrorMessage] = useState('')
  const [activeTab, setActiveTab] = useState('overview')
  const [messageComposerOpen, setMessageComposerOpen] = useState(false)
  const [messageBody, setMessageBody] = useState('')
  const [messageStatus, setMessageStatus] = useState('')
  const [messageSending, setMessageSending] = useState(false)

  useEffect(() => {
    fetchContractorProfile(contractorId, projectId)
      .then(setProfile)
      .catch((error) => setErrorMessage(error.response?.data?.detail || t('cpd.errLoadProfile')))
  }, [contractorId])

  const galleryImages = useMemo(() => profile?.gallery || [], [profile])

  if (errorMessage) {
    if (isModal) {
      return <ModalFrame label={td(profile?.company_name) || t('dash.contractor.loadingProfile')} closeLabel={t('dash.common.close')} onClose={close}><p className="p-8 text-center text-sm font-bold text-graphite">{errorMessage}</p></ModalFrame>
    }
    return (
      <main className="grid min-h-screen place-items-center bg-cream p-6">
        <div className="rounded-2xl border border-brand-100 bg-white p-6 text-center shadow-card">
          <p className="font-display text-lg font-bold text-graphite">{errorMessage}</p>
          <button onClick={() => navigate(-1)} className="mt-4 rounded-xl bg-brand-700 px-4 py-2 text-sm font-bold text-white">{t('dash.contractor.goBack')}</button>
        </div>
      </main>
    )
  }

  if (!profile) {
    if (isModal) {
      return <ModalFrame label={td(profile?.company_name) || t('dash.contractor.loadingProfile')} closeLabel={t('dash.common.close')} onClose={close}><p className="p-8 text-center text-sm font-bold text-graphite/60">{t('dash.contractor.loadingProfile')}</p></ModalFrame>
    }
    return <main className="grid min-h-screen place-items-center bg-cream text-sm font-bold text-graphite/60">{t('dash.contractor.loadingProfile')}</main>
  }

  const servicesOffered = profile.services_offered || []
  const serviceLocations = profile.service_locations || []
  const equipmentOwned = profile.equipment_owned || []
  const documentList = profile.documents || []
  const documentTypes = profile.document_types || []
  const completedProjectDetails = profile.completed_project_details || []
  const contactUnlocked = profile.can_view_contact !== false
  const documentsUnlocked = profile.can_view_documents !== false
  const reviewCount = Number(profile.review_count || 0)
  const businessTypeLabel = profile.business_type ? optionLabel(t, BUSINESS_TYPE_KEYS, profile.business_type) : ''

  const sendDirectMessage = async (event) => {
    event.preventDefault()
    if (!contactUnlocked) {
      setMessageStatus(t('dash.owner.supplierModal.unlockNote'))
      return
    }
    if (!messageBody.trim()) {
      setMessageStatus(t('dash.contractor.typeMessage'))
      return
    }
    setMessageSending(true)
    setMessageStatus('')
    try {
      const conversation = await startConversation({
        receiver_id: profile.user_id,
        title: profile.company_name || profile.name,
      })
      await sendConversationMessage({
        conversation_id: conversation.id,
        body: messageBody.trim(),
      })
      setMessageBody('')
      setMessageStatus(t('dash.contractor.messageSent'))
    } catch (error) {
      setMessageStatus(error.response?.data?.detail || t('cpd.errSendMessage'))
    } finally {
      setMessageSending(false)
    }
  }

  const renderTabContent = () => {
    if (activeTab === 'overview') {
      return (
        <section className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
          <div className="space-y-4">
            <InfoCard title={t('dash.contractor.aboutBuilder')}>
              <p className="text-sm leading-relaxed text-graphite/70">{td(profile.about) || t('dash.contractor.noCompanyDescription')}</p>
            </InfoCard>
            {/* The fixed four-step "Work Process" that used to follow was the same
                for every builder, so it described none of them. */}
          </div>
          <InfoCard title={t('dash.contractor.keyInformation')}>
            <DetailLine label={t('dash.owner.supplierModal.businessType')} value={profile.business_type ? optionLabel(t, BUSINESS_TYPE_KEYS, profile.business_type) : ''} />
            <DetailLine label={t('dash.owner.supplierModal.registrationYear')} value={profile.registration_year} />
            <DetailLine label={t('dash.contractor.teamSize')} value={profile.team_size} />
            <DetailLine label={t('dash.contractor.insurance')} value={profile.insurance_available ? t('dash.common.yes') : t('dash.common.no')} />
            {/* Business identifiers are shared once a request is accepted, the
                same rule as phone and email; until then they read as such
                rather than as "Not set". */}
            <DetailLine label={t('dash.contractor.license')} value={contactUnlocked ? profile.license_number : t('cpd.privateAfterAccept')} />
            <DetailLine label={t('dash.owner.supplierModal.gstin')} value={contactUnlocked ? profile.gstin : t('cpd.privateAfterAccept')} />
            <DetailLine label={t('dash.owner.supplierModal.pan')} value={contactUnlocked ? profile.pan : t('cpd.privateAfterAccept')} />
            <DetailLine label={t('dash.owner.supplierModal.website')} value={contactUnlocked ? profile.website : t('cpd.privateAfterAccept')} />
            <DetailLine label={t('dash.common.pincode')} value={profile.pincode} />
          </InfoCard>
        </section>
      )
    }

    if (activeTab === 'projects') {
      return (
        <InfoCard title={t('dash.contractor.completedProjects')}>
          {/* The builder's own portfolio, each project with only the photos the
              builder added to it. Gallery images are never presented as a
              project's photos: the gallery has its own tab. */}
          {completedProjectDetails.length ? (
            <div className={`grid grid-cols-1 ${isModal ? 'gap-2.5 sm:grid-cols-2' : 'gap-4 md:grid-cols-2 xl:grid-cols-4'}`}>
              {completedProjectDetails.map((project, index) => {
                const projectImages = Array.isArray(project.images) ? project.images : []
                return (
                  <article key={`${project.title}-${index}`} className="overflow-hidden rounded-xl border border-brand-100 bg-white">
                    {projectImages.length > 0 && (
                      <div className={`grid gap-1 ${projectImages.length > 1 ? 'grid-cols-2' : 'grid-cols-1'}`}>
                        {projectImages.slice(0, 4).map((image) => (
                          <SmartImage key={image} src={imageUrl(image)} alt="" className={`w-full object-cover ${projectImages.length > 1 ? (isModal ? 'h-16' : 'h-24') : (isModal ? 'h-28' : 'h-44')}`} />
                        ))}
                      </div>
                    )}
                    <div className={isModal ? 'p-2.5 text-xs' : 'p-4 text-sm'}>
                      <p className="font-bold text-graphite">{td(project.title) || t('dash.contractor.completedProjectN', { n: index + 1 })}</p>
                      {project.location && <p className="mt-1 flex items-center gap-1 text-xs font-semibold text-graphite/55"><MapPin className="h-3.5 w-3.5" /> {td(project.location)}</p>}
                      {project.description && <p className="mt-2 text-xs leading-relaxed text-graphite/60">{td(project.description)}</p>}
                    </div>
                  </article>
                )
              })}
            </div>
          ) : (
            <EmptyPanel title={t('dash.contractor.noCompletedProjects')} message={t('dash.contractor.noCompletedProjectsSub')} />
          )}
        </InfoCard>
      )
    }

    if (activeTab === 'reviews') {
      // Only real reviews from the reviews table; with none, the rating reads
      // "New" and the list says there are no reviews yet.
      const reviews = Array.isArray(profile.reviews) ? profile.reviews : []
      return (
        <section className="grid grid-cols-1 gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
          <InfoCard title={t('dash.contractor.customerRating')}>
            <div className="text-center">
              <p className={`font-display font-extrabold text-graphite ${isModal ? 'text-2xl' : 'text-5xl'}`}>{ratingLabel(profile.rating, profile.review_count, t)}</p>
              {reviewCount > 0 && <p className="mt-2 text-sm font-bold text-gold">{t('cpd.reviewCount', { count: reviewCount })}</p>}
              <p className="mt-1 text-xs text-graphite/50">{t('dash.contractor.reviewsAfterCompletion')}</p>
            </div>
          </InfoCard>
          <InfoCard title={t('dash.contractor.customerReviews')}>
            {reviews.length ? (
              <div className="space-y-3">
                {reviews.map((review, index) => (
                  <article key={`${review.created_at}-${index}`} className="rounded-xl border border-brand-100 bg-white p-4">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-bold text-graphite">{td(review.reviewer_name)}</p>
                      <span className="inline-flex items-center gap-1 text-xs font-bold text-gold"><Star className="h-3.5 w-3.5 fill-current" /> {review.rating}</span>
                    </div>
                    {review.comment && <p className="mt-1.5 text-xs leading-relaxed text-graphite/65">{td(review.comment)}</p>}
                  </article>
                ))}
              </div>
            ) : (
              <EmptyPanel title={t('dash.contractor.noReviews')} message={t('dash.contractor.noReviewsSub')} />
            )}
          </InfoCard>
        </section>
      )
    }

    if (activeTab === 'services') {
      return (
        <section className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
          <InfoCard title={t('ps.con.servicesOffered')}>
            {servicesOffered.length ? (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                {servicesOffered.map((service) => (
                  <div key={service} className={`flex items-center rounded-xl border border-brand-100 bg-white ${isModal ? 'gap-2 p-2.5' : 'gap-3 p-4'}`}>
                    <Home className="h-5 w-5 text-brand-700" />
                    <span className="text-sm font-bold text-graphite">{optionLabel(t, SERVICE_OPTION_KEYS, service)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyPanel title={t('cpd.noServices')} message={t('cpd.servicesEmpty')} />
            )}
          </InfoCard>
          <InfoCard title={t('ps.con.serviceLocations')}>
            {serviceLocations.length ? (
              <div className="flex flex-wrap gap-2">
                {serviceLocations.map((location) => <Chip key={location} icon={MapPin}>{td(location)}</Chip>)}
              </div>
            ) : (
              <EmptyPanel title={t('cpd.noLocations')} message={t('cpd.locationsEmpty')} />
            )}
          </InfoCard>
        </section>
      )
    }

    if (activeTab === 'documents') {
      return (
        <InfoCard title={t('cpd.documentsCerts')}>
          {!documentsUnlocked && documentTypes.length ? (
            // Which documents the builder holds is shown to everyone; the files
            // themselves only once a request between the two is accepted.
            <div className="space-y-3">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                {documentTypes.map((documentType) => (
                  <div key={documentType} className="flex items-center justify-between rounded-xl border border-brand-100 bg-white px-4 py-3 text-xs font-bold text-graphite">
                    <span className="flex items-center gap-2"><FileText className="h-4 w-4 text-slate-500" /> {DOCUMENT_TYPE_KEYS[documentType] ? t(DOCUMENT_TYPE_KEYS[documentType]) : td(documentType)}</span>
                    <Lock className="h-4 w-4 text-graphite/40" />
                  </div>
                ))}
              </div>
              <p className="rounded-xl border border-brand-100 bg-brand-50 px-3 py-2 text-xs font-semibold text-brand-800">{t('cpd.documentsLocked')}</p>
            </div>
          ) : documentList.length ? (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {documentList.map((documentName) => {
                const documentHref = documentUrlFromLabel(documentName)
                return (
                  <a
                    key={documentName}
                    href={documentHref ? imageUrl(documentHref) : undefined}
                    target={documentHref ? '_blank' : undefined}
                    rel="noreferrer"
                    className="flex items-center justify-between rounded-xl border border-brand-100 bg-white px-4 py-3 text-xs font-bold text-graphite"
                  >
                    <span className="flex items-center gap-2"><FileText className="h-4 w-4 text-slate-500" /> {documentTypeLabel(documentName, t, td)}</span>
                    <Download className="h-4 w-4 text-brand-700" />
                  </a>
                )
              })}
            </div>
          ) : (
            <EmptyPanel title={t('cpd.noDocuments')} message={t('cpd.documentsEmpty')} />
          )}
        </InfoCard>
      )
    }

    if (activeTab === 'gallery') {
      return (
        <InfoCard title={t('cpd.projectGallery')}>
          {galleryImages.length ? (
            <div className={`grid ${isModal ? 'grid-cols-3 gap-2 sm:grid-cols-4' : 'grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5'}`}>
              {galleryImages.map((item) => <SmartImage key={item} src={imageUrl(item)} alt="" className={`rounded-xl object-cover ${isModal ? 'h-20' : 'h-44'}`} />)}
            </div>
          ) : (
            <EmptyPanel title={t('cpd.noGallery')} message={t('cpd.galleryEmpty')} />
          )}
        </InfoCard>
      )
    }

    return (
      <InfoCard title={t('ps.con.equipmentOwned')}>
        {equipmentOwned.length ? (
          <div className={`grid grid-cols-1 ${isModal ? 'gap-2 sm:grid-cols-3' : 'gap-3 md:grid-cols-2 xl:grid-cols-4'}`}>
            {equipmentOwned.map((item) => (
              <div key={item} className={`flex items-center rounded-xl border border-brand-100 bg-white ${isModal ? 'gap-2 p-2.5' : 'gap-3 p-4'}`}>
                <Building2 className="h-5 w-5 text-brand-700" />
                <span className="text-sm font-bold text-graphite">{optionLabel(t, EQUIPMENT_OPTION_KEYS, item)}</span>
              </div>
            ))}
          </div>
        ) : (
          <EmptyPanel title={t('cpd.noEquipment')} message={t('cpd.equipmentEmpty')} />
        )}
      </InfoCard>
    )
  }

  // The window's header: one small card with the photo, the company (its logo
  // as a small mark), the key figures on one line, and the contact details in
  // a single short row -- instead of the page's large photo, logo tile, stat
  // boxes and separate contact card.
  const compactHeader = (
    <section className="rounded-2xl border border-brand-100 bg-white p-3 pr-11 shadow-card">
      <div className="flex items-start gap-3">
        <SmartImage src={avatarFromPath(profile.profile_image_url, 'BUILDER')} alt={profile.name} className="h-14 w-14 shrink-0 rounded-full object-cover" />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            {profile.company_logo_url && (
              <SmartImage src={imageUrl(profile.company_logo_url)} alt="" className="h-6 w-6 shrink-0 rounded-md object-cover ring-1 ring-brand-100" />
            )}
            <h1 className="truncate font-display text-base font-extrabold text-graphite">{td(profile.company_name)}</h1>
            {/* PRO / PREMIUM: only while the builder's paid plan is in force (server). */}
            <BuilderTierBadge builderId={profile.user_id || contractorId} />
            {profile.is_verified === true ? (
              <span data-testid="verified-partner-badge" className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-brand-50 px-2 py-0.5 text-[10px] font-bold text-brand-700">
                <BadgeCheck className="h-3 w-3" /> {t('dash.common.verified')}
              </span>
            ) : !profile.profile_complete && (
              <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-600">{t('dash.contractor.profilePending')}</span>
            )}
          </div>
          <p className="truncate text-[11px] font-semibold text-graphite/60">{[td(profile.name), businessTypeLabel].filter(Boolean).join(' · ')}</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-graphite/65">
            <span className="inline-flex items-center gap-1 text-gold">
              <Star className="h-3.5 w-3.5 fill-current" />
              {hasRating(profile.rating, profile.review_count) ? ratingLabel(profile.rating, profile.review_count, t) : t('dash.common.new')}
            </span>
            <span className="inline-flex items-center gap-1"><HardHat className="h-3.5 w-3.5 text-brand-700" /> {t('ui.contractor.yearsExperiencePlus', { years: profile.experience_years || 0 })}</span>
            <span className="inline-flex items-center gap-1"><BriefcaseBusiness className="h-3.5 w-3.5 text-brand-700" /> {completedProjectDetails.length} {t('cpd.projectsCompleted')}</span>
            <span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5 text-brand-700" /> {contactUnlocked && profile.address ? `${td(profile.address)} - ${profile.pincode || ''}` : profile.pincode}</span>
          </div>
        </div>
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-2 border-t border-brand-50 pt-2.5 text-[11px]">
        {contactUnlocked ? (
          <>
            {profile.phone && <span className="inline-flex items-center gap-1 font-semibold text-graphite/75"><Phone className="h-3.5 w-3.5 text-brand-700" /> {profile.phone}</span>}
            {profile.email && <span className="inline-flex min-w-0 items-center gap-1 font-semibold text-graphite/75"><Mail className="h-3.5 w-3.5 shrink-0 text-brand-700" /> <span className="truncate">{profile.email}</span></span>}
            {profile.website && <span className="inline-flex min-w-0 items-center gap-1 font-semibold text-graphite/75"><Globe className="h-3.5 w-3.5 shrink-0 text-brand-700" /> <span className="truncate">{profile.website}</span></span>}
          </>
        ) : (
          <span className="inline-flex items-center gap-1 font-semibold text-brand-800"><Lock className="h-3.5 w-3.5" /> {t('cpd.contactLocked')}</span>
        )}
        <button
          type="button"
          disabled={!contactUnlocked}
          onClick={() => setMessageComposerOpen((isOpen) => !isOpen)}
          className="ml-auto inline-flex h-7 shrink-0 items-center gap-1.5 rounded-lg bg-brand-700 px-2.5 text-[11px] font-bold text-white disabled:cursor-not-allowed disabled:bg-graphite/25"
        >
          <MessageSquare className="h-3.5 w-3.5" /> {t('cpd.sendMessage')}
        </button>
      </div>
      {contactUnlocked && messageComposerOpen && (
        <form onSubmit={sendDirectMessage} className="mt-2 space-y-2 rounded-xl border border-brand-100 bg-cream/40 p-2.5">
          <textarea
            value={messageBody}
            onChange={(event) => setMessageBody(event.target.value)}
            placeholder={t('ui.contractor.messageTo', { name: td(profile.company_name || profile.name) })}
            className="min-h-16 w-full rounded-lg border border-brand-100 bg-white px-2.5 py-1.5 text-xs outline-none focus:border-brand-400"
          />
          <button disabled={messageSending} className="w-full rounded-lg bg-brand-700 py-1.5 text-[11px] font-bold text-white disabled:opacity-60">
            {messageSending ? t('cpp.sending') : t('cpd.send')}
          </button>
          {messageStatus && <p className="text-[11px] font-semibold text-graphite/60">{messageStatus}</p>}
        </form>
      )}
    </section>
  )

  const content = (
      <main className={isModal ? 'space-y-2.5 p-3' : 'mx-auto max-w-[1500px] space-y-4 p-4 sm:p-6'}>
        {!isModal && <div className="text-xs font-semibold text-graphite/55">{t('dash.contractor.dashboardBreadcrumb')} / <span className="text-graphite">{td(profile.company_name)}</span></div>}

        {isModal ? compactHeader : (
        <section className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className={`rounded-2xl border border-brand-100 bg-white shadow-card ${isModal ? 'p-3.5' : 'p-5'}`}>
            <div className={`grid grid-cols-1 ${isModal ? 'gap-3 sm:grid-cols-[88px_minmax(0,1fr)]' : 'gap-5 xl:grid-cols-[170px_minmax(0,1fr)_420px]'}`}>
              <div>
                {/* The builder themselves, not their company mark -- the
                    company logo has its own tile below. */}
                <SmartImage src={avatarFromPath(profile.profile_image_url, 'BUILDER')} alt={profile.name} className={`rounded-full object-cover ${isModal ? 'h-20 w-20' : 'h-36 w-36'}`} />
                <div className={`mt-3 rounded-2xl border border-brand-100 bg-cream/50 ${isModal ? 'w-20 p-2' : 'p-3'}`}>
                  <p className={`font-bold uppercase tracking-wide text-graphite/45 ${isModal ? 'text-[9px]' : 'text-[11px]'}`}>            {t('dash.contractor.companyLogo')}</p>
                  {profile.company_logo_url ? (
                    <SmartImage src={imageUrl(profile.company_logo_url)} alt={profile.company_name} className={`mt-2 rounded-xl object-cover ${isModal ? 'h-12 w-12' : 'h-20 w-20'}`} />
                  ) : (
                    <span className={`mt-2 grid place-items-center rounded-xl bg-white font-bold text-graphite/45 ${isModal ? 'h-12 w-12 text-[9px]' : 'h-20 w-20 text-xs'}`}>            {t('dash.contractor.noLogo')}</span>
                  )}
                </div>
                {/* "Verified" comes only from a live verification decision; a
                    complete profile is not the same thing. */}
                {profile.is_verified === true ? (
                  <span data-testid="verified-partner-badge" className="mt-3 inline-flex items-center gap-1 rounded-full bg-brand-50 px-3 py-1 text-xs font-bold text-brand-700">
                    <BadgeCheck className="h-3.5 w-3.5" /> {t('dash.common.verified')}
                  </span>
                ) : !profile.profile_complete && (
                  <span className="mt-3 inline-flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600">
                    {t('dash.contractor.profilePending')}
                  </span>
                )}
              </div>
              <div>
                <h1 className={`font-display font-extrabold text-graphite ${isModal ? 'text-xl' : 'text-3xl'}`}>{td(profile.company_name)}</h1>
                {/* The builder's name and their own business type. The fixed
                    "Civil Builder & Construction Company" tagline described every
                    builder the same way, whatever they had chosen. */}
                <p className={`mt-1 font-semibold text-graphite/65 ${isModal ? 'text-xs' : 'text-sm'}`}>{[td(profile.name), businessTypeLabel].filter(Boolean).join(' · ')}</p>
                <div className={`flex flex-wrap items-center text-graphite/65 ${isModal ? 'mt-2.5 gap-3 text-xs' : 'mt-4 gap-4 text-sm'}`}>
                  <span className="inline-flex items-center gap-1 text-gold">
                    <Star className="h-4 w-4 fill-current" />
                    {hasRating(profile.rating, profile.review_count) ? t('ui.contractor.ratingValue', { rating: ratingLabel(profile.rating, profile.review_count, t) }) : t('dash.common.new')}
                  </span>
                  <span className="inline-flex items-center gap-1"><ShieldCheck className="h-4 w-4 text-brand-700" /> {t('ui.contractor.yearsExperiencePlus', { years: profile.experience_years || 0 })}</span>
                  {/* The street address is shared with the contact details; the
                      pincode is always shown. */}
                  <span className="inline-flex items-center gap-1"><MapPin className="h-4 w-4 text-brand-700" /> {contactUnlocked && profile.address ? `${td(profile.address)} - ${profile.pincode || ''}` : profile.pincode}</span>
                </div>
                <div className={`flex flex-wrap gap-4 text-xs text-graphite/55 ${isModal ? 'mt-2' : 'mt-5'}`}>
                  {profile.gstin && <span>{t('cpd.gstinLabel')} <b className="text-graphite">{profile.gstin}</b></span>}
                  {profile.pan && <span>{t('cpd.panLabel')} <b className="text-graphite">{profile.pan}</b></span>}
                </div>
              </div>
              {/* Only figures read from this builder's own profile. The on-time
                  delivery rate and happy-client count shown here before were the
                  same invented numbers for every builder, so they are gone. The
                  project count is the builder's portfolio, as listed. */}
              <div className={`grid grid-cols-2 content-start ${isModal ? 'gap-2 sm:col-span-2' : 'gap-3'}`}>
                <StatBox icon={BriefcaseBusiness} value={completedProjectDetails.length} label={t('cpd.projectsCompleted')} />
                <StatBox icon={HardHat} value={`${profile.experience_years || 0}+`} label={t('cpd.yearsInBusiness')} />
              </div>
            </div>
          </div>

          <InfoCard title={t('cpd.contactInformation')}>
            <div className={isModal ? 'space-y-2 text-xs' : 'space-y-3 text-sm'}>
              <div className={`${isModal ? 'space-y-2' : 'space-y-3'} ${contactUnlocked ? '' : 'pointer-events-none select-none blur-sm'}`} aria-hidden={!contactUnlocked}>
                {/* Blurred until the contact is unlocked. The stand-ins used to
                    be an invented email address and web address, which read as
                    English text on every language's screen and as real contact
                    details to anyone who looked closely. A mask carries neither. */}
                <p className="flex items-center gap-3"><Phone className="h-4 w-4 text-brand-700" /> {contactUnlocked ? profile.phone : MASKED_CONTACT}</p>
                <p className="flex items-center gap-3"><Mail className="h-4 w-4 text-brand-700" /> {contactUnlocked ? profile.email : MASKED_CONTACT}</p>
                {(contactUnlocked ? profile.website : true) && <p className="flex items-center gap-3"><Globe className="h-4 w-4 text-brand-700" /> {contactUnlocked ? profile.website : MASKED_CONTACT}</p>}
                <p className="flex items-center gap-3"><MapPin className="h-4 w-4 text-brand-700" /> {contactUnlocked ? `${td(profile.address)} - ${profile.pincode}` : MASKED_CONTACT}</p>
              </div>
              {!contactUnlocked && (
                <div className="rounded-xl border border-brand-100 bg-brand-50 px-3 py-2 text-xs font-semibold text-brand-800">
                  {t('cpd.contactLocked')}
                </div>
              )}
              <button
                disabled={!contactUnlocked}
                onClick={() => setMessageComposerOpen((isOpen) => !isOpen)}
                className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl bg-brand-700 py-2.5 text-xs font-bold text-white disabled:cursor-not-allowed disabled:bg-graphite/25"
              >
                <MessageSquare className="h-4 w-4" /> {t('cpd.sendMessage')}
              </button>
              {contactUnlocked && messageComposerOpen && (
                <form onSubmit={sendDirectMessage} className="mt-3 space-y-2 rounded-xl border border-brand-100 bg-cream/40 p-3">
                  <textarea
                    value={messageBody}
                    onChange={(event) => setMessageBody(event.target.value)}
                    placeholder={t('ui.contractor.messageTo', { name: td(profile.company_name || profile.name) })}
                    className="min-h-24 w-full rounded-xl border border-brand-100 bg-white px-3 py-2 text-sm outline-none focus:border-brand-400"
                  />
                  <button disabled={messageSending} className="w-full rounded-xl bg-brand-700 py-2 text-xs font-bold text-white disabled:opacity-60">
                    {messageSending ? t('cpp.sending') : t('cpd.send')}
                  </button>
                  {messageStatus && <p className="text-xs font-semibold text-graphite/60">{messageStatus}</p>}
                </form>
              )}
            </div>
          </InfoCard>
        </section>
        )}

        <nav className={`dash-scroll sticky z-20 flex gap-1 overflow-x-auto rounded-2xl border border-brand-100 bg-white px-2 shadow-card ${isModal ? 'top-0' : 'top-16'}`}>
          {tabs.map((tab) => (
            <button key={tab} onClick={() => setActiveTab(tab)} className={`shrink-0 border-b-2 font-bold capitalize ${isModal ? 'px-3 py-2 text-xs' : 'px-5 py-3 text-sm'} ${activeTab === tab ? 'border-brand-700 text-brand-800' : 'border-transparent text-graphite/55'}`}>
              {t(TAB_LABEL_KEYS[tab])}
            </button>
          ))}
        </nav>

        {renderTabContent()}
      </main>
  )

  if (isModal) {
    return (
      <CompactContext.Provider value>
        <ModalFrame label={td(profile?.company_name) || t('dash.contractor.loadingProfile')} closeLabel={t('dash.common.close')} onClose={close}>{content}</ModalFrame>
      </CompactContext.Provider>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-cream to-white text-graphite">
      <header className="sticky top-0 z-30 border-b border-brand-100 bg-white/90 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-[1500px] items-center justify-between px-4 sm:px-6">
          <Logo />
          <button onClick={() => navigate(-1)} className="rounded-full border border-brand-100 bg-white px-4 py-2 text-sm font-bold text-brand-700 shadow-sm">{t('dash.common.back')}</button>
        </div>
      </header>
      {content}
    </div>
  )
}
