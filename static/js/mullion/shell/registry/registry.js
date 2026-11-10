/* Mullion -- the registration surface.
 *
 * Everything the shell can be extended with lands here: item types,
 * value types and permission namespaces. A plugin never imports the
 * engine's internals; it is handed these functions and registers against
 * them, which is what keeps the boundary between core and plugin real.
 */

// Set while a plugin's register() runs, so every type it adds is attributed
// to it. "core" is what the shell's own registrations get.
// i18n, handed in by setup (index.js): the translation tables the checks read.
let i18n = null;
export function connect(translations) {
  i18n = translations;
}

let registrationSource = null;

export function setRegistrationSource(id) {
  registrationSource = id;
}

export const ITEM_TYPES = {};
export const ITEM_FACTORIES = new Map();

export function registerItemFactory(name, build) {
  if (typeof build !== "function" || ITEM_FACTORIES.has(name)) throw new Error(`invalid or duplicate item factory "${name}"`);
  ITEM_FACTORIES.set(name, { source: registrationSource || "core", build });
}
// The built-in apps, by the item type each is the app of: what is opened with
// it (a layout, starting values) and how it is told apart. An app is a preset
// of windows and an item, so it is said here and not on the item type.
export const APPS = {};
export const VALUE_TYPES = {};
export const CONTROLS = {};
export const ACTIONS = {};
export const PERMISSIONS = {};
export const SKINS = {};

export function registerAction(name, def) {
  if (!name || typeof name !== "string") throw new Error("action needs a name");
  if (ACTIONS[name]) throw new Error(`action "${name}" is already registered`);
  if (!def || typeof def.run !== "function") throw new Error(`action "${name}" needs a run() function`);
  ACTIONS[name] = {
    ...def,
    name,
    source: registrationSource || "core",
  };
  return ACTIONS[name];
}

// role -> Bootstrap Icons name. A type may also name a Bootstrap icon
// directly; roles exist for the handful the shell itself draws, so that a
// set can be swapped without editing the shell.
export const ICONS = {
  split: "layout-split",
  close: "x",
  // Named for the bar they leave behind: a horizontal one (the arrows close
  // vertically onto it) or a vertical one.
  collapse: "arrows-collapse",
  collapseVertical: "arrows-collapse-vertical",
  expand: "arrows-expand",
  // A card control that fills its window, and the way back (see `expand` in core).
  expandCard: "arrows-angle-expand",
  contractCard: "arrows-angle-contract",
  expandVertical: "arrows-expand-vertical",
  // Expanding into the space beside it, which the windows there give up.
  expandUp: "arrow-bar-up",
  expandDown: "arrow-bar-down",
  expandLeft: "arrow-bar-left",
  expandRight: "arrow-bar-right",
  drag: "grip-vertical",
  // Holding a window to its size, and the window held.
  pin: "pin-angle",
  pinned: "pin-angle-fill",
  // A bay's way to its next sash, and a bay itself.
  nextSash: "skip-forward",
  prevSash: "skip-backward",
  bay: "window-stack",
  // The way back out of a screen opened inside another one.
  back: "arrow-left-short",
  // A row of things that folds away, and the same row folded.
  foldUp: "chevron-up",
  foldDown: "chevron-down",
  // Narrowing a list by name.
  search: "search",
  // Taking what is on top of a window out into a window of its own.
  detach: "box-arrow-up-right",
  // Everything a bar cannot fit, in one button.
  menu: "list",
  swap: "arrow-left-right",
  // Windows in one slot, taking turns: the guide that forms a group, and
  // what a group wears wherever one is named.
  group: "window-stack",
  // The outermost frame, which is the stage itself.
  stage: "window-desktop",
  // Saved values, wherever they are reached from: the button beside a
  // property's label and the one in a prompt's header open the same
  // chooser onto the same library, so they wear the same thing. A button
  // that puts a value *in* wears the same bookmark with a small plus in its
  // corner -- the one mark that separates keeping from opening.
  preset: "bookmarks",
  presetSave: "plus",
  app: "window",
  tool: "wrench-adjustable",
  system: "question-square",
  value: "tag",
};

export function registerIcon(role, icon) {
  ICONS[role] = String(icon);
  return ICONS[role];
}

// Told by the shell which property a property of an item shares, if it does:
// `resolve(binding)` -> {get, set} of the one it is, or null. A property
// inside another's value (a field, an element) never shares.
let shareResolver = null;
export function setShareResolver(resolve) {
  shareResolver = resolve;
}

