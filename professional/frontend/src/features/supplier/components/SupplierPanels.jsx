import { Globe, Mail, Phone, X } from 'lucide-react'
import { SmartImage } from '../../../shared/ui/ui.jsx'
import { imageUrl } from '../../../shared/api/apiClient.js'
import { defaultProjectImage } from '../supplierConstants.js'
import { constructionTypeLabel } from '../../../shared/utils/roleLabels.js'
import { initials, splitEditableList } from '../supplierHelpers.js'
import { useLanguage } from '../../../i18n/LanguageContext.jsx'
import { BUSINESS_TYPE_KEYS, DOCUMENT_TYPE_KEYS, EQUIPMENT_OPTION_KEYS, SERVICE_OPTION_KEYS, optionLabel } from '../../../i18n/optionKeys.js'

export function DetailItem({ label, value }) {
  const { t } = useLanguage()
  return (
    <p className="rounded-xl border border-brand-100 bg-white px-3 py-2 text-sm">
      <span className="block text-[11px] font-bold uppercase tracking-wide text-graphite/45">{label}</span>
      <span className="font-semibold text-graphite">{value || t('dash.common.notSet')}</span>
    </p>
  )
}

export function ClientProfileModal({ client, requestSent, sending, canViewContact: canViewContactProp, onClose, onSendRequest }) {
  const { t, td } = useLanguage()
  if (!client) return null
  const isOwnerProject = Boolean(client.project_title)
  const title = td(isOwnerProject ? client.name : client.company_name || client.name)
  const subtitle = isOwnerProject ? td(client.project_title) : t('dash.common.builderProfile')
  const heroImage = isOwnerProject
    ? (client.project_image_url ? imageUrl(client.project_image_url) : defaultProjectImage)
    : (client.profile_image_url ? imageUrl(client.profile_image_url) : '')
  const canViewContact = Boolean(canViewContactProp || client.can_view_contact)
  const galleryImages = Array.isArray(client.gallery) ? client.gallery : splitEditableList(client.gallery)
  const documentList = Array.isArray(client.documents) ? client.documents : splitEditableList(client.documents)
  const servicesOffered = Array.isArray(client.services_offered) ? client.services_offered : splitEditableList(client.services_offered)
  const serviceLocations = Array.isArray(client.service_locations) ? client.service_locations : splitEditableList(client.service_locations)
  const equipmentOwned = Array.isArray(client.equipment_owned) ? client.equipment_owned : splitEditableList(client.equipment_owned)
  const contactValue = (value, fallback) => {
    if (canViewContact) return value || t('dash.common.notSet')
    return fallback
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/45 p-3 backdrop-blur-sm sm:p-6">
      <div className="mx-auto flex max-h-[92vh] max-w-4xl flex-col overflow-hidden rounded-2xl border border-brand-100 bg-white shadow-[0_30px_90px_-40px_rgba(15,23,42,0.9)]">
        <div className="flex items-start justify-between gap-4 border-b border-brand-100 px-5 py-4">
          <div className="min-w-0">
            <p className="text-[11px] font-extrabold uppercase tracking-wide text-brand-700">{isOwnerProject ? t('dash.common.ownerProject') : t('dash.common.builderProfile')}</p>
            <h2 className="mt-1 truncate font-display text-2xl font-extrabold text-graphite">{title}</h2>
            <p className="mt-1 text-sm text-graphite/55">{subtitle}</p>
          </div>
          <button onClick={onClose} className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-slate-200 bg-white text-graphite/60 transition hover:border-brand-200 hover:text-brand-800">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="overflow-y-auto p-5">
          <div className="grid gap-5 lg:grid-cols-[280px_minmax(0,1fr)]">
            <aside className="overflow-hidden rounded-2xl border border-brand-100 bg-brand-50/60">
              {heroImage ? (
                <SmartImage src={heroImage} alt={title} className="h-44 w-full object-cover" />
              ) : (
                <span className="grid h-44 w-full place-items-center bg-white text-2xl font-extrabold text-brand-700">{initials(title)}</span>
              )}
              <div className="space-y-3 p-4">
                <p className="font-display text-lg font-bold text-graphite">{title}</p>
                <p className="text-xs font-bold uppercase text-brand-700">{client.type === 'OWNER' ? t('role.owner') : client.type === 'BUILDER' ? t('role.builder') : client.type || t('role.client')} - {client.pincode || t('dash.common.notSet')}</p>
                <button
                  disabled={sending || requestSent}
                  onClick={() => onSendRequest(client)}
                  className={`w-full rounded-xl py-2.5 text-xs font-bold disabled:cursor-not-allowed ${
                    requestSent ? 'bg-brand-50 text-brand-800 ring-1 ring-brand-100' : 'bg-brand-900 text-white disabled:opacity-50'
                  }`}
                >
                  {requestSent ? t('dash.common.requestSent') : sending ? t('dash.common.sending') : t('dash.common.sendRequest')}
                </button>
              </div>
            </aside>

            <div className="space-y-4">
              {isOwnerProject ? (
                <>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <DetailItem label={t('dash.common.project')} value={td(client.project_title)} />
                    <DetailItem label={t('dash.common.construction')} value={constructionTypeLabel(client.construction_type)} />
                    <DetailItem label={t('role.owner')} value={td(client.name)} />
                    <DetailItem label={t('dash.common.pincode')} value={client.pincode} />
                  </div>
                  <section className="rounded-2xl border border-brand-100 bg-white p-4">
                    <h3 className="font-display text-sm font-bold text-graphite">{t('dash.supplier.modal.projectSummary')}</h3>
                    <p className="mt-2 text-sm leading-relaxed text-graphite/60">
                      {t('dash.supplier.modal.projectSummaryBody')}
                    </p>
                  </section>
                </>
              ) : (
                <>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <DetailItem label={t('dash.supplier.modal.builderName')} value={td(client.name)} />
                    <DetailItem label={t('dash.supplier.modal.company')} value={td(client.company_name || client.name)} />
                    <DetailItem label={t('dash.common.pincode')} value={client.pincode} />
                    <DetailItem label={t('dash.common.address')} value={td(client.address)} />
                    <DetailItem label={t('dash.msg.experience')} value={t('dash.msg.years', { n: client.experience_years || 0 })} />
                    <DetailItem label={t('dash.common.rating')} value={client.rating || t('dash.common.new')} />
                    <DetailItem label={t('dash.supplier.modal.licenseNumber')} value={client.license_number} />
                    <DetailItem label={t('ps.gstin')} value={client.gstin} />
                    <DetailItem label={t('ps.pan')} value={client.pan} />
                    <DetailItem label={t('dash.supplier.modal.businessType')} value={optionLabel(t, BUSINESS_TYPE_KEYS, client.business_type)} />
                    <DetailItem label={t('dash.supplier.modal.registrationYear')} value={client.registration_year} />
                    <DetailItem label={t('dash.supplier.modal.teamSize')} value={client.team_size} />
                    <DetailItem label={t('dash.supplier.modal.insurance')} value={client.insurance_available ? t('dash.supplier.modal.available') : t('dash.common.notSet')} />
                  </div>

                  <section className="rounded-2xl border border-brand-100 bg-white p-4">
                    <div className="flex items-center justify-between gap-3">
                      <h3 className="font-display text-sm font-bold text-graphite">{t('dash.supplier.modal.contactDetails')}</h3>
                      <span className={`rounded-full px-3 py-1 text-[11px] font-bold ${canViewContact ? 'bg-brand-50 text-brand-800' : 'bg-slate-100 text-slate-600'}`}>
                        {canViewContact ? t('dash.supplier.modal.unlocked') : t('dash.supplier.modal.lockedUntilAcceptance')}
                      </span>
                    </div>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <p className="rounded-xl border border-brand-100 bg-white px-3 py-2 text-sm">
                        <span className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wide text-graphite/45"><Phone className="h-3.5 w-3.5" /> {t('dash.common.phone')}</span>
                        <span className={`mt-1 block font-semibold text-graphite ${canViewContact ? '' : 'select-none blur-sm'}`}>{contactValue(client.phone, '0000000000')}</span>
                      </p>
                      <p className="rounded-xl border border-brand-100 bg-white px-3 py-2 text-sm">
                        <span className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wide text-graphite/45"><Mail className="h-3.5 w-3.5" /> {t('dash.common.email')}</span>
                        <span className={`mt-1 block font-semibold text-graphite ${canViewContact ? '' : 'select-none blur-sm'}`}>{contactValue(client.email, 'builder@example.com')}</span>
                      </p>
                    </div>
                  </section>

                  <section className="rounded-2xl border border-brand-100 bg-white p-4">
                    <h3 className="font-display text-sm font-bold text-graphite">{t('dash.supplier.modal.aboutCompany')}</h3>
                    <p className="mt-2 text-sm leading-relaxed text-graphite/60">
                      {client.about ? td(client.about) : t('dash.supplier.modal.noCompanyDescription')}
                    </p>
                    {client.website && (
                      <p className="mt-3 inline-flex items-center gap-2 text-sm font-bold text-brand-800">
                        <Globe className="h-4 w-4" /> {client.website}
                      </p>
                    )}
                  </section>

                  <section className="rounded-2xl border border-brand-100 bg-white p-4">
                    <h3 className="font-display text-sm font-bold text-graphite">{t('dash.msg.services')}</h3>
                    <p className="mt-2 text-sm leading-relaxed text-graphite/60">
                      {servicesOffered.length ? servicesOffered.map((service) => optionLabel(t, SERVICE_OPTION_KEYS, service)).join(', ') : t('dash.msg.noServices')}
                    </p>
                  </section>
                  <section className="rounded-2xl border border-brand-100 bg-white p-4">
                    <h3 className="font-display text-sm font-bold text-graphite">{t('dash.supplier.modal.equipmentOwned')}</h3>
                    <p className="mt-2 text-sm leading-relaxed text-graphite/60">
                      {equipmentOwned.length ? equipmentOwned.map((equipment) => optionLabel(t, EQUIPMENT_OPTION_KEYS, equipment)).join(', ') : t('dash.supplier.modal.noEquipment')}
                    </p>
                  </section>
                  <section className="rounded-2xl border border-brand-100 bg-white p-4">
                    <h3 className="font-display text-sm font-bold text-graphite">{t('dash.msg.serviceLocations')}</h3>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {serviceLocations.length ? serviceLocations.map((location) => (
                        <span key={location} className="rounded-full bg-brand-50 px-3 py-1 text-xs font-bold text-brand-800">{td(location)}</span>
                      )) : <p className="text-sm text-graphite/50">{t('dash.msg.noLocations')}</p>}
                    </div>
                  </section>
                  <section className="rounded-2xl border border-brand-100 bg-white p-4">
                    <h3 className="font-display text-sm font-bold text-graphite">{t('dash.msg.workGallery')}</h3>
                    <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
                      {galleryImages.length ? galleryImages.map((image) => (
                        <SmartImage key={image} src={imageUrl(image)} alt="" className="h-28 w-full rounded-xl object-cover ring-1 ring-slate-200" />
                      )) : <p className="text-sm text-graphite/50 sm:col-span-3">{t('dash.msg.noGallery')}</p>}
                    </div>
                  </section>
                  <section className="rounded-2xl border border-brand-100 bg-white p-4">
                    <h3 className="font-display text-sm font-bold text-graphite">{t('dash.common.documents')}</h3>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {documentList.length ? documentList.map((documentName) => (
                        <span key={documentName} className="rounded-full bg-slate-50 px-3 py-1 text-xs font-bold text-graphite/65 ring-1 ring-slate-200">{optionLabel(t, DOCUMENT_TYPE_KEYS, String(documentName).split(':')[0])}</span>
                      )) : <p className="text-sm text-graphite/50">{t('dash.common.documentsNone')}</p>}
                    </div>
                  </section>
                  <section className="rounded-2xl border border-brand-100 bg-white p-4">
                    <h3 className="font-display text-sm font-bold text-graphite">{t('dash.msg.completedProjects')}</h3>
                    <div className="mt-3 space-y-2">
                      {client.completed_project_details?.length ? client.completed_project_details.map((project, index) => (
                        <p key={`${project.title}-${index}`} className="rounded-xl bg-brand-50 px-3 py-2 text-xs font-semibold text-graphite/70">
                          {project.title ? td(project.title) : t('ui.requests.project', { n: index + 1 })}{project.location ? ` - ${td(project.location)}` : ''}
                        </p>
                      )) : <p className="text-sm text-graphite/50">{t('dash.supplier.modal.noCompletedProjects')}</p>}
                    </div>
                  </section>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
