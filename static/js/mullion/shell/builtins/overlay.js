/* Overlay -- the items, controls and values on the screen, drawn over it.
 *
 * A screen of the Developer Tools item, and an app of its own. While its
 * window is open every item, control and value that is showing is outlined and
 * named where it sits, so what a screen is made of can be read off the screen
 * itself rather than out of the inventory.
 *
 * It looks like the guides a move or a drop offers (a dashed frame, a tint,
 * a name in a small dashed tag) and, unlike them, it is only to be looked at:
 * the layer takes no pointer, so every click, drag and key goes through it to
 * what is underneath, as if it were not there.
 *
 *   item     a `.mu-item`: what a window shows, named by its type and id
 *   control  a control a body placed, or the one a property row is drawn with
 *   value    a port -- anything with a grip, named by the property it is of
 *
 * The drawing is view's (shell/view/overlay.js). The layer is one element on the page, outside the stage, so that drawing it
 * is not itself a change to what it watches. It lives exactly as long as a
 * window shows this item with "overlay" switched on.
 */

import { ITEM_TYPES, registerApp, registerItemType } from "./deps.js";
import { NODES, getItem, hideOverlay, overlayCounts, row, showOverlay, t } from "./deps.js";

const mounted = new Map(); // windowId -> ctx of each window showing the item

// What the (latest) window showing the item says, read from the item itself.
function settings() {
  let item = null;
  for (const ctx of mounted.values()) item = getItem(ctx.item.id) || ctx.item;
  if (!item) return null;
  const props = item.props || {};
  const on = (key) => props[key] !== false;
  return { active: on("active"), items: on("items"), controls: on("controls"), values: on("values"), names: on("names") };
}

// Running while a window shows the item with the overlay on; told again at
// every redraw of the item, which is also how a changed switch gets here.
function sync() {
  const shown = settings();
  if (shown && shown.active) showOverlay(settings, () => mounted.forEach((ctx) => ctx.refresh()));
  else hideOverlay();
}

// What this file registers, once the modules it uses are handed in (index.js).
export function install() {
  registerApp("overlay");
  registerItemType("overlay", {
    label: "mu.item.overlay",
    standalone: true,
    icon: "bounding-box", // a screen of the Developer Tools item, and an app of its own
    permissions: [],
    properties: {
      active: { label: "mu.prop.overlay.active", type: "boolean", default: true },
      items: { label: "mu.overlay.items", type: "boolean", default: true },
      controls: { label: "mu.overlay.controls", type: "boolean", default: true },
      values: { label: "mu.overlay.values", type: "boolean", default: true },
      names: { label: "mu.prop.overlay.names", type: "boolean", default: true },
    },

    mount(ctx) {
      mounted.set(ctx.windowId, ctx);
      sync();
    },

    unmount(ctx) {
      mounted.delete(ctx.windowId);
      sync();
    },

    body() {
      sync();
      // With the overlay off nothing is being counted, and the last numbers
      // would read as if it were.
      const now = overlayCounts();
      const shown = (kind) => (now ? now[kind] : t("mu.value.dash"));
      return [
        // What is on the screen now, first.
        NODES.section("found", t("mu.section.overlayFound"), [
          NODES.props("counts", [
            row("items", t("mu.overlay.items"), shown("items")),
            row("controls", t("mu.overlay.controls"), shown("controls")),
            row("values", t("mu.overlay.values"), shown("values")),
          ]),
        ]),
        NODES.section("show", t("mu.section.overlayShow"), [NODES.ownProps("fields")]),
      ];
    },
  });
}
