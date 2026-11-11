/* What a control is handed (its descriptor): the property it shows, its
 * state, its bindings and its actions. Split out of view.js (2026-11-11);
 * part of the view module. */
import { CONTROLS, getItem, itemProperties, adaptDescriptor, t } from "./deps.js";
import { controlStates, entryAddress, renderNodes, announceViewChange } from "./view.js";

export function controlActionKey(node) {
  return JSON.stringify([node.bind, node.params?.binds, node.params?.states]);
}

// A control node comes in two shapes. Bound: it names a property, and the
// descriptor is that property's -- so a placed control and the property
// table always show the same value. Standalone: it names a control and
// carries its own parameters, which is how a button exists without a
// property behind it.
export function controlDescriptor(node, ctx, path) {
  let base = controlDescriptorOf(node, ctx);
  if (node.params?.valueAdapter && base.property) {
    base = adaptDescriptor(base, node.params.valueAdapter, (message) => ctx.status?.(t("mu.control.conversionWriteError", { message })));
  }
  const bound = withBinds(named(base), node, ctx);
  const desc = path ? withControlState(bound, node, ctx, path) : bound;
  // Composite controls may place the same keyed nodes as an item body.
  // The renderer retains the item's context and handles updates and teardown.
  return desc.control?.nestedNodes ? {
    ...desc,
    renderNodes: (host, nodes, slot) => renderNodes(host, nodes || [], ctx, slot === undefined ? path : [...(path || []), ["slot", slot]]),
  } : desc;
}

// A stateful argument belongs to the item and the keyed placement of the
// control. A property binding or an explicit constant takes precedence.
export function withControlState(desc, node, ctx, path) {
  const table = desc.control?.params;
  if (!ctx.item || !table || Array.isArray(table)) return desc;
  const id = ctx.item.id;
  const saved = controlStates.get(id);
  const keys = new Map();
  const params = { ...desc.params };
  for (const [arg, spec] of Object.entries(table)) {
    if (arg === "view" && !node.params?.viewNodes?.length) continue;
    const name = Object.hasOwn(node.params?.states || {}, arg) ? node.params.states[arg] : undefined;
    if (spec.state !== true || Object.hasOwn(node.params?.binds || {}, arg) || (name === undefined && Object.hasOwn(params, arg))) continue;
    const key = JSON.stringify([path, desc.control.name, node.bind ?? desc.key, name ?? arg]);
    keys.set(arg, key);
    params[arg] = saved?.has(key) ? JSON.parse(saved.get(key)) : spec.default;
  }
  if (!keys.size) return desc;
  return {
    ...desc, params,
    readControlState(arg) {
      const key = keys.get(arg);
      if (!key) return params[arg];
      const encoded = controlStates.get(id)?.get(key);
      return encoded === undefined ? table[arg].default : JSON.parse(encoded);
    },
    set(arg, value) {
      const key = keys.get(arg);
      if (!key) return desc.set(arg, value);
      if (table[arg].bind !== "readwrite" || getItem(id) !== ctx.item) return false;
      const encoded = JSON.stringify(value);
      const entries = controlStates.get(id) || new Map();
      if (entries.get(key) === encoded) return true;
      if (encoded === undefined) {
        entries.delete(key);
        if (!entries.size) controlStates.delete(id);
      } else {
        entries.set(key, encoded);
        controlStates.set(id, entries);
      }
      announceViewChange({ redraw: true });
      return true;
    },
  };
}

// Where a control's own arguments are kept, said as data on its node: `binds: { arg: "property" }`,
// or `{ arg: { field: "property", ... } }` for an argument that is a set of values (a card's display
// options). The arguments are read from those properties, and what the control writes back with
// `desc.set(arg, value)` goes into them -- the same door a declaration's `{ "bind": ... }` is compiled
// to, and the one an item's own body uses, so neither hands a control a function to call back.
// `desc.set` answers whether it kept the value: a control with nothing bound keeps it itself.
export function withBinds(desc, node, ctx) {
  const binds = node && node.params && node.params.binds;
  if (!binds || !ctx || typeof ctx.property !== "function") return { ...desc, set: () => false };
  const read = (key) => {
    try {
      return ctx.property(key).get();
    } catch {
      return undefined;
    }
  };
  const params = { ...desc.params };
  for (const [arg, to] of Object.entries(binds)) {
    params[arg] = typeof to === "string" ? read(to) : Object.fromEntries(Object.entries(to).map(([field, key]) => [field, read(key)]));
  }
  const set = (arg, value) => {
    if (!Object.hasOwn(binds, arg) || desc.control?.params?.[arg]?.bind !== "readwrite") return false;
    const to = binds[arg];
    if (typeof to === "string") {
      ctx.property(to).set(value);
    } else {
      for (const [field, key] of Object.entries(to)) {
        if (value && Object.hasOwn(value, field) && value[field] !== read(key)) ctx.property(key).set(value[field]);
      }
    }
    announceViewChange({ redraw: true });
    return true;
  };
  return { ...desc, params, set };
}

