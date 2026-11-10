/* Home Editor (type id `homeeditor`) -- how Mullion Home sets out the apps.
 *
 * Opened from Home's own bar, one step along Home's window. Home's apps
 * are named groups (see "Home's groups" in core), and this is them as
 * cards inside a card: the list of groups, each group the list of its
 * apps. An app is added to a group by carrying one onto the group's add
 * button (from the App List, or from another group) or by pressing it,
 * which opens the preset picker over every app. An app's card is only
 * its grip, to put it in order within its group or carry it elsewhere,
 * and its close button. "Back to the default" puts Home back as it comes.
 */

import { describe, registerItemType, registerValueType } from "./deps.js";
import { NODES, appDef, appList, defaultHomeGroups, homeGroups, openValuePicker, setHomeGroups, t } from "./deps.js";

// Home's groups as they are now: the edited ones, or Home as it comes.
const current = () => homeGroups() || defaultHomeGroups();

// A change to the groups: made to a copy of the current ones and saved.
// The first edit of Home as it comes saves it as groups from then on.
function edit(change) {
  const groups = current().map((one) => ({ ...one, apps: [...one.apps] }));
  change(groups);
  setHomeGroups(groups);
}

function addApp(groupId, appId) {
  if (!appId || !appDef(appId)) return false;
  edit((groups) => {
    const group = groups.find((one) => one.id === groupId);
    if (group && !group.apps.includes(appId)) group.apps.push(appId);
  });
  return true;
}

// An app, as a value worth carrying: the app itself, with its id -- what
// the App List's cards carry, so one dropped on the App Editor opens it.
const appValue = (id) => {
  const app = appDef(id);
  if (!app) return {};
  const { builtin: _b, overridden: _o, layoutChanged: _l, oneWindow: _w, ...value } = app;
  return value;
};

const hasId = (one) => Boolean(one && one.id);

// A group is carried as a group, to be put in order among the others; nothing
// is put into one.

// An app in a group: carried as the app itself, and put in order among the
// apps of its own group only.

// An app by its id, chosen in the preset picker: what it offers is every
// app there is, built-in and your own -- none of them kept as a preset.

const entryId = (groupId, appId) => `${groupId}:${appId}`;

