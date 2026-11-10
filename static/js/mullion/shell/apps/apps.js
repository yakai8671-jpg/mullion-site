/* apps: moved out of core.js (docs/wiki/migration.md). */
import { APPS, DEFAULT_ITEM_TYPE, ITEM_TYPES, MAX_NESTING, ROOT_DEFAULT_ITEM, ROOT_ID, SKINS, addBayRecord, allBays, allLinks, bayRecord, bindProperty, canLink, canShare, commit, contentNode, createGroupNode, createItem, createWindowNode, currentItemId, defaultFor, deleteValue, derivesFrom, dropLinksAmong, eachGroup, eachLeaf, eachStashedGroup, eachStashedLeaf, findLeaf, getItem, groupContent, groupOf, isContainer, isPlainObject, isSlotLeaf, isStandalone, knownType, layoutRoot, leafIds, newWindowId, nextBayId, oneWindowLayout, placeLink, portAddress, removeWindow, saveValue, savedOfType, savedValue, screensOf, singleLayout, slotOnly, t, takeContent, settings, languages } from "./deps.js";

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

// ---- launch layouts people chose -------------------------------------
// A type's `launch.layout` is where its windows go when it is opened -- the
// type's opinion. The person's is kept beside it in the profile, per type,
// because it is about every future instance and no instance exists yet
// when one is launched. Kept as JSON text rather than as an object: the
// profile merges objects key by key, and a layout that merged into the one
// before it would keep that one's stale ratios.
//
// A chosen layout names the same things a type's does: "self", and
// { owned: key } -- where the key may be a path through owners,
// "editor.parts", for a window showing something the app's editor owns.
const LAUNCH_KEY = "launchLayouts";

// Kept for the callers that still ask by type: a type's chosen layout is
// its built-in app's overridden one now (see apps).
function chosenLaunchLayout(type) {
  const over = appOverride(type);
  return over && launchSpecValid(over.layout) ? over.layout : null;
}

function launchLayoutOf(type) {
  const own = APPS[type] && APPS[type].layout ? APPS[type].layout : null;
  const app = appDef(type);
  return own ? (app && !singleLayout(app.layout) ? app.layout : own) : null;
}

// The property links a launch layout carries, on its outermost object:
// [{to: {at, key, entry?, part?}, from: {...}}], each end's `at` being
// "self" or a path of owners, the way its windows are named; "+tag" a window or
// app added to the frame, and "+tag/owner.path" an item that one owns.
const LINK_AT = /^(self|\+[A-Za-z0-9_]+(\/[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)*)?|[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)*)$/;

function launchLinksValid(list) {
  return (
    Array.isArray(list) &&
    list.every(
      (one) =>
        one &&
        ["to", "from"].every(
          (end) => one[end] && typeof one[end].at === "string" && LINK_AT.test(one[end].at) && typeof one[end].key === "string" && one[end].key
        )
    )
  );
}

// The app links a launch layout carries: [{at, key, to: [at, ...]}] -- the
// item named by `at` has these items linked into its property `key`.
function launchAppLinksValid(list) {
  return (
    Array.isArray(list) &&
    list.every(
      (one) =>
        one &&
        typeof one.at === "string" &&
        LINK_AT.test(one.at) &&
        typeof one.key === "string" &&
        one.key &&
        Array.isArray(one.to) &&
        one.to.every((at) => typeof at === "string" && LINK_AT.test(at))
    )
  );
}

