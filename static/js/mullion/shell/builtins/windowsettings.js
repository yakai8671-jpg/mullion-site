/* Window Settings (type id `windowsettings`) -- what a window is, and how
 * the thing in it is set up.
 *
 * Opened by clicking a window's id (see openWindowSettings in core), one
 * step along that window's path, and closed the same way or by the crumbs.
 * It is three things, top to bottom:
 *
 *   the app                                 when the window (or group) is an
 *                                           app's frame: its name, icon and
 *                                           colour, and where its windows go
 *                                           -- the app's own, so a change
 *                                           here is every frame of it
 *   the settings of what the window shows   per type, kept in the profile:
 *                                           the item's own type's, then each
 *                                           owner's above it
 *   the window itself                       the facts the id used to show
 *                                           in a popup
 *
 * Nothing here is the window's own state. A setting is the type's, so
 * changing it in one window changes it in every window of that type, and
 * in the next one opened.
 */

import { ITEM_TYPES, describe, grantApi, registerItemType, registerValueType, barHas } from "./deps.js";
import { ACCENT_SETTING, NODES, TITLE_TOOLS, TITLE_TOOL_ICONS, appDef, captureLaunchLayout, closeScreen, findLeaf, getItem, inferredAppOf, itemLabel, leafIds, reopenApp, resetApp, windowEl, row, setApp, setToolShown, setTypeSetting, shownBeneathSettings, t, toolShown, typeSettingValue, typeSettingsOf } from "./deps.js";

const isRecord = (value) => !!value && typeof value === "object" && !Array.isArray(value);
const isPlainObject = isRecord;
const record = (value) => (isRecord(value) ? value : {});
const appLabelOf = (type) => (type && ITEM_TYPES[type] ? t(ITEM_TYPES[type].label) : "");

// A launch layout, saved: the app it is for and the layout. Grouped by app,
// which is how the picker narrows to the layouts that fit the app it was
// opened from.

// One type's settings, as editors that read and write the profile.
function settingRows(item, type) {
  return Object.entries(typeSettingsOf(type)).map(([key, spec]) =>
    describe(
      {
        ...spec,
        read: () => typeSettingValue(type, key, spec.default),
        write: (_api, value) => setTypeSetting(type, key, value),
      },
      { key: `${item.id}-${type}-${key}`, label: t(spec.label) }
    )
  );
}

// Whose settings the window offers: the item's own.
function ownersOf(target) {
  return target ? [target] : [];
}

// Each window of a launch layout, named by the item it would show in this
// app -- which is what it will show in a new one too.
function namedLayout(app, spec) {
  const iconOf = (entry) => (ITEM_TYPES[entry.type] || {}).icon || "window";
  const named = (one) => {
    const collapsed = Boolean(one && one.collapsed);
    if (one === "self" || (one && one.self === true)) {
      return { label: itemLabel(app.id), icon: iconOf(app), collapsed };
    }
    // An old layout's window of something the app owned: it names nothing now.
    if (one && typeof one.owned === "string") {
      return { label: one.owned, icon: "question-square", missing: true, collapsed };
    }
    // A window added by hand: a new one of its type each time.
    if (one && typeof one.add === "string") {
      const def = ITEM_TYPES[one.add];
      return def
        ? { label: t(def.label), icon: def.icon || "window", collapsed }
        : { label: one.add, icon: "question-square", missing: true, collapsed };
    }
    // An app inside the app: by its name.
    if (one && typeof one.app === "string") {
      const inner = appDef(one.app);
      return inner
        ? { label: inner.name, icon: inner.icon || "window", collapsed }
        : { label: one.app, icon: "question-square", missing: true, collapsed };
    }
    // A bay: its name, and a line per sash -- what the sash holds, its
    // windows' names joined.
    if (isPlainObject(one) && isPlainObject(one.bay)) {
      const lines = (Array.isArray(one.bay.sashes) ? one.bay.sashes : [])
        .map((sash) => (sash ? named(sash) : null))
        .filter(Boolean)
        .map((tree) => {
          const panes = [];
          (function collect(node) {
            if (node.children) node.children.forEach(collect);
            else panes.push(node);
          })(tree);
          return { label: panes.map((pane) => pane.label).join(" · "), icon: panes[0].icon, missing: panes.some((pane) => pane.missing) };
        });
      return { bay: { label: one.bay.name || t("mu.item.bayslot"), items: lines }, collapsed };
    }
    if (one && Array.isArray(one.children)) {
      const kids = one.children.map(named);
      if (kids.length === 1) return kids[0];
      // A list of more than two is right-leaning, as the shell builds it.
      const fold = (list, dir, ratio) =>
        list.length === 1
          ? list[0]
          : { dir, ratio: list.length === 2 && ratio ? ratio : 1 / list.length, children: [list[0], fold(list.slice(1), dir)] };
      return fold(kids, one.dir === "col" ? "col" : "row", Number(one.ratio) || 0);
    }
    return { label: "?", icon: "question-square", missing: true };
  };
  return named(spec);
}

