/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      screens: {
        '3xl': '1920px',
        // Landing-page breakpoints (additive). The landing design
        // switches layout at 701px and 1001px, so those are named exactly.
        wide: '701px',
        mid: '1001px',
      },
      // Extra opacity steps used by the landing page's translucent surfaces.
      // Purely additive — the default steps are untouched.
      opacity: {
        8: '0.08',
        12: '0.12',
        14: '0.14',
        15: '0.15',
        16: '0.16',
        18: '0.18',
        22: '0.22',
        24: '0.24',
        34: '0.34',
        35: '0.35',
        45: '0.45',
        46: '0.46',
        55: '0.55',
        64: '0.64',
        65: '0.65',
        85: '0.85',
      },
      colors: {
        // Primary brand — Dark Construction Green (#134127)
        brand: {
          50: '#f0f6f2',
          100: '#e0eee6',
          200: '#c3dccd',
          300: '#9dc5af',
          400: '#6ba88a',
          500: '#2e7d55',
          600: '#236645',
          700: '#1a5038',
          800: '#134127',
          900: '#0d3225',
          950: '#061f15',
        },
        // Legacy alias — "forest" tokens resolve to the dark green brand family
        // so dashboards share the same green identity.
        forest: {
          50: '#f0f6f2',
          100: '#e0eee6',
          200: '#c3dccd',
          300: '#9dc5af',
          400: '#6ba88a',
          500: '#2e7d55',
          600: '#236645',
          700: '#1a5038',
          800: '#134127',
          900: '#0d3225',
          950: '#061f15',
        },
        // Secondary — Dark Slate
        graphite: '#1f2937',
        slate: {
          50: '#f8fafc',
          100: '#f1f5f9',
          200: '#e2e8f0',
          300: '#cbd5e1',
          400: '#94a3b8',
          500: '#64748b',
          600: '#475569',
          700: '#334155',
          800: '#1e293b',
          900: '#0f172a',
          950: '#020617',
        },
        surface: {
          DEFAULT: '#f8fafc',
          deep: '#f1f5f9',
        },
        cream: {
          DEFAULT: '#f8fafc',
          deep: '#f1f5f9',
        },
        // Error / rejection tone (kept red so alerts stay readable)
        warm: '#dc2626',
        gold: {
          DEFAULT: '#134127',
          soft: '#2e7d55',
        },
        accent: {
          DEFAULT: '#1a5038',
          soft: '#2e7d55',
        },
        neon: {
          DEFAULT: '#134127',
          soft: '#2e7d55',
        },
        // ---------------------------------------------------------------
        // Landing-page palette (landing design system).
        // Namespaced under `oc-` so none of the existing application
        // tokens above (brand, forest, slate, accent, gold …) are shadowed.
        // ---------------------------------------------------------------
        oc: {
          green: '#126b45',
          deep: '#083e2b',
          mint: '#dff0e8',
          paper: '#f7faf7',
          ink: '#17201c',
          muted: '#61736a',
          amber: '#f4b740',
          line: '#d9e6de',
          'line-strong': '#d5ddd9',
          night: '#0b0c0b',
          faint: '#98a29d',
          sunken: '#f1f5f3',
        },
        ocbrand: {
          50: '#ecf6f1',
          100: '#d5ebe0',
          200: '#add8c3',
          300: '#7bc2a2',
          400: '#22a06b',
          500: '#1a8659',
          700: '#0e5537',
        },
        ocaccent: {
          50: '#fef8ea',
          100: '#fceec9',
          400: '#e8b23c',
          600: '#b27d1c',
        },
      },
      fontFamily: {
        display: ['"Manrope"', 'system-ui', 'sans-serif'],
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      fontSize: {
        // Landing-page display sizes (additive).
        headline: ['clamp(1.875rem, 1.1rem + 2.6vw, 3rem)', { lineHeight: '1.1', letterSpacing: '-0.03em' }],
        title: ['clamp(1.25rem, 1rem + 0.8vw, 1.625rem)', { lineHeight: '1.25', letterSpacing: '-0.02em' }],
      },
      transitionTimingFunction: {
        soft: 'cubic-bezier(0.23, 1, 0.32, 1)',
      },
      boxShadow: {
        ocsoft: '0 1px 2px rgba(23, 32, 28, 0.04), 0 10px 30px -18px rgba(23, 32, 28, 0.18)',
        soft: '0 10px 40px -12px rgba(31, 41, 55, 0.12)',
        card: '0 8px 30px -8px rgba(31, 41, 55, 0.10)',
        float: '0 24px 60px -15px rgba(31, 41, 55, 0.24)',
        glow: '0 0 40px -8px rgba(46, 125, 85, 0.45)',
        orange: '0 18px 45px -18px rgba(19, 65, 39, 0.55)',
      },
      letterSpacing: {
        tightest: '-0.045em',
        tighter: '-0.035em',
      },
      keyframes: {
        floaty: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-10px)' },
        },
        pulseRing: {
          '0%': { boxShadow: '0 0 0 0 rgba(46,125,85,0.45)' },
          '70%': { boxShadow: '0 0 0 14px rgba(46,125,85,0)' },
          '100%': { boxShadow: '0 0 0 0 rgba(46,125,85,0)' },
        },
        flowDash: {
          to: { strokeDashoffset: '-1000' },
        },
        shimmer: {
          '100%': { transform: 'translateX(100%)' },
        },
        marquee: {
          '0%': { transform: 'translateX(0)' },
          '100%': { transform: 'translateX(-50%)' },
        },
        fadeUp: {
          '0%': { opacity: '0', transform: 'translateY(24px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        wiggle: {
          '0%, 100%': { transform: 'rotate(-6deg) scale(1.06)' },
          '50%': { transform: 'rotate(6deg) scale(1.06)' },
        },
        iconPulse: {
          '0%': { transform: 'scale(1)', opacity: '0.7' },
          '70%': { transform: 'scale(1.4)', opacity: '0' },
          '100%': { transform: 'scale(1.4)', opacity: '0' },
        },
        /* ---- Landing page idle motions ---- */
        'pulse-dot': {
          '0%, 100%': { opacity: '1', transform: 'scale(1)' },
          '50%': { opacity: '0.45', transform: 'scale(0.82)' },
        },
        'role-home': {
          '0%, 100%': { transform: 'translateY(3px) rotate(-2deg)' },
          '50%': { transform: 'translateY(-12px) rotate(2deg)' },
        },
        'role-build': {
          '0%, 100%': { transform: 'rotate(-2deg) translateY(0)' },
          '50%': { transform: 'rotate(2deg) translateY(-7px)' },
        },
        'role-engineer': {
          '0%, 100%': { transform: 'translateX(-3px) rotate(-1deg)' },
          '50%': { transform: 'translateX(5px) rotate(1deg)' },
        },
        'role-supply': {
          '0%, 100%': { transform: 'scale(1) rotate(0)' },
          '50%': { transform: 'scale(1.045) rotate(-2deg)' },
        },
        'role-equipment': {
          '0%, 100%': { transform: 'translateY(0) rotate(0)' },
          '35%': { transform: 'translateY(-9px) rotate(-3deg)' },
          '70%': { transform: 'translateY(-4px) rotate(3deg)' },
        },
      },
      animation: {
        floaty: 'floaty 6s ease-in-out infinite',
        floatySlow: 'floaty 9s ease-in-out infinite',
        pulseRing: 'pulseRing 2.4s ease-out infinite',
        flowDash: 'flowDash 18s linear infinite',
        marquee: 'marquee 30s linear infinite',
        fadeUp: 'fadeUp 0.8s cubic-bezier(0.22, 1, 0.36, 1) both',
        wiggle: 'wiggle 1s ease-in-out infinite',
        iconPulse: 'iconPulse 1.2s ease-out infinite',
        'pulse-dot': 'pulse-dot 2.2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'role-home': 'role-home 4.2s ease-in-out infinite',
        'role-build': 'role-build 1.7s cubic-bezier(0.23, 1, 0.32, 1) infinite',
        'role-engineer': 'role-engineer 3.2s ease-in-out infinite',
        'role-supply': 'role-supply 2.2s ease-in-out infinite',
        'role-equipment': 'role-equipment 2.8s ease-in-out infinite',
      },
    },
  },
  plugins: [],
}
