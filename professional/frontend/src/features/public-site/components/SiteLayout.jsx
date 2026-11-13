import { useLocation } from 'react-router-dom'
import Navbar from './site/Navbar.jsx'
import Footer from './site/Footer.jsx'
import AdSlot from '../../../shared/ui/AdSlot.jsx'

/** Which advert placement each public page corresponds to.
 *
 * Held here rather than passed in by every page: putting the slot in the layout
 * means a new public page gets adverts by being added to this map, instead of by
 * somebody remembering to paste a component into it. The keys match the
 * PLACEMENTS list the server validates against, so a page that is not listed
 * simply shows no adverts rather than asking for a placement that does not exist.
 */
const PLACEMENT_FOR_PATH = {
  '/about': 'about',
  '/services': 'services',
  '/projects': 'projects',
  '/why-us': 'why_us',
  '/process': 'process',
  '/testimonials': 'testimonials',
  '/contact': 'contact',
  '/contact-us': 'contact',
  '/estimate': 'estimate',
}

export default function SiteLayout({ children }) {
  const { pathname } = useLocation()
  const placement = PLACEMENT_FOR_PATH[pathname]

  return (
    <div className="relative min-h-screen overflow-x-hidden bg-[#fcfaf3]">
      <Navbar />
      {/* A banner, above the page's own content. Renders nothing when no advert
          is placed here, so a page that sells no banner looks untouched. */}
      {placement && (
        <AdSlot
          placement={placement}
          position="top"
          className="mx-auto w-full max-w-5xl px-4 pt-4"
        />
      )}
      <main>{children}</main>
      {/* Above the footer, after the page has said what it came to say.
          Renders nothing at all when no advert is running here. */}
      {placement && (
        <AdSlot
          placement={placement}
          position="footer"
          className="mx-auto w-full max-w-5xl px-4 pb-12"
        />
      )}
      <Footer />
    </div>
  )
}
