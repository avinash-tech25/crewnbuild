import { useState } from "react";
import { motion } from "framer-motion";
import { ArrowRight, ChevronRight } from "lucide-react";
import { buttonClass, creamButtonClass } from "./shared.jsx";
import ConstructionVilla from "./ConstructionVilla.jsx";
import { letterStaggerGroup, popIn, useScrollReveal } from "./scrollReveal.js";

// Stacked shadows extrude the wordmark into a solid block. The offsets use em so the
// depth stays proportional as the type scales, and the greens darken with each step
// to read as a face falling away from the light.
const extrusionGreens = ["#10603e", "#0f5839", "#0e5134", "#0c4a30", "#0b432b", "#0a3c27", "#093522", "#082e1e", "#072819", "#062115"];

const wordmarkShadow = [
  "0 -0.012em 0 rgba(255,255,255,.45)",
  ...extrusionGreens.map((green, step) => `0 ${((step + 1) * 0.012).toFixed(3)}em 0 ${green}`),
  "0 0.15em 0.16em rgba(0,0,0,.38)",
  "0 0.24em 0.34em rgba(0,0,0,.22)",
].join(", ");

// A lit amber face: brighter along the top edge, deepening toward the base, so the
// letters catch the light like painted site signage.
const wordmarkFace = "linear-gradient(180deg, #ffdc86 0%, #f6c150 48%, #e2a230 100%)";

const wordmark = "CREWNBUILD";

// Each letter carries its own extrusion and striped face so the two stay locked together
// while it pops. A single element cannot do both, because text-shadow paints over a
// background that has been clipped to the text.
function WordmarkLetter({ letter }) {
  return (
    <motion.span
      aria-hidden="true"
      variants={popIn}
      style={{ transformPerspective: 900, transformOrigin: "50% 100%" }}
      className="relative inline-block"
    >
      <span className="absolute inset-0 text-transparent" style={{ textShadow: wordmarkShadow }}>
        {letter}
      </span>
      <span
        className="relative"
        style={{
          backgroundImage: wordmarkFace,
          backgroundClip: "text",
          WebkitBackgroundClip: "text",
          WebkitTextFillColor: "transparent",
        }}
      >
        {letter}
      </span>
    </motion.span>
  );
}


// The section takes its colour from the villa's Day/Night control, so the whole band moves
// from a bright afternoon to deep night rather than sitting on a fixed green.
const TONES = {
  day: {
    background: "linear-gradient(180deg, #dce8f2 0%, #eef4f7 62%, #f4f7f5 100%)",
    label: "#3f6b52",
    heading: "#17201c",
    highlight: "#126b45",
    body: "#4a5a51",
    link: "#126b45",
  },
  night: {
    background: "linear-gradient(180deg, #131d35 0%, #101a30 62%, #0c1426 100%)",
    label: "#9fb6dd",
    heading: "#ffffff",
    highlight: "#a9d6bc",
    body: "#c2cfe2",
    link: "#dbe7ff",
  },
};

export function SolutionBridge({ text }) {
  return (
    <div className="relative z-[6] flex flex-wrap items-center justify-center gap-[9px] min-h-[108px] -mt-px bg-oc-deep text-[#d4eddd] tracking-[-.035em] text-[clamp(1.1rem,2.2vw,2rem)] max-wide:px-[18px] max-wide:py-[25px] max-wide:text-center max-wide:text-[1.12rem]">
      <span>{text.bridge[0]}</span>
      <strong className="text-white">{text.bridge[1]}</strong>
      <i className="w-[7px] h-[7px] ms-[10px] rounded-full bg-oc-amber shadow-[0_0_0_7px_rgba(244,183,64,.14)] max-wide:hidden" />
    </div>
  );
}

export function SolutionPanel({ text }) {
  const reveal = useScrollReveal();
  const [isNight, setIsNight] = useState(false);
  const tone = isNight ? TONES.night : TONES.day;

  return (
    <div
            className="grid grid-cols-2 items-center gap-[60px] px-[max(24px,calc((100vw-1240px)/2))] py-[110px] max-mid:grid-cols-1 max-mid:py-[82px] max-wide:block max-wide:px-[18px] max-wide:py-[70px]"
            style={{ background: tone.background, color: tone.heading, transition: "background 900ms linear, color 900ms linear" }}
          >
      <div className="max-w-[560px]">
        <div className="flex items-center gap-[10px] text-[10px] uppercase tracking-[.14em] font-extrabold rtl:tracking-normal"
          style={{ color: tone.label, transition: "color 900ms linear" }}>
          <span className="w-2 h-2 rounded-full bg-oc-amber shadow-[0_0_0_5px_rgba(244,183,64,.16)]" />
          {text.solution.label}
        </div>

        {/* From 1001px to 1535px the villa sits beside this column, and at 7vw the wordmark
            ran on under its Day/Night toggle. In that range it is sized to end in the gap
            before the villa (about 7.64em wide, so width / 15.3 per half-screen column). */}
        <motion.div
          role="img"
          aria-label={wordmark}
          variants={letterStaggerGroup}
          {...reveal}
          className="relative mt-[21px] w-fit whitespace-nowrap font-display font-black leading-[.95] tracking-[.1em] text-[clamp(3.6rem,7vw,7.6rem)] max-wide:text-[length:min(calc((100vw_-_48px)/7.9),3.75rem)] mid:max-[1535px]:text-[length:min(calc((100vw_-_35px)/15.3),4.9rem)]"
        >
          {[...wordmark].map((letter, index) => (
            <WordmarkLetter key={`${letter}-${index}`} letter={letter} />
          ))}
        </motion.div>

        <h2 className="mt-7 font-extrabold tracking-[-.06em] leading-[.96] text-[clamp(2.5rem,4.6vw,4.9rem)] rtl:tracking-normal rtl:leading-[1.18] max-wide:text-[2.6rem]">
          {text.solution.headline}
          <br />
          <span style={{ color: tone.highlight, transition: "color 900ms linear" }}>{text.solution.highlight}</span>
        </h2>

        <p className="max-w-[520px] mt-6 text-[15px] leading-[1.75] max-wide:text-[13px]" style={{ color: tone.body, transition: "color 900ms linear" }}>{text.solution.body}</p>

        <div className="flex flex-wrap items-center gap-x-6 gap-y-4 mt-8 whitespace-nowrap">
          <a className={`${isNight ? creamButtonClass : buttonClass} max-wide:px-6`} href="/signup">
            {text.nav.start} <ArrowRight size={16} className="rtl:-scale-x-100" />
          </a>
          <a className="group flex items-center gap-[7px] text-xs font-extrabold" style={{ color: tone.link, transition: "color 900ms linear" }} href="#roles">
            {text.solution.explore}
            <ChevronRight size={16} className="transition-transform duration-200 group-hover:translate-x-1 rtl:-scale-x-100 rtl:group-hover:-translate-x-1" />
          </a>
        </div>
      </div>

      {/* The wordmark is set on one line and runs wider than its column, so on the
          two-column layout the villa is pushed down to start below it instead of
          sitting over its last letters. Narrower screens stack the two already. */}
      <div className="max-mid:w-full max-mid:max-w-[640px] max-mid:mx-auto max-wide:mt-[38px] mid:mt-32">
        <ConstructionVilla isNight={isNight} onModeChange={setIsNight} />
      </div>
    </div>
  );
}
