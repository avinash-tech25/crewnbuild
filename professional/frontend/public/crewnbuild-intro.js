/* Startup adapter only. Artwork and timings are shared with React BrandLoader. */
;(function () {
  function mountArtwork() {
    var intro = document.getElementById('crewnbuild-intro')
    if (!intro || intro.dataset.mounted || !document.documentElement.classList.contains('crew-intro-active')) return
    intro.dataset.mounted = 'true'
    var art = intro.querySelector('.crew-intro-art')
    var original = intro.querySelector('.crew-intro-original')
    var fallback = intro.querySelector('.crew-intro-fallback')
    function failed() {
      intro.classList.add('crew-intro-failed')
      art.style.display = 'none'
      fallback.hidden = false
    }
    original.addEventListener('error', failed, { once: true })
    if (original.complete && !original.naturalWidth) { failed(); return }
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    // Start loading the tiny renderer alongside the image, not after it.
    var renderer = import('./crewnbuild-motion.js').catch(function () { return null })
    function animate() {
      renderer.then(async function (motion) {
        var lifecycle = window.__CREWNBUILD_INTRO__
        if (original.decode) {
          try { await original.decode() } catch (error) { failed(); return }
        }
        if (!motion || !lifecycle || !lifecycle.beginSequence()) return
        function settled(event) {
          if (event.animationName !== 'crew-final' || !event.target.classList.contains('crew-motion__complete')) return
          intro.removeEventListener('animationend', settled)
          lifecycle.artworkSettled()
        }
        intro.addEventListener('animationend', settled)
        motion.mountBrandArtwork(art, 'crew-start', lifecycle.duration)
        intro.classList.add('crew-intro-playing')
      })
    }
    if (original.complete && original.naturalWidth) animate()
    else original.addEventListener('load', animate, { once: true })
  }
  if (document.getElementById('crewnbuild-intro')) mountArtwork()
  else if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountArtwork, { once: true })
  else mountArtwork()
})()
