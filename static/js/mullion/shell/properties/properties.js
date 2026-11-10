/* Mullion -- the built-in value types.
 *
 * A value type says what a value *is*. It never draws anything: how a
 * value is edited is a control's job (controls.js), and the two are matched
 * by the methods a control asks for. That is why `number`, `slider` and
 * `percent` are no longer three types -- they are one number with three
 * ways of showing it.
 *
 * `get`, `set` and `format` come from the registry unless a type overrides
 * them. Everything else here is a capability: a method a control can ask
 * for by name.
 */

import { ITEM_TYPES, VALUE_TYPES, bindElement, bindProperty, defaultFor, derivesFrom, formatValue, paramsFor, presetSpecOf, presetTypeDef, presetTypeFor, presetTypes, registerValueType, valueTypeFor, fetch } from "./deps.js";
import { appSettingValue, getItem, registerPortConversion } from "./deps.js";
import { t } from "./deps.js";
import { locate, mediaOfName } from "./deps.js";
import { saved, savedValue } from "./deps.js";

let entrySeq = 0;

// The languages a multilingual text can be in: the shell's own.
export const TEXT_LANGUAGES = ["en", "ja"];
// A multilingual text, whatever it was given: a bare string is the shell's language's.
function coerceMultitext(value) {
  const from = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const out = {};
  for (const lang of TEXT_LANGUAGES) out[lang] = typeof from[lang] === "string" ? from[lang] : "";
  if (typeof value === "string") out[appSettingValue("language") === "ja" ? "ja" : "en"] = value;
  return out;
}
// The text in the reader's language, else English, else whatever there is.
export function pickLanguage(value, lang = appSettingValue("language")) {
  const one = coerceMultitext(value);
  return one[lang] || one.en || one.ja || "";
}

// A description, whatever it was given: a bare string is a name with nothing
// said about it.
function coerceDescription(value) {
  if (typeof value === "string") return { name: value, description: "" };
  const from = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    name: typeof from.name === "string" ? from.name : "",
    description: typeof from.description === "string" ? from.description : "",
  };
}
// The ones that count: named, trimmed, each name once. An editor keeps a blank
// card -- a card is blank the moment it is added -- and this is where it stops
// being counted.
function usableDescriptions(list) {
  const seen = new Set();
  const out = [];
  for (const raw of Array.isArray(list) ? list : []) {
    const one = coerceDescription(raw);
    const name = one.name.trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push({ name, description: one.description.trim() });
  }
  return out;
}

const BUILT_IN = {};

// Which saved values may be applied to a property with this spec. Two
// questions, and they are separate on purpose.
//
// The first is what the value *means*, and it is directional. A type
// derived from another is usable wherever the base is wanted -- a height is
// a fine answer to "give me a number", because the target has no meaning to
// violate -- but not the other way round: applying a bare number where a
// height is wanted would assert a meaning nobody ever recorded, and the
// number might as well have been a weight. `exact: true` on the spec
// declines even the safe direction, for a property that means the base type
// itself and nothing derived from it.
//
// The second is whether the value would *survive* being applied. A saved
// number of 99 put into a property bounded at 1 does not fail -- coercion
// quietly makes it a 1 -- so the way to tell is to coerce it and see
// whether it came back unchanged. Offering something that would be silently
// rewritten is worse than not offering it.
export function candidatesFor(spec) {
  const wanted = presetTypeFor(spec);
  if (!wanted) return [];
  if (spec.storable === false || valueTypeFor(spec)?.storable === false || !storable(wanted)) return [];
  const kept = saved().filter((one) => {
    const usable = spec.exact ? one.type === wanted : derivesFrom(one.type, wanted);
    return usable && survives(spec, one.value);
  });
  // What the type itself knows of besides what is saved -- the categories
  // prompt parts are already filed under, say. Offered after the saved
  // ones and never twice: one kept by hand wins. Their ids are the type's
  // own, never a row's, so nothing mistakes one for something to delete.
  const def = presetTypeDef(wanted);
  const offered = def && def.offers ? def.offers() || [] : [];
  const extra = [...suppliedFor(wanted), ...offered];
  const out = [...kept];
  for (const one of extra) {
    if (survives(spec, one.value) && !out.some((mine) => sameValue(mine.value, one.value))) out.push(one);
  }
  return out;
}

// What saved values of *other* types can stand in as, for this one. A type
// says so with `supplies: {[wanted type]: (value) => [{name, value}]}` --
// a character, say, can be a prompt part (its tags), a sentence (its
// description) and a picture (its views) -- so wherever a value of that
// type is being chosen, each saved character is among the choices, without
// the character being saved again as each of them.
//
// What is offered is a copy made now, as any preset is: taking it puts the
// value in, and editing the character later does not reach into it. The
// ids are made up from the saved row's, and never a row's own, so nothing
// mistakes one for something to delete.
function suppliedFor(wanted) {
  const out = [];
  for (const one of saved()) {
    const def = presetTypeDef(one.type);
    const make = def && def.supplies && def.supplies[wanted];
    if (typeof make !== "function") continue;
    let made;
    try {
      made = make(one.value) || [];
    } catch (error) {
      // A value its own type cannot read supplies nothing.
      continue;
    }
    made.forEach((entry, index) => {
      if (entry && entry.name && entry.value !== undefined) {
        out.push({ id: `supplied:${one.id}:${index}`, type: wanted, name: entry.name, value: entry.value });
      }
    });
  }
  return out;
}

