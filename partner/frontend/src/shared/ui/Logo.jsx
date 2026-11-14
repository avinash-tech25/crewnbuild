import { Link } from 'react-router-dom'

// The same mark the Professional app's landing header carries, so the two applications read as one
// brand. The file is copied into Partner's own public/ folder rather than imported across
// the repo, keeping Partner dependent on nothing in the Professional app.
const LOGO_URL = '/crew n build logo.png'
// `wordmark` swaps the text name for the transparent Crew&Build wordmark image.
const WORDMARK_URL = '/crew and build wordmark.png'

export default function Logo({ to = '/', tone = 'dark', wordmark = false }) {
  const text = tone === 'light' ? 'text-white' : 'text-oc-deep'
  if (wordmark) {
    // The logo and the wordmark are now one image, so it is shown once. The box keeps
    // the width the mark + gap + wordmark pair used to take (40 + 10 + 179 px, or
    // 40 + 10 + 126 px on mobile), so the navigation beside it stays where it was.
    return (
      <Link to={to} className={`inline-flex items-center ${text}`} aria-label="CREWNBUILD Partner home">
        <img
          src={WORDMARK_URL}
          alt="Crew&Build"
          className="h-10 w-[229px] object-contain object-left max-md:w-[176px]"
        />
      </Link>
    )
  }

  return (
    <Link to={to} className={`inline-flex items-center gap-2.5 ${text}`} aria-label="CREWNBUILD Partner home">
      <img
        src={LOGO_URL}
        alt=""
        className="h-10 w-10 object-contain drop-shadow-[0_7px_11px_rgba(8,62,43,.34)]"
      />
      <span className="font-display text-lg font-extrabold tracking-tight">CREWNBUILD</span>
    </Link>
  )
}
