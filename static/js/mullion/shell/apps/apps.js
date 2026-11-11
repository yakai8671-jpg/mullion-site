/* apps: moved out of core.js (docs/wiki/migration.md). */
import { APPS, DEFAULT_ITEM_TYPE, ITEM_TYPES, MAX_NESTING, ROOT_DEFAULT_ITEM, ROOT_ID, SKINS, addBayRecord, allBays, allLinks, bayRecord, bindProperty, canLink, canShare, commit, contentNode, createGroupNode, createItem, createWindowNode, currentItemId, defaultFor, deleteValue, derivesFrom, dropLinksAmong, eachGroup, eachLeaf, eachStashedGroup, eachStashedLeaf, findLeaf, getItem, groupContent, groupOf, isContainer, isPlainObject, isSlotLeaf, isStandalone, knownType, layoutRoot, leafIds, newWindowId, nextBayId, oneWindowLayout, placeLink, portAddress, removeWindow, saveValue, savedOfType, savedValue, screensOf, singleLayout, slotOnly, t, takeContent, settings, languages } from "./deps.js";
import { LAUNCH_KEY, captureFrameLayout, launchNode, launchSpecValid, toArrangement } from "./launch.js";
import { AUTO_LAYOUT_KEY, linkSlotsOf, linkedIds } from "./links.js";

// What apps asks of others (registerAppsHook):
//   coerceHotkeys(value)  -- an app value's hotkeys made whole (hotkeys)
//   workingFrame()        -- the app frame being worked in, by the focus (frames)
//   ready()               -- whether a layout has been adopted yet (operations)
// and what it says: { redraw: "all" | "items" } after an app, its
// links or a setting changed, { settings } after app settings were written
// (the language may have changed), as its event "change".
const appsHooks = {
  coerceHotkeys: (value) => value,
  workingFrame: () => null,
  ready: () => false,
};

function registerAppsHook(kind, fn) {
  appsHooks[kind] = fn;
}

let appsChanged = () => {};
// For the other files of apps (launch.js, links.js): appsChanged is set when apps connects.
const announceAppsChange = (change) => appsChanged(change);
export function connectEvents(emit) {
  appsChanged = (change) => emit("change", change);
}

// Settings that belong to the whole shell rather than to one item:
// they live in the server-side profile (/api/settings), so they are shared
// by every tab and survive a restart. Everything reachable through the
// app:* permissions is declared here -- an item cannot touch a profile key
// that is not in this table.
const THEMES = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "solarized", label: "Solarized" },
  { value: "nord", label: "Nord" },
  { value: "prompt", label: "Prompt Violet" },
];

const APP_SETTINGS = {
  theme: {
    label: "mu.prop.theme",
    type: "enum",
    default: "dark",
    // One per palette in the stylesheets.
    options: () => THEMES,
  },
  skin: {
    label: "mu.prop.skin",
    type: "enum",
    default: "prompt",
    // Shape and density, independent of the palette above: any skin works
    // with any theme, because one sets colours and the other does not.
    options: () =>
      Object.values(SKINS).map((skin) => ({ value: skin.name, label: t(skin.label) })),
  },
  language: {
    label: "mu.prop.language",
    type: "enum",
    default: "en",
    // One source for the list: i18n.js, whose labels are endonyms and so
    // are the same in every language.
    options: () => languages(),
  },
  // Where the servers a workflow runs on are. The relay reads these from the
  // profile rather than taking a destination from whoever asks.
  comfyuiUrl: {
    label: "mu.prop.comfyuiUrl",
    type: "string",
    default: "http://127.0.0.1:8188",
  },
  ollamaUrl: {
    label: "mu.prop.ollamaUrl",
    type: "string",
    default: "http://127.0.0.1:11434",
  },
  // The voice engines (plugins/speech), relayed the same way.
  voicevoxUrl: {
    label: "mu.prop.voicevoxUrl",
    type: "string",
    default: "http://127.0.0.1:50021",
  },
  irodoriUrl: {
    label: "mu.prop.irodoriUrl",
    type: "string",
    default: "http://127.0.0.1:8081",
  },
  // How long folding, opening and sliding a bay's sash take; 0 is none.
  motionMs: {
    label: "mu.prop.motionMs",
    type: "number",
    default: 200,
    min: 0,
    max: 2000,
  },
  // The run history (plugins/workflow keeps it; whether and how much is the shell's to say).
  historyEnabled: {
    label: "mu.prop.historyEnabled",
    type: "boolean",
    default: true,
  },
  historyMax: {
    label: "mu.prop.historyMax",
    type: "number",
    default: 500,
    min: 1,
    max: 5000,
    step: 1,
  },
};

// The layout's tree. The items are the items module's (allItems).





// The layout's own: a window's path, a frame's screens, and an app's frame,
// which holds the app whether or not its dashboard is one of the windows on
// screen (closing the dashboard is not closing the app).