// Whether a value of this type means anything outside the layout it was
// made in. An item id does not: saved, it would point at whatever happens
// to have that id wherever it is applied.
export function storable(type) {
  const def = presetTypeDef(type);
  return Boolean(def) && def.storable !== false;
}

// Whether this spec would take the value as it is. Coercion is the test
// because coercion is what would happen: if it changes the value, applying
// it would have changed it too.
function survives(spec, value) {
  const def = VALUE_TYPES[spec.type];
  if (!def || !def.coerce) return true;
  try {
    return sameValue(def.coerce(value, paramsFor(spec)), value);
  } catch (error) {
    // A value this type cannot even read is not a candidate.
    return false;
  }
}

// Structural equality over what a value can be: JSON. Key order is not
// meaningful -- a coerced record is rebuilt field by field, and the stored
// one came back from the database -- so keys are compared as a set.
function sameValue(a, b) {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") {
    return false;
  }
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    return a.length === b.length && a.every((item, i) => sameValue(item, b[i]));
  }
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((key) => key in b && sameValue(a[key], b[key]));
}

// How a value type divides its own saved values, if it does at all.
// Most do not: a vector is just a vector, and there is nothing to group by.
// A type that does declares it --
//
//   groups: { label: "…", of: (value) => "expression" }
//
// -- and everything generic (the picker's filter, the library's listing)
// works from that, so the shell never learns what a category is. Grouping
// lives in the value, which is why the database can stay one flat table
// however many types are added.
export function groupingOf(type) {
  const def = type && presetTypeDef(type);
  return (def && def.groups) || null;
}

// Which group one value falls into. "" means ungrouped, which is also what
// a type without grouping answers for everything.
export function groupOf(type, value) {
  const grouping = groupingOf(type);
  if (!grouping) return "";
  try {
    if (typeof grouping.of === "function") return String(grouping.of(value) || "");
    if (typeof grouping.field === "string" && grouping.field) {
      return value && typeof value === "object" && !Array.isArray(value) ? String(value[grouping.field] || "") : "";
    }
    return "";
  } catch (error) {
    // A value the type cannot read is ungrouped rather than fatal: it may
    // predate the grouping, or have been written by an older version.
    return "";
  }
}

// The groups this type's saved values actually fall into, in the order they
// read best -- alphabetical, with the ungrouped ones last. Derived rather
// than declared, so making a value with a new group is all it takes to
// bring that group into existence, and a group nothing is in stops being
// offered on its own.
export function groupsIn(type) {
  if (!groupingOf(type)) return [];
  const found = new Set();
  // Derived types included, for the same reason they are offered as
  // candidates: a filter that could not name the group a candidate is in
  // would silently hide it.
  saved()
    .filter((one) => derivesFrom(one.type, type))
    .forEach((one) => found.add(groupOf(type, one.value)));
  // And the groups of what other types supply, or a filter could never
  // bring those back into view.
  suppliedFor(type).forEach((one) => found.add(groupOf(type, one.value)));
  const named = [...found].filter(Boolean).sort((a, b) => a.localeCompare(b));
  const out = named.map((id) => ({ id, label: id }));
  if (found.has("")) out.push({ id: "", label: t("mu.value.ungrouped") });
  return out;
}

// An image value is the picture itself, where the library keeps it, or an
// address that serves it (one whose name does not say what it is is taken to
// be a picture: that is what it was asked for as). All three go straight into
// an <img>; whatever needs the bytes -- an upload to ComfyUI, a picture sent
// to Ollama -- asks for them by the address. What the string is is read by
// media.js.
const isImageLocation = (found) => Boolean(found) && (found.media === "image" || (found.scheme === "served" && !found.media));

function imageValue(value) {
  return isImageLocation(locate(value)) ? value : "";
}

export const isKeptImage = (value) => {
  const found = locate(value);
  return Boolean(found) && found.scheme === "kept" && found.media === "image";
};

// What an image value is, read off the string: its media type, a short
// name for it, and how many bytes it stands for -- null where nothing says
// (an address that serves it).
export function imageFacts(value) {
  const found = locate(value);
  if (!isImageLocation(found)) return null;
  return { mime: found.mime, format: found.ext.toUpperCase().replace("JPG", "JPEG").replace("X-ICON", "ICO"), bytes: found.bytes };
}

// The facts as one short line: "PNG · 12.3 KB", or the format alone where the
// size is not known.
export function describeImage(facts) {
  if (!facts) return "";
  return facts.bytes === null ? facts.format : `${facts.format} · ${formatBytes(facts.bytes)}`;
}

export function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

// A file's bytes as an image data URL. The server hands files over as
// octet-stream, so the media type comes from the blob when it has a real
// one and from the file name when it does not.
export function blobToDataUrl(blob, name = "") {
  const named = mediaOfName(name);
  const fromName = named.media === "image" ? named.mime : "";
  const mime = blob.type && blob.type.startsWith("image/") ? blob.type : fromName;
  if (!mime) return Promise.reject(new Error(t("mu.value.notAnImageFile")));
  const typed = blob.type === mime ? blob : new Blob([blob], { type: mime });
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(typed);
  });
}

