import { useReducedMotion } from "framer-motion";

const ease = [0.23, 1, 0.32, 1];

// Fades in and rises — used where a block should read top to bottom.
export const riseIn = {
  hidden: { opacity: 0, y: 30 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.55, ease } },
};

// Parent that releases its children one after another.
export const staggerGroup = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.12 } },
};

// A single step or card in a staggered group.
export const stepIn = {
  hidden: { opacity: 0, y: 42, scale: 0.96 },
  visible: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.5, ease } },
};

// Springs up from a tilted, shrunken state and overshoots slightly, so it lands with a pop.
export const popIn = {
  hidden: { opacity: 0, scale: 0.62, rotateX: -55 },
  visible: {
    opacity: 1,
    scale: 1,
    rotateX: 0,
    transition: { type: "spring", stiffness: 210, damping: 11, mass: 0.9 },
  },
};

// Tighter than the card stagger, so a word still lands as one gesture.
export const letterStaggerGroup = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.07 } },
};

const slideDistance = 56;
const slideTransition = { duration: 0.6, ease };

// Held as constants so their identity never changes between renders — a fresh object
// each render restarts the in-view watcher and leaves the animation stuck part way.
const slideVariants = {
  ltr: {
    start: { hidden: { opacity: 0, x: -slideDistance }, visible: { opacity: 1, x: 0, transition: slideTransition } },
    end: { hidden: { opacity: 0, x: slideDistance }, visible: { opacity: 1, x: 0, transition: slideTransition } },
  },
  rtl: {
    start: { hidden: { opacity: 0, x: slideDistance }, visible: { opacity: 1, x: 0, transition: slideTransition } },
    end: { hidden: { opacity: 0, x: -slideDistance }, visible: { opacity: 1, x: 0, transition: slideTransition } },
  },
};

// Slides in from the leading or trailing edge, mirrored for Arabic.
export function slideInFrom(edge, isArabic) {
  return slideVariants[isArabic ? "rtl" : "ltr"][edge];
}

const revealOnScroll = { initial: "hidden", whileInView: "visible", viewport: { once: true, amount: 0.2 } };
const noReveal = {};

// Spread onto a motion element to play its variants when it scrolls into view.
// Returns nothing when the visitor asked for reduced motion.
export function useScrollReveal() {
  return useReducedMotion() ? noReveal : revealOnScroll;
}
