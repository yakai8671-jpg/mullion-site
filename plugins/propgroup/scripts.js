/* Property Group declarative scripts: the values the screens read, what they do, the value types and the controls. */
import createOperations from "./operations.js";
import { createScreens } from "./forms.js";
import { TYPE_ID as TYPE, coerceEntries, coerceGroup, copy, kindsHeld, kindLabel, nameOf, newId, setup, shownAs } from "./lib.js";

export { coerceEntries, coerceGroup, copy, kindsHeld, kindLabel, nameOf, newId, shownAs };

const CREATE = `${TYPE}.create`;
const ADD = `${TYPE}.add`;
const VIEW = `${TYPE}.view`;

let core;
let operations;
export function initialize(api) {
  core = api.core;
  setup(api.core, api.valueTypes);
  operations = createOperations(
    { core },
    {
      TYPE,
      coerceGroup,
      isTransient: (value) => typeof value === "string" && /^\/api\/comfy\/view\?/.test(value),
      asDataUrl: async (src) => {
        const blob = await (await fetch(src)).blob();
        return new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(blob);
        });
      },
      kindsHeld,
      shownAs,
      copy,
      newId,
    }
  );
  try {
    core.registerPortConversion?.(TYPE, "text", (value) =>
      coerceEntries(value)
        .map((entry) => {
          const said = typeof entry.value === "string" ? entry.value : core.portConvert?.(entry.value, entry.kind, "text");
          return `${nameOf(entry)}: ${said ?? ""}`;
        })
        .join("\n")
    );
    core.registerPortConversion?.("propgroupgroups", "text", (value) => (Array.isArray(value) ? value : []).map((one) => (one && one.name) || "").join("\n"));
    core.registerPortConversion?.("propgroupentries", "text", (value) =>
      coerceEntries(value)
        .map((entry) => `${nameOf(entry)}: ${typeof entry.value === "string" ? entry.value : core.portConvert?.(entry.value, entry.kind, "text") ?? ""}`)
        .join("\n")
    );
  } catch {
    // Ignore in environments where already registered
  }
}

export const types = {
  "propgroup.entry": {
    defaultValue: () => ({ id: "", kind: "", name: "", value: null }),
    coerce: (value) => coerceEntries([value])[0] || { id: "", kind: "", name: "", value: null },
    coerceList: coerceEntries,
    format: (value) => (value && (value.name || (typeof value.value === "string" ? value.value : value.kind))) || "—",
    fromWords: (text) => ({ id: "", kind: "text", name: "", value: String(text ?? "") }),
  },
  "propgroup.groupref": {
    defaultValue: () => ({ id: "", name: "" }),
    coerce: (value) => ({ id: String((value && value.id) ?? ""), name: String((value && value.name) ?? "") }),
    coerceList: (value) => (Array.isArray(value) ? value : []).map((one) => ({ id: String((one && one.id) ?? ""), name: String((one && one.name) ?? "") })),
    format: (value) => (value && value.name) || "—",
    fromWords: (text) => ({ id: "", name: String(text ?? "") }),
  },
  propgroup: {
    defaultValue: (p) => coerceGroup(p?.default),
    coerce: (value) => coerceGroup(value),
    format: (value) => {
      const t = core.t || ((k, vars) => `${vars?.n || 0}`);
      return t("propgroup.value.count", { n: coerceEntries(value).length });
    },
    portText: (value) => {
      const group = coerceGroup(value);
      const lines = group.entries.map((entry) => `${nameOf(entry)}: ${typeof entry.value === "string" ? entry.value : core.portConvert?.(entry.value, entry.kind, "text") ?? ""}`);
      return [group.name, ...lines].filter(Boolean).join("\n");
    },
  },
};

// ---- what the screens read ---------------------------------------------------------------------
const valueOf = (api, id, key) => {
  const one = id && api.items.get(id);
  return one ? one.properties.find((prop) => prop.key === key)?.value : undefined;
};
// Where the group in hand is held: the app's `shown` (when the form was opened for it) or a preview's `input`.
// Null for the app's own form, which adds to a group of the library it chooses.
const holderOf = (props) => {
  if (props.forShown && props.app) return { id: props.app, key: "shown" };
  if (props.preview) return { id: props.preview, key: "input" };
  return null;
};
const parentGroup = (api, props) => {
  const holder = holderOf(props);
  const held = holder && valueOf(api, holder.id, holder.key);
  return held?.kind === TYPE ? coerceGroup(held.value) : null;
};
// The preset of the library the group in hand is the open copy of: the app's `opened`, when it is the app that holds it.
const parentReference = (api, props) => {
  const holder = holderOf(props);
  return holder && holder.key === "shown" ? valueOf(api, holder.id, "opened") || null : null;
};
// The app this form is the own form of, when it has no group in hand.
const ownerApp = (api, props) => {
  if (holderOf(props)) return null;
  return props.app ? api.items.get(props.app) : null;
};

