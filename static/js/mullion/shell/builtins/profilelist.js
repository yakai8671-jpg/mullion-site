/* Profiles -- where the data is kept, and which of them the server opens.
 *
 * Two apps of Settings' (and apps of their own), each a profile's directory with its own
 * database, library and pictures (backend/profiles.py):
 *
 *   profilelist    the profiles: ONE property, `profiles`, a list of `mu.profile`, drawn as the
 *                  list card that is the whole body of the window (so it can fill it). The list's primary button is "New profile": it opens `profilecreate`, one
 *                  step along this window. An element's primary button makes it the default --
 *                  the one a server opens when a page does not ask for another; its other
 *                  buttons open it (the server starts again with it asked for), rename it and
 *                  take it out. A page asks for a profile with `?profile=` on its address
 *                  (profilequery.js).
 *   profilecreate  a new profile: a name and where to keep it (a folder, a `filepath`), and a
 *                  primary button that makes it.
 */

import { describe, registerApp, registerItemType, registerValueType, reloadPage } from "./deps.js";
import { NODES, row, t } from "./deps.js";

// One profile as a value. Carried out of the list it is that profile; its folder is a place
// (`filepath`), a field of it -- not an element of anything -- that a File Manager or a property
// that wants one can take.
const ENTRY = "mu.profile";
const isEntry = (value) => Boolean(value && typeof value === "object" && typeof value.id === "string" && value.id);

// The list of profiles: the property's own control. The cards are shell nodes made by the item
// (what a button does needs the item's window), laid out here as the control's content.

// What each window was last told by the server, for the list read through its property.
const STATES = new Map();

// ---- the profiles --------------------------------------------------------

// ---- a new profile -------------------------------------------------------

