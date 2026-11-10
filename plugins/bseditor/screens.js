/* The ten screens of BsEditor, drawn: each an item's body, given what it shows and doing what it does
 * to it (the document `doc`, the picked cell `cell`, the lists of the catalogs) through `ctx`, which stands for the
 * item: `ctx.get(key)` reads an argument, `ctx.set(key, value)` writes it back, `ctx.status(text)` says something,
 * `ctx.clear()` asks to start a new page. What the undo steps and the typing in the cell editor share is in
 * state.js. */
import * as ops from "./ops.js";
import { INLINE_OPTIONS, TEMPLATE_CATALOG, UI_GROUPS } from "./ops.js";
import { WORDS } from "./words.js";
import { DECORATIONS, ICON_DECORATION } from "./controls.js";
import * as S from "./state.js";

const DOC = "bseditor.doc";
const CELL = "bseditor.cell";
const CLASS = "bseditor.classentry";
const ATTR = "bseditor.attrentry";
const RICH = "bseditor.richtext";
const RUN = "bseditor.run";
const DECOR_ID = "bseditor.decor";
const DECORCATALOG_ID = "bseditor.decorcatalog";
const HTMLLOAD_ID = "bseditor.htmlload";
const KINDS = ["tag", "bs", "custom", "fav"];
// The groups the style form puts first; the rest are under "other groups".
const MAIN_GROUPS = ["bg", "text", "alignment", "border-pos", "border-color", "rounded", "shadow"];
// Margin and padding have a control of their own (bseditor.spacing).
const SPACING_GROUPS = ["mt", "mb", "ms", "me", "m-all", "mx", "my", "pt", "pb", "ps", "pe", "p-all", "px", "py"];
const CHUNK = 50;