// Only the shapes a launch layout is made of, and at least one window.
function launchSpecValid(spec, depth = 0) {
  if (depth > MAX_NESTING + 2) return false;
  if (spec === "self") return true;
  if (spec && typeof spec === "object" && !Array.isArray(spec) && spec.links !== undefined) {
    if (depth > 0 || !launchLinksValid(spec.links)) return false;
  }
  if (spec && typeof spec === "object" && !Array.isArray(spec) && spec.appLinks !== undefined) {
    if (depth > 0 || !launchAppLinksValid(spec.appLinks)) return false;
  }
  if (spec && typeof spec === "object" && !Array.isArray(spec)) {
    // The object forms carry a window's own state -- `collapsed` -- which a
    // bare "self" has nowhere to put.
    if (spec.self === true) return true;
    // An old layout's window of something the app owned: it names nothing now, and is
    // dropped when the app opens (see resolveLaunch).
    if (typeof spec.owned === "string") return /^[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)*$/.test(spec.owned);
    // A bay: its sashes, each what that sash holds (or null for an empty
    // one), and which is shown. Not a bay inside a bay.
    if (spec.bay && typeof spec.bay === "object" && !Array.isArray(spec.bay)) {
      const sashes = spec.bay.sashes;
      if (!Array.isArray(sashes) || (spec.tag !== undefined && !/^[A-Za-z0-9_]+$/.test(spec.tag))) return false;
      const within = (one) => one && typeof one === "object" && !Array.isArray(one) && (one.bay || (Array.isArray(one.children) && one.children.some(within)));
      return sashes.every((one) => one === null || (launchSpecValid(one, depth + 1) && !within(one)));
    }
    // An app inside the app, by its id and the tag it is known by here.
    if (typeof spec.app === "string") {
      return /^[A-Za-z0-9_.:-]+$/.test(spec.app) && (spec.tag === undefined || /^[A-Za-z0-9_]+$/.test(spec.tag));
    }
    // A window added to the frame by hand, kept by its type (and a tag for
    // links to name it by, and the values it starts with).
    if (typeof spec.add === "string") {
      return /^[A-Za-z0-9_.-]+$/.test(spec.add) && (spec.tag === undefined || /^[A-Za-z0-9_]+$/.test(spec.tag));
    }
    if (Array.isArray(spec.children) && spec.children.length) {
      return spec.children.every((child) => launchSpecValid(child, depth + 1));
    }
  }
  return false;
}

// null puts the type's own back. Its built-in app's layout, by type.
function setChosenLaunchLayout(type, spec) {
  if (!ITEM_TYPES[type] || !(APPS[type] && APPS[type].layout)) {
    throw new Error(`${type} does not open as a group`);
  }
  if (spec !== null && !launchSpecValid(spec)) throw new Error("not a launch layout");
  return setApp(type, { layout: spec });
}

// The arrangement an app's frame has now, as a launch layout: each window
// named by where its item sits under the app -- "self", or the path of
// owners down to it -- or, for a window added to the frame later showing
// something that is not the app's, by its type: `{add: type, tag}`, a new
// one of that type when the app opens (tagged so links can name it). What
// the windows hold is not in it -- a layout is where things go.
function captureLaunchLayout(appItemId) {
  let frame = null;
  eachGroup(layoutRoot(), (group) => {
    if (!frame && group.appItem === appItemId && appItemOf(group)) frame = group;
  });
  if (!frame) return null;
  return captureFrameLayout(frame, getItem(appItemId));
}

