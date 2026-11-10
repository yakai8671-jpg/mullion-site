/* The layout beyond the bare tree (tree.js): changing it and saying so,
 * settling it, reading and writing it, and the steps others add to it
 * (registerPart, registerHolder, registerLayoutHook). docs/wiki/layout.md.
 * Moved out of core.js in migration stage "layout, second half". */
import {
  ROOT_ID, ROOT_DEFAULT_ITEM, DEFAULT_RATIO, MAX_NESTING, layoutRoot, setLayoutRoot, newWindowId,
  claimWindowIds, forgetWindowIds, isContainer, groupContent, countLeaves, eachLeaf, eachGroup, nodeIds,
  findParent, findLeaf, findNodeParent, containsNode, groupOf, replaceNode,
} from "./tree.js";
import { APPS, ITEM_TYPES, isStandalone, defaultFor, t, DEFAULT_ITEM_TYPE, MISSING_ITEM_TYPE, allItems, claimItemIds, createItem, forgetItemIds, getItem, removeItems, retireItem, setItems } from "./deps.js";

// Which side of the target the new window lands on, and how that maps
// onto a split node: axis, plus whether the newcomer is child 0 or 1.
export const DIRECTIONS = {
  up: { dir: "col", first: true, label: "↑" },
  down: { dir: "col", first: false, label: "↓" },
  left: { dir: "row", first: true, label: "←" },
  right: { dir: "row", first: false, label: "→" },
};

// Item types this shell used to call something else. A layout saved under
// the old name keeps working; the instance is read as the new type, and
// saved under it from then on. Renames only -- see readItems().
export const RENAMED_TYPES = {
  // The preset manager was a third screen doing what the chooser does:
  // browse what is saved of a type, and copy one in.
  preset: "chooser",
};

// What the layout says (its events): "change" after the tree changed
// ({ path } or { options }), "restore" around an undo or redo ({ phase:
// "before" } before anything moves, { phase: "swap" } just before the tree is
// replaced; said by whoever restores, through announceRestore), "pruned"
// after the items nothing holds were removed ({ live }: the ids still held),
// "loaded" after a layout was read (adopt).
let emitLayout = () => {};
export function connectEvents(emit) {
  emitLayout = emit;
}

/** Said by operations around an undo or redo: each ends what it had under way. */
export function announceRestore(phase) {
  emitLayout("restore", { phase });
}

// The rest of a layout file, by key, each part written and read by what owns
// it (registerPart): the port links, the bays, the cards' folds and sizes,
// the controls' states. Written in the order they were registered.
const layoutParts = [];

export function registerPart(key, part) {
  if (layoutParts.some((one) => one.key === key)) throw new Error(`layout part ${key} registered twice`);
  layoutParts.push({ key, ...part });
}

// Steps others add to what the layout does (registerLayoutHook):
//   nodeFields(saved, node)  -- copy a field of theirs when a node is read
//   settle()                 -- make their part whole when the tree settles,
//                               before the paths are repaired
//   repairPaths()            -- drop items that are gone from paths of theirs
//   oldFiles()               -- bring a tree read from an older file up to date,
//                               before the file's parts are read
//   frameAround(group, node) -- a group is made around a node
//   beforeRemove(node)       -- a subtree is about to leave the tree
//   lastInGroup(group, node) -- the last window of a group is closed: a node
//                               to put in its place keeps the group (null: no)
//   dropFromPath(item)       -- true: the item goes from a window's path when
//                               the paths are repaired
//   launch(type, props)      -- the node an app's launch spec opens as (apps; one)
const layoutHooks = { nodeFields: [], settle: [], repairPaths: [], oldFiles: [], frameAround: [], beforeRemove: [], lastInGroup: [], dropFromPath: [], launch: [] };

export function registerLayoutHook(kind, fn) {
  layoutHooks[kind].push(fn);
}

// What a launch spec in a content spec opens as (apps registers it).
export function launchVia(type, props) {
  return layoutHooks.launch[0](type, props);
}

// What holds items, each answering with the ids it holds (registerHolder):
// an item nothing holds is removed when the layout settles (pruneItems).
const layoutHolders = [];

export function registerHolder(fn) {
  layoutHolders.push(fn);
}