// Every property gets these unless it defines its own. `get`/`set` are the
// single door to a value: the item's code and the user's control both go
// through them, so a property can never be changed two different ways.
const BASE_METHODS = {
  // A read-through value is handed its item as well as its API: a value
  // worked out from the item's own children (the prompt editor's result)
  // has to know whose children, and the API alone does not say.
  get: (p) => {
    // A property that shares another (see core's sharePort) is that one.
    if (shareResolver && !p.params.read) {
      const shared = shareResolver(p);
      if (shared) return shared.get();
    }
    return p.params.read ? p.params.read(p.api || selfApi(p.item), p.item) : p.item.props[p.key];
  },
  set: (p, value) => {
    const coerced = p.def.coerce ? p.def.coerce(value, p.params) : value;
    if (shareResolver && !p.params.read) {
      const shared = shareResolver(p);
      // What is written goes to what is shared; a read-only one takes nothing.
      if (shared) {
        if (shared.set) shared.set(coerced);
        return coerced;
      }
    }
    // A spec may redirect the write elsewhere (app settings) or record a
    // consequence of it (a document becoming unsaved).
    if (p.params.write) p.params.write(p.api, coerced, p.item);
    else p.item.props[p.key] = coerced;
    return coerced;
  },
  format: (p) => formatValue({ type: p.params.type, params: p.params, value: p.get() }),

  // A property inside this one's value. The value type declares them:
  //
  //   fields: { name: { type: "string" }, tags: { type: "list", each: {...} } }
  //
  // and a field is a property like any other -- it has a type, a control, a
  // port -- except that its owner is the value and not an item, and it keeps
  // nothing of its own: reading takes the field out of the owner's value,
  // writing puts it back through the owner's set(), which is where the whole
  // value is coerced. The fields of a value are flat. There is no section
  // here; to group fields, make the group a value and the field its property.
  fields: (p) => Object.keys(p.def.fields || {}),
  field: (p, name) => {
    const spec = p.def.fields && p.def.fields[name];
    if (!spec) throw new Error(`value type "${p.params.type}" has no field "${name}"`);
    const own = (value) => (value && typeof value === "object" && !Array.isArray(value) ? value : {});
    return bindWithin(p, name, spec, {
      read: () => {
        const value = own(p.get())[name];
        return value === undefined ? defaultFor(spec) : value;
      },
      write: (value) => p.set({ ...own(p.get()), [name]: value }),
    });
  },
  // Where this property is: the steps from the item's property down to it,
  // a field's name or a list element's position. Empty for an item's own.
  steps: (p) => (p.owner ? [...p.owner.steps(), p.step] : []),
};

// The accessor for a property that lives inside another one's value: a
// field, or an element of a list. `read`/`write` are the same hook a spec
// already has for a value kept elsewhere, pointed at the owner. They reach
// for the value when called rather than closing over a copy (see describe()),
// and the key says where the property is, so it changes when an element's
// position does.
function bindWithin(owner, step, spec, { read, write }) {
  return bindSpec(
    { ...spec, read: () => read(), write: (_api, value) => write(value) },
    { item: owner.item, key: `${owner.key}.${step}`, api: owner.api, owner, step }
  );
}

// The accessor of a list's element, by position. Lists use this for the
// `each` spec; a list type without one has no element to bind.
//
// A write puts the element back into the list's value and hands the whole
// list to `commit` -- the list's own set() unless a control, which has more
// to do when its value changes than store it, says otherwise.
//
// `items` is where the entries are read from -- the list's own value unless
// the one asking wants them as the list's type reads them (see core's ports).
export function bindElement(list, index, commit = (next) => list.set(next), items = () => list.items()) {
  const spec = list.params.each;
  if (!spec) throw new Error(`"${list.key}" has no element type (each)`);
  return bindWithin(list, index, spec, {
    read: () => items()[index],
    write: (value) => {
      const next = [...items()];
      next[index] = value;
      return commit(next);
    },
  });
}

export function elementIdentity(value, key) {
  const id = value?.[key];
  if (typeof id === "string") return id || null;
  return typeof id === "number" && Number.isFinite(id) ? String(id) : null;
}

// An edit handler may outlive the order in which it was drawn. Resolve the
// identity again on every access and refuse an ambiguous or removed entry.
export function bindElementByIdentity(list, identity, id, readonly = false) {
  const find = (items) => {
    const index = items.findIndex((one) => elementIdentity(one, identity) === id);
    return index >= 0 && !items.slice(index + 1).some((one) => elementIdentity(one, identity) === id) ? index : -1;
  };
  return bindWithin(list, id, list.params.each, {
    read: () => {
      const items = list.items();
      return items[find(items)];
    },
    write: (value) => {
      if (readonly || !value || typeof value !== "object" || Array.isArray(value)) return;
      const items = list.items();
      const index = find(items);
      if (index < 0) return;
      const next = [...items];
      next[index] = { ...value, [identity]: items[index][identity] };
      return list.set(next);
    },
  });
}

