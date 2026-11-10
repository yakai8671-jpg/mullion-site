/* Property Catalog -- the value type registry, made readable.
 *
 * One card per value type, in a list card: its id, who provided it, how it
 * is parametrised, the controls that can edit it, a sample, and who uses it.
 * Which controls exist is the Control Catalog's.
 */

import { registerItemType } from "./deps.js";
import { NODES, openScreen, row, t } from "./deps.js";
import "./catalogentry.js";

// What this file registers, once the modules it uses are handed in (index.js).
export function install() {
  registerItemType("propcatalog", {
    label: "mu.item.propcatalog",
    icon: "tags", // a screen of the Developer Tools item
    permissions: ["props:read"],
    properties: {
      // Narrowing the list by id or name.
      search: { label: "mu.prop.search", type: "string", control: "searchbox", default: "", placed: true },
      types: { type: "list", each: { type: "catalog.entry" }, readonly: true, placed: true, read: (api) => api.props.types() },
    },

    body(api, item, ctx) {
      const needle = String(item.props.search || "").trim().toLowerCase();
      const types = ctx.get("types")
        .filter((type) => !type.legacy && (!needle || type.label.toLowerCase().includes(needle) || type.name.toLowerCase().includes(needle)));
      const dash = t("mu.value.dash");

      const card = (type) =>
        NODES.card(
          `type-${type.name}`,
          type.label,
          [
            NODES.props(`fields-${type.name}`, [
              row("id", t("mu.field.id"), type.name),
              row("source", t("mu.field.source"), type.source),
              row("params", t("mu.field.params"), type.params.join(", ") || dash),
              row("control", t("mu.field.control"), type.defaultControl || dash),
              row("controls", t("mu.field.accepts"), type.controls.join(", ") || dash),
              row(
                "sampleParams",
                t("mu.field.sampleParams"),
                Object.entries(type.sample)
                  .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
                  .join(", ") || dash
              ),
              row("sampleValue", t("mu.field.sampleValue"), type.sampleText),
              row("usedBy", t("mu.field.usedBy"), type.usedBy.join(", ") || t("mu.value.nothingYet")),
            ]),
          ],
          [{ key: "controls", icon: "toggles", title: t("mu.action.controlsForType", { type: type.label }), run: () => openScreen(ctx.windowId, "controlcatalog", { props: { valueType: type.name } }) }],
          { icon: "tags" }
        );

      return [
        NODES.listCard("types", types.map(card), { port: { item: item.id, key: "types" }, icon: "tags", bar: [NODES.control("search", "search")] }),
      ];
    },
  });
}
