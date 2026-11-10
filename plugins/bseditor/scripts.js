/* BsEditor scripts */
import registerControls, { DECORATIONS, ICON_DECORATION } from "./controls.js";
import { createScreens } from "./screens.js";
import * as S from "./state.js";
import * as ops from "./ops.js";

const countOf = (cells) => (Array.isArray(cells) ? cells.reduce((n, c) => n + 1 + countOf(c.children), 0) : 0);

const VIEWS = ["preview", "html", "json"];
const dataViews = new Map();

function dataNodes({ api, item, port, clear = null, doc, view, setView, onPick = null }) {
  const NODES = api?.core?.NODES;
  const t = (k, vars) => (api?.core?.t ? api.core.t(`bseditor.${k}`, vars) : k);
  const describe = api?.describe || ((spec, opts) => ({ property: spec, ...opts }));
  if (!NODES) return [];

  const shown = VIEWS.includes(view) ? view : "preview";
  const switcher = describe(
    {
      type: "enum", control: "segments", labels: "all",
      options: VIEWS.map((one) => ({ value: one, label: t(`view.${one}`) })),
      read: () => shown,
      write: (_api, value) => setView(value),
    },
    { api, key: `${item.id}-data-view`, label: t("prop.view") }
  );
  const body = shown === "preview"
    ? NODES.control("page", {
        control: "bseditor.preview",
        page: ops.pageHtml(doc, { mark: Boolean(onPick), scripts: false }),
        active: doc.active,
        mode: onPick ? "edit" : "preview",
        onPick,
        bare: true,
        grow: true,
      })
    : NODES.control(shown, {
        desc: describe(
          { type: "string", control: "texteditor", readonly: true, read: () => (shown === "html" ? ops.pageHtml(doc) : ops.jsonOf(doc)) },
          { api, key: `${item.id}-data-${shown}`, label: t(`view.${shown}`) }
        ),
        grow: true,
      });
  return [NODES.card("data", "", [body], [], { icon: "layout-text-window", port, bar: [NODES.control("view", { desc: switcher })] })];
}

export const types = {
  "bseditor.doc": {
    defaultValue: () => ops.emptyDoc(),
    coerce: (value) => ops.coerceDoc(value),
    format: (value, api) => {
      const t = (k, vars) => (api?.t ? api.t(`bseditor.${k}`, vars) : (vars?.n !== undefined ? `Count: ${vars.n}` : k));
      return t("value.count", { n: countOf(ops.coerceDoc(value).cells) });
    },
    portNodes: ({ api, item, ctx, port, value, clear }) =>
      dataNodes({
        api, item, port, clear,
        doc: ops.coerceDoc(value),
        view: dataViews.get(item?.id) || "preview",
        setView: (view) => {
          if (item?.id) dataViews.set(item.id, view);
          ctx?.refresh?.();
        },
      }),
    portText: (value) => ops.jsonOf(ops.coerceDoc(value)),
  },

  "bseditor.cell": {
    defaultValue: () => null,
    coerce: (value) => ops.coerceCell(value),
    format: (value) => {
      const cell = ops.coerceCell(value);
      return cell ? ops.signatureOf(cell) || cell.id : "—";
    },
    portText: (value) => {
      const cell = ops.coerceCell(value);
      return cell ? ops.bodyHtml({ ...ops.emptyDoc(), cells: [cell] }) : "";
    },
  },

  "bseditor.classentry": {
    defaultValue: () => ({ className: "", category: "", description: "" }),
    coerce: (value) => ({
      className: String((value && value.className) ?? ""),
      category: String((value && value.category) ?? ""),
      description: String((value && value.description) ?? ""),
    }),
    format: (value) => (value && value.className ? `.${value.className}` : "—"),
    portText: (value) => (value && value.className ? `.${value.className}` : ""),
  },

  "bseditor.attrentry": {
    defaultValue: () => ({ name: "", value: "", description: "" }),
    coerce: (value) => ({
      name: String((value && value.name) ?? ""),
      value: String((value && value.value) ?? ""),
      description: String((value && value.description) ?? ""),
    }),
    format: (value) => (value && value.name ? `${value.name}="${value.value ?? ""}"` : "—"),
    portText: (value) => (value && value.name ? `${value.name}="${value.value ?? ""}"` : ""),
  },

  "bseditor.richtext": {
    format: (value) => {
      const text = ops.richToText(value);
      return text.length > 40 ? `${text.slice(0, 40)}…` : text;
    },
    portText: (value) => ops.richToText(value),
  },

  "bseditor.run": {
    defaultValue: () => ({ id: "", text: "" }),
    coerce: (value) => ({ id: String((value && value.id) ?? ""), text: String((value && value.text) ?? "") }),
    format: (value) => ops.richToText(value && value.text).slice(0, 30) || "—",
    portRead: (value) => String((value && value.text) ?? ""),
    portPut: (entry, carried) => ({ ...entry, text: String(carried ?? "") }),
    portText: (value) => ops.richToText(value && value.text),
  },
};

