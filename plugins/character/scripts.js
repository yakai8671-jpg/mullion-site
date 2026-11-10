/* Character Editor declarative scripts */
import createControls from "./controls.js";
import { actionId, characterOf, coerceActions as characterActions, createEditorScreen, isDirty, isEmpty } from "./editor.js";
import { YIELDS, coerceAction, coerceCharacter, coerceReference, findCharacter, newUid } from "./model.js";
import {
  coerceMedia,
  hasMedia,
  isVideoMedia,
  portKindOf as mediaPortKindOf,
  portRead as mediaPortRead,
  portWrite as mediaPortWrite,
  shownOf,
} from "./media.js";

const TYPE = "character";
const MEDIA = "character.media";
const ACTION = "character.action";
const ACTIONS = "character.actions";

const firstPicture = (c) => c?.references?.find((one) => one.kind === "image" && one.data)?.data || "";

function summaryOf(c, t = core.t || ((k) => k)) {
  return {
    name: c?.name || t("character.value.unnamed"),
    detail: [
      t("character.references.count", { n: c?.references?.length || 0 }),
      t("character.value.actionCount", { n: c?.actions?.length || 0 }),
    ]
      .filter(Boolean)
      .join(" · "),
    thumb: firstPicture(c),
  };
}

let core;
export function initialize(api) {
  core = api.core;
  // So a character can be dropped where words or pictures are wanted: on a text prompt it is the sentence a
  // run would get, on a list of pictures its sheet.
  try {
    const conv = core.registerPortConversion;
    if (conv) {
      conv(TYPE, "text", (value) => YIELDS["value.prompt_single"](value));
      conv(TYPE, "imagelist", (value) =>
        coerceCharacter(value)
          .references.filter((one) => one.kind === "image" && one.data)
          .map((one, i) => ({ id: String(i), src: one.data }))
      );
    }
  } catch {
    // Ignore in environments where already registered
  }
}

const el = (tag, className, props = {}) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return Object.assign(node, props);
};

export const types = {
  "character.reference": {
    defaultValue: () => coerceReference({}),
    coerce: coerceReference,
    coerceList: (val) => (Array.isArray(val) ? val.map(coerceReference) : []),
    format: (value) => coerceReference(value).name || "—",
  },
  "character.action": {
    defaultValue: () => coerceAction({}),
    coerce: coerceAction,
    coerceList: (value) => (Array.isArray(value) ? value.map(coerceAction) : []),
    format: (value) => coerceAction(value).name || "—",
    portText: (value) => coerceAction(value).name || "",
  },
  character: {
    defaultValue: (p) => coerceCharacter(p?.default),
    coerce: (value) => coerceCharacter(value),
    format: (value) => {
      const t = core.t || ((k) => k);
      return coerceCharacter(value).name || t("character.value.unnamed");
    },
    yields: YIELDS,
    supplies: {
      "prompt.sentence": (value) => {
        const c = coerceCharacter(value);
        const t = core.t || ((k, vars) => `${vars?.name || ""}`);
        const who = c.name || t("character.value.unnamed");
        const own = YIELDS["value.prompt_single"](c);
        return own
          ? [
              {
                name: t("character.supply.description", { name: who }),
                value: { name: t("character.supply.description", { name: who }), text: own, category: who },
              },
            ]
          : [];
      },
      image: (value) => {
        const c = coerceCharacter(value);
        const t = core.t || ((k, vars) => `${vars?.name || ""}`);
        const who = c.name || t("character.value.unnamed");
        return [
          ...c.references
            .filter((one) => one.kind === "image" && one.data)
            .map((one, i) => ({ name: `${who}: ${one.name || i + 1}`, value: one.data })),
        ];
      },
    },
    methods: {
      summary: (p) => summaryOf(coerceCharacter(p.get())),
      character: (p) => coerceCharacter(p.get()),
      src: (p) => firstPicture(coerceCharacter(p.get())),
    },
  },
  "character.media": {
    portKindOf: (value) => mediaPortKindOf(value),
    portRead: (value) => mediaPortRead(value),
    portWrite: (value, held) => mediaPortWrite(value, held),
    defaultValue: () => coerceMedia({}),
    coerce: (value) => coerceMedia(value),
    coerceList: (value) => (Array.isArray(value) ? value.map(coerceMedia) : []),
    format: (value) => {
      const one = coerceMedia(value);
      const t = core.t || ((k) => k);
      return one.kind ? `${t(`character.value.media.${one.kind}` || one.kind)}` : t("character.value.noMedia");
    },
    methods: {
      hasMedia: (p) => hasMedia(coerceMedia(p.get())),
      isVideo: (p) => isVideoMedia(coerceMedia(p.get())),
      shown: (p) => shownOf(coerceMedia(p.get()), { store: core.store }),
    },
  },
};

