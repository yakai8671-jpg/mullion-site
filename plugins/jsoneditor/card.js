/* jsoneditor.card -- the shell's text card, holding a JSON document, with
 * two ways to work on it.
 *
 * It is the `texteditor` control with more around it, not a second one: the
 * card, its grip, the link it can follow, copy and the one-line toggle are
 * all the shell's. What is added is a row under the header -- which view,
 * and in the text view, format and minify -- the blocks view that takes the
 * text's place, and a line that says whether the document is JSON.
 *
 * The document is always the text. The blocks are parsed from it, and every
 * change in them is written back as text; so a grip, a link or a paste moves
 * the same thing in either view, and nothing about the document is kept
 * anywhere else. Text that does not parse cannot be shown as blocks: the
 * view stays text, with the error, until it parses again.
 *
 * Which view is shown is the placer's to keep (`options.mode`, bound with
 * `binds: { options: { mode: ... } }`), as the notepad's options are.
 */

import { createBlocks } from "./blocks.js";

const MODES = ["text", "blocks"];
const JSON_DEFAULTS = { mode: "blocks" };

const INDENT = "  ";

// Where each document was scrolled to, by the item it belongs to: a pane
// loses its scroll when it is taken out of the layout and put back.
const scrolls = new Map();

function parse(text) {
  if (!text.trim()) return { empty: true };
  try {
    return { value: JSON.parse(text) };
  } catch (error) {
    return { error: String(error.message || error), text };
  }
}

