/* ports: moved out of core.js (docs/wiki/migration.md). */
import { ITEM_TYPES, VALUE_TYPES, bindElement, bindProperty, bindSpec, derivesFrom, grantApi, listOfPortKind, setShareResolver, valueTypeFor, MAX_NESTING, registerPart, getItem, itemLabel, t } from "./deps.js";

// What ports says: "change" after a link, a share or a value written through
// a port ({ links }: whether the links themselves changed).
let portsChanged = () => {};
export function connectEvents(emit) {
  portsChanged = (change) => emit("change", change);
}

// What ports puts into others: its part of a layout file, and how a shared
// property finds what it shares (the registry's resolver).
export function registerWithOthers() {
  // ports: which properties follow which. Only links between items still here;
  // read as written otherwise (syncLinks drops one that cannot be followed).
  registerPart("links", {
    save: () =>
      links
        .filter((one) => getItem(one.to.item) && getItem(one.from.item))
        .map((one) => ({ to: portAddress(one.to), from: portAddress(one.from), ...(one.share ? { share: true } : {}) })),
    load(saved) {
      const port = (value) =>
        value && typeof value.item === "string" && typeof value.key === "string"
          ? portAddress({ item: value.item, key: value.key, path: value.path })
          : null;
      links = (Array.isArray(saved) ? saved : [])
        .map((one) => ({ to: port(one && one.to), from: port(one && one.from), ...(one && one.share === true ? { share: true } : {}) }))
        .filter((one) => one.to && one.from && getItem(one.to.item) && getItem(one.from.item));
    },
  });
  setShareResolver(resolveShare);
}

export function portIsEntry(address) {
  const node = address && address.item ? portSpec(address) : null;
  return Boolean(node && node.element);
}

// ---- ports: one property's value, carried to another --------------------
// A control showing a value worth taking somewhere else -- a prompt, the
// text an editor puts together -- carries a grip. Taking hold of it is
// property move mode: every other control on screen that could take the
// value offers guides, the way every window offers its own while one is
// being dragged. Two of them, because there are two things to want. Paste
// puts the value there once, and nothing joins the two afterwards. Link
// makes the one follow the other from then on: the detailed work is done in
// an app made for it, and the place that uses the result only holds a link.
//
// A port is a property, addressed as (item, key) -- the one address that
// still means something after the layout is reloaded -- and, to go inside
// its value, a path of steps: {item, key, path: [step, ...]}. A step is an
// element of a list, by the identity its type declares (`identity`), or a
// field of a value, by name (`fields`); which one it is, is for the type
// where the walk stands to say. A path that does not lead anywhere is not a
// port. What a port carries is its value, read the way any reader reads it,
// so a read-through property (the prompt editor's result) is as good a
// source as a stored one. What may receive is narrower: a stored property
// that is not read-only. An output preview is something to take from,
// never to put into.
//
// What a value is, for carrying, is its kind: "text" for anything derived
// from string, or whatever a type or spec names (`port`). A target takes
// its own kind and any it lists in `portAccepts`; between kinds a plugin
// may register a conversion -- a list of prompts read as text is the
// prompt it adds up to. A kind with no way across is not offered a guide.
//
// The way a value of a type is carried is said by the type, wherever the
// value stands -- on an item, in a field, as an element of a list:
//   port                  the kind it is carried as
//   portKindOf(value)     the kind, when it depends on the value
//   portAccepts           kinds it takes besides its own
//   portReceive: false    it is only taken from
//   portRead(value, item) what it carries (default: itself); the item for an
//                         entry that brings things kept beside it
//   portWrite(value, kind) the stored value, made from what is carried to it
//   fields                a field with a kind of its own is a port of its own
// and, for the type of a list's element (one with an `identity`):
//   portPut(entry, value, kind, fromKind)  the entry with a value put into
//                         it (default: the value as the type reads it, with
//                         the entry's identity and `portKeep` kept)
//   portKeep: [key]       what belongs to the entry's place, not to its value
//   portGroup(entry)      which entries may trade places by the move guide:
//                         only those that give the same answer
//   portAfterWrite(item, entry, value, fromKind)  run after a whole value is
//                         put into an entry: what else in the item the value
//                         brings, written to item.props
//   portFacets            {name: {kind, accepts, read, write}} -- a piece of
//                         an entry that is carried on its own although it is
//                         not a field
//
// A list says nothing about how its entries are carried: the type of its
// element does (a list type that still declares `entryPort` is refused at
// start-up, see registryProblems).
//
// A type that holds whatever is carried to it -- a preview -- takes every
// kind (`portAcceptsAny`) and keeps the kind with the value: `portWrite`
// makes the stored value from (value, kind), `portRead` gives back what is
// carried out again, and `portKindOf` says, from the stored value, what
// kind that is.
let links = []; // [{to: {item, key, path?}, from: {item, key, path?}}]

