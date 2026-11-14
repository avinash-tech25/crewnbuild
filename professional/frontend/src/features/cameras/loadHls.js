// hls.js is large and only needed once a camera actually plays, so it is downloaded then,
// once, and shared by the live and recorded players.
let pending = null

export function loadHls() {
  if (!pending) {
    pending = import('hls.js').then((module) => module.default).catch((error) => {
      pending = null
      throw error
    })
  }
  return pending
}
