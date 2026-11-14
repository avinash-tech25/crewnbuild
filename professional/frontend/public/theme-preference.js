// Runs before the app and before first paint.
// 1. Carries the visitor's theme, language and country choice over from the old app's
//    storage names, once, so nobody loses them with the rename. The new name wins if set.
// 2. Applies the saved theme, so the wrong theme never flashes. Light is the default; dark
//    only when the visitor chose it (src/theme/ThemeContext.jsx has the key).
;(function () {
  var CARRIED_OVER = [
    ['octabuild_theme_preference', 'crewnbuild_theme_preference'],
    ['octabuild_language', 'crewnbuild_language'],
    ['octabuild_language_manual', 'crewnbuild_language_manual'],
    ['octabuild_country', 'crewnbuild_country'],
  ]
  try {
    var storage = window.localStorage
    for (var i = 0; i < CARRIED_OVER.length; i += 1) {
      var oldKey = CARRIED_OVER[i][0]
      var newKey = CARRIED_OVER[i][1]
      var oldValue = storage.getItem(oldKey)
      if (oldValue === null) continue
      if (storage.getItem(newKey) === null) storage.setItem(newKey, oldValue)
      storage.removeItem(oldKey)
    }
    if (storage.getItem('crewnbuild_theme_preference') === 'dark') {
      document.documentElement.classList.add('dark')
    }
  } catch (e) {
    /* storage unavailable: light theme, default language */
  }
})()
