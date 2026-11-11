/* Bridge -- the one place core modules meet (docs/wiki/bridge.md).
 *
 * A module never imports another module. It is a directory under shell/
 * with a module.json (name, deps, api, events, slots, fills) and an
 * index.js exporting `{ setup(ctx) }`. Boot registers every module here and
 * starts the bridge, which calls each setup in dependency order and hands it
 * a ctx:
 *
 *   ctx.use(name)            the public API of a module listed in deps
 *   ctx.emitter()            emit(event, payload) for this module's events
 *   ctx.on(module, ev, fn)   listen to a dependency's event; returns off()
 *   ctx.slot(name)           a function another module fills in later
 *   ctx.fill("m.slot", fn)   fill a slot this module declared in fills
 *
 * A module may say its `version` ("1.2.0": a name gone or changed in its api
 * is the first number, a name added the second, anything else the third;
 * tests/api-versions.mjs keeps that honest) and, in `depVersions`, which
 * versions of a dependency it takes ({"server": "^1.0.0"}); start() checks
 * those before any setup runs. Ranges: "1.2.3", "^1.2.3", "~1.2.3",
 * ">=1.2.3", "1" / "1.x" (that major).
 *
 * What setup returns must name exactly the module's `api`; it is frozen and
 * handed out as it is, so a call is a plain function call (no lookup per
 * call, no replacing at run time). Every problem stops start() with an
 * error that names the module, the way the registry's problems do.
 */

const FIELDS = ["deps", "api", "events", "slots", "fills"];

const VERSION = /^(\d+)\.(\d+)\.(\d+)$/;
/** [major, minor, patch] of "1.2.3", or null. */
export function parseVersion(text) {
  const m = VERSION.exec(String(text ?? ""));
  return m ? m.slice(1).map(Number) : null;
}
const compare = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
/** Whether `version` ("1.2.3") is in `range` (see the head of this file); throws on a range it cannot read. */
export function satisfies(version, range) {
  const v = parseVersion(version);
  const r = String(range ?? "").trim();
  let m;
  if (!v) return false;
  if ((m = /^(\d+)(?:\.x)?$/.exec(r))) return v[0] === Number(m[1]);
  const op = /^(\^|~|>=)?(.*)$/.exec(r);
  const want = parseVersion(op[2]);
  if (!want) throw new Error(`bridge: bad version range ${JSON.stringify(range)}`);
  if (op[1] === ">=") return compare(v, want) >= 0;
  if (op[1] === "^") return compare(v, want) >= 0 && (want[0] > 0 ? v[0] === want[0] : v[1] === want[1] && (want[1] > 0 || v[2] === want[2]));
  if (op[1] === "~") return compare(v, want) >= 0 && v[0] === want[0] && v[1] === want[1];
  return compare(v, want) === 0;
}

