/* Retrieval for the tag generator: which of the dictionary's tags are worth showing a model.
 *
 * The model that writes tags from a request knows Danbooru's vocabulary only roughly -- it
 * writes "blue-eyed" for blue_eyes, and cannot know a minor tag at all. So before it writes,
 * the tags the request could mean are looked up in the tag dictionary (plugins/tagdict) and
 * handed over with their definitions; what it writes is then put back on the dictionary's
 * spelling.
 *
 * No embedding model: the search is words. Two kinds of words come in --
 *   - English keywords (asked of the model in a first, short step), matched against tag
 *     names (token overlap, IDF weighted) and, weakly, against definitions;
 *   - the request itself, which may be Japanese: every stretch of it that is one of a tag's
 *     other names (the dictionary lists 猫耳 under cat_ears) is a hit.
 *
 * Pure functions on the dictionary's `list` (see tagdict/store.js), so it can be tried
 * without a browser.
 */

import { current, ensure, onLoaded, normalize } from "../tagdict/store.js";

const STOP = new Set(["a", "an", "the", "of", "and", "or", "with", "in", "on", "at", "to", "for", "is", "are", "her", "his", "their", "from", "by"]);
// A light stem, so that cat_ears answers "cat ear", smile answers "smiling" and sitting answers "sit":
// the endings -ing -ed -es -s go, then a last -e, then a doubled consonant the ending left (sitt).
const stem = (word) => {
  let out = word;
  let ended = false;
  if (out.length > 5 && out.endsWith("ing")) [out, ended] = [out.slice(0, -3), true];
  else if (out.length > 4 && out.endsWith("ed")) [out, ended] = [out.slice(0, -2), true];
  else if (out.length > 4 && out.endsWith("es")) out = out.slice(0, -2);
  else if (out.length > 3 && out.endsWith("s") && !out.endsWith("ss")) out = out.slice(0, -1);
  if (out.length > 2 && out.endsWith("e")) out = out.slice(0, -1);
  if (ended && out.length > 3 && out.at(-1) === out.at(-2) && !/[sl]/.test(out.at(-1))) out = out.slice(0, -1);
  return out;
};
const tokensOf = (text) =>
  String(text || "")
    .toLowerCase()
    .split(/[^a-z0-9']+/)
    .filter((word) => word && !STOP.has(word))
    .map(stem);
const nameTokens = (name) => [...new Set(tokensOf(name.replace(/_/g, " ")))];
const fold = (text) => String(text || "").normalize("NFKC").toLowerCase();

const MAX_ALIAS = 12;

/** Index the dictionary's list once: name tokens, other names, document frequencies. */
export function buildIndex(list) {
  const tagsByToken = new Map();
  const byAlias = new Map();
  const rows = list.map((one, at) => {
    const tokens = nameTokens(one.name);
    for (const token of tokens) {
      if (!tagsByToken.has(token)) tagsByToken.set(token, []);
      tagsByToken.get(token).push(at);
    }
    for (const alias of one.entry.names || []) {
      const key = fold(alias).replace(/\s+/g, "");
      if (key.length < 2) continue;
      if (!byAlias.has(key)) byAlias.set(key, []);
      byAlias.get(key).push(at);
    }
    return { at, tokens, definition: one.entry.text && one.entry.text.en ? one.entry.text.en.toLowerCase() : "" };
  });
  return { list, rows, tagsByToken, byAlias, size: list.length };
}

const idf = (index, token) => {
  const have = (index.tagsByToken.get(token) || []).length;
  return Math.log(1 + index.size / (1 + have));
};

/** The first sentence of a definition, short enough to be one line of a prompt. */
export function brief(text, limit = 120) {
  const one = String(text || "").replace(/\s+/g, " ").trim();
  const sentence = one.match(/^.*?[.!?](?:\s|$)/);
  const cut = sentence ? sentence[0].trim() : one;
  return cut.length > limit ? `${cut.slice(0, limit - 1).trimEnd()}…` : cut;
}

/**
 * The tags the request could mean, best first.
 *
 * `keywords` are English words or short phrases; `description` is the request as written.
 * Returns [{name, entry, score, via}] -- at most `limit`. Character tags (kind 4) come only on
 * a whole-name or other-name hit, since a word like "girl" is in the name of hundreds of
 * characters; ratings never.
 */
export function retrieve(index, { description = "", keywords = [], limit = 40 } = {}) {
  const scores = new Map();
  const note = (at, add, via) => {
    const was = scores.get(at) || { score: 0, via: new Set() };
    was.score += add;
    was.via.add(via);
    scores.set(at, was);
  };

  // English keywords: the name as a whole, then overlap of its words.
  const phrases = [...new Set((keywords || []).map((word) => String(word || "").trim()).filter(Boolean))].slice(0, 40);
  const byName = new Map(index.list.map((one, at) => [one.name, at]));
  for (const phrase of phrases) {
    const exact = byName.get(normalize(phrase));
    if (exact !== undefined) note(exact, 12, "name");
    const words = [...new Set(tokensOf(phrase))];
    if (!words.length) continue;
    const touched = new Set();
    for (const word of words) for (const at of index.tagsByToken.get(word) || []) touched.add(at);
    for (const at of touched) {
      const row = index.rows[at];
      const shared = words.filter((word) => row.tokens.includes(word));
      const weight = shared.reduce((sum, word) => sum + idf(index, word), 0);
      const whole = words.reduce((sum, word) => sum + idf(index, word), 0);
      const own = row.tokens.reduce((sum, word) => sum + idf(index, word), 0);
      // Dice on IDF mass: 1 when the phrase and the name are the same words.
      const dice = (2 * weight) / (whole + own || 1);
      if (dice > 0) note(at, 8 * dice, "words");
    }
    // The definition saying the phrase outright is a weak vote: it finds the tag whose
    // name is not the common word (a "bangs" tag described as a fringe).
    if (phrase.length >= 4) {
      const needle = phrase.toLowerCase();
      for (const row of index.rows) if (row.definition.includes(needle)) note(row.at, 1.2, "definition");
    }
  }

  // The request as written: any stretch of it that is another name of a tag.
  const text = fold(description).replace(/\s+/g, "");
  const seen = new Set();
  for (let from = 0; from < text.length; from++) {
    for (let size = 2; size <= MAX_ALIAS && from + size <= text.length; size++) {
      const piece = text.slice(from, from + size);
      const hits = index.byAlias.get(piece);
      if (!hits || seen.has(`${from}:${piece}`)) continue;
      seen.add(`${from}:${piece}`);
      // Longer stretches are less likely to be chance; an alias many tags share says little.
      const add = (4 + Math.min(size, 6)) / Math.sqrt(hits.length);
      for (const at of hits) note(at, add, "alias");
    }
  }

  const hits = [];
  for (const [at, found] of scores) {
    const one = index.list[at];
    const kind = one.entry.kind;
    if (kind === 9) continue;
    const sure = found.via.has("name") || found.via.has("alias");
    if (kind === 4 && !sure && found.score < 7.5) continue;
    // A rare tag only on a sure hit; popularity breaks ties among the rest.
    const count = one.entry.count || 0;
    if (count < 100 && !sure) continue;
    hits.push({ name: one.name, entry: one.entry, score: found.score + Math.log10(count + 10) * 0.15, via: [...found.via] });
  }
  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, limit);
}

/** The candidates, as the lines a model is given: `blue eyes: A character with blue eyes.` */
export const candidateLines = (hits) => hits.map((hit) => `- ${hit.name.replace(/_/g, " ")}: ${brief(hit.entry.text && hit.entry.text.en)}`).join("\n");

/**
 * A tag as the dictionary spells it (spaces, not underscores), or null when it is not one.
 * An exact name first; then a lone other-name ("猫耳" -> cat ears).
 */
export function snap(index, tag) {
  const text = String(tag ?? "").trim();
  if (!text) return null;
  const direct = index.list.find((one) => one.name === normalize(text));
  if (direct) return direct.name.replace(/_/g, " ");
  const hits = index.byAlias.get(fold(text).replace(/\s+/g, ""));
  if (hits && hits.length === 1) return index.list[hits[0]].name.replace(/_/g, " ");
  return null;
}

/** A model's tags put on the dictionary's spelling. Returns {tags, unknown}. Order kept, repeats dropped. */
export function snapAll(index, tags) {
  const byName = index.byName || (index.byName = new Map(index.list.map((one) => [one.name, one.name])));
  const out = [];
  const unknown = [];
  const used = new Set();
  for (const raw of Array.isArray(tags) ? tags : []) {
    const text = String(raw ?? "").trim();
    if (!text) continue;
    const key = normalize(text);
    let spelt = byName.has(key) ? key.replace(/_/g, " ") : null;
    if (!spelt) spelt = snap(index, text);
    if (!spelt) unknown.push(text);
    const final = spelt || text;
    if (used.has(final.toLowerCase())) continue;
    used.add(final.toLowerCase());
    out.push(final);
  }
  return { tags: out, unknown };
}

// ---- the dictionary, as the page holds it -----------------------------------

let built = null; // {list, index}

/**
 * The index of the dictionary, loading it first if nobody has. Resolves to null when there is
 * none (not made, unreadable, or the plugin has no permission): the caller then goes without.
 */
export function indexOf(api) {
  return new Promise((resolve) => {
    const settle = () => {
      const state = current();
      if (state.status === "ready") {
        if (!built || built.list !== state.list) built = { list: state.list, index: buildIndex(state.list) };
        return resolve(built.index);
      }
      if (state.status === "absent" || state.status === "error") return resolve(null);
      return false;
    };
    ensure(api);
    if (settle() !== false) return;
    const stop = onLoaded(() => {
      if (settle() !== false) stop();
    });
    // Nothing starting the load (no permission) must not leave a run waiting.
    if (current().status === "idle") {
      stop();
      resolve(null);
    }
  });
}