export const derived = {
  // The groups of the library, as a list that can be pointed at: read off the library, and a group added to it is
  // made there (one that is taken out of it is not: that is the group card's own close button).
  groups: {
    read: (api) => {
      const store = api?.store || core.store;
      return store?.saved ? store.saved(TYPE).map((one) => ({ id: String(one.id), name: one.name })) : [];
    },
    write: (api, value) => {
      const store = api?.store || core.store;
      if (!store?.saved) return;
      const known = new Set(store.saved(TYPE).map((one) => String(one.id)));
      for (const one of Array.isArray(value) ? value : []) {
        const name = one && typeof one.name === "string" ? one.name.trim() : "";
        if (name && !known.has(String(one.id))) operations.create({ store }, name).catch((error) => console.error("[mullion] a group was not made:", error.message || error));
      }
    },
  },
  // The add form: whether it is the app's own (it chooses the group), and the group in hand otherwise.
  owned: (api, item) => Boolean(ownerApp(api, item.props)),
  parent: (api, item) => parentGroup(api, item.props),
  // The view: what the app shows.
  shownGroup: (api, item) => {
    const shown = valueOf(api, item.props.app, "shown");
    return shown && shown.kind === TYPE ? shown : { kind: "", value: null };
  },
};

// ---- what it does ------------------------------------------------------------------------------
const none = () => ({ kind: "", value: null });
// The group of the library an add form writes to: the one carried in, else the one chosen.
const targetOf = (api, props) => {
  const name = String((props.group || {}).name || "").trim();
  if (!name) return props.target;
  const found = api.store.saved(TYPE).find((one) => one.name === name);
  if (!found) throw new Error(core.t("propgroup.error.noReference"));
  return String(found.id);
};

export const actions = {
  // ---- the app --------------------------------------------------------------------------------
  "propgroup.rename": {
    async run({ id, name }, { api, status }) {
      const preset = api.store.saved(TYPE).find((one) => one.id === Number(id));
      const named = String(name || "").trim();
      if (!preset || !named || named === preset.name) return {};
      if (api.store.saved(TYPE).some((one) => one.name === named)) {
        status("mu.status.presetNameTaken", { name: named });
        return {};
      }
      try {
        await api.store.save({ id: preset.id, type: preset.type, name: named, value: { ...coerceGroup(preset.value), name: named } });
        status("mu.status.presetRenamed", { name: named });
      } catch (error) {
        status("mu.status.presetFailed", { error: error.message || String(error) });
      }
      return {};
    },
  },
  "propgroup.remove": {
    async run({ id, opened }, { api, status }) {
      const preset = api.store.saved(TYPE).find((one) => one.id === Number(id));
      if (!preset) return {};
      try {
        await api.store.remove(preset.id);
        status("mu.status.presetDeleted", { name: preset.name });
        return Number(opened) === preset.id ? { opened: 0 } : {};
      } catch (error) {
        status("mu.status.presetFailed", { error: error.message || String(error) });
        return {};
      }
    },
  },
  // The app shows a copy of the group; it remembers which preset it is a copy of, and keeps it up to date when it
  // is back.
  "propgroup.go": {
    async run({ id }, { api, itemId, write }) {
      const preset = api.store.saved(TYPE).find((one) => one.id === Number(id));
      if (!preset) return {};
      write({ shown: { kind: TYPE, value: { ...coerceGroup(preset.value), name: preset.name } }, opened: preset.id });
      api.window.openScreen(VIEW, { app: itemId });
      return {};
    },
  },
  "propgroup.opencreate": {
    async run(_inputs, { api, itemId }) {
      api.window.openScreen(CREATE, { app: itemId });
      return {};
    },
  },
  "propgroup.openadd": {
    async run(_inputs, { api, itemId }) {
      api.window.openScreen(ADD, { app: itemId });
      return {};
    },
  },
  // The group the app shows is kept in the library when the app is back.
  "propgroup.keep": {
    async run({ opened, shown }, { api, status }) {
      const id = Number(opened) || 0;
      const held = shown?.kind === TYPE ? coerceGroup(shown.value) : null;
      if (!id || !api.store.loaded() || !held) return {};
      let next;
      try {
        await operations.keep(api, id, () => held, (saved) => {
          next = { kind: TYPE, value: { ...coerceGroup(saved.value), name: saved.name } };
        });
      } catch (error) {
        status("mu.status.presetFailed", { error: error.message || String(error) });
        return {};
      }
      return next ? { shown: next } : {};
    },
  },

  // ---- the form that makes a group --------------------------------------------------------------
  "propgroup.create": {
    async run({ name, app }, { api }) {
      const saved = await operations.create(api, name);
      if (app && api.items.get(app)) api.items.set(app, "resultRef", operations.reference(saved));
      return { name: "", resultRef: operations.reference(saved), result: { kind: TYPE, value: coerceGroup(saved.value) } };
    },
  },

  // ---- the form that adds a property ------------------------------------------------------------
  "propgroup.addentry": {
    async run(inputs, { api }) {
      const props = inputs;
      const owner = ownerApp(api, props);
      if (owner) {
        // A group of the library, picked. When it is the one the app has open in its preview, the preview's draft
        // is what is written to, so the write keeps what is shown.
        const ref = targetOf(api, props);
        operations.resolve(api, ref);
        const entry = await operations.entry(api, props.name, props.entry);
        const draft = () => {
          if (Number(valueOf(api, owner.id, "opened")) !== Number(ref)) return null;
          const held = valueOf(api, owner.id, "shown");
          return held?.kind === TYPE ? coerceGroup(held.value) : null;
        };
        let added;
        const shownNow = Boolean(draft());
        await operations.add(api, ref, entry, draft, (saved) => {
          added = coerceGroup(saved.value);
          if (shownNow) api.items.set(owner.id, "shown", { kind: TYPE, value: { ...added, name: saved.name } });
        });
        return { name: "", entry: none(), entryType: "", resultRef: String(ref), result: { kind: TYPE, value: copy(added) } };
      }
      const entry = await operations.entry(api, props.name, props.entry);
      const latest = parentGroup(api, props);
      if (!latest || latest.name !== props.forGroup) throw new Error(core.t("propgroup.error.groupGone"));
      const ref = parentReference(api, props);
      let added;
      const holder = holderOf(props);
      const sync = (value) => {
        api.items.set(holder.id, holder.key, { kind: TYPE, value });
        added = value;
      };
      if (ref) {
        await operations.add(
          api,
          ref,
          entry,
          () => {
            const current = parentGroup(api, props);
            if (!current || current.name !== props.forGroup) throw new Error(core.t("propgroup.error.groupGone"));
            return current;
          },
          (saved) => sync(coerceGroup(saved.value))
        );
      } else sync({ ...latest, entries: [...latest.entries, entry] });
      return { name: "", entry: none(), entryType: "", resultRef: ref ? String(ref) : "", result: { kind: TYPE, value: copy(added) } };
    },
  },
  // Opened for another group than the one it was last used for: what was typed is let go of.
  "propgroup.addreset": {
    async run({ forGroup, app, preview, forShown }, { api }) {
      const props = { forGroup, app, preview, forShown };
      if (ownerApp(api, props)) return {};
      const group = parentGroup(api, props);
      if (group && group.name !== forGroup) return { name: "", entry: none(), entryType: "", forGroup: group.name, result: none() };
      return {};
    },
  },

  // ---- the group the app holds, as a screen -----------------------------------------------------
  "propgroup.viewset": {
    async run({ app, value }, { api }) {
      api.items.set(app, "shown", { kind: TYPE, value });
      return {};
    },
  },
  "propgroup.viewclear": {
    async run({ app }, { api }) {
      api.items.set(app, "shown", none());
      api.items.set(app, "opened", 0);
      return {};
    },
  },
  // A result that took the form's place is closed, so that what a chain points at is drawn.
  "propgroup.closeresult": {
    async run() {
      return { result: none() };
    },
  },
  "propgroup.viewadd": {
    async run({ app }, { api }) {
      api.window.openScreen(ADD, { app, forShown: true });
      return {};
    },
  },
};

