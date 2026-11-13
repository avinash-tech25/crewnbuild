import { motion, useReducedMotion } from "framer-motion";

// Fills with scaleX rather than width, so the browser never does layout work while
// the bar grows. The origin follows the text direction, so it always fills away
// from the reading edge.
export function ProgressBar({ value, label, tone = "brand", isArabic, className = "" }) {
  const reduceMotion = useReducedMotion();
  const filled = Math.max(0, Math.min(100, value));

  return (
    <div
      role="progressbar"
      aria-valuenow={filled}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
      className={`h-1.5 w-full overflow-hidden rounded-full bg-oc-sunken ${className}`}
    >
      <motion.div
        className={`h-full w-full rounded-full ${tone === "accent" ? "bg-ocaccent-400" : "bg-ocbrand-500"}`}
        style={{ originX: isArabic ? 1 : 0 }}
        initial={{ scaleX: reduceMotion ? filled / 100 : 0 }}
        whileInView={{ scaleX: filled / 100 }}
        viewport={{ once: true, amount: 0.6 }}
        transition={{ duration: reduceMotion ? 0 : 1, ease: [0.23, 1, 0.32, 1], delay: 0.15 }}
      />
    </div>
  );
}