// Window and item ids are the lowest number not taken, so they stay as small
// as what is open: a counter only ever climbs, and one survivor with a high
// number kept every later layout's numbers up with it. Taken is what the
// layout was loaded with and everything handed out since -- an id given up in
// this session is not given again before the layout is loaded anew, so a
// timer, a cache or a half-made node that still names it is not met by a
// different window. Nothing outside the layout file names a window or an
// item by id (launch layouts and hotkeys use tags).
export function forgetIds() {
  forgetWindowIds();
  forgetItemIds();
}

export function splitNode(direction, target, incoming) {
  const { dir, first } = DIRECTIONS[direction] || DIRECTIONS.right;
  return {
    type: "split",
    dir,
    ratio: DEFAULT_RATIO,
    children: first ? [incoming, target] : [target, incoming],
  };
}

// A split replaces a node with a split of itself and the newcomer, wherever
// that node sits -- so splitting a window inside a group divides the room
// inside that group, and nothing outside it moves.
export function splitWindow(targetId, direction, incoming) {
  // A sash holds one window (or one group): beside what a bay shows is
  // beside the bay.
  const frame = groupOf(targetId);
  if (frame && frame.bay) targetId = frame.id;
  const found = findParent(targetId);
  if (!found) return false;
  const [parent, index] = found;
  const target = parent === null ? layoutRoot() : parent.children[index];
  replaceNode(parent, index, splitNode(direction, target, incoming));
  return true;
}

// Removing a leaf collapses its parent split into the surviving sibling,
// so the tree never keeps a split with a single child. The collapsed
// split's ratio goes with it -- the sibling inherits the whole slot.
//
// The last window inside a group takes the group with it: an empty frame is
// not something to leave behind on the stage.
export function removeWindow(id) {
  const found = findParent(id);
  if (!found) return false;
  const [parent, index] = found;
  const leaving = parent === null ? layoutRoot() : parent.children[index];
  for (const hook of layoutHooks.beforeRemove) hook(leaving);
  if (parent === null) {
    setLayoutRoot(null);
    return true;
  }
  if (parent.type === "group") {
    for (const hook of layoutHooks.lastInGroup) {
      const keep = hook(parent, parent.children[index]);
      if (keep) {
        parent.children[0] = keep;
        return true;
      }
    }
    return removeWindow(parent.id);
  }
  const sibling = parent.children[1 - index];
  const grand = findNodeParent(parent);
  if (grand === null || grand === undefined) setLayoutRoot(sibling);
  else grand.parent.children[grand.index] = sibling;
  return true;
}

// ---- groups ----------------------------------------------------------
// Grouping puts a frame around the target and the newcomer together. The
// target is the centre of it: it keeps its place in the tree and its share
// of the stage, and what arrives lands beside it *inside* the new frame --
// so nothing outside moves, because the room a group needs is room the
// target already had.
//
// Three cases, which are one act read at three depths:
//
//   a window                 wrap it, the newcomer beside it inside
//   a group                  already a frame, so divide what is in it
//   a group's whole contents the frame is already there too; divide it
//
// The last two are what keeps frames from piling up one inside another
// every time something is dropped into the same group twice.
export function groupWindows(targetId, incoming, direction = "right") {
  if (!incoming) return false;
  const found = findParent(targetId);
  if (!found) return false;
  const [parent, index] = found;
  const target = parent === null ? layoutRoot() : parent.children[index];
  if (containsNode(incoming, target)) return false;

  if (target.type === "group") {
    target.children[0] = splitNode(direction, groupContent(target), incoming);
    return true;
  }
  // The root frame is always there, so being its whole content is not
  // being framed already: grouping the only window on the stage makes a
  // group, which is what was asked for.
  // ...except a bay's: its sash holds one thing, so in with the window it
  // shows is a new group around the two, which is that one thing.
  if (parent !== null && parent.type === "group" && parent !== layoutRoot() && !parent.bay) {
    parent.children[0] = splitNode(direction, target, incoming);
    return true;
  }

  const group = { type: "group", id: newWindowId(), children: [] };
  // Collapsed is the frame's state, and the frame is the group's now.
  if (target.collapsed) {
    group.collapsed = true;
    delete target.collapsed;
  }
  for (const hook of layoutHooks.frameAround) hook(group, target);
  group.children.push(splitNode(direction, target, incoming));
  replaceNode(parent, index, group);
  return true;
}

