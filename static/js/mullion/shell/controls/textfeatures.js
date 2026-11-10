/* Mullion -- the features a text card can be given (`features` on texteditor).
 *
 * The shell's text card with an editor around it, made from what was the
 * notepad's own card: the card, its grip, the link it can follow, copy and the
 * one-line toggle stay texteditor's, drawn by its own render/update. What a
 * feature adds:
 *
 *   history  undo and redo in the card bar
 *   find     find and replace (a panel under the bar, Ctrl+F, F3) and the
 *            marks on every match
 *   tidy     a menu of ways to tidy the text (or the selection)
 *   display  how the text is shown (wrap, monospace, Tab, spell check, line
 *            numbers, the status line, size) and the status line itself
 *
 * The options are the placer's to keep. Bound (`binds: { options: {...} }` on
 * the node, or `{ "bind": ... }` in a declaration), they are read from and
 * written back to wherever the placer keeps them -- the notepad keeps them in
 * its own properties, so they are in the layout like the text is. A placed
 * card with no explicit options keeps them as display state at its address.
 *
 * Nothing here touches a value except by typing into the textarea: every
 * change -- a replace, a tidy, a tab -- is an insertion the browser would
 * make itself, so the control's `onChange` hears it as it hears typing, and
 * the browser's undo covers it.
 */

import { t, ResizeObserver, document, getComputedStyle, requestAnimationFrame, window } from "./deps.js";

// Every feature, in the order they are offered.
export const TEXTCARD_FEATURES = ["history", "find", "tidy", "display"];

export const TEXTCARD_DEFAULTS = {
  wrap: true,
  mono: false,
  zoom: 100,
  tab: false,
  spellcheck: false,
  stats: true,
  numbers: false,
};

export const ZOOM_MIN = 70;
export const ZOOM_MAX = 200;
const ZOOM_STEP = 10;

// What the tidying tools do to a piece of text. Each takes the text and
// returns it changed; whether that is the selection or the lot is not its
// business.
const lines = (s) => s.split(/\r?\n/);
const TIDY = [
  { key: "trim", icon: "eraser", run: (s) => lines(s).map((l) => l.replace(/[ \t　]+$/, "")).join("\n") },
  { key: "blank", icon: "dash-square", run: (s) => lines(s).filter((l) => l.trim() !== "").join("\n") },
  { key: "join", icon: "text-paragraph", run: (s) => lines(s).map((l) => l.trim()).filter(Boolean).join(" ") },
  { key: "sort", icon: "sort-alpha-down", run: (s) => lines(s).sort((a, b) => a.localeCompare(b, "ja")).join("\n") },
  { key: "unique", icon: "layers", run: (s) => [...new Set(lines(s))].join("\n") },
  { key: "reverse", icon: "arrow-down-up", run: (s) => lines(s).reverse().join("\n") },
  { key: "upper", icon: "type", run: (s) => s.toUpperCase() },
  { key: "lower", icon: "fonts", run: (s) => s.toLowerCase() },
  {
    key: "half",
    icon: "alphabet",
    run: (s) => s.replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace(/　/g, " "),
  },
];

// Where each note was scrolled to, by the item it belongs to. A textarea
// loses its scroll when it is taken out of the layout and put back -- the
// window was folded, or the layout was drawn again around it -- and a long
// note must not start from the top every time that happens.
const scrolls = new Map();

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// One menu at a time across the cards. It is placed in the document so a
// narrow card or a scrolling body cannot clip it.
let popupMenu = null;

function closePopupMenu(restoreFocus = false) {
  if (!popupMenu) return;
  const { button, element } = popupMenu;
  button.classList.remove("is-active");
  button.setAttribute("aria-expanded", "false");
  element.remove();
  popupMenu = null;
  if (restoreFocus && button.isConnected) button.focus({ preventScroll: true });
}

