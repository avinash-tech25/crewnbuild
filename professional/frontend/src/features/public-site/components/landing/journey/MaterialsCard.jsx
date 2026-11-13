import { Boxes } from "lucide-react";
import { CardShell } from "./CardShell.jsx";
import { Pill } from "./Pill.jsx";
import { ProgressBar } from "./ProgressBar.jsx";
import { sampleProject } from "../journeyData.js";

// Step 4 — materials and stock stay attached to the same project.
export function MaterialsCard({ copy, isArabic, highlighted }) {
  return (
    <CardShell icon={Boxes} label={copy.label} highlighted={highlighted}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-title font-bold text-oc-ink">{copy.title}</p>
        <p className="text-xs leading-normal text-oc-faint">{copy.subtitle}</p>
      </div>

      <ul className="mt-4 flex flex-col gap-4">
        {sampleProject.materials.map((material) => {
          const item = copy.items[material.key];
          const low = material.status === "low";

          return (
            <li key={material.key}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm leading-normal font-semibold text-oc-ink">{item.name}</p>
                <p className="text-sm leading-normal font-medium text-oc-muted">{item.quantity}</p>
              </div>

              <ProgressBar
                value={material.level}
                tone={low ? "accent" : "brand"}
                label={item.name}
                isArabic={isArabic}
                className="mt-2"
              />

              <div className="mt-2 flex items-center justify-between gap-2">
                <Pill tone={low ? "accent" : "brand"} dot>{low ? copy.lowStock : copy.inStock}</Pill>
                {low && (
                  <button
                    type="button"
                    className="rounded-lg px-2 py-1 text-xs leading-normal font-semibold text-oc-green transition-colors duration-200 hover:bg-ocbrand-50"
                  >
                    {copy.reorder}
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </CardShell>
  );
}
