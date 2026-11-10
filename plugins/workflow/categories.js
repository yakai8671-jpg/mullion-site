/* The categories a sorting step sorts into: a list of descriptions (the
 * shell's value type, {name, description}), read the one way everywhere --
 * the run settings, the preview, the run, and an app that hands the list on.
 *
 * Pure functions: nothing here needs the shell, so an app's own code can use
 * them as they are.
 */

// A category, whatever it was given: a bare string is a name with nothing
// said about it.
export function coerceCategory(value) {
  if (typeof value === "string") return { name: value, description: "" };
  const from = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    name: typeof from.name === "string" ? from.name : "",
    description: typeof from.description === "string" ? from.description : "",
  };
}

// What a run sorts into: the named ones, trimmed, each name once. The editor
// keeps blank cards -- a card is blank the moment it is added -- and this is
// where they stop counting.
export function usableCategories(list) {
  const seen = new Set();
  const out = [];
  for (const raw of Array.isArray(list) ? list : []) {
    const one = coerceCategory(raw);
    const name = one.name.trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push({ name, description: one.description.trim() });
  }
  return out;
}

// The list as it is held, written out as JSON: what a model is given, so that
// what it reads is exactly what is edited.
export function categoriesJson(list) {
  return JSON.stringify(
    usableCategories(list).map((one) => ({ name: one.name, description: one.description })),
    null,
    2
  );
}

// `{categories}` in a prompt stands for that JSON.
export const fillCategories = (text, list) => String(text).split("{categories}").join(categoriesJson(list));
