/* Launch layouts people chose: how an app's windows are laid out when it
 * opens, captured and kept per app. Split out of apps.js (2026-11-11); part of
 * the apps module. */
import { APPS, ITEM_TYPES, MAX_NESTING, allLinks, bayRecord, bindProperty, canLink, canShare, createGroupNode, createItem, createWindowNode, derivesFrom, dropLinksAmong, eachGroup, getItem, groupContent, isStandalone, layoutRoot, newWindowId, oneWindowLayout, placeLink, portAddress, singleLayout, slotOnly } from "./deps.js";
import { appDef, appItemOf, appOverride, bayFromSpec, copyValue, freeTag, keepAppValues, keptAppValues, launchAppNode, setApp } from "./apps.js";
import { linkSlotsOf, linkedIds } from "./links.js";

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
export const LAUNCH_KEY = "launchLayouts";

// Kept for the callers that still ask by type: a type's chosen layout is
// its built-in app's overridden one now (see apps).
export function chosenLaunchLayout(type) {
  const over = appOverride(type);
  return over && launchSpecValid(over.layout) ? over.layout : null;
}

export function launchLayoutOf(type) {
  const own = APPS[type] && APPS[type].layout ? APPS[type].layout : null;
  const app = appDef(type);
  return own ? (app && !singleLayout(app.layout) ? app.layout : own) : null;
}

// The property links a launch layout carries, on its outermost object:
// [{to: {at, key, entry?, part?}, from: {...}}], each end's `at` being
// "self" or a path of owners, the way its windows are named; "+tag" a window or
// app added to the frame, and "+tag/owner.path" an item that one owns.
export const LINK_AT = /^(self|\+[A-Za-z0-9_]+(\/[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)*)?|[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)*)$/;

export function launchLinksValid(list) {
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
export function launchAppLinksValid(list) {
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
export function launchSpecValid(spec, depth = 0) {
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
export function setChosenLaunchLayout(type, spec) {
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
export function captureLaunchLayout(appItemId) {
  let frame = null;
  eachGroup(layoutRoot(), (group) => {
    if (!frame && group.appItem === appItemId && appItemOf(group)) frame = group;
  });
  if (!frame) return null;
  return captureFrameLayout(frame, getItem(appItemId));
}

// The same for any frame, around the item that is its main one.
export function captureFrameLayout(frame, app) {
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
export function launchItemAt(app, at, tags = new Map()) {
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
export function resolveLaunch(app, spec, ctx = { tags: new Map(), take: () => null }) {
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
export function applyLaunchLinks(app, spec, replace = false, tags = new Map()) {
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
export const launchingApps = new Set();

// apps: a launch spec inside a content spec opens as the app's launch.

export function launchNode(type, given = {}, appId = null, options = {}) {
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
export function fitLaunched(node, hostDefault) {
  return node && node.type === "group" && node.defaultItem && node.defaultItem === hostDefault
    ? node.children[0]
    : node;
}

// A spec as an object, so a group-level key can ride along with it.
export function toArrangement(spec) {
  if (Array.isArray(spec)) return { children: spec };
  if (spec && typeof spec === "object" && Array.isArray(spec.children)) return spec;
  return { children: [spec] };
}

// A move is a remove followed by a split. The leaf node itself is reused,
// so the window keeps its id and the whole item path it was showing.
// Trade two windows' places. Everything about a window travels with it --
// what it is showing, whether it is collapsed -- and only its position in
// the tree changes, so the two frames keep their ids and their sizes.
