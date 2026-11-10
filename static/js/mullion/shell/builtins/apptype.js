/* The value type `app` -- an app as a value (see "apps" in core).
 *
 * {type, name, icon, accent, autoSave, layout, props}, plus the app's `id`
 * when the value is one that exists: carried by a grip from the app list,
 * that id is how the app editor knows which app it was handed rather than
 * a copy of one. A person's own apps are saved values of this type.
 */

import { registerValueType } from "./deps.js";
import { coerceApp, t } from "./deps.js";

// An icon by its Bootstrap Icons name, chosen in the icon picker.

// What this file registers, once the modules it uses are handed in (index.js).
export function install() {
  registerValueType("icon", {
    base: "string",
    label: "mu.vtype.icon",
    icon: "emoji-smile",
    defaultControl: "iconcard",
  });
  registerValueType("app", {
    label: "mu.vtype.app",
    icon: "app-indicator",
    port: "app",
    sample: { default: {} },
    defaultControl: "summary",
    defaultValue: () => coerceApp({}),
    coerce: (value) => ({
      ...coerceApp(value),
      ...(value && typeof value.id === "string" && value.id ? { id: value.id } : {}),
    }),
    format: (value) => (value && value.name) || t("mu.vtype.app"),
  });
}