function openPopupMenu(button, element) {
  const was = popupMenu && popupMenu.button;
  closePopupMenu();
  if (was === button) return;
  document.body.append(element);
  const at = button.getBoundingClientRect();
  const size = element.getBoundingClientRect();
  const left = Math.max(4, Math.min(at.left, window.innerWidth - size.width - 4));
  const below = at.bottom + 4;
  const top = below + size.height > window.innerHeight - 4 ? Math.max(4, at.top - size.height - 4) : below;
  element.style.left = `${Math.round(left)}px`;
  element.style.top = `${Math.round(top)}px`;
  popupMenu = { button, element };
  button.classList.add("is-active");
  button.setAttribute("aria-expanded", "true");
  const first = element.querySelector("button:not(:disabled)");
  if (first) first.focus({ preventScroll: true });
}

// Listening to the page, once it is handed in (index.js); not outside a page.
export function install() {
  if (!document) return;
  document.addEventListener("pointerdown", (event) => {
    if (popupMenu && !popupMenu.element.contains(event.target) && !popupMenu.button.contains(event.target)) closePopupMenu();
  }, true);
  document.addEventListener("keydown", (event) => {
    if (!popupMenu) return;
    if (event.key === "Escape") {
      event.stopPropagation();
      closePopupMenu(true);
      return;
    }
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      const items = [...popupMenu.element.querySelectorAll("button:not(:disabled)")];
      const current = items.indexOf(document.activeElement);
      const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (current + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
      if (items[next]) {
        event.preventDefault();
        items[next].focus({ preventScroll: true });
      }
    }
  }, true);
  window.addEventListener("resize", () => closePopupMenu());
  document.addEventListener("scroll", () => closePopupMenu(), true);
}

const make = (tag, className, props) => Object.assign(document.createElement(tag), { className, ...props });
const icon = (name) => make("i", `bi bi-${name}`);

// Put `text` where `from..to` is, the way typing would: through the
// browser's own editing, which is what keeps undo working and makes the
// textarea say `input`. Refused only by a read-only field, which none of
// the tools reach.
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
  area.setSelectionRange(from, from + text.length);
}

