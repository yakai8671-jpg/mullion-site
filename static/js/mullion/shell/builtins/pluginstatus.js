/* Plugin Status -- which plugins are installed, and whether each one loaded.
 *
 * A screen of the Developer Tools item, beside the Item Catalog: what a type
 * is and who provided it is the catalog's; whether the plugin it came from
 * loaded at all, and why not, is this.
 */

import { registerApp, registerItemType, reloadPage } from "./deps.js";
import { NODES, row, t } from "./deps.js";

// What this file registers, once the modules it uses are handed in (index.js).
export function install() {
  registerApp("pluginstatus");
  registerItemType("pluginstatus", {
    label: "mu.item.pluginstatus",
    standalone: true,
    icon: "plug", // a screen of Settings and of the Developer Tools item, and an app of its own
    permissions: ["plugins:read", "plugins:write"],
    properties: {},

    body(api, item, ctx) {
      const plugins = api.plugins.list();
      const dash = t("mu.value.dash");
      // Switching one on or off for this profile (the code is shared). Others that have
      // to change with it are named, and the person cancels or does them all together;
      // the plugins are loaded once, so the page is read again to take it up.
      const toggle = async (plugin) => {
        const enable = !plugin.enabled;
        const ask = (together) => api.plugins.setEnabled(plugin.id, enable, together);
        try {
          await ask(false);
        } catch (error) {
          if (!error.conflict) return ctx.status(error.message);
          const others = error.conflict.others.map((one) => one.name).join(", ");
          const dependents = error.conflict.needs === "dependents";
          const ok = await ctx.confirm(t(dependents ? "mu.plugin.offBody" : "mu.plugin.onBody", { name: plugin.name, others }), {
            title: t(dependents ? "mu.plugin.offTitle" : "mu.plugin.onTitle", { name: plugin.name }),
            okText: t(dependents ? "mu.plugin.offOk" : "mu.plugin.onOk"),
            danger: dependents,
          });
          if (!ok) return;
          try {
            await ask(true);
          } catch (again) {
            return ctx.status(again.message);
          }
        }
        reloadPage();
      };
      const card = (plugin) =>
        NODES.card(
          `plugin-${plugin.id}`,
          `${plugin.name} ${plugin.version}`.trim(),
          [
            NODES.props(`fields-${plugin.id}`, [
              row("id", t("mu.field.id"), plugin.id),
              row(
                "status",
                t("mu.field.status"),
                plugin.status === "loaded" ? t("mu.value.pluginLoaded") : plugin.status === "disabled" ? t("mu.value.pluginDisabled") : plugin.status
              ),
              ...(plugin.error ? [row("error", t("mu.field.error"), plugin.error)] : []),
              row("requires", t("mu.field.requires"), plugin.requires.join(", ") || dash),
              row("requiredBy", t("mu.field.requiredBy"), plugin.requiredBy.join(", ") || dash),
              row("permissions", t("mu.field.permissions"), plugin.permissions.join(", ") || dash),
            ]),
          ],
          plugin.status === "invalid" || plugin.status === "unmet" || plugin.status === "failed"
            ? []
            : [
                {
                  key: "toggle",
                  icon: plugin.enabled ? "toggle-on" : "toggle-off",
                  label: t(plugin.enabled ? "mu.plugin.off" : "mu.plugin.on"),
                  title: t(plugin.enabled ? "mu.plugin.offHint" : "mu.plugin.onHint"),
                  run: () => toggle(plugin),
                },
              ],
          { icon: plugin.enabled ? "plug" : "plug-fill", isListElement: true }
        );
      return [
        NODES.section("plugins", t("mu.section.plugins", { n: plugins.length }), [
          NODES.listCard("plugins", plugins.map(card), { icon: "plug" }),
        ]),
      ];
    },
  });
}