// ---- the controls ------------------------------------------------------------------------------
// The six controls that draw themselves are made together (they share how a card is drawn); each is given to
// the shell by its own name.
const made = new WeakMap();
const drawn = (fw) => {
  if (!made.has(fw)) made.set(fw, createControls(fw));
  return made.get(fw);
};
const DRAWING = ["render", "update", "mount", "unmount"];
const drawingOf = (id) => (fw) => Object.fromEntries(DRAWING.filter((key) => drawn(fw)[id]?.[key] !== undefined).map((key) => [key, drawn(fw)[id][key]]));

export const controls = {
  ...Object.fromEntries(["character.summary", "character.card", "character.mediainput", "character.referencepreview", "character.actionpreview"].map((id) => [id, drawingOf(id)])),
};

// The screens: each the body of an item.
export const screens = {
  // The editor: the character card with the name, the references and the actions in it.
  "character.editor": (fw) => createEditorScreen(fw),
  // The preview window: the references or the actions of the character, one gallery at a time.
  "character.preview": (fw) => {
    const { NODES, t } = fw.core;
    return {
      body(s) {
        const p = s.props;
        const itemId = s.item.id;
        const mode = p.mode === "actions" ? "actions" : "references";
        const view = fw.describe(
          {
            type: "enum",
            control: "segments",
            labels: "all",
            options: () => [
              { value: "references", label: t("character.references.title"), icon: "bookmark" },
              { value: "actions", label: t("character.section.actions"), icon: "play-btn" },
            ],
            read: () => (s.read("mode") === "actions" ? "actions" : "references"),
            write: (_api, value) => {
              if (value === "references" || value === "actions") s.set("mode", value);
            },
          },
          { api: s.api, key: `${itemId}-preview-mode`, label: t("character.item.preview") }
        );
        return [
          NODES.card(
            "character-preview",
            "",
            [NODES.control(mode, { control: mode === "actions" ? "character.actionpreview" : "character.referencepreview", character: coerceCharacter(p.character), grow: true })],
            [],
            { port: { item: itemId, key: "character" }, bar: [NODES.control("view", { desc: view })] }
          ),
        ];
      },
    };
  },
};

// ---- what it does ------------------------------------------------------------------------------
const OWN = ["uid", "name", "references", "actions"];
export const actions = {
  // The character the editor holds, kept in the library: under a name (asked for when it has none), as the
  // same character, or -- as new -- as another.
  "character.save": {
    async run({ uid, name, references, actions: moves, asNew }, { api, prompt, status }) {
      const held = characterOf({ uid, name, references, actions: moves });
      let named = held.name.trim();
      if (!named) {
        named = String((await prompt("character.prompt.name", {}, { title: "character.action.save" })) || "").trim();
        if (!named) return {};
      }
      const draft = { ...held, name: named };
      const kept = asNew || !draft.uid ? newUid() : draft.uid;
      const existing = asNew ? null : findCharacter(api, kept);
      try {
        await api.store.save({ id: existing ? existing.id : null, type: TYPE, name: named, value: { ...draft, name: named, uid: kept } });
        status("character.status.saved", { name: named });
        return { uid: kept, name: named };
      } catch (error) {
        status("character.status.failed", { error: error.message || String(error) });
        return { name: named };
      }
    },
  },
  // Another character in its place -- loaded, or a new one. Changes nobody kept are asked about before they are
  // thrown away.
  "character.replace": {
    async run({ uid, name, references, actions: moves, value, title }, { api, confirm }) {
      const held = characterOf({ uid, name, references, actions: moves });
      if (isDirty(api, held).dirty && !isEmpty(held)) {
        const ok = await confirm("character.prompt.discard", {}, { title: title || "" });
        if (!ok) return {};
      }
      const c = coerceCharacter(value);
      return { uid: c.uid, name: c.name, references: c.references.map((one) => ({ ...one })), actions: c.actions.map((one) => ({ id: actionId(), ...one })) };
    },
  },
};

// The character the editor holds is read from, and written back to, its own properties: so it can be
// edited, carried and loaded where it is shown. Typing is not saving: a character every app refers to
// changes when it is saved.
export const derived = {
  editorCharacter: {
    read: (_api, item) => {
      const props = item ? item.props : {};
      return coerceCharacter({
        uid: props.uid,
        name: props.name,
        references: props.references,
        description: props.description,
        outfits: props.outfits,
        sheet: props.sheet,
        actions: characterActions(props.actions).map(({ id: _id, ...rest }) => rest),
      });
    },
    write: (_api, value, item) => {
      if (!item) return;
      const c = coerceCharacter(value);
      item.props.uid = c.uid;
      item.props.name = c.name;
      item.props.references = c.references.map((one) => ({ ...one }));
      item.props.actions = c.actions.map((one) => ({ id: actionId(), ...one }));
    },
  },
};
