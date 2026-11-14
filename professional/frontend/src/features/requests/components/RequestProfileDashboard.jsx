import { FileText, MapPin, Star, X } from 'lucide-react'
import { imageUrl } from '../../../shared/api/apiClient.js'
import { ContactValue, formatMoney, profileList } from '../../messaging/messageHelpers.jsx'
import { useLanguage } from '../../../i18n/LanguageContext.jsx'
import { avatarFromPath } from '../../../shared/ui/avatars.js'
import { formatNumber } from '../../../shared/utils/formatters.js'
import { documentFileUrl } from '../../../shared/utils/documentEntries.js'
import { BUSINESS_TYPE_KEYS, SERVICE_OPTION_KEYS, SUPPLIER_CATEGORY_KEYS, optionLabel } from '../../../i18n/optionKeys.js'

// The profile's role code as the role name the rest of the app shows.
const PROFILE_ROLE_KEYS = {
  OWNER: 'role.owner',
  CONTRACTOR: 'role.contractor',
  BUILDER: 'role.contractor',
  SUPPLIER: 'role.supplier',
  ENGINEER: 'role.engineer',
  PROFILE: 'ui.profile',
}

/**
 * The picture of the person this request profile belongs to: what they
 * uploaded, or their role's default. `role` comes from the same payload as
 * the name shown beside it, so the two always describe one person.
 */
export function ProfileImage({ src, alt, role = null }) {
  return <img src={avatarFromPath(src, role)} alt={alt} className="h-full w-full rounded-2xl object-cover" />
}

