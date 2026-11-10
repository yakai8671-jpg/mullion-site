/* Chain Run -- what the screen, the value types and the run share.
 *
 * The chain is one flat list of blocks (value type `chain.blocks`). A block that holds others -- a
 * repeat, an if -- does not contain them: it is a start marker with an end marker (and for an if, an
 * else) added beside it that cannot be taken away alone, and what stands between the two is what it
 * holds. Held flat, every block is one entry of one list, which is what lets a block's grip carry it
 * as a port; at run time the list is read as the tree it says (`derive`).
 *
 *   run      press a button of a linked app -- picked on the app's own window -- after applying what
 *            the chain has set to it
 *   set      one property of an app, picked on its window -- or its preset as a whole: a value typed
 *            in, or what another property carries. Held until the app runs, and applied after its
 *            preset: a set wins over a preset
 *   repeat   what is between it and its end N times, or once for each picture / line a block made
 *   if       one block's output tested; what is up to the else, or after it
 *   setvar   puts a value in one of the chain's variables, or adds to it
 *
 * What goes from one block to another is a reference ({block: id}) made by dragging a block's grip
 * onto the card of a property it should set. It is resolved when the block runs, never read
 * implicitly from a window. What the chain asks of the apps goes through `api.apps` -- their buttons,
 * inputs and outputs. The apps are the ones linked in; this plugin never opens or places one.
 */

import { appEmbed } from "../workflow/runner.js";

let CORE = null;
let TYPES = {};

// Given by scripts.js when the plugin starts.
export function setup({ core, valueTypes }) {
  CORE = core;
  TYPES = valueTypes;
}
export const core = () => CORE;
export const valueTypes = () => TYPES;
const t = (key, vars) => CORE.t(key, vars);

export const isPlain = (value) => !!value && typeof value === "object" && !Array.isArray(value);

let seq = 0;
export const newId = () => `b${Date.now().toString(36)}${(seq++).toString(36)}`;

// ---- the blocks ---------------------------------------------------------
// The kinds a person chooses between; the markers are made with them.
export const KIND_ORDER = ["run", "set", "repeat", "if", "setvar"];
export const MARKERS = { repeat: ["endrepeat"], if: ["else", "endif"] };
export const MARKER_KINDS = ["endrepeat", "else", "endif"];
export const ALL_KINDS = [...KIND_ORDER, ...MARKER_KINDS];
export const KIND_ICON = {
  run: "play-fill",
  set: "box-arrow-in-right",
  repeat: "arrow-repeat",
  if: "signpost-split",
  setvar: "braces",
  endrepeat: "arrow-repeat",
  else: "signpost-split",
  endif: "signpost-split",
};
// What makes an output to take: not a marker, and not a set.
export const MAKES_OUTPUT = ["run", "repeat"];
// The step of a block's address that leads to one of its results.
export const RESULT = "out.";

// What a block of a kind starts as.
export const starting = (kind) =>
  ({
    run: { button: null },
    set: { app: "", key: "", source: { type: "value" } },
    repeat: { mode: "times", count: 3, source: "" },
    if: { test: "has", source: "", value: "" },
    setvar: { target: "", op: "set", value: undefined, amount: 1 },
  })[kind];
export const markersFor = (kind, id) => (MARKERS[kind] || []).map((marker) => ({ id: newId(), kind: marker, pair: id }));

export function coerceBlock(raw) {
  const one = isPlain(raw) ? raw : {};
  const kind = ALL_KINDS.includes(one.kind) ? one.kind : "run";
  const { parent: _parent, slot: _slot, ...rest } = one;
  return {
    ...rest,
    id: typeof one.id === "string" && one.id ? one.id : newId(),
    kind,
    // The start a marker belongs to.
    pair: typeof one.pair === "string" ? one.pair : "",
  };
}

// A block of an older kind: a variable made by a block is now one of the chain's list and the block
// gives it its first value, as the block did.
function fromLegacy(raw) {
  if (!isPlain(raw) || (raw.kind !== "var" && raw.kind !== "text")) return raw;
  const name = String(raw.name || "").trim();
  if (!name || typeof raw.id !== "string") return null;
  const number = raw.kind === "var" && raw.mode !== "text";
  return {
    id: raw.id,
    kind: "setvar",
    pair: "",
    target: raw.id,
    op: "set",
    value: raw.kind === "text" ? String(raw.template ?? "") : number ? Number(raw.start) || 0 : String(raw.text ?? ""),
    amount: 1,
  };
}

