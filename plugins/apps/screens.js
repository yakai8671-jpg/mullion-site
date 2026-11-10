/* The screen of Apps that is drawn in code: the editor of one app (the list of the apps is declared). The apps themselves are the shell's; these only set them, through `api.apps` (apps:read / apps:write).
 * What needs the person asked (removing, keeping as a preset) and what is said are the item's actions. */

export function createScreens(fw) {
  const { core, describe } = fw;
  const { NODES, t } = core;

  // An app's windows as a preview -- or, for one of your own with no window layout, nothing: it opens as its main
  // window alone, and drawing that one window read as a layout still being there. The card says so (`empty`).
  const appPreview = (api, app, key) => (app.builtin || !app.oneWindow ? NODES.control(key, { control: "layoutpreview", tree: api.apps.tree(app.id), bare: true }) : null);

  // ---- the editor -------------------------------------------------------------------------------
  const editor = {
    body(s) {
      // The app being edited is the item's `target`, read when it is asked for (a handler runs after a redraw).
      const target = () => s.read("target");
      const SET = (key, value) => s.set(key, value);
      const api = s.api;
      const item = s.item;
      const say = (text) => s.run("say", { text });
      const fail = (error) => say(String((error && error.message) || error));
      const app = target() ? api.apps.get(target()) : null;

      // A window chosen for the layout: the app is made of it, or becomes its arrangement (and starting values).
      const onWindow = (windowId) => {
        const value = api.apps.capture(windowId);
        if (!value) return say(t("apps.status.notApp"));
        const now = target() ? api.apps.get(target()) : null;
        if (!now) {
          api.apps
            .add(value)
            .then((id) => {
              SET("target", id);
              say(t("apps.status.made", { name: value.name }));
            })
            .catch(fail);
          return;
        }
        if (value.type !== now.type && now.builtin) return say(t("apps.status.otherType", { type: now.type }));
        try {
          api.apps
            .set(now.id, { ...(value.type !== now.type ? { type: value.type } : {}), layout: value.layout, props: value.props })
            .then(() => say(t("apps.status.taken")))
            .catch(fail);
        } catch (error) {
          fail(error);
        }
      };

      const field = (key, spec, label) =>
        describe(
          {
            ...spec,
            read: () => (api.apps.get(app.id) || app)[key],
            write: (_api, value) => {
              try {
                api.apps.set(app.id, { [key]: value }).catch(fail);
              } catch (error) {
                fail(error);
              }
            },
          },
          { api, key: `${item.id}-${app.id}-${key}`, label: t(label) }
        );

      // Presets of apps are your own apps: loading one makes this app what it is, keeping one saves this app as a
      // new one of your own.
      const presetDesc = describe(
        {
          type: "app",
          read: () => (app ? api.apps.get(app.id) || app : {}),
          write: (_api, value) => {
            const { id: _id, type, ...fields } = value || {};
            if (!app || !type) return;
            api.apps.set(app.id, app.builtin || type === app.type ? fields : { ...fields, type });
          },
        },
        { api, key: "app", label: t("mu.vtype.app") }
      );
      const ioCard = NODES.card(
        "app",
        "",
        [app ? appPreview(api, app, "app-tree") : null],
        app
          ? [
              { key: "clear", primary: true, icon: "x-lg", label: t("apps.action.clearApp"), run: () => SET("target", "") },
              { key: "open", icon: "play-fill", title: t("apps.action.open"), run: () => api.apps.place(app.id) },
              { key: "presets", icon: "preset", title: t("mu.action.presets", { type: t("mu.vtype.app") }), run: (button) => core.openValuePicker(presetDesc, button) },
              { key: "keep", icon: "preset", badge: "presetSave", title: t("mu.action.keepAsPreset"), run: () => s.run("keep") },
              ...(app.builtin
                ? [{ key: "reset", icon: "arrow-counterclockwise", title: t("apps.action.reset"), disabled: !app.overridden, run: () => api.apps.reset(app.id).catch(fail) }]
                : []),
            ]
          : [],
        {
          port: { item: item.id, key: "app" },
          icon: app ? app.icon || "window" : "app-indicator",
          empty: t(app ? "apps.value.noLayout" : "apps.value.noApp"),
        }
      );

      // The window layout as an input: chosen from a window on screen, and taken away again -- a built-in app back
      // to its type's, one of your own down to its one main window.
      const layoutSet = app ? (app.builtin ? app.layoutChanged : !app.oneWindow) : false;
      const choose = () => api.apps.pickWindow().then((windowId) => windowId && onWindow(windowId));
      const clear = () => {
        try {
          api.apps
            .set(app.id, app.builtin ? { layout: null } : { layout: "self", props: {} })
            .then(() => say(t("apps.status.cleared")))
            .catch(fail);
        } catch (error) {
          fail(error);
        }
      };
      const layoutCard = NODES.card(
        "layout",
        app && !layoutSet && app.builtin ? t("apps.value.defaultLayout") : "",
        [
          // Shown when there is one to show: a built-in app's type's own, or what was chosen. A person's own app
          // with none opens as its main window alone, and drawing that window here read as a layout still being
          // there after it was removed.
          app && (app.builtin || layoutSet) && api.apps.tree(app.id) ? NODES.control("layout-tree", { control: "layoutpreview", tree: api.apps.tree(app.id), bare: true }) : null,
        ],
        [layoutSet ? { key: "clear", primary: true, icon: "x-lg", label: t("apps.action.clearLayout"), run: clear } : { key: "choose", primary: true, icon: "hand-index", label: t("apps.action.choose"), run: choose }],
        { empty: t(app ? "apps.value.noLayout" : "apps.value.chooseToMake") }
      );

      const values = app ? Object.entries(app.props || {}) : [];
      return [
          NODES.section("app", t("apps.section.app"), [ioCard], { hint: t("apps.hint") }),
          app
            ? NODES.section("details", t("apps.section.details"), [
                // A built-in app's name and icon are its type's: only its colour and its window layout are changed here.
                NODES.props("details", [
                  ...(app.builtin ? [] : [field("name", { type: "string", default: "" }, "mu.field.appName"), field("icon", { type: "icon", default: "" }, "mu.field.appIcon")]),
                  field("accent", core.ACCENT_SETTING, "mu.setting.accent"),
                  field("autoSave", { type: "boolean", default: true }, "mu.setting.autoSaveLayout"),
                ]),
              ])
            : null,
          NODES.section("layout", t("apps.section.layout"), [layoutCard]),
          app
            ? NODES.section(
                "values",
                t("apps.section.values"),
                values.length ? [NODES.props("values", values.map(([key, value]) => core.row(`v-${key}`, key, typeof value === "object" ? JSON.stringify(value) : String(value))))] : []
              )
            : null,
        ].filter(Boolean);
    },
  };

  return { "apps.editor": editor };
}
