export const logoUrl = "/crew and build logo.png";
export const hubUrl = "/landing/3d-hub.png";
export const equipmentUrl = "/landing/equipment-miniatures.png";
export const townUrl = "/landing/mini-city.png";
export const introVideoUrl = "/landing/intro.mp4";
export const siteMonitorUrl = "/landing/site-monitor.png";
export const siteUpdatePhotoUrl = "/landing/site-update.jpg";
export const connectionLostUrl = "/landing/connection-lost.png";
export const underDevelopmentUrl = "/landing/under-development.png";
export const lockedOutUrl = "/landing/forgot-password.png";
export const resetDoneUrl = "/landing/password-reset-done.png";

export const containerClass = "w-[min(100%-48px,1240px)] mx-auto";

// Vertical rhythm for the sections that sit on paper rather than a coloured band.
export const sectionPaddingClass = "py-[clamp(4.5rem,3rem+6vw,8rem)]";

// The outline pill the language switch sits in, away from the landing page's amber bar.
export const languagePillClass =
  "inline-flex items-center gap-[7px] min-h-[38px] px-[15px] rounded-full border border-[rgba(8,62,43,.2)] " +
  "text-oc-deep text-[11px] font-extrabold transition-colors duration-200 hover:bg-oc-mint";

// The nav bar's amber face, reused wherever something should carry the brand yellow.
export const amberSurfaceClass = "bg-[linear-gradient(180deg,#f9c85f_0%,#f4b740_52%,#e9a92f_100%)]";

// Round frame that holds one role character at card scale.
export const roleAvatarClass =
  "grid place-items-center shrink-0 w-10 h-10 rounded-full overflow-hidden border border-oc-line bg-oc-mint";

const buttonBase =
  "inline-flex items-center justify-center gap-[13px] rounded-full text-xs leading-normal font-extrabold " +
  "transition-[transform,background,box-shadow] duration-200 ease-soft hover:-translate-y-[3px] active:scale-[.97]";

export const buttonClass =
  `${buttonBase} min-h-[50px] px-7 bg-oc-green text-white shadow-[0_11px_25px_rgba(18,107,69,.18)] ` +
  "hover:bg-oc-deep hover:shadow-[0_17px_29px_rgba(18,107,69,.22)]";

export const smallButtonClass =
  `${buttonBase} min-h-[42px] px-[22px] bg-oc-green text-white shadow-[0_11px_25px_rgba(18,107,69,.18)] ` +
  "hover:bg-oc-deep hover:shadow-[0_17px_29px_rgba(18,107,69,.22)]";

export const creamButtonClass = `${buttonBase} min-h-[50px] px-7 bg-white text-oc-green hover:bg-[#edf8f0]`;

// Defaults to the landing page. Pages that already contain the hero pass "#top" so the
// logo scrolls there instead of reloading. `logoOnly` drops the text name: the
// logo already carries "Crew&Build" and its tagline.

// The white pill the landing header puts the brand on once the page scrolls
// (SiteHeader's logoBadge), for surfaces where the full-colour wordmark needs a
// white ground -- the amber dashboard bar, the photo panel on the auth pages.
export const brandBadgeClass =
  "inline-flex bg-white rounded-full border border-[rgba(8,62,43,.16)] shadow-[0_10px_22px_rgba(23,32,28,.18)]";

// `small` is the same logo scaled down, for a short header bar.
// The logo is cropped to its artwork (about 1.62 : 1); the boxes keep that shape.
export function Brand({ href = "/", logoOnly = false, small = false }) {
  return (
    <a className={`inline-flex items-center ${small ? "gap-2" : "gap-[10px]"} text-[15px] tracking-[.17em] group`} href={href} aria-label="CREWNBUILD home">
      <img
        src={logoUrl}
        alt=""
        className={`${small ? "w-[68px] h-[42px]" : "w-[94px] h-[58px] max-md:w-[78px] max-md:h-[48px]"} object-contain drop-shadow-[0_7px_11px_rgba(8,62,43,.34)]
                   transition-[transform,filter] duration-[250ms] ease-soft
                   group-hover:scale-[1.04] group-hover:drop-shadow-[0_12px_16px_rgba(8,62,43,.4)]`}
      />
      {!logoOnly && <strong className="font-extrabold font-display">CREWNBUILD</strong>}
    </a>
  );
}

// The amber dot needs a different colour on an amber band, or it disappears.
const labelTones = {
  dark: { text: "text-oc-green", dot: "bg-oc-amber shadow-[0_0_0_5px_rgba(244,183,64,.14)]" },
  light: { text: "text-[#b9d8c5]", dot: "bg-oc-amber shadow-[0_0_0_5px_rgba(244,183,64,.14)]" },
  onAmber: { text: "text-oc-deep", dot: "bg-oc-deep shadow-[0_0_0_5px_rgba(8,62,43,.12)]" },
};

export function SectionLabel({ children, tone = "dark" }) {
  const { text, dot } = labelTones[tone];
  return (
    <div className={`flex gap-[9px] items-center text-[10px] uppercase tracking-[.14em] font-extrabold rtl:tracking-normal ${text}`}>
      <span className={`w-2 h-2 rounded-full ${dot}`} />
      {children}
    </div>
  );
}

// A head-and-shoulders crop, for places too small to read a whole figure.
export function RoleFace({ image, className = "" }) {
  return <img src={image} alt="" aria-hidden="true" className={`object-cover ${className}`} />;
}

// One role character. Each is its own file, cut from the artwork sheet on a shared baseline
// and to a shared height, so giving them all the same height keeps their real proportions.
export function RoleCharacter({ image, className = "" }) {
  return (
    <img
      src={image}
      alt=""
      aria-hidden="true"
      className={`relative z-[1] h-full w-auto mx-auto object-contain ${className}`}
    />
  );
}