// Links set without saying so (a launch layout puts its links in place, and
// the launch redraws once at the end): those between the given items go,
// one link put in, all of them gone.
export function dropLinksAmong(itemIds) {
  links = links.filter((one) => !(itemIds.has(one.to.item) && itemIds.has(one.from.item)));
}

export function placeLink(to, from, share = false) {
  links = links.filter((other) => !samePort(other.to, to));
  links.push({ to: portAddress(to), from: portAddress(from), ...(share ? { share: true } : {}) });
}

export function clearLinks() {
  links = [];
}

export const PORT_CONVERSIONS = {}; // from kind -> to kind -> fn(value)

export function registerPortConversion(from, to, fn) {
  if (typeof fn !== "function") throw new Error(`conversion ${from} -> ${to} needs a function`);
  (PORT_CONVERSIONS[from] || (PORT_CONVERSIONS[from] = {}))[to] = fn;
}

export const stepsOf = (path) => (Array.isArray(path) ? path.filter((one) => typeof one === "string" && one) : []);

export const portAddress = (port) => {
  const out = { item: port.item, key: port.key };
  const path = stepsOf(port.path);
  if (path.length) out.path = path;
  return out;
};

export const samePath = (a, b) => {
  const x = stepsOf(a);
  const y = stepsOf(b);
  return x.length === y.length && x.every((step, i) => step === y[i]);
};

// A key that says where a port is, for what is remembered about the card it
// is drawn on (its size, whether it is folded). Two steps are always spelled
// out, empty or not, so what was kept under an address with an entry and a
// part is found again.
export function portKey(port, prefix = "") {
  const path = stepsOf(port && port.path);
  const head = [port.item, port.key || "", path[0] || "", path[1] || "", ...path.slice(2)];
  return (prefix ? [prefix, ...head] : head).join(":");
}

export const samePort = (a, b) =>
  Boolean(a && b) && a.item === b.item && a.key === b.key && samePath(a.path, b.path);

// Two addresses in the same property.
export const sameProperty = (a, b) => Boolean(a && b) && a.item === b.item && a.key === b.key;

// One address is the other's, or lies inside it: a list and one of its
// entries, an entry and a piece of it. A link between them would feed itself.
export const within = (a, b) => {
  if (!sameProperty(a, b)) return false;
  const x = stepsOf(a.path);
  const y = stepsOf(b.path);
  return x.slice(0, Math.min(x.length, y.length)).every((step, i) => step === y[i]);
};

// What sort of value a port carries. A spec may say `port: false` to keep
// out of it altogether.
export function portKind(spec) {
  if (!spec || spec.port === false) return null;
  if (typeof spec.port === "string") return spec.port;
  const def = valueTypeFor(spec);
  if (def && typeof def.port === "string") return def.port;
  return derivesFrom(spec.type, "string") ? "text" : null;
}

// A list as its type reads it: an entry the stored value left without an
// identity has the one the type gives it, so a path can name it.
export function entriesOf(list) {
  const own = list.def || {};
  const value = own.coerce ? own.coerce(list.get(), list.params) : list.get();
  return Array.isArray(value) ? value : [];
}