export function coerceBlocks(value) {
  const seen = new Set();
  const rawList = Array.isArray(value) ? value : [];
  // A property set that took the value of one of those blocks takes the variable.
  const made = new Set(
    rawList.filter((raw) => isPlain(raw) && (raw.kind === "var" || raw.kind === "text") && String(raw.name || "").trim()).map((raw) => raw.id)
  );
  const list = rawList
    .map(fromLegacy)
    .filter(Boolean)
    .map((raw) =>
      raw.kind === "set" && isPlain(raw.source) && raw.source.type === "ref" && made.has(raw.source.block)
        ? { ...raw, source: { type: "ref", variable: raw.source.block } }
        : raw
    )
    .map(coerceBlock)
    .filter((one) => {
      if (seen.has(one.id)) return false;
      seen.add(one.id);
      return true;
    });
  // A run block no longer holds a preset or an output: the preset it held is a set of the app's preset
  // just before it, and what it picked to make is the app's own.
  return list.flatMap((one) => {
    const { preset, output: _output, ...rest } = one;
    if (one.kind !== "run" || (preset === undefined && _output === undefined)) return [one];
    const app = isPlain(one.button) ? one.button.app : "";
    const lead =
      preset && app
        ? [{ id: `${one.id}-preset`, kind: "set", pair: "", app, key: "preset", shown: "", valueKind: "preset", source: { type: "value", value: String(preset) } }]
        : [];
    return [...lead, rest];
  });
}

export const coerceVariables = (value) =>
  (Array.isArray(value) ? value : [])
    .filter((one) => isPlain(one) && typeof one.name === "string" && one.name)
    .map((one) => ({
      name: one.name,
      type: typeof one.type === "string" ? one.type : "string",
      value: one.value === undefined || one.value === null ? "" : String(one.value),
    }));

export const coerceDecls = (value) => {
  const seen = new Set();
  return (Array.isArray(value) ? value : [])
    .filter((one) => isPlain(one) && typeof one.id === "string" && one.id && !seen.has(one.id) && seen.add(one.id))
    .map((one) => ({
      id: one.id,
      name: typeof one.name === "string" ? one.name : "",
      type: typeof one.type === "string" && one.type ? one.type : "string",
      keep: Boolean(one.keep),
      value: one.value === undefined ? null : one.value,
    }));
};

// The chain's variables, with those an older chain made by blocks that are still in what was saved.
export function declaredVariables(props) {
  const stored = coerceDecls(props.variableList);
  const seen = new Set(stored.map((one) => one.id));
  const found = [];
  for (const raw of Array.isArray(props.blocks) ? props.blocks : []) {
    if (!isPlain(raw) || (raw.kind !== "var" && raw.kind !== "text") || typeof raw.id !== "string" || seen.has(raw.id)) continue;
    const name = String(raw.name || "").trim();
    if (!name) continue;
    seen.add(raw.id);
    found.push({ id: raw.id, name, type: raw.kind === "var" && raw.mode !== "text" ? "number" : "string", keep: false, value: null });
  }
  return [...stored, ...found];
}

// The list read as what it says: each block with the block it is inside and which part of it (a
// repeat's body, an if's `then` or `else`), its number (2, then 2-1 and 2-2 inside the second block),
// and what is wrong with how the markers stand. Markers come back flagged and with their start's number.
export function derive(blocks) {
  const list = [];
  const stack = [];
  const problems = [];
  const path = [0];
  const labels = new Map();
  for (const block of blocks) {
    const top = stack[stack.length - 1] || null;
    const place = { parent: top ? top.id : "", slot: top ? top.slot : "" };
    if (MARKER_KINDS.includes(block.kind)) {
      const closes = block.kind === "endrepeat" ? "repeat" : "if";
      if (top && top.kind === closes && block.pair === top.id && (block.kind !== "else" || top.slot === "then")) {
        list.push({ ...block, ...place, marker: true, label: labels.get(top.id) || "" });
        if (block.kind === "else") top.slot = "else";
        else {
          stack.pop();
          path.pop();
        }
      } else {
        list.push({ ...block, ...place, marker: true, label: "", invalid: true });
        problems.push({ id: block.id, text: "chain.problem.marker" });
      }
      continue;
    }
    path[path.length - 1] += 1;
    const label = path.join("-");
    list.push({ ...block, ...place, label, marker: false });
    labels.set(block.id, label);
    if (block.kind === "repeat" || block.kind === "if") {
      stack.push({ id: block.id, kind: block.kind, slot: block.kind === "if" ? "then" : "" });
      path.push(0);
    }
  }
  for (const open of stack) problems.push({ id: open.id, text: "chain.problem.unclosed" });
  return { list, problems };
}

