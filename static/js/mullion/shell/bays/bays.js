/* bays: moved out of core.js (docs/wiki/migration.md). */
import { commit, containsNode, currentItemId, eachGroup, eachLeaf, findLeaf, findParent, groupContent, groupOf, isContainer, layoutRoot, newWindowId, nodeIds, ratioOf, removeWindow, replaceNode, setLayoutRoot, splitNode, splitWindow, validateNode, registerPart, registerHolder, registerLayoutHook, claimWindowIds, screensOf, createItem, getItem, itemIcon, itemLabel, t } from "./deps.js";
import { writeValue } from "./deps.js";

// What bays says: "change" with { touched } after a bay or a sash changed,
// { sash: { frame, ahead, wasShut } } after another sash of a bay on screen
// came into view.
let baysChanged = () => {};
export function connectEvents(emit) {
  baysChanged = (change) => emit("change", change);
}

// What bays puts into others: its part of a layout file, what it holds, and
// its steps in removing, settling and repairing the layout.
export function registerWithOthers() {
  // bays: the bays and the sashes they keep off screen (the active one of a bay
  // on screen is the frame's content, in the layout's root).
  registerPart("bays", {
    save: () => bays.map((record) => ({ ...record, sashes: record.sashes.map((sash) => ({ ...sash })) })),
    load(saved, { windowIds }) {
      bays = readBays(saved, windowIds);
      // A window id a sash keeps aside is taken too.
      claimWindowIds(stashedIds());
    },
  });
  // bays: a bay going off screen keeps what its sash held; the last window of a
  // bay is replaced by its placeholder (closing the placeholder itself is taking
  // the bay off screen).
  registerLayoutHook("beforeRemove", (node) => eachGroup(node, (group) => group.bay && stashFrame(group)));
  registerLayoutHook("lastInGroup", (group, node) => (group.bay && !isSlotLeaf(node) ? slotLeaf(group.bay) : null));

  // bays: made whole when the layout settles; a sash kept aside loses items that are gone.
  registerLayoutHook("settle", () => normalizeBays());
  registerLayoutHook("repairPaths", () =>
    eachStashedLeaf((leaf) => {
      leaf.path = leaf.path.filter((itemId) => getItem(itemId));
    }),
  );
  // bays: a sash kept aside holds what its windows show.
  registerHolder((hold) => {
    eachStashedLeaf((leaf) => leaf.path.forEach(hold));
    eachStashedGroup((group) => screensOf(group).forEach(hold));
  });
}

// What bays asks of others while it is still core.js (registerBaysHook):
//   label(node)              -- what a sash's window or group is called (frames)
//   collapsed(frame)         -- whether a bay's frame is folded shut (frames)
//   stepping(bayId, step)    -- run step() while the focus follows the bay's
//                               new sash (frames)
// and what it says (onBays): { touched } after a bay or a sash changed
// (drawn, saved), { sash: { frame, ahead, wasShut } } after another sash of a
// bay on screen came into view (frames slides it in). They become the bays
// module's slots and event.
export const baysHooks = {
  label: (node) => node.id,
  collapsed: () => false,
  stepping: (bayId, step) => step(),
};

export function registerBaysHook(kind, fn) {
  baysHooks[kind] = fn;
}

// How a bay's sashes slide, as the bay says: "auto" -- sideways, or up and
// down when the bay stands in a column -- or one of the four ways named for
// where the next sash comes from (see slideSash).
export const BAY_SLIDES = ["auto", "left", "right", "up", "down"];

// ---- bays -------------------------------------------------------------
// A bay is one place on screen whose windows can be swapped out for
// others without leaving any of them standing about: a set of sashes, one
// of them in the opening at a time, the way the panes of a sliding window
// share one frame. Each sash is an arrangement of windows; the bay shows
// the active one, and the rest are kept off screen, alive, until they are
// slid back in.
//
// On screen a bay is a frame (a group node carrying `bay: <bayId>`) drawn
// without a bar of its own: its windows look like any others, and only the
// "next sash" button on their bars says where they are. What the active
// sash holds lives in the tree, as that frame's content; the other sashes
// keep theirs in the bay's record (`content`, a node or null). So being in
// a sash is being inside its bay's frame: dropping a window next to one of
// its windows, or on the placeholder an empty sash shows (the bay slot),
// is registering it, and taking it out is taking it off.
//
// The bays are the shell's, saved with the layout. The Bays app edits them
// through bays:read / bays:write.
export const BAY_SLOT_TYPE = "bayslot";

