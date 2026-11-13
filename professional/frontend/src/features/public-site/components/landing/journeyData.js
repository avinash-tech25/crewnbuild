import { Activity, FileText, Hammer, MapPin, MessageSquare } from "lucide-react";

// The five stages of the CREWNBUILD flow, numbered 01–05 in the UI.
export const flowSteps = [
  { key: "requirement", icon: FileText },
  { key: "discover", icon: MapPin },
  { key: "quote", icon: MessageSquare },
  { key: "start", icon: Hammer },
  { key: "track", icon: Activity },
];

// The four product cards, in the order a project actually moves through them.
export const journeyCards = ["requirement", "builder", "project", "materials"];

// Sample project behind the cards. Numbers live here, copy lives in content.js,
// so wiring this section to a real API only changes this file.
export const sampleProject = {
  progress: 78,
  activeMilestone: 2,
  milestones: ["foundation", "structure", "roofing", "finishing", "handover"],
  materials: [
    { key: "cement", level: 68, status: "ok" },
    { key: "steel", level: 22, status: "low" },
  ],
};
