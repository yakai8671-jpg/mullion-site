/* The document and what is done to it -- BsEditor's operations on cells, with
 * the window taken out.
 *
 * A document (`doc`) is the value the four items share: the cells, which one
 * is selected, what was copied or cut, where a new cell goes, and the
 * templates the user kept. Every operation takes a document and gives back
 * `{doc, note}` -- a new one, the old one untouched -- or null when there was
 * nothing to do; the items decide when that is written and remembered for undo.
 */

import { TEMPLATE_CATALOG } from "./templates.js";
import { CLASS_ROWS, UI_GROUPS } from "./classes.js";
import {
  ALLOWED_ATTRS,
  assignInlineIds,
  buildCellHTML,
  cloneCellRecursive,
  findCellById,
  findCellParentArrayAndIndex,
  findCellParentAndIndex,
  getContainerSlotIndex,
  importHtmlToCells,
  insertChildIntoSlot,
  isCellOrDescendant,
  sanitizeHTML,
} from "./html.js";

export { TEMPLATE_CATALOG, UI_GROUPS };

const clone = (value) => JSON.parse(JSON.stringify(value));
const stamp = () => `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
export const newCellId = () => `cell-${stamp()}`;

export const INLINE_TAGS = ["a", "abbr", "b", "strong", "i", "em", "sub", "sup", "mark", "code", "kbd", "del", "ins", "span"];

// ---- the document ---------------------------------------------------------
export function emptyDoc() {
  return { cells: [], active: "", clip: null, at: null, target: "", favs: [], customs: [], sid: `doc-${stamp()}` };
}

export function coerceDoc(value) {
  const v = value && typeof value === "object" ? value : {};
  const clip = v.clip && typeof v.clip === "object" && v.clip.id ? { id: String(v.clip.id), mode: v.clip.mode === "cut" ? "cut" : "copy" } : null;
  return {
    cells: Array.isArray(v.cells) ? v.cells : [],
    active: typeof v.active === "string" ? v.active : "",
    clip,
    at: v.at && typeof v.at === "object" ? { parent: String(v.at.parent || ""), index: Math.max(0, Math.floor(Number(v.at.index)) || 0), slot: Math.max(0, Math.floor(Number(v.at.slot)) || 0) } : null,
    target: typeof v.target === "string" ? v.target : "",
    favs: Array.isArray(v.favs) ? v.favs : [],
    customs: Array.isArray(v.customs) ? v.customs : [],
    sid: typeof v.sid === "string" && v.sid ? v.sid : `doc-${stamp()}`,
  };
}

// Edit a copy: `fn(next)` changes it and says what was done (a string), or
// false when there was nothing to do.
export function edit(doc, fn) {
  const next = { ...doc, cells: clone(doc.cells) };
  const said = fn(next);
  if (said === false) return null;
  return { doc: next, note: typeof said === "string" ? said : "" };
}

// ---- undo, kept in memory beside the document -------------------------------
const histories = new Map();
const LIMIT = 30;
const history = (doc) => {
  if (!histories.has(doc.sid)) histories.set(doc.sid, { undo: [], redo: [] });
  return histories.get(doc.sid);
};
export const remember = (doc) => {
  const h = history(doc);
  h.undo.push({ cells: clone(doc.cells), active: doc.active });
  if (h.undo.length > LIMIT) h.undo.shift();
  h.redo = [];
};
export const canUndo = (doc) => history(doc).undo.length > 0;
export const canRedo = (doc) => history(doc).redo.length > 0;
export function stepHistory(doc, back) {
  const h = history(doc);
  const from = back ? h.undo : h.redo;
  const to = back ? h.redo : h.undo;
  const shot = from.pop();
  if (!shot) return null;
  to.push({ cells: clone(doc.cells), active: doc.active });
  const active = findCellById(shot.cells, doc.active) ? doc.active : "";
  return { ...doc, cells: shot.cells, active, clip: doc.clip && findCellById(shot.cells, doc.clip.id) ? doc.clip : null };
}

// ---- templates ---------------------------------------------------------------
export function templateOf(doc, id) {
  return (
    TEMPLATE_CATALOG.find((one) => one.id === id) ||
    doc.customs.find((one) => one.id === id) ||
    doc.favs.find((one) => one.id === id || one.templateId === id) ||
    null
  );
}

const parse = (html) => {
  const temp = document.createElement("div");
  temp.innerHTML = html || "";
  return temp;
};
const rootOf = (cell) => parse(cell.html).firstElementChild;

// What a cell is called: its template, else the tag its markup begins with.
export function titleOf(doc, cell) {
  const template = TEMPLATE_CATALOG.find((one) => one.id === cell.templateId) || doc.customs.find((one) => one.id === cell.templateId);
  if (template) return template.title;
  const root = rootOf(cell);
  if (!root) return "セル";
  const tag = root.tagName.toLowerCase();
  const found = TEMPLATE_CATALOG.find((one) => one.id === `tag-${tag}` || one.id === tag);
  return found ? found.title : tag.toUpperCase();
}

export const containerCount = (cell) => parse(cell.html).querySelectorAll(".cell-container").length;
export const isContainerCell = (cell) => containerCount(cell) > 0;
// The slots of a cell's containers, in order: a grid has one to a column, a table one to each cell that holds cells.
export const slotsOf = (cell) =>
  Array.from(parse(cell.html).querySelectorAll(".cell-container")).map((el, i) => getContainerSlotIndex(el, i));

// Whether a cell may turn between text and child cells, and when it may not.
export function modeInfo(doc, cell) {
  const root = rootOf(cell);
  if (!root) return { toggle: false };
  const tag = root.tagName.toLowerCase();
  const template = templateOf(doc, cell.templateId) || {};
  const capable = ["div", "blockquote", "details", "address", "li"].includes(tag) || cell.category === "bs";
  const fixed = template.fixedMode || (["ul", "ol", "dl"].includes(tag) ? "container" : null);
  return { toggle: Boolean(capable && !fixed), fixed, tag };
}

// The cells in the order they are listed, each with how deep it is. A
// collapsed cell hides what is inside it.
export function rowsOf(doc) {
  const rows = [];
  (function walk(cells, depth) {
    for (const cell of cells) {
      const collapsed = Boolean(cell.collapsed);
      rows.push({ cell, depth, collapsed, count: (cell.children || []).length });
      if (!collapsed && cell.children && cell.children.length) walk(cell.children, depth + 1);
    }
  })(doc.cells, 0);
  return rows;
}

export const tagOf = (cell) => {
  const root = rootOf(cell);
  return root ? root.tagName.toLowerCase() : "";
};
// A few words of what the cell says, for the list.
export function snippetOf(cell) {
  const text = (parse(cell.html).textContent || "").replace(/\s+/g, " ").trim();
  return text.length > 28 ? `${text.slice(0, 28)}…` : text;
}

// ---- the page --------------------------------------------------------------
export function bodyHtml(doc, { mark = false } = {}) {
  return doc.cells.map((cell) => `${buildCellHTML(cell, true, mark)}\n`).join("");
}

// `scripts: false` leaves the Bootstrap script out: the preview runs none.
export function pageHtml(doc, { mark = false, scripts = true } = {}) {
  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Exported Page</title>
  <!-- Bootstrap 5 CSS CDN -->
  <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
  <!-- Bootstrap Icons CDN (for the icon cells) -->
  <link href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.10.5/font/bootstrap-icons.css" rel="stylesheet">
  <style>
    body {
      padding-top: 2rem;
      padding-bottom: 4rem;
      background-color: #ffffff;
    }
    img {
      max-width: 100%;
      height: auto;
    }
  </style>
</head>
<body>
  <div class="container">
    ${bodyHtml(doc, { mark })}
  </div>
${scripts ? `  <!-- Bootstrap 5 JS Bundle CDN -->
  <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js"></script>
