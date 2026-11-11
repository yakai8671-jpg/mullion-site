/* The items of the open layout and their ids (docs/wiki/items.md).
 *
 * An item lives while a window's path, a screen or an app's frame holds it;
 * which ones are still held is the layout's question (pruneItems there), and
 * this store only keeps the list and hands out ids.
 *
 * Item ids are the lowest number not taken, so they stay as small as what is
 * open. Taken is what the layout was loaded with and everything handed out
 * since: an id given up in this session is not given again before the layout
 * is loaded anew, so a timer or a cache that still names it meets nothing.
 */

let registry; // ITEM_TYPES: handed in by setup (index.js)
let values; // defaultFor
let t; // i18n
export function connect(r, i18n, v) {
  values = v;
  registry = r;
  t = i18n.t;
}

/** What a window nobody chose anything for shows. */
export const DEFAULT_ITEM_TYPE = "dashboard";
/** The type an item of an uninstalled plugin is parked as. */
export const MISSING_ITEM_TYPE = "core.missing";

let items = [];
const taken = new Set();
let from = 1;

function takeItemId() {
  let n = from;
  while (taken.has(`i${n}`)) n += 1;
  from = n + 1;
  taken.add(`i${n}`);
  return `i${n}`;
}

/** Ids already in a layout are taken (ids with no number cannot be handed out anyway). */
export function claimItemIds(ids) {
  for (const id of ids) if (typeof id === "string" && /^i\d+$/.test(id)) taken.add(id);
}

/** A layout loaded anew starts its numbers again. */
export function forgetItemIds() {
  taken.clear();
  from = 1;
}

/** Every id taken this session (undo keeps them taken across a restore). */
export function reservedItemIds() {
  return [...taken];
}

/** The live list. Read it; change it only through this module. */
export function allItems() {
  return items;
}

/** What an item is called: its type's label ("missing" when it is gone). */
export function itemLabel(itemId) {
  const item = getItem(itemId);
  if (!item) return "missing";
  const def = registry.ITEM_TYPES[item.type];
  return def ? t(def.label) : item.type;
}

// A read-only descriptor, which is how every API hands data to an item.
export function readonlyProp(key, labelKey, type, value, params = {}) {
  return { key, label: t(labelKey), type, params, value, readonly: true };
}

// The descriptors for an item's properties. Most read out of item.props,
// but a spec may declare read/write hooks instead -- that is how the
// settings item edits the shared profile without shadowing it in state.
export function itemProperties(item, api) {
  const def = registry.ITEM_TYPES[item.type];
  return Object.entries(def.properties || {}).map(([key, spec]) => {
    const property = registry.bindProperty(item, key, api);
    return {
      key,
      label: spec.label ? t(spec.label) : key,
      type: spec.type,
      params: spec,
      // The value still travels on the descriptor so a read-only row costs
      // nothing, but every read and write goes through the accessor.
      value: property.get(),
      property,
      control: registry.controlFor(spec),
      readonly: Boolean(spec.readonly),
      api,
    };
  });
}

/** The icon an item shows: its type's, or the system one. */
export function itemIcon(item) {
  const def = item && registry.ITEM_TYPES[item.type];
  return (def && def.icon) || registry.ICONS.system;
}

export function getItem(id) {
  return items.find((item) => item.id === id) || null;
}

/** A new item of `type`, its properties at their defaults (a `read` property lives elsewhere). */
export function createItem(type) {
  const def = registry.ITEM_TYPES[type];
  if (!def) throw new Error(`unknown item type: ${type}`);
  // Its values are built before it is anyone's to write (values.writeValue is for live items).
  const props = {};
  for (const [key, spec] of Object.entries(def.properties || {})) {
    if (spec.read) continue; // lives elsewhere; nothing to seed or persist
    props[key] = values.defaultFor(spec);
  }
  const item = { id: takeItemId(), type, props };
  items.push(item);
  return item;
}

/** The list of a layout just loaded (its ids are claimed by the loader). */
export function setItems(list) {
  items = list;
}

/** Keeps the items `keep` says yes to; returns the others. */
export function keepItems(keep) {
  const gone = items.filter((item) => !keep(item));
  items = items.filter((item) => keep(item));
  return gone;
}

/** Where the list and the numbering stand, to throw away what is made after (probes). */
export function itemsMark() {
  return { length: items.length, from };
}

/** Removes the items made since `mark` and frees their ids; returns them. */
export function dropItemsSince(mark) {
  const gone = items.splice(mark.length);
  for (const one of gone) taken.delete(one.id);
  from = mark.from;
  return gone;
}