// A value type says what a value *is*: how it defaults, how it reads back
// as text, and what an item can ask it to do (its methods). It draws nothing.
// A type may be written from scratch, or derived from one already
// registered with `base`. Deriving copies the implementation -- the
// methods, the coercion, the default control -- and gives it a new name,
// which is the whole point: a height and a weight are both numbers, and
// nothing but a name can keep them from being offered to each other.
//
// It is not subclassing. Two things are deliberately left out:
//
//   Nothing dispatches through the lineage. The implementation is flattened
//   here, at registration, so a derived type is a complete independent type
//   the moment it exists and changing a base later cannot reach into it.
//
//   The lineage is still recorded, because one question needs it: what a
//   picker may offer. That is directional -- a height is usable wherever a
//   plain number is wanted, since the target has no meaning to violate,
//   while a plain number is not usable where a height is wanted, because
//   that would assert a meaning nobody recorded. See derivesFrom().
//
// `defaults` is where a derived type fixes parameters (a height is 0..300).
// They are defaults, not limits: a property may narrow them further, and
// bindSpec merges the two with the property winning.
export function registerValueType(name, def) {
  if (VALUE_TYPES[name]) throw new Error(`value type "${name}" is already registered`);

  const base = def.base ? VALUE_TYPES[def.base] : null;
  if (def.base && !base) {
    // Order matters, and saying so beats copying half a type: a plugin
    // deriving from another plugin's type says so in its manifest's
    // `requires`, which is what decides load order.
    throw new Error(
      `value type "${name}" derives from "${def.base}", which is not registered yet`
    );
  }

  const merged = base
    ? {
        ...base,
        ...def,
        // Accumulated rather than replaced: a refinement adds to what the
        // base accepted and fixed, it does not start over.
        params: def.params || base.params,
        defaults: { ...(base.defaults || {}), ...(def.defaults || {}) },
        methods: { ...base.methods, ...(def.methods || {}) },
        ancestors: [def.base, ...(base.ancestors || [])],
      }
    : { icon: ICONS.value, ...def, ancestors: [] };

  // Checked after merging, because a derived type inherits both of these.
  if (typeof merged.defaultValue !== "function") {
    throw new Error(`value type "${name}" needs a defaultValue()`);
  }
  if (!merged.defaultControl) throw new Error(`value type "${name}" needs a defaultControl`);

  VALUE_TYPES[name] = {
    icon: ICONS.value,
    ...merged,
    methods: { ...BASE_METHODS, ...(merged.methods || {}) },
    source: registrationSource || "core",
  };
  return VALUE_TYPES[name];
}

// Whether `name` is `ancestor`, or was derived from it however indirectly.
// The one place the lineage is consulted: deciding what a picker may offer.
export function derivesFrom(name, ancestor) {
  if (!name || !ancestor) return false;
  if (name === ancestor) return true;
  const def = VALUE_TYPES[name];
  return Boolean(def && (def.ancestors || []).includes(ancestor));
}

// The names of the arguments a control takes, whether its `params` is a list of
// names or a table keyed by them (typed: see the declarative design, where a
// control used from a declaration must have the table).
export function paramNames(control) {
  const params = control && control.params;
  return Array.isArray(params) ? params : Object.keys(params || {});
}

// A control is UI over some property. It never decides what a value means;
// it declares the methods it needs and is matched against properties that
// implement them.
export function registerControl(name, def) {
  if (CONTROLS[name]) throw new Error(`control "${name}" is already registered`);
  if (def.extends) def = extendControl(name, def);
  if (typeof def.render !== "function" && typeof def.mount !== "function") {
    throw new Error(`control "${name}" needs render() or mount()`);
  }
  CONTROLS[name] = {
    needs: [],
    requiresParams: [],
    ...def,
    name,
    source: registrationSource || "core",
  };
  // A plugin's own control is a decision to draw something the shell's cards
  // do not: it says why (`why`), or it is listed once the plugins are loaded
  // (see unexplainedControls), so the next one of these starts as a question.
  if (registrationSource && typeof def.why !== "string") {
    (UNEXPLAINED[registrationSource] = UNEXPLAINED[registrationSource] || []).push(name);
  }
  return CONTROLS[name];
}

// A control made from another (`extends: name`) takes what the other declares
// rather than copying it, so a derived card cannot fall behind its base -- the
// text cards built on `texteditor` had each copied its declaration and lost a
// part of it. The child's own keys win; `params`, `needs` and `requiresParams`
// are joined, never shortened (what the base takes, its child takes too). How it
// is drawn is all or nothing: a child that says none of render / update / mount /
// unmount draws as its base does; one that says any of them says all it needs,
// since half of one control's drawing over half of another's is a bug waiting.
// Its `why` is its own: a reason is not inherited.
const DRAWING = ["render", "update", "mount", "unmount"];
export function extendControl(name, def, base = CONTROLS[def.extends]) {
  if (!base) {
    // As with a value type's base: the order is the manifest's `requires`.
    throw new Error(`control "${name}" extends "${def.extends}", which is not registered yet`);
  }
  const { name: _name, source: _source, why: _why, ...inherited } = base;
  const own = DRAWING.some((key) => typeof def[key] === "function");
  if (own) for (const key of DRAWING) delete inherited[key];
  const join = (key) => [...new Set([...(base[key] || []), ...(def[key] || [])])];
  const params =
    Array.isArray(base.params) && (def.params === undefined || Array.isArray(def.params))
      ? join("params")
      : !Array.isArray(base.params) && (def.params === undefined || !Array.isArray(def.params))
        ? { ...(base.params || {}), ...(def.params || {}) }
        : null;
  if (!params) throw new Error(`control "${name}" lists its params in another shape than "${def.extends}", which it extends`);
  return {
    ...inherited,
    ...def,
    params,
    needs: join("needs"),
    requiresParams: join("requiresParams"),
    ancestors: [def.extends, ...(base.ancestors || [])],
  };
}

// Plugin -> the controls of its own that did not say why the shell's would
// not do.
const UNEXPLAINED = {};
export function unexplainedControls() {
  return Object.fromEntries(Object.entries(UNEXPLAINED).map(([id, names]) => [id, [...names]]));
}

// The accessor an item is handed: the property's methods, bound to one
// instance and one key. Created on demand -- instances stay plain data.
export function bindProperty(item, key, api) {
  return bindSpec(ITEM_TYPES[item.type].properties[key], { item, key, api });
}

