/**
 * Choosing which part of a picture becomes the advert.
 *
 * Drag to move, the slider to zoom. Deliberately not eight resize handles: the
 * shape is fixed by the slot the advert will sit in, so the only real choice is
 * which part of the picture fills it — the same interaction as setting a profile
 * photograph, which people already know.
 *
 * The frame shown is the slot's true shape, so what is inside the frame is
 * exactly what will appear. Nothing is uploaded until Use this crop.
 */

import { useEffect, useRef, useState } from 'react'
import { centredRegion, shapeFor } from '../advertCrop.js'
import { WIDTH_CHOICES, shrinkAdvertImage } from '../advertImage.js'

const FRAME_WIDTH = 420

export default function AdvertCropper({ file, position, onCancel, onConfirm }) {
  const [source, setSource] = useState(null)
  const [zoom, setZoom] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  // 'whole' keeps all of the picture and only makes it smaller. 'fill' cuts it
  // to the slot's shape.
  //
  // Making it smaller is the default because it is what is wanted most of the
  // time and because it takes nothing away: cutting somebody's picture is the
  // more opinionated act, and should be asked for rather than assumed.
  const [mode, setMode] = useState('whole')
  const [width, setWidth] = useState(WIDTH_CHOICES[0].width)
  const [wholeSize, setWholeSize] = useState(null)
  const dragging = useRef(null)

  const { ratio, label: shapeLabel } = shapeFor(position)
  const frameHeight = Math.round(FRAME_WIDTH / ratio)

  // What the picture will actually weigh at the chosen width. Measured by doing
  // the work rather than estimated: the answer is the point of the choice, and
  // re-encoding a picture this size takes a moment.
  useEffect(() => {
    if (mode !== 'whole') return undefined
    let cancelled = false
    setWholeSize(null)
    shrinkAdvertImage(file, width, true)
      .then((result) => {
        if (!cancelled) setWholeSize(result.size)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [file, mode, width])

  useEffect(() => {
    const url = URL.createObjectURL(file)
    const image = new Image()
    image.onload = () => setSource({ url, width: image.naturalWidth, height: image.naturalHeight })
    image.src = url
    return () => URL.revokeObjectURL(url)
  }, [file])

  if (!source) {
    return <p className="text-xs font-semibold text-oc-muted">Opening the picture…</p>
  }

  // The scale at which the picture just covers the frame. Everything is measured
  // from here, so zoom 1 is always "no empty space" rather than an arbitrary size.
  const cover = Math.max(FRAME_WIDTH / source.width, frameHeight / source.height)
  const scale = cover * zoom
  const shownWidth = source.width * scale
  const shownHeight = source.height * scale

  // Never past the edges: dragging can move the picture only as far as leaving
  // no gap at the frame's border.
  //
  // The frame extent is passed in rather than worked out by comparing the two
  // sizes. Deciding "this must be the vertical one because the numbers differ"
  // is wrong for a square picture, where the scaled width and height are equal:
  // the vertical clamp then measured itself against the frame's width, found no
  // slack, and dragging did nothing at all. Square is exactly the shape a
  // generated picture arrives in.
  const limit = (value, extent, frameExtent) => {
    const slack = Math.max(0, extent - frameExtent)
    return Math.min(slack / 2, Math.max(-slack / 2, value))
  }
  const clamped = {
    x: limit(offset.x, shownWidth, FRAME_WIDTH),
    y: limit(offset.y, shownHeight, frameHeight),
  }

  const startDrag = (event) => {
    dragging.current = { x: event.clientX - clamped.x, y: event.clientY - clamped.y }
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  const onDrag = (event) => {
    if (!dragging.current) return
    setOffset({ x: event.clientX - dragging.current.x, y: event.clientY - dragging.current.y })
  }
  const endDrag = () => {
    dragging.current = null
  }

  const confirm = () => {
    if (mode === 'whole') {
      // No region: nothing is cut, the picture is only made smaller.
      onConfirm({ whole: true, maxWidth: width })
      return
    }

    // Back from what is on screen to the picture's own pixels, so the crop is
    // taken at full resolution rather than at the size it was previewed.
    const visibleWidth = FRAME_WIDTH / scale
    const visibleHeight = frameHeight / scale
    const centred = centredRegion(source.width, source.height, ratio)
    onConfirm({
      x: Math.max(0, Math.round((source.width - visibleWidth) / 2 - clamped.x / scale)),
      y: Math.max(0, Math.round((source.height - visibleHeight) / 2 - clamped.y / scale)),
      width: Math.round(Math.min(visibleWidth, source.width)),
      height: Math.round(Math.min(visibleHeight, source.height)),
      fallback: centred,
    })
  }

  return (
    <div className="mt-2 rounded-xl border border-oc-line bg-white p-3">
      <div className="flex flex-wrap gap-1.5">
        {[
          { key: 'whole', label: 'Just make it smaller' },
          { key: 'fill', label: 'Crop to fit the slot' },
        ].map(({ key, label: name }) => (
          <button
            key={key}
            type="button"
            onClick={() => setMode(key)}
            className={`rounded-lg px-2.5 py-1 text-[11px] font-bold ${
              mode === key ? 'bg-oc-green text-white' : 'bg-slate-100 text-oc-muted'
            }`}
          >
            {name}
          </button>
        ))}
      </div>

      {mode === 'whole' ? (
        <div className="mt-2">
          <div
            className="grid place-items-center rounded-lg border border-oc-line bg-slate-100 p-2"
            style={{ width: FRAME_WIDTH, maxWidth: '100%' }}
          >
            {/* Shown whole, at the shape it will keep. The slot renders an
                advert at its own proportions, so nothing is letterboxed and
                nothing is cut — it is simply smaller. */}
            <img src={source.url} alt="" className="max-h-40 w-auto max-w-full" />
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] font-extrabold uppercase tracking-wide text-oc-faint">
              Width
            </span>
            {WIDTH_CHOICES.map(({ width: choice, label: name }) => (
              <button
                key={choice}
                type="button"
                onClick={() => setWidth(choice)}
                className={`rounded-md px-2 py-0.5 text-[11px] font-bold ${
                  width === choice ? 'bg-oc-green text-white' : 'bg-slate-100 text-oc-muted'
                }`}
              >
                {name} {choice}px
              </button>
            ))}
          </div>
          <p className="mt-1 text-[11px] font-semibold text-oc-faint">
            {wholeSize === null
              ? 'Measuring…'
              : `${Math.max(1, Math.round(wholeSize / 1024)).toLocaleString()} KB, down from ${Math.round(file.size / 1024).toLocaleString()} KB`}
          </p>
        </div>
      ) : (
        <>
      <p className="text-[11px] font-extrabold uppercase tracking-wide text-oc-faint">
        {shapeLabel} — drag to choose what shows
      </p>

      <div
        className="relative mt-2 cursor-grab overflow-hidden rounded-lg border border-oc-line bg-slate-100 active:cursor-grabbing"
        style={{ width: FRAME_WIDTH, height: frameHeight, maxWidth: '100%' }}
        onPointerDown={startDrag}
        onPointerMove={onDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <img
          src={source.url}
          alt=""
          draggable={false}
          className="pointer-events-none absolute left-1/2 top-1/2 max-w-none"
          style={{
            width: shownWidth,
            height: shownHeight,
            transform: `translate(calc(-50% + ${clamped.x}px), calc(-50% + ${clamped.y}px))`,
          }}
        />
      </div>

      <label className="mt-2 block">
        <span className="text-[11px] font-extrabold uppercase tracking-wide text-oc-faint">Zoom</span>
        <input
          type="range"
          min="1"
          max="3"
          step="0.01"
          value={zoom}
          onChange={(event) => setZoom(Number(event.target.value))}
          className="mt-1 w-full"
          style={{ maxWidth: FRAME_WIDTH }}
        />
      </label>
        </>
      )}

      <div className="mt-2 flex gap-2">
        <button
          type="button"
          onClick={confirm}
          className="rounded-lg bg-oc-green px-3 py-1.5 text-xs font-bold text-white hover:bg-oc-deep"
        >
          {mode === 'whole' ? 'Use this picture' : 'Use this crop'}

        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg border border-oc-line px-3 py-1.5 text-xs font-bold text-oc-muted"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
