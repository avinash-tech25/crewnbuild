import { ArrowLeft, Globe, Wrench } from "lucide-react";
import { Brand, buttonClass, languagePillClass, underDevelopmentUrl } from "../components/landing/shared.jsx";
import { useLanguage } from "../components/landing/useLanguage.js";
import { roleMeta } from "../components/landing/content.js";

// The page is reached as /coming-soon?role=equipment, so it can name and picture whichever
// module is not open yet. Without a role it still reads as a general "not ready" page.
function upcomingRoleFromLink() {
  const requested = new URLSearchParams(window.location.search).get("role");
  return roleMeta.findIndex((role) => role.key === requested && role.comingSoon);
}

export default function ComingSoon() {
  const { setLanguage, text, isArabic } = useLanguage();
  const copy = text.comingSoonPage;
  const roleIndex = upcomingRoleFromLink();
  const role = roleIndex >= 0 ? roleMeta[roleIndex] : null;

  return (
    <div className="min-h-svh flex flex-col bg-oc-paper px-[8%] py-5 max-wide:px-6">
      <div className="flex items-center justify-between">
        <Brand />
        <button
          onClick={() => setLanguage(isArabic ? "en" : "ar")}
          lang={isArabic ? "en" : "ar"}
          className={languagePillClass}
        >
          <Globe size={14} />
          {isArabic ? "English" : "العربية"}
        </button>
      </div>

      <div className="flex flex-col items-center my-auto mx-auto w-full max-w-[540px] text-center">
        <img
          src={underDevelopmentUrl}
          alt=""
          aria-hidden="true"
          className="w-auto max-h-[34svh] object-contain drop-shadow-[0_26px_34px_rgba(8,62,43,.18)]"
        />

        <span className="mt-6 inline-flex items-center gap-[7px] text-[10px] font-extrabold uppercase tracking-[.16em] text-oc-green rtl:tracking-normal">
          <span className="w-2 h-2 rounded-full bg-oc-amber shadow-[0_0_0_5px_rgba(244,183,64,.14)]" />
          {copy.eyebrow}
        </span>

        <h1 className="mt-3 font-extrabold tracking-[-.05em] leading-[1.05] text-[clamp(1.8rem,3vw,2.5rem)] rtl:tracking-normal rtl:leading-[1.3]">
          {copy.headline}
          <br />
          <span className="text-oc-green">{copy.highlight}</span>
        </h1>

        {role && (
          <span className="mt-4 inline-flex items-center gap-2 rounded-full bg-oc-amber px-3.5 py-1.5 text-[11px] font-extrabold text-oc-deep">
            <Wrench size={13} />
            {text.roles[roleIndex].title} · {copy.inDevelopment}
          </span>
        )}

        <p className="mt-4 text-sm leading-[1.75] text-oc-muted">{copy.body}</p>

        <div className="flex flex-wrap items-center justify-center gap-3 mt-7">
          <a className={buttonClass} href="/signup">{copy.chooseAnother}</a>
          <a
            className="inline-flex items-center gap-2 min-h-[50px] px-6 rounded-full border border-oc-line bg-white text-xs font-extrabold text-oc-ink
                       transition-colors duration-200 hover:bg-oc-mint"
            href="/"
          >
            <ArrowLeft size={15} className="rtl:-scale-x-100" />
            {copy.backHome}
          </a>
        </div>
      </div>
    </div>
  );
}
