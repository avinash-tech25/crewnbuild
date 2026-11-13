// Small status chip. The amber tone is the only place the warm colour appears in
// these cards — it marks a construction state, never an action.
const tones = {
  neutral: "bg-oc-sunken text-oc-muted border-oc-line",
  brand: "bg-ocbrand-50 text-ocbrand-700 border-ocbrand-100",
  accent: "bg-ocaccent-50 text-ocaccent-600 border-ocaccent-100",
};

const dotTones = {
  neutral: "bg-oc-faint",
  brand: "bg-ocbrand-400",
  accent: "bg-ocaccent-400 animate-pulse-dot",
};

export function Pill({ tone = "neutral", dot = false, icon: Icon, children }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs leading-normal font-semibold ${tones[tone]}`}>
      {dot && <span aria-hidden="true" className={`w-1.5 h-1.5 rounded-full ${dotTones[tone]}`} />}
      {Icon && <Icon aria-hidden="true" className="w-3.5 h-3.5" strokeWidth={2} />}
      {children}
    </span>
  );
}
