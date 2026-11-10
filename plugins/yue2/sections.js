// Documents stay structured in the layout; the ComfyUI boundary uses text.
import { contextOf, splitHeader } from "./abcmodel.js";

// Not crypto.randomUUID: it exists only in a secure context, and Mullion is
// also opened over plain http by its LAN address.
export const newId = () => `s-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;

// The ABC part names YuE2 knows. They are its own vocabulary, word for word
// (one `% name` comment where the structure changes). Lyrics use tags spelt
// as YuE2's examples spell them ([Verse], [Chorus]);
// YuE's notes find [Intro] the least stable, so it is offered but not first.
export const ABC_SECTIONS = ["intro", "verse", "pre-chorus", "chorus", "bridge", "interlude", "outro", "instrumental"];
export const LYRIC_SECTIONS = ["Verse", "Pre-Chorus", "Chorus", "Bridge", "Outro", "Intro", "Interlude"];
const namesFor = (abc) => (abc ? ABC_SECTIONS : LYRIC_SECTIONS);

// A known name in its own spelling ("[verse]" → "Verse"); anything else as
// it was written, so nothing typed or pasted is lost.
function canonical(name, abc) {
  const plain = String(name || "").replace(/[\r\n]/g, " ").trim();
  const key = plain.toLowerCase().replace(/[\s_]+/g, "-");
  return namesFor(abc).find((one) => one.toLowerCase() === key) || plain;
}

function parse(text, abc) {
  const result = [];
  let name = "";
  let lines = [];
  const push = () => {
    const text = lines.join("\n").replace(/^\n+|\n+$/g, "");
    if (text || name) result.push({ id: `section-${result.length + 1}`, name: canonical(name, abc), text });
  };
  for (const line of String(text || "").replace(/\r\n?/g, "\n").split("\n")) {
    const marker = abc ? /^%[ \t]+(.+?)\s*$/.exec(line) : /^\s*\[([^\]\n]+)\]\s*$/.exec(line);
    if (marker) { push(); name = marker[1]; lines = []; }
    else lines.push(line);
  }
  push();
  return result;
}

export function sectionsOf(value, abc = false) {
  if (!Array.isArray(value)) return parse(value, abc);
  const used = new Set();
  return value.filter(one => one && typeof one === "object").map((one, index) => {
    let id = typeof one.id === "string" && one.id ? one.id : `section-${index + 1}`;
    while (used.has(id)) id += "-copy";
    used.add(id);
    return { id, name: canonical(one.name, abc), text: String(one.text ?? "") };
  });
}

export function documentOf(value, abc = false) {
  if (!Array.isArray(value)) return String(value ?? "");
  return sectionsOf(value, abc).map(one => {
    const name = one.name.trim();
    return `${name ? (abc ? `% ${name}` : `[${name.replace(/[\[\]]/g, "")}]`) + "\n" : ""}${one.text}`;
  }).join(abc ? "\n" : "\n\n");
}

// The ABC as a value: its header -- the fixed lines above the music (the
// tune number, meter, unit length, tempo, the two voices, the key) -- and the
// sections the music is written in. As one value it is carried whole, as the
// text it writes out as. What comes in as text (or as the list of sections
// the editor used to keep, header and all) is split the same way: the header
// is what is above the first plain `V: Vocal` line of the first part, and
// music that follows it before any `% name` is a section without a name.
export function abcOf(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return { header: String(value.header ?? ""), sections: sectionsOf(value.sections ?? [], true) };
  }
  const list = Array.isArray(value) ? sectionsOf(value, true) : parse(value, true);
  if (list.length && !list[0].name) {
    const { header, body } = splitHeader(list[0].text);
    const rest = list.slice(1);
    return { header, sections: body.trim() ? [{ ...list[0], text: body }, ...rest] : rest };
  }
  return { header: "", sections: list };
}

export function abcDocument(value) {
  const { header, sections } = abcOf(value);
  return [header, documentOf(sections, true)].filter((part) => part !== "").join("\n");
}

export function registerSections(fw) {
  const normalizeParts = value => sectionsOf(value, true);
  const normalizeLyrics = value => sectionsOf(value, false);
  const lyricList = {
    label: "yue2.prop.lyrics", icon: "list-ol",
    port: "text", portRead: value => documentOf(value, false),
    methods: {
      text: p => documentOf(p.get(), false),
      setText: (p, value) => p.set(normalizeLyrics(value)),
    },
  };
  // One section of the lyrics or one part of the ABC, carried as the text it
  // writes out as. Text put into one replaces its words (and its name, when the
  // text brings one).
  const entryType = (name, abc, icon) => fw.registerValueType(name, {
    label: abc ? "yue2.vtype.part" : "yue2.vtype.section", icon, port: "text", identity: "id",
    storable: false, presetNew: false,
    params: ["default"],
    fields: { name: { type: "string" }, text: { type: "string" } },
    sample: { default: { id: "s0", name: abc ? "verse" : "Verse", text: "" } },
    defaultControl: "summary",
    defaultValue: () => ({ id: "", name: "", text: "" }),
    coerce: value => sectionsOf([value], abc)[0] || { id: "", name: "", text: "" },
    coerceList: abc ? normalizeParts : normalizeLyrics,
    list: abc ? { label: "yue2.prop.parts", icon: "music-note-list" } : lyricList,
    format: value => (value && value.name) || "—",
    portRead: value => documentOf([value], abc),
    portPut: (entry, value) => {
      const taken = sectionsOf(String(value ?? ""), abc);
      if (taken.length === 1 && taken[0].name) return { ...entry, name: taken[0].name, text: taken[0].text };
      return { ...entry, text: taken.length ? documentOf(taken, abc) : "" };
    },
  });
  entryType("yue2.lyric", false, "type");
  entryType("yue2.part", true, "music-note-list");
  // One value of its own kind, carried as text (the way h3's draft is one).
  fw.registerValueType("yue2.abc", {
    label: "yue2.prop.abc", icon: "music-note-list", port: "text",
    params: ["default"],
    fields: { header: { type: "string" }, sections: { type: "list", each: { type: "yue2.part" } } },
    sample: { default: { header: "", sections: [] } },
    defaultControl: "summary",
    defaultValue: () => ({ header: "", sections: [] }),
    coerce: abcOf,
    format: value => `${abcOf(value).sections.length}`,
    portRead: value => abcDocument(value),
    methods: {
      text: p => abcDocument(p.get()),
      setText: (p, value) => p.set(abcOf(value)),
    },
  });
}

// What the header and the sections before this one have set (the unit
// length, the meter and key in force), for the piano roll that edits this one.
export const contextFor = (header, list, index) => contextOf([header, ...list.slice(0, index).map((one) => one.text)]);

// A part's name as it is shown: YuE2's own names in words ("verse" → "Verse
// (Aメロ)"), any other as it was written, none as "untitled".
export function partNameLabel(t, name, abc = true) {
  if (!name) return t(abc ? "yue2.part.untitled" : "yue2.section.untitled");
  const key = `yue2.${abc ? "partName" : "sectionName"}.${name.toLowerCase()}`;
  const said = t(key);
  return said === key ? name : said;
}

// Uses the shell's cards, controls and descriptors, with live accessors so
// delayed edits always target the section they were opened for. Each part is
// text here; the score editor (editor.js) is where an ABC part is drawn.
export function sectionList(fw, { api, item, key, read, write, abc = false, summary = false, busy = false, open, tools = [], listTitle = "", port = { item: item.id, key } }) {
  const { NODES, t } = fw.core;
  const now = () => sectionsOf(read(), abc);
  const change = (id, patch) => { if (!busy) write(now().map(one => one.id === id ? { ...one, ...patch } : one)); };
  const remove = id => { if (!busy) write(now().filter(one => one.id !== id)); };
  const partPath = id => (abc ? ["sections", id] : [id]);
  const list = now();
  const entries = list.map((one) => {
    const title = one.name || t(abc ? "yue2.part.untitled" : "yue2.section.untitled");
    const field = (name, control, extra = {}, label = `yue2.field.${name}`) => fw.describe({
      type: "string", control, readonly: busy,
      read: () => (now().find(entry => entry.id === one.id) || {})[name] || "",
      write: (_api, value) => change(one.id, { [name]: String(value) }), ...extra,
    }, { api, key: `${item.id}-${key}-${one.id}-${name}`, label: t(label) });
    return NODES.card(`${key}-${one.id}`, title,
      summary ? [] : [
        NODES.props(`name-${one.id}`, [field("name", "select", {
          type: "enum",
          // YuE2's names; one from elsewhere (or none, for music that came
          // without a `% name`) stays offered as it is.
          options: () => {
            const current = (now().find(entry => entry.id === one.id) || {}).name || "";
            const names = [...namesFor(abc)];
            if (!names.includes(current)) names.push(current);
            return names.map(value => ({ value, label: partNameLabel(t, value, abc) }));
          },
        }, abc ? "yue2.field.partName" : "yue2.field.name")]),
        NODES.control(`text-${one.id}`, { desc: field("text", "texteditor", { lines: abc ? 6 : 4 }) }),
      ], [
        ...(open ?[{ key: "edit", icon: "pencil", label: t("yue2.action.editor"), disabled: busy, run: open }] : []),
      ], {
        // Each part is a port of its own: carried by its grip (to another
        // text, or to a place in this list), and the way it is moved.
        port: summary ? null : { item: item.id, key, path: partPath(one.id) },
        isListElement: true,
        onDiscard: busy ? null : () => remove(one.id), icon: abc ? "music-note-list" : "type",
      });
  });
  return NODES.listCard(`${key}-list`, entries, { title: listTitle, tools: tools, port,
    add: busy ? null : {
      label: t(abc ? "yue2.action.addPart" : "yue2.action.addSection"),
      run: () => {
        const list = now();
        write([...list, { id: newId(), name: abc ? "verse" : "Verse", text: "" }]);
        if (summary && open) open();
      },
    } });
}
