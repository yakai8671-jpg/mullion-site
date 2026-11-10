/* List Tools declarative scripts: the values the screens read, what they do, and the two controls that draw them.
 *
 * Both items work on a list somebody else holds: the property `source` shares it (picked by pointing at it on
 * screen), and `api.props.shared("source")` says what it is -- its type, its elements, how to read and write it. */
import { ID_FIELD, NO_FIELD, NUMBER_OPS, TEXT_FIELD, TEXT_OPS, coerceFilter, makeShape } from "./shape.js";

const EMPTY = Object.freeze({ kind: "", value: null });
let shapes;
let valueTypes;
let CORE;
export function initialize(api) {
  CORE = api.core;
  valueTypes = api.valueTypes;
  shapes = makeShape(api.valueTypes);
}

const isPlain = (value) => !!value && typeof value === "object" && !Array.isArray(value);
const copy = (value) => (value === undefined ? null : JSON.parse(JSON.stringify(value)));
let seq = 0;

export const sharedInfo = (api) => (api && api.props && api.props.shared ? api.props.shared("source") : null);

export const searchOf = (api, item) => {
  const info = sharedInfo(api);
  return info && info.isList ? shapes.search(info, item?.props?.filter) : { ...EMPTY, count: 0 };
};

export const listOf = (api) => {
  const info = sharedInfo(api);
  return info && info.isList ? { kind: info.kind, value: info.read() } : { ...EMPTY };
};

export const types = {
  "list.any": {
    defaultValue: () => [],
    coerce: (value) => (Array.isArray(value) ? value : []),
  },
};

export const derived = {
  // What the shared list is: the controls draw from it (they are not given the item's own way of asking).
  sharedList: (api) => sharedInfo(api),
  searchResult: (api, item) => {
    const found = searchOf(api, item);
    return { kind: found.kind, value: found.value };
  },
  addList: (api) => listOf(api),
};

// ---- the value to add --------------------------------------------------------------------------
// The value to add is a value of the list's element type, drawn the way the type says: its fields one by one
// when it has fields, its own control when it has one, and as JSON text when it has neither.
const blankOf = (shape) => {
  if (shape.def && typeof shape.def.defaultValue === "function") return shape.def.defaultValue(shape.params);
  return shape.basic === "number" ? 0 : shape.basic === "boolean" ? false : "";
};
const modeOf = (shape) => {
  if (shape.def && isPlain(shape.def.fields) && Object.keys(shape.def.fields).length) return "fields";
  if (shape.def && shape.def.defaultControl && shape.def.defaultControl !== "summary") return "control";
  return shape.basic ? "control" : "json";
};
// The draft, as the list now needs it: one made for another kind of element is not carried over.
const draftOf = (held, info, shape) => {
  if (isPlain(held) && held.type === info.elementType && "value" in held) return held.value;
  return modeOf(shape) === "json" ? "" : blankOf(shape);
};
const wordsOf = (held, info) => (isPlain(held) && held.type === info.elementType && typeof held.text === "string" ? held.text : "");

