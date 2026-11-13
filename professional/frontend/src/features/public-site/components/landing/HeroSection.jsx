import { motion } from "framer-motion";
import { Check, ChevronLeft, ChevronRight, Calculator } from "lucide-react";
import { RoleCharacter, containerClass, townUrl } from "./shared.jsx";
import { roleMeta } from "./content.js";

const scrimStops = "rgba(6,45,31,.9) 0%, rgba(6,45,31,.82) 38%, rgba(6,45,31,.55) 60%, rgba(6,45,31,.2) 80%, rgba(6,45,31,.12) 100%";

// The photo and its readability scrim span the hero, the bridge and the solution panel,
// so the whole block shares one background box — same as the section it replaces.
export function HeroBackdrop({ isArabic, children }) {
  const angle = isArabic ? "270deg" : "90deg";

  return (
    <div
      className="relative overflow-hidden text-white min-h-svh bg-cover bg-no-repeat
                 [background-position:center_-220px] max-wide:[background-position:62%_-220px] rtl:max-wide:[background-position:38%_-220px]"
      style={{ backgroundImage: `linear-gradient(${angle}, ${scrimStops}), url(${townUrl})` }}
    >
      <div className="absolute rounded-full blur-[2px] pointer-events-none opacity-40 w-[340px] h-[340px] end-[6%] top-[8%] bg-[rgba(244,183,64,.14)]" />
      <div className="absolute rounded-full blur-[2px] pointer-events-none opacity-40 w-[260px] h-[260px] start-[4%] bottom-[10%] bg-[rgba(18,107,69,.08)]" />
      {children}
    </div>
  );
}

function SlideArrow({ icon: Icon, label, onClick, className }) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      className={`pointer-events-auto absolute top-1/2 -translate-y-1/2 grid place-items-center w-12 h-12 rounded-full
                  bg-transparent border-0 text-white/85 drop-shadow-[0_2px_10px_rgba(0,0,0,.55)]
                  transition-[color,transform] duration-200 ease-soft hover:text-white hover:scale-110
                  focus-visible:outline-2 focus-visible:outline-oc-amber
                  max-wide:w-10 max-wide:h-10 max-wide:top-auto max-wide:bottom-[143px] max-wide:translate-y-0 ${className}`}
    >
      <Icon size={30} className="rtl:-scale-x-100" />
    </button>
  );
}