// The same for any frame, around the item that is its main one.
function captureFrameLayout(frame, app) {
  if (!frame || !app) return null;

  const pathTo = (itemId) => (itemId === app.id ? "self" : null);
  // The windows added later, by the item each was opened on: a1, a2, ...
  const tags = new Map();

  // Minimised is where a window is as much as which side of a seam it is
  // on, so it is kept; what it holds is not.
  const withState = (spec, node) => {
    if (!spec || !node.collapsed) return spec;
    if (spec === "self") return { self: true, collapsed: true };
    return spec.children ? spec : { ...spec, collapsed: true };
  };
  const specOf = (node) => {
    // A bay -- inside the frame, or the frame itself: kept as a bay with
    // every sash, the hidden ones as well, under its tag.
    if (node.bay && bayRecord(node.bay)) {
      const record = bayRecord(node.bay);
      if (!node.tag) node.tag = freeTag(frame, "y");
      const sashes = record.sashes.map((sash) => {
        const content = sash.id === record.active ? groupContent(node) : sash.content;
        return content && !slotOnly(content) ? specOf(content) : null;
      });
      return {
        bay: { name: record.name, active: Math.max(0, record.sashes.findIndex((one) => one.id === record.active)), sashes },
        tag: node.tag,
      };
    }
    // The main item's window is "self", even when it was a one-window app
    // of its own before it was made the main one of this.
    if (node.type === "leaf" && node.path.includes(app.id)) return withState("self", node);
    // An app inside this one: kept as that app, under its tag.
    if (node !== frame && node.app && appDef(node.app)) {
      if (!node.tag) node.tag = freeTag(frame, "b");
      return withState({ app: node.app, tag: node.tag }, node);
    }
    if (node.type === "leaf") {
      // What the window is showing now, or failing that what it was
      // opened on -- a picker on top of an app window is a visit.
      for (const itemId of [...node.path].reverse()) {
        const at = pathTo(itemId);
        if (at) return withState("self", node);
      }
      // Not the app's: kept by the type of what it was opened on, unless
      // that is one of the shell's own screens -- under the tag the window
      // has, or one given now (a hotkey names it by that).
      const base = getItem(node.path[0]);
      const def = base && ITEM_TYPES[base.type];
      if (!def || !isStandalone(def)) return null;
      if (!tags.has(base.id)) {
        if (!node.tag || [...tags.values()].includes(node.tag)) node.tag = freeTag(frame, "a");
        tags.set(base.id, node.tag);
      }
      return withState({ add: base.type, tag: tags.get(base.id) }, node);
    }
    if (node.type === "group") return node.children[0] ? withState(specOf(node.children[0]), node) : null;
    const [a, b] = node.children.map(specOf);
    if (a && b) return { dir: node.dir, ratio: Number(node.ratio.toFixed(4)), children: [a, b] };
    return a || b;
  };
  const spec = frame.bay ? specOf(frame) : frame.children[0] ? specOf(frame.children[0]) : null;
  if (!spec) return null;
  // The links between the frame's items go with it: which window follows
  // which is part of how the app is set out. Always said, none included,
  // so a layout with no links is a choice and not a gap.
  // The main item of an app inside this one is named by that app's tag.
  const mains = new Map();
  const mainOf = (node) => node.appItem || (node.type === "leaf" ? node.path[0] : null);
  (function walk(node) {
    if (!node) return;
    if (node !== frame && node.app && node.tag) {
      const id = mainOf(node);
      if (id) mains.set(id, `+${node.tag}`);
    }
    if (Array.isArray(node.children)) node.children.forEach(walk);
  })(frame);
  // An item by the name a layout gives it: "self", or the tag of a window or app
  // added to the frame.
  const added = new Map([...tags].map(([id, tag]) => [id, `+${tag}`]));
  for (const [id, name] of mains) added.set(id, name);
  const nameOf = (id) => {
    const own = pathTo(id);
    if (own) return own;
    return added.has(id) ? added.get(id) : null;
  };
  // The links between the frame's items. Those inside one added app are left
  // to that app: it opens with its own.
  const baseOf = (at) => (at.startsWith("+") ? at.split("/")[0] : "");
  const end = (port) => {
    const at = nameOf(port.item);
    if (!at) return null;
    const { item: _item, ...rest } = portAddress(port);
    return { at, ...rest };
  };
  const kept = allLinks()
    .map((one) => ({ to: end(one.to), from: end(one.from), ...(one.share ? { share: true } : {}) }))
    .filter((one) => one.to && one.from && !(baseOf(one.to.at) && baseOf(one.to.at) === baseOf(one.from.at)));
  // The app links as well -- a chain's apps, by the names the windows have
  // here -- or the chain would open with nothing linked to it.
  const appLinks = [];
  for (const holderId of new Set([app.id, ...tags.keys(), ...mains.keys()])) {
    const holder = getItem(holderId);
    const at = holder && nameOf(holderId);
    if (!at) continue;
    for (const [key, slot] of linkSlotsOf(holder)) {
      const to = linkedIds(holder, key, slot).map(nameOf).filter(Boolean);
      if (to.length) appLinks.push({ at, key, to });
    }
  }
  return { ...(spec.children ? spec : { children: [spec] }), links: kept, appLinks };
}

// An item of an app's frame by the name a launch layout gives it: "self", or
// "+tag" for a window added by type.
function launchItemAt(app, at, tags = new Map()) {
  if (at === "self") return app.id;
  // An added window or app, by its tag.
  if (!at.startsWith("+") || at.includes("/")) return null;
  const entry = getItem(tags.get(at.slice(1)));
  return entry ? entry.id : null;
}

