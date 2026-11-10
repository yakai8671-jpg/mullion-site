/* The variables a text is composed of, and how a text holds them.
 *
 * A text holds an embedded variable as a run of characters: an opening mark,
 * the variable's id written in zero-width characters, and a closing mark. In
 * what is stored that is all it is; in the text card it is also given the
 * variable's name (and a handle), which is what the badge drawn over it shows.
 * Because the run is made of ordinary characters, everything a text field
 * does with text -- typing around it, cutting and pasting it, undoing -- keeps
 * working, and `reconcile` reads back from the field which variables are still
 * in the text, in what order, and which were copied.
 *
 *   stored    OPEN  id  CLOSE                    (invisible)
 *   in field  OPEN  id  handle + name  CLOSE     (the badge sits over this)
 *
 * A variable comes from a source: the basic ones the plugin carries (the date
 * and time), or any value carried to the catalog by a grip -- text, a picture,
 * a chain's variables. A source says what kind of value it is; what variables
 * that gives is `variablesOf`.
 */

export const OPEN = "⁠";
export const CLOSE = "⁣";
export const HANDLE = "≡ ";

const ZW = ["​", "‌", "‍", "⁢"];
const ZW_CLASS = "[\\u200B\\u200C\\u200D\\u2062]";
const RUN = () => new RegExp(`${OPEN}(${ZW_CLASS}+)([^${OPEN}${CLOSE}]*)${CLOSE}`, "g");
const COMPACT = () => new RegExp(`${OPEN}(${ZW_CLASS}+)${CLOSE}`, "g");

let seq = 0;
export const newId = (prefix = "e") => `${prefix}${Date.now().toString(36)}${(seq++).toString(36)}`;

export function encodeId(id) {
  let out = "";
  for (const ch of String(id)) {
    const c = ch.charCodeAt(0) & 255;
    out += ZW[(c >> 6) & 3] + ZW[(c >> 4) & 3] + ZW[(c >> 2) & 3] + ZW[c & 3];
  }
  return out;
}

export function decodeId(zw) {
  const chars = [...zw];
  let out = "";
  for (let i = 0; i + 4 <= chars.length; i += 4) {
    const c = (ZW.indexOf(chars[i]) << 6) | (ZW.indexOf(chars[i + 1]) << 4) | (ZW.indexOf(chars[i + 2]) << 2) | ZW.indexOf(chars[i + 3]);
    out += String.fromCharCode(c);
  }
  return out;
}

export const compactRun = (id) => OPEN + encodeId(id) + CLOSE;
export const runLabel = (label) => HANDLE + String(label).replace(/ /g, " ");
const fullRun = (id, label) => OPEN + encodeId(id) + runLabel(label) + CLOSE;

// What is stored, as the field shows it: each run given its variable's name.
// A run whose variable is gone is not shown.
export function expand(text, labelOf) {
  return String(text ?? "").replace(COMPACT(), (_whole, zw) => {
    const id = decodeId(zw);
    const label = labelOf(id);
    return label === null || label === undefined ? "" : fullRun(id, label);
  });
}

// The runs in what the field shows: where each stands, whose it is.
export function runsOf(value) {
  const out = [];
  for (const m of String(value ?? "").matchAll(RUN())) {
    out.push({ from: m.index, to: m.index + m[0].length, id: decodeId(m[1]), label: m[2] });
  }
  return out;
}

// The ids of the runs in stored text, in order.
export function idsIn(text) {
  return [...String(text ?? "").matchAll(COMPACT())].map((m) => decodeId(m[1]));
}

// Where a place in the field is, in the stored text.
export function toCompactOffset(value, offset) {
  let shown = 0;
  for (const run of runsOf(value)) {
    if (run.to > offset) break;
    shown += run.to - run.from - compactRun(run.id).length;
  }
  return offset - shown;
}

// And the other way round.
export function toShownOffset(text, offset, labelOf) {
  let extra = 0;
  for (const m of String(text ?? "").matchAll(COMPACT())) {
    if (m.index + m[0].length > offset) break;
    const label = labelOf(decodeId(m[1]));
    if (label !== null && label !== undefined) extra += fullRun(decodeId(m[1]), label).length - m[0].length;
  }
  return offset + extra;
}