// ---- the screens and the controls ---------------------------------------------------------------
const made = new WeakMap();
const drawn = (fw) => {
  if (!made.has(fw)) made.set(fw, createScreens(fw));
  return made.get(fw);
};
const screenOf = (id) => (fw) => drawn(fw)[id];

// The four screens, each the body of an item.
export const screens = Object.fromEntries(["app", "create", "add", "view"].map((name) => [`propgroup.${name}`, screenOf(`propgroup.${name}`)]));

export const controls = {
  "propgroup.namebox": (api) => {
    const t = api?.t || core.t || ((k) => k);
    return {
      render(desc, onChange) {
        const input = Object.assign(document.createElement("input"), { type: "text", className: "input mu-prop-input", spellcheck: false });
        input.addEventListener("change", () => onChange(input.value));
        input.addEventListener("keydown", (event) => {
          if (event.key === "Enter") input.blur();
        });
        this.update(input, desc);
        return input;
      },
      update(input, desc) {
        if (desc.params?.placeholder) input.placeholder = t(desc.params.placeholder);
        if (document.activeElement !== input && input.value !== String(desc.value ?? "")) input.value = String(desc.value ?? "");
      },
    };
  },
  "propgroup.zone": (api) => {
    const t = api?.t || core.t || ((k) => k);
    return {
      render(desc) {
        const zone = document.createElement("div");
        zone.className = "scratch-zone";
        zone.append(Object.assign(document.createElement("i"), { className: "bi bi-box-arrow-in-down" }), Object.assign(document.createElement("span"), { className: "scratch-zone-label" }));
        this.update(zone, desc);
        return zone;
      },
      update(zone, desc) {
        zone.classList.toggle("is-empty", Boolean(desc.params?.empty));
        zone.lastElementChild.textContent = t(desc.params?.empty ? "scratch.value.empty" : "scratch.value.dropMore");
      },
    };
  },
};
