/* page: the browser page, as a module. The modules that draw take
 * `document`, `window` and the browser's screen functions from here (their
 * deps.js), never from the globals; a module that does not list page in its
 * deps has no page (tests/boundaries.mjs checks both). Outside a browser --
 * the Node tests -- each is what the global is then: undefined, or what a
 * test put there before starting the shell. */

export function pageOf(scope = globalThis) {
  return {
    document: scope.document,
    window: scope.window,
    requestAnimationFrame: scope.requestAnimationFrame ? (fn) => scope.requestAnimationFrame(fn) : undefined,
    cancelAnimationFrame: scope.cancelAnimationFrame ? (id) => scope.cancelAnimationFrame(id) : undefined,
    MutationObserver: scope.MutationObserver,
    ResizeObserver: scope.ResizeObserver,
    getComputedStyle: scope.getComputedStyle ? (el, pseudo) => scope.getComputedStyle(el, pseudo) : undefined,
    Element: scope.Element,
    HTMLVideoElement: scope.HTMLVideoElement,
    // CSS.escape for a value put in a selector; where the page is; what the browser offers (the clipboard: shell/clipboard).
    CSS: scope.CSS,
    location: scope.location,
    navigator: scope.navigator,
  };
}