// The six controls that draw themselves are drawn by controls.js, which registers them as register(fw) does; what it
// registers is kept and given to the shell as the drawing hooks of each declared control.
let CAPTURED = null;
const capture = (api) => {
  if (!CAPTURED) {
    CAPTURED = {};
    registerControls({ ...api, registerControl: (id, def) => { CAPTURED[id] = def; } });
  }
  return CAPTURED;
};
const DRAWING = ["render", "update", "mount", "unmount"];
const drawingOf = (id) => (api) => {
  const def = capture(api)[id];
  return Object.fromEntries(DRAWING.filter((key) => def?.[key] !== undefined).map((key) => [key, def[key]]));
};

// The ten screens, drawn by screens.js: the body of each item.
const built = new WeakMap();
const screenOf = (id) => (fw) => {
  if (!built.has(fw)) built.set(fw, createScreens(fw));
  return built.get(fw)[id];
};

export const controls = Object.fromEntries(["bseditor.cellrow", "bseditor.htmlinput", "bseditor.preview", "bseditor.spacing", "bseditor.textcard", "bseditor.workspace"].map((id) => [id, drawingOf(id)]));

export const screens = Object.fromEntries(
  ["cells", "add", "cell", "classes", "classadd", "attrs", "attradd", "decor", "decorcatalog", "htmlload"].map((name) => [`bseditor.${name}`, screenOf(`bseditor.${name}`)])
);

let CORE;
export function initialize(api) {
  CORE = api.core;
}

// ---- the values the screens read, and write back ------------------------------------------------
const CHUNK = 50;
const classRecords = (props) => {
  const off = new Set(Array.isArray(props.off) ? props.off : []);
  return ops.searchClasses("", String(props.find || "")).filter((record) => !off.has(record.category));
};

