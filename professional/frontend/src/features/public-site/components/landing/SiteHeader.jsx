import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowRight, BadgeCheck, Crown, Globe, Handshake, LayoutGrid, Menu, Phone, Users, Workflow, X } from "lucide-react";
import { Brand, smallButtonClass } from "./shared.jsx";
import { useLanguage } from "../../../../i18n/LanguageContext.jsx";
import PublicWeatherIndicator from "../../../weather/components/PublicWeatherIndicator.jsx";

// A solid white bar across the top of the page. Once the visitor scrolls, the bar itself and
// everything in it fades out and only the logo stays, on its own white badge in the corner.
const restingSurface =
  "bg-white border-b border-[rgba(8,62,43,.12)] shadow-[0_10px_24px_rgba(23,32,28,.12)]";

const scrolledSurface = "border-b border-transparent bg-transparent shadow-none pointer-events-none";

const logoBadge =
  `bg-white rounded-full border border-[rgba(8,62,43,.16)] ps-[14px] pe-[18px] py-[7px] pointer-events-auto ` +
  "shadow-[0_10px_22px_rgba(23,32,28,.18)]";

function useHasScrolled(threshold = 40) {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const update = () => setScrolled(window.scrollY > threshold);
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, [threshold]);

  return scrolled;
}

// Every nav label carries one icon at the same size and stroke, inline with
// the text (never above or below it), as in the reference bar.
const navIconProps = { size: 15, strokeWidth: 2, "aria-hidden": true, className: "shrink-0" };

const linkBaseClass =
  "inline-flex items-center gap-[7px] max-[1365px]:gap-[6px] transition-colors duration-200 hover:text-oc-deep";
const linkMenuClass = "py-[15px] border-b border-[rgba(8,62,43,.16)] text-xs";

// Below this width the links never fit in one row, whatever the language.
const MENU_QUERY = "(max-width: 1279px)";

// Whether the header shows its menu button instead of the row of links.
// Under 1280px always. Above it, only when the row would overflow: the Telugu,
// Kannada, Tamil and Malayalam labels are several times wider than the English
// ones, so a fixed breakpoint either cut off Get started for them or hid the
// links from English readers on screens with room for them. The row is put
// back inline and measured whenever the width or the language changes; both
// renders happen before the browser paints, so nothing flickers.
function useMenuMode(rowRef, language, watchRef) {
  const [narrow, setNarrow] = useState(() => typeof window !== "undefined" && window.matchMedia(MENU_QUERY).matches);
  const [overflowing, setOverflowing] = useState(false);
  // Still too wide with the menu button showing (a long language on a tablet):
  // Sign in and Get started then move into the menu, as they do on phones.
  const [crowded, setCrowded] = useState(false);
  const [measureKey, setMeasureKey] = useState(0);

  useEffect(() => {
    const media = window.matchMedia(MENU_QUERY);
    const remeasure = () => {
      setNarrow(media.matches);
      setOverflowing(false);
      setCrowded(false);
      setMeasureKey((key) => key + 1);
    };
    window.addEventListener("resize", remeasure);
    // Web fonts change the labels' widths once they arrive.
    document.fonts?.ready.then(remeasure);
    // So does the weather indicator once its weather loads. Its width does not
    // depend on the menu mode, so this cannot feed back into itself.
    let lastWidth = null;
    const observer = typeof ResizeObserver !== "undefined" && watchRef?.current
      ? new ResizeObserver(([entry]) => {
          const width = Math.round(entry.contentRect.width);
          if (lastWidth !== null && width !== lastWidth) remeasure();
          lastWidth = width;
        })
      : null;
    if (observer) observer.observe(watchRef.current);
    return () => { window.removeEventListener("resize", remeasure); observer?.disconnect(); };
  }, [watchRef]);

  useLayoutEffect(() => { setOverflowing(false); setCrowded(false); }, [language]);

  useLayoutEffect(() => {
    const row = rowRef.current;
    if (!row || crowded || row.scrollWidth <= row.clientWidth + 1) return;
    if (narrow || overflowing) setCrowded(true);
    else setOverflowing(true);
  }, [narrow, overflowing, crowded, measureKey, language, rowRef]);

  return { menuMode: narrow || overflowing, crowded };
}

// The thin deep-green strip above the logo bar: the network's name in amber,
// then what visitors come to do, each cut off from the next by a thin rule,
// and the trust indicators on the right. It sits in
// normal flow ABOVE the sticky bar, so it scrolls away on its own and the bar
// (and the hero's own top spacing beneath it) is left exactly as it was.
// Plain text, not links: these are not new navigation entries.
const topStripActions = ["Build", "Buy", "Sell", "Hire", "Supply"];