// Move a window into another one's frame. Remove first, so a window leaving
// a group of two takes that group apart before the new one is formed.
export function groupWindow(sourceId, targetId, direction = "right") {
  if (sourceId === targetId) return false;
  const node = findLeaf(sourceId);
  const target = findLeaf(targetId);
  // Already all the group holds: in it is where it is.
  if (!node || !target || containsNode(node, target) || emptiesTarget(node, target)) return false;
  removeWindow(sourceId);
  const grouped = groupWindows(targetId, node, direction);
  commit();
  return grouped;
}

// ---- what a new window is ---------------------------------------------
// Every group may say what a window added inside it shows when nobody said
// otherwise -- a split, the empty space a closed window left, a window
// whose item went missing. A group that says nothing defers to the one
// around it, and so on out to the root, which always has an answer.
//
// It is kept on the group rather than on the shell because what "a new
// window" should be depends on where it is: beside an image generator it
// is the workflow launcher, out on the stage it is the dashboard.
export function knownType(type) {
  return typeof type === "string" && ITEM_TYPES[type] ? type : null;
}

// ---- the root frame ---------------------------------------------------
// The top of the tree is always a group, id "root": the stage is a frame
// like any other, and what makes it the outermost one is what a new window
// out here becomes. It is never drawn -- no bar, no edge -- because the
// page is its edge and nothing can move it, split beside it or close it.
//
// A layout saved without one is framed on the way to the screen. One saved
// by the version that drew the root with a numbered id is recognised by
// what only that frame had -- a group on top carrying a default of its own
// -- and renamed rather than framed a second time.
export function frameRoot() {
  const root = layoutRoot();
  if (!root || (root.type === "group" && root.id === ROOT_ID)) return;
  if (root.type === "group" && root.defaultItem && !nodeIds(root).includes(ROOT_ID)) {
    root.id = ROOT_ID;
    return;
  }
  setLayoutRoot({
    type: "group",
    id: ROOT_ID,
    defaultItem: ROOT_DEFAULT_ITEM,
    children: [root],
  });
}

export function freshRoot() {
  return {
    type: "group",
    id: ROOT_ID,
    defaultItem: ROOT_DEFAULT_ITEM,
    children: [createWindowNode(null, knownType(ROOT_DEFAULT_ITEM) || DEFAULT_ITEM_TYPE)],
  };
}

// A window leaving the group it is in, by that group's bar, when it is
// everything the group holds: there is then no group left to land beside.
export function emptiesTarget(node, target) {
  return target.type === "group" && groupContent(target) === node;
}

// So the group simply goes, and the window takes its place -- the same as
// a group left with nothing in it anywhere else. Collapsed was the frame's
// state, and the window is the frame now.
export function unframe(group, node) {
  const found = findParent(group.id);
  if (!found) return false;
  if (group.collapsed) node.collapsed = true;
  replaceNode(found[0], found[1], node);
  commit();
  return true;
}

export function moveWindow(sourceId, targetId, direction) {
  if (sourceId === targetId) return;
  const node = findLeaf(sourceId);
  const target = findLeaf(targetId);
  // A group cannot land beside one of its own windows: it would have to
  // contain the slot it was being dropped into.
  if (!node || !target || containsNode(node, target)) return;
  if (emptiesTarget(node, target)) return void unframe(target, node);
  removeWindow(sourceId);
  splitWindow(targetId, direction, node);
  commit();
}

export function ratioOf(node) {
  const value = Number(node.ratio);
  return Number.isFinite(value) ? value : DEFAULT_RATIO;
}

// An item lives while something holds it (registerHolder): a window's path, a
// screen, an app's frame, a sash kept aside. The others are removed (items),
// and what kept something of theirs is told (layout "pruned").
export function pruneItems() {
  const live = new Set();
  const hold = (id) => live.add(id);
  for (const holder of layoutHolders) holder(hold);
  removeItems((item) => live.has(item.id));
  emitLayout("pruned", { live });
}