export function propertyNode(base) {
  const { property, item } = base;
  const own = valueTypeFor(property.params) || {};
  const node = {
    ...base,
    own,
    type: property.params.type,
    kind: () => (own.portKindOf ? own.portKindOf(property.get()) || null : portKind(property.params)),
    accepts: () => {
      if (own.portReceive === false) return [];
      if (own.portAcceptsAny) {
        // Holding a kind that keeps what is put into it (`portKeeps` on the
        // type that carries it: a property group takes entries, not the place
        // of its own value) it takes nothing in as a whole -- emptied first,
        // it does.
        const held = own.portKindOf ? own.portKindOf(property.get()) : null;
        if (held && Object.values(VALUE_TYPES).some((def) => def.port === held && def.portKeeps)) return [];
        return ["*"];
      }
      const kind = portKind(property.params);
      if (!kind) return [];
      return [kind, ...(property.params.portAccepts || own.portAccepts || [])];
    },
    read: () => {
      const value = property.get();
      return own.portRead ? own.portRead(value, item) : value;
    },
    put: (carried, kind, fromKind) => {
      if (base.element) {
        const entry = property.get();
        const keep = Object.fromEntries((own.portKeep || []).map((key) => [key, entry && entry[key]]));
        const next = own.portPut
          ? own.portPut(entry, carried, kind, fromKind)
          : { ...(own.coerce ? own.coerce(carried, property.params) : carried), [base.element.identity]: entry[base.element.identity], ...keep };
        property.set(next);
        if (own.portAfterWrite) own.portAfterWrite(item, property.get(), carried, fromKind);
        return;
      }
      property.set(own.portWrite ? own.portWrite(carried, kind) : carried);
    },
    entryValue: base.element ? () => property.get() : null,
    group: base.element && own.portGroup ? (entry) => own.portGroup(entry) : null,
  };
  return node;
}

// A piece of an element that is carried on its own but is not a field.
export function facetNode(parent, common, facet) {
  const { item } = common;
  const entry = () => parent.property.get();
  const kind = () => (typeof facet.kind === "function" ? facet.kind(entry()) : facet.kind);
  return {
    ...common,
    property: null,
    kind,
    accepts: () => (typeof facet.accepts === "function" ? facet.accepts(entry()) : facet.accepts) || [kind()],
    read: () => facet.read(entry(), item),
    // What it is called after the entry it belongs to.
    facetLabel: () => (typeof facet.label === "function" ? facet.label(entry()) : facet.label) || "",
    put: (carried, k, fromKind) => parent.property.set(facet.write(entry(), carried, k, fromKind)),
  };
}

// The node one step inside `node`, or null where the path does not go.
export function descend(node, step) {
  const common = {
    item: node.item,
    def: node.def,
    spec: node.spec,
    key: node.key,
    steps: [...node.steps, step],
    parent: node,
  };
  if (!node.property) return null;
  const own = node.own;
  const isList = derivesFrom(node.type, "list");
  if (isList) {
    const each = node.property.params.each;
    const element = each && VALUE_TYPES[each.type];
    const identity = element && element.identity;
    if (!identity) return null;
    const index = entriesOf(node.property).findIndex((one) => one && String(one[identity]) === step);
    if (index < 0) return null;
    const property = bindElement(node.property, index, undefined, () => entriesOf(node.property));
    return propertyNode({ ...common, property, element: { index, identity } });
  }
  if (own.fields && step in own.fields) {
    return propertyNode({ ...common, property: node.property.field(step), field: step });
  }
  // A holder of whatever kind it was given (a preview's input) goes on into
  // the value it holds, as if the property were of the type that kind belongs
  // to: a property group held there has its `entries` to walk into.
  if (own.portKindOf) {
    const held = own.portKindOf(node.property.get());
    const named = held ? Object.entries(VALUE_TYPES).find(([, def]) => def.port === held && def.fields && step in def.fields) : null;
    if (named) {
      const holder = node.property;
      const view = bindSpec(
        {
          type: named[0],
          read: () => {
            const value = holder.get();
            return value && value.kind === held ? value.value : null;
          },
          write: (_api, value) => holder.set({ kind: held, value }),
        },
        { item: node.item, key: node.key, api: holder.api, owner: holder.owner, step: holder.step }
      );
      return propertyNode({ ...common, property: view.field(step), field: step });
    }
  }
  // A fixed facet by its name, or one the type makes from the entry (a chain
  // block's result: one per output the app it runs offers).
  const facet =
    node.element &&
    ((own.portFacets && own.portFacets[step]) ||
      (typeof own.portFacetOf === "function" ? own.portFacetOf(step, node.property.get(), node.item, itemApi(node.item)) : null));
  return facet ? facetNode(node, common, facet) : null;
}

