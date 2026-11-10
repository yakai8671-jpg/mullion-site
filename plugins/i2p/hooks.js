/* Image to Prompt -- what its declaration (items/i2p.json) cannot say.
 *
 * The app is a declared `workflow.run` with the tagger template; after the
 * tagger, the chosen way of sorting runs on the tags it read (`chain`), and a
 * Text Compose window opened beside it writes the question the sorting model
 * is asked (apps/i2p.json). What is left for code is what a property reads
 * from elsewhere: the sorting template chosen in `sortKind`, the choices of
 * `sortKind`, what the tag dictionary says the tags mean (`tagNotes`) and the
 * categories as JSON (`categoriesJson`) -- the variables a connected Text
 * Compose offers.
 */

import { categoriesJson } from "../workflow/categories.js";
import { ensure as ensureTagDictionary, lookup as lookupTag, ready as tagDictionaryReady } from "../tagdict/store.js";
import { CLASSIFY } from "./classify.js";

// The ways of sorting what the tagger read: one for now. Each is a template
// that runs after the tagger (see classify.js); the app runs the one chosen
// in its `sortKind` row.
const SORTS = [{ key: "categories", label: "i2p.sort.categories", template: CLASSIFY }];

const sortOf = (item) => {
  const key = item && item.props ? item.props.sortKind : "";
  return SORTS.find((one) => one.key === key) || SORTS[0];
};

// And what each of them means, from the tag dictionary, when it has them: a model that does not know
// a tag is told what the wiki says it is, instead of guessing. The heading goes with the lines, so a run
// without a dictionary has neither.
const MEANT = "\n\nWhat the tags mean (Danbooru wiki):\n";

// One line per tag the dictionary knows: the name, then the first sentence of what it is.
function notesOf(api, item) {
  ensureTagDictionary(api);
  if (!tagDictionaryReady()) return "";
  const lines = [];
  for (const one of Array.isArray(item.props.stepTags) ? item.props.stepTags : []) {
    const tag = one && typeof one === "object" ? String(one.text || "") : String(one || "");
    const found = tag ? lookupTag(tag) : null;
    // The wiki's English: what the model is told is not for reading.
    if (!found || !found.text.en) continue;
    const first = found.text.en.split(/(?<=[.!?])\s/)[0];
    lines.push(`${tag}: ${first.length > 200 ? `${first.slice(0, 200)}…` : first}`);
  }
  return lines.length ? MEANT + lines.join("\n") : "";
}

// What the derived item is given beyond its declaration (`hooks`).
export const items = {
  "i2p.app": ({ core }) => {
    const { t } = core;
    return {
      properties: {
        // What runs after the tagger, on the tags it read: the sorting chosen.
        chain: { read: (_api, item) => sortOf(item).template },
        sortKind: { options: () => SORTS.map((one) => ({ value: one.key, label: t(one.label) })) },
        tagNotes: { read: (api, item) => notesOf(api, item) },
        categoriesJson: { read: (_api, item) => categoriesJson(item.props.categoryEditor) },
      },
    };
  },
};