export function createWindowNode(id, itemType = DEFAULT_ITEM_TYPE) {
  return {
    type: "leaf",
    id: id || newWindowId(),
    path: [createItem(itemType).id],
  };
}

// ---- content specs -----------------------------------------------------
// What goes into a frame, said as data rather than assembled a window at a
// time. This is what lets something launched from elsewhere -- a dashboard,
// a workflow -- arrive already arranged:
//
//   "clock.face"                              one window
//   ["notepad.editor", "terminal.shell"]      a row of two
//   { dir: "col", ratio: 0.3, children: [
//       "files.browser",
//       { dir: "row", children: ["a", "b"] }  ] }
//
// A list is a row unless `dir` says otherwise, `ratio` is honoured when a
// node has exactly two children (there is one seam to place), and anything
// deeper is another spec. The result is an ordinary tree, so everything
// that can be built this way can also be built by hand afterwards.
export function contentNode(spec, depth = 0) {
  if (depth > MAX_NESTING) throw new Error(`a group nested deeper than ${MAX_NESTING}`);
  if (spec === undefined || spec === null) return createWindowNode(null, DEFAULT_ITEM_TYPE);
  if (typeof spec === "string") {
    if (!ITEM_TYPES[spec]) throw new Error(`unknown item type: ${spec}`);
    return createWindowNode(null, spec);
  }
  if (isLaunch(spec)) return launchVia(spec.launch, spec.props || {});
  // A node made already -- an app inside an app (see resolveLaunch).
  if (typeof spec === "object" && !Array.isArray(spec) && spec.node && typeof spec.node === "object") return spec.node;
  // An item that already exists, shown in a window of its own -- how a
  // launch puts an instance and what it owns side by side.
  if (typeof spec === "object" && !Array.isArray(spec) && "item" in spec) {
    if (!getItem(spec.item)) throw new Error(`unknown item: ${spec.item}`);
    const leaf = { type: "leaf", id: newWindowId(), path: [spec.item] };
    // Arriving minimised, as a launch layout can ask.
    if (spec.collapsed === true) leaf.collapsed = true;
    // Its name in the app it is part of (a window added by type).
    if (typeof spec.tag === "string" && spec.tag) leaf.tag = spec.tag;
    return leaf;
  }
  if (Array.isArray(spec)) return contentNode({ children: spec }, depth);
  if (typeof spec !== "object") throw new Error("a group is made of item types");

  const children = Array.isArray(spec.children) ? spec.children : [];
  if (!children.length) throw new Error("a group needs at least one item");
  if (children.length === 1) return contentNode(children[0], depth + 1);

  const dir = spec.dir === "col" ? "col" : "row";
  const ratio = Number(spec.ratio);
  const pair = children.length === 2 && Number.isFinite(ratio) && ratio > 0 && ratio < 1;

  // Right-leaning, so each child gets an equal share of what is left beside
  // it: with three in a row the first cut is at a third, the second at a half.
  let node = contentNode(children[children.length - 1], depth + 1);
  for (let i = children.length - 2; i >= 0; i -= 1) {
    node = {
      type: "split",
      dir,
      ratio: pair ? ratio : 1 / (children.length - i),
      children: [contentNode(children[i], depth + 1), node],
    };
  }
  return node;
}

// Whether a spec names things that can be built, without building any of
// them. Placement has to fail where it was asked for rather than leave a
// mode open that turns out to do nothing when a guide is finally clicked.
export function checkContent(spec, depth = 0) {
  if (depth > MAX_NESTING) throw new Error(`a group nested deeper than ${MAX_NESTING}`);
  if (typeof spec === "string") {
    if (!ITEM_TYPES[spec]) throw new Error(`unknown item type: ${spec}`);
    return true;
  }
  if (spec && typeof spec === "object" && !Array.isArray(spec) && "item" in spec) {
    if (!getItem(spec.item)) throw new Error(`unknown item: ${spec.item}`);
    return true;
  }
  if (isLaunch(spec)) {
    const def = ITEM_TYPES[spec.launch];
    if (!def) throw new Error(`unknown item type: ${spec.launch}`);
    for (const [key, value] of Object.entries(spec.props || {})) {
      const prop = (def.properties || {})[key];
      if (!prop || prop.read) throw new Error(`${spec.launch} has no property ${key} to set`);
    }
    return true;
  }
  const children = Array.isArray(spec)
    ? spec
    : spec && typeof spec === "object"
      ? spec.children
      : null;
  if (!Array.isArray(children) || !children.length) {
    throw new Error("a group needs at least one item");
  }
  children.forEach((child) => checkContent(child, depth + 1));
  return true;
}

