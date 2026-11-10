/* Preset maker -- make a new preset, and edit it before it is kept.
 *
 * The chooser's other half. Taking a preset and keeping one are the same
 * screen's business -- the library, under one property's type -- so the way
 * to keep one starts there too: the first tile of every chooser opens this,
 * one step along the same window. That is why the buttons that used to sit
 * beside each loader, saving what the property held, are gone: the loader
 * already leads here. Only what has no loader -- an output, a result card --
 * still keeps its own button.
 *
 * What is kept is a draft, edited here with a control that can edit the
 * type. Opened from a property, the draft starts as that property is now,
 * read once through the chooser's grant (see capture()); opened from Home's
 * preset list, it starts from the type's default or from the preset that
 * was picked. Either way the property itself is never touched: this screen
 * makes a preset, it does not load one.
 *
 * The editor can itself open choosers -- a prompt list's cards open the
 * part chooser -- and those have their own first tile, so a part can be
 * made on the way to making the list that uses it.
 */

import { CONTROLS, ICONS, derivesFrom, describe, presetSpecOf, presetTypeDef, presetTypeFor, registerItemType, valueTypeFor } from "./deps.js";
import { NODES, closeScreen, refreshAll, t } from "./deps.js";
import { blankOf, previewCard, shapeOf } from "./presetview.js";

// The drafts. Not a property: a draft can be of any type, and a screen that
// lives only while it is looked at has nothing worth saving with the layout.
const drafts = new Map();

// Values waiting to be the start of a draft, by a token the screen that is
// about to open is told (`from: "seed:<token>"`): what was carried to the
// generic preset creator, for the maker it opens to begin with.
const seeds = new Map();
let seedCount = 0;
export function seedDraft(value) {
  const token = `s${Date.now().toString(36)}${(seedCount++).toString(36)}`;
  seeds.set(token, JSON.parse(JSON.stringify(value === undefined ? null : value)));
  return token;
}
// A draft kept for an item that is not a maker but shows one's body (the
// generic preset creator): set when something is put in it, dropped when it
// is saved or let go of.
export const setDraft = (itemId, value) => drafts.set(itemId, JSON.parse(JSON.stringify(value === undefined ? null : value)));
export const hasDraft = (itemId) => drafts.has(itemId);
export const dropDraft = (itemId) => drafts.delete(itemId);
const isSeed = (from) => typeof from === "string" && from.startsWith("seed:");

// Which control edits the draft, and with what. A type may say so itself
// with `presetEditor` -- a prompt list is edited as slot cards, not as the
// count its property row shows. Otherwise the property's own choice, looking
// through the preset wrapper to what it wraps; then, for a list that knows
// its elements, a row per element; then whatever the type draws by default.
function editorFor(desc, target, itemId) {
  const def = valueTypeFor(desc.params);
  if (def.presetEditor) return def.presetEditor(desc, { itemId, refresh: refreshAll }) || {};
  const spec = target ? target.spec : {};
  if (spec.control && spec.control !== "preset") return { control: spec.control };
  if (spec.control === "preset" && spec.inner && spec.inner !== "none") return { control: spec.inner };
  if (def.defaultControl === "listcount" && (desc.params.each || (def.defaults || {}).each)) return { control: "rows" };
  return {};
}

// What a value of a type is carried as when another item sets it (see
// appSurface): the kinds a chain converts into.
function kindOfType(type, spec = {}) {
  const def = valueTypeFor({ ...spec, ...(presetSpecOf(type) || { type }) }) || {};
  // Match the scratch board's exact kind where the type declares one: a
  // type of a string carried as something else (an image) would otherwise be
  // shown as the text it is.
  if (def.stash) return def.stash;
  if (def.port) return def.port;
  if (derivesFrom(type, "boolean")) return "boolean";
  if (derivesFrom(type, "number")) return "number";
  if (derivesFrom(type, "image")) return "image";
  if (derivesFrom(type, "string")) return "text";
  return "value";
}

