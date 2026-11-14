import { Suspense, lazy, useEffect, useRef, useState } from 'react'

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

export default function LazyConstructionVilla(props) {
  const boxRef = useRef(null)
  const [near, setNear] = useState(false)

  useEffect(() => {
    const box = boxRef.current
    if (near || !box) return undefined
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) setNear(true)
    }, { rootMargin: '600px 0px' })
    observer.observe(box)
    return () => observer.disconnect()
  }, [near])

  if (!near) return <VillaPlaceholder className={props.className} boxRef={boxRef} />
  return (
    <Suspense fallback={<VillaPlaceholder className={props.className} />}>
      <ConstructionVilla {...props} />
    </Suspense>
  )
}
