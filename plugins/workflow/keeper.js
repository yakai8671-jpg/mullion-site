/* The keeper -- a picture a run made, kept as a preset.
 *
 * A preview's own window for keeping what it shows: the picture, a name, and what to keep it as --
 * a plain picture, or what the app says its output is (a 360 degree panorama app's is a panorama).
 * The preview opens it on a picture; saving closes it again.
 *
 * What an app's output is, it declares on its type:
 *   output: {type, value?(api, {app, results, src, name}) -> value}
 * `value` makes the kept value from the run's results; without it the picture is kept, as a
 * picture of that type.
 */

import { KEEP_IMAGE_CHARS, asDataUrl, fitImage, resultAddress } from "./runner.js";

let CORE = null;
let TYPES = null;
let VALUE_TYPES = null;
export function initialize({ core, types, valueTypes }) {
  CORE = core;
  TYPES = types;
  VALUE_TYPES = valueTypes;
}

const isRunApp = (type) => Boolean((TYPES[type] || {}).runApp);
const valueIn = (entry, key) => entry && (entry.properties.find((one) => one.key === key) || {}).value;

// The run app the keeper is linked to, what its output is, and what the picture can be kept as: the
// app's own output type first, then a plain picture -- which any picture is, whatever else it is.
function look(api, appId, as) {
  const linked = appId && api && api.items ? api.items.get(appId) : null;
  const app = linked && isRunApp(linked.type) ? linked : null;
  const output = (app && (TYPES[app.type] || {}).output) || null;
  const results = (app && valueIn(app, "results")) || [];
  const kinds = [...new Set([output && output.type, "image"].filter((one) => one && VALUE_TYPES[one]))];
  const chosen = kinds.includes(as) ? as : kinds[0];
  return { app, output, results, kinds, chosen };
}

// Back to the preview it was opened from; a window of its own (an older layout) closes.
const leave = (api) => {
  if (!api.window.back()) api.window.close();
};

export const actions = {
  "workflow.keeper.save": {
    async run({ src, name, as, app }, { api, status }) {
      const named = String(name || "").trim();
      if (!named) {
        status("workflow.status.nameFirst");
        return {};
      }
      const { app: runner, output, results, chosen } = look(api, app, as);
      try {
        let value;
        if (output && output.type === chosen && output.value) {
          value = await output.value(api, { app: runner, results, src, name: named });
        } else {
          // As big as the type takes: a panorama is kept whole, where a plain picture is held to the
          // picture box's size.
          const bytes = ((VALUE_TYPES[chosen] || {}).defaults || {}).maxBytes || 0;
          value = await fitImage(await asDataUrl(src), Math.max(KEEP_IMAGE_CHARS, Math.floor((bytes * 4) / 3)));
          if (!value) throw new Error(CORE.t("workflow.status.imageTooBig"));
        }
        await api.store.save({ type: chosen, name: named, value });
        status("workflow.status.kept", { name: named });
        leave(api);
        return { src: "" };
      } catch (error) {
        status("workflow.status.failed", { error: error.message || String(error) });
        return {};
      }
    },
  },
  "workflow.keeper.cancel": {
    async run(_inputs, { api }) {
      leave(api);
      return { src: "" };
    },
  },
};

// The screen of the keeper: what is drawn is the picture, the name and what to keep it as, or -- with nothing
// to keep -- a line that says so.
export const screens = {
  "workflow.keeper": (api) => {
    const { NODES, t } = api.core;
    const { describe } = api;
    return {
      body(screen) {
        const p = screen.props;
        const src = String(p.src || "");
        if (!src) return [NODES.section("empty", "", [], { empty: t("workflow.value.nothingToKeep") })];
        const { output, results, kinds, chosen } = look(screen.api, p.app, p.as);
        const typeLabel = (type) => t(VALUE_TYPES[type].label || type);
        const itemId = screen.item.id;
        const as = describe(
          {
            type: "enum",
            options: kinds.map((value) => ({ value, label: typeLabel(value) })),
            // What is kept when it is kept whole, said by the choice it is about.
            ...(chosen === (output && output.type) && output.note ? { hint: output.note } : {}),
            read: () => chosen,
            write: (_api, value) => screen.set("as", value),
          },
          { api: screen.api, key: `${itemId}-as-${kinds.join(",")}`, label: t("workflow.prop.keepAs") }
        );
        const name = describe(
          { type: "string", read: () => String(p.name || ""), write: (_api, value) => screen.set("name", value) },
          { api: screen.api, key: `${itemId}-name`, label: t("workflow.prop.keepName") }
        );
        // Kept whole, what is kept is the app's output, not the picture the keeper was opened on: its
        // own picture is shown (the first the run made -- a depth app's panorama, not its depth map).
        const whole = Boolean(output && output.type === chosen && output.value);
        const made = results.find((one) => one.kind === "image" && one.ref);
        const shown = whole && made ? resultAddress(made) : src;
        return [
          NODES.section("picture", "", [NODES.control("picture", { control: "imagestage", images: [shown], showSize: false })]),
          NODES.props("fields", [name, as]),
          NODES.actions("actions", [
            { key: "save", label: t("workflow.action.keep"), run: () => screen.run("save") },
            { key: "cancel", label: t("workflow.action.cancelKeep"), run: () => screen.run("cancel") },
          ]),
        ];
      },
    };
  },
};
