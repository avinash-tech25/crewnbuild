import { amberSurfaceClass } from "../shared.jsx";

// The two grey text tones lose their contrast on amber, so the highlighted card darkens
// them to the deep green. Declared once here rather than threaded through every card.
const highlightedText = "[&_.text-oc-muted]:text-oc-deep [&_.text-oc-faint]:text-oc-deep/75";

// Shared chrome for the product cards. These are deliberately small single-purpose
// cards rather than one big dashboard screenshot — each carries one beat of the story.
// The card the visitor is on — hovered, or simply scrolled to — takes the nav bar's amber.
export function CardShell({ icon: Icon, label, action, highlighted, children }) {
  return (
    <article
      className={`rounded-[18px] border p-5 shadow-ocsoft transition-[background,border-color] duration-300 ease-soft max-wide:p-4
                  ${highlighted ? `${amberSurfaceClass} border-[rgba(8,62,43,.22)] ${highlightedText}` : "border-oc-line bg-white"}`}
    >
      <header className="flex items-center gap-2.5">
        <span className="grid place-items-center w-7 h-7 rounded-lg bg-ocbrand-50 text-oc-green">
          <Icon aria-hidden="true" className="w-3.5 h-3.5" strokeWidth={2} />
        </span>
        <h3 className="text-[11px] font-bold uppercase tracking-[.14em] text-oc-faint rtl:tracking-normal">{label}</h3>
        {action && <div className="ms-auto">{action}</div>}
      </header>

      <div className="mt-4">{children}</div>
    </article>
  );
}
