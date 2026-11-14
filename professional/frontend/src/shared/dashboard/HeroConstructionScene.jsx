/**
 * The construction scene that sits at the right edge of a dashboard welcome
 * banner: a two-storey villa mid-build, a tower crane above it, a few trees and
 * soft hills, on a pale-green field whose left edge fades to nothing so it
 * melts into the banner rather than ending on a seam.
 *
 * Drawn as vector rather than shipped as an image so it stays sharp at any
 * size, costs no request, and uses the application's own palette tokens.
 *
 * It carries no size of its own. The caller gives it a box; the viewBox is
 * fitted inside that box with `meet` — the SVG equivalent of object-fit:
 * contain — so the scene scales down to whatever room the banner has and is
 * never cropped or stretched. The 4.2:1 viewBox is deliberately wide because a
 * welcome banner is a short strip. Decorative, so it is hidden from readers.
 */

// Palette, spelled out because SVG paint cannot read Tailwind classes.
const WHITE = '#ffffff'
const PAPER = '#f7faf7'
const MINT = '#dff0e8'
const SHADE = '#cbe0d4'
const LIGHT = '#add8c3'
const MID = '#7bc2a2'
const GREEN = '#126b45'
const DEEP_GREEN = '#0e5537'
const SLAB = '#9fb8ab'
const STEEL = '#4f6b5d'
const FRAME = '#8fa79b'

