/* What the screens and the actions of Property Group share: how a group and its entries are read and told apart. */
export const TYPE_ID = "propgroup";
const TYPE = TYPE_ID;
const LISTS = ["propgroupentries", "propgroupgroups"];

let seq = 0;
export const newId = () => `g${Date.now().toString(36)}${(seq++).toString(36)}`;
export const copy = (value) => (value === undefined ? null : JSON.parse(JSON.stringify(value)));

export const coerceEntries = (value) => {
  const list = Array.isArray(value) ? value : value && Array.isArray(value.entries) ? value.entries : [];
  const seen = new Set();
  return list
    .filter((one) => one && typeof one === "object" && typeof one.kind === "string" && one.kind && one.kind !== TYPE)
    .map((one, index) => {
      let id = typeof one.id === "string" && one.id ? one.id : `g${index}`;
      while (seen.has(id)) id = newId();
      seen.add(id);
      return {
        id,
        kind: one.kind,
        name: typeof one.name === "string" ? one.name : "",
        value: one.value === undefined ? null : one.value,
      };
    });
};

export const coerceGroup = (value) => ({
  name: value && typeof value === "object" && typeof value.name === "string" ? value.name : "",
  entries: coerceEntries(value),
});

export const shownAs = (kind, valueTypes = VALUE_TYPES()) => {
  const types = Object.entries(valueTypes);
  const found = types.find(([, def]) => def.stash === kind) || types.find(([, def]) => def.port === kind);
  return found ? found[0] : kind === "number" || kind === "boolean" ? kind : null;
};

export const kindsHeld = (valueTypes = VALUE_TYPES()) => [
  ...new Set([
    "number",
    "boolean",
    ...Object.values(valueTypes)
      .flatMap((def) => [def.stash, def.port])
      .filter((one) => typeof one === "string" && one !== TYPE && !LISTS.includes(one)),
  ]),
];

export const kindLabel = (kind, valueTypes = VALUE_TYPES()) => {
  const type = shownAs(kind, valueTypes);
  const def = type ? valueTypes[type] : null;
  const t = (CORE && CORE.t) || ((k) => k);
  return def && def.label ? t(def.label) : kind;
};

export const nameOf = (entry) => entry?.name || kindLabel(entry?.kind);


let CORE;
let TYPES;
const VALUE_TYPES = () => TYPES;
export function setup(core, valueTypes) {
  CORE = core;
  TYPES = valueTypes;
}
