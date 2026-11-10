/* The History app -- what items/history.json cannot say.
 *
 * The runs are the library's `workflow.historyentry` presets: kept by finishing a run (keepRun in
 * runner.js, the only place one is written), listed here newest first, narrowed to one app when
 * asked. Nothing is stored in the item but that app: the list is read off the library each time it
 * is drawn (`derived`), the way the file manager's listing is read off the disk.
 *
 * Whether runs are kept and how many is the shell's own setting (`historyEnabled`, `historyMax`
 * in Mullion's settings), which the runner reads back with core.appSettingValue(): it is not
 * this app's, so the app declares nothing of it.
 */

import { historyOf, pruneHistory, resultAddress } from "./runner.js";

let CORE = null;
let TYPES = null;
export function initialize({ core, types }) {
  CORE = core;
  TYPES = types;
}

const isRecord = (value) => !!value && typeof value === "object" && !Array.isArray(value);
const record = (value) => (isRecord(value) ? value : {});
const appLabelOf = (type) => (type && TYPES?.[type] ? CORE.t(TYPES[type].label) : "");

// ---- keeping the list tidy ---------------------------------------------------------------------
// History entries made before outputs were kept here (or while ComfyUI could not hand them over)
// still point at ComfyUI's files. Shown, a few at a time they are copied, and the entry is saved
// again holding the copy; each is asked for at most once a minute, the ones tried longest ago first
// -- so one whose file is gone does not keep the others waiting.
const HEALED = new Map();
let HEAL_PASS = 0;
const unkept = (one) => one && (one.kind === "image" || one.kind === "mesh") && one.ref && !one.src;
async function heal(api, entries) {
  const now = Date.now();
  // One pass in a while, however often the list is drawn.
  if (now - HEAL_PASS < 15 * 1000) return;
  HEAL_PASS = now;
  const stale = entries
    .filter((entry) => Array.isArray(entry.value.results) && entry.value.results.some(unkept))
    .filter((entry) => now - (HEALED.get(entry.id) || 0) > 60 * 1000)
    .sort((a, b) => (HEALED.get(a.id) || 0) - (HEALED.get(b.id) || 0))
    .slice(0, 6);
  for (const entry of stale) HEALED.set(entry.id, now);
  for (const entry of stale) {
    const results = [...entry.value.results];
    let kept = 0;
    for (let at = 0; at < results.length; at += 1) {
      if (!unkept(results[at])) continue;
      const src = await api.comfy.keep(results[at].ref).catch(() => null);
      if (!src) continue;
      results[at] = { ...results[at], src };
      kept += 1;
    }
    if (kept) await api.store.save({ id: entry.id, type: entry.type, name: entry.name, value: { ...entry.value, results } });
  }
}

// A lower limit applies now, not at the next run: the list should say what the setting says.
let pruning = false;
async function prune(api) {
  const max = Math.floor(Number(CORE.appSettingValue("historyMax")));
  if (pruning || !(max > 0) || historyOf(api).length <= max) return;
  pruning = true;
  try {
    await pruneHistory(api, max);
  } finally {
    pruning = false;
  }
}

// ---- the values the app reads ------------------------------------------------------------------
export const derived = {
  // The runs, newest first; the app's own when one is chosen. Read with no api (a port reads it so)
  // it only lists.
  "workflow.history.entries": (api, _item, { read }) => {
    const entries = historyOf(api, read("app") || "");
    if (api?.store && api?.comfy) {
      queueMicrotask(() => heal(api, entries).catch(() => {}));
      queueMicrotask(() => prune(api).catch(() => {}));
    }
    return entries;
  },
  "workflow.history.off": () => CORE.appSettingValue("historyEnabled") === false,
};

