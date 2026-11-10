/* Item Inventory -- every live instance and its properties.
 *
 * One card per item, in a list card: which type it is, where it sits in
 * the tree of what owns what, which windows show it, and what it holds. An
 * item a window shows has "Show" as its primary button, which brings that
 * window forward.
 */

import { formatValue, registerItemType } from "./deps.js";
import { NODES, row, t } from "./deps.js";

// What this file registers, once the modules it uses are handed in (index.js).
export function install() {
  registerItemType("inventory", {
    label: "mu.item.inventory",
    icon: "list-ul", // a screen of the Developer Tools item
    permissions: ["items:read", "layout:place"],
    properties: {
      // Narrowing the list by id or type.
      search: { label: "mu.prop.search", type: "string", control: "searchbox", default: "", placed: true },
    },

    body(api, item) {
      // What an item holds, as one line: the properties with something in them.
      // A row each drew a thousand rows for a layout of a few dozen items, and
      // that was seconds; one line is what is looked for in a list anyway.
      const valuesOf = (entry) =>
        entry.properties
          .map((desc) => [desc.key, String(formatValue(desc) ?? "")])
          .filter(([, text]) => text && text !== "—")
          .map(([key, text]) => `${key}: ${text.length > 40 ? `${text.slice(0, 40)}…` : text}`)
          .join(", ");

      const needle = String(item.props.search || "").trim().toLowerCase();
      const items = api.items
        .list()
        .filter((entry) => !needle || entry.id.toLowerCase().includes(needle) || entry.type.toLowerCase().includes(needle));
      const dash = t("mu.value.dash");

      const card = (entry) =>
        NODES.card(
          `item-${entry.id}`,
          entry.id,
          [
            NODES.props(`fields-${entry.id}`, [
              row("id", t("mu.field.id"), entry.id),
              row("type", t("mu.field.type"), entry.type),
              row("windows", t("mu.field.windows"), entry.windows.join(", ") || t("mu.value.unused")),
              row("values", t("mu.field.values"), valuesOf(entry) || dash),
            ]),
          ],
          entry.windows.length
            ? [
                {
                  key: "show",
                  primary: true,
                  icon: "eye",
                  label: t("mu.action.reveal"),
                  title: t("mu.action.revealTitle", { id: entry.id }),
                  run: () => api.layout.reveal(entry.id),
                },
              ]
            : [],
          { icon: "box" }
        );

      return [
        NODES.bar("find", [NODES.control("search", "search")]),
        NODES.section("items", t("mu.section.liveItems", { n: items.length }), [
          NODES.listCard("items", items.map(card), { icon: "list-ul" }),
        ]),
      ];
    },
  });
}
