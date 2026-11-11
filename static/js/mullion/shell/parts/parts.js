/* parts: the small pieces of a screen only the core makes (docs/auto-layout-proposal.md 7.2) --
 * button, iconbutton, icontoggle, select, segments, textbox, numberbox, stepper, slider, checkbox, statusrow, badges. Controls and declarations are built from them; a plugin
 * never makes its own. Each is a control in the registry under its own name.
 * The building blocks the bigger controls share with them (setValue,
 * diffChildren, ...) are handed out too; controls depends on parts, not the
 * other way. Split out of controls.js (2026-11-11). */
import { ICONS, document, window, languages, TEXT_LANGUAGES, optionsOf, appSettingValue, attachPort, explainer, closeHint, listCard, openPopup, paintStatusRow, t, registerControl } from "./deps.js";

// Never fight the person typing into a control.
export function setValue(el, value) {
  if (!el || document.activeElement === el) return;
  if (el.value !== String(value)) el.value = value;
}

// ---- badges that explain themselves ----------------------------------------------------------
// What explains the elements of a list (mount's explainer for the type of its elements), given an element,
// answering a text (or multilingual text) or nothing.
function explainerOf(desc) {
  const each = desc.property.params && desc.property.params.each;
  return each ? explainer(each.type) : null;
}

// What a badge says, as a popup under it: its name, then the text in the reader's language, with the
// other language one press away when there is one.
function openExplanation(anchor, title, found) {
  const content = document.createElement("div");
  content.className = "mu-explain";
  const value = typeof found === "string" ? { [appSettingValue("language") === "ja" ? "ja" : "en"]: found } : found;
  const have = TEXT_LANGUAGES.filter((lang) => value && typeof value[lang] === "string" && value[lang]);
  if (!have.length) return;
  let lang = have.includes(appSettingValue("language")) ? appSettingValue("language") : have[0];
  const labels = Object.fromEntries(languages().map((one) => [one.value, one.label]));
  const paint = () => {
    const head = Object.assign(document.createElement("div"), { className: "mu-explain-head" });
    head.append(Object.assign(document.createElement("strong"), { textContent: title }));
    if (have.length > 1) {
      const segments = Object.assign(document.createElement("div"), { className: "mu-segments" });
      for (const one of have) {
        const button = Object.assign(document.createElement("button"), { type: "button", className: `mu-segment${one === lang ? " is-active" : ""}` });
        button.append(Object.assign(document.createElement("span"), { className: "mu-segment-label", textContent: labels[one] || one }));
        button.addEventListener("click", (event) => {
          event.stopPropagation();
          lang = one;
          paint();
        });
        segments.append(button);
      }
      head.append(segments);
    }
    content.replaceChildren(head, Object.assign(document.createElement("div"), { className: "mu-explain-text", textContent: value[lang] }));
  };
  paint();
  openPopup(anchor, content, "mu-hint-popup mu-explain-popup");
}

// The badge being dragged from one list of badges to another: where it comes from, and which it is.
let BADGE_DRAG = null;

// What a list says while it has nothing in it (hidden while it has).
export function emptyGuide() {
  return Object.assign(document.createElement("div"), { className: "mu-empty", textContent: t("mu.value.emptyList"), hidden: true });
}

export function stepperButton(glyph, titleKey, run) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "mu-stepper-btn";
  button.tabIndex = -1; // the field is the tab stop; the buttons are the mouse's
  button.textContent = glyph;
  button.title = t(titleKey);
  button.addEventListener("mousedown", (event) => event.preventDefault());
  button.addEventListener("click", run);
  return button;
}

function textInput(type, className) {
  return {
    render(desc, onChange) {
      const input = document.createElement("input");
      input.type = type;
      input.className = className;
      if (desc.params.placeholder) input.placeholder = t(desc.params.placeholder);
      if (desc.params.min !== undefined) input.min = desc.params.min;
      if (desc.params.max !== undefined) input.max = desc.params.max;
      if (desc.params.step !== undefined) input.step = desc.params.step;
      input.value = desc.value ?? "";
      input.addEventListener("input", () => onChange(input.value));
      return input;
    },
    update(el, desc) {
      if (desc.params.placeholder) {
        const placeholder = t(desc.params.placeholder);
        if (el.placeholder !== placeholder) el.placeholder = placeholder;
      }
      setValue(el, desc.value ?? "");
    },
  };
}