// Brand reassurance on the right of the strip. Informational labels only: they
// are not links and they do not claim that any particular account is verified.
const trustIndicators = [
  { label: "Verified Professionals", Icon: BadgeCheck },
  { label: "Trusted Suppliers", Icon: Handshake },
];

function TopStrip() {
  return (
    <div className="relative z-[21] w-full bg-oc-deep text-white">
      <div className={`${headerContainerClass} flex h-[36px] items-center gap-[18px] overflow-hidden whitespace-nowrap text-[12px] font-bold leading-none max-wide:h-[32px] max-wide:gap-3 max-wide:text-[10.5px] max-[400px]:gap-2 max-[400px]:text-[10px] max-[380px]:gap-[6px]`}>
        <span className="font-extrabold tracking-[.01em] text-oc-amber">India&apos;s Construction Network</span>
        <span aria-hidden="true" className="h-[14px] w-px shrink-0 bg-white/35 max-[350px]:hidden" />
        <ul className="m-0 flex list-none items-center p-0 text-white/85 max-[350px]:hidden" aria-label="What you can do on Crew&Build">
          {topStripActions.map((action, index) => (
            <li key={action} className="flex items-center">
              {index > 0 && <span aria-hidden="true" className="mx-[12px] h-[12px] w-px bg-white/30 max-wide:mx-2 max-[400px]:mx-[5px] max-[380px]:mx-[4px]" />}
              {action}
            </li>
          ))}
        </ul>
        {/* The brand's diagonal amber cuts after Supply: three 9px stripes on a
            17px rhythm (43px = stripe, gap, stripe, gap, stripe). */}
        <span
          aria-hidden="true"
          className="hidden wide:block h-full w-[43px] shrink-0 -skew-x-[30deg] rtl:skew-x-[30deg]
                     bg-[repeating-linear-gradient(90deg,#f4b740_0_9px,transparent_9px_17px)]"
        />
        {/* Only where both halves fit on one line; narrower screens keep the
            left-hand group alone, as before. */}
        <ul
          data-trust
          className="m-0 ms-auto hidden list-none items-center p-0 text-white/90 min-[900px]:flex"
          aria-label="Crew&Build trust indicators"
        >
          {trustIndicators.map(({ label, Icon }, index) => (
            <li key={label} className="flex items-center">
              {index > 0 && <span aria-hidden="true" className="mx-[14px] h-[12px] w-px bg-white/30" />}
              <Icon size={14} strokeWidth={2.2} aria-hidden="true" className="me-[6px] shrink-0 text-oc-amber" />
              {label}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

// Sign in as an outline pill and Get started on the brand amber, as in the
// reference bar. Same links, same labels.
const signInPillClass =
  "inline-flex min-h-[40px] items-center rounded-full border border-[rgba(8,62,43,.3)] px-[18px] max-[1365px]:px-[14px] " +
  "transition-colors duration-200 hover:bg-oc-mint";

const startPillClass =
  "inline-flex min-h-[42px] items-center justify-center gap-[10px] rounded-full bg-oc-amber px-[22px] max-[1365px]:px-[16px] text-oc-deep " +
  "shadow-[0_11px_25px_rgba(244,183,64,.28)] transition-[transform,background] duration-200 ease-soft " +
  "hover:-translate-y-[3px] hover:bg-[#e9a92f] active:scale-[.97]";

const headerContainerClass = "w-[min(100%-48px,1400px)] mx-auto";

// A thin light-grey rule between items of the white bar (row layout only; the
// open menu already rules its entries off with borders). Its negative margins
// cancel one flex gap, so items keep the spacing they had, with the rule
// centred between them.
function NavRule({ className = "" }) {
  return <span aria-hidden="true" className={`h-[18px] w-px shrink-0 bg-[rgba(8,62,43,.14)] ${className}`} />;
}
const navLinkRuleClass = "-mx-[12px] max-[1365px]:-mx-[7px]";
const navEdgeRuleClass =
  "flex shrink-0 w-[17px] justify-center -mx-[4px] max-[1365px]:w-[13px] max-[1365px]:-mx-[4px]";

export function SiteHeader({ text, brandHref = "#top" }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const scrolled = useHasScrolled();
  // Read from the application context rather than from props: this is the one
  // language selection the whole app shares, and the page's own `text` already
  // follows it.
  const { language, setLanguage, languages, t } = useLanguage();
  const languageLabel = t("language.label");
  const rowRef = useRef(null);
  const weatherRef = useRef(null);
  const { menuMode, crowded } = useMenuMode(rowRef, language, weatherRef);
  const linkClass = `${linkBaseClass} ${menuMode ? linkMenuClass : ""}`;
  // The section links point at the landing page's sections. On the landing page
  // they are in-page anchors; on the other pages that use this header (Contact
  // Us, calculators, support tickets) a bare "#roles" pointed at a section that
  // page does not have, so the click did nothing. Same rule as View plans below.
  const sectionHref = (id) => (brandHref === "#top" ? `#${id}` : `/#${id}`);
  // Contact us is marked as the current page on the Contact & Support pages.
  const onContactPage = typeof window !== "undefined" && window.location.pathname.startsWith("/contact-us");

  // The bar leaves with the menu still open otherwise, and it would be open again on return.
  useEffect(() => { if (scrolled) setMenuOpen(false); }, [scrolled]);

  // Everything except the logo fades out once the visitor scrolls.
  const barItemClass = `transition-opacity duration-300 ease-soft ${scrolled ? "opacity-0 pointer-events-none" : "opacity-100"}`;

  return (
    <>
    <TopStrip />
    <header
      className={`sticky top-0 z-20 h-[62px] w-full mb-[-62px]
                  transition-[background,box-shadow,border-color] duration-300 ease-soft
                  max-wide:h-[52px] max-wide:mb-[-52px]
                  ${scrolled ? scrolledSurface : restingSurface}`}
    >
      {/* A little wider than the page container on large screens, and with a
          floor of 16px between the groups, so the iconned links never touch
          the logo or the language pill. */}
      <div ref={rowRef} className={`${headerContainerClass} h-full flex items-center gap-[16px] max-[1365px]:gap-[12px] max-wide:gap-0`}>
        <span
          className={`flex shrink-0 transition-[background,box-shadow,padding] duration-300 ease-soft
                      max-[380px]:[&_img]:h-[44px] max-[380px]:[&_img]:w-[71px]
                      ${scrolled ? logoBadge : ""}`}
        >
          <Brand href={brandHref} logoOnly />
        </span>

        {/* The rules either side of the links are fixed; the free space of the
            bar goes to the nav, which spreads its links evenly (justify-between),
            so no single gap -- such as between Contact us and the language
            pill -- swallows it all. Each in-nav rule stays midway in its gap. */}
        {!menuMode && <span aria-hidden="true" className={`${navEdgeRuleClass} ${barItemClass}`}><NavRule /></span>}

        {/* The menu button takes over from the row of links whenever they do not
            fit beside the logo, language switch and Get Started (useMenuMode). */}
        <nav
          className={`${menuOpen || !menuMode ? "flex" : "hidden"} ${barItemClass} items-center whitespace-nowrap text-xs leading-normal font-bold text-[rgba(8,62,43,.8)]
                      ${menuMode
                        ? "absolute inset-x-0 top-full m-0 flex-col items-stretch gap-0 rounded-b-[20px] border-b border-[rgba(8,62,43,.16)] bg-white px-5 pt-[10px] pb-4 shadow-[0_16px_30px_rgba(23,32,28,.18)]"
                        : "flex-1 justify-between gap-[24px] max-[1365px]:gap-[14px]"}`}
        >
          <a className={linkClass} href={sectionHref("roles")} onClick={() => setMenuOpen(false)}><Users {...navIconProps} />{text.nav.roles}</a>
          {!menuMode && <NavRule className={navLinkRuleClass} />}
          <a className={linkClass} href={sectionHref("how")} onClick={() => setMenuOpen(false)}><Workflow {...navIconProps} />{text.nav.how}</a>
          {!menuMode && <NavRule className={navLinkRuleClass} />}
          <a className={linkClass} href={sectionHref("world")} onClick={() => setMenuOpen(false)}><LayoutGrid {...navIconProps} />{text.nav.world}</a>
          {!menuMode && <NavRule className={navLinkRuleClass} />}
          {/* View Plans: the builder plans section further down this page. */}
          <a
            className="inline-flex items-center justify-center gap-1.5 rounded-full bg-emerald-600 px-3.5 py-1.5 text-white transition-colors duration-200 hover:bg-emerald-700 max-wide:my-[10px] max-wide:py-[10px] max-wide:text-xs"
            // The section lives on the home page; elsewhere (calculators, contact) go there.
            href={brandHref === "#top" ? "#plans" : "/#plans"}
            onClick={() => setMenuOpen(false)}
          >
            <Crown {...navIconProps} /> {text.nav.plans}
          </a>
          {!menuMode && <NavRule className={navLinkRuleClass} />}
          <a
            className={`${linkClass} ${menuMode ? "border-b-0" : ""} ${onContactPage ? `text-oc-deep ${menuMode ? "" : "relative after:absolute after:inset-x-0 after:-bottom-[7px] after:h-[3px] after:rounded-full after:bg-oc-amber"}` : ""}`}
            href="/contact-us"
            aria-current={onContactPage ? "page" : undefined}
            onClick={() => setMenuOpen(false)}
          ><Phone {...navIconProps} />{text.nav.contactUs}</a>
          {/* Phones have no room for these in the bar, so the menu carries them. */}
          <div className={`${crowded ? "" : "wide:hidden"} flex flex-col gap-[10px] pt-[14px] border-t border-[rgba(8,62,43,.16)]`}>
            <a
              className="inline-flex min-h-[42px] items-center justify-center rounded-full border border-[rgba(8,62,43,.3)] text-xs font-extrabold text-oc-deep"
              href="/login"
            >
              {text.nav.signIn}
            </a>
            <a className={smallButtonClass} href="/signup">
              {text.nav.start} <ArrowRight size={15} className="rtl:-scale-x-100" />
            </a>
          </div>
        </nav>

        {!menuMode && <span aria-hidden="true" className={`${navEdgeRuleClass} ${barItemClass}`}><NavRule /></span>}

        {/* The weather where the visitor is (or chooses), beside the language
            switch; its detail opens in a popover. Fades with the bar on scroll. */}
        <span ref={weatherRef} className={`${barItemClass} shrink-0 me-[10px] max-[1365px]:me-2 max-[380px]:me-1.5 ${menuMode ? "ms-auto" : ""}`}>
          <PublicWeatherIndicator concealed={scrolled} />
        </span>

        {/* Every language the app offers, not a two-way English/Arabic flip.
            This control writes the application-wide selection, so the old
            toggle switched a Telugu reader to Arabic -- `isArabic` was false
            for them, and the "other" language was hardcoded as Arabic.
            Each language is named in itself, so the list stays readable
            whichever one is active. */}
        <label
          className={`${barItemClass} inline-flex items-center gap-[7px] min-h-[38px] px-[15px] max-[1365px]:px-[12px] me-[6px] max-[1365px]:me-0 rounded-full bg-white/[.34] text-oc-deep text-[11px] font-extrabold
                     border border-[rgba(8,62,43,.3)] ease-soft hover:bg-white/[.7] hover:-translate-y-[2px]
                     focus-within:ring-2 focus-within:ring-oc-deep/40
                     ${menuMode ? "me-0" : ""} max-wide:min-h-[33px] max-wide:px-[11px] max-wide:text-[10px] max-[380px]:px-2`}
        >
          <Globe size={14} className="shrink-0 max-[380px]:hidden" />
          <span className="sr-only">{languageLabel}</span>
          <select
            value={language}
            onChange={(event) => setLanguage(event.target.value)}
            aria-label={languageLabel}
            /* The focus ring lives on the label above, not here: a ring on this
               square-cornered <select> painted a rectangle inside the rounded
               pill, and a <select> matches :focus-visible on a plain mouse
               click, so it appeared as a second, nested control the moment the
               language was clicked. */
            className="cursor-pointer appearance-none border-0 bg-transparent p-0 pe-1 text-[11px] font-extrabold text-oc-deep focus:outline-none max-wide:text-[10px]"
          >
            {languages.map(({ code, name }) => (
              <option key={code} value={code} className="text-oc-ink">
                {name}
              </option>
            ))}
          </select>
        </label>

        {!menuMode && <NavRule className={`-ms-[11px] -me-[5px] max-[1365px]:-mx-[6px] ${barItemClass}`} />}

        <div className={`hidden ${crowded ? "" : "wide:flex"} ${barItemClass} ${menuMode ? "gap-3" : "gap-5 max-[1365px]:gap-[10px]"} whitespace-nowrap items-center text-oc-deep text-xs leading-normal font-extrabold`}>
          <a className={signInPillClass} href="/login">{text.nav.signIn}</a>
          <a className={startPillClass} href="/signup">
            {text.nav.start} <ArrowRight size={15} className="rtl:-scale-x-100" />
          </a>
        </div>

        <button className={`${menuMode ? "" : "hidden"} ${barItemClass} ms-2 wide:ms-4 text-oc-ink`} onClick={() => setMenuOpen(!menuOpen)} aria-label="Toggle menu">
          {menuOpen ? <X className="w-[22px]" /> : <Menu className="w-[22px]" />}
        </button>
      </div>
    </header>
    </>
  );
}