// What the field now holds, taken back into what is stored, and which
// variables are embedded in it: a run that is whole and whose variable is
// there stays; a run cut into, or whose variable is gone, goes; a run found
// twice (copied) makes a copy of its variable. Whatever is left of a run that
// was broken -- a mark, a name -- is taken out with it.
export function reconcile(value, embeds, labelOf) {
  const byId = new Map(embeds.map((one) => [one.id, one]));
  const seen = new Set();
  const next = [];
  let text = "";
  let at = 0;
  // What is left of a run that was cut into: its opening mark and the name
  // after it, or its closing mark alone.
  const loose = (piece) => {
    let out = "";
    let i = 0;
    while (i < piece.length) {
      const ch = piece[i];
      if (ch === OPEN) {
        let j = i + 1;
        let zw = "";
        while (j < piece.length && ZW.includes(piece[j])) {
          zw += piece[j];
          j += 1;
        }
        const label = labelOf(decodeId(zw));
        if (label !== null && label !== undefined && piece.startsWith(runLabel(label), j)) j += runLabel(label).length;
        i = j;
      } else if (ch === CLOSE) {
        i += 1;
      } else {
        out += ch;
        i += 1;
      }
    }
    return out;
  };
  for (const m of String(value ?? "").matchAll(RUN())) {
    text += loose(value.slice(at, m.index));
    at = m.index + m[0].length;
    const id = decodeId(m[1]);
    const embed = byId.get(id);
    const label = labelOf(id);
    if (!embed || label === null || label === undefined || m[2] !== runLabel(label)) continue;
    let use = embed;
    if (seen.has(id)) use = { ...embed, id: newId(), opts: JSON.parse(JSON.stringify(embed.opts || {})) };
    seen.add(use.id);
    next.push(use);
    text += compactRun(use.id);
  }
  text += loose(String(value ?? "").slice(at));
  return { text, embeds: next };
}

// What the text says with the runs taken out.
export const plain = (text) => String(text ?? "").replace(COMPACT(), "");

// Runs taken out of stored text: those of the given ids.
export const dropRuns = (text, ids) =>
  String(text ?? "").replace(COMPACT(), (whole, zw) => (ids.has(decodeId(zw)) ? "" : whole));

// A run put into stored text, at a place in it.
export function insertRun(text, offset, id) {
  const at = Math.max(0, Math.min(String(text ?? "").length, Number.isFinite(offset) ? offset : text.length));
  return text.slice(0, at) + compactRun(id) + text.slice(at);
}

// ---- variables -------------------------------------------------------------
const NUMBER = /^-?\d+(\.\d+)?$/;

