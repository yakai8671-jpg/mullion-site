/* Developer Tools -- the shell's own test beds and reflection screens, in one
 * item instead of one launcher tile each.
 *
 * What a value type, a control or an item type is, what is alive in the
 * layout right now, and one property of every built-in type to try them on:
 * they are for whoever is building a plugin, not for a person using the shell,
 * so they are one entry among the tools rather than five. Each is an item of
 * its own, opened as a screen of this window -- one step along its path, with
 * the way back at the top -- and closed the same way.
 */

import { ITEM_TYPES, registerApp, registerItemType } from "./deps.js";
import { NODES, openScreen, t } from "./deps.js";

// In the order they are most wanted: the shape of what exists, then what is
// alive, then the place to try a value. The overlay shows the same things on
// the screen itself, so it follows the list of what is alive.
const SCREENS = ["catalog", "pluginstatus", "propcatalog", "controlcatalog", "inventory", "overlay", "input"];

// What this file registers, once the modules it uses are handed in (index.js).
export function install() {
  registerApp("devtools");
  registerItemType("devtools", {
    label: "mu.item.devtools",
    standalone: true,
    icon: "tools",
    permissions: [],
    properties: {},

    body(_api, _item, ctx) {
      const screens = SCREENS.filter((type) => ITEM_TYPES[type]);
      return [
        NODES.section("screens", t("mu.section.devtools", { n: screens.length }), [
          NODES.gallery(
            "screens",
            screens.map((type) => ({
              key: type,
              label: t(ITEM_TYPES[type].label),
              icon: ITEM_TYPES[type].icon || "tools",
              title: type,
              run: () => openScreen(ctx.windowId, type),
            })),
            "grid"
          ),
        ]),
      ];
    },
  });
}
