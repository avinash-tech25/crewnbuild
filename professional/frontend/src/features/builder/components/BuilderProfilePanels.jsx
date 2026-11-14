import { ArrowRight, Boxes, CheckCircle2, Lock, Mail, MapPin, Phone, Truck } from 'lucide-react'
import { SmartImage } from '../../../shared/ui/ui.jsx'
import { imageUrl } from '../../../shared/api/apiClient.js'
import { constructionTypeLabel } from '../../../shared/utils/roleLabels.js'
import { buildingTypeText, inr } from '../builderHelpers.js'
import { ContactDetail, DetailItem } from './BuilderPanels.jsx'
import { useLanguage } from '../../../i18n/LanguageContext.jsx'
import { optionLabel, BUSINESS_TYPE_KEYS, DOCUMENT_TYPE_KEYS, SUPPLIER_CATEGORY_KEYS } from '../../../i18n/optionKeys.js'

/**
 * A stored document entry, read for display.
 *
 * Documents are saved as "<Document Type>: <url>", so the part before the colon
 * is the English document type the upload form offered. The upload form itself
 * already renders those through DOCUMENT_TYPE_KEYS; this puts the saved list on
 * the same footing instead of printing the stored English straight out. A type
 * the map does not know (a file name, say) falls through to `td`.
 */
function documentTypeLabel(documentName, t, td) {
  const storedType = String(documentName || '').split(':')[0].trim()
  return DOCUMENT_TYPE_KEYS[storedType] ? t(DOCUMENT_TYPE_KEYS[storedType]) : td(storedType)
}