function Tree({ x, y, scale = 1, tone = GREEN }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`}>
      <rect x="-1.5" y="-2" width="3" height="14" rx="1.3" fill={DEEP_GREEN} />
      <circle cx="0" cy="-11" r="9" fill={tone} />
      <circle cx="-6" cy="-4.5" r="6.6" fill={tone} />
      <circle cx="6" cy="-4.5" r="6.6" fill={tone} opacity="0.85" />
    </g>
  )
}

export default function HeroConstructionScene({ className = '' }) {
  return (
    <svg
      viewBox="0 0 420 100"
      preserveAspectRatio="xMidYMid meet"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        {/* Nothing on the left, gathering into pale green on the right: that
            fade is what blends the scene into the banner. */}
        <linearGradient id="ocHeroField" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor={MINT} stopOpacity="0" />
          <stop offset="22%" stopColor={MINT} stopOpacity="0.34" />
          <stop offset="58%" stopColor={MINT} stopOpacity="0.62" />
          <stop offset="100%" stopColor={MINT} stopOpacity="0.72" />
        </linearGradient>
        <linearGradient id="ocHeroHillFar" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor={MID} stopOpacity="0" />
          <stop offset="35%" stopColor={MID} stopOpacity="0.4" />
          <stop offset="100%" stopColor={MID} stopOpacity="0.5" />
        </linearGradient>
        <linearGradient id="ocHeroGround" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor={LIGHT} stopOpacity="0" />
          <stop offset="26%" stopColor={LIGHT} stopOpacity="0.75" />
          <stop offset="100%" stopColor={LIGHT} stopOpacity="0.95" />
        </linearGradient>
      </defs>

      {/* Pale field with a soft organic upper boundary */}
      <path
        d="M20 100 C 66 74, 118 56, 190 52 C 258 48, 300 30, 358 30 C 396 30, 412 40, 420 52 L420 100 Z"
        fill="url(#ocHeroField)"
      />
      {/* Rolling hills */}
      <path d="M60 90 C 128 66, 196 70, 250 84 L250 100 L60 100 Z" fill="url(#ocHeroHillFar)" />
      <path d="M300 88 C 344 68, 388 72, 420 80 L420 100 L300 100 Z" fill={MID} opacity="0.3" />
      {/* Ground */}
      <path d="M34 91 C 140 85, 320 85, 420 90 L420 100 L34 100 Z" fill="url(#ocHeroGround)" />

      {/* ---- Tower crane, rising behind and above the villa ---------------- */}
      <g>
        <rect x="349" y="16" width="7.5" height="75" rx="1" fill={STEEL} />
        {[24, 35, 46, 57, 68, 79].map((y) => (
          <g key={y}>
            <line x1="349.5" y1={y} x2="356" y2={y - 5.5} stroke={PAPER} strokeWidth="1.3" opacity="0.75" />
            <line x1="349.5" y1={y - 5.5} x2="356" y2={y} stroke={PAPER} strokeWidth="1.3" opacity="0.45" />
          </g>
        ))}
        {/* Base */}
        <rect x="343" y="88" width="20" height="4" rx="1.4" fill={STEEL} />
        {/* Jib reaching left over the build, and the counter-jib */}
        <rect x="248" y="12" width="105" height="4.6" rx="1.6" fill={STEEL} />
        <rect x="353" y="12" width="32" height="4.6" rx="1.6" fill={STEEL} />
        <rect x="374" y="8" width="11" height="9" rx="1.6" fill={GREEN} />
        {/* A-frame and tie bars */}
        <path d="M350 12 L352.5 2 L358 12" fill="none" stroke={STEEL} strokeWidth="2" strokeLinejoin="round" />
        <line x1="352" y1="3" x2="256" y2="13" stroke={STEEL} strokeWidth="1.3" />
        <line x1="355" y1="3" x2="381" y2="9.5" stroke={STEEL} strokeWidth="1.3" />
        {/* Operator cab */}
        <rect x="345" y="17" width="10" height="8" rx="1.6" fill={PAPER} stroke={STEEL} strokeWidth="0.8" />
        {/* Hoist line, hook block and its load */}
        <line x1="286" y1="16.6" x2="286" y2="42" stroke={STEEL} strokeWidth="1.2" />
        <rect x="281" y="42" width="10" height="5" rx="1.4" fill={STEEL} />
        <rect x="278" y="47" width="16" height="6" rx="1.4" fill={FRAME} />
      </g>

      {/* ---- Villa under construction --------------------------------------- */}
      <g>
        {/* Upper storey, set back */}
        <rect x="238" y="34" width="58" height="24" fill={WHITE} />
        <rect x="288" y="34" width="8" height="24" fill={SHADE} />
        <rect x="232" y="29.5" width="70" height="5" rx="1.6" fill={SLAB} />
        <rect x="246" y="41" width="13" height="10" rx="1" fill={GREEN} opacity="0.68" />
        <rect x="266" y="41" width="13" height="10" rx="1" fill={GREEN} opacity="0.52" />

        {/* Ground storey */}
        <rect x="220" y="62" width="80" height="29" fill={PAPER} />
        <rect x="292" y="62" width="8" height="29" fill={SHADE} />
        <rect x="214" y="57.5" width="92" height="5" rx="1.6" fill={SLAB} />
        <rect x="230" y="69" width="15" height="11" rx="1" fill={GREEN} opacity="0.68" />
        <rect x="253" y="69" width="15" height="11" rx="1" fill={GREEN} opacity="0.52" />
        <rect x="278" y="74" width="11" height="17" rx="1.2" fill={SHADE} />

        {/* The wing still going up: slabs and columns, no walls yet */}
        <rect x="300" y="57.5" width="34" height="5" rx="1.6" fill={SLAB} />
        <rect x="302" y="62" width="3.6" height="29" fill={FRAME} />
        <rect x="315" y="62" width="3.6" height="29" fill={FRAME} />
        <rect x="328" y="62" width="3.6" height="29" fill={FRAME} />
        <rect x="300" y="75" width="34" height="3" fill={FRAME} />

        {/* Scaffolding across the finished face */}
        <g stroke={STEEL} strokeWidth="1.2" opacity="0.65">
          <line x1="218" y1="48" x2="218" y2="91" />
          <line x1="234" y1="48" x2="234" y2="91" />
          <line x1="216" y1="58" x2="236" y2="58" />
          <line x1="216" y1="72" x2="236" y2="72" />
          <line x1="216" y1="86" x2="236" y2="86" />
        </g>

        {/* A small stack of materials on the ground */}
        <rect x="196" y="84" width="18" height="3.6" rx="1.2" fill={FRAME} />
        <rect x="198" y="87.6" width="18" height="3.6" rx="1.2" fill={SLAB} />
      </g>

      {/* ---- Trees ---------------------------------------------------------- */}
      <Tree x={112} y={92} scale={0.72} tone={GREEN} />
      <Tree x={148} y={92} scale={0.95} tone={DEEP_GREEN} />
      <Tree x={176} y={92} scale={0.66} tone={GREEN} />
      <Tree x={352} y={92} scale={0.9} tone={DEEP_GREEN} />
      <Tree x={382} y={92} scale={0.7} tone={GREEN} />
      <Tree x={404} y={92} scale={0.86} tone={DEEP_GREEN} />
    </svg>
  )
}
