import { Building2, BriefcaseBusiness, HardHat, Package } from "lucide-react";

// Icon, idle animation, and sprite crop per role. The characters sit at uneven
// positions on the 2560x1440 sheet, so each one carries its own window.
// Same order as the translated role list in `landing.roles.*`.
// Each character is its own file, cut from the artwork sheet to a shared height and
// baseline. `face` is a head-and-shoulders crop, only for the roles that show an avatar.
export const roleMeta = [
  { key: "home", icon: Building2, animation: "animate-role-home", image: "/landing/roles/house owner.png", face: "/landing/roles/home-face.png" },
  { key: "builder", icon: HardHat, animation: "animate-role-build", image: "/landing/roles/builder.png", face: "/landing/roles/builder-face.png" },
  { key: "engineer", icon: BriefcaseBusiness, animation: "animate-role-engineer", image: "/landing/roles/engineer.png" },
  { key: "supplier", icon: Package, animation: "animate-role-supply", image: "/landing/roles/supplier.png" },
];

// Roles still in development send visitors to the coming-soon page rather than sign-up.
export function roleDestination(key) {
  const role = roleMeta.find((entry) => entry.key === key);
  return role?.comingSoon ? `/coming-soon?role=${key}` : `/signup?role=${key}`;
}

// The landing copy that used to live here (an `english` and an `arabic`
// object behind a `translations` map) now lives in src/i18n/translations.js
// under `landing.*`, alongside the rest of the application's copy, so all
// seven supported languages are covered rather than only two. What remains
// above is configuration -- icons, sprite paths, animations and routes --
// which is not translatable text.
