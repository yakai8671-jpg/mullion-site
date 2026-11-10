/* The character editor's form: the name, the references and the actions, in the character card.
 *
 * What the editor holds are the character's fields as properties, so each can be edited, carried and loaded
 * where it is shown; the character itself (what the card carries, and what is saved) is read from them and
 * written back to them. Typing is not saving: a character every app refers to changes when it is saved.
 * Saving and replacing the character are the item's actions (`save`, `saveAsNew`, `replace`); the lists are
 * written straight to the arguments.
 */
import { coerceAction, coerceCharacter, coerceReference, findCharacter } from "./model.js";
import { coerceMedia } from "./media.js";

const TYPE = "character";
const MEDIA = "character.media";
const ACTION = "character.action";

let seq = 0;
export const actionId = () => `a${Date.now().toString(36)}${(seq++).toString(36)}`;

// The editor's actions: each with an id that stays with it when the list is reordered. The top one is their
// own -- what is shown when nothing else is asked.
export const coerceActions = (value) => {
  const seen = new Set();
  return (Array.isArray(value) ? value : [])
    .filter((one) => one && typeof one === "object")
    .map((one, index) => {
      let id = typeof one.id === "string" && one.id ? one.id : `a${index}`;
      while (seen.has(id)) id = actionId();
      seen.add(id);
      return { id, ...coerceAction(one) };
    });
};

// The character the properties hold.
export const characterOf = (props) =>
  coerceCharacter({
    uid: props.uid,
    name: props.name,
    references: props.references,
    description: props.description,
    outfits: props.outfits,
    sheet: props.sheet,
    actions: coerceActions(props.actions).map(({ id: _id, ...rest }) => rest),
  });

// Whether what is held was never kept, or differs from what was.
export const isDirty = (api, c) => {
  const saved = findCharacter(api, c.uid);
  return { saved, dirty: !saved || JSON.stringify(coerceCharacter(saved.value)) !== JSON.stringify(c) };
};
export const isEmpty = (c) => JSON.stringify({ ...c, uid: "" }) === JSON.stringify(coerceCharacter({}));

