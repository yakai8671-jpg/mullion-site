/* Presets -- every type a preset can be kept of, reached from Home.
 *
 * The chooser is normally opened from a property, and offers what fits it.
 * This is the way in with no property in hand: pick what kind of value --
 * a vector, a prompt part, run settings -- and the chooser opens on that
 * type, one step along the same window. There it browses what is saved,
 * and its first tile makes a new one.
 */

import { ICONS, registerItemType } from "./deps.js";
import { NODES, openScreen, t } from "./deps.js";

// What this file registers, once the modules it uses are handed in (index.js).
export function install() {
  registerItemType("presetlist", {
    label: "mu.item.presetlist",
    // Opened from Home's own tile, never from the launcher list.
    icon: ICONS.preset,
    permissions: ["props:read", "store:read"],
    properties: {
      view: {
        label: "mu.prop.dashboard.view",
        type: "enum",
        control: "segments",
        default: "grid",
        options: () => [
          { value: "grid", label: t("mu.opt.viewGrid"), icon: "grid-3x2-gap-fill" },
          { value: "list", label: t("mu.opt.viewList"), icon: "list-ul" },
        ],
        placed: true,
      },
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
      const counts = new Map(api.store.types().map((one) => [one.type, one.count]));
      // Every type a value can be kept of. One that holds item ids would
      // only point back into this layout, so it says it is not storable and
      // is left out. Those with something saved come first: they are the
      // ones being used.
      const types = api.props
        .types()
        .filter((type) => type.storable)
        .filter((type) => !needle || type.label.toLowerCase().includes(needle) || type.name.toLowerCase().includes(needle))
        .sort((a, b) => (counts.get(b.name) || 0) - (counts.get(a.name) || 0) || a.label.localeCompare(b.label));
      const view = item.props.view === "list" ? "list" : "grid";

      return [
        NODES.bar("find", [NODES.control("search", "search"), NODES.control("view", "view")]),
        NODES.section("types", t("mu.section.presetTypes", { n: types.length }), [
          types.length
            ? NODES.gallery(
                "types",
                types.map((type) => {
                  const n = counts.get(type.name) || 0;
                  return {
                    key: type.name,
                    label: n ? `${type.label} (${n})` : type.label,
                    icon: type.icon || ICONS.preset,
                    title: `${type.name} · ${t("mu.value.entries", { n })}`,
                    run: () => openScreen(ctx.windowId, "chooser", { props: { type: type.name } }),
                  };
                }),
                view
              )
            : null,
        ]),
      ];
    },
  });
}
