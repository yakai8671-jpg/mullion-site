/* Tag Dictionary -- declarative scripts */
import { NO_GROUP, ensure, kindName, lookup, onLoaded, search } from "./store.js";

export function initialize({ core, registerPermission, backend }) {
try {
  registerPermission("tagdict:read", () => ({
    status: () => backend.fetchJSON("status"),
    data: () => backend.fetchJSON("data"),
  }));
} catch {
  // Ignore duplicate registration in environments where it is already set up
}

// Windows drawn before the file arrived are drawn again when it has.
onLoaded(() => core?.refreshAll?.());

// A tag badge anywhere opens what the dictionary says of it.
core?.registerExplainer?.("prompt.tag", (tag) => {
  const found = lookup(tag && tag.text);
  return found && (found.text.en || found.text.ja) ? found.text : null;
});

}

const list = (value) => (Array.isArray(value) ? value.map(String) : []);

// What a card says in place of its list while there is nothing to show.
const guide = (t, st) =>
  st.status === "absent"
    ? t("tagdict.guide.absent", { path: st.path })
    : st.status === "error"
      ? t("tagdict.guide.failed", { error: st.error })
      : t("tagdict.guide.loading");


// One list card: the tags found are its body, and everything that works on the list is in its bars -- the search,
// the kinds and groups (checklists of what is shown), then the page and, once one is picked, the tag picked (a side
// card whose grip carries it). The card says what it asks (`view` of `results`); a new question starts at the first
// page and a page past the last is the last. What is found is made here, from the dictionary.
export const derived = {
  definition: (api, item) => {
    ensure(api);
    const e = lookup(item?.props?.picked);
    return e ? e.text : { en: "", ja: "" };
  },
  results: (api, _item, { t, view }) => {
    const st = ensure(api);
    if (st.status !== "ready") return { total: 0, rows: [], choices: {} };
    const found = search({ query: String(view.query ?? ""), kindsOff: list((view.off || {}).kind).map(Number), groupsOff: list((view.off || {}).group) });
    const pages = Math.max(1, Math.ceil(found.total / view.size));
    const page = Math.min(Math.max(1, Number(view.page) || 1), pages);
    const rows = found.list.slice((page - 1) * view.size, page * view.size).map(({ name, entry }) => ({
      id: name,
      primary: name,
      // A character or a rating says so; a general tag says which group it is listed in.
      secondary: entry.kind === 0 && (entry.groups || [])[0] ? entry.groups[0] : t(`tagdict.kind.${kindName(entry.kind) || "general"}`),
    }));
    return {
      total: found.total,
      rows,
      choices: {
        kind: [
          { value: "0", label: t("tagdict.kind.general") },
          { value: "4", label: t("tagdict.kind.character") },
          { value: "9", label: t("tagdict.kind.rating") },
        ],
        group: [{ value: NO_GROUP, label: t("tagdict.group.none") }, ...st.groups.map((one) => ({ value: one, label: one }))],
      },
    };
  },
  // Whether the dictionary is read, and what is said while it is not.
  ready: (api) => ensure(api).status === "ready",
  waiting: (api) => ensure(api).status !== "ready",
  guide: (api, _item, { t }) => guide(t, ensure(api)),
  hasPicked: (_api, item) => Boolean(String(item?.props?.picked ?? "")),
  pickedName: (_api, item) => String(item?.props?.picked ?? ""),
};