// What this file registers, once the modules it uses are handed in (index.js).
export function install() {
  registerValueType("home.group", {
    label: "mu.vtype.homeGroup",
    icon: "collection",
    storable: false,
    presetNew: false,
    identity: "id",
    portKindOf: () => "home.group",
    portReceive: false,
    params: ["default"],
    sample: { default: { id: "g0", name: "group", apps: [] } },
    defaultControl: "summary",
    defaultValue: () => ({ id: "", name: "", apps: [] }),
    coerce: (value) => (hasId(value) ? value : { id: "", name: "", apps: [] }),
    coerceList: (value) => (Array.isArray(value) ? value.filter(hasId) : []),
    list: { storable: false, label: "mu.vtype.homeGroups", icon: "collection" },
    format: (value) => (value && value.name) || "\u2014",
  });
  registerValueType("home.entry", {
    label: "mu.vtype.homeEntry",
    icon: "app-indicator",
    storable: false,
    presetNew: false,
    identity: "id",
    portKindOf: () => "app",
    portReceive: false,
    portRead: (one) => appValue(one.app),
    portGroup: (one) => one.group,
    params: ["default"],
    sample: { default: { id: "g0:a0", group: "g0", app: "a0" } },
    defaultControl: "summary",
    defaultValue: () => ({ id: "", group: "", app: "" }),
    coerce: (value) => (hasId(value) ? value : { id: "", group: "", app: "" }),
    coerceList: (value) => (Array.isArray(value) ? value.filter(hasId) : []),
    list: { storable: false, label: "mu.vtype.homeEntries", icon: "app-indicator" },
    format: (value) => (value && value.id) || "\u2014",
  });
  registerValueType("homeapp", {
    base: "string",
    label: "mu.vtype.homeApp",
    icon: "app-indicator",
    sample: { default: "" },
    port: false,
    // Every app is offered; there is no app to keep as a preset of this.
    presetNew: false,
    offers: () => appList().map((app) => ({ id: `app:${app.id}`, name: app.name, value: app.id })),
    format: (value) => (appDef(value) || {}).name || String(value || ""),
  });
  registerItemType("homeeditor", {
    label: "mu.item.homeEditor",
    icon: "pencil-square",
    properties: {
      groups: {
        label: "mu.vtype.homeGroups",
        type: "list", each: { type: "home.group" },
        placed: true,
        storable: false,
        read: () => current(),
        write: (_api, value) => {
          const known = new Map(current().map((one) => [one.id, one]));
          setHomeGroups((Array.isArray(value) ? value : []).map((one) => known.get(one.id) || one));
        },
      },
      entries: {
        label: "mu.vtype.homeEntries",
        type: "list", each: { type: "home.entry" },
        placed: true,
        storable: false,
        read: () => current().flatMap((group) => group.apps.map((app) => ({ id: entryId(group.id, app), group: group.id, app }))),
        // Put in order: each group's apps as the list now has them.
        write: (_api, value) => {
          const list = Array.isArray(value) ? value : [];
          edit((groups) => {
            for (const group of groups) {
              group.apps = list.filter((one) => one.group === group.id).map((one) => one.app);
            }
          });
        },
      },
    },

    body(_api, item, ctx) {
      const groups = current();
      const edited = Boolean(homeGroups());

      const newGroup = async () => {
        const name = String((await ctx.prompt(t("mu.home.groupName"), { title: t("mu.home.newGroup"), value: "" })) || "").trim();
        if (!name) return;
        edit((all) => {
          let n = all.length + 1;
          while (all.some((one) => one.id === `g${n}`)) n += 1;
          all.push({ id: `g${n}`, name, apps: [] });
        });
      };

      const appCard = (group) => (appId) => {
        const app = appDef(appId);
        return NODES.card(`app-${group.id}-${appId}`, app.name, [], [], {
          side: true,
          icon: app.icon || "window",
          port: { item: item.id, key: "entries", path: [entryId(group.id, appId)] },
          onDiscard: () =>
            edit((all) => {
              const own = all.find((one) => one.id === group.id);
              if (own) own.apps = own.apps.filter((id) => id !== appId);
            }),
        });
      };

      const groupCard = (group) => {
        const apps = group.apps.filter((id) => appDef(id));
        // The picker writes the app chosen into this group.
        const pick = describe(
          { type: "homeapp", default: "", read: () => "", write: (_api, value) => addApp(group.id, String(value || "")) },
          { key: `add-${group.id}`, label: t("mu.home.addApp") }
        );
        const rename = async () => {
          const name = String((await ctx.prompt(t("mu.home.groupName"), { title: t("mu.home.rename"), value: group.name })) || "").trim();
          if (!name) return;
          edit((all) => {
            const own = all.find((one) => one.id === group.id);
            if (own) own.name = name;
          });
        };
        return NODES.card(
          `group-${group.id}`,
          group.name || t("mu.home.unnamed"),
          apps.map(appCard(group)),
          [{ key: "rename", icon: "pencil", title: t("mu.home.rename"), run: rename }],
          {
            icon: "folder",
            port: { item: item.id, key: "groups", path: [group.id] },
            add: {
              label: t("mu.home.addApp"),
              run: (button) => openValuePicker(pick, button),
              accepts: ["app"],
              put: (value) => {
                if (!addApp(group.id, value && value.id)) ctx.status(t("mu.home.notAnApp"));
              },
            },
            onDiscard: async () => {
              if (apps.length) {
                const ok = await ctx.confirm(t("mu.home.confirmRemove", { name: group.name }), { title: group.name, danger: true });
                if (!ok) return;
              }
              edit((all) => {
                const at = all.findIndex((one) => one.id === group.id);
                if (at >= 0) all.splice(at, 1);
              });
            },
          }
        );
      };

      return [
        NODES.section("groups", t("mu.home.groups", { n: groups.length }), [
            NODES.listCard("groups",
              groups.map(groupCard), { tools: [
                {
                  key: "reset",
                  icon: "arrow-counterclockwise",
                  title: t("mu.home.reset"),
                  disabled: !edited,
                  run: () => {
                    setHomeGroups(null);
                    ctx.status(t("mu.home.wasReset"));
                  },
                },
              ], icon: "collection",
                add: { label: t("mu.home.newGroup"), run: newGroup } }),
          ], { hint: t("mu.home.hint") }),
      ];
    },
  });
}