// The same accessor over a spec that is not one of an item's own properties:
// an element of a list, an entry being edited in the library. `read`/`write`
// on the spec are what redirect it -- the same hook the settings item uses
// to put its values in the profile instead of in the item.
export function bindSpec(spec, { item = null, key = "", api = null, owner = null, step = null } = {}) {
  const def = valueTypeFor(spec);
  if (!def) throw new Error(`property "${key}" has unknown type "${spec.type}"`);
  // The methods are found on the type's own prototype, bound to this
  // accessor the first time each is asked for: most accessors are made to
  // read one value and never touch the rest, and a closure for every method
  // of every property of every item, on every redraw, was what an app's body
  // spent half its time on.
  const binding = Object.create(methodsOf(def));
  binding.item = item;
  binding.key = key;
  binding.params = paramsFor(spec);
  binding.api = api;
  binding.def = def;
  // Set for a property inside another's value (a field, a list element).
  binding.owner = owner;
  binding.step = step;
  return binding;
}

// A list can take its whole-list behavior from its element type.  The base
// definition remains `list`; the element only supplies behavior that needs
// to see the collection as a whole (for example, a text port for lyrics).
// Keep a stable definition for methodProtos' per-definition cache.
const listDefinitions = new WeakMap();
export function valueTypeFor(spec) {
  const base = spec && VALUE_TYPES[spec.type];
  if (!base || spec.type !== "list") return base;
  const element = spec.each && VALUE_TYPES[spec.each.type];
  if (!element || !element.list) return base;
  let result = listDefinitions.get(element);
  if (!result) {
    // What names the list as a preset (label, icon, sample, each) is not the
    // list's own: a generic list stays a list.
    const { label, icon, sample, each, ...own } = element.list;
    result = { ...base, ...own, methods: { ...base.methods, ...(own.methods || {}) } };
    listDefinitions.set(element, result);
  }
  return result;
}

// The list a port kind carries, as the spec of a plain list: the kind an element type
// names in `list.port` is the kind of the list of that element, so nothing else has to be
// registered to tell which list it is. Null where no element type says so.
export function listOfPortKind(kind) {
  if (!kind) return null;
  for (const [name, def] of Object.entries(VALUE_TYPES)) {
    if (!def.list || def.list.port !== kind) continue;
    return { ...(VALUE_TYPES.list?.defaults || {}), type: "list", each: { type: name, ...(def.list.each || {}) } };
  }
  return null;
}

// The value types a port kind can lead to, as `[type name, definition]`: the registered ones,
// then the list of each element type that declares `list.port` -- named "list", with the
// element in its `defaults`, so that it describes as a plain list of that element.
export function portTypes() {
  const out = Object.entries(VALUE_TYPES);
  for (const [name, def] of Object.entries(VALUE_TYPES)) {
    if (!def.list?.port) continue;
    const spec = listOfPortKind(def.list.port);
    if (!spec || spec.each.type !== name) continue;
    out.push(["list", { ...valueTypeFor(spec), label: def.list.label, icon: def.list.icon, defaults: spec }]);
  }
  return out;
}

// A saved value is filed under the name of its type, and a saved list under "list:" and the
// type of what it is a list of. That is all a list preset needs to be found by: there is no
// value type of its own to register for it.
const LIST_PRESET = /^list:(.+)$/;
export const listPresetKey = (element) => `list:${element}`;

// What a type key stands for as a spec: the type itself, or for a list preset the plain list of
// its element. Null for a key that is neither (a list whose element does not say it can be
// kept as a list, `list.label`, is not one).
export function presetSpecOf(key) {
  if (typeof key !== "string" || !key) return null;
  if (VALUE_TYPES[key]) return { type: key };
  const element = LIST_PRESET.exec(key)?.[1];
  const own = element && VALUE_TYPES[element]?.list;
  if (!own || !own.label) return null;
  return { type: "list", each: { type: element, ...(own.each || {}) } };
}

// The definition behind a type key: the registered type, or for a list preset the list as its
// element describes it, with the label and icon the element gives its list.
const listPresetDefs = new WeakMap();
export function presetTypeDef(key) {
  if (VALUE_TYPES[key]) return VALUE_TYPES[key];
  const spec = presetSpecOf(key);
  if (!spec) return undefined;
  const element = VALUE_TYPES[spec.each.type];
  let def = listPresetDefs.get(element);
  if (!def) {
    const own = element.list;
    const base = VALUE_TYPES.list || {};
    def = {
      ...valueTypeFor(spec),
      name: key,
      label: own.label,
      icon: own.icon || base.icon,
      sample: own.sample || { default: [] },
      defaults: { ...(base.defaults || {}), each: spec.each },
      ancestors: ["list", ...(base.ancestors || [])],
      listOf: spec.each.type,
    };
    listPresetDefs.set(element, def);
  }
  return def;
}

// Every type a value can be saved as: the registered ones, and the list of each element that
// can be kept as a list. `[key, definition]`, like Object.entries(VALUE_TYPES).
export function presetTypes() {
  const out = Object.entries(VALUE_TYPES);
  for (const [name, def] of Object.entries(VALUE_TYPES)) {
    if (def.list && def.list.label) out.push([listPresetKey(name), presetTypeDef(listPresetKey(name))]);
  }
  return out;
}