// A frame around that content. Even one window is a real group: the frame
// is the point -- it is what the next window dropped in there goes inside.
//
// A spec object may carry `defaultItem`, which is the group's own: what a
// window added inside it later becomes.
export function createGroupNode(spec) {
  const group = { type: "group", id: newWindowId(), children: [contentNode(spec)] };
  if (spec && typeof spec === "object" && !Array.isArray(spec) && knownType(spec.defaultItem)) {
    group.defaultItem = spec.defaultItem;
    if (typeof spec.appItem === "string" && spec.appItem) group.appItem = spec.appItem;
  }
  return group;
}

// What a side guide drops. One item type is one window -- or whatever that
// type says it opens as (see launchNode) -- because wrapping a single
// window in a frame nobody asked for would be a surprise; anything with an
// arrangement to it arrives as a group.
//
// `{ launch: type, props }` is the same as the name alone, with values for
// the new instance -- see launchNode.
export function placedNode(spec) {
  if (typeof spec === "string") return launchVia(spec);
  if (isLaunch(spec)) return launchVia(spec.launch, spec.props || {});
  // An item that already exists goes into a window, not into a frame of
  // its own: this is one window being put back, not an arrangement being
  // opened, and a group around a single window is a frame nobody asked for.
  if (spec && typeof spec === "object" && !Array.isArray(spec) && "item" in spec) return contentNode(spec);
  return createGroupNode(spec);
}

export function isLaunch(spec) {
  return Boolean(spec) && typeof spec === "object" && !Array.isArray(spec) && typeof spec.launch === "string";
}

// ---- window paths ------------------------------------------------------
// A group has a path too, of screens shown over the whole of it -- its
// window settings, and whatever is opened from them. Empty (absent) while
// it shows its windows; the group itself is the first step back.
export const screensOf = (node) => (node && node.type === "group" && Array.isArray(node.screens) ? node.screens : []);

export const setScreens = (group, screens) => {
  if (screens.length) group.screens = screens;
  else delete group.screens;
};

// One window's path changed -- something opened in it, or it stepped back --
// and nothing else did: only that window is drawn again. A full draw rebuilds
// every window on the stage, which loses what a window holds that is not in
// the layout: a text scrolled to somewhere, a field's caret.
// Only this window's path changed (layout): say so.
export function commitPath(windowId, before) {
  emitLayout("change", { path: { windowId, before } });
}

export function truncatePath(windowId, index) {
  const leaf = findLeaf(windowId);
  // A group's steps are the group (0) and then its screens.
  if (leaf && leaf.type === "group") {
    const screens = screensOf(leaf);
    if (index < 0 || index >= screens.length) return;
    setScreens(leaf, screens.slice(0, index));
    commit();
    return;
  }
  if (!leaf || leaf.type !== "leaf" || index < 0 || index >= leaf.path.length - 1) return;
  const before = leaf.path;
  leaf.path = leaf.path.slice(0, index + 1);
  commitPath(windowId, before);
}

// ---- window facts, as typed properties --------------------------------
export function describeNode(node) {
  if (node.type === "leaf") return node.id;
  return node.type === "group" ? `group(${countLeaves(node)})` : `split(${node.dir})`;
}

// ---- serialization ----------------------------------------------------
export function serialize() {
  return {
    // 4 is the first that can hold a group; 3 and below are read
    // unchanged, having only leaves and splits to read.
    version: 4,
    // A parked instance is written back as what it really is, so a layout
    // saved without the plugin installed still restores fully with it.
    items: allItems().map((item) =>
      item.missing
        ? { id: item.id, type: item.missing.type, props: item.missing.props }
        : item
    ),
    root: layoutRoot(),
    ...Object.fromEntries(layoutParts.map((part) => [part.key, part.save()])),
  };
}

