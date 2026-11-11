/* Preset create -- make a preset of whatever is carried to its property
 * control.
 *
 * The preset maker needs to be told what type of value it is making a
 * preset of, and gets that from the chooser a property opened, or from the
 * list of types on Home. This is the way in with nothing in hand but the
 * value: the grip of any card -- a prompt, a picture, tags, a size -- is
 * carried here, and what it is carried as (its kind) says which type to keep
 * it as. The preset maker's own screen is then this window's body, in place
 * -- the preview, the name, the value's rows, and the button that saves -- so
 * nothing is opened and there is nowhere to go back to: saving, or letting go
 * of it, leaves the place to drop something on again.
 *
 * It is also an app that can be driven: a chain presses its save button and
 * sets its name and value like those of any other app.
 */

import { derivesFrom, ICONS, presetTypeDef, presetTypes, registerApp, registerItemType, fetch } from "./deps.js";
import { refreshAll, t } from "./deps.js";
import { dropDraft, makerBody, makerSurface, setDraft } from "./presetmaker.js";
import { blankOf, shapeOf } from "./presetview.js";

// Which type keeps a kind: the one that stands for it on its own (`stash`),
// else one that carries it (`port`), then primitive types with an inferred
// kind. Types a preset cannot be made of are not offered.
const storable = () => presetTypes().filter(([, def]) => def.storable !== false && def.presetNew !== false);

function typeOfKind(kind, sourceType = "") {
  const types = storable();
  const source = types.find(([name]) => name === sourceType && kindOfType(name) === kind);
  if (source) return source[0];
  const found =
    types.find(([, def]) => def.stash === kind) ||
    types.find(([, def]) => def.port === kind) ||
    types.find(([name]) => kindOfType(name) === kind);
  return found ? found[0] : "";
}

// Give the preview and chain inputs the same kind the scratch board uses for
// a type.
function kindOfType(type) {
  const def = presetTypeDef(type) || {};
  if (def.stash) return def.stash;
  if (def.port) return def.port;
  if (derivesFrom(type, "boolean")) return "boolean";
  if (derivesFrom(type, "number")) return "number";
  if (derivesFrom(type, "image")) return "image";
  if (derivesFrom(type, "string")) return "text";
  return "value";
}

// Every kind some type can keep, including primitive outputs such as numbers
// and booleans that have no special stash or port declaration.
const keptKinds = () => [
  ...new Set(
    storable()
      .flatMap(([type, def]) => [def.stash, def.port, kindOfType(type)])
      .filter((one) => typeof one === "string" && one && one !== "value")
  ),
];

