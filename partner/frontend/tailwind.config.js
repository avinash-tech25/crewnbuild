/** @type {import('tailwindcss').Config} */
// the Professional app's landing palette, re-expressed here rather than imported, so Partner
// looks like part of the same family while depending on nothing in it.
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        oc: {
          green: '#126b45',
          deep: '#083e2b',
          mint: '#dff0e8',
          paper: '#f7faf7',
          ink: '#17201c',
          muted: '#61736a',
          amber: '#f4b740',
          line: '#d9e6de',
          sunken: '#f1f5f3',
        },
      },
      fontFamily: {
        display: ['"Manrope"', 'system-ui', 'sans-serif'],
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        ocsoft: '0 1px 2px rgba(23, 32, 28, 0.04), 0 10px 30px -18px rgba(23, 32, 28, 0.18)',
        card: '0 8px 30px -8px rgba(31, 41, 55, 0.10)',
        lift: '0 24px 50px -24px rgba(8, 62, 43, 0.45)',
      },
      transitionTimingFunction: {
        soft: 'cubic-bezier(0.23, 1, 0.32, 1)',
      },
      keyframes: {
        floaty: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-8px)' },
        },
        fadeUp: {
          '0%': { opacity: '0', transform: 'translateY(16px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        // The hero image swap. These are the exact values the Professional landing
        // hero animates through with framer-motion (opacity 0 -> 1, y 20 -> 0,
        // scale .86 -> 1, rotate -5deg -> 0 over 0.55s on the same easing
        // curve), expressed as a keyframe so Partner gets the identical feel
        // without taking on framer-motion as a dependency.
        heroPop: {
          '0%': { opacity: '0', transform: 'translateY(20px) scale(0.86) rotate(-5deg)' },
          '100%': { opacity: '1', transform: 'translateY(0) scale(1) rotate(0deg)' },
        },
        // The idle motion each figure keeps up while it is the one on show.
        // The Professional app gives every role character its own loop rather than one
        // shared float, so the four never drift in step; these are those four
        // loops ('role-home', 'role-build', 'role-engineer' and 'role-supply'),
        // renamed for the trade that carries each one. The paths are the Professional app's
        // exactly -- the durations below are about a quarter shorter, because
        // Partner's hero was read as too sluggish at the Professional app's timings.
        'trade-painter': {
          '0%, 100%': { transform: 'translateY(3px) rotate(-2deg)' },
          '50%': { transform: 'translateY(-12px) rotate(2deg)' },
        },
        'trade-plumber': {
          '0%, 100%': { transform: 'rotate(-2deg) translateY(0)' },
          '50%': { transform: 'rotate(2deg) translateY(-7px)' },
        },
        'trade-electrician': {
          '0%, 100%': { transform: 'translateX(-3px) rotate(-1deg)' },
          '50%': { transform: 'translateX(5px) rotate(1deg)' },
        },
        'trade-carpenter': {
          '0%, 100%': { transform: 'scale(1) rotate(0)' },
          '50%': { transform: 'scale(1.045) rotate(-2deg)' },
        },
      },
      animation: {
        floaty: 'floaty 6s ease-in-out infinite',
        fadeUp: 'fadeUp 0.6s cubic-bezier(0.22, 1, 0.36, 1) both',
        heroPop: 'heroPop 0.45s cubic-bezier(0.23, 1, 0.32, 1) both',
        'trade-painter': 'trade-painter 3s ease-in-out infinite',
        'trade-plumber': 'trade-plumber 1.3s cubic-bezier(0.23, 1, 0.32, 1) infinite',
        'trade-electrician': 'trade-electrician 2.3s ease-in-out infinite',
        'trade-carpenter': 'trade-carpenter 1.6s ease-in-out infinite',
      },
    },
  },
  plugins: [],
}