export function applyButton(el, spec) {
  if (el.textContent !== spec.label) el.textContent = spec.label;
  el.disabled = Boolean(spec.disabled);
  // Which button it is, for whoever points at it (see pickControl in core).
  el.dataset.toolKey = spec.key || "";
  el.title = spec.title || "";
  // Replaced rather than added: body() hands over a fresh closure each pass.
  el.onclick = (event) => {
    event.stopPropagation();
    if (spec.confirm) askFirst(el, spec);
    else spec.run(el);
  };
}

// A button that asks before it acts (`confirm: {message, title?, okText?, danger?}`): a popup under the
// button with what is about to happen, and a way out. Only a press on the OK button runs it; a press outside
// the popup, or on Cancel, lets it go. The same for every button that does something that cannot be undone --
// restart, quit, a reset to the defaults -- so they ask the same way.
function askFirst(anchor, spec) {
  const ask = spec.confirm;
  const content = document.createElement("div");
  content.className = "mu-confirm";
  if (ask.title) content.append(Object.assign(document.createElement("div"), { className: "mu-confirm-title", textContent: ask.title }));
  content.append(Object.assign(document.createElement("div"), { className: "mu-confirm-message", textContent: ask.message || "" }));
  const actions = Object.assign(document.createElement("div"), { className: "mu-confirm-actions" });
  const cancel = Object.assign(document.createElement("button"), { type: "button", className: "mu-item-button", textContent: ask.cancelText || t("mu.ask.cancel") });
  const ok = Object.assign(document.createElement("button"), {
    type: "button",
    className: `mu-item-button mu-confirm-ok${ask.danger ? " is-danger" : ""}`,
    textContent: ask.okText || t("mu.ask.ok"),
  });
  cancel.addEventListener("click", (event) => {
    event.stopPropagation();
    closeHint();
  });
  ok.addEventListener("click", (event) => {
    event.stopPropagation();
    closeHint();
    spec.run(anchor);
  });
  actions.append(cancel, ok);
  content.append(actions);
  const popup = openPopup(anchor, content, "mu-hint-popup mu-confirm-popup");
  // Asking again on the same button is letting go of the question (openPopup toggles); a new one starts at "no".
  if (popup) cancel.focus();
}

export function diffChildren(parent, entries, keyOf, handlers) {
  const existing = new Map();
  for (const child of Array.from(parent.children)) existing.set(child.dataset.nodeKey, child);

  const kept = new Set();
  let cursor = parent.firstElementChild;
  entries.forEach((entry, index) => {
    const key = String(keyOf(entry, index));
    let el = existing.get(key);
    if (!el) {
      el = handlers.create(entry);
      el.dataset.nodeKey = key;
    }
    handlers.update(el, entry);
    kept.add(key);
    if (el === cursor) cursor = cursor.nextElementSibling;
    else parent.insertBefore(el, cursor);
  });
  existing.forEach((el, key) => {
    if (!kept.has(key)) el.remove();
  });
}

// Why a library control is offering nothing. Both cases are a mistake in
// the item type rather than anything the reader did, so they name the
// drawer: whoever wrote the property is the one who can fix it.
function fillOptions(select, desc) {
  // A property that knows its own domain answers for it; anything else --
  // a plain list of options handed in by a control -- goes through optionsOf.
  const options =
    desc.property && desc.property.options
      ? desc.property.options()
      : optionsOf(desc.params, desc.api);
  const same =
    select.options.length === options.length &&
    options.every(
      (option, i) =>
        select.options[i].value === String(option.value) &&
        select.options[i].textContent === option.label
    );
  if (same) return;
  select.replaceChildren();
  options.forEach((option) => {
    const el = document.createElement("option");
    el.value = option.value;
    el.textContent = option.label;
    select.append(el);
  });
}