export function SupplierProfilePanel({ supplier, requestSent, sending, canViewContact, loadingMessage, onBack, onSendRequest }) {
  const { t, td } = useLanguage()
  const products = Array.isArray(supplier?.profile_products)
    ? supplier.profile_products
    : (Array.isArray(supplier?.products) ? supplier.products : [])
  const galleryImages = Array.isArray(supplier?.gallery) ? supplier.gallery : []
  // Document links reach only a viewer allowed to open them; anyone else gets
  // the document types alone, which is all this panel shows anyway.
  const documents = Array.isArray(supplier?.documents) && supplier.documents.length
    ? supplier.documents
    : (Array.isArray(supplier?.document_types) ? supplier.document_types : [])
  const displayName = td(supplier?.store_name || supplier?.title) || t('dash.common.supplier')
  const heroImage = supplier?.cover_image_url || supplier?.store_logo_url || supplier?.profile_image_url
  // A stored list, read for display. A category the option map knows is
  // translated from the key table; anything else (a delivery area, say) goes
  // through `td`. An empty list returns '' so DetailItem shows its own "not set".
  const readList = (value, map) => {
    const items = (Array.isArray(value) ? value : String(value || '').split(',')).map((item) => String(item).trim()).filter(Boolean)
    if (!items.length) return ''
    return items.map((item) => (map && map[item] ? t(map[item]) : td(item))).join(', ')
  }

  return (
    <section className="overflow-hidden rounded-[1.35rem] border border-slate-200 bg-white shadow-[0_28px_80px_-58px_rgba(15,23,42,0.85)] ring-1 ring-white">
      <div className="border-b border-slate-100 bg-white px-4 py-3">
        <button onClick={onBack} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-brand-700 shadow-sm transition hover:bg-brand-50">
          {t('dash.contractor.backToSuppliers')}
        </button>
      </div>
      {loadingMessage && (
        <div className="mx-4 mt-4 rounded-xl border border-brand-100 bg-brand-50 px-4 py-2.5 text-[13px] font-semibold text-brand-800">
          {loadingMessage}
        </div>
      )}
      <div className="grid gap-0 lg:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="border-r border-slate-100 bg-slate-50/70 p-4">
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            {heroImage ? (
              <SmartImage src={imageUrl(heroImage)} alt={displayName} className="h-44 w-full object-cover" />
            ) : (
              <span className="grid h-44 w-full place-items-center bg-brand-50 text-brand-700"><Truck className="h-10 w-10" /></span>
            )}
            <div className="p-4">
              <p className="inline-flex items-center gap-2 rounded-full bg-brand-50 px-3 py-1 text-[11px] font-bold uppercase text-brand-800 ring-1 ring-brand-100">
                <Truck className="h-3.5 w-3.5" /> {t('dash.common.supplier')}
              </p>
              <h2 className="mt-2 font-display text-lg font-extrabold text-graphite">{displayName}</h2>
              <p className="mt-1.5 text-[13px] leading-5 text-graphite/62">{td(supplier?.about || supplier?.description) || t('dash.owner.supplierModal.aboutFallback')}</p>
              <button
                disabled={sending || requestSent || canViewContact}
                onClick={onSendRequest}
                className={`mt-4 w-full rounded-xl px-4 py-2.5 text-[13px] font-extrabold transition disabled:cursor-not-allowed ${
                  requestSent || canViewContact
                    ? 'bg-brand-50 text-brand-700 ring-1 ring-brand-100'
                    : 'bg-brand-900 text-white hover:-translate-y-0.5 hover:bg-brand-950 disabled:opacity-50'
                }`}
              >
                {canViewContact ? t('dash.contractor.requestAccepted') : requestSent ? t('dash.contractor.requestSent') : sending ? t('dash.common.sending') : t('dash.common.sendRequest')}
              </button>
            </div>
          </div>
        </aside>

        <div className="space-y-4 p-4">
          <section className="rounded-xl border border-slate-200 bg-white p-3.5">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <DetailItem label={t('dash.owner.supplierModal.businessType')} value={supplier?.business_type ? optionLabel(t, BUSINESS_TYPE_KEYS, supplier.business_type) : ''} />
              <DetailItem label={t('dash.common.categories')} value={readList(supplier?.categories, SUPPLIER_CATEGORY_KEYS)} />
              <DetailItem label={t('dash.owner.supplierModal.deliveryLocations')} value={readList(supplier?.delivery_locations)} />
              <DetailItem label={t('dash.common.pincode')} value={supplier?.pincode} />
              <DetailItem label={t('dash.owner.supplierModal.registrationYear')} value={supplier?.registration_year} />
              <DetailItem label={t('dash.common.rating')} value={supplier?.rating || t('dash.common.new')} />
              <DetailItem label={t('dash.contractor.gstLicense')} value={supplier?.gst_number || supplier?.license_number} />
              <DetailItem label={t('dash.common.address')} value={td(supplier?.address)} />
            </div>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-3.5">
            <div className="flex items-center justify-between gap-3">
              <h3 className="font-display text-base font-extrabold text-graphite">{t('dash.owner.supplierModal.contactDetails')}</h3>
              <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-bold ${canViewContact ? 'bg-brand-50 text-brand-700' : 'bg-slate-100 text-slate-600'}`}>
                {canViewContact ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />}
                {canViewContact ? t('dash.contractor.unlocked') : t('dash.common.lockedUntilAccepted')}
              </span>
            </div>
            <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
              <ContactDetail icon={Phone} label={t('dash.common.phone')} value={supplier?.phone} canView={canViewContact} />
              <ContactDetail icon={Mail} label={t('dash.common.email')} value={supplier?.email} canView={canViewContact} />
              <ContactDetail icon={MapPin} label={t('dash.owner.supplierModal.website')} value={supplier?.website} canView={canViewContact} />
              <ContactDetail icon={MapPin} label={t('dash.common.address')} value={td(supplier?.address)} canView={canViewContact} />
            </div>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-3.5">
            <h3 className="font-display text-base font-extrabold text-graphite">{t('dash.owner.supplierModal.products')}</h3>
            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {products.length ? products.map((product, index) => {
                const productImage = product.image_url || product.image || product.photo_url || product.thumbnail_url
                const productName = td(product.name || product.product_name || product.title) || t('dash.owner.supplierModal.productN', { n: index + 1 })
                const productPrice = product.price || product.rate
                const productUnit = product.unit || product.measurement_unit
                return (
                  <article key={product.id || productName} className="overflow-hidden rounded-xl border border-slate-200 bg-slate-50/50">
                    {productImage ? (
                      <SmartImage src={imageUrl(productImage)} alt={productName} className="h-32 w-full object-cover" />
                    ) : (
                      <span className="grid h-32 w-full place-items-center bg-white text-brand-700"><Boxes className="h-7 w-7" /></span>
                    )}
                    <div className="space-y-1 p-3">
                      <p className="truncate font-display text-sm font-bold text-graphite">{productName}</p>
                      {(product.category || product.material_type) && <p className="truncate text-xs font-semibold text-graphite/50">{optionLabel(t, SUPPLIER_CATEGORY_KEYS, product.category || product.material_type)}</p>}
                      {(productPrice || productUnit) && (
                        <p className="text-xs font-bold text-brand-800">
                          {productPrice ? inr(productPrice) : t('dash.owner.supplierModal.priceNotSet')}{productUnit ? ` / ${productUnit}` : ''}
                        </p>
                      )}
                    </div>
                  </article>
                )
              }) : <p className="text-sm text-graphite/50">{t('dash.owner.supplierModal.noProducts')}</p>}
            </div>
          </section>

          <section className="grid gap-5 lg:grid-cols-2">
            <div className="rounded-xl border border-slate-200 bg-white p-3.5">
              <h3 className="font-display text-base font-extrabold text-graphite">{t('dash.contractor.gallery')}</h3>
              <div className="mt-4 grid grid-cols-2 gap-3">
                {galleryImages.length ? galleryImages.slice(0, 6).map((galleryImage) => (
                  <SmartImage key={galleryImage} src={imageUrl(galleryImage)} alt="" className="h-24 w-full rounded-xl object-cover ring-1 ring-slate-200" />
                )) : <p className="text-sm text-graphite/50">{t('dash.msg.noGallery')}</p>}
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-3.5">
              <h3 className="font-display text-base font-extrabold text-graphite">{t('dash.common.documents')}</h3>
              <div className="mt-4 flex flex-wrap gap-2">
                {documents.length ? documents.map((documentName) => (
                  <span key={documentName} className="rounded-full bg-brand-50 px-3 py-1 text-xs font-bold text-brand-700">{documentTypeLabel(documentName, t, td)}</span>
                )) : <p className="text-sm text-graphite/50">{t('dash.common.documentsNone')}</p>}
              </div>
            </div>
          </section>
        </div>
      </div>
    </section>
  )
}

export function ClientProfilePanel({ client, requestSent, sending, canViewContact: canViewContactProp, onBack, onSendRequest }) {
  const { t, td } = useLanguage()
  const canViewContact = Boolean(canViewContactProp || client.can_view_contact)
  const projectTitle = td(client.project_title || client.title) || t('dash.contractor.ownerProject')
  const ownerName = td(client.owner_name || client.title) || t('dash.contractor.houseOwner')
  const description = td(client.project_description || client.description) || t('dash.common.notSet')
  const landArea = client.land_area || 0
  const floors = client.floors || 0
  const contactStatus = canViewContact ? t('dash.contractor.contactUnlocked') : t('dash.contractor.contactLocked')
  // Until acceptance the phone and e-mail are a blurred placeholder: the
  // badge at the top already says contact details are locked. The placeholder
  // is never the real value (which is not sent before acceptance).
  const contactValue = (value, placeholder) => {
    if (canViewContact) return value || t('dash.common.notSet')
    return (
      <span aria-label={t('dash.contractor.visibleAfterAcceptance')} title={t('dash.contractor.visibleAfterAcceptance')} className="select-none blur-[4px]">
        {placeholder}
      </span>
    )
  }

  return (
    <section className="rounded-xl border border-brand-100 bg-white p-3.5 shadow-[0_24px_70px_-52px_rgba(15,23,42,0.85)] ring-1 ring-white">
      <div className="flex flex-col gap-2 border-b border-slate-100 pb-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <button onClick={onBack} className="rounded-full border border-brand-100 bg-brand-50 px-3 py-1 text-[11px] font-extrabold text-brand-800 transition hover:bg-brand-100">
            {t('cpp.backToClients')}
          </button>
          <p className="mt-2.5 text-[10px] font-bold uppercase tracking-[0.18em] text-brand-700">{t('cpp.homeownerProfile')}</p>
          <h2 className="mt-1 font-display text-lg font-extrabold text-graphite">{projectTitle}</h2>
          <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-graphite/62" title={description}>{description}</p>
        </div>
        <span className={`inline-flex w-fit shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold ${canViewContact ? 'bg-brand-50 text-brand-700' : 'bg-slate-100 text-slate-600'}`}>
          {canViewContact ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />}
          {contactStatus}
        </span>
      </div>

      {/* Compact detail tiles; the project title and description are in the header above. */}
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 [&>p]:px-2.5 [&>p]:py-1.5 [&>p]:text-xs">
        <DetailItem label={t('cpp.ownerName')} value={ownerName} />
        <DetailItem label={t('ps.phoneShort')} value={contactValue(client.phone, '+91 98765 43210')} />
        <DetailItem label={t('ps.email')} value={contactValue(client.email, 'owner@example.com')} />
        <DetailItem label={t('ps.address')} value={td(client.address) || t('cpp.notSet')} />
        <DetailItem label={t('ps.pincode')} value={client.pincode || t('cpp.notSet')} />
        <DetailItem label={t('ps.owner.buildingType')} value={buildingTypeText(client.building_type, t) || t('cpp.notSet')} />
        <DetailItem label={t('ps.owner.constructionType')} value={constructionTypeLabel(client.construction_type, t) || t('cpp.notSet')} />
        <DetailItem label={t('cpp.budget')} value={client.budget ? inr(client.budget) : t('cpp.notSet')} />
        <DetailItem label={t('cpp.landArea')} value={landArea ? t('cpp.sqFt', { area: landArea }) : t('cpp.notSet')} />
        <DetailItem label={t('ps.owner.floors')} value={floors || t('cpp.notSet')} />
        <DetailItem label={t('ps.owner.startTimeline')} value={td(client.start_timeline) || t('cpp.notSet')} />
      </div>

      <button
        disabled={sending || requestSent || canViewContact}
        onClick={onSendRequest}
        className={`mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl px-5 py-2 text-[13px] font-extrabold transition disabled:cursor-not-allowed ${
          requestSent || canViewContact
            ? 'bg-brand-50 text-brand-700 ring-1 ring-brand-100'
            : 'bg-brand-800 text-white shadow-[0_18px_35px_-24px_rgba(31,100,64,0.95)] hover:-translate-y-0.5 hover:bg-brand-900'
        }`}
      >
        {canViewContact ? t('cpp.requestAccepted') : requestSent ? t('cpp.requestSent') : sending ? t('cpp.sending') : t('cpp.sendRequest')}
        {!requestSent && !canViewContact && <ArrowRight className="h-4 w-4" />}
      </button>
    </section>
  )
}