// What this file registers, once the modules it uses are handed in (index.js).
export function install() {
  registerValueType(ENTRY, {
    label: "mu.profile.vtype",
    icon: "person",
    storable: false,
    presetNew: false,
    identity: "id",
    port: "profile",
    portReceive: false,
    params: ["default"],
    sample: { default: { id: "work", name: "Work", dir: "C:\\Mullion\\work" } },
    fields: {
      id: { type: "string" },
      name: { type: "string" },
      dir: { type: "filepath" },
    },
    defaultControl: "summary",
    defaultValue: () => ({ id: "", name: "", dir: "" }),
    coerce: (value) => (isEntry(value) ? value : { id: "", name: "", dir: "" }),
    coerceList: (value) => (Array.isArray(value) ? value.filter(isEntry) : []),
    list: { storable: false, label: "mu.profile.vtypes", icon: "people" },
    format: (value) => (value && value.name) || "\u2014",
  });
  registerApp("profilelist");
  registerItemType("profilelist", {
    label: "mu.item.profilelist",
    standalone: true,
    icon: "people",
    permissions: ["app:control", "window:write"],
    properties: {
      // The profiles, as the server says them: read only, so each card is a port.
      profiles: {
        label: "mu.profile.vtypes",
        type: "list",
        each: { type: ENTRY },
        placed: true,
        storable: false,
        readonly: true,
        read: (_api, item) => {
          const state = STATES.get(item.id);
          return state ? state.profiles.map((one) => ({ id: one.id, name: one.name || t("mu.profile.default"), dir: one.dir })) : [];
        },
      },
    },

    // The profiles are the server's to say: asked when the window opens, and again
    // after each change.
    mount(ctx) {
      const ask = () =>
        (ctx.profilesAt = Date.now(), ctx.api.app
          .profiles()
          .then((state) => {
            ctx.profiles = state;
            ctx.refresh();
          })
          .catch(() => {
            ctx.profiles = null;
          }));
      ctx.askProfiles = ask;
      ask();
    },

    body(api, item, ctx) {
      // What another window did (a profile made in New Profile) is seen when this one is drawn next:
      // asked again unless it was asked a moment ago.
      if (ctx.askProfiles && Date.now() - (ctx.profilesAt || 0) > 500) ctx.askProfiles();
      const state = ctx.profiles;
      if (state) STATES.set(item.id, state);
      const nameOf = (one) => one.name || t("mu.profile.default");
      const failed = (err) => ctx.status(err.status === 404 ? t("mu.status.serverOld") : err.message);
      const change = async (run) => {
        try {
          await run();
          await ctx.askProfiles();
        } catch (err) {
          failed(err);
        }
      };
      // Open it: the server starts again with it asked for (the default is left as it is).
      const openIt = async (one) => {
        const ok = await ctx.confirm(t("mu.profile.switchBody", { name: nameOf(one) }), {
          title: t("mu.profile.switchTitle"),
          okText: t("mu.profile.switchOk"),
          danger: true,
        });
        if (!ok) return;
        ctx.status(t("mu.status.restarting"));
        let was;
        try {
          was = await api.app.switchProfile(one.id);
        } catch (err) {
          return failed(err);
        }
        if (await api.app.waitBack(was)) reloadPage();
        else ctx.status(t("mu.status.restartFailed"));
      };
      const rename = async (one) => {
        const name = await ctx.prompt(t("mu.profile.renamePrompt"), { title: t("mu.profile.rename"), value: one.name || "" });
        if (name) await change(() => api.app.renameProfile(one.id, name));
      };
      const remove = async (one) => {
        const ok = await ctx.confirm(t(one.managed ? "mu.profile.removeBody" : "mu.profile.removeOutsideBody", { name: nameOf(one) }), {
          title: t("mu.profile.removeTitle"),
          okText: t("mu.profile.removeOk"),
          danger: true,
        });
        if (ok) await change(() => api.app.removeProfile(one.id));
      };
      const size = (bytes) => (bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);
      // What it is to the server: the one open, the default, both, or neither.
      const stateOf = (one) =>
        [one.active ? t("mu.profile.inUse") : "", one.default ? t("mu.profile.isDefault") : ""].filter(Boolean).join(" \u00b7 ") || t("mu.profile.idle");
      const locked = Boolean(state && state.locked);
      const card = (one) =>
        NODES.card(
          `profile-${one.id}`,
          nameOf(one),
          [
            NODES.props(`profile-rows-${one.id}`, [
              row("state", t("mu.profile.state"), stateOf(one)),
              row("data", t("mu.profile.data"), one.hasData ? size(one.bytes) : t("mu.profile.noData")),
            ]),
            // Where it is: a field of the profile, so a card of its own (its name above it, as a
            // row's is) with the grip that carries it out as a place.
            NODES.card(
              `profile-dir-${one.id}`,
              t("mu.profile.dir"),
              [
                NODES.control(`profile-dir-${one.id}-value`, {
                  desc: describe({ type: "filepath", read: () => one.dir }, { api, key: `${item.id}-dir-${one.id}`, label: t("mu.profile.dir") }),
                  readonly: true,
                }),
              ],
              [],
              { side: true, readonly: true, port: { item: item.id, key: "profiles", path: [one.id, "dir"] } }
            ),
          ],
          locked
            ? []
            : [
                {
                  key: "default",
                  primary: true,
                  icon: one.default ? "star-fill" : "star",
                  label: t("mu.profile.makeDefault"),
                  title: t(one.default ? "mu.profile.isDefaultTitle" : "mu.profile.makeDefaultTitle"),
                  disabled: one.default,
                  run: () => change(() => api.app.setDefaultProfile(one.id)),
                },
                { key: "open", icon: "box-arrow-in-right", title: t("mu.profile.switchTitle"), disabled: one.active, run: () => openIt(one) },
                { key: "rename", icon: "pencil", title: t("mu.profile.rename"), run: () => rename(one) },
                ...(one.active || one.default ? [] : [{ key: "remove", icon: "trash", title: t("mu.profile.removeTitle"), run: () => remove(one) }]),
              ],
          { icon: one.active ? "person-check" : "person", isListElement: true, port: { item: item.id, key: "profiles", path: [one.id] } }
        );
      const nodes = state
        ? [
            NODES.listCard(
              "profile-list",
              [...(locked ? [NODES.card("profile-locked", "", [], [NODES.warning(t("mu.profile.locked"))], { isListElement: false })] : []), ...state.profiles.map(card)],
              {
                // The list's primary: a new profile, made in the app of its own.
                tools: locked ? [] : [{ key: "new", primary: true, icon: "plus-lg", label: t("mu.profile.new"), title: t("mu.profile.newTitle"), run: () => api.window.openScreen("profilecreate") }],
                icon: "people",
                port: { item: item.id, key: "profiles" },
              }
            ),
          ]
        : [];
      // The window's body is the list (the property `profiles` is its port).
      return nodes;
    },
  });
  registerApp("profilecreate");
  registerItemType("profilecreate", {
    label: "mu.item.profilecreate",
    standalone: true,
    icon: "person-plus",
    permissions: ["app:control", "window:write"],
    properties: {
      newName: { label: "mu.profile.name", type: "string", default: "" },
      // A folder is a place (`filepath`): the File Manager's folder or picked file is pasted or
      // linked here, and what is written here can be carried out of its grip.
      newDir: { label: "mu.profile.folder", type: "filepath", default: "", placeholder: "mu.profile.folderPlaceholder", placed: true },
    },

    body(api, item, ctx) {
      const create = async () => {
        const name = String(ctx.get("newName") || "").trim();
        if (!name) return ctx.status(t("mu.profile.needName"));
        // Empty is the folder this makes; a full path is wherever it was said to be.
        try {
          await api.app.createProfile(name, String(ctx.get("newDir") || "").trim());
          ctx.set("newName", "");
          ctx.set("newDir", "");
          ctx.status(t("mu.profile.created", { name }));
          // The list of profiles, wherever it is open, shows it; and this window goes back to it
          // when it was opened from it (nothing happens in a window of its own).
          ctx.refreshAll();
          api.window.back();
        } catch (err) {
          ctx.status(err.status === 404 ? t("mu.status.serverOld") : err.message);
        }
      };
      return [
        NODES.section("new", t("mu.item.profilecreate"), [
          NODES.card(
            "profile-new",
            "",
            [
              NODES.ownProps("profile-new-fields"),
              NODES.card("profile-new-dir", t("mu.profile.folder"), [NODES.control("dir", "newDir")], [], { side: true, port: { item: item.id, key: "newDir" } }),
            ],
            [{ key: "create", primary: true, icon: "plus-lg", label: t("mu.profile.create"), title: t("mu.profile.createTitle"), run: create }],
            { icon: "person-plus" }
          ),
        ]),
      ];
    },
  });
}
