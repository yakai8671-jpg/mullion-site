/* Mullion -- the plugin loader.
 *
 * Each plugin is a directory under plugins/ with a manifest.json. The
 * server only lists them (backend/handlers/plugins_api.py); the import
 * happens here, in the browser, and each plugin's default export is called
 * with the framework surface.
 *
 * Two properties matter more than the mechanics:
 *
 *   Failures are isolated. A plugin that throws on import or registration
 *   is recorded and skipped -- the shell still starts, because a broken
 *   plugin must not cost you the layout you had open.
 *
 *   The manifest is binding, in both directions. A plugin may only register
 *   what its `provides` names, and its types may only ask for permissions it
 *   declared -- so the manifest is an auditable statement of what a plugin
 *   brings and what it can reach, rather than documentation nobody enforces.
 *
 *   Dependencies are explicit. `requires` names other plugins, and one whose
 *   dependencies did not load is skipped with a reason instead of leaving
 *   half-broken types in the registry.
 */

import { ACTIONS, CONTROLS, ITEM_TYPES, ITEM_FACTORIES, PERMISSIONS, SKINS, VALUE_TYPES, bindSpec, describe, describeProperty, registerAction, registerControl, registerItemType, registerItemFactory, registerApp, registerSkin, registerPermission, registerValueType, registerTranslations, setRegistrationSource, unexplainedControls, paramNames, addStylesheet, fetchJSON, grantApi, qs } from "./deps.js";
import { core } from "./deps.js";
import { controlCardHead as buildCardHead, buildSideCard, cardBar, cardBarRow, cardPortOf, syncCardHead } from "./deps.js";
import { propertyGroupOf as groupOf, groupingOf, groupsIn } from "./deps.js";
import { API_VERSIONS, buildPlugin } from "./deps.js";

// What was loaded, what failed, and why. The catalog reads this.
export const loadedPlugins = [];


// What of `core` a plugin does not have. Working across items is the user's: a
// drag or a click makes a paste, a link, a share or a connection, and an item is
// given what that reaches through its own `api` (`api.items`, `api.apps`,
// `api.props`), never through `core` -- so those calls are the shell's, and no
// manifest can declare "shell" (a permission is `namespace:verb`). The rest of
// `core` is the engine's vocabulary (nodes, text, the registry) and is open. Not
// a sandbox -- a plugin runs in this page and could import any module by URL
// (the code is read for that, see backend/handlers/plugin_scan.py) -- but the
// honest path is the checked one, and a call says what is wrong with it.
const GUARDED = {
  putLink: "shell",
  unlinkApp: "shell",
  linkPort: "shell",
  unlinkPort: "shell",
  pastePort: "shell",
  sharePort: "shell",
  movePort: "shell",
  canShare: "shell",
  sharedFrom: "shell",
  linkSource: "shell",
  portInfo: "shell",
  portValue: "shell",
  pickPort: "shell",
  sharedInfo: "shell",
  pickShare: "shell",
  pickProperty: "shell",
  appSurface: "shell",
  pressApp: "shell",
  setAppInput: "shell",
  readAppOutput: "shell",
  // The items themselves: a plugin sees the item it is given and what its api
  // reaches, not the layout's items by id.
  getItem: "shell",
  bindProperty: "shell",
  createItem: "shell",
  mountedItems: "shell",
  state: "shell",
};

// What a plugin may take from `core`, by name: the engine's vocabulary (nodes,
// text, icons, the registry's helpers, how a card is drawn and a port is carried)
// and the few ways an item is told to draw again. Everything else in `core` is the
// shell's -- the layout, the items by id, the links and the profile -- and is
// refused, so a new function the shell exports is not open to plugins until it is
// listed here.
const OPEN = new Set([
  "NODES", "t", "row", "ICONS", "ACCENT_SETTING", "store",
  "refreshAll", "refreshItems", "syncLinks",
  "fitCardHead", "listCard", "hintButton", "paintStatusRow", "foldIcon", "foldedLists", "foldChanged",
  "cardIsShrunk", "setCardShrunk", "setCardSizeClass", "animateCardResize",
  "attachPort", "attachSink", "makePortBadge", "syncPortBadge", "portLink", "portKey", "portConvert", "registerPortConversion", "kindNodes", "registerExplainer",
  "openValuePicker", "setPresetOpener", "itemProperties", "askNear",
  "typeSettingValue", "setTypeSetting", "appSettingValue", "runText", "onRunText",
]);

export function coreFor(manifest) {
  const declared = new Set(manifest.permissions || []);
  const refused = new Map();
  return new Proxy(core, {
    get(target, name) {
      if (typeof name !== "string" || !(name in target)) return target[name];
      const need = GUARDED[name];
      if (!need && OPEN.has(name)) return target[name];
      if (need && declared.has(need)) return target[name];
      if (!refused.has(name)) {
        refused.set(name, () => {
          throw new Error(
            !need
              ? `${manifest.id} uses core.${name}, which the shell keeps for itself`
              : need === "shell"
                ? `${manifest.id} uses core.${name}, which is the shell's: work on what the user connected or shared to the item, through its api (api.items, api.apps, api.props)`
                : `${manifest.id} uses core.${name}, which needs "${need}" in its manifest`
          );
        });
      }
      return refused.get(name);
    },
  });
}

