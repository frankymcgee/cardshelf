// Blocking, same-origin head script: apply the saved preference before first paint.
// No account data, cookies, credentials or network calls are involved.
(function () {
  var mode = 'system';
  try {
    var saved = window.localStorage.getItem('cardshelf.theme');
    if (saved === 'light' || saved === 'dark') mode = saved;
  } catch (_) { /* Storage may be unavailable in private/restricted browsers. */ }
  var dark = mode === 'dark';
  if (mode === 'system') {
    try { dark = window.matchMedia('(prefers-color-scheme: dark)').matches; }
    catch (_) { dark = false; }
  }
  var root = document.documentElement;
  root.dataset.theme = dark ? 'dark' : 'light';
  root.dataset.themeMode = mode;
  root.style.colorScheme = dark ? 'dark' : 'light';
}());