// ---- values -------------------------------------------------------------
// Words out of whatever a source carries, for a place that takes text: a list of prompts, a list of
// tags or one prompt, read as the line they add up to -- never as the objects they are made of.
export function textOf(value) {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) {
    // A list of tags is told from a list of prompts by what its entries are: a prompt says what kind
    // it is, a tag only what it says.
    const tags = value.length > 0 && value.every((one) => isPlain(one) && typeof one.text === "string" && !("kind" in one));
    return CORE.portConvert(value, tags ? "taglist" : "promptlist", "text") ?? "";
  }
  if (isPlain(value)) return CORE.portConvert(value, "prompt", "text") ?? "";
  return String(value);
}
// A value, as the text it reads as.
export const asText = (value) =>
  typeof value === "string" ? value : typeof value === "number" || typeof value === "boolean" ? String(value) : textOf(value);
export const copyValue = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));
// The kinds of variable that hold a list, and what each is a list of: what a variable's `type` says
// when it is not a value type of its own.
export const VARIABLE_LISTS = { "prompt.tags": "prompt.tag", "prompt.template": "prompt.slot" };
// The spec a variable's value is edited and kept under.
export const specOfVariable = (type) => (VARIABLE_LISTS[type] ? { type: "list", each: { type: VARIABLE_LISTS[type] } } : { type });
// The kind of variable that holds the list a port kind carries, if any.
export const variableOfKind = (kind) => Object.keys(VARIABLE_LISTS).find((name) => TYPES[VARIABLE_LISTS[name]]?.list?.port === kind) || "";
// What a value of a type is before anything is put in it.
export const blankOf = (type) => {
  const spec = specOfVariable(type);
  const def = TYPES[spec.type];
  if (def && typeof def.defaultValue === "function") return def.defaultValue(spec);
  return type === "number" ? 0 : type === "boolean" ? false : "";
};

// ---- what the linked apps offer ------------------------------------------
// The kinds of what a block picked, from the app as it is now: kept in the block when it was picked,
// and asked of the app again for a block saved before that was kept.
const surfaceKinds = new Map();
// The api of the chain that was last drawn or run: a value type's hooks (a block's inputs and results)
// have none in hand, and read the apps through the chain they belong to.
let LAST = null;
export const remember = (api) => {
  if (api) LAST = api;
};
export const lastApi = () => LAST;

export function pickedKind(app, key, of, api = LAST) {
  const cacheKey = `${of}|${app}|${key}`;
  if (surfaceKinds.has(cacheKey)) return surfaceKinds.get(cacheKey);
  let found = "";
  try {
    const surface = api && api.apps.surface(app);
    const one = surface && (of === "input" ? surface.inputs : surface.outputs).find((entry) => entry.key === key);
    found = (one && one.kind) || "";
  } catch (error) {
    found = "";
  }
  // What an app makes can change kind from one run to the next (a search that takes one element or a
  // list): only what it takes in is kept.
  if (found && of === "input") surfaceKinds.set(cacheKey, found);
  return found;
}
export const inputKindOf = (entry) => entry.valueKind || (entry.app && entry.key ? pickedKind(entry.app, entry.key, "input") : "") || "value";

// What a run block's control makes: the outputs the app draws together with the button it presses (a
// picture and the pictures are one result -- the pictures).
const homeOf = (one) => (Array.isArray(one.node) ? one.node[0] : typeof one.node === "string" ? one.node : one.key);
export function resultsOf(api, app, buttonKey) {
  let surface = null;
  try {
    surface = app && buttonKey ? api.apps.surface(app) : null;
  } catch (error) {
    surface = null;
  }
  const button = surface && surface.buttons.find((one) => one.key === buttonKey);
  if (!button) return [];
  const made = surface.outputs.filter((one) => homeOf(one) === homeOf(button));
  return made.some((one) => one.kind === "imagelist") ? made.filter((one) => one.kind !== "image") : made;
}

