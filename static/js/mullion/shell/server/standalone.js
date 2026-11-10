/* The backend without a server: the routes of docs/backend-contract.md
 * answered inside the page, for Mullion put on a web page (static hosting)
 * or opened with ?backend=standalone. The server module sends every /api/
 * request here instead of the network when the page runs this way, so no
 * other module knows the difference.
 *
 * What it keeps lives in this browser (IndexedDB; in memory where there is
 * none, as in the Node tests). What it cannot do -- run a program, reach
 * ComfyUI through the relay, read the disk -- answers 503 with
 * `unavailable: true`, the one answer a caller reads as "not here".
 *
 * The plugin listing and the profile's defaults come from
 * static/standalone.json, written by tools/standalone.py from the same code
 * the server answers with. */

// From where this module is (static/js/mullion/shell/server/): the site may sit under a path.
const SNAPSHOT_URL = new URL("../../../../standalone.json", import.meta.url).href;
const DB_NAME = "mullion-standalone";
const STORE = "kv";

// ---- keeping -------------------------------------------------------------

function memoryKeep() {
  const map = new Map();
  return { get: async (k) => map.get(k), set: async (k, v) => void map.set(k, v) };
}

function idbKeep(idb) {
  let opened = null;
  const open = () =>
    (opened ??= new Promise((resolve, reject) => {
      const req = idb.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }));
  const run = async (mode, fn) => {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req && req.result);
      tx.onerror = () => reject(tx.error);
    });
  };
  return {
    get: (k) => run("readonly", (s) => s.get(k)),
    set: (k, v) => run("readwrite", (s) => s.put(v, k)),
  };
}

// ---- the routes ------------------------------------------------------------

const plain = (v) => Boolean(v) && typeof v === "object" && !Array.isArray(v);
const copy = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
function merge(base, patch) {
  for (const [k, v] of Object.entries(patch)) {
    if (plain(v) && plain(base[k])) merge(base[k], v);
    else base[k] = copy(v);
  }
  return base;
}

class Answer {
  constructor(status, body) {
    this.status = status;
    this.body = body;
  }
}
const fail = (status, error, more = {}) => new Answer(status, { error, ...more });

