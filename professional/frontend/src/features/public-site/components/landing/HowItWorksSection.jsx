import { motion, useReducedMotion } from "framer-motion";
import { SectionLabel, containerClass, sectionPaddingClass } from "./shared.jsx";
import { riseIn, staggerGroup, stepIn, useScrollReveal } from "./scrollReveal.js";
import { flowSteps } from "./journeyData.js";

// Five stages, one flow. Wide screens draw them along a horizontal rail; narrow
// screens fold the same markup into a vertical timeline. The rail grows from
// whichever side the reading order starts on, so it still runs forwards in Arabic.
export function HowItWorksSection({ text, isArabic }) {
  const reveal = useScrollReveal();
  const reduceMotion = useReducedMotion();
  const copy = text.howItWorks;

  return (
    <section id="how" className={`bg-oc-paper ${sectionPaddingClass}`}>
      <div className={containerClass}>
        <motion.div variants={riseIn} {...reveal} className="max-w-2xl mx-auto text-center">
          <div className="flex justify-center">
            <SectionLabel>{copy.eyebrow}</SectionLabel>
          </div>
          <h2 className="mt-3 text-headline font-extrabold text-oc-ink rtl:tracking-normal rtl:leading-[1.3]">{copy.title}</h2>
        </motion.div>

        <div className="relative mt-14 wide:mt-20">
          {/* The rail spans the centres of the first and last badge. */}
          <div aria-hidden="true" className="absolute inset-x-[10%] top-6 h-px bg-oc-line max-mid:hidden">
            <motion.div
              className="h-px w-full bg-ocbrand-300"
              style={{ originX: isArabic ? 1 : 0 }}
              initial={{ scaleX: reduceMotion ? 1 : 0 }}
              whileInView={{ scaleX: 1 }}
              viewport={{ once: true, amount: 0.6 }}
              transition={{ duration: reduceMotion ? 0 : 1.1, ease: [0.23, 1, 0.32, 1], delay: 0.2 }}
            />
          </div>

          <motion.ol variants={staggerGroup} {...reveal} className="relative grid grid-cols-1 mid:grid-cols-5 mid:gap-6">
            {flowSteps.map((step, index) => {
              const StepIcon = step.icon;
              const isLast = index === flowSteps.length - 1;

              return (
                <motion.li
                  key={step.key}
                  variants={stepIn}
                  className="flex gap-4 mid:flex-col mid:items-center mid:gap-0 mid:text-center"
                >
                  {/* mid:contents dissolves this wrapper so the badge becomes a
                      direct child of the centred column. */}
                  <div className="flex flex-col items-center mid:contents">
                    <span className="grid place-items-center shrink-0 w-12 h-12 rounded-[18px] border border-oc-line bg-white text-oc-green shadow-ocsoft">
                      <StepIcon aria-hidden="true" className="w-5 h-5" strokeWidth={1.6} />
                    </span>
                    {!isLast && <span aria-hidden="true" className="mt-2 w-px flex-1 bg-oc-line mid:hidden" />}
                  </div>

                  <div className="pb-10 mid:mt-6 mid:pb-0">
                    <span className="text-xs leading-normal font-bold tracking-[.14em] text-ocbrand-500 rtl:tracking-normal">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <h3 className="mt-1.5 text-base font-bold text-oc-ink">{copy.steps[step.key].title}</h3>
                    <p className="mt-1.5 text-sm leading-relaxed text-oc-muted mid:mx-auto mid:max-w-[22ch]">
                      {copy.steps[step.key].description}
                    </p>
                  </div>
                </motion.li>
              );
            })}
          </motion.ol>
        </div>

        <motion.p variants={riseIn} {...reveal} className="mt-4 text-center text-base font-semibold text-oc-ink mid:mt-10">
          {copy.footnote}
        </motion.p>
      </div>
    </section>
  );
}
