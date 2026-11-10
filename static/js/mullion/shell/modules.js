import { createBridge } from "./bridge.js";
/* Every core module, for boot and tests: [module.json, index.js default].
 * The only file besides the modules' own that imports a module's files, and,
 * with startShell, the only one that starts them. */
import pageMeta from "./page/module.json" with { type: "json" };
import page from "./page/index.js";
import preloadMeta from "./preload/module.json" with { type: "json" };
import preload from "./preload/index.js";
import serverMeta from "./server/module.json" with { type: "json" };
import server from "./server/index.js";
import i18nMeta from "./i18n/module.json" with { type: "json" };
import i18n from "./i18n/index.js";
import grantsMeta from "./grants/module.json" with { type: "json" };
import grants from "./grants/index.js";
import mediaMeta from "./media/module.json" with { type: "json" };
import media from "./media/index.js";
import historyMeta from "./history/module.json" with { type: "json" };
import history from "./history/index.js";
import libraryMeta from "./library/module.json" with { type: "json" };
import library from "./library/index.js";
import registryMeta from "./registry/module.json" with { type: "json" };
import registry from "./registry/index.js";
import itemsMeta from "./items/module.json" with { type: "json" };
import items from "./items/index.js";
import layoutMeta from "./layout/module.json" with { type: "json" };
import layout from "./layout/index.js";
import portsMeta from "./ports/module.json" with { type: "json" };
import ports from "./ports/index.js";
import viewMeta from "./view/module.json" with { type: "json" };
import view from "./view/index.js";
import baysMeta from "./bays/module.json" with { type: "json" };
import bays from "./bays/index.js";
import appsMeta from "./apps/module.json" with { type: "json" };
import apps from "./apps/index.js";
import homeMeta from "./home/module.json" with { type: "json" };
import home from "./home/index.js";
import operationsMeta from "./operations/module.json" with { type: "json" };
import operations from "./operations/index.js";
import pickersMeta from "./pickers/module.json" with { type: "json" };
import pickers from "./pickers/index.js";
import hotkeysMeta from "./hotkeys/module.json" with { type: "json" };
import hotkeys from "./hotkeys/index.js";
import framesMeta from "./frames/module.json" with { type: "json" };
import frames from "./frames/index.js";
import mountMeta from "./mount/module.json" with { type: "json" };
import mount from "./mount/index.js";
import propertiesMeta from "./properties/module.json" with { type: "json" };
import properties from "./properties/index.js";
import controlsMeta from "./controls/module.json" with { type: "json" };
import controls from "./controls/index.js";
import pluginsMeta from "./plugins/module.json" with { type: "json" };
import plugins from "./plugins/index.js";
import permissionsMeta from "./permissions/module.json" with { type: "json" };
import permissions from "./permissions/index.js";
import builtinsMeta from "./builtins/module.json" with { type: "json" };
import builtins from "./builtins/index.js";
import bootMeta from "./boot/module.json" with { type: "json" };
import boot from "./boot/index.js";
import buildMeta from "./build/module.json" with { type: "json" };
import build from "./build/index.js";

export const MODULES = [
  [pageMeta, page],
  [preloadMeta, preload],
  [serverMeta, server],
  [i18nMeta, i18n],
  [grantsMeta, grants],
  [mediaMeta, media],
  [historyMeta, history],
  [libraryMeta, library],
  [registryMeta, registry],
  [buildMeta, build],
  [itemsMeta, items],
  [layoutMeta, layout],
  [portsMeta, ports],
  [viewMeta, view],
  [baysMeta, bays],
  [appsMeta, apps],
  [homeMeta, home],
  [operationsMeta, operations],
  [pickersMeta, pickers],
  [hotkeysMeta, hotkeys],
  [framesMeta, frames],
  [mountMeta, mount],
  [propertiesMeta, properties],
  [controlsMeta, controls],
  [pluginsMeta, plugins],
  [permissionsMeta, permissions],
  [builtinsMeta, builtins],
  [bootMeta, boot],
];

// The shell started: every module set up through the bridge, in the order of
// their deps. `api` by module; `core`, every module's surface in one object,
// for the page's console (window.Mullion.core), the tests and a plugin's core.
// Where two modules use one name, the first in MODULES keeps it, and the
// other is there under a name of its own (ALIASES).
const ALIASES = { properties: { groupOf: "propertyGroupOf" }, controls: { buildCardHead: "controlCardHead" } };

export function startShell() {
  const bridge = createBridge();
  for (const [meta, impl] of MODULES) bridge.register(meta, impl);
  const api = bridge.start();
  const core = {};
  for (const [meta] of MODULES) {
    const surface = api[meta.name] || {};
    for (const [name, value] of Object.entries(surface)) {
      const as = (ALIASES[meta.name] && ALIASES[meta.name][name]) || name;
      if (!(as in core)) core[as] = value;
    }
  }
  return { api, core };
}