// For a window landing beside `id`: what the nearest group around it asks.
function defaultItemFor(id) {
  let group = groupOf(id);
  for (let depth = 0; group && depth <= MAX_NESTING; depth += 1) {
    if (knownType(group.defaultItem)) return group.defaultItem;
    group = groupOf(group.id);
  }
  return knownType(ROOT_DEFAULT_ITEM) || DEFAULT_ITEM_TYPE;
}

// For a window landing inside `group` itself.
function defaultItemIn(group) {
  return knownType(group.defaultItem) || defaultItemFor(group.id);
}

// A group launched as an app is that app -- not that kind of app, that one.
// `appItem` is the instance it was launched for, so a window split off
// inside it shows the same dashboard rather than minting a second app with
// an id of its own and none of the first one's windows. Answered only while
// the instance is still there and still the type the group asks for.
function appItemOf(group) {
  if (!group || !group.appItem) return null;
  const item = getItem(group.appItem);
  return item && item.type === knownType(group.defaultItem) ? item.id : null;
}

// The group whose default decides a new window beside `id`.
function decidingGroupFor(id) {
  let group = groupOf(id);
  for (let depth = 0; group && depth <= MAX_NESTING; depth += 1) {
    if (knownType(group.defaultItem)) return group;
    group = groupOf(group.id);
  }
  return null;
}

// A new window's leaf, for a default taken from `group`: the app's own
// instance when the group is an app, a fresh item of the type otherwise.
function defaultLeafFrom(group, type) {
  const own = group && group.defaultItem === type ? appItemOf(group) : null;
  return own ? { type: "leaf", id: newWindowId(), path: [own] } : createWindowNode(null, type);
}

// A new window beside `id`, or inside the group `id` names.
function defaultLeafBeside(id) {
  return defaultLeafFrom(decidingGroupFor(id), defaultItemFor(id));
}

function defaultLeafIn(group) {
  return knownType(group.defaultItem) ? defaultLeafFrom(group, group.defaultItem) : defaultLeafBeside(group.id);
}

// null clears it, and the group goes back to deferring outward. A name no
// type answers to is refused rather than stored: a stale one read from a
// file is kept (its plugin may come back), but nobody should be able to
// choose one.
function setGroupDefault(groupId, type) {
  const group = findLeaf(groupId);
  if (!group || group.type !== "group") return false;
  if (type === null || type === undefined || type === "") delete group.defaultItem;
  else if (knownType(type)) group.defaultItem = type;
  else throw new Error(`unknown item type: ${type}`);
  commit();
  return true;
}



// ---- launching ----------------------------------------------------------
// Opening a type on its own -- from a dashboard, a split, the API -- gives
// one window, unless its app says it arrives as more than that. An app is a
// preset of windows and an item, so it is registered apart from the type
// (`registerApp`, registry.js); its `layout` is a content spec for a group,
// where "self" is the instance being opened and { owned: key } is the item it
// holds in that property:
//
//   registerApp("t2i.app", {
//     layout: { dir: "row", ratio: 0.6, children: [{ owned: "preview" }, "self"] },
//     defaultItem: "t2i.app",
//   })
//
// Owned rather than made alongside, so the pieces are one instance's --
// the preview is *that* runner's preview, and goes when it goes.
//
// `props` are values for the new instance's own properties, set through
// the property's accessor so they are coerced as any edit would be. That is
// how a shortcut opens a tool already loaded -- a runner with a template in
// it -- rather than opening it empty and leaving the loading to the person.
// ---- settings that belong to a type, not an instance ---------------------
// Some of what an app is set to is about the app rather than the window it
// is in -- its colour, how much history it keeps. An instance is made fresh
// every time the app is opened, so kept on the instance those would be gone
// the moment the app was closed. They are kept in the profile instead, per
// type, and a property reads them through `read`/`write` like any other
// property that lives elsewhere.
//
// Flat values per type, so the profile's key-by-key merge is exactly right:
// setting one leaves the others alone.
const TYPE_SETTINGS_KEY = "typeSettings";

function typeSettingValue(type, key, fallback) {
  const all = settings.get(TYPE_SETTINGS_KEY, {}) || {};
  const mine = all[type];
  return mine && Object.prototype.hasOwnProperty.call(mine, key) ? mine[key] : fallback;
}

function setTypeSetting(type, key, value) {
  if (!ITEM_TYPES[type]) throw new Error(`unknown item type: ${type}`);
  // Into the cache first, so the redraw that follows this write already
  // reads the new value instead of waiting for the server to answer.
  const cache = settings.cache;
  cache[TYPE_SETTINGS_KEY] = { ...(cache[TYPE_SETTINGS_KEY] || {}) };
  cache[TYPE_SETTINGS_KEY][type] = { ...(cache[TYPE_SETTINGS_KEY][type] || {}), [key]: value };
  return settings.update({ [TYPE_SETTINGS_KEY]: { [type]: { [key]: value } } })
    .then(() => appsChanged({ redraw: "items" }))
    .catch((error) => console.error("[mullion] setting was not saved:", error.message || error));
}