export function createBridge() {
  const defs = new Map(); // name -> { meta, setup }
  const apis = new Map(); // name -> frozen public API
  const listeners = new Map(); // "module.event" -> Set<fn>
  const slots = new Map(); // "module.slot" -> { fn, owner }

  function register(meta, impl) {
    const name = meta && meta.name;
    if (typeof name !== "string" || !/^[a-z][a-z0-9]*$/.test(name)) throw new Error(`bridge: bad module name ${JSON.stringify(name)}`);
    if (defs.has(name)) throw new Error(`bridge: module ${name} registered twice`);
    for (const f of FIELDS) {
      const v = meta[f] ?? [];
      if (!Array.isArray(v) || v.some((x) => typeof x !== "string")) throw new Error(`bridge: ${name}.${f} must be a list of names`);
    }
    if (!impl || typeof impl.setup !== "function") throw new Error(`bridge: ${name} has no setup(ctx)`);
    if (meta.version !== undefined && !parseVersion(meta.version)) throw new Error(`bridge: ${name}.version must look like "1.0.0", not ${JSON.stringify(meta.version)}`);
    const depVersions = meta.depVersions ?? {};
    if (typeof depVersions !== "object" || Array.isArray(depVersions)) throw new Error(`bridge: ${name}.depVersions must be {module: range}`);
    for (const [dep, range] of Object.entries(depVersions)) {
      if (!(meta.deps ?? []).includes(dep)) throw new Error(`bridge: ${name}.depVersions names ${dep}, which is not in its deps`);
      satisfies("0.0.0", range); // throws on a range it cannot read
    }
    const norm = { name, version: meta.version ?? null, depVersions: { ...depVersions } };
    for (const f of FIELDS) norm[f] = [...(meta[f] ?? [])];
    defs.set(name, { meta: Object.freeze(norm), setup: impl.setup });
  }

  // Dependency order of `targets` and everything they need; throws on a
  // missing module or a cycle.
  function order(targets) {
    const out = [];
    const state = new Map(); // name -> "visiting" | "done"
    const visit = (name, path) => {
      if (state.get(name) === "done") return;
      if (state.get(name) === "visiting") throw new Error(`bridge: dependency cycle ${[...path, name].join(" -> ")}`);
      const def = defs.get(name);
      if (!def) throw new Error(`bridge: ${path.length ? path[path.length - 1] + " needs " : ""}unknown module ${name}`);
      state.set(name, "visiting");
      for (const d of def.meta.deps) visit(d, [...path, name]);
      state.set(name, "done");
      out.push(name);
    };
    for (const t of targets) visit(t, []);
    return out;
  }

  function contextFor(meta) {
    const own = (list, what) => (x) => {
      if (!list.includes(x)) throw new Error(`bridge: ${meta.name} uses ${what} ${x} not declared in module.json`);
    };
    const needDep = own(meta.deps, "module");
    return Object.freeze({
      name: meta.name,
      use(name) {
        needDep(name);
        return apis.get(name);
      },
      emitter() {
        const mine = own(meta.events, "event");
        return (event, payload) => {
          mine(event);
          for (const fn of [...(listeners.get(`${meta.name}.${event}`) ?? [])]) {
            try {
              fn(payload);
            } catch (err) {
              console.error(`bridge: a listener of ${meta.name}.${event} failed`, err);
            }
          }
        };
      },
      on(module, event, fn) {
        needDep(module);
        if (!defs.get(module).meta.events.includes(event)) throw new Error(`bridge: ${module} has no event ${event} (asked by ${meta.name})`);
        const key = `${module}.${event}`;
        if (!listeners.has(key)) listeners.set(key, new Set());
        listeners.get(key).add(fn);
        return () => listeners.get(key).delete(fn);
      },
      slot(name) {
        own(meta.slots, "slot")(name);
        const key = `${meta.name}.${name}`;
        const entry = { fn: null, owner: null };
        slots.set(key, entry);
        return (...args) => {
          if (!entry.fn) throw new Error(`bridge: slot ${key} called before it was filled`);
          return entry.fn(...args);
        };
      },
      fill(target, fn) {
        own(meta.fills, "slot")(target);
        if (typeof fn !== "function") throw new Error(`bridge: ${meta.name} fills ${target} with a non-function`);
        pendingFills.push({ target, fn, by: meta.name });
      },
    });
  }

  let pendingFills = [];

  // Sets up `targets` (all modules when none given) and what they need.
  // Returns the API of the one target asked for, or a map name -> API.
  function start(...targets) {
    const names = order(targets.length ? targets : [...defs.keys()]);
    // Every version asked for, before anything is set up: a module that does
    // not fit is a reason not to start, named like the other problems.
    for (const name of names) {
      for (const [dep, range] of Object.entries(defs.get(name).meta.depVersions)) {
        const have = defs.get(dep).meta.version;
        if (!have) throw new Error(`bridge: ${name} needs ${dep} ${range}, but ${dep} says no version`);
        if (!satisfies(have, range)) throw new Error(`bridge: ${name} needs ${dep} ${range}, but ${dep} is ${have}`);
      }
    }
    for (const name of names) {
      if (apis.has(name)) continue;
      const { meta, setup } = defs.get(name);
      const api = setup(contextFor(meta));
      if (!api || typeof api !== "object") throw new Error(`bridge: ${name}.setup did not return its API`);
      const got = Object.keys(api);
      const missing = meta.api.filter((k) => !(k in api));
      const extra = got.filter((k) => !meta.api.includes(k));
      if (missing.length || extra.length)
        throw new Error(`bridge: ${name} API does not match module.json` + (missing.length ? `; missing ${missing.join(", ")}` : "") + (extra.length ? `; not declared ${extra.join(", ")}` : ""));
      apis.set(name, Object.freeze({ ...api }));
    }
    for (const { target, fn, by } of pendingFills) {
      const entry = slots.get(target);
      if (!entry) throw new Error(`bridge: ${by} fills ${target}, which no started module declared`);
      if (entry.fn) throw new Error(`bridge: slot ${target} filled by both ${entry.owner} and ${by}`);
      entry.fn = fn;
      entry.owner = by;
    }
    pendingFills = [];
    if (!targets.length) {
      const empty = [...slots].filter(([, e]) => !e.fn).map(([k]) => k);
      if (empty.length) throw new Error(`bridge: slots never filled: ${empty.join(", ")}`);
    }
    if (targets.length === 1) return apis.get(targets[0]);
    return Object.fromEntries(names.map((n) => [n, apis.get(n)]));
  }

  return Object.freeze({ register, start, modules: () => [...defs.values()].map((d) => d.meta) });
}

/** A stand-in module for tests: `fake(meta, api)` with api names checked by start(). */
export function fake(meta, api) {
  return [{ deps: [], events: [], slots: [], fills: [], ...meta, api: meta.api ?? Object.keys(api) }, { setup: () => api }];
}