// What the features add to a text card, made once: the card has been drawn by
// texteditor.render, and `slots`, `bar` and `barRow` are how it is reached.
export function buildFeatures(el, features, desc, { slots, bar, barRow }) {
  const has = (name) => features.includes(name);
  el.__txDesc = desc;
  const area = slots.area;
  const parts = { area, texts: [], panel: "", local: { ...TEXTCARD_DEFAULTS } };
  // A label, a title or both that follow the language: kept so `update`
  // can set them again whenever it runs.
  const say = (node, key, attr = "title") => {
    parts.texts.push({ node, key, attr });
    return node;
  };
  const tool = (name, titleKey, run, extra = "") => {
    const button = make("button", `mu-icon-button mu-tx-tool ${extra}`.trim(), { type: "button" });
    button.append(icon(name));
    // Pressing a tool must not take the selection's focus away from the
    // text: the tool acts on that selection.
    button.addEventListener("mousedown", (event) => event.preventDefault());
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      run(event);
    });
    return say(button, titleKey);
  };
  const menuItem = (labelKey, name, run, { check = false, keepOpen = false } = {}) => {
    const button = make("button", `mu-tx-menu-item${check ? " is-check" : ""}`, { type: "button" });
    button.setAttribute("role", check ? "menuitemcheckbox" : "menuitem");
    button.append(icon(name));
    const text = make("span", "mu-tx-menu-label");
    button.append(text);
    if (check) button.append(make("i", "bi bi-check-lg mu-tx-menu-check"));
    say(text, labelKey, "textContent");
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      if (!keepOpen) closePopupMenu(true);
      run(event);
    });
    return button;
  };
  const menu = () => {
    const element = make("div", "mu-tx-menu");
    element.setAttribute("role", "menu");
    return element;
  };
  const menuTrigger = (name, titleKey, element) => {
    const button = tool(name, titleKey, () => openPopupMenu(button, element));
    button.setAttribute("aria-haspopup", "menu");
    button.setAttribute("aria-expanded", "false");
    return button;
  };

  const options = () => ({ ...TEXTCARD_DEFAULTS, ...(el.__txDesc.params.options || parts.local) });
  const setOption = (key, value) => {
    const desc = el.__txDesc;
    if (desc.set && desc.set("options", { ...options(), [key]: value })) return;
    parts.local[key] = value;
    updateFeatures(el, desc);
  };

  // ---- the card's shared action bar ----
  parts.undo = tool("arrow-counterclockwise", "mu.textcard.tool.undo", () => {
    area.focus();
    document.execCommand("undo");
  });
  parts.redo = tool("arrow-clockwise", "mu.textcard.tool.redo", () => {
    area.focus();
    document.execCommand("redo");
  });
  parts.findTool = tool("search", "mu.textcard.tool.find", () => show(parts.panel === "find" ? "" : "find"));

  const tidyMenu = menu();
  parts.tidyItems = TIDY.map((one) => {
    const button = menuItem(`mu.textcard.tidy.${one.key}`, one.icon, () => {
      if (area.readOnly) return;
      const from = area.selectionStart;
      const to = area.selectionEnd;
      const whole = from === to;
      const source = whole ? area.value : area.value.slice(from, to);
      const result = one.run(source);
      if (result !== source) replaceRange(area, whole ? 0 : from, whole ? area.value.length : to, result);
    });
    tidyMenu.append(button);
    return button;
  });
  parts.tidyTool = menuTrigger("magic", "mu.textcard.tool.tidy", tidyMenu);

  const optionsMenu = menu();
  parts.switches = {};
  for (const [key, labelKey, name] of [
    ["wrap", "mu.textcard.opt.wrap", "text-wrap"],
    ["mono", "mu.textcard.opt.mono", "braces"],
    ["tab", "mu.textcard.opt.tab", "indent"],
    ["spellcheck", "mu.textcard.opt.spellcheck", "spellcheck"],
    ["numbers", "mu.textcard.opt.numbers", "list-ol"],
    ["stats", "mu.textcard.opt.stats", "info-circle"],
  ]) {
    const one = menuItem(labelKey, name, () => setOption(key, !options()[key]), { check: true, keepOpen: true });
    parts.switches[key] = one;
    optionsMenu.append(one);
  }
  optionsMenu.append(make("div", "mu-tx-menu-divider", { role: "separator" }));
  const zoom = make("div", "mu-tx-menu-zoom");
  const zoomButton = (name, titleKey, run) => {
    const button = tool(name, titleKey, run, "mu-tx-zoom-button");
    button.setAttribute("role", "menuitem");
    zoom.append(button);
    return button;
  };
  zoomButton("dash-lg", "mu.textcard.opt.zoomOut", () => setOption("zoom", Math.max(ZOOM_MIN, options().zoom - ZOOM_STEP)));
  parts.zoomText = make("button", "mu-tx-zoom-value", { type: "button" });
  parts.zoomText.setAttribute("role", "menuitem");
  parts.zoomText.addEventListener("mousedown", (event) => event.preventDefault());
  parts.zoomText.addEventListener("click", (event) => {
    event.stopPropagation();
    closePopupMenu(true);
    setOption("zoom", TEXTCARD_DEFAULTS.zoom);
  });
  say(parts.zoomText, "mu.textcard.opt.zoomReset");
  zoom.append(parts.zoomText);
  zoomButton("plus-lg", "mu.textcard.opt.zoomIn", () => setOption("zoom", Math.min(ZOOM_MAX, options().zoom + ZOOM_STEP)));
  optionsMenu.append(zoom);
  parts.optionsTool = menuTrigger("sliders", "mu.textcard.tool.options", optionsMenu);

  const actionBar = bar(el);
  actionBar.classList.add("mu-tx-action-bar");
  const row = barRow(el, "textcard", { thirds: false });
  row.classList.add("mu-tx-action-row");
  const start = make("div", "mu-action-bar-start");
  const spacer = make("span", "mu-tx-action-spacer");
  const end = make("div", "mu-action-bar-end");
  // Only the features asked for are offered; the rest are made but never placed.
  if (has("history")) start.append(parts.undo, parts.redo);
  end.append(...[has("find") && parts.findTool, has("tidy") && parts.tidyTool, has("display") && parts.optionsTool].filter(Boolean));
  row.append(start, spacer, end);

  function show(panel) {
    parts.panel = panel;
    el.dataset.panel = panel;
    parts.findTool.classList.toggle("is-active", panel === "find");
    if (panel === "find") {
      const selected = area.value.slice(area.selectionStart, area.selectionEnd);
      if (selected && !selected.includes("\n")) parts.find.value = selected;
      parts.find.focus();
      parts.find.select();
      findCount();
    }
  }
  parts.show = show;

  // ---- find and replace ----
  const findPanel = make("div", "mu-tx-panel mu-tx-find");
  parts.find = make("input", "input mu-tx-find-input", { type: "text", spellcheck: false });
  parts.replace = make("input", "input mu-tx-find-input", { type: "text", spellcheck: false });
  say(parts.find, "mu.textcard.find.placeholder", "placeholder");
  say(parts.replace, "mu.textcard.find.replacePlaceholder", "placeholder");
  parts.count = make("span", "mu-tx-find-count");
  parts.caseTool = tool("type", "mu.textcard.find.case", () => {
    parts.caseTool.classList.toggle("is-active");
    findCount();
  });
  parts.regexTool = tool("regex", "mu.textcard.find.regex", () => {
    parts.regexTool.classList.toggle("is-active");
    findCount();
  });
  const prev = tool("chevron-up", "mu.textcard.find.prev", () => step(-1));
  const next = tool("chevron-down", "mu.textcard.find.next", () => step(1));
  parts.replaceOne = tool("arrow-return-right", "mu.textcard.find.replace", () => replaceOne());
  parts.replaceAll = tool("arrow-repeat", "mu.textcard.find.replaceAll", () => replaceAll());
  const findRow = make("div", "mu-tx-row");
  findRow.append(parts.find, parts.count, prev, next, parts.caseTool, parts.regexTool);
  const replaceRow = make("div", "mu-tx-row");
  replaceRow.append(parts.replace, parts.replaceOne, parts.replaceAll);
  findPanel.append(findRow, replaceRow);

  // The pattern as typed, or why there is none: `null` for an empty box,
  // `false` for one that does not parse.
  function pattern(global = true) {
    const query = parts.find.value;
    if (!query) return null;
    const source = parts.regexTool.classList.contains("is-active") ? query : escapeRegExp(query);
    try {
      return new RegExp(source, `${global ? "g" : ""}${parts.caseTool.classList.contains("is-active") ? "" : "i"}`);
    } catch {
      return false;
    }
  }
  function matches() {
    const re = pattern();
    if (!re) return [];
    const found = [];
    let m;
    while ((m = re.exec(area.value)) && found.length < 5000) {
      if (m[0] === "") re.lastIndex += 1;
      else found.push({ from: m.index, to: m.index + m[0].length });
    }
    return found;
  }
  function findCount() {
    const re = pattern();
    parts.find.classList.toggle("is-bad", re === false);
    parts.find.title = re === false ? t("mu.textcard.find.bad") : "";
    if (!re) {
      parts.count.textContent = "";
      parts.sync();
      return [];
    }
    const found = matches();
    const at = found.findIndex((one) => one.from === area.selectionStart && one.to === area.selectionEnd);
    parts.count.textContent = at >= 0 ? t("mu.textcard.find.countAt", { at: at + 1, n: found.length }) : t("mu.textcard.find.count", { n: found.length });
    parts.sync();
    return found;
  }
  function select(range) {
    area.focus();
    area.setSelectionRange(range.from, range.to);
    // A textarea does not always bring a selection into view by itself:
    // scroll to the line it is on.
    const before = area.value.slice(0, range.from).split("\n").length - 1;
    const lineHeight = parseFloat(getComputedStyle(area).lineHeight) || 18;
    const top = before * lineHeight;
    if (top < area.scrollTop || top > area.scrollTop + area.clientHeight - lineHeight * 2) {
      area.scrollTop = Math.max(0, top - area.clientHeight / 2);
    }
    findCount();
    stats();
  }
  function step(direction) {
    const found = matches();
    if (!found.length) return findCount();
    const at = direction > 0 ? area.selectionEnd : area.selectionStart;
    const pick =
      direction > 0
        ? found.find((one) => one.from >= at) || found[0]
        : [...found].reverse().find((one) => one.to <= at) || found[found.length - 1];
    select(pick);
  }
  function replaceOne() {
    const re = pattern(false);
    if (!re || area.readOnly) return;
    const chosen = area.value.slice(area.selectionStart, area.selectionEnd);
    const whole = new RegExp(`^(?:${re.source})$`, re.flags);
    if (chosen && whole.test(chosen)) {
      replaceRange(area, area.selectionStart, area.selectionEnd, chosen.replace(re, parts.replace.value));
    }
    step(1);
  }
  function replaceAll() {
    const re = pattern();
    if (!re || area.readOnly) return;
    const before = area.value;
    const after = before.replace(re, parts.replace.value);
    if (after !== before) replaceRange(area, 0, before.length, after);
    area.setSelectionRange(0, 0);
    findCount();
  }
  parts.find.addEventListener("input", findCount);
  for (const input of [parts.find, parts.replace]) {
    input.addEventListener("keydown", (event) => {
      event.stopPropagation();
      if (event.key === "Escape") {
        show("");
        area.focus();
      } else if (event.key === "Enter") {
        event.preventDefault();
        if (input === parts.replace) replaceOne();
        else step(event.shiftKey ? -1 : 1);
      }
    });
  }

  // ---- line numbers and the marks on every match ----
  // A textarea can draw neither, so both are drawn behind it: a copy of
  // the text, a block per line, set in the same box and face and moved
  // with its scrolling. The copy is invisible; what shows through the
  // (then transparent) textarea is the counter in the margin and a
  // background on each match. One block per *line*, not per row, which is
  // what lets a wrapped line carry one number.
  parts.mirror = make("div", "mu-tx-mirror", { hidden: true });
  parts.mirrorIn = make("div", "mu-tx-mirror-in");
  parts.mirror.append(parts.mirrorIn);
  parts.lines = [];
  let digitWidth = 0;
  function sync() {
    const o = options();
    const marked = parts.panel === "find" && parts.find.value ? matches() : [];
    const active = (o.numbers || marked.length > 0) && !area.hidden;
    el.classList.toggle("mu-tx-backdrop", active);
    el.classList.toggle("mu-tx-numbers", Boolean(o.numbers));
    parts.mirror.hidden = !active;
    if (!active) {
      if (parts.lines.length) {
        parts.mirrorIn.replaceChildren();
        parts.lines = [];
      }
      el.style.removeProperty("--mu-tx-gutter");
      return;
    }
    const value = area.value;
    const rows = value.split("\n");
    // The margin is as wide as the largest number, in the text's own face.
    const own = getComputedStyle(area);
    if (o.numbers) {
      const font = `${own.fontStyle} ${own.fontWeight} ${own.fontSize} ${own.fontFamily}`;
      if (parts.digitFont !== font) {
        parts.digitFont = font;
        const context = document.createElement("canvas").getContext("2d");
        context.font = font;
        digitWidth = context.measureText("0").width;
      }
      el.style.setProperty("--mu-tx-gutter", `${Math.ceil(String(rows.length).length * digitWidth + 14)}px`);
    } else {
      el.style.removeProperty("--mu-tx-gutter");
    }
    const box = getComputedStyle(area);
    const inner = parts.mirrorIn;
    Object.assign(parts.mirror.style, {
      left: `${area.offsetLeft}px`,
      top: `${area.offsetTop}px`,
      width: `${area.offsetWidth}px`,
      height: `${area.offsetHeight}px`,
    });
    Object.assign(inner.style, {
      width: `${area.clientWidth}px`,
      font: box.font,
      letterSpacing: box.letterSpacing,
      lineHeight: box.lineHeight,
      tabSize: box.tabSize,
      padding: box.padding,
      whiteSpace: o.wrap ? "pre-wrap" : "pre",
      transform: `translate(${-area.scrollLeft}px, ${-area.scrollTop}px)`,
    });
    // Only the lines that changed are drawn again. Typing touches one
    // line, so redrawing all of them -- thousands, in a long note -- on
    // every key was what made the card slow. Each line is known by its
    // text and the marks on it; the lines that differ are what lies
    // between the ones that match at the top and at the bottom.
    const lines = [];
    let start = 0;
    let next = 0;
    for (const row of rows) {
      const end = start + row.length;
      const segments = [];
      while (next < marked.length && marked[next].to <= start) next += 1;
      for (let k = next; k < marked.length && marked[k].from < end; k += 1) {
        const from = Math.max(marked[k].from, start) - start;
        const to = Math.min(marked[k].to, end) - start;
        if (to > from) segments.push([from, to]);
      }
      lines.push({ row, segments, key: segments.length ? `${row}\u0000${segments.join(";")}` : row });
      start = end + 1;
    }
    const before = parts.lines;
    let head = 0;
    while (head < before.length && head < lines.length && before[head].key === lines[head].key) head += 1;
    let tail = 0;
    while (
      tail < before.length - head &&
      tail < lines.length - head &&
      before[before.length - 1 - tail].key === lines[lines.length - 1 - tail].key
    ) {
      tail += 1;
    }
    const gone = before.slice(head, before.length - tail);
    const anchor = tail ? before[before.length - tail].block : null;
    for (const one of gone) one.block.remove();
    const frag = document.createDocumentFragment();
    for (let i = head; i < lines.length - tail; i += 1) {
      const { row, segments } = lines[i];
      const block = make("div", "mu-tx-ml");
      let at = 0;
      for (const [from, to] of segments) {
        if (from > at) block.append(row.slice(at, from));
        block.append(make("mark", "mu-tx-mark", { textContent: row.slice(from, to) }));
        at = to;
      }
      if (at < row.length) block.append(row.slice(at));
      lines[i].block = block;
      frag.append(block);
    }
    for (let i = 0; i < head; i += 1) lines[i].block = before[i].block;
    for (let i = lines.length - tail, j = before.length - tail; i < lines.length; i += 1, j += 1) lines[i].block = before[j].block;
    inner.insertBefore(frag, anchor);
    parts.lines = lines;
  }
  parts.sync = sync;
  // The scroll is remembered while it can be seen: a hidden textarea reads
  // as scrolled to the top, and that is not where the person left it.
  parts.scrolled = { top: 0, left: 0 };
  parts.wasHidden = true;
  const remember = () => {
    if (area.clientHeight <= 0) return;
    parts.scrolled = { top: area.scrollTop, left: area.scrollLeft };
    if (parts.scrollKey) scrolls.set(parts.scrollKey, parts.scrolled);
  };
  area.addEventListener("scroll", () => {
    parts.mirrorIn.style.transform = `translate(${-area.scrollLeft}px, ${-area.scrollTop}px)`;
    remember();
  });
  // Also at the moments it is likely to be left: a scroll event is not
  // always delivered before the layout is drawn again.
  area.addEventListener(
    "wheel",
    () => {
      parts.moved = true;
      setTimeout(remember, 120);
    },
    { passive: true }
  );
  for (const name of ["keydown", "pointerdown", "touchstart"]) area.addEventListener(name, () => (parts.moved = true), { passive: true });
  for (const name of ["keyup", "mouseup", "focusout"]) area.addEventListener(name, remember);
  // Shown again (or shown the first time) after being hidden: back to where
  // it was left. Asked by whatever sees the card on screen -- the size
  // observer, and the redraw that follows the layout being drawn again.
  parts.settle = () => {
    const visible = area.clientHeight > 0;
    if (visible && parts.wasHidden) {
      const kept = (parts.scrollKey && scrolls.get(parts.scrollKey)) || parts.scrolled;
      if (kept && (kept.top || kept.left)) {
        const put = () => {
          area.scrollTop = kept.top;
          area.scrollLeft = kept.left;
          parts.mirrorIn.style.transform = `translate(${-area.scrollLeft}px, ${-area.scrollTop}px)`;
        };
        put();
        // The text may not be laid out yet, and a scroll past the end of it
        // lands on the top: ask again a few times, until the person has
        // scrolled it themselves.
        parts.moved = false;
        for (const delay of [60, 250, 800]) {
          setTimeout(() => {
            if (!parts.moved && Math.abs(area.scrollTop - kept.top) > 1) put();
          }, delay);
        }
      }
    }
    parts.wasHidden = !visible;
  };
  new ResizeObserver(() => {
    parts.settle();
    parts.sync();
  }).observe(area);

  // ---- the line numbers are a way to select a line ----
  // The margin is the textarea's own padding, so a press there lands in the
  // text; it is taken here instead and selects the line it is level with --
  // dragged down or up, the lines it passes.
  const gutterWidth = () => (options().numbers ? parseFloat(el.style.getPropertyValue("--mu-tx-gutter")) || 0 : 0);
  const inGutter = (event) => {
    const width = gutterWidth();
    if (!width) return false;
    const box = area.getBoundingClientRect();
    return event.clientX - box.left - area.clientLeft < width;
  };
  // The line whose block is level with a height on screen, by index.
  const lineAt = (clientY) => {
    const rows = parts.lines;
    if (!rows.length) return -1;
    let found = rows.length - 1;
    for (let i = 0; i < rows.length; i += 1) {
      const box = rows[i].block.getBoundingClientRect();
      if (clientY < box.bottom) {
        found = i;
        break;
      }
    }
    return found;
  };
  // The text of lines `a` to `b` (inclusive), with the line break after the
  // last one when there is one.
  const selectLines = (a, b) => {
    const first = Math.min(a, b);
    const last = Math.max(a, b);
    const rows = area.value.split("\n");
    let from = 0;
    for (let i = 0; i < first; i += 1) from += rows[i].length + 1;
    let to = from;
    for (let i = first; i <= last; i += 1) to += rows[i].length + 1;
    area.setSelectionRange(from, Math.min(to, area.value.length), a <= b ? "forward" : "backward");
    parts.stats();
  };
  let anchorLine = -1;
  area.addEventListener("mousedown", (event) => {
    if (event.button !== 0 || !inGutter(event)) return;
    const line = lineAt(event.clientY);
    if (line < 0) return;
    event.preventDefault();
    area.focus();
    anchorLine = line;
    selectLines(line, line);
    const move = (e) => {
      const now = lineAt(e.clientY);
      if (now >= 0) selectLines(anchorLine, now);
    };
    const up = () => {
      document.removeEventListener("mousemove", move, true);
      document.removeEventListener("mouseup", up, true);
      anchorLine = -1;
    };
    document.addEventListener("mousemove", move, true);
    document.addEventListener("mouseup", up, true);
  });
  area.addEventListener("mousemove", (event) => {
    area.classList.toggle("mu-tx-over-gutter", !event.buttons && inGutter(event));
  });
  area.addEventListener("mouseleave", () => area.classList.remove("mu-tx-over-gutter"));

  // ---- the line of facts ----
  parts.status = make("div", "mu-tx-status");
  function stats() {
    const value = area.value;
    const at = area.selectionStart;
    const before = value.slice(0, at);
    const picked = Math.abs(area.selectionEnd - area.selectionStart);
    const facts = [
      t("mu.textcard.stat.pos", { line: before.split("\n").length, col: at - before.lastIndexOf("\n") }),
      t("mu.textcard.stat.chars", { n: [...value].length }),
      t("mu.textcard.stat.lines", { n: value.split("\n").length }),
    ];
    if (picked) facts.push(t("mu.textcard.stat.selected", { n: picked }));
    const line = facts.join("  ·  ");
    if (parts.status.textContent !== line) parts.status.textContent = line;
  }
  parts.stats = stats;

  // ---- keys and the caret ----
  area.addEventListener("keydown", (event) => {
    if (has("find") && event.ctrlKey && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "f") {
      event.preventDefault();
      show("find");
    } else if (has("find") && event.key === "F3") {
      event.preventDefault();
      step(event.shiftKey ? -1 : 1);
    } else if (event.key === "Escape" && parts.panel) {
      // Closing the panel is this Escape's whole job; the shell's own
      // (letting go of the window's focus) is for the next one.
      event.stopPropagation();
      show("");
    } else if (event.key === "Tab" && options().tab && !area.readOnly && !event.ctrlKey && !event.altKey) {
      event.preventDefault();
      indent(area, event.shiftKey);
    }
  });
  // What follows typing -- the facts, the margin, the marks -- is done
  // once per frame, however many keys came in it: fast typing must cost the
  // keys and nothing else.
  let frame = 0;
  let redraw = false;
  const later = (full) => {
    redraw = redraw || full;
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      stats();
      if (redraw) {
        redraw = false;
        if (parts.panel === "find") findCount();
        else sync();
      }
    });
  };
  area.addEventListener("input", () => later(true));
  for (const name of ["keyup", "mouseup", "focus"]) area.addEventListener(name, () => later(false));

  slots.body(findPanel, parts.status, parts.mirror);
  el.classList.add("mu-tx-card");
  parts.features = features;
  el.__tx = parts;
  return parts;
}