// What a type offers to be set, per type: specs in the property
// vocabulary, under `settings` in the type's definition, kept through the
// two functions above. A window's settings draw them for the item in the
// window and for every item that owns it, and the type reads them back with
// typeSettingValue(). Every app has one more, given by the shell: the colour
// its windows wear (see tintOf).
//
// The colours, picked to read as an accent on both themes and to carry white
// text when a button is filled with them. Empty is the theme's own accent.
const TINTS = [
  { value: "", key: "default" },
  { value: "#3b82f6", key: "blue" },
  { value: "#0d9488", key: "teal" },
  { value: "#16a34a", key: "green" },
  { value: "#d97706", key: "amber" },
  { value: "#ea580c", key: "orange" },
  { value: "#dc2626", key: "red" },
  { value: "#db2777", key: "pink" },
  { value: "#7c3aed", key: "purple" },
];

const ACCENT_KEY = "accent";

const ACCENT_SETTING = {
  label: "mu.setting.accent",
  type: "enum",
  control: "swatches",
  default: "",
  options: () => TINTS.map((one) => ({ value: one.value, label: `mu.tint.${one.key}` })),
};

function typeSettingsOf(type) {
  const def = ITEM_TYPES[type];
  if (!def) return {};
  // The colour an app wears is the app's now (see apps), not the type's.
  return { ...(def.settings || {}) };
}

// ---- app-wide settings -----------------------------------------------
function appSettingSpec(key) {
  const spec = APP_SETTINGS[key];
  if (!spec) throw new Error(`unknown app setting: ${key}`);
  return spec;
}

// The enum choices for an app setting. properties.js has a general version
// of this, but core must not import it: properties.js imports core, and one
// small resolver is cheaper than a cycle.
function appSettingOptions(spec) {
  const raw = typeof spec.options === "function" ? spec.options() : spec.options || [];
  return raw.map((option) =>
    typeof option === "object" ? option : { value: option, label: String(option) }
  );
}

function appSettingValue(key) {
  const spec = appSettingSpec(key);
  const value = settings.get(key, spec.default);
  // A profile outlives the things it names: a skin gets renamed, a plugin
  // that brought one is uninstalled. Fall back rather than hand out a value
  // nothing can render -- the same rule pickedType() applies to item types.
  if (spec.type === "enum" && !appSettingOptions(spec).some((o) => o.value === value)) {
    return spec.default;
  }
  return value;
}

function setAppSetting(key, value) {
  const spec = appSettingSpec(key);
  if (spec.type === "enum" && !appSettingOptions(spec).some((option) => option.value === value)) {
    throw new Error(`${key} cannot be "${value}"`);
  }
  // The profile is the source of truth, so apply and redraw once the write
  // has landed rather than guessing. settings pushes the change to every
  // other open tab too (see the mullion-settings-changed listener below).
  settings.update({ [key]: value })
    .then(() => appsChanged({ settings: true }))
    .catch(() => {});
}

// Whether a link slot takes an item of this type: `itemType` is a name, a
// list of names, or a function of a type name.
function linkFits(spec, type) {
  return typeof spec.itemType === "function" ? Boolean(spec.itemType(type)) : [].concat(spec.itemType).includes(type);
}


// Whether `holderId` has `targetId` linked in (see the app links below). An item
// may drive what it is linked to -- a chain runs the apps it was given -- which is
// wider than its own only in that direction: the linked app gets no say over the
// chain.
function linksInto(holderId, targetId) {
  const holder = getItem(holderId);
  if (!holder || !targetId) return false;
  for (const [key, spec] of linkSlotsOf(holder)) {
    if (linkedIds(holder, key, spec).some((id) => id === targetId && getItem(id))) return true;
  }
  return false;
}

// ---- apps -------------------------------------------------------------
// An app is a value: what a launcher offers and what a frame on screen is
// an instance of. Its name and icon, the colour its windows wear, where its
// windows go (a launch layout, links included), whether that is kept from
// the frame as it is moved about, and the values its main item starts with.
//
//   {type, name, icon, accent, autoSave, layout, props, hotkeys}
//
// `type` is the item type of the app's main item ("self" in the layout).
//
// Two kinds, one shape. Built-in apps are the item types of kind "app" --
// core's and every plugin's -- read from the type every time, so a plugin
// that changes its default layout reaches everyone; what a person changes
// in one is kept beside it as an override in the profile ("appOverrides",
// JSON text per app), and taking that away is "back to the default". A
// person's own apps are saved values of type "app" in the library (id
// "u<library id>"), made from another app or from a window, and fixed from
// then on: they do not follow the app they were made from.
//
// On screen an app is a frame -- a group, or the one window of an app that
// opens as one -- carrying `app: <id>`. Its name, icon and colour are read
// from the app whenever the frames are drawn, so a change to them shows at
// once; its layout is where the windows of the next one opened go.
const APP_TYPE = "app";

