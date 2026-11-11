/* preload: what the page's classic scripts left before any module ran.
 * theme-boot.js reads the profile before the first paint (so the theme does
 * not flash) and leaves it as __MU_SETTINGS__, with where the backend is
 * (__MU_BACKEND__: "server", or "standalone" for the one in the page); static/js/i18n.js is the
 * translation table, a classic script because the loading screen speaks
 * before the modules load (BW_LANGUAGES, BW_TRANSLATIONS). This module is the
 * one place that reads those names (tests/boundaries.mjs checks it); server
 * and i18n take them from here through their deps, so a test or the wiki's
 * playground can hand in its own.
 *
 * Each is read when called, not at setup: a Node test may put the tables on
 * globalThis after the shell started (tests/kit/translations.mjs). */

export function preloadOf(scope = globalThis) {
  return {
    /** The profile the page read before the first paint, or {} when it could not. */
    preloadedSettings: () => scope.__MU_SETTINGS__ || {},
    /** "standalone" when the page runs without the Mullion server (server/standalone.js), else "server". */
    preloadedBackend: () => (scope.__MU_BACKEND__ === "standalone" ? "standalone" : "server"),
    /** problem.js's restart button maker, (section, labels) => void, or null without it. */
    preloadedProblemRestart: () => (typeof scope.muProblemRestart === "function" ? scope.muProblemRestart : null),
    /** The languages one can choose, [{ value, label }], or null without the table. */
    preloadedLanguages: () => scope.BW_LANGUAGES || null,
    /** The page's translation tables by language, or null without the table. */
    preloadedTranslations: () => scope.BW_TRANSLATIONS || null,
  };
}
