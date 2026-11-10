/* Chooser -- browse what is saved, and copy one into a property.
 *
 * This is the only way a saved value reaches an item, and it does one
 * thing: load a value from the database and copy it in. There is no second
 * mechanism that links instead of copying. There was -- a `reusable` type
 * that held a row id so that editing the row would reach everything
 * pointing at it -- and nothing ever wanted it: the only live link in the
 * shell was a demo property, while most uses were a picker remembering
 * which row had been clicked. So a copy is all there is, which is why a
 * saved value can be deleted without breaking anything.
 *
 * Choosing from the library is not a thing one app does. Any item with a
 * property whose type has values saved can want it, and the screen is the
 * same every time: narrow to the groups you care about, find the one you
 * want, take it. So it is one item rather than a section inside each app
 * that needs it -- and a screen rather than a dropdown, because a list that
 * grows past a handful is not something to pick from a dropdown.
 *
 * What makes it generic is that the *target* says what it wants. The
 * chooser asks its API what it is choosing for, and offers what is saved of
 * that type. It never names the property itself -- it cannot: the shell
 * recorded a grant against this item when a control opened it, and
 * `grant:write` only ever answers about the grant made to whoever is
 * asking. It never knows what the value means either -- it hands it over,
 * and the property's coercion and write hook decide what happens next.
 */

import { ICONS, describe, presetSpecOf, presetTypeDef, presetTypeFor, registerItemType } from "./deps.js";
import { NODES, openScreen, rememberPickerView, rememberedPickerView, t } from "./deps.js";
import { candidatesFor, propertyGroupOf as groupOf } from "./deps.js";
import { blankOf, previewCard, shapeOf } from "./presetview.js";

// What each open chooser shows as the value now. Read once, when the screen
// first draws: a run's settings are a snapshot of several windows, which is
// more than should be taken again on every key typed into the search.
const nows = new Map();