` : ""}</body>
</html>`;
}

// The cells as the file BsEditor saved: just the array, folded state included.
export function jsonOf(doc) {
  const fold = (cells) => cells.map((c) => ({ ...c, collapsed: Boolean(c.collapsed), children: fold(c.children || []) }));
  return JSON.stringify(fold(doc.cells), null, 2);
}

// ---- where a new cell goes ---------------------------------------------------
// `at` is {parent, index, slot}: the cell it goes into ("" for the page), the
// place among what is already in that slot, and the slot. With no `at`, at the end.
const slotSequence = (list, slot) => list.filter((c) => (c.slotIndex || 0) === slot);

function insertAt(next, cells, at = next.at) {
  const place = at || { parent: "", index: Number.MAX_SAFE_INTEGER, slot: 0 };
  const parent = place.parent ? findCellById(next.cells, place.parent) : null;
  if (place.parent && !parent) {
    insertAt(next, cells, null);
    return;
  }
  const list = parent ? (parent.children = parent.children || []) : next.cells;
  cells.forEach((cell, i) => insertChildIntoSlot(list, cell, place.slot, place.index + i));
}

function made(template, extra = {}) {
  const contentMode =
    template.fixedMode || (template.allowToggleMode ? "text" : template.contentMode || (template.html.includes("cell-container") ? "container" : "text"));
  let children = [];
  if (template.children && template.children.length) children = cloneCellRecursive({ id: "dummy", children: template.children }).children || [];
  const templateId = template.originalTemplateId || template.id || template.templateId || "tag-div";
  return {
    id: newCellId(),
    templateId,
    category: template.originalCategory || (template.category === "custom" ? "bs" : template.category),
    html: assignInlineIds(sanitizeHTML(template.html, false)),
    contentMode,
    detailsOpen: templateId === "tag-details" ? true : template.detailsOpen !== undefined ? template.detailsOpen : undefined,
    collapsed: false,
    children,
    slotIndex: 0,
    ...extra,
  };
}

export function addTemplate(doc, id) {
  const template = templateOf(doc, id);
  if (!template) return null;
  return edit(doc, (next) => {
    const cell = made(template);
    insertAt(next, [cell]);
    next.at = null;
    next.active = cell.id;
    return `「${template.title}」を追加しました。`;
  });
}

export function importHtml(doc, raw) {
  if (!String(raw || "").trim()) return null;
  const cells = importHtmlToCells(raw);
  if (!cells.length) return { doc, note: "変換できる要素が見つかりませんでした。", refused: true };
  return edit(doc, (next) => {
    insertAt(next, cells);
    next.at = null;
    next.active = cells[cells.length - 1].id;
    return `${cells.length} 件のセルとして HTML を取り込みました。`;
  });
}

// The JSON BsEditor saved: an array of cells.
export function loadJson(doc, raw) {
  let cells;
  try {
    cells = JSON.parse(raw);
  } catch (error) {
    return { error: String(error.message || error) };
  }
  if (!Array.isArray(cells)) return { error: "データ形式が正しくありません。" };
  const tidy = (list) => list.forEach((c) => {
    c.collapsed = Boolean(c.collapsed);
    if (!Array.isArray(c.children)) c.children = [];
    if (!c.id) c.id = newCellId();
    tidy(c.children);
  });
  tidy(cells);
  return { result: edit(doc, (next) => {
    next.cells = cells;
    next.active = cells.length ? cells[0].id : "";
    next.clip = null;
    return "JSON を読み込みました。";
  }) };
}

export const clearAll = (doc) => edit(doc, (next) => {
  next.cells = [];
  next.active = "";
  next.clip = null;
  return "新規にしました。";
});

// ---- cells: select, copy, cut, paste, move, fold, delete ---------------------
export const select = (doc, id) => (doc.active === id ? doc : { ...doc, active: id });

export function setClip(doc, id, mode) {
  const same = doc.clip && doc.clip.id === id && doc.clip.mode === mode;
  return { ...doc, clip: same ? null : { id, mode } };
}
export const clearClip = (doc) => ({ ...doc, clip: null });

// Put the cell `id` (moved) or a copy of it (`copy`) at `at`; a cell does not go
// into itself.
function place(doc, id, at, copy) {
  const source = findCellById(doc.cells, id);
  if (!source) return null;
  if (at && at.parent && isCellOrDescendant(source, at.parent)) {
    return { doc, note: "自分自身の子孫の中には貼り付けできません。", refused: true };
  }
  return edit(doc, (next) => {
    const original = findCellById(next.cells, id);
    const target = at ? { ...at } : null;
    let cell;
    if (copy) {
      cell = cloneCellRecursive(original);
    } else {
      const from = findCellParentArrayAndIndex(next.cells, id);
      const sameList = target && (from.parent ? from.parent.id : "") === target.parent && (original.slotIndex || 0) === target.slot;
      // Taking it out first moves what was after it up by one.
      if (sameList && slotSequence(from.array, target.slot).indexOf(original) < target.index) target.index -= 1;
      from.array.splice(from.index, 1);
      cell = original;
    }
    insertAt(next, [cell], target);
    next.active = cell.id;
    if (!copy && next.clip && next.clip.id === id) next.clip = null;
    return copy ? "セルを複製（貼り付け）しました。" : "セルを移動しました。";
  });
}

