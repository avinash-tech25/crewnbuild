import { ArrowRight, BadgeCheck, Building2, MapPin } from "lucide-react";
import { CardShell } from "./CardShell.jsx";
import { Pill } from "./Pill.jsx";
import { RoleFace, roleAvatarClass } from "../shared.jsx";
import { roleMeta } from "../content.js";

const builderFace = roleMeta.find((role) => role.key === "builder").face;

// Step 2 — a nearby builder responds with a price.
export function BuilderCard({ copy, highlighted }) {
  return (
    <CardShell icon={Building2} label={copy.label} highlighted={highlighted}>
      <p className="text-title font-bold text-oc-ink">{copy.title}</p>

      <div className="mt-4 flex items-center gap-3">
        <span className={roleAvatarClass}>
          <RoleFace image={builderFace} className="w-full h-full" />
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm leading-normal font-bold text-oc-ink">{copy.company}</p>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <Pill icon={MapPin}>{copy.distance}</Pill>
            <Pill tone="brand" icon={BadgeCheck}>{copy.verified}</Pill>
          </div>
        </div>
      </div>

      <div className="mt-5 rounded-xl border border-ocbrand-100 bg-ocbrand-50/60 p-4">
        <p className="text-xs leading-normal font-semibold text-ocbrand-700">{copy.quotationLabel}</p>
        <p className="mt-1 text-2xl font-extrabold tracking-tight text-oc-ink rtl:tracking-normal">{copy.amount}</p>
        <p className="mt-1 text-xs leading-normal text-oc-muted">{copy.duration}</p>
      </div>

      <button
        type="button"
        className="mt-4 w-full inline-flex items-center justify-center gap-2 min-h-[44px] rounded-xl border border-oc-line bg-white
                   text-[15px] font-semibold text-oc-ink transition-[background,border-color] duration-200 hover:border-oc-line-strong hover:bg-oc-sunken"
      >
        {copy.cta}
        <ArrowRight aria-hidden="true" className="w-4 h-4 rtl:-scale-x-100" strokeWidth={2.25} />
      </button>
    </CardShell>
  );
}
