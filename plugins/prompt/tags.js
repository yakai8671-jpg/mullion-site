/* Tags as entries.
 *
 * A tag is a value of its own, {id, text}: the text is what it says and the
 * id is what keeps it the same tag while the list around it is edited,
 * reordered or carried -- the same job a prompt's id does in a template. A
 * list of tags is therefore a list of these, never of bare strings, so that
 * one tag can be a property, have a port of its own and be pointed at.
 *
 * Pure functions only (no framework), because more than the prompt plugin
 * has to make and read tags: a workflow keeps a sorted tag as a part, a pose
 * preset reads a part's tags as a line.
 *
 * What comes in is entries. A bare string is not read as a tag here; the
 * places that really do start from strings (a model's answer, a line typed
 * with commas) say so by calling `tagEntries`, and data saved before this
 * was so is rewritten once by tools/migrate/001_tag_entries.py rather than
 * understood forever.
 */

let seq = 0;
export const newTagId = () => `t${Date.now().toString(36)}${(seq++).toString(36)}`;

const isRecord = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);

// One tag. A blank text is kept: a row is blank the moment it is added, and
// dropping it here would take it away before it could be typed into.
export const coerceTag = (value, fallbackId = "") => {
  const from = isRecord(value) ? value : {};
  return {
    id: typeof from.id === "string" && from.id ? from.id : fallbackId,
    text: typeof from.text === "string" ? from.text : "",
  };
};

// A list of them, each with an id of its own. One read before it was ever
// written gets one from its place, which it keeps once written.
export const coerceTags = (list) => {
  const seen = new Set();
  return (Array.isArray(list) ? list : []).filter(isRecord).map((raw, index) => {
    const one = coerceTag(raw, `t${index}`);
    // A clash is settled by the place, never by chance, so the same list
    // always reads as the same entries.
    const base = one.id;
    for (let again = 1; seen.has(one.id); again++) one.id = `${base}_${again}`;
    seen.add(one.id);
    return one;
  });
};

// What the tags say, as the lines an image model is given: trimmed, and
// without the blank rows being typed into.
export const tagTexts = (tags) =>
  (Array.isArray(tags) ? tags : [])
    .map((one) => (isRecord(one) && typeof one.text === "string" ? one.text.trim() : ""))
    .filter(Boolean);

// Tags from words: a model's answer, a line split at its commas. The ids
// come from the place in the list, so the same words make the same tags
// every time -- a link carrying them does not see a new list on every pass.
export const tagEntries = (texts) =>
  (Array.isArray(texts) ? texts : [])
    .map((one) => String(one ?? "").trim())
    .filter(Boolean)
    .map((text, index) => ({ id: `t${index}`, text }));

// The same words as an edit of tags already there: a tag whose text is still
// in the list keeps its id, the rest are new. For a control that edits tags
// as words (the part editor's chips) without making every edit a new set.
export const retag = (texts, tags) => {
  const free = coerceTags(tags);
  return tagEntries(texts).map((one) => {
    const at = free.findIndex((old) => old.text.trim() === one.text);
    if (at < 0) return { id: newTagId(), text: one.text };
    return free.splice(at, 1)[0];
  });
};