export function paste(doc, at = doc.at) {
  if (!doc.clip) return null;
  if (!findCellById(doc.cells, doc.clip.id)) return { doc: clearClip(doc), note: "" };
  return place(doc, doc.clip.id, at, doc.clip.mode !== "cut");
}
export const moveTo = (doc, id, at) => place(doc, id, at, false);

export function move(doc, id, direction) {
  const where = findCellParentAndIndex(doc.cells, id);
  if (!where) return null;
  const slot = where.parentArray[where.index].slotIndex || 0;
  let at = where.index + direction;
  while (at >= 0 && at < where.parentArray.length && (where.parentArray[at].slotIndex || 0) !== slot) at += direction;
  if (at < 0 || at >= where.parentArray.length) return null;
  return edit(doc, (next) => {
    const w = findCellParentAndIndex(next.cells, id);
    const t = w.parentArray[w.index];
    w.parentArray[w.index] = w.parentArray[at];
    w.parentArray[at] = t;
  });
}

export function toggleCollapse(doc, id) {
  return edit(doc, (next) => {
    const cell = findCellById(next.cells, id);
    if (!cell) return false;
    cell.collapsed = !cell.collapsed;
  });
}

export function remove(doc, id) {
  return edit(doc, (next) => {
    const where = findCellParentAndIndex(next.cells, id);
    if (!where) return false;
    where.parentArray.splice(where.index, 1);
    if (next.clip && next.clip.id === id) next.clip = null;
    if (next.active === id) next.active = next.cells.length ? next.cells[next.cells.length - 1].id : "";
    return "セルを削除しました。";
  });
}

// ---- the kept templates ------------------------------------------------------
export const isFavorite = (doc, cell) => doc.favs.some((one) => one.templateId === cell.templateId);

export function toggleFavorite(doc, id) {
  return edit(doc, (next) => {
    const cell = findCellById(next.cells, id);
    if (!cell) return false;
    const at = next.favs.findIndex((one) => one.templateId === cell.templateId);
    if (at > -1) {
      next.favs.splice(at, 1);
      return "お気に入りから外しました。";
    }
    const template = templateOf(next, cell.templateId);
    if (!template) return false;
    next.favs.push({ id: `fav-${Date.now()}`, templateId: template.id, category: "fav", title: template.title, description: template.description, html: cell.html });
    return "お気に入りに追加しました。";
  });
}

export function saveCustom(doc, id, name, description) {
  return edit(doc, (next) => {
    const cell = findCellById(next.cells, id);
    if (!cell) return false;
    next.customs.push({
      id: `custom-${Date.now()}`,
      category: "custom",
      title: name || "マイテンプレート",
      description: description || "カスタムレイアウト",
      html: cell.html,
      contentMode: cell.contentMode || (cell.html.includes("cell-container") ? "container" : "text"),
      detailsOpen: cell.detailsOpen,
      originalTemplateId: cell.templateId || "tag-div",
      originalCategory: cell.category || "bs",
      children: cloneCellRecursive(cell).children || [],
    });
    return `自作テンプレート「${name || "マイテンプレート"}」を保存しました。`;
  });
}

export const removeCustom = (doc, id) => edit(doc, (next) => {
  next.customs = next.customs.filter((one) => one.id !== id);
  next.favs = next.favs.filter((one) => one.templateId !== id);
  return "自作テンプレートを削除しました。";
});

// ---- the kind of a cell ------------------------------------------------------
export function replaceTemplate(doc, id, templateId) {
  const template = templateOf(doc, templateId);
  if (!template) return null;
  return edit(doc, (next) => {
    const target = findCellById(next.cells, id);
    if (!target) return false;
    swapInTemplate(next, target, template);
    return `セルの種類を「${template.title}」に変更しました。`;
  });
}

function swapInTemplate(next, targetCell, template) {
  const isOldContainer = targetCell.contentMode === "container" || (targetCell.children && targetCell.children.length > 0);
  const isNewFixedContainer = template.fixedMode === "container" || (template.html && template.html.includes("cell-container") && !template.allowToggleMode);
  const isNewToggleContainer = !!template.allowToggleMode;
  const oldDiv = parse(targetCell.html);
  const oldEditables = Array.from(oldDiv.querySelectorAll('[data-edit="text"]'));
  const oldText = oldEditables.length > 0 ? oldEditables[0].innerHTML : (oldDiv.textContent || "").trim();
  const newDiv = parse(template.html);
  const templateId = template.id || template.templateId;

  targetCell.templateId = templateId;
  targetCell.category = template.category;

  const carryText = () => {
    const newEditables = Array.from(newDiv.querySelectorAll('[data-edit="text"]'));
    if (oldEditables.length > 0 && newEditables.length > 0) {
      for (let i = 0; i < Math.min(oldEditables.length, newEditables.length); i++) newEditables[i].innerHTML = oldEditables[i].innerHTML;
    } else if (oldEditables.length === 0 && newEditables.length > 0 && oldText) {
      newEditables[0].textContent = oldText;
    }
  };

  if (isOldContainer && isNewToggleContainer) {
    targetCell.contentMode = "container";
    const el = newDiv.firstElementChild;
    if (el) {
      const tag = el.tagName.toLowerCase();
      if (tag === "details") {
        const summary = oldEditables.length > 0 ? oldEditables[0].innerHTML : "折りたたみタイトル";
        el.innerHTML = `<summary data-edit="text">${summary}</summary><div class="cell-container"></div>`;
      } else {
        el.removeAttribute("data-edit");
        el.innerHTML = '<div class="cell-container"></div>';
      }
    }
    targetCell.html = assignInlineIds(sanitizeHTML(newDiv.innerHTML, false));
    targetCell.children = targetCell.children || [];
    targetCell.detailsOpen = templateId === "tag-details" ? true : undefined;
  } else if (isNewFixedContainer) {
    targetCell.contentMode = "container";
    targetCell.html = assignInlineIds(sanitizeHTML(newDiv.innerHTML, false));
    if (!isOldContainer && oldText) {
      targetCell.children = [{
        id: newCellId(),
        templateId: "tag-p",
        category: "tag",
        html: assignInlineIds(sanitizeHTML(`<p data-edit="text">${oldText}</p>`, false)),
        contentMode: "text",
        children: [],
        slotIndex: 0,
      }];
    } else {
      targetCell.children = targetCell.children || [];
    }
    targetCell.detailsOpen = undefined;
  } else if (!isNewFixedContainer && !isNewToggleContainer) {
    targetCell.contentMode = "text";
    // Children of the old cell are kept: they come out beside it.
    if (targetCell.children && targetCell.children.length > 0) {
      const oldChildren = targetCell.children;
      targetCell.children = [];
      const where = findCellParentArrayAndIndex(next.cells, targetCell.id);
      if (where) {
        const slot = targetCell.slotIndex || 0;
        oldChildren.forEach((c) => (c.slotIndex = slot));
        where.array.splice(where.index + 1, 0, ...oldChildren);
      }
    }
    carryText();
    targetCell.html = assignInlineIds(sanitizeHTML(newDiv.innerHTML, false));
    targetCell.detailsOpen = undefined;
  } else {
    targetCell.contentMode = "text";
    carryText();
    targetCell.html = assignInlineIds(sanitizeHTML(newDiv.innerHTML, false));
    targetCell.children = [];
    targetCell.detailsOpen = templateId === "tag-details" ? true : undefined;
  }
}