// What a property is saved as: the type, or for a list of something that can be kept as a
// list, that list's key.
export function presetTypeFor(spec) {
  if (spec && spec.type === "list" && spec.each?.type && VALUE_TYPES[spec.each.type]?.list?.label) {
    return listPresetKey(spec.each.type);
  }
  return (spec && spec.type) || "";
}

const methodProtos = new WeakMap();
function methodsOf(def) {
  let proto = methodProtos.get(def);
  if (!proto) {
    proto = {};
    for (const [method, fn] of Object.entries(def.methods)) {
      Object.defineProperty(proto, method, {
        configurable: true,
        get() {
          const bound = (...args) => fn(this, ...args);
          Object.defineProperty(this, method, { value: bound, configurable: true, writable: true });
          return bound;
        },
        // Assigned over, as a plain property would be.
        set(value) {
          Object.defineProperty(this, method, { value, configurable: true, writable: true });
        },
      });
    }
    methodProtos.set(def, proto);
  }
  return proto;
}

// A descriptor for such a spec: what every control is handed, whether the
// value belongs to an item, to a list, or to a row in the database.
//
// Two rules for a spec built on the fly, both of them consequences of the
// same thing -- a control keeps the descriptor it was rendered with, and
// only re-reads through it:
//
//   `read`/`write` must reach for the value when they are called rather
//   than close over a copy of it, or an edit will be computed from
//   whatever the value was when the control was first drawn;
//
//   `key` must change when the descriptor starts pointing somewhere else
//   (a different element of a list, a different row), because the renderer
//   reuses the DOM for an unchanged key and the old handlers with it.
//
// An item's own properties need neither: their binding is (item, key) and
// reads live, and their key is the property name.
export function describe(spec, { item = null, key = "", api = null, label = "" } = {}) {
  const property = bindSpec(spec, { item, key, api });
  return {
    key,
    label,
    type: spec.type,
    params: spec,
    value: property.get(),
    property,
    control: controlFor(spec),
    readonly: Boolean(spec.readonly),
    api,
  };
}

// The descriptor of a property that is already bound -- a field or a list
// element, which come from their owner (`field`, `element`) and not from a
// spec to be bound afresh. Its params are the property's, type defaults
// included.
export function describeProperty(property, { key = property.key, label = "", params: extra = null } = {}) {
  // `extra` is what the place that draws it adds to the property's own
  // params: a control's settings that only that place knows.
  const params = extra ? { ...property.params, ...extra } : property.params;
  return {
    key,
    label,
    type: params.type,
    params,
    value: property.get(),
    property,
    control: controlFor(params),
    readonly: Boolean(params.readonly),
    api: property.api,
  };
}

// Which control a spec ends up using: its own choice, or the type's default.
export function controlFor(spec) {
  const def = valueTypeFor(spec);
  return CONTROLS[spec.control || (def && def.defaultControl)] || null;
}

// A skin is a name and a label. The look is a [data-skin="<name>"] block in
// a stylesheet -- the shell's skins.css, or a plugin's own -- so there is
// nothing to register but the fact that the name exists and what to call it
// in the settings.
export function registerSkin(name, def = {}) {
  if (SKINS[name]) throw new Error(`skin "${name}" is already registered`);
  if (!def.label) throw new Error(`skin "${name}" needs a label`);
  SKINS[name] = { ...def, name, source: registrationSource || "core" };
  return SKINS[name];
}

export function registerPermission(name, factory) {
  if (!/^[a-z]+:[a-z]+$/.test(name)) {
    throw new Error(`permission "${name}" must look like "namespace:verb"`);
  }
  if (PERMISSIONS[name]) throw new Error(`permission "${name}" is already registered`);
  PERMISSIONS[name] = factory;
  return factory;
}

// Whether a type can be opened on its own: as a window of its own, with
// nothing else around it to hand it what it needs. Nothing can be worked out
// from an item's shape -- the clock declares no permissions and one property,
// and can be opened; core.missing declares plenty and cannot -- so the type
// says so: `standalone: true`. One that says nothing is a screen or a part
// of another item (a picker, an owned editor), reached from what it belongs
// to. Every standalone type is an app of its own (see "apps" in core), unless
// it says `app: false`: it is then openable on its own, but not listed as an app.
export const isStandalone = (def) => Boolean(def && def.standalone === true);

// Only what is intrinsic to the definition is checked here. Anything that
// points at another type is checked by validateRegistry() instead: whoever
// registers first must not be punished for it, since a plugin may own a
// type that another plugin registers later.
export function registerItemType(name, def) {
  if (ITEM_TYPES[name]) throw new Error(`item type "${name}" is already registered`);
  if (typeof def.body !== "function") throw new Error(`item type "${name}" has no body()`);
  for (const [key, spec] of Object.entries(def.properties || {})) {
    if (!spec || !spec.type) throw new Error(`item type "${name}" property "${key}" has no type`);
  }
  ITEM_TYPES[name] = {
    permissions: [],
    properties: {},
    // What it looks like in a window's title bar and in a launcher. A type
    // that says nothing gets the plain window, so every item has one.
    icon: ICONS.app,
    ...def,
    source: registrationSource || "core",
  };
  return ITEM_TYPES[name];
}

