import { ACC, chordOf, noteOf } from "./note.js";
import registerNote from "./note.js";
import registerRoll from "./roll.js";
import registerCard from "./abccard.js";
import { abcDocument, abcOf, contextFor, documentOf, sectionsOf } from "./sections.js";

function getControlDef(registerFn, controlName, api) {
  let captured = null;
  const mockFw = {
    core: api?.core || { t: (k) => k, ICONS: {} },
    card: api?.card || {
      buildSide: (cls) => {
        const card = Object.assign(document.createElement("div"), { className: `mu-card ${cls}` });
        const grip = Object.assign(document.createElement("div"), { className: "mu-port-grip" });
        const body = Object.assign(document.createElement("div"), { className: "mu-card-body" });
        card.append(grip, body);
        return { card, body, grip };
      },
      syncHead() {},
    },
    controls: api?.controls || {},
    describe: api?.describe,
    registerControl(name, def) {
      if (name === controlName) captured = def;
    },
    registerValueType() {},
    registerTranslations() {},
  };
  registerFn(mockFw);
  if (!captured) return null;
  const { render, update, mount, unmount } = captured;
  return {
    ...(render ? { render } : {}),
    ...(update ? { update } : {}),
    ...(mount ? { mount } : {}),
    ...(unmount ? { unmount } : {}),
  };
}

export const controls = {
  "yue2.notecard": (api) => getControlDef(registerNote, "yue2.notecard", api),
  "yue2.roll": (api) => getControlDef(registerRoll, "yue2.roll", api),
  "yue2.abccard": (api) => getControlDef(registerCard, "yue2.abccard", api),
};

export const types = {
  "yue2.note": {
    coerce: noteOf,
    format: (value) => {
      const v = noteOf(value);
      return v ? `${v.layer} · ${v.letter}${ACC[v.alt] ?? ""}${v.oct}` : "";
    },
  },
  "yue2.chord": {
    coerce: chordOf,
    format: (value) => {
      const v = chordOf(value);
      return v ? `${v.root}${v.quality}${v.bass ? `/${v.bass}` : ""}` : "";
    },
  },
  "yue2.lyric": {
    list: {
      portRead: (value) => documentOf(value, false),
      methods: {
        text: (p) => documentOf(p.get(), false),
        setText: (p, value) => p.set(sectionsOf(value, false)),
      },
    },
    coerce: (value) => sectionsOf([value], false)[0] || { id: "", name: "", text: "" },
    coerceList: (value) => sectionsOf(value, false),
    format: (value) => (value && value.name) || "—",
    portRead: (value) => documentOf([value], false),
    portPut: (entry, value) => {
      const taken = sectionsOf(String(value ?? ""), false);
      if (taken.length === 1 && taken[0].name) return { ...entry, name: taken[0].name, text: taken[0].text };
      return { ...entry, text: taken.length ? documentOf(taken, false) : "" };
    },
  },
  "yue2.part": {
    coerce: (value) => sectionsOf([value], true)[0] || { id: "", name: "", text: "" },
    coerceList: (value) => sectionsOf(value, true),
    format: (value) => (value && value.name) || "—",
    portRead: (value) => documentOf([value], true),
    portPut: (entry, value) => {
      const taken = sectionsOf(String(value ?? ""), true);
      if (taken.length === 1 && taken[0].name) return { ...entry, name: taken[0].name, text: taken[0].text };
      return { ...entry, text: taken.length ? documentOf(taken, true) : "" };
    },
  },
  "yue2.abc": {
    coerce: abcOf,
    format: (value) => `${abcOf(value).sections.length}`,
    portRead: (value) => abcDocument(value),
    methods: {
      text: (p) => abcDocument(p.get()),
      setText: (p, value) => p.set(abcOf(value)),
    },
  },
};

const selectedPart = (read) => {
  const parts = sectionsOf(read("parts"), true);
  const index = Math.max(0, parts.findIndex((entry) => entry.id === read("part")));
  return { parts, index, selected: parts[index] };
};
export const derived = {
  scoreText: (_api, _item, { read }) => selectedPart(read).selected?.text || "",
  scorePart: (_api, _item, { read }) => selectedPart(read).selected?.id || "",
  scoreParts: (_api, _item, { read }) => selectedPart(read).parts.map((entry) => ({ value: entry.id, label: entry.name || "—" })),
  scoreContext: (_api, _item, { read }) => { const { parts, index } = selectedPart(read); return contextFor(read("header") || "", parts, index); },
};
