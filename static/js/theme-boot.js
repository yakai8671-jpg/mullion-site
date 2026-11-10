/* Applies the persisted theme and skin before first paint (avoids a flash of
 * the wrong one). Loaded as a plain blocking <script> in <head>, before the
 * stylesheets finish, so a synchronous request is the simplest fix here --
 * it's a single localhost round trip. Also stashes the settings payload on
 * window so the server module (shell/server) does not fetch them again.
 *
 * It also decides where the backend is (__MU_BACKEND__, read by
 * shell/preload): "standalone" -- answered in the page, kept in this browser
 * (shell/server/standalone.js) -- when the address asks for it
 * (?backend=standalone) or when no Mullion server answers (the page put on a
 * web site as plain files); "server" otherwise. Without a server, the theme,
 * skin and language come from what standalone.js left in localStorage. */
(function () {
  var root = document.documentElement;
  function apply(settings, backend) {
    window.__MU_SETTINGS__ = settings;
    window.__MU_BACKEND__ = backend;
    root.dataset.theme = settings.theme || "dark";
    root.dataset.skin = settings.skin || "prompt";
  }
  function standalone() {
    var look = {};
    try {
      look = JSON.parse(localStorage.getItem("mullion.standalone.look") || "{}") || {};
    } catch (e) {
      look = {};
    }
    apply(look, "standalone");
  }
  if (/[?&]backend=standalone(&|$)/.test(location.search)) return standalone();
  try {
    var xhr = new XMLHttpRequest();
    xhr.open("GET", "/api/settings", false);
    xhr.send(null);
    // A Mullion server that cannot open its data answers 503 (problem: true):
    // that is still the server, whose page says why.
    if (xhr.status === 503) return apply({}, "server");
    var settings = xhr.status === 200 ? JSON.parse(xhr.responseText) : null;
    if (!settings || typeof settings !== "object" || Array.isArray(settings)) return standalone();
    apply(settings, "server");
  } catch (e) {
    standalone();
  }
})();
