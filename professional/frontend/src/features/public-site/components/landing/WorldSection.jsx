import { motion } from "framer-motion";
import { SectionLabel, containerClass, equipmentUrl, hubUrl } from "./shared.jsx";
import { slideInFrom, useScrollReveal } from "./scrollReveal.js";

const noteClass =
  "absolute flex items-center gap-[7px] px-3 py-[9px] rounded-[7px] bg-white border border-oc-line text-[10px] font-extrabold " +
  "shadow-[0_11px_22px_rgba(18,107,69,.08)] max-wide:text-[8px] max-wide:px-[9px] max-wide:py-[7px]";

export function WorldSection({ text, isArabic }) {
  const reveal = useScrollReveal();

  return (
    <section
      id="world"
      className="relative bg-oc-amber pt-[135px] pb-[142px] max-wide:pt-[84px] max-wide:pb-[90px]
                 before:content-[''] before:absolute before:inset-x-0 before:top-0 before:h-px
                 before:bg-[linear-gradient(90deg,rgba(8,62,43,.45),transparent_35%)]"
    >
      <div className={`${containerClass} grid grid-cols-[.8fr_1.2fr] items-center gap-[70px] max-mid:gap-10 max-wide:block`}>
        <motion.div variants={slideInFrom("start", isArabic)} {...reveal}>
          <SectionLabel tone="onAmber">{text.world.label}</SectionLabel>
          <h2 className="mt-[21px] font-extrabold tracking-[-.06em] leading-[.96] text-[clamp(3.3rem,5vw,5.5rem)] rtl:tracking-normal rtl:leading-[1.18]">
            {text.world.headline}
            <br />
            <span className="text-oc-green">{text.world.highlight}</span>
          </h2>
          <p className="max-w-[400px] mt-7 text-[15px] leading-[1.75] text-oc-deep/80 max-wide:text-sm">{text.world.body}</p>

          <div className="flex flex-col gap-[14px] mt-[33px] text-[11px] font-extrabold text-oc-deep">
            {text.world.points.map((point) => (
              <span key={point} className="flex items-center gap-[9px]">
                <i className="w-[7px] h-[7px] rounded-full bg-oc-green" />
                {point}
              </span>
            ))}
          </div>
        </motion.div>

        <motion.div
          variants={slideInFrom("end", isArabic)}
          {...reveal}
          className="relative grid place-items-center h-[440px] bg-[radial-gradient(circle,rgba(255,255,255,.6),transparent_64%)] max-wide:h-[350px] max-wide:mt-[35px]"
        >
          <div className="absolute rounded-full border border-[rgba(18,107,69,.24)] rotate-[-18deg] w-[360px] h-[175px] max-wide:w-[280px] max-wide:h-[140px]" />
          <div className="absolute rounded-full border border-[rgba(18,107,69,.24)] rotate-[32deg] w-[420px] h-[255px] max-wide:w-[325px] max-wide:h-[200px]" />

          <img src={hubUrl} alt="" className="relative z-[2] w-[145px] drop-shadow-[0_18px_16px_rgba(18,107,69,.18)] max-wide:w-[105px]" />

          <div className={`${noteClass} start-[8%] top-[21%] max-wide:start-0`}>
            <span className="w-[7px] h-[7px] rounded-full bg-oc-green" /> {text.world.notes[0]}
          </div>
          <div className={`${noteClass} end-[5%] top-[17%] max-wide:end-0`}>
            <span className="w-[7px] h-[7px] rounded-full bg-oc-amber" /> {text.world.notes[1]}
          </div>
          <div className={`${noteClass} end-[8%] bottom-[17%] max-wide:end-0`}>
            <span className="w-[7px] h-[7px] rounded-full bg-oc-green" /> {text.world.notes[2]}
          </div>

          <img
            src={equipmentUrl}
            alt=""
            className="absolute w-[240px] bottom-[1%] start-[5%] drop-shadow-[0_17px_12px_rgba(18,107,69,.16)] max-wide:w-[200px] max-wide:start-[-2%] max-wide:bottom-[-4%]"
          />
        </motion.div>
      </div>
    </section>
  );
}