// A launch layout as an arrangement of items: windows named by path show
// the app's own; one added by type shows what `take(type)` gives -- a new
// one at launch, one already in the frame when the layout is put on an
// open app -- noted under its tag in `tags`. A path that no longer leads
// anywhere, or a type no longer installed, drops that window rather than
// the whole arrangement.
function resolveLaunch(app, spec, ctx = { tags: new Map(), take: () => null }) {
  if (spec === "self") return { item: app.id };
  if (Array.isArray(spec)) return spec.map((one) => resolveLaunch(app, one, ctx)).filter(Boolean);
  const state2 = spec && typeof spec === "object" && spec.collapsed ? { collapsed: true } : {};
  if (spec && typeof spec === "object" && spec.self === true) return { item: app.id, ...state2 };
  if (spec && typeof spec === "object" && typeof spec.add === "string") {
    const id = ITEM_TYPES[spec.add] ? ctx.take(spec.add, spec.props) : null;
    if (!id) return null;
    if (spec.tag) ctx.tags.set(spec.tag, id);
    return { item: id, ...state2, ...(spec.tag ? { tag: spec.tag } : {}) };
  }
  // A bay: a new one, its sashes made of what each held.
  if (spec && typeof spec === "object" && spec.bay && typeof spec.bay === "object" && ctx.makeBay) {
    const node = ctx.makeBay(spec.bay, (one) => resolveLaunch(app, one, ctx));
    if (!node) return null;
    if (spec.tag) node.tag = spec.tag;
    return { node };
  }
  // An app inside: a new one at launch -- under its tag, which is how a
  // hotkey tells it from another of the same app.
  if (spec && typeof spec === "object" && typeof spec.app === "string") {
    const node = ctx.takeApp ? ctx.takeApp(spec.app, spec.tag) : null;
    if (!node) return null;
    if (spec.tag) {
      node.tag = spec.tag;
      // Its main item, by the tag: what a link to this app names it by.
      const main = node.appItem || (node.type === "leaf" ? node.path[0] : null);
      if (main && ctx.tags) ctx.tags.set(spec.tag, main);
    }
    if (state2.collapsed) node.collapsed = true;
    else delete node.collapsed;
    return { node };
  }
  if (spec && typeof spec === "object" && Array.isArray(spec.children)) {
    const children = spec.children.map((one) => resolveLaunch(app, one, ctx)).filter(Boolean);
    if (!children.length) return null;
    const { links: _links, appLinks: _appLinks, ...rest } = spec;
    // One left of a pair is that one, not a pair with a ratio for nothing.
    return children.length === 1 ? children[0] : { ...rest, children };
  }
  return null;
}

// The links a launch layout asks for, made between a frame's items. With
// `replace`, the links already between them go first -- a layout put on an
// open app is its links as well as its windows.
function applyLaunchLinks(app, spec, replace = false, tags = new Map()) {
  const list = spec && typeof spec === "object" && Array.isArray(spec.links) ? spec.links : [];
  // App links: what each item has linked in, named the way the windows are.
  for (const one of spec && typeof spec === "object" && Array.isArray(spec.appLinks) ? spec.appLinks : []) {
    const holder = getItem(launchItemAt(app, one.at, tags));
    const slot = holder && linkSlotsOf(holder).find(([key]) => key === one.key);
    if (!slot) continue;
    const ids = (one.to || []).map((at) => launchItemAt(app, at, tags)).filter((id) => id && getItem(id));
    if (!ids.length) continue;
    bindProperty(holder, one.key, null).set(derivesFrom(slot[1].type, "list") ? ids : ids[0]);
  }
  if (replace) {
    const inside = new Set([app.id, ...tags.values()]);
    dropLinksAmong(inside);
  }
  for (const one of list) {
    const toItem = launchItemAt(app, one.to.at, tags);
    const fromItem = launchItemAt(app, one.from.at, tags);
    if (!toItem || !fromItem) continue;
    const { at: _to, ...toRest } = one.to;
    const { at: _from, ...fromRest } = one.from;
    const to = { ...toRest, item: toItem };
    const from = { ...fromRest, item: fromItem };
    if (!(one.share ? canShare(to, from) : canLink(to, from))) continue;
    placeLink(to, from, Boolean(one.share));
  }
}

// The apps being launched, outermost first: one inside itself is left out.
const launchingApps = new Set();

// apps: a launch spec inside a content spec opens as the app's launch.