// The surface a plugin is handed. Registration is scoped to the plugin, so
// what it registers is attributed to it and checked against its manifest.
// A plugin's file, from where this module is (static/js/mullion/shell/plugins/),
// so the site works at / and under a path (GitHub Pages: /<repo>/).
const PLUGINS_ROOT = new URL("../../../../../plugins/", import.meta.url);
const pluginFile = (id, file) => new URL(`${id}/${file}`, PLUGINS_ROOT).href;

function surfaceFor(manifest) {
  const declared = new Set(manifest.permissions || []);
  const provides = manifest.provides || {};

  // Registering something the manifest does not list is refused: what a
  // plugin brings has to be readable from the manifest alone.
  const guard = (kind, register) => (name, ...rest) => {
    if (!(provides[kind] || []).includes(name)) {
      throw new Error(`${manifest.id} registers ${name}, which its provides.${kind} does not list`);
    }
    return register(name, ...rest);
  };

  // The plugin's own routes on the server (/api/<id>/...), through the server
  // module: a plugin never names an address outside its own, and never calls
  // fetch for /api/ itself (tests/boundaries.mjs).
  const own = `/api/${manifest.id}/`;
  const route = (path, params) => {
    const rel = String(path).replace(/^\/+/, "");
    if (!rel || rel.startsWith("..") || rel.includes("/../")) throw new Error(`${manifest.id}: bad backend path ${JSON.stringify(path)}`);
    const query = params && Object.keys(params).length ? `?${qs(params)}` : "";
    return own + rel + query;
  };
  const backend = Object.freeze({
    // fetchJSON("discussion", { query: { id } }) or fetchJSON("discussion", { body }) (POST).
    fetchJSON: (path, { query, body, method, signal } = {}) =>
      fetchJSON(route(path, query), body === undefined ? { method, signal } : { method: method || "POST", body, signal }),
    address: (path, query) => route(path, query),
  });

  return {
    manifest,
    backend,
    // A permission this plugin declares, without an item: for what is the
    // same for every item (an output's address, say) and is needed where no
    // item is at hand. Only the plugin's own declared permissions.
    granted(permission) {
      if (!declared.has(permission)) throw new Error(`${manifest.id} asks for "${permission}", which its manifest does not declare`);
      return grantApi({ permissions: [permission] }, { windowId: null, itemId: null })[permission.split(":")[0]];
    },
    registerTranslations,
    registerValueType: guard("valueTypes", registerValueType),
    registerControl: guard("controls", registerControl),
    registerAction: guard("actions", registerAction),
    registerSkin: guard("skins", registerSkin),
    registerPermission: guard("permissions", registerPermission),
    registerItemFactory: guard("itemFactories", (name, build) => {
      if (!name.startsWith(`${manifest.id}.`)) throw new Error(`item factory "${name}" must use its plugin namespace`);
      return registerItemFactory(name, build);
    }),
    registerItemType: guard("itemTypes", (name, def) => {
      for (const permission of def.permissions || []) {
        if (!declared.has(permission)) {
          throw new Error(
            `item type "${name}" wants "${permission}", which ${manifest.id} does not declare`
          );
        }
      }
      return registerItemType(name, def);
    }),
    // The app of an item type this plugin brings (see registry.registerApp).
    registerApp: guard("itemTypes", registerApp),
    // The engine, for the parts a plugin legitimately needs: node helpers,
    // translation, and the item/property vocabulary. What reaches across items
    // is behind a permission (see coreFor).
    core: coreFor(manifest),
    // How a value becomes something a control can draw. A plugin that
    // brings a composite type of its own needs this to render the fields
    // inside it -- the same way the rows control renders a list's elements.
    // Read its two rules first: a spec built on the fly has to read live
    // and be keyed by what it points at.
    describe,
    describeProperty,
    bindSpec,
    types: ITEM_TYPES,
    valueTypes: VALUE_TYPES,
    controls: CONTROLS,
    actions: ACTIONS,
    // The names of the arguments a control takes (its `params`, a list or a table).
    paramNames,
    // How a value type divides its own values. A plugin that declares
    // `groups` on a type needs these to read them back, so it can build the
    // same kind of screen over them that the shell builds.
    grouping: { groupOf, groupsIn, groupingOf },
    // The header every shell card has, for a plugin card to be built from
    // rather than copy: buildHead(prefix, {lead, tools, onDiscard}) makes it
    // (grip, label, link badge, your buttons, shrink, remove -- in that
    // order), syncHead(host, parts, {port, name, onDiscard, size}) says
    // what it shows now, and portOf(desc) is where its grip takes the card
    // from. `prefix` names the card's classes (`mu-imagecard` is the shell's
    // own frame and needs no CSS of yours). buildSide(prefix) makes a card with
    // a vertical header -- {card, head, grip, body}: fill `body`, and say what
    // the grip carries with core.attachPort(card, grip, port). bar(card) is the card's bar
    // under the header, and barRow(card, key, {thirds}) one row of it --
    // rows stack, as the item's bar does.
    card: { buildHead: buildCardHead, buildSide: buildSideCard, bar: cardBar, barRow: cardBarRow, syncHead: syncCardHead, portOf: cardPortOf },
  };
}

