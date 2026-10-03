// Applies a saved light or dark theme before first paint. Loaded as a
// same-origin script so it satisfies the connected service's CSP.
(function () {
  try {
    var theme = localStorage.getItem('riftwell.theme');
    if (theme === 'light' || theme === 'dark') {
      var root = document.documentElement;
      root.setAttribute('data-theme', theme);
      root.style.colorScheme = theme;
      var meta = document.querySelector('meta[name="theme-color"]');
      if (meta)
        meta.setAttribute('content', theme === 'light' ? '#f2f5f1' : '#080b0a');
    }
  } catch (error) {
    // Storage can be unavailable; the default dark theme remains.
  }
})();
