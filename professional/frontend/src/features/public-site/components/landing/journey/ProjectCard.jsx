import { Activity } from "lucide-react";
import { CardShell } from "./CardShell.jsx";
import { Pill } from "./Pill.jsx";
import { ProgressBar } from "./ProgressBar.jsx";
import { siteUpdatePhotoUrl } from "../shared.jsx";
import { sampleProject } from "../journeyData.js";

// Step 3 — the project is live and progress is visible day by day.
export function ProjectCard({ copy, isArabic, highlighted }) {
  const { progress, milestones, activeMilestone } = sampleProject;

  return (
    <CardShell icon={Activity} label={copy.label} highlighted={highlighted} action={<Pill>{copy.day}</Pill>}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-title font-bold text-oc-ink">{copy.title}</p>
        <p className="text-sm leading-normal font-bold text-oc-green">{copy.progressValue}</p>
      </div>

      <ProgressBar value={progress} label={copy.progressLabel} isArabic={isArabic} className="mt-3" />

      {/* Milestone rail — one dot per stage, filled up to the current one. */}
      <ol className="mt-4 grid grid-cols-5 gap-1">
        {milestones.map((milestone, index) => {
          const done = index < activeMilestone;
          const current = index === activeMilestone;

          return (
            <li key={milestone} className="flex flex-col items-center gap-1.5">
              <span
                aria-hidden="true"
                className={`w-2 h-2 rounded-full ${current ? "bg-ocbrand-500 ring-4 ring-ocbrand-100" : done ? "bg-ocbrand-500" : "bg-oc-line-strong"}`}
              />
              <span className={`w-full truncate text-center text-[10px] leading-tight ${current ? "font-semibold text-oc-ink" : "text-oc-faint"}`}>
                {copy.milestones[milestone]}
              </span>
            </li>
          );
        })}
      </ol>

      <div className="mt-5 flex items-center gap-3 rounded-xl border border-oc-line bg-oc-paper p-3">
        <img
          src={siteUpdatePhotoUrl}
          alt={copy.photoLabel}
          loading="lazy"
          decoding="async"
          className="shrink-0 w-16 h-16 rounded-lg border border-oc-line object-cover"
        />
        <div className="min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-[.12em] text-oc-faint rtl:tracking-normal">{copy.updateLabel}</p>
          <p className="mt-0.5 text-sm leading-snug text-oc-ink">{copy.update}</p>
        </div>
      </div>
    </CardShell>
  );
}