// A launch layout's links as lines to read: "Preview · Input ← Image
// Generation · Output pictures", each end named by the item it would be in
// this app and its property's label.
function namedLinks(app, spec) {
  const list = spec && typeof spec === "object" && Array.isArray(spec.links) ? spec.links : [];
  const at = (path) => {
    if (path === "self") return app;
    let entry = app;
    for (const key of path.split(".")) {
      const id = entry ? entry.props[key] : null;
      entry = typeof id === "string" ? getItem(id) : null;
    }
    return entry;
  };
  // Windows added by type, by tag: named by their type.
  const added = new Map();
  (function walk(node) {
    if (node && typeof node === "object" && typeof node.add === "string" && node.tag) added.set(node.tag, node.add);
    if (node && Array.isArray(node.children)) node.children.forEach(walk);
  })(spec);
  const end = (one) => {
    if (one.at.startsWith("+")) {
      const type = added.get(one.at.slice(1));
      const def = type && ITEM_TYPES[type];
      if (!def) return { text: `${one.at} · ${one.key}`, missing: true };
      const prop = (def.properties || {})[one.key];
      return { text: `${t(def.label)} · ${prop ? t(prop.label) : one.key}`, missing: false };
    }
    const entry = at(one.at);
    if (!entry) return { text: `${one.at} · ${one.key}`, missing: true };
    const spec2 = ((ITEM_TYPES[entry.type] || {}).properties || {})[one.key];
    return { text: `${itemLabel(entry.id)} · ${spec2 ? t(spec2.label) : one.key}`, missing: false };
  };
  return list.map((one) => {
    const to = end(one.to);
    const from = end(one.from);
    return { to: to.text, from: from.text, missing: to.missing || from.missing };
  });
}