// ---- what it does ------------------------------------------------------------------------------
export const actions = {
  "workflow.history.remove": {
    async run({ id }, { api }) {
      await api.store.remove(id);
      return {};
    },
  },
  "workflow.history.clear": {
    ready: ({ app }, { api, t }) => (historyOf(api, app).length ? [] : [t("workflow.value.nothingToClear")]),
    async run({ app }, { api, confirm }) {
      const entries = historyOf(api, app);
      if (!entries.length) return {};
      const ok = await confirm(
        app ? "workflow.prompt.clearAppHistory" : "workflow.prompt.clearHistory",
        { n: entries.length, app: appLabelOf(app) || app },
        { title: "workflow.action.clearHistory", danger: true }
      );
      if (ok) await pruneHistory(api, 0, app);
      return {};
    },
  },
  // The warning's way out: the setting that switched keeping off, switched on.
  "workflow.history.enable": {
    async run(_inputs, { api }) {
      api.app.set("historyEnabled", true);
      return {};
    },
  },
};

// ---- the value types' hooks --------------------------------------------------------------------
export const types = {
  // Which app's runs are shown: all of them (""), or one of the apps that have runs -- asked when
  // the choice is drawn, because what there are runs of changes as runs are kept and thrown away.
  "workflow.historyapp": ({ core }) => ({
    methods: {
      options: (p) => {
        const apps = [...new Set(historyOf(p.api).map((one) => one.value.app))].filter(Boolean);
        return [
          { value: "", label: core.t("workflow.value.allApps") },
          ...apps.map((type) => ({ value: type, label: appLabelOf(type) || type })),
        ];
      },
    },
  }),
};

// ---- one run: what it made, when, and what went in and came out ---------------------------------
// The card around it (its name, the grip it is carried by, the button that throws it away) is the
// declaration's; this is the inside.
const VIDEO = /[?&]filename=[^&]*\.(webm|mp4|m4v|mov|mkv)(&|$)/i;

export const controls = {
  "workflow.runinfo": ({ core }) => {
    const { t } = core;
    const el = (tag, className, props = {}) => Object.assign(document.createElement(tag), { className, ...props });
    const when = (iso) => {
      const at = new Date(iso);
      return Number.isNaN(at.getTime()) ? "" : at.toLocaleString();
    };
    // How long a run took, as people say it: 8.4 s, 2 min 05 s.
    const took = (seconds) => {
      const s = Number(seconds);
      if (!Number.isFinite(s) || s < 0) return "";
      if (s < 60) return t("workflow.value.took", { time: `${s.toFixed(s < 10 ? 1 : 0)} ${t("workflow.unit.s")}` });
      const m = Math.floor(s / 60);
      return t("workflow.value.took", { time: `${m} ${t("workflow.unit.min")} ${String(Math.round(s - m * 60)).padStart(2, "0")} ${t("workflow.unit.s")}` });
    };
    const facts = (entry) => {
      const value = record(entry.value);
      const results = Array.isArray(value.results) ? value.results : [];
      const made = results.find((one) => one.kind === "image" && one.ref);
      return {
        // What it made if it made a picture; otherwise what it was shown.
        thumb: made ? resultAddress(made) : String(record(value.run).image || ""),
        when: [when(value.at) || entry.name, took(value.seconds)].filter(Boolean).join(" · "),
        summary: String(value.summary || ""),
        output: String(value.output || ""),
      };
    };
    const paint = (root, desc) => {
      const shown = facts(record(desc.params.entry));
      const signature = JSON.stringify(shown);
      if (root.__signature === signature) return;
      root.__signature = signature;
      const thumb = el("div", "workflow-runinfo-thumb");
      if (shown.thumb) {
        // A video's first frame: loaded as far as that and no further.
        thumb.append(
          VIDEO.test(shown.thumb)
            ? Object.assign(document.createElement("video"), { src: shown.thumb, muted: true, preload: "metadata" })
            : Object.assign(document.createElement("img"), { src: shown.thumb, alt: "", loading: "lazy" })
        );
      } else {
        thumb.append(el("i", "bi bi-card-text"));
      }
      const info = el("div", "workflow-runinfo-text");
      info.append(el("span", "workflow-runinfo-when", { textContent: shown.when }));
      for (const [cls, text] of [
        ["workflow-runinfo-summary", shown.summary],
        ["workflow-runinfo-output", shown.output],
      ]) {
        if (text) info.append(el("span", cls, { textContent: text, title: text }));
      }
      root.replaceChildren(thumb, info);
    };
    return {
      render(desc) {
        const root = el("div", "workflow-runinfo");
        paint(root, desc);
        return root;
      },
      update: paint,
    };
  },
};
