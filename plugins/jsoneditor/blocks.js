/* The blocks view of a JSON document: every value is a block with a type,
 * a name when it sits in an object, and its children below it.
 *
 * It owns a value (parsed from the text) and nothing else: the document is
 * the text the card holds, so each edit is turned back into text at once
 * and handed to `onEdit`. What is not part of the document -- which blocks
 * are folded, what is being cut or copied, which one is being dragged --
 * is not saved anywhere; it lasts as long as the value it was said about.
 *
 * A key typed into an object that has no name yet is kept under a draft key
 * (a name nobody can type), so that "add a property" can show a row to fill
 * in before there is a key to put it under; it is written out as "".
 */

export const JSON_TYPES = [
  { type: "object", icon: "braces" },
  { type: "array", icon: "list-ul" },
  { type: "string", icon: "quote" },
  { type: "number", icon: "hash" },
  { type: "boolean", icon: "toggle-on" },
  { type: "null", icon: "slash-circle" },
];

const DRAFT_KEY_PREFIX = "​mu-draft-key:";
const visibleKey = (key) => (key.startsWith(DRAFT_KEY_PREFIX) ? "" : key);

export function valueType(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value === "object" ? "object" : typeof value;
}

const defaultValue = (type) => ({ object: {}, array: [], string: "", number: 0, boolean: true, null: null })[type];
const clone = (value) => JSON.parse(JSON.stringify(value));
const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

// The text of a value as the blocks write it: two spaces, one entry a line.
export function stringify(value, depth = 0) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  const indent = "  ".repeat(depth);
  const inner = "  ".repeat(depth + 1);
  if (Array.isArray(value)) {
    if (!value.length) return "[]";
    return `[\n${value.map((child) => `${inner}${stringify(child, depth + 1)}`).join(",\n")}\n${indent}]`;
  }
  const entries = Object.entries(value);
  if (!entries.length) return "{}";
  return `{\n${entries.map(([key, child]) => `${inner}${JSON.stringify(visibleKey(key))}: ${stringify(child, depth + 1)}`).join(",\n")}\n${indent}}`;
}

const make = (tag, className, props) => Object.assign(document.createElement(tag), { className, ...props });
const icon = (name) => make("i", `bi bi-${name}`);
const iconOf = (type) => JSON_TYPES.find((one) => one.type === type).icon;

function reorderObject(object, from, to) {
  const entries = Object.entries(object);
  const [moved] = entries.splice(from, 1);
  entries.splice(to, 0, moved);
  Object.keys(object).forEach((key) => delete object[key]);
  Object.assign(object, Object.fromEntries(entries));
}

function animateHeight(element, from, to, duration = 160) {
  if (!element || from === to || reduced()) return;
  element.style.overflow = "clip";
  const animation = element.animate([{ height: `${from}px` }, { height: `${to}px` }], { duration, easing: "ease-out" });
  const done = () => {
    element.style.overflow = "";
  };
  animation.addEventListener("finish", done, { once: true });
  animation.addEventListener("cancel", done, { once: true });
}

/* `t(key, params)` is the shell's. `onEdit(text)` hears every change of the
 * document, as the whole text. */