// ---- what it does ------------------------------------------------------------------------------
export const actions = {
  // Pointing at a list: the guides cover every port on screen that holds one.
  "lists.pick": {
    async run({ writable }, { api, status }) {
      const done = await api.props.pick("source", { list: true, writable: Boolean(writable) });
      if (done === undefined) status("lists.status.nothingToPick");
      else if (done === false) status("lists.status.cannotShare");
      return {};
    },
  },
  "lists.unshare": {
    async run(_inputs, { api }) {
      api.props.unshare("source");
      return {};
    },
  },
  "lists.search": {
    async run({ filter }, { api, status }) {
      status("lists.status.found", { n: searchOf(api, { props: { filter } }).count });
      return {};
    },
  },
  // Add the draft to the list: a new identity when it needs one, at the end or the start, written through the
  // list's own port.
  "lists.add": {
    async run({ draft, where }, { api, status }) {
      const core = CORE;
      const info = sharedInfo(api);
      if (!info || !info.isList || !info.writable) {
        status("lists.status.cannotWrite");
        return {};
      }
      const shape = shapes.shapeOf(info);
      let entry = draftOf(draft, info, shape);
      const said = wordsOf(draft, info).trim();
      if (said && modeOf(shape) !== "json" && fromText(core, shape)) {
        // What was made of the words, with what was filled in beside them (a name).
        const made = madeFromText(core, shape, said);
        const beside = isPlain(entry) ? Object.fromEntries(Object.entries(entry).filter(([key, one]) => key !== shape.identity && one !== "" && one !== null && one !== undefined)) : {};
        entry = isPlain(made) ? { ...made, ...beside, ...(Object.hasOwn(made, "kind") ? { kind: made.kind } : {}), ...(Object.hasOwn(made, "value") ? { value: made.value } : {}) } : made;
      }
      if (modeOf(shape) === "json") {
        try {
          entry = JSON.parse(String(entry || ""));
        } catch {
          status("lists.status.badJson");
          return {};
        }
      }
      try {
        if (shape.def && typeof shape.def.coerce === "function") entry = shape.def.coerce(copy(entry), shape.params);
      } catch {
        status("lists.status.cannotWrite");
        return {};
      }
      const entries = shapes.entriesOf(info);
      if (shape.identity && isPlain(entry)) {
        const taken = new Set(entries.map((one) => String(isPlain(one) ? one[shape.identity] : "")));
        const held = entry[shape.identity];
        if (held === undefined || held === null || held === "" || taken.has(String(held))) {
          let id;
          do {
            seq += 1;
            id = `a${Date.now().toString(36)}${seq.toString(36)}`;
          } while (taken.has(id));
          entry = { ...entry, [shape.identity]: id };
        }
      }
      const next = where === "start" ? [entry, ...entries] : [...entries, entry];
      const def = valueTypes[info.type];
      const value = def && typeof def.coerce === "function" ? def.coerce(next, info.params) : next;
      // A list whose additions are made elsewhere (the library's groups are saved to the server, and show up in
      // the list a moment later) says so.
      if (!info.write(value) && !info.writesLater && !(def && def.writesLater)) {
        status("lists.status.notAdded");
        return {};
      }
      status("lists.status.added");
      return { draft: { type: info.elementType, value: modeOf(shape) === "json" ? "" : blankOf(shape), text: "" } };
    },
  },
};

// A line of text the element can be made from, for an element that is not typed into (a prompt is chosen from
// presets or dropped): when the shell knows how to read text as the kind the elements are carried as.
const fromText = (core, shape) =>
  Boolean(shape.def && typeof shape.def.fromWords === "function") ||
  Boolean(shape.elementKind && shape.elementKind !== "text" && core.portConvert("", "text", shape.elementKind) !== null);
const madeFromText = (core, shape, text) =>
  shape.def && typeof shape.def.fromWords === "function" ? shape.def.fromWords(text) : core.portConvert(text, "text", shape.elementKind);

// ---- the controls ------------------------------------------------------------------------------
// What the two screens share: the card of the list chosen, or the way to choose one.
function listCard(core, desc, info, children, writable) {
  const { NODES, t } = core;
  // The card is where the list is put: its grip carries what it shares, and another list carried over it is
  // shared in its place.
  const port = { item: desc.item.id, key: "source" };
  if (!info) {
    return [
      NODES.listCard("source", [NODES.control("pick", { control: "propertypick", label: t("lists.action.pick"), title: t("lists.action.pickTitle"), onPick: () => desc.params.pick({ writable }) })], { port }),
    ];
  }
  const unset = () => desc.params.unshare();
  if (!info.isList) {
    return [
      NODES.card("source", t("lists.source.gone"), [], [], {
        icon: "list-ul",
        onDiscard: unset,
        empty: t("lists.source.notList"),
      }),
    ];
  }
  // Named by the badge on its header (what it shares), not twice.
  return [NODES.listCard("source", children, { icon: "list-ul", port, onDiscard: unset })];
}

// A screen read the way the drawing code below reads its arguments: `params` are the item's properties and its
// actions by name, `set` writes a property.
function asDesc(screen, binds, actions) {
  const params = {};
  for (const [param, prop] of Object.entries(binds)) Object.defineProperty(params, param, { enumerable: true, get: () => screen.read(prop) });
  for (const [param, action] of Object.entries(actions)) params[param] = (payload) => screen.run(action, payload);
  return { params, item: screen.item, api: screen.api, set: (key, value) => screen.set(binds[key] || key, value) };
}