// The built-in app of a type, with what it is opened with:
//   name        what it is called, when that is not the type's label
//   icon        when it is not the type's
//   layout      a launch spec: where its windows go ("self" is the type's
//               item, { owned: key } one it holds, { add: type, tag } another)
//   props       values for the item's own properties at launch
//   defaultItem the type new windows of the frame are
//   keep        the item's properties the app keeps between launches
//   excludeHistory  its edits are left out of the operation history
// Only what is declared is an app: a type that can be opened on its own
// (`standalone`, from the Item Catalog, as an app that has not been kept) is
// none until an app is declared for it. A plugin declares its apps as data in
// its manifest (`apps`); what a plugin builds in code, and the shell's own
// types, register them here.
export function registerApp(type, def = {}) {
  if (typeof type !== "string" || !type) throw new Error("an app needs the item type it is the app of");
  if (APPS[type]) throw new Error(`app "${type}" is already registered`);
  APPS[type] = { ...def, type, source: registrationSource || "core" };
  return APPS[type];
}

// Run once every registration has happened. Returns the problems it found
// rather than throwing on the first one, so a broken type can be reported
// (and later disabled) without taking the shell down with it.
export function registryProblems() {
  const problems = [];
  const found = (source, message) => problems.push({ source: source || "core", message });
  // What a value type says about itself has to hold together: the control it
  // is drawn with exists and can be asked what it asks, a field's and an
  // element's types and controls are real, and a port is a kind or nothing.
  const controlFits = (source, where, control, typeName) => {
    const found2 = (message) => found(source, message);
    const type = VALUE_TYPES[typeName];
    if (!type) return;
    const wanted = CONTROLS[control];
    if (!wanted) return found2(`${where} wants unknown control "${control}"`);
    const missing = (wanted.needs || []).filter((method) => typeof type.methods[method] !== "function");
    if (missing.length) found2(`${where}: control "${control}" needs ${missing.join(", ")}, which value type "${typeName}" does not implement`);
  };
  // The fields of a value are a flat list of properties (see BASE_METHODS):
  // a field that names a section, or one whose type is nobody's, has no way
  // to be shown or carried.
  // A port kind can have at most one value type that declares `preview`:
  // shared kinds (such as "text") do not declare one.
  const previewByKind = new Map();
  for (const [name, def] of Object.entries(VALUE_TYPES)) {
    // An identity is the key of the value that keeps an element the same
    // entry while the list around it changes. It is not a field: nobody
    // edits it, and a field is a property someone could.
    if (def.identity !== undefined && (typeof def.identity !== "string" || !def.identity)) {
      found(def.source, `value type "${name}" has an identity that is not a key`);
    }
    // How an entry is carried is said by the type of the element (port,
    // portKindOf, portRead, portGroup...), never by the list around it.
    if ("entryPort" in def) {
      found(def.source, `value type "${name}" declares entryPort; say how an entry is carried on the type of the element`);
    }
    if ("portControl" in def) {
      found(def.source, `value type "${name}" declares portControl; use preview`);
    }
    if (def.preview !== undefined) {
      if (typeof def.port !== "string" || !def.port) {
        found(def.source, `value type "${name}" declares preview without a port kind`);
      } else if (previewByKind.has(def.port)) {
        found(def.source, `value type "${name}" declares preview for port kind "${def.port}", which "${previewByKind.get(def.port)}" already previews`);
      } else {
        previewByKind.set(def.port, name);
      }
      if (!def.preview || typeof def.preview !== "object" || Array.isArray(def.preview)) {
        found(def.source, `value type "${name}" has an invalid preview`);
      } else if (typeof def.preview.control === "string") {
        controlFits(def.source, `value type "${name}" preview`, def.preview.control, name);
      } else if (!Array.isArray(def.preview.layout) && typeof def.preview.build !== "function") {
        found(def.source, `value type "${name}" preview needs a control or layout`);
      }
    }
    for (const [field, spec] of Object.entries(def.fields || {})) {
      if (!spec || !VALUE_TYPES[spec.type]) {
        found(def.source, `value type "${name}" field "${field}" has no registered type`);
      }
      for (const banned of ["section", "sections", "group"]) {
        if (spec && banned in spec) {
          found(def.source, `value type "${name}" field "${field}" names a ${banned}; the fields of a value are flat`);
        }
      }
    }
  }
  // The list of an element is checked as the type it is: its preview needs the kind it is
  // carried as, a kind is previewed by one type only, and the control it is drawn with can be
  // asked what it asks.
  for (const [name, def] of Object.entries(VALUE_TYPES)) {
    const own = def.list;
    if (!own) continue;
    const where = `the list of value type "${name}"`;
    const listDef = valueTypeFor({ type: "list", each: { type: name } });
    if (own.preview !== undefined) {
      if (typeof own.port !== "string" || !own.port) {
        found(def.source, `${where} declares preview without a port kind`);
      } else if (previewByKind.has(own.port)) {
        found(def.source, `${where} declares preview for port kind "${own.port}", which "${previewByKind.get(own.port)}" already previews`);
      } else {
        previewByKind.set(own.port, `the list of ${name}`);
      }
      if (!own.preview || typeof own.preview !== "object" || Array.isArray(own.preview)) {
        found(def.source, `${where} has an invalid preview`);
      } else if (typeof own.preview.control === "string") {
        const wanted = CONTROLS[own.preview.control];
        if (!wanted) found(def.source, `${where} preview wants unknown control "${own.preview.control}"`);
      } else if (!Array.isArray(own.preview.layout) && typeof own.preview.build !== "function") {
        found(def.source, `${where} preview needs a control or layout`);
      }
    }
    if (own.port !== undefined && own.port !== false && typeof own.port !== "string") {
      found(def.source, `${where} has a port that is neither a kind nor false`);
    }
    const wantedControl = CONTROLS[listDef.defaultControl];
    if (!wantedControl) {
      found(def.source, `${where} wants unknown control "${listDef.defaultControl}"`);
    } else {
      const missing = (wantedControl.needs || []).filter((method) => typeof listDef.methods[method] !== "function");
      if (missing.length) found(def.source, `${where}: control "${listDef.defaultControl}" needs ${missing.join(", ")}, which a list does not implement`);
    }
  }
  // A list is a list of values, each addressable: its elements are of a
  // type that declares an identity, or the list type itself says its
  // elements are records with one (`identity`); a list of links is told by the items. A property
  // that holds an array nobody addresses is not a list but data (the `data`
  // type).
  const addressable = (spec) => {
    const type = VALUE_TYPES[spec.type];
    if (!type || (spec.type !== "list" && !derivesFrom(spec.type, "list"))) return true;
    if (spec.identity || type.identity) return true;
    // A list of the items it links to: each is told apart by the item it is.
    if (spec.link === true && spec.itemType) return true;
    const each = paramsFor(spec).each;
    const element = each && VALUE_TYPES[each.type];
    return Boolean(element && element.identity);
  };
  for (const [name, def] of Object.entries(VALUE_TYPES)) {
    for (const [field, spec] of Object.entries(def.fields || {})) {
      if (!addressable(spec)) {
        found(def.source, `value type "${name}" field "${field}" is a list whose elements have no identity; use the data type`);
      }
    }
  }
  for (const [name, def] of Object.entries(ITEM_TYPES)) {
    for (const [key, spec] of Object.entries(def.properties || {})) {
      if (!addressable(spec)) {
        found(def.source, `item type "${name}" property "${key}" is a list whose elements have no identity; use the data type`);
      }
    }
    for (const permission of def.permissions) {
      if (!(permission in PERMISSIONS)) {
        found(def.source, `item type "${name}" wants unknown permission "${permission}"`);
      }
    }
    // One window of a larger app names the dashboard that is that app's
    // body -- which has to exist, or the type is listed nowhere at all.
    if (def.partOf !== undefined && !ITEM_TYPES[def.partOf]) {
      found(def.source, `item type "${name}" is part of unknown app "${def.partOf}"`);
    }
    for (const [key, spec] of Object.entries(def.properties)) {
      const type = valueTypeFor(spec);
      if (!type) {
        found(def.source, `item type "${name}" property "${key}" has unknown type "${spec.type}"`);
        continue;
      }
      // A ref is a link and says so (`link: true`): it names an item that exists on its
      // own. A readonly ref only shows where something points; it relates nothing.
      if (derivesFrom(spec.type, "ref") && !spec.readonly && spec.link !== true) {
        found(def.source, `item type "${name}" property "${key}" is a ref that does not link (link: true)`);
      }
      // A slot an app is linked into (see core, app links): a ref to an
      // app of a named type.
      if (spec.link === true) {
        if (!(derivesFrom(spec.type, "ref") || derivesFrom(spec.type, "list")) || !spec.itemType) {
          found(def.source, `item type "${name}" property "${key}" is a link but not a ref or list with an itemType`);
        }
        for (const held of typeof spec.itemType === "function" ? [] : [].concat(spec.itemType || [])) {
          if (!ITEM_TYPES[held]) found(def.source, `item type "${name}" property "${key}" links to unknown type "${held}"`);
        }
      }
      // What was once a child of its owner is not any more: say so at start-up.
      if (spec.owns || spec.linkedToOwner || derivesFrom(spec.type, "children")) {
        found(def.source, `item type "${name}" property "${key}" is owned or owner-linked: nothing is owned by another item now (use link: true and a window of its own)`);
      }

      // Control fit, checked by method set rather than by type name: a
      // control works with any property that can answer what it asks.
      const wanted = spec.control || type.defaultControl;
      const control = CONTROLS[wanted];
      if (!control) {
        found(def.source, `item type "${name}" property "${key}" wants unknown control "${wanted}"`);
        continue;
      }
      const missing = control.needs.filter((method) => typeof type.methods[method] !== "function");
      if (missing.length) {
        found(def.source, 
          `control "${wanted}" needs ${missing.join(", ")}, which value type "${spec.type}" does not implement`
        );
      }
      const withDefaults = paramsFor(spec);
      const absent = control.requiresParams.filter((param) => withDefaults[param] === undefined);
      if (absent.length) {
        found(def.source, 
          `item type "${name}" property "${key}" uses "${wanted}", which needs ${absent.join(", ")}`
        );
      }
    }
  }

  for (const [name, def] of Object.entries(VALUE_TYPES)) {
    controlFits(def.source, `value type "${name}"`, def.defaultControl, name);
    if (def.port !== undefined && def.port !== false && typeof def.port !== "string") {
      found(def.source, `value type "${name}" has a port that is neither a kind nor false`);
    }
    for (const [field, spec] of Object.entries(def.fields || {})) {
      if (spec && VALUE_TYPES[spec.type]) {
        controlFits(def.source, `value type "${name}" field "${field}"`, spec.control || VALUE_TYPES[spec.type].defaultControl, spec.type);
      }
    }
    const each = (def.defaults || {}).each;
    if (each) {
      if (!VALUE_TYPES[each.type]) found(def.source, `value type "${name}" holds elements of unknown type "${each.type}"`);
      else controlFits(def.source, `value type "${name}" element`, each.control || VALUE_TYPES[each.type].defaultControl, each.type);
    }
  }
  // What is shown has words, in every language the shell speaks: a label with
  // no translation reads as its own key.
  const tables = i18n ? i18n.translationTables() : null;
  if (tables) {
    const languages = ["ja", "en"];
    // Check every registered string, including ones used only by scripts or
    // dynamic controls, not just the labels exposed by the registry.
    const keys = new Set(languages.flatMap((lang) => Object.keys(tables[lang] || {})));
    for (const key of keys) {
      const lacking = languages.filter((lang) => typeof (tables[lang] || {})[key] !== "string" || !(tables[lang] || {})[key].trim());
      if (lacking.length) found("translations", `translation "${key}" is missing in ${lacking.join(", ")}`);
    }
    const labelled = (source, where, key) => {
      if (typeof key !== "string" || !key) return;
      const lacking = languages.filter((lang) => !(tables[lang] || {})[key]);
      if (lacking.length) found(source, `${where} has the label "${key}", which has no translation in ${lacking.join(", ")}`);
    };
    for (const [name, def] of Object.entries(ITEM_TYPES)) {
      labelled(def.source, `item type "${name}"`, def.label);
      for (const [key, spec] of Object.entries(def.properties || {})) labelled(def.source, `item type "${name}" property "${key}"`, spec.label);
    }
    for (const [name, def] of Object.entries(VALUE_TYPES)) labelled(def.source, `value type "${name}"`, def.label);
    for (const [name, def] of Object.entries(VALUE_TYPES)) if (def.list) labelled(def.source, `the list of value type "${name}"`, def.list.label);
    for (const [name, def] of Object.entries(CONTROLS)) labelled(def.source, `control "${name}"`, def.label);
  }
  return problems;
}

