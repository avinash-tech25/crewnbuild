import { useEffect, useState } from 'react'

/* Image with graceful gradient fallback if the remote photo fails to load */
export function SmartImage({ src, alt, className = '', fallback = 'from-forest-200 to-forest-400' }) {
  const [failed, setFailed] = useState(false)
  // A new address gets a fresh try (a replaced photo must not keep the fallback).
  useEffect(() => { setFailed(false) }, [src])
  if (failed) {
    return <div className={`bg-gradient-to-br ${fallback} ${className}`} aria-label={alt} role="img" />
  }
  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      onError={() => setFailed(true)}
      className={className}
    />
  )
}
