/* App links (type id `applinks`) -- the links an item holds, one by one.
 *
 * The screen behind the links row of an item's bar (see paintStatusRow in
 * core): what the item is linked to, which of its properties each link feeds,
 * the way to the linked app, and the way to let it go. Not an app of its own:
 * it is opened along the path of the window asking, and says nothing the
 * linked item does not.
 */

import { registerItemType } from "./deps.js";
import { NODES, getItem, itemLabel, linkOptionsFor, linkSlotsOf, linksOf, putLink, refreshAll, revealItem, row, t, unlinkApp } from "./deps.js";

// What this file registers, once the modules it uses are handed in (index.js).
export function install() {
  registerItemType("applinks", {
    label: "mu.item.applinks",
    icon: "link-45deg",
    properties: {
      // The item whose links these are.
      host: { label: "mu.field.host", type: "string", default: "", placed: true },
    },

    body(_api, item, ctx) {
      const host = getItem(item.props.host);
      const links = host ? linksOf(host) : [];
      const entry = (one) =>
        NODES.card(
          `link-${one.key}-${one.to}`,
          itemLabel(one.to),
          [NODES.props(`link-rows-${one.key}-${one.to}`, [row("feeds", t("mu.link.feeds"), t(one.spec.label || one.key))])],
          [
            {
              key: "show",
              icon: "box-arrow-up-right",
              title: t("mu.link.show"),
              // An app that is on screen is brought forward.
              run: () => revealItem(one.to),
            },
          ],
          {
            icon: "link-45deg",
            onDiscard: () => {
              unlinkApp(host, one);
              refreshAll();
            },
          }
        );
      // A window's handle dragged onto the list adds it, as the slot of the host
      // that would take it; with the button there is nothing to pick from, so
      // it says how.
      const add =
        host && linkSlotsOf(host).length
          ? {
              label: t("mu.link.add"),
              run: () => ctx.status(t("mu.link.addHint")),
              windows: (standsFor) =>
                linkOptionsFor(host, standsFor).map((option) => ({
                  label: t("mu.link.guide", { name: option.name }),
                  put: () => putLink(host, option),
                })),
            }
          : null;
      return [
        NODES.section("links", t("mu.link.state"), [
          NODES.listCard("links", links.map(entry), { icon: "link-45deg", add }),
        ]),
      ];
    },
  });
}
