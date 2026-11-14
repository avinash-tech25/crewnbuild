import { ImageOff } from 'lucide-react'
import { imageUrl } from '../../../shared/api/apiClient.js'

// The picture a supplier listing shows, or '' for none.
//
// Only the image the administrator uploaded to the master catalog -- the API
// sends it as image_url, read live from master_product_images -- and nothing
// otherwise: never a category or stock photograph standing in for it.
export function listingImageSrc(product) {
  return product.image_url ? imageUrl(product.image_url) : ''
}

// The empty image area: a neutral box, not a picture.
export function NoListingImage({ label, className = '', compact = false }) {
  return (
    <div
      role="img"
      aria-label={label}
      className={`flex flex-col items-center justify-center gap-1 bg-slate-100 text-slate-400 ${className}`}
    >
      <ImageOff className={compact ? 'h-4 w-4' : 'h-6 w-6'} />
      {!compact && <span className="text-[11px] font-bold">{label}</span>}
    </div>
  )
}