// ---- editing the root element of a cell ---------------------------------------
// Parse the cell's markup, let `fn(root, temp)` change it, write it back.
function withRoot(next, id, fn, { ids = false } = {}) {
  const cell = findCellById(next.cells, id);
  if (!cell) return false;
  const temp = parse(cell.html);
  const root = temp.firstElementChild;
  if (!root) return false;
  const said = fn(root, temp, cell);
  if (said === false) return false;
  const clean = sanitizeHTML(temp.innerHTML, false);
  cell.html = ids ? assignInlineIds(clean) : clean;
  return typeof said === "string" ? said : true;
}
const editRoot = (doc, id, fn, options) => edit(doc, (next) => {
  const said = withRoot(next, id, fn, options);
  return said === true ? "" : said;
});

export function toggleContentMode(doc, id, mode) {
  return edit(doc, (next) => {
    const cell = findCellById(next.cells, id);
    if (!cell) return false;
    const temp = parse(cell.html);
    const el = temp.firstElementChild;
    if (!el) return false;
    cell.contentMode = mode;
    const tag = el.tagName.toLowerCase();
    if (mode === "container") {
      if (tag === "details") {
        const summaryEl = el.querySelector(":scope > summary");
        el.innerHTML = (summaryEl ? summaryEl.outerHTML : '<summary data-edit="text">折りたたみタイトル</summary>') + '<div class="cell-container"></div>';
      } else if (tag === "li") {
        el.removeAttribute("data-edit");
        el.innerHTML = '<span data-edit="text">見出しテキスト</span><div class="cell-container"></div>';
      } else {
        el.innerHTML = '<div class="cell-container"></div>';
      }
      cell.children = cell.children || [];
    } else {
      if (tag === "div" || tag === "blockquote" || tag === "address") {
        el.setAttribute("data-edit", "text");
        el.innerHTML = "編集可能なテキストです。";
      } else if (tag === "details") {
        el.innerHTML = '<summary data-edit="text">折りたたみタイトル</summary><span data-edit="text">折りたたまれる詳細コンテンツです。</span>';
      } else if (tag === "li") {
        el.setAttribute("data-edit", "text");
        el.textContent = "リスト項目テキスト";
      } else {
        el.innerHTML = '<span data-edit="text">編集可能なテキストコンテンツです。</span>';
      }
      cell.children = [];
    }
    cell.html = assignInlineIds(sanitizeHTML(temp.innerHTML, false));
  });
}

export function setDetailsOpen(doc, id, open) {
  return edit(doc, (next) => {
    const cell = findCellById(next.cells, id);
    if (!cell) return false;
    cell.detailsOpen = open;
    withRoot(next, id, (root) => {
      if (root.tagName.toLowerCase() !== "details") return false;
      if (open) root.setAttribute("open", "");
      else root.removeAttribute("open");
    });
  });
}

export const detailsOpenOf = (cell) => {
  const root = rootOf(cell);
  if (!root || root.tagName.toLowerCase() !== "details") return null;
  return cell.detailsOpen !== undefined ? cell.detailsOpen : root.hasAttribute("open");
};

// ---- grid columns ------------------------------------------------------------
const GRID = { "bs-grid2": { breakpoint: "md", groupType: "col-md" }, "bs-grid3": { breakpoint: "lg", groupType: "col-lg" } };

export function gridInfo(cell) {
  const config = GRID[cell.templateId];
  const row = config && rootOf(cell);
  if (!row) return null;
  const re = new RegExp(`^col-${config.breakpoint}-(.+)$`);
  const columns = Array.from(row.children).map((col) => {
    const match = Array.from(col.classList).map((c) => c.match(re)).find(Boolean);
    return { value: match ? match[1] : "" };
  });
  return { breakpoint: config.breakpoint, group: config.groupType, columns };
}

export function setGridColumn(doc, id, index, value) {
  return edit(doc, (next) => {
    const cell = findCellById(next.cells, id);
    const config = cell && GRID[cell.templateId];
    if (!config) return false;
    const temp = parse(cell.html);
    const col = temp.firstElementChild && temp.firstElementChild.children[index];
    if (!col) return false;
    const re = new RegExp(`^col-${config.breakpoint}-(.+)$`);
    Array.from(col.classList).forEach((c) => re.test(c) && col.classList.remove(c));
    if (value) col.classList.add(`col-${config.breakpoint}-${value}`);
    cell.html = temp.innerHTML;
  });
}

// ---- tables ------------------------------------------------------------------
function spanOf(el, name) {
  return parseInt(el.getAttribute(name) || "1", 10);
}
function visualColumn(td) {
  let col = 0;
  for (const c of Array.from(td.closest("tr").children)) {
    if (c === td) break;
    col += spanOf(c, "colspan");
  }
  return col;
}
function cellBelow(table, td) {
  const rows = Array.from(table.querySelectorAll("tr"));
  const next = rows[rows.indexOf(td.closest("tr")) + 1];
  if (!next) return null;
  const want = visualColumn(td);
  let col = 0;
  for (const c of Array.from(next.children)) {
    if (col === want) return c;
    col += spanOf(c, "colspan");
    if (col > want) return null;
  }
  return null;
}

export function tableInfo(cell) {
  const table = parse(cell.html).querySelector("table");
  if (!table) return null;
  return Array.from(table.querySelectorAll("td, th")).map((td, index) => {
    const container = !!td.querySelector(":scope > .cell-container");
    return {
      index,
      tag: td.tagName.toLowerCase(),
      container,
      preview: container ? "" : (td.textContent || "").trim().slice(0, 12) || "(空)",
      colspan: spanOf(td, "colspan"),
      rowspan: spanOf(td, "rowspan"),
      canMergeRight: !!td.nextElementSibling && ["TD", "TH"].includes(td.nextElementSibling.tagName),
      canMergeDown: !!cellBelow(table, td),
      canSplit: spanOf(td, "colspan") > 1 || spanOf(td, "rowspan") > 1,
    };
  });
}