export function validateNode(node) {
  if (node === null) return null;
  if (!node || typeof node !== "object") throw new Error("node must be an object");
  if (node.type === "leaf") {
    if (typeof node.id !== "string" || !node.id) throw new Error("leaf needs a string id");
    // A v1/v2 leaf carried a single itemId; a path is the same thing with
    // room to drill into children.
    const path = node.path === undefined ? (node.itemId ? [node.itemId] : []) : node.path;
    if (!Array.isArray(path)) throw new Error("leaf path must be an array");
    if (path.some((id) => typeof id !== "string" || !id)) {
      throw new Error("leaf path must hold item ids");
    }
    const leaf = { type: "leaf", id: node.id, path: [...path] };
    // Collapsed is authored state -- it is how you left the layout -- so it
    // is saved, and only when true.
    if (node.collapsed === true) leaf.collapsed = true;
    // A card control filling the window (see `expand`).
    if (node.expanded === true) leaf.expanded = true;
    // The app a one-window app's window is (see apps), and its name in the
    // app it is part of.
    if (typeof node.app === "string" && node.app) leaf.app = node.app;
    if (typeof node.tag === "string" && node.tag) leaf.tag = node.tag;
    for (const field of layoutHooks.nodeFields) field(node, leaf);
    return leaf;
  }
  if (node.type === "group") {
    if (typeof node.id !== "string" || !node.id) throw new Error("group needs a string id");
    if (!Array.isArray(node.children) || node.children.length !== 1) {
      throw new Error("group needs exactly 1 child");
    }
    const content = validateNode(node.children[0]);
    if (content === null) throw new Error("group child cannot be null");
    // Collapsed belongs to the frame, and inside a group the frame is the
    // group's -- so what it holds is never collapsed in its own right.
    delete content.collapsed;
    const group = { type: "group", id: node.id, children: [content] };
    if (node.collapsed === true) group.collapsed = true;
    // Kept as written even when no type answers to it: the plugin that
    // brought it may be installed again, and defaultItemFor() skips it
    // until then.
    if (typeof node.defaultItem === "string" && node.defaultItem) {
      group.defaultItem = node.defaultItem;
    }
    if (typeof node.appItem === "string" && node.appItem) group.appItem = node.appItem;
    if (typeof node.bay === "string" && node.bay) group.bay = node.bay;
    if (typeof node.app === "string" && node.app) group.app = node.app;
    if (typeof node.tag === "string" && node.tag) group.tag = node.tag;
    for (const field of layoutHooks.nodeFields) field(node, group);
    if (Array.isArray(node.screens)) {
      const screens = node.screens.filter((id) => typeof id === "string" && id);
      if (screens.length) group.screens = screens;
    }
    return group;
  }
  if (node.type === "split") {
    if (node.dir !== "row" && node.dir !== "col") throw new Error('dir must be "row" or "col"');
    if (!Array.isArray(node.children) || node.children.length !== 2) {
      throw new Error("split needs exactly 2 children");
    }
    const children = node.children.map(validateNode);
    if (children.some((child) => child === null)) throw new Error("split child cannot be null");
    const ratio = node.ratio === undefined ? DEFAULT_RATIO : Number(node.ratio);
    if (!Number.isFinite(ratio) || ratio <= 0 || ratio >= 1) {
      throw new Error("ratio must be between 0 and 1");
    }
    return { type: "split", dir: node.dir, ratio, children };
  }
  throw new Error(`unknown node type: ${node.type}`);
}

