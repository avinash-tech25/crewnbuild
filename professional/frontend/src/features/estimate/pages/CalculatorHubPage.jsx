/**
 * Calculator hub — the destination of the landing page's existing
 * "Get Free Estimate" action (`/estimate`).
 *
 * This file is a shell and nothing more: a row of calculator cards and the
 * selected calculator below them. It performs no calculation, holds no rate,
 * ratio, coverage figure or price, and talks to no API.
 *
 * The construction estimate is the existing `EstimateCalculator`, rendered
 * unmodified. That component is a whole page — it brings its own `SiteHeader`
 * and its own top padding — so the two pieces of its page chrome are suppressed
 * here from the OUTSIDE, with parent-scoped classes, rather than by editing it.
 * See `embeddedPageChrome` below.
 *
 * The other three work from the user's own measurements and published technical
 * figures, which live with their sources in `calculators/constants.js`. They
 * quote no price and name no product: they are arithmetic, not catalogue.
 */
import { useState } from 'react'
import { Calculator, Compass, FileCheck, Landmark, Layers, Paintbrush, Receipt, Scale, ReceiptIndianRupee, Stamp, TrendingUp, Truck, Wallet } from 'lucide-react'
import EstimateCalculator from '../components/EstimateCalculator.jsx'
import PaintCalculator from '../calculators/PaintCalculator.jsx'
import RawMaterialCalculator from '../calculators/RawMaterialCalculator.jsx'
import ReadyMixCalculator from '../calculators/ReadyMixCalculator.jsx'
import VastuCalculator from '../calculators/VastuCalculator.jsx'
import HomeLoanCalculator from '../calculators/HomeLoanCalculator.jsx'
import TrueCostCalculator from '../calculators/TrueCostCalculator.jsx'
import StampDutyCalculator from '../calculators/StampDutyCalculator.jsx'
import RentVsBuyCalculator from '../calculators/RentVsBuyCalculator.jsx'
import ContractorQuoteCalculator from '../calculators/ContractorQuoteCalculator.jsx'
import ConstructionFinanceCalculator from '../calculators/ConstructionFinanceCalculator.jsx'
import PropertyTdsCalculator from '../calculators/PropertyTdsCalculator.jsx'
import PropertyRoiCalculator from '../calculators/PropertyRoiCalculator.jsx'
import { SiteHeader } from '../../public-site/components/landing/SiteHeader.jsx'
import { useLanguage } from '../../public-site/components/landing/useLanguage.js'
import { useLanguage as useAppLanguage } from '../../../i18n/LanguageContext.jsx'

// Navigation labels only — these name the screens, they are not business data.
// `embedded` marks the one calculator that is a whole page of its own.
// `labelKey` is read through the shared `t()` so the rail follows the selected
// language; the ids below are identifiers and stay as they are.
// `image` is the card illustration from the approved hub design (cut out of the
// reference mock-up into `public/calculator-hub/`); a card without one shows its
// `icon` instead. `badgeKey` is the design's marker above a card. `subKey` is
// kept as the card's tooltip — the design shows the title only.
const HUB_IMAGES = '/calculator-hub'
const CALCULATORS = [
  { id: 'construction', labelKey: 'site.calculators.hub.construction', icon: Calculator, image: 'construction', badgeKey: 'site.calculators.hub.badgePopular', embedded: true, Component: EstimateCalculator },
  { id: 'raw-material', labelKey: 'site.calculators.hub.rawMaterial', icon: Layers, image: 'raw-material', Component: RawMaterialCalculator },
  { id: 'paint', labelKey: 'site.calculators.hub.paint', icon: Paintbrush, image: 'paint', Component: PaintCalculator },
  { id: 'ready-mix', labelKey: 'site.calculators.hub.readyMix', icon: Truck, image: 'ready-mix', badgeKey: 'site.calculators.hub.badgePopular', Component: ReadyMixCalculator },
  { id: 'vastu', labelKey: 'site.calculators.hub.vastu', icon: Compass, image: 'vastu', badgeKey: 'site.calculators.hub.badgeMostUsed', Component: VastuCalculator },
  { id: 'home-loan', labelKey: 'site.calculators.hub.homeLoan', subKey: 'site.calculators.hub.homeLoanSub', icon: Landmark, image: 'home-loan', Component: HomeLoanCalculator },
  { id: 'true-cost', labelKey: 'site.calculators.hub.trueCost', subKey: 'site.calculators.hub.trueCostSub', icon: Receipt, image: 'true-cost', badgeKey: 'site.calculators.hub.badgeImportant', Component: TrueCostCalculator },
  { id: 'stamp-duty', labelKey: 'site.calculators.hub.stampDuty', subKey: 'site.calculators.hub.stampDutySub', icon: Stamp, image: 'stamp-duty', Component: StampDutyCalculator },
  { id: 'rent-vs-buy', labelKey: 'site.calculators.hub.rentVsBuy', subKey: 'site.calculators.hub.rentVsBuySub', icon: Scale, image: 'rent-vs-buy', Component: RentVsBuyCalculator },
  { id: 'contractor-quote', labelKey: 'site.calculators.hub.contractorQuote', subKey: 'site.calculators.hub.contractorQuoteSub', icon: FileCheck, image: 'contractor-quote', Component: ContractorQuoteCalculator },
  { id: 'construction-finance', labelKey: 'site.calculators.hub.constructionFinance', subKey: 'site.calculators.hub.constructionFinanceSub', icon: Wallet, image: 'construction-finance', Component: ConstructionFinanceCalculator },
  { id: 'property-tds', labelKey: 'site.calculators.hub.propertyTds', subKey: 'site.calculators.hub.propertyTdsSub', icon: ReceiptIndianRupee, Component: PropertyTdsCalculator },
  { id: 'property-roi', labelKey: 'site.calculators.hub.propertyRoi', subKey: 'site.calculators.hub.propertyRoiSub', icon: TrendingUp, Component: PropertyRoiCalculator },
]

