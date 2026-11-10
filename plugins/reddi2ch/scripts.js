/* reddi2ch -- declarative scripts
 *
 * Reddit read as a 5ch board: subject lists, momentum, thread flattening, >>N popup anchors, and Ollama translations.
 * The values the screens read are made in state.js and handed out here (`derived`); what they do is `actions`; the
 * screens themselves are in screens.js, and the controls that draw a page are below.
 */

import { escapeHtml } from "./core/format.js";
import { renderThread, renderThreadList } from "./core/render.js";
import { createScreens } from "./screens.js";
import { DEFAULT_STYLE } from "./translate.js";
import {
  APP, BOARD, THREAD, VIEW, SETTINGS, COMMENT_SORTS, MODELS, REDDIT, appOf, askAgain, boardView, moreBoard, reloadBoard, reloadThread,
  retryTranslation, sessionText, services, showWindow, tr, threadPathOf, samePost, threadView, useCore, windowTiles,
} from "./state.js";

const SORTS = ["hot", "new", "top", "rising"];
const TOP_SPANS = ["day", "week", "month", "year", "all"];

const choices = (values, prefix) => () => values.map((value) => ({ value, label: tr(`${prefix}.${value}`) }));

// ---- the app's settings: about this machine, kept per type -----------------
const APP_SETTINGS = {
  redditCookie: { label: "reddi2ch.prop.redditCookie", type: "string", default: "", control: "reddi2ch.secret" },
  redditUserAgent: { label: "reddi2ch.prop.redditUserAgent", type: "string", default: "" },
  commentSort: {
    label: "reddi2ch.prop.commentSort",
    type: "enum",
    default: "confidence",
    options: choices(COMMENT_SORTS, "reddi2ch.csort"),
  },
  limit: { label: "reddi2ch.prop.limit", type: "number", min: 1, max: 500, default: 500 },
  expandMore: { label: "reddi2ch.prop.expandMore", type: "boolean", default: true },
  maxRequests: { label: "reddi2ch.prop.maxRequests", type: "number", min: 1, max: 100, default: 40 },
  ollamaModel: {
    label: "reddi2ch.prop.ollamaModel",
    type: "enum",
    default: "",
    options: () => [
      { value: "", label: tr("reddi2ch.value.firstModel") },
      ...MODELS.map((name) => ({ value: name, label: name })),
    ],
  },
};

const APP_SETTING_SECTIONS = [
  ["reddit", ["redditCookie", "redditUserAgent"]],
  ["fetch", ["commentSort", "limit", "expandMore", "maxRequests"]],
  ["translate", ["ollamaModel"]],
];

// ---- the view settings: how this app is reading, kept on the item ----------
const VIEW_SETTINGS = {
  nameMode: {
    label: "reddi2ch.prop.nameMode",
    type: "enum",
    default: "author",
    options: choices(["author", "anon"], "reddi2ch.name"),
  },
  anonName: { label: "reddi2ch.prop.anonName", type: "string", default: "名無しさん@お腹いっぱい。" },
  idScope: {
    label: "reddi2ch.prop.idScope",
    type: "enum",
    default: "subreddit",
    options: choices(["subreddit", "thread"], "reddi2ch.idscope"),
  },
  dropAutoModerator: { label: "reddi2ch.prop.dropAutoModerator", type: "boolean", default: true },
  dropDeleted: { label: "reddi2ch.prop.dropDeleted", type: "boolean", default: false },
  useMinScore: { label: "reddi2ch.prop.useMinScore", type: "boolean", default: false },
  minScore: { label: "reddi2ch.prop.minScore", type: "number", min: -10000, max: 100000, default: 1 },
  maxRes: { label: "reddi2ch.prop.maxRes", type: "number", min: 0, max: 5000, default: 0 },
  order: {
    label: "reddi2ch.prop.order",
    type: "enum",
    default: "time",
    options: choices(["time", "thread"], "reddi2ch.order"),
  },
  highlight: { label: "reddi2ch.prop.highlight", type: "boolean", default: true },
  showImages: { label: "reddi2ch.prop.showImages", type: "boolean", default: true },
  translateStyle: {
    label: "reddi2ch.prop.translateStyle",
    type: "reddi2ch.style",
    control: "preset",
    default: DEFAULT_STYLE,
  },
  translateMax: { label: "reddi2ch.prop.translateMax", type: "number", min: 0, max: 5000, default: 30 },
};