function createCard(fw) {
  const { core } = fw;
  const { t } = core;

  const make = (tag, className, props) => Object.assign(document.createElement(tag), { className, ...props });
  const icon = (name) => make("i", `bi bi-${name}`);

  // Where in the text a parse error is, in the words a person counts by.
  function whereIs(error, text) {
    if (/line \d+/i.test(error)) return "";
    const match = error.match(/position\s+(\d+)/i);
    if (!match) return "";
    const before = text.slice(0, Number(match[1])).split("\n");
    return ` (${t("jsoneditor.at", { line: before.length, col: before.at(-1).length + 1 })})`;
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
    area.setSelectionRange(from, from);
  }

  function build(el) {
    const slots = fw.controls.texteditor.slots(el);
    const area = slots.area;
    const parts = { area, texts: [], local: { ...JSON_DEFAULTS }, emitted: null, language: "" };
    const say = (node, key, attr = "title") => {
      parts.texts.push({ node, key, attr });
      return node;
    };
    const options = () => ({ ...JSON_DEFAULTS, ...(el.__desc.params.options || parts.local) });
    const setOption = (key, value) => {
      const desc = el.__desc;
      if (desc.set && desc.set("options", { ...options(), [key]: value })) return;
      parts.local[key] = value;
      update(el, desc);
    };

    const tool = (name, titleKey, run) => {
      const button = make("button", "mu-icon-button je-tool", { type: "button" });
      button.append(icon(name));
      // Pressing a tool must not take the selection away from the text.
      button.addEventListener("mousedown", (event) => event.preventDefault());
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        run();
      });
      return say(button, titleKey);
    };

    // ---- the row under the header ----
    // The card's own bar (the shell's), under the header.
    const bar = fw.card.bar(el);
    bar.classList.add("je-bar");
    const views = make("div", "je-views");
    parts.views = {};
    for (const mode of MODES) {
      const chip = make("button", "je-chip", { type: "button" });
      chip.append(icon(mode === "text" ? "code-slash" : "diagram-3"), say(make("span", "je-chip-label"), `jsoneditor.mode.${mode}`, "textContent"));
      chip.addEventListener("click", (event) => {
        event.stopPropagation();
        if (options().mode !== mode) setOption("mode", mode);
      });
      parts.views[mode] = chip;
      views.append(chip);
    }
    parts.undo = tool("arrow-counterclockwise", "jsoneditor.tool.undo", () => {
      area.focus();
      document.execCommand("undo");
    });
    parts.redo = tool("arrow-clockwise", "jsoneditor.tool.redo", () => {
      area.focus();
      document.execCommand("redo");
    });
    parts.format = tool("text-indent-left", "jsoneditor.tool.format", () => reshape(INDENT));
    parts.minify = tool("arrows-collapse", "jsoneditor.tool.minify", () => reshape(""));
    parts.texty = [parts.undo, parts.redo, parts.format, parts.minify];
    bar.append(views, make("span", "je-gap"), ...parts.texty);

    // The document rewritten in one go, so that it is one step to undo.
    function reshape(space) {
      const parsed = parse(area.value);
      if (parsed.error || parsed.empty) return;
      replaceRange(area, 0, area.value.length, JSON.stringify(parsed.value, null, space) + (space ? "\n" : ""));
    }

    // ---- the blocks ----
    parts.blocks = createBlocks({
      t,
      onEdit: (text) => {
        parts.emitted = text;
        if (el.__change) el.__change(text);
        parts.stats(text);
      },
    });
    parts.blocks.el.classList.add("je-pane");

    // ---- the line under the text ----
    parts.status = make("div", "je-status");
    parts.message = make("span", "je-message");
    parts.cursor = make("span", "je-cursor");
    parts.status.append(parts.message, parts.cursor);

    parts.stats = (text = area.value) => {
      const parsed = parse(text);
      const state = parsed.error ? "bad" : parsed.empty ? "empty" : "ok";
      el.dataset.json = state;
      parts.message.textContent = parsed.error
        ? `${parsed.error}${whereIs(parsed.error, text)}`
        : t(parsed.empty ? "jsoneditor.status.empty" : "jsoneditor.status.valid");
      parts.message.title = parts.message.textContent;
      if (el.dataset.view === "text") {
        const before = text.slice(0, area.selectionStart).split("\n");
        parts.cursor.textContent = t("jsoneditor.status.pos", { line: before.length, col: before.at(-1).length + 1 });
      } else {
        parts.cursor.textContent = "";
      }
      parts.views.blocks.disabled = Boolean(parsed.error);
      parts.views.blocks.title = parsed.error ? t("jsoneditor.mode.fix") : "";
    };

    let frame = 0;
    const later = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        parts.stats();
      });
    };
    area.addEventListener("input", later);
    for (const name of ["keyup", "mouseup", "focus"]) area.addEventListener(name, later);

    area.addEventListener("keydown", (event) => {
      if (event.key === "Tab" && !event.ctrlKey && !event.altKey && !event.metaKey && !area.readOnly) {
        event.preventDefault();
        replaceRange(area, area.selectionStart, area.selectionEnd, INDENT);
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === "f" && !area.readOnly) {
        event.preventDefault();
        reshape(INDENT);
      }
    });

    // ---- scroll, kept while it can be seen ----
    const keepScroll = (node, which) => {
      const key = () => `${parts.scrollKey || ""}:${which}`;
      let top = 0;
      let hidden = true;
      node.addEventListener("scroll", () => {
        if (node.clientHeight <= 0) return;
        top = node.scrollTop;
        if (parts.scrollKey) scrolls.set(key(), top);
      });
      new ResizeObserver(() => {
        const visible = node.clientHeight > 0;
        if (visible && hidden) {
          const kept = (parts.scrollKey && scrolls.get(key())) || top;
          if (kept) requestAnimationFrame(() => (node.scrollTop = kept));
        }
        hidden = !visible;
      }).observe(node);
    };
    keepScroll(area, "text");
    keepScroll(parts.blocks.el, "blocks");

    slots.body(parts.blocks.el, parts.status);
    el.classList.add("je-card");
    el.__je = parts;
    return parts;
  }

  function update(el, desc) {
    const base = fw.controls.texteditor;
    base.update(el, desc);
    el.__desc = desc;
    const parts = el.__je;
    const p = desc.params;
    const area = parts.area;
    parts.scrollKey = p.scrollKey || "";

    for (const { node, key, attr } of parts.texts) {
      const text = t(key);
      if (node[attr] !== text) node[attr] = text;
    }

    const text = String(desc.value ?? "");
    const parsed = parse(text);
    const wanted = { ...JSON_DEFAULTS, ...(p.options || parts.local) }.mode;
    const view = wanted === "blocks" && !parsed.error ? "blocks" : "text";
    const fixed = area.readOnly;

    el.dataset.view = view;
    el.classList.toggle("is-filling", Boolean(p.fill));
    for (const mode of MODES) parts.views[mode].classList.toggle("is-active", wanted === mode);
    for (const tool of parts.texty) tool.hidden = view !== "text";
    for (const tool of [parts.undo, parts.redo, parts.format, parts.minify]) tool.disabled = fixed;
    parts.format.disabled = fixed || Boolean(parsed.error) || Boolean(parsed.empty);
    parts.minify.disabled = parts.format.disabled;

    parts.blocks.setReadonly(fixed);
    const language = t("jsoneditor.key");
    if (view === "blocks") {
      // Its own edits come back here as the text they wrote; only text from
      // elsewhere starts the blocks again (and unfolds them).
      if (text !== parts.emitted) {
        parts.emitted = text;
        parts.blocks.load(parsed.empty ? {} : parsed.value);
      } else if (language !== parts.language) {
        parts.blocks.redraw();
      }
    } else {
      parts.emitted = null;
    }
    parts.language = language;
    parts.stats(text);
  }

  return {
    render(desc, onChange) {
      const el = fw.controls.texteditor.render(desc, onChange);
      el.__desc = desc;
      el.__change = onChange;
      build(el);
      update(el, desc);
      return el;
    },
    update,
  };
}

export const controls = { "jsoneditor.card": createCard };