// The existing calculator is a page, so inside this hub two pieces of its own
// chrome are hidden from the parent: the header it renders for itself (the hub
// already shows one) and the top padding that header needs. Written as
// parent-scoped variants so `EstimateCalculator.jsx` is not touched.
// `& > div` is the calculator's own page root; its first child is the wrapper
// holding its `SiteHeader`, and its `<main>` carries the top padding that
// header needs. Both are addressed by position from here, so the calculator's
// own source keeps every class it has.
// The third override releases the calculator's own `max-w-3xl` content cap so
// it fills the hub's right-hand column instead of sitting in the middle of it
// with the freed space left empty. Targeted by that class rather than by
// position, because it is the only one in the component, and applied from here
// so `EstimateCalculator.jsx` keeps every class it has — the same arrangement
// the two overrides above already use.
const embeddedPageChrome = '[&>div>div:first-child]:hidden [&>div>main]:!pt-0 [&_.max-w-3xl]:!max-w-none'

export default function CalculatorHub() {
  // The construction estimate is the one the landing page's button promises, so
  // it is the one already open when the hub loads.
  const [selected, setSelected] = useState(CALCULATORS[0].id)
  const { text } = useLanguage()
  const { t } = useAppLanguage()
  const active = CALCULATORS.find((item) => item.id === selected) || CALCULATORS[0]

  return (
    <div className="min-h-screen overflow-x-clip bg-oc-paper font-display text-oc-ink" id="top">
      <div className="print:hidden">
        <SiteHeader text={text} brandHref="/" />
      </div>

      <main className="pt-[clamp(108px,14vh,156px)] max-wide:pt-[92px] print:pt-0">
        {/* Layout from the approved hub design: one horizontal row of
            illustrated calculator cards, and the selected calculator below at
            full width. Only this shell changed — every calculator renders as
            before. */}
        <div className="px-4 pb-20 sm:px-6 print:px-0 print:pb-0">
          {/* The cards: one row that scrolls sideways inside itself when there
              are more cards than room, so the page never scrolls horizontally.
              Top padding leaves space for the badges that sit on a card's edge. */}
          <nav aria-label={t('site.calculators.hub.aria')} className="min-w-0 print:hidden">
            <ul className="-mx-4 flex snap-x scroll-px-4 gap-2.5 overflow-x-auto px-4 pb-4 pt-4 sm:-mx-6 sm:scroll-px-6 sm:px-6 [scrollbar-width:thin]">
              {CALCULATORS.map((item) => {
                const isActive = item.id === selected
                return (
                  <li key={item.id} className="relative w-[108px] shrink-0 snap-start sm:w-[120px]">
                    {item.badgeKey && (
                      <span className="pointer-events-none absolute -top-3 left-1/2 z-10 -translate-x-1/2 whitespace-nowrap rounded-md bg-[#f9c22e] px-2 py-0.5 text-[10px] font-bold leading-none text-oc-ink shadow-sm after:absolute after:left-1/2 after:top-full after:-translate-x-1/2 after:border-x-[5px] after:border-t-[5px] after:border-x-transparent after:border-t-[#f9c22e] after:content-['']">
                        {t(item.badgeKey)}
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => setSelected(item.id)}
                      aria-current={isActive ? 'page' : undefined}
                      title={item.subKey ? t(item.subKey) : undefined}
                      /* `dash-gold-hover` is the dashboard's own gold hover, kept
                         from the previous cards; the selected card is the design's
                         mint card with a green border. */
                      className={`dash-gold-hover group flex h-full w-full flex-col items-center rounded-xl border px-1.5 pb-3 pt-4 text-center shadow-[0_8px_30px_-8px_rgba(15,23,42,.08)] transition-[transform,box-shadow,border-color,background] duration-300 ease-soft hover:-translate-y-0.5 hover:shadow-[0_18px_40px_-24px_rgba(15,23,42,.35)] ${
                        isActive ? 'border-oc-green bg-oc-mint' : 'border-[rgba(8,62,43,.08)] bg-white'
                      }`}
                    >
                      <span className="flex h-[52px] w-full shrink-0 items-center justify-center sm:h-[60px]">
                        {item.image
                          ? <img src={`${HUB_IMAGES}/${item.image}.png`} alt="" aria-hidden="true" loading="lazy" className="h-full w-full object-contain" />
                          : (
                            <span className={`grid h-11 w-11 place-items-center rounded-xl ${isActive ? 'bg-oc-green text-white' : 'bg-oc-mint text-oc-deep'}`}>
                              <item.icon className="h-6 w-6" />
                            </span>
                          )}
                      </span>
                      <span className="mt-2 font-display text-[11px] font-bold leading-tight text-oc-ink sm:text-xs">
                        {t(item.labelKey)}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </nav>

          {/* Below: the selected calculator, and nothing else. */}
          <div className="mt-4 min-w-0">
            {active.embedded
              ? <div className={embeddedPageChrome}><active.Component /></div>
              : <active.Component />}
          </div>
        </div>
      </main>
    </div>
  )
}