const APP_OVERRIDES_KEY = "appOverrides";

const USER_APP_ID = /^u(\d+)$/;

const APP_KEYS = ["type", "name", "icon", "accent", "autoSave", "excludeHistory", "layout", "props", "hotkeys"];
// What of a built-in app can be changed: its colour and where its windows
// go (and its hotkeys, kept with it). Its name, icon and starting values
// are its type's.
const BUILTIN_APP_KEYS = ["accent", "autoSave", "excludeHistory", "layout", "hotkeys"];

const copyValue = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));

function coerceApp(value) {
  const v = isPlainObject(value) ? value : {};
  return {
    type: typeof v.type === "string" ? v.type : "",
    name: typeof v.name === "string" ? v.name : "",
    icon: typeof v.icon === "string" ? v.icon : "",
    accent: typeof v.accent === "string" ? v.accent : "",
    autoSave: v.autoSave !== false,
    excludeHistory: typeof v.excludeHistory === "boolean" ? v.excludeHistory : Boolean(APPS[v.type]?.excludeHistory),
    layout: launchSpecValid(v.layout) ? v.layout : "self",
    props: isPlainObject(v.props) ? v.props : {},
    hotkeys: appsHooks.coerceHotkeys(v.hotkeys),
  };
}

// A built-in app is a type that can be opened on its own (`standalone`): its
// id is the type's, and what it opens with is the type's `launch`. A type
// that opens as a group is not also offered as its window alone -- that is
// opened from the Item Catalog, as an app that has not been kept.

// A built-in app as its type says it is.
function builtinApp(id) {
  const def = ITEM_TYPES[id];
  const reg = APPS[id];
  if (!reg || !isStandalone(def)) return null;
  return {
    type: id,
    name: t(reg.name || def.label),
    icon: reg.icon || def.icon || "window",
    accent: "",
    autoSave: true,
    excludeHistory: Boolean(reg.excludeHistory),
    layout: reg.layout ? reg.layout : "self",
    props: reg.props || {},
    hotkeys: [],
  };
}

// What the profile said about a type before apps were values -- its chosen
// launch layout, its colour, whether its layout was kept -- read as the
// override it now is, until one is written.
function legacyOverride(type) {
  const out = {};
  const all = settings.get(LAUNCH_KEY, {}) || {};
  if (typeof all[type] === "string" && all[type]) {
    try {
      const spec = JSON.parse(all[type]);
      if (launchSpecValid(spec)) out.layout = spec;
    } catch {
      /* not a layout any more */
    }
  }
  const accent = typeSettingValue(type, ACCENT_KEY, "");
  if (typeof accent === "string" && accent) out.accent = accent;
  if (typeSettingValue(type, AUTO_LAYOUT_KEY, true) === false) out.autoSave = false;
  return Object.keys(out).length ? out : null;
}

function appOverride(id) {
  const all = settings.get(APP_OVERRIDES_KEY, {}) || {};
  if (typeof all[id] !== "string") return legacyOverride(id);
  if (!all[id]) return null;
  try {
    const value = JSON.parse(all[id]);
    if (!isPlainObject(value)) return null;
    const kept = Object.fromEntries(Object.entries(value).filter(([key]) => BUILTIN_APP_KEYS.includes(key)));
    return Object.keys(kept).length ? kept : null;
  } catch {
    return null;
  }
}

// An app by its id, resolved: {...the value, id, builtin, overridden}.
function appDef(id) {
  if (typeof id !== "string" || !id) return null;
  const user = USER_APP_ID.exec(id);
  if (user) {
    const saved = savedValue(Number(user[1]));
    if (!saved || saved.type !== APP_TYPE) return null;
    const value = coerceApp(saved.value);
    return { ...value, name: saved.name || value.name, id, builtin: false, overridden: false, oneWindow: oneWindowLayout(value.layout) };
  }
  const base = builtinApp(id);
  if (!base) return null;
  const over = appOverride(id);
  const value = over ? coerceApp({ ...base, ...over, type: base.type }) : base;
  return {
    ...value,
    id,
    builtin: true,
    overridden: Boolean(over),
    layoutChanged: Boolean(over && "layout" in over),
    oneWindow: oneWindowLayout(value.layout),
  };
}

// Every app: the built-in ones by name, then a person's own. The types that
// are a window of a larger app (`partOf`) are apps too -- the workflow app's
// own window, its standalone runner -- and are listed with the rest: Home
// shows only what a person put in its groups, so listing them here costs it
// nothing, and the App List is where every app can be found.
function appList() {
  const ids = Object.keys(APPS).filter((type) => isStandalone(ITEM_TYPES[type]));
  const builtins = ids
    .map(appDef)
    .filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name));
  const own = savedOfType(APP_TYPE)
    .map((one) => appDef(`u${one.id}`))
    .filter(Boolean);
  return [...builtins, ...own];
}

