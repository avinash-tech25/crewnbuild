import { Home } from "lucide-react";
import { CardShell } from "./CardShell.jsx";
import { Pill } from "./Pill.jsx";
import { RoleFace, roleAvatarClass } from "../shared.jsx";
import { roleMeta } from "../content.js";

const ownerFace = roleMeta.find((role) => role.key === "home").face;

// Step 1 — the house owner posts what they want to build.
export function RequirementCard({ copy, highlighted }) {
  const facts = [copy.area, copy.type, copy.location];

  return (
    <CardShell icon={Home} label={copy.label} highlighted={highlighted}>
      <div className="flex items-center gap-3">
        <span className={roleAvatarClass}>
          <RoleFace image={ownerFace} className="w-full h-full" />
        </span>
        <p className="text-title font-bold text-oc-ink">{copy.projectName}</p>
      </div>

      <ul className="mt-3 flex flex-wrap gap-1.5">
        {facts.map((fact) => (
          <li key={fact}>
            <Pill>{fact}</Pill>
          </li>
        ))}
      </ul>

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-oc-line pt-4">
        <span className="text-xs leading-normal font-medium text-oc-faint">{copy.statusLabel}</span>
        <Pill tone="accent" dot>{copy.status}</Pill>
      </div>

      <p className="mt-3 text-xs leading-normal text-oc-faint">{copy.meta}</p>
    </CardShell>
  );
}