// A path value is always {type, path}. A bare string is taken as the path.
// A type nobody has registered is kept as it is -- the plugin that owns it
// may just not be loaded -- unless `of` says what is wanted, in which case
// anything that is not that (or derived from it) becomes that.
function pathValue(value, params) {
  const from = typeof value === "string" ? { path: value } : value || {};
  let type = typeof from.type === "string" && from.type ? from.type : "";
  if (params.of && !derivesFrom(type, params.of)) type = params.of;
  if (!type) type = "string";
  return { type, path: String(from.path ?? "") };
}

// What a file holds, read as `type`. Files are JSON; a text type also takes
// a file that is not, as the text itself, because a .txt of plain words is
// exactly what a string is.
export function decodeFile(type, text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    if (!derivesFrom(type, "string")) return { value: undefined, valid: false, problem: error.message };
    parsed = text;
  }
  const def = presetTypeDef(type);
  if (!def) return { value: parsed, valid: false, problem: `unknown value type "${type}"` };
  const spec = presetSpecOf(type) || { type };
  const value = def.coerce ? def.coerce(parsed, paramsFor(spec)) : parsed;
  return { value, valid: sameValue(value, parsed), problem: "" };
}

// The axis names, which are also the count. Anything that forgets to say
// gets three, because the thing this exists for is XYZ.
export function axesOf(params) {
  const axes = params.axes;
  return Array.isArray(axes) && axes.length ? axes.map(String) : ["X", "Y", "Z"];
}

function clampAxis(value, params) {
  let n = Number(value);
  if (!Number.isFinite(n)) n = 0;
  if (params.min !== undefined) n = Math.max(n, params.min);
  if (params.max !== undefined) n = Math.min(n, params.max);
  return n;
}

// Enough digits for the step in use, and no trailing zeros: a step of 0.1
// reads as "1.2", a step of 1 as "12". Exported because the vector
// control shows one axis at a time and wants the same rule.
export function formatAxis(value, params) {
  const n = Number(value) || 0;
  const step = Number(params.step) || 1;
  const digits = step >= 1 ? 0 : String(step).split(".")[1]?.length || 2;
  return String(Number(n.toFixed(digits)));
}

// Options may be a plain list, a list of {value,label}, or a function -- the
// last so a domain can depend on what is registered right now.
// An image list's entries, whatever it was given: {id, src} records, or
// bare addresses, which take their place in the list as their id.
export function coerceImageList(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  return value
    .map((one, index) =>
      typeof one === "string"
        ? { id: String(index), src: one }
        : one && typeof one === "object" && typeof one.src === "string"
          ? { id: String(one.id ?? index), src: one.src }
          : null
    )
    .filter((one) => one && one.src && !seen.has(one.id) && seen.add(one.id));
}

export function optionsOf(params, api) {
  const raw = typeof params.options === "function" ? params.options(api) : params.options || [];
  // A label is a translation key or already a text (t() hands back what it does not know), so
  // options declared as data -- `{ value, label: "clock.opt.digital" }` -- read in the reader's language.
  return raw.map((option) =>
    typeof option === "object" ? { ...option, label: t(String(option.label ?? option.value)) } : { value: option, label: String(option) }
  );
}


// A path is text to whoever wants text, and text is a path to whoever wants a place.
// A multilingual text is carried as text in the reader's language; a text put where one is
// wanted is in the reader's language.