function writeOverride(id, value) {
  const text = value ? JSON.stringify(value) : "";
  // Into the cache first, so what is drawn next already reads it.
  const cache = settings.cache;
  cache[APP_OVERRIDES_KEY] = { ...(cache[APP_OVERRIDES_KEY] || {}), [id]: text };
  return settings.update({ [APP_OVERRIDES_KEY]: { [id]: text } }).catch((error) =>
    console.error("[mullion] app was not saved:", error.message || error)
  );
}

// ---- the values an app is closed with -------------------------------------
// Closing an app keeps what its main item (and the items it owns) was set
// to, and the next one opened starts from that. Kept in the profile beside
// the app, not in the app: it is not a change to the app's definition (so a
// built-in app is not "changed" by being used, and a person's own app stays
// the snapshot it was made as). A caller's values still come over it, and
// "back to default" on an app takes it away.
const APP_VALUES_KEY = "appValues";
// What is never kept: what the last run made, and how it was being looked at.
const UNKEPT_KEYS = new Set(["results", "views"]);
// A value this large is a picture or the like, and the profile is no place
// for it (it is still in the layout while the window is open).
const KEPT_VALUE_MAX = 64 * 1024;

function keptAppValues(id) {
  const all = settings.get(APP_VALUES_KEY, {}) || {};
  if (typeof all[id] !== "string" || !all[id]) return {};
  try {
    const value = JSON.parse(all[id]);
    const app = appDef(id);
    return isPlainObject(value) && app ? fitValues(app.type, value) : {};
  } catch {
    return {};
  }
}

// The part of some values a type still has a place for: a property that is
// gone, or is read through now, is left out.
function fitValues(type, values) {
  const specs = (ITEM_TYPES[type] || {}).properties || {};
  const out = {};
  for (const [key, value] of Object.entries(values)) {
    const spec = specs[key];
    if (!spec || spec.read) continue;
    out[key] = value;
  }
  return out;
}

// What an item holds that is worth starting from again: its own values that
// differ from the type's default or from what the app opens with (`base`).
function closingValues(item, base = {}) {
  const def = ITEM_TYPES[item.type];
  if (!def) return {};
  const out = {};
  const dropped = [];
  for (const [key, spec] of Object.entries(def.properties || {})) {
    if (spec.read || spec.readonly || UNKEPT_KEYS.has(key)) continue;
    // A reference to another item names one of this session's, which is gone
    // when the app is opened again; a port's value is what a link carried
    // in, and is carried again by the link.
    if (spec.type === "ref" || spec.type === "portvalue") continue;
    const value = item.props[key];
    if (value === undefined) continue;
    const text = JSON.stringify(value);
    if (text === undefined) continue;
    if (text.length > KEPT_VALUE_MAX) {
      dropped.push(key);
      continue;
    }
    if (key in base || text !== JSON.stringify(defaultFor(spec))) out[key] = copyValue(value);
  }
  // A picture's name without the picture would say a file is there.
  for (const key of dropped) delete out[`${key}Name`];
  return out;
}

// An app being closed: its values are kept for the next one opened. `node`
// is the app's frame, or its window where it is one window.
function keepAppValues(node) {
  if (!node || !node.app) return;
  const app = appDef(node.app);
  if (!app) return;
  const item = getItem(node.type === "group" ? appItemOf(node) : node.path && node.path[0]);
  if (!item || item.type !== app.type) return;
  const values = closingValues(item, app.props || {});
  const text = Object.keys(values).length ? JSON.stringify(values) : "";
  const all = settings.get(APP_VALUES_KEY, {}) || {};
  if ((typeof all[node.app] === "string" ? all[node.app] : "") === text) return;
  // Into the cache first, so what is opened next already reads it.
  settings.cache[APP_VALUES_KEY] = { ...(settings.cache[APP_VALUES_KEY] || {}), [node.app]: text };
  settings.update({ [APP_VALUES_KEY]: { [node.app]: text } }, { quiet: true }).catch((error) =>
    console.error("[mullion] app values were not kept:", error.message || error)
  );
}

// A window closed by the person: every app that goes with it keeps its values
// first -- the ones inside it, and the frames it was the last window of.
// (Moving a window is a removal too, and is not this.)
function closeWindow(id) {
  const node = findLeaf(id);
  if (!node) return false;
  const going = [];
  const note = (one) => going.push(one);
  if (node.type === "group") eachGroup(node, note);
  eachLeaf(node, note);
  for (let up = groupOf(id); up && up !== layoutRoot() && !up.bay && leafIds(up).length === leafIds(node).length; up = groupOf(up.id)) {
    going.push(up);
  }
  going.forEach(keepAppValues);
  return removeWindow(id);
}

