/* reddi2ch -- what the screens read, and the work that fills it.
 *
 * Nothing here draws. The items (items/*.json) show values that scripts.js
 * hands them (`derived`) and run what scripts.js implements (`actions`); this
 * module is the part under both: what has been fetched from Reddit, what
 * Ollama has translated, what the app's settings are, and the functions that
 * turn them into the values a screen shows.
 *
 * The fetching itself starts when a screen first asks for what it shows (a
 * derived value read for a board nobody has loaded), and every result is
 * told to the shell with changed(), which redraws. An item has no mount
 * hook to start it from.
 */

import { applyTranslation, toDiscussion } from "./core/discussion.js";
import { expandThread } from "./core/expand.js";
import { buildScThread, buildThreadList } from "./core/flatten.js";
import { collectTree, countHidden, extractPost } from "./core/reddit.js";
import { DEFAULT_STYLE, translateThread, translateTitles, translationKey, workFor } from "./translate.js";

export const APP = "reddi2ch.app";
export const BOARD = "reddi2ch.board";
export const THREAD = "reddi2ch.thread";
export const VIEW = "reddi2ch.view";
export const SETTINGS = "reddi2ch.settings";

export const COMMENT_SORTS = ["confidence", "top", "new", "controversial", "old", "qa"];
const BOARD_PAGE = 100;
export const REDDIT = "https://www.reddit.com";
const THREAD_PATH = /^\/r\/[A-Za-z0-9_]+\/comments\/[a-z0-9]+/i;

// ---- the shell's, handed in by initialize() --------------------------------
let core = null;
export function useCore(shell) {
  core = shell;
}
export const tr = (key, vars) => (core && core.t ? core.t(key, vars) : key);

// Redraw, once for a burst of results.
let redrawTimer = 0;
export function changed() {
  if (redrawTimer) return;
  redrawTimer = setTimeout(() => {
    redrawTimer = 0;
    core?.refreshAll?.();
  }, 30);
}

// ---- the app's settings: about this machine, kept per type ------------------
export const SETTING_DEFAULTS = {
  redditCookie: "",
  redditUserAgent: "",
  commentSort: "confidence",
  limit: 500,
  expandMore: true,
  maxRequests: 40,
  ollamaModel: "",
};

export const appSetting = (key) => core?.typeSettingValue?.(APP, key, SETTING_DEFAULTS[key]) ?? SETTING_DEFAULTS[key];
export const setAppSetting = (key, value) => core?.setTypeSetting?.(APP, key, value);

// ---- what the app reads, kept on the app item -------------------------------
export const VIEW_DEFAULTS = {
  nameMode: "author",
  anonName: "名無しさん@お腹いっぱい。",
  idScope: "subreddit",
  dropAutoModerator: true,
  dropDeleted: false,
  useMinScore: false,
  minScore: 1,
  maxRes: 0,
  order: "time",
  highlight: true,
  showImages: true,
  translateStyle: DEFAULT_STYLE,
  translateMax: 30,
};
export const VIEW_KEYS = Object.keys(VIEW_DEFAULTS);

// ---- Ollama's models, and Reddit's session ----------------------------------
export let MODELS = [];
const SERVICES = { session: null, models: null, stored: null, asked: false };

// The state the app's cards show, asked once and again on request.
export function services(api) {
  if (api && !SERVICES.asked) askServices(api);
  return SERVICES;
}

function askServices(api) {
  SERVICES.asked = true;
  api.reddit
    ?.status()
    .then((answer) => {
      SERVICES.session = answer;
      changed();
    })
    .catch((error) => {
      SERVICES.session = { error: error.message || String(error) };
      changed();
    });
  askModels(api).then(() => changed());
  api.threadstore
    ?.discussions()
    .then((answer) => {
      SERVICES.stored = answer.discussions || [];
      changed();
    })
    .catch(() => {});
}

export function askAgain(api) {
  SERVICES.session = null;
  SERVICES.models = null;
  SERVICES.stored = null;
  SERVICES.asked = false;
  services(api);
  changed();
}

// After the cookie is changed, what Reddit says about the session.
export function askSession(api) {
  setTimeout(() => {
    api?.reddit
      ?.status()
      .then((answer) => {
        SERVICES.session = answer;
        changed();
      })
      .catch(() => {});
  }, 300);
}

