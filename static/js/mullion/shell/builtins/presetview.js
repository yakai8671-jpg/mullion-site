/* Preset view -- what the two preset screens share: the shape a value of a
 * type is held to, its blank, and the preview card both lead with.
 *
 * Taking a preset (the chooser) and making one (the preset maker) are one
 * piece of work on one value, so both open on the same thing: a card showing
 * that value -- what is there now, or what the draft has become -- with the
 * screen's main act as the card's primary button. The chooser's is making a
 * new preset, the maker's is saving it.
 *
 * A type may say what its value looks like with `presetPreview(value)`,
 * returning {images, text}; without it the card is the value as the type
 * formats it, one line.
 */

import { describe, presetSpecOf, presetTypeDef } from "./deps.js";
import { NODES, t } from "./deps.js";

// What a spec says about where it is drawn rather than what its value is.
// A draft is drawn here, by this screen, so none of it carries over.
const PLACEMENT = ["control", "inner", "placed", "readonly", "compact", "read", "write", "label"];

// The shape a value is held to. From a property, that property's own
// parameters -- a vector with its axes, a list with what its elements are.
// From Home there is none, so the type's catalogue sample stands in rather
// than nothing, which some controls cannot draw.
export function shapeOf(type, target) {
  const def = presetTypeDef(type);
  const from = target ? target.spec : (def && def.sample) || {};
  // A list kept as a preset is described as a plain list of what it holds.
  const shape = { ...from, ...(presetSpecOf(type) || { type }) };
  // The sample's value is for showing the type off, not for starting from.
  if (!target) delete shape.default;
  PLACEMENT.forEach((key) => delete shape[key]);
  return shape;
}

export function blankOf(shape) {
  const def = presetTypeDef(shape.type);
  const value = def && def.defaultValue ? def.defaultValue(shape) : null;
  return value === undefined ? null : JSON.parse(JSON.stringify(value));
}

// The value, in a line, as its type says it.
export function formatOf(type, shape, value) {
  if (value === null || value === undefined) return "-";
  return describe({ ...(shape && shape.type ? shape : presetSpecOf(type) || { type }), read: () => value }, {}).property.format();
}

// The preview card: `title` over what the value is, and the screen's main
// act as the primary button. `tools` are the card's other buttons.
export function previewCard({ key, title, type, shape, value, primary, tools = [], content = [], sink = null, onDiscard = null, showValue = true }) {
  const def = presetTypeDef(type) || {};
  const seen = value === null || value === undefined ? null : typeof def.presetPreview === "function" ? def.presetPreview(value) : null;
  const text = seen && seen.text !== undefined ? String(seen.text) : formatOf(type, shape || presetSpecOf(type) || { type }, value);
  const images = seen && Array.isArray(seen.images) ? seen.images.filter(Boolean) : [];
  const line = describe({ type: "string", readonly: true, read: () => text }, { key: `${key}-text`, label: t("mu.field.value") });
  const children = [
    ...content,
    ...(images.length ? [NODES.control(`${key}-picture`, { control: "imagestage", images, showSize: false })] : []),
    ...(showValue ? [NODES.props(`${key}-text`, [line])] : []),
  ];
  return NODES.card(key, title, children, [...(primary ? [{ key: primary.key || "primary", primary: true, ...primary }] : []), ...tools], {
    icon: def.icon || "",
    ...(sink ? { sink } : {}),
    ...(onDiscard ? { onDiscard } : {}),
  });
}
