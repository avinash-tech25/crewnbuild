// Shared by the document intro and React BrandLoader. No runtime dependencies.
// All times are milliseconds; changing a scene here changes both presentations.
// Towers: [phase start, zero stagger, shared duration]. Their reveal clips
// and backing-removal masks use the same phase clock and CSS easing.
export const TIMELINE = Object.freeze({
  helmet: [40, 610], towers: [650, 0, 600],
  windows: [1250, 40, 80, 120], capsule: [1770, 330],
  crew: [2100, 180], ampersand: [2180, 180], build: [2260, 180],
  tagline: [2440, 160], resolve: [490, 160], complete: [2600, 180], hold: 3080,
})

export const LOGO = '/crew-and-build-logo.png'
// Bounds reference the original 654 × 400 PNG, not replacement vector artwork.
const TOWERS = [
  { x: 143, y: 112, width: 73, height: 142, fill: '#182328', columns: [[155, 20], [184, 20]], rows: [126, 152, 178, 204, 230], windowHeight: 19 },
  { x: 274, y: 0, width: 106, height: 254, fill: '#182328', columns: [[291, 28], [334, 28]], rows: [30, 71, 112, 153, 194], windowHeight: 28 },
  { x: 434, y: 111, width: 74, height: 143, fill: '#f5bb0f', columns: [[445, 13], [465, 13], [484, 13]], rows: [125, 143, 162, 180, 198, 217, 235], windowHeight: 13 },
]
// Sampled helmet envelope, including the brim. PNG alpha supplies the exact
// visible edge; connectors cover the crown obscured by the central tower.
const HELMET = 'M50 254 L50 237 L54 230 L68 223 L78 185 L98 140 L118 109 L138 86 L158 68 L178 53 L198 41 L218 31 L228 26 L260 12 L274 10 L327 8 L380 10 L410 22 L426 25 L452 39 L472 50 L492 64 L512 82 L532 104 L552 133 L572 177 L582 212 L592 226 L602 234 L602 254 Z'

