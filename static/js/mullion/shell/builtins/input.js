/* Input Test -- one property of every built-in type, plus a widget. */

import { formatValue, registerItemType } from "./deps.js";
import { APP_SETTINGS, DEFAULT_ITEM_TYPE, DIRECTIONS, NODES, appSettingValue, itemProperties, pickedType, refreshAll, row, t } from "./deps.js";

// What this file registers, once the modules it uses are handed in (index.js).
export function install() {
  registerItemType("input", {
      label: "mu.item.input",
      // a screen of the Developer Tools item
      icon: "input-cursor-text",
      // Its own properties, plus the library: `spot` uses the saved-value
      // loader,
      // and saving the value you have is a write to the library like any
      // other -- a control cannot borrow a capability its item never asked
      // for, so the item asks.
      permissions: ["store:write"],
      properties: {
        text: { label: "mu.prop.input.text", type: "string", placeholder: "mu.placeholder.text" },
        // Same value type as `text`; only the control differs.
        note: {
          label: "mu.prop.input.note",
          type: "string",
          control: "textarea",
          rows: 2,
          placeholder: "mu.placeholder.note",
        },
        count: { label: "mu.prop.input.count", type: "number", default: 3, min: 0, max: 99, step: 1 },
        // A number shown as a slider: the bounds are the property's (they
        // constrain the value), the step is the control's (it is feel).
        ratio: {
          label: "mu.prop.input.ratio",
          type: "number",
          control: "slider",
          default: 0.5,
          min: 0,
          max: 1,
          step: 0.05,
        },
        share: { label: "mu.prop.input.share", type: "percent", default: 0.25 },
        // Three numbers on one line: the axes are the property's, because
        // they say what the value *is*; the step is the control's feel.
        position: {
          label: "mu.prop.input.position",
          type: "vector",
          axes: ["X", "Y", "Z"],
          default: [0, 1, 0],
          step: 0.1,
        },
        enabled: { label: "mu.prop.input.enabled", type: "boolean", default: true },
        // How the library reaches a property: `spot` keeps its own vector and
        // borrows a saved one through the picker, which is the only way there
        // is. There is no linking counterpart to sit beside it.
        spot: {
          label: "mu.prop.input.spot",
          type: "vector",
          control: "preset",
          inner: "vector",
          axes: ["X", "Y", "Z"],
          default: [0, 0, 0],
          step: 0.1,
        },
        mode: {
          label: "mu.prop.input.mode",
          type: "enum",
          default: "alpha",
          options: ["alpha", "beta", "gamma"],
        },
        tint: { label: "mu.prop.input.tint", type: "string", control: "swatch", default: "#5b9dff" },
        // A list that says what it holds, so one control can edit it. Rows of
        // library references: promptmanager's template, in one property.
        slots: {
          label: "mu.prop.input.slots",
          type: "list",
          control: "rows",
          default: [],
          each: { type: "entry" },
        },
        // The strokes: an array nobody addresses, so data and not a list.
        sketch: { label: "mu.prop.input.sketch", type: "data", control: "sketch", default: [] },
      },

      body(api, item) {
        return [
          NODES.section("own", t("mu.section.properties"), [NODES.ownProps("editors")]),
          // The widget draws itself from the same property the table shows.
          NODES.section("sketch", t("mu.section.sketch"), [
            NODES.control("canvas", "sketch"),
            NODES.actions("tools", [
              {
                key: "clear",
                label: t("mu.action.clearSketch"),
                title: t("mu.action.clearSketchTitle"),
                run: () => {
                  item.props.sketch = [];
                  refreshAll();
                },
              },
            ]),
          ]),
        ];
      },
    });
}
