/* Control Catalog -- what a value can be edited with, and what it looks
 * like when it is.
 *
 * The other catalogs describe things: item types and value types. This one
 * has to *show* its subject, because a control is nothing but the way
 * something appears. So it keeps one sample property of each value type and
 * draws each control, in its own card of a list card, over whichever sample
 * fits it -- the same method-set matching the shell uses to allow a pairing
 * in the first place.
 */

import { VALUE_TYPES, registerItemType } from "./deps.js";
import { NODES, row, t } from "./deps.js";
import "./catalogentry.js";

// One sample per value type, in the order the preview should prefer them.
const SAMPLES = [
  ["sampleString", "string"],
  ["sampleNumber", "number"],
  ["samplePercent", "percent"],
  ["sampleBoolean", "boolean"],
  ["sampleEnum", "enum"],
  ["sampleVector", "vector"],
  ["sampleList", "list"],
  ["sampleGroups", "groupset"],
  ["sampleRef", "ref"],
];

// What this file registers, once the modules it uses are handed in (index.js).
export function install() {
  registerItemType("controlcatalog", {
    label: "mu.item.controlcatalog",
    // a screen of the Developer Tools item
    icon: "toggles",
    permissions: ["props:read"],
    properties: {
      // Narrowing the list by id or name.
      search: { label: "mu.prop.search", type: "string", control: "searchbox", default: "", placed: true },
      controls: { type: "list", each: { type: "catalog.entry" }, readonly: true, placed: true, read: (api) => api.props.controls() },
      valueType: {
        label: "mu.prop.controlValueType", type: "enum", control: "select", default: "", placed: true,
        options: () => [
          { value: "", label: t("mu.value.allTypes") },
          ...Object.entries(VALUE_TYPES).filter(([, def]) => !def.legacy).map(([name, def]) => ({ value: name, label: def.label ? `${t(def.label)} (${name})` : name })),
        ],
      },
      // The samples are placed by the preview, never by the automatic table.
      sampleString: { label: "mu.sample.string", type: "string", default: "hello", placed: true },
      sampleNumber: {
        label: "mu.sample.number",
        type: "number",
        default: 42,
        min: 0,
        max: 100,
        placed: true,
      },
      samplePercent: { label: "mu.sample.percent", type: "percent", default: 0.25, placed: true },
      sampleBoolean: { label: "mu.sample.boolean", type: "boolean", default: true, placed: true },
      sampleEnum: {
        label: "mu.sample.enum",
        type: "enum",
        default: "alpha",
        // Icons as well as labels: the controls that can use one do, and the
        // ones that cannot ignore them.
        options: [
          { value: "alpha", label: "alpha", icon: "circle" },
          { value: "beta", label: "beta", icon: "square" },
          { value: "gamma", label: "gamma", icon: "triangle" },
        ],
        placed: true,
      },
      sampleVector: {
        label: "mu.sample.vector",
        type: "vector",
        axes: ["X", "Y", "Z"],
        default: [1, 2, 3],
        step: 0.1,
        placed: true,
      },
      sampleList: { label: "mu.sample.list", type: "list", each: { type: "entry" }, default: [], placed: true },
      // Over prompt parts, because that is the type in this shell that
      // divides its own values -- a filter over a type with no groups has
      // nothing to show, which would make a poor sample.
      sampleGroups: {
        label: "mu.sample.groups",
        type: "groupset",
        of: "prompt.part",
        default: [],
        placed: true,
      },
      sampleRef: { label: "mu.sample.ref", type: "ref", readonly: true, placed: true },
    },

    body(api, item, ctx) {
      const needle = String(item.props.search || "").trim().toLowerCase();
      const valueType = String(item.props.valueType || "");
      const controls = ctx.get("controls")
        .filter((control) => (!valueType || control.accepts.includes(valueType)) && (!needle || control.label.toLowerCase().includes(needle) || control.name.toLowerCase().includes(needle)));
      const dash = t("mu.value.dash");

      const card = (control) => {
        // A bound control is shown over the first sample it accepts; a
        // standalone one over the sample parameters it ships with.
        const sample = !control.standalone ? SAMPLES.find(([, type]) => control.accepts.includes(type)) : null;
        const demo = control.standalone
          ? NODES.control(`demo-${control.name}`, { control: control.name, ...(control.sampleParams || {}) })
          : sample
            ? NODES.control(`demo-${control.name}`, sample[0], { control: control.name, ...(control.sampleParams || {}) })
            : null;
        return NODES.card(
          `control-${control.name}`,
          control.label,
          [
            demo,
            NODES.props(`fields-${control.name}`, [
              row("id", t("mu.field.id"), control.name),
              row("source", t("mu.field.source"), control.source),
              row(
                "boundTo",
                t("mu.field.boundTo"),
                control.standalone ? t("mu.value.standalone") : sample ? t("mu.value.previewOver", { type: sample[1] }) : dash
              ),
              // The contract: what a property must be able to answer for this
              // control to be allowed on it.
              row("needs", t("mu.field.needs"), control.needs.join(", ") || t("mu.value.none")),
              row("requiresParams", t("mu.field.requiresParams"), control.requiresParams.join(", ") || dash),
              row("params", t("mu.field.params"), (control.params || []).join(", ") || dash),
              row("accepts", t("mu.field.accepts"), control.standalone ? t("mu.value.standalone") : control.accepts.join(", ") || t("mu.value.none")),
              row("widget", t("mu.field.ownsDom"), t(control.widget ? "mu.value.yes" : "mu.value.no")),
              // Only a plugin's own control has a reason to give.
              ...(control.source !== "core" ? [row("why", t("mu.field.why"), control.why || t("mu.value.noReason"))] : []),
            ]),
          ],
          [],
          { icon: "toggles" }
        );
      };

      return [
        NODES.listCard("controls", controls.map(card), { port: { item: item.id, key: "controls" }, icon: "toggles", bar: [NODES.control("search", "search"), NODES.control("valueType", "valueType")] }),
      ];
    },
  });
}