export function makerBody(api, item, ctx, options = {}) {
    const target = api.grant.target();
    const type = target ? target.type : item.props.type;
    const savedType = target ? presetTypeFor(target.spec) : type;
    const closeProperty = options.propertyOnDiscard || (() => closeScreen(ctx.windowId));
    const propertySink =
      options.propertySink ||
      (type && presetTypeDef(type)
        ? {
            accepts: [kindOfType(type, target && target.spec)],
            label: t("mu.action.presetFromCarried"),
            put: (value, kind) => {
              if (kind !== kindOfType(type, target && target.spec)) return;
              setDraft(item.id, value);
              refreshAll();
            },
          }
        : null);
    const nameProperty = ctx.property("name");
    const nameDesc = describe(
      {
        type: "string",
        read: () => nameProperty.get(),
        write: (_api, value) => nameProperty.set(String(value ?? "")),
      },
      { api, key: `preset-name-${item.id}`, label: t("mu.prop.presetName") }
    );
    if (!type || !presetTypeDef(type)) {
      return [
        NODES.card(
          "preview",
          t("mu.item.presetcreate"),
          [
            NODES.props("name", [nameDesc]),
            NODES.card("property", "", [], [], {
              empty: t("mu.value.presetDrop"),
            }),
          ],
          [
            {
              key: "save",
              icon: ICONS.presetSave,
              label: t("mu.action.presetSave"),
              disabled: true,
              primary: true,
              run: () => {},
            },
          ],
          { icon: ICONS.presetSave, sink: propertySink, onDiscard: options.onDiscard || null }
        ),
      ];
    }
    const shape = shapeOf(type, target);
    const def = valueTypeFor(shape);
    // What it is kept as names it: a list kept as a preset has the name its element gives it.
    const named = presetTypeDef(savedType) || def;
    const typeLabel = named.label ? t(named.label) : type;
    const draft = () => (drafts.has(item.id) ? drafts.get(item.id) : blankOf(shape));
    if (draft() === null) {
      if (!propertySink) {
        return [NODES.section("none", "", [], { empty: t("mu.status.presetNothing") })];
      }
      return [
        NODES.card(
          "preview",
          typeLabel,
          [
            ...(typeof def.presetName === "function" ? [] : [NODES.props("name", [nameDesc])]),
            NODES.card("property", options.propertyLabel || typeLabel, [], [], {
              sink: propertySink,
              empty: t("mu.value.presetDrop"),
              onDiscard: closeProperty,
            }),
          ],
          [
            {
              key: "save",
              icon: ICONS.presetSave,
              label: t("mu.action.presetSave"),
              disabled: true,
              primary: true,
              run: () => {},
            },
          ],
          { onDiscard: options.onDiscard || null }
        ),
      ];
    }

    // The draft as a property of its own, keyed by this screen so the
    // editor is never reused for another one. Read when asked, not closed
    // over -- an editor opened from here (a chooser over one slot) writes
    // back through it long after this pass.
    const desc = describe(
      {
        ...shape,
        read: () => draft(),
        // Redrawn here rather than by whoever wrote: a control that edits
        // through its own methods -- a part's tags -- writes without going
        // through the window's onChange, and a draft has no store to redraw
        // after it the way a saved value does.
        write: (_api, value) => {
          drafts.set(item.id, value);
          refreshAll();
        },
      },
      {
        api,
        key: `draft-${item.id}`,
        label: target
          ? target.label
          : options.propertyLabel || (presetTypeDef(type).label ? t(presetTypeDef(type).label) : type),
      }
    );
    let editor;
    const propertyControl = options.propertyControl || "scratch.card";
    if (CONTROLS[propertyControl]) {
      // Preset input uses the same card as the scratch board. A port may
      // carry an image address, which must be drawn as a picture.
      editor = [
        NODES.control("value", {
          desc,
          control: propertyControl,
          kind: options.propertyKind || kindOfType(type, target && target.spec),
          sink: propertySink,
          onDiscard: closeProperty,
        }),
      ];
    } else {
      // A type may lay its value out as several rows of its own -- a prompt
      // part as its name, its category and its tags -- rather than one control.
      const { control, fields, ...params } = editorFor(desc, target, item.id);
      const editable = control ? CONTROLS[control] : desc.control;
      // A field marked `wide` -- a list drawn as cards -- gets the whole
      // width under a heading of its own rather than half of a property row.
      const narrow = (fields || []).filter((one) => !one.wide);
      const wide = (fields || []).filter((one) => one.wide);
      editor = fields
        ? [
            ...(narrow.length ? [NODES.props("value", narrow)] : []),
            ...wide.map((one) =>
              NODES.section(`wide-${one.key}`, one.label, [NODES.control(`wide-${one.key}`, { desc: one })])
            ),
          ]
        : [
            editable
              ? NODES.control("value", { desc, control, ...params })
              : NODES.props("value", [
                  describe(
                    { type: "string", readonly: true, read: () => desc.property.format() },
                    { key: `value-${item.id}`, label: desc.label || t("mu.field.value") }
                  ),
                ]),
          ];
    }

    // A value that names itself -- a prompt part has its own name -- is
    // kept under that name, so this screen does not ask for a second one.
    const namesItself = typeof def.presetName === "function";

    // A preset of this type already called this is overwritten rather than
    // joined by a second one of the same name -- and the button says so
    // before it is pressed, not after.
    const nameNow = () => String((namesItself ? def.presetName(draft()) : item.props.name) || "").trim();
    const sameName = (name) => (name ? api.store.saved(savedType).find((one) => one.name === name) || null : null);
    const existing = sameName(nameNow());

    const save = async () => {
      const name = nameNow();
      if (!name) return ctx.status(t("mu.status.presetNoName"));
      const value = draft();
      if (value === null || value === undefined) return ctx.status(t("mu.status.presetNothing"));
      const over = sameName(name);
      try {
        await api.store.save({ id: over ? over.id : null, type: savedType, name, value });
        ctx.status(t(over ? "mu.status.presetOverwritten" : "mu.status.presetSaved", { name }));
        // Back to the chooser, where the new one now is -- or wherever the one
        // showing this was told to go.
        (options.done || (() => closeScreen(ctx.windowId)))();
      } catch (error) {
        ctx.status(t("mu.status.presetFailed", { error: error.message || error }));
      }
    };

    // A preset being edited can also be renamed and taken out of the library
    // here. Neither touches what was copied from it: a saved value is only
    // ever copied.
    const saved = item.props.from ? api.store.value(item.props.from) : null;
    const rename = async () => {
      const name = nameNow();
      if (!name) return ctx.status(t("mu.status.presetNoName"));
      if (name === saved.name) return;
      const taken = sameName(name);
      if (taken && taken.id !== saved.id) return ctx.status(t("mu.status.presetNameTaken", { name }));
      try {
        await api.store.save({ id: saved.id, type: saved.type, name, value: saved.value });
        ctx.status(t("mu.status.presetRenamed", { name }));
        refreshAll();
      } catch (error) {
        ctx.status(t("mu.status.presetFailed", { error: error.message || error }));
      }
    };
    const remove = async () => {
      const ok = await ctx.confirm(t("mu.confirm.presetDelete", { name: saved.name }), {
        title: saved.name,
        okText: t("mu.action.presetDelete"),
        danger: true,
      });
      if (!ok) return;
      try {
        await api.store.remove(saved.id);
        ctx.status(t("mu.status.presetDeleted", { name: saved.name }));
        (options.done || (() => closeScreen(ctx.windowId)))();
      } catch (error) {
        ctx.status(t("mu.status.presetFailed", { error: error.message || error }));
      }
    };

    // The preset is one card: its name is a property row, followed by the
    // property's own card control without an extra wrapper around it.
    const content = [
      ...(namesItself
        ? []
        : [NODES.props("name", [nameDesc])]),
      ...(options.editable === false
        ? []
        : editor),
    ];
    const tools = [
      ...(options.tools || []),
      ...(saved && !namesItself
        ? [{ key: "rename", icon: "pencil", title: t("mu.action.presetRename"), run: rename }]
        : []),
      ...(saved && options.editable !== false
        ? [{ key: "delete", icon: "trash", title: t("mu.action.presetDelete"), run: remove }]
        : []),
    ];
    const preview = previewCard({
      key: "preview",
      title: typeLabel,
      type,
      shape,
      value: draft(),
      content,
      primary: {
        key: "save",
        icon: ICONS.presetSave,
        label: t("mu.action.presetSave"),
        title: t(existing ? "mu.action.saveOverTitle" : "mu.action.savePresetTitle", { name: nameNow() }),
        run: save,
      },
      tools,
      onDiscard: options.onDiscard || null,
      showValue: options.showValue === undefined ? options.editable === false : options.showValue,
    });
    return [
      preview,
    ];
  }

