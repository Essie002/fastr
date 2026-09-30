/*
 * Applies the saved theme before the app loads. Requirement 14.2.
 *
 * Runs synchronously from <head>, so the first paint is already the right colour. React reconciles
 * this with the theme stored on the profile once it has one, which may differ if the user changed it
 * on another device; that correction is a one-off after sign-in rather than on every load.
 *
 * Deliberately plain, dependency-free, and duplicated in spirit by src/theme/theme.ts. The storage
 * key and the resolution rule are asserted identical by src/theme/themeBoot.test.ts, because two
 * copies of a rule with nothing checking them is how a theme ends up flashing again six months from
 * now.
 */
(function () {
  var STORAGE_KEY = 'fastr.theme';

  var stored = null;
  try {
    stored = localStorage.getItem(STORAGE_KEY);
  } catch {
    // Safari in private mode throws on localStorage. Falling back to the system preference is
    // better than failing to paint.
  }

  var choice = stored === 'light' || stored === 'dark' || stored === 'system' ? stored : 'system';

  var resolved =
    choice === 'system'
      ? window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light'
      : choice;

  document.documentElement.setAttribute('data-theme', resolved);

  // Keep the phone's status bar in step with the app, or a dark app sits under a light bar.
  var meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', resolved === 'dark' ? '#111312' : '#f7f7f5');
})();
