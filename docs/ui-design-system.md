# UI design system (as it is now)

This describes what the code does today, for the **Professional** web app
(`professional/frontend`). Partner (`partner/frontend`) has its own copy of the same page width,
z-index scale, fonts and card shadow in its `tailwind.config.js`; the two apps share no code.
Sources: `tailwind.config.js`, `src/index.css`, `src/shared/ui/*`, `src/shared/dashboard/*`.
When the code and this page disagree, the code is right and this page should be fixed.

## 1. Colour tokens (Tailwind `theme.extend.colors`)

| Token | Values | Used for |
| --- | --- | --- |
| `brand-50 … 950` | `#f0f6f2` … `#134127` (800) … `#061f15` | App primary: dark construction green. `forest-*` is an alias with the same values. |
| `oc-*` | `green #126b45`, `deep #083e2b`, `mint #dff0e8`, `paper #f7faf7`, `ink #17201c`, `muted #61736a`, `faint #98a29d`, `line #d9e6de`, `line-strong #d5ddd9`, `sunken #f1f5f3`, `amber #f4b740`, `night #0b0c0b` | Landing page and the shared list card, chips and dashboard shell text. |
| `ocbrand-50 … 700`, `ocaccent-50 … 600` | greens `#ecf6f1` … `#0e5537`; ambers `#fef8ea` … `#b27d1c` | `EntityPill` tones. |
| `graphite` | `#1f2937` | Body text (`body` is `bg-white text-graphite`). |
| `slate-*`, `surface`, `cream` | Tailwind slate; `surface` / `cream` = `#f8fafc` / `#f1f5f9` | Neutral surfaces. |
| `warm` | `#dc2626` | Error / rejection. |
| `gold`, `accent`, `neon` | Legacy names that now resolve to the greens | Kept for old classes; do not use in new code. |

**Status tones** (`ListCard.jsx`, `TONE_CLASSES`): each is a 700/800 text on a 50 background with
a 200 border (AA on white). `amber` waiting, `green` agreed / done, `blue` under way, `red` refused
/ failed, `grey` ended / withdrawn, `violet` procurement. `STATUS_TONES` maps stored status codes
to tones; an unknown code reads grey.

**Warm yellow** (`linear-gradient(180deg, #f9c85f, #f4b740 52%, #e9a92f)`): the hover / focus
surface of list cards and the active dashboard navigation item. Grey text on it turns `#083e2b`.

**Dark mode** (`darkMode: 'class'`): only inside the dashboard shell (`html.dark .dash-canvas`).
`index.css` remaps the surface, text and border tokens there; landing and auth pages stay light.

## 2. Typography

- Fonts are self-hosted (`src/assets/fonts/fonts.css`, no font host in the CSP):
  `font-display` = Manrope (headings), `font-sans` = Inter (body). Both fall back to `system-ui`.
- Landing sizes: `text-headline` = `clamp(1.875rem, 1.1rem + 2.6vw, 3rem)`, line-height 1.1;
  `text-title` = `clamp(1.25rem, 1rem + 0.8vw, 1.625rem)`, line-height 1.25.
- Dashboard scale (`.dashboard-main`, `index.css`; the Builder dashboard is the reference):

| Element | Size | Weight / font |
| --- | --- | --- |
| Page title (`--dash-page-title`) | 1.125rem; 1.25rem from 640px | 800, Manrope |
| `h2` section title | 1.125rem | 800, Manrope |
| `h3` card title | 0.9375rem (15px) | 800, Manrope |
| `h4` | 0.875rem | 700 |
| Body, buttons, inputs, `td` | 0.8125rem (13px) | inherit |
| Field labels | 0.75rem | inherit |
| Table headers | 0.6875rem, letter-spacing 0.045em | 800 |

- Long words wrap (`overflow-wrap: break-word` on `body`), for Tamil, Malayalam and Kannada.

## 3. Layout, spacing and breakpoints

