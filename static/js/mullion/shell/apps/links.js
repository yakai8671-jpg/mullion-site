/* App links (an app that depends on another one: its slots, what may fill
 * them, putting and taking links) and keeping launch layouts as frames change.
 * Split out of apps.js (2026-11-11); part of the apps module. */
import { ITEM_TYPES, MAX_NESTING, ROOT_ID, bindProperty, commit, currentItemId, derivesFrom, eachGroup, findLeaf, getItem, groupOf, isSlotLeaf, layoutRoot, oneWindowLayout, screensOf, t } from "./deps.js";
import { announceAppsChange, appDef, appItemOf, appsHooks, eachOwnNode, linkFits, setApp } from "./apps.js";
import { captureFrameLayout } from "./launch.js";

// ---- app links, and keeping launch layouts as frames change ---------------
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
export function linkSlotsOf(item) {
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
export function linkedIds(item, key, spec) {
  const value = item.props[key];
  if (derivesFrom(spec.type, "list")) return (Array.isArray(value) ? value : []).filter((one) => typeof one === "string");
  return typeof value === "string" && value ? [value] : [];
}

// The item a dragged window stands for: what it shows, or for a frame the
// app it is.
export function itemOfWindow(windowId) {
  const node = findLeaf(windowId);
  if (!node) return null;
  if (node.type === "group") return getItem(appItemOf(node)) || null;
  return getItem(currentItemId(node)) || null;
}

// The apps whose frames a window sits in, the nearest first: what a window
// of an app stands for, once it does not fit by itself. It is where the
// window is that says so, not who owns it -- a window added to an app's frame
// (a preview, a prompt editor) stands for the app as much as one it owns.
export function appItemsAround(windowId) {
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
export function linkTargetFor(from, spec, toId) {
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
export function linkOptionsFor(host, dropped) {
  return linkSlotsOf(host)
    .map(([key, spec]) => ({ key, spec, source: linkTargetFor(dropped, spec, host.id), name: t(spec.label || key) }))
    // Only what would change something: a slot that already holds the item
    // (an app's own windows are connected by its layout) has nothing to offer.
    .filter((option) => option.source && !linkedIds(host, option.key, option.spec).includes(option.source));
}

// Link `source` to the host's slot, once: a list takes it unless it is
// already in it, a ref is replaced.
export function putLink(host, { key, spec, source }) {
  const prop = bindProperty(host, key, null);
  if (derivesFrom(spec.type, "list")) {
    const now = linkedIds(host, key, spec);
    if (!now.includes(source)) prop.set([...now, source]);
  } else prop.set(source);
}

// The links an item holds, as {key, spec, to}, those whose app is still there.
export function linksOf(item) {
  return linkSlotsOf(item)
    .flatMap(([key, spec]) => linkedIds(item, key, spec).map((to) => ({ key, spec, to })))
    .filter((one) => one.to && getItem(one.to));
}

// Let go of one link.
export function unlinkApp(item, { key, spec, to }) {
  if (derivesFrom(spec.type, "list")) {
    bindProperty(item, key, null).set(linkedIds(item, key, spec).filter((one) => one !== to));
  } else bindProperty(item, key, null).set(null);
  announceAppsChange({ redraw: "all" });
}

// A frame around one window of an app whose layout is one window. Not the
// root, a bay's frame, or one with screens open over it; and only when the
// window is the app's own item, so a frame someone made by hand around
// another window stays as it is.
export function collapseOneWindowFrames(node) {
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
export const AUTO_LAYOUT_KEY = "autoSaveLayout";

let launchKeepTimer = null;

// apps: an app whose windows moved keeps its new launch layout.
// apps: a launch layout about to be kept is not, when an undo or redo moves the layout.

export function scheduleLaunchKeep() {
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
export const frameMembers = new Map();

let framesSeeded = false;
// apps: what is in each app frame after a layout was read is what it was
// read with: nothing arrives.

export function connectNewcomers() {
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
  if (linked) announceAppsChange({ redraw: "all" });
}

// What a layout asks a window added by type to start with (`{add, tag, props}`)
// is not something an arrangement captured from a frame can say -- the frame
// holds the windows, not what they were started with -- so a captured layout
// takes it from the layout it replaces, by tag. Without that the first
// arrangement kept would lose it, and the next launch would open blank.
export function carryProps(captured, base) {
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

export function keepLaunchLayouts() {
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


// A restore is coming: a launch layout waiting to be kept is not kept.
export function cancelLaunchKeep() {
  clearTimeout(launchKeepTimer);
}

// A layout was loaded: its frames are seen afresh, and items it brought are connected.
export function reseedFrames() {
  framesSeeded = false;
  connectNewcomers();
}
