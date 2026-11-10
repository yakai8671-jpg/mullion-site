/* Run the actions compiled into an item definition. Jobs belong to the
 * live item object, so reopening a saved layout cannot inherit a job. */
export function createActionRuntime({ definition, live, property, defaultValue, apiFor, refresh, report, progress, t, block = () => "", serviceBlocker = () => "", context = () => ({}) }) {
  const jobs = new WeakMap();
  const idle = { state: "idle", message: "", progress: null };
  const copy = (value) => structuredClone(value);
  const errorMessage = (error) => error?.message || String(error);

  function prepare(item, action, payload, checking = false) {
    const blocked = block(item, action);
    if (blocked) return { reason: blocked };
    for (const service of action.services || []) {
      const serviceReason = serviceBlocker(service, item);
      if (serviceReason) return { reason: serviceReason };
    }
    const read = (key) => {
      if (Object.hasOwn(action.constants, key)) return copy(action.constants[key]);
      const source = action.inputs[key];
      if (typeof source === "string") return copy(property(item, source).get());
      if (payload != null && typeof payload === "object" && Object.hasOwn(payload, source?.payload)) return copy(payload[source.payload]);
      if (payload != null && typeof payload !== "object" && source?.payload === "value") return copy(payload);
      return undefined;
    };
    const empty = action.nonEmpty.find((key) => {
      if (checking && typeof action.inputs[key] === "object") return false;
      const value = read(key);
      return value == null || (typeof value === "string" && !value.trim()) || (Array.isArray(value) && !value.length);
    });
    if (empty !== undefined) return { reason: t("mu.action.requiredInput", { name: empty }) };
    if (checking && !action.ready) return {};
    const api = apiFor(item, action.permissions);
    const inputs = { ...copy(action.constants), ...Object.fromEntries(Object.keys(action.inputs).map((key) => [key, read(key)])) };
    return { api, read, inputs, reason: action.ready?.(inputs, { ...context(item), api, t })?.[0] };
  }

  function status(item, name) {
    const current = jobs.get(item)?.get(name);
    if (current) return { ...current.status };
    const action = definition(item, name);
    if (!action) return { ...idle };
    try {
      const { reason } = prepare(item, action, undefined, true);
      return reason ? { ...idle, state: "blocked", message: reason } : { ...idle };
    } catch (error) {
      return { ...idle, state: "error", message: errorMessage(error) };
    }
  }

  async function run(item, name, payload, reporter) {
    const action = live(item) && definition(item, name);
    if (!action) return { state: "blocked", outputs: {} };
    if (!jobs.has(item)) jobs.set(item, new Map());
    const actions = jobs.get(item);
    const previous = actions.get(name);
    if (previous?.status.state === "busy" && action.concurrency !== "restart") return { state: "busy", outputs: {} };
    const job = { status: { ...idle, state: "busy" }, controller: new AbortController(), services: new Set() };
    const { signal } = job.controller;
    actions.set(name, job);
    const active = () => live(item) && actions.get(name) === job && !signal.aborted;
    const outputs = Object.create(null);
    const announce = (message) => typeof reporter === "function" ? reporter(message) : report(item, message);
    const write = (values) => {
      if (!active()) return false;
      if (!values || typeof values !== "object" || Array.isArray(values)) throw new Error("action results must be an object");
      const entries = Object.entries(values);
      for (const [key] of entries) if (!Object.hasOwn(action.outputs, key)) throw new Error(`undeclared action result "${key}"`);
      for (const [key, value] of copy(entries)) {
        if (!active()) return false;
        const target = property(item, action.outputs[key]);
        target.set(value);
        outputs[key] = copy(target.get());
      }
      if (entries.length) refresh();
      return true;
    };
    try {
      if (previous?.status.state === "busy") {
        job.wait = stop(item, action, previous);
        await job.wait;
      }
      if (!active()) return { state: "idle", outputs };
      const { api, inputs, read, reason } = prepare(item, action, payload);
      if (reason) {
        actions.delete(name);
        announce(reason);
        refresh();
        return { state: "blocked", outputs };
      }
      refresh();
      job.started = true;
      const result = action.builtin === "open"
        ? (api.window.openScreen(action.screen, {}, { share: action.share }), {})
        : action.builtin
        ? Object.fromEntries(Object.entries(action.outputs).map(([key, target]) => [
            key, action.builtin === "set" ? inputs[key] : action.builtin === "toggle" ? !property(item, target).get() : defaultValue(item, target),
          ]))
        : await action.run(inputs, {
            ...context(item), api, signal, write, t,
            read: (key) => Object.hasOwn(action.inputs, key) || Object.hasOwn(action.constants, key) ? read(key) : undefined,
            status: (key, args) => {
              if (!active()) return;
              job.status.message = t(key, args);
              announce(job.status.message);
              refresh();
            },
            progress: (key, args, { on } = {}) => {
              if (!active()) return;
              job.status.progress = t(key, args);
              if (on) {
                job.services.add(on);
                progress(item, on, job.status.progress);
              }
              refresh();
            },
          });
      if (!active()) return { state: "idle", outputs };
      if (result !== undefined) write(result);
      if (active()) actions.delete(name);
      return { state: "idle", outputs };
    } catch (error) {
      if (!active()) return { state: "idle", outputs };
      job.status = { ...idle, state: "error", message: errorMessage(error) };
      announce(job.status.message);
      return { state: "error", outputs };
    } finally {
      if (live(item) && (actions.get(name) === job || !actions.has(name))) {
        for (const service of job.services) progress(item, service, "");
        refresh();
      }
    }
  }

  async function stop(item, action, job) {
    if (job.stopping) return job.stopping;
    job.controller.abort();
    for (const service of job.services) progress(item, service, "");
    job.services.clear();
    job.stopping = job.started ? Promise.resolve().then(() => action.cancel?.({ api: apiFor(item, action.permissions) })) : job.wait;
    await job.stopping;
  }

  async function cancel(item, name) {
    const action = live(item) && definition(item, name);
    const actions = jobs.get(item);
    const job = actions?.get(name);
    if (!action?.cancellable || job?.status.state !== "busy" || job.controller.signal.aborted) return;
    try {
      await stop(item, action, job);
      if (actions.get(name) === job) actions.delete(name);
    } catch (error) {
      if (live(item) && actions.get(name) === job) job.status = { ...idle, state: "error", message: errorMessage(error) };
    } finally {
      if (live(item)) refresh();
    }
  }

  function retire(item) {
    const actions = jobs.get(item);
    jobs.delete(item);
    for (const job of actions?.values() || []) {
      job.controller.abort();
      for (const service of job.services) progress(item, service, "");
    }
    actions?.clear();
  }

  return { status, run, cancel, retire };
}