- **Page width:** `max-w-page` = 1400px for every screen; `.container-x` = `max-w-page` with
  `px-5`, `sm:px-8`. The dashboard page container is `max-w-page px-4 sm:px-5` (a `wide` page
  uses `max-w-[1584px]`).
- **Dashboard shell:** a sticky 56px top bar (`h-14`, `z-header`), then the section navigation as
  a horizontal strip, then `<main class="dashboard-main">`.
- **Breakpoints:** Tailwind defaults `sm 640`, `md 768`, `lg 1024`, `xl 1280`, `2xl 1536`, plus
  `3xl 1920`, and the landing page's `wide 701` and `mid 1001`.
- **Scrollbar:** from 701px the page always reserves scrollbar space (`scrollbar-gutter: stable`),
  so short pages, long pages and scroll-locked dialogs never shift sideways.

## 4. Cards (`src/shared/ui/ListCard.jsx`)

Every list in the app (projects, requests, partners, listings, orders, bookings, admin records)
uses `ListCard` inside `CardGrid`.

- **Grid:** one column, two from 768px (`md`), three from 1280px (`xl`); `gap-5` (20px); items
  aligned to the top, never stretched to equal height.
- **Card:** `rounded-2xl`, `border-oc-line`, white, `p-4`, `shadow-ocsoft`. No fixed height (the
  height is its content); nothing scrolls inside it. `highlighted` gives `border-oc-green
  bg-ocbrand-50`; `dimmed` dims the body only.
- **Anatomy, in order (a part with nothing to show is left out):**

| Part | Content and size |
| --- | --- |
| header | 48px avatar (`CardAvatar`, `rounded-xl`) · title 15px extrabold, one line · subtitle 12px muted |
| chips | `CardStatus` first, then `CardChip`s: `rounded-full`, `px-2.5 py-0.5`, 11px bold, one line |
| description | one muted 12px line |
| rows | at most four label / value rows (12px) |
| progress | label and amount, then a 6px bar (`bg-emerald-500` on `bg-slate-200`) |
| meta | a small 11px line, a link on the right |
| footer | top border; secondary actions left, primary right; wraps instead of scrolling |

- Long text is cut with an ellipsis and kept whole as a `title` tooltip.
- **Hover / focus:** the whole card turns the warm yellow and lifts 2px (180ms); `focus-within`
  does the same for keyboard users. A clickable card's title is a `<button>` (its keyboard target);
  clicks on buttons, links and fields inside keep their own action.
- Tests: `listCard.test.jsx`, `listCardSize.test.jsx`, `listCardHover.test.jsx`.

**Chips outside cards:** `EntityPill` (`rounded-full`, `px-2.5 py-1`, 12px semibold) with tones
`neutral`, `brand`, `accent`, `positive`, `warning`, `info`, an optional dot and icon.

## 5. Buttons

| Kind | Classes | Size |
| --- | --- | --- |
| Card buttons (`cardButtonClass`) | `primary` light green (`emerald-50` / `emerald-800`), `secondary` white outlined, `danger` white with rose border and text | `h-8`, `px-3`, `rounded-lg`, 12px extrabold |
| `.btn-primary` | `bg-brand-700`, white, `shadow-orange`, lifts 2px on hover | `px-6 py-3`, `rounded-full`, 14px bold |
| `.btn-secondary` | `bg-graphite`, white | same |
| `.btn-ghost` | white, slate border, green on hover | same |
| `.btn-white` | white, `shadow-soft` | same |

All have a visible focus ring (`focus-visible:ring-2`, `ring-oc-green` on cards, `ring-accent/60`
on `.btn`, with `ring-offset-2`); disabled buttons are `opacity-50` and `cursor-not-allowed`.
Icon-only buttons carry an `aria-label`.

## 6. Forms

- There is **no shared input component**: each feature defines its own `inputClass`. The common
  shape is `h-10`, `rounded-lg` or `rounded-xl`, `border-slate-200`, white, `px-3`, 13–14px
  semibold, `focus:border-brand-500`.