export const labelOf = (api, id) => {
  const entry = id ? api.items.get(id) : null;
  return entry ? entry.label : "";
};

// ---- running ------------------------------------------------------------
// What each chain is up to, by item id: not saved with the layout.
export const RUNS = new Map();

const loopIndex = (state) => (state.loop.length ? state.loop[state.loop.length - 1].index : 0);

// `{name}` in a template: the loop's number ({i}), the date and time ({date} {time} {datetime}, or
// {year} {month} {day} {hour} {minute} {second}), or a variable the chain has made. `{name:3}` is a
// whole number made three digits wide with zeros. Unknown names are left as written.
export function fill(template, state) {
  const now = new Date();
  const pad = (n, width = 2) => String(n).padStart(width, "0");
  const date = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const builtin = {
    i: String(loopIndex(state)),
    date,
    time,
    datetime: `${date}-${time}`,
    year: String(now.getFullYear()),
    month: pad(now.getMonth() + 1),
    day: pad(now.getDate()),
    hour: pad(now.getHours()),
    minute: pad(now.getMinutes()),
    second: pad(now.getSeconds()),
  };
  return String(template ?? "").replace(/\{([^{}]+)\}/g, (whole, spec) => {
    const [named, width] = spec.split(":");
    const key = named.trim();
    let value;
    if (state.vars.has(key)) value = asText(state.vars.get(key));
    else if (key in builtin) value = builtin[key];
    else return whole;
    const wide = Number(width);
    if (width !== undefined && Number.isInteger(wide) && wide > 0 && /^\d+$/.test(value)) value = value.padStart(wide, "0");
    return value;
  });
}

export const nameOfBlock = (state, id) => {
  const one = state.blocks.find((b) => b.id === id);
  return one ? `${one.label}. ${t(`chain.kind.${one.kind}`)}` : String(id || "");
};

// One value of a given kind, from what a source says.
function convert(text, kind) {
  const line = String(text ?? "");
  if (kind === "size") {
    const found = /^\s*(\d+)\D+(\d+)\s*$/.exec(line);
    return found ? [Number(found[1]), Number(found[2])] : null;
  }
  if (kind === "number") return Number(line);
  if (kind === "boolean") return /^(1|true|on|yes)$/i.test(line.trim());
  return line;
}

export function sourceValue(src, kind, state) {
  if (src.type === "value" || !src.type) {
    // Typed in with the property's own control, so it is already of the kind -- except text, which may
    // carry {placeholders}.
    if (typeof src.value === "string") return kind === "image" || kind === "promptlist" ? src.value : convert(fill(src.value, state), kind);
    if (src.value === undefined) return null;
    return kind === "text" ? convert(fill(textOf(src.value), state), kind) : src.value;
  }
  if (src.variable) {
    const made = state.declared.find((one) => one.id === src.variable);
    if (!made || !made.name) throw new Error(t("chain.problem.target"));
    if (!state.vars.has(made.name)) throw new Error(t("chain.error.noVariable", { name: made.name }));
    const held = state.vars.get(made.name);
    if (kind === "text") return asText(held);
    if (kind === "number") return Number(held);
    if (kind === "boolean") return Boolean(held);
    return held;
  }
  const out = state.outputs.get(src.block);
  if (!out) throw new Error(t("chain.error.noOutput", { name: nameOfBlock(state, src.block) }));
  if (kind === "image") return out.image || (out.images || [])[0] || "";
  if (kind === "imagelist") return (out.images || []).map((src2, index) => ({ id: String(index), src: src2 }));
  return convert(out.text || "", kind);
}