// A card control is named by its descriptor's label, in its header, where it is an entry of a list (or
// says it is one): the same rule the property rows apply (paintPropRow), for the cards placed as controls.
export function named(desc) {
  const control = desc.control;
  if (!control || control.mount || typeof control.cardName !== "function" || !desc.label || desc.unlabeled) return desc;
  const params = desc.params || {};
  if (!entryAddress(params.port) && params.isListElement !== true) return desc;
  return desc.head === desc.label ? desc : { ...desc, head: desc.label };
}

// `readonly: true` on a control node (NODES.control(key, bind, { readonly: true })) makes this control
// read-only whatever the property behind it is: the same property can be typed into in one place and only
// shown in another. It cannot make a read-only property writable (`readonly: false` is not read).
// A control that knows what read-only means for it (a text card, a percent) says so itself from
// `desc.readonly`; for every other one the shell does the plain part (paintReadonly below), so that a
// control does not have to be written to be set read-only.
export function controlDescriptorOf(node, ctx) {
  const desc = controlDescriptorBase(node, ctx);
  return node.params && node.params.readonly === true && !desc.readonly ? { ...desc, readonly: true } : desc;
}

export function controlDescriptorBase(node, ctx) {
  // A descriptor the body built itself, placed as a control of its own.
  // What a property row gives such a field is a label column, and a field
  // whose meaning is the screen it is on -- the chooser's group filter --
  // has nothing to put in it. See describe()'s two rules: such a spec has
  // to read live and be keyed by what it points at.
  if (node.desc) {
    const control = node.control ? CONTROLS[node.control] : node.desc.control;
    if (!control) throw new Error(`control "${node.key}" wants unknown control "${node.control}"`);
    return {
      ...node.desc,
      control,
      params: node.params ? { ...node.desc.params, ...node.params } : node.desc.params,
    };
  }

  if (node.bind) {
    const found = itemProperties(ctx.item, ctx.api).find((desc) => desc.key === node.bind);
    if (!found) throw new Error(`control "${node.key}" is bound to unknown property "${node.bind}"`);
    const control = node.control ? CONTROLS[node.control] : found.control;
    if (!control) throw new Error(`control "${node.key}" wants unknown control "${node.control}"`);
    return {
      ...found,
      control,
      // A node may add parameters of its own on top of the property's spec.
      params: node.params ? { ...found.params, ...node.params } : found.params,
    };
  }

  const control = CONTROLS[node.control];
  if (!control) throw new Error(`control "${node.key}" wants unknown control "${node.control}"`);
  return {
    key: node.key,
    label: node.key,
    unlabeled: true,
    control,
    params: node.params || {},
    api: ctx.api,
    item: ctx.item,
    readonly: true,
  };
}

// The plain part of a read-only control, for any control: the text fields in it cannot be typed into
// and the choices cannot be changed, and it wears `is-readonly`. What a control sets itself (a hidden
// upload button, a muted colour) is its own business. Not for a control that stands on its own with no
// property behind it (a button): `unlabeled`, which is read-only by having nothing to write. Nor for one
// that says what to do when it is changed (`change`, an action): the value is only read, and the change
// goes by the action.
export function paintReadonly(el, desc) {
  const on = Boolean(desc.readonly) && !desc.unlabeled && !desc.control.mount && !(desc.params && typeof desc.params.change === "function");
  el.classList.toggle("is-readonly", on);
  // What it holds can still be carried out, but nothing is pasted, linked or shared into it (the guides
  // offer it as refused: see startPortMove).
  for (const port of [el, ...el.querySelectorAll(".mu-port")]) {
    if (on) port.dataset.portReadonly = "1";
    else delete port.dataset.portReadonly;
  }
  const fields = el.querySelectorAll('input:not([type="button"]):not([type="submit"]):not([type="hidden"]):not([type="file"]), textarea, select');
  for (const field of fields) {
    const way = field.tagName === "SELECT" || ["checkbox", "radio", "range", "color"].includes(field.type) ? "disabled" : "readOnly";
    if (on) {
      if (!field[way]) {
        field[way] = true;
        field.__readonlyBy = way;
      }
    } else if (field.__readonlyBy === way) {
      field[way] = false;
      delete field.__readonlyBy;
    }
  }
}