// The two screens: what is in them comes from the list they are pointed at.
export const screens = {
  // The search: the result, the list it works on, and the filter with its one button.
  "lists.search": (api) => {
    const { core, describe } = api;
    const { NODES, t } = core;
    const typeLabel = (type) => {
      const def = valueTypes[type];
      return def && def.label ? t(def.label) : type || "—";
    };
    const fieldLabel = (field) => (field.label ? t(field.label) : field.name);
    return {
      body(screen) {
        const desc = asDesc(screen, { filter: "filter", info: "info" }, { search: "search", pick: "pick", unshare: "unshare" });
        const p = desc.params;
        const item = desc.item;
        const row = (key, label, spec) => describe(spec, { api: desc.api, key: `${item.id}-${key}`, label: t(label) });
        const info = desc.params.info || null;
        const ok = Boolean(info && info.isList);
        const found = ok ? shapes.search(info, p.filter) : { ...EMPTY, count: 0 };
        const kindNodes = core.kindNodes;
        const port = { item: item.id, key: "result" };

        const shown =
          found.kind && kindNodes
            ? kindNodes({ kind: found.kind, value: found.value, port, prefix: item.id, name: "result-", compact: true })
            : [NODES.card("result-empty", t("lists.result.card"), [], [], { icon: "search", port, empty: t(ok ? "lists.result.none" : "lists.result.noList") })];

        const sections = [NODES.section("result", t("lists.section.result"), shown)];
        const entries = ok ? shapes.entriesOf(info) : [];
        sections.push(
          NODES.section(
            "list",
            t("lists.section.list"),
            listCard(
              core,
              desc,
              info,
              ok
                ? [
                    NODES.props("source-rows", [
                      row("count", "lists.info.count", { type: "string", readonly: true, read: () => t("lists.value.count", { n: entries.length }) }),
                      row("element", "lists.info.element", { type: "string", readonly: true, read: () => typeLabel(info.elementType) }),
                    ]),
                  ]
                : [],
              false
            )
          )
        );
        if (ok) {
          const shape = shapes.shapeOf(info);
          const now = () => coerceFilter(p.filter);
          const put = (patch) => desc.set("filter", { ...now(), ...patch });
          const rows = [];
          const fieldOptions = [
            { value: NO_FIELD, label: t("lists.field.none") },
            { value: TEXT_FIELD, label: t("lists.field.text") },
            ...(shape.identity ? [{ value: ID_FIELD, label: t("lists.field.id") }] : []),
            ...shape.fields.map((one) => ({ value: one.name, label: fieldLabel(one) })),
          ];
          rows.push(
            row("field", "lists.filter.field", {
              type: "enum",
              control: "select",
              options: fieldOptions,
              read: () => {
                const held = now().field;
                return fieldOptions.some((one) => one.value === held) ? held : NO_FIELD;
              },
              // A different field is compared another way: what was set for the old one is not carried over.
              write: (_api, value) => {
                const field = String(value || "");
                const kind = shapes.fieldKind(shape, field);
                put({ field, op: kind === "number" ? "eq" : "contains", value: kind === "number" ? 0 : kind === "boolean" ? true : "" });
              },
            })
          );
          const kind = shapes.fieldKind(shape, now().field);
          if (kind === "text" || kind === "number") {
            const ops = kind === "text" ? TEXT_OPS : NUMBER_OPS;
            rows.push(
              row("op", "lists.filter.op", {
                type: "enum",
                control: "select",
                options: ops.map((one) => ({ value: one, label: t(`lists.op.${one}`) })),
                read: () => (ops.includes(now().op) ? now().op : ops[0]),
                write: (_api, value) => put({ op: String(value) }),
              })
            );
          }
          if (kind === "text") {
            rows.push(
              row("needle", "lists.filter.value", { type: "string", read: () => String(now().value ?? ""), write: (_api, value) => put({ value: String(value ?? "") }) }),
              row("case", "lists.filter.ignoreCase", { type: "boolean", read: () => now().ignoreCase, write: (_api, value) => put({ ignoreCase: Boolean(value) }) })
            );
          } else if (kind === "number") {
            rows.push(row("number", "lists.filter.value", { type: "number", step: 1, read: () => Number(now().value) || 0, write: (_api, value) => put({ value: Number(value) || 0 }) }));
          } else if (kind === "boolean") {
            rows.push(row("switch", "lists.filter.value", { type: "boolean", read: () => now().value === true || now().value === "true", write: (_api, value) => put({ value: Boolean(value) }) }));
          }
          rows.push(
            row("take", "lists.filter.take", {
              type: "enum",
              control: "select",
              options: ["all", "first", "last", "nth"].map((one) => ({ value: one, label: t(`lists.take.${one}`) })),
              read: () => now().take,
              write: (_api, value) => put({ take: String(value) }),
            })
          );
          if (now().take === "nth") {
            rows.push(
              row("index", "lists.filter.index", {
                type: "number",
                min: 1,
                step: 1,
                read: () => now().index,
                write: (_api, value) => put({ index: Math.max(1, Math.floor(Number(value)) || 1) }),
              })
            );
          }
          sections.push(
            NODES.section("filter", t("lists.section.filter"), [
              NODES.card("filter", "", [NODES.props("filter-rows", rows)], [{ key: "search", primary: true, icon: "search", label: t("lists.action.search"), run: () => p.search() }]),
            ])
          );
        }
        return sections;
      },
    };
  },

  // The addition: the list, and the form for a value of its element type with the one button that adds it.
  "lists.add": (api) => {
    const { core, describe } = api;
    const { NODES, t } = core;
    const typeLabel = (type) => {
      const def = valueTypes[type];
      return def && def.label ? t(def.label) : type || "—";
    };
    return {
      body(screen) {
        const desc = asDesc(screen, { draft: "draft", where: "where", info: "info" }, { add: "add", pick: "pick", unshare: "unshare" });
        const p = desc.params;
        const item = desc.item;
        const row = (key, label, spec) => describe(spec, { api: desc.api, key: `${item.id}-${key}`, label: t(label) });
        const info = desc.params.info || null;
        const ok = Boolean(info && info.isList);
        const kindNodes = core.kindNodes;
        const shape = ok ? shapes.shapeOf(info) : null;
        const entries = ok ? shapes.entriesOf(info) : [];
        const sections = [
          NODES.section(
            "list",
            t("lists.section.list"),
            // The list itself, read from where it is: nothing of it is copied here.
            listCard(core, desc, info, ok && kindNodes ? kindNodes({ kind: info.kind, value: info.read(), prefix: item.id, name: "list-", compact: true }) : [], true)
          ),
        ];
        if (ok) {
          const draft = () => draftOf(p.draft, info, shape);
          const setDraft = (value) => desc.set("draft", { type: info.elementType, value, text: wordsOf(p.draft, info) });
          const setWords = (text) => desc.set("draft", { type: info.elementType, value: draft(), text });
          const mode = modeOf(shape);
          const words =
            mode !== "json" && fromText(core, shape)
              ? [NODES.props("form-words", [row("words", "lists.form.words", { type: "string", read: () => wordsOf(p.draft, info), write: (_api, value) => setWords(String(value ?? "")) })])]
              : [];
          const label = (spec, name) => (spec.label ? t(spec.label) : name);
          let form;
          if (mode === "json") {
            form = [NODES.props("form", [row("json", "lists.form.json", { type: "string", control: "textarea", read: () => String(draft() ?? ""), write: (_api, value) => setDraft(String(value ?? "")) })])];
          } else if (mode === "control") {
            const spec = { ...shape.params, type: shape.type || shape.params.type };
            const one = describe({ ...spec, read: () => draft(), write: (_api, value) => setDraft(value) }, { api: desc.api, key: `${item.id}-draft`, label: typeLabel(shape.type) });
            form = [...words, ...(one.control && (one.control.params || []).includes("port") ? [NODES.control("form", { desc: one })] : [NODES.props("form", [one])])];
          } else {
            // The fields of the element, one control each; a field that is a card of its own (a picture, a text) stands alone.
            const rows = [];
            const cards = [];
            for (const [name, spec] of Object.entries(shape.def.fields)) {
              // What cannot be typed (a value that is only data, a kind that is told) is not asked for.
              if (spec.readonly || spec.type === "data") continue;
              const one = describe(
                {
                  ...spec,
                  read: () => {
                    const held = isPlain(draft()) ? draft()[name] : undefined;
                    return held === undefined ? (valueTypes[spec.type] && typeof valueTypes[spec.type].defaultValue === "function" ? valueTypes[spec.type].defaultValue(spec) : null) : held;
                  },
                  write: (_api, value) => setDraft({ ...(isPlain(draft()) ? draft() : {}), [name]: value }),
                },
                { api: desc.api, key: `${item.id}-draft-${name}`, label: label(spec, name) }
              );
              if (one.control && (one.control.params || []).includes("port")) cards.push(NODES.control(`form-${name}`, { desc: one }));
              else rows.push(one);
            }
            form = [...(rows.length ? [NODES.props("form", rows)] : []), ...words, ...cards];
          }
          sections.push(
            NODES.section("entry", t("lists.section.entry"), [
              NODES.card(
                "entry",
                "",
                [
                  ...form,
                  NODES.props("add-rows", [
                    row("where", "lists.field.where", {
                      type: "enum",
                      control: "select",
                      options: ["end", "start"].map((one) => ({ value: one, label: t(`lists.where.${one}`) })),
                      read: () => (p.where === "start" ? "start" : "end"),
                      write: (_api, value) => desc.set("where", String(value) === "start" ? "start" : "end"),
                    }),
                    row("count", "lists.info.count", { type: "string", readonly: true, read: () => t("lists.value.count", { n: entries.length }) }),
                  ]),
                ],
                [
                  { key: "add", primary: true, icon: "plus-lg", label: t("lists.action.add"), disabled: !info.writable, run: () => p.add() },
                  ...(!info.writable ? [NODES.warning(t("lists.status.cannotWrite"), "readonly")] : []),
                ]
              ),
            ])
          );
        }
        return sections;
      },
    };
  },
};