function tableEdit(doc, id, fn) {
  return edit(doc, (next) => {
    const cell = findCellById(next.cells, id);
    if (!cell) return false;
    const temp = parse(cell.html);
    const table = temp.querySelector("table");
    if (!table) return false;
    const said = fn(cell, table, Array.from(table.querySelectorAll("td, th")));
    if (said === false) return false;
    cell.html = assignInlineIds(sanitizeHTML(temp.innerHTML, false));
    return said;
  });
}

export const setTableCellMode = (doc, id, index, mode) => tableEdit(doc, id, (cell, table, all) => {
  const td = all[index];
  if (!td) return false;
  let note = "";
  if (mode === "container") {
    td.innerHTML = "";
    td.removeAttribute("data-edit");
    const box = document.createElement("div");
    box.className = `cell-container slot-idx-${index}`;
    td.appendChild(box);
  } else {
    const orphaned = (cell.children || []).filter((c) => (c.slotIndex || 0) === index);
    if (orphaned.length) {
      cell.children = cell.children.filter((c) => (c.slotIndex || 0) !== index);
      note = "このセル内にあった子セルは削除されました。";
    }
    td.innerHTML = "セルのテキスト";
    td.setAttribute("data-edit", "text");
  }
  return note;
});

export const mergeTableCell = (doc, id, index, direction) => tableEdit(doc, id, (cell, table, all) => {
  const td = all[index];
  if (!td) return false;
  const target = direction === "right" ? td.nextElementSibling : cellBelow(table, td);
  if (!target) return false;
  const targetIndex = all.indexOf(target);
  let note = "";
  const orphaned = (cell.children || []).filter((c) => (c.slotIndex || 0) === targetIndex);
  if (orphaned.length) {
    cell.children = cell.children.filter((c) => (c.slotIndex || 0) !== targetIndex);
    note = "結合先のセル内にあった子セルは削除されました。";
  }
  const attr = direction === "right" ? "colspan" : "rowspan";
  td.setAttribute(attr, String(spanOf(td, attr) + spanOf(target, attr)));
  target.remove();
  return note;
});

export const splitTableCell = (doc, id, index) => tableEdit(doc, id, (cell, table, all) => {
  const td = all[index];
  if (!td) return false;
  const colspan = spanOf(td, "colspan");
  const rowspan = spanOf(td, "rowspan");
  if (colspan <= 1 && rowspan <= 1) return false;
  const fresh = document.createElement(td.tagName.toLowerCase());
  fresh.setAttribute("data-edit", "text");
  fresh.textContent = "セルのテキスト";
  if (colspan > 1) {
    if (colspan - 1 > 1) td.setAttribute("colspan", String(colspan - 1));
    else td.removeAttribute("colspan");
    td.parentElement.insertBefore(fresh, td.nextSibling);
  } else {
    if (rowspan - 1 > 1) td.setAttribute("rowspan", String(rowspan - 1));
    else td.removeAttribute("rowspan");
    const want = visualColumn(td);
    const rows = Array.from(table.querySelectorAll("tr"));
    const next = rows[rows.indexOf(td.closest("tr")) + 1];
    if (next) {
      let col = 0;
      let done = false;
      for (const c of Array.from(next.children)) {
        if (col >= want) {
          next.insertBefore(fresh, c);
          done = true;
          break;
        }
        col += spanOf(c, "colspan");
      }
      if (!done) next.appendChild(fresh);
    }
  }
  return "";
});

// ---- text ----------------------------------------------------------------------
// The editable runs of a cell (the top-level ones: a run inside a run is part
// of it), as the markup between their tags -- without the marks the editor
// puts on inline elements.
export const plainInline = (html) => String(html || "").replace(/\sdata-inline-id="[^"]*"/g, "").replace(/\scontenteditable="[^"]*"/g, "");

export function textFields(cell) {
  const temp = parse(cell.html);
  return Array.from(temp.querySelectorAll('[data-edit="text"]'))
    .filter((el) => !el.parentElement.closest('[data-edit="text"]'))
    .map((el, index) => ({
      index,
      tag: el.tagName.toLowerCase(),
      html: plainInline(el.innerHTML),
      table: ["td", "th"].includes(el.tagName.toLowerCase()),
    }));
}

export function setTextField(doc, id, index, html) {
  return edit(doc, (next) => {
    const cell = findCellById(next.cells, id);
    if (!cell) return false;
    const temp = parse(cell.html);
    const runs = Array.from(temp.querySelectorAll('[data-edit="text"]')).filter((el) => !el.parentElement.closest('[data-edit="text"]'));
    if (!runs[index]) return false;
    runs[index].innerHTML = html;
    cell.html = assignInlineIds(sanitizeHTML(temp.innerHTML, false));
  });
}

// ---- inline decoration ----------------------------------------------------------
export const INLINE_OPTIONS = [
  ["span", "(未適用)"], ["strong", "太字 (strong)"], ["b", "太字 (b)"], ["em", "斜体 (em)"], ["i", "斜体 (i)"],
  ["sub", "下付き (sub)"], ["sup", "上付き (sup)"], ["mark", "マーカー (mark)"], ["code", "コード (code)"],
  ["kbd", "キー (kbd)"], ["del", "打消線 (del)"], ["ins", "下線 (ins)"], ["a", "リンク (a)"], ["abbr", "略語 (abbr)"],
];

// The decorations in a cell, nested as they are in the markup.
export function inlineTree(cell) {
  const walk = (parent) => {
    const out = [];
    for (const el of Array.from(parent.children)) {
      const tag = el.tagName.toLowerCase();
      if (INLINE_TAGS.includes(tag) && el.hasAttribute("data-inline-id")) {
        const iconClass = tag === "i" && el.classList.contains("bi") ? Array.from(el.classList).find((c) => c !== "bi" && c.startsWith("bi-")) || "" : null;
        out.push({
          id: el.getAttribute("data-inline-id"),
          tag,
          text: el.textContent || "",
          icon: iconClass === null ? null : iconClass.replace(/^bi-/, ""),
          href: el.getAttribute("href") || "",
          name: el.getAttribute("name") || "",
          target: el.getAttribute("target") || "",
          title: el.getAttribute("title") || "",
          children: walk(el),
        });
      } else {
        out.push(...walk(el));
      }
    }
    return out;
  };
  return walk(parse(cell.html));
}