export function createBlocks({ t, onEdit }) {
  const el = make("div", "je-blocks");
  const clipBar = make("div", "je-clipbar");
  clipBar.hidden = true;
  const root = make("div", "je-root");
  const menu = make("div", "je-menu");
  menu.hidden = true;
  el.append(clipBar, root, menu);

  let value = {};
  let readonly = false;
  let seq = 0;
  let clipboard = null; // {mode: "copy"|"cut", value, source}
  let dragged = null;
  let entering = null; // the block that was just added, to slide in
  let resizing = null; // the collection whose height changes, to animate
  const folded = new WeakSet();

  const typeLabel = (type) => t(`jsoneditor.type.${type}`);
  const badge = (type, className = "je-badge") => {
    const one = make("span", `${className} type-${type}`);
    one.append(icon(iconOf(type)));
    return one;
  };

  function newDraftKey(object) {
    let key;
    do key = `${DRAFT_KEY_PREFIX}${++seq}`;
    while (Object.hasOwn(object, key));
    return key;
  }

  const edited = () => onEdit(`${stringify(value)}\n`);

  // ---- the type menu: one, shared, fixed to the screen so that no scrolling
  // pane clips it ----
  let menuOwner = null;
  function closeMenu() {
    if (menu.hidden) return;
    menu.hidden = true;
    if (menuOwner) menuOwner.classList.remove("is-open");
    menuOwner = null;
    document.removeEventListener("pointerdown", outside, true);
    document.removeEventListener("keydown", onKey, true);
  }
  function outside(event) {
    if (!menu.contains(event.target)) closeMenu();
  }
  function onKey(event) {
    if (event.key !== "Escape") return;
    event.stopPropagation();
    closeMenu();
  }
  function openMenu(anchor, pick) {
    if (!menu.hidden && menuOwner === anchor) return closeMenu();
    closeMenu();
    menu.replaceChildren(
      ...JSON_TYPES.map(({ type }) => {
        const option = make("button", "je-menu-item", { type: "button" });
        option.append(badge(type), make("span", "je-menu-label", { textContent: typeLabel(type) }));
        option.addEventListener("click", (event) => {
          event.stopPropagation();
          closeMenu();
          pick(type);
        });
        return option;
      })
    );
    menu.hidden = false;
    const at = anchor.getBoundingClientRect();
    const height = menu.offsetHeight;
    const below = at.bottom + 4 + height <= window.innerHeight || at.top - 4 - height < 0;
    menu.style.left = `${Math.max(4, Math.min(at.left, window.innerWidth - menu.offsetWidth - 4))}px`;
    menu.style.top = `${below ? at.bottom + 4 : at.top - 4 - height}px`;
    menuOwner = anchor;
    anchor.classList.add("is-open");
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("keydown", onKey, true);
  }

  // ---- what is cut or copied ----
  const sameSlot = (a, b) => {
    if (!a || !b || a.parent !== b.parent) return false;
    return Array.isArray(a.parent) ? a.position === b.position : a.key === b.key;
  };

  function removeClipSource() {
    if (!clipboard || clipboard.mode !== "cut") return;
    const { parent, position, key } = clipboard.source;
    if (Array.isArray(parent)) parent.splice(position, 1);
    else delete parent[key];
  }

  function paste(target) {
    const copied = clone(clipboard.value);
    removeClipSource();
    if (Array.isArray(target)) target.push(copied);
    else target[newDraftKey(target)] = copied;
    clipboard = null;
    resizing = target;
    edited();
    render();
  }

  function drawClipBar() {
    clipBar.replaceChildren();
    clipBar.hidden = !clipboard;
    if (!clipboard) return;
    const type = valueType(clipboard.value);
    const info = make("span", `je-clipinfo type-${type}`);
    info.append(badge(type), make("span", "", { textContent: t(`jsoneditor.clip.${clipboard.mode}`, { type: typeLabel(type) }) }));
    const close = make("button", "mu-icon-button", { type: "button", title: t("jsoneditor.clip.cancel") });
    close.append(icon("x-lg"));
    close.addEventListener("click", () => {
      clipboard = null;
      render();
    });
    clipBar.append(info, close);
  }

  // ---- one block ----
  function typeButton(current, onPick) {
    const button = make("button", `je-type type-${current}`, { type: "button", title: `${typeLabel(current)} — ${t("jsoneditor.type.change")}` });
    button.append(icon(iconOf(current)), make("span", "je-type-name", { textContent: t(`jsoneditor.typeShort.${current}`) }));
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      openMenu(button, onPick);
    });
    return button;
  }

  function field(className, text, onInput, kind = "text", eventName = "input", placeholder = "") {
    const input = make("input", `input je-field ${className}`, { type: kind, value: text, placeholder, spellcheck: false });
    input.addEventListener(eventName, () => onInput(input.value));
    return input;
  }

  function block(item, setItem, opts = {}) {
    const type = valueType(item);
    const wrapper = make("div", "je-block");
    wrapper._value = item;
    if (opts.parent) wrapper.classList.add("has-handle");
    if (sameSlot(opts, entering)) wrapper.classList.add("is-entering");
    if (sameSlot(opts, clipboard && clipboard.source)) wrapper.classList.add("is-clip-source", `is-${clipboard.mode}`);
    const row = make("div", "je-row");

    if (opts.parent) {
      const handle = make("span", "je-handle", { draggable: true, title: t("jsoneditor.drag") });
      handle.append(icon("grip-vertical"));
      handle.addEventListener("dragstart", (event) => {
        closeMenu();
        dragged = { parent: opts.parent };
        wrapper.classList.add("is-dragging");
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", String(opts.position));
      });
      handle.addEventListener("dragend", () => {
        dragged = null;
        wrapper.classList.remove("is-dragging");
        render();
      });
      wrapper.addEventListener("dragover", (event) => {
        if (!dragged || dragged.parent !== opts.parent) return;
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = "move";
        const container = wrapper.parentElement;
        const moving = container.querySelector(":scope > .je-block.is-dragging");
        if (!moving || moving === wrapper) return;
        const siblings = [...container.children].filter((one) => one.classList.contains("je-block"));
        const from = siblings.indexOf(moving);
        if (from < 0) return;
        const bounds = wrapper.getBoundingClientRect();
        const after = event.clientY > bounds.top + bounds.height / 2;
        if (!after && moving.nextElementSibling === wrapper) return;
        if (after && wrapper.nextElementSibling === moving) return;
        const tops = new Map(siblings.map((one) => [one, one.getBoundingClientRect().top]));
        container.insertBefore(moving, after ? wrapper.nextElementSibling : wrapper);
        const now = [...container.children].filter((one) => one.classList.contains("je-block"));
        const to = now.indexOf(moving);
        if (to < 0 || from === to) return;
        if (Array.isArray(opts.parent)) {
          const [moved] = opts.parent.splice(from, 1);
          opts.parent.splice(to, 0, moved);
        } else {
          reorderObject(opts.parent, from, to);
        }
        if (!reduced()) {
          now.forEach((one) => {
            const offset = tops.get(one) - one.getBoundingClientRect().top;
            if (!offset) return;
            one.getAnimations().forEach((animation) => animation.cancel());
            one.animate([{ transform: `translateY(${offset}px)` }, { transform: "translateY(0)" }], { duration: 120, easing: "ease-out" });
          });
        }
        edited();
      });
      wrapper.addEventListener("drop", (event) => {
        if (!dragged || dragged.parent !== opts.parent) return;
        event.preventDefault();
        event.stopPropagation();
      });
      row.append(handle);
    }

    row.append(
      typeButton(type, (next) => {
        resizing = opts.parent || null;
        setItem(defaultValue(next));
        edited();
        render();
      })
    );

    if (opts.key !== undefined) {
      row.append(field("je-key", visibleKey(opts.key), (name) => opts.rename(name), "text", "change", t("jsoneditor.key")));
    } else if (opts.index !== undefined) {
      row.append(make("span", "je-index", { textContent: `[${opts.index}]` }));
    }

    if (type === "string") {
      row.append(
        field("je-value", item, (next) => {
          setItem(next);
          edited();
        }, "text", "input", t("jsoneditor.value"))
      );
    } else if (type === "number") {
      row.append(
        field("je-value", item, (next) => {
          const number = Number(next);
          if (next !== "" && Number.isFinite(number)) {
            setItem(number);
            edited();
          }
        }, "number", "input", t("jsoneditor.value"))
      );
    } else if (type === "boolean") {
      const select = make("select", "select je-bool");
      select.add(new Option("true", "true"));
      select.add(new Option("false", "false"));
      select.value = String(item);
      select.addEventListener("change", () => {
        setItem(select.value === "true");
        edited();
      });
      row.append(select);
    }

    if (opts.remove) {
      const actions = make("div", "je-actions");
      for (const [action, name] of [["copy", "files"], ["cut", "scissors"], ["delete", "trash"]]) {
        const button = make("button", `mu-icon-button je-action action-${action}`, { type: "button", title: t(`jsoneditor.action.${action}`) });
        button.append(icon(name));
        if (sameSlot(opts, clipboard && clipboard.source) && clipboard.mode === action) button.classList.add("is-active");
        button.addEventListener("click", () => {
          if (action === "delete") {
            if (sameSlot(opts, clipboard && clipboard.source)) clipboard = null;
            wrapper.classList.add("is-removing");
            resizing = opts.parent;
            setTimeout(opts.remove, reduced() ? 0 : 160);
            return;
          }
          if (sameSlot(opts, clipboard && clipboard.source) && clipboard.mode === action) {
            clipboard = null;
          } else {
            clipboard = { mode: action, value: clone(item), source: { parent: opts.parent, position: opts.position, key: opts.key } };
          }
          render();
        });
        actions.append(button);
      }
      row.append(actions);
    }
    wrapper.append(row);

    if (type === "object") {
      const children = make("div", "je-children");
      Object.entries(item).forEach(([key, child], position) => {
        children.append(
          block(child, (next) => (item[key] = next), {
            key,
            parent: item,
            position,
            rename: (name) => {
              if (!name || name === visibleKey(key) || Object.hasOwn(item, name)) return;
              const entries = Object.entries(item).map(([k, v]) => [k === key ? name : k, v]);
              Object.keys(item).forEach((k) => delete item[k]);
              Object.assign(item, Object.fromEntries(entries));
              edited();
              render();
            },
            remove: () => {
              delete item[key];
              edited();
              render();
            },
          })
        );
      });
      const add = addButton("jsoneditor.add.property", item, (kind) => {
        const key = newDraftKey(item);
        item[key] = defaultValue(kind);
        return { parent: item, key };
      });
      wrapper.append(collection(item, children, add, opts.parent));
    } else if (type === "array") {
      const children = make("div", "je-children");
      item.forEach((child, index) => {
        children.append(
          block(child, (next) => (item[index] = next), {
            index,
            parent: item,
            position: index,
            remove: () => {
              item.splice(index, 1);
              edited();
              render();
            },
          })
        );
      });
      const add = addButton("jsoneditor.add.item", item, (kind) => {
        item.push(defaultValue(kind));
        return { parent: item, position: item.length - 1 };
      });
      wrapper.append(collection(item, children, add, opts.parent));
    }
    return wrapper;
  }

  // The children of an object or array, behind a guide line down their left
  // that folds them: folded, the guide shows what is inside as a row of types.
  function collection(item, children, add) {
    const body = make("div", "je-collection");
    const guide = make("button", "je-guide", { type: "button" });
    const inside = Array.isArray(item) ? item : Object.values(item);
    const summary = make("span", "je-summary");
    inside.slice(0, 12).forEach((child) => {
      const one = valueType(child);
      const mark = badge(one, "je-mini");
      mark.title = typeLabel(one);
      summary.append(mark);
    });
    if (inside.length > 12) summary.append(make("span", "je-rest", { textContent: `+${inside.length - 12}` }));
    guide.append(summary);
    const content = make("div", "je-content");
    content.append(children, add);
    const apply = () => {
      const closed = folded.has(item);
      content.hidden = closed;
      guide.dataset.folded = String(closed);
      guide.title = closed ? t("jsoneditor.unfold", { n: inside.length }) : t("jsoneditor.fold");
    };
    guide.addEventListener("click", () => {
      const owner = body.closest(".je-block");
      const from = owner.getBoundingClientRect().height;
      if (folded.has(item)) {
        folded.delete(item);
        apply();
        animateHeight(owner, from, owner.getBoundingClientRect().height);
        return;
      }
      folded.add(item);
      guide.dataset.folded = "true";
      guide.title = t("jsoneditor.unfold", { n: inside.length });
      content.hidden = true;
      const to = owner.getBoundingClientRect().height;
      content.hidden = false;
      animateHeight(owner, from, to, 140);
      setTimeout(() => {
        content.hidden = true;
      }, reduced() ? 0 : 140);
    });
    apply();
    body.append(guide, content);
    return body;
  }

  // "+ property" opens the menu of types; with something cut or copied it is
  // "paste" instead, into this collection.
  function addButton(labelKey, parent, add) {
    const button = make("button", "je-add", { type: "button" });
    if (clipboard) {
      button.classList.add("is-paste");
      button.append(icon("clipboard-plus"), make("span", "", { textContent: t("jsoneditor.paste") }));
      button.addEventListener("click", () => paste(parent));
      return button;
    }
    button.append(icon("plus-lg"), make("span", "", { textContent: t(labelKey) }));
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      openMenu(button, (kind) => {
        const added = add(kind);
        if (!added) return;
        entering = added;
        resizing = parent;
        edited();
        render();
      });
    });
    return button;
  }

  function render() {
    closeMenu();
    const old = [...root.querySelectorAll(".je-block")].find((one) => one._value === resizing);
    const from = old && old.getBoundingClientRect().height;
    root.replaceChildren(block(value, (next) => (value = next)));
    const now = [...root.querySelectorAll(".je-block")].find((one) => one._value === resizing);
    if (from !== undefined && now) animateHeight(now, from, now.getBoundingClientRect().height);
    drawClipBar();
    root.querySelectorAll(".je-block.is-entering").forEach((one) => {
      if (reduced()) one.classList.remove("is-entering");
      else one.addEventListener("animationend", () => one.classList.remove("is-entering"), { once: true });
    });
    entering = null;
    resizing = null;
  }

  return {
    el,
    // The document changed from outside (typed, pasted, followed): start
    // from its value. What was cut or copied belonged to the old one.
    load(next) {
      value = next;
      clipboard = null;
      dragged = null;
      render();
    },
    setReadonly(flag) {
      readonly = Boolean(flag);
      el.classList.toggle("is-fixed", readonly);
    },
    // Say it all again in the language the shell is in now.
    redraw: render,
    close: closeMenu,
    get readonly() {
      return readonly;
    },
  };
}
