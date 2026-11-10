/* The two controls the BsEditor items need that the shell does not have.
 *
 *   bseditor.preview   the page as it will be exported, in a frame; in the
 *                      editing view a click on a part of it picks that cell
 *                      and the picked one is outlined.
 *   bseditor.workspace the cells as a tree to work in: each cell a row with its
 *                      tools, the cells it holds nested under it, and between
 *                      them the places a cell can be added, pasted or dropped.
 *   bseditor.spacing   the margin and padding of a cell, as one box: outer then inner
 *                      space on each edge, in the shell's field forms.
 *   bseditor.cellrow   one cell as the row the list shows it in, with the grip
 *                      that carries it: the cell editor's cell.
 *   bseditor.textcard  the shell's text card, holding the markup of one run
 *                      of text: its tags drawn as badges with a handle that moves
 *                      them, and, while a range of the text is selected, a bar of
 *                      tools that wrap it in a decoration (strong, link, mark ...).
 */

import { INLINE_OPTIONS } from "./ops.js";

// The decorations the row offers, in order: tag, icon, attributes it starts with.
export const DECORATIONS = [
  ["strong", "type-bold", {}],
  ["em", "type-italic", {}],
  ["mark", "highlighter", {}],
  ["code", "code", {}],
  ["a", "link-45deg", { href: "#" }],
  ["abbr", "chat-square-text", { title: "説明" }],
  ["del", "type-strikethrough", {}],
  ["ins", "type-underline", {}],
  ["sub", "subscript", {}],
  ["sup", "superscript", {}],
  ["kbd", "keyboard", {}],
  ["span", "braces", {}],
];

// The decoration an icon is: not in the bar (it has no words to be put on), only from the catalog.
export const ICON_DECORATION = ["i", "emoji-smile", { class: "bi bi-star" }];

const OUTLINE_ID = "bseditor-outline";