- Validation messages use `FieldError` (`src/shared/ui/FieldError.jsx`): 11px bold red, directly
  under the field; it renders only a non-empty string.
- Auth pages use their own `.auth-field`, `.auth-submit` and `.auth-panel` classes (`index.css`).
- Legal short notes under results use `DisclaimerNote`: one 11px grey line with an info icon and a
  "Read disclaimer" link.

## 7. Dialogs, toasts and loading

- **Details window** (`DetailDialog`): `fixed inset-0 z-dialog`, a `bg-slate-900/40` blurred
  backdrop; frame `w-[90vw] max-w-[1280px] max-h-[85vh] min-h-[min(60vh,85vh)]`, `rounded-2xl`;
  header (small label, title, status line, actions, 32px close button); a grey body that scrolls
  inside the frame, with `DetailSection` cards. Closes on ×, a click outside, or Escape (not while
  typing in a field). `role="dialog"`, `aria-modal="true"`.
- **Confirm dialogs** are written per screen: `fixed inset-0 z-dialog`, `max-w-md`, `rounded-2xl`,
  `p-5`. A dialog opened from a dialog uses `z-dialog-nested`; the photo viewer and the crash
  screen use `z-dialog-top`.
- **Toasts** are per feature, on `z-toast`: the new-request toast sits bottom-end (`max-w-sm`,
  `role="status"`, `aria-live="polite"`); short confirmations sit top-centre
  (`w-[min(92vw,30rem)]`, `role="status"` or `alert`). While the Viswa bubble is shown it sets
  `--assistant-offset`, and toasts add it to their bottom offset.
- **Loading:** `Skeleton`, `SkeletonList` and `SkeletonGrid` reserve the space the content will
  take (`animate-pulse`, `bg-slate-200/70`), inside one `role="status"` "Loading" wrapper.

## 8. Stacking (z-index) scale

Every fixed or sticky layer uses a name, never a raw number:

| Name | Value | Used by |
| --- | --- | --- |
| `z-sticky` | 20 | sticky bars inside a page |
| `z-header` | 30 | site navbar, dashboard top bar |
| `z-drawer` | 40 | admin side drawer |
| `z-dropdown` | 50 | menus, bells, search overlays |
| `z-toast` | 60 | toasts, the Viswa bubble and panel |
| `z-dialog` | 70 | dialogs and details windows |
| `z-dialog-nested` | 75 | a dialog opened from a dialog |
| `z-dialog-top` | 80 | photo viewer, crash screen |

Small numbers (`z-10`, `z-[2]` …) appear only for stacking inside one component.

## 9. Motion

- Easing token `ease-soft` = `cubic-bezier(0.23, 1, 0.32, 1)`. Card hover is 180ms; `.btn` 300ms.
- Named animations (landing and auth): `fadeUp`, `floaty` / `floatySlow`, `pulseRing`,
  `flowDash`, `marquee`, `wiggle`, `pulse-dot`, `iconPulse`, and the role figures (`role-home`,
  `role-build` …). A `shimmer` keyframe exists with no animation class.
- **Reduced motion:** framer-motion runs under `<MotionConfig reducedMotion="user">`
  (`AppProviders.jsx`), and `index.css` turns off the auth, landing and list-card animations under
  `prefers-reduced-motion: reduce`. New animation must do the same.

## 10. Accessibility and layout stability

- Text and chips meet WCAG AA on their surfaces (status tones are 700/800 on 50; grey text on the
  yellow hover turns deep green). Focus is always visible. Dialogs are `role="dialog"` with a label.
  An `axe-core` check runs in the Viswa tests.
- No layout shift: one page width, the reserved scrollbar gutter, skeletons instead of empty areas,
  count badges that keep their slot at 0, and the same navigation and page container nodes across
  tab switches (`src/shared/dashboard/layoutStability.test.jsx`). jsdom measures no pixels; a real
  shift measurement would need a browser.
- User-facing text comes from i18n keys; layouts must survive long translated words.
