/* The placeholder a layout falls back to when the type an instance names is
 * not registered here -- almost always a plugin that is not installed.
 *
 * It exists so opening a layout is never destructive: the original type and
 * every property value are held untouched on `item.missing` and written back
 * on save, so installing the plugin restores the instance exactly.
 */

import { registerItemType } from "./deps.js";
import { NODES, row, t } from "./deps.js";

// What this file registers, once the modules it uses are handed in (index.js).
export function install() {
  registerItemType("core.missing", {
    label: "mu.item.missing",
    icon: "question-square",
    permissions: [],
    properties: {},

    body(api, item) {
      const parked = item.missing || { type: "?", props: {} };
      const values = Object.entries(parked.props);

      return [
        NODES.section("what", t("mu.section.missing"), [NODES.card("what" + "-content", "", [NODES.props("meta", [row("type", t("mu.field.type"), parked.type)])], [])], { hint: t("mu.value.missingExplain", { type: parked.type }) }),
        NODES.section("kept", t("mu.section.missingKept", { n: values.length }), [
          values.length
            ? NODES.props(
                "values",
                values.map(([key, value]) =>
                  row(key, key, typeof value === "object" ? JSON.stringify(value) : String(value))
                )
              )
            : null,
        ]),
      ];
    },
  });
}