export function createScreens(fw) {
  const { core, describe } = fw;
  const { NODES, t: tr } = core;
  const t = (key, vars) => tr(`bseditor.${key}`, vars);
  // What is being drawn now: the search box, which every catalog has, is made from it.
  const CUR = { api: null, item: null, ctx: null };
  const findBox = () =>
    NODES.control("find", {
      desc: describe(
        { type: "string", control: "searchbox", placeholder: t("prop.find"), read: () => CUR.ctx.get("find"), write: (_api, value) => CUR.ctx.set("find", value) },
        { api: CUR.api, key: `${CUR.item.id}-find`, label: t("prop.find") }
      ),
    });

  // ---- what the items do with the document -------------------------------------------
  const docOf = (ctx) => ops.coerceDoc(ctx.get("doc"));

  // Make `produce(doc)` the document. It gives {doc, note} (an operation of
  // ops.js), a document, or nothing.
  function change(ctx, produce, { remember = true, key = "" } = {}) {
    const doc = docOf(ctx);
    const out = produce(doc);
    if (!out) return false;
    const result = out.doc ? out : { doc: out, note: "" };
    if (out.refused) {
      if (out.note) ctx.status(out.note);
      return false;
    }
    if (remember) S.rememberFor(doc, key);
    ctx.set("doc", result.doc);
    if (result.note) ctx.status(result.note);
    return true;
  }
  const choose = (ctx, id) => change(ctx, (doc) => ops.select(doc, id), { remember: false });

  // The picked cell, for the items that hold it (`cell`): what they do to it
  // is done to a document of that one cell.
  function cellTools(ctx) {
    const now = () => ops.coerceCell(ctx.get("cell"));
    const edit = (produce, key = "") => {
      const current = now();
      if (!current) return false;
      const out = ops.onCell(current, produce);
      if (!out) return false;
      S.state.typing = key;
      try {
        ctx.set("cell", out.cell);
      } finally {
        S.state.typing = "";
      }
      if (out.note) ctx.status(out.note);
      return true;
    };
    return { now, edit };
  }

  const options = (pairs) => pairs.map(([value, label]) => ({ value, label }));
  const stringProp = (api, item, key, label, spec) => describe({ type: "string", ...spec }, { api, key: `${item.id}-${key}`, label });
  // A list in a named card: a bare picker has no name of its own.
  const listCard = (api, item, key, label, entries, onPick, { selected = "", icon = "list-ul", tools = [], add = null } = {}) =>
    NODES.listCard(key, [
      NODES.control(key, {
        desc: describe(
          { type: "string", control: "picker", bare: true, entries, selected, read: () => selected, write: (_api, value) => onPick(String(value)) },
          { api, key: `${item.id}-${key}`, label }
        ),
      }),
    ], { tools: tools, icon, ...(add ? { add } : {}) });

  // ---- the cells ------------------------------------------------------------------------

  // ---- the screen cells are added in ---------------------------------------------------
  // The templates of the kinds that are switched on, each once.
  function templateEntries(doc, kinds, find) {
    const customs = doc.customs.map((one) => ({ ...one, category: "custom" }));
    const pools = {
      tag: TEMPLATE_CATALOG.filter((one) => one.category === "tag"),
      bs: TEMPLATE_CATALOG.filter((one) => one.category === "bs"),
      custom: customs,
      fav: doc.favs.map((one) => ({ id: one.templateId, title: one.title, description: one.description })),
    };
    const seen = new Set();
    let list = [];
    for (const kind of KINDS) {
      if (!kinds.includes(kind)) continue;
      for (const one of pools[kind]) {
        if (!seen.has(one.id)) {
          seen.add(one.id);
          list.push(one);
        }
      }
    }
    const q = String(find || "").toLowerCase().trim();
    if (q) list = list.filter((one) => `${one.title} ${one.description}`.toLowerCase().includes(q));
    return list.map((one) => ({ id: one.id, primary: one.title, secondary: one.description }));
  }


  // ---- the classes of the picked cell: the list of them, and the style form ---------------
  const spacingLabel = (v) => (/^n\d+$/.test(v) ? `-${v.slice(1)}` : v === "" ? "" : v);

  function classNodes(api, item, ctx, cell, edit, now) {
    const id = cell.id;

    // The list is the property `classes`: a card to each class, each a port of its own, and
    // the way to more -- a screen to choose from, or a class carried here.
    const cards = ops.classEntries(cell).map((one) => {
      const group = ops.groupOfClass(one.className);
      const names = group ? UI_GROUPS[group.type].values.map((v) => (v === "" ? UI_GROUPS[group.type].stem : `${UI_GROUPS[group.type].stem}-${v}`)) : [];
      if (group && !names.includes(one.className)) names.unshift(one.className);
      // A class of a group is the drop-down of that group's choices; any other is only its name.
      const field = group
        ? {
            key: "class", kind: "select", label: one.description || one.className, value: one.className,
            options: names.map((name) => [name, `.${name}`]),
            onChange: (value) => edit((d) => ops.setGroupClass(d, id, group.type, String(value || ""))),
          }
        : { key: "class", kind: "readout", label: one.description || one.className, value: `.${one.className}` };
      return NODES.card(`k-${one.className}`, "", [NODES.control(`k-form-${one.className}`, { control: "fieldform", fields: [field] })], [], {
        side: true,
        port: { item: item.id, key: "classes", path: [one.className] },
        onDiscard: () => edit((d) => ops.toggleClass(d, id, one.className, false)),
      });
    });
    const list = NODES.listCard("classes", cards, { icon: "tags",
      port: { item: item.id, key: "classes" },
      add: {
        label: t("action.addClass"),
        run: () => api.window.openScreen("bseditor.classadd", {}, { share: { cell: "cell" } }),
        accepts: ["bseditor.class"],
        put: (value) => value && value.className && edit((d) => ops.toggleClass(d, id, value.className, true)),
      } });

    // The style form: a select to each group of the dictionary.
    const groupLabel = (type) => (WORDS[`group.${type}`] ? t(`group.${type}`) : type);
    const setGroup = (type, value) => edit((d) => ops.setGroupClass(d, id, type, String(value || "")));
    const groupRow = (type) =>
      describe(
        {
          type: "enum",
          options: () => {
            const group = UI_GROUPS[type];
            const names = group ? group.values.map((v) => (v === "" ? group.stem : `${group.stem}-${v}`)) : [];
            return [{ value: "", label: t("class.unset") }, ...names.map((name) => ({ value: name, label: name }))];
          },
          read: () => ops.groupValue(now() || cell, type),
          write: (_api, value) => setGroup(type, value),
        },
        { api, key: `${item.id}-g-${type}`, label: groupLabel(type) }
      );
    // bg and text colours are not groups of the dictionary: their values are the theme colours.
    const colorRow = (type, prefix) =>
      describe(
        {
          type: "enum",
          options: () => {
            const names = ops.searchClasses("", prefix).map((r) => r.className).filter((name) => name.startsWith(prefix) && !/opacity/.test(name) && (type !== "text" || ops.isTextColor(name)));
            return [{ value: "", label: t("class.unset") }, ...[...new Set(names)].map((name) => ({ value: name, label: name }))];
          },
          read: () => ops.groupValue(now() || cell, type),
          write: (_api, value) => setGroup(type, value),
        },
        { api, key: `${item.id}-g-${type}`, label: groupLabel(type) }
      );
    const alignRow = describe(
      {
        type: "enum",
        options: [{ value: "", label: t("class.unset") }, ...["text-start", "text-center", "text-end", "text-justify"].map((name) => ({ value: name, label: name }))],
        read: () => ops.groupValue(now() || cell, "alignment"),
        write: (_api, value) => setGroup("alignment", value),
      },
      { api, key: `${item.id}-g-alignment`, label: groupLabel("alignment") }
    );
    const main = [colorRow("bg", "bg-"), colorRow("text", "text-"), alignRow, ...MAIN_GROUPS.filter((type) => !["bg", "text", "alignment"].includes(type) && UI_GROUPS[type]).map(groupRow)];
    const others = Object.keys(UI_GROUPS).filter((type) => !MAIN_GROUPS.includes(type) && !SPACING_GROUPS.includes(type)).map(groupRow);

    // The margin and the padding: one control, a choice at each edge.
    const spacing = {};
    const spaceOptions = {};
    for (const group of SPACING_GROUPS) {
      const def = UI_GROUPS[group];
      spacing[group] = ops.groupValue(cell, group);
      spaceOptions[group] = [{ value: "", label: "" }, ...def.values.map((v) => ({ value: v === "" ? def.stem : `${def.stem}-${v}`, label: spacingLabel(v) }))];
    }
    const spacingControl = NODES.control("spacing", {
      control: "bseditor.spacing",
      values: spacing,
      options: spaceOptions,
      onChange: (group, value) => setGroup(group, value),
    });
    return [
      NODES.section("classes", t("section.classes"), [list]),
      NODES.section("style", t("section.style"), [NODES.props("style", main)]),
      NODES.section("spacing", t("control.spacing"), [spacingControl]),
      NODES.section("other-groups", t("group.more"), [NODES.props("other", others)]),
    ];
  }

  // ---- the cell, edited ---------------------------------------------------------------------

  // ---- the dictionary, as the catalog and the add screen list it -----------------------
  // What is looked for and which categories are left out: properties of the item
  // that lists it.
  const FILTER_PROPS = {
    find: { label: "bseditor.prop.find", type: "string", default: "", placed: true },
    // The categories left out of the list, by name.
    off: { label: "bseditor.prop.off", type: "data", default: [], placed: true },
    shown: { label: "bseditor.prop.shown", type: "number", default: CHUNK, placed: true },
  };
  const filteredClasses = (props) => {
    const off = new Set(Array.isArray(props.off) ? props.off : []);
    return ops.searchClasses("", String(props.find || "")).filter((record) => !off.has(record.category));
  };

  // A category as the user reads it: its name in the language, else as the dictionary has it.
  const categoryLabel = (name) => {
    const key = `cat.${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
    return WORDS[key] ? t(key) : name;
  };

  // A search, and the categories to list (the button is the icon and how many are on).
  function classFilter(ctx) {
    const categories = ops.categoryNames();
    const off = new Set(Array.isArray(ctx.get("off")) ? ctx.get("off") : []);
    return NODES.bar("filter", [
      findBox(),
      NODES.control("categories", {
        control: "popupchecklist",
        icon: "funnel",
        title: t("class.categories"),
        items: categories.map((name) => ({ value: name, label: categoryLabel(name), checked: !off.has(name) })),
        onChange: (checked) => {
          const keep = new Set(checked);
          ctx.set("off", categories.filter((name) => !keep.has(name)));
          ctx.set("shown", CHUNK);
        },
      }),
    ]);
  }

  // ---- the class catalog: only what there is ------------------------------------------------

  // ---- the screen classes are added in ---------------------------------------------------------

  // ---- the attribute catalog: only what there is --------------------------------------------------
  const ATTR_PROPS = { find: { label: "bseditor.prop.find", type: "string", default: "", placed: true } };


  // ---- the screen attributes are added in -----------------------------------------------------------

  // ---- the decoration composer: a decorated text, written ------------------------------------
  // A standalone item of the app. Its one value is the text, as the markup between the tags (a
  // decorated text, so it is a port: it goes wherever a text does, and the app links it to the
  // cell editor's text). The text is written in a card that draws its tags as badges and, while a
  // range of it is selected, offers the tools that wrap the range in a decoration; the
  // decorations in it are listed under it, and "Add decoration" opens the catalog of every
  // decoration there is (the icon too), which puts one where the selection is.


  // ---- the decoration catalog: every decoration there is -----------------------------------------
  // A screen the composer opens: a card to each decoration (the icon too), whose main button puts
  // it where the composer's text is selected (the caret, where nothing is).

  // ---- the cell, from HTML: a screen -------------------------------------------------------------
  // One control: the HTML, typed or pasted. What it comes to is checked as it is typed and said in
  // the bar (nothing typed, nothing it can be made of, or how many cells); the main button, "Load",
  // is for when there is a cell to make. The first cell it makes takes the place of the cell held
  // (its id and its place in the page stay), or is the cell there is none of.
  const htmlCheck = (text) => {
    if (!String(text || "").trim()) return { state: "empty", text: "" };
    const made = ops.cellsFromHtml(text);
    if (!made.length) return { state: "error", text: t("load.none") };
    return { state: "ok", text: made.length > 1 ? t("load.first", { n: made.length }) : t("load.one") };
  };


  function body_bseditor_cells(api, item, ctx) {
      const doc = docOf(ctx);
      const active = ops.selectedCell(doc);
      const run = (produce, flags) => change(ctx, produce, flags);
      const openAdd = () => api.window.openScreen("bseditor.add", {}, { share: { doc: "doc" } });

      // The body is this one control, which draws a card (so it can be expanded);
      // the picked cell and the tools that act on it are in the card's bar.
      const clipped = doc.clip ? ops.findCell(doc.cells, doc.clip.id) : null;
      return [NODES.control("workspace", {
        control: "bseditor.workspace",
        port: { item: item.id, key: "doc" },
        items: ops.outlineOf(doc),
        picked: ops.summaryOf(active),
        pickedPort: { item: item.id, key: "cell" },
        clipped: clipped ? { ...ops.summaryOf(clipped), mode: doc.clip.mode } : null,
        canUndo: ops.canUndo(doc),
        canRedo: ops.canRedo(doc),
        canNew: doc.cells.length > 0,
        active: doc.active,
        clip: doc.clip,
        // Picking the picked cell again lets it go.
        onSelect: (id) => choose(ctx, id === doc.active ? "" : id),
        onFold: (id) => run((d) => ops.toggleCollapse(d, id), { remember: false }),
        onCopy: () => run((d) => ops.setClip(d, d.active, "copy"), { remember: false }),
        onCut: () => run((d) => ops.setClip(d, d.active, "cut"), { remember: false }),
        onDelete: () => run((d) => ops.remove(d, d.active)),
        onAdd: (at) => {
          run((d) => ({ ...d, at, target: "" }), { remember: false });
          openAdd();
        },
        onPaste: (at) => run((d) => ops.paste(d, at)),
        onMove: (id, at) => run((d) => ops.moveTo(d, id, at)),
        onClearClip: () => run((d) => ops.clearClip(d), { remember: false }),
        onUndo: () => {
          const back = ops.stepHistory(docOf(ctx), true);
          if (back) ctx.set("doc", back);
        },
        onRedo: () => {
          const forward = ops.stepHistory(docOf(ctx), false);
          if (forward) ctx.set("doc", forward);
        },
        onNew: () => {
          ctx.clear();
        },
      })];
  }

  function body_bseditor_add(api, item, ctx) {
      const doc = docOf(ctx);
      const replacing = Boolean(doc.target && ops.selectedCell({ ...doc, active: doc.target }));
      const stored = ctx.get("kinds");
      const kinds = Array.isArray(stored) ? stored.filter((kind) => KINDS.includes(kind)) : KINDS;
      const filter = NODES.bar("filter", [
        findBox(),
        NODES.control("kinds", {
          control: "popupchecklist",
          icon: "funnel",
          title: t("prop.tab"),
          items: KINDS.map((kind) => ({ value: kind, label: t(`tab.${kind}`), checked: kinds.includes(kind) })),
          onChange: (checked) => ctx.set("kinds", KINDS.filter((kind) => checked.includes(kind))),
        }),
      ]);
      const pick = (id) => {
        const done = change(ctx, (d) => {
          const out = d.target ? ops.replaceTemplate(d, d.target, id) : ops.addTemplate(d, id);
          if (out && out.doc) out.doc.target = "";
          return out;
        });
        if (done) api.window.back();
      };
      const customs = doc.customs.map((one) =>
        NODES.card(`custom-${one.id}`, one.title, [], [], { icon: "file-earmark-text", onDiscard: () => change(ctx, (d) => ops.removeCustom(d, one.id), { remember: false }) })
      );
      return [
        NODES.section("add", replacing ? t("section.replace") : t("section.add"), [filter]),
        NODES.section("templates", t("section.templates"), [
          listCard(api, item, "templates", t("section.templates"), templateEntries(doc, kinds, ctx.get("find")), pick, { icon: "grid-3x3-gap" }),
        ]),
        ...(customs.length ? [NODES.section("customs", t("section.customs"), customs)] : []),
      ];
  }

  function body_bseditor_cell(api, item, ctx) {
      const { now, edit } = cellTools(ctx);
      const cell = now();
      // The cell it edits, as the row the list shows it in, in a card that is the cell's
      // port: a cell dropped on it (or linked, or shared) is the one edited. Its main act
      // is to take the cell from HTML; the close button lets go of the cell, it does not
      // delete it from the page.
      const loadHtml = () => api.window.openScreen(HTMLLOAD_ID, {}, { share: { cell: "cell" } });
      // A cell that is shared or linked is another item's: neither loaded over nor let go of here.
      const address = { item: item.id, key: "cell" };
      const bound = Boolean(ctx.get("bound"));
      const holder = NODES.section("cell", t("section.cell"), [
        NODES.card(
          "cell",
          "",
          cell ? [NODES.control("slot", { control: "bseditor.cellrow", cell: ops.summaryOf(cell) })] : [],
          // One primary button, and the two are never wanted together: with no cell, to take one
          // from HTML; with one, to let it go.
          [
            cell
              ? { key: "remove", icon: "trash", label: t("cell.remove"), primary: true, disabled: bound, run: () => ctx.set("cell", null) }
              : { key: "load", icon: "file-earmark-code", label: t("cell.load"), primary: true, disabled: bound, run: loadHtml },
          ],
          { port: address, empty: cell ? "" : t("cell.guide") }
        ),
      ]);
      if (!cell) return [holder];
      const id = cell.id;
      const here = () => now() || cell;
      const blank = ops.emptyDoc();
      const prop = (key, label, spec) => stringProp(api, item, key, label, spec);

      // ---- text: the first run is the text property (the one the decoration composer is linked
      // to), written as a string; any others are cards of their own, each a port of the runs.
      const runControls = ops.textFields(cell).map((field, order) => {
        const label = field.table ? t("cell.tdRun", { n: field.index + 1 }) : t("cell.run", { n: field.index + 1 });
        // The first is the text itself: the section names it, so its card has no label of its own.
        if (order === 0) return NODES.control("run-0", { desc: describe({ type: RICH, control: "texteditor", lines: 3, read: () => ctx.get("text"), write: (_api, value) => ctx.set("text", value) }, { api, key: `${item.id}-run-0`, label: t("prop.cellText") }) });
        return NODES.control(`run-${order}`, {
          desc: describe(
            {
              type: RICH,
              control: "texteditor",
              lines: 3,
              port: { item: item.id, key: "runs", path: [String(field.index)] },
              read: () => (ops.textFields(here()).find((one) => one.index === field.index) || { html: "" }).html,
              write: (_api, value) => edit((d) => ops.setTextField(d, id, field.index, String(value ?? "")), `run-${id}-${field.index}`),
            },
            { api, key: `${item.id}-run-${field.index}`, label }
          ),
        });
      });
      const texts = runControls;

      // ---- structure
      const structure = [];
      const tags = ops.tagChoices(cell);
      if (tags.length) {
        const titleOf = (tag) => {
          const template = TEMPLATE_CATALOG.find((one) => one.id === `tag-${tag}`);
          return template ? template.title : `<${tag}>`;
        };
        structure.push(
          NODES.props("tag", [
            prop("tag", t("cell.tag"), {
              type: "enum",
              options: options(tags.map((tag) => [tag, titleOf(tag)])),
              read: () => ops.tagOf(here()),
              write: (_api, value) => edit((d) => ops.changeTag(d, id, String(value))),
            }),
          ])
        );
      }
      const mode = ops.modeInfo(blank, cell);
      if (mode.toggle) {
        structure.push(
          NODES.props("mode", [
            prop("mode", t("cell.mode"), {
              type: "enum", control: "segments", labels: "all",
              options: options([["text", t("cell.mode.text")], ["container", t("cell.mode.container")]]),
              read: () => (here().contentMode === "container" ? "container" : "text"),
              write: (_api, value) => edit((d) => ops.toggleContentMode(d, id, value)),
            }),
          ])
        );
      }
      if (ops.detailsOpenOf(cell) !== null) {
        structure.push(
          NODES.props("details", [
            describe(
              { type: "boolean", read: () => Boolean(ops.detailsOpenOf(here())), write: (_api, value) => edit((d) => ops.setDetailsOpen(d, id, Boolean(value))) },
              { api, key: `${item.id}-details`, label: t("cell.detailsOpen") }
            ),
          ])
        );
      }
      const grid = ops.gridInfo(cell);
      if (grid) {
        const sizes = UI_GROUPS[grid.group] ? UI_GROUPS[grid.group].values : [];
        structure.push(
          NODES.props(
            "grid",
            grid.columns.map((column, index) =>
              describe(
                {
                  type: "enum",
                  options: [{ value: "", label: t("cell.gridAuto") }, ...sizes.filter((v) => v !== "").map((v) => ({ value: v, label: String(v) }))],
                  read: () => (ops.gridInfo(here()) || { columns: [] }).columns[index]?.value || "",
                  write: (_api, value) => edit((d) => ops.setGridColumn(d, id, index, value)),
                },
                { api, key: `${item.id}-grid-${index}`, label: t("cell.gridColumn", { n: index + 1 }) }
              )
            )
          )
        );
      }
      if (ops.iconNameOf(cell) !== null) {
        structure.push(
          NODES.props("icon", [
            prop("icon", t("cell.icon"), {
              control: "textbox",
              read: () => ops.iconNameOf(here()) || "",
              write: (_api, value) => edit((d) => ops.setIconName(d, id, String(value ?? "")), `icon-${id}`),
            }),
          ])
        );
      }
      const table = ops.tableInfo(cell);
      if (table) {
        for (const td of table) {
          const buttons = [];
          if (td.canMergeRight) buttons.push({ key: "right", label: t("cell.mergeRight"), run: () => edit((d) => ops.mergeTableCell(d, id, td.index, "right")) });
          if (td.canMergeDown) buttons.push({ key: "down", label: t("cell.mergeDown"), run: () => edit((d) => ops.mergeTableCell(d, id, td.index, "down")) });
          if (td.canSplit) buttons.push({ key: "split", label: t("cell.split"), run: () => edit((d) => ops.splitTableCell(d, id, td.index)) });
          const title = `${t("cell.table", { n: td.index + 1 })}${td.container ? "" : `  ${td.preview}`}${td.colspan > 1 || td.rowspan > 1 ? `  (${t("cell.span", { c: td.colspan, r: td.rowspan })})` : ""}`;
          structure.push(
            NODES.card(`td-${td.index}`, title, [
              NODES.props(`td-mode-${td.index}`, [
                prop(`td-mode-${td.index}`, t("cell.tableMode"), {
                  type: "enum", control: "segments", labels: "all",
                  options: options([["text", t("cell.mode.text")], ["container", t("cell.mode.container")]]),
                  read: () => ((ops.tableInfo(here()) || [])[td.index]?.container ? "container" : "text"),
                  write: (_api, value) => edit((d) => ops.setTableCellMode(d, id, td.index, value)),
                }),
              ]),
              ...(buttons.length ? [NODES.actions(`td-actions-${td.index}`, buttons)] : []),
            ], [], { icon: "table" })
          );
        }
      }

      // ---- attributes: the list of them, a card down the side to each: the name, as a
      // preview, and the value written beside it
      const attrCards = ops.attributeEntries(cell).map((one) =>
        NODES.card(`a-${one.name}`, "", [
          NODES.control(`a-form-${one.name}`, {
            control: "fieldform",
            fields: [
              { key: "name", kind: "readout", label: one.description || one.name, value: one.name },
              {
                key: "value",
                kind: "text",
                label: one.name,
                value: one.value,
                onChange: (value) => S.later(`attr-${id}-${one.name}`, ctx.settled(() => S.typed(`attr-${id}-${one.name}`, () => edit((d) => ops.addAttribute(d, id, one.name, String(value ?? "")), `attr-${id}-${one.name}`)))),
              },
            ],
          }),
        ], [], {
          side: true,
          port: { item: item.id, key: "attrs", path: [one.name] },
          onDiscard: () => edit((d) => ops.removeAttribute(d, id, one.name)),
        })
      );
      const attrList = NODES.listCard("attrs", attrCards, { icon: "tags",
        port: { item: item.id, key: "attrs" },
        add: {
          label: t("action.addAttribute"),
          run: () => api.window.openScreen("bseditor.attradd", {}, { share: { cell: "cell" } }),
          accepts: ["bseditor.attr"],
          put: (value) => value && value.name && edit((d) => ops.addAttribute(d, id, value.name, String(value.value ?? ""))),
        } });

      return [
        holder,
        ...(structure.length ? [NODES.section("structure", t("section.structure"), structure)] : []),
        ...(texts.length ? [NODES.section("text", t("section.text"), texts)] : []),
        NODES.section("attributes", t("section.attributes"), [attrList]),
        ...classNodes(api, item, ctx, cell, edit, now),
      ];
  }

  function body_bseditor_classes(api, item, ctx) {
      const found = filteredClasses({ find: ctx.get("find"), off: ctx.get("off") });
      const shown = Math.max(CHUNK, Math.floor(Number(ctx.get("shown")) || CHUNK));
      const page = found.slice(0, shown);

      // A class is a card with its header down the side and one line in it: its name, and what
      // it is for in the hint beside it. Its grip carries it.
      const classCard = (record) =>
        NODES.card(`c-${record.className}`, "", [
          NODES.props(`c-p-${record.className}`, [
            describe(
              { type: "string", readonly: true, hint: `${categoryLabel(record.category)}\n${record.description}`, read: () => "" },
              { api, key: `${item.id}-c-${record.className}`, label: `.${record.className}` }
            ),
          ]),
        ], [], { side: true, port: { item: item.id, key: "classes", path: [record.className] } });

      return [
        NODES.section("filter", "", [classFilter(ctx)]),
        NODES.section("catalog", t("section.catalog"), [
          ...page.map(classCard),
          ...(found.length > page.length
            ? [NODES.actions("more", [{ key: "more", label: t("action.more", { n: found.length - page.length }), run: () => ctx.set("shown", shown + CHUNK) }])]
            : []),
        ]),
      ];
  }

  function body_bseditor_classadd(api, item, ctx) {
      const { now, edit } = cellTools(ctx);
      const cell = now();
      const on = new Set(cell ? ops.classesOf(cell) : []);
      // Choosing a class puts it on the cell, or takes it off: the mark says which.
      const row = (record) => ({ id: record.className, primary: `${on.has(record.className) ? "\u2611" : "\u2610"} .${record.className}`, secondary: record.description });
      const toggle = (name) => cell && edit((d) => ops.toggleClass(d, cell.id, name, !ops.classesOf(ops.selectedCell(d) || cell).includes(name)));

      const common = cell ? ops.commonClassesOf(ops.emptyDoc(), cell) : [];
      const found = filteredClasses({ find: ctx.get("find"), off: ctx.get("off") });
      const shown = Math.max(CHUNK, Math.floor(Number(ctx.get("shown")) || CHUNK));
      const page = found.slice(0, shown);
      return [
        ...(common.length
          ? [NODES.section("common", t("section.common"), [listCard(api, item, "common", t("section.common"), common.map(row), toggle, { icon: "stars" })])]
          : []),
        NODES.section("filter", t("section.catalog"), [classFilter(ctx)]),
        NODES.section("classes", "", [
          listCard(api, item, "classes", t("section.catalog"), page.map(row), toggle, { icon: "tags" }),
          ...(found.length > page.length
            ? [NODES.actions("more", [{ key: "more", label: t("action.more", { n: found.length - page.length }), run: () => ctx.set("shown", shown + CHUNK) }])]
            : []),
        ]),
      ];
  }

  function body_bseditor_attrs(api, item, ctx) {
      const found = ops.searchAttributes(ctx.get("find"));
      const card = (record) =>
        NODES.card(`a-${record.name}`, "", [
          NODES.props(`a-p-${record.name}`, [
            describe({ type: "string", readonly: true, hint: record.description, read: () => "" }, { api, key: `${item.id}-a-${record.name}`, label: record.name }),
          ]),
        ], [], { side: true, port: { item: item.id, key: "attributes", path: [record.name] } });
      return [
        NODES.section("filter", "", [findBox()]),
        NODES.section("catalog", t("section.attrCatalog"), found.map(card)),
      ];
  }

  function body_bseditor_attradd(api, item, ctx) {
      const { now, edit } = cellTools(ctx);
      const cell = now();
      const on = new Set(cell ? ops.attributesOf(cell).map((one) => one.name) : []);
      const rows = ops.searchAttributes(ctx.get("find")).map((record) => ({ id: record.name, primary: `${on.has(record.name) ? "\u2611" : "\u2610"} ${record.name}`, secondary: record.description }));
      // Choosing an attribute puts it on the cell (empty, to be written in the editor), or takes it off.
      const toggle = (name) => {
        if (!cell) return;
        const has = ops.attributesOf(now() || cell).some((one) => one.name === name);
        edit((d) => (has ? ops.removeAttribute(d, cell.id, name) : ops.addAttribute(d, cell.id, name, "")));
      };
      return [
        NODES.section("filter", t("section.attrCatalog"), [findBox()]),
        NODES.section("attributes", "", [listCard(api, item, "attributes", t("section.attrCatalog"), rows, toggle, { icon: "tag" })]),
      ];
  }

  function body_DECOR_ID(api, item, ctx) {
      const text = String(ctx.get("text") ?? "");
      // What is done to the decorations is done to a cell of this one text.
      const editText = (produce, key = "") => {
        const out = ops.onCell(ops.scratchCell(String(ctx.get("text") ?? "")), produce);
        if (out) S.typed(key, () => ctx.set("text", ops.scratchText(out.cell)));
      };
      const SID = ops.SCRATCH_ID;
      const prop = (key, label, spec) => stringProp(api, item, key, label, spec);

      // ---- the decorations in the text, one after the other as the markup has them
      const flat = (nodes, out = []) => {
        for (const one of nodes) {
          out.push(one);
          flat(one.children, out);
        }
        return out;
      };
      const cards = flat(ops.inlineTree(ops.scratchCell(text))).map((one, index) => {
        const remove = () => editText((d) => ops.removeInline(d, SID, one.id));
        // A link and an icon say more than their range, so they are cards with their properties.
        if (one.icon !== null || one.tag === "a") {
          const attribute = (attr, label) =>
            prop(`inline-${attr}-${index}`, label, {
              control: "textbox",
              read: () => one[attr],
              write: (_api, value) => editText((d) => ops.setInlineAttribute(d, SID, one.id, attr, String(value ?? "")), `inline-${one.id}-${attr}`),
            });
          let rows;
          if (one.icon !== null) {
            rows = [prop(`inline-icon-${index}`, t("cell.icon"), {
              control: "textbox",
              read: () => one.icon,
              write: (_api, value) => editText((d) => ops.setInlineIcon(d, SID, one.id, String(value ?? "")), `inline-${one.id}-icon`),
            })];
          } else {
            rows = [
              prop(`inline-tag-${index}`, t("deco.tag"), {
                type: "enum",
                options: options(INLINE_OPTIONS),
                read: () => one.tag,
                write: (_api, value) => editText((d) => ops.changeInlineTag(d, SID, one.id, value)),
              }),
              attribute("href", t("deco.href")),
              attribute("name", t("deco.anchor")),
              prop(`inline-target-${index}`, t("deco.target"), {
                type: "enum",
                options: options([["", t("deco.targetNone")], ["_blank", t("deco.targetBlank")], ["_self", t("deco.targetSelf")]]),
                read: () => one.target,
                write: (_api, value) => editText((d) => ops.setInlineAttribute(d, SID, one.id, "target", String(value ?? ""))),
              }),
            ];
          }
          const shown = one.text.length > 15 ? `${one.text.slice(0, 15)}…` : one.text;
          // A card of the other kind is another card, not the same one drawn again: the key says which.
          return NODES.card(`inline-card-${index}`, one.icon === null ? t("deco.range", { text: shown }) : t("deco.icon"), [
            NODES.props(`inline-props-${index}`, rows),
          ], [], { icon: "fonts", isListElement: true, onDiscard: remove });
        }
        // The rest are a tag and the text it is on, side by side in a card with its header down the
        // side. Taking it away leaves the text it was on.
        return NODES.card(`inline-side-${index}`, "", [
          NODES.control(`inline-form-${index}`, {
            control: "fieldform",
            fields: [
              {
                key: "tag",
                kind: "select",
                label: t("deco.tag"),
                value: one.tag,
                options: INLINE_OPTIONS,
                onChange: (value) => editText((d) => ops.changeInlineTag(d, SID, one.id, String(value))),
              },
              // A range with decorations inside it is changed through those.
              one.children.length
                ? { key: "text", kind: "readout", label: t("decor.range"), value: one.text }
                : {
                    key: "text",
                    kind: "text",
                    label: t("decor.range"),
                    value: one.text,
                    onChange: (value) => S.later(`inline-${index}`, ctx.settled(() => editText((d) => ops.setInlineText(d, SID, one.id, String(value ?? "")), `inline-${index}-text`))),
                  },
            ],
          }),
        ], [], { side: true, isListElement: true, onDiscard: remove });
      });

      const openCatalog = () => {
        const id = ctx.get("catalog");
        if (id && api.window.reveal(id)) return;
        api.window.openScreen(DECORCATALOG_ID, { app: item.id });
      };

      return [
        NODES.section("text", t("decor.text"), [
          NODES.control("buffer", { desc: describe({ type: RICH, control: "bseditor.textcard", lines: 8, register: (fns) => S.composers.set(item.id, fns), read: () => ctx.get("text"), write: (_api, value) => ctx.set("text", value) }, { api, key: `${item.id}-buffer`, label: t("prop.decorText") }) }),
        ]),
        // A card, for the primary button it leads with.
        NODES.card(
          "decorations",
          t("decor.list"),
          cards,
          [{ key: "add", primary: true, icon: "plus-lg", label: t("decor.add"), title: t("decor.addTitle"), run: openCatalog }],
          { icon: "fonts", empty: cards.length ? "" : t("decor.empty") }
        ),
      ];
  }

  function body_DECORCATALOG_ID(api, item, ctx) {
      const appId = ctx.get("app");
      const entry = appId ? api.items.get(appId) : null;
      if (!entry || entry.type !== DECOR_ID) return [NODES.card("none", "", [], [], { empty: t("decor.noApp") })];
      const put = (tag, attrs) => {
        const composer = S.composers.get(appId);
        if (composer) composer.put(tag, attrs);
      };
      const cards = [...DECORATIONS, ICON_DECORATION].map(([tag, glyph, attrs]) => {
        const icon = Boolean(attrs && attrs.class);
        const label = icon ? t("deco.icon") : (INLINE_OPTIONS.find(([value]) => value === tag) || [tag, tag])[1];
        return NODES.card(`d-${icon ? "icon" : tag}`, label, [], [{ key: "put", primary: true, icon: "plus-lg", label: t("decor.put"), title: icon ? t("decor.putIconTitle") : t("decor.putTitle"), run: () => put(tag, attrs) }], {
          icon: glyph,
          isListElement: true,
        });
      });
      return [NODES.section("catalog", "", cards)];
  }

  function body_HTMLLOAD_ID(api, item, ctx) {
      const text = String(ctx.get("html") ?? "");
      const check = htmlCheck(text);
      const load = () => {
        const made = ops.cellsFromHtml(String(ctx.get("html") ?? ""));
        if (!made.length) return;
        const held = ops.coerceCell(ctx.get("cell"));
        ctx.set("cell", held ? { ...made[0], id: held.id, slotIndex: held.slotIndex || 0, collapsed: Boolean(held.collapsed) } : made[0]);
        ctx.set("html", "");
        ctx.status(made.length > 1 ? t("load.loadedFirst", { n: made.length - 1 }) : t("load.loaded"));
        api.window.back();
      };
      return [
        NODES.control("input", { desc: describe({ type: "string", control: "bseditor.htmlinput", placeholder: "bseditor.load.placeholder", check, onLoad: load, read: () => ctx.get("html"), write: (_api, value) => ctx.set("html", value) }, { api, key: `${item.id}-html`, label: t("prop.html") }), grow: true }),
      ];
  }


  // ---- the screens that draw them: each item's body, named by the item ----------------------------
  const screen = (body) => ({
    body(s) {
      const ctx = {
        get: (key) => s.read(key),
        set: (key, value) => s.set(key, value),
        status: (text) => s.run("say", { text }),
        clear: () => s.run("clear"),
        // A write that waits for a pause in typing (S.later) lands outside the event that asked for it:
        // nothing draws after it then, so the links (the cell this text is shared with) would not hear.
        settled: (fn) => () => {
          fn();
          s.ctx?.refreshAll?.();
        },
      };
      CUR.api = s.api;
      CUR.item = s.item;
      CUR.ctx = ctx;
      return body(s.api, s.item, ctx);
    },
  });
  return {
    "bseditor.cells": screen(body_bseditor_cells),
    "bseditor.add": screen(body_bseditor_add),
    "bseditor.cell": screen(body_bseditor_cell),
    "bseditor.classes": screen(body_bseditor_classes),
    "bseditor.classadd": screen(body_bseditor_classadd),
    "bseditor.attrs": screen(body_bseditor_attrs),
    "bseditor.attradd": screen(body_bseditor_attradd),
    "bseditor.decor": screen(body_DECOR_ID),
    "bseditor.decorcatalog": screen(body_DECORCATALOG_ID),
    "bseditor.htmlload": screen(body_HTMLLOAD_ID),
  };
}
