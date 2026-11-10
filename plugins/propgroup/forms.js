/* The four screens of Property Group, drawn: the app's list of the library's groups, the form that makes one, the
 * form that adds a named property to one, and the group the app holds. Each is an item's body, given what it shows
 * and doing what it does through the item's actions. */
import { groupNodes } from "./group.js";
import { TYPE_ID as TYPE, coerceEntries, coerceGroup, copy, kindsHeld, nameOf, shownAs } from "./lib.js";

const empty = () => ({ kind: "", value: null });

export function createScreens(fw) {
  const { core, describe } = fw;
  const { NODES, t } = core;

  // ---- the app: the groups of the library, one card each -------------------------------------
  const app = {
    // What the app holds is kept in the library when it is back.
    mount(s) {
      setTimeout(() => s.run("keep"), 0);
    },
    body(s) {
      const api = s.api;
      const itemId = s.item.id;
      const presets = api.store.saved(TYPE);
      const cards = presets.map((preset) => {
        const entries = coerceEntries(preset.value);
        const rows = [
          describe(
            { type: "string", control: "propgroup.namebox", read: () => preset.name, write: (_api, value) => s.run("rename", { id: preset.id, name: String(value ?? "") }) },
            { api, key: `group-${preset.id}-name`, label: t("propgroup.field.name") }
          ),
          describe({ type: "string", readonly: true, read: () => t("propgroup.value.count", { n: entries.length }) }, { api, key: `group-${preset.id}-count`, label: t("propgroup.field.entries") }),
          describe({ type: "string", readonly: true, read: () => entries.map(nameOf).join(", ") }, { api, key: `group-${preset.id}-names`, label: t("propgroup.field.names") }),
        ];
        return NODES.card(
          `group-${preset.id}`,
          preset.name,
          [NODES.props(`group-rows-${preset.id}`, rows)],
          [{ key: "go", primary: true, icon: "arrow-right-circle", label: t("propgroup.action.go"), title: t("propgroup.action.goTitle", { name: preset.name }), run: () => s.run("go", { id: preset.id }) }],
          { icon: "collection", onDiscard: () => s.run("remove", { id: preset.id }) }
        );
      });
      return [
        NODES.listCard("groups", cards, {
          title: t("propgroup.section.groups", { n: presets.length }),
          tools: [
            { key: "create", primary: true, icon: "plus-lg", label: t("propgroup.item.create"), run: () => s.run("opencreate") },
            { key: "addProperty", icon: "node-plus", label: t("propgroup.item.add"), title: t("propgroup.action.addToGroupTitle"), run: () => s.run("openadd") },
          ],
          icon: "collection",
          port: { item: itemId, key: "groups" },
        }),
      ];
    },
  };

  // A result is shown in place of the form, and closing it returns to the form; the saved group stays.
  const resultNodes = (s, result) => {
    if (!result || result.kind !== TYPE) return null;
    return groupNodes({
      core,
      describe,
      api: s.api,
      itemId: s.item.id,
      port: { item: s.item.id, key: "result" },
      read: () => (s.read("result") || {}).value,
      readonly: true,
      tools: [{ key: "close", primary: true, icon: "x-lg", label: t("mu.tool.close"), run: () => s.set("result", empty()) }],
    });
  };

  // ---- the form that makes a group -------------------------------------------------------------
  const create = {
    body(s) {
      const p = s.props;
      const shown = resultNodes(s, p.result);
      if (shown) return shown;
      const name = String(p.name || "").trim();
      return [
        NODES.card(
          "create-group",
          t("propgroup.item.create"),
          [NODES.props("name", [describe({ type: "string", read: () => s.read("name"), write: (_api, value) => s.set("name", value) }, { api: s.api, key: `${s.item.id}-name`, label: t("propgroup.field.groupName") })])],
          [{ key: "create", primary: true, icon: "plus-lg", label: t("propgroup.action.create"), disabled: !name, run: () => s.run("create") }]
        ),
      ];
    },
  };

  // ---- the form that adds a named property to a group -------------------------------------------
  const add = {
    // Opened for another group than the one it was last used for: what was typed is let go of.
    mount(s) {
      setTimeout(() => s.run("reset"), 0);
    },
    body(s) {
      const p = s.props;
      const api = s.api;
      const itemId = s.item.id;
      const shown = resultNodes(s, p.result);
      if (shown) return shown;
      const SET = (key, value) => s.set(key, value);
      const held = p.entry || empty();
      const owner = p.owned;
      const holds = kindsHeld().includes(held.kind) && held.value !== null && held.value !== undefined;
      const carried = String((p.group || {}).name || "").trim();
      const library = api.store.saved(TYPE);
      const valid = owner
        ? Boolean((carried ? library.find((one) => one.name === carried) : library.some((one) => String(one.id) === String(p.target))) && holds)
        : Boolean(p.parent && p.parent.name === p.forGroup && holds);
      const clear = () => {
        SET("entryType", "");
        SET("entry", empty());
      };
      const sink = {
        accepts: kindsHeld(),
        label: t("propgroup.field.property"),
        put: (value, kind, sourceType) => {
          if (!kindsHeld().includes(kind)) return;
          const source = fw.valueTypes[sourceType];
          const family = [sourceType, ...(source?.ancestors || [])];
          const primitive = ["boolean", "number", "image", "string"].find((one) => family.includes(one));
          const sourceKind = source?.stash || source?.port || (primitive === "string" ? "text" : primitive);
          const type = sourceKind === kind ? sourceType : shownAs(kind);
          SET("entryType", type || "");
          SET("entry", { kind, value: copy(value) });
        },
      };
      const type = fw.valueTypes[p.entryType] ? p.entryType : shownAs(held.kind);
      // The value to put in, named outside its box like a property's value is; the card holds the way to let go of
      // it and what is dropped on it, and the value inside is drawn without a header of its own.
      const property =
        type && held.kind
          ? NODES.card(
              "property",
              t("propgroup.field.property"),
              [
                NODES.control("value", {
                  control: "scratch.card",
                  desc: describe(
                    { type, read: () => (s.read("entry") || {}).value, write: (_api, value) => SET("entry", { kind: held.kind, value: copy(value) }) },
                    { api, key: `${itemId}-property-${type}`, label: t("propgroup.field.property") }
                  ),
                  kind: held.kind,
                  bare: true,
                }),
              ],
              [],
              { sink, onDiscard: clear }
            )
          : NODES.card("property", t("propgroup.field.property"), [], [], { sink, empty: t("mu.value.presetDrop") });
      const targetSpec = {
        type: "enum",
        control: "select",
        options: [{ value: "", label: t("propgroup.value.chooseGroup") }, ...library.map((one) => ({ value: String(one.id), label: one.name }))],
      };
      const target = owner
        ? [NODES.props("target", [describe({ ...targetSpec, read: () => String(s.read("target") || ""), write: (_api, value) => SET("target", String(value || "")) }, { api, key: `${itemId}-target`, label: t("propgroup.field.targetGroup") })])]
        : [];
      // A group carried in by its grip takes the place of the one chosen above.
      const groupSink = {
        accepts: [TYPE],
        label: t("propgroup.field.group"),
        put: (value, kind) => {
          if (kind === TYPE) SET("group", coerceGroup(value));
        },
      };
      const groupCard = owner
        ? [
            carried
              ? NODES.card("group", carried, [], [], { icon: "collection", sink: groupSink, onDiscard: () => SET("group", coerceGroup(null)) })
              : NODES.card("group", t("propgroup.field.group"), [], [], { sink: groupSink, empty: t("propgroup.value.groupDrop") }),
          ]
        : [];
      return [
        NODES.card(
          "add-property",
          t("propgroup.item.add"),
          [
            ...target,
            ...groupCard,
            NODES.props("name", [describe({ type: "string", read: () => s.read("name"), write: (_api, value) => SET("name", value) }, { api, key: `${itemId}-name`, label: t("propgroup.field.propertyName") })]),
            property,
          ],
          [{ key: "add", primary: true, icon: "plus-lg", label: t("propgroup.action.addEntry"), disabled: !valid, run: () => s.run("add") }],
          { sink }
        ),
      ];
    },
  };

  // ---- the group the app holds, as a screen --------------------------------------------------
  // Drawn from the app's `shown` through the connection to it, and edited there -- what is changed is the app's
  // own.
  const view = {
    body(s) {
      const p = s.props;
      const appId = p.app;
      const entry = appId ? s.api.items.get(appId) : null;
      if (!entry) return [NODES.section("gone", "", [], { empty: t("propgroup.value.appGone") })];
      const shown = p.shown && p.shown.kind === TYPE ? p.shown : empty();
      if (!shown.kind) {
        return [NODES.card("guide", t("propgroup.item.group"), [], [], { icon: "collection", port: { item: appId, key: "shown" }, empty: t("mu.preview.empty") })];
      }
      return groupNodes({
        core,
        describe,
        api: s.api,
        itemId: s.item.id,
        port: { item: appId, key: "shown" },
        read: () => {
          const now = s.read("shown");
          return (now && now.kind === TYPE ? now : shown).value;
        },
        set: (value) => s.run("set", { value }),
        clear: () => s.run("clear"),
        // The add form, for this group: opened as a screen of its own, connected to the app.
        openChild: () => s.run("openAdd"),
      });
    },
  };

  return { "propgroup.app": app, "propgroup.create": create, "propgroup.add": add, "propgroup.view": view };
}