function launchNode(type, given = {}, appId = null, options = {}) {
  const def = ITEM_TYPES[type];
  if (!def) throw new Error(`unknown item type: ${type}`);
  // An app's type opens as that app -- its own built-in one unless another
  // is named: its layout, its starting values, and the frame says which.
  // `alone`: the type as one window, with the values it starts with and
  // nothing else -- an app that has not been kept (see placeAlone).
  const app = options.alone ? null : appDef(appId || (isStandalone(def) ? type : null));
  const own = APPS[type] && APPS[type].layout ? APPS[type].layout : null;
  const layout = options.alone ? "self" : app ? app.layout : own;
  // A layout that comes to the one window -- "self", or a frame kept with
  // nothing else in it ({children: ["self"]}, which is what an app left
  // alone on screen is saved as) -- opens as that window, not as a group
  // with one window in it.
  const hasLaunch = !oneWindowLayout(layout);
  const bind = (node) => {
    if (app && node) node.app = app.id;
    return node;
  };
  // What a new instance of the type starts with, under whatever the caller
  // asked for -- a panorama app's editor opens at 2:1, not the square every
  // other editor does. One level deep, so `{ editor: { size } }` given here
  // and `{ editor: { template } }` from the caller both land.
  const isObject = (value) => value && typeof value === "object" && !Array.isArray(value);
  const props = { ...copyValue(app ? app.props : (APPS[type] && APPS[type].props) || {}) };
  // Under the caller's, over the app's: what the app had when it was last
  // closed (see keepAppValues), cut to what the type still has.
  const kept = app ? keptAppValues(app.id) : {};
  for (const [key, value] of Object.entries(kept)) {
    props[key] = isObject(props[key]) && isObject(value) ? { ...props[key], ...value } : value;
  }
  for (const [key, value] of Object.entries(given)) {
    props[key] = isObject(props[key]) && isObject(value) ? { ...props[key], ...value } : value;
  }
  const hasInitialLinks = layout && typeof layout === "object" && ((layout.links || []).length || (layout.appLinks || []).length);
  if (!hasLaunch && !hasInitialLinks && !Object.keys(props).length) return bind(createWindowNode(null, type));

  const item = createItem(type);
  // A copy: the caller's object -- a saved value, often -- stays theirs.
  const copyOf = (value) => (value === null || typeof value !== "object" ? value : JSON.parse(JSON.stringify(value)));
  const setValues = (target, values) => {
    const targetDef = ITEM_TYPES[target.type] || {};
    for (const [key, value] of Object.entries(values)) {
      const spec = (targetDef.properties || {})[key];
      if (!spec || spec.read) throw new Error(`${target.type} has no property ${key} to set`);
      bindProperty(target, key, null).set(copyOf(value));
    }
  };
  setValues(item, props);
  if (!hasLaunch) {
    if (hasInitialLinks) applyLaunchLinks(item, layout);
    return bind({ type: "leaf", id: newWindowId(), path: [item.id] });
  }

  // A window added by type is a new one of that type; an app inside, a new
  // one of that app.
  const tags = new Map();
  // `given`: what a window added by type starts with ({add, props}) -- a
  // text composed for the app, say, with the variable it is made for in it.
  const take = (one, given) => {
    const made = createItem(one);
    if (isObject(given)) setValues(made, given);
    return made.id;
  };
  const takeApp = (appIdInside) => (launchingApps.has(appIdInside) || !appDef(appIdInside) ? null : launchAppNode(appIdInside));
  if (app) launchingApps.add(app.id);
  let arranged;
  try {
    arranged =
      resolveLaunch(item, layout, { tags, take, takeApp, makeBay: bayFromSpec }) ||
      (own && resolveLaunch(item, own, { tags, take, takeApp, makeBay: bayFromSpec })) || { item: item.id };
  } finally {
    if (app) launchingApps.delete(app.id);
  }
  // The links it asks for -- the type's own when a layout chosen before
  // layouts carried links says nothing about them.
  const carries = (one) => one && typeof one === "object" && (Array.isArray(one.links) || Array.isArray(one.appLinks));
  applyLaunchLinks(item, carries(layout) ? layout : own, false, tags);
  const defaultItem = (APPS[type] && APPS[type].defaultItem) || type;
  return bind(
    createGroupNode({
      ...toArrangement(arranged),
      defaultItem,
      // A frame whose new windows are this type is this instance's frame.
      ...(defaultItem === type ? { appItem: item.id } : {}),
    })
  );
}

// A launch arriving inside a frame that already belongs to the same app
// gives up its own frame. The runner opens as a group whose new windows are
// the workflow dashboard; opened from that dashboard, inside the workflow
// app's group, a second frame saying the same thing would only be a second
// bar. So the group's contents go in, and the app stays one frame.
//
// `hostDefault` is what a new window where it is landing would be -- the
// frame around it answering, as for any new window.
function fitLaunched(node, hostDefault) {
  return node && node.type === "group" && node.defaultItem && node.defaultItem === hostDefault
    ? node.children[0]
    : node;
}

// A spec as an object, so a group-level key can ride along with it.
function toArrangement(spec) {
  if (Array.isArray(spec)) return { children: spec };
  if (spec && typeof spec === "object" && Array.isArray(spec.children)) return spec;
  return { children: [spec] };
}

// A move is a remove followed by a split. The leaf node itself is reused,
// so the window keeps its id and the whole item path it was showing.
// Trade two windows' places. Everything about a window travels with it --
// what it is showing, whether it is collapsed -- and only its position in
// the tree changes, so the two frames keep their ids and their sizes.

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

