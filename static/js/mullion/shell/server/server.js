/* server: the way to the backend. fetchJSON and qs for /api/ calls, fetch
 * for a file, and settings: the server-side profile (theme, language, the
 * saved layout), kept on disk so it survives restarts and is shared by every
 * tab on this server. A module that talks to the server lists server in its
 * deps and takes these from its deps.js; a module that does not, has no way
 * out (tests/boundaries.mjs checks both).
 *
 * Nothing here touches the page. What a change of the profile does to it
 * (the theme on the root element, the icons, the language of the labels) is
 * the screen layer's: it listens to `change`. A server that was started
 * again and cannot open its data (backend/problems.py) answers 503 with
 * problem: true; what the page then does is the `problem` slot (view fills
 * it with a reload, so the server's own page says why). */

import { createStandalone } from "./standalone.js";

let emit = () => {};
// The backend in the page, when there is no server (preload's backend).
let standalone = null;
let problem = () => {};
export function connect(emitter, problemSlot, preload) {
  emit = emitter;
  problem = problemSlot;
  settings.cache = preload.preloadedSettings();
  standalone = preload.preloadedBackend() === "standalone" ? createStandalone() : null;
}

/** "standalone" when /api/ is answered in the page (server/standalone.js), else "server". */
export const backend = () => (standalone ? "standalone" : "server");

// ---- requests --------------------------------------------------------
// Read when called, so a test may put its fake in after the shell started.
// Without a server, /api/ is answered in the page; files still come over the network.
const isApi = (input) => /^\/api\//.test(typeof input === "string" ? input : String((input && input.url) || ""));
export const fetch = (input, init) => (standalone && isApi(input) ? standalone.handle(input, init) : globalThis.fetch(input, init));

export async function fetchJSON(url, options = {}) {
  const opts = { ...options };
  if (opts.body && typeof opts.body !== "string") {
    opts.body = JSON.stringify(opts.body);
    opts.headers = { "Content-Type": "application/json", ...(opts.headers || {}) };
  }
  const res = await fetch(url, opts);
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!res.ok) {
    if (res.status === 503 && data && data.problem === true) problem();
    const err = new Error((data && data.error) || `${res.status} ${res.statusText}`);
    err.status = res.status;
    err.body = data;
    throw err;
  }
  return data;
}

export const qs = (params) => new URLSearchParams(params).toString();

// ---- the server-side profile ------------------------------------------
// theme-boot.js read it before the first paint; preload hands it in (connect).
// A change is told to the other tabs over a
// BroadcastChannel, so the theme or the language changes everywhere at once.
const channel = typeof globalThis.BroadcastChannel === "function" ? new globalThis.BroadcastChannel("mullion-settings") : null;
// It does not keep a process alive by itself (the Node tests have one too).
if (channel && typeof channel.unref === "function") channel.unref();

const plain = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);

export const settings = {
  cache: {},

  get(path, fallback) {
    let obj = this.cache;
    for (const part of path.split(".")) {
      if (obj == null) return fallback;
      obj = obj[part];
    }
    return obj === undefined ? fallback : obj;
  },

  async refresh() {
    this.cache = await fetchJSON("/api/settings");
    return this.cache;
  },

  // `quiet`: the answer is not the whole profile -- for a patch that is large
  // and sent often (the layout) -- so what is held follows the patch the way
  // the server merges it, and nothing is read back or told to other tabs.
  async update(patch, { quiet = false } = {}) {
    if (quiet) {
      await fetchJSON("/api/settings?quiet=1", { method: "POST", body: patch });
      for (const [key, value] of Object.entries(patch)) {
        this.cache[key] = plain(value) && plain(this.cache[key]) ? { ...this.cache[key], ...value } : value;
      }
      return this.cache;
    }
    this.cache = await fetchJSON("/api/settings", { method: "POST", body: patch });
    if (channel) channel.postMessage(this.cache);
    emit("change", { incoming: false, patch });
    return this.cache;
  },
};

if (channel) {
  channel.onmessage = (event) => {
    settings.cache = event.data;
    emit("change", { incoming: true, patch: null });
  };
}