export function validateItems(raw) {
  if (raw === undefined) return []; // v1 layouts predate items
  if (!Array.isArray(raw)) throw new Error("items must be an array");
  const seen = new Set();
  const startsAtOwner = [];
  const items = raw.map((item) => {
    if (!item || typeof item !== "object") throw new Error("item must be an object");
    if (typeof item.id !== "string" || !item.id) throw new Error("item needs a string id");
    if (seen.has(item.id)) throw new Error(`duplicate item id: ${item.id}`);
    seen.add(item.id);
    if (item.props !== undefined && (typeof item.props !== "object" || item.props === null)) {
      throw new Error("item props must be an object");
    }

    // A type this shell has renamed. Only renames belong here: a type that
    // changed its name is the same type, so an instance of it should carry
    // on working rather than become a placeholder. Anything whose meaning
    // changed does not get an alias -- it is genuinely missing.
    const type = RENAMED_TYPES[item.type] || item.type;

    // A type we do not have is almost always a plugin that is not installed
    // here. Park the instance in a placeholder that carries the original
    // type and properties untouched, so installing the plugin brings it
    // back and saving in the meantime loses nothing.
    const def = ITEM_TYPES[type];
    if (!def) {
      return {
        id: item.id,
        type: MISSING_ITEM_TYPE,
        props: {},
        missing: { type: item.type, props: item.props ? { ...item.props } : {} },
      };
    }

    // Values are filled in from the schema, so a file may carry only the
    // ones it cares about -- and a property added to the type since it was
    // written still shows up, with its default.
    const props = {};
    for (const [key, spec] of Object.entries(def.properties || {})) {
      if (spec.read) continue; // backed by an API, never by the file
      const stored = item.props ? item.props[key] : undefined;
      props[key] = stored === undefined ? defaultFor(spec) : stored;
    }
    return { id: item.id, type, props };
  });
  return items;
}

// Drop path entries whose item is gone, and never leave a window with
// nothing to show.
export function repairPaths() {
  eachLeaf(layoutRoot(), (leaf) => {
    leaf.path = leaf.path.filter((itemId) => {
      const item = getItem(itemId);
      if (!item) return false;
      return !layoutHooks.dropFromPath.some((drop) => drop(item));
    });
    if (!leaf.path.length) leaf.path = [...defaultLeafBeside(leaf.id).path];
  });
  eachGroup(layoutRoot(), (group) => setScreens(group, screensOf(group).filter((itemId) => getItem(itemId))));
  for (const repair of layoutHooks.repairPaths) repair();
}

export function adopt(data) {
  if (!data || typeof data !== "object") throw new Error("expected a JSON object");
  const root = validateNode(data.root ?? null);
  // Groups are counted with the windows: a group answers to the same
  // lookups one does, so the two cannot share a name.
  const windowIds = nodeIds(root);
  if (new Set(windowIds).size !== windowIds.length) throw new Error("duplicate window ids");
  const items = validateItems(data.items);

  // Taken from what is there, not from the high-water mark the file kept:
  // screens and pickers made and thrown away in a session each took a
  // number, and carrying those over made the ids climb with every launch.
  forgetIds();
  claimWindowIds(windowIds);
  claimItemIds(items.map((item) => item.id));
  for (const item of allItems()) retireItem(item);
  setLayoutRoot(root);
  setItems(items);

  for (const update of layoutHooks.oldFiles) update();

  const known = { windowIds: new Set(windowIds) };
  for (const part of layoutParts) part.load(data[part.key], known);

  repairPaths();
  pruneItems();
  emitLayout("loaded", {});
}

// A change of layout keeps the bodies of the windows it leaves alone (see
// render). `commit({ keep: false })` draws everything again.
// The layout changed (layout): say so.
export function commit(options = { keep: true }) {
  emitLayout("change", { options });
}

// The tree made whole after a change: the root frame, the bays, the paths,
// and the items nothing holds any more.
export function settleLayout() {
  frameRoot();
  for (const settle of layoutHooks.settle) settle();
  repairPaths();
  pruneItems();
}

export function layoutText() {
  return JSON.stringify(serialize(), null, 2);
}

export const isPlainObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);

export function singleLayout(spec) {
  return !spec || spec === "self" || (isPlainObject(spec) && spec.self === true);
}

// Whether a layout is the main window alone, however it is written: a
// one-window frame kept from the screen is {children: ["self"]}.
export function oneWindowLayout(spec) {
  if (singleLayout(spec)) return true;
  return isPlainObject(spec) && Array.isArray(spec.children) && spec.children.length === 1 && oneWindowLayout(spec.children[0]);
}

// The item a window shows now: the last of its path, or a group's last screen.
export function currentItemId(leaf) {
  if (leaf.type === "group") {
    const screens = screensOf(leaf);
    return screens[screens.length - 1];
  }
  return leaf.path[leaf.path.length - 1];
}