export default function registerControls(fw) {
  const { core, registerControl } = fw;
  const { t } = core;

  const make = (tag, className, props) => Object.assign(document.createElement(tag), { className, ...props });
  const icon = (name) => make("i", `bi bi-${name}`);


  // ---- a cell as a row ---------------------------------------------------------
  const DRAG_TYPE = "application/x-bseditor-cell";

  // One cell as a row, the same wherever it is shown (the list, the bar, the cell
  // editor): its grip first, the fold if it holds cells, the tag it is written
  // with, and a few words of what it says. `drag` makes the grip move the cell
  // in the list; `port` makes it carry the cell (and the row take one dropped on it).
  function cellRow(cell, { drag = null, fold = null, port = null, root = null } = {}) {
    const row = root || make("div", "bs-row");
    row.classList.add("bs-node-head");
    const button = (className, iconName, title, onClick) => {
      const one = make("button", className, { type: "button", title });
      one.append(icon(iconName));
      one.addEventListener("click", (event) => {
        event.stopPropagation();
        onClick();
      });
      return one;
    };
    const grip = make("span", "mu-icon-button bs-grip", { title: t("bseditor.action.drag") });
    grip.append(icon("grip-vertical"));
    if (drag) {
      grip.draggable = true;
      grip.addEventListener("dragstart", (event) => {
        event.dataTransfer.setData(DRAG_TYPE, cell.id);
        event.dataTransfer.effectAllowed = "move";
        drag.start();
      });
      grip.addEventListener("dragend", () => drag.end());
    }
    const parts = [
      grip,
      make("span", "bs-kind", { textContent: cell.tag || "" }),
      make("span", "bs-snippet", { textContent: cell.collapsed ? `${t("bseditor.cell.folded")} ${cell.snippet}` : cell.snippet || "" }),
    ];
    // Folding is at the end of the row, so that nothing stands between the grip and the tag.
    if (fold) {
      parts.push(button("mu-icon-button bs-fold", cell.collapsed ? "chevron-right" : "chevron-down", cell.collapsed ? t("bseditor.action.unfold") : t("bseditor.action.fold"), fold));
    }
    row.replaceChildren(...parts);
    if (port) core.attachPort(root || row, grip, port);
    return row;
  }

  function drawWorkspace(el) {
    const p = el.__desc.params;
    const say = (name, ...args) => p[name] && p[name](...args);

    // A place a cell can go: add, or paste while something is held; a cell
    // dragged by its grip is dropped on it.
    const divider = (at, empty) => {
      const pasting = Boolean(p.clip);
      const one = make("button", `bs-divider${empty ? " is-empty" : ""}${pasting ? " is-paste" : ""}`, { type: "button" });
      const label = pasting ? t("bseditor.action.paste") : t("bseditor.action.add");
      one.title = label;
      one.append(icon(pasting ? "clipboard-plus" : "plus-lg"));
      if (empty) one.append(make("span", "bs-divider-label", { textContent: label }));
      one.addEventListener("click", (event) => {
        event.stopPropagation();
        say(pasting ? "onPaste" : "onAdd", at);
      });
      one.addEventListener("dragover", (event) => {
        if (!event.dataTransfer.types.includes(DRAG_TYPE)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        one.classList.add("is-over");
      });
      one.addEventListener("dragleave", () => one.classList.remove("is-over"));
      one.addEventListener("drop", (event) => {
        const id = event.dataTransfer.getData(DRAG_TYPE);
        one.classList.remove("is-over");
        if (!id) return;
        event.preventDefault();
        event.stopPropagation();
        say("onMove", id, at);
      });
      return one;
    };

    const list = (parent, slot, items) => {
      const box = make("div", "bs-list");
      if (!items.length) {
        box.append(divider({ parent, index: 0, slot }, true));
        return box;
      }
      items.forEach((item, index) => {
        box.append(divider({ parent, index, slot }, false), node(item));
      });
      box.append(divider({ parent, index: items.length, slot }, false));
      return box;
    };

    const node = (item) => {
      const active = item.id === p.active;
      const held = p.clip && p.clip.id === item.id ? p.clip.mode : "";
      const wrap = make("div", `bs-node${active ? " is-active" : ""}${held ? ` is-${held}` : ""}${item.collapsed ? " is-collapsed" : ""}`);
      wrap.dataset.cellId = item.id;
      const hasSlots = item.slots.length > 0;
      wrap.append(
        cellRow(item, {
          drag: { start: () => el.classList.add("is-dragging"), end: () => el.classList.remove("is-dragging") },
          fold: hasSlots ? () => say("onFold", item.id) : false,
        })
      );
      wrap.addEventListener("click", (event) => {
        event.stopPropagation();
        say("onSelect", item.id);
      });

      if (hasSlots && !item.collapsed) {
        const body = make("div", "bs-node-body");
        for (const slot of item.slots) {
          const part = make("div", "bs-slot");
          if (slot.label) part.append(make("div", "bs-slot-label", { textContent: slot.label }));
          part.append(list(item.id, slot.slot, slot.items));
          body.append(part);
        }
        wrap.append(body);
      }
      return wrap;
    };

    el.__body.replaceChildren(list("", 0, p.items || []));
    const picked = el.__body.querySelector(".bs-node.is-active");
    if (picked && el.__picked !== p.active) picked.scrollIntoView({ block: "nearest" });
    el.__picked = p.active;
    drawBar(el);
  }

  // The bar under the card's header. Its first row is the picked cell -- the
  // same row as in the list, its grip carrying the cell -- and the tools that act
  // on it. While a cell is copied or cut a second row shows it, and lets it go.
  function drawBar(el) {
    const p = el.__desc.params;
    const tool = (name, key, callback, off) => {
      const one = make("button", "mu-icon-button bs-tool", { type: "button", title: t(key), disabled: off });
      one.append(icon(name));
      one.addEventListener("click", (event) => {
        event.stopPropagation();
        if (p[callback]) p[callback]();
      });
      return one;
    };
    const row = fw.card.barRow(el, "picked");
    // Nothing picked: no bar at all (a copied cell still shows, with the way to let it go).
    fw.card.bar(el).hidden = !p.picked && !p.clipped;
    row.hidden = !p.picked;
    const shown = make("div", "bs-node bs-bar-cell");
    cellRow(p.picked || { id: "", tag: "", snippet: t("bseditor.cell.noneShort") }, { port: p.picked ? p.pickedPort : null, root: shown });
    const tools = make("span", "bs-bar-tools");
    tools.append(
      tool("files", "bseditor.action.copy", "onCopy", !p.picked),
      tool("scissors", "bseditor.action.cut", "onCut", !p.picked),
      tool("trash", "bseditor.action.delete", "onDelete", !p.picked)
    );
    row.replaceChildren(shown, tools);

    const held = fw.card.barRow(el, "clip");
    held.hidden = !p.clipped;
    if (p.clipped) {
      const there = make("div", `bs-node bs-bar-cell is-${p.clipped.mode}`);
      // What is held says how: copied or cut.
      const how = make("span", "bs-clip-mode", { title: t(`bseditor.clip.${p.clipped.mode}`) });
      how.append(icon(p.clipped.mode === "cut" ? "scissors" : "files"), make("span", "bs-clip-word", { textContent: t(`bseditor.clip.${p.clipped.mode}`) }));
      cellRow(p.clipped, { root: there });
      there.prepend(how);
      const clear = make("span", "bs-bar-tools");
      clear.append(tool("x-circle", "bseditor.action.clearClip", "onClearClip", false));
      held.replaceChildren(there, clear);
    } else {
      held.replaceChildren();
    }
  }

  registerControl("bseditor.workspace", {
    // Draws as a card, named in its header only as an entry of a list.
    cardName: (desc) => desc.head || "",
    label: "bseditor.control.workspace",
    why: "the cells of a page as a tree to work in -- each with the cells it holds nested in it, and the places between them to add, paste or drop one -- under a bar that holds the picked cell and the tools that act on it; the shell's lists are flat and its cards cannot take a cell dragged between them",
    standalone: true,
    params: ["port", "items", "active", "clip", "picked", "pickedPort", "clipped", "canUndo", "canRedo", "canNew", "onSelect", "onFold", "onCopy", "onCut", "onDelete", "onAdd", "onPaste", "onMove", "onClearClip", "onUndo", "onRedo", "onNew", "expand"],
    render(desc) {
      const el = make("div", "mu-card bs-workspace");
      // The page's own tools stand in the header: undo, redo, and a new page.
      const headTool = (name, key, callback) => {
        const one = make("button", "mu-icon-button bs-head-tool", { type: "button", title: t(key) });
        one.append(icon(name));
        one.addEventListener("click", (event) => {
          event.stopPropagation();
          if (el.__desc.params[callback]) el.__desc.params[callback]();
        });
        return one;
      };
      const tools = [headTool("arrow-counterclockwise", "bseditor.action.undo", "onUndo"), headTool("arrow-clockwise", "bseditor.action.redo", "onRedo"), headTool("file-earmark-x", "bseditor.action.new", "onNew")];
      const parts = fw.card.buildHead("bs-workspace", { tools });
      el.__parts = parts;
      el.__headTools = tools;
      el.__body = make("div", "bs-workspace-body");
      el.append(parts.head, el.__body);
      el.__desc = desc;
      fw.controls["bseditor.workspace"].update(el, desc);
      return el;
    },
    update(el, desc) {
      el.__desc = desc;
      const p = desc.params;
      fw.card.syncHead(el, el.__parts, { port: p.port || null, name: desc.head || "" });
      el.__headTools[0].disabled = !p.canUndo;
      el.__headTools[1].disabled = !p.canRedo;
      el.__headTools[2].disabled = !p.canNew;
      core.fitCardHead(el.__parts.head);
      // Drawn again only when what it shows has changed: the callbacks are new
      // every time, and drawing over a drag would end it.
      const sign = JSON.stringify([p.items, p.active, p.clip, p.picked, p.clipped]);
      if (el.__sign === sign) return;
      el.__sign = sign;
      drawWorkspace(el);
    },
  });

  // One cell as a row, in the window of an item of its own: the cell editor's cell,
  // which takes a cell dropped on it (or linked, or shared) like any port.
  registerControl("bseditor.cellrow", {
    label: "bseditor.control.cellrow",
    why: "a cell as the same row the list shows it in, with the grip that carries it; the shell's cards and rows say nothing of a cell",
    standalone: true,
    params: ["cell", "port"],
    render(desc) {
      const el = make("div", "bs-node bs-cellrow");
      el.__desc = desc;
      fw.controls["bseditor.cellrow"].update(el, desc);
      return el;
    },
    update(el, desc) {
      el.__desc = desc;
      const p = desc.params;
      const sign = JSON.stringify(p.cell || null);
      if (el.__sign === sign) return;
      el.__sign = sign;
      cellRow(p.cell || { id: "", tag: "", snippet: t("bseditor.cell.noneShort") }, { port: p.port, root: el });
    },
  });

  // ---- the spacing ------------------------------------------------------------
  // The margin and the padding of a cell, as the one box they are thought of in: from
  // outside in on each edge (the margin, then the padding), with the cell between. The
  // shell's field form is the frame of every part -- the top and the bottom are two cells
  // stacked, the sides two cells side by side -- and under the box, the shorthands that
  // set a whole edge pair or all four at once.
  const EDGES = {
    top: [["mt", "m", "top"], ["pt", "p", "top"]],
    start: [["ms", "m", "start"], ["ps", "p", "start"]],
    end: [["pe", "p", "end"], ["me", "m", "end"]],
    bottom: [["pb", "p", "bottom"], ["mb", "m", "bottom"]],
  };
  const SHORTHANDS = {
    m: [["m-all", "all"], ["mx", "x"], ["my", "y"]],
    p: [["p-all", "all"], ["px", "x"], ["py", "y"]],
  };

  registerControl("bseditor.spacing", {
    label: "bseditor.control.spacing",
    why: "the margin and the padding of a cell as the one box they are thought of in, outer space then inner space on each edge; the shell's field form is the frame of each part, and the box is four of them (and two rows of shorthands) placed around the cell",
    standalone: true,
    params: ["values", "options", "onChange"],
    render(desc) {
      const el = make("div", "bs-spacing");
      el.__forms = {};
      // A form to each edge and each shorthand row; the box is laid out as a grid.
      const part = (name, layout) => {
        const form = fw.controls.fieldform.render({ params: { fields: [], layout } });
        form.classList.add("bs-form", `is-${name}`);
        el.__forms[name] = form;
        return form;
      };
      el.append(
        part("top", "stack"),
        part("start", "row"),
        make("div", "bs-core"),
        part("end", "row"),
        part("bottom", "stack"),
        part("m", "row"),
        part("p", "row")
      );
      el.__desc = desc;
      fw.controls["bseditor.spacing"].update(el, desc);
      return el;
    },
    update(el, desc) {
      el.__desc = desc;
      const p = desc.params;
      const word = (kind) => t(kind === "m" ? "bseditor.spacing.margin" : "bseditor.spacing.padding");
      // A choice's words are its class, so that a cell says which space it is: mt-3, pb-2.
      const field = (group, heading, stem) => ({
        key: group,
        label: heading,
        value: (p.values && p.values[group]) || "",
        options: ((p.options && p.options[group]) || []).map((one) => [one.value, one.value === "" ? `${stem} –` : one.value]),
        onChange: (value) => el.__desc.params.onChange && el.__desc.params.onChange(group, value),
      });
      const fill = (name, layout, fields) => fw.controls.fieldform.update(el.__forms[name], { params: { fields, layout } });
      for (const [name, edges] of Object.entries(EDGES)) {
        fill(name, name === "top" || name === "bottom" ? "stack" : "row", edges.map(([group, kind, side]) => field(group, `${word(kind)} ${t(`bseditor.spacing.${side}`)}`, group)));
      }
      for (const [kind, groups] of Object.entries(SHORTHANDS)) {
        fill(kind, "row", groups.map(([group, side]) => field(group, `${word(kind)} ${t(`bseditor.spacing.${side}`)}`, group === "m-all" ? "m" : group === "p-all" ? "p" : group)));
      }
    },
  });

  // ---- the preview ----------------------------------------------------------
  const frameDocument = (frame) => {
    try {
      return frame.contentDocument;
    } catch {
      return null;
    }
  };

  function outline(frame, active) {
    const doc = frameDocument(frame);
    if (!doc || !doc.head) return;
    let style = doc.getElementById(OUTLINE_ID);
    if (!style) {
      style = doc.createElement("style");
      style.id = OUTLINE_ID;
      doc.head.append(style);
    }
    const css = active ? `[data-preview-cell-id="${CSS.escape(active)}"]{outline:2px solid #6366f1;outline-offset:2px;}` : "";
    if (style.textContent !== css) style.textContent = css;
  }

  function wire(frame, el) {
    const doc = frameDocument(frame);
    if (!doc || !doc.body) return;
    doc.addEventListener("click", (event) => {
      const p = el.__desc.params;
      if (p.mode !== "edit" || !p.onPick) return;
      const target = event.target.closest ? event.target.closest("[data-preview-cell-id]") : null;
      event.preventDefault();
      if (target) p.onPick(target.getAttribute("data-preview-cell-id"));
    });
    // A pick that landed on the cell under the pointer, deepest first.
    doc.addEventListener("mouseover", (event) => {
      const p = el.__desc.params;
      doc.body.style.cursor = p.mode === "edit" && event.target.closest && event.target.closest("[data-preview-cell-id]") ? "pointer" : "";
    });
  }

  registerControl("bseditor.preview", {
    label: "bseditor.control.preview",
    why: "the page as it is exported, drawn by the browser with Bootstrap in a frame of its own; the shell has no control that shows markup",
    standalone: true,
    params: ["page", "active", "mode", "onPick", "bare", "grow"],
    render(desc) {
      const el = make("div", "bs-preview");
      const frame = make("iframe", "bs-preview-frame", { title: "preview" });
      // Same origin so that the shell can see the clicks; no scripts run in it.
      frame.setAttribute("sandbox", "allow-same-origin");
      frame.addEventListener("load", () => {
        const doc = frameDocument(frame);
        const top = el.__scroll || 0;
        if (doc && doc.scrollingElement) doc.scrollingElement.scrollTop = top;
        wire(frame, el);
        outline(frame, el.__desc.params.mode === "edit" ? el.__desc.params.active : "");
      });
      el.append(frame);
      el.__frame = frame;
      el.__desc = desc;
      fw.controls["bseditor.preview"].update(el, desc);
      return el;
    },
    update(el, desc) {
      el.__desc = desc;
      const frame = el.__frame;
      const p = desc.params;
      el.dataset.mode = p.mode;
      el.classList.toggle("is-bare", Boolean(p.bare));
      if (el.__page !== p.page) {
        const doc = frameDocument(frame);
        el.__scroll = doc && doc.scrollingElement ? doc.scrollingElement.scrollTop : 0;
        el.__page = p.page;
        frame.srcdoc = p.page;
        return;
      }
      outline(frame, p.mode === "edit" ? p.active : "");
    },
  });

  // ---- the text of one run, with its decorations ---------------------------
  // The text is kept as markup (what the page is made of) and written as text: a decoration is
  // not shown as its tags but as a card with a handle that holds the words it is on, a new line
  // is a line break (`<br>`) with a mark at the end of its line. So what the field holds (the
  // "display") is not the markup: each decoration is a handle character with its number after it
  // (in characters that have no width), and an end character; the markup is made back from it.
  const OPEN = "\u2003";
  const CLOSE = "\u2064";
  const DIGITS = ["\u200B", "\u200C", "\u200D", "\u2062"];
  const DIGIT_CLASS = "[\\u200B\\u200C\\u200D\\u2062]";
  const encodeId = (n) => [...n.toString(4)].map((d) => DIGITS[Number(d)]).join("");
  const decodeId = (zw) => parseInt([...zw].map((c) => DIGITS.indexOf(c)).join(""), 4);
  const escapeText = (text) => String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const escapeAttr = (value) => String(value).replace(/&/g, "&amp;").replace(/"/g, "&quot;");
  const openTag = (tag, attrs) => `<${tag}${Object.entries(attrs || {}).map(([k, v]) => ` ${k}="${escapeAttr(v)}"`).join("")}>`;
  const tagOf = (open) => (/^<([a-z][a-z0-9]*)/i.exec(open) || [, "span"])[1].toLowerCase();

  // Tokens of a display: where each decoration opens (and how long its mark is) and closes, in
  // matching pairs. A mark without its pair is only a character.
  function pairsOf(display) {
    const marks = [];
    const re = new RegExp(`${OPEN}(${DIGIT_CLASS}*)|${CLOSE}`, "g");
    for (const m of display.matchAll(re)) {
      marks.push(m[0] === CLOSE ? { close: true, from: m.index, to: m.index + 1 } : { close: false, from: m.index, to: m.index + m[0].length, id: m[1] ? decodeId(m[1]) : NaN });
    }
    const stack = [];
    const pairs = [];
    for (const mark of marks) {
      if (!mark.close) stack.push(mark);
      else if (stack.length) pairs.push({ open: stack.pop(), close: mark });
    }
    return pairs;
  }

  // The display of some markup, its decorations numbered in `state`.
  function expand(markup, state) {
    const body = new DOMParser().parseFromString(`<body>${markup || ""}</body>`, "text/html").body;
    let out = "";
    const walk = (node) => {
      for (const child of node.childNodes) {
        if (child.nodeType === Node.TEXT_NODE) {
          out += child.nodeValue.replace(/\s*\n\s*/g, " ").replace(new RegExp(`[${OPEN}${CLOSE}]|${DIGIT_CLASS}`, "g"), "");
        } else if (child.nodeType === Node.ELEMENT_NODE) {
          if (child.tagName === "BR") {
            out += "\n";
            continue;
          }
          const attrs = {};
          for (const attr of child.attributes) if (attr.name !== "data-inline-id" && !attr.name.startsWith("data-edit")) attrs[attr.name] = attr.value;
          const tag = child.tagName.toLowerCase();
          const id = state.next++;
          state.decos.set(id, { open: openTag(tag, attrs), close: `</${tag}>` });
          out += OPEN + encodeId(id);
          walk(child);
          out += CLOSE;
        }
      }
    };
    walk(body);
    // A line break at the very end of a page's text shows nothing: the last one is only the place
    // for the line that is not there yet (see toMarkup).
    return out.endsWith("\n") ? out.slice(0, -1) : out;
  }

  // The markup of a display: a mark without its pair, or of a number nobody knows, is let go (the
  // words stay), a new line is a line break.
  function toMarkup(display, state) {
    const pairs = pairsOf(display);
    const opens = new Map(pairs.map((pair) => [pair.open.from, pair]));
    const closes = new Map(pairs.map((pair) => [pair.close.from, pair]));
    let out = "";
    let at = 0;
    const text = (to) => {
      const piece = display.slice(at, to).replace(new RegExp(`[${OPEN}${CLOSE}]|${DIGIT_CLASS}`, "g"), "");
      out += piece.split("\n").map(escapeText).join("<br>");
    };
    const re = new RegExp(`${OPEN}${DIGIT_CLASS}*|${CLOSE}`, "g");
    for (const m of display.matchAll(re)) {
      text(m.index);
      at = m.index + m[0].length;
      const open = opens.get(m.index);
      const close = closes.get(m.index);
      if (open) {
        const deco = state.decos.get(open.open.id);
        if (deco) out += deco.open;
      } else if (close) {
        const deco = state.decos.get(close.open.id);
        if (deco) out += deco.close;
      }
    }
    text(display.length);
    // A new line at the very end is made to show: the browser takes the last `<br>` of a block for
    // nothing, so one more stands for the line that is waiting.
    return display.endsWith("\n") ? `${out}<br>` : out;
  }

  // Put `text` where `from..to` is, the way typing would: through the
  // browser's own editing, so undo works and the textarea says `input`.
  function replaceRange(area, from, to, text) {
    area.focus();
    area.setSelectionRange(from, to);
    let done = false;
    try {
      done = document.execCommand("insertText", false, text);
    } catch {
      done = false;
    }
    if (!done) {
      area.setRangeText(text, from, to, "end");
      area.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }

  // The range a decoration may be put on: a mark's pair is not cut in two, nor is a mark in itself.
  function balanced(display, from, to) {
    const pairs = pairsOf(display);
    let a = from;
    let b = to;
    for (let again = true; again; ) {
      again = false;
      for (const { open, close } of pairs) {
        if (a > open.from && a < open.to) {
          a = open.from;
          again = true;
        }
        if (b > open.from && b < open.to) {
          b = open.to;
          again = true;
        }
        const openIn = open.from >= a && open.to <= b;
        const closeIn = close.from >= a && close.to <= b;
        if (openIn && !closeIn) {
          b = close.to;
          again = true;
        } else if (closeIn && !openIn) {
          a = open.from;
          again = true;
        }
      }
    }
    return [a, b];
  }

  // ---- the decorations, drawn as cards over the text ----------------------------------
  // The same way the text composer draws its variables: a layer over the textarea, in its box and
  // face and moved with its scrolling, draws what it is told over the characters it is made of
  // (nothing in it adds width, or the text after it would drift). Here a decoration is a card
  // from its handle to its end, nested as the decorations are; the handle shows the decoration's
  // icon and carries the card: pulled to another place in the text, it takes the card there.
  const ICON_OF = new Map(DECORATIONS.map(([tag, glyph]) => [tag, glyph]));
  const LABEL_OF = new Map(INLINE_OPTIONS);
  const glyphOf = (open) => {
    const named = /\bbi-([a-z0-9-]+)/.exec(open);
    return named ? named[1] : ICON_OF.get(tagOf(open)) || "braces";
  };

  function cardLayer(el, area) {
    const layer = make("div", "bs-layer");
    const inner = make("div", "bs-layer-in");
    const drop = make("div", "bs-drop", { hidden: true });
    layer.append(inner);
    fw.controls.texteditor.slots(el).body(layer, drop);
    const state = { key: "" };
    const place = () => {
      const own = getComputedStyle(area);
      Object.assign(layer.style, {
        left: `${area.offsetLeft}px`,
        top: `${area.offsetTop}px`,
        width: `${area.offsetWidth}px`,
        height: `${area.offsetHeight}px`,
        display: area.hidden ? "none" : "",
      });
      Object.assign(inner.style, {
        width: `${area.clientWidth}px`,
        font: own.font,
        letterSpacing: own.letterSpacing,
        lineHeight: own.lineHeight,
        tabSize: own.tabSize,
        padding: own.padding,
        whiteSpace: area.wrap === "off" ? "pre" : "pre-wrap",
        transform: `translate(${-area.scrollLeft}px, ${-area.scrollTop}px)`,
      });
      return own;
    };
    const draw = () => {
      const value = area.value;
      const own = place();
      const key = `${value}\u0000${own.font}\u0000${area.clientWidth}\u0000${own.padding}\u0000${area.wrap}`;
      if (key === state.key) return;
      state.key = key;
      inner.replaceChildren();
      const decos = el.__bs.state.decos;
      const pairs = pairsOf(value);
      const opens = new Map(pairs.map((pair) => [pair.open.from, pair]));
      const closes = new Set(pairs.map((pair) => pair.close.from));
      const stack = [inner];
      const here = () => stack[stack.length - 1];
      let at = 0;
      const text = (to) => {
        const lines = value.slice(at, to).split("\n");
        lines.forEach((line, index) => {
          if (index) {
            // The mark at the end of a line: it takes no room.
            here().append(make("span", "bs-nl"), document.createTextNode("\n"));
          }
          if (line) here().append(document.createTextNode(line));
        });
      };
      const re = new RegExp(`${OPEN}${DIGIT_CLASS}*|${CLOSE}`, "g");
      for (const m of value.matchAll(re)) {
        text(m.index);
        at = m.index + m[0].length;
        const pair = opens.get(m.index);
        if (pair) {
          const deco = decos.get(pair.open.id);
          const open = deco ? deco.open : "<span>";
          const card = make("span", "bs-card", { });
          card.dataset.tag = tagOf(open);
          const handle = make("span", "bs-card-handle", { title: LABEL_OF.get(tagOf(open)) || tagOf(open) });
          handle.append(make("i", `bi bi-${glyphOf(open)}`), document.createTextNode(OPEN));
          handle.addEventListener("pointerdown", (event) => startMove(event, m.index));
          card.append(handle, document.createTextNode(m[0].slice(1)));
          here().append(card);
          stack.push(card);
        } else if (closes.has(m.index) && stack.length > 1) {
          here().append(document.createTextNode(m[0]));
          stack.pop();
        } else {
          here().append(document.createTextNode(m[0]));
        }
      }
      text(value.length);
    };
    area.addEventListener("scroll", () => {
      inner.style.transform = `translate(${-area.scrollLeft}px, ${-area.scrollTop}px)`;
    });
    new ResizeObserver(draw).observe(area);

    // Where in the text a point is, found in the layer's own copy of it (a textarea cannot say).
    function* walk(root) {
      for (const node of root.childNodes) {
        if (node.nodeType === Node.TEXT_NODE) yield node;
        else yield* walk(node);
      }
    }
    const offsetAt = (x, y) => {
      layer.classList.add("is-hit");
      const point = document.caretPositionFromPoint
        ? document.caretPositionFromPoint(x, y)
        : (() => {
            const range = document.caretRangeFromPoint(x, y);
            return range ? { offsetNode: range.startContainer, offset: range.startOffset } : null;
          })();
      layer.classList.remove("is-hit");
      if (!point || !inner.contains(point.offsetNode)) return null;
      const range = document.createRange();
      range.selectNodeContents(inner);
      range.setEnd(point.offsetNode, point.offset);
      return range.toString().length;
    };
    const rectAt = (offset) => {
      const range = document.createRange();
      let left = offset;
      for (const node of walk(inner)) {
        const length = node.textContent.length;
        if (left <= length) {
          range.setStart(node, left);
          range.setEnd(node, left);
          const rects = range.getClientRects();
          return rects.length ? rects[0] : null;
        }
        left -= length;
      }
      return null;
    };
    // A place that is not inside a handle's mark.
    const outside = (offset, pairs) => {
      const inside = pairs.map((pair) => pair.open).find((open) => offset > open.from && offset < open.to);
      return inside ? inside.to : offset;
    };

    function startMove(event, from) {
      if (event.button !== 0 || area.readOnly) return;
      event.preventDefault();
      event.stopPropagation();
      const pairs = pairsOf(area.value);
      const pair = pairs.find((one) => one.open.from === from);
      if (!pair) return;
      const start = pair.open.from;
      const end = pair.close.to;
      let target = null;
      const box = el.getBoundingClientRect();
      const move = (e) => {
        const found = offsetAt(e.clientX, e.clientY);
        target = found === null ? null : outside(found, pairs);
        const rect = target === null ? null : rectAt(target);
        drop.hidden = !rect;
        if (rect) Object.assign(drop.style, { left: `${rect.left - box.left}px`, top: `${rect.top - box.top}px`, height: `${rect.height}px` });
      };
      const done = (e) => {
        window.removeEventListener("pointermove", move, true);
        window.removeEventListener("pointerup", done, true);
        window.removeEventListener("pointercancel", done, true);
        document.body.classList.remove("bs-moving");
        drop.hidden = true;
        if (e.type === "pointercancel" || target === null || (target >= start && target <= end)) return;
        const value = area.value;
        const card = value.slice(start, end);
        // One edit that covers what lies between, so the textarea's own undo takes it back whole.
        let a;
        let b;
        let put;
        if (target > end) {
          a = start;
          b = target;
          put = value.slice(end, target) + card;
        } else {
          a = target;
          b = end;
          put = card + value.slice(target, start);
        }
        replaceRange(area, a, b, put);
      };
      document.body.classList.add("bs-moving");
      window.addEventListener("pointermove", move, true);
      window.addEventListener("pointerup", done, true);
      window.addEventListener("pointercancel", done, true);
      move(event);
    }
    state.draw = () => {
      state.key = "";
      draw();
    };
    area.addEventListener("input", draw);
    return state;
  }

  function build(el) {
    const slots = fw.controls.texteditor.slots(el);
    const area = slots.area;
    const parts = { area, state: { decos: new Map(), next: 1 }, last: { markup: null, display: "" } };

    // The bar of tools is there while a range of the text is selected: each wraps that range in a
    // decoration, which the list of decorations then shows.
    const row = fw.card.barRow(el, "decorate");
    row.classList.add("bs-tools");
    // Under the text, not over it: the bar comes and goes with the selection, and a bar over the text
    // pushes the lines down while the mouse is still selecting them.
    slots.body(row.parentElement);
    // A decoration put on `from..to` (the caret, where nothing is selected): its mark round the words.
    parts.put = (tag, attrs) => {
      if (area.readOnly) return;
      const [from, to] = balanced(area.value, area.selectionStart, area.selectionEnd);
      const id = parts.state.next++;
      parts.state.decos.set(id, { open: openTag(tag, attrs), close: `</${tag}>` });
      const icon = Boolean(attrs && attrs.class && /\bbi\b/.test(attrs.class));
      const inner = icon ? "" : area.value.slice(from, to) || t("bseditor.deco.text");
      // An icon has no words: it goes at the end of what is selected.
      if (icon) replaceRange(area, to, to, OPEN + encodeId(id) + CLOSE);
      else replaceRange(area, from, to, OPEN + encodeId(id) + inner + CLOSE);
    };
    for (const [tag, iconName, attrs] of DECORATIONS) {
      const button = make("button", "mu-icon-button bs-tool", { type: "button" });
      button.append(icon(iconName));
      // Pressing a tool must not take the selection away from the text.
      button.addEventListener("mousedown", (event) => event.preventDefault());
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        parts.put(tag, attrs);
      });
      const label = INLINE_OPTIONS.find(([value]) => value === tag);
      button.title = label ? label[1] : tag;
      row.append(button);
    }
    parts.row = row;
    parts.tools = [...row.children];
    const show = (on) => {
      row.hidden = !on;
      row.parentElement.hidden = !on;
    };
    parts.show = show;
    const told = () => show(area.selectionStart !== area.selectionEnd && !area.hidden && !area.readOnly);
    for (const name of ["select", "keyup", "mouseup", "focus", "input"]) area.addEventListener(name, told);
    // Leaving the text for the bar keeps the range; leaving it for anything else lets it go.
    area.addEventListener("blur", (event) => {
      if (!event.relatedTarget || !el.contains(event.relatedTarget)) show(false);
    });
    show(false);

    // The caret stays out of a handle's mark; Backspace after one, or Delete before one, takes all
    // of it (and the decoration is let go, its words stay).
    let last = 0;
    document.addEventListener("selectionchange", () => {
      if (document.activeElement !== area || !el.isConnected) return;
      const opens = pairsOf(area.value).map((pair) => pair.open);
      let from = area.selectionStart;
      let to = area.selectionEnd;
      const inside = (pos) => opens.find((open) => pos > open.from && pos < open.to);
      const a = inside(from);
      const b = inside(to);
      if (from === to && a) from = to = from >= last ? a.to : a.from;
      else {
        if (a) from = a.from;
        if (b) to = b.to;
      }
      if (from !== area.selectionStart || to !== area.selectionEnd) area.setSelectionRange(from, to, area.selectionDirection);
      last = area.selectionStart;
    });
    area.addEventListener("keydown", (event) => {
      if ((event.key !== "Backspace" && event.key !== "Delete") || area.selectionStart !== area.selectionEnd) return;
      const at = area.selectionStart;
      const open = pairsOf(area.value).map((pair) => pair.open).find((one) => (event.key === "Backspace" ? one.to === at : one.from === at));
      if (open) area.setSelectionRange(open.from, open.to);
    });

    parts.layer = cardLayer(el, area);
    el.classList.add("bs-textcard");
    el.__bs = parts;
    return parts;
  }

  // What the field is told: the markup, as the display it comes to (kept while it is the markup
  // the field itself made, so the numbers of the decorations in it stay).
  function shown(el, desc) {
    const parts = el.__bs;
    const markup = String(desc.value ?? "");
    if (parts.last.markup !== markup) parts.last = { markup, display: expand(markup, parts.state) };
    return { ...desc, value: parts.last.display };
  }

  function update(el, desc) {
    el.__bsDesc = desc;
    const parts = el.__bs;
    fw.controls.texteditor.update(el, shown(el, desc));
    // What copy takes is the markup.
    el.__text = String(desc.value ?? "");
    for (const button of parts.tools) button.disabled = parts.area.readOnly;
    // Folded to its one line the text has no selection to wrap.
    if (parts.area.hidden) parts.show(false);
    if (typeof desc.params.register === "function") desc.params.register({ put: parts.put });
    parts.layer.draw();
  }

  // ---- HTML to make a cell of ---------------------------------------------------------
  // The text card, with the main button "Load" in its header, and under the header a bar that
  // says whether what is written can be made into a cell.
  registerControl("bseditor.htmlinput", {
    extends: "texteditor",
    // Never named in its header, wherever it stands.
    cardName: () => "",
    label: "bseditor.control.htmlinput",
    why: "the shell's text card for HTML, with a main button in its header that is off until the text can be made into a cell, and a bar that says whether it can",
    params: { check: { type: "data" }, onLoad: { type: "action" } },
    render(desc, onChange) {
      const el = fw.controls.texteditor.render(desc, onChange);
      const go = make("button", "mu-icon-button is-primary bs-load", { type: "button" });
      go.append(icon("box-arrow-in-down"), make("span", "mu-button-label"));
      go.addEventListener("click", (event) => {
        event.stopPropagation();
        if (el.__bsDesc && el.__bsDesc.params.onLoad) el.__bsDesc.params.onLoad();
      });
      fw.controls.texteditor.slots(el).lead(go);
      const row = fw.card.barRow(el, "check");
      row.classList.add("bs-check");
      el.__bsLoad = { go, row };
      fw.controls["bseditor.htmlinput"].update(el, desc);
      return el;
    },
    update(el, desc) {
      el.__bsDesc = desc;
      fw.controls.texteditor.update(el, desc);
      const { go, row } = el.__bsLoad;
      const check = desc.params.check || { state: "empty", text: "" };
      go.lastElementChild.textContent = t("bseditor.cell.loadOk");
      go.title = t("bseditor.cell.loadOk");
      go.disabled = check.state !== "ok";
      // Nothing written: nothing to say.
      row.hidden = check.state === "empty";
      row.dataset.state = check.state;
      if (check.state === "empty") {
        row.replaceChildren();
      } else {
        row.replaceChildren(icon(check.state === "ok" ? "check-circle" : "exclamation-triangle"), make("span", "bs-check-text", { textContent: check.text }));
      }
      fw.controls.texteditor.slots(el).fit();
    },
  });

  registerControl("bseditor.textcard", {
    extends: "texteditor",
    label: "bseditor.control.textcard",
    // The shell's text card holds words; this one holds markup, shows its decorations as cards that
    // hold the words they are on, and wraps what is selected in a decoration, which a text card
    // has no way to do.
    why: "A run of text as markup, drawn with its decorations as cards with a handle (no tags), a new line as a line break, and a bar that wraps the selected range in a decoration, over the text card it is written back to.",
    params: { register: { type: "action" } },
    render(desc, onChange) {
      let el;
      // What the field holds is a display; what is told on is the markup it comes to.
      const changed = (display) => {
        const parts = el.__bs;
        const markup = toMarkup(display, parts.state);
        parts.last = { markup, display };
        onChange(markup);
      };
      el = fw.controls.texteditor.render(desc, changed);
      build(el);
      update(el, desc);
      return el;
    },
    update,
  });
}