const PARTS = {
  // ---- controls with no property behind them ---------------------------
  // A standalone control takes its configuration from the node that placed
  // it rather than from a property spec. `run` is a function, so it lives
  // on the node -- transient, and never part of a saved layout.
  button: {
    label: "mu.control.button",
    standalone: true,
    params: ["label", "title", "run"],
    // What to show it with when there is nothing real to bind -- the
    // control catalog renders this to demonstrate the control itself.
    sampleParams: { label: "Button", title: "", run: () => {} },
    render(desc) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "mu-item-button";
      applyButton(button, desc.params);
      return button;
    },
    update(el, desc) {
      applyButton(el, desc.params);
    },
  },
  // One button that is only its icon -- at the end of a bar, say, where a
  // word would crowd out what the bar is for. `title` says what it does.
  iconbutton: {
    label: "mu.control.iconbutton",
    standalone: true,
    params: ["icon", "title", "run", "disabled"],
    sampleParams: { icon: "gear", title: "Settings", run: () => {} },
    render(desc) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "mu-icon-button";
      button.append(document.createElement("i"));
      PARTS.iconbutton.update(button, desc);
      return button;
    },
    update(button, desc) {
      const p = desc.params;
      const icon = `bi bi-${ICONS[p.icon] || p.icon}`;
      if (button.firstElementChild.className !== icon) button.firstElementChild.className = icon;
      button.title = p.title || "";
      button.setAttribute("aria-label", p.title || "");
      button.disabled = Boolean(p.disabled);
      button.onclick = (event) => {
        event.stopPropagation();
        p.run(button);
      };
    },
  },
  // ---- property editors -------------------------------------------------
  textbox: {
    label: "mu.control.textbox",
    needs: ["setText"],
    // `change`: what is done when it is changed (given { value }), for a value that is read and not written here;
    // `port`: where the value stands when it is an element's field (the shell gives it).
    params: { change: { type: "action", payload: { value: "string" } }, port: { type: "data" } },
    // Typing writes at once; the windows are drawn again after a pause (see
    // onChange in core): a keystroke must not wait for every window.
    deferRefresh: 250,
    // A text that follows another (a text composer's result, say) is put in a
    // one-line field by the grip: its row is a port (see paintRowPort).
    linkable: true,
    ...textInput("text", "input mu-prop-input"),
  },
  numberbox: {
    label: "mu.control.numberbox",
    needs: ["setNumber"],
    // `change`: what is done when it is changed (given { value }), for a value that is read and not written here;
    // `port`: where the value stands when it is an element's field (the shell gives it).
    params: { step: { type: "number" }, change: { type: "action", payload: { value: "number" } }, port: { type: "data" } },
    // Typing writes at once and the windows are drawn after a pause, as for
    // the text box: a digit must not wait for every window.
    deferRefresh: 250,
    ...textInput("number", "input mu-prop-input"),
  },
  // A number field with its own -/+ buttons either side. The property does
  // the clamping -- `set` coerces, so a step past min or max simply lands on
  // it -- which is why this asks for nothing but setNumber and works with
  // any numeric property, bounded or not.
  stepper: {
    label: "mu.control.stepper",
    needs: ["setNumber"],
    params: ["step"],
    // A press or a digit writes the property at once; the windows are drawn
    // after a pause (see onChange in core), so a run of presses is not a run
    // of redraws of every window.
    deferRefresh: 250,
    render(desc, onChange) {
      const wrap = document.createElement("div");
      wrap.className = "mu-stepper";

      const input = document.createElement("input");
      input.type = "number";
      input.className = "input mu-stepper-input";
      if (desc.params.min !== undefined) input.min = desc.params.min;
      if (desc.params.max !== undefined) input.max = desc.params.max;

      // The current value is read off the field rather than off the desc
      // captured here: update() keeps the field right, and a click may come
      // many refreshes after the render.
      const bump = (direction) => {
        const step = Number(wrap.dataset.step) || 1;
        const from = Number(input.value) || 0;
        // Steps land on multiples of the step rather than drifting from
        // wherever a typed value happened to be.
        const next = Math.round((from + direction * step) / step) * step;
        // Floating point: 0.1 + 0.2 must read back as 0.3, not 0.30000000004.
        onChange(Number(next.toPrecision(12)));
        // update() will not touch a focused field -- that is what protects
        // the caret while typing -- so a press has to write the field back
        // itself, or the next press would step from stale text. Read from
        // the property rather than from `next`, so a clamp shows.
        input.value = desc.property.get();
      };

      wrap.append(
        stepperButton("\u2212", "mu.action.stepDown", () => bump(-1)),
        input,
        stepperButton("+", "mu.action.stepUp", () => bump(1))
      );
      input.addEventListener("input", () => onChange(input.value));
      PARTS.stepper.update(wrap, desc);
      return wrap;
    },
    update(el, desc) {
      el.dataset.step = String(desc.params.step ?? 1);
      const input = el.querySelector(".mu-stepper-input");
      input.step = desc.params.step ?? "any";
      setValue(input, desc.value ?? 0);
    },
  },
  slider: {
    label: "mu.control.slider",
    // A slider is meaningless without both ends, so it asks for them by
    // method and refuses a property that cannot answer.
    needs: ["setNumber", "min", "max"],
    params: {
      step: { type: "number" },
    },
    render(desc, onChange) {
      const wrap = document.createElement("div");
      wrap.className = "mu-prop-inline";
      const input = document.createElement("input");
      input.type = "range";
      input.className = "mu-prop-range";
      input.min = desc.property.min() ?? 0;
      input.max = desc.property.max() ?? 1;
      input.step = desc.params.step ?? 0.01;
      input.value = desc.value;
      const readout = document.createElement("span");
      readout.className = "mu-prop-readout";
      readout.textContent = desc.property.format();
      input.addEventListener("input", () => {
        onChange(Number(input.value));
        readout.textContent = desc.property.format();
      });
      wrap.append(input, readout);
      return wrap;
    },
    update(el, desc) {
      setValue(el.querySelector("input"), desc.value);
      el.querySelector(".mu-prop-readout").textContent = desc.property.format();
    },
  },
  checkbox: {
    label: "mu.control.checkbox",
    needs: ["toggle"],
    // `change`: what is done when it is switched (given { value }), for a value that is read and not written here.
    // (`port`: a value that is an element of a list is carried by its address; a checkbox has nothing to carry it by.)
    params: { change: { type: "action", payload: { value: "boolean" } }, port: { type: "data" } },
    render(desc, onChange) {
      const input = document.createElement("input");
      input.type = "checkbox";
      input.className = "mu-prop-check";
      input.checked = Boolean(desc.value);
      input.addEventListener("change", () => {
        if (desc.params && typeof desc.params.change === "function") desc.params.change({ value: input.checked });
        else onChange(input.checked);
      });
      return input;
    },
    update(el, desc) {
      if (el.checked !== Boolean(desc.value)) el.checked = Boolean(desc.value);
    },
  },
  // A boolean as one pressable icon: on it is filled and pressed, off it is
  // the outline. For a switch that belongs beside the thing it acts on
  // rather than in a table of its own -- re-rolling a seed sits next to the
  // seed, and a row saying "new seed every run" underneath the number said
  // the same thing twice as far apart as it could be put.
  icontoggle: {
    label: "mu.control.icontoggle",
    needs: ["toggle"],
    // `icon` is the look when it is off, `onIcon` when it is on -- the same
    // shape filled, usually. One icon for both is fine: pressed says it.
    params: ["icon", "onIcon", "title", "onTitle"],
    sampleParams: { icon: "dice-5", onIcon: "dice-5-fill" },
    render(desc, onChange) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "mu-item-button mu-icontoggle";
      button.append(Object.assign(document.createElement("i"), { className: "bi" }));
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        onChange(!button.classList.contains("is-active"));
      });
      PARTS.icontoggle.update(button, desc);
      return button;
    },
    update(el, desc) {
      const on = Boolean(desc.value);
      const name = (on && desc.params.onIcon) || desc.params.icon || "toggle-on";
      const icon = `bi bi-${ICONS[name] || name}`;
      if (el.firstElementChild.className !== icon) el.firstElementChild.className = icon;
      const title = t((on && desc.params.onTitle) || desc.params.title || desc.label || "");
      if (el.title !== title) el.title = title;
      el.classList.toggle("is-active", on);
      el.setAttribute("aria-pressed", String(on));
    },
  },
  select: {
    label: "mu.control.select",
    needs: ["options"],
    // `change`: what is done when it is changed (given { value }), for a value that is read and not written here;
    // `port`: where the value stands when it is an element's field (the shell gives it).
    params: { change: { type: "action", payload: { value: "string" } }, port: { type: "data" } },
    render(desc, onChange) {
      const select = document.createElement("select");
      select.className = "select mu-prop-select";
      fillOptions(select, desc);
      select.value = desc.value;
      select.addEventListener("change", () => onChange(select.value));
      return select;
    },
    update(el, desc) {
      fillOptions(el, desc);
      setValue(el, desc.value);
    },
  },
  // A choice laid out as buttons rather than folded into a dropdown: every
  // option visible, the chosen one filled. Matched by method, so it works
  // with any value type that can list its options and take a write.
  segments: {
    label: "mu.control.segments",
    needs: ["set", "options"],
    // Which buttons say what they are, in words:
    //   "selected" -- only the chosen one (the rest are their icon alone)
    //   "all"      -- every one of them
    //   "none"     -- none, provided they all have an icon
    params: ["labels"],
    render(desc, onChange) {
      const el = document.createElement("div");
      el.className = "mu-segments";
      el.__onChange = onChange;
      PARTS.segments.update(el, desc);
      return el;
    },
    update(el, desc) {
      const labels = desc.params.labels || "selected";
      diffChildren(el, desc.property.options(), (option) => option.value, {
        create: () => {
          const button = document.createElement("button");
          button.type = "button";
          button.className = "mu-segment";
          button.append(
            Object.assign(document.createElement("i"), { className: "bi" }),
            Object.assign(document.createElement("span"), { className: "mu-segment-label" })
          );
          button.addEventListener("click", (event) => {
            event.stopPropagation();
            el.__onChange(button.dataset.nodeKey);
          });
          return button;
        },
        update: (button, option) => {
          const chosen = String(option.value) === String(desc.value);
          const icon = option.icon ? `bi bi-${ICONS[option.icon] || option.icon}` : "bi";
          if (button.firstElementChild.className !== icon) {
            button.firstElementChild.className = icon;
          }
          button.firstElementChild.hidden = !option.icon;

          const label = button.lastElementChild;
          if (label.textContent !== option.label) label.textContent = option.label;
          // Without an icon there is nothing to shrink to, so the word stays
          // whatever `labels` says.
          const worded = !option.icon || labels === "all" || (labels === "selected" && chosen);
          label.hidden = !worded;

          button.classList.toggle("is-active", chosen);
          button.setAttribute("aria-pressed", String(chosen));
          button.title = option.label;
        },
      });
    },
  },
  // A state as one row (see paintStatusRow in core): what a connected
  // program, an app's links or a chain's run says about itself, with the way
  // into its detail at the right end. Placed with NODES.pinned, it sits in the
  // item's bar.
  statusrow: {
    label: "mu.control.statusrow",
    standalone: true,
    params: ["name", "text", "lamp", "error", "onMore", "moreTitle"],
    sampleParams: { name: "ComfyUI", text: "Ready", lamp: "ok" },
    render(desc) {
      const host = document.createElement("div");
      paintStatusRow(host, desc.params);
      return host;
    },
    update(host, desc) {
      paintStatusRow(host, desc.params);
    },
  },
  // Any list, read only, as a card of badges: one badge for each element, said the way the
  // element's type says it (its `format`). A list of tags is its words; anything whose
  // format is short reads the same. The card is a list's: the grip carries the whole list
  // (the control's own property, or the `port` it is given), and it folds. Editing is
  // `rows`' and `cardgrid`'s.
  badges: {
    label: "mu.control.badges",
    needs: ["items"],
    requiresParams: ["each"],
    // `bare`: only the badges, for a card that already is one (an element of a list). `moveKey` + `onMove`: a badge
    // can be dragged to another list of badges that has a `moveKey` too -- `onMove(index, fromKey, toKey)` is told
    // where it was dropped, by the one it was dropped on (the card the badges are in is the place to drop).
    params: ["port", "bare", "moveKey", "onMove"],
    render(desc) {
      const list = document.createElement("div");
      list.className = "mu-badges";
      if (desc.params.bare) {
        list.__list = list;
        PARTS.badges.update(list, desc);
        return list;
      }
      const guide = emptyGuide();
      const wrap = listCard(list, { key: `badges:${desc.key || ""}` });
      wrap.classList.add("mu-badgecard");
      list.after(guide);
      PARTS.badges.update(wrap, desc);
      return wrap;
    },
    update(wrap, desc) {
      const items = desc.property.items();
      const item = desc.property.item;
      const bare = Boolean(desc.params.bare);
      if (!bare) {
        attachPort(wrap, wrap.__grip, desc.params.port || (item ? { item: item.id, key: desc.property.key } : null));
        wrap.__grip.title = t("mu.port.grip");
      }
      const list = wrap.__list;
      const said = items.map((_, index) => desc.property.element(index).format());
      // Redrawn only when what it says changed: a badge is not typed into, so there is nothing
      // to keep alive between draws.
      const sig = JSON.stringify(said);
      if (list.__sig !== sig) {
        list.__sig = sig;
        list.replaceChildren(...said.map((text) => Object.assign(document.createElement("span"), { className: "mu-badge", textContent: text, title: text })));
      }
      // A badge whose element has an explanation (a helper "explain:<element type>", from whoever knows
      // what the element is) opens it on a press: what it says, in the reader's language.
      list.__desc = desc;
      const explain = explainerOf(desc);
      const elements = items;
      [...list.children].forEach((badge, index) => {
        // Only a badge that has something to say can be pressed.
        const has = Boolean(explain && explain(elements[index]));
        badge.classList.toggle("is-explained", has);
        badge.onclick = has
          ? (event) => {
              event.stopPropagation();
              const found = explain(list.__desc.property.items()[index]);
              if (found) openExplanation(badge, said[index], found);
            }
          : null;
      });
      // Dragging a badge to another list: this list takes what is dropped on the card it is in.
      list.__moving = desc.params.moveKey ? { key: desc.params.moveKey, onMove: desc.params.onMove } : null;
      list.classList.toggle("is-movable", Boolean(list.__moving));
      [...list.children].forEach((badge) => {
        badge.draggable = Boolean(list.__moving);
        if (badge.__dragWired) return;
        badge.__dragWired = true;
        badge.addEventListener("dragstart", (event) => {
          if (!list.__moving) return;
          BADGE_DRAG = { key: list.__moving.key, index: [...list.children].indexOf(badge) };
          badge.classList.add("is-dragging");
          if (event.dataTransfer) {
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData("text/plain", badge.textContent);
          }
        });
        badge.addEventListener("dragend", () => {
          BADGE_DRAG = null;
          badge.classList.remove("is-dragging");
          document.querySelectorAll(".mu-badge-drop.is-over").forEach((one) => one.classList.remove("is-over"));
        });
      });
      const zone = list.closest(".mu-nodecard") || list;
      zone.__badgeList = list;
      if (!zone.__dropWired) {
        zone.__dropWired = true;
        zone.classList.add("mu-badge-drop");
        zone.addEventListener("dragover", (event) => {
          const mine = zone.__badgeList.__moving;
          if (!BADGE_DRAG || !mine || BADGE_DRAG.key === mine.key) return;
          event.preventDefault();
          if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
          zone.classList.add("is-over");
        });
        zone.addEventListener("dragleave", (event) => {
          if (!zone.contains(event.relatedTarget)) zone.classList.remove("is-over");
        });
        zone.addEventListener("drop", (event) => {
          const mine = zone.__badgeList.__moving;
          if (!BADGE_DRAG || !mine || BADGE_DRAG.key === mine.key) return;
          event.preventDefault();
          zone.classList.remove("is-over");
          const from = BADGE_DRAG;
          BADGE_DRAG = null;
          if (mine.onMove) mine.onMove(from.index, from.key, mine.key);
        });
      }
      if (bare) return;
      list.nextElementSibling.hidden = items.length > 0;
      list.hidden = items.length === 0;
    },
  },
};

export function install() {
  for (const [name, def] of Object.entries(PARTS)) registerControl(name, def);
}