function inlineEdit(doc, cellId, inlineId, fn, { ids = true } = {}) {
  return edit(doc, (next) => {
    const cell = findCellById(next.cells, cellId);
    if (!cell) return false;
    const temp = parse(cell.html);
    const target = temp.querySelector(`[data-inline-id="${inlineId}"]`);
    if (!target) return false;
    fn(target);
    const clean = sanitizeHTML(temp.innerHTML, false);
    cell.html = ids ? assignInlineIds(clean) : clean;
  });
}

export const changeInlineTag = (doc, cellId, inlineId, tagName) => inlineEdit(doc, cellId, inlineId, (target) => {
  const el = document.createElement(tagName);
  Array.from(target.attributes).forEach((attr) => el.setAttribute(attr.name, attr.value));
  el.innerHTML = target.innerHTML;
  if (tagName === "a") {
    if (!el.hasAttribute("href")) el.setAttribute("href", "#");
    el.setAttribute("data-edit-attr", "href,target");
    el.setAttribute("data-edit", "text");
  } else if (tagName === "abbr") {
    if (!el.hasAttribute("title")) el.setAttribute("title", "説明");
    el.setAttribute("data-edit-attr", "title");
    el.setAttribute("data-edit", "text");
  } else {
    ["href", "target", "title", "data-edit-attr", "data-edit"].forEach((a) => el.removeAttribute(a));
  }
  target.replaceWith(el);
});

export const setInlineAttribute = (doc, cellId, inlineId, name, value) => inlineEdit(doc, cellId, inlineId, (target) => {
  if (value === "") target.removeAttribute(name);
  else target.setAttribute(name, value);
}, { ids: false });

export const setInlineIcon = (doc, cellId, inlineId, icon) => inlineEdit(doc, cellId, inlineId, (target) => {
  Array.from(target.classList).forEach((c) => c !== "bi" && c.startsWith("bi-") && target.classList.remove(c));
  const trimmed = String(icon || "").trim();
  if (trimmed) target.classList.add(`bi-${trimmed}`);
}, { ids: false });

// The text a decoration is on, set (a decoration with others inside it is changed through those).
export const setInlineText = (doc, cellId, inlineId, text) => inlineEdit(doc, cellId, inlineId, (target) => {
  target.textContent = text;
}, { ids: false });

export const removeInline = (doc, cellId, inlineId) => inlineEdit(doc, cellId, inlineId, (target) => target.replaceWith(...target.childNodes));

export const nestInline = (doc, cellId, inlineId) => inlineEdit(doc, cellId, inlineId, (target) => {
  const span = document.createElement("span");
  span.textContent = target.textContent || "テキスト";
  span.setAttribute("data-inline-id", `inline-${stamp()}`);
  target.innerHTML = "";
  target.appendChild(span);
});

// ---- the icon of an icon cell ----------------------------------------------------
export function iconNameOf(cell) {
  const root = rootOf(cell);
  if (!root || root.tagName.toLowerCase() !== "i" || !root.classList.contains("bi")) return null;
  return (Array.from(root.classList).find((c) => c !== "bi" && c.startsWith("bi-")) || "").replace(/^bi-/, "");
}
export const setIconName = (doc, id, icon) => editRoot(doc, id, (root) => {
  if (root.tagName.toLowerCase() !== "i") return false;
  Array.from(root.classList).forEach((c) => c !== "bi" && c.startsWith("bi-") && root.classList.remove(c));
  const trimmed = String(icon || "").trim();
  if (trimmed) root.classList.add(`bi-${trimmed}`);
});

// ---- attributes -------------------------------------------------------------------
export function attributesOf(cell) {
  const root = rootOf(cell);
  if (!root) return [];
  return Array.from(root.attributes)
    .filter((a) => ALLOWED_ATTRS.has(a.name.toLowerCase()) && a.name !== "class" && a.name !== "data-inline-id")
    .map((a) => ({ name: a.name, value: a.value }));
}
export function unusedAttributes(cell) {
  const root = rootOf(cell);
  if (!root) return [];
  return Array.from(ALLOWED_ATTRS).filter((a) => a !== "class" && a !== "data-inline-id" && !root.hasAttribute(a));
}
export const setAttribute = (doc, id, name, value) => editRoot(doc, id, (root) => {
  if (!name) return false;
  if (value === "") root.removeAttribute(name);
  else root.setAttribute(name, value);
});
export const removeAttribute = (doc, id, name) => editRoot(doc, id, (root) => root.removeAttribute(name));

// ---- classes ---------------------------------------------------------------------
const RECORDS = new Map(CLASS_ROWS.map(([className, template, category, description]) => [className, { className, template, category, description }]));
const CATEGORIES = new Map();
for (const record of RECORDS.values()) {
  if (!CATEGORIES.has(record.category)) CATEGORIES.set(record.category, []);
  CATEGORIES.get(record.category).push(record);
}
export const categoryNames = () => Array.from(CATEGORIES.keys()).sort();
export const recordOf = (name) => RECORDS.get(name) || null;

export function searchClasses(category, query) {
  let list = category ? CATEGORIES.get(category) || [] : Array.from(RECORDS.values());
  const q = String(query || "").toLowerCase().trim();
  if (q) list = list.filter((c) => c.className.toLowerCase().includes(q) || c.description.toLowerCase().includes(q));
  return list;
}

export const classesOf = (cell) => {
  const root = rootOf(cell);
  return root ? Array.from(root.classList) : [];
};

// The classes a template suggests, as dictionary records.
export function commonClassesOf(doc, cell) {
  const template = templateOf(doc, cell.templateId) || {};
  const seen = new Set();
  const out = [];
  for (const name of template.commonClasses || []) {
    const record = RECORDS.get(name);
    if (record && !seen.has(name)) {
      seen.add(name);
      out.push(record);
    }
  }
  for (const category of template.commonCategories || []) {
    for (const record of CATEGORIES.get(category) || []) {
      if (!seen.has(record.className)) {
        seen.add(record.className);
        out.push(record);
      }
    }
  }
  return out;
}

export const toggleClass = (doc, id, name, on) => editRoot(doc, id, (root) => {
  if (on) root.classList.add(name);
  else root.classList.remove(name);
});

const groupClassName = (group, value) => (value === "" ? group.stem : `${group.stem}-${value}`);
export const groupClassNames = (type) => {
  const group = UI_GROUPS[type];
  return group ? group.values.map((v) => groupClassName(group, v)) : [];
};

// The group a class is a value of, and the classes of that group.
export function groupOfClass(name) {
  for (const type of Object.keys(UI_GROUPS)) {
    const group = UI_GROUPS[type];
    for (const v of group.values) {
      if (groupClassName(group, v) === name) return { type, value: v };
    }
  }
  return null;
}

