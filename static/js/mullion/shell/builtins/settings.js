/* Mullion Settings -- the shell-wide profile, edited in place. (Its type id is
 * still `settings`: the name changed, the layouts that hold one did not.) */

import { formatValue, registerApp, registerItemType, reloadPage } from "./deps.js";
import { APP_SETTINGS, DEFAULT_ITEM_TYPE, DIRECTIONS, NODES, appSettingValue, itemProperties, pickedType, refreshAll, row, t } from "./deps.js";

// What this file registers, once the modules it uses are handed in (index.js).
export function install() {
  registerApp("settings", { home: "mullion", homeOrder: 20 });
  registerItemType("settings", {
      label: "mu.item.settings",
      standalone: true,
      icon: "sliders",
      permissions: ["app:read", "app:write", "app:control", "window:write"],
      // Generated from APP_SETTINGS, so adding a second app-wide setting is
      // one entry there and nothing here. Each property reads and writes the
      // shared profile directly rather than keeping a copy of its own.
      properties: Object.fromEntries(
        Object.entries(APP_SETTINGS).map(([key, spec]) => [
          key,
          {
            ...spec,
            read: (api) => (api && api.app ? api.app.get(key) : appSettingValue(key)),
            write: (api, value) => api.app.set(key, value),
          },
        ])
      ),

      body(api, item, ctx) {
        return [
          // The two lists are items of their own, opened one step along this window.
          NODES.section("lists", t("mu.section.lists"), [
            NODES.actions("lists", [
              { key: "profiles", label: t("mu.item.profilelist"), title: t("mu.profile.listTitle"), run: () => api.window.openScreen("profilelist") },
              { key: "profilecreate", label: t("mu.item.profilecreate"), title: t("mu.profile.createTitle"), run: () => api.window.openScreen("profilecreate") },
              { key: "plugins", label: t("mu.item.pluginstatus"), title: t("mu.plugin.listTitle"), run: () => api.window.openScreen("pluginstatus") },
            ]),
          ]),
          NODES.section("process", t("mu.section.process"), [
            NODES.actions("process", [
              {
                key: "restart",
                label: t("mu.action.restart"),
                title: t("mu.action.restartTitle"),
                confirm: { title: t("mu.confirm.restartTitle"), message: t("mu.confirm.restartBody"), okText: t("mu.confirm.restartOk"), danger: true },
                run: async () => {
                  ctx.status(t("mu.status.restarting"));
                  let was;
                  try {
                    was = await api.app.restart();
                  } catch (err) {
                    ctx.status(err.status === 404 ? t("mu.status.serverOld") : err.message);
                    return;
                  }
                  if (await api.app.waitBack(was)) reloadPage();
                  else ctx.status(t("mu.status.restartFailed"));
                },
              },
              {
                key: "quit",
                label: t("mu.action.quit"),
                title: t("mu.action.quitTitle"),
                confirm: { title: t("mu.confirm.quitTitle"), message: t("mu.confirm.quitBody"), okText: t("mu.confirm.quitOk"), danger: true },
                run: async () => {
                  try {
                    await api.app.quit();
                    ctx.status(t("mu.status.quit"));
                  } catch (err) {
                    ctx.status(err.status === 404 ? t("mu.status.serverOld") : err.message);
                  }
                },
              },
            ]),
          ]),
          NODES.section("own", t("mu.section.properties"), [NODES.ownProps("editors")]),
          NODES.section("scope", t("mu.section.scope"), [
            NODES.props("scope", [
              row("storedIn", t("mu.field.storedIn"), t("mu.value.storedIn")),
              row("sharedWith", t("mu.field.sharedWith"), t("mu.value.sharedWith")),
              ...api.app
                .settings()
                .map((desc) => row(desc.key, t("mu.field.raw", { key: desc.key }), desc.value)),
            ]),
          ]),
        ];
      },
    });
}
