/** Viswa's helmet mark (as in Kuwait-Version's widget). */
export function Helmet({ className, stroke }) {
  return (
    <svg className={className} viewBox="0 0 48 48" fill="none" stroke={stroke} strokeWidth="2.8" strokeLinejoin="round" strokeLinecap="round" aria-hidden="true">
      <path d="M10 31 C10 20.5 16 14 24 14 C32 14 38 20.5 38 31" />
      <path d="M21 14.5 V23 M27 14.5 V23" />
      <path d="M6 31 H42 V34.5 H6 Z" />
    </svg>
  )
}
