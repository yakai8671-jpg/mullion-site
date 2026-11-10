/* What this page knows about the connected programs, shared.
 *
 * The Connected Software window and every state control placed in other
 * apps (services.state) show the same four programs, so what the server last
 * said about them is kept once, here, and asked again only while something
 * is looking: a window or a control subscribes, and when the last one leaves
 * the asking stops.
 */

const POLL_MS = 3000;
// How long to wait, at most, between asks while the server does not answer.
const BACKOFF_MS = 30000;
// How long a failure stays on the row that caused it.
const ERROR_MS = 10000;

export const store = {
  list: null, // the server's entries, null until asked
  loading: null,
  working: new Map(), // id -> "start" | "stop"
  errors: new Map(), // id -> message
  logs: new Map(), // id -> text, only for those whose output is open
  watchers: new Map(), // subscription token -> { api, wakeFn }
  // The questions an item asks about a program, kept for the detail screen
  // that is opened from its row: "<item id>:<program id>" -> probe(onLoad).
  providers: new Map(),
  api: null,
  timer: null,
  // While the server does not answer: how many asks in a row failed, and the
  // earliest time to ask again.
  failures: 0,
  retryAt: 0,
};

const wake = () => store.watchers.forEach(({ wakeFn }) => wakeFn());
export { wake };

export const entryOf = (id) => (store.list || []).find((one) => one.id === id) || null;
export const canRead = (api) => typeof api?.services?.status === "function";

export function load(api) {
  // Catalog samples and other unprivileged hosts are allowed to draw the
  // control, but may neither query services nor replace a real subscriber.
  if (!canRead(api)) return Promise.resolve(null);
  if (store.loading) return store.loading;
  store.loading = Promise.resolve()
    .then(() => api.services.status())
    .then((list) => {
      store.list = list;
      store.failures = 0;
      store.retryAt = 0;
      // Output that is open follows the program.
      for (const id of store.logs.keys()) {
        if (typeof api.services.log !== "function") continue;
        Promise.resolve().then(() => api.services.log(id))
          .then((text) => {
            if (store.logs.has(id) && store.logs.get(id) !== text) {
              store.logs.set(id, text);
              wake();
            }
          })
          .catch(() => {});
      }
    })
    .catch((error) => {
      if (!store.list) store.list = [];
      // Said once for an outage, not once for every ask of it, and asked less
      // often the longer it lasts: a server that is restarting is not news.
      if (store.failures === 0) console.warn("[services] the server did not answer:", (error && error.message) || error);
      store.failures += 1;
      store.retryAt = Date.now() + Math.min(BACKOFF_MS, POLL_MS * 2 ** store.failures);
    })
    .finally(() => {
      store.loading = null;
      wake();
    });
  return store.loading;
}

export function replace(entry) {
  store.list = (store.list || []).map((one) => (one.id === entry.id ? entry : one));
}

// Something is looking: ask now, and keep asking while anything is. The api
// is whichever subscriber's -- every one of them holds services:read.
export function subscribe(api, wakeFn) {
  if (!canRead(api)) return () => {};
  const token = Symbol("services subscriber");
  store.watchers.set(token, { api, wakeFn });
  store.api = api;
  if (!store.timer) {
    store.timer = setInterval(() => {
      if (!store.working.size && store.api && Date.now() >= store.retryAt) load(store.api);
    }, POLL_MS);
  }
  load(api);
  return () => {
    store.watchers.delete(token);
    store.api = [...store.watchers.values()].at(-1)?.api || null;
    if (!store.watchers.size && store.timer) {
      clearInterval(store.timer);
      store.timer = null;
    }
  };
}

export function fail(id, error) {
  store.errors.set(id, error.message || String(error));
  setTimeout(() => {
    store.errors.delete(id);
    wake();
  }, ERROR_MS);
}

// Start or stop one. `confirmStop(entry)` is asked for what was not started
// from here, which resolves to whether to go on.
export async function act(api, entry, kind, confirmStop) {
  if (store.working.has(entry.id)) return null;
  store.working.set(entry.id, kind);
  store.errors.delete(entry.id);
  wake();
  try {
    if (kind === "stop") {
      if (!entry.managed && confirmStop && !(await confirmStop(entry))) return null;
      const fresh = await api.services.stop(entry.id);
      replace(fresh);
      return fresh;
    }
    const fresh = await api.services.start(entry.id);
    replace(fresh);
    return fresh;
  } catch (error) {
    fail(entry.id, error);
    throw error;
  } finally {
    store.working.delete(entry.id);
    wake();
    // The program takes a while to answer after it is started.
    load(api);
  }
}

// "running", "starting" or "stopped", as a person would put it.
export function stateOf(entry) {
  if (store.working.get(entry.id) === "start") return "starting";
  if (store.working.get(entry.id) === "stop") return "stopping";
  if (entry.running) return "running";
  return entry.managed ? "starting" : "stopped";
}