// Change an app. A key set to null takes a built-in app's override of it
// away. Its name, icon and colour reach every frame of it at once (they
// are read as the frames are drawn); its layout is for the frames opened
// from now on.
function setApp(id, patch = {}) {
  const def = appDef(id);
  if (!def) throw new Error(`unknown app: ${id}`);
  const clean = {};
  for (const [key, value] of Object.entries(isPlainObject(patch) ? patch : {})) {
    if (!APP_KEYS.includes(key)) continue;
    if (def.builtin && !BUILTIN_APP_KEYS.includes(key)) continue;
    if (key === "type") {
      if (value === def.type) continue;
      if (def.builtin) throw new Error("a built-in app's type is its own");
      if (!ITEM_TYPES[value]) throw new Error(`unknown item type: ${value}`);
    }
    if (key === "layout" && value !== null && !launchSpecValid(value)) throw new Error("not a launch layout");
    if (key === "props" && value !== null && !isPlainObject(value)) throw new Error("props must be an object");
    if (key === "hotkeys" && value !== null && !Array.isArray(value)) throw new Error("hotkeys must be a list");
    if (key === "excludeHistory" && value !== null && typeof value !== "boolean") throw new Error("excludeHistory must be a boolean");
    clean[key] = copyValue(value);
  }
  let saving;
  let next;
  if (def.builtin) {
    const over = { ...(appOverride(id) || {}) };
    for (const [key, value] of Object.entries(clean)) {
      if (value === null) delete over[key];
      else over[key] = value;
    }
    saving = writeOverride(id, Object.keys(over).length ? over : null);
    next = appDef(id);
  } else {
    const { id: _id, builtin: _builtin, overridden: _overridden, ...current } = def;
    const fields = Object.fromEntries(Object.entries(clean).filter(([, value]) => value !== null));
    const value = coerceApp({ ...current, ...fields });
    next = { ...value, id, builtin: false, overridden: false };
    saving = saveValue({ id: Number(USER_APP_ID.exec(id)[1]), type: APP_TYPE, name: value.name, value });
  }
  // What the frames show is read from the app as they are drawn; where
  // their windows go is not -- a layout is how the next one opens.
  appsChanged({ redraw: "all" });
  return Promise.resolve(saving).then(() => true);
}

// ---- changing apps (reset, add, copy, remove), the running ones, capturing and launching one ----

// A built-in app back as its type has it.
function resetApp(id) {
  const def = appDef(id);
  if (!def || !def.builtin) throw new Error(`${id} is not a built-in app`);
  const saving = writeOverride(id, null);
  // The values it was closed with are part of what it was changed to.
  const all = settings.cache[APP_VALUES_KEY] || {};
  if (all[id]) {
    settings.cache[APP_VALUES_KEY] = { ...all, [id]: "" };
    settings.update({ [APP_VALUES_KEY]: { [id]: "" } }, { quiet: true }).catch(() => {});
  }
  appsChanged({ redraw: "all" });
  return Promise.resolve(saving).then(() => true);
}

// An app's frame opened again, in the same place, as the app is now: its windows are replaced by a new
// launch of the app (its layout and the values it starts with -- after a reset, the defaults). What the old
// windows held is not kept: this is what a reset is for, so the values they have are not written down as
// the ones the app was closed with (see keepAppValues, which closing a window does).

// A person's own app, from a value: resolves to its id.
function addApp(value) {
  const app = coerceApp(value);
  if (!ITEM_TYPES[app.type]) return Promise.reject(new Error(`unknown item type: ${app.type}`));
  const name = app.name || t(ITEM_TYPES[app.type].label);
  return saveValue({ type: APP_TYPE, name, value: { ...app, name } }).then((saved) => `u${saved.id}`);
}

function duplicateApp(id) {
  const def = appDef(id);
  if (!def) return Promise.reject(new Error(`unknown app: ${id}`));
  const { id: _id, builtin: _builtin, overridden: _overridden, ...value } = def;
  return addApp({ ...copyValue(value), name: t("mu.app.copyOf", { name: def.name }) });
}

// A person's own app gone. Its frames stay, as plain frames.
function removeApp(id) {
  const user = USER_APP_ID.exec(String(id || ""));
  if (!user) return Promise.reject(new Error(`${id} is not a person's own app`));
  appFrames(id).forEach((node) => delete node.app);
  return deleteValue(Number(user[1])).then(() => {
    commit();
    return true;
  });
}

// The frames on screen that are an app's.
function appFrames(id) {
  const out = [];
  (function walk(node) {
    if (!node) return;
    if (node.app === id) out.push(node);
    if (isContainer(node)) node.children.forEach(walk);
  })(layoutRoot());
  return out;
}

// The app a window is part of: the nearest frame around it (itself
// included) that is one.
function appOfWindow(id) {
  for (let node = id ? findLeaf(id) : null; node; node = groupOf(node.id)) {
    if (node.app) return appDef(node.app);
  }
  return null;
}