// Classes that start with text- but are not a colour: BsEditor took them away
// with the colour; here they stay.
const NOT_COLOR = /^text-(start|center|end|justify|wrap|nowrap|break|truncate|lowercase|uppercase|capitalize|decoration-.*|opacity-.*|bg-.*|reset)$/;
export const isTextColor = (c) => c.startsWith("text-") && !NOT_COLOR.test(c);

// What the group `type` is now on a cell (the class, or "").
export function groupValue(cell, type) {
  const classes = new Set(classesOf(cell));
  if (type === "bg") return Array.from(classes).find((c) => /^bg-(?!opacity)/.test(c)) || "";
  if (type === "text") return Array.from(classes).find(isTextColor) || "";
  if (type === "alignment") return ["text-start", "text-center", "text-end", "text-justify"].find((c) => classes.has(c)) || "";
  return groupClassNames(type).find((c) => classes.has(c)) || "";
}

// Set the class of one group, taking away the others of it (updateCellClass).
export const setGroupClass = (doc, id, type, value) => editRoot(doc, id, (root) => {
  let prefixes = [];
  if (type === "text") {
    for (const c of Array.from(root.classList)) if (isTextColor(c)) root.classList.remove(c);
  } else if (type === "bg") prefixes = ["bg-", "text-white", "text-dark"];
  else if (type === "alignment") prefixes = ["text-start", "text-center", "text-end", "text-justify"];
  else if (UI_GROUPS[type]) prefixes = groupClassNames(type);
  for (const prefix of prefixes) {
    for (const c of Array.from(root.classList)) {
      if (c === prefix || c.startsWith(`${prefix}-`) || (prefix.endsWith("-") && c.startsWith(prefix))) root.classList.remove(c);
    }
  }
  if (value) value.split(" ").forEach((c) => c && root.classList.add(c));
});

// ---- one cell as a value ---------------------------------------------------------
// The cell editor and the class catalog hold the picked cell as a value of their
// own (`bseditor.cell`), not the document; what they do to it is done to a
// document of one cell and the cell is taken back out.
export const findCell = (cells, id) => findCellById(cells, id);
export const selectedCell = (doc) => (doc.active ? findCellById(doc.cells, doc.active) : null);

export function coerceCell(value) {
  return value && typeof value === "object" && typeof value.id === "string" && typeof value.html === "string"
    ? { ...value, children: Array.isArray(value.children) ? value.children : [] }
    : null;
}

export function onCell(cell, fn) {
  const doc = { ...emptyDoc(), cells: [clone(cell)], active: cell.id };
  const out = fn(doc);
  if (!out || !out.doc || out.refused) return null;
  return { cell: out.doc.cells[0], note: out.note || "" };
}

// The cell put back where the document had it.
export const replaceCell = (doc, cell) => edit(doc, (next) => {
  const where = findCellParentAndIndex(next.cells, cell.id);
  if (!where) return false;
  where.parentArray[where.index] = clone(cell);
});

// What the root element of the cell looks like, as a selector: h1.text-center.
export function signatureOf(cell) {
  const root = rootOf(cell);
  if (!root) return "";
  return root.tagName.toLowerCase() + Array.from(root.classList).map((c) => `.${c}`).join("");
}

// ---- the tree for the list ---------------------------------------------------------
// Every cell as {id, title, snippet, collapsed, fav, slots: [{slot, label, items}]}.
export function outlineOf(doc) {
  const node = (cell) => {
    const slots = slotsOf(cell);
    const many = slots.length > 1;
    return {
      id: cell.id,
      parent: "",
      tag: tagOf(cell),
      title: titleOf(doc, cell),
      snippet: snippetOf(cell),
      collapsed: Boolean(cell.collapsed),
      fav: isFavorite(doc, cell),
      slots: slots.map((slot, i) => ({
        slot,
        label: many ? (cell.templateId === "tag-table" ? `表のセル ${slot + 1}` : `${i + 1}`) : "",
        items: slotSequence(cell.children || [], slot).map((child) => ({ ...node(child), parent: cell.id })),
      })),
    };
  };
  return doc.cells.map((cell) => node(cell));
}

// A cell as the row that shows it: its id, the tag it is written with, and a few words.
export const summaryOf = (cell) => (cell ? { id: cell.id, tag: tagOf(cell), snippet: snippetOf(cell), collapsed: false } : null);


// ---- the attributes, as a dictionary like the classes' -------------------------------
// [name, what it is for]: the attributes a cell may carry (what html.js lets through).
export const ATTRIBUTE_ROWS = [
  ["abbr", "略語の正式名称（表のヘッダ用）"],
  ["alt", "画像が表示できないときの代替テキスト"],
  ["cite", "引用元の URL"],
  ["colspan", "セルを右へ結合する数"],
  ["datetime", "日時を機械が読める形で指定する"],
  ["height", "要素の高さ"],
  ["href", "リンク先の URL"],
  ["lang", "要素の言語（ja、en など）"],
  ["name", "アンカー名やフォーム部品の名前"],
  ["open", "折りたたみ（details）を最初から開いておく"],
  ["rel", "リンク先との関係（noopener など）"],
  ["role", "支援技術に伝える要素の役割"],
  ["rowspan", "セルを下へ結合する数"],
  ["src", "画像などの URL"],
  ["target", "リンクを開く場所（_blank で新しいタブ）"],
  ["title", "ホバーで出る補足の説明"],
  ["width", "要素の幅"],
  ["xml:lang", "要素の言語（XML 形式）"],
];
const ATTRIBUTE_MAP = new Map(ATTRIBUTE_ROWS.map(([name, description]) => [name, { name, description }]));
export const attributeRecord = (name) => ATTRIBUTE_MAP.get(name) || null;
export function searchAttributes(query) {
  const q = String(query || "").toLowerCase().trim();
  const all = ATTRIBUTE_ROWS.map(([name, description]) => ({ name, description }));
  return q ? all.filter((r) => r.name.toLowerCase().includes(q) || r.description.toLowerCase().includes(q)) : all;
}

// The attributes of a cell, as the list the editor holds: {name, value, description}.
export function attributeEntries(cell) {
  return attributesOf(cell).map((a) => ({ name: a.name, value: a.value, description: (ATTRIBUTE_MAP.get(a.name) || {}).description || "" }));
}

// What is on the cell is set to these: the attributes left out are taken away.
export const setAttributes = (doc, id, entries) => editRoot(doc, id, (root) => {
  const keep = new Map(entries.map((one) => [String(one.name), String(one.value ?? "")]));
  for (const a of Array.from(root.attributes)) {
    const n = a.name.toLowerCase();
    if (ALLOWED_ATTRS.has(n) && n !== "class" && n !== "data-inline-id" && !keep.has(a.name)) root.removeAttribute(a.name);
  }
  for (const [name, value] of keep) {
    if (ALLOWED_ATTRS.has(name.toLowerCase()) && name !== "class") root.setAttribute(name, value);
  }
});

