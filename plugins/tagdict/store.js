/* The tag dictionary, loaded once and kept.
 *
 * The server hands over one file whole (backend/handlers/tagdict_api.py) -- a few
 * megabytes -- and everything here is done on it in memory: a lookup is a property
 * read, a search is a pass over about eleven thousand names. So an item's
 * computed property can ask for a tag's definition and get an answer on the spot;
 * until the file has arrived the answer is "not yet", and whoever drew itself with
 * that is drawn again when it does (see `onLoaded`).
 *
 * The file is {schema, source, tags: {name: {kind, count, text: {en, ja}, groups, names}}} (a
 * "tagdict/1" file has `text` as one English string; it is read as {en}); the name is Danbooru's -- lowercase, words joined by "_". A tagger's output may
 * have spaces instead (the app turns them into spaces), so every question is put
 * through `normalize`.
 */

const KINDS = { 0: "general", 4: "character", 9: "rating" };

let state = { status: "idle", path: "", error: "", source: {}, list: [], tags: {}, groups: [] };
let started = false;
const listeners = new Set();

export const normalize = (tag) => String(tag ?? "").trim().toLowerCase().replace(/\s+/g, "_");
export const kindName = (kind) => KINDS[kind] || "";
export const current = () => state;
export const ready = () => state.status === "ready";
export const onLoaded = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};
const changed = () => listeners.forEach((fn) => fn());

/** Ask for the dictionary once (every call after the first only reads). `api` is the permission's. */
export function ensure(api) {
  if (started || !api || !api.tagdict) return state;
  started = true;
  state = { ...state, status: "loading" };
  (async () => {
    try {
      const found = await api.tagdict.status();
      if (!found.present) {
        state = { ...state, status: "absent", path: found.path || "", error: found.error || "" };
        return;
      }
      const data = await api.tagdict.data();
      const tags = (data && data.tags) || {};
      for (const entry of Object.values(tags)) {
        // The text in each language there is; one English string (the first schema) is {en}.
        const one = typeof entry.text === "string" ? { en: entry.text } : entry.text || {};
        entry.text = { en: one.en || "", ja: one.ja || "" };
      }
      const list = Object.entries(tags)
        .map(([name, entry]) => ({
          name,
          entry,
          hay: (entry.names || []).join("\n").toLowerCase(),
          text: `${entry.text.en}\n${entry.text.ja}`.toLowerCase(),
        }))
        .sort((a, b) => b.entry.count - a.entry.count);
      const groups = [...new Set(list.flatMap((one) => one.entry.groups || []))].sort();
      state = { status: "ready", path: found.path || "", error: "", source: data.source || {}, list, tags, groups };
    } catch (error) {
      state = { ...state, status: "error", error: String((error && error.message) || error) };
    } finally {
      changed();
    }
  })();
  return state;
}

/** One tag's entry, or null (unknown, or not loaded). */
export const lookup = (tag) => state.tags[normalize(tag)] || null;

/** The group a tag with no group is filed under in a filter. */
export const NO_GROUP = "";

/**
 * Tags matching a query, the best first: the name starts with it, the name has it, another
 * name has it, the definition has it. Among equals, the more used.
 *
 * `kindsOff` are WD14 categories (0, 4, 9) left out; `groupsOff` are tag groups left out
 * (NO_GROUP for the tags that are in none). A tag is left out of a group filter only when every
 * group it is in is off. Returns every hit: {list: [{name, entry}], total}.
 */
export function search({ query = "", kindsOff = [], groupsOff = [] } = {}) {
  const kindOff = new Set(kindsOff);
  const groupOff = new Set(groupsOff);
  const q = normalize(query);
  const loose = String(query).trim().toLowerCase();
  const hits = [];
  for (let i = 0; i < state.list.length; i++) {
    const one = state.list[i];
    if (kindOff.has(one.entry.kind)) continue;
    if (groupOff.size) {
      const own = one.entry.groups || [];
      if (own.length ? own.every((g) => groupOff.has(g)) : groupOff.has(NO_GROUP)) continue;
    }
    let tier = 0;
    if (q) {
      if (one.name.startsWith(q)) tier = 0;
      else if (one.name.includes(q)) tier = 1;
      else if (one.hay.includes(loose)) tier = 2;
      else if (q.length >= 3 && one.text.includes(loose)) tier = 3;
      else continue;
    }
    hits.push(i * 4 + tier);
  }
  hits.sort((a, b) => (a % 4) - (b % 4) || a - b);
  return { total: hits.length, list: hits.map((code) => state.list[(code - (code % 4)) / 4]).map((one) => ({ name: one.name, entry: one.entry })) };
}
