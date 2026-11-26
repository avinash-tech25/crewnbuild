import { Suspense, lazy, useEffect, useRef, useState } from 'react'
import { Box } from 'lucide-react'
import { hubUrl } from './shared.jsx'

// The 3D villa needs three.js, the largest library on the home page. It is downloaded
// only when its box comes near the screen; until then an empty box of the same size and
// frame holds its place, so nothing on the page moves.
const ConstructionVilla = lazy(() => import('./ConstructionVilla.jsx'))

const FRAME = 'relative isolate overflow-hidden rounded-3xl border border-white/15 shadow-[0_28px_44px_rgba(0,0,0,.22)]'

function VillaPlaceholder({ className = '', boxRef }) {
  return (
    <div ref={boxRef} className={`${FRAME} ${className}`} aria-hidden="true">
      <div className="h-[420px] w-full max-wide:h-[330px]" />
    </div>
  )
}

// Phones show a picture instead, and load the 3D villa only when asked.
const isPhone = () => Boolean(window.matchMedia?.('(max-width: 700px)')?.matches)

export default function LazyConstructionVilla({ viewLabel, ...props }) {
  const boxRef = useRef(null)
  const [near, setNear] = useState(false)
  const [asPicture, setAsPicture] = useState(isPhone)

  useEffect(() => {
    const box = boxRef.current
    if (asPicture || near || !box) return undefined
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) setNear(true)
    }, { rootMargin: '600px 0px' })
    observer.observe(box)
    return () => observer.disconnect()
  }, [asPicture, near])

  if (asPicture) {
    return (
      <div className={`${FRAME} grid h-[330px] place-items-center bg-oc-mint ${props.className || ''}`}>
        <img src={hubUrl} alt="" loading="lazy" className="mb-10 h-[200px] w-auto max-w-[85%] object-contain" />
        <button
          type="button"
          onClick={() => { setAsPicture(false); setNear(true) }}
          className="absolute bottom-4 start-1/2 inline-flex min-h-[44px] -translate-x-1/2 items-center gap-2 whitespace-nowrap rounded-full bg-oc-green px-5 text-xs font-extrabold text-white transition hover:bg-oc-deep focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-oc-green focus-visible:ring-offset-2 rtl:translate-x-1/2"
        >
          <Box className="h-4 w-4" aria-hidden="true" /> {viewLabel}
        </button>
      </div>
    )
  }

  if (!near) return <VillaPlaceholder className={props.className} boxRef={boxRef} />
  return (
    <Suspense fallback={<VillaPlaceholder className={props.className} />}>
      <ConstructionVilla {...props} />
    </Suspense>
  )
}
