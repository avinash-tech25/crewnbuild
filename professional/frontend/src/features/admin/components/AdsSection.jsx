/**
 * Adverts.
 *
 * An advert is a picture, a link, and a decision about where it should appear.
 * The where is what makes this screen more than a file upload, so the screen
 * list is the largest thing in the form rather than a dropdown tucked at the
 * bottom.
 *
 * Views and clicks sit on the row, not behind a separate report. An advert with
 * no clicks after a week is the thing you want to notice while looking at the
 * list, not something you have to go asking about.
 */

import { useEffect, useState } from 'react'
import { Image as ImageIcon, Pause, Play, Plus, Upload } from 'lucide-react'
import {
  createAdvert,
  fetchAdvertPlacements,
  fetchAdverts,
  setAdvertStatus,
  updateAdvert,
  uploadAdvertImage,
} from '../adminApi.js'
// The admin's own previews read /files/{id}, which needs their token on the
// query string. Visitors get the public /ads/{id}/image address instead.
import { imageUrl } from '../../../shared/api/apiClient.js'

import BudgetInWords from '../../../shared/ui/BudgetInWords.jsx'
import { shrinkAdvertImage } from '../advertImage.js'
import { cropAdvertImage, shapeFor } from '../advertCrop.js'
import AdvertCropper from './AdvertCropper.jsx'
import { useAdminCountry } from './AdminCountry.jsx'
import { can } from '../adminAccess.js'

// The currency an advert's price is in, by the country it runs in (India is the only
// market). Used before the server has given the advert its own currency; the old console
// referred to this table without defining it, so opening the form crashed.
const CURRENCY_FOR_SCOPE = { IN: 'INR' }

const BLANK = {
  title: '',
  image_url: '',
  link_url: '',
  placements: [],
  positions: {},
  display_width: 'FULL',
  scope: '',
  starts_on: '',
  ends_on: '',
  price_amount: '',
  pricing_model: '',
  currency: '',
}

// How an advert can be charged for. Nothing here collects money — the platform
// has no payment rail — so a price records what was agreed, and the view and
// click counts already kept say what it has come to.
const PRICING_MODELS = [
  { key: 'FLAT', label: 'Flat, for the booking' },
  { key: 'PER_1000_VIEWS', label: 'Per 1,000 views' },
  { key: 'PER_CLICK', label: 'Per click' },
]

// Where on a screen an advert sits. Two, because both live in a layout that
// already wraps every page — a third would have to be pasted into each page by
// hand, in a spot only that page can decide.
const POSITIONS = [
  { key: 'top', label: 'Top' },
  { key: 'footer', label: 'Above footer' },
]
const DEFAULT_POSITION = 'footer'

// How much of the page's width an advert is given. The picture is unchanged
// either way; this is only how much room it gets.
const DISPLAY_WIDTHS = [
  { key: 'FULL', label: 'Full width' },
  { key: 'HALF', label: 'Half' },
  { key: 'SMALL', label: 'Small' },
]

// The public pages, and the address each one lives at. These can be shown as
// they really are: they need no account, and they are served from this same
// origin, so the console can open one in a frame beside the form.
//
// The four consoles are deliberately absent. A frame of /owner/projects would
// load as the administrator who is signed in, and be sent straight to the login
// screen — a preview of the wrong thing is worse than an honest outline.
const PREVIEW_PATHS = {
  home: '/',
  about: '/about',
  services: '/services',
  projects: '/projects',
  why_us: '/why-us',
  process: '/process',
  testimonials: '/testimonials',
  contact: '/contact',
  estimate: '/estimate',
}

const field =
  'mt-1 h-10 w-full rounded-lg border border-oc-line bg-white px-3 text-sm font-semibold text-graphite'
const label = 'block text-[11px] font-extrabold uppercase tracking-wide text-oc-faint'

function StatusPill({ value }) {
  const tone =
    value === 'ACTIVE'
      ? 'bg-ocbrand-50 text-ocbrand-700'
      : value === 'PAUSED'
        ? 'bg-amber-50 text-amber-700'
        : 'bg-slate-100 text-slate-500'
  return (
    <span className={`rounded-md px-2 py-0.5 text-[11px] font-bold uppercase ${tone}`}>
      {value}
    </span>
  )
}

