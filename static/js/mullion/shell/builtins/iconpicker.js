/* Icon picker (type id `iconpicker`) -- every icon there is, to choose one.
 *
 * Opened by an icon card's "choose" (see openIconPicker in core), one step
 * along that window's path, holding a grant to the one property it was
 * opened for -- the chooser's arrangement, with every Bootstrap icon as the
 * presets. Picking one writes it through the grant and steps back.
 */

import { registerItemType } from "./deps.js";
import { NODES, iconNames, row, t } from "./deps.js";

// Drawn at most at once: the whole set is two thousand tiles, and a search
// narrows it to what is wanted far sooner than scrolling would.
const SHOWN = 600;

// What this file registers, once the modules it uses are handed in (index.js).
export function install() {
  registerItemType("iconpicker", {
    label: "mu.item.iconpicker",
    icon: "grid-3x3-gap",
    permissions: ["grant:write", "window:write"],
    properties: {
      search: { label: "mu.prop.search", type: "string", control: "searchbox", default: "", placed: true },
    },

    body(api, item) {
      const target = api.grant.target();
      const current = target && typeof target.value === "string" ? target.value : "";
      const needle = String(item.props.search || "").trim().toLowerCase();
      const names = iconNames().filter((name) => !needle || name.includes(needle));
      const shown = names.slice(0, SHOWN);
      const take = (name) => {
        if (api.grant.set(name)) api.window.back();
      };
      return [
        NODES.bar("find", [NODES.control("search", "search")]),
        NODES.section("icons", t("mu.section.iconsN", { n: names.length }), [
          shown.length
            ? NODES.gallery(
                "icons",
                shown.map((name) => ({ key: name, label: name, icon: name, title: name, active: name === current, run: () => take(name) })),
                "grid"
              )
            : null,
          names.length > shown.length ? NODES.props("more", [row("more", t("mu.field.moreIcons"), names.length - shown.length)]) : null,
        ]),
      ];
    },
  });
}