let bays = []; // [{id, name, active, sashes: [{id, name, content}]}]
// A layout started afresh has no bays.
export function clearBays() {
  bays = [];
}

export function bayRecord(id) {
  return bays.find((one) => one.id === id) || null;
}

// The frame showing a bay, if it is on screen.
export function bayFrame(bayId) {
  let found = null;
  eachGroup(layoutRoot(), (group) => {
    if (!found && group.bay === bayId) found = group;
  });
  return found;
}

// The bay frame a node is inside, if any (not the node itself).
export function bayOf(id) {
  for (let group = groupOf(id); group; group = groupOf(group.id)) {
    if (group.bay) return group;
  }
  return null;
}

export function isSlotLeaf(node) {
  if (!node || node.type !== "leaf" || !node.path.length) return false;
  const item = getItem(node.path[0]);
  return Boolean(item && item.type === BAY_SLOT_TYPE);
}

// Whether an arrangement is nothing but the placeholder.
export function slotOnly(node) {
  let real = false;
  eachLeaf(node, (leaf) => {
    if (!isSlotLeaf(leaf)) real = true;
  });
  return !real;
}

export function slotLeaf(bayId) {
  const item = createItem(BAY_SLOT_TYPE);
  writeValue(item, "bay", bayId, { by: "bays" });
  return { type: "leaf", id: newWindowId(), path: [item.id] };
}

export function activeSash(record) {
  return (record && record.sashes.find((one) => one.id === record.active)) || null;
}

// What the frame shows, put away in the active sash.
export function stashFrame(frame) {
  const sash = activeSash(bayRecord(frame.bay));
  const content = groupContent(frame);
  if (sash) sash.content = content && !slotOnly(content) ? content : null;
}

// What the frame is to show: the active sash's arrangement, taken out of
// the record (it lives in the tree while it shows), or the placeholder.
export function takeContent(record) {
  const sash = activeSash(record);
  const content = sash && sash.content;
  if (sash) sash.content = null;
  if (!content) return slotLeaf(record.id);
  delete content.collapsed; // a frame's content is never collapsed itself
  // One thing to a sash: several kept from before go in as one group.
  if (content.type === "split") return { type: "group", id: newWindowId(), children: [content] };
  return content;
}

export function nextBayId(list, prefix) {
  let n = 1;
  while (list.some((one) => one.id === `${prefix}${n}`)) n += 1;
  return `${prefix}${n}`;
}

export function bayTouched() {
  baysChanged({ touched: true });
}

export function needBay(id) {
  const record = bayRecord(id);
  if (!record) throw new Error(`unknown bay: ${id}`);
  return record;
}

export function needSash(record, sashId) {
  const sash = record.sashes.find((one) => one.id === sashId);
  if (!sash) throw new Error(`unknown sash: ${sashId}`);
  return sash;
}

export function addBay(name = "") {
  const id = nextBayId(bays, "b");
  bays.push({ id, name: String(name || "") || t("mu.bay.nameN", { n: bays.length + 1 }), active: "", slide: "auto", sashes: [] });
  bayTouched();
  return id;
}

// Which way the sashes of a bay slide (one of BAY_SLIDES).
export function setBaySlide(id, mode) {
  if (!BAY_SLIDES.includes(mode)) throw new Error(`unknown slide: ${mode}`);
  needBay(id).slide = mode;
  // The bars' buttons point the way, so they are drawn again.
  commit();
  return true;
}

export function renameBay(id, name) {
  needBay(id).name = String(name || "");
  // The placeholder and the bars name the bay.
  commit();
  return true;
}