export function makerSurface(api, item, ctx, options = {}) {
    const target = api.grant.target();
    const type = target ? target.type : item.props.type;
    const savedType = target ? presetTypeFor(target.spec) : type;
    const def = valueTypeFor(target ? target.spec : presetSpecOf(type) || { type });
    if (!def) return { exclusive: true };
    const shape = shapeOf(type, target);
    const draft = () => (drafts.has(item.id) ? drafts.get(item.id) : blankOf(shape));
    const desc = describe(
      {
        ...shape,
        read: () => draft(),
        write: (_api, value) => {
          drafts.set(item.id, value);
          refreshAll();
        },
      },
      { api, key: `draft-${item.id}`, label: target ? target.label : t("mu.field.value") }
    );
    const namesItself = typeof def.presetName === "function";
    const bare = (spec) => {
      const { read, write, placed, label, ...rest } = spec || {};
      return rest;
    };
    const inputs = [];
    if (!namesItself) {
      inputs.push({ key: "name", label: t("mu.prop.presetName"), kind: "text", spec: { type: "string" }, set: (value) => ctx.property("name").set(String(value ?? "")) });
    }
    const { fields } = typeof def.presetEditor === "function" ? def.presetEditor(desc, { itemId: item.id, refresh: refreshAll }) || {} : {};
    if (fields && fields.length) {
      for (const one of fields) {
        inputs.push({
          key: `field:${one.key}`,
          label: one.label,
          kind: kindOfType(one.type),
          spec: bare(one.params),
          wide: Boolean(one.wide),
          node: options.editable === false ? "preview" : (domKey) => domKey === one.key || domKey === `wide-${one.key}`,
          set: (value) => one.property.set(value),
        });
      }
    } else {
      const kind = kindOfType(type, target && target.spec);
      inputs.push({
        key: "value",
        label: t("mu.field.value"),
        kind,
        spec: bare(shape),
        wide: kind === "image" || kind === "imagelist",
        node: options.editable === false ? "preview" : undefined,
        set: (value) => desc.property.set(value),
      });
    }
    return {
      exclusive: true,
      buttons: [
        {
          key: "save",
          label: t("mu.action.presetSave"),
          primary: true,
          // The preview card's own button.
          node: "preview",
          tool: "save",
          run: async () => {
            const name = String((namesItself ? def.presetName(draft()) : item.props.name) || "").trim();
            if (!name) throw new Error(t("mu.status.presetNoName"));
            const value = draft();
            if (value === null || value === undefined) throw new Error(t("mu.status.presetNothing"));
            const over = api.store.saved(savedType).find((one) => one.name === name) || null;
            await api.store.save({ id: over ? over.id : null, type: savedType, name, value });
          },
        },
      ],
      inputs,
      outputs: [],
    };
  }