function ScreenChip({ chosen, onToggle, screenKey, name, muted }) {
  return (
    <label
      className={`cursor-pointer rounded-lg border px-2.5 py-1 text-xs font-semibold ${
        chosen
          ? 'border-ocbrand-400 bg-ocbrand-50 text-ocbrand-700'
          : `border-oc-line bg-white ${muted ? 'text-oc-faint' : 'text-oc-muted'}`
      }`}
    >
      <input
        type="checkbox"
        checked={chosen}
        onChange={() => onToggle(screenKey)}
        className="sr-only"
      />
      {name}
    </label>
  )
}

/** The screen picker, shared by the create and edit forms.
 *
 * A console and the sections inside it are one group rather than thirty loose
 * chips. Ticking the console runs the advert everywhere in it, so its sections
 * are shown as already covered and taking one out means untick the console and
 * pick the parts — which is the choice being made, said plainly.
 */
function PlacementPicker({ placements, chosen, onToggle }) {
  const publicScreens = placements.filter((entry) => !entry.key.includes(':'))
  const consoles = publicScreens.filter((entry) => entry.key.endsWith('_dashboard'))
  const pages = publicScreens.filter((entry) => !entry.key.endsWith('_dashboard'))

  return (
    <div className="mt-1.5 space-y-2.5">
      <div className="flex flex-wrap gap-2">
        {pages.map(({ key, label: name }) => (
          <ScreenChip key={key} screenKey={key} name={name} chosen={chosen.includes(key)} onToggle={onToggle} />
        ))}
      </div>

      {consoles.map(({ key: consoleKey, label: consoleName }) => {
        const sections = placements.filter((entry) => entry.key.startsWith(`${consoleKey}:`))
        const wholeConsole = chosen.includes(consoleKey)
        return (
          <div key={consoleKey} className="rounded-xl border border-oc-line bg-white/70 p-2">
            <div className="flex flex-wrap items-center gap-2">
              <ScreenChip
                screenKey={consoleKey}
                name={`${consoleName} (all)`}
                chosen={wholeConsole}
                onToggle={onToggle}
              />
              {sections.map(({ key, label: name }) => (
                <ScreenChip
                  key={key}
                  screenKey={key}
                  name={name.split(' - ').pop()}
                  chosen={wholeConsole || chosen.includes(key)}
                  muted={wholeConsole}
                  onToggle={onToggle}
                />
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

/** The screens that were ticked, and where the advert sits on each.
 *
 * A list rather than a control buried in each chip: the position only matters
 * for screens actually chosen, and the point of choosing per screen is being
 * able to see, in one place, that this advert is a banner on the landing page
 * and sits above the footer everywhere else.
 */
function ChosenScreens({ chosen, positions, nameFor, onPosition, selected, onSelect }) {
  if (!chosen.length) return null
  return (
    <div className="mt-2 space-y-1">
      <span className={label}>Where it sits on each screen</span>
      {chosen.map((screen) => (
        <div
          key={screen}
          className={`flex items-center justify-between gap-2 rounded-lg border bg-white px-2.5 py-1.5 ${
            selected === screen ? 'border-ocbrand-400 ring-1 ring-ocbrand-200' : 'border-oc-line'
          }`}
        >
          {/* Clicking a screen previews it. The row is the obvious thing to
              click when the question is "what does it look like there?" */}
          <button
            type="button"
            onClick={() => onSelect(screen)}
            className="min-w-0 flex-1 truncate text-left text-xs font-bold text-graphite"
          >
            {nameFor(screen)}
            {PREVIEW_PATHS[screen] && (
              <span className="ml-1.5 text-[10px] font-semibold text-oc-faint">preview</span>
            )}
          </button>
          <div className="flex shrink-0 gap-1">
            {POSITIONS.map(({ key, label: name }) => {
              const active = (positions[screen] || DEFAULT_POSITION) === key
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => onPosition(screen, key)}
                  className={`rounded-md px-2 py-0.5 text-[11px] font-bold ${
                    active ? 'bg-oc-green text-white' : 'bg-slate-100 text-oc-muted'
                  }`}
                >
                  {name}
                </button>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

/** The chosen screen, as it really is, with the draft advert in place.
 *
 * The page itself in a frame rather than a drawing of it: the question an
 * administrator is asking is whether the advert looks right on that page, and
 * only the page can answer it. Scaled down so a full-width layout fits beside
 * the form, and made inert so nothing inside it can be clicked by accident.
 *
 * The draft travels through sessionStorage — same origin, same tab, nothing
 * stored anywhere and nothing that outlives the tab.
 */
function RealScreenPreview({ placement, position, imageUrl: imagePath, title, displayWidth }) {
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    try {
      sessionStorage.setItem(
        'crewnbuild_advert_preview',
        JSON.stringify({ placement, position, image_url: imagePath, title, display_width: displayWidth }),
      )
      // The frame reads the draft as it loads, so it has to be reloaded for a
      // change to show. Changing the address is what reloads it.
      setNonce((current) => current + 1)
    } catch {
      // A browser refusing storage loses the preview, not the form.
    }
  }, [placement, position, imagePath, title, displayWidth])

  const path = PREVIEW_PATHS[placement]
  if (!path || !imagePath) return null

  return (
    <div className="mt-1.5 overflow-hidden rounded-xl border border-oc-line bg-white">
      <div
        className="relative w-full"
        // 1280 wide scaled to a third, so the height shown is a third of 900.
        style={{ height: 300 }}
      >
        <iframe
          key={nonce}
          title="How this screen will look"
          src={`${path}?advertPreview=1&n=${nonce}`}
          className="absolute left-0 top-0 origin-top-left border-0"
          style={{ width: 1280, height: 900, transform: 'scale(0.333)' }}
          // Nothing in a preview should be clickable, and it must not be able
          // to navigate the console away from the form somebody is filling in.
          sandbox="allow-same-origin allow-scripts"
          scrolling="no"
        />
        <div className="absolute inset-0" aria-hidden="true" />
      </div>
    </div>
  )
}

/** The advert as a visitor will meet it, before anything is saved.
 *
 * A page drawn in outline — a header bar, lines of content, a footer — with the
 * advert in the place it will actually occupy. The picture is rendered exactly
 * as the real slot renders it, badge included, because the questions being asked
 * here are "is it cut off?" and "is it in the way?", and neither can be answered
 * by a thumbnail on its own.
 */
function AdvertPreview({ imageSrc, title, position, displayWidth }) {
  // The same proportions the real slot gives it, so the outline does not
  // promise a full-width banner for an advert set to sit small.
  const widthClass =
    displayWidth === 'HALF' ? 'w-1/2 mx-auto' : displayWidth === 'SMALL' ? 'w-1/3 mx-auto' : 'w-full'

  const advert = imageSrc ? (
    <div className={`relative ${widthClass}`}>
      <span className="absolute right-1.5 top-1.5 rounded bg-black/45 px-1 py-0.5 text-[8px] font-bold uppercase tracking-wide text-white">
        Ad
      </span>
      <img
        src={imageSrc}
        alt={title || ''}
        className="w-full rounded-lg border border-oc-line object-cover"
        style={{ maxHeight: '96px' }}
        onError={(event) => {
          event.currentTarget.style.visibility = 'hidden'
        }}
      />
    </div>
  ) : (
    <div className={`grid h-12 place-items-center rounded-lg border border-dashed border-oc-line text-[10px] font-bold uppercase tracking-wide text-oc-faint ${widthClass}`}>
      Your advert
    </div>
  )

  const contentLine = (width) => (
    <div className={`h-2 rounded-full bg-slate-200 ${width}`} />
  )

  return (
    <div className="mt-3">
      <span className={label}>Preview</span>
      <div className="mt-1.5 max-w-sm overflow-hidden rounded-xl border border-oc-line bg-white">
        <div className="flex items-center gap-1.5 border-b border-oc-line bg-slate-50 px-2.5 py-2">
          <div className="h-2 w-2 rounded-full bg-oc-green" />
          {contentLine('w-14')}
          <div className="ml-auto flex gap-1">
            {contentLine('w-6')}
            {contentLine('w-6')}
          </div>
        </div>
        <div className="space-y-2 p-2.5">
          {position === 'top' && advert}
          {contentLine('w-3/4')}
          {contentLine('w-full')}
          {contentLine('w-2/3')}
          {contentLine('w-5/6')}
          {position === 'footer' && advert}
        </div>
        <div className="flex gap-1.5 border-t border-oc-line bg-slate-50 px-2.5 py-2">
          {contentLine('w-10')}
          {contentLine('w-8')}
        </div>
      </div>
      <p className="mt-1 text-[11px] font-semibold text-oc-faint">
        {position === 'top' ? 'Above the page content' : 'Below the content, above the footer'}
      </p>
    </div>
  )
}

function AdvertForm({ identity, placements, existing, onDone, onCancel }) {
  const editing = Boolean(existing)
  const [draft, setDraft] = useState(
    existing
      ? {
          title: existing.title,
          image_url: existing.image_url,
          link_url: existing.link_url || '',
          placements: existing.placements,
          positions: existing.placement_positions || {},
          display_width: existing.display_width || 'FULL',
          price_amount: existing.price_amount || '',
          pricing_model: existing.pricing_model || '',
          currency: existing.currency || '',
          scope: existing.scope,
          starts_on: existing.starts_on || '',
          ends_on: existing.ends_on || '',
        }
      : BLANK,
  )
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [imageSize, setImageSize] = useState(null)
  const [previewScreen, setPreviewScreen] = useState('')
  // The chosen file, waiting to be cropped. Nothing is uploaded until it is.
  const [pending, setPending] = useState(null)
  // The picture as it was chosen, kept so Edit can go back to it.
  //
  // Re-cutting the version that was uploaded would mean cutting something
  // already made smaller and re-encoded — a second pass over a first pass, and
  // the picture is a little worse each time. Every edit works from the original.
  const [original, setOriginal] = useState(null)

  // Which screen the preview is showing: the one clicked, or the first chosen
  // until somebody clicks. A screen that stops being chosen falls back rather
  // than leaving the preview showing a screen the advert no longer runs on.
  const shownScreen = draft.placements.includes(previewScreen)
    ? previewScreen
    : draft.placements[0] || ''
  const shownPosition = draft.positions[shownScreen] || DEFAULT_POSITION
  const nameOf = (key) => placements.find((entry) => entry.key === key)?.label || key
  const [error, setError] = useState('')

  // Choosing a file opens the cropper rather than uploading at once: the shape
  // of the slot is fixed, and a picture that is not that shape would otherwise be
  // cut by the browser in a place nobody chose and nobody can see until it is live.
  const chooseImage = (event) => {
    const file = event.target.files?.[0]
    setError('')
    if (file) {
      setOriginal(file)
      setPending(file)
    }
    // Cleared so choosing the same file twice still fires a change.
    event.target.value = ''
  }

  // Offered while the chosen picture is still in hand, which is the whole of the
  // time somebody is working on an advert.
  //
  // Not offered for a picture already saved and reopened later: reading it back
  // means asking the file store for another administrator's upload, which it
  // refuses — correctly, and not something to loosen for a convenience. Choosing
  // the picture again does the same job.
  const editPicture = () => {
    setError('')
    if (original) setPending(original)
  }

  const uploadCropped = async (region) => {
    if (!pending) return
    setUploading(true)
    setError('')
    try {
      // Two ways to prepare a picture, and the form says which was chosen.
      //
      // Whole: nothing is cut, it is only made smaller at the width asked for —
      // for a picture that says something at its edges, or one already the right
      // shape, where cropping would only take something away.
      //
      // Otherwise: cut to the slot's shape, then held to a sensible size.
      //
      // Both happen here rather than on the server: re-encoding an image there
      // needs an imaging library, and doing it in the browser means the original
      // never crosses the network at all.
      const picture = region?.whole
        ? await shrinkAdvertImage(pending, region.maxWidth, true)
        : await shrinkAdvertImage(await cropAdvertImage(pending, shapeFor(shownPosition).ratio, region))
      const url = await uploadAdvertImage(picture)
      setDraft((current) => ({ ...current, image_url: url }))
      setImageSize(picture.size)
      setPending(null)
    } catch (uploadError) {
      setError(uploadError.response?.data?.detail || 'That image could not be uploaded.')
    } finally {
      setUploading(false)
    }
  }

  const toggle = (key) =>
    setDraft((current) => ({
      ...current,
      // Ticking a whole console drops the sections of it that were picked
      // separately: the console already covers them, and leaving both would
      // store a list saying the same thing twice.
      placements: current.placements.includes(key)
        ? current.placements.filter((entry) => entry !== key)
        : [...current.placements.filter((entry) => !entry.startsWith(`${key}:`)), key],
    }))

  const submit = async (event) => {
    event.preventDefault()
    setSaving(true)
    setError('')
    try {
      const body = {
        title: draft.title,
        image_url: draft.image_url,
        link_url: draft.link_url || null,
        placements: draft.placements.map(
          (screen) => `${screen}@${draft.positions[screen] || DEFAULT_POSITION}`,
        ),
        starts_on: draft.starts_on || null,
        ends_on: draft.ends_on || null,
        display_width: draft.display_width,
        price_amount: draft.price_amount ? draft.price_amount : null,
        pricing_model: draft.pricing_model || null,
      }
      // Only asked for when the advert runs in both countries; otherwise the
      // server takes it from the country the advert belongs to.
      if (!editing && draft.currency) body.currency = draft.currency
      if (editing) {
        // Nothing sent means "run until stopped", which an omitted field cannot
        // express — the server would read it as "leave the dates alone".
        if (!draft.starts_on && !draft.ends_on) body.clear_dates = true
        // Same reasoning for the price: an omitted field means "leave it alone",
        // so removing one has to be said outright.
        if (!draft.price_amount && !draft.pricing_model) body.clear_price = true
        await updateAdvert(existing.id, body)
      } else {
        // Ignored by the server for a location administrator, whose own country
        // is always used.
        await createAdvert({ ...body, scope: identity.is_global ? draft.scope : undefined })
      }
      onDone()
    } catch (requestError) {
      setError(requestError.response?.data?.detail || 'Could not save that advert.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form
      onSubmit={submit}
      className="mb-4 rounded-2xl border border-oc-line bg-brand-50/40 p-4"
    >
      <p className="text-[11px] font-extrabold uppercase tracking-wide text-oc-faint">
        {editing ? `Editing "${existing.title}"` : 'New advert'}
      </p>

      <div className="mt-2 grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className={label}>Name</span>
          <input
            value={draft.title}
            onChange={(event) => setDraft({ ...draft, title: event.target.value })}
            placeholder="Monsoon cement offer"
            className={field}
            required
          />
        </label>
        <div className="block">
          <span className={label}>Picture</span>
          <label
            className={`mt-1 flex h-10 cursor-pointer items-center gap-2 rounded-lg border border-dashed px-3 text-sm font-semibold ${
              uploading
                ? 'border-oc-line text-oc-faint'
                : 'border-ocbrand-300 bg-white text-ocbrand-700 hover:bg-ocbrand-50'
            }`}
          >
            <Upload className="h-4 w-4 shrink-0" />
            {uploading
              ? 'Uploading…'
              : draft.image_url
                ? 'Choose a different picture'
                : 'Choose a picture'}
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={chooseImage}
              disabled={uploading}
              className="sr-only"
            />
          </label>
          {/* Offered once there is a picture, so a crop or a size can be
              reconsidered without hunting for the file on disk again. */}
          {draft.image_url && original && !pending && (
            <button
              type="button"
              onClick={editPicture}
              disabled={uploading}
              className="mt-1.5 rounded-lg border border-oc-line bg-white px-2.5 py-1 text-[11px] font-bold text-oc-deep hover:bg-slate-50 disabled:text-oc-faint"
            >
              Edit size or crop
            </button>
          )}
          {/* The address is kept visible but read-only: it is worth being able to
              see and copy, and worth not being able to mistype. */}
          {draft.image_url && (
            <input value={draft.image_url} readOnly className={`${field} text-[11px] text-oc-muted`} />
          )}
          {pending && (
            <AdvertCropper
              file={pending}
              position={shownPosition}
              onCancel={() => setPending(null)}
              onConfirm={uploadCropped}
            />
          )}
          {/* Named because the weight of the picture is the one thing about it
              the visitor feels and the person choosing it cannot see. */}
          {imageSize !== null && (
            <p className="mt-1 text-[11px] font-semibold text-oc-faint">
              {Math.max(1, Math.round(imageSize / 1024)).toLocaleString()} KB after resizing
            </p>
          )}
        </div>
        <label className="block">
          <span className={label}>Where it links to (optional)</span>
          <input
            value={draft.link_url}
            onChange={(event) => setDraft({ ...draft, link_url: event.target.value })}
            placeholder="https://…"
            className={field}
          />
        </label>
      </div>

      <p className="mt-4 border-t border-oc-line pt-3 text-[11px] font-extrabold uppercase tracking-wide text-oc-faint">Where it runs</p>
      <div className="mt-3">
        <span className={label}>Which screens it appears on</span>
        <PlacementPicker
          placements={placements}
          chosen={draft.placements}
          onToggle={toggle}
        />
        <ChosenScreens
          chosen={draft.placements}
          positions={draft.positions}
          selected={shownScreen}
          onSelect={setPreviewScreen}
          nameFor={(key) => placements.find((entry) => entry.key === key)?.label || key}
          onPosition={(screen, position) =>
            setDraft((current) => ({
              ...current,
              positions: { ...current.positions, [screen]: position },
            }))
          }
        />
      </div>
        <div className="mt-3">
          <span className={label}>How wide it appears</span>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {DISPLAY_WIDTHS.map(({ key, label: name }) => (
              <button
                key={key}
                type="button"
                onClick={() => setDraft({ ...draft, display_width: key })}
                className={`rounded-lg px-2.5 py-1 text-xs font-bold ${
                  draft.display_width === key
                    ? 'bg-oc-green text-white'
                    : 'bg-slate-100 text-oc-muted'
                }`}
              >
                {name}
              </button>
            ))}
          </div>
        </div>

      <p className="mt-4 border-t border-oc-line pt-3 text-[11px] font-extrabold uppercase tracking-wide text-oc-faint">Dates and cost</p>
      <div className="mt-2 grid gap-3 sm:grid-cols-2">
        {/* What the advertiser agreed to pay. Optional, because a house advert
            promoting the platform itself costs nothing and still has to be
            placeable. Nothing here collects money — the platform has no payment
            rail — so this is the rate, and the counts we already keep say what
            it has come to. */}
        <label className="block">
          <span className={label}>
            Price {draft.currency || CURRENCY_FOR_SCOPE[editing ? existing.scope : draft.scope] || ''} (optional)
          </span>
          <input
            // A plain text input, not type="number": a focused number input
            // changes its value on a mouse wheel, and an advert priced at 5,000
            // becoming 4,989 while somebody scrolls the form is invisible until
            // it reaches an invoice.
            inputMode="decimal"
            value={draft.price_amount}
            onChange={(event) =>
              setDraft({ ...draft, price_amount: event.target.value.replace(/[^0-9.]/g, '') })
            }
            placeholder="5000"
            className={field}
          />
          {/* Adverts are priced in rupees. */}
          <BudgetInWords value={draft.price_amount} country="India" />
        </label>
        <label className="block">
          <span className={label}>How it is charged</span>
          <select
            value={draft.pricing_model}
            onChange={(event) => setDraft({ ...draft, pricing_model: event.target.value })}
            className={field}
          >
            <option value="">No price</option>
            {PRICING_MODELS.map(({ key, label: name }) => (
              <option key={key} value={key}>{name}</option>
            ))}
          </select>
        </label>
        {/* Country is fixed once an advert exists: moving a running advert
            between countries would leave its recorded performance describing an
            audience it no longer has. */}
        {identity.is_global && !editing && (
          <label className="block">
            <span className={label}>Country</span>
            <select
              value={draft.scope}
              onChange={(event) => setDraft({ ...draft, scope: event.target.value })}
              className={field}
              required
            >
              <option value="">Choose…</option>
              <option value="IN">India</option>
              <option value="GLOBAL">Global</option>
            </select>
          </label>
        )}
        {/* Only for a GLOBAL advert. Everywhere else the currency follows the
            country the advert belongs to. */}
        {draft.scope === 'GLOBAL' && draft.price_amount && !editing && (
          <label className="block">
            <span className={label}>Priced in</span>
            <select
              value={draft.currency}
              onChange={(event) => setDraft({ ...draft, currency: event.target.value })}
              className={field}
              required
            >
              <option value="">Choose…</option>
              <option value="INR">INR — Indian rupees</option>
            </select>
          </label>
        )}
        <label className="block">
          <span className={label}>Starts (optional)</span>
          <input
            type="date"
            value={draft.starts_on}
            onChange={(event) => setDraft({ ...draft, starts_on: event.target.value })}
            className={field}
          />
        </label>
        <label className="block">
          <span className={label}>Ends (optional)</span>
          <input
            type="date"
            value={draft.ends_on}
            onChange={(event) => setDraft({ ...draft, ends_on: event.target.value })}
            className={field}
          />
        </label>
      </div>

      {/* The real page where there is one to show, and an outline everywhere
          else. A console cannot be shown as it really is: a frame of it would
          load as the signed-in administrator and be sent to the login screen. */}
      {PREVIEW_PATHS[shownScreen] && draft.image_url ? (
        <div className="mt-3">
          <span className={label}>Preview — {nameOf(shownScreen)}</span>
          <RealScreenPreview
            placement={shownScreen}
            position={shownPosition}
            imageUrl={draft.image_url}
            title={draft.title}
            displayWidth={draft.display_width}
          />
        </div>
      ) : (
        <AdvertPreview
          imageSrc={draft.image_url ? imageUrl(draft.image_url) : ''}
          title={draft.title}
          position={shownPosition}
          displayWidth={draft.display_width}
        />
      )}

      {error && <p className="mt-2 text-xs font-bold text-red-600">{error}</p>}

      <div className="mt-3 flex gap-2">
        <button
          type="submit"
          disabled={saving}
          className="h-9 rounded-lg bg-oc-green px-4 text-xs font-extrabold text-white hover:bg-oc-deep disabled:opacity-60"
        >
          {saving ? 'Saving…' : editing ? 'Save changes' : 'Create advert'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="h-9 rounded-lg border border-oc-line px-4 text-xs font-extrabold text-oc-muted hover:bg-white"
        >
          Cancel
        </button>
      </div>

      {!editing && (
        <p className="mt-2 text-[11px] font-medium text-oc-muted">
          New adverts start as a draft. Nothing appears to anyone until you start it.
        </p>
      )}
    </form>
  )
}

export function AdsPage({ identity, Panel }) {
  const [adverts, setAdverts] = useState([])
  const [placements, setPlacements] = useState([])
  const [revenue, setRevenue] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [creating, setCreating] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [busyId, setBusyId] = useState(null)

  const mayManage = can(identity, 'ads.manage')
  // This screen loads itself rather than going through the shared `useAsync`,
  // because it reloads after its own edits too. That means the country switch has
  // to be named here explicitly: without it the list keeps showing the country you
  // were looking at before, and only a manual refresh corrects it.
  const { country } = useAdminCountry()

  const load = () => {
    setLoading(true)
    Promise.all([fetchAdverts(), fetchAdvertPlacements()])
      .then(([list, screens]) => {
        setAdverts(list.items || [])
        setRevenue(list.revenue || [])
        setPlacements(screens || [])
        setError('')
      })
      .catch((loadError) =>
        setError(loadError.response?.data?.detail || 'Could not load adverts.'),
      )
      .finally(() => setLoading(false))
  }

  useEffect(load, [country])

  const nameFor = (key) => placements.find((p) => p.key === key)?.label || key

  const toggleRunning = async (advert) => {
    const next = advert.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE'
    setBusyId(advert.id)
    try {
      await setAdvertStatus(advert.id, next)
      load()
    } catch (requestError) {
      setError(requestError.response?.data?.detail || 'Could not change that advert.')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <Panel
      title="Adverts"
      subtitle={
        identity.is_global
          ? 'Every advert running on the platform.'
          : 'Adverts running in your country.'
      }
      right={
        mayManage && !creating ? (
          <button
            type="button"
            onClick={() => {
              setCreating(true)
              setEditingId(null)
            }}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-oc-green px-3.5 text-sm font-extrabold text-white hover:bg-oc-deep"
          >
            <Plus className="h-3.5 w-3.5" /> New advert
          </button>
        ) : null
      }
    >
      {error && <p className="mb-3 text-xs font-bold text-red-600">{error}</p>}

      {creating && (
        <AdvertForm
          identity={identity}
          placements={placements}
          existing={null}
          onDone={() => {
            setCreating(false)
            load()
          }}
          onCancel={() => setCreating(false)}
        />
      )}

      {/* Kept apart by currency, never one total: there is no exchange rate
          anywhere in this application. Covers every advert in scope, not just
          this page. */}
      {revenue.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-2">
          {revenue.map((row) => (
            <div
              key={row.currency}
              className="rounded-xl border border-oc-line bg-oc-mint/40 px-3 py-2"
            >
              <p className="font-display text-base font-bold tabular-nums text-oc-deep">
                {row.currency} {Number(row.earned).toLocaleString()}
              </p>
              <p className="text-[10px] font-extrabold uppercase tracking-wide text-oc-faint">
                From {row.adverts} priced {row.adverts === 1 ? 'advert' : 'adverts'}
              </p>
            </div>
          ))}
        </div>
      )}

      {loading ? (
        <p className="text-sm font-semibold text-oc-muted">Loading…</p>
      ) : adverts.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-oc-line px-4 py-10 text-center">
          <ImageIcon className="mx-auto h-6 w-6 text-slate-300" />
          <p className="mt-2 text-sm font-bold text-oc-deep">No adverts yet</p>
          <p className="mt-0.5 text-xs font-medium text-oc-muted">
            An advert appears on the screens you choose, to the country it belongs to.
          </p>
        </div>
      ) : (
        <div className="grid gap-3">
          {adverts.map((advert) =>
            editingId === advert.id ? (
              <AdvertForm
                key={advert.id}
                identity={identity}
                placements={placements}
                existing={advert}
                onDone={() => {
                  setEditingId(null)
                  load()
                }}
                onCancel={() => setEditingId(null)}
              />
            ) : (
              <div
                key={advert.id}
                className="flex flex-wrap items-center gap-3 rounded-2xl border border-oc-line bg-white p-3"
              >
                <img
                  src={imageUrl(advert.image_url)}
                  alt=""
                  className="h-14 w-24 shrink-0 rounded-lg border border-oc-line object-cover"
                  onError={(event) => {
                    event.currentTarget.style.visibility = 'hidden'
                  }}
                />

                <div className="min-w-48 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="font-display text-sm font-bold text-graphite">{advert.title}</p>
                    <StatusPill value={advert.status} />
                    <span className="rounded-md bg-oc-mint px-2 py-0.5 text-[11px] font-bold uppercase text-oc-deep">
                      {advert.scope === 'GLOBAL' ? 'Global' : advert.scope}
                    </span>
                  </div>
                  <p className="mt-0.5 text-[11px] font-semibold text-oc-muted">
                    {advert.placements.map(nameFor).join(' · ')}
                  </p>
                  {(advert.starts_on || advert.ends_on) && (
                    <p className="mt-0.5 text-[11px] font-medium text-oc-faint">
                      {advert.starts_on || 'now'} → {advert.ends_on || 'until stopped'}
                    </p>
                  )}
                </div>

                {/* Views and clicks sit on the row rather than behind a report:
                    an advert nobody clicks is what you want to notice while
                    scanning the list. */}
                <div className="flex gap-4 text-center">
                  <div>
                    <p className="font-display text-base font-bold tabular-nums text-graphite">
                      {advert.views}
                    </p>
                    <p className="text-[10px] font-extrabold uppercase tracking-wide text-oc-faint">
                      Views
                    </p>
                  </div>
                  <div>
                    <p className="font-display text-base font-bold tabular-nums text-graphite">
                      {advert.clicks}
                    </p>
                    <p className="text-[10px] font-extrabold uppercase tracking-wide text-oc-faint">
                      Clicks
                    </p>
                  </div>
                  {/* Only for an advert that carries a rate. A house advert
                      showing "0" would read as one that earned nothing rather
                      than one that was never sold. */}
                  {advert.earned !== null && advert.earned !== undefined && (
                    <div>
                      <p className="font-display text-base font-bold tabular-nums text-oc-deep">
                        {advert.currency} {Number(advert.earned).toLocaleString()}
                      </p>
                      <p className="text-[10px] font-extrabold uppercase tracking-wide text-oc-faint">
                        {PRICING_MODELS.find((m) => m.key === advert.pricing_model)?.label || 'Earned'}
                      </p>
                    </div>
                  )}
                </div>

                {mayManage && (
                  <div className="flex gap-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        setEditingId(advert.id)
                        setCreating(false)
                      }}
                      className="h-8 rounded-lg border border-oc-line px-3 text-xs font-extrabold text-oc-deep hover:bg-brand-50"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      disabled={busyId === advert.id}
                      onClick={() => toggleRunning(advert)}
                      className={`inline-flex h-8 items-center gap-1 rounded-lg border px-3 text-xs font-extrabold disabled:opacity-50 ${
                        advert.status === 'ACTIVE'
                          ? 'border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100'
                          : 'border-ocbrand-200 bg-ocbrand-50 text-ocbrand-700 hover:bg-ocbrand-100'
                      }`}
                    >
                      {advert.status === 'ACTIVE' ? (
                        <>
                          <Pause className="h-3 w-3" /> Pause
                        </>
                      ) : (
                        <>
                          <Play className="h-3 w-3" /> Start
                        </>
                      )}
                    </button>
                  </div>
                )}
              </div>
            ),
          )}
        </div>
      )}
    </Panel>
  )
}