// What this file registers, once the modules it uses are handed in (index.js).
export function install() {
  registerItemType("chooser", {
    label: "mu.item.chooser",
    // Never picked from a launcher. It exists for one gesture -- a control
    // opens it, something is taken, it is collected -- and on its own it has
    // no property to choose for, so the launcher would be offering a screen
    // that can only say it has nothing to do.
    icon: "box-arrow-in-down",
    // store:read to list what is saved; grant:write to learn what it is
    // choosing for and to hand the choice over. The second is what used to be
    // a token in a property -- a string anyone could have assembled. It is a
    // question to the API now, answered about the asker and nobody else.
    permissions: ["store:read", "grant:write"],
    properties: {
      // The type to browse when nothing was granted -- the chooser opened
      // from Home's preset list rather than from a property. Then there is
      // nowhere to load a value into, and picking one starts a new preset
      // from it instead. Placed: it is what the screen is about, not a
      // setting of it.
      type: { label: "mu.field.type", type: "string", default: "", placed: true },
      // Which groups to show. Empty means all of them -- the filter is the
      // point of the screen once there are two hundred parts and you only
      // want the expressions, so it is edited here and saved here rather
      // than declared by whoever opened it.
      //
      // Placed, and drawn by body() rather than in the property table,
      // because which groups it may name depends on what the target asked
      // for -- and that is not known until the target is.
      groups: { label: "mu.prop.groups", type: "groupset", default: [], placed: true },
      // Icons or rows, the same choice the dashboard offers. Values are
      // recognised by name here, so rows read better while there are few of
      // them and tiles read better once there are many.
      view: {
        label: "mu.prop.chooser.view",
        type: "enum",
        control: "segments",
        default: "grid",
        options: () => [
          { value: "grid", label: t("mu.opt.viewGrid"), icon: "grid-3x2-gap-fill" },
          { value: "list", label: t("mu.opt.viewList"), icon: "list-ul" },
        ],
        // Placed above the values it lays out, rather than in a settings
        // section away from them.
        placed: true,
      },
      // Placed beside the layout switch, above what it narrows. Drawn by the
      // search control, which says what it is for with a magnifier rather
      // than with a placeholder nobody needed to read twice.
      search: {
        label: "mu.prop.search",
        type: "string",
        control: "searchbox",
        default: "",
        placed: true,
      },
    },

    // What this screen is choosing for. In the window's facts rather than in
    // the body: it is the one thing here that never changes while the screen
    // is open, and the body is for the choosing.
    facts(api, item) {
      const target = api.grant.target();
      if (!target && item && item.props.type) return [{ label: t("mu.field.type"), value: item.props.type }];
      if (!target) return [{ label: t("mu.section.chooser"), value: t("mu.value.noTarget") }];
      return [
        { label: t("mu.field.deliverTo"), value: `${target.itemId}.${target.key}` },
        { label: t("mu.field.type"), value: target.type },
        {
          label: t("mu.field.value"),
          value: describe({ ...target.spec, type: target.type, read: () => target.value }, {}).property.format(),
        },
      ];
    },

    // Sets itself up from what it was handed: where to start looking, and
    // the layout the last picker was left in. Nothing else writes these --
    // the shell recorded the condition in the grant and left this screen's
    // properties alone -- so how they are stored is this item's own business.
    //
    // Through the accessors rather than ctx.set(): the item is drawn straight
    // after mount, and a set() here would redraw every window first.
    mount(ctx) {
      const target = ctx.api.grant.target();
      ctx.property("view").set(rememberedPickerView());
      if (!target) return;
      ctx.property("groups").set(target.query.groups);
      ctx.property("search").set(target.query.text);
    },

    destroy(item) {
      nows.delete(item.id);
    },

    body(api, item, ctx) {
      const target = api.grant.target();
      // What is being chosen: the granted property's type, or -- opened from
      // Home -- the type this screen was pointed at, with nowhere to put it.
      const type = target ? target.type : item.props.type;
      if (!type) {
        return [
          NODES.section("none", t("mu.section.chooser"), [], { empty: t("mu.value.noTarget") }),
        ];
      }
      const spec = target ? { ...target.spec, type } : presetSpecOf(type) || { type };

      const view = item.props.view === "list" ? "list" : "grid";
      // This screen does not live long enough to remember anything, so the
      // choice between tiles and rows is handed back to the shell for the
      // next one. See openValuePicker().
      rememberPickerView(view);

      // The filter, over the groups this type divides its values into. Built
      // here rather than declared, because `of` -- whose groups these are --
      // is whatever the target asked for; and keyed by that type, so pointing
      // the screen at a different property builds a new control instead of
      // reusing one offering the wrong groups. See describe()'s rules.
      const filter = describe(
        {
          type: "groupset",
          of: type,
          inner: "grouppick",
          read: () => item.props.groups,
          write: (_api, value) => ctx.set("groups", value),
        },
        { api, key: "groups-" + type, label: t("mu.field.groups") }
      );

      // What may be taken: everything saved that this property would accept
      // unchanged, narrowed to the groups being looked at. The reusable type
      // used to answer this; now the spec does, through the same filter the
      // loader button uses.
      const showing = filter.property.showing();
      const needle = String(item.props.search || "").trim().toLowerCase();
      const entries = candidatesFor(spec)
        .filter((one) => !showing.length || showing.includes(groupOf(type, one.value)))
        .filter((one) => !needle || one.name.toLowerCase().includes(needle));

      // Handed over through the API, which copies it at the boundary and
      // writes through the property's own accessor. See grant:write.
      const take = (entry) => {
        if (api.grant.set(entry.value)) {
          ctx.status(t("mu.status.tookValue", { name: entry.name }));
        }
      };
      // Where a new preset is made: a screen of its own, one step along this
      // window, handed the same address this one was -- so what it keeps is
      // the property as it is now. From Home there is no property, and it
      // starts from the type's own default, or from the preset picked.
      const make = (from = null) =>
        openScreen(ctx.windowId, "presetmaker", {
          grantFrom: target ? item.id : null,
          props: { type, from: from ? String(from.id) : "" },
        });

      const typeDef = presetTypeDef(target ? presetTypeFor(spec) : type) || presetTypeDef(type);
      const typeLabel = typeDef && typeDef.label ? t(typeDef.label) : type;

      // The value as it is now -- the property's, or what its preset would
      // keep -- and, from Home where there is no property, the type's blank.
      if (!nows.has(item.id)) {
        const kept = target ? api.grant.capture() : null;
        nows.set(item.id, kept ?? (target ? target.value : blankOf(shapeOf(type, null))));
      }
      const now = nows.get(item.id);

      return [
        // What there is now, and the way to keep it: the primary button makes
        // a new preset, on the same screen as taking one. Not for a type whose
        // choices are only what it offers (see `presetNew` on the type): there
        // is nothing of it to keep.
        previewCard({
          key: "now",
          title: target ? target.label : typeLabel,
          type,
          shape: target ? spec : shapeOf(type, null),
          value: now,
          primary:
            typeDef && typeDef.presetNew === false
              ? null
              : {
                  key: "make",
                  icon: ICONS.presetSave,
                  label: t("mu.action.presetMake"),
                  title: t("mu.action.newPresetTitle", { type: typeLabel }),
                  run: () => make(),
                },
        }),
        // The values themselves. Each tile says what it holds, in the type's
        // own words, so what is about to be copied in can be read first --
        // which is the reason this is a screen and not a dropdown.
        NODES.section("entries", t("mu.section.saved", { n: entries.length }), [
          // What to look for and how to lay out what turns up, on one line:
          // both are about the list directly under them.
          NODES.bar("find", [NODES.control("search", "search"), NODES.control("view", "view")]),
          // Under the search box, because it is the same question asked the
          // other way round -- narrow by name, narrow by group -- and both
          // are about the list directly below. Offered only when this type
          // divides its values at all: a vector is just a vector, and a
          // filter over nothing is a row that explains itself badly.
          ...(filter.property.offered().length ? [NODES.control("filter", { desc: filter })] : []),
          NODES.gallery(
            "entries",
            entries.map((entry) => ({
              key: String(entry.id),
              label: entry.name,
              icon: target ? "box-arrow-in-down" : ICONS.preset,
              title: target
                ? `${describe({ ...spec, read: () => entry.value }, {}).property.format()} → ${target.key}`
                : `${describe({ ...spec, read: () => entry.value }, {}).property.format()} · ${t("mu.action.editPreset")}`,
              run: () => (target ? take(entry) : make(entry)),
            })),
            view
          ),
        ]),
      ];
    },
  });
}