// Gone, with every window its sashes held.
export function removeBay(id) {
  needBay(id);
  const frame = bayFrame(id);
  if (frame) removeWindow(frame.id);
  bays = bays.filter((one) => one.id !== id);
  commit();
  return true;
}

// A new sash is the active one at once -- empty, so the bay shows its
// placeholder, ready for windows to be dropped on. Whether the bay still
// has to be put on screen is the caller's to act on (`placed`).
export function addSash(bayId, name = "") {
  const record = needBay(bayId);
  const sash = {
    id: nextBayId(record.sashes, "s"),
    name: String(name || "") || t("mu.bay.sashN", { n: record.sashes.length + 1 }),
    content: null,
  };
  record.sashes.push(sash);
  activateSash(bayId, sash.id);
  return { id: sash.id, placed: Boolean(bayFrame(bayId)) };
}

export function renameSash(bayId, sashId, name) {
  needSash(needBay(bayId), sashId).name = String(name || "");
  commit();
  return true;
}

export function removeSash(bayId, sashId) {
  const record = needBay(bayId);
  needSash(record, sashId);
  if (record.active === sashId) {
    if (record.sashes.length > 1) {
      const index = record.sashes.findIndex((one) => one.id === sashId);
      activateSash(bayId, record.sashes[(index + 1) % record.sashes.length].id);
    } else {
      const frame = bayFrame(bayId);
      record.active = "";
      if (frame) frame.children[0] = slotLeaf(bayId);
    }
  }
  record.sashes = record.sashes.filter((one) => one.id !== sashId);
  commit();
  return true;
}

// The sashes in the order given (ids; any left out keep their place after).
export function orderSashes(bayId, ids) {
  const record = needBay(bayId);
  const wanted = (Array.isArray(ids) ? ids : []).map((id) => record.sashes.find((one) => one.id === id)).filter(Boolean);
  const rest = record.sashes.filter((one) => !wanted.includes(one));
  record.sashes = [...new Set([...wanted, ...rest])];
  // The next-sash buttons say whether there is a next one.
  commit();
  return true;
}

export function activateSash(bayId, sashId, forward = null) {
  const record = needBay(bayId);
  needSash(record, sashId);
  if (record.active === sashId) {
    commit();
    return true;
  }
  const index = (id) => record.sashes.findIndex((one) => one.id === id);
  const ahead = forward === null ? index(sashId) > index(record.active) : forward;
  const frame = bayFrame(bayId);
  const wasShut = Boolean(frame && baysHooks.collapsed(frame));
  if (frame) stashFrame(frame);
  record.active = sashId;
  if (!frame) {
    commit();
    return true;
  }
  frame.children[0] = takeContent(record);
  baysChanged({ sash: { frame, ahead, wasShut } });
  return true;
}

// The next sash along, round to the first again; or the one before, round
// to the last (`step` is 1 or -1).
export function stepSash(bayId, step) {
  const record = bayRecord(bayId);
  if (!record || record.sashes.length < 2) return false;
  const index = record.sashes.findIndex((one) => one.id === record.active);
  const count = record.sashes.length;
  // Always the way asked, round the ends included. The window that held the
  // focus has gone with its sash: the focus goes on to the one now shown.
  return baysHooks.stepping(bayId, () => activateSash(bayId, record.sashes[(index + step + count) % count].id, step > 0));
}

export function nextSash(bayId) {
  return stepSash(bayId, 1);
}

export function prevSash(bayId) {
  return stepSash(bayId, -1);
}

// Off screen, keeping what its sash held (removeWindow puts it away).
export function unplaceBay(bayId) {
  needBay(bayId);
  const frame = bayFrame(bayId);
  if (!frame) return false;
  removeWindow(frame.id);
  commit();
  return true;
}

// A node in the placeholder's place: the bay's active sash now holds it.
export function putInSlot(slotId, node) {
  const found = findParent(slotId);
  if (!found || !found[0]) return false;
  replaceNode(found[0], found[1], node);
  return true;
}