// ---- an app's surface: what another item can press, set and read ---------
// A chain (plugins/chain) drives the apps linked to it by what they show: the
// buttons their bodies draw, the properties they take, the values they hold.
// Nothing about an app has to be declared for that; the surface is read off
// the app as it is, and a type that has more to say than its properties and
// buttons (an app whose inputs are not plain properties) adds it with
// `appSurface(api, item, ctx)` -- returning {buttons, inputs, outputs} and
// `exclusive: true` when those are the whole of it.
//
//   prepare  ()  called before a property is pointed at, to bring the form
//            back on screen (a result card closed, say): nothing to point at
//            while the controls are not drawn
//   button   {key, label, primary, disabled, run}   run may return a promise
//   input    {key, label, kind, spec, wide, set(v)} the kind is what is carried
//   output   {key, label, kind, read()}
//
// Buttons are found by walking the body the app would draw: the tools on a
// card, a row of buttons, an image card's empty-state action and
// a card's own add. The body is drawn for nobody -- off screen -- when no
// window shows the app, with a ctx that reads and writes the app as its own
// window would, and the app's own authority: a button pressed here does what
// pressing it there does.

// The properties of an item that take an app by a link.
function linkSlotsOf(item) {
  const def = item && ITEM_TYPES[item.type];
  if (!def) return [];
  // A ref takes one app; a list takes any number of them (a chain's apps).
  // `itemType` is a name, a list of names, or a function of a type name.
  return Object.entries(def.properties || {}).filter(
    ([, spec]) =>
      spec && spec.link === true && (derivesFrom(spec.type, "ref") || derivesFrom(spec.type, "list")) && spec.itemType
  );
}

// The ids a link property holds, whichever shape it has.
function linkedIds(item, key, spec) {
  const value = item.props[key];
  if (derivesFrom(spec.type, "list")) return (Array.isArray(value) ? value : []).filter((one) => typeof one === "string");
  return typeof value === "string" && value ? [value] : [];
}

// The item a dragged window stands for: what it shows, or for a frame the
// app it is.
function itemOfWindow(windowId) {
  const node = findLeaf(windowId);
  if (!node) return null;
  if (node.type === "group") return getItem(appItemOf(node)) || null;
  return getItem(currentItemId(node)) || null;
}

// The apps whose frames a window sits in, the nearest first: what a window
// of an app stands for, once it does not fit by itself. It is where the
// window is that says so, not who owns it -- a window added to an app's frame
// (a preview, a prompt editor) stands for the app as much as one it owns.
function appItemsAround(windowId) {
  const apps = [];
  let group = groupOf(windowId);
  for (let hops = 0; group && hops <= MAX_NESTING; hops++) {
    const id = appItemOf(group);
    if (id && !apps.includes(id)) apps.push(id);
    group = groupOf(group.id);
  }
  return apps;
}

// Which item a slot would be linked to, were something dropped on `toId`.
// `from` is the dragged item and, after it, the apps around its window (see
// appItemsAround): the first that is of a type the slot names, and not the
// host itself. A single id is the item alone.
function linkTargetFor(from, spec, toId) {
  for (const id of [].concat(from)) {
    const at = getItem(id);
    if (at && at.id !== toId && linkFits(spec, at.type)) return at.id;
  }
  return null;
}

// The guides of one window, for the window being dragged: one per property
// that would take it. They look and answer like the window's own guides,
// laid along its title bar the way a group's are, with the others moved down
// out of their way. They are not part of the guides overlay, though: a
// window inside a group that is not open has none of those on show, and
// this is wanted exactly there -- an app's windows sit inside its frame.
// What dropping an item on `host` could link: one entry per slot of the host
// that would take it and is not already holding it, as {key, spec, source, name}.
function linkOptionsFor(host, dropped) {
  return linkSlotsOf(host)
    .map(([key, spec]) => ({ key, spec, source: linkTargetFor(dropped, spec, host.id), name: t(spec.label || key) }))
    // Only what would change something: a slot that already holds the item
    // (an app's own windows are connected by its layout) has nothing to offer.
    .filter((option) => option.source && !linkedIds(host, option.key, option.spec).includes(option.source));
}

// Link `source` to the host's slot, once: a list takes it unless it is
// already in it, a ref is replaced.
function putLink(host, { key, spec, source }) {
  const prop = bindProperty(host, key, null);
  if (derivesFrom(spec.type, "list")) {
    const now = linkedIds(host, key, spec);
    if (!now.includes(source)) prop.set([...now, source]);
  } else prop.set(source);
}

