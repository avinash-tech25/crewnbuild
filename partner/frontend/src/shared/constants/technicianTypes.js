import painterImage from '../../assets/technicians/painter.svg'
import plumberImage from '../../assets/technicians/plumber.svg'
import electricianImage from '../../assets/technicians/electrician.svg'
import carpenterImage from '../../assets/technicians/carpenter.svg'

// Landing-hero artwork, kept SEPARATE from `image` above.
//
// `image` is the small flat illustration used in thirteen places -- the service
// cards, the booking screens, the tracking panel, the technician dashboard and
// the onboarding steps. These four are full-figure renders sized for the hero
// only, so they are a second field rather than a replacement: swapping `image`
// would silently change every one of those screens.
//
// PNG with a real alpha channel, so each figure sits directly on the page with
// no panel or card behind it. They were supplied as JPEGs on a solid black
// background; the black was keyed out by flood-filling inward from the border,
// which is why the black toolboxes the plumber and electrician are carrying
// survived -- that black is enclosed by the figure and never touches the edge.
import painterHero from '../../assets/technicians/painter-hero.png'
import plumberHero from '../../assets/technicians/plumber-hero.png'
import electricianHero from '../../assets/technicians/electrician-hero.png'
import carpenterHero from '../../assets/technicians/carpenter-hero.png'

// `motion` is the idle animation the landing hero plays on whichever figure is
// showing. the Professional app gives each of its role characters a loop of its own, so
// this is a third landing-only field alongside `heroImage`, for the same reason:
// the thirteen other screens that read `image` must not inherit it.
//
// The four technician types. The codes match partner.technician_profiles.technician_type.
export const TECHNICIAN_TYPES = [
  {
    code: 'PAINTER',
    slug: 'painter',
    label: 'Painter',
    plural: 'painters',
    image: painterImage,
    heroImage: painterHero,
    motion: 'animate-trade-painter',
    description: 'Interior and exterior painting, texture finishes, touch-ups and waterproof coatings.',
    tint: 'from-emerald-50 to-[#dff0e8]',
  },
  {
    code: 'PLUMBER',
    slug: 'plumber',
    label: 'Plumber',
    plural: 'plumbers',
    image: plumberImage,
    heroImage: plumberHero,
    motion: 'animate-trade-plumber',
    description: 'Pipe fitting, leakage repair, taps, bathroom fittings and plumbing services.',
    tint: 'from-sky-50 to-blue-100',
  },
  {
    code: 'ELECTRICIAN',
    slug: 'electrician',
    label: 'Electrician',
    plural: 'electricians',
    image: electricianImage,
    heroImage: electricianHero,
    motion: 'animate-trade-electrician',
    description: 'Wiring, switchboards, fans and lights, fault finding and safe electrical repairs.',
    tint: 'from-amber-50 to-orange-100',
  },
  {
    code: 'CARPENTER',
    slug: 'carpenter',
    label: 'Carpenter',
    plural: 'carpenters',
    image: carpenterImage,
    heroImage: carpenterHero,
    motion: 'animate-trade-carpenter',
    description: 'Furniture repair, doors and windows, modular fittings and custom woodwork.',
    tint: 'from-orange-50 to-rose-100',
  },
]

export function technicianTypeByCode(code) {
  return TECHNICIAN_TYPES.find((type) => type.code === String(code || '').toUpperCase()) || null
}

export function technicianTypeBySlug(slug) {
  return TECHNICIAN_TYPES.find((type) => type.slug === String(slug || '').toLowerCase()) || null
}