// What an app made, as the chain carries it: a picture, pictures and text, from the outputs the app
// offers.
export function outputsOf(api, app) {
  const surface = api.apps.surface(app);
  const out = { image: "", images: [], text: "" };
  const lines = [];
  for (const one of (surface && surface.outputs) || []) {
    // What is only for showing (a group the app made) is not a line of its text.
    if (one.display) continue;
    const value = api.apps.output(app, one.key);
    if (one.kind === "image") out.image = out.image || String(value || "");
    else if (one.kind === "imagelist") {
      const list = (Array.isArray(value) ? value : []).map((entry) => (typeof entry === "string" ? entry : entry && entry.src)).filter(Boolean);
      if (!out.images.length) out.images = list;
    } else if (typeof value === "string") {
      if (value) lines.push(value);
    } else if (value !== null && value !== undefined) {
      // Tags, a prompt, a list of prompts: read as the text they come to.
      const text = CORE.portConvert(value, one.kind, "text");
      if (typeof text === "string" && text) lines.push(text);
      else if (Array.isArray(value) && value.every((entry) => typeof entry === "string")) lines.push(value.join(", "));
    }
  }
  out.text = lines.join(", ");
  if (!out.image && out.images.length) out.image = out.images[0];
  if (!out.images.length && out.image) out.images = [out.image];
  return out;
}

// What stands between a block and its end, by part.
const bodyOf = (state, parent, slot) => state.blocks.filter((b) => !b.marker && b.parent === parent && b.slot === slot);

async function runBlocks(list, state, env) {
  for (const block of list) {
    if (state.cancelled || env.signal.aborted) throw new Error(t("chain.status.cancelled"));
    await runBlock(block, state, env);
  }
}

async function runBlock(block, state, env) {
  const { api, embed } = env;
  state.current = block.id;
  env.progress();
  const linkedApp = (app) => {
    if (!app || !state.apps.includes(app)) throw new Error(t("chain.error.noApp"));
    return app;
  };
  switch (block.kind) {
    case "run": {
      const button = isPlain(block.button) ? block.button : null;
      if (!button || !button.key) throw new Error(t("chain.error.noControl"));
      const app = linkedApp(button.app);
      // Its preset first, then the rest of what the chain has set: a set of a property wins over the
      // preset.
      const mine = [...state.sets.values()].filter((set) => set.app === app);
      for (const set of mine.filter((one) => one.key === "preset")) {
        const saved = set.value ? api.store.saved("workflow.runpreset").find((one) => String(one.id) === String(set.value)) : null;
        if (saved) embed.applyPreset(api, app, saved.value);
      }
      for (const set of mine.filter((one) => one.key !== "preset")) await api.apps.setInput(app, set.key, set.value, set.kind);
      env.running(app);
      await api.apps.press(app, button.key);
      const out = outputsOf(api, app);
      state.outputs.set(block.id, out);
      state.last = out;
      break;
    }
    case "set": {
      const app = linkedApp(block.app);
      const surface = api.apps.surface(app);
      const input = surface && surface.inputs.find((one) => one.key === block.key);
      if (!input) throw new Error(t("chain.error.noInput"));
      // As the block is now, not as the chain began: a property link may have brought an earlier
      // block's output into it since. The links are brought up to date first: what a typed-into
      // property says is only passed on at the next redraw, which may be a moment off.
      CORE.syncLinks();
      const live = coerceBlocks(env.read("blocks")).find((one) => one.id === block.id) || block;
      const src = isPlain(live.source) ? live.source : { type: "value" };
      const kind = input.kind === "*" ? src.kind || input.defaultKind || "text" : input.kind;
      let value = sourceValue(src, kind, state);
      if (input.kind === "preset") value = value || "";
      // Typed in but never touched: what the input starts as.
      if (value === null && (src.type === "value" || !src.type)) {
        const blank = (TYPES[input.spec.type] || {}).defaultValue;
        value = blank ? blank(input.spec) : input.spec.default ?? "";
      }
      state.sets.set(`${app}\n${block.key}`, { app, key: block.key, value, kind });
      break;
    }
    case "repeat": {
      let elements;
      if (block.mode === "each") {
        const out = state.outputs.get(block.source);
        if (!out) throw new Error(t("chain.error.noOutput", { name: nameOfBlock(state, block.source) }));
        elements =
          out.images && out.images.length
            ? out.images.map((src) => ({ image: src, images: [src], text: "" }))
            : String(out.text || "")
                .split(/\r?\n/)
                .map((line) => line.trim())
                .filter(Boolean)
                .map((line) => ({ image: "", images: [], text: line }));
      } else {
        const count = Math.max(0, Math.min(1000, Math.floor(Number(block.count) || 0)));
        elements = Array.from({ length: count }, (_one, index) => ({ image: "", images: [], text: String(index + 1) }));
      }
      for (let index = 0; index < elements.length; index += 1) {
        state.loop.push({ index: index + 1 });
        state.outputs.set(block.id, elements[index]);
        try {
          await runBlocks(bodyOf(state, block.id, ""), state, env);
        } finally {
          state.loop.pop();
        }
      }
      break;
    }
    case "if": {
      const out = state.outputs.get(block.source);
      const text = out ? String(out.text || "") : "";
      const has = Boolean(out && (out.image || (out.images || []).length || text));
      const want = fill(block.value, state);
      const test = block.test || "has";
      const pass = test === "has" ? has : test === "empty" ? !has : test === "equals" ? text === want : test === "contains" ? text.includes(want) : false;
      await runBlocks(bodyOf(state, block.id, pass ? "then" : "else"), state, env);
      break;
    }
    case "setvar": {
      const made = state.declared.find((one) => one.id === block.target);
      if (!made || !made.name.trim()) throw new Error(t("chain.problem.target"));
      const name = made.name.trim();
      let value;
      if (block.op === "add") {
        // Adding to what was never given is a mistake: a variable starts by being given a value.
        if (!state.vars.has(name)) throw new Error(t("chain.error.noVariable", { name }));
        const base = Number(state.vars.get(name));
        if (!Number.isFinite(base)) throw new Error(t("chain.error.notNumber", { name }));
        const amount = Number(block.amount);
        value = base + (Number.isFinite(amount) ? amount : 1);
      } else {
        value = typeof block.value === "string" && made.type === "string" ? fill(block.value, state) : copyValue(block.value);
        if (value === undefined || value === null) value = blankOf(made.type);
        if (made.type === "number") value = Number(typeof value === "string" ? fill(value, state) : value) || 0;
        else if (made.type === "boolean") value = value === true || /^(1|true|on|yes)$/i.test(String(value));
        else if (made.type === "string") value = asText(value);
      }
      state.vars.set(name, value);
      env.kept();
      break;
    }
    default:
      break;
  }
  state.done.add(block.id);
}