const VIEW_SECTIONS = [
  ["names", ["nameMode", "anonName", "idScope"]],
  ["filter", ["dropAutoModerator", "dropDeleted", "useMinScore", "minScore", "maxRes"]],
  ["look", ["order", "highlight", "showImages"]],
  ["translate", ["translateStyle", "translateMax"]],
];




function scrollerOf(el) {
  for (let node = el.parentElement; node; node = node.parentElement) {
    if (!node.ownerDocument || !node.ownerDocument.defaultView) continue;
    const overflow = node.ownerDocument.defaultView.getComputedStyle(node).overflowY;
    if (overflow === "auto" || overflow === "scroll") return node;
  }
  return null;
}

function message(host, text, kind = "loading") {
  host.innerHTML = `<div class="r2c-root"><div class="r2c-${kind}">${escapeHtml(text)}</div></div>`;
}

function wireLinks(host, state) {
  host.addEventListener("click", (event) => {
    if (event.button !== 0) return;
    const row = event.target.closest(".r2c-row");
    const a = event.target.closest("a[href]") || (row && row.querySelector(".r2c-rowlink"));
    if (!a || !host.contains(a)) return;
    const href = a.getAttribute("href") || "";
    event.preventDefault();
    if (href.startsWith("#")) {
      state.jump(href.slice(1));
      return;
    }
    const path = threadPathOf(href);
    const open = state.desc?.params?.onOpen;
    if (path && open && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
      open(path);
      return;
    }
    if (typeof window !== "undefined" && window.open) {
      window.open(new URL(href, REDDIT).href, "_blank", "noopener,noreferrer");
    }
  });
}

function wireAnchors(host, state) {
  const stack = [];
  let closeTimer = 0;

  const resHtml = (no) => {
    const el = host.querySelector(`.r2c-res[data-no="${CSS.escape(String(no))}"]`);
    return el ? el.outerHTML : `<div class="r2c-note">&gt;&gt;${escapeHtml(no)} は取得済みのレスにありません</div>`;
  };
  const closeFrom = (level) => {
    while (stack.length > level) stack.pop().remove();
  };
  const scheduleClose = () => {
    clearTimeout(closeTimer);
    closeTimer = setTimeout(() => {
      const doc = host.ownerDocument || document;
      if (!doc.querySelector(".r2c-pop:hover") && !host.querySelector(".r2c-anchor:hover")) closeFrom(0);
    }, 220);
  };
  const open = (anchor) => {
    clearTimeout(closeTimer);
    const doc = host.ownerDocument || document;
    const parent = anchor.closest(".r2c-pop");
    const level = parent ? Number(parent.dataset.level) + 1 : 0;
    closeFrom(level);
    const pop = doc.createElement("div");
    pop.className = "r2c-pop";
    pop.dataset.level = String(level);
    pop.innerHTML = `<div class="r2c-root">${resHtml(anchor.dataset.target)}</div>`;
    const rect = anchor.getBoundingClientRect();
    const winWidth = typeof window !== "undefined" ? window.innerWidth : 1024;
    const winHeight = typeof window !== "undefined" ? window.innerHeight : 768;
    pop.style.left = `${Math.max(4, Math.min(rect.left, winWidth - 640))}px`;
    pop.style.top = `${rect.bottom + 2}px`;
    pop.style.visibility = "hidden";
    doc.body.append(pop);
    if (rect.bottom + pop.offsetHeight > winHeight) {
      pop.style.top = `${Math.max(4, rect.top - pop.offsetHeight - 2)}px`;
    }
    pop.style.visibility = "";
    pop.addEventListener("mouseleave", scheduleClose);
    pop.addEventListener("mouseover", (event) => {
      const a = event.target.closest(".r2c-anchor");
      if (a) open(a);
    });
    pop.addEventListener("mouseout", (event) => {
      if (event.target.closest(".r2c-anchor")) scheduleClose();
    });
    pop.addEventListener("click", (event) => {
      const a = event.target.closest("a[href]");
      if (!a) return;
      const href = a.getAttribute("href") || "";
      event.preventDefault();
      if (href.startsWith("#")) state.jump(href.slice(1));
      else if (typeof window !== "undefined" && window.open) {
        window.open(new URL(href, REDDIT).href, "_blank", "noopener,noreferrer");
      }
    });
    stack.push(pop);
  };

  host.addEventListener("mouseover", (event) => {
    const a = event.target.closest(".r2c-anchor");
    if (a) open(a);
  });
  host.addEventListener("mouseout", (event) => {
    if (event.target.closest(".r2c-anchor")) scheduleClose();
  });
  state.closePopups = () => {
    clearTimeout(closeTimer);
    closeFrom(0);
  };
}