export function HeroContent({ text, activeIndex, onSelect }) {
  const role = text.roles[activeIndex];
  const RoleIcon = roleMeta[activeIndex].icon;
  const showPreviousRole = () => onSelect((activeIndex + roleMeta.length - 1) % roleMeta.length);
  const showNextRole = () => onSelect((activeIndex + 1) % roleMeta.length);

  // Left/right keys move through the slides while focus is inside the hero.
  // Arabic reads right to left, so the arrows swap meaning there.
  const isArabic = text.direction === "rtl";
  function handleArrowKeys(event) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const goesForward = isArabic ? event.key === "ArrowLeft" : event.key === "ArrowRight";
    if (goesForward) showNextRole();
    else showPreviousRole();
  }

  return (
    <div
      onKeyDown={handleArrowKeys}
      className={`${containerClass} relative block min-h-svh wide:min-h-0 pt-[clamp(88px,11vh,120px)] pb-[72px] max-wide:pt-[92px] max-wide:pb-[56px]`}
    >
      {/* From 701px the text column lines up with the header's logo: the hero sits
          in the 1240px page container while the header uses 1400px, so the column
          moves left by the difference between the two containers' left edges. */}
      <div className="relative z-[5] w-[min(58%,760px)] max-mid:w-[min(72%,760px)] max-wide:w-full max-wide:pe-1 wide:ms-[calc((min(100vw-48px,1240px)-min(100vw-48px,1400px))/2)]">
        {/* One grid cell holds every step's text: invisible copies size the cell
            to the tallest step at this width, so the tabs, the button, the
            character and the section below stay put whichever step is shown. */}
        {/* grid-cols-1 (a minmax(0,1fr) column): the step text wraps inside the
            column instead of widening it -- a long Telugu question at 1024px
            otherwise ran over the character illustration. */}
        <div className="grid grid-cols-1">
        {text.roles.map((sizerRole, index) => {
          const SizerIcon = roleMeta[index].icon;
          return (
            <div key={`sizer-${index}`} aria-hidden="true" className="invisible pointer-events-none select-none [grid-area:1/1]">
              <div className="inline-flex items-center gap-[9px] px-3 py-2 rounded-full text-[11px] font-extrabold border">
                <span className="grid place-items-center w-6 h-6 rounded-full"><SizerIcon size={16} /></span>
                {sizerRole.eyebrow}
              </div>
              <div
                className="max-w-[760px] mt-6 font-extrabold text-balance tracking-[-.065em] leading-[1.15]
                           text-[clamp(2rem,min(4.4vw,6.6vh),5rem)] max-wide:text-[clamp(1.6rem,min(7.4vw,5.4vh),3rem)]
                           rtl:tracking-normal rtl:leading-[1.45]"
              >
                {sizerRole.questions[0]}
                <br />
                <span>{sizerRole.questions[1]}</span>
              </div>
              <p className="max-w-[520px] mt-6 text-sm leading-[1.55] max-wide:max-w-[310px] max-wide:text-xs max-wide:leading-[1.45]">
                {text.heroHelper}
              </p>
            </div>
          );
        })}
        <motion.div
          key={`${text.direction}-${activeIndex}`}
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45 }}
          className="[grid-area:1/1]"
        >
          <div className="inline-flex items-center gap-[9px] px-3 py-2 rounded-full text-[11px] font-extrabold text-white bg-white/15 border border-white/30 backdrop-blur-[10px]">
            <span className="grid place-items-center w-6 h-6 rounded-full bg-oc-amber text-oc-deep">
              <RoleIcon size={16} />
            </span>
            {role.eyebrow}
          </div>

          <h1
            id="hero-title"
            className="max-w-[760px] mt-6 font-extrabold text-balance tracking-[-.065em] leading-[1.15] [text-shadow:0_4px_25px_rgba(0,0,0,.2)]
                       text-[clamp(2rem,min(4.4vw,6.6vh),5rem)] max-wide:text-[clamp(1.6rem,min(7.4vw,5.4vh),3rem)]
                       rtl:tracking-normal rtl:leading-[1.45]"
          >
            {role.questions[0]}
            <br />
            <span className="text-[#b9efc9]">{role.questions[1]}</span>
          </h1>

          <p className="max-w-[520px] mt-6 text-sm leading-[1.55] text-[#e3f2e7] max-wide:max-w-[310px] max-wide:text-xs max-wide:leading-[1.45]">
            {text.heroHelper}
          </p>
        </motion.div>
        </div>

        <div className="flex gap-[7px] mt-6 max-wide:mt-[25px]" role="tablist" aria-label={text.rolesSection.label}>
          {roleMeta.map((meta, index) => (
            <button
              key={meta.key}
              role="tab"
              aria-selected={activeIndex === index}
              onClick={() => onSelect(index)}
              className={`w-[34px] h-[34px] rounded-full text-[10px] font-extrabold border transition-[transform,background,color] duration-200 ease-soft
                          ${activeIndex === index
                            ? "bg-oc-amber text-oc-deep border-oc-amber -translate-y-[3px]"
                            : "bg-transparent text-white border-white/45 hover:bg-oc-amber hover:text-oc-deep hover:border-oc-amber hover:-translate-y-[3px]"}`}
            >
              {index + 1}
            </button>
          ))}
        </div>

        {/* Get Free Estimate — directly below the 1-2-3-4-5 tabs */}
        <a
          href="/estimate"
          className="inline-flex items-center gap-[7px] mt-4 px-4 py-2.5 rounded-full text-[11px] font-extrabold text-oc-deep bg-oc-amber border border-oc-amber backdrop-blur-[10px] transition-[transform,box-shadow] duration-200 ease-soft hover:-translate-y-[2px] hover:shadow-[0_10px_22px_rgba(244,183,64,.28)]"
        >
          <Calculator size={14} />
          {text.freeEstimate?.button || "Get Free Estimate"}
        </a>

        {/* On a phone the character takes its own row under the text instead of
            floating over it. */}
        <motion.div
          key={`phone-${activeIndex}`}
          initial={{ opacity: 0, y: 20, scale: 0.86, rotate: -5 }}
          animate={{ opacity: 1, y: 0, scale: 1, rotate: 0 }}
          transition={{ duration: 0.55, ease: [0.23, 1, 0.32, 1] }}
          className="wide:hidden relative mx-auto mt-8 w-[150px]"
        >
          <div className="absolute inset-x-5 -bottom-2 h-[25px] rounded-full bg-black/30 blur-[9px]" />
          <div
            className="flex items-end justify-center overflow-hidden w-[150px] h-[214px]
                       rounded-t-[110px] rounded-b-[20px] bg-white/15 border border-white/50
                       shadow-[0_26px_42px_rgba(0,0,0,.28),inset_0_0_0_10px_rgba(255,255,255,.18)]"
          >
            <RoleCharacter image={roleMeta[activeIndex].image} className="drop-shadow-[0_20px_12px_rgba(0,0,0,.2)]" />
          </div>
        </motion.div>
      </div>

      <div className="absolute inset-y-0 start-1/2 -translate-x-1/2 rtl:translate-x-1/2 w-screen z-[6] pointer-events-none">
        <SlideArrow icon={ChevronLeft} label={text.prevRole} onClick={showPreviousRole} className="start-4 max-wide:start-2" />
        <SlideArrow icon={ChevronRight} label={text.nextRole} onClick={showNextRole} className="end-4 max-wide:end-2" />
      </div>

      <div className="absolute inset-0 z-[2] pointer-events-none">
        <div className="relative h-full">
          <div
            className="absolute inset-y-0 start-1/2 -translate-x-1/2 w-screen opacity-[.16]
                       bg-[linear-gradient(rgba(18,107,69,.18)_1px,transparent_1px),linear-gradient(90deg,rgba(18,107,69,.18)_1px,transparent_1px)]
                       [background-size:52px_52px] [mask-image:linear-gradient(to_bottom,transparent,black_28%,black_76%,transparent)]"
          />
          <div className="absolute end-[12%] top-[10%] w-[110px] h-[110px] rounded-full opacity-55 bg-[rgba(244,183,64,.2)] shadow-[0_0_0_16px_rgba(244,183,64,.08)]" />

          <motion.div
            key={activeIndex}
            initial={{ opacity: 0, y: 20, scale: 0.86, rotate: -5 }}
            animate={{ opacity: 1, y: 0, scale: 1, rotate: 0 }}
            transition={{ duration: 0.55, ease: [0.23, 1, 0.32, 1] }}
            className="absolute z-[4] end-[18%] bottom-[19%] scale-[1.2] max-wide:hidden
                       max-mid:end-[10%] max-mid:bottom-[18%] max-mid:scale-[1.05]
                       max-wide:end-[19%] max-wide:bottom-[19%] max-wide:scale-[.78]"
          >
            <div className="absolute inset-x-5 -bottom-2 h-[25px] rounded-full bg-black/30 blur-[9px]" />
            <div
              className="flex items-end justify-center overflow-hidden w-[245px] h-[350px] max-mid:w-[210px] max-mid:h-[300px] max-wide:w-[170px] max-wide:h-[242px]
                         rounded-t-[110px] rounded-b-[20px] bg-white/15 border border-white/50
                         shadow-[0_26px_42px_rgba(0,0,0,.28),inset_0_0_0_10px_rgba(255,255,255,.18)]"
            >
              <RoleCharacter image={roleMeta[activeIndex].image} className="drop-shadow-[0_20px_12px_rgba(0,0,0,.2)]" />
            </div>
          </motion.div>

          <div className="absolute z-[5] inset-x-[5%] bottom-7 flex justify-between text-[10px] font-extrabold text-[#e4f2e8] max-wide:inset-x-[18px] max-wide:bottom-4 max-wide:text-[8px]">
            <span className="flex items-center gap-1.5"><Check size={13} /> {text.sceneFooter[0]}</span>
            <span className="flex items-center gap-1.5"><Check size={13} /> {text.sceneFooter[1]}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