// The links an item holds, as {key, spec, to}, those whose app is still there.
function linksOf(item) {
  return linkSlotsOf(item)
    .flatMap(([key, spec]) => linkedIds(item, key, spec).map((to) => ({ key, spec, to })))
    .filter((one) => one.to && getItem(one.to));
}

// Let go of one link.
function unlinkApp(item, { key, spec, to }) {
  if (derivesFrom(spec.type, "list")) {
    bindProperty(item, key, null).set(linkedIds(item, key, spec).filter((one) => one !== to));
  } else bindProperty(item, key, null).set(null);
  appsChanged({ redraw: "all" });
}

// A frame around one window of an app whose layout is one window. Not the
// root, a bay's frame, or one with screens open over it; and only when the
// window is the app's own item, so a frame someone made by hand around
// another window stays as it is.
function collapseOneWindowFrames(node) {
  if (!node) return node;
  if (node.type === "split") {
    node.children = node.children.map((child) => collapseOneWindowFrames(child));
    return node;
  }
  if (node.type !== "group") return node;
  node.children = node.children.map((child) => collapseOneWindowFrames(child));
  const only = node.children.length === 1 ? node.children[0] : null;
  const def = typeof node.app === "string" ? appDef(node.app) : null;
  if (
    node.id !== ROOT_ID &&
    !node.bay &&
    !screensOf(node).length &&
    def &&
    oneWindowLayout(def.layout) &&
    only &&
    only.type === "leaf" &&
    !only.app &&
    typeof node.appItem === "string" &&
    only.path[0] === node.appItem
  ) {
    return { ...only, app: node.app, ...(node.collapsed === true ? { collapsed: true } : {}) };
  }
  return node;
}






// An app whose windows are moved keeps the new arrangement as its launch
// layout -- unless its type setting `autoSaveLayout` says not (on unless
// set). Asked after every change to the layout, a little after it, so a
// drag that commits several times keeps the last shape once; and written
// only when it differs from what is kept, so a commit that moved nothing
// of the app's writes nothing.
const AUTO_LAYOUT_KEY = "autoSaveLayout";

let launchKeepTimer = null;

// apps: an app whose windows moved keeps its new launch layout.
// apps: a launch layout about to be kept is not, when an undo or redo moves the layout.

function scheduleLaunchKeep() {
  if (!appsHooks.ready()) return;
  clearTimeout(launchKeepTimer);
  launchKeepTimer = setTimeout(keepLaunchLayouts, 600);
}

// frames: the app frame being worked in is the one the focus is in.

// What each app frame held when last looked at, so that a window put into one
// afterwards -- by grouping it with the app, or dropping it in -- is connected to
// the app: a link slot of its that is empty and takes the app's type is filled,
// and the app's own empty slot that takes the newcomer's type (a variable catalog
// beside a Text Compose app is for that app, and the app knows its catalog). Only an
// empty one, once, when it arrives; what a person unlinks later stays unlinked.
// The first look after the layout was read only takes note.
const frameMembers = new Map();

let framesSeeded = false;
// apps: what is in each app frame after a layout was read is what it was
// read with: nothing arrives.

function connectNewcomers() {
  const now = new Map();
  let linked = false;
  eachGroup(layoutRoot(), (group) => {
    if (!group.app) return;
    const mainId = appItemOf(group);
    const main = mainId && getItem(mainId);
    if (!main) return;
    const members = new Set();
    eachOwnNode(group, (node) => {
      if (node.type !== "leaf" || isSlotLeaf(node)) return;
      const id = node.path[0];
      if (id && id !== main.id) members.add(id);
    });
    now.set(group.id, members);
    if (!framesSeeded) return;
    const before = frameMembers.get(group.id) || new Set();
    for (const id of members) {
      if (before.has(id)) continue;
      const item = getItem(id);
      if (!item) continue;
      // Both ways: the newcomer to the app, and the app to the newcomer.
      for (const [from, to] of [[item, main], [main, item]]) {
        for (const [key, spec] of linkSlotsOf(from)) {
          if (derivesFrom(spec.type, "list") || linkedIds(from, key, spec).length || !linkFits(spec, to.type)) continue;
          putLink(from, { key, spec, source: to.id });
          linked = true;
        }
      }
    }
  });
  frameMembers.clear();
  for (const [id, members] of now) frameMembers.set(id, members);
  framesSeeded = true;
  if (linked) appsChanged({ redraw: "all" });
}

