/* compose.input -- the shell's text card, with variables in the text.
 *
 * It is the shell's text card with its features (find and replace, tidying,
 * display options, line numbers, ...; `features` is passed through) and
 * nothing else: the field is the same textarea, and what a
 * variable is in it is a run of characters (see vars.js) that the textarea
 * holds like any others. What is added:
 *
 *   - a layer over the textarea, set in the same box and face and moved with
 *     its scrolling, that draws each run as a badge: the same characters, so
 *     it lies exactly where they are, over them. Its handle -- the first of
 *     the characters -- is the one place on it that takes the pointer;
 *     pulling it moves the badge to wherever it is let go in the text;
 *   - the caret never stops inside a badge, and Backspace / Delete next to one
 *     takes the whole of it;
 *   - what is typed is taken back (`reconcile`) into the text and the list of
 *     variables embedded in it, so a badge cut or copied is a variable
 *     removed or copied.
 *
 * Given by whoever places it: `embeds` (the variables in the text, in the order they
 * stand; written back when the list changes) and `sources` (what the connected items offer, from
 * which a variable's name and what the text comes to are made). Where the caret is, in the stored
 * text, is told to lib.js for the catalog to put a variable at.
 */

import { HANDLE, expand, reconcile, runsOf, toCompactOffset } from "./vars.js";
import { coerceEmbeds, composed, labelFor, setCaret } from "./lib.js";