// The editor's screen: the character card, its tools in its header, and in it the name, the references and the
// actions. `P()` reads the properties as they are now (an event handler asks after the draw), and the item's
// actions by name; `SET` writes a property.
export function createEditorScreen(fw) {
  const { core, describe } = fw;
  const { NODES, t } = core;
  return {
    body(screen) {
      const P = () => ({
        character: screen.read("character"),
        name: screen.read("name"),
        save: (payload) => screen.run("save", payload),
        saveAsNew: (payload) => screen.run("saveAsNew", payload),
        replace: (payload) => screen.run("replace", payload),
      });
      // `moves` is the property `actions` (the name `actions` is the item's own).
      const SET = (key, value) => screen.set(key === "moves" ? "actions" : key, value);
      const api = screen.api;
      const itemId = screen.item.id;
      const c = coerceCharacter(P().character);
      const { saved } = isDirty(api, c);
      const empty = isEmpty(c);

      const presets = describe(
        {
          type: TYPE,
          control: "preset",
          inner: "none",
          read: () => P().character,
          write: (_api, value) => P().replace({ value, title: t("mu.action.presets", { type: t("character.vtype.character") }) }),
        },
        { api, key: `${itemId}-character-presets`, label: t("character.vtype.character") }
      );

      const characterPort = { item: itemId, key: "character" };
      const refsPort = { ...characterPort, path: ["references"] };
      const refsNow = () => coerceCharacter(P().character).references;
      const changeRef = (id, patch) => SET("references", refsNow().map((ref) => (ref.id === id ? { ...ref, ...patch } : ref)));
      const refs = c.references.map((ref, index) => {
        const read = () => refsNow().find((one) => one.id === ref.id) || ref;
        const port = { ...refsPort, path: ["references", ref.id] };
        const fields = NODES.props("reference-fields-" + ref.id, [
          describe(
            { type: "string", read: () => read().name, write: (_api, value) => changeRef(ref.id, { name: String(value ?? "") }) },
            { api, key: itemId + "-reference-name-" + ref.id, label: t("character.field.name") }
          ),
          describe(
            {
              type: "enum",
              control: "select",
              options: ["text", "image", "video"].map((value) => ({ value, label: t("character.references." + value) })),
              read: () => read().kind,
              write: (_api, value) => changeRef(ref.id, { kind: value, data: "" }),
            },
            { api, key: itemId + "-reference-kind-" + ref.id, label: t("character.references.kind") }
          ),
        ]);
        const data =
          ref.kind === "text"
            ? NODES.control("reference-data-" + ref.id, {
                desc: describe(
                  { type: "string", control: "texteditor", lines: 3, read: () => read().data, write: (_api, value) => changeRef(ref.id, { data: String(value ?? "") }) },
                  { api, key: itemId + "-reference-data-" + ref.id, label: t("character.references.text") }
                ),
              })
            : NODES.control("reference-data-" + ref.id, {
                desc: describe(
                  {
                    type: MEDIA,
                    control: "character.mediainput",
                    allowCharacter: false,
                    read: () => ({ kind: read().kind, media: read().data }),
                    write: (_api, value) => {
                      const media = coerceMedia(value);
                      changeRef(ref.id, { kind: media.media ? media.kind : read().kind, data: media.media });
                    },
                  },
                  { api, key: itemId + "-reference-data-" + ref.id, label: t("character.field.resource") }
                ),
              });
        return NODES.card("reference-" + ref.id, ref.name || t("character.references.itemN", { n: index + 1 }), [fields, data], [], {
          port,
          onDiscard: () => SET("references", refsNow().filter((one) => one.id !== ref.id)),
        });
      });
      const listRefs = NODES.listCard("references", refs, { title: t("character.references.title"), port: refsPort,
        add: {
          label: t("character.references.add"),
          run: () => SET("references", [...refsNow(), { id: actionId(), name: "", kind: "text", data: "" }]),
          accepts: ["character.reference", "text", "image", "video"],
          put: (value, kind) =>
            SET("references", [
              ...refsNow(),
              kind === "character.reference" ? { ...coerceReference(value), id: actionId() } : { id: actionId(), name: "", kind, data: String(value || "") },
            ]),
        } });

      const actionsNow = () => coerceActions(screen.read("actions"));
      const actions = actionsNow().map((action, index) => {
        const read = () => actionsNow().find((one) => one.id === action.id) || action;
        const write = (patch) => SET("moves", actionsNow().map((one) => (one.id === action.id ? { ...one, ...patch } : one)));
        const port = { item: itemId, key: "actions", path: [action.id] };
        return NODES.card(
          "action-" + action.id,
          action.name || t("character.value.actionN", { n: index + 1 }),
          [
            NODES.props("action-fields-" + action.id, [
              describe({ type: "string", read: () => read().name, write: (_api, value) => write({ name: String(value ?? "") }) }, { api, key: itemId + "-action-name-" + action.id, label: t("character.field.actionName") }),
            ]),
            NODES.control("action-media-" + action.id, {
              desc: describe(
                {
                  type: MEDIA,
                  control: "character.mediainput",
                  allowCharacter: false,
                  port: { ...port, path: [action.id, "media"] },
                  read: () => ({ kind: read().kind, media: read().media }),
                  write: (_api, value) => {
                    const media = coerceMedia(value);
                    write({ kind: media.kind, media: media.media });
                  },
                },
                { api, key: itemId + "-action-media-" + action.id, label: t("character.field.resource") }
              ),
            }),
          ],
          index
            ? [
                {
                  key: "default",
                  icon: "arrow-bar-up",
                  title: t("character.action.makeDefaultAction"),
                  run: () => {
                    const list = actionsNow();
                    SET("moves", [...list.filter((one) => one.id === action.id), ...list.filter((one) => one.id !== action.id)]);
                  },
                },
              ]
            : [],
          { port, onDiscard: () => SET("moves", actionsNow().filter((one) => one.id !== action.id)) }
        );
      });
      const listActions = NODES.listCard("actions", actions, { title: t("character.section.actions"), port: { item: itemId, key: "actions" },
        add: {
          label: t("character.action.addAction"),
          run: () => SET("moves", [...actionsNow(), { id: actionId(), ...coerceAction({}) }]),
          accepts: [ACTION, "image", "video"],
          put: (value, kind) => SET("moves", [...actionsNow(), { id: actionId(), ...coerceAction(kind === ACTION ? value : { kind, media: String(value || "") }) }]),
        } });

      const tool = (key, icon, label, run) => ({ key, icon, title: t(label), run });
      return [
        NODES.card(
          "editor",
          "",
          [
            NODES.props("name", [
              describe({ type: "string", read: () => P().name, write: (_api, value) => SET("name", value) }, { api, key: itemId + "-name", label: t("character.field.name") }),
            ]),
            listRefs,
            listActions,
          ],
          [
            tool("save", "presetSave", "character.action.save", () => P().save()),
            ...(saved ? [tool("saveAsNew", "plus-lg", "character.action.saveAsNew", () => P().saveAsNew())] : []),
            tool("presets", "preset", "character.control.presets", (button) => core.openValuePicker(presets, button)),
            ...(empty ? [] : [tool("new", "file-earmark", "character.action.new", () => P().replace({ value: coerceCharacter({}), title: t("character.action.new") }))]),
          ],
          { port: characterPort }
        ),
      ];
    },
  };
}
