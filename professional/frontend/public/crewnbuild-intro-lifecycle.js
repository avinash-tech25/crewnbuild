// The start-up screen's life: shown from first paint, independent of React, routing and
// the API; index.html loads this file before the page body (a file, not inline, for a strict
// CSP: FE-09). React calls window.__CREWNBUILD_INTRO__.appReady() once it has rendered.
;(function () {
  var html = document.documentElement
  var key = 'crewnbuild:intro-internal-navigation'
  var completedKey = 'crewnbuild:intro-completed'
  var previouslyCompleted = false
  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)')
  var navigation = performance.getEntriesByType('navigation')[0]
  var skip = false
  try {
    previouslyCompleted = sessionStorage.getItem(completedKey) === 'true'
    var ticket = JSON.parse(sessionStorage.getItem(key) || 'null')
    sessionStorage.removeItem(key)
    skip = Boolean(ticket && navigation && navigation.type === 'navigate' &&
      ticket.url === location.href && Date.now() - ticket.at >= 0 && Date.now() - ticket.at < 5000 &&
      document.referrer && new URL(document.referrer).origin === location.origin)
  } catch (error) { /* Storage unavailable: each new document gets the intro. */ }
  var ready = false
  var done = skip
  // Includes the original-asset handoff and 300ms hold before the exit.
  // Artwork scales its single timeline to this duration.
  var duration = previouslyCompleted ? 1280 : 3080
  var sequenceStarted = false
  var artworkSettled = false
  var completionRecorded = false
  var deadline = performance.now() + (reduced.matches ? 400 : duration)
  var latestAnimationStart = performance.now() + 750
  var finishTimer
  var safetyTimer
  var removalTimer
  var fadeTarget
  function fadeEnded(event) {
    if (event.target === fadeTarget && event.propertyName === 'opacity') release()
  }
  function release() {
    clearTimeout(removalTimer)
    clearTimeout(finishTimer)
    clearTimeout(safetyTimer)
    if (fadeTarget) fadeTarget.removeEventListener('transitionend', fadeEnded)
    reduced.removeEventListener('change', motionChanged)
    html.classList.remove('crew-intro-active')
    var root = document.getElementById('root')
    if (root) { root.style.removeProperty('visibility'); root.inert = false; root.removeAttribute('aria-hidden') }
    var intro = document.getElementById('crewnbuild-intro')
    if (intro) intro.remove()
  }
  function dismiss() {
    if (done) return
    done = true
    clearTimeout(finishTimer)
    clearTimeout(safetyTimer)
    var root = document.getElementById('root')
    if (root) { root.style.visibility = 'visible'; root.inert = false; root.removeAttribute('aria-hidden') }
    var intro = document.getElementById('crewnbuild-intro')
    if (intro) {
      fadeTarget = intro
      intro.addEventListener('transitionend', fadeEnded)
      intro.classList.remove('crew-intro-waiting')
      intro.style.opacity = '0'; intro.style.pointerEvents = 'none'; intro.setAttribute('aria-hidden', 'true')
    }
    removalTimer = setTimeout(function () {
      if (root) root.style.removeProperty('visibility')
      release()
    }, reduced.matches ? 0 : 650) // Fallback only; transitionend owns normal removal.
  }
  function check() {
    clearTimeout(finishTimer)
    if (done) return
    var remaining = deadline - performance.now()
    if (remaining > 0) { finishTimer = setTimeout(check, remaining); return }
    // CSS and JS clocks can diverge under load. Never cut off moving
    // artwork just because the nominal wall-clock deadline has elapsed.
    if (sequenceStarted && !artworkSettled && !reduced.matches) {
      if (performance.now() < deadline + 1200) { finishTimer = setTimeout(check, 100); return }
      // Failed animation events must not trap startup indefinitely.
      var stalled = document.getElementById('crewnbuild-intro')
      if (stalled) stalled.classList.add('crew-intro-failed')
      sequenceStarted = false
    }
    if (sequenceStarted && !reduced.matches && !completionRecorded) {
      completionRecorded = true
      try { sessionStorage.setItem(completedKey, 'true') } catch (error) { /* Storage is optional. */ }
    }
    if (ready) dismiss()
    else {
      var intro = document.getElementById('crewnbuild-intro')
      if (intro) intro.classList.add('crew-intro-waiting')
    }
  }
  if (!skip) html.classList.add('crew-intro-active')
  window.__CREWNBUILD_INTRO__ = {
    duration: duration,
    beginSequence: function () {
      if (done || sequenceStarted || reduced.matches || performance.now() > latestAnimationStart) return false
      sequenceStarted = true
      // Allow the small artwork script to arrive without restarting on React mount.
      deadline = Math.min(performance.now() + duration, deadline + 750)
      check()
      return true
    },
    artworkSettled: function () {
      if (done || artworkSettled || !sequenceStarted) return
      artworkSettled = true
      deadline = Math.max(deadline, performance.now() + 300)
      check()
    },
    appReady: function () { ready = true; check() }
  }
  document.addEventListener('DOMContentLoaded', function () {
    if (done) { release(); return }
    var root = document.getElementById('root')
    if (root) { root.inert = true; root.setAttribute('aria-hidden', 'true') }
  }, { once: true })
  safetyTimer = setTimeout(function () {
    if (done) return
    if (ready) { dismiss(); return }
    // A broken/slow app must show a usable recovery state, not an endless animation.
    var intro = document.getElementById('crewnbuild-intro')
    if (intro) {
      intro.classList.add('crew-intro-failed')
      var recovery = intro.querySelector('.crew-intro-recovery')
      if (recovery) recovery.style.display = 'block'
    }
  }, 9000)
  function motionChanged(event) {
    if (event.matches) { deadline = performance.now(); check() }
  }
  reduced.addEventListener('change', motionChanged)
  check()
  window.addEventListener('pageshow', function (event) {
    if (event.persisted) { done = true; clearTimeout(removalTimer); release() }
  })
  // Preserve existing plain links. Only a matching, immediate same-tab
  // document navigation can skip; refreshes and direct visits cannot.
  document.addEventListener('click', function (event) {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    var link = event.target.closest && event.target.closest('a[href]')
    if (!link || link.hasAttribute('download') || (link.target && link.target !== '_self')) return
    var url = new URL(link.href, location.href)
    if (url.origin !== location.origin || !/^https?:$/.test(url.protocol)) return
    if (url.pathname === location.pathname && url.search === location.search) return
    try { sessionStorage.setItem(key, JSON.stringify({ url: url.href, at: Date.now() })) } catch (error) { /* noop */ }
  })
})()