// What a layout asks a window added by type to start with (`{add, tag, props}`)
// is not something an arrangement captured from a frame can say -- the frame
// holds the windows, not what they were started with -- so a captured layout
// takes it from the layout it replaces, by tag. Without that the first
// arrangement kept would lose it, and the next launch would open blank.
function carryProps(captured, base) {
  const props = new Map();
  const collect = (spec) => {
    if (!spec || typeof spec !== "object") return;
    if (Array.isArray(spec)) return spec.forEach(collect);
    if (typeof spec.add === "string" && spec.tag && spec.props) props.set(spec.tag, spec.props);
    (spec.children || []).forEach(collect);
    if (spec.bay && Array.isArray(spec.bay.sashes)) spec.bay.sashes.forEach(collect);
  };
  collect(base);
  if (!props.size || !captured || typeof captured !== "object") return captured;
  const out = JSON.parse(JSON.stringify(captured));
  const put = (spec) => {
    if (!spec || typeof spec !== "object") return;
    if (Array.isArray(spec)) return spec.forEach(put);
    if (typeof spec.add === "string" && spec.tag && props.has(spec.tag)) spec.props = props.get(spec.tag);
    (spec.children || []).forEach(put);
    if (spec.bay && Array.isArray(spec.bay.sashes)) spec.bay.sashes.forEach(put);
  };
  put(out);
  return out;
}

function keepLaunchLayouts() {
  connectNewcomers();
  // One layout per app, so with two of an app open only one may say what
  // it is: the one being worked in. Another one of the same app -- opened
  // from an older layout, or left as it was -- must not write over it (it
  // did: the first frame found was kept, whichever that was, and a second
  // Image Generation without its prompt link took the link out of the
  // layout every later one opened with). With several open and none of
  // them being worked in, none is kept. What is kept is how the app opens
  // next; the other frames of it stay as they are.
  const working = appsHooks.workingFrame();
  const frames = new Map();
  eachGroup(layoutRoot(), (group) => {
    if (!group.app || !appItemOf(group)) return;
    if (!frames.has(group.app)) frames.set(group.app, []);
    frames.get(group.app).push(group);
  });
  frames.forEach((groups, id) => {
    const group = groups.length === 1 ? groups[0] : groups.find((one) => one === working);
    if (!group) return;
    const def = appDef(id);
    if (!def || def.autoSave === false) return;
    const captured = captureFrameLayout(group, getItem(group.appItem));
    const now = captured && carryProps(captured, def.layout);
    if (!now || JSON.stringify(def.layout) === JSON.stringify(now)) return;
    setApp(id, { layout: now }).catch((error) => console.error("[mullion] layout was not kept:", error.message || error));
  });
}

// Nothing is written back before the layout has been read. The library
// cache warming up redraws every item, and a redraw is a save in the
// ordinary way -- but until init() has adopted something, the state is the
// empty one the module starts with, and that save would land on top of the
// layout on disk. Which it did, whenever the plugins took longer to load
// than the delay below.

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

// ---- Home's groups ------------------------------------------------------
// How Mullion Home sets out the apps: named groups, each a list of app
// ids, in order. null is Home as it comes -- every app in one group --
// and is what "back to the default" puts back. Kept in the profile as
// JSON text, for the reason launch layouts are: the profile merges
// objects key by key, and a list merged into the one before it would keep
// what was taken out.

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

// A restore is coming: a launch layout waiting to be kept is not kept.
function cancelLaunchKeep() {
  clearTimeout(launchKeepTimer);
}

// A layout was loaded: its frames are seen afresh, and items it brought are connected.
function reseedFrames() {
  framesSeeded = false;
  connectNewcomers();
}

export {
  cancelLaunchKeep,
  reseedFrames,
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
  LAUNCH_KEY,
  chosenLaunchLayout,
  launchLayoutOf,
  LINK_AT,
  launchLinksValid,
  launchAppLinksValid,
  launchSpecValid,
  setChosenLaunchLayout,
  captureLaunchLayout,
  captureFrameLayout,
  launchItemAt,
  resolveLaunch,
  applyLaunchLinks,
  launchingApps,
  launchNode,
  fitLaunched,
  toArrangement,
  appSettingSpec,
  appSettingOptions,
  appSettingValue,
  setAppSetting,
  linkFits,
  linksInto,
  linkSlotsOf,
  linkedIds,
  itemOfWindow,
  appItemsAround,
  linkTargetFor,
  linkOptionsFor,
  putLink,
  linksOf,
  unlinkApp,
  collapseOneWindowFrames,
  AUTO_LAYOUT_KEY,
  scheduleLaunchKeep,
  frameMembers,
  connectNewcomers,
  carryProps,
  keepLaunchLayouts,
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
};
