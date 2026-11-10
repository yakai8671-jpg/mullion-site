/* Item Catalog -- what can be instantiated, and what it looks like.
 *
 * One card per item type, in a list card: its id, who provided it, what it
 * owns and holds. Which plugins loaded is the Plugin Status item's. A type that can be opened on its own has "Open" as its primary button: it
 * opens as an app that has not been kept (see placeAlone in core), where a
 * guide is clicked. One that cannot -- a picker, an owned editor -- is only
 * described.
 */

import { registerItemType } from "./deps.js";
import { NODES, row, t } from "./deps.js";

// What this file registers, once the modules it uses are handed in (index.js).
export function install() {
  registerItemType("catalog", {
    label: "mu.item.catalog",
    icon: "box-seam", // a screen of the Developer Tools item
    permissions: ["items:read", "items:write", "window:write", "layout:place"],
    properties: {
      // Narrowing the list by id or name.
      search: { label: "mu.prop.search", type: "string", control: "searchbox", default: "", placed: true },
    },

    body(api, item) {
      const needle = String(item.props.search || "").trim().toLowerCase();
      const all = api.items.types();
      const types = all.filter((type) => !needle || type.label.toLowerCase().includes(needle) || type.name.toLowerCase().includes(needle));
      const dash = t("mu.value.dash");

      const card = (type) => {
        return NODES.card(
          `type-${type.name}`,
          type.label,
          [
            NODES.props(`fields-${type.name}`, [
              row("id", t("mu.field.id"), type.name),
              row("source", t("mu.field.source"), type.source),
              row("standalone", t("mu.field.standalone"), t(type.standalone ? "mu.value.yes" : "mu.value.no")),
              row(
                "properties",
                t("mu.field.properties"),
                type.properties.map((prop) => `${prop.key}: ${prop.type}`).join(", ") || dash
              ),
              row("permissions", t("mu.field.permissions"), type.permissions.join(", ") || t("mu.value.none")),
              row("hooks", t("mu.field.hooks"), type.hooks.join(", ") || dash),
            ]),
          ],
          [
            ...(type.standalone
              ? [{ key: "open", primary: true, icon: "play-fill", label: t("mu.action.open"), title: t("mu.action.openAloneTitle", { type: type.name }), run: () => api.layout.startAlone(type.name) }]
              : []),
            { key: "apply", icon: "box-arrow-in-down", title: t("mu.action.applyTitle", { type: type.name }), run: () => api.window.setItem(api.items.create(type.name)) },
          ],
          { icon: type.icon }
        );
      };

      return [
        NODES.bar("find", [NODES.control("search", "search")]),
        NODES.section("types", t("mu.section.itemTypes", { n: types.length }), [
          NODES.listCard("types", types.map(card), { icon: "box-seam" }),
        ]),
      ];
    },
  });
}