export function createBrandArtwork(id, duration = TIMELINE.hold) {
  // IDs are internally generated, never user HTML. Validate to keep string
  // markup safe and isolate masks when several loaders share a document.
  if (!/^[a-zA-Z][\w-]*$/.test(id)) throw new Error('Invalid brand artwork ID')
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('Invalid brand duration')
  // Preserve a real 300ms completed-logo hold even in the short repeat variant.
  const scale = Math.max(0, duration - 300) / (TIMELINE.hold - 300)
  const ms = (value) => `${Number((value * scale).toFixed(3))}ms`
  const timing = (at, length) => `--at:${ms(at)};--duration:${ms(length)}`
  const url = (name) => `url(#${id}-${name})`
  const image = (attributes = '') => `<image href="${LOGO}" width="654" height="400" ${attributes}/>`
  const rect = ({ x, y, width, height }, attributes = '') => `<rect x="${x}" y="${y}" width="${width}" height="${height}" ${attributes}/>`
  const crop = (name, x, y, width, height) => `<clipPath id="${id}-${name}">${rect({ x, y, width, height })}</clipPath>`
  // Keep all blend pixels inside the charcoal facade, clear of the left
  // silhouette border and the first window column (x=291). No yellow-side wash.
  const joinStart = TOWERS[1].x + 6
  const joinWidth = 10
  const joinEnd = joinStart + joinWidth
  const helmetJoin = () => `<g class="crew-motion__join" mask="${url('alpha')}" clip-path="${url('join-region')}"><rect x="${joinStart}" y="2" width="${joinWidth}" height="246" fill="${url('join')}"/></g>`
  const windows = TOWERS.map((tower) => tower.rows.map((y) => tower.columns.map(([x, width]) => ({ x, y, width, height: tower.windowHeight }))))
  const scenes = ['helmet', 'capsule', 'crew', 'ampersand', 'build', 'tagline', 'resolve', 'complete']
  const variables = scenes.map((name) => `--${name}-at:${ms(TIMELINE[name][0])};--${name}-duration:${ms(TIMELINE[name][1])}`).join(';')
  const defs = [
    `<mask id="${id}-alpha" maskUnits="userSpaceOnUse" x="0" y="0" width="654" height="400" data-crew-style="mask-type:alpha">${image()}</mask>`,
    `<mask id="${id}-helmet" maskUnits="userSpaceOnUse" x="0" y="0" width="654" height="254"><rect width="654" height="254" fill="white"/>${TOWERS.map((tower) => rect(tower, 'fill="black"')).join('')}</mask>`,
    `<clipPath id="${id}-envelope"><path d="${HELMET}"/></clipPath>`,
    `<clipPath id="${id}-daylight"><rect class="crew-motion__daylight" width="654" height="254"/></clipPath>`,
    // The backing and visible facade use the same right-shifted coordinates.
    `<linearGradient id="${id}-bridge" gradientUnits="userSpaceOnUse" x1="${joinStart}" y1="0" x2="${joinEnd}" y2="0"><stop offset="0" stop-color="#f5bb0f"/><stop offset="1" stop-color="#182328"/></linearGradient>`,
    // Yellow recedes into the existing charcoal pixels; no blur or new hue.
    `<linearGradient id="${id}-join" gradientUnits="userSpaceOnUse" x1="${joinStart}" y1="0" x2="${joinEnd}" y2="0"><stop offset="0" stop-color="#f5bb0f" stop-opacity=".8"/><stop offset=".25" stop-color="#f5bb0f" stop-opacity=".68"/><stop offset=".5" stop-color="#f5bb0f" stop-opacity=".4"/><stop offset=".75" stop-color="#f5bb0f" stop-opacity=".12"/><stop offset="1" stop-color="#f5bb0f" stop-opacity="0"/></linearGradient>`,
    crop('join-region', joinStart, 2, joinWidth, 246),
    `<clipPath id="${id}-footprints">${TOWERS.map((tower) => rect(tower)).join('')}</clipPath>`,
    `<mask id="${id}-remaining" maskUnits="userSpaceOnUse" x="0" y="0" width="654" height="254"><rect width="654" height="254" fill="white"/>${TOWERS.map((tower) => rect(tower, `fill="black" class="crew-motion__rise" data-crew-style="${timing(TIMELINE.towers[0], TIMELINE.towers[2])}"`)).join('')}</mask>`,
    `<mask id="${id}-wordless" maskUnits="userSpaceOnUse" x="0" y="254" width="654" height="110"><rect x="0" y="254" width="654" height="110" fill="white"/><rect x="54" y="267" width="552" height="82" fill="black"/></mask>`,
    crop('top', 0, 0, 654, 254), crop('plate', 0, 254, 654, 110),
    `<clipPath id="${id}-foundation"><rect class="crew-motion__foundation" x="0" y="254" width="654" height="110"/></clipPath>`,
    crop('crew', 54, 267, 225, 82), crop('ampersand', 279, 267, 78, 82), crop('build', 357, 267, 249, 82), crop('tagline', 0, 364, 654, 36),
    ...TOWERS.map((tower, index) => `<clipPath id="${id}-tower-${index}">${rect(tower, `class="crew-motion__rise" data-crew-style="${timing(TIMELINE.towers[0], TIMELINE.towers[2])}"`)}</clipPath>`),
    ...windows.flatMap((rows, index) => rows.map((cells, row) => `<clipPath id="${id}-windows-${index}-${row}">${cells.map((cell) => rect(cell)).join('')}</clipPath>`)),
    ...windows.map((rows, index) => `<mask id="${id}-facade-${index}" maskUnits="userSpaceOnUse" x="0" y="0" width="654" height="254"><rect width="654" height="254" fill="white"/>${rows.flat().map((cell) => rect(cell, 'fill="black"')).join('')}</mask>`),
  ].join('')
  const skyline = TOWERS.map((tower, index) => `<g clip-path="${url(`tower-${index}`)}">
    ${windows[index].flat().map((cell) => rect(cell, `fill="${tower.fill}"`)).join('')}
    <g mask="${url(`facade-${index}`)}">${image()}</g>
    ${index === 1 ? helmetJoin() : ''}
    ${windows[index].map((_, row) => image(`class="crew-motion__window" data-crew-style="${timing(TIMELINE.windows[0] + index * TIMELINE.windows[2] + (windows[index].length - 1 - row) * TIMELINE.windows[1], TIMELINE.windows[3])}" clip-path="${url(`windows-${index}-${row}`)}"`)).join('')}
  </g>`).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" class="crew-motion" viewBox="0 0 654 400" aria-hidden="true" focusable="false" data-crew-style="${variables}"><defs>${defs}</defs>
    <g class="crew-motion__layers">
      <g class="crew-motion__helmet" clip-path="${url('daylight')}"><g clip-path="${url('envelope')}">
        <g clip-path="${url('footprints')}" mask="${url('remaining')}"><g mask="${url('alpha')}"><rect width="654" height="254" fill="${url('bridge')}"/></g></g>
        <g mask="${url('helmet')}">${image()}</g>
      </g></g>
      <g clip-path="${url('top')}">${skyline}</g>
      <g clip-path="${url('foundation')}"><rect x="54" y="267" width="552" height="82" fill="#147c3b"/><g mask="${url('wordless')}">${image()}</g></g>
      ${['crew', 'ampersand', 'build'].map((name) => image(`class="crew-motion__${name}" clip-path="${url(name)}"`)).join('')}
      <g class="crew-motion__tagline">${image(`clip-path="${url('tagline')}"`)}</g>
    </g>
    <g class="crew-motion__complete"><rect width="654" height="400" fill="#ffffff"/>${image()}</g>
  </svg>`
}

// Puts the artwork into `container` without HTML parsing (the markup is built above from
// constants, never user text) and sets each element's timings through the CSSOM, which a
// strict Content-Security-Policy allows where inline style attributes are blocked (FE-09).
export function mountBrandArtwork(container, id, duration) {
  const parsed = new DOMParser().parseFromString(createBrandArtwork(id, duration), 'image/svg+xml')
  const svg = container.ownerDocument.importNode(parsed.documentElement, true)
  for (const element of [svg, ...svg.querySelectorAll('[data-crew-style]')]) {
    const declarations = element.getAttribute('data-crew-style')
    if (!declarations) continue
    for (const declaration of declarations.split(';')) {
      const split = declaration.indexOf(':')
      if (split > 0) element.style.setProperty(declaration.slice(0, split).trim(), declaration.slice(split + 1).trim())
    }
    element.removeAttribute('data-crew-style')
  }
  container.append(svg)
  return svg
}