// What this file registers, once the modules it uses are handed in (index.js).
export function install() {
  registerItemType("presetmaker", {
    label: "mu.item.presetmaker",
    // Only ever opened from a chooser.
    icon: ICONS.presetSave,
    // ollama:run for the editors that can fill a preset in by asking a
    // model -- a prompt part's tags. The editor says what to ask; this
    // screen only lends it the way to ask.
    permissions: ["store:read", "store:write", "grant:write", "ollama:run"],
    properties: {
      // What the new preset will be called. Placed, above the button that
      // uses it.
      name: { label: "mu.prop.presetName", type: "string", default: "", placed: true },
      // The type to make a preset of, and the saved preset to start from, if
      // any. Set by whoever opened this.
      type: { label: "mu.field.type", type: "string", default: "", placed: true },
      from: { label: "mu.prop.presetFrom", type: "string", default: "", placed: true },
    },

    facts(api, item) {
      const target = api.grant.target();
      return target
        ? [
            { label: t("mu.field.deliverTo"), value: `${target.itemId}.${target.key}` },
            { label: t("mu.field.type"), value: target.type },
          ]
        : [{ label: t("mu.field.type"), value: item.props.type || "-" }];
    },

    // Where the draft starts, and a name to go with it: what the value calls
    // itself, or -- starting from a saved preset -- that preset's name,
    // marked as another one.
    mount(ctx) {
      const target = ctx.api.grant.target();
      const type = target ? target.type : ctx.item.props.type;
      if (!presetTypeDef(type)) return;
      const seeded = isSeed(ctx.item.props.from) ? ctx.item.props.from.slice(5) : "";
      const from = ctx.item.props.from && !seeded ? ctx.api.store.value(ctx.item.props.from) : null;
      if (!ctx.item.props.name) {
        // From a saved preset the name stays: saving is then an edit of that
        // preset (the button says it overwrites), and a copy is a new name.
        const name = target ? target.suggestedName : from ? from.name : "";
        if (name) ctx.property("name").set(name);
      }
      if (drafts.has(ctx.item.id)) return;
      if (seeded && seeds.has(seeded)) {
        drafts.set(ctx.item.id, seeds.get(seeded));
        seeds.delete(seeded);
        return;
      }
      if (target) {
        // What the property would be kept as. One whose preset is a snapshot
        // of something else -- run settings with no editor behind them -- and
        // says null has nothing here to edit either; any other empty one
        // starts from its type's default.
        const captured = ctx.api.grant.capture();
        drafts.set(ctx.item.id, captured ?? (target.derivedPreset ? null : blankOf(shapeOf(type, target))));
      } else {
        drafts.set(
          ctx.item.id,
          from && from.type === type ? JSON.parse(JSON.stringify(from.value)) : blankOf(shapeOf(type, null))
        );
      }
    },

    destroy(item) {
      drafts.delete(item.id);
    },

    // What another item -- a chain -- can do with this one: set the name and
    // the value (each of its rows, for a type that lays its value out in
    // several), and press save. Saving is the same act as the screen's own
    // button, minus going back: whoever pressed it is not looking here.
    appSurface: (api, item, ctx) => makerSurface(api, item, ctx),

    body: (api, item, ctx) => makerBody(api, item, ctx),
  });
}
