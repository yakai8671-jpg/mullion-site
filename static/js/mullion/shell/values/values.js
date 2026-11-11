/* values: the one door through which a live item's value is written
 * (docs/wiki/values.md). The values themselves stay where the layout keeps
 * them, in item.props; what changes is that nothing else assigns to them:
 * a property's set (registry), the shell's own bookkeeping (bays, boot,
 * mount, pickers, builtins) and whatever comes later all call writeValue, so
 * a write can be seen, counted and, later, versioned in one place
 * (tests/boundaries.mjs keeps it so).
 *
 * Building a new set of values -- an item made, a layout read -- is not a
 * write to a live item and is left to whoever builds it.
 *
 * It also says what a value is worth beyond being stored: a type's default
 * (defaultFor) and a value as text (formatValue). The value types themselves
 * are registered in the registry, which this depends on; the registry's
 * properties reach these through slots this fills (registry.write,
 * registry.defaultOf, registry.format). */

let emit = () => {};
let types = null; // registry: valueTypeFor, paramsFor, presetSpecOf
export function connect(emitter, registry) {
  emit = emitter;
  types = registry;
}

/** The value a property of this spec starts with (its type's default, under the spec's parameters). */
export function defaultFor(spec) {
  const def = types.valueTypeFor(spec);
  if (!def) throw new Error(`unknown value type: ${spec.type}`);
  return def.defaultValue(types.paramsFor(spec));
}

// ---- versions -------------------------------------------------------------
// A value type may say which shape its values are in (`version`, 1 when it
// says nothing) and how a value of an older shape becomes the next one
// (`migrate(value, from, params)`: from `from` to `from + 1`). Values in memory
// are always of the current shape; what is stored says the shape it was
// written in -- the layout per property (`versions`), the library around the
// value ({"$v": n, "value": ...}, only past 1) -- and is brought up to date
// when it is read back.

/** The shape a value of this spec is in now. A list of a versioned element is its element's. */
export function versionOf(spec) {
  const def = spec && types.valueTypeFor(spec);
  if (def && def.version) return def.version;
  if (spec && spec.type === "list" && spec.each) return versionOf(spec.each);
  return 1;
}

/** `value`, written when the spec's type was at `from`, in the current shape. */
export function upgradeValue(spec, value, from = 1) {
  const to = versionOf(spec);
  const start = Number.isInteger(from) && from > 0 ? from : 1;
  if (start >= to || value === undefined) return value;
  const def = types.valueTypeFor(spec);
  if (!(def && def.version) && spec.type === "list" && spec.each) {
    return Array.isArray(value) ? value.map((one) => upgradeValue(spec.each, one, start)) : value;
  }
  const params = types.paramsFor(spec);
  let out = value;
  for (let at = start; at < to; at++) out = def.migrate(out, at, params);
  return out;
}

const ENVELOPE = "$v";
const wrapped = (stored) => Boolean(stored) && typeof stored === "object" && !Array.isArray(stored) && Number.isInteger(stored[ENVELOPE]) && "value" in stored && Object.keys(stored).length === 2;

/** A value of the type key (a value type, or a list preset "list:<element>") as the library keeps it. */
export function packValue(typeKey, value) {
  const spec = types.presetSpecOf(typeKey);
  const version = spec ? versionOf(spec) : 1;
  return version > 1 ? { [ENVELOPE]: version, value } : value;
}

/** What the library kept, in the current shape; `known` false when the type key is not registered (yet), so the caller may ask again later. */
export function unpackValue(typeKey, stored) {
  const from = wrapped(stored) ? stored[ENVELOPE] : 1;
  const value = wrapped(stored) ? stored.value : stored;
  const spec = types.presetSpecOf(typeKey);
  if (!spec) return { value, known: false };
  return { value: upgradeValue(spec, value, from), known: true };
}

/** A value as text, the way its type says ({ type, params, value }). */
export function formatValue(descriptor) {
  const spec = { ...(descriptor.params || {}), type: descriptor.type };
  const def = types.valueTypeFor(spec);
  if (!def) return String(descriptor.value);
  return def.format ? def.format(descriptor.value, types.paramsFor(spec)) : String(descriptor.value);
}

/** The value of `key` on `item` as it is stored (no read-through, no share: that is the property's get). */
export function readValue(item, key) {
  return item && item.props ? item.props[key] : undefined;
}

/** Writes `value` to `key` on `item`. `by` says who (for whoever listens to `changed`). */
export function writeValue(item, key, value, { by = "" } = {}) {
  if (!item || typeof item !== "object") throw new Error(`values: writing ${key} to no item`);
  if (typeof key !== "string" || !key) throw new Error(`values: writing to a bad key ${JSON.stringify(key)}`);
  if (!item.props || typeof item.props !== "object") item.props = {};
  const before = item.props[key];
  item.props[key] = value;
  if (before !== value) emit("changed", { itemId: item.id, key, by });
  return value;
}
