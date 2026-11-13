import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { motion } from "framer-motion";
import { SectionLabel, containerClass, sectionPaddingClass } from "./shared.jsx";
import { riseIn, useScrollReveal } from "./scrollReveal.js";
import { journeyCards } from "./journeyData.js";
import { RequirementCard } from "./journey/RequirementCard.jsx";
import { BuilderCard } from "./journey/BuilderCard.jsx";
import { ProjectCard } from "./journey/ProjectCard.jsx";
import { MaterialsCard } from "./journey/MaterialsCard.jsx";

const cardsByStep = {
  requirement: RequirementCard,
  builder: BuilderCard,
  project: ProjectCard,
  materials: MaterialsCard,
};

// Shows the product instead of describing it. Wide screens pin the narration on one
// side while the cards scroll past on the other; narrow screens drop the tracker and
// stack the same cards. Tracking and the entrance animation sit on separate elements,
// so the reveal fires once while the tracker keeps updating in both directions.
export function PlatformSection({ text, isArabic }) {
  const reveal = useScrollReveal();
  const [activeIndex, setActiveIndex] = useState(0);
  const [hoveredIndex, setHoveredIndex] = useState(null);
  const copy = text.journey;

  // Pointing at a card wins; with no pointer it is whichever card the visitor scrolled to.
  const highlightedIndex = hoveredIndex ?? activeIndex;

  return (
    <section id="platform" className={`bg-oc-sunken ${sectionPaddingClass}`}>
      <div className={containerClass}>
        <div className="grid gap-10 mid:grid-cols-12 mid:gap-16">
          <div className="mid:col-span-5">
            <div className="mid:sticky mid:top-28">
              <motion.div variants={riseIn} {...reveal} className="max-w-2xl">
                <SectionLabel>{copy.eyebrow}</SectionLabel>
                <h2 className="mt-3 text-headline font-extrabold text-oc-ink rtl:tracking-normal rtl:leading-[1.3]">
                  {copy.titleLine1}
                  <span className="block text-oc-muted">{copy.titleLine2}</span>
                </h2>
                <p className="mt-4 max-w-[58ch] text-base leading-relaxed text-oc-muted wide:text-lg">{copy.subtitle}</p>
              </motion.div>

              <ol className="mt-10 max-mid:hidden" aria-hidden="true">
                {journeyCards.map((step, index) => {
                  const active = index === activeIndex;

                  return (
                    <li
                      key={step}
                      className={`border-s-2 py-2.5 ps-4 transition-colors duration-300 ease-soft ${active ? "border-ocbrand-500" : "border-oc-line"}`}
                    >
                      <span className={`text-xs leading-normal font-bold tracking-[.14em] rtl:tracking-normal ${active ? "text-ocbrand-500" : "text-oc-faint"}`}>
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <span className={`ms-3 text-sm leading-normal font-semibold ${active ? "text-oc-ink" : "text-oc-muted"}`}>
                        {copy.cards[step].label}
                      </span>
                    </li>
                  );
                })}
              </ol>
            </div>
          </div>

          <ol className="mid:col-span-7">
            {journeyCards.map((step, index) => {
              const Card = cardsByStep[step];
              const isLast = index === journeyCards.length - 1;

              return (
                <motion.li
                  key={step}
                  viewport={{ amount: 0.45 }}
                  onViewportEnter={() => setActiveIndex(index)}
                  onMouseEnter={() => setHoveredIndex(index)}
                  onMouseLeave={() => setHoveredIndex(null)}
                  className="max-w-[520px]"
                >
                  <motion.div variants={riseIn} {...reveal}>
                    <Card copy={copy.cards[step]} isArabic={isArabic} highlighted={index === highlightedIndex} />
                  </motion.div>

                  {!isLast && (
                    <div aria-hidden="true" className="flex flex-col items-center py-3">
                      <span className="h-6 w-px bg-oc-line" />
                      <ChevronDown className="-mt-1 w-4 h-4 text-oc-faint" strokeWidth={2} />
                    </div>
                  )}
                </motion.li>
              );
            })}
          </ol>
        </div>
      </div>
    </section>
  );
}
