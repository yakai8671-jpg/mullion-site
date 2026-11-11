/* Mullion -- startup.
 *
 * Registration order matters: value types and permissions have to exist
 * before an item type that declares them can be validated. Plugins load
 * after the core registrations, ahead of the first render (step 04).
 */

import { startShell } from "./shell/modules.js";

// The shell: every module started through the bridge (shell/modules.js). `core`
// is all of their surfaces in one object; boot's own (init, the startup
// problems, the profile on the address) are in it too.
const { core } = startShell();
const library = core;
const properties = { ...core, groupOf: core.propertyGroupOf };
const registry = core;
const { init, showProblemPage, startupProblems, followProfileQuery, loadPlugins, loadedPlugins, loadLibrary, watchLibrary } = core;

// The framework surface, in one place. This is what step 04 will hand to a
// plugin module, and what a console has to poke at a running shell.
window.Mullion = {
  // Every module's surface (shell/modules.js startShell), for the console and the browser tests.
  core,
  registerItemType: registry.registerItemType,
  registerApp: registry.registerApp,
  registerValueType: registry.registerValueType,
  registerControl: registry.registerControl,
  registerPermission: registry.registerPermission,
  registerSkin: registry.registerSkin,
  registerTranslations: registry.registerTranslations,
  validateRegistry: registry.validateRegistry,
  grantApi: registry.grantApi,
  types: registry.ITEM_TYPES,
  valueTypes: registry.VALUE_TYPES,
  controls: registry.CONTROLS,
  permissions: registry.PERMISSIONS,
  skins: registry.SKINS,
  library,
  core,
  // How a value type divides its own values. A plugin that declares
  // `groups` on a type needs these to read them back -- the picker's filter
  // and the library's listing use nothing else, so a plugin can build the
  // same screens the shell builds.
  grouping: { groupOf: properties.groupOf, groupsIn: properties.groupsIn, groupingOf: properties.groupingOf },
};

// What is on the screen while this runs (templates/index.html): how far the start has
// got. Without it -- a page that does not have it -- nothing is reported.
const loading = window.__muLoading || { step() {}, fail() {}, finish() {} };
// Every module above has been fetched and run by the time this one does.
loading.step(30, "mu.loading.library");

// `?profile=` on the address: the profile this page is for. First of all -- the library read
// next is the profile's -- and when the server has to be started again for it, nothing after
// this runs: the page is read again.
await followProfileQuery(loading);

// The library is cached in memory because reading a property is
// synchronous, so it has to be there before the first body() runs.
watchLibrary(() => core.refreshAll());
await loadLibrary();
loading.step(40, "mu.loading.list");

// Plugins register after the core types and before anything is validated or
// drawn, so a layout that names a plugin's type finds it on the first render.
// The plugins are most of the wait, so they are most of the bar: 45 to 90.
await loadPlugins((done, total) => loading.step(45 + (total ? (45 * done) / total : 45), "mu.loading.plugins", { done, total }));
window.Mullion.plugins = loadedPlugins;
loading.step(92, "mu.loading.layout");

// Cross-type references are resolved only once everything is registered --
// and everything has to match the current spec before a layout is opened:
// a plugin that did not load, or that declares what the registry cannot hold
// together, stops the shell here, with the reasons on screen (see startup.js).
const problems = startupProblems(loadedPlugins);
window.Mullion.startupProblems = problems;
if (problems.length) {
  problems.forEach((one) => console.error(`[mullion] ${one.source}: ${one.message}`));
  core.halt();
  const show = () => showProblemPage(problems);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", show);
  else show();
} else {
  // What breaks the spec only once it is drawn -- an entry that only some
  // data has -- stops the shell the same way, with the same page.
  core.onDesignProblem((found) => {
    core.halt();
    window.Mullion.startupProblems = found;
    showProblemPage(found);
  });
  // The screen goes once the first layout is drawn; if drawing it fails, it says so.
  const start = () => init().then(loading.finish, (error) => {
    loading.fail();
    throw error;
  });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
  // What needs the server where there is none (plugins.loadPlugins): once, on screen.
  const unavailable = loadedPlugins.filter((one) => one.status === "unavailable");
  if (unavailable.length) {
    core.toast(core.t("mu.startup.unavailable", { n: unavailable.length, names: unavailable.map((one) => (one.manifest && one.manifest.name) || one.id).join(", ") }), { ms: 12000 });
  }
}
