import { slotProblem } from "./spec-type.js";

const object = (value) => value && typeof value === "object" && !Array.isArray(value);
const fields = new Set(["id", "permissions", "params", "results", "concurrency", "cancellable", "requires"]);
const KNOWN_SERVICES = new Set(["comfyui", "ollama", "voicevox", "irodori"]);

export function prepareActions(manifest, env, problems) {
  const { actions: declared = [] } = manifest.declarations || {};
  const provides = new Set(manifest.provides?.actions || []);
  const registered = new Map();
  const actions = new Map();
  if (env.actions instanceof Map) {
    for (const [id, def] of env.actions) actions.set(id, def);
  } else if (object(env.actions)) {
    for (const [id, def] of Object.entries(env.actions)) actions.set(id, def);
  }
  for (const { file, data } of declared) {
    const at = (path, message) => problems.push(`${file}: ${path}: ${message}`);
    const { id, permissions = [], params = {}, results = {}, concurrency = "ignore", cancellable = false, requires = {} } = data;
    if (typeof id !== "string" || !id.startsWith(`${manifest.id}.`) || !provides.has(id) || registered.has(id) || actions.has(id)) {
      at("id", "must be a unique action listed in provides.actions under this plugin's namespace");
      continue;
    }
    for (const key of Object.keys(data)) if (!fields.has(key)) at(key, "unknown action field");
    if (!Array.isArray(permissions) || !permissions.every((key) => manifest.permissions?.includes(key))) {
      at("permissions", "must be a list of permissions declared by this plugin");
    }
    for (const [key, table] of [["params", params], ["results", results]]) {
      if (!object(table)) at(key, "must be an object");
      else for (const [name, spec] of Object.entries(table)) {
        const wrong = slotProblem(spec, env.valueTypes);
        if (wrong) at(`${key}.${name}`, wrong);
      }
    }
    if (!["ignore", "restart"].includes(concurrency)) at("concurrency", 'must be "ignore" or "restart"');
    if (typeof cancellable !== "boolean") at("cancellable", "must be true or false");
    if (concurrency === "restart" && !cancellable) at("concurrency", "restart requires a cancellable action");
    const nonEmpty = [];
    let services = [];
    if (!object(requires)) {
      at("requires", 'must map input names to "nonEmpty" or "services" to a list of services');
    } else {
      for (const [key, check] of Object.entries(requires)) {
        if (key === "services" && !Object.hasOwn(params || {}, "services")) {
          if (
            !Array.isArray(check) ||
            !check.length ||
            new Set(check).size !== check.length ||
            !check.every((one) => typeof one === "string" && KNOWN_SERVICES.has(one))
          ) {
            at("requires.services", `must be a non-empty list of unique services (${[...KNOWN_SERVICES].join(", ")})`);
          } else {
            services = [...check];
          }
        } else if (Object.hasOwn(params || {}, key) && check === "nonEmpty") {
          nonEmpty.push(key);
        } else {
          at("requires", 'must map input names to "nonEmpty" or "services" to a list of services');
        }
      }
    }
    const def = { source: manifest.id, permissions, params, results, concurrency, cancellable, nonEmpty, services };
    registered.set(id, def);
    actions.set(id, def);
  }
  for (const id of provides) if (!registered.has(id)) problems.push(`provides.actions: "${id}" has no declaration`);
  return {
    registered,
    actions,
    load(modules) {
      const loaded = new Set();
      for (const { file, module } of modules) {
        if (module.actions === undefined && (module.controls !== undefined || module.types !== undefined || module.items !== undefined || module.derived !== undefined || module.screens !== undefined)) continue;
        if (!object(module.actions)) {
          problems.push(`${file}: must export an actions object`);
          continue;
        }
        for (const [id, implementation] of Object.entries(module.actions)) {
          const action = registered.get(id);
          if (!action || loaded.has(id)) {
            problems.push(`${file}: ${id}: implementation must match one declaration`);
            continue;
          }
          loaded.add(id);
          if (!object(implementation) || typeof implementation.run !== "function" ||
              !Object.entries(implementation).every(([key, fn]) => ["run", "ready", "cancel"].includes(key) && typeof fn === "function") ||
              (implementation.cancel && !action.cancellable)) {
            problems.push(`${file}: ${id}: expected run, optional ready, and cancel only for a cancellable action`);
            continue;
          }
          Object.assign(action, implementation);
        }
      }
      for (const id of registered.keys()) if (!loaded.has(id)) problems.push(`${id}: action has no script implementation`);
    },
  };
}
