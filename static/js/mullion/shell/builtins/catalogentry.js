// Registry records are addressed by their stable registered name.
import { registerValueType } from "./deps.js";

// What this file registers, once the modules it uses are handed in (index.js).
export function install() {
  registerValueType("catalog.entry", {
    label: "mu.field.id",
    identity: "name",
    port: false,
    storable: false,
    presetNew: false,
    defaultControl: "summary",
    defaultValue: () => ({ name: "" }),
    coerce: (value) => (value && typeof value === "object" && !Array.isArray(value) ? value : { name: "" }),
    format: (value) => value?.name || "—",
  });
}