let core;
export function initialize(api) {
  core = api.core;
  useCore(api.core);
  try {
    const { fetchJSON } = api.backend;
    api.registerPermission("threadstore:access", () => ({
      discussion: (id) => fetchJSON("discussion", { query: { id } }),
      saveDiscussion: (discussion) => fetchJSON("discussion", { body: { discussion } }),
      discussions: () => fetchJSON("discussions"),
      translation: (id, key) => fetchJSON("translation", { query: { id, key } }),
      saveTranslation: (id, key, translation) => fetchJSON("translation", { body: { id, key, translation } }),
      titles: (key, ids) => fetchJSON("titles", { body: { key, ids } }),
      saveTitle: (key, id, title) => fetchJSON("title", { body: { key, id, title } }),
    }));
  } catch {
    // Ignore duplicate registration in environments where it is already set up
  }
}


// ---- the values the screens read ---------------------------------------------------------------
export const derived = {
  // The app: what it works with (Reddit's session, Ollama's models, what is stored), and its windows.
  appFacts: (api) => {
    const state = services(api);
    return [
      { key: "reddit", label: tr("reddi2ch.fact.reddit"), value: sessionText(state.session) },
      {
        key: "ollama",
        label: tr("reddi2ch.fact.ollama"),
        value:
          state.models === null
            ? tr("reddi2ch.status.checking")
            : state.models.length
              ? tr("reddi2ch.value.models", { n: state.models.length, model: core.typeSettingValue?.(APP, "ollamaModel", "") || state.models[0] })
              : tr("reddi2ch.status.noModel"),
      },
      {
        key: "stored",
        label: tr("reddi2ch.fact.stored"),
        value: state.stored === null ? tr("reddi2ch.status.checking") : tr("reddi2ch.value.storedThreads", { n: state.stored.length }),
      },
    ];
  },
  appTiles: (api, _item, { read }) => windowTiles(api, read),
  // The board and the thread: what the window shows, for the app it is connected to.
  boardReport: (api, _item, { read }) => boardView(api, read),
  threadReport: (api, item) => threadView(api, item.props.app),
};

// ---- what it does ------------------------------------------------------------------------------
const appValue = (api, appId, key) => appOf(api, appId)?.values?.[key];

export const actions = {
  "reddi2ch.again": {
    async run(_inputs, { api }) {
      askAgain(api);
      return {};
    },
  },
  // A window of the app is brought forward; one that is not there is opened beside it.
  "reddi2ch.show": {
    async run({ key, board, thread }, { api, itemId }) {
      const id = key === "board" ? board : thread;
      if (id && api.items.get(id)) showWindow(api, id);
      else api.window.openScreen(key === "board" ? BOARD : THREAD, { app: itemId });
      return {};
    },
  },
  // A thread is picked in the board (or a link of a thread): it is what the app reads now, and its window is shown.
  "reddi2ch.open": {
    async run({ app, permalink }, { api }) {
      if (!app || !api.items.get(app)) return {};
      api.items.set(app, "current", permalink);
      const thread = appValue(api, app, "thread");
      if (thread) showWindow(api, thread);
      else api.window.openScreen(THREAD, { app });
      return {};
    },
  },
  "reddi2ch.setcurrent": {
    async run({ app, path }, { api }) {
      if (app && api.items.get(app)) api.items.set(app, "current", path);
      return {};
    },
  },
  // Translate what is shown, or show the original: the app's, for the board and the thread alike.
  "reddi2ch.translate": {
    async run({ app }, { api }) {
      if (app && api.items.get(app)) api.items.set(app, "translated", !appValue(api, app, "translated"));
      return {};
    },
  },
  "reddi2ch.reloadboard": {
    async run({ subreddit, sort, span }, { api }) {
      await reloadBoard(api, subreddit, sort, span);
      return {};
    },
  },
  "reddi2ch.moreboard": {
    async run({ subreddit, sort, span }, { api }) {
      await moreBoard(api, subreddit, sort, span);
      return {};
    },
  },
  "reddi2ch.reloadthread": {
    async run({ app }, { api }) {
      await reloadThread(api, app);
      return {};
    },
  },
  "reddi2ch.retry": {
    async run({ app }, { api }) {
      retryTranslation(api, app);
      return {};
    },
  },
};

