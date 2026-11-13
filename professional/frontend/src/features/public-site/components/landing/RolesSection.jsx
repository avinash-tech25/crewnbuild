import { useEffect, useRef } from "react";
import { motion } from "framer-motion";
import { ChevronRight, Sparkles } from "lucide-react";
import { RoleCharacter, SectionLabel, containerClass } from "./shared.jsx";
import { roleDestination, roleMeta } from "./content.js";
import { riseIn, staggerGroup, useScrollReveal } from "./scrollReveal.js";

// Each role holds for most of a screen of scrolling before the next takes over, so the
// first one is on show by default and none of them flash past. On the narrow layout the
// track is only as tall as its content, so the roles share that height instead.
const screensPerRole = 0.8;

function useScrollActivatedRole(onActivate) {
  const trackRef = useRef(null);

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return undefined;

    const update = () => {
      const { top, height } = track.getBoundingClientRect();
      const scrolledIntoTrack = -top;
      const perRole = Math.min(window.innerHeight * screensPerRole, height / roleMeta.length);
      const step = Math.floor(scrolledIntoTrack / perRole);
      onActivate(Math.min(roleMeta.length - 1, Math.max(0, step)));
    };

    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [onActivate]);

  return trackRef;
}

// Constants, not inline objects — a new object each render restarts the tile's animations.
const tileHoverLeft = { x: -8, y: -4, rotate: -1.5 };
const tileHoverRight = { x: 8, y: -4, rotate: -1.5 };

function RoleTile({ role, index, isActive, onActivate, isArabic, comingSoonLabel }) {
  const Icon = roleMeta[index].icon;
  // Only the active tile turns green — hover just lifts it, so one role reads as selected at a time.
  const activeTile = isActive
    ? "bg-oc-green border-oc-green shadow-[0_18px_34px_rgba(0,0,0,.2)] translate-x-[10px] rtl:-translate-x-[10px] max-wide:translate-x-0"
    : "bg-white/8 border-white/20 hover:bg-white/[.14] hover:border-white/30";

  return (
    <motion.a
      variants={riseIn}
      data-role-index={index}
      href={roleDestination(roleMeta[index].key)}
      onMouseEnter={onActivate}
      onFocus={onActivate}
      whileHover={isArabic ? tileHoverLeft : tileHoverRight}
      className={`group w-full flex items-center gap-[15px] px-[17px] py-4 rounded-xl border text-start text-white
                  transition-[box-shadow,background,transform] duration-[250ms] ease-soft ${activeTile}`}
    >
      <span
        className={`grid place-items-center shrink-0 w-[42px] h-[42px] rounded-[10px] transition-[transform,background,color] duration-[250ms] ease-soft
                    ${isActive ? "bg-oc-amber text-oc-deep rotate-[-12deg] scale-[1.08]" : "bg-[rgba(223,240,232,.16)] text-[#d5f1de]"}`}
      >
        <Icon size={18} />
      </span>

      <span className="flex flex-col gap-1">
        <span className="flex items-center gap-2">
          <b className="text-sm leading-normal">{role.title}</b>
          {roleMeta[index].comingSoon && (
            <span className="rounded-full bg-oc-amber px-2 py-[3px] text-[9px] font-extrabold uppercase tracking-[.08em] text-oc-deep rtl:tracking-normal">
              {comingSoonLabel}
            </span>
          )}
        </span>
        <small className={`text-[10px] ${isActive ? "text-[#dcf4e3]" : "text-[#b9d8c5]"}`}>{role.short}</small>
        {isActive && <em className="not-italic text-[10px] font-extrabold text-oc-amber">{role.benefit}</em>}
      </span>

      <ChevronRight size={17} className={`ms-auto rtl:-scale-x-100 ${isActive ? "text-[#c9e4d3]" : "text-[#a9d6bc]"}`} />
    </motion.a>
  );
}

