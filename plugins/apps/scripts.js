/* Apps scripts: the values the screens read, what they do, the value type and the screen. */
import { createScreens } from "./screens.js";

const isApp = (value) => Boolean(value && typeof value === "object" && typeof value.id === "string" && value.id);

// The apps as a list of values, so each card is a port: an entry is an app value with its id; carried, it
// is that app (the kind `app`), and nothing is put into one.
// An app as a card shows it: the name it goes by, its icon, whether it is built in or back to its default, whether
// history leaves it out, and its windows as a layout tree -- of a built-in app, or of one of your own that has more
// than its one main window (a card of one window alone says so, and draws none).
const entryOf = (api, app, t) => {
  const tree = app.builtin || !app.oneWindow;
  return {
    id: app.id,
    name: app.name,
    title: app.builtin && app.overridden ? `${app.name} · ${t("apps.value.overridden")}` : app.name,
    icon: app.icon || "window",
    builtin: Boolean(app.builtin),
    pristine: !app.overridden,
    excludeHistory: Boolean(api.apps.get(app.id)?.excludeHistory),
    hasTree: Boolean(tree),
    tree: tree ? api.apps.tree(app.id) : null,
  };
};

export const derived = {
  list: (api) => api.apps.list(),
  // Your own apps, and the built-in ones.
  own: (api, _item, { t }) => api.apps.list().filter((one) => !one.builtin).map((one) => entryOf(api, one, t)),
  builtin: (api, _item, { t }) => api.apps.list().filter((one) => one.builtin).map((one) => entryOf(api, one, t)),
  editorApp: {
    // The app as a value, through the card: carried out, it is the app; an app carried in (with its id,
    // from the list) puts the editor on it; a value with no id -- a preset loaded, a value pasted --
    // becomes what the editor's app is (or a new app of your own, when the editor has none).
    read: (api, item) => {
      const app = item.props.target ? api.apps.get(item.props.target) : null;
      return app || {};
    },
    write: (api, value, item) => {
      if (!value) return;
      if (value.id && api.apps.get(value.id)) {
        item.props.target = value.id;
        return;
      }
      if (!value.type) return;
      const { id: _id, ...rest } = value;
      const now = item.props.target ? api.apps.get(item.props.target) : null;
      if (now) {
        // A built-in app keeps its own main window.
        const { type, ...fields } = rest;
        api.apps.set(now.id, now.builtin || type === now.type ? fields : rest);
        return;
      }
      api.apps.add(rest).then((id) => {
        item.props.target = id;
        derivedCore?.refreshAll();
      });
    },
  },
};

let derivedCore;
export function initialize({ core }) {
  derivedCore = core;
}

// ---- what it does ------------------------------------------------------------------------------
export const actions = {
  // Something the screens have to say to the person.
  "apps.say": {
    async run({ text }, { status }) {
      status(String(text ?? ""));
      return {};
    },
  },
  // An app of your own is taken away, once asked.
  "apps.remove": {
    async run({ id, name }, { api, confirm, status }) {
      const ok = await confirm("apps.confirm.remove", { name }, { title: name, danger: true });
      if (!ok) return {};
      try {
        await api.apps.remove(id);
      } catch (error) {
        status(String((error && error.message) || error));
      }
      return {};
    },
  },
  // An app opened, where a guide is clicked.
  "apps.place": {
    async run({ id }, { api, status }) {
      try {
        api.apps.place(id);
      } catch (error) {
        status(String((error && error.message) || error));
      }
      return {};
    },
  },
  // The editor, on an app -- or, with none, an empty one to drop a window into.
  "apps.edit": {
    async run({ id }, { api }) {
      api.layout.start({ launch: "apps.editor", props: { target: id || "" } });
      return {};
    },
  },
  // A built-in app back to its default.
  "apps.reset": {
    async run({ id }, { api, status }) {
      try {
        await api.apps.reset(id);
      } catch (error) {
        status(String((error && error.message) || error));
      }
      return {};
    },
  },
  // History leaves an app out, or takes it back.
  "apps.excludehistory": {
    async run({ id, value }, { api, status }) {
      try {
        await api.apps.set(id, { excludeHistory: Boolean(value) });
      } catch (error) {
        status(String((error && error.message) || error));
      }
      return {};
    },
  },
  // An app carried to the button for a new one is copied as one of your own.
  "apps.adddropped": {
    async run({ value }, { api, status }) {
      const { id: _id, ...rest } = value || {};
      try {
        await api.apps.add(rest);
      } catch (error) {
        status(String((error && error.message) || error));
      }
      return {};
    },
  },
  // This app, kept as a new one of your own under a name: a preset of apps is your own apps.
  "apps.keep": {
    async run({ target }, { api, prompt, status }) {
      const app = target ? api.apps.get(target) : null;
      if (!app) return {};
      const name = String((await prompt("mu.prompt.presetName", {}, { title: "mu.action.keepAsPreset", value: app.name })) || "").trim();
      if (!name) return {};
      const { id: _id, builtin: _b, overridden: _o, layoutChanged: _l, oneWindow: _w, ...value } = api.apps.get(app.id) || app;
      try {
        await api.apps.add({ ...value, name });
        status("mu.status.kept", { name });
      } catch (error) {
        status(String((error && error.message) || error));
      }
      return {};
    },
  },
};

// ---- the screens ---------------------------------------------------------------------------------
const built = new WeakMap();
const screenOf = (id) => (fw) => {
  if (!built.has(fw)) built.set(fw, createScreens(fw));
  return built.get(fw)[id];
};
export const screens = {
  "apps.editor": screenOf("apps.editor"),
};


export const types = {
  "apps.entry": {
    defaultValue: () => ({ id: "", name: "" }),
    coerce: (value) => (isApp(value) ? value : { id: "", name: "" }),
    coerceList: (value) => (Array.isArray(value) ? value.filter(isApp) : []),
    format: (value) => (value && value.name) || "\u2014",
    portKindOf: () => "app",
  },
};
