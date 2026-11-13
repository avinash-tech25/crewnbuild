// Apply the saved theme before first paint, so the wrong theme never flashes. Light is the
// default; dark only when the visitor chose it (src/theme/ThemeContext.jsx has the key).
;(function () {
  try {
    if (localStorage.getItem('crewnbuild_theme_preference') === 'dark') {
      document.documentElement.classList.add('dark')
    }
  } catch (e) {
    /* storage unavailable: light theme */
  }
})()