export const derived = {
  // The picked cell. It is the document's, read out of it; written, it takes the place of that cell in the
  // document -- which is how the cell editor and the catalog, sharing it, change the page.
  pickedCell: {
    read: (_api, item) => {
      const found = ops.selectedCell(ops.coerceDoc(item.props.doc));
      return found ? JSON.parse(JSON.stringify(found)) : null;
    },
    write: (_api, value, item) => {
      const cell = ops.coerceCell(value);
      const doc = ops.coerceDoc(item.props.doc);
      // No cell is letting go of the picked one (the document keeps it).
      if (!cell) {
        if (doc.active) item.props.doc = ops.select(doc, "");
        return;
      }
      const out = ops.replaceCell(doc, cell);
      if (!out) return;
      S.rememberFor(doc, S.state.typing);
      item.props.doc = out.doc;
    },
  },

  // The classes and the attributes of the cell the editor holds, as lists of their own: read out of the cell
  // (shared, so through what it shares), and written back into it.
  cellClasses: {
    read: (api, item) => {
      const cell = S.heldCell(api, item);
      return cell ? ops.classEntries(cell) : [];
    },
    write: (api, value, item) => {
      const cell = S.heldCell(api, item);
      const names = (Array.isArray(value) ? value : []).map((one) => String((one && one.className) ?? "")).filter(Boolean);
      const out = cell && ops.onCell(cell, (d) => ops.setClasses(d, cell.id, names));
      if (out) S.putCell(api, item, out.cell);
    },
  },
  // The first run of text of the cell: what the decoration composer is linked to.
  cellText: {
    read: (api, item) => {
      const cell = S.heldCell(api, item);
      const field = cell ? ops.textFields(cell)[0] : null;
      return field ? field.html : "";
    },
    write: (api, value, item) => {
      const cell = S.heldCell(api, item);
      const field = cell ? ops.textFields(cell)[0] : null;
      // A link brings its value over at every redraw: what is there already is no write.
      if (!field || field.html === String(value ?? "")) return;
      const out = ops.onCell(cell, (d) => ops.setTextField(d, cell.id, field.index, String(value ?? "")));
      if (out) S.typed(`run-${cell.id}-${field.index}`, () => S.putCell(api, item, out.cell));
    },
  },
  // The runs of text of the cell, each a decorated text.
  cellRuns: {
    read: (api, item) => {
      const cell = S.heldCell(api, item);
      return cell ? ops.textFields(cell).map((field) => ({ id: String(field.index), text: field.html })) : [];
    },
    write: (api, value, item) => {
      const cell = S.heldCell(api, item);
      if (!cell) return;
      const list = Array.isArray(value) ? value : [];
      const out = ops.onCell(cell, (d) => {
        let cur = { doc: d, note: "" };
        for (const one of list) {
          const index = Number(one && one.id);
          if (!Number.isInteger(index) || ops.runHtml(cur.doc.cells[0], index) === String(one.text ?? "")) continue;
          cur = ops.setTextField(cur.doc, cell.id, index, String(one.text ?? "")) || cur;
        }
        return cur;
      });
      if (out) S.putCell(api, item, out.cell);
    },
  },
  cellAttrs: {
    read: (api, item) => {
      const cell = S.heldCell(api, item);
      return cell ? ops.attributeEntries(cell) : [];
    },
    write: (api, value, item) => {
      const cell = S.heldCell(api, item);
      const entries = (Array.isArray(value) ? value : []).filter((one) => one && one.name);
      const out = cell && ops.onCell(cell, (d) => ops.setAttributes(d, cell.id, entries));
      if (out) S.putCell(api, item, out.cell);
    },
  },
  // A cell that is shared or linked is another item's: neither loaded over nor let go of here.
  cellBound: (api, item) => Boolean((api && api.props && api.props.shared("cell")) || CORE.portLink({ item: item.id, key: "cell" })),

  // What the catalogs list, as lists that can be carried from: each class, each attribute is a port.
  catalogClasses: (_api, item) => classRecords(item.props).map((record) => ({ className: record.className, category: record.category, description: record.description })),
  catalogAttributes: (_api, item) => ops.searchAttributes(item.props.find).map((record) => ({ name: record.name, value: "", description: record.description })),
};

// ---- what it does ------------------------------------------------------------------------------
export const actions = {
  // Something the screens have to say to the person.
  "bseditor.say": {
    async run({ text }, { status }) {
      status(String(text ?? ""));
      return {};
    },
  },
  // A new page: asked about first, because what is there is gone.
  "bseditor.clear": {
    async run({ doc }, { confirm }) {
      const ok = await confirm("bseditor.confirm.new", {}, { danger: true });
      if (!ok) return {};
      const held = ops.coerceDoc(doc);
      const out = ops.clearAll(held);
      if (!out || out.refused) return {};
      S.rememberFor(held, "");
      return { doc: out.doc ? out.doc : out };
    },
  },
};