export function RolesSection({ text, isArabic, activeIndex, onSelect }) {
  const trackRef = useScrollActivatedRole(onSelect);
  const reveal = useScrollReveal();

  return (
    <section
      id="roles"
      className="relative text-white pt-32 pb-[135px] max-wide:pt-[84px] max-wide:pb-[90px] bg-oc-deep
                 bg-[radial-gradient(circle_at_18%_18%,rgba(95,182,130,.22),transparent_34%),radial-gradient(circle_at_88%_78%,rgba(244,183,64,.12),transparent_26%)]
                 before:content-[''] before:absolute before:inset-x-0 before:top-0 before:h-px
                 before:bg-[linear-gradient(90deg,var(--color-amber),rgba(255,255,255,.35),transparent_70%)]"
    >
      <div className={containerClass}>
        <motion.div variants={staggerGroup} {...reveal} className="flex items-end justify-between gap-[50px] max-wide:block">
          <div>
            <motion.div variants={riseIn}>
              <SectionLabel tone="light">{text.rolesSection.label}</SectionLabel>
            </motion.div>
            <motion.h2
              variants={riseIn}
              className="mt-[21px] font-extrabold tracking-[-.06em] leading-[.96] text-[clamp(3rem,5vw,5.2rem)] rtl:tracking-normal rtl:leading-[1.18] max-wide:text-[3.3rem]"
            >
              {text.rolesSection.headline}
              <br />
              <span className="text-[#a9d6bc]">{text.rolesSection.highlight}</span>
            </motion.h2>
          </div>
          <motion.p variants={riseIn} className="max-w-[340px] mb-[5px] text-sm leading-[1.75] text-[#b9d8c5] max-wide:mt-[25px]">
            {text.rolesSection.body}
          </motion.p>
        </motion.div>

        {/* The track supplies the scroll distance; the showcase pins inside it so each role
            stays on screen for its share of the scrolling. */}
        <div ref={trackRef} className="relative mt-[70px] max-wide:mt-[45px] wide:h-[400vh]">
          <div className="grid grid-cols-2 gap-[70px] items-center max-mid:gap-10 max-wide:flex max-wide:flex-col max-wide:gap-7 wide:sticky wide:top-[110px]">
          <div className="relative grid place-items-center h-[440px] border-b border-white/20 max-wide:w-full max-wide:h-[360px]">
            <div className="absolute w-[300px] h-[300px] rounded-full border border-dashed border-white/35 rotate-[-18deg] max-wide:w-[240px] max-wide:h-[240px]" />
            <motion.div
              key={activeIndex}
              initial={{ opacity: 0, y: 16, scale: 0.92 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ duration: 0.35 }}
              className={`relative z-[2] grid place-items-center w-[245px] h-[320px] origin-[50%_82%] drop-shadow-[0_24px_15px_rgba(21,68,44,.18)] max-wide:w-[195px] max-wide:h-[260px] ${roleMeta[activeIndex].animation}`}
            >
              <div className="relative w-[220px] h-[305px] overflow-hidden max-wide:w-[190px] max-wide:h-[265px]">
                <RoleCharacter image={roleMeta[activeIndex].image} className="drop-shadow-[0_20px_12px_rgba(0,0,0,.24)]" />
                <span className="absolute inset-x-4 bottom-[15px] h-[17px] rounded-full bg-black/30 blur-[7px]" />
              </div>
            </motion.div>
            <div className="absolute bottom-[43px] w-[180px] h-[25px] rounded-full bg-black/30 blur-[10px]" />
            <div className="absolute bottom-[15px] flex items-center gap-[7px] text-[10px] font-extrabold text-[#d1ebda]">
              <Sparkles size={14} className="text-oc-amber" /> {text.rolesSection.caption}
            </div>
          </div>

          <motion.div variants={staggerGroup} {...reveal} className="flex flex-col gap-[10px] max-wide:w-full">
            {text.roles.map((role, index) => (
              <RoleTile
                key={role.title}
                role={role}
                index={index}
                isActive={activeIndex === index}
                isArabic={isArabic}
                comingSoonLabel={text.comingSoon}
                onActivate={() => onSelect(index)}
              />
            ))}
            </motion.div>
          </div>
        </div>
      </div>
    </section>
  );
}