// Runs the chain in `env`: { api, embed, read(key), signal, progress(), running(app), kept() }.
export async function runChain(state, env) {
  await runBlocks(bodyOf(state, "", ""), state, env);
}

export function newRun({ blocks, apps, declared }) {
  const state = {
    blocks: derive(coerceBlocks(blocks)).list,
    apps,
    declared,
    vars: new Map(),
    outputs: new Map(),
    sets: new Map(),
    loop: [],
    last: null,
    cancelled: false,
    current: "",
    done: new Set(),
    errors: new Map(),
    running: true,
    version: 0,
  };
  // A variable that is kept starts with the value it ended the last run with.
  for (const one of declared) {
    if (one.keep && one.name.trim() && one.value !== null && one.value !== undefined) state.vars.set(one.name.trim(), one.value);
  }
  return state;
}

// The variables with what the last run (or the kept value) holds: [{name, type, value}].
export function variableValues(itemId, props) {
  const run = RUNS.get(itemId);
  return declaredVariables(props)
    .filter((entry) => entry.name.trim())
    .map((entry) => {
      const name = entry.name.trim();
      const held = run && run.vars.has(name) ? run.vars.get(name) : entry.keep ? entry.value : null;
      return { name, type: entry.type, value: held === null || held === undefined ? "" : asText(held) };
    });
}

// ---- what the chain is now, in a line -------------------------------------
// The lamp and the line: running (with how far), stopped on an error, not ready (what is wrong), or
// ready -- and, after a run, done.
function stateLine(run, checks, total) {
  if (run && run.running) {
    const at = run.blocks.find((one) => one.id === run.current);
    return {
      lamp: "checking",
      text: [t("chain.state.running", { done: run.done.size, total }), at ? `${at.label ? `${at.label}. ` : ""}${t(`chain.kind.${at.kind}`)}` : ""]
        .filter(Boolean)
        .join(" · "),
    };
  }
  if (run && run.errors.size) return { lamp: "failed", error: true, text: [...run.errors.values()][0] };
  const bad = checks.find((one) => one.state === "error");
  if (bad) return { lamp: "failed", error: true, text: bad.summary };
  const warn = checks.find((one) => one.state === "warn");
  if (warn) return { lamp: "warn", text: warn.summary };
  return { lamp: "ok", text: run ? t("chain.state.done", { n: run.done.size }) : t("chain.state.ready") };
}

