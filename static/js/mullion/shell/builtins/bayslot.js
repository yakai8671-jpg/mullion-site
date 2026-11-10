/* Bay slot (type id `bayslot`) -- what a bay shows while its active sash
 * holds no window.
 *
 * Only a place to drop windows on: a window put beside it, or traded for
 * it, is inside the bay and so in the active sash, and the shell takes the
 * placeholder away (normalizeBays). It is made and removed by the shell,
 * never by hand -- closing it takes the bay off screen. `bay` names the
 * bay it stands in, which the shell keeps right.
 */

import { registerItemType } from "./deps.js";
import { NODES, t } from "./deps.js";

// What this file registers, once the modules it uses are handed in (index.js).
export function install() {
  registerItemType("bayslot", {
    label: "mu.item.bayslot",
    icon: "bay",
    permissions: ["bays:read"],
    properties: {
      bay: { label: "mu.item.bayslot", type: "string", default: "", readonly: true, placed: true },
    },
    body(api, item) {
      const bay = api.bays.get(item.props.bay);
      const sash = bay && bay.sashes.find((one) => one.active);
      return [
        NODES.section("slot", bay ? t("mu.bay.slotAt", { bay: bay.name, sash: sash ? sash.name : "—" }) : t("mu.item.bayslot"), [], { empty: t(sash ? "mu.bay.slotEmpty" : "mu.bay.slotNoSash") }),
      ];
    },
  });
}