// The same, as sentences.
export const validateRegistry = () => registryProblems().map((one) => one.message);

// An item is handed exactly the namespaces its type declared, and nothing
// else -- an item without window:write has no method to edit the layout.
// What every item has, whatever it declared: what its connections give it (the
// items the user -- or the app's layout -- connected to it). Namespace -> factory,
// registered once by the shell; a permission with the same namespace is merged
// over it, so `items:read` widens `items.get` from what is connected to every item.
const BASE_APIS = [];
export function registerBaseApi(namespace, factory) {
  BASE_APIS.push([namespace, factory]);
}

export function grantApi(def, ctx) {
  const api = {};
  for (const [namespace, factory] of BASE_APIS) api[namespace] = Object.assign(api[namespace] || {}, factory(ctx));
  for (const permission of def.permissions || []) {
    const factory = PERMISSIONS[permission];
    const [namespace] = permission.split(":");
    api[namespace] = Object.assign(api[namespace] || {}, factory(ctx));
  }
  return api;
}

// The api of an item as its own code has it, for a read-through value that is
// read from outside the item (a port, a link) and so has no api of its own to
// be handed: a value worked out from what the item is connected to reads it
// through the item's connections, as the item's body would.
const selfApis = new WeakMap();
export function selfApi(item) {
  const def = item && ITEM_TYPES[item.type];
  if (!def) return null;
  if (!selfApis.has(item)) selfApis.set(item, grantApi(def, { windowId: null, itemId: item.id }));
  return selfApis.get(item);
}

// What a spec amounts to once the type has had its say: a derived type's
// fixed parameters, with the property's own on top. One place, so a value
// is coerced, defaulted and formatted under the same parameters wherever it
// is read.
export function paramsFor(spec) {
  const def = VALUE_TYPES[spec.type];
  const given = !def || !def.defaults ? spec : { ...def.defaults, ...spec };
  // A list says what it is a list of, and the element says what its entries are given when
  // they are listed (`list.each`: a placeholder, say).
  const extra = spec.type === "list" && spec.each ? VALUE_TYPES[spec.each.type]?.list?.each : null;
  return extra ? { ...given, each: { ...extra, ...spec.each } } : given;
}

export function defaultFor(spec) {
  const def = valueTypeFor(spec);
  if (!def) throw new Error(`unknown value type: ${spec.type}`);
  return def.defaultValue(paramsFor(spec));
}

export function formatValue(descriptor) {
  const def = valueTypeFor({ ...(descriptor.params || {}), type: descriptor.type });
  if (!def) return String(descriptor.value);
  const params = paramsFor({ ...(descriptor.params || {}), type: descriptor.type });
  return def.format ? def.format(descriptor.value, params) : String(descriptor.value);
}