// A window on screen moved into a bay through its placeholder.
export function registerInBay(sourceId, slotId) {
  const node = findLeaf(sourceId);
  const slot = findLeaf(slotId);
  if (!node || !slot || node === slot || containsNode(node, slot) || !isSlotLeaf(slot)) return false;
  removeWindow(sourceId);
  const placed = putInSlot(slotId, node);
  commit();
  return placed;
}

export function findIn(node, id) {
  let hit = null;
  (function walk(at) {
    if (hit || !at) return;
    if (at.id === id) hit = at;
    else if (isContainer(at)) at.children.forEach(walk);
  })(node);
  return hit;
}

// A sash's arrangement as the layout preview draws one: a window, or the
// windows of the group the sash holds, as they are laid out in it.
export function bayPreviewTree(node) {
  if (!node || slotOnly(node)) return null;
  if (node.type === "group") return bayPreviewTree(groupContent(node));
  if (node.type === "split") {
    const children = node.children.map(bayPreviewTree);
    if (!children[0] || !children[1]) return children[0] || children[1];
    return { dir: node.dir, ratio: ratioOf(node), children };
  }
  const itemId = currentItemId(node);
  const item = getItem(itemId);
  return { label: itemLabel(itemId), icon: itemIcon(item), collapsed: Boolean(node.collapsed), missing: !item };
}

// What a sash holds, by name: its window's item, or its group's name.
export function sashUnit(content) {
  if (!content || slotOnly(content)) return null;
  if (content.type === "group" || content.type === "leaf") return { id: content.id, label: baysHooks.label(content) };
  return null;
}

// A node taken out of an arrangement kept aside: the split it was in gives
// way to its sibling. Returns what is left (null for nothing).
export function removeFromContent(content, id) {
  if (!content) return null;
  if (content.id === id) return null;
  if (content.type !== "split") return content;
  const [a, b] = content.children;
  if (a.id === id) return b;
  if (b.id === id) return a;
  content.children = [removeFromContent(a, id), removeFromContent(b, id)];
  return content;
}

// Out of a sash, and onto the screen beside the bay (beside everything,
// when the bay itself is off screen). Only what is registered -- a window
// or group the sash holds directly -- not something inside one of those.
export function unregisterFromSash(bayId, sashId, nodeId) {
  const record = needBay(bayId);
  const sash = needSash(record, sashId);
  const frame = bayFrame(bayId);
  let node;
  if (sash.id === record.active && frame) {
    node = findLeaf(nodeId);
    if (!node || groupOf(nodeId) !== frame || isSlotLeaf(node)) throw new Error(`${nodeId} is not in ${sashId}`);
    removeWindow(nodeId);
  } else {
    node = findIn(sash.content, nodeId);
    if (!node || !registeredIn(sash.content, nodeId)) throw new Error(`${nodeId} is not in ${sashId}`);
    sash.content = removeFromContent(sash.content, nodeId);
  }
  delete node.collapsed;
  if (frame) splitWindow(frame.id, "right", node);
  else if (layoutRoot() && layoutRoot().children && layoutRoot().children[0]) {
    layoutRoot().children[0] = splitNode("right", layoutRoot().children[0], node);
  } else setLayoutRoot(node);
  commit();
  return true;
}

// Whether a node is registered in an arrangement kept aside: reached from
// its top through splits only, not inside a group the sash holds.
export function registeredIn(node, id) {
  if (!node) return false;
  if (node.id === id) return true;
  return node.type === "split" && node.children.some((child) => registeredIn(child, id));
}

export function bayList() {
  return bays.map((record) => {
    const frame = bayFrame(record.id);
    return {
      id: record.id,
      name: record.name,
      placed: Boolean(frame),
      active: record.active,
      slide: BAY_SLIDES.includes(record.slide) ? record.slide : "auto",
      sashes: record.sashes.map((sash) => {
        const content = sash.id === record.active && frame ? groupContent(frame) : sash.content;
        let windows = 0;
        eachLeaf(content, (leaf) => !isSlotLeaf(leaf) && (windows += 1));
        const unit = sashUnit(content);
        return {
          id: sash.id,
          name: sash.name,
          active: sash.id === record.active,
          windows,
          // What it holds: the window (or group) by its id and name.
          unit: unit ? unit.id : "",
          label: unit ? unit.label : "",
          tree: bayPreviewTree(content),
        };
      }),
    };
  });
}

