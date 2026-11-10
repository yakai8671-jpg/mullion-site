/* What a list holds, as far as a search or an addition needs to know it: the
 * type of its elements says which of them can be compared (a text, a number, a
 * switch, or the fields of an element that has some), what an element is
 * carried as, and what a new one starts as. Nothing here draws.
 */

const isPlain = (value) => !!value && typeof value === "object" && !Array.isArray(value);

export const TEXT_OPS = ["contains", "excludes", "equals", "starts", "ends"];
export const NUMBER_OPS = ["eq", "ne", "lt", "le", "gt", "ge"];
// The field a filter looks at when it is not one the element declares: the
// text the element reads as, its identity, or none (every element passes).
export const NO_FIELD = "";
export const TEXT_FIELD = "@text";
export const ID_FIELD = "@id";

export const FILTER = Object.freeze({
  field: NO_FIELD,
  op: "contains",
  value: "",
  ignoreCase: true,
  take: "all",
  index: 1,
});

export function coerceFilter(value) {
  const one = isPlain(value) ? value : {};
  const index = Math.floor(Number(one.index));
  return {
    field: typeof one.field === "string" ? one.field : FILTER.field,
    op: typeof one.op === "string" ? one.op : FILTER.op,
    value: one.value === undefined ? FILTER.value : one.value,
    ignoreCase: one.ignoreCase !== false,
    take: ["all", "first", "last", "nth"].includes(one.take) ? one.take : FILTER.take,
    index: Number.isFinite(index) && index >= 1 ? index : FILTER.index,
  };
}

export function makeShape(valueTypes) {
  const family = (type) => [type, ...((valueTypes[type] && valueTypes[type].ancestors) || [])];
  // What a value of a type is compared as: text, number or switch; null for a
  // type that is none of them.
  const comparable = (type) => {
    const kinds = family(type);
    if (kinds.includes("boolean")) return "boolean";
    if (kinds.includes("number")) return "number";
    if (kinds.includes("string") || kinds.includes("enum")) return "text";
    return null;
  };

  // The shape of a list's elements, from what portInfo says of the list.
  function shapeOf(info) {
    const type = (info && info.elementType) || "";
    const def = valueTypes[type] || null;
    const params = (info && info.elementParams) || { type };
    const basic = comparable(type);
    const fields = [];
    if (def && isPlain(def.fields)) {
      for (const [name, spec] of Object.entries(def.fields)) {
        const kind = comparable(spec.type);
        if (kind && !spec.readonly) fields.push({ name, kind, label: spec.label || "", spec });
      }
    }
    const identity = (def && def.identity) || "";
    // What one element reads as, in words: what its type formats it as.
    const textOf = (entry) => {
      if (basic) return String(entry ?? "");
      if (entry === null || entry === undefined) return "";
      if (def && typeof def.format === "function") {
        try {
          return String(def.format(entry, params));
        } catch (error) {
          return "";
        }
      }
      return typeof entry === "string" ? entry : JSON.stringify(entry);
    };
    // What the elements are carried as: the kind of their type, or of what
    // they are made of.
    const elementKind = (() => {
      if (def && typeof def.port === "string") return def.port;
      if (basic === "text") return "text";
      return basic || "";
    })();
    const read = (entry) => (def && typeof def.portRead === "function" ? def.portRead(entry) : entry);
    return { type, def, params, basic, fields, identity, textOf, elementKind, read };
  }

  // The field a filter may look at, and what it is compared as.
  function fieldKind(shape, field) {
    if (field === NO_FIELD) return null;
    if (field === TEXT_FIELD || field === ID_FIELD) return "text";
    const found = shape.fields.find((one) => one.name === field);
    return found ? found.kind : null;
  }

  const valueAt = (shape, entry, field) => {
    if (field === TEXT_FIELD) return shape.textOf(entry);
    if (field === ID_FIELD) return shape.identity && isPlain(entry) ? String(entry[shape.identity] ?? "") : "";
    return isPlain(entry) ? entry[field] : undefined;
  };

  function passes(shape, filter, entry) {
    const kind = fieldKind(shape, filter.field);
    if (!kind) return true;
    const got = valueAt(shape, entry, filter.field);
    if (kind === "boolean") return Boolean(got) === (filter.value === true || filter.value === "true");
    if (kind === "number") {
      const a = Number(got);
      const b = Number(filter.value);
      if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
      switch (filter.op) {
        case "ne": return a !== b;
        case "lt": return a < b;
        case "le": return a <= b;
        case "gt": return a > b;
        case "ge": return a >= b;
        default: return a === b;
      }
    }
    const fold = (text) => (filter.ignoreCase ? String(text ?? "").toLowerCase() : String(text ?? ""));
    const a = fold(got);
    const b = fold(filter.value);
    switch (filter.op) {
      case "excludes": return !a.includes(b);
      case "equals": return a === b;
      case "starts": return a.startsWith(b);
      case "ends": return a.endsWith(b);
      default: return a.includes(b);
    }
  }

  // The elements of a list as its type reads them (a prompt list's prompts,
  // a picture list's pictures), whatever shape they came in.
  function entriesOf(info) {
    const raw = info.read();
    const def = valueTypes[info.type];
    let value = raw;
    try {
      value = def && typeof def.coerce === "function" ? def.coerce(raw, info.params) : raw;
    } catch (error) {
      value = raw;
    }
    return Array.isArray(value) ? value : [];
  }

  // What the filter takes from the list: {kind, value} -- the matches as a list
  // of the list's own kind, or the one element taken (no list) as what an
  // element is carried as. Nothing taken is {kind: "", value: null}.
  function search(info, filterValue) {
    const empty = { kind: "", value: null, count: 0 };
    if (!info || !info.isList) return empty;
    const shape = shapeOf(info);
    const filter = coerceFilter(filterValue);
    const matches = entriesOf(info).filter((entry) => passes(shape, filter, entry));
    if (filter.take === "all") return { kind: info.kind, value: matches, count: matches.length };
    const one = filter.take === "first" ? matches[0] : filter.take === "last" ? matches[matches.length - 1] : matches[filter.index - 1];
    if (one === undefined) return { ...empty, count: matches.length };
    // An element that is carried as nothing in particular is given as its words.
    const kind = shape.elementKind || "text";
    return { kind, value: shape.elementKind ? shape.read(one) : shape.textOf(one), count: matches.length };
  }

  return { comparable, shapeOf, fieldKind, entriesOf, search, passes };
}
