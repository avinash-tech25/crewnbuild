import consultationImage from '../../assets/services/consultation.jpg'

// Artwork for the service catalog, bundled with the app.
//
// Files live at src/assets/services/<trade>/<slug>.jpg -- the slug is the
// catalog row's own stable slug, so a reworded display name never moves an
// image. Every Consultation shares src/assets/services/consultation.jpg.
//
// `image_url` on the catalog row still wins when one is set; this is only the
// local fallback, so no database change is needed to show pictures. A service
// with neither keeps the neutral placeholder tile the pages already draw.
const SERVICE_IMAGES = import.meta.glob('../../assets/services/*/*.jpg', { eager: true, import: 'default' })

export function serviceImage(service) {
  if (!service) return null
  if (service.image_url) return service.image_url
  if (service.service_kind === 'CONSULTATION') return consultationImage
  const trade = String(service.trade || '').toLowerCase()
  return SERVICE_IMAGES[`../assets/services/${trade}/${service.slug}.jpg`] || null
}