// A picture that came as an address on the ComfyUI server is not one a
// preset can keep: fetched, and kept as the picture.
const isTransient = (value) => typeof value === "string" && /^\/api\/comfy\/view\?/.test(value);
async function asDataUrl(src) {
  const blob = await (await fetch(src)).blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

async function setDraftForKind(item, ctx, kind, value) {
  const currentType = presetTypeDef(item.props.type) && kindOfType(item.props.type) === kind ? item.props.type : "";
  const type = currentType || typeOfKind(kind);
  if (!type) throw new Error(t("mu.status.presetNoType", { kind }));
  let kept = value;
  if (kind === "image" && (presetTypeDef(type) || {}).stash === "image" && isTransient(value)) kept = await asDataUrl(value);
  setDraft(item.id, value === undefined ? blankOf(shapeOf(type, null)) : kept);
  ctx.set("type", type);
  ctx.set("displayKind", kind);
}

// What this file registers, once the modules it uses are handed in (index.js).
export function install() {
  registerApp("presetcreate", { home: "mullion", homeOrder: 70 });
  registerItemType("presetcreate", {
    label: "mu.item.presetcreate",
    standalone: true,
    icon: ICONS.presetSave,
    // The maker's: the library to keep it in, and the models some editors ask.
    permissions: ["store:read", "store:write", "grant:write", "ollama:run"],
    properties: {
      // What it is making a preset of, empty while it waits to be given something.
      type: { label: "mu.field.type", type: "string", default: "", placed: true },
      // The carried kind determines how the scratch board's card displays this
      // value (for example, an image address is still shown as an image).
      displayKind: { label: "mu.field.type", type: "string", default: "", placed: true },
      name: { label: "mu.prop.presetName", type: "string", default: "", placed: true },
      from: { label: "mu.prop.presetFrom", type: "string", default: "", placed: true },
    },

    // A chain can target the empty property card with an input matching the
    // output kind it will link in. The selected input establishes the type.
    appSurface(api, item, ctx) {
      const type = presetTypeDef(item.props.type) ? item.props.type : "";
      const typeInput = {
        key: "type",
        hidden: true,
        label: t("mu.field.type"),
        kind: "text",
        spec: { type: "enum", options: storable().map(([name, def]) => ({ value: name, label: def.label ? t(def.label) : name })) },
        node: type ? "value" : "property",
        set: (value) => {
          const next = String(value || "");
          if (!presetTypeDef(next) || next === item.props.type) return;
          setDraft(item.id, blankOf(shapeOf(next, null)));
          ctx.set("type", next);
          ctx.set("displayKind", kindOfType(next));
        },
      };
      const nameInput = {
        key: "name",
        label: t("mu.prop.presetName"),
        kind: "text",
        spec: { type: "string" },
        node: "name",
        set: (value) => ctx.property("name").set(String(value ?? "")),
      };
      const save = async () => {
        if (!presetTypeDef(item.props.type)) throw new Error(t("mu.status.presetNothing"));
        const surface = makerSurface(api, item, ctx, { editable: false });
        const button = surface.buttons.find((one) => one.key === "save");
        if (!button) throw new Error(t("mu.status.presetNothing"));
        return button.run();
      };
      const emptySave = {
        key: "save",
        label: t("mu.action.presetSave"),
        primary: true,
        disabled: !presetTypeDef(item.props.type),
        node: "preview",
        tool: "save",
        run: save,
      };
      const surface = type ? makerSurface(api, item, ctx, { editable: false }) : null;
      const kinds = type ? [kindOfType(type)] : keptKinds();
      const propertyInputs = [...new Set(kinds)].map((kind) => {
        const valueType = type && kindOfType(type) === kind ? type : typeOfKind(kind);
        const def = presetTypeDef(valueType) || {};
        if (!valueType) return null;
        return {
          key: `property:${kind}`,
          hidden: true,
          label: def.label ? t(def.label) : valueType,
          kind,
          spec: shapeOf(valueType, null),
          wide: kind === "image" || kind === "imagelist",
          node: type ? "value" : "property",
          set: (value) => setDraftForKind(item, ctx, kind, value),
        };
      }).filter(Boolean);
      const currentInputs = surface ? surface.inputs || [] : [];
      const propertyInput = {
        key: "property",
        label: t("mu.prop.presetInput"),
        kind: "*",
        defaultKind: type ? kindOfType(type) : "",
        spec: { ...(type ? shapeOf(type, null) : { type: "string" }), control: "scratch.card" },
        wide: true,
        node: type ? "value" : "property",
        set: (value, kind) => setDraftForKind(item, ctx, kind && kind !== "*" ? kind : type ? kindOfType(type) : "text", value),
      };
      const needsName =
        !currentInputs.some((one) => one.key === "name") &&
        (!type || typeof (presetTypeDef(type) || {}).presetName !== "function");
      return {
        ...(surface || { exclusive: true }),
        buttons: surface ? surface.buttons : [emptySave],
        inputs: [...currentInputs.map((one) => one.key === "name" ? one : { ...one, hidden: true }), typeInput, ...(needsName ? [nameInput] : []), propertyInput, ...propertyInputs],
        outputs: surface ? surface.outputs : [],
      };
    },

    body(api, item, ctx) {
      const start = (type, value, kind = kindOfType(type)) => {
        setDraft(item.id, value === undefined ? blankOf(shapeOf(type, null)) : value);
        ctx.set("type", type);
        ctx.set("displayKind", kind);
      };
      const clearProperty = () => {
        dropDraft(item.id);
        ctx.set("type", "");
        ctx.set("displayKind", "");
      };
      const reset = () => {
        clearProperty();
        ctx.set("name", "");
      };
      // What is carried here -- to the place to drop, or onto the card that is
      // already being filled in, which it then replaces -- becomes the value.
      const take = async (value, kind, sourceType) => {
        const type = typeOfKind(kind, sourceType);
        if (!type) return ctx.status(t("mu.status.presetNoType", { kind }));
        let kept = value;
        try {
          if (kind === "image" && isTransient(value)) kept = await asDataUrl(value);
        } catch (error) {
          return ctx.status(t("mu.status.presetFailed", { error: error.message || error }));
        }
        if (item.props.type && type !== item.props.type) ctx.set("name", "");
        start(type, kept, kind);
        refreshAll();
      };
      const propertySink = {
        accepts: keptKinds(),
        label: t("mu.action.presetFromCarried"),
        put: (value, kind, sourceType) => take(value, kind, sourceType),
      };

      // The property control is also the drop target. Its type follows the
      // property carried to it, and the value can be adjusted before saving.
      return makerBody(api, item, ctx, {
        done: reset,
        propertySink,
        propertyControl: "scratch.card",
        propertyKind: item.props.displayKind || kindOfType(item.props.type),
        propertyOnDiscard: clearProperty,
        editable: true,
      });
    },
  });
}