// The classes of the cell, set to these, in this order.
export const setClasses = (doc, id, names) => editRoot(doc, id, (root) => {
  root.setAttribute("class", names.filter(Boolean).join(" "));
  if (!root.getAttribute("class")) root.removeAttribute("class");
});

// The classes of a cell, as the list the editor holds: {className, category, description}.
export function classEntries(cell) {
  return classesOf(cell).map((name) => {
    const record = RECORDS.get(name);
    return { className: name, category: record ? record.category : "", description: record ? record.description : "" };
  });
}

// An attribute put on the cell, whatever its value (an empty one too).
export const addAttribute = (doc, id, name, value) => editRoot(doc, id, (root) => {
  if (!name || !ALLOWED_ATTRS.has(String(name).toLowerCase()) || name === "class") return false;
  root.setAttribute(name, String(value ?? ""));
});

// ---- the tag of a cell ------------------------------------------------------------------
// The tags a plain tag cell may turn into: among the ones that hold text the same way
// (a heading, a paragraph, a block), among the lists, among the terms, among the code
// tags. What is in the cell, its attributes and its classes come with it.
const TAG_GROUPS = [
  ["h1", "h2", "h3", "h4", "h5", "h6", "p", "div", "blockquote", "pre", "address"],
  ["ul", "ol"],
  ["dt", "dd"],
  ["code", "kbd", "samp"],
];
// A tag whose text is held in a span of its own, rather than in the tag itself.
const WRAPPED_TAGS = ["div", "blockquote", "address"];
const TEXT_ONLY_TAGS = ["h1", "h2", "h3", "h4", "h5", "h6", "p", "pre"];

// The tags the cell can be changed to, with its own first; [] where it has no such choice
// (a component, a table, a grid, a details).
export function tagChoices(cell) {
  const root = cell ? rootOf(cell) : null;
  if (!root || !String(cell.templateId || "").startsWith("tag-")) return [];
  const tag = root.tagName.toLowerCase();
  const group = TAG_GROUPS.find((one) => one.includes(tag));
  if (!group) return [];
  // A cell that holds cells stays among the tags that can.
  const holds = cell.contentMode === "container" || (cell.children || []).length > 0;
  const choices = holds ? group.filter((one) => !TEXT_ONLY_TAGS.includes(one)) : group;
  return choices.includes(tag) && choices.length > 1 ? choices : [];
}

export function changeTag(doc, id, tag) {
  return edit(doc, (next) => {
    const cell = findCellById(next.cells, id);
    if (!cell || !tagChoices(cell).includes(tag)) return false;
    const temp = parse(cell.html);
    const old = temp.firstElementChild;
    const was = old.tagName.toLowerCase();
    if (was === tag) return false;
    const el = document.createElement(tag);
    for (const attribute of Array.from(old.attributes)) el.setAttribute(attribute.name, attribute.value);
    el.innerHTML = old.innerHTML;
    // The text moves in or out of its span when the new tag holds it the other way.
    const holds = cell.contentMode === "container" || old.querySelector(":scope > .cell-container");
    if (!holds && WRAPPED_TAGS.includes(tag) && !WRAPPED_TAGS.includes(was)) {
      el.removeAttribute("data-edit");
      el.innerHTML = `<span data-edit="text">${old.innerHTML}</span>`;
    } else if (!holds && !WRAPPED_TAGS.includes(tag) && WRAPPED_TAGS.includes(was)) {
      const span = old.querySelector(':scope > [data-edit="text"]');
      el.setAttribute("data-edit", "text");
      el.innerHTML = span ? span.innerHTML : old.innerHTML;
    }
    old.replaceWith(el);
    cell.html = assignInlineIds(sanitizeHTML(temp.innerHTML, false));
    cell.templateId = `tag-${tag}`;
    return `タグを <${tag}> に変更しました。`;
  });
}

// The cells an HTML text makes (what BsEditor takes in), none where there is nothing in it.
export const cellsFromHtml = (raw) => (String(raw || "").trim() ? importHtmlToCells(raw) : []);

// ---- decorated text ---------------------------------------------------------------------
// A decorated text is the markup between the tags of a run of text: words with strong,
// em, a and the like in them. It is a string that is also a text: as text it is what the
// markup says, and a text put in as decorated text is written as it is (escaped).
export const richToText = (html) => parse(plainInline(html)).textContent || "";
export const textToRich = (text) => String(text ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
export const cleanRich = (html) => sanitizeHTML(plainInline(html), false);

// What edits a decorated text on its own: a cell of one run, so that every operation on a
// cell's decorations is the same operation on this text.
export const SCRATCH_ID = "decor";
// The decorations are numbered by their place in the text, so the same text has the same ids each
// time it is made a cell of: a card drawn from one cell can be used on another made of the same text.
export const scratchCell = (html) => {
  let place = 0;
  return {
    id: SCRATCH_ID,
    templateId: "tag-p",
    category: "tag",
    html: assignInlineIds(sanitizeHTML(`<p data-edit="text">${html || ""}</p>`, false)).replace(/data-inline-id="[^"]*"/g, () => `data-inline-id="d${place++}"`),
    contentMode: "text",
    children: [],
    slotIndex: 0,
  };
};
// What the editor marks a link or an abbreviation with (to edit it in place) is not the text's.
export const scratchText = (cell) => (textFields(cell)[0] || { html: "" }).html.replace(/\sdata-edit(-attr)?="[^"]*"/g, "");

// The text of one run of a cell ("" where the cell has no such run).
export const runHtml = (cell, index) => (cell && textFields(cell)[Number(index) || 0] ? textFields(cell)[Number(index) || 0].html : "");

// `html` with the selection `from..to` (offsets in the markup) wrapped in a decoration.
export function wrapRange(html, from, to, tag, attrs = {}, placeholder = "テキスト") {
  const text = String(html ?? "");
  const a = Math.max(0, Math.min(text.length, Number(from) || 0));
  const b = Math.max(a, Math.min(text.length, Number(to) || a));
  const escape = (value) => String(value).replace(/&/g, "&amp;").replace(/"/g, "&quot;");
  const attributes = Object.entries(attrs).map(([k, v]) => ` ${k}="${escape(v)}"`).join("");
  return `${text.slice(0, a)}<${tag}${attributes}>${text.slice(a, b) || placeholder}</${tag}>${text.slice(b)}`;
}