// A tab with nothing selected, or the lines of what is selected moved a
// tab in or out.
function indent(area, back) {
  const from = area.selectionStart;
  const to = area.selectionEnd;
  const text = area.value;
  if (from === to && !back) return replaceRange(area, from, to, "\t");
  const start = from === 0 ? 0 : text.lastIndexOf("\n", from - 1) + 1;
  const end = to;
  const block = text.slice(start, end);
  const moved = block
    .split("\n")
    .map((l) => (back ? l.replace(/^(\t| {1,4})/, "") : `\t${l}`))
    .join("\n");
  if (moved === block) return;
  replaceRange(area, start, end, moved);
}

// What the features show now; called by texteditor.update after the card's own.
export function updateFeatures(el, desc) {
  el.__txDesc = desc;
  const parts = el.__tx;
  const p = desc.params;
  const area = parts.area;
  parts.scrollKey = p.scrollKey || "";
  const opts = { ...TEXTCARD_DEFAULTS, ...(p.options || parts.local) };
  const fixed = area.readOnly;
  if (popupMenu && !popupMenu.button.isConnected) closePopupMenu();
  if ((el.classList.contains("is-oneline") || el.classList.contains("is-alternate-view")) &&
      popupMenu && el.contains(popupMenu.button)) closePopupMenu();

  for (const { node, key, attr } of parts.texts) {
    const text = t(key);
    if (node[attr] !== text) node[attr] = text;
  }
  // A read-only card still finds and counts; it just cannot change.
  for (const tool of [parts.undo, parts.redo, parts.tidyTool, ...parts.tidyItems, parts.replaceOne, parts.replaceAll]) tool.disabled = fixed;
  for (const [key, one] of Object.entries(parts.switches)) {
    const checked = Boolean(opts[key]);
    one.classList.toggle("is-checked", checked);
    one.setAttribute("aria-checked", String(checked));
  }

  area.wrap = opts.wrap ? "soft" : "off";
  area.spellcheck = Boolean(opts.spellcheck);
  el.classList.toggle("mu-tx-nowrap", !opts.wrap);
  el.classList.toggle("mu-tx-mono", Boolean(opts.mono));
  el.classList.toggle("is-filling", Boolean(p.fill));
  el.classList.toggle("mu-tx-nostats", !opts.stats || !parts.features.includes("display"));
  el.style.setProperty("--mu-tx-zoom", String(opts.zoom / 100));
  parts.zoomText.textContent = `${opts.zoom}%`;
  parts.stats();
  parts.settle();
  parts.sync();
  if (parts.panel === "find") parts.find.dispatchEvent(new Event("input"));
}