// The tree after any change, put right: a bay frame no record answers to
// (or a second one for the same bay, or one inside another bay) is a plain
// group again; a placeholder outside a bay goes, and so does one beside
// real windows; a bay frame is never collapsed; and the active sash of a
// bay on screen keeps nothing aside, its arrangement being the frame's.
export function normalizeBays() {
  if (!layoutRoot()) return;
  const seen = new Set();
  const frames = [];
  eachGroup(layoutRoot(), (group) => {
    if (!group.bay) return;
    if (!bayRecord(group.bay) || seen.has(group.bay) || bayOf(group.id)) {
      delete group.bay;
      return;
    }
    seen.add(group.bay);
    delete group.collapsed;
    frames.push(group);
  });
  const drop = [];
  eachLeaf(layoutRoot(), (leaf) => {
    if (!isSlotLeaf(leaf)) return;
    const frame = bayOf(leaf.id);
    if (!frame) drop.push(leaf.id);
    else writeValue(getItem(leaf.path[0]), "bay", frame.bay, { by: "bays" });
  });
  for (const frame of frames) {
    if (groupContent(frame).type === "split") {
      frame.children[0] = { type: "group", id: newWindowId(), children: [groupContent(frame)] };
    }
    const slots = [];
    let real = false;
    eachLeaf(frame, (leaf) => {
      if (isSlotLeaf(leaf)) slots.push(leaf.id);
      else real = true;
    });
    drop.push(...(real ? slots : slots.slice(1)));
    const sash = activeSash(bayRecord(frame.bay));
    if (sash) sash.content = null;
  }
  drop.forEach((id) => removeWindow(id));
}

export function readBays(list, taken) {
  const out = [];
  for (const raw of Array.isArray(list) ? list : []) {
    if (!raw || typeof raw.id !== "string" || !raw.id || out.some((one) => one.id === raw.id)) continue;
    const sashes = [];
    for (const one of Array.isArray(raw.sashes) ? raw.sashes : []) {
      if (!one || typeof one.id !== "string" || !one.id || sashes.some((other) => other.id === one.id)) continue;
      let content = null;
      try {
        content = one.content ? validateNode(one.content) : null;
      } catch {
        content = null;
      }
      // A window id the tree (or another sash) already uses: the sash
      // cannot be trusted to name what it held, so it starts empty.
      const ids = content ? nodeIds(content) : [];
      if (ids.some((id) => taken.has(id)) || new Set(ids).size !== ids.length) content = null;
      else ids.forEach((id) => taken.add(id));
      sashes.push({ id: one.id, name: typeof one.name === "string" ? one.name : "", content });
    }
    const active = sashes.some((one) => one.id === raw.active) ? raw.active : "";
    out.push({
      id: raw.id,
      name: typeof raw.name === "string" ? raw.name : "",
      active,
      slide: BAY_SLIDES.includes(raw.slide) ? raw.slide : "auto",
      sashes,
    });
  }
  return out;
}

// Every leaf and group a sash keeps off screen, for the item bookkeeping.
export function eachStashedLeaf(fn) {
  for (const record of bays) for (const sash of record.sashes) eachLeaf(sash.content, fn);
}

export function eachStashedGroup(fn) {
  for (const record of bays) for (const sash of record.sashes) eachGroup(sash.content, fn);
}

export function stashedIds() {
  const out = [];
  for (const record of bays) for (const sash of record.sashes) nodeIds(sash.content, out);
  return out;
}

/** The bays as they are now (read through this: the list is replaced on load). */
export const allBays = () => bays;
/** A bay made from a launch layout joins the list. */
export function addBayRecord(record) {
  bays.push(record);
}