// The app a frame is: its name, icon and colour, and where its windows go.
// Every edit is the app's, so it reaches every frame of it at once.
function appSection(item, frame, app, main, ctx) {
  const failed = (error) => ctx.status(String(error.message || error));
  const field = (key, spec, label) =>
    describe(
      {
        ...spec,
        read: () => (appDef(app.id) || app)[key],
        write: (_api, value) => {
          try {
            setApp(app.id, { [key]: value }).catch(failed);
          } catch (error) {
            failed(error);
          }
        },
      },
      { key: `${item.id}-app-${key}`, label: t(label) }
    );
  // A built-in app's name and icon are its type's: only its colour and
  // where its windows go are changed here.
  const nodes = [
    NODES.props("app", [
      ...(app.builtin
        ? []
        : [field("name", { type: "string", default: "" }, "mu.field.appName"), field("icon", { type: "icon", default: "" }, "mu.field.appIcon")]),
      field("accent", ACCENT_SETTING, "mu.setting.accent"),
    ]),
  ];
  if (frame.type === "group" && main) {
    const layout = app.layout;
    nodes.push(
      NODES.props("layout-auto", [field("autoSave", { type: "boolean", default: true }, "mu.setting.autoSaveLayout")]),
      NODES.control("layout", {
        control: "layoutpreview",
        tree: layout ? namedLayout(main, layout) : null,
        links: layout ? namedLinks(main, layout) : [],
        linksTitle: t("mu.field.layoutLinks"),
        note: t(app.builtin ? (app.overridden ? "mu.value.appOverridden" : "mu.value.layoutDefault") : "mu.value.appOwn"),
        actions: [
          {
            key: "take",
            icon: "window-split",
            title: t("mu.action.takeLayout"),
            disabled: !captureLaunchLayout(main.id),
            run: () => {
              const now = captureLaunchLayout(main.id);
              if (!now) return ctx.status(t("mu.status.noFrame"));
              setApp(app.id, { layout: now })
                .then(() => ctx.status(t("mu.status.layoutTaken")))
                .catch(failed);
            },
          },
        ],
      })
    );
  }
  // Only core/plugin apps have a provider default to restore. A personal app
  // is a fixed copy, so there is no outside definition to reset it to.
  if (main && app.builtin) {
    nodes.push(
      NODES.actions("layout-default", [
        {
          key: "reset-app",
          label: t("mu.action.resetApp"),
          title: t("mu.action.resetAppTitle"),
          confirm: {
            title: t("mu.confirm.resetAppTitle", { name: app.name }),
            message: t("mu.confirm.resetAppBody", { name: app.name }),
            okText: t("mu.confirm.resetAppOk"),
            danger: true,
          },
          // Back to the defaults, and the app opened again as they have it: what is on screen was
          // made with the settings that were just taken away.
          run: () =>
            resetApp(app.id)
              .then(() => {
                reopenApp(frame);
                // The settings are of what was reset: opening the app again puts it in their place; where it
                // could not be opened again, they are closed all the same.
                if (findLeaf(ctx.windowId)) {
                  closeScreen(ctx.windowId);
                  ctx.status(t("mu.status.appReset"));
                }
              })
              .catch(failed),
        },
      ])
    );
  }
  return NODES.section("app", t("mu.section.appOf", { name: app.name }), nodes);
}

// Which of the title bar's own buttons this window wears. The window's, not
// the type's: it is kept with the window in the layout. Only the ones the bar
// has -- the sash moves are there only for a window in a bay.
function toolCards(frame) {
  const onBar = (tool) => {
    if (tool !== "prevSash" && tool !== "nextSash") return true;
    return barHas(frame.id, `${tool === "prevSash" ? "prev" : "next"}-sash`);
  };
  return TITLE_TOOLS.filter(onBar).map((tool) => ({
    key: tool,
    icon: TITLE_TOOL_ICONS[tool],
    label: t(`mu.tool.${tool}`),
    on: toolShown(frame.id, tool),
    set: (value) => setToolShown(frame.id, tool, value),
  }));
}

// What the id used to say in its popup.
function factRows(item, frame, target) {
  const rows = [row("window", t("mu.field.window"), frame.id)];
  if (frame.type === "group") {
    // A group is a frame, so what it is is what it frames: the windows
    // inside it, in the order the tree holds them.
    const inside = leafIds(frame);
    rows.push(row("windows", t("mu.field.windows"), inside.length));
    for (const wid of inside) {
      const leaf = findLeaf(wid);
      const shown = leaf ? shownBeneathSettings(leaf) : "";
      rows.push(row(`w-${wid}`, wid, shown ? itemLabel(shown) : t("mu.value.dash")));
    }
    return rows;
  }
  if (!target) return [...rows, row("item", t("mu.field.item"), t("mu.value.dash"))];
  rows.push(
    row("item", t("mu.field.item"), itemLabel(target.id)),
    row("id", t("mu.field.id"), target.id),
    row("type", t("mu.field.type"), target.type)
  );
  const at = frame.path.indexOf(target.id);
  if (at > 0) rows.push(row("path", t("mu.field.path"), frame.path.slice(0, at + 1).join(" › ")));
  // A type may add what only it knows -- the chooser, what it is choosing
  // for -- asked for through the item's own API.
  const def = ITEM_TYPES[target.type];
  if (def && def.facts) {
    const api = grantApi(def, { windowId: frame.id, itemId: target.id });
    (def.facts(api, target) || []).forEach((fact, index) => rows.push(row(`fact-${index}`, fact.label, fact.value)));
  }
  return rows;
}