// The api of an item as its own code has it, for what a value type draws from
// the item it is in (a facet reads through the item's connections). Kept per
// item: asking for it is as often as a port is looked at.
export const itemApis = new WeakMap();

export function itemApi(item) {
  const def = ITEM_TYPES[item.type];
  if (!def) return null;
  if (!itemApis.has(item)) itemApis.set(item, grantApi(def, { windowId: null, itemId: item.id }));
  return itemApis.get(item);
}

export function portSpec(port) {
  const item = port && getItem(port.item);
  const def = item && ITEM_TYPES[item.type];
  const spec = def && (def.properties || {})[port.key];
  if (!spec) return null;
  let node = propertyNode({ item, def, spec, key: port.key, steps: [], parent: null, property: bindProperty(item, port.key, null) });
  for (const step of stepsOf(port.path)) {
    node = descend(node, step);
    if (!node) return null;
  }
  return node;
}

// An entry's kind may depend on the entry: a scratch board holds text next
// to prompt lists, each entry saying which it is.
export const kindAt = (found) => (found ? found.kind() : null);

export const acceptsAt = (found) => (found ? found.accepts() : []);

// How a value of one kind gets into a port taking `accepted`: as it is, or
// through one registered conversion. Null when there is no way.
export function routeFor(fromKind, accepted) {
  if (!fromKind) return null;
  if (accepted.includes(fromKind) || accepted.includes("*")) return { kind: fromKind, convert: (value) => value };
  for (const kind of accepted) {
    const fn = (PORT_CONVERSIONS[fromKind] || {})[kind];
    if (fn) return { kind, convert: fn };
  }
  return null;
}

// Read with no API, as items:read reads every property: a read-through
// value has to make do with its item.
export const readPort = (found) => found.read();

export function portValue(port) {
  const found = portSpec(port);
  return found ? found.read() : undefined;
}

// What a port is, for a caller that must not know how a path is walked: the
// kind it is carried as, the value it holds now, the value type of the
// property (a list type, when the port holds a list -- found by its kind when
// the property is a holder of any kind, like a preview's), the parameters of
// that type, and how a value is put in. Null where the address leads nowhere.
export function portInfo(port, depth = 0) {
  // A property that shares another is that one, whatever its own type says.
  const shared = depth < MAX_NESTING ? sharedFrom(port) : null;
  if (shared) return portInfo(shared, depth + 1);
  const found = portSpec(port);
  if (!found) return null;
  const kind = found.kind();
  let type = found.type || "";
  let params = found.property ? found.property.params : {};
  // Only a port that holds whatever it is given (a preview's) or is no
  // property at all (a result a type draws) is told by its kind: a text is no
  // list because some list type is carried as text too.
  const byKind = !type || Boolean(VALUE_TYPES[type] && VALUE_TYPES[type].portKindOf);
  if (byKind && !derivesFrom(type, "list") && kind) {
    // The list whose elements say they are carried as this kind.
    const plain = listOfPortKind(kind);
    if (plain) {
      type = "list";
      params = plain;
    }
  }
  const isList = Boolean(type) && derivesFrom(type, "list");
  return {
    address: portAddress(port),
    kind,
    type,
    params,
    isList,
    // The type of what a list holds, when it says.
    elementType: isList && params.each ? params.each.type : "",
    elementParams: isList && params.each ? params.each : null,
    writesLater: Boolean(found.own && found.own.writesLater),
    read: () => found.read(),
    // Whether a value of its own kind can be put in: stored, not read-only, and
    // taking what it carries (a result drawn for an app's output takes nothing).
    writable: writable(found) && Boolean(routeFor(kind, acceptsAt(found))),
    // Put a whole value in, as the kind it is; whether it changed.
    write: (value, fromKind = kind) => {
      const changed = writePort(portAddress(port), value, fromKind);
      portsChanged({ links: false });
      return changed;
    },
    label: portLabel(port),
  };
}