// `onProgress(done, total)` is told how many of the plugins that are to load have been
// tried: once the list is known (none yet), and after each one.
export async function loadPlugins(onProgress = () => {}) {
  let listing = { plugins: [], problems: [] };
  try {
    listing = await fetchJSON("/api/plugins");
  } catch (error) {
    console.error("[mullion] could not list plugins:", error.message || error);
    return loadedPlugins;
  }

  listing.problems.forEach((problem) => {
    loadedPlugins.push({ id: problem.id, status: "invalid", error: problem.error });
    console.error(`[mullion] plugin ${problem.id}: ${problem.error}`);
  });

  // Load whatever is satisfied, then go round again: a plugin only loads
  // once the plugins it requires actually loaded. Whatever is still waiting
  // after a pass that changed nothing has an unmet (or circular) dependency.
  // What this profile does not use is not loaded, and says why (see plugins_api).
  listing.plugins
    .filter((manifest) => manifest.enabled === false)
    .forEach((manifest) => {
      const off = manifest.off || {};
      loadedPlugins.push({
        id: manifest.id,
        status: "disabled",
        error: off.chosen ? "" : `requires ${(off.because || []).join(", ")}, which is off`,
        manifest,
      });
    });
  const done = new Set();
  let waiting = listing.plugins.filter((manifest) => manifest.enabled !== false);
  const total = waiting.length;
  onProgress(0, total);
  let progress = true;

  while (waiting.length && progress) {
    progress = false;
    const next = [];
    for (const manifest of waiting) {
      const missing = (manifest.requires || []).filter((id) => !done.has(id));
      if (missing.length) {
        next.push(manifest);
        continue;
      }
      await loadOne(manifest);
      done.add(manifest.id);
      onProgress(done.size, total);
      progress = true;
    }
    waiting = next;
  }

  waiting.forEach((manifest) => {
    const missing = (manifest.requires || []).filter((id) => !done.has(id));
    loadedPlugins.push({
      id: manifest.id,
      status: "unmet",
      error: `requires ${missing.join(", ")}`,
      manifest,
    });
    console.error(`[mullion] plugin ${manifest.id} needs ${missing.join(", ")}`);
  });

  // The controls plugins drew for themselves, one line: each should either
  // be a shell card (see the audio, image and text cards) or say why not.
  const own = Object.entries(unexplainedControls());
  if (own.length) {
    const total = own.reduce((sum, [, names]) => sum + names.length, 0);
    console.warn(
      `[mullion] ${total} controls of plugins' own say nothing about why the shell's cards would not do (give the control a \`why\`): ` +
        own.map(([id, names]) => `${id} (${names.join(", ")})`).join("; ")
    );
  }

  return loadedPlugins;
}

async function loadOne(manifest) {
  try {
    (manifest.styles || []).forEach((style) => addStylesheet(pluginFile(manifest.id, style)));
    if (!API_VERSIONS.includes(manifest.api)) throw new Error(`api ${manifest.api} is not one this shell reads`);
    setRegistrationSource(manifest.id);
    await buildPlugin(manifest, surfaceFor(manifest), {
      controls: CONTROLS, valueTypes: VALUE_TYPES, actions: ACTIONS, NODES: core.NODES, t: core.t,
      itemProperties: core.itemProperties, portConvert: core.portConvert, canConvertPort: core.canConvertPort,
      HOTKEY_ACTIONS: core.HOTKEY_ACTIONS, listView: core.listView, setListView: core.setListView, drawSerial: core.currentDrawSerial,
      runAction: core.runAction, cancelAction: core.cancelAction, actionStatus: core.actionStatus, refreshAll: core.refreshAll,
      importScript: (file) => import(pluginFile(manifest.id, file)),
    });
    // What the manifest lists is what the plugin brings: listed and not
    // registered is as wrong as registered and not listed (the surface
    // refuses that one already).
    const provided = [
      ["itemTypes", ITEM_TYPES],
      ["valueTypes", VALUE_TYPES],
      ["controls", CONTROLS],
      ["actions", ACTIONS],
      ["permissions", PERMISSIONS],
      ["skins", SKINS],
    ].flatMap(([kind, table]) => ((manifest.provides || {})[kind] || []).filter((name) => !(name in table)).map((name) => `${kind} ${name}`));
    for (const name of manifest.provides?.itemFactories || []) {
      if (ITEM_FACTORIES.get(name)?.source !== manifest.id) provided.push(`itemFactories ${name}`);
    }
    if (provided.length) throw new Error(`its manifest lists what it did not register: ${provided.join(", ")}`);
    loadedPlugins.push({ id: manifest.id, status: "loaded", manifest });
  } catch (error) {
    loadedPlugins.push({ id: manifest.id, status: "failed", error: error.message || String(error) });
    console.error(`[mullion] plugin ${manifest.id} failed:`, error);
  } finally {
    setRegistrationSource(null);
  }
}
