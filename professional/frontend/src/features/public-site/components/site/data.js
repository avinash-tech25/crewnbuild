// Central content for the CREWNBUILD marketing site.

export const IMG = {
  heroSite:
    '/site-images/photo-1693639767415-27ff64ce4da2-w1400.jpg',
  heroConstruction:
    '/site-images/photo-1541888946425-d81bb19240f5-w1920.jpg',
  heroEngineer:
    '/site-images/photo-1581094794329-c8112a89af12-w1200.jpg',
  blueprint:
    '/site-images/photo-1503387762-592deb58ef4e-w1200.jpg',
  teamWork:
    '/site-images/photo-1522071820081-009f0129c71c-w1200.jpg',
  planning:
    '/site-images/photo-1454165804606-c3d57bc86b40-w1200.jpg',
  cranes:
    '/site-images/photo-1504307651254-35680f356dfd-w1200.jpg',
}

export const SERVICES = [
  {
    id: 'design',
    title: 'Design & Architecture',
    blurb:
      'Concept to construction drawings — architectural, structural and MEP design with 3D visualisation, BOQ and cost estimates built in.',
    points: ['Architectural design', 'Structural engineering', '3D visualisation', 'Bill of quantities'],
    image: IMG.blueprint,
  },
  {
    id: 'residential',
    title: 'Residential Construction',
    blurb:
      'Homes built to last — from single-family houses to gated communities, delivered with transparent pricing and fixed timelines.',
    points: ['Independent homes', 'Villas & bungalows', 'Gated communities', 'Interior fit-out'],
    image:
      '/site-images/photo-1600585154340-be6161a56a0c-w1200.jpg',
  },
  {
    id: 'commercial',
    title: 'Commercial & Industrial',
    blurb:
      'Office towers, retail spaces, warehouses and factories — engineered for efficiency, safety and future expansion.',
    points: ['Office buildings', 'Retail & showrooms', 'Warehouses', 'Factories & plants'],
    image:
      '/site-images/photo-1486406146926-c627a92ad1ab-w1200.jpg',
  },
  {
    id: 'renovation',
    title: 'Renovation & Remodeling',
    blurb:
      'Structural retrofits, facelifts and interior transformations that extend the life of your asset and raise its value.',
    points: ['Structural retrofit', 'Facade upgrades', 'Interior remodeling', 'Restoration'],
    image:
      '/site-images/photo-1600607687939-ce8a6c25118c-w1200.jpg',
  },
  {
    id: 'pm',
    title: 'Project Management',
    blurb:
      'End-to-end supervision — vendor management, quality audits, milestone tracking and transparent reporting on every rupee.',
    points: ['Vendor management', 'Quality audits', 'Milestone tracking', 'Cost control'],
    image: IMG.planning,
  },
  {
    id: 'mep',
    title: 'MEP & Smart Systems',
    blurb:
      'Electrical, plumbing, HVAC and sustainable energy systems — plus smart-home and fire-safety integration by certified teams.',
    points: ['Electrical & plumbing', 'HVAC systems', 'Solar & green energy', 'Smart home integration'],
    image:
      '/site-images/photo-1581094794329-c8112a89af12-w1200.jpg',
  },
]

export const PROJECTS = [
  {
    id: 'skyline',
    category: 'Commercial',
    title: 'Skyline Business Towers',
    location: 'Hyderabad, Telangana',
    year: '2025',
    area: '2.1 lakh sq.ft',
    image:
      '/site-images/photo-1486406146926-c627a92ad1ab-w1200.jpg',
    featured: true,
  },
  {
    id: 'garden',
    category: 'Residential',
    title: 'The Garden Estate Villas',
    location: 'Gachibowli, Hyderabad',
    year: '2025',
    area: '14 villas',
    image:
      '/site-images/photo-1600585154340-be6161a56a0c-w1200.jpg',
  },
  {
    id: 'metrolink',
    category: 'Infrastructure',
    title: 'Metro Link Road Corridor',
    location: 'Bengaluru, Karnataka',
    year: '2024',
    area: '11.4 km',
    image:
      '/site-images/photo-1517646287270-a5a9ca602e5c-w1200.jpg',
  },
  {
    id: 'forge',
    category: 'Industrial',
    title: 'Forge Precision Factory',
    location: 'Sri City, Andhra Pradesh',
    year: '2024',
    area: '96,000 sq.ft',
    image:
      '/site-images/photo-1504307651254-35680f356dfd-w1200.jpg',
  },
  {
    id: 'harbor',
    category: 'Residential',
    title: 'Harbor View Residences',
    location: 'Visakhapatnam, Andhra Pradesh',
    year: '2023',
    area: '68 apartments',
    image:
      '/site-images/photo-1568605114967-8130f3a36994-w1200.jpg',
  },
  {
    id: 'lumina',
    category: 'Renovation',
    title: 'Lumina Retail Revamp',
    location: 'Kolkata, West Bengal',
    year: '2023',
    area: '32,000 sq.ft',
    image:
      '/site-images/photo-1600607687939-ce8a6c25118c-w1200.jpg',
  },
  {
    id: 'cedar',
    category: 'Residential',
    title: 'Cedar Creek Duplex Homes',
    location: 'Pune, Maharashtra',
    year: '2023',
    area: '8 homes',
    image:
      '/site-images/photo-1580587771525-78b9dba3b914-w1200.jpg',
  },
  {
    id: 'nexus',
    category: 'Commercial',
    title: 'Nexus Corporate Campus',
    location: 'Chennai, Tamil Nadu',
    year: '2022',
    area: '1.6 lakh sq.ft',
    image:
      '/site-images/photo-1487958449943-2429e8be8625-w1200.jpg',
  },
  {
    id: 'skyloft',
    category: 'Renovation',
    title: 'Skyloft Penthouse Fit-Out',
    location: 'Mumbai, Maharashtra',
    year: '2022',
    area: '5,400 sq.ft',
    image:
      '/site-images/photo-1618221195710-dd6b41faaea6-w1200.jpg',
  },
]