// The ids of the apps that have a window open: a frame of the app on
// screen, or one a sash keeps aside.
function runningApps() {
  const out = new Set();
  const note = (node) => {
    if (node.app) out.add(node.app);
  };
  eachGroup(layoutRoot(), note);
  eachLeaf(layoutRoot(), note);
  eachStashedLeaf(note);
  eachStashedGroup(note);
  return out;
}



// A bay of a launch layout, made new for the app being opened: its sashes
// from what the layout says each held (`resolve` turns one into the
// windows), the one it says shown in its frame and the rest kept aside.
function bayFromSpec(spec, resolve) {
  const record = {
    id: nextBayId(allBays(), "b"),
    name: typeof spec.name === "string" && spec.name ? spec.name : t("mu.bay.nameN", { n: allBays().length + 1 }),
    active: "",
    sashes: [],
  };
  addBayRecord(record);
  (Array.isArray(spec.sashes) ? spec.sashes : []).forEach((one, index) => {
    const arranged = one ? resolve(one) : null;
    record.sashes.push({
      id: `s${index + 1}`,
      name: t("mu.bay.sashN", { n: index + 1 }),
      content: arranged ? contentNode(toArrangement(arranged)) : null,
    });
  });
  const shown = record.sashes[Math.min(Math.max(0, Number(spec.active) || 0), record.sashes.length - 1)];
  if (shown) record.active = shown.id;
  return { type: "group", id: newWindowId(), bay: record.id, children: [takeContent(record)] };
}

// A new instance of an app, as the node to put on screen.
function launchAppNode(id) {
  const def = appDef(id);
  if (!def) throw new Error(`unknown app: ${id}`);
  if (!ITEM_TYPES[def.type]) throw new Error(`unknown item type: ${def.type}`);
  return launchNode(def.type, {}, id);
}

// Ask where an app goes, and open it there.

// The values an app's main item starts with that it keeps: those its type
// says matter at launch (its app's `keep`, else the keys of its props)
// and that differ from the type's default.
function launchValues(item) {
  const def = ITEM_TYPES[item.type];
  if (!def) return {};
  const reg = APPS[item.type] || {};
  const given = reg.props || {};
  const keys = Array.isArray(reg.keep) ? reg.keep : Object.keys(given);
  const differs = (value, spec) => JSON.stringify(value) !== JSON.stringify(defaultFor(spec));
  const out = {};
  for (const key of keys) {
    const spec = (def.properties || {})[key];
    if (!spec || spec.read) continue;
    if (differs(item.props[key], spec)) out[key] = copyValue(item.props[key]);
  }
  return out;
}

// A window on screen as an app: the app frame it is in (itself included)
// with its layout and links, or the window -- or plain frame -- as it is,
// its first window's item the main one. What the main item starts with
// comes along (launchValues); name, icon and colour are the app's it was
// part of, or its item's.
function captureApp(windowId) {
  const node = findLeaf(windowId);
  if (!node) return null;
  let frame = null;
  for (let at = node; at; at = groupOf(at.id)) {
    if (at.app || (at.type === "group" && appItemOf(at))) {
      frame = at;
      break;
    }
  }
  const target = frame || node;
  const bound = target.app ? appDef(target.app) : null;
  let appItem = null;
  const usable = (leaf) => {
    const item = getItem(leaf.path[0]);
    return item && !isSlotLeaf(leaf) && isStandalone(ITEM_TYPES[item.type]) ? item : null;
  };
  if (target.type === "group") {
    appItem = getItem(target.appItem);
    if (!appItem) eachLeaf(target, (leaf) => appItem || (appItem = usable(leaf)));
    // A bay showing an empty sash: the first window another sash holds.
    if (!appItem && target.bay && bayRecord(target.bay)) {
      for (const sash of bayRecord(target.bay).sashes) eachLeaf(sash.content, (leaf) => appItem || (appItem = usable(leaf)));
    }
  } else {
    appItem = getItem(target.path[0]);
  }
  if (!appItem) return null;
  const typeDef = ITEM_TYPES[appItem.type];
  if (!typeDef || !isStandalone(typeDef)) return null;
  const layout = target.type === "group" ? captureFrameLayout(target, appItem) || "self" : "self";
  const bay = target.bay ? bayRecord(target.bay) : null;
  return coerceApp({
    type: appItem.type,
    name: bound ? bound.name : bay ? bay.name : t(typeDef.label),
    icon: bound ? bound.icon : typeDef.icon || "window",
    accent: bound ? bound.accent : "",
    autoSave: bound ? bound.autoSave : true,
    layout,
    props: launchValues(appItem),
  });
}

