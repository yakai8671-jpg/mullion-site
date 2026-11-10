/* The layout's tree: windows (leaves), splits and groups (frames), and the
 * window ids (docs/wiki/layout.md).
 *
 * A group is a frame drawn around a part of the layout; from the outside it
 * *is* a window: it is dragged, split, collapsed and closed by the same code
 * through the same title bar. So everything here addresses leaves and groups
 * alike, and only a split is treated apart.
 */

// The root frame's id, the same in every layout: it is not a window anybody
// made, so it has no number in the sequence windows are counted in, and
// anything that wants the stage can name it without looking it up.
export const ROOT_ID = "root";
// What the outermost frame opens a new window as, unless someone changed it:
// the launcher, since a window nobody chose anything for is a window about
// to be used to choose something.
export const ROOT_DEFAULT_ITEM = "dashboard";
export const DEFAULT_RATIO = 0.5;
// How deep a group may nest in a group: the bound on every walk up the window tree.
export const MAX_NESTING = 32;

let root = null;

/** The root of the tree (null: nothing open). */
export const layoutRoot = () => root;
export function setLayoutRoot(node) {
  root = node;
}

// Window ids are the lowest number not taken, so they stay as small as what
// is open. Taken is what the layout was loaded with and everything handed
// out since -- an id given up in this session is not given again before the
// layout is loaded anew, so a timer, a cache or a half-made node that still
// names it is not met by a different window.
const taken = new Set();
let from = 1;

export function newWindowId() {
  let n = from;
  while (taken.has(`w${n}`)) n += 1;
  from = n + 1;
  taken.add(`w${n}`);
  return `w${n}`;
}
/** Ids already in a layout are taken (ids with no number cannot be handed out anyway). */
export function claimWindowIds(ids) {
  for (const id of ids) if (typeof id === "string" && /^w\d+$/.test(id)) taken.add(id);
}
export function forgetWindowIds() {
  taken.clear();
  from = 1;
}
export const reservedWindowIds = () => [...taken];

// ---- tree helpers ----------------------------------------------------
// Three kinds of node. A leaf is one window. A split holds exactly two
// children and divides its space between them. A group is a frame holding a
// layout of its own: one child, which is an ordinary tree of splits and
// windows, drawn inside the group's own title bar and border.
//
// So splitting is how a layout gets wider, and a group is how it gets a
// level deeper: the windows inside one are ordinary windows with ordinary
// title bars, and every seam, split and drop among them stays inside that
// frame rather than reaching across the stage.
//
// A group carries an id from the same counter windows come from, because
// from the outside it *is* a window: it is dragged, split, collapsed and
// closed by the same code through the same title bar. So everything below
// addresses leaves and groups alike, and only a split is treated apart.
export function isContainer(node) {
  return Boolean(node) && (node.type === "split" || node.type === "group");
}

// What a group frames. One child always -- a frame with nothing in it is
// nothing, so removeWindow() takes the group away with its last window.
export function groupContent(group) {
  return group.children[0] || null;
}

export function countLeaves(node) {
  if (!node) return 0;
  if (node.type === "leaf") return 1;
  return node.children.reduce((total, child) => total + countLeaves(child), 0);
}

export function countGroups(node) {
  if (!isContainer(node)) return 0;
  return node.children.reduce(
    (total, child) => total + countGroups(child),
    node.type === "group" ? 1 : 0
  );
}

export function eachLeaf(node, fn) {
  if (!node) return;
  if (node.type === "leaf") fn(node);
  else node.children.forEach((child) => eachLeaf(child, fn));
}

export function eachGroup(node, fn) {
  if (!node || node.type === "leaf") return;
  if (node.type === "group") fn(node);
  node.children.forEach((child) => eachGroup(child, fn));
}

export function leafIds(node) {
  const out = [];
  eachLeaf(node, (leaf) => out.push(leaf.id));
  return out;
}

// Every id in a subtree, groups included -- what an id has to be unique
// against, since a group answers to the same lookups a window does.
export function nodeIds(node, out = []) {
  if (!node) return out;
  if (node.id) out.push(node.id);
  if (isContainer(node)) node.children.forEach((child) => nodeIds(child, out));
  return out;
}

// Returns [parent, index] for the node with this id -- parent is null when
// it is the root itself. undefined means "not in this subtree".
export function findParent(id, node = root, parent = null, index = -1) {
  if (!node) return undefined;
  if (node.id === id) return [parent, index];
  if (!isContainer(node)) return undefined;
  for (let i = 0; i < node.children.length; i += 1) {
    const found = findParent(id, node.children[i], node, i);
    if (found) return found;
  }
  return undefined;
}

export function findLeaf(id) {
  const found = findParent(id);
  if (!found) return null;
  const [parent, index] = found;
  return parent === null ? root : parent.children[index];
}

// Same walk, but locating a container by identity so it can be collapsed
// or replaced. null means "found, and it is the root".
export function findNodeParent(target, node = root, parent = null, index = -1) {
  if (!isContainer(node)) return undefined;
  if (node === target) return parent === null ? null : { parent, index };
  for (let i = 0; i < node.children.length; i += 1) {
    const found = findNodeParent(target, node.children[i], node, i);
    if (found !== undefined) return found;
  }
  return undefined;
}

// Whether a node is somewhere inside another, itself included. What keeps
// a move or a swap from putting a node inside its own subtree.
export function containsNode(node, target) {
  if (!node) return false;
  if (node === target) return true;
  return isContainer(node) && node.children.some((child) => containsNode(child, target));
}

// The group a node is framed by: the nearest one above it, or null out on
// the stage itself.
export function groupOf(id, node = root, group = null) {
  if (!node) return null;
  if (node.id === id) return group;
  if (!isContainer(node)) return null;
  const within = node.type === "group" ? node : group;
  for (const child of node.children) {
    const found = groupOf(id, child, within);
    if (found) return found;
  }
  return null;
}

export function replaceNode(parent, index, replacement) {
  if (parent === null) root = replacement;
  else parent.children[index] = replacement;
}