export const STATS = [
  { value: '25+', label: 'Years of experience' },
  { value: '850+', label: 'Projects delivered' },
  { value: '120+', label: 'Engineers & architects' },
  { value: '98%', label: 'On-time delivery' },
]

export const PROCESS = [
  {
    step: '01',
    title: 'Consultation',
    blurb:
      'We sit with you, understand your site, budget and vision, and walk the plot with you to map constraints and opportunities.',
  },
  {
    step: '02',
    title: 'Design & Estimation',
    blurb:
      'Architects and engineers turn your vision into drawings, 3D models and a transparent line-item cost estimate.',
  },
  {
    step: '03',
    title: 'Permits & Approvals',
    blurb:
      'Our liaison team handles sanctioned plans, RERA filings, and municipal approvals so you never stand in a queue.',
  },
  {
    step: '04',
    title: 'Construction',
    blurb:
      'Certified site teams execute with weekly progress reports, quality checklists and an open materials ledger.',
  },
  {
    step: '05',
    title: 'Quality Assurance',
    blurb:
      'Independent audits at every milestone — concrete cube tests, load checks and MEP commissioning reports.',
  },
  {
    step: '06',
    title: 'Handover & Warranty',
    blurb:
      'Clean handover with as-built drawings, warranties and a 12-month post-construction service commitment.',
  },
]

export const TEAM = [
  {
    name: 'Arvind Rao',
    role: 'Founder & Managing Director',
    bio: 'Civil engineer with 26 years across roads, ports and high-rise residential.',
    image: '/site-images/portrait-men-32.jpg',
  },
  {
    name: 'Meera Krishnan',
    role: 'Chief Architect',
    bio: 'Leads the design studio — award-winning work in sustainable housing.',
    image: '/site-images/portrait-women-44.jpg',
  },
  {
    name: 'Vikram Shetty',
    role: 'Head of Engineering',
    bio: 'Structural specialist for seismic zones and heavy infrastructure.',
    image: '/site-images/portrait-men-75.jpg',
  },
  {
    name: 'Ananya Iyer',
    role: 'Projects Director',
    bio: 'Runs delivery operations — 850+ projects shipped on schedule.',
    image: '/site-images/portrait-women-68.jpg',
  },
]

export const TESTIMONIALS = [
  {
    name: 'Rajesh & Sunita Menon',
    role: 'Homeowners · The Garden Estate',
    quote:
      'CREWNBUILD built our dream home on budget and three weeks early. The weekly photo updates meant we were never out of the loop.',
    rating: 5,
    image: '/site-images/portrait-men-41.jpg',
  },
  {
    name: 'Karthik Reddy',
    role: 'Director · Skyline Infra',
    quote:
      'Their project management discipline is unmatched. Milestones hit, quality audited, and every rupee accounted for.',
    rating: 5,
    image: '/site-images/portrait-men-12.jpg',
  },
  {
    name: 'Priya Nair',
    role: 'Homeowner · Cedar Creek',
    quote:
      'From permits to paint, they handled everything. As a first-time builder I felt guided at every single step.',
    rating: 5,
    image: '/site-images/portrait-women-26.jpg',
  },
  {
    name: 'Aditya Shah',
    role: 'CEO · Nexus Retail',
    quote:
      'Our retail revamp was done in 60 days flat with zero business interruption. Professional, transparent and fast.',
    rating: 5,
    image: '/site-images/portrait-men-64.jpg',
  },
  {
    name: 'Farah Khan',
    role: 'Homeowner · Harbor View',
    quote:
      'The material ledger and cost dashboard meant I always knew where my money went. Rare honesty in construction.',
    rating: 5,
    image: '/site-images/portrait-women-50.jpg',
  },
  {
    name: 'Suresh Goud',
    role: 'Facility Head · Forge Industries',
    quote:
      'They delivered our factory shell in nine months — quality that passed every third-party inspection on the first try.',
    rating: 5,
    image: '/site-images/portrait-men-22.jpg',
  },
]

export const FAQS = [
  {
    q: 'How is your pricing structured?',
    a: 'Every project starts with a transparent, line-item BOQ estimate. You approve costs before we begin, and our milestone-based payment plan means you only pay as work is verified.',
  },
  {
    q: 'Do you handle permits and approvals?',
    a: 'Yes. Our liaison team manages sanctioned plans, RERA filings, and municipal approvals end-to-end, keeping you updated at every stage of approval.',
  },
  {
    q: 'What is the typical project timeline?',
    a: 'A standard independent home takes 8–14 months depending on size and design. Commercial shells run 9–18 months. You get a committed milestone schedule before we start.',
  },
  {
    q: 'Can I track my project remotely?',
    a: 'Absolutely. Every client gets a live project dashboard with weekly progress reports, photo updates, material usage and cost tracking.',
  },
  {
    q: 'What warranties do you provide?',
    a: 'Structural works carry a 10-year warranty and MEP systems a 2-year warranty, plus a 12-month post-construction service commitment on all finishes.',
  },
  {
    q: 'Do you work on projects outside your cities?',
    a: 'We currently deliver across Hyderabad, Bengaluru, Chennai, Pune and Mumbai. For larger commercial and infrastructure projects, we mobilise nationwide.',
  },
]