export default function createInput(fw) {

  const make = (tag, className, props = {}) => Object.assign(document.createElement(tag), { className, ...props });

  // What the textarea is shown with: the stored text, with each run given its
  // variable's name.
  const labelOf = (desc) => labelFor(coerceEmbeds(desc.params.embeds), desc.params.sources);
  const wrapDesc = (desc) => ({ ...desc, value: expand(desc.value, labelOf(desc)) });

  function build(el) {
    const slots = fw.controls.texteditor.slots(el);
    const area = slots.area;
    const layer = make("div", "cp-layer");
    const inner = make("div", "cp-layer-in");
    const drop = make("div", "cp-drop", { hidden: true });
    layer.append(inner);
    slots.body(layer, drop);
    const cp = { area, layer, inner, drop, key: "", before: 0 };
    el.__cp = cp;

    const box = () => getComputedStyle(area);
    // Set in the textarea's own box and face, and moved as it scrolls.
    cp.place = () => {
      const own = box();
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
    };

    // Each run is a badge: the characters it is made of, in a span of their
    // own with the handle in another. No padding or margin anywhere in it, or
    // the text after it would no longer lie where the textarea's does.
    cp.draw = () => {
      const value = area.value;
      const own = box();
      const key = `${value}\u0000${own.font}\u0000${area.clientWidth}\u0000${own.padding}\u0000${area.wrap}`;
      cp.place();
      if (key === cp.key) return;
      cp.key = key;
      const nodes = [];
      let at = 0;
      for (const run of runsOf(value)) {
        if (run.from > at) nodes.push(document.createTextNode(value.slice(at, run.from)));
        const pill = make("span", "cp-badge");
        pill.dataset.id = run.id;
        const mark = value.slice(run.from, run.to);
        const handleAt = mark.indexOf(HANDLE);
        pill.append(document.createTextNode(mark.slice(0, handleAt)));
        const grip = make("span", "cp-handle", { textContent: HANDLE });
        grip.addEventListener("pointerdown", (event) => startMove(event, run.id));
        pill.append(grip, document.createTextNode(mark.slice(handleAt + HANDLE.length)));
        nodes.push(pill);
        at = run.to;
      }
      if (at < value.length) nodes.push(document.createTextNode(value.slice(at)));
      inner.replaceChildren(...nodes);
    };

    area.addEventListener("scroll", () => {
      inner.style.transform = `translate(${-area.scrollLeft}px, ${-area.scrollTop}px)`;
    });
    new ResizeObserver(() => cp.draw()).observe(area);

    // ---- the caret stays out of a badge ---------------------------------
    let last = 0;
    document.addEventListener("selectionchange", () => {
      if (document.activeElement !== area || !el.isConnected) return;
      const value = area.value;
      const runs = runsOf(value);
      let from = area.selectionStart;
      let to = area.selectionEnd;
      if (runs.length) {
        const inside = (pos) => runs.find((run) => pos > run.from && pos < run.to);
        const a = inside(from);
        const b = inside(to);
        if (from === to && a) {
          // Moving right goes over it, moving left goes back before it.
          from = to = from >= last ? a.to : a.from;
        } else {
          if (a) from = a.from;
          if (b) to = b.to;
        }
        if (from !== area.selectionStart || to !== area.selectionEnd) area.setSelectionRange(from, to, area.selectionDirection);
      }
      last = area.selectionStart;
      const p = el.__cdesc && el.__cdesc.params;
      if (p && el.__cdesc.item) setCaret(el.__cdesc.item.id, toCompactOffset(value, area.selectionStart));
    });

    // Backspace after a badge, or Delete before one, takes all of it.
    area.addEventListener("keydown", (event) => {
      if ((event.key !== "Backspace" && event.key !== "Delete") || area.selectionStart !== area.selectionEnd) return;
      const at = area.selectionStart;
      const run = runsOf(area.value).find((one) => (event.key === "Backspace" ? one.to === at : one.from === at));
      if (run) area.setSelectionRange(run.from, run.to);
    });

    // ---- moving a badge by its handle ------------------------------------
    // Where in the text a point is, found in the layer's own copy of it (a
    // textarea cannot say): the layer takes the pointer for the length of the
    // move, and gives it back.
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
    function* walk(root) {
      for (const node of root.childNodes) {
        if (node.nodeType === Node.TEXT_NODE) yield node;
        else yield* walk(node);
      }
    }
    // A place that is not inside another badge.
    const outside = (offset, runs) => {
      const inside = runs.find((run) => offset > run.from && offset < run.to);
      return inside ? (offset - inside.from < inside.to - offset ? inside.from : inside.to) : offset;
    };

    function startMove(event, id) {
      if (event.button !== 0 || area.readOnly) return;
      event.preventDefault();
      event.stopPropagation();
      const runs = runsOf(area.value);
      const run = runs.find((one) => one.id === id);
      if (!run) return;
      let target = null;
      const cardBox = el.getBoundingClientRect();
      const move = (e) => {
        const found = offsetAt(e.clientX, e.clientY);
        target = found === null ? null : outside(found, runs);
        const rect = target === null ? null : rectAt(target);
        drop.hidden = !rect;
        if (rect) {
          Object.assign(drop.style, {
            left: `${rect.left - cardBox.left}px`,
            top: `${rect.top - cardBox.top}px`,
            height: `${rect.height}px`,
          });
        }
      };
      const done = (e) => {
        window.removeEventListener("pointermove", move, true);
        window.removeEventListener("pointerup", done, true);
        window.removeEventListener("pointercancel", done, true);
        document.body.classList.remove("cp-moving");
        drop.hidden = true;
        if (e.type === "pointercancel" || target === null || (target >= run.from && target <= run.to)) return;
        const value = area.value;
        const text = value.slice(run.from, run.to);
        // One edit that covers what lies between: the textarea's own undo
        // takes it back in one step.
        let from;
        let to;
        let put;
        if (target > run.to) {
          from = run.from;
          to = target;
          put = value.slice(run.to, target) + text;
        } else {
          from = target;
          to = run.to;
          put = text + value.slice(target, run.from);
        }
        area.focus();
        area.setSelectionRange(from, to);
        document.execCommand("insertText", false, put);
      };
      document.body.classList.add("cp-moving");
      window.addEventListener("pointermove", move, true);
      window.addEventListener("pointerup", done, true);
      window.addEventListener("pointercancel", done, true);
      move(event);
    }

    // What the field holds after the person (or a tool) changed it: taken back
    // into the text and the variables in it, and the field made to match.
    area.addEventListener("input", () => {
      const desc = el.__cdesc;
      if (!desc) return;
      const p = desc.params;
      const embeds = coerceEmbeds(p.embeds);
      const label = labelOf(desc);
      const { text, embeds: next } = reconcile(area.value, embeds, label);
      const shown = expand(text, label);
      if (shown !== area.value) {
        const caret = Math.min(area.selectionStart, shown.length);
        area.value = shown;
        area.setSelectionRange(caret, caret);
      }
      if (JSON.stringify(next) !== JSON.stringify(embeds) && desc.set) desc.set("embeds", next);
      cp.draw();
    });
    return cp;
  }

  const base = () => fw.controls.texteditor;

  // The shell's text card (and its features), with the badges over it.
  const hooks = {
    render(desc, onChange) {
      // What the card hears, taken back into the stored text first.
      let el;
      const changed = (value) => {
        const current = el && el.__cdesc ? el.__cdesc : desc;
        const { text } = reconcile(value, coerceEmbeds(current.params.embeds), labelOf(current));
        onChange(text);
      };
      el = base().render(wrapDesc(desc), changed);
      el.__cdesc = desc;
      build(el);
      hooks.update(el, desc);
      return el;
    },
    update(el, desc) {
      el.__cdesc = desc;
      base().update(el, wrapDesc(desc));
      // What copy takes is what the text comes to, not the badges' marks.
      el.__text = composed(desc.value, desc.params.embeds, desc.params.sources);
      const cp = el.__cp;
      if (cp) {
        cp.key = "";
        cp.draw();
      }
    },
  };
  return hooks;
}
