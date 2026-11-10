import { createActionRuntime } from "./action-runtime.js";

export function createControlActions({ live, permits, writable, defaultFor, apiFor, refresh, report, progress, t, serviceBlocker = () => "" }) {
  const runtime = createActionRuntime({
    definition: (scope, name) => scope.desc.control.declarationActions[name],
    live: (scope) => scope.live && live(scope.ctx.item),
    serviceBlocker: (service, scope) => serviceBlocker(service, scope.ctx.item),
    block(scope, action) {
      if (!permits(scope.ctx, action.permissions)) return t("mu.control.actionPermission");
      if (Object.values(action.outputs).includes("value") && !writable(scope.desc)) return t("mu.control.actionReadOnly");
      return "";
    },
    property: (scope, key) => {
      if (key === "value") return {
        get: () => scope.desc.property.get(),
        set(value) {
          if (!writable(scope.desc)) throw new Error(t("mu.control.actionReadOnly"));
          scope.desc.property.set(value);
        },
      };
      const get = (name) => scope.ctx.property(name).get();
      return {
        get() {
          const binding = scope.node.params?.binds?.[key];
          if (typeof binding === "string") return get(binding);
          if (binding) return Object.fromEntries(Object.entries(binding).map(([field, name]) => [field, get(name)]));
          return scope.desc.readControlState ? scope.desc.readControlState(key) : scope.desc.params[key];
        },
        set(value) {
          if (!scope.desc.set(key, value)) throw new Error(`control argument "${key}" is read-only`);
        },
      };
    },
    defaultValue: (scope, key) => {
      if (key === "value") return defaultFor(scope.desc.property.params);
      const binding = scope.node.params?.binds?.[key];
      const defaultOf = (name) => defaultFor(scope.ctx.property(name).params);
      if (typeof binding === "string") return defaultOf(binding);
      if (binding) return Object.fromEntries(Object.entries(binding).map(([field, name]) => [field, defaultOf(name)]));
      return defaultFor(scope.desc.control.params[key]);
    },
    apiFor: (scope, permissions) => apiFor(scope.ctx, permissions),
    refresh,
    report: (scope, message) => report(scope.ctx, message),
    progress: (scope, service, message) => progress(scope.ctx.item, service, message),
    t,
  });

  function create(ctx) {
    const scope = { ctx, live: false };
    scope.run = (name, payload) => runtime.run(scope, name, payload);
    scope.cancel = (name) => runtime.cancel(scope, name);
    scope.status = (name) => runtime.status(scope, name);
    return scope;
  }

  function bind(scope, node, desc) {
    scope.node = node;
    scope.desc = desc;
    const tools = desc.control.declarationActionTools || {};
    const placed = desc.params.slotNodes || {};
    const slotNodes = { ...placed };
    for (const [name, buttons] of Object.entries(tools)) {
      if (name === "lead" && Object.hasOwn(placed, name)) continue;
      const replacements = new Set((placed[name] || []).map((one) => one.key));
      slotNodes[name] = [...buttons.map((build) => build(scope)).filter((one) => !replacements.has(one.key)), ...(placed[name] || [])];
    }
    return {
      ...desc,
      params: { ...desc.params, slotNodes },
      runAction: scope.run,
      cancelAction: scope.cancel,
      actionStatus: scope.status,
    };
  }

  function retire(scope) {
    scope.live = false;
    runtime.retire(scope);
  }

  return { create, bind, retire };
}