// What the apps the blocks use need and what is wrong with the blocks, said as a checklist, plus the
// run's own row: everything the state row and its screen show. `props` are {blocks, apps,
// variableList} as the chain holds them. Pure data, so it can be handed to a control or shared.
export function computeView(api, itemId, props, onLoad = () => {}) {
  remember(api);
  const embed = appEmbed();
  const apps = (Array.isArray(props.apps) ? props.apps : []).filter((id) => api.items.get(id));
  const { list: blocks, problems: structural } = derive(coerceBlocks(props.blocks));
  const declared = declaredVariables(props);
  const run = RUNS.get(itemId) || null;

  const surfaces = new Map();
  const surfaceOf = (id) => {
    if (!id || !apps.includes(id)) return null;
    if (!surfaces.has(id)) {
      let found = null;
      try {
        found = api.apps.surface(id);
      } catch (error) {
        found = null;
      }
      surfaces.set(id, found);
    }
    return surfaces.get(id);
  };
  const buttonOf = (pick) => {
    const surface = pick && surfaceOf(pick.app);
    return surface ? surface.buttons.find((one) => one.key === pick.key) || null : null;
  };
  const describeBlock = (one) => {
    const kind = t(`chain.kind.${one.kind}`);
    if (one.kind === "run") {
      const button = buttonOf(one.button);
      return button ? `${kind} · ${labelOf(api, one.button.app)} · ${button.label}` : kind;
    }
    if (one.kind === "set") {
      const surface = surfaceOf(one.app);
      const input = surface && one.key ? surface.inputs.find((entry) => entry.key === one.key) : null;
      return input ? `${kind} · ${labelOf(api, one.app)} · ${one.shown || input.label}` : kind;
    }
    if (one.kind === "setvar") {
      const made = declared.find((entry) => entry.id === one.target);
      return `${kind} · ${(made && made.name) || ""}`;
    }
    return kind;
  };

  // ---- what stops the chain, said the way ComfyUI's state is ---------
  const problems = structural.map((one) => {
    const at = blocks.find((b) => b.id === one.id);
    return `${at && at.label ? `${at.label}. ` : ""}${t(`chain.kind.${at ? at.kind : "run"}`)}: ${t(one.text)}`;
  });
  const used = new Set();
  const order = new Map(blocks.map((one, index) => [one.id, index]));
  for (const block of blocks) {
    if (block.marker) continue;
    const say = (text) => problems.push(`${block.label}. ${describeBlock(block)}: ${text}`);
    if (block.kind === "run") {
      const pick = isPlain(block.button) ? block.button : null;
      if (!pick || !pick.key) say(t("chain.problem.control"));
      else if (!apps.includes(pick.app) || !buttonOf(pick)) say(t("chain.problem.app"));
      else used.add(pick.app);
    }
    if (block.kind === "set") {
      if (!block.app && !block.key) say(t("chain.problem.input"));
      else if (!apps.includes(block.app)) say(t("chain.problem.app"));
      const src = isPlain(block.source) ? block.source : {};
      const from = src.type === "ref" || src.type === "block" ? src.block : "";
      if (from && !(order.has(from) && order.get(from) < order.get(block.id))) say(t("chain.problem.source"));
    }
    if ((block.kind === "if" || (block.kind === "repeat" && block.mode === "each")) && !block.source) say(t("chain.problem.source"));
    if (block.kind === "setvar") {
      const made = declared.find((one) => one.id === block.target);
      if (!made || !made.name.trim()) say(t("chain.problem.target"));
    }
    if (block.kind === "set") {
      const src = isPlain(block.source) ? block.source : {};
      if (src.variable && !declared.some((one) => one.id === src.variable)) say(t("chain.problem.target"));
    }
  }
  // The variables: each needs a name of its own.
  const names = new Map();
  for (const one of declared) {
    const name = one.name.trim();
    if (!name) problems.push(t("chain.problem.varName"));
    else if (names.has(name)) problems.push(`${name}: ${t("chain.problem.varDup")}`);
    names.set(name, true);
  }

  const notReady = [];
  for (const id of used) {
    // What an app that runs on a server says is wrong with it.
    const entry = api.items.get(id);
    if (!entry || !embed || !embed.isApp(entry.type)) continue;
    const found = embed.problems(api, id, onLoad);
    if (found.length) notReady.push(`${labelOf(api, id)}: ${found[0]}`);
  }
  const total = blocks.filter((one) => !one.marker).length;
  const checks = [
    {
      key: "apps",
      label: t("chain.check.apps"),
      state: apps.length ? "ok" : "error",
      summary: apps.length ? t("chain.value.appCount", { n: apps.length }) : t("chain.value.noApps"),
      detail: apps.length ? apps.map((id) => labelOf(api, id)).join("\n") : t("chain.value.linkHint"),
    },
    {
      key: "blocks",
      label: t("chain.check.blocks"),
      state: !blocks.length ? "warn" : problems.length ? "error" : "ok",
      summary: !blocks.length ? t("chain.value.noBlocks") : problems.length ? t("chain.value.toPutRight", { n: problems.length }) : t("chain.value.blocks", { n: total }),
      detail: problems.join("\n"),
    },
    {
      key: "ready",
      label: t("chain.check.ready"),
      state: notReady.length ? "error" : used.size ? "ok" : "warn",
      summary: notReady.length ? t("chain.value.appsNotReady", { n: notReady.length }) : used.size ? t("chain.value.appsReady") : t("chain.value.noRuns"),
      detail: notReady.join("\n"),
    },
  ];
  if (!embed) checks.unshift({ key: "workflow", label: t("chain.check.workflow"), state: "error", summary: t("chain.value.noWorkflow"), detail: "" });

  const rows = [...checks];
  if (run) {
    const line = stateLine(run, checks, total);
    rows.push({
      key: "run",
      label: t("chain.state.run"),
      state: run.running ? "checking" : run.errors.size ? "error" : "ok",
      summary: run.running ? line.text : run.errors.size ? [...run.errors.values()][0] : t("chain.state.done", { n: run.done.size }),
      detail: [...run.errors.entries()]
        .map(([id, text]) => {
          const at = run.blocks.find((one) => one.id === id);
          return `${at && at.label ? `${at.label}. ` : ""}${t(`chain.kind.${at ? at.kind : "run"}`)}: ${text}`;
        })
        .join("\n"),
    });
  }
  const blocked = !embed || checks.some((one) => one.state === "error") || !blocks.length;
  const reason = !embed ? t("chain.value.noWorkflow") : !blocks.length ? t("chain.value.noBlocks") : (checks.find((one) => one.state === "error") || {}).summary || "";
  return {
    ...stateLine(run, checks, total),
    total,
    running: Boolean(run && run.running),
    current: run && run.running ? run.current : "",
    done: run ? [...run.done] : [],
    errors: run ? Object.fromEntries(run.errors) : {},
    rows: blocks.map(({ id, kind, marker, label, invalid, parent, slot, pair }) => ({ id, kind, marker, label, invalid: Boolean(invalid), parent, slot, pair, text: marker ? "" : describeBlock({ ...blocks.find((b) => b.id === id) }) })),
    problems,
    checks: rows,
    declared,
    blocked,
    reason,
  };
}

// The view, asked again only when what it is made of changed or a moment has passed: it is read by
// several controls in one drawing, and the apps' surfaces it needs are drawn on each ask.
const VIEWS = new Map();
export function viewOf(api, itemId, props, onLoad) {
  const run = RUNS.get(itemId);
  const sig = JSON.stringify([props.blocks, props.apps, props.variableList, run ? [run.running, run.current, run.done.size, run.errors.size, run.version] : 0]);
  const now = Date.now();
  // The screen behind the state row reads it from here: it reaches the chain through a link, and the
  // apps only through the chain.
  REPORTS.set(itemId, { api, props });
  const hit = VIEWS.get(itemId);
  if (hit && hit.sig === sig && now - hit.at < 300) return hit.view;
  const view = computeView(api, itemId, props, onLoad);
  VIEWS.set(itemId, { sig, at: now, view });
  return view;
}
// What the screen behind the state row asks of the chain it shows.
export const REPORTS = new Map();
