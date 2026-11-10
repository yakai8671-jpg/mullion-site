// What a typed slot holds: a property, an action's input or result, a control's argument.
//
// A slot names a value type, and a list says what it is a list of:
// `{ "type": "list", "each": { "type": "prompt.tag" } }`. That is the one way to
// write it.

const isObject = (value) => value && typeof value === "object" && !Array.isArray(value);

const isList = (name, valueTypes) => name === "list" || Boolean(valueTypes[name]?.ancestors?.includes("list"));

// Why a slot cannot be what it says, or "" when it can: only `type` and, for a list, `each`
// with the element's `type`.
export function slotProblem(spec, valueTypes) {
  if (!isObject(spec) || typeof spec.type !== "string" || !Object.hasOwn(valueTypes, spec.type)) {
    return "must name a registered value type";
  }
  for (const key of Object.keys(spec)) {
    if (key !== "type" && key !== "each") return `has "${key}", which a typed slot does not take`;
  }
  if (spec.each === undefined) return "";
  if (!isList(spec.type, valueTypes)) return '"each" belongs to a list';
  if (!isObject(spec.each) || Object.keys(spec.each).length !== 1 || typeof spec.each.type !== "string" ||
      !Object.hasOwn(valueTypes, spec.each.type)) {
    return '"each" must be { "type": a registered value type }';
  }
  return "";
}