// What the item's type declared it may do ("items:read", "store:write"...):
// the powers the item has, since every call it makes is checked against these.
// One line to a namespace, its verbs beside it.
function permissionRows(target) {
  const def = target && ITEM_TYPES[target.type];
  const byNamespace = new Map();
  for (const name of (def && def.permissions) || []) {
    const [space, verb] = String(name).split(":");
    byNamespace.set(space, [...(byNamespace.get(space) || []), verb]);
  }
  return [...byNamespace].map(([space, verbs]) => row(`permission-${space}`, space, verbs.join(", ")));
}

// What this file registers, once the modules it uses are handed in (index.js).
export function install() {
  registerValueType("launchlayout", {
    label: "mu.vtype.launchlayout",
    icon: "grid-1x2",
    params: ["default"],
    sample: { default: { app: "", layout: "self" } },
    defaultControl: "summary",
    defaultValue: (p) => record(p.default),
    coerce: (value) => record(value),
    groups: { label: "mu.field.app", of: (value) => appLabelOf(record(value).app) },
    format: (value) => appLabelOf(record(value).app) || t("mu.vtype.launchlayout"),
  });
  registerItemType("windowsettings", {
    label: "mu.item.windowSettings",
    icon: "gear",
    properties: {
      // Set once by the shell when it is opened. Not offered as editors:
      // pointing it at another window would not move it there.
      frame: { label: "mu.prop.windowSettings.frame", type: "string", readonly: true, placed: true },
      target: { label: "mu.prop.windowSettings.target", type: "ref", readonly: true, placed: true },
    },

    body(_api, item, ctx) {
      const frame = findLeaf(item.props.frame);
      if (!frame) return [NODES.section("gone", "", [], { empty: t("mu.value.windowGone") })];
      const target = getItem(item.props.target);

      const settings = target
        ? ownersOf(target)
            .map((one) => ({ one, rows: settingRows(item, one.type) }))
            .filter(({ rows }) => rows.length)
            .map(({ one, rows }) =>
              NODES.section(`type-${one.type}`, t("mu.section.typeSettings", { type: itemLabel(one.id) }), [
                NODES.props(`type-${one.type}`, rows),
              ])
            )
        : [];
      // An app's frame -- a group, or a one-window app's window: the app.
      // A group made by hand has no app of its own; if it holds windows of one
      // app and nothing else, that app is what it shows.
      const app = frame.app ? appDef(frame.app) : inferredAppOf(frame);
      const main = frame.type === "group" ? getItem(frame.appItem) : getItem(frame.path[0]);
      const appNodes = app ? appSection(item, frame, app, main, ctx) : null;

      return [
        appNodes,
        ...settings,
        !settings.length && !appNodes ? NODES.section("none", "", [], { empty: t("mu.value.noTypeSettings") }) : null,
        NODES.section("tools", t("mu.section.titleTools"), [NODES.control("tools", { control: "toolcards", items: toolCards(frame) })]),
        NODES.section("facts", t("mu.section.windowFacts"), [NODES.props("facts", factRows(item, frame, target))]),
        target && ITEM_TYPES[target.type]
          ? NODES.section("permissions", t("mu.section.permissions"), permissionRows(target).length ? [NODES.props("permissions", permissionRows(target))] : [], {
              empty: t("mu.value.none"),
            })
          : null,
      ];
    },
  });
}