// Whether anything may be put here at all: stored, and not read-only.
export function writable(found) {
  return Boolean(found && !found.spec.readonly && (!found.spec.read || found.spec.write));
}

// Whether the property is fed by a link from another property: what is
// written to it is overwritten at the next refresh.
export function isLinkedInto(itemId, key) {
  return links.some((one) => !one.share && one.to.item === itemId && one.to.key === key);
}

// The link a port follows: a copy that is kept up to date. A share is another
// thing (see shareOf) and is not asked for here.
export function linkOf(port) {
  return links.find((one) => !one.share && samePort(one.to, port)) || null;
}

// Whatever a port takes its value from, copied or shared.
export function upstreamOf(port) {
  return links.find((one) => samePort(one.to, port)) || null;
}

// Where a property that follows a link takes its value from, or null. A link
// is a copy and goes one way only: what is written to the follower stays in
// it (and is overwritten at the next refresh). Whoever wants to put something
// where the follower reads from writes to that property itself.
export function linkSource(port) {
  const one = linkOf(port);
  return one ? one.from : null;
}

// Whether `to` is already upstream of `from` -- linking them would make a
// value follow itself round in a circle.
export function linkLoops(to, from) {
  if (within(to, from)) return true;
  let at = from;
  for (let hops = 0; at && hops < MAX_NESTING; hops++) {
    if (samePort(at, to)) return true;
    const up = upstreamOf(at);
    at = up ? up.from : null;
  }
  return false;
}

// The way from one port into another, if there is one, writable or not.
export function routeBetween(to, from) {
  const source = portSpec(from);
  const target = portSpec(to);
  if (!source || !target || samePort(to, from)) return null;
  return routeFor(kindAt(source), acceptsAt(target));
}

export const canPaste = (to, from) => writable(portSpec(to)) && Boolean(routeBetween(to, from));

export const canLink = (to, from) => canPaste(to, from) && !linkLoops(to, from);

// Put a value into a port, converting it on the way. Returns whether what
// the port holds changed.
export function writePort(to, value, fromKind) {
  const found = portSpec(to);
  if (!writable(found)) return false;
  const route = routeFor(fromKind, acceptsAt(found));
  if (!route) return false;
  const before = JSON.stringify(found.read());
  found.put(route.convert(value), route.kind, fromKind);
  const after = portSpec(to);
  return Boolean(after) && JSON.stringify(after.read()) !== before;
}

export function linkPort(to, from) {
  if (!canLink(to, from)) return false;
  links = links.filter((one) => !samePort(one.to, to));
  links.push({ to: portAddress(to), from: portAddress(from) });
  // Part of how an app is set out: kept with its layout like a move.
  portsChanged({ links: true });
  return true;
}

// Whether `to` may be made the same property as `from`: an item's own property
// that takes a value (not one worked out from others), and a source whose type
// is the target's or one derived from it -- a list of any kind for a `list`
// -- so that the one is never given what it has no meaning for. A source that
// is read-only (a chain's result) is shared read-only.
export function canShare(to, from) {
  if (!to || !from || !to.item || !from.item || samePort(to, from) || stepsOf(to.path).length) return false;
  const target = portSpec(to);
  if (!target || !target.property || !writable(target)) return false;
  const source = portInfo(from);
  if (!source || !source.type || !derivesFrom(source.type, target.own.shareFrom || target.type)) return false;
  return !linkLoops(to, from);
}