// ---- the screens ---------------------------------------------------------------------------------
const built = new WeakMap();
const screenOf = (id) => (fw) => {
  if (!built.has(fw)) built.set(fw, createScreens(fw, { APP_SETTINGS, APP_SETTING_SECTIONS, VIEW_SETTINGS, VIEW_SECTIONS }));
  return built.get(fw)[id];
};

export const screens = Object.fromEntries(["app", "board", "thread", "view", "settings"].map((n) => [`reddi2ch.${n}`, screenOf(`reddi2ch.${n}`)]));

export const types = {
  "reddi2ch.style": {
    defaultValue: () => DEFAULT_STYLE,
    coerce: (value) => String(value ?? ""),
  },
};

export const controls = {
  "reddi2ch.thread": () => ({
    mount(host, desc) {
      host.classList.add("reddi2ch-page");
      const state = { desc, shown: undefined, shownId: "" };
      host.__r2c = state;
      state.jump = (anchorId) => {
        const target = host.querySelector(`#${CSS.escape(anchorId)}`);
        if (!target) return;
        state.closePopups();
        target.scrollIntoView({ behavior: "smooth", block: "start" });
        target.classList.add("is-flash");
        setTimeout(() => target.classList.remove("is-flash"), 1200);
      };
      wireLinks(host, state);
      wireAnchors(host, state);
      this.update(host, desc);
    },
    update(host, desc) {
      const state = host.__r2c;
      if (!state) return;
      state.desc = desc;
      const p = desc.params;
      const shown = p.error ? `error:${p.error}` : p.loading ? `loading:${p.loading}` : p.thread || `empty:${p.empty}`;
      if (shown === state.shown) return;
      state.shown = shown;
      state.closePopups?.();
      if (p.error) return message(host, p.error, "error");
      if (p.loading) return message(host, p.loading);
      if (!p.thread) return message(host, p.empty || "");
      host.innerHTML = renderThread(p.thread, { showSource: true });
      if (p.thread.id !== state.shownId) {
        state.shownId = p.thread.id;
        const scroller = scrollerOf(host);
        if (scroller) scroller.scrollTop = 0;
      }
    },
    unmount(host) {
      const state = host.__r2c;
      if (state) state.closePopups?.();
      delete host.__r2c;
    },
  }),

  "reddi2ch.board": () => ({
    mount(host, desc) {
      host.classList.add("reddi2ch-page");
      const state = { desc, shown: undefined };
      host.__r2c = state;
      state.jump = () => {};
      wireLinks(host, state);
      this.update(host, desc);
    },
    update(host, desc) {
      const state = host.__r2c;
      if (!state) return;
      state.desc = desc;
      const p = desc.params;
      const shown = p.error ? `error:${p.error}` : p.list || `loading:${p.loading || ""}`;
      if (shown !== state.shown) {
        state.shown = shown;
        if (p.error) message(host, p.error, "error");
        else if (!p.list) message(host, p.loading || "");
        else host.innerHTML = renderThreadList(p.list, { threadHref: (it) => `${REDDIT}${it.permalink}` });
      }
      for (const row of host.querySelectorAll(".r2c-row")) {
        const link = row.querySelector(".r2c-rowlink");
        const path = link ? threadPathOf(link.getAttribute("href")) : null;
        row.classList.toggle("is-current", Boolean(path && p.current && samePost(path, p.current)));
      }
    },
    unmount(host) {
      delete host.__r2c;
    },
  }),

  "reddi2ch.secret": () => ({
    render(desc, onChange) {
      const input = document.createElement("input");
      input.type = "password";
      input.className = "input mu-prop-input";
      input.autocomplete = "off";
      input.spellcheck = false;
      input.value = desc.value ?? "";
      input.addEventListener("input", () => onChange(input.value));
      return input;
    },
    update(el, desc) {
      if (document.activeElement !== el && el.value !== String(desc.value ?? "")) el.value = desc.value ?? "";
    },
  }),
};