// An app's layout as the layout preview draws one, by the types its
// windows are -- for an app with no instance to name them by.
function appLayoutTree(def) {
  if (!def) return null;
  const typeAt = (path) => {
    let type = def.type;
    for (const key of path.split(".")) {
      const spec = ((ITEM_TYPES[type] || {}).properties || {})[key];
      type = spec && spec.itemType;
      if (!type) return null;
    }
    return type;
  };
  const pane = (type, collapsed) => {
    const typeDef = type && ITEM_TYPES[type];
    return typeDef
      ? { label: t(typeDef.label), icon: typeDef.icon || "window", collapsed }
      : { label: type || "?", icon: "question-square", missing: true, collapsed };
  };
  const walk = (one) => {
    const collapsed = Boolean(isPlainObject(one) && one.collapsed);
    if (one === "self" || (isPlainObject(one) && one.self === true)) return pane(def.type, collapsed);
    if (isPlainObject(one) && typeof one.owned === "string") return pane(typeAt(one.owned), collapsed);
    if (isPlainObject(one) && typeof one.add === "string") return pane(one.add, collapsed);
    if (isPlainObject(one) && typeof one.app === "string") {
      const inner = appDef(one.app);
      return inner ? { label: inner.name, icon: inner.icon || "window", collapsed } : pane(null, collapsed);
    }
    // A bay: its name, and a line per sash -- what the sash holds, its
    // windows' names joined.
    if (isPlainObject(one) && isPlainObject(one.bay)) {
      const lines = (Array.isArray(one.bay.sashes) ? one.bay.sashes : [])
        .map((sash) => (sash ? walk(sash) : null))
        .filter(Boolean)
        .map((tree) => {
          const panes = [];
          (function collect(node) {
            if (node.children) node.children.forEach(collect);
            else panes.push(node);
          })(tree);
          return { label: panes.map((pane) => pane.label).join(" · "), icon: panes[0].icon, missing: panes.some((pane) => pane.missing) };
        });
      return { bay: { label: one.bay.name || t("mu.item.bayslot"), items: lines }, collapsed };
    }
    if (isPlainObject(one) && Array.isArray(one.children)) {
      const kids = one.children.map(walk).filter(Boolean);
      if (!kids.length) return null;
      // More than two is right-leaning, as the shell builds it.
      const fold = (list, dir, ratio) =>
        list.length === 1
          ? list[0]
          : { dir, ratio: list.length === 2 && ratio ? ratio : 1 / list.length, children: [list[0], fold(list.slice(1), dir)] };
      return fold(kids, one.dir === "col" ? "col" : "row", Number(one.ratio) || 0);
    }
    return null;
  };
  return walk(def.layout);
}

// Names, icons and colours of the app frames on screen, from their apps:
// read at every refresh, so a renamed app shows renamed without the
// layout being drawn again (which would take the caret out of the field
// the name is being typed into).

// What is inside an app frame and its, not a nested app's: walked without
// going into the app frames inside it.
function eachOwnNode(frame, fn) {
  (function walk(node) {
    fn(node);
    if (node !== frame && node.app && appDef(node.app)) return;
    if (isContainer(node)) node.children.forEach(walk);
  })(frame);
}

function freeTag(frame, prefix) {
  const used = new Set();
  eachOwnNode(frame, (node) => {
    if (node.tag) used.add(node.tag);
    // What a bay in it keeps aside counts too: it is the app's as well.
    const record = node.bay && bayRecord(node.bay);
    if (record) {
      for (const sash of record.sashes) {
        (function walk(one) {
          if (!one) return;
          if (one.tag) used.add(one.tag);
          if (isContainer(one) && !(one.app && appDef(one.app))) one.children.forEach(walk);
        })(sash.content);
      }
    }
  });
  let n = 1;
  while (used.has(`${prefix}${n}`)) n += 1;
  return `${prefix}${n}`;
}

// Where an item is under an app's main item: "self" when it is the main one itself.



export {
  appsHooks,
  registerAppsHook,
  APP_SETTINGS,
  defaultItemFor,
  defaultItemIn,
  appItemOf,
  decidingGroupFor,
  defaultLeafFrom,
  defaultLeafBeside,
  defaultLeafIn,
  setGroupDefault,
  TYPE_SETTINGS_KEY,
  typeSettingValue,
  setTypeSetting,
  TINTS,
  ACCENT_KEY,
  ACCENT_SETTING,
  typeSettingsOf,
  appSettingSpec,
  appSettingOptions,
  appSettingValue,
  setAppSetting,
  linkFits,
  linksInto,
  APP_TYPE,
  APP_OVERRIDES_KEY,
  USER_APP_ID,
  APP_KEYS,
  BUILTIN_APP_KEYS,
  copyValue,
  coerceApp,
  builtinApp,
  legacyOverride,
  appOverride,
  appDef,
  appList,
  writeOverride,
  APP_VALUES_KEY,
  UNKEPT_KEYS,
  KEPT_VALUE_MAX,
  keptAppValues,
  fitValues,
  closingValues,
  keepAppValues,
  closeWindow,
  setApp,
  resetApp,
  addApp,
  duplicateApp,
  removeApp,
  appFrames,
  appOfWindow,
  runningApps,
  bayFromSpec,
  launchAppNode,
  launchValues,
  captureApp,
  appLayoutTree,
  eachOwnNode,
  freeTag,
  announceAppsChange,
};