// `to` becomes the same property as `from`: reading it reads that one, writing
// it writes that one. What `to` held itself is put away, and is there again
// when the share is let go of (or what it shared is gone).
export function sharePort(to, from) {
  if (!canShare(to, from)) return false;
  links = links.filter((one) => !samePort(one.to, to));
  links.push({ to: portAddress(to), from: portAddress(from), share: true });
  portsChanged({ links: true });
  return true;
}

// What an item's own property shares, as the item may know it: what it is
// (its type, the elements of a list, whether it can be written to, what it is
// called) and how to read and write it -- not where it is. Null when it shares
// nothing. For the item's own `props:share`; nothing else is given the answer.
export function sharedInfo(itemId, key) {
  const from = sharedFrom({ item: itemId, key });
  const info = from && portInfo(from);
  if (!info) return null;
  const { address: _address, ...rest } = info;
  return rest;
}

// What a property shares, as an address, or null.
export function sharedFrom(port) {
  const found = port && links.find((one) => one.share && samePort(one.to, port));
  return found ? found.from : null;
}

// For a control: what its port shares, with the name it is called.
export function portShare(port) {
  const from = sharedFrom(port);
  return from && portSpec(from) ? { from, label: portLabel(from), share: true } : null;
}

// The shares by the property that shares, read for every get and set of an
// item's property: kept until the links change.
let shareIndex = { links: null, size: -1, map: new Map() };

export function resolveShare(property) {
  if (!property.item || property.owner) return null;
  if (shareIndex.links !== links || shareIndex.size !== links.length) {
    const map = new Map();
    for (const one of links) if (one.share) map.set(`${one.to.item}|${one.to.key}`, one);
    shareIndex = { links, size: links.length, map };
  }
  if (!shareIndex.map.size) return null;
  const one = shareIndex.map.get(`${property.item.id}|${property.key}`);
  const node = one && portSpec(one.from);
  if (!node) return null;
  if (!node.property) return { get: () => node.read(), set: null };
  const params = node.property.params;
  const readOnly = Boolean(params.readonly || (params.read && !params.write));
  return { get: () => node.property.get(), set: readOnly ? null : (value) => node.property.set(value) };
}

export function unlinkPort(to) {
  const before = links.length;
  const under = underShare(to);
  links = links.filter((one) => !samePort(one.to, to) && !(under !== to && !one.share && samePort(one.to, under)));
  if (links.length !== before) portsChanged({ links: true });
}

// The value, once. A paste onto a linked port is a decision to stop
// following, so the link goes with it.
export function pastePort(to, from) {
  if (!canPaste(to, from)) return false;
  const value = portValue(from);
  if (value === undefined) return false;
  // A paste onto a link stops following; onto a share it is written to what is
  // shared, so the share stays.
  links = links.filter((one) => one.share || !samePort(one.to, to));
  writePort(to, value, kindAt(portSpec(from)));
  portsChanged({ links: false });
  return true;
}

// One entry moved to where another is, in the same list: the third guide
// a row of a list offers its neighbours, the way a window offers to trade
// places.
// Whether two entries of one list may trade places: a list whose entries
// fall into groups (a shot's lines, kept in one list for the whole video)
// says which with `portGroup(entry)`, and only entries of the same group
// are put in order against each other.
export function sameGroup(target, source) {
  const group = target && target.group;
  return !group || Boolean(source && source.entryValue && group(target.entryValue()) === group(source.entryValue()));
}

// Both are entries of the one list, which may be put in order.
export function canMove(to, from) {
  const target = portSpec(to);
  const source = portSpec(from);
  if (!target || !source || !target.element || !source.element || samePort(to, from)) return false;
  if (!sameProperty(to, from) || !samePath(stepsOf(to.path).slice(0, -1), stepsOf(from.path).slice(0, -1))) return false;
  return sameGroup(target, source) && writable(target);
}

export function movePort(to, from) {
  if (!canMove(to, from)) return false;
  const target = portSpec(to);
  const source = portSpec(from);
  const list = target.parent;
  const next = [...entriesOf(list.property)];
  const [taken] = next.splice(source.element.index, 1);
  next.splice(target.element.index, 0, taken);
  list.property.set(next);
  portsChanged({ links: false });
  return true;
}