export function askModels(api) {
  if (!api?.ollama) return Promise.resolve(MODELS);
  return api.ollama
    .status()
    .then((answer) => {
      MODELS = Array.isArray(answer.models) ? answer.models : [];
      SERVICES.models = MODELS;
      return MODELS;
    })
    .catch(() => {
      SERVICES.models = SERVICES.models ?? MODELS;
      return MODELS;
    });
}

// The models are asked for once, the first time a screen shows them.
let modelsAsked = false;
export function modelsFor(api) {
  if (api && !modelsAsked) {
    modelsAsked = true;
    askModels(api).then(() => changed());
  }
  return MODELS;
}

export const sessionText = (answer) =>
  answer === null
    ? tr("reddi2ch.status.checking")
    : answer.error
      ? tr("reddi2ch.status.failed", { error: answer.error })
      : tr(answer.cookie ? "reddi2ch.value.sessionSet" : "reddi2ch.value.sessionNone");

// ---- what has been fetched, while the page is open ---------------------------
const DISCUSSIONS = new Map();
const BOARDS = new Map();
const TRANSLATIONS = new Map();
const TITLES = new Map();
const BUILT = new WeakMap();
const TRANSLATED = new WeakMap();
const TITLED = new WeakMap();

const threadIdOf = (permalink) => ((String(permalink).match(/\/comments\/([a-z0-9]+)/i) || [])[1] || "").toLowerCase();