// What this file registers, once the modules it uses are handed in (index.js).
export function install() {
  Object.assign(BUILT_IN, {
    string: {
      label: "mu.vtype.string",
      icon: "type",
      // Text put down on its own (a scratch board) is kept as a string, in a
      // text card.
      stash: "text",
      params: ["default", "placeholder", "maxLength"],
      sample: { default: "hello" },
      defaultControl: "textbox",
      defaultValue: (p) => p.default ?? "",
      coerce: (value, p) =>
        p.maxLength ? String(value ?? "").slice(0, p.maxLength) : String(value ?? ""),
      format: (value) => (value === "" || value == null ? "—" : String(value)),
      methods: {
        text: (p) => String(p.get() ?? ""),
        setText: (p, value) => p.set(String(value ?? "")),
      },
    },

    // Where a file or a folder is, as a path on the machine the server runs on. A string
    // to read and type, and a kind of its own to carry: the File Manager hands on the
    // folder it is in and the file it has picked, and a property that wants a place
    // (where a profile is kept, a model file) takes it by paste or link. Text can be put
    // in it too (a path typed or copied is text), and it reads as text anywhere.
    filepath: {
      base: "string",
      label: "mu.vtype.filepath",
      icon: "folder2",
      port: "filepath",
      sample: { default: "C:\\Users\\you\\Documents" },
    },

    // Where a video is: what a run's output preview hands on when what it
    // made is a video. A kind of its own, so a video is never offered to
    // something that takes a picture.
    video: {
      label: "mu.vtype.video",
      icon: "film",
      port: "video",
      // Shown in the image card (whose stage plays a video too) where it stands
      // on its own; carried and taken in by the guides (paste, link) like any
      // value, a file by the card.
      preview: { control: "imagecard", options: { value: { bind: "value" } } },
      params: ["default"],
      sample: { default: "" },
      defaultControl: "videocard",
      defaultValue: (p) => (typeof p.default === "string" ? p.default : ""),
      coerce: (value) => (typeof value === "string" ? value : ""),
      format: (value) => (value ? String(value) : "\u2014"),
      methods: {
        text: (p) => String(p.get() ?? ""),
        setText: (p, value) => p.set(String(value ?? "")),
        src: (p) => String(p.get() ?? ""),
        setSrc: (p, value) => p.set(String(value ?? "")),
        clear: (p) => p.set(""),
      },
    },

    // A recording, held by where it is: the address of a file kept beside the
    // library (backend/blobs.py), or a data URL. A voice is megabytes, so
    // unlike an `image` it is never the value itself. Carried by its card's
    // grip as "audio"; the address needs no fetching, so it is taken in like
    // any value -- the guides offer paste and link -- and a file by the card.
    audio: {
      label: "mu.vtype.audio",
      icon: "volume-up",
      port: "audio",
      preview: { control: "audiocard", options: { value: { bind: "value" } } },
      params: ["default"],
      sample: { default: "" },
      defaultControl: "audiocard",
      defaultValue: (p) => (typeof p.default === "string" ? p.default : ""),
      coerce: (value) => (typeof value === "string" ? value : ""),
      format: (value) => (value ? t("mu.value.audioHeld") : t("mu.value.noAudio")),
      methods: {
        src: (p) => String(p.get() ?? ""),
        setSrc: (p, value) => p.set(String(value ?? "")),
        clear: (p) => p.set(""),
      },
    },

    // The smallest element worth being a list's: {id, text}. What the shell's
    // own sample lists are made of (the input test, the control catalog), so
    // that even they are lists of values with an identity.
    entry: {
      label: "mu.vtype.entry",
      icon: "card-text",
      identity: "id",
      port: false,
      presetNew: false,
      params: ["default", "placeholder"],
      fields: { text: { type: "string" } },
      sample: { default: { id: "e0", text: "entry" } },
      defaultControl: "entrytext",
      defaultValue: () => ({ id: `e${Date.now().toString(36)}${(entrySeq++).toString(36)}`, text: "" }),
      coerce: (value) => {
        const from = value && typeof value === "object" && !Array.isArray(value) ? value : {};
        return { id: typeof from.id === "string" ? from.id : "", text: typeof from.text === "string" ? from.text : "" };
      },
      format: (value) => (value && typeof value.text === "string" && value.text ? value.text : "—"),
      methods: {
        text: (p) => String((p.get() || {}).text ?? ""),
        setText: (p, text) => p.set({ ...(p.get() || {}), text: String(text ?? "") }),
      },
    },

    // A text that is in more than one language: {en, ja}. What a string is, said once for
    // each language -- a definition read in English that has also been translated. It is carried
    // as a text (in the reader's language, else English), shown in the shell's text card with a
    // choice of language in the card's bar, and is not a string: a property that wants one gets
    // the text through the port conversion, not the object.
    multitext: {
      label: "mu.vtype.multitext",
      icon: "translate",
      port: "multitext",
      preview: { control: "multitext", options: { value: { bind: "value" } } },
      params: ["default", "placeholder"],
      fields: { en: { type: "string" }, ja: { type: "string" } },
      sample: { default: { en: "A short text.", ja: "短い文章。" } },
      defaultControl: "multitext",
      defaultValue: (p) => coerceMultitext(p.default),
      coerce: (value) => coerceMultitext(value),
      format: (value) => pickLanguage(value) || "—",
      portText: (value) => pickLanguage(value),
      methods: {
        // The languages the text is in (those with something written).
        languages: (p) => TEXT_LANGUAGES.filter((lang) => coerceMultitext(p.get())[lang]),
        text: (p, lang) => (lang ? coerceMultitext(p.get())[lang] : pickLanguage(p.get())),
        setText: (p, text, lang) => p.set({ ...coerceMultitext(p.get()), [lang || (appSettingValue("language") === "ja" ? "ja" : "en")]: String(text ?? "") }),
      },
    },

    // A value the app keeps for itself and nobody edits, carries or points at:
    // a terminal's transcript, the results of a run. It is not a list even when
    // it holds an array, because a list is a list of values -- each one a
    // property of its own, with an identity and a place to be carried from --
    // and this has none of that. Nothing here is a port, a preset or a row;
    // the app that owns it is the only reader, and reads it whole.
    //
    // What the default is decides what it is kept as: a default that is an
    // array keeps an array (anything else is put back to one), so a reader that
    // spreads it never meets a stray value. Any other default keeps what it is
    // given.
    data: {
      label: "mu.vtype.data",
      icon: "braces",
      storable: false,
      port: false,
      presetNew: false,
      params: ["default"],
      sample: { default: null },
      defaultControl: "summary",
      defaultValue: (p) => (p.default === undefined ? null : JSON.parse(JSON.stringify(p.default))),
      coerce: (value, p) => (Array.isArray(p.default) ? (Array.isArray(value) ? value : []) : value === undefined ? null : value),
      format: (value) => (Array.isArray(value) ? t("mu.value.entries", { n: value.length }) : value == null ? "—" : typeof value),
      // What a log draws: the rows, when what it holds is a list of them.
      methods: { items: (p) => (Array.isArray(p.get()) ? p.get() : []) },
    },

    // Whatever was carried here, with what kind it is: {kind, value}. What a
    // preview holds -- it takes any kind, and shows each the way that kind
    // is shown. Carried on again as that same kind.
    portvalue: {
      label: "mu.vtype.portvalue",
      icon: "box-arrow-in-down",
      params: ["default"],
      sample: { default: { kind: "", value: null } },
      defaultControl: "summary",
      defaultValue: () => ({ kind: "", value: null }),
      coerce: (value) =>
        value && typeof value === "object" && !Array.isArray(value) && typeof value.kind === "string"
          ? { kind: value.kind, value: value.value === undefined ? null : value.value }
          : { kind: "", value: null },
      format: (value) => (value && value.kind ? value.kind : "—"),
      portAcceptsAny: true,
      portKindOf: (value) => (value && value.kind) || null,
      portRead: (value) => (value ? value.value : undefined),
      portWrite: (value, kind) => ({ kind, value }),
    },

    number: {
      label: "mu.vtype.number",
      icon: "123",
      params: ["default", "min", "max", "step"],
      sample: { default: 42, min: 0, max: 99, step: 1 },
      // The stepper, not the bare field: a number is usually nudged rather
      // than retyped. `control: "numberbox"` on the spec asks for the field.
      defaultControl: "stepper",
      defaultValue: (p) => p.default ?? 0,
      coerce: (value, p = {}) => {
        let n = Number(value);
        if (!Number.isFinite(n)) n = p.default ?? 0;
        if (p.min !== undefined) n = Math.max(n, p.min);
        if (p.max !== undefined) n = Math.min(n, p.max);
        return n;
      },
      format: (value) => String(value),
      methods: {
        number: (p) => Number(p.get()),
        setNumber: (p, value) => p.set(Number(value)),
        min: (p) => p.params.min,
        max: (p) => p.params.max,
        step: (p) => p.params.step,
      },
    },

    // A number that means a proportion. Same capabilities as `number`, but it
    // knows its own bounds and reads back as a percentage.
    // The first derived type, and the reason `base` is worth having: this was
    // fifteen lines of number, written again, to say one thing -- a percent
    // is a number between nothing and everything. Now it says that.
    //
    // Nothing else is needed. The coercion it used to carry was number's
    // clamp with these bounds; the methods were number's methods; the default
    // was number's default. What is left is genuinely its own: what it is
    // called, how it reads, and that a proportion is usually dragged rather
    // than typed.
    //
    // It is not a number for the library's purposes, which is the point of
    // being a type at all. A saved percent may be applied to a plain number
    // property -- it is a number, and a property that only asked for a number
    // has no meaning to violate -- but a saved number may not be applied
    // here, because nothing recorded that it was ever a proportion.
    percent: {
      base: "number",
      label: "mu.vtype.percent",
      icon: "percent",
      defaults: { min: 0, max: 1 },
      sample: { default: 0.25 },
      defaultControl: "slider",
      format: (value) => `${(Number(value) * 100).toFixed(1)}%`,
    },

    boolean: {
      label: "mu.vtype.boolean",
      icon: "toggle-on",
      params: ["default"],
      sample: { default: true },
      defaultControl: "checkbox",
      defaultValue: (p) => p.default ?? false,
      coerce: (value) => Boolean(value),
      format: (value) => (value ? "true" : "false"),
      methods: {
        toggle: (p) => p.set(!p.get()),
      },
    },

    enum: {
      label: "mu.vtype.enum",
      icon: "menu-button-wide",
      params: ["default", "options"],
      sample: { options: ["alpha", "beta", "gamma"] },
      defaultControl: "select",
      defaultValue: (p) => {
        if (p.default !== undefined) return p.default;
        const [first] = optionsOf(p, null);
        return first ? first.value : "";
      },
      // The only type with a stated domain, and until now the only one that
      // did not enforce it: a value outside `options` went straight in. It
      // matters more now that a saved value can be applied from elsewhere,
      // but it was always wrong.
      //
      // A domain given as a function may need an api this has no access to.
      // Answering [] then means "cannot see the domain", which is not the
      // same as "the domain is empty", so the value is left alone rather than
      // rewritten to nothing.
      coerce: (value, p) => {
        const options = optionsOf(p, null);
        if (!options.length) return value;
        const found = options.find((option) => String(option.value) === String(value));
        if (found) return found.value;
        const fallback = options.find((option) => option.value === p.default);
        return fallback ? fallback.value : options[0].value;
      },
      format: (value) => String(value),
      methods: {
        // The domain of the value belongs to the property; a control only
        // needs to be able to ask for it.
        options: (p) => optionsOf(p.params, p.api),
      },
    },

    // A reference to another item, kept as its id and connected to it (`link: true`).
    // Neither side owns the other: each lives by its own window.
    //
    // Not storable: a saved id would only point back into one layout.
    ref: {
      label: "mu.vtype.ref",
      icon: "link-45deg",
      storable: false,
      params: ["itemType", "link"],
      sample: { itemType: "input" },
      defaultControl: "reflabel",
      defaultValue: () => null,
      format: (value) => value || "—",
      methods: {
        target: (p) => getItem(p.get()),
        setTarget: (p, item) => p.set(item ? item.id : null),
      },
    },

    // Several numbers that belong together: a position, a size, a colour in
    // some space. `axes` names them, and it is what decides how many there
    // are -- a value of the wrong length is filled or trimmed to match.
    vector: {
      label: "mu.vtype.vector",
      icon: "bounding-box",
      params: ["default", "axes", "min", "max", "step"],
      sample: { axes: ["X", "Y", "Z"], default: [0, 0, 0], step: 0.1 },
      defaultControl: "vector",
      defaultValue: (p) => axesOf(p).map((_, i) => clampAxis(p.default?.[i] ?? 0, p)),
      coerce: (value, p) => {
        const from = Array.isArray(value) ? value : [];
        return axesOf(p).map((_, i) => clampAxis(from[i], p));
      },
      format: (value, p) =>
        (Array.isArray(value) ? value : []).map((n) => formatAxis(n, p)).join(", "),
      methods: {
        axes: (p) => axesOf(p.params),
        numbers: (p) => [...p.get()],
        axisValue: (p, index) => Number(p.get()[index]) || 0,
        // One axis at a time is how the control edits, and writing the whole
        // vector back through set() is what keeps the coercion in one place.
        setAxis: (p, index, value) => {
          const next = [...p.get()];
          next[index] = value;
          return p.set(next);
        },
        min: (p) => p.params.min,
        max: (p) => p.params.max,
        step: (p) => p.params.step,
      },
    },

    // A value kept in the database rather than in the item: the item stores
    // the entry's id, and reading the property resolves it. Editing the entry
    // changes every item that points at it, which is what it is for.
    //
    // Two levels, one property: `collection` is the drawer to choose from and
    // `of` is the value type its entries hold. Taking a copy instead of a
    // link is not this type at all -- that is the `preset` control over an
    // ordinary property.
    // Which groups of one type a screen is looking at. A type of its own
    // rather than a plain list of strings, for two reasons: a filter is worth
    // saving and reapplying -- "just the expressions" is reused far more often
    // than it is retyped -- and a saved filter has to agree in type with the
    // property applying it, which a bare list could not promise.
    //
    // Empty means every group. That is not the same as "none": a filter that
    // hid everything is never what was meant, and the common case -- look
    // everywhere -- should not need a decision.
    groupset: {
      label: "mu.vtype.groupset",
      icon: "funnel",
      // `of` is the type whose groups these are. Without it there is nothing
      // to offer, because groups belong to a type rather than to the library.
      params: ["default", "of"],
      sample: { default: [], of: "string" },
      defaultControl: "grouppick",
      defaultValue: (p) => (Array.isArray(p.default) ? p.default.map(String) : []),
      coerce: (value) => (Array.isArray(value) ? value.map(String).filter(Boolean) : []),
      format: (value, p) => {
        const ids = Array.isArray(value) ? value : [];
        if (!ids.length) return t("mu.value.everyGroup");
        const known = new Map(groupsIn(p.of).map((one) => [one.id, one.label]));
        return ids.map((id) => known.get(id) || id).join(", ");
      },
      methods: {
        picked: (p) => (Array.isArray(p.get()) ? p.get().map(String) : []),
        setPicked: (p, ids) => p.set(ids),
        // The groups this filter may name: whichever ones the type's saved
        // values actually fall into. Read live, so a group that came into
        // existence a moment ago is offered without a reload.
        offered: (p) => groupsIn(p.params.of),
        // What is actually showing, with the empty-means-everything rule
        // applied once, here, rather than at each call site.
        showing: (p) => {
          const chosen = p.picked().filter((id) => p.offered().some((one) => one.id === id));
          return chosen.length ? chosen : p.offered().map((one) => one.id);
        },
        // What this filter would become with one group turned on or off. It
        // computes rather than writes: a control has one way to write -- its
        // onChange, which is also what makes the screen redraw -- so a method
        // that wrote as well would be a second door to the same value.
        //
        // Turning the last one off, or the last one on, goes back to "every
        // group": both ends of the range mean the same thing.
        //
        // Clicking one while nothing is picked means "just this one", not
        // "everything except this one". Both readings are consistent with
        // the toggle, but nobody opens a filter to remove a single group from
        // everything -- they open it to get to one -- and the other reading
        // took a click per group to say that.
        toggled: (p, id) => {
          const picked = p.picked().filter((one) => p.offered().some((group) => group.id === one));
          if (!picked.length) return [id];
          const next = picked.includes(id) ? picked.filter((one) => one !== id) : [...picked, id];
          return next.length && next.length < p.offered().length ? next : [];
        },
      },
    },

    // A list of values. `each` is the spec every element is held to -- give
    // it one and the `rows` control can edit the list with the element type's
    // own control. Leave it out and the list stays opaque: still a list, but
    // only a control that understands the contents (the sketch pad) can show
    // it, which is what the default control admits by only counting them.
    list: {
      label: "mu.vtype.list",
      icon: "list-ol",
      params: ["default", "each", "itemType", "link"],
      sample: { default: [] },
      defaultControl: "listcount",
      defaultValue: (p) => (Array.isArray(p.default) ? JSON.parse(JSON.stringify(p.default)) : []),
      // An element type can define normalization that needs the whole list
      // (for example, assigning unique identities across its entries).
      coerce: (value, p) => {
        const element = p.each && VALUE_TYPES[p.each.type];
        return element && element.coerceList ? element.coerceList(value, p.each) : Array.isArray(value) ? value : [];
      },
      format: (value) => t("mu.value.entries", { n: Array.isArray(value) ? value.length : 0 }),
      methods: {
        items: (p) => (Array.isArray(p.get()) ? p.get() : []),
        length: (p) => p.items().length,
        append: (p, entry) => p.set([...p.items(), entry]),
        clear: (p) => p.set([]),
        // What an element is, and what a new one starts as. Both go through
        // the element type, so a list of anything behaves like that anything.
        each: (p) => p.params.each || null,
        blank: (p) => (p.params.each ? defaultFor(p.params.each) : null),
        // One element as a property of its own, by position: what a control
        // draws it with. It reads and writes through this list, so the
        // element's control never learns it is in one.
        element: (p, index, commit) => bindElement(p, index, commit),
      },
    },

    // One picture of an image list: {id, src}. Carried as the picture it is
    // (its `src`), and put over by one -- the entry stays the same entry.
    picture: {
      label: "mu.vtype.picture",
      icon: "image",
      identity: "id",
      port: "image",
      presetNew: false,
      params: ["default"],
      fields: { src: { type: "image" } },
      sample: { default: { id: "0", src: "" } },
      defaultControl: "summary",
      defaultValue: () => ({ id: "", src: "" }),
      coerce: (value) => {
        const from = value && typeof value === "object" && !Array.isArray(value) ? value : {};
        return { id: from.id === undefined ? "" : String(from.id), src: typeof from.src === "string" ? from.src : "" };
      },
      coerceList: coerceImageList,
      list: {
        port: "imagelist",
        label: "mu.vtype.imagelist",
        icon: "images",
        defaultControl: "imagelistinput",
        preview: { control: "imagecard", options: { value: { bind: "value" } } },
        format: (value) => t("mu.value.pictures", { n: coerceImageList(value).length }),
      },
      format: (value) => (value && value.src ? t("mu.vtype.picture") : "—"),
      portRead: (value) => value.src,
      portPut: (entry, value) => ({ id: entry.id, src: typeof value === "string" ? value : "" }),
    },

    // (After `list`: its list type is derived from it when this is registered.)
    // Something with a name and what it is: {name, description}, two strings.
    // The generic form of "a list of things each told apart by its name and
    // explained in a sentence" -- the categories a sorting model sorts into are
    // one -- so that the lists made of it share their editor and their presets.
    // What an app does with the list is its own business.
    description: {
      label: "mu.vtype.description",
      icon: "card-text",
      identity: "name",
      port: "description",
      params: ["default", "placeholder"],
      fields: { name: { type: "string" }, description: { type: "string" } },
      sample: { default: { name: "pose", description: "what the body is doing" } },
      defaultControl: "descriptionfields",
      defaultValue: (p) => coerceDescription(p.default),
      coerce: (value) => coerceDescription(value),
      coerceList: (value) => (Array.isArray(value) ? value.map(coerceDescription) : []),
      format: (value) => coerceDescription(value).name || "—",
      list: {
        label: "mu.vtype.descriptions",
        icon: "list-task",
        port: "descriptions",
        sample: { default: [{ name: "character", description: "" }, { name: "background", description: "" }] },
        defaultControl: "rows",
        format: (value) => t("mu.value.entries", { n: usableDescriptions(value).length }),
      },
      methods: {
        name: (p) => coerceDescription(p.get()).name,
        setName: (p, name) => p.set({ ...coerceDescription(p.get()), name: String(name ?? "") }),
        description: (p) => coerceDescription(p.get()).description,
        setDescription: (p, text) => p.set({ ...coerceDescription(p.get()), description: String(text ?? "") }),
      },
    },

    // A picture, as one string that goes straight into an <img>: the picture
    // itself (a data URL, the bytes and their media type), where the library
    // keeps it (an address named by its content, backend/blobs.py), or an
    // address that serves it (what ComfyUI hands a run's output at, a file the
    // server hands out). Which of the three it is is read off the string, never
    // stored beside it.
    //
    // A picture a person puts in -- chooses, drops -- is turned into the first
    // by the control that takes it, so a saved value does not depend on a server
    // that may be gone; a saved library value has its addresses of the third
    // kind fetched into the first (see saveValue). A program's own output may
    // hold the third as it is. A path to a file is not one of these: it is a
    // `filepath`, and becomes one by the port conversion.
    //
    // `maxBytes` is how large a picture a control will take in; the value
    // travels whole in the layout and in a saved preset, and the library
    // refuses one past 256 KB, so the default stays under that once base64
    // has had its third. It does not apply to an address.
    image: {
      label: "mu.vtype.image",
      icon: "image",
      // A picture put down on its own is kept as the picture itself (an
      // address it came as is turned into one), in the image card -- the
      // same card that takes a picture in and shows one coming out.
      stash: "image",
      preview: { control: "imagecard", options: { value: { bind: "value" } } },
      // Carried by its card's grip as a picture; taken in by the card itself
      // (see imagecard), never by a guide.
      port: "image",
      portReceive: false,
      params: ["default", "maxBytes"],
      sample: { default: "" },
      defaults: { maxBytes: 180 * 1024 },
      defaultControl: "imagebox",
      // How this type is made from a file's bytes, for a path pointing at one.
      // Declared here rather than known by the path type, so a plugin's own
      // binary type can say the same.
      fromBytes: (blob, name) => blobToDataUrl(blob, name),
      defaultValue: (p) => imageValue(p.default),
      coerce: (value) => imageValue(value),
      format: (value) => describeImage(imageFacts(value)) || (value ? String(value) : t("mu.value.noImage")),
      methods: {
        src: (p) => p.get(),
        setSrc: (p, value) => p.set(value),
        clear: (p) => p.set(""),
        // The picture's media type and decoded size, without decoding it.
        facts: (p) => imageFacts(p.get()),
        maxBytes: (p) => p.params.maxBytes,
      },
    },

    // Where a value is kept, rather than the value: a file on disk and the
    // value type of what is in it. The file is the data; this is only the
    // way to it, so the same file can be edited elsewhere and every path
    // pointing at it reads the new contents.
    //
    // The type travels with the path because a file does not say what it
    // holds -- `42` is a number, a percent or a weight depending on who wrote
    // it -- and it is also how saved paths are grouped: "the paths to
    // vectors" is the filter worth having. `of` pins it, for a property that
    // only wants files of one type (or of something derived from it).
    //
    // Reading the file needs fs:read, which is the item's to ask for. The
    // binding only borrows it: read() on an item without that permission
    // fails, the same as any other capability it never declared.
    path: {
      label: "mu.vtype.path",
      icon: "file-earmark-code",
      params: ["default", "of"],
      sample: { default: { type: "number", path: "samples/basic/number.json" } },
      defaultControl: "pathbox",
      defaultValue: (p) => pathValue(p.default, p),
      coerce: (value, p) => pathValue(value, p),
      groups: { label: "mu.field.pointsTo", of: (value) => (value && value.type) || "" },
      format: (value) =>
        value && value.path ? `${value.type} · ${value.path}` : t("mu.value.dash"),
      methods: {
        path: (p) => p.get().path,
        pointsTo: (p) => p.get().type,
        setPath: (p, path) => p.set({ ...p.get(), path: String(path ?? "") }),
        setPointsTo: (p, type) => p.set({ ...p.get(), type }),
        // The types a path may point at: anything whose values mean something
        // outside the layout, narrowed to `of` and what derives from it.
        typeOptions: (p) =>
          presetTypes()
            .filter(([name]) => name !== "path" && storable(name))
            .filter(([name]) => !p.params.of || derivesFrom(name, p.params.of))
            .map(([name, def]) => ({ value: name, label: def.label ? t(def.label) : name })),
        // The file, read and decoded as the type it is said to hold. `valid`
        // is whether that type's coercion left it alone -- a file that says
        // "abc" where a number was promised still loads, as a zero, and saying
        // so beats pretending it was fine.
        read: async (p) => {
          const { type, path } = p.get();
          if (!path) throw new Error(t("mu.status.noPath"));
          if (!p.api || !p.api.fs) throw new Error(`"${p.key}" needs fs:read to read its file`);
          // A type made from bytes (a picture) is fetched as bytes and handed
          // to the type to turn into its value; there is no text to show.
          const def = presetTypeDef(type);
          if (def && typeof def.fromBytes === "function") {
            const response = await fetch(p.api.fs.downloadUrl(path));
            if (!response.ok) {
              const body = await response.json().catch(() => ({}));
              throw new Error(body.error || `${response.status} ${response.statusText}`);
            }
            const parsed = await def.fromBytes(await response.blob(), path);
            const value = def.coerce ? def.coerce(parsed, paramsFor(presetSpecOf(type) || { type })) : parsed;
            return { path, text: "", type, value, valid: sameValue(value, parsed) && Boolean(value), problem: "" };
          }
          const file = await p.api.fs.read(path);
          return { path: file.path, text: file.content, type, ...decodeFile(type, file.content) };
        },
      },
    },

  });
  for (const [name, def] of Object.entries(BUILT_IN)) registerValueType(name, def);
  registerPortConversion("multitext", "text", (value) => pickLanguage(value));
  registerPortConversion("text", "multitext", (value) => coerceMultitext(String(value ?? "")));
  registerPortConversion("filepath", "text", (value) => String(value ?? ""));
  registerPortConversion("text", "filepath", (value) => String(value ?? "").trim());
}