// Every link brought up to date. Run before every redraw, so whatever
// changed a source -- an edit, a child's edit under a read-through value,
// a preset loaded -- reaches what follows it in the same pass that shows
// it. A chain settles in as many rounds as it is long. A link that keeps
// changing its target round after round is feeding itself by a way no
// link shows (an entry following the text its own list adds up to), and
// is let go rather than left to grow the value on every redraw.
export const LINK_WRITES = 3;

export function syncLinks() {
  // A share has nothing to bring over: what it shares is what it reads.
  links = links.filter((one) => portSpec(one.from) && (one.share ? portSpec(one.to) : writable(portSpec(one.to))));
  const writes = new Map();
  for (let round = 0; round < MAX_NESTING; round++) {
    let moved = false;
    for (const one of [...links]) {
      if (one.share) continue;
      const from = portSpec(one.from);
      if (!from || !portSpec(one.to)) continue;
      if (!writePort(one.to, readPort(from, one.from), kindAt(from))) continue;
      moved = true;
      const count = (writes.get(one) || 0) + 1;
      writes.set(one, count);
      if (count >= LINK_WRITES) {
        console.warn("Mullion: a link that feeds itself was removed", one);
        links = links.filter((other) => other !== one);
      }
    }
    if (!moved) break;
  }
}

// What a port is called where somebody reads it: the app it belongs to and
// the property's own name -- "Prompt Editor · Result", and for an entry,
// which one -- "… · Prompt list 2".
export function portLabel(port) {
  const found = portSpec(port);
  if (!found) return t("mu.value.dash");
  const top = found.item;
  const own = found.spec.label ? t(found.spec.label) : port.key;
  const places = [];
  for (let at = found; at; at = at.parent) if (at.element) places.unshift(at.element.index + 1);
  // A field of a value (a property group's entries) is named after its own label.
  const inside = [];
  for (let at = found; at; at = at.parent) {
    if (at.field && !at.element) inside.unshift(at.property && at.property.params.label ? t(at.property.params.label) : at.field);
  }
  const piece = [...inside, typeof found.facetLabel === "function" ? found.facetLabel() : ""].filter(Boolean).join(" · ");
  return `${itemLabel(top.id)} · ${own}${places.map((n) => ` ${n}`).join("")}${piece ? ` · ${piece}` : ""}`;
}

// A port of a property that shares another one (a screen onto an item's list) is
// that one's: the same place under the sharer's name. Itself when it shares nothing.
export function underShare(port) {
  if (!port) return port;
  const share = links.find((one) => one.share && one.to.item === port.item && one.to.key === port.key && !(one.to.path && one.to.path.length));
  if (!share) return port;
  const path = [...(share.from.path || []), ...(port.path || [])];
  return { ...share.from, ...(path.length ? { path } : {}) };
}

// For a control: where its port's value comes from, if it follows one -- on the
// port itself, or on the one it shares.
export function portLink(port) {
  const link = port && (linkOf(port) || linkOf(underShare(port)));
  return link ? { from: link.from, label: portLabel(link.from) } : null;
}

// For a control: make `card` a port and `grip` the way to take hold of it.
// The address is read off the card when the drag starts, so a control that
// is pointed somewhere else only has to call this again.
export function readAddress(card) {
  const port = { item: card.dataset.portItem, key: card.dataset.portKey };
  if (card.dataset.portPath) {
    try {
      port.path = stepsOf(JSON.parse(card.dataset.portPath));
    } catch (error) {
      port.path = [];
    }
  }
  return port;
}

// A value of one kind read as another, for showing it: text from a prompt
// list, say. Null when there is no way.
export function portConvert(value, fromKind, toKind) {
  const route = routeFor(fromKind, [toKind]);
  return route ? route.convert(value) : null;
}

export function canConvertPort(fromKind, toKind) {
  return Boolean(routeFor(fromKind, [toKind]));
}

/** The links as they are now (the list is replaced, not changed, so it is read through this). */
export const allLinks = () => links;
