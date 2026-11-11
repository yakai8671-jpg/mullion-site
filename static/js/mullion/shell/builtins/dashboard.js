/* Mullion Home (type id `dashboard`) -- one place to reach everything that can go in a window.
 *
 * It is nothing but a launcher for apps, set out in the groups a person made
 * (the Home Editor). What an item type is -- and whether it can be opened on
 * its own at all -- is the Item Catalog's to say, not Home's.
 *
 * Picking one does not open it anywhere in particular. It puts the shell
 * into placement -- every window offers its guides -- and where you click is
 * where the window lands. The alternative was for the launcher to decide,
 * which meant a "split direction" setting that had to be changed before
 * every launch that did not match it.
 */

import { ICONS, registerApp, registerItemType } from "./deps.js";
import { defaultHomeGroups, homeGroups } from "./home.js";
import { NODES, openScreen, t } from "./deps.js";

// What this file registers, once the modules it uses are handed in (index.js).
export function install() {
  registerApp("dashboard", { home: "mullion", homeOrder: 10 });
  registerItemType("dashboard", {
    label: "mu.item.dashboard",
    standalone: true,
    icon: "grid-3x3-gap",
    // items:read and apps:read to know what exists, layout:place to ask
    // where it goes.
    permissions: ["items:read", "apps:read", "layout:place"],
    properties: {
      // Icons or rows. Which one reads better depends on how many types are
      // installed and how wide the window is, so it is a choice rather than a
      // decision -- and it is authored state, so it is saved.
      view: {
        label: "mu.prop.dashboard.view",
        type: "enum",
        control: "segments",
        default: "grid",
        // Both options carry an icon, so the unchosen one shrinks to it.
        options: () => [
          { value: "grid", label: t("mu.opt.viewGrid"), icon: "grid-3x2-gap-fill" },
          { value: "list", label: t("mu.opt.viewList"), icon: "list-ul" },
        ],
        // Placed at the top beside the layout switch, as the chooser does:
        // both are about the list directly under them.
        placed: true,
      },
      // Narrowing the list by name. Drawn by the search control, which says
      // what it is for with a magnifier rather than a placeholder.
      search: {
        label: "mu.prop.search",
        type: "string",
        control: "searchbox",
        default: "",
        placed: true,
      },
    },

    body(api, item, ctx) {
      const needle = String(item.props.search || "").trim().toLowerCase();
      const view = item.props.view === "list" ? "list" : "grid";

      // The apps: each opened as itself, where a guide is clicked. Set out
      // in the groups the Home Editor made, or -- as Home comes -- in the default ones.
      const all = api.apps.list();
      const running = new Set(api.apps.running());
      const known = new Map(all.map((app) => [app.id, app]));
      const found = (app) => !needle || app.name.toLowerCase().includes(needle) || app.type.toLowerCase().includes(needle);
      const groups = homeGroups() || defaultHomeGroups();
      // An app that is in none of the groups Home was set out in -- one that came
      // after the groups were made, or was left out -- is still an app: it is
      // shown after them, so a new app is never nowhere to be found.
      const grouped = new Set((groups || []).flatMap((group) => group.apps));
      const leftOut = groups ? all.filter((app) => !grouped.has(app.id)).map((app) => app.id) : [];
      const sections = groups && leftOut.length ? [...groups, { id: "left-out", name: t("mu.home.leftOut"), apps: leftOut }] : groups;
      const appSections = (sections || [{ id: "", name: "", apps: all.map((app) => app.id) }])
        .map((group, index) => {
          const apps = group.apps.map((id) => known.get(id)).filter(Boolean).filter(found);
          if (needle && !apps.length) return null;
          const title = sections ? `${group.name || t("mu.home.unnamed")} (${apps.length})` : t("mu.section.apps", { n: apps.length });
          return NODES.section(`app-${group.id || index}`, title, [
            apps.length
              ? NODES.gallery(
                  "apps",
                  apps.map((app) => ({
                    key: app.id,
                    label: app.name,
                    icon: app.icon || "window",
                    // Its colour on the icon; the tile itself lit in it
                    // only while the app is open.
                    tint: app.accent || "",
                    lit: running.has(app.id),
                    title: t("mu.action.launchTitle", { type: app.name }),
                    run: () => api.layout.startApp(app.id),
                  })),
                  view
                )
              : null,
          ]);
        })
        .filter(Boolean);

      // The library, beside what can be launched: not a window of its own
      // but a screen in this one, so it opens here rather than asking where
      // to go -- the list of preset types, and from there the chooser.
      const presetsLabel = t("mu.item.presetlist");
      const library =
        !needle || presetsLabel.toLowerCase().includes(needle)
          ? NODES.section("library", t("mu.section.library"), [
              NODES.gallery(
                "library",
                [
                  {
                    key: "presets",
                    label: presetsLabel,
                    icon: ICONS.preset,
                    title: t("mu.action.openPresetsTitle"),
                    run: () => openScreen(ctx.windowId, "presetlist"),
                  },
                ],
                view
              ),
            ])
          : null;
      const shown = [...appSections, library].filter(Boolean);

      return [
        // What to look for and how to lay out what turns up, on one line at
        // the top -- the same bar the preset chooser opens with.
        // At its right end, the way to set Home out: the Home Editor, one
        // step along this window.
        NODES.bar("find", [
          NODES.control("search", "search"),
          NODES.control("view", "view"),
          NODES.control("edit", { control: "iconbutton", icon: "pencil-square", title: t("mu.home.edit"), run: () => openScreen(ctx.windowId, "homeeditor") }),
        ]),
        ...shown,
      ];
    },
  });
}