export function RequestProfileDashboard({ details, participant, canViewContact, onClose }) {
  const { t, td } = useLanguage()
  // A stored option value with a written label uses it; anything typed by hand
  // has no key to look up, so it is machine-translated for display.
  const valueLabel = (map, value) => {
    const label = optionLabel(t, map, value)
    return label === value ? td(value) : label
  }
  const profileTitle = td(details.profile_title || participant?.secondary_name || details.sender_name) || t('ui.profile')
  const profileName = td(details.profile_name || participant?.primary_name || details.sender_name) || t('ui.shared.user')
  const profileRole = details.profile_role || details.sender_role || 'PROFILE'
  const profileRoleLabel = PROFILE_ROLE_KEYS[profileRole] ? t(PROFILE_ROLE_KEYS[profileRole]) : profileRole
  // The tagline this person wrote for themselves, else the name of their role.
  const profileSubtitle = td(details.profile_subtitle) || profileRoleLabel
  const profileImage = details.profile_image_url || details.profile_logo_url || participant?.avatar_url
  const services = profileList(details.profile_services || details.profile_categories)
  const locations = profileList(details.profile_locations || details.profile_address || details.project_address)
  const documents = profileList(details.profile_documents)
  const gallery = profileList(details.profile_gallery)
  const products = Array.isArray(details.profile_products) ? details.profile_products : []
  const isSupplierProfile = profileRole === 'SUPPLIER'
  const stats = [
    [t('dash.common.rating'), details.profile_rating || '0', <Star key="rating" className="h-4 w-4 fill-amber-400 text-amber-500" />],
    [t('dash.common.pincode'), details.profile_pincode || details.project_pincode || '-', <MapPin key="pincode" className="h-4 w-4 text-brand-700" />],
    [isSupplierProfile ? t('dash.owner.supplierModal.businessType') : t('dash.msg.experience'), isSupplierProfile ? (valueLabel(BUSINESS_TYPE_KEYS, details.profile_business_type) || '-') : (details.profile_experience_years ? t('dash.msg.years', { n: details.profile_experience_years }) : '-'), null],
    [isSupplierProfile ? t('dash.owner.supplierModal.registrationYear') : t('dash.msg.completedProjects'), isSupplierProfile ? (details.profile_registration_year || '-') : (details.profile_completed_projects || '-'), null],
    [t('dash.common.phone'), <ContactValue key="phone" value={details.profile_phone || details.sender_phone} visible={canViewContact} />, null],
    [t('dash.common.email'), <ContactValue key="email" value={details.profile_email || details.sender_email} visible={canViewContact} />, null],
  ]
  const supplierDetails = [
    [t('dash.msg.storeName'), profileTitle],
    [t('dash.common.categories'), services.length ? services.map((service) => valueLabel(SUPPLIER_CATEGORY_KEYS, service)).join(', ') : '-'],
    // Place names the supplier typed.
    [t('dash.owner.supplierModal.deliveryLocations'), locations.length ? td(locations.join(', ')) : '-'],
    // Sent by the server only once a request is accepted, like the contact
    // details below, so they read as locked rather than as "not set".
    [t('dash.owner.supplierModal.gstin'), <ContactValue key="gstin" value={details.profile_gstin} visible={canViewContact} />],
    [t('dash.owner.supplierModal.pan'), <ContactValue key="pan" value={details.profile_pan} visible={canViewContact} />],
    [t('dash.owner.supplierModal.website'), <ContactValue key="website" value={details.profile_website} visible={canViewContact} />],
    [t('dash.common.address'), <ContactValue key="address" value={details.profile_address || details.sender_address} visible={canViewContact} />],
  ]

  return (
    <div className="fixed inset-0 z-50 bg-black/45 p-3 backdrop-blur-sm sm:p-6">
      <div className="mx-auto flex max-h-[92vh] max-w-6xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-start gap-4 border-b border-brand-100 bg-gradient-to-r from-brand-50 to-cream/40 p-5">
          <div className="h-24 w-24 shrink-0 overflow-hidden rounded-2xl border border-brand-100 bg-white">
            <ProfileImage src={profileImage} alt={profileName} role={profileRole} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-extrabold uppercase tracking-wide text-brand-700">{profileRoleLabel}</p>
            <h2 className="mt-1 truncate font-display text-3xl font-extrabold text-graphite">{profileName}</h2>
            <p className="mt-1 text-sm font-semibold text-graphite/60">{profileTitle}</p>
            <p className="mt-2 inline-flex rounded-full bg-white px-3 py-1 text-xs font-bold text-brand-700">{canViewContact ? t('dash.msg.contactUnlocked') : t('dash.msg.contactHidden')}</p>
          </div>
          <button type="button" onClick={onClose} className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-brand-100 bg-white text-graphite hover:bg-brand-50">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="overflow-y-auto p-5">
          <div className="grid gap-3 md:grid-cols-3">
            {stats.map(([label, value, icon]) => (
              <div key={label} className="rounded-xl border border-brand-100 bg-white p-4">
                <p className="text-xs font-bold uppercase text-graphite/45">{label}</p>
                <div className="mt-2 flex items-center gap-2 text-lg font-extrabold text-graphite">
                  {icon}
                  <span className="min-w-0 truncate">{value || '-'}</span>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_1fr]">
            <section className="rounded-2xl border border-brand-100 bg-white p-4">
              <h3 className="text-sm font-extrabold uppercase tracking-wide text-graphite/55">{t('dash.msg.about')}</h3>
              {/* What this person wrote about themselves. */}
            <p className="mt-2 text-sm leading-relaxed text-graphite/70">{td(details.profile_about) || profileSubtitle || t('dash.msg.profileAvailable')}</p>
            </section>
            <section className="rounded-2xl border border-brand-100 bg-white p-4">
              <h3 className="text-sm font-extrabold uppercase tracking-wide text-graphite/55">{profileRole === 'SUPPLIER' ? t('dash.common.categories') : t('dash.msg.services')}</h3>
              <div className="mt-3 flex flex-wrap gap-2">
                {services.length ? services.map((service) => (
                  <span key={service} className="rounded-full border border-brand-100 bg-brand-50 px-3 py-1 text-sm font-bold text-brand-800">{valueLabel(profileRole === 'SUPPLIER' ? SUPPLIER_CATEGORY_KEYS : SERVICE_OPTION_KEYS, service)}</span>
                )) : <p className="text-sm text-graphite/55">{t('dash.msg.noServices')}</p>}
              </div>
            </section>
          </div>

          {isSupplierProfile && (
            <section className="mt-4 rounded-2xl border border-brand-100 bg-white p-4">
              <h3 className="text-sm font-extrabold uppercase tracking-wide text-graphite/55">{t('dash.msg.supplierDetails')}</h3>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                {supplierDetails.map(([label, value]) => (
                  <div key={label} className="rounded-xl border border-brand-100 bg-white px-3 py-3">
                    <p className="text-xs font-bold uppercase text-graphite/45">{label}</p>
                    <div className="mt-1 text-sm font-bold text-graphite">{value || '-'}</div>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section className="mt-4 rounded-2xl border border-brand-100 bg-white p-4">
            <h3 className="text-sm font-extrabold uppercase tracking-wide text-graphite/55">{t('dash.msg.serviceLocations')}</h3>
            <div className="mt-3 flex flex-wrap gap-2">
              {locations.length ? locations.map((location) => (
                <span key={location} className="rounded-xl bg-cream/60 px-3 py-2 text-sm font-semibold text-graphite">{td(location)}</span>
              )) : <p className="text-sm text-graphite/55">{t('dash.msg.noLocations')}</p>}
            </div>
          </section>

          <section className="mt-4 rounded-2xl border border-brand-100 bg-white p-4">
            <h3 className="text-sm font-extrabold uppercase tracking-wide text-graphite/55">{t('dash.msg.certificates')}</h3>
            <div className="mt-3 grid gap-2 md:grid-cols-2">
              {documents.length ? documents.map((documentUrl, index) => (
                <a key={`${documentUrl}-${index}`} href={imageUrl(documentFileUrl(documentUrl))} target="_blank" rel="noreferrer" className="flex items-center gap-2 rounded-xl border border-brand-100 px-3 py-3 text-sm font-bold text-brand-700 hover:bg-brand-50">
                  <FileText className="h-4 w-4" /> {t('dash.msg.openDocument', { n: index + 1 })}
                </a>
              )) : <p className="text-sm text-graphite/55">{t('dash.common.documentsNone')}</p>}
            </div>
          </section>

          <section className="mt-4 rounded-2xl border border-brand-100 bg-white p-4">
            <h3 className="text-sm font-extrabold uppercase tracking-wide text-graphite/55">{t('dash.msg.workGallery')}</h3>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {gallery.length ? gallery.map((item, index) => (
                <a key={`${item}-${index}`} href={imageUrl(item)} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-xl border border-brand-100 bg-slate-50">
                  <img src={imageUrl(item)} alt={t('ui.shared.workPhotoAlt', { name: profileName, n: index + 1 })} className="h-44 w-full object-cover" />
                </a>
              )) : <p className="text-sm text-graphite/55">{t('dash.msg.noGallery')}</p>}
            </div>
          </section>

          {profileRole === 'SUPPLIER' && (
            <section className="mt-4 rounded-2xl border border-brand-100 bg-white p-4">
              <h3 className="text-sm font-extrabold uppercase tracking-wide text-graphite/55">{t('dash.msg.supplierProducts')}</h3>
              <div className="mt-3 space-y-3">
                {products.length ? products.map((product, index) => {
                  const productFeatures = Array.isArray(product.features) ? product.features : profileList(product.features)
                  return (
                  <article key={product.id || `${product.name}-${index}`} className="grid gap-3 overflow-hidden rounded-xl border border-brand-100 bg-white p-3 sm:grid-cols-[150px_minmax(0,1fr)]">
                    {product.image_url ? (
                      <img src={imageUrl(product.image_url)} alt={td(product.name)} className="h-32 w-full rounded-lg object-cover sm:h-full" />
                    ) : (
                      <div className="grid h-32 place-items-center rounded-lg bg-brand-50 text-sm font-bold text-brand-700 sm:h-full">{t('dash.msg.noImage')}</div>
                    )}
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <p className="text-base font-extrabold text-graphite">{product.name ? td(product.name) : t('dash.owner.supplierModal.productN', { n: index + 1 })}</p>
                          <p className="mt-1 text-xs font-bold uppercase text-brand-700">{product.category ? valueLabel(SUPPLIER_CATEGORY_KEYS, product.category) : t('dash.msg.categoryNotSet')}</p>
                        </div>
                        <span className="rounded-full bg-brand-50 px-3 py-1 text-xs font-bold text-brand-800">
                          {/* Was pinned to en-IN, so the grouping never
                              followed the selected language. */}
                          {formatNumber(product.quantity || 0)} {td(product.unit || '')} {t('dash.owner.supplierModal.inStock')}
                        </span>
                      </div>
                      <p className="font-display text-lg font-extrabold text-brand-800">{formatMoney(product.price)} <span className="text-xs text-graphite/45">/ {product.unit ? td(product.unit) : t('dash.msg.unit')}</span></p>
                      {productFeatures.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {/* Feature bullets the supplier wrote. */}
                          {productFeatures.map((feature) => (
                            <span key={feature} className="rounded-full bg-slate-50 px-2 py-1 text-xs font-bold text-graphite/60 ring-1 ring-slate-200">{td(feature)}</span>
                          ))}
                        </div>
                      )}
                    </div>
                  </article>
                )}) : <p className="text-sm text-graphite/55">{t('dash.msg.noProducts')}</p>}
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  )
}
