import { bindSpec } from "./registry.js";

function writeJSON(value) {
  return JSON.stringify(value, (_key, one) => {
    if (["undefined", "function", "symbol"].includes(typeof one) || (typeof one === "number" && !Number.isFinite(one))) {
      throw new TypeError("expected a JSON value");
    }
    return one;
  }, 2);
}

// Unlike port conversions, an adapter describes both directions of an edit.
// It belongs to the placement, while the item's property stays in its own type.
export const VALUE_ADAPTERS = new Map([
  ["json", Object.freeze({
    from: "string",
    to: "data",
    read: (text) => text.trim() ? JSON.parse(text) : {},
    write: writeJSON,
  })],
]);

export function adaptDescriptor(desc, adapter, report) {
  const source = desc.property;
  const readonly = desc.readonly || Boolean(source.params.read && !source.params.write);
  const property = bindSpec({
    type: adapter.to,
    readonly,
    read: () => adapter.read(source.get()),
    write: (_api, value) => {
      if (readonly) return;
      let encoded;
      try {
        // A control can still hold its last descriptor while a source edit
        // waits for redraw. It cannot replace text that no longer parses.
        adapter.read(source.get());
        encoded = adapter.write(value);
      } catch (error) {
        report(error.message || String(error));
        return;
      }
      source.set(encoded);
    },
  }, { item: source.item, key: source.key, api: source.api });
  try {
    return { ...desc, type: adapter.to, params: { ...desc.params, type: adapter.to }, property, readonly, value: property.get() };
  } catch (error) {
    return { ...desc, conversionError: error.message || String(error) };
  }
}