export function createVars(core, t) {
  const pad2 = (n, width = 2) => String(n).padStart(width, "0");
  function formatDate(date, format) {
    return String(format).replace(/YYYY|YY|MM|DD|HH|mm|ss|SSS/g, (token) => {
      switch (token) {
        case "YYYY":
          return String(date.getFullYear());
        case "YY":
          return pad2(date.getFullYear() % 100);
        case "MM":
          return pad2(date.getMonth() + 1);
        case "DD":
          return pad2(date.getDate());
        case "HH":
          return pad2(date.getHours());
        case "mm":
          return pad2(date.getMinutes());
        case "ss":
          return pad2(date.getSeconds());
        default:
          return pad2(date.getMilliseconds(), 3);
      }
    });
  }

  // How a value is written, by the kind of the variable: the options each
  // kind has, shown in the embed list.
  const OPTIONS = {
    datetime: [{ key: "format", kind: "string", default: "YYYYMMDD-HHmmss" }],
    number: [
      {
        key: "pad",
        kind: "enum",
        default: "none",
        options: ["none", "zero", "space"],
      },
      { key: "width", kind: "number", default: 0, min: 0, max: 40 },
      { key: "decimals", kind: "number", default: -1, min: -1, max: 10 },
    ],
    bytes: [
      { key: "unit", kind: "enum", default: "auto", options: ["auto", "B", "KB", "MB"] },
      { key: "decimals", kind: "number", default: 1, min: 0, max: 6 },
    ],
    text: [
      { key: "transform", kind: "enum", default: "none", options: ["none", "upper", "lower", "trim"] },
      { key: "max", kind: "number", default: 0, min: 0, max: 100000 },
    ],
  };
  const optionOf = (type, opts, key) => {
    const spec = (OPTIONS[type] || []).find((one) => one.key === key);
    const given = opts && opts[key];
    return given === undefined || given === null ? (spec ? spec.default : undefined) : given;
  };

  function formatNumber(raw, opts) {
    const n = Number(raw);
    if (!Number.isFinite(n)) return "";
    const decimals = Number(optionOf("number", opts, "decimals"));
    let body = decimals >= 0 ? Math.abs(n).toFixed(decimals) : String(Math.abs(n));
    const width = Math.max(0, Math.floor(Number(optionOf("number", opts, "width")) || 0));
    const mode = optionOf("number", opts, "pad");
    const sign = n < 0 ? "-" : "";
    if (mode === "zero") body = sign + body.padStart(Math.max(0, width - sign.length), "0");
    else {
      body = sign + body;
      if (mode === "space") body = body.padStart(width, " ");
    }
    return body;
  }

  function formatBytes(raw, opts) {
    const n = Number(raw);
    if (!Number.isFinite(n)) return "";
    const decimals = Math.max(0, Math.floor(Number(optionOf("bytes", opts, "decimals"))) || 0);
    let unit = optionOf("bytes", opts, "unit");
    if (unit === "auto") unit = n >= 1024 * 1024 ? "MB" : n >= 1024 ? "KB" : "B";
    const size = { B: 1, KB: 1024, MB: 1024 * 1024 }[unit] || 1;
    return `${unit === "B" ? String(Math.round(n)) : (n / size).toFixed(decimals)} ${unit}`;
  }

  function formatText(raw, opts) {
    let out = String(raw ?? "");
    const how = optionOf("text", opts, "transform");
    if (how === "upper") out = out.toUpperCase();
    else if (how === "lower") out = out.toLowerCase();
    else if (how === "trim") out = out.trim();
    const max = Math.floor(Number(optionOf("text", opts, "max")) || 0);
    return max > 0 ? [...out].slice(0, max).join("") : out;
  }

  // What a picture is, once it has been looked at: fetched in the background,
  // and what is known by then is what is said.
  const pictures = new Map();
  function pictureInfo(src) {
    let one = pictures.get(src);
    if (one) return one;
    one = { width: null, height: null, bytes: null };
    pictures.set(src, one);
    const image = new Image();
    image.onload = () => {
      one.width = image.naturalWidth;
      one.height = image.naturalHeight;
      core.refreshItems();
    };
    image.src = src;
    fetch(src)
      .then((answer) => answer.blob())
      .then((blob) => {
        one.bytes = blob.size;
        core.refreshItems();
      })
      .catch(() => {});
    return one;
  }
  const fileName = (src) => {
    const text = String(src || "");
    const named = /[?&]filename=([^&]+)/.exec(text);
    if (named) return decodeURIComponent(named[1]);
    return decodeURIComponent(text.split(/[?#]/)[0].split("/").pop() || "");
  };

  const textOf = (value, kind) =>
    typeof value === "string" ? value : value === null || value === undefined ? "" : core.portConvert(value, kind, "text") ?? "";

  // The kinds of value a source may be, and the variables each gives.
  const field = (source, name, label, type, get, labelText) => ({
    key: `${source.id}:${name}`,
    source: source.id,
    field: name,
    label: labelText || t(label),
    type,
    read: get,
  });

  const NOW = { id: "now", builtin: true, label: "" };
  const readSource = (source) => source.value;

  function variablesOf(source) {
    if (source.builtin || source.id === "now") {
      return [
        field(NOW, "now", "compose.var.now", "datetime", () => new Date()),
        field(NOW, "timestamp", "compose.var.timestamp", "number", () => Math.floor(Date.now() / 1000)),
      ];
    }
    const value = readSource(source);
    const kind = source.kind;
    if (kind === "text" || kind === "taglist" || kind === "prompt" || kind === "promptlist") {
      const out = [
        field(source, "value", "compose.var.text", "text", () => textOf(value, kind)),
        field(source, "length", "compose.var.length", "number", () => [...textOf(value, kind)].length),
      ];
      if (kind === "taglist" || kind === "promptlist") {
        out.push(field(source, "count", "compose.var.count", "number", () => (Array.isArray(value) ? value.length : 0)));
      }
      return out;
    }
    if (kind === "image") {
      const src = typeof value === "string" ? value : "";
      return [
        field(source, "path", "compose.var.path", "text", () => src),
        field(source, "name", "compose.var.name", "text", () => fileName(src)),
        field(source, "width", "compose.var.width", "number", () => (src ? pictureInfo(src).width : null)),
        field(source, "height", "compose.var.height", "number", () => (src ? pictureInfo(src).height : null)),
        field(source, "size", "compose.var.size", "text", () => {
          const one = src ? pictureInfo(src) : null;
          return one && one.width ? `${one.width}x${one.height}` : "";
        }),
        field(source, "fileSize", "compose.var.fileSize", "bytes", () => (src ? pictureInfo(src).bytes : null)),
      ];
    }
    if (kind === "imagelist") {
      const list = (Array.isArray(value) ? value : []).map((one) => (typeof one === "string" ? one : one && one.src)).filter(Boolean);
      return [
        field(source, "count", "compose.var.count", "number", () => list.length),
        field(source, "path", "compose.var.firstPath", "text", () => list[0] || ""),
      ];
    }
    if (kind === "chainvars") {
      return (Array.isArray(value) ? value : [])
        .filter((one) => one && one.name)
        .map((one) =>
          field(source, one.name, "", one.type === "number" || (!one.type && NUMBER.test(String(one.value))) ? "number" : "text", () => one.value, one.name)
        );
    }
    return [];
  }

  const allVariables = (sources) => [...variablesOf(NOW), ...sources.flatMap((one) => variablesOf(one))];
  const find = (sources, key) => allVariables(sources).find((one) => one.key === key) || null;

  function format(variable, opts) {
    const raw = variable.read();
    if (variable.type === "datetime") return raw instanceof Date ? formatDate(raw, optionOf("datetime", opts, "format")) : "";
    if (variable.type === "number") return raw === null || raw === undefined ? "" : formatNumber(raw, opts);
    if (variable.type === "bytes") return raw === null || raw === undefined ? "" : formatBytes(raw, opts);
    return formatText(raw, opts);
  }

  // The text with every embedded variable written out.
  function compose(text, embeds, sources) {
    const byId = new Map(embeds.map((one) => [one.id, one]));
    const all = allVariables(sources);
    return String(text ?? "").replace(COMPACT(), (_whole, zw) => {
      const embed = byId.get(decodeId(zw));
      const variable = embed && all.find((one) => one.key === embed.var);
      return variable ? format(variable, embed.opts) : "";
    });
  }

  return { OPTIONS, optionOf, variablesOf, allVariables, find, format, compose, formatDate, NOW, readSource };
}
