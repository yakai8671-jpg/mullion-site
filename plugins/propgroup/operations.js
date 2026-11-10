// Library operations shared by the child screens and chain automation.
// Serialize writes per group so repeated/concurrent additions keep each entry.
export default function operations(fw, helpers) {
  const { TYPE, coerceGroup, kindsHeld, copy, newId, isTransient, asDataUrl } = helpers;
  const t = fw.core.t;
  const writes = new Map();
  const reference = (saved) => String(saved.id);
  const resolve = (api, ref) => {
    const id = Number(ref);
    const saved = Number.isSafeInteger(id) && id > 0 ? api.store.value(id) : null;
    if (!saved || saved.type !== TYPE) throw new Error(t("propgroup.error.noReference"));
    return saved;
  };
  const queue = (ref, run) => {
    const key = String(ref);
    const task = (writes.get(key) || Promise.resolve()).catch(() => {}).then(run);
    writes.set(key, task);
    task.finally(() => { if (writes.get(key) === task) writes.delete(key); }).catch(() => {});
    return task;
  };
  const keepValue = async (api, entry) => {
    const held = { ...entry, value: copy(entry.value) };
    if ((held.kind === "image" || held.kind === "video") && isTransient(held.value)) {
      held.value = await api.store.keepFile(await asDataUrl(held.value));
    }
    return held;
  };
  const update = (api, ref, edit, onSaved) => {
    const id = reference(resolve(api, ref));
    return queue(id, async () => {
      const saved = resolve(api, id);
      const group = await edit(coerceGroup(saved.value));
      if (!group) return saved;
      const value = { ...coerceGroup(group), name: saved.name };
      const result = JSON.stringify(saved.value) === JSON.stringify(value) ? saved :
        await api.store.save({ id: saved.id, type: TYPE, name: saved.name, value });
      if (onSaved) onSaved(result);
      return result;
    });
  };
  return {
    reference, resolve,
    async create(api, rawName) {
      const name = String(rawName || "").trim();
      if (!name) throw new Error(t("propgroup.error.noName"));
      return queue(`new:${name}`, async () => {
        if (api.store.saved(TYPE).some((one) => one.name === name)) throw new Error(t("mu.status.presetNameTaken", { name }));
        return api.store.save({ type: TYPE, name, value: { name, entries: [] } });
      });
    },
    async entry(api, name, held) {
      if (!held || !kindsHeld().includes(held.kind) || held.value === null || held.value === undefined) {
        throw new Error(t("propgroup.error.noProperty"));
      }
      return keepValue(api, { id: newId(), kind: held.kind, name: String(name || "").trim(), value: held.value });
    },
    add(api, ref, entry, readDraft, onSaved) {
      return update(api, ref, (group) => {
        const draft = readDraft ? readDraft() : null;
        return { ...(draft || group), entries: [...(draft || group).entries, entry] };
      }, onSaved);
    },
    keep(api, ref, readDraft, onSaved) {
      return update(api, ref, async () => {
        const draft = readDraft();
        if (!draft) return null;
        return { ...draft, entries: await Promise.all(draft.entries.map((entry) => keepValue(api, entry))) };
      }, onSaved);
    },
  };
}