export function cleanSub(value) {
  return String(value || "")
    .trim()
    .replace(/^(https?:\/\/[^/]+)?\/?r\//i, "")
    .replace(/[/?#].*$/, "");
}

// A thread's path out of any link to it: www., old. and bare reddit.com are all the same thread.
export function threadPathOf(href) {
  let url;
  try {
    url = new URL(href, REDDIT);
  } catch {
    return null;
  }
  if (!/(^|\.)reddit\.com$/i.test(url.hostname)) return null;
  return THREAD_PATH.test(url.pathname) ? url.pathname : null;
}

export function samePost(a, b) {
  const id = (path) => (String(path).match(/\/comments\/([a-z0-9]+)/i) || [])[1];
  return Boolean(id(a)) && id(a) === id(b);
}

// ---- the app item, as the screens connected to it see it ----------------------
// What a board or a thread reads of the app it is connected to: its stored values (where it is
// reading, whether it translates, how it reads) by the connection `api.items` gives.
export function appOf(api, id) {
  if (!id || !api?.items) return null;
  const entry = api.items.get(id);
  if (!entry) return null;
  const values = {};
  for (const one of entry.properties || []) values[one.key] = one.value;
  return {
    id,
    entry,
    values,
    windows: entry.windows || [],
    current: String(values.current || ""),
    translated: Boolean(values.translated),
    view: (key) => (values[key] === undefined ? VIEW_DEFAULTS[key] : values[key]),
  };
}

const viewOptions = (app) => ({
  nameMode: app.view("nameMode"),
  anonName: app.view("anonName"),
  idScope: app.view("idScope"),
  dropAutoModerator: app.view("dropAutoModerator"),
  dropDeleted: app.view("dropDeleted"),
  minScore: app.view("useMinScore") ? app.view("minScore") : null,
  maxRes: app.view("maxRes") || null,
  order: app.view("order"),
  highlight: app.view("highlight"),
  showImages: app.view("showImages"),
});

const fetchOptions = () => ({
  sort: appSetting("commentSort"),
  limit: appSetting("limit"),
  expand: appSetting("expandMore"),
  maxRequests: appSetting("maxRequests"),
});

const translationSettings = (app) => {
  const model = appSetting("ollamaModel") || MODELS[0] || "";
  const style = app.view("translateStyle");
  return { model, style, max: app.view("translateMax"), key: model ? translationKey(style, model) : "" };
};

// ---- a thread -----------------------------------------------------------------
function discussionFor(api, permalink) {
  const opts = fetchOptions();
  const key = JSON.stringify([permalink, opts]);
  let entry = DISCUSSIONS.get(key);
  if (entry) return entry;
  entry = {
    key,
    permalink,
    discussion: null,
    error: "",
    stale: "",
    progress: tr("reddi2ch.status.fetching"),
  };
  const get = (path, params) => api.reddit.get(path, params);
  entry.promise = (async () => {
    try {
      const answer = await get(permalink, { limit: opts.limit, sort: opts.sort });
      let parts;
      if (opts.expand) {
        parts = await expandThread(answer, get, {
          sort: opts.sort,
          maxRequests: opts.maxRequests,
          onProgress: ({ loaded, pending, requests }) => {
            entry.progress = tr("reddi2ch.status.expanding", { loaded, pending, requests });
            changed();
          },
        });
      } else {
        const acc = collectTree(answer?.[1]?.data?.children ?? []);
        parts = { post: extractPost(answer), comments: acc.comments, hiddenCount: countHidden(acc.mores) };
      }
      entry.discussion = toDiscussion(parts);
      api.threadstore?.saveDiscussion(entry.discussion).catch((error) => {
        console.warn("[reddi2ch] thread not stored:", error.message || error);
      });
    } catch (error) {
      const id = threadIdOf(permalink);
      const kept = id ? await api.threadstore?.discussion(id).catch(() => null) : null;
      if (kept) {
        entry.discussion = kept;
        entry.stale = error.message || String(error);
      } else {
        entry.error = error.message || String(error);
      }
    }
    changed();
  })();
  DISCUSSIONS.set(key, entry);
  return entry;
}

// Let go of what was fetched for a thread (and what failed), so the next look fetches it again.
export function forget(permalink) {
  for (const [key, entry] of DISCUSSIONS) {
    if (entry.permalink === permalink && (entry.discussion || entry.error)) DISCUSSIONS.delete(key);
  }
}

function translationFor(api, discussion, settings) {
  const mapKey = `${discussion.id}|${settings.key}`;
  let entry = TRANSLATIONS.get(mapKey);
  if (!entry) {
    entry = { key: mapKey, translation: null, state: "loading", done: 0, total: 0, error: "", version: 0, ran: null };
    TRANSLATIONS.set(mapKey, entry);
  }
  const run = async () => {
    try {
      if (!settings.model) {
        await askModels(api);
        if (!MODELS.length) throw new Error(tr("reddi2ch.status.noModel"));
        TRANSLATIONS.delete(mapKey);
        changed();
        return;
      }
      if (entry.state === "loading") {
        entry.translation = await api.threadstore.translation(discussion.id, settings.key);
        entry.version += 1;
      }
      if (!workFor(discussion, entry.translation, settings.max).length) {
        entry.state = "done";
        changed();
        return;
      }
      entry.state = "running";
      entry.translation = await translateThread(api, discussion, {
        ...settings,
        translation: entry.translation,
        save: (translation) => api.threadstore.saveTranslation(discussion.id, settings.key, translation),
        report: (done, total, translation) => {
          entry.done = done;
          entry.total = total;
          entry.translation = { ...translation };
          entry.version += 1;
          changed();
        },
      });
      entry.state = "done";
    } catch (error) {
      entry.state = "failed";
      entry.error = error.message || String(error);
    }
    changed();
  };
  if (entry.ran !== discussion.fetchedAt && entry.state !== "running" && entry.state !== "failed") {
    entry.ran = discussion.fetchedAt;
    run();
  }
  return entry;
}

function translatedOf(discussion, entry) {
  if (!entry || !entry.translation) return discussion;
  const kept = TRANSLATED.get(discussion);
  if (kept && kept.key === entry.key && kept.version === entry.version) return kept.discussion;
  const done = entry.translation;
  const laid = applyTranslation(discussion, {
    locale: "ja",
    model: done.model,
    translatedAt: done.translatedAt,
    title: done.title,
    body: done.body,
    comments: done.comments,
  });
  TRANSLATED.set(discussion, { key: entry.key, version: entry.version, discussion: laid });
  return laid;
}

function threadOf(discussion, app) {
  const opts = viewOptions(app);
  const key = JSON.stringify(opts);
  const kept = BUILT.get(discussion);
  if (kept && kept.key === key) return kept.thread;
  const thread = buildScThread(discussion, opts);
  BUILT.set(discussion, { key, thread });
  return thread;
}

// What the thread window shows, for the app it is connected to.
export function threadView(api, appId) {
  const app = appOf(api, appId);
  const permalink = app ? app.current : "";
  const entry = permalink && api?.reddit ? discussionFor(api, permalink) : null;
  const discussion = entry && entry.discussion ? entry.discussion : null;
  const version =
    discussion && app.translated && api?.threadstore ? translationFor(api, discussion, translationSettings(app)) : null;
  const thread = discussion ? threadOf(translatedOf(discussion, version), app) : null;
  const notes = [];
  if (entry && entry.stale) notes.push(tr("reddi2ch.status.stale", { error: entry.stale }));
  if (version && version.state === "running") {
    notes.push(tr("reddi2ch.status.translating", { done: version.done, total: version.total }));
  } else if (version && version.state === "failed") {
    notes.push(tr("reddi2ch.status.translateFailed", { error: version.error }));
  }
  return {
    app,
    permalink,
    thread,
    translating: Boolean(app && app.translated),
    heading: thread ? thread.title : tr("reddi2ch.section.thread"),
    loading: entry && !entry.discussion && !entry.error ? entry.progress : "",
    error: entry && entry.error ? tr("reddi2ch.status.failed", { error: entry.error }) : "",
    notes: notes.join(" / "),
    canRetry: Boolean(version && version.state === "failed"),
  };
}

// Translate the thread again after it stopped.
export function retryTranslation(api, appId) {
  const app = appOf(api, appId);
  const entry = app && app.current ? [...DISCUSSIONS.values()].find((one) => one.permalink === app.current && one.discussion) : null;
  if (!entry) return;
  const settings = translationSettings(app);
  TRANSLATIONS.delete(`${entry.discussion.id}|${settings.key}`);
  changed();
}

// Fetch a thread again, and wait for it.
export async function reloadThread(api, appId) {
  const app = appOf(api, appId);
  if (!app || !app.current) return;
  forget(app.current);
  await discussionFor(api, app.current).promise;
}

// ---- a board ------------------------------------------------------------------
const boardKey = (sub, sort, span) => JSON.stringify([sub.toLowerCase(), sort, sort === "top" ? span : ""]);

const loadBoard = (api, sub, sort, span, entry, after = null) => {
  entry.loading = true;
  const params = { limit: BOARD_PAGE, ...(after ? { after, count: entry.list ? entry.list.items.length : 0 } : {}) };
  if (sort === "top") params.t = span;
  return api.reddit
    .get(`/r/${sub}/${sort}`, params)
    .then((answer) => {
      const page = buildThreadList(answer, sub, { sort });
      if (after && entry.list) {
        const seen = new Set(entry.list.items.map((one) => one.id));
        const offset = entry.list.items.length;
        const added = page.items.filter((one) => !seen.has(one.id)).map((one, i) => ({ ...one, no: offset + i + 1 }));
        entry.list = { ...entry.list, items: [...entry.list.items, ...added], after: page.after };
      } else {
        entry.list = page;
      }
      entry.error = "";
    })
    .catch((error) => {
      entry.error = error.message || String(error);
    })
    .finally(() => {
      entry.loading = false;
      changed();
    });
};

// The board's entry, started when nobody has asked for it yet.
function boardEntry(api, sub, sort, span) {
  const key = sub ? boardKey(sub, sort, span) : "";
  if (!key) return null;
  let entry = BOARDS.get(key);
  if (!entry && api?.reddit) {
    entry = { list: null, error: "", loading: true };
    BOARDS.set(key, entry);
    loadBoard(api, sub, sort, span, entry);
  }
  return entry || null;
}

export async function reloadBoard(api, name, sort, span) {
  const sub = cleanSub(name);
  if (!sub) return;
  BOARDS.delete(boardKey(sub, sort, span));
  const entry = boardEntry(api, sub, sort, span);
  changed();
  await waitFor(entry);
}

export async function moreBoard(api, name, sort, span) {
  const sub = cleanSub(name);
  const entry = sub ? BOARDS.get(boardKey(sub, sort, span)) : null;
  if (!entry || !entry.list || !entry.list.after || entry.loading) return;
  const done = loadBoard(api, sub, sort, span, entry, entry.list.after);
  changed();
  await done;
}

// Why the next page cannot be asked for now (none: it can).
export function moreBlocked(name, sort, span) {
  const sub = cleanSub(name);
  const entry = sub ? BOARDS.get(boardKey(sub, sort, span)) : null;
  if (!entry || !entry.list || !entry.list.after) return tr("reddi2ch.status.fetching");
  return entry.loading ? tr("reddi2ch.status.fetching") : "";
}

const waitFor = async (entry) => {
  while (entry && entry.loading) await new Promise((resolve) => setTimeout(resolve, 50));
};

function titlesFor(api, items, settings) {
  const mapKey = `board|${settings.key}`;
  let entry = TITLES.get(mapKey);
  if (!entry) {
    entry = { key: mapKey, titles: {}, state: "idle", done: 0, total: 0, error: "", version: 0, asked: new Set() };
    TITLES.set(mapKey, entry);
  }
  const wanted = items.filter((one) => !entry.titles[one.id] && !entry.asked.has(one.id));
  if (!wanted.length || entry.state === "running") return entry;
  for (const one of wanted) entry.asked.add(one.id);
  (async () => {
    try {
      if (!settings.model) {
        await askModels(api);
        if (!MODELS.length) throw new Error(tr("reddi2ch.status.noModel"));
        TITLES.delete(mapKey);
        changed();
        return;
      }
      entry.state = "running";
      entry.error = "";
      const stored = await api.threadstore.titles(settings.key, wanted.map((one) => one.id));
      Object.assign(entry.titles, stored.titles || {});
      entry.version += 1;
      const left = wanted.filter((one) => !entry.titles[one.id]);
      entry.done = 0;
      entry.total = left.length;
      changed();
      await translateTitles(api, left, {
        ...settings,
        save: (id, title) => api.threadstore.saveTitle(settings.key, id, title),
        report: (id, title, done) => {
          if (title) {
            entry.titles[id] = title;
            entry.version += 1;
          }
          entry.done = done;
          changed();
        },
      });
      entry.state = "done";
    } catch (error) {
      entry.state = "failed";
      entry.error = error.message || String(error);
      for (const one of wanted) entry.asked.delete(one.id);
    }
    changed();
  })();
  return entry;
}

// The list with its titles in Japanese, kept the same object while nothing changes.
function titledList(list, titles) {
  const kept = TITLED.get(list);
  if (kept && kept.titles === titles && kept.version === titles.version) return kept.list;
  const laid = { ...list, items: list.items.map((one) => ({ ...one, title: titles.titles[one.id] || one.title })) };
  TITLED.set(list, { titles, version: titles.version, list: laid });
  return laid;
}

// What the board window shows.
export function boardView(api, read) {
  const sub = cleanSub(read("subreddit"));
  const sort = read("sort");
  const span = read("span");
  const entry = boardEntry(api, sub, sort, span);
  const app = appOf(api, read("app"));
  const translating = Boolean(app && app.translated);
  const titles =
    translating && entry && entry.list && api?.threadstore ? titlesFor(api, entry.list.items, translationSettings(app)) : null;
  const list = entry && entry.list ? (titles ? titledList(entry.list, titles) : entry.list) : null;
  let status = "";
  if (titles && titles.state === "running") status = tr("reddi2ch.status.translatingTitles", { done: titles.done, total: titles.total });
  else if (titles && titles.state === "failed") status = tr("reddi2ch.status.translateFailed", { error: titles.error });
  return {
    sub,
    sort,
    span,
    app,
    list,
    translating,
    heading: sub ? `r/${sub}` : tr("reddi2ch.section.board"),
    loading: sub ? tr("reddi2ch.status.fetching") : tr("reddi2ch.value.pickBoard"),
    error: entry && entry.error ? tr("reddi2ch.status.failed", { error: entry.error }) : "",
    current: app ? app.current : "",
    status,
    hasMore: Boolean(entry && entry.list && entry.list.after),
  };
}

// ---- the app's own window list --------------------------------------------------
const TILE_ICONS = { board: "list-ul", thread: "chat-left-text", view: "eye", settings: "gear" };

export function windowTiles(api, read) {
  if (!api?.items) return [];
  const tile = (key) => {
    const id = key === "board" || key === "thread" ? read(key) : "";
    const entry = id ? api.items.get(id) : null;
    const label = entry ? entry.label : key === "view" || key === "settings" ? tr(`reddi2ch.item.${key}`) : tr("reddi2ch.value.noWindow");
    const shown = Boolean(entry && entry.windows?.length);
    return {
      key,
      label,
      icon: TILE_ICONS[key],
      active: shown,
      title: shown ? tr("reddi2ch.action.windowShown", { name: label }) : tr("reddi2ch.action.showWindow", { name: label }),
    };
  };
  return ["board", "thread", "view", "settings"].map(tile);
}

// Bring a window that exists to the front; open it where it is not.
export function showWindow(api, id) {
  if (!id) return;
  if (api.layout?.reveal?.(id)) return;
  if (api.window?.open) api.window.open(id);
  else api.layout?.start?.({ item: id });
}

export { DEFAULT_STYLE };