export function createStandalone({ idb = globalThis.indexedDB, fetchFile = (url) => globalThis.fetch(url), look = globalThis.localStorage } = {}) {
  const keep = idb ? idbKeep(idb) : memoryKeep();
  let snapshot = null;
  const loadSnapshot = async () => {
    if (snapshot) return snapshot;
    const res = await fetchFile(SNAPSHOT_URL);
    if (!res.ok) throw new Error(`${SNAPSHOT_URL}: ${res.status} (run tools/standalone.py)`);
    snapshot = await res.json();
    return snapshot;
  };

  async function settings() {
    const { settingsDefaults = {} } = await loadSnapshot();
    return merge(copy(settingsDefaults), (await keep.get("settings")) || {});
  }
  // The few keys theme-boot.js needs before the first paint, where it can
  // read them synchronously.
  function keepLook(all) {
    try {
      look && look.setItem("mullion.standalone.look", JSON.stringify({ theme: all.theme, skin: all.skin, language: all.language }));
    } catch {}
  }

  async function saved() {
    return (await keep.get("saved")) || { next: 1, rows: [] };
  }

  // backend/handlers/plugins_api.py: off_state and closure, the same rules.
  const graphOf = (plugins) => new Map(plugins.map((p) => [p.id, [...(p.requires || [])]]));
  function offState(graph, chosen) {
    const state = new Map();
    for (const id of graph.keys()) if (chosen.has(id)) state.set(id, { chosen: true, because: [] });
    for (let changed = true; changed; ) {
      changed = false;
      for (const [id, needs] of graph) {
        if (state.has(id)) continue;
        const gone = needs.filter((n) => state.has(n));
        if (gone.length) state.set(id, { chosen: false, because: gone }), (changed = true);
      }
    }
    return state;
  }
  function closure(graph, start, forward = true) {
    let g = graph;
    if (!forward) {
      g = new Map();
      for (const [id, needs] of graph) for (const n of needs) g.set(n, [...(g.get(n) || []), id]);
    }
    const seen = new Set();
    const stack = [start];
    while (stack.length) for (const next of g.get(stack.pop()) || []) if (!seen.has(next)) seen.add(next), stack.push(next);
    seen.delete(start);
    return seen;
  }
  const chosenOff = async () => new Set(((await settings()).disabledPlugins || []).filter((x) => typeof x === "string"));

  async function listing() {
    const { plugins = [], problems = [] } = await loadSnapshot();
    const state = offState(graphOf(plugins), await chosenOff());
    const requiredBy = new Map();
    for (const p of plugins) for (const n of p.requires || []) requiredBy.set(n, [...(requiredBy.get(n) || []), p.id]);
    return {
      plugins: plugins.map((p) => ({
        ...copy(p),
        requiredBy: [...(requiredBy.get(p.id) || [])].sort(),
        enabled: !state.has(p.id),
        ...(state.has(p.id) ? { off: state.get(p.id) } : {}),
      })),
      problems: copy(problems),
    };
  }
  const names = (plugins, ids) => [...ids].sort().map((id) => ({ id, name: plugins.find((p) => p.id === id)?.name || id }));

  const routes = {
    "GET /api/settings": async () => new Answer(200, await settings()),
    "POST /api/settings": async ({ body, query }) => {
      if (!plain(body)) return fail(400, "settings patch must be an object");
      const stored = (await keep.get("settings")) || {};
      for (const [k, v] of Object.entries(body)) stored[k] = plain(v) && plain(stored[k]) ? merge(stored[k], v) : copy(v);
      await keep.set("settings", stored);
      const all = await settings();
      keepLook(all);
      return new Answer(200, query.quiet ? {} : all);
    },

    "GET /api/store/saved": async ({ query }) => {
      const { rows } = await saved();
      const list = query.type ? rows.filter((r) => r.type === query.type) : rows;
      const order = (a, b) => (query.type ? 0 : a.type.localeCompare(b.type)) || a.name.localeCompare(b.name);
      return new Answer(200, { saved: copy([...list].sort(order)) });
    },
    "POST /api/store/saved/save": async ({ body = {} }) => {
      const type = String(body.type || "").trim();
      const name = String(body.name || "").trim();
      if (!type) return fail(400, "type is required");
      if (!name) return fail(400, "name is required");
      if (!("value" in body)) return fail(400, "value is required");
      const all = await saved();
      if (all.rows.some((r) => r.type === type && r.name === name && r.id !== body.id)) return fail(409, `a ${type} called ${name} already exists`);
      const now = new Date().toISOString().replace("T", " ").slice(0, 19);
      let row;
      if (body.id == null) {
        row = { id: all.next++, type, name, value: copy(body.value), updatedAt: now };
        all.rows.push(row);
      } else {
        row = all.rows.find((r) => r.id === body.id && r.type === type);
        if (!row) return fail(404, `unknown saved value: ${body.id}`);
        Object.assign(row, { name, value: copy(body.value), updatedAt: now });
      }
      await keep.set("saved", all);
      return new Answer(200, { saved: copy(row) });
    },
    "POST /api/store/saved/delete": async ({ body = {} }) => {
      if (body.id == null) return fail(400, "id is required");
      const all = await saved();
      const at = all.rows.findIndex((r) => r.id === body.id);
      if (at < 0) return fail(404, `unknown saved value: ${body.id}`);
      all.rows.splice(at, 1);
      await keep.set("saved", all);
      return new Answer(200, { ok: true });
    },

    // A picture or video kept "as a file": without a server there is no file
    // to keep it in, so its address is the data URL itself.
    "POST /api/blob/put": async ({ body = {} }) => {
      const url = String(body.data_url || "");
      if (!url.startsWith("data:")) return fail(400, "data_url must be a data: URL");
      return new Answer(200, { address: url });
    },

    "GET /api/plugins": async () => new Answer(200, await listing()),
    "POST /api/plugins/enabled": async ({ body = {} }) => {
      const id = String(body.id || "");
      const { plugins = [] } = await loadSnapshot();
      const graph = graphOf(plugins);
      if (!graph.has(id)) return fail(404, `no plugin ${id}`);
      const chosen = await chosenOff();
      const state = offState(graph, chosen);
      if (body.enabled) {
        const down = closure(graph, id);
        const missing = [...down].filter((one) => !graph.has(one));
        if (missing.length) return fail(400, `${id} requires ${missing.sort().join(", ")}, which is not installed`);
        const needed = new Set([...down].filter((one) => state.has(one)));
        if (needed.size && !body.together) return fail(409, "needs", { needs: "requirements", id, others: names(plugins, needed) });
        for (const one of [...needed, id]) chosen.delete(one);
      } else {
        const dependents = [...closure(graph, id, false)].filter((one) => !state.has(one));
        if (dependents.length && !body.together) return fail(409, "needs", { needs: "dependents", id, others: names(plugins, dependents) });
        for (const one of [...dependents, id]) chosen.add(one);
      }
      const stored = (await keep.get("settings")) || {};
      stored.disabledPlugins = [...chosen].sort();
      await keep.set("settings", stored);
      return new Answer(200, { ok: true, disabledPlugins: stored.disabledPlugins });
    },
  };

  /** A Response for an /api/ request, as the server would answer it. */
  async function handle(input, init = {}) {
    const url = new URL(String(input), "http://standalone.invalid");
    const method = (init.method || "GET").toUpperCase();
    let body;
    if (typeof init.body === "string" && init.body) {
      try {
        body = JSON.parse(init.body);
      } catch {
        return respond(fail(400, "body is not JSON"));
      }
    }
    const route = routes[`${method} ${url.pathname}`];
    let answer;
    if (!route) answer = fail(503, `${method} ${url.pathname} needs the Mullion server`, { unavailable: true });
    else {
      try {
        answer = await route({ body, query: Object.fromEntries(url.searchParams) });
      } catch (err) {
        answer = fail(500, String((err && err.message) || err));
      }
    }
    return respond(answer);
  }
  const respond = (a) => new Response(JSON.stringify(a.body), { status: a.status, headers: { "Content-Type": "application/json" } });

  return { handle, routes: Object.keys(routes) };
}
