/* view: moved out of core.js (docs/wiki/migration.md). */
import { escapeHtml } from "./pagesettings.js";
import { CONTROLS, ICONS, ITEM_TYPES, formatValue, paramNames, actionStatus, cancelAction, controlActions, getItem, itemProperties, runAction, kindAt, linkOf, portInfo, portIsEntry, portLink, portShare, portSpec, stepsOf, unlinkPort, writable, adaptDescriptor, registerPart, t, describeSpec, ResizeObserver, document, getComputedStyle, requestAnimationFrame, window } from "./deps.js";

// What view says: "change" with { redraw } after a list's view, a control's
// state or a bound write changed, { save } after a card was folded or sized.
let viewChanged = () => {};
let onLayoutEvent = () => {};
export function connectEvents(emit, on) {
  viewChanged = (change) => emit("change", change);
  onLayoutEvent = (event, fn) => on("layout", event, fn);
}

// What view puts into others: its parts of a layout file, and dropping the
// controls' states of items that are gone.
export function registerWithOthers() {
  if (typeof document !== "undefined") {
    // A hint's popup closes when the pointer goes down anywhere outside it.
    document.addEventListener("pointerdown", (event) => {
      if (!hintPopup) return;
      if (event.target.closest(".mu-hint-popup") || event.target.closest(".mu-hint")) return;
      if (event.target.closest(".mu-title-menu") || event.target.closest(".action-menu") || event.target.closest(".mu-card-more")) return;
      closeHint();
    });
  }
  // view: the controls' states of items that are gone.
  onLayoutEvent("pruned", ({ live }) => {
    for (const id of controlStates.keys()) if (!live.has(id)) controlStates.delete(id);
  });
  // view: the cards that are put away, by the key each is drawn under.
  registerPart("folds", {
    save: () => [...foldedLists].slice(0, 2000),
    load(saved) {
      foldedLists.clear();
      for (const key of Array.isArray(saved) ? saved : []) if (typeof key === "string" && key && keyItemsLive(key)) foldedLists.add(key);
    },
  });
  // view: a card's explicit size, keyed by its stable item/property address.
  // Keep both values: false opens cards whose own default is small.
  registerPart("cardSizes", {
    save: () => [...cardSizes].filter(([key]) => keyItemsLive(key)).slice(0, 2000),
    load(saved) {
      cardSizes.clear();
      for (const entry of Array.isArray(saved) ? saved : []) {
        if (!Array.isArray(entry) || typeof entry[0] !== "string" || !entry[0] || typeof entry[1] !== "boolean") continue;
        if (keyItemsLive(entry[0])) cardSizes.set(entry[0], entry[1]);
      }
    },
  });
  // view: what controls keep of their own, per item.
  registerPart("controlStates", {
    save: () => [...controlStates].flatMap(([id, entries]) => [...entries].map(([key, value]) => [id, key, JSON.parse(value)])),
    load(saved) {
      controlStates.clear();
      for (const entry of Array.isArray(saved) ? saved : []) {
        if (!Array.isArray(entry) || entry.length !== 3) continue;
        const [id, key, value] = entry;
        if (typeof id !== "string" || typeof key !== "string" || value === undefined || !getItem(id)) continue;
        if (!controlStates.has(id)) controlStates.set(id, new Map());
        controlStates.get(id).set(key, JSON.stringify(value));
      }
    },
  });
}

// What view asks of others while it is still core.js (registerViewHook):
//   motionMs()                    -- the motion setting, in ms (apps)
//   resizing()                    -- a seam is being dragged (frames)
//   attachPort(card, grip, port)  -- a card's grip carries its port (mount)
//   attachSink(el, sink)          -- an element takes what is dropped on it (mount)
//   paintExpand(el, node, ctx)    -- a card control that fills its window (mount)
//   ready()                       -- a layout has been read, so design problems
//                                    are reported as they come (operations)
//   noDrag(grip, cardOf)          -- a grip that must not start a window drag (mount)
//   stage()                       -- the element the windows are drawn in (frames)
// and what it says (onView): { redraw } after a list's view changed, { save }
// after a card was folded. They become the view module's slots and event.
export const viewHooks = {
  ready: () => true,
  noDrag: () => {},
  stage: () => document.body,
  motionMs: () => 200,
  resizing: () => false,
  attachPort: () => {},
  attachSink: () => {},
  paintExpand: () => {},
};

export function registerViewHook(kind, fn) {
  viewHooks[kind] = fn;
}

// ---- body nodes -------------------------------------------------------
// An item describes its body as a tree of these, and the renderer diffs
// that tree against the DOM. Nodes never hold state: anything mutable is
// bound to a property, so the same props always rebuild the same body.
//
// There are only three kinds: two containers and one leaf.
//
//   section(key, title, children)   titled block
//   props(key, entries | own)       property table
//   control(key, bind | spec)       any control, bound to a property or not
//
// Everything else -- buttons, lists -- is a control, which is
// what lets a plugin add to the vocabulary: node kinds are closed, but the
// control registry is not. The helpers below are sugar over the same node.
// What a body built that the spec does not allow, found as it is built. The
// start-up gate reads them (bodyProblems); one found later is said in the
// console, once.
export const designProblems = [];

// The item type whose body is being built, so a problem can name it.
let buildingType = "";

// mount: which type's body is being built (named in design problems).
export function setBuildingType(type) {
  buildingType = type;
}

// Told when a body breaks the spec while the shell is already running (what a
// start-up check could not reach: an entry that only some data has). Set by
// boot.js to the same page the start-up gate shows.
let designHandler = null;
// mount: who is told about design problems (onDesignProblem).
export function setDesignHandler(handler) {
  designHandler = handler;
}

export const runtimeProblems = [];

export function reportDesign(message) {
  const type = buildingType;
  const found = { source: (type && ITEM_TYPES[type] && ITEM_TYPES[type].source) || "core", kind: "spec", message: type ? `item type "${type}": ${message}` : message };
  runtimeProblems.push(found);
  console.error(`[mullion] ${found.source}: ${found.message}`);
  if (designHandler) designHandler(runtimeProblems.slice());
}

export function designProblem(message) {
  if (designProblems.includes(message)) return;
  designProblems.push(message);
  if (viewHooks.ready()) reportDesign(message);
}

export function sectionToolsProblem(node) {
  if (typeof node?.sectionError === "string") return node.sectionError;
  if (node && (Object.hasOwn(node, "tools") || Object.hasOwn(node, "buttons") || Object.hasOwn(node, "actions"))) {
    return `section "${node.key}" cannot have buttons or tools; put actions on a card or in its body`;
  }
  return "";
}

export function noSectionsIn(kind, key, children) {
  for (const one of (children || []).filter(Boolean)) {
    if (one.kind === "section") {
      const message = `a section ("${one.key}") inside a ${kind} ("${key}"): sections are only the top level of a body`;
      if (!designProblems.includes(message)) {
        designProblems.push(message);
        if (viewHooks.ready()) reportDesign(message);
      }
    }
  }
  return {};
}

// A card's port is an address: {item, key, path?}. Any other name in it is read by
// nobody -- an entry given as `entry:` was the whole list's port, and its card a
// property with its label outside -- so it is said when the card is made.
export function cardPortProblem(key, port) {
  if (port && typeof port === "object") {
    const odd = Object.keys(port).filter((name) => !["item", "key", "path"].includes(name));
    if (odd.length) designProblem(`card "${key}" has a port with ${odd.map((name) => `"${name}"`).join(", ")}: a port is {item, key, path}; an entry of a list is its \`path\``);
  }
  return {};
}

export const NODES = {
  // Sections only group a heading and body. Buttons belong to controls or cards.
  // A fourth argument may supply {empty}; the former tools argument is an error.
  section: (key, title, children, extra = {}, ...legacy) => {
    if (!Array.isArray(extra) && extra?.hint && !title) designProblem(`section "${key}" has a hint but no title to put it beside`);
    const problem = Array.isArray(extra) || legacy.length || sectionToolsProblem({ key, ...extra })
      ? `section "${key}" cannot have buttons or tools; put actions on a card or in its body` : "";
    if (problem) designProblem(problem);
    return {
      kind: "section", ...noSectionsIn("section", key, children), key, title, children,
      ...(problem ? { sectionError: problem } : {}),
      empty: !Array.isArray(extra) && extra?.empty || "",
      hint: !Array.isArray(extra) && extra?.hint || "",
    };
  },
  // A warning for a card's tools: a "!" that opens its explanation.
  warning: (text, key = "warning") => ({ key, icon: "exclamation-triangle", hint: text, active: true }),
  // A section drawn as a card: a header with its title, its buttons and a
  // fold toggle, and the children inside -- for one thing among several
  // (a list, an element of one) that should read as a thing you hold,
  // rather than as a heading over the rest of the window. Cards nest. A
  // tool marked `primary` is the card's main act: it leads the header,
  // in words as well as its icon, the way every card's primary button does.
  //
  // `extra.port` is what the card's grip carries: a property, or one entry
  //   of a list ({item, key, entry}) -- which is also how an entry is put
  //   in order, by the move guide every other entry of its list offers.
  //   Every card has the grip; with no port it is only greyed.
  // `extra.add` is the way to a new entry, inside the card under the rest:
  //   {label, run, accepts?, put?(value, kind)} -- a list's own button, not
  //   one on its header; given `accepts`, a value of one of those kinds
  //   dropped on it is a new entry too. `windows(itemId)` does the same for a
  //   window dragged by its handle: the entries it would make there, as
  //   [{label, put}] (none: no guide).
  // `extra.bar` holds controls in the card's bar (the card bar), under its header: nodes in a line
  //   (the first takes the room that is left), or {start, middle, end}, laid out in thirds with the
  //   middle centred on the bar. A card with more than one bar says `extra.bars`, a list of those:
  //   each is a bar of its own, one row, and no bar takes two rows.
  // `extra.onDiscard` puts the card's close button at the right end of its
  //   header: the same one every card that can be thrown away wears.
  // `extra.icon` is no longer drawn on a `side` card (its face is the name); a header's label has no icon.
  // `extra.isListElement` describes a value card without a port: list
  //   elements put their label in the header; other cards put it outside, in
  //   the card they stand in, as any property's is. A property port determines
  //   this from its actual address instead. Left out, it is read off where the
  //   card stands: a card in a card that is a list (it has `add`, or its port
  //   is a list) is an element; any other is not. Say it only where that is
  //   wrong -- a list held in a card that has neither.
  // `extra.list` says the card is a list even where nothing shows it (no `add`, no list
  //   port): its cards are elements, and while it has none it says so -- its own `empty` if
  //   it has one, else the shell's "nothing in this list yet" -- rather than being its header alone.
  // `extra.empty` is what the card says, inside itself, while it has
  //   nothing in it.
  // `extra.side` runs the header down the card's left side, holding only
  //   the grip and the close button; the icon and the title are the
  //   card's face, and it does not fold -- one entry of a list, held.
  //
  // A card with a title (or a button, a close button, a grip's port) is a
  // thing you hold -- an entry of a list, a list, a property -- and is
  // drawn as one. A card with none of them is only the nesting of what is
  // in it: nothing to look at, so it draws no box, no header and no ground,
  // and its children (and its add button) stand where it stands. Wrapping
  // is therefore free: it never needs "taking out" to keep a form flat.
  card: (key, title, children, tools, extra = {}) => ({
    ...cardPortProblem(key, extra.port),
    kind: "card",
    // A section is a heading over the body of an item: the card's own children
    // are cards and rows. Said when the card is made (see bodyProblems).
    ...noSectionsIn("card", key, children),
    key,
    title,
    children,
    tools,
    bars: cardBarSpecs(extra),
    // Every node in the bars, for what walks the nodes.
    bar: cardBarSpecs(extra).flatMap(barSpecNodes),
    port: extra.port || null,
    add: extra.add || null,
    sink: extra.sink || null,
    onDiscard: extra.onDiscard || null,
    icon: extra.icon || "",
    side: Boolean(extra.side),
    empty: extra.empty || "",
    list: Boolean(extra.list),
    // Made by NODES.listCard: a list is always drawn (header, grip), never only a nesting.
    listCard: Boolean(extra.listCard),
    // Portless value cards can declare what they represent. Unspecified
    // portless cards are ordinary cards, whose title belongs in the header.
    isListElement: typeof extra.isListElement === "boolean" ? extra.isListElement : null,
    // A card that shows what its port holds and takes nothing into it: no paste, link or share.
    readonly: Boolean(extra.readonly),
  }),
  // The one way to make a list: a card holding the list's elements, drawn whatever it carries (a
  // header with the grip -- greyed when it has no port --, the fold, and the add button under the
  // elements). A list is a property, so its name stands outside the box (as a row's label does) and
  // never in the header: `extra.title` where nothing above names it (a list inside an element), left
  // out where the section's title does. `extra` is the card's own (`port`, `add`, `empty`, `bars`,
  // `sink`, `icon`, `readonly`) and `tools` the buttons of its header. (NODES.list is the picker, a
  // list of choices.) A list made with NODES.card (an `add`, `list: true` or a port that holds a
  // list) is said in the console until it is moved here (see noteListCard).
  //   `extra.view` is what the card shows of its list besides the entries (see listViewBars): a search, the
  //   filters and the pages, drawn in its bars -- the card's own, before any `bars` it is given.
  listCard: (key, children, extra = {}) => {
    const { tools = [], title = "", listCard, list, view, ...own } = extra || {};
    const bars = view ? [...listViewBars(key, view), ...cardBarSpecs(own)] : null;
    return NODES.card(key, title, children, tools, { ...own, ...(bars ? { bars, bar: undefined } : {}), list: true, listCard: true });
  },
  // Nodes side by side rather than stacked: a search box and the switch
  // that lays out what it finds belong on one line. The first child takes
  // the room that is left; the rest keep their own width.
  bar: (key, children) => ({ kind: "bar", key, children }),
  // Nodes held at the top of the window, in the item's bar, while the body
  // scrolls under them: for what is wanted at a glance whatever is being
  // read -- the state of a program the item talks to. Anywhere but a window
  // of its own (an item drawn inside another) they are in the body, in place.
  pinned: (key, children) => ({ kind: "pinned", key, children }),
  props: (key, entries) => ({ kind: "props", key, entries }),
  ownProps: (key) => ({ kind: "props", key, own: true }),

  // `bind` names a property; an object names a control and its parameters.
  // Passing both binds the property but draws it with another control --
  // which is how one value can be demonstrated in several of them.
  // `bind` names a property; an object names a control and its parameters,
  // or carries a descriptor the body built itself (`desc`).
  control: (key, bind, extra) =>
    typeof bind === "string"
      ? { kind: "control", key, bind, control: extra && extra.control, params: extra }
      : { kind: "control", key, control: bind.control, desc: bind.desc, params: bind },

  list: (key, entries, selected, bind) => ({
    kind: "control",
    key,
    bind,
    control: "picker",
    params: { entries, selected },
  }),
  // A set of actions as icon tiles or as rows -- see the gallery control.
  gallery: (key, items, layout = "grid") => ({
    kind: "control",
    key,
    control: "gallery",
    params: { items, layout },
  }),
  actions: (key, buttons) => ({
    kind: "control",
    key,
    control: "buttonrow",
    params: { buttons },
  }),
};

// A read-only label/value pair, expressed as a descriptor so it renders
// through the same code as a real editor.
export function row(key, label, value) {
  return { key, label, type: "string", params: {}, value: String(value), readonly: true };
}

// ---- rendering -------------------------------------------------------
// A role ("split") or a Bootstrap icon name ("house") -- both work, and a
// role that has not been registered falls through to being one.
export function iconMarkup(name) {
  return `<i class="bi bi-${escapeHtml(ICONS[name] || name)}" aria-hidden="true"></i>`;
}

export function iconEl(name, className = "mu-icon") {
  const el = document.createElement("i");
  el.className = `${className} bi bi-${ICONS[name] || name}`;
  el.setAttribute("aria-hidden", "true");
  return el;
}

// ---- hints -----------------------------------------------------------
// A "?" beside something, and what it has to say when pressed. One at a
// time, belonging to nothing, gone on the next click anywhere else -- a
// glance, the same gesture
// asked of two different things.
//
// It is a piece of DOM rather than a control so that a control can put one
// inside itself. Where one may stand is narrow, on purpose: in a section's
// title (`NODES.section(key, title, children, { hint })`) or in a value's
// label (a `hint` on its spec) -- never alone, and never in a card's header,
// which holds what is done with the card and not what the section is about.
//
// Fixed, and measured against the button, so it is not clipped by whatever
// the button happens to be inside -- a section that scrolls, a table cell,
// a window narrower than the sentence.
let hintPopup = null;

export function closeHint() {
  if (!hintPopup) return;
  hintPopup.remove();
  hintPopup = null;
}

// Whatever it is, said beside the button that was pressed. Text for a hint,
// a short list of buttons for a bar that has folded its own away -- the
// placing and the one-at-a-time rule are the same either way, so they are
// written once.
export function openPopup(anchor, content, className) {
  const wasFor = hintPopup && hintPopup.__anchor;
  closeHint();
  if (wasFor === anchor) return null;
  const popup = document.createElement("div");
  popup.className = className;
  popup.append(content);
  popup.__anchor = anchor;
  document.body.append(popup);
  // Under the button and aligned to its right, pulled back inside the
  // viewport where that would put it off an edge. Right, because these sit
  // at the right-hand end of the things they belong to.
  const shown = anchor.getClientRects().length
    ? anchor
    : (anchor.closest(".mu-card-head") && anchor.closest(".mu-card-head").querySelector(":scope > .mu-card-more")) || anchor;
  const at = shown.getBoundingClientRect();
  const size = popup.getBoundingClientRect();
  const wanted = className === "mu-title-menu" ? at.right - size.width : at.left;
  const left = Math.max(4, Math.min(wanted, window.innerWidth - size.width - 4));
  const below = at.bottom + 4;
  const top = below + size.height > window.innerHeight - 4 ? Math.max(4, at.top - size.height - 4) : below;
  popup.style.left = `${Math.round(left)}px`;
  popup.style.top = `${Math.round(top)}px`;
  hintPopup = popup;
  return popup;
}

export function openHint(button) {
  const text = button.__hint || "";
  if (!text) {
    closeHint();
    return;
  }
  openPopup(button, document.createTextNode(text), "mu-hint-popup");
}

// The title bar's own buttons, for a window too narrow to wear them. Built
// from the buttons that are there rather than from a second list of what
// they do: pressing one in here presses the real one, so the menu can never
// drift from the bar it stands in for.
export function openTitleMenu(button, frame) {
  const collapsed = frame.classList.contains("is-collapsed");
  const wanted = collapsed
    ? ["action-expand", "action-delete"]
    : ["action-contract", "action-presets", "action-prev-sash", "action-next-sash", "action-pin", "action-collapse", "action-delete"];
  const list = document.createElement("div");
  const bar = frame.querySelector(":scope > .mu-titlebar");
  const reals = wanted
    .flatMap((name) =>
      Array.from(bar.querySelectorAll(`.${name}`)).concat(
        name === "action-expand" ? Array.from(bar.querySelectorAll(".action-expand-toward")) : []
      )
    )
    .filter((real) => !real.hidden)
    .filter((real) => !frame.classList.contains(`no-tool-${TOOL_OF_BUTTON[real.classList[1]]}`));
  for (const real of reals) {
    const name = real.classList[1];
    const entry = document.createElement("button");
    entry.type = "button";
    entry.className = `mu-title-menu-item ${name}-menu`;
    const icon = real.querySelector(".bi");
    entry.append(
      Object.assign(document.createElement("i"), { className: icon ? icon.className : "bi" }),
      Object.assign(document.createElement("span"), { textContent: real.title })
    );
    entry.addEventListener("click", (event) => {
      event.stopPropagation();
      closeHint();
      real.click();
    });
    list.append(entry);
  }
  openPopup(button, list, "mu-title-menu");
}

// A hint button, and the way to tell it what to say. `setHint("")` leaves
// it with nothing to show, so it hides itself rather than opening an empty
// popup when pressed.
// A list, in a card: every control that is a list of things is drawn
// inside one, so a list reads as one thing among the others in a window
// and can be put away. The header has the fold toggle and, for now,
// nothing else. `key` names the list, so it stays folded through redraws
// and rebuilds while the page is open.
//
// The control returns what this returns from render(), and finds its own
// list again as `.__list` in update().
export const foldedLists = new Set();

// Card size is a choice about how the layout is being read, kept beside
// the list cards that are folded. A stored false is meaningful too: some
// cards start small, so opening one has to override that default.
export const cardSizes = new Map();

export const controlStates = new Map();

// A key that names an item that is gone is dropped with it -- item ids are
// spelled `i<number>` wherever a key holds one.
export const keyItemsLive = (key) => (key.match(/(?:^|[^A-Za-z0-9])(i\d+)(?![A-Za-z0-9])/g) || []).every((one) => getItem(one.replace(/^[^i]*/, "")));

export const foldChanged = () => viewChanged({ save: true });

// The icon of a fold button, drawn the same on every card that folds: the
// way out while what it holds is put away, the way in while it is shown.
export const foldIcon = (folded) => `bi bi-${folded ? "arrows-expand" : "arrows-collapse"}`;

export function cardIsShrunk(key, fallback = false) {
  return cardSizes.has(key) ? cardSizes.get(key) : Boolean(fallback);
}

export function hasCardSize(key) {
  return cardSizes.has(key);
}

export function setCardShrunk(key, shrunk) {
  if (typeof key !== "string" || !key) return false;
  const value = Boolean(shrunk);
  if (cardSizes.get(key) === value) return false;
  cardSizes.set(key, value);
  viewChanged({ save: true });
  return true;
}

// A card's content can change its height when it is shrunk. Animate the
// frame from its old height to the new one, respecting the shell's motion
// setting and reduced-motion preference. This also works when the class
// being changed lives on a child of the frame.
export function animateCardResize(frame, change) {
  if (!frame || typeof change !== "function") return;
  const previous = frame.__cardResizeAnimation;
  const wasVisible = frame.isConnected && frame.getClientRects().length > 0;
  const inFlight = previous && wasVisible ? frame.getBoundingClientRect() : null;
  if (previous) {
    previous.onfinish = null;
    previous.oncancel = null;
    previous.cancel();
    frame.style.overflow = frame.__cardResizeOverflow || "";
    delete frame.__cardResizeAnimation;
    delete frame.__cardResizeOverflow;
  }
  const canAnimate =
    wasVisible &&
    !lessMotion() &&
    typeof frame.animate === "function";
  const before = canAnimate ? inFlight || frame.getBoundingClientRect() : null;
  change();
  if (!before) return;
  const after = frame.getBoundingClientRect();
  const height = Math.abs(before.height - after.height) > 0.5;
  const width = Math.abs(before.width - after.width) > 0.5;
  if (!height && !width) return;

  const from = {};
  const to = {};
  if (height) {
    from.height = before.height + "px";
    to.height = after.height + "px";
  }
  if (width) {
    from.width = before.width + "px";
    to.width = after.width + "px";
  }
  frame.__cardResizeOverflow = frame.style.overflow;
  frame.style.overflow = "hidden";
  const animation = frame.animate([from, to], { duration: motionMs(), easing: MOTION_EASE });
  frame.__cardResizeAnimation = animation;
  const settle = () => {
    if (frame.__cardResizeAnimation !== animation) return;
    frame.style.overflow = frame.__cardResizeOverflow || "";
    delete frame.__cardResizeAnimation;
    delete frame.__cardResizeOverflow;
  };
  animation.onfinish = settle;
  animation.oncancel = settle;
  setTimeout(() => {
    if (frame.__cardResizeAnimation !== animation) return;
    try {
      animation.finish();
    } catch {
      settle();
    }
  }, motionMs() + 150);
}

export function setCardSizeClass(frame, shrunk, className = "is-shrunk") {
  if (!frame || !frame.classList) return;
  const value = Boolean(shrunk);
  if (frame.classList.contains(className) === value) return;
  animateCardResize(frame, () => frame.classList.toggle(className, value));
}

// Folding and opening a card's body: the body grows or shrinks to its height
// instead of appearing and vanishing, unless motion is to be kept low.
export function foldBody(body, folded) {
  const was = body.__folded;
  body.__folded = folded;
  if (was === undefined || was === folded || lessMotion() || !body.isConnected) {
    body.hidden = folded;
    return;
  }
  body.getAnimations().forEach((one) => one.cancel());
  const duration = motionMs();
  body.style.overflow = "hidden";
  // Where it ends up, whichever of the animation's finish and the timer
  // below gets there first: a page that is not being drawn (a hidden tab)
  // does not run animations on.
  let settled = false;
  const settle = () => {
    if (settled) return;
    settled = true;
    body.style.overflow = "";
    // Still the way it was going -- it may have been turned round meanwhile.
    if (body.__folded === folded) body.hidden = folded;
  };
  let run;
  if (!folded) {
    body.hidden = false;
    const height = body.scrollHeight;
    run = body.animate([{ height: "0px", opacity: 0 }, { height: `${height}px`, opacity: 1 }], { duration, easing: MOTION_EASE });
  } else {
    const height = body.getBoundingClientRect().height;
    run = body.animate([{ height: `${height}px`, opacity: 1 }, { height: "0px", opacity: 0 }], { duration, easing: MOTION_EASE });
  }
  run.onfinish = settle;
  run.oncancel = () => {
    settled = true;
    body.style.overflow = "";
  };
  setTimeout(() => {
    if (settled) return;
    try {
      run.cancel();
    } catch (error) {
      /* already over */
    }
    settled = false;
    settle();
  }, duration + 150);
}

// Node cards just opened whose cards inside are still folded: their next
// press opens those (see NODE_KINDS.card).
export const openingCards = new Set();

export function listCard(list, { key = "" } = {}) {
  const card = document.createElement("div");
  card.className = "mu-card mu-listcard";
  const head = Object.assign(document.createElement("div"), { className: "mu-card-bar mu-listcard-head" });
  const fold = Object.assign(document.createElement("button"), { type: "button", className: "mu-icon-button mu-listcard-fold" });
  fold.append(Object.assign(document.createElement("i"), { className: "bi" }));
  const body = Object.assign(document.createElement("div"), { className: "mu-listcard-body" });
  body.append(list);
  // The header every card has: the grip at the left (carrying nothing
  // until a control attaches a port to it), the fold -- and whatever else
  // -- at the right. The list's name is its property's, outside it: a
  // label goes inside a card only when the card is one element of a list.
  const grip = Object.assign(document.createElement("button"), { type: "button", className: "mu-icon-button mu-port-grip is-inert" });
  grip.append(Object.assign(document.createElement("i"), { className: "bi bi-grip-vertical" }));
  const gap = Object.assign(document.createElement("span"), { className: "mu-textcard-gap mu-card-gap" });
  head.append(grip, gap, fold);
  card.append(head, body);
  card.__list = list;
  card.__grip = grip;
  fitCardHead(head);
  const paint = () => {
    const folded = card.classList.contains("is-folded");
    fold.firstElementChild.className = foldIcon(folded);
    fold.title = t(folded ? "mu.action.unfoldList" : "mu.action.foldList");
    fold.setAttribute("aria-expanded", String(!folded));
    foldBody(body, folded);
  };
  card.classList.toggle("is-folded", Boolean(key) && foldedLists.has(key));
  fold.addEventListener("click", (event) => {
    event.stopPropagation();
    const folded = !card.classList.contains("is-folded");
    card.classList.toggle("is-folded", folded);
    if (key) folded ? foldedLists.add(key) : foldedLists.delete(key);
    paint();
    foldChanged();
  });
  paint();
  return card;
}

// ---- card headers ---------------------------------------------------------
// One rule for every card's header: on the left the grip and the primary
// button (run, upload, edit -- whatever the card is for), nothing else; on
// the right the rest. When the header is too narrow for all of it, the
// primary button gives up its words first and keeps its icon, and then the
// buttons on the right fold into a menu button of their own.
//
// A control builds its header in that order and hands it here once, and
// again after anything in it changes. Which buttons are which is read off
// the header: `.mu-port-grip` and `.is-primary` stay; every other button
// that is a direct child folds.
export const cardHeads = new WeakSet();

export const pendingHeads = new Set();

// Made the first time a header is watched (the page is handed in by then).
let headWatcher = null;
function headWatcherOf() {
  if (headWatcher === null) headWatcher = typeof ResizeObserver === "function" ? makeHeadWatcher() : false;
  return headWatcher || null;
}
export const headObserver = { observe: (el) => headWatcherOf()?.observe(el) };
const makeHeadWatcher = () =>
  new ResizeObserver((entries) =>
        entries.forEach((one) => {
          // A header is fitted to its width: one that only grew taller, or
          // that has not moved since it was fitted, has nothing to redo.
          if (one.target.__fitWidth === one.target.clientWidth) return;
          queueFit(one.target);
        })
      );

export const foldingTools = (head) =>
  (head.querySelector(":scope > [data-after-card-tool]")
    ? [...head.children].sort((a, b) => Number(a.style.order) - Number(b.style.order))
    : [...head.children])
    .flatMap((one) => (one.classList.contains("mu-nodecard-tools") ? [...one.children] : [one]))
    .filter(
      (one) =>
        one.tagName === "BUTTON" &&
        !one.classList.contains("mu-port-grip") &&
        !one.classList.contains("is-primary") &&
        !one.classList.contains("mu-card-more")
    );

// Coalesced into one pass after the current redraw: a refresh updates every
// card, and each asks. A microtask rather than a frame, so a page that is
// not being painted (a hidden tab) still ends up fitted.
export function queueFit(head) {
  const first = !pendingHeads.size;
  pendingHeads.add(head);
  // While a seam is being dragged the headers are left as they are: every
  // window under it changes width at every step, and fitting each one is far
  // more than the drag can afford. They are fitted once, where it is let go.
  if (first && !viewHooks.resizing()) queueMicrotask(flushFits);
}

export function flushFits() {
  if (viewHooks.resizing()) return;
  const heads = [...pendingHeads];
  pendingHeads.clear();
  fitHeads(heads);
}

// The order a card header's buttons stand in, whatever order a control
// built them in: on the left the grip, then the primary; then any text the
// header carries; the gap; then the rest -- anything without a role of its
// own in the order it came, then copy, open, presets, keep as a preset,
// shrink, and close at the right end -- and the menu button after them.
// Set as flex `order`, not by moving the elements: controls find their
// buttons by position.
export const HEAD_ROLES = [
  ["close", (icon) => /\bbi-x(-lg)?\b/.test(icon)],
  ["shrink", (icon) => /\bbi-arrows-(collapse|expand)\b/.test(icon)],
  ["fill", (icon) => /\bbi-arrows-angle-(expand|contract)\b/.test(icon)],
  ["keep", (_icon, el) => Boolean(el.querySelector(".mu-icon-badge"))],
  ["presets", (icon) => icon.includes(`bi-${ICONS.preset}`)],
  ["open", (icon) => /\bbi-box-arrow-up-right\b/.test(icon)],
  ["copy", (icon) => /\bbi-(copy|clipboard)\b/.test(icon)],
];

export function orderHead(head) {
  [...head.children].forEach((el, index) => {
    let order;
    if (el.classList.contains("mu-port-grip")) order = -30;
    else if (el.classList.contains("is-primary") || el.classList.contains("mu-nodecard-lead")) order = -20;
    else if (el.classList.contains("mu-nodecard-tools")) {
      const anchor = HEAD_ROLES.findIndex(([name]) => name === el.dataset.afterCardTool);
      order = anchor < 0 ? 100 + index : 991 - anchor * 10;
    }
    else if (el.classList.contains("mu-card-more")) order = 1000;
    else if (el.classList.contains("mu-card-gap") || el.classList.contains("workflow-card-gap")) order = 0;
    else if (el.classList.contains("mu-nodecard-icon")) order = -15;
    else if (el.tagName !== "BUTTON") order = -10;
    else {
      const icon = (el.querySelector(".bi:not(.mu-icon-badge)") || {}).className || "";
      const role = HEAD_ROLES.findIndex(([, test]) => test(icon, el));
      // Counted from the right: close is the last of them.
      order = role >= 0 ? 990 - role * 10 : 100 + index;
    }
    if (el.style.order !== String(order)) el.style.order = String(order);
  });
}

// A card header's label, and the icon before it: what the header says.
export const HEAD_LABEL = ":scope > .mu-nodecard-label, :scope > .mu-textcard-label, :scope > .mu-imagecard-label, :scope > .workflow-card-label";

export function headTitle(head) {
  const label = head.querySelector(HEAD_LABEL);
  if (!label || label.hidden || !label.textContent.trim() || !label.getClientRects().length) return null;
  const icon = head.querySelector(":scope > .mu-nodecard-icon");
  return icon && !icon.hidden && icon.getClientRects().length ? [icon, label] : [label];
}

// Centred on the header, the way a window's title is on its bar -- moved
// aside only as far as the buttons on either side need, and cut short only
// when even that is not enough. Done with a left margin on the first of it,
// so nothing in the header changes place in the DOM.
export function centreHeadTitle(head) {
  const one = centreShiftOf(head);
  if (one) one.el.style.marginLeft = `${one.shift}px`;
}

export function centreShiftOf(head) {
  // A property's card has its name outside the box (see NODES.card).
  if (head.parentElement && head.parentElement.classList.contains("is-property")) return null;
  const parts = headTitle(head);
  if (!parts) return null;
  const box = head.getBoundingClientRect();
  const left = parts[0].getBoundingClientRect().left;
  const right = parts[parts.length - 1].getBoundingClientRect().right;
  const width = right - left;
  let lo = box.left;
  let hi = box.right;
  for (const el of head.children) {
    if (parts.includes(el) || el.classList.contains("mu-card-gap") || el.classList.contains("workflow-card-gap")) continue;
    if (!el.getClientRects().length) continue;
    const r = el.getBoundingClientRect();
    if (r.right <= left + 1) lo = Math.max(lo, r.right);
    else if (r.left >= right - 1) hi = Math.min(hi, r.left);
  }
  const start = Math.max(lo + TITLE_GAP, Math.min(box.left + (box.width - width) / 2, hi - TITLE_GAP - width));
  const shift = start - left;
  return shift > 0.5 ? { el: parts[0], shift } : null;
}

// Headers fitted together, a phase at a time -- every write to all of them,
// then every read of all of them -- so that fitting a screenful of cards asks
// the browser for a layout a few times and not a few times per card.
export function fitHeads(all) {
  const heads = all.filter((head) => {
    orderHead(head);
    return head.isConnected && head.clientWidth;
  });
  const over = (head) => head.scrollWidth > head.clientWidth + 1;
  // Measured from where the title sits on its own, not where it was put, and
  // with every label at full size.
  for (const head of heads) {
    head.classList.remove("is-tight", "is-folded");
    head.querySelectorAll(`${HEAD_LABEL}, :scope > .mu-nodecard-icon`).forEach((one) => {
      if (one.style.marginLeft) one.style.marginLeft = "";
    });
    head.classList.add("is-measuring");
  }
  // The primary's words go first, then the tools, and a label is cut to an
  // ellipsis only after both.
  const tight = heads.filter(over);
  for (const head of tight) head.classList.add("is-tight");
  const folded = tight.filter((head) => over(head) && foldingTools(head).some((one) => !one.hidden));
  for (const head of folded) head.classList.add("is-folded");
  for (const head of heads) {
    head.classList.remove("is-measuring");
    // What this header needs on its own: 0 as it is, 1 the primary down to
    // its icon, 2 the rest folded into the menu.
    head.__fit = head.classList.contains("is-folded") ? 2 : head.classList.contains("is-tight") ? 1 : 0;
    head.__fitWidth = head.clientWidth;
  }
  const shifts = heads.map(centreShiftOf);
  for (const one of shifts) if (one) one.el.style.marginLeft = `${one.shift}px`;
  heads.forEach(settleList);
}

// The cards of one list wear one header: when any of them has to give up
// its words, or fold its buttons into the menu, every card of the list
// does, so the grips, the primary buttons and the menus stand in lines
// down the list instead of each card deciding for itself. A list is the
// cards a card holds (NODES.card inside NODES.card); each keeps what it
// needs on its own (`__fit`) and the list shows the most of them.
export function settleList(head) {
  const card = head.parentElement;
  const box = card && card.parentElement;
  if (!box || !card.classList.contains("mu-nodecard")) return;
  const heads = [...box.children]
    .filter((one) => one.classList.contains("mu-nodecard") && !one.classList.contains("is-side") && !one.classList.contains("is-plain"))
    .map((one) => one.firstElementChild)
    .filter((one) => one && one.classList.contains("mu-card-head"));
  const level = heads.reduce((most, one) => Math.max(most, one.__fit || 0), 0);
  for (const one of heads) {
    if (one === head && one.__fit === level) continue;
    const had = [one.classList.contains("is-tight"), one.classList.contains("is-folded")];
    // A menu is only for a card that has something to put in it.
    const fold = level >= 2 && foldingTools(one).some((tool) => !tool.hidden);
    one.classList.toggle("is-tight", level >= 1);
    one.classList.toggle("is-folded", fold);
    // A different set of buttons beside the title: centred again.
    if (had[0] !== (level >= 1) || had[1] !== fold) centreHeadTitle(one);
  }
}

export function fitCardHead(head) {
  if (!head) return;
  if (!cardHeads.has(head)) {
    cardHeads.add(head);
    head.classList.add("mu-card-head");
    // Whatever grip the header has -- built by the control or given here
    // -- says so when held with nothing to carry.
    const own = head.querySelector(":scope > .mu-port-grip");
    if (own) viewHooks.noDrag(own, () => head.parentElement);
    // Every card has a grip: one that did not build its own is given one
    // here -- at the end, where it moves no button a control finds by
    // position; its order puts it first. Until the control says what it
    // carries (attachPort), it is there and does nothing.
    if (!head.querySelector(":scope > .mu-port-grip")) {
      const grip = document.createElement("button");
      grip.type = "button";
      grip.className = "mu-icon-button mu-port-grip is-inert";
      grip.innerHTML = '<i class="bi bi-grip-vertical" aria-hidden="true"></i>';
      head.append(grip);
      viewHooks.noDrag(grip, () => head.parentElement);
    }
    const more = document.createElement("button");
    more.type = "button";
    more.className = "mu-icon-button mu-card-more";
    more.title = t("mu.action.moreButtons");
    more.innerHTML = iconMarkup("menu");
    more.addEventListener("click", (event) => {
      event.stopPropagation();
      // The folded buttons, as a list: each entry presses the real one, so
      // whatever it does stays the control's business.
      const list = document.createElement("div");
      for (const real of foldingTools(head)) {
        if (real.hidden) continue;
        const entry = document.createElement("button");
        entry.type = "button";
        entry.className = "mu-title-menu-item";
        entry.disabled = real.disabled;
        const icon = real.querySelector(".bi");
        entry.append(
          Object.assign(document.createElement("i"), { className: icon ? icon.className : "bi" }),
          Object.assign(document.createElement("span"), { textContent: real.title || real.textContent })
        );
        entry.addEventListener("click", (inner) => {
          inner.stopPropagation();
          closeHint();
          real.click();
        });
        list.append(entry);
      }
      openPopup(more, list, "mu-title-menu");
    });
    head.append(more);
    if (headObserver) headObserver.observe(head);
  } else {
    // Kept last, whatever was appended since.
    const more = head.querySelector(":scope > .mu-card-more");
    if (more && more !== head.lastElementChild) head.append(more);
  }
  queueFit(head);
}

export function hintButton(label = "") {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "mu-icon-button mu-hint";
  button.title = label;
  button.append(Object.assign(document.createElement("i"), { className: "bi bi-question-circle" }));
  button.__hint = "";
  button.setHint = (text, title = button.title) => {
    button.__hint = text || "";
    button.title = title;
    button.hidden = !button.__hint;
    if (!button.__hint && hintPopup && hintPopup.__anchor === button) closeHint();
  };
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    openHint(button);
  });
  return button;
}

// ---- the body renderer ------------------------------------------------
// Nodes are matched to DOM by `key`, so an unchanged control is updated in
// place instead of being replaced. That is what lets a text field keep its
// focus and caret while another window redraws around it.
// What a container says while it holds nothing: put after its children are
// drawn, and taken away by the next draw (it carries no node key).
export function paintEmpty(container, node) {
  const there = container.querySelector(":scope > .mu-empty");
  const nothing = !(node.children || []).filter(Boolean).length;
  if (!nothing || !node.empty) {
    if (there) there.remove();
    return;
  }
  if (there) {
    if (there.textContent !== node.empty) there.textContent = node.empty;
    return;
  }
  container.append(Object.assign(document.createElement("div"), { className: "mu-empty", textContent: node.empty }));
}

export function renderNodes(container, nodes, ctx, parentPath = []) {
  const next = nodes.filter(Boolean);
  const keys = new Set(next.map((node) => String(node.key)));
  const existing = new Map();
  // Drop disappearing nodes before matching positions so a surviving
  // sibling can stay attached, including while one of its fields has focus.
  for (const child of Array.from(container.children)) {
    if (keys.has(child.dataset.nodeKey)) existing.set(child.dataset.nodeKey, child);
    else {
      teardownTree(child);
      child.remove();
    }
  }

  let cursor = container.firstElementChild;

  next.forEach((node) => {
    const key = String(node.key);
    const path = [...parentPath, [node.kind, key]];
    let el = existing.get(key);
    const kind = NODE_KINDS[node.kind];
    // Same key and same kind is not always the same element: a control node
    // keeps its key while switching control, and the DOM one control built
    // is not something another can update.
    if (el && (el.dataset.nodeKind !== node.kind || (kind.matches && !kind.matches(el, node, ctx)))) {
      // Step the cursor past it first: it is about to leave the DOM, and an
      // insertBefore against a detached reference node throws.
      if (el === cursor) cursor = cursor.nextElementSibling;
      teardownTree(el);
      el.remove();
      el = undefined;
    }
    if (el) {
      kind.update(el, node, ctx, path);
    } else {
      el = kind.create(node, ctx, path);
      el.dataset.nodeKey = key;
      el.dataset.nodeKind = node.kind;
    }
    if (el === cursor) cursor = cursor.nextElementSibling;
    else container.insertBefore(el, cursor);
  });
}

// A widget owns its DOM; the host carries which control mounted it so the
// teardown below can find it again.
export function mountWidget(control, desc, ctx, current = () => desc) {
  const host = document.createElement("div");
  host.className = "mu-widget";
  host.dataset.widget = desc.params.control || desc.type;
  control.mount(host, desc, (value) => ctx.onChange(current(), value));
  host.__control = control;
  return host;
}

// Widgets own DOM and listeners, so anything leaving the tree has to be
// told -- including widgets nested inside a section being removed.
export function teardownTree(el) {
  const scopes = [...el.querySelectorAll("[data-control-actions]")];
  if (el.matches("[data-control-actions]")) scopes.push(el);
  for (const host of scopes) controlActions.retire(host.__controlActions);
  const hosts = el.matches("[data-widget]") ? [el] : Array.from(el.querySelectorAll("[data-widget]"));
  hosts.forEach((host) => {
    const control = host.__control || CONTROLS[host.dataset.widget];
    if (control && control.unmount) control.unmount(host);
  });
}

// A property row lives in a display:contents wrapper so the label and the
// control still sit in the parent's two-column grid.
//
// The label cell holds the label and, for a control that has one, an
// accessory beside it: the preset control's way into the chooser sits
// there, next to the name of what it loads, rather than at the far end of
// the value where it read as part of the value.
export function propRow(desc, ctx) {
  const row = document.createElement("div");
  row.className = "mu-prop-row";
  row.dataset.nodeKey = desc.key;
  const dt = document.createElement("dt");
  dt.append(Object.assign(document.createElement("span"), { className: "mu-prop-label" }));
  row.append(dt, document.createElement("dd"));
  updatePropRow(row, desc, ctx);
  return row;
}

export function updatePropRow(row, desc, ctx) {
  paintPropRow(row, desc, ctx);
  paintRowPort(row, desc);
}

// A one-line text field (a control that says it is `linkable`) is a place a
// text can be put -- pasted once, or linked so that it follows -- when it is
// a property that takes text: the row is the port, and while it follows
// something the field cannot be typed into and the label says what it
// follows, with the way to stop. The address is the row's property (`rowPort`
// on a descriptor from a property table, or `rowPort` in a spec the body
// built itself for a property it has).
export function paintRowPort(row, desc) {
  const [dt, dd] = [row.firstElementChild, row.lastElementChild];
  const control = desc.control;
  const address = control && control.linkable && !desc.readonly ? (desc.params && desc.params.rowPort) || desc.rowPort || null : null;
  const found = address && address.item && portSpec(address);
  const linkable = Boolean(found && writable(found) && kindAt(found) === "text");
  row.classList.toggle("mu-port", linkable);
  row.dataset.portItem = linkable ? address.item : "";
  row.dataset.portKey = linkable ? address.key : "";
  row.dataset.portPath = linkable && stepsOf(address.path).length ? JSON.stringify(stepsOf(address.path)) : "";
  syncLinkBadge(dt, linkable ? address : null, true);
  const linked = linkable && Boolean(linkOf(address));
  row.classList.toggle("is-linked", linked);
  const field = dd.querySelector("input");
  if (field && field.readOnly !== linked) field.readOnly = linked;
}

// Whether a port is an entry of a list. A card control that is one names
// itself in its own header, as the entry's card; a card control that is a
// field of a dict (a value with fields), or a property of an item, is a
// labelled slot, and its name stands outside it.
// Whether a card is an element of a list, when it does not say (`isListElement`):
// by where it stands. A card that is a list -- it has `add`, or its port holds
// one -- makes the cards in it elements; a card anywhere else is not one.
export function cardIsList(node) {
  if (!node || node.kind !== "card") return false;
  if (node.add || node.list) return true;
  try {
    const info = node.port && node.port.item ? portInfo(node.port) : null;
    return Boolean(info && info.isList);
  } catch {
    return false;
  }
}

export function markElements(card) {
  const list = cardIsList(card);
  for (const child of card.children || []) {
    if (child && child.kind === "card") child.inList = list;
  }
}

export function cardIsElement(node) {
  return typeof node.isListElement === "boolean" ? node.isListElement : Boolean(node.inList);
}

export function paintPropRow(row, desc, ctx) {
  // A card control (`cardCaption`) decides where its name goes from where it
  // is, not from whoever placed it: in its own header when it is an entry of
  // a list, else (a field of a dict, a property) as the row's label.
  if (desc.control && desc.control.cardCaption && !desc.readonly) {
    const given = desc.params && desc.params.port;
    const inside = portIsEntry(given && typeof given === "object" ? given : desc.rowPort || null);
    row.classList.toggle("is-captioned", inside);
    if (inside) desc = { ...desc, head: desc.label };
  } else {
    row.classList.remove("is-captioned");
  }
  // A control is made once and updated after, and what it was first given is
  // what a change it reports would be written through. The row says which
  // descriptor is the current one: the first one's options (a list that grew
  // since) turned a new choice into the old list's default -- a variable
  // picked in a chain block read back as "none".
  row.__desc = desc;
  const current = () => row.__desc;
  const [dt, dd] = [row.firstElementChild, row.lastElementChild];
  const labelEl = dt.firstElementChild;
  if (labelEl.textContent !== desc.label) labelEl.textContent = desc.label;
  // A value's own hint stands beside its label (see hintButton).
  let hintEl = dt.querySelector(":scope > .mu-hint");
  if (desc.params.hint) {
    if (!hintEl) {
      hintEl = hintButton();
      labelEl.after(hintEl);
    }
    hintEl.setHint(t(desc.params.hint), t("mu.action.hint"));
  } else if (hintEl) {
    hintEl.remove();
  }

  const control = desc.control;
  // A widget claims real estate and is placed deliberately by body(), so in
  // a property table it shows its summary instead of a second copy of itself.
  // A read-only value that says what to do when it is changed (`change`, an action) is still edited here.
  const changes = Boolean(desc.params && typeof desc.params.change === "function");
  const wantsStatic = (Boolean(desc.readonly) && !changes) || !control || Boolean(control.widget);
  const name = wantsStatic ? "static" : (desc.params.control || desc.type);
  const rebuild = row.dataset.control !== name;

  if (rebuild) {
    teardownTree(dd);
    dd.replaceChildren();
    dt.replaceChildren(labelEl, ...dt.querySelectorAll(":scope > .mu-hint"));
    row.dataset.control = name;
    // Told it is in a row, so a control with an accessory draws it here
    // instead of inside itself.
    if (!wantsStatic && control.accessory) dt.append(control.accessory(desc, row));
    if (wantsStatic) {
      const span = document.createElement("span");
      span.className = "mu-prop-static";
      dd.append(span);
    } else if (control.mount) {
      dd.append(mountWidget(control, desc, ctx, current));
      return;
    } else {
      dd.append(control.render({ ...desc, inRow: true }, (value) => ctx.onChange(current(), value)));
      return;
    }
  }

  const el = dd.firstElementChild;
  if (wantsStatic) el.textContent = formatValue(desc);
  else if (control.update) control.update(el, desc);
  else dd.replaceChildren(control.render(desc, (value) => ctx.onChange(current(), value)));
}

// A property row is a label in one half and its value in the other, until
// the value does not fit in a half -- a select as wide as its longest
// option, a vector's two fields, a long label. CSS cannot ask "did this
// fit": a flex item squeezes silently rather than reporting it, and the
// old answer -- letting the value refuse to shrink so the row wrapped --
// let a value take three quarters of a row instead of wrapping.
//
// So it is measured. One pass lifts the caps off every row at once, reads
// what each half wants, puts the caps back, and stacks the rows that asked
// for more than half. Reads and writes are kept apart, and the whole thing
// is coalesced into one animation frame, so a keystroke that redraws six
// windows still measures once.
let fitPending = false;

export function scheduleFitPropRows() {
  if (fitPending) return;
  fitPending = true;
  requestAnimationFrame(() => {
    fitPending = false;
    fitPropRows();
  });
}

export function fitPropRows() {
  const lists = Array.from(viewHooks.stage().querySelectorAll(".mu-props"));
  if (!lists.length) return;

  // Measuring lays every row out on one line for a moment, which makes a
  // body shorter than it really is -- and a body scrolled to its end is
  // clamped to that shorter height by the browser, which is a reader losing
  // their place for a measurement they never asked for. So where each body
  // was scrolled is taken before the rows are flattened and put back after
  // they are decided.
  const scrolled = Array.from(viewHooks.stage().querySelectorAll(".mu-body"))
    .filter((el) => el.scrollTop > 0)
    .map((el) => [el, el.scrollTop]);

  lists.forEach((dl) => dl.classList.add("is-measuring"));
  // Per window, not per row. A row decided on its own left one window with
  // controls at three widths -- a short list of options half the row, a
  // longer one the whole of it -- so the width of a field said something
  // about the longest word in it rather than about the field, and moving a
  // window narrower changed which fields were which. One row that cannot
  // fit stacks every row shown with it, and they are all then the same
  // width: whatever the window has.
  const verdicts = [];
  const stackedIn = new Map();
  const homeOf = (dl) => dl.closest(".mu-item") || dl.closest(".mu-window") || dl;
  lists.forEach((dl) => {
    const rows = [];
    let anyStacked = false;
    Array.from(dl.children).forEach((row) => {
      // Only the rows this file builds: the measuring rules above are
      // written for those, and a plugin is free to put anything else in a
      // property list.
      if (!row.classList.contains("mu-prop-row")) return;
      const dt = row.firstElementChild;
      const dd = row.lastElementChild;
      if (!dt || dt === dd) return;
      // What each side is actually offered: the row less the gap between
      // them, halved -- read from the row rather than assumed, because a
      // skin may set a gap of its own. A half that comes back as nothing
      // means the row is not on screen -- leave it as it is rather than
      // stacking everything in a window that has just been hidden.
      const gap = parseFloat(getComputedStyle(row).columnGap) || 0;
      const half = (row.clientWidth - gap) / 2;
      if (half <= 0) return;
      // The label, and only the label. A value measured at the width it
      // would like made the row's shape a fact about its contents -- a
      // short list of options half a row, a longer one the whole of it --
      // and then stacking them together to make them agree turned a window
      // with one long value into a window of two-line rows. A value lives
      // in its half and says what it can; a label that cannot fit in one
      // has nowhere else to go, and that is what breaks a row.
      if (dt.offsetWidth > half + 0.5) anyStacked = true;
      rows.push(row);
    });
    const home = homeOf(dl);
    if (anyStacked) stackedIn.set(home, true);
    for (const row of rows) verdicts.push([row, home]);
  });
  lists.forEach((dl) => dl.classList.remove("is-measuring"));
  verdicts.forEach(([row, home]) => row.classList.toggle("is-stacked", Boolean(stackedIn.get(home))));
  for (const [el, top] of scrolled) {
    if (el.scrollTop !== top) el.scrollTop = top;
  }
}

// A card's header buttons, kept in step with what body() asked for. The
// primary ones say what they do in words too.
// A tool that says something rather than does something: `{key, hint}`
// on a card's tools is a "?" that opens the hint popup, the
// same as hintButton -- so a heading's explanation sits beside it instead
// of being written into it.
export function wireToolHint(button, spec) {
  button.__hint = spec.hint || "";
  button.classList.toggle("mu-hint", Boolean(spec.hint));
}

export function paintCardTools(holder, buttons, primary) {
  while (holder.children.length > buttons.length) holder.lastElementChild.remove();
  while (holder.children.length < buttons.length) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `mu-icon-button${primary ? " is-primary" : ""}`;
    button.append(Object.assign(document.createElement("i"), { className: "bi" }));
    if (primary) button.append(Object.assign(document.createElement("span"), { className: "mu-button-label" }));
    holder.append(button);
  }
  buttons.forEach((spec, index) => {
    const button = holder.children[index];
    const icon = `bi bi-${ICONS[spec.icon] || spec.icon || (spec.hint ? "question-circle" : "three-dots")}`;
    if (button.firstElementChild.className !== icon) button.firstElementChild.className = icon;
    // A small second icon on the first: "keep as a preset" is the preset
    // icon with a plus, the same button every card that keeps one has.
    let badge = button.querySelector(":scope > .mu-icon-badge");
    if (spec.badge) {
      if (!badge) {
        badge = document.createElement("i");
        button.firstElementChild.after(badge);
      }
      const wanted = `bi bi-${ICONS[spec.badge] || spec.badge} mu-icon-badge`;
      if (badge.className !== wanted) badge.className = wanted;
    } else if (badge) badge.remove();
    if (primary) button.lastElementChild.textContent = spec.label || "";
    button.dataset.toolKey = spec.key || "";
    button.title = spec.title || spec.label || (spec.hint ? t("mu.action.hint") : "");
    button.disabled = Boolean(spec.disabled);
    button.classList.toggle("is-active", Boolean(spec.active));
    wireToolHint(button, spec);
    button.onclick = (event) => {
      event.stopPropagation();
      if (spec.hint) openHint(button);
      else if (spec.run) spec.run(button);
    };
  });
}

// A property's name may be left off only where it is the one thing in its
// section (the section's own title names it). A card placed among others
// with no name of its own is a card nobody can tell the use of: said once, in
// the console, for the section it is in.
export const unnamedWarned = new Set();

// While the start-up gate draws every body off screen (see bodyProblems), what
// this finds is collected there instead of being said one window at a time.
let unnamedSink = null;

// mount: where problems of unnamed cards go while a body is checked.
export function setUnnamedSink(sink) {
  unnamedSink = sink;
}

export function checkCardsNamed(section, node, ctx) {
  const kids = [...section.lastElementChild.children].filter((one) => !one.classList.contains("mu-empty"));
  if (kids.length < 2) return;
  const unnamed = kids.filter((one) => {
    const card = one.classList.contains("mu-control") ? one.firstElementChild : null;
    if (!card || !card.classList.contains("mu-card")) return false;
    return ![...card.querySelectorAll(".mu-card-title")].some((title) => !title.hidden && title.textContent.trim());
  });
  const where = `${(ctx.item && ctx.item.type) || ""}:${node.key}`;
  if (unnamed.length && unnamedSink) {
    unnamedSink.push(`a card among ${kids.length} things in the section "${node.key}" has no name; name it, or put it in a row`);
    return;
  }
  if (unnamed.length && !unnamedWarned.has(where)) {
    unnamedWarned.add(where);
    const found = {
      source: (ctx.item && ITEM_TYPES[ctx.item.type] && ITEM_TYPES[ctx.item.type].source) || "core",
      kind: "spec",
      message: `item type "${(ctx.item && ctx.item.type) || ""}": a card among ${kids.length} things in the section "${node.key}" has no name; name it, or put it in a row`,
    };
    runtimeProblems.push(found);
    console.error(`[mullion] ${found.source}: ${found.message}`);
    if (designHandler) designHandler(runtimeProblems.slice());
  }
}

// The rule of card labels (2026-10-15, user): a name goes in a card's header
// only when the card is an entry of a list. Any other card is named outside it --
// by its section's title, or as a row's label -- and a side-header card is a list
// of things held, its face the name. Read off the declarations: a card node with a
// title, or a control that draws as a card and says its name (`cardName`).
// Off while the cards that break it are put right (62 at the time it was made):
// they are only said in the console. On, a card that breaks it stops start-up like
// every other mistake of the spec.
export const ENFORCE_HEADER_NAMES = true;

export const headerNames = new Set();

// A list is made one way: NODES.listCard (a declaration's `list` control). A card that is a list
// all the same -- it has an `add`, `list: true`, or a port that holds a list -- is a list written
// the other way, and is said here; once the cards that do it are moved it is a mistake of the spec.
export const ENFORCE_LIST_CARD = true;

// The start-up check (bodyProblems) reads what every body builds, and none was left (2026-11-08):
// a list made with NODES.card there stops start-up like any other mistake of the spec. Lists a
// control draws itself are only seen while drawing (noteListCard, said in the console).
export const ENFORCE_LIST_CARD_AT_START = true;

export const listCardWarned = new Set();

export const listCardsFound = new Set();

// The start-up check of the same rule, read off the nodes a body builds: a card that is a list and
// is not an entry of a list (the card around it is not a list, or it says it is not one) was made
// with NODES.card. Only what a body builds is seen here; a control that draws nodes itself says it
// as it draws (noteListCard).
export function listCardProblem(node, parent) {
  if (!node || node.kind !== "card" || node.listCard || node.side || !cardIsList(node)) return "";
  const entry = typeof node.isListElement === "boolean" ? node.isListElement : Boolean(parent && cardIsList(parent));
  return entry ? "" : `card "${node.key}" is a list made with NODES.card; make it with NODES.listCard (a list control in a declaration)`;
}

export function noteListCard(node, ctx) {
  // An entry that holds a list of its own (a bay and its sashes) is an entry first: it wears its name.
  if (!node || node.listCard || node.side || cardIsElement(node) || !cardIsList(node)) return;
  const type = (ctx && ctx.item && ctx.item.type) || "";
  const problem = `card "${node.key}" is a list made with NODES.card; make it with NODES.listCard (a list control in a declaration)`;
  if (ENFORCE_LIST_CARD) designProblem(problem);
  else {
    const said = `${type}:${node.key}`;
    if (listCardWarned.has(said)) return;
    listCardWarned.add(said);
    console.warn(`[mullion] ${type ? `item type "${type}": ` : ""}${problem}`);
  }
}

// A control node may only be handed what its control says it takes (`params`,
// a list of names or a table keyed by them) and what the shell itself reads off
// the node. Anything else is a name nobody reads: a mistyped one, or a caller
// still passing what a control no longer takes (`onFull` once `full` is written
// back through desc.set) -- which would otherwise be dropped without a word.
// On: one found stops start-up like every other mistake of the spec (when it was
// made, the only one was a `presetsTitle` the workflow prompt preview never read).
export const ENFORCE_KNOWN_PARAMS = true;

export const SHELL_NODE_PARAMS = new Set(["control", "desc", "grow", "readonly", "sink", "isListElement", "binds", "states", "slotNodes", "viewNodes", "valueAdapter"]);

export const unknownParams = new Set();

export function unknownParamsProblem(node, control) {
  if (!node || node.kind !== "control" || !control || !node.params) return "";
  const declared = paramNames(control);
  const unknown = Object.keys(node.params).filter((name) => !SHELL_NODE_PARAMS.has(name) && !declared.includes(name));
  if (unknown.length) return `control "${node.key}" (${control.name}) is given ${unknown.map((name) => `"${name}"`).join(", ")}, which it does not take`;
  // Only arguments that declare binding may read from an item property.
  const table = Array.isArray(control.params) ? {} : control.params || {};
  const unbindable = Object.keys(node.params.binds || {}).filter((name) => !table[name] || !["read", "readwrite"].includes(table[name].bind));
  return unbindable.length ? `control "${node.key}" (${control.name}) binds ${unbindable.map((name) => `"${name}"`).join(", ")}, which it does not declare as bindable` : "";
}

// Said where it is found while drawing: a problem of the spec once enforced, a console line until then.
export function noteUnknownParams(node, control, type = "") {
  const problem = unknownParamsProblem(node, control);
  if (!problem) return;
  if (ENFORCE_KNOWN_PARAMS) designProblem(problem);
  else if (!unknownParams.has(problem)) {
    unknownParams.add(problem);
    console.warn(`[mullion] ${type ? `item type "${type}": ` : ""}${problem}`);
  }
}

export function entryAddress(address) {
  try {
    return Boolean(address && typeof address === "object" && address.item && portIsEntry(address));
  } catch {
    return false;
  }
}

export function headerNameProblem(node, ctx) {
  if (!node) return "";
  if (node.kind === "card") {
    // Every card is one or the other (see cardIsElement), and a card that is not draws its name outside.
    return "";
  }
  if (node.kind === "control") {
    let desc;
    try {
      desc = controlDescriptor(node, ctx);
    } catch {
      return "";
    }
    if (desc.conversionError) return "";
    const control = desc.control;
    if (!control || control.mount || typeof control.cardName !== "function") return "";
    // A card's name is its descriptor's label (see `named`): nothing is passed for it, and there is
    // no `caption` to pass.
    if ((node.params && "caption" in node.params) || (desc.params && "caption" in desc.params)) return `control "${node.key}" is given a caption: there is none -- a card is named by its label (the descriptor's), and only an entry of a list wears it in its header`;
    const name = String(control.cardName(desc) || "").trim();
    if (!name || name === "bare") return "";
    if (entryAddress(desc.params && desc.params.port) || (desc.params && desc.params.isListElement === true)) return "";
    return `control "${node.key}" draws a card with "${name}" in its header, but is not an entry of a list: name it in the section's title or the row's label`;
  }
  return "";
}

// A card with no name among others, from what the controls say of themselves
// and not from a drawing: a control that draws as a card (and is not a widget,
// which is exempt) declares `cardName(desc)`, the name it wears -- most take
// their `head` (the label, for an entry of a list) -- and a section holding two or more things, one of them a
// card whose name is empty, is a card nobody can tell the use of. The same
// rule checkCardsNamed finds in the DOM, which is what the declarations are
// checked against.
export function unnamedCardsIn(section, ctx) {
  const kids = (section.children || []).filter(Boolean);
  if (kids.length < 2) return "";
  const unnamed = kids.filter((kid) => {
    if (kid.kind !== "control") return false;
    let desc;
    try {
      desc = controlDescriptor(kid, ctx);
    } catch {
      return false;
    }
    const control = desc.control;
    return Boolean(control && !control.mount && typeof control.cardName === "function" && !String(control.cardName(desc) || "").trim());
  });
  return unnamed.length ? `a card among ${kids.length} things in the section "${section.key}" has no name; name it, or put it in a row` : "";
}

// ---- what a list card shows of its list: a search, filters and pages -----------------------------
// What was asked of a list (the words, what is switched off, the page) belongs to the item and the card,
// not to what the item keeps: it is read when the list is drawn and not saved with the layout.
export const listViews = new Map();

export const listViewKey = (itemId, key) => `${itemId}\n${key}`;

export function listView(itemId, key) {
  const held = listViews.get(listViewKey(itemId, key));
  return { query: held?.query ?? "", off: held?.off ?? {}, page: held?.page ?? 1 };
}

// `patch`: { query?, off?: { filter: [values switched off] }, page? }, put over what is held.
export function setListView(itemId, key, patch) {
  const now = listView(itemId, key);
  listViews.set(listViewKey(itemId, key), {
    query: patch.query ?? now.query,
    off: { ...now.off, ...(patch.off || {}) },
    page: patch.page ?? now.page,
  });
  viewChanged({ redraw: true });
}

// The bars of a list card from its `view`: { query: text | null (no search), placeholder, filters: [{ key, label, icon,
// all: [{ value, label }], off: [values] }], page: { page, pages, total } | null, set(patch) }. A search and the
// filters share the first bar; the pages, when there is more than one, are the second, centred.
export function listViewBars(key, view) {
  const bars = [];
  const line = [];
  if (view.query !== null && view.query !== undefined) {
    line.push(NODES.control(`${key}-query`, {
      desc: describeSpec(
        { type: "string", control: "searchbox", placeholder: view.placeholder || t("mu.list.search"), read: () => view.query, write: (_api, value) => view.set({ query: String(value ?? ""), page: 1 }) },
        { key: `${key}-query`, label: t("mu.list.search") }
      ),
    }));
  }
  for (const filter of view.filters || []) {
    line.push(NODES.control(`${key}-filter-${filter.key}`, {
      control: "popupchecklist",
      icon: filter.icon || "funnel",
      title: filter.label,
      items: filter.all.map((one) => ({ value: one.value, label: one.label, checked: !filter.off.includes(one.value) })),
      onChange: (checked) => view.set({ off: { [filter.key]: filter.all.map((one) => one.value).filter((value) => !checked.includes(value)) }, page: 1 }),
    }));
  }
  if (line.length) bars.push(line);
  if (view.page && view.page.pages > 1) {
    const { page, pages } = view.page;
    const step = (name, icon, to) => NODES.control(`${key}-page-${name}`, { control: "iconbutton", icon, title: t(`mu.list.page.${name}`), disabled: to === page, run: () => view.set({ page: to }) });
    bars.push({
      middle: [
        step("first", "chevron-double-left", 1),
        step("previous", "chevron-left", Math.max(1, page - 1)),
        NODES.control(`${key}-page`, { control: "readout", text: `${page}/${pages}`, title: t("mu.list.page") }),
        step("next", "chevron-right", Math.min(pages, page + 1)),
        step("last", "chevron-double-right", pages),
      ],
    });
  }
  return bars;
}

// A card's bars as `extra` says them: [spec], a spec being nodes in a line or {start, middle, end}.
export function cardBarSpecs(extra) {
  const given = Array.isArray(extra.bars) ? extra.bars : extra.bar ? [extra.bar] : [];
  return given.filter((spec) => spec && (Array.isArray(spec) ? true : typeof spec === "object"));
}

export function barSpecNodes(spec) {
  return (Array.isArray(spec) ? spec : [...(spec.start || []), ...(spec.middle || []), ...(spec.end || [])]).filter(Boolean);
}

// The bar elements of a card, in order: the first is always there (it holds the shell's own
// things too); the rest are made and taken away to match the card's `bars`.
export function cardBarEls(el) {
  return [...el.children].filter((one) => one.classList.contains("mu-action-bar"));
}

export function paintCardBars(el, node, ctx, path) {
  // A row with nothing in it (what it holds is not shown now) is not drawn: the first bar stays, for the shell's own things.
  const specs = (node.bars || []).filter((spec) => barSpecNodes(spec).length);
  const have = cardBarEls(el);
  while (have.length < Math.max(1, specs.length)) {
    const more = Object.assign(document.createElement("div"), { className: "mu-action-bar mu-action-bar-row" });
    have[have.length - 1].after(more);
    have.push(more);
  }
  while (have.length > Math.max(1, specs.length)) {
    const gone = have.pop();
    teardownTree(gone);
    gone.remove();
  }
  have.forEach((bar, i) => {
    const spec = specs[i] || [];
    const thirds = !Array.isArray(spec);
    // One bar is one row, as a line or in thirds; its own children are never both.
    if (bar.classList.contains("is-thirds") !== thirds) {
      Array.from(bar.children).forEach((child) => {
        teardownTree(child);
        child.remove();
      });
      bar.classList.toggle("is-thirds", thirds);
      if (thirds) for (const part of ["start", "middle", "end"]) bar.append(Object.assign(document.createElement("div"), { className: `mu-action-bar-${part}` }));
    }
    if (thirds) ["start", "middle", "end"].forEach((part, j) => renderNodes(bar.children[j], spec[part] || [], ctx, [...path, ["bar", i, part]]));
    else renderNodes(bar, spec, ctx, [...path, ["bar", i]]);
    bar.__filled = barSpecNodes(spec).length > 0;
  });
}

export const NODE_KINDS = {
  pinned: {
    create(node, ctx, path) {
      const el = document.createElement("div");
      el.className = "mu-pinned";
      renderNodes(el, node.children || [], ctx, path);
      return el;
    },
    update(el, node, ctx, path) {
      renderNodes(el, node.children || [], ctx, path);
    },
  },
  bar: {
    create(node, ctx, path) {
      const el = document.createElement("div");
      el.className = "mu-bar";
      NODE_KINDS.bar.update(el, node, ctx, path);
      return el;
    },
    update(el, node, ctx, path) {
      renderNodes(el, node.children || [], ctx, path);
    },
  },
  section: {
    create(node, ctx, path) {
      const el = document.createElement("div");
      el.className = "mu-view-section";
      const title = document.createElement("div");
      title.className = "mu-view-title";
      title.append(Object.assign(document.createElement("span"), { className: "mu-view-label" }), hintButton());
      const body = document.createElement("div");
      body.className = "mu-section-body";
      el.append(title, body);
      NODE_KINDS.section.update(el, node, ctx, path);
      return el;
    },
    update(el, node, ctx, path) {
      const problem = sectionToolsProblem(node);
      if (problem) designProblem(problem);
      const title = el.firstElementChild;
      const label = title.firstElementChild;
      const text = node.title || "";
      if (label.textContent !== text) label.textContent = text;
      title.hidden = !text;
      title.lastElementChild.setHint(node.hint || "", t("mu.action.hint"));
      renderNodes(el.lastElementChild, node.children || [], ctx, path);
      paintEmpty(el.lastElementChild, node);
      checkCardsNamed(el, node, ctx);
    },
  },
  card: {
    create(node, ctx, path) {
      const el = document.createElement("div");
      el.className = "mu-card mu-listcard mu-nodecard";
      // The header is built by the same hand as every other card's (buildCardHead): the grip, then
      // the primary buttons (lead) and the icon, the name, what the card follows (the link badge),
      // the gap, its own tools, the shrink button -- which on a node card folds it -- and close.
      const lead = Object.assign(document.createElement("span"), { className: "mu-nodecard-lead" });
      const glyph = Object.assign(document.createElement("i"), { className: "bi mu-nodecard-icon" });
      glyph.setAttribute("aria-hidden", "true");
      const tools = Object.assign(document.createElement("span"), { className: "mu-nodecard-tools" });
      const parts = buildCardHead("mu-nodecard", { lead: [lead, glyph], tools: [tools], onDiscard: () => el.__discard && el.__discard() });
      const { head, label, size: fold } = parts;
      // The classes the shell's styles know a node card's header by.
      head.className = "mu-card-bar mu-listcard-head mu-nodecard-head";
      label.className = "mu-card-title mu-textcard-label mu-nodecard-label";
      head.querySelector(":scope > .mu-nodecard-gap").className = "mu-textcard-gap mu-card-gap";
      fold.className = "mu-icon-button mu-listcard-fold";
      // A card with cards inside folds in two steps: the cards inside it
      // first, then itself. Opening goes the other way: itself, then the
      // cards inside.
      fold.addEventListener("click", (event) => {
        event.stopPropagation();
        const where = el.__foldKey;
        // A card with nothing in it has nothing to open: it is not one of them.
        const inner = [...el.lastElementChild.querySelectorAll(".mu-nodecard:not(.is-side):not(.is-bare):not(.is-plain)")].filter((one) => one.__foldKey);
        const open = inner.filter((one) => !foldedLists.has(one.__foldKey));
        if (foldedLists.has(where)) {
          foldedLists.delete(where);
          if (inner.length > open.length) openingCards.add(where);
        } else if (openingCards.has(where) && open.length < inner.length) {
          openingCards.delete(where);
          inner.forEach((one) => foldedLists.delete(one.__foldKey));
        } else if (open.length) {
          openingCards.delete(where);
          open.forEach((one) => foldedLists.add(one.__foldKey));
        } else {
          openingCards.delete(where);
          foldedLists.add(where);
        }
        inner.forEach((one) => NODE_KINDS.card.paintFold(one));
        NODE_KINDS.card.paintFold(el);
        foldChanged();
      });
      // Guides for the card as a whole go on its header while the cards
      // inside it offer their own (see startPortMove).
      el.__portHead = head;
      const items = Object.assign(document.createElement("div"), { className: "mu-nodecard-items" });
      const add = Object.assign(document.createElement("button"), { type: "button", className: "mu-add mu-nodecard-add" });
      add.addEventListener("click", (event) => {
        event.stopPropagation();
        // Handed the button, so an add that opens something can anchor it.
        if (el.__add && el.__add.run) el.__add.run(add);
      });
      // The button in a box of its own: what is dropped on it is offered
      // its guide there, and a button cannot hold one.
      const zone = Object.assign(document.createElement("div"), { className: "mu-nodecard-addzone" });
      zone.append(add);
      const body = Object.assign(document.createElement("div"), { className: "mu-listcard-body mu-nodecard-body" });
      // A side-headed card's icon and title, in its body (see extra.side).
      const face = Object.assign(document.createElement("div"), { className: "mu-nodecard-face" });
      face.append(Object.assign(document.createElement("i"), { className: "bi" }), document.createElement("span"));
      body.append(face, items, zone);
      const bar = Object.assign(document.createElement("div"), { className: "mu-action-bar mu-action-bar-row" });
      el.append(head, bar, body);
      NODE_KINDS.card.update(el, node, ctx, path);
      return el;
    },
    paintFold(el) {
      const folded = foldedLists.has(el.__foldKey);
      const head = el.children[0];
      const body = el.querySelector(":scope > .mu-nodecard-body");
      const fold = head.querySelector(".mu-listcard-fold");
      // Open, but its cards still to be opened: the button opens them.
      const opening =
        !folded &&
        openingCards.has(el.__foldKey) &&
        [...body.querySelectorAll(".mu-nodecard:not(.is-side):not(.is-bare):not(.is-plain)")].some((one) => one.__foldKey && foldedLists.has(one.__foldKey));
      el.classList.toggle("is-folded", folded);
      fold.firstElementChild.className = foldIcon(folded || opening);
      fold.title = t(folded || opening ? "mu.action.unfoldList" : "mu.action.foldList");
      fold.setAttribute("aria-expanded", String(!folded));
      foldBody(body, folded);
      for (const one of cardBarEls(el)) one.hidden = folded || !one.__filled;
    },
    update(el, node, ctx, path) {
      const head = el.children[0];
      const body = el.querySelector(":scope > .mu-nodecard-body");
      // Found by what they are, not where they stand in the header.
      const part = (selector) => head.querySelector(`:scope > ${selector}`);
      const [grip, lead, glyph, label, link, tools] = [".mu-port-grip", ".mu-nodecard-lead", ".mu-nodecard-icon", ".mu-nodecard-label", ".mu-port-link", ".mu-nodecard-tools"].map(part);
      const [face, items, zone] = body.children;
      const add = zone.firstElementChild;
      el.__add = node.add || null;
      // A card that takes what is dropped on it (`sink`: {accepts, put, label})
      // draws nothing for it: the label is on the guide that covers it while
      // something is being carried, which is the only time it is wanted.
      if (node.sink) {
        viewHooks.attachSink(el, node.sink);
        el.__cardSink = true;
      } else if (el.__cardSink) {
        el.classList.remove("mu-port-sink");
        el.__sink = null;
        el.__cardSink = false;
      }
      const discard = head.querySelector(".mu-card-discard");
      el.__discard = node.onDiscard || null;
      // A card that is a property (a list as a whole, a form) names itself outside its box, as a row's
      // label is; only an entry of a list, or a card with no property behind it, wears its name in the
      // header.
      const held = node.port ? portSpec(node.port) : null;
      const isProperty = held ? !held.element : !node.side && !cardIsElement(node);
      // The close button means the card itself goes, and only an element of a list has one. What any
      // other card holds is taken out with a primary "delete" button (it lets the value go; it does
      // not remove the card).
      const releasing = Boolean(node.onDiscard) && isProperty && !node.side;
      discard.hidden = !node.onDiscard || releasing;
      discard.title = t("mu.action.discard");
      viewHooks.attachPort(el, grip, node.port || null);
      // What the card follows, on its own badge (the one every card header has).
      const following = node.port ? portLink(node.port) || portShare(node.port) : null;
      syncPortBadge(link, following, following ? () => unlinkPort(node.port) : null);
      if (node.readonly) el.dataset.portReadonly = "1";
      else delete el.dataset.portReadonly;
      grip.title = t("mu.port.grip");
      zone.hidden = !node.add;
      if (node.add && add.textContent !== node.add.label) add.textContent = node.add.label;
      // A window dragged by its handle: asked at the time what it would
      // become here (see showLinkGuides).
      zone.__windowDrop = node.add && node.add.windows ? (id) => (el.__add && el.__add.windows ? el.__add.windows(id) : []) : null;
      if (node.add && node.add.accepts) {
        viewHooks.attachSink(zone, {
          accepts: node.add.accepts,
          label: node.add.label,
          put: (value, kind) => {
            const now = el.__add;
            if (now && now.put) now.put(value, kind);
          },
        });
      } else {
        zone.classList.remove("mu-port-sink");
        zone.__sink = null;
      }
      // Folded by where it is: the item and the card's own key, so a card
      // stays folded through redraws and when its list is reordered.
      el.__foldKey = `card:${(ctx.item && ctx.item.id) || ""}:${node.key}`;
      const text = node.title || "";
      if (label.textContent !== text) label.textContent = text;
      label.hidden = !text;
      // A card's label has no icon: what a card is about is its label's
      // business (and its property's, outside) -- only a side card's face
      // shows one.
      glyph.hidden = true;
      const all = [
        ...(node.tools || []),
        ...(releasing ? [{ key: "release", icon: "trash", label: t("mu.action.delete"), primary: true, run: node.onDiscard }] : []),
      ];
      for (const tool of all) {
        if (tool && tool.hint && !/exclamation/.test(String(tool.icon || ""))) {
          designProblem(`card "${node.key}" has a hint button (${tool.key}); a hint stands in a section's title or a value's label, not in a card's header`);
        }
      }
      paintCardTools(lead, all.filter((one) => one.primary), true);
      paintCardTools(tools, all.filter((one) => !one.primary), false);
      // Nothing to hold by: only the nesting of its children (see NODES.card).
      const plain = !node.side && !node.listCard && !text && !all.length && !node.onDiscard && !node.port;
      noteListCard(node, ctx);
      el.classList.toggle("is-plain", plain);
      el.classList.toggle("is-property", isProperty);
      el.classList.toggle("is-side", node.side);
      // The face is the name alone: a side card shows no icon (its `icon` is not drawn).
      face.hidden = !node.side || !text;
      if (node.side) {
        face.firstElementChild.hidden = true;
        if (face.lastElementChild.textContent !== text) face.lastElementChild.textContent = text;
        // Never folded: there is nothing under its face to put away.
        foldedLists.delete(el.__foldKey);
      }
      // Nor does a card with no header: nothing to press.
      if (plain) foldedLists.delete(el.__foldKey);
      NODE_KINDS.card.paintFold(el);
      // A list with nothing in it says so (its own `empty` if it has one, else the shell's): its
      // body is not taken away, and the person sees an empty list and not a card gone missing.
      const nothing = !(node.children || []).filter(Boolean).length;
      const said = node.empty || (nothing && cardIsList(node) ? t("mu.value.emptyList") : "");
      // A card with nothing in it is its top bar and no more: nothing to fold.
      const bare = nothing && !node.add && !said && !node.bar?.length;
      el.classList.toggle("is-bare", bare);
      head.querySelector(".mu-listcard-fold").hidden = bare;
      // Narrow: the primary down to its icon, then the rest into the menu.
      // A side header holds two buttons and has nothing to fold.
      if (!node.side && !plain) fitCardHead(head);
      paintCardBars(el, node, ctx, path);
      for (const one of cardBarEls(el)) one.hidden = foldedLists.has(el.__foldKey) || !one.__filled;
      markElements(node);
      renderNodes(items, node.children || [], ctx, path);
      // The body's one card can fill the window (see expandOf).
      viewHooks.paintExpand(el, node, ctx);
      // A card that only holds another card is a wrapper -- made to carry what
      // a section could not (its tools). The card inside is the value; its
      // own tools are where they go.
      if (/-content$/.test(String(node.key)) && !node.title && items.children.length === 1 && items.firstElementChild.classList.contains("mu-card")) {
        designProblem(`card "${node.key}" only wraps another card; give the inner card the tools, and drop the wrapper`);
      }
      paintEmpty(items, said === node.empty ? node : { ...node, empty: said });
    },
  },

  props: {
    create(node, ctx) {
      const el = document.createElement("dl");
      el.className = "mu-props";
      NODE_KINDS.props.update(el, node, ctx);
      return el;
    },
    update(el, node, ctx) {
      // `own: true` means "this item's own properties" -- an item never has
      // to reach into core helpers to describe its own editors.
      // `placed: true` means body() puts this property somewhere itself, so
      // the automatic table leaves it out rather than drawing it twice.
      const entries = node.own
        ? itemProperties(ctx.item, ctx.api)
            .filter((desc) => !desc.params.placed)
            .map((desc) => ({ ...desc, rowPort: { item: ctx.item.id, key: desc.key } }))
        : node.entries || [];
      const existing = new Map();
      for (const child of Array.from(el.children)) existing.set(child.dataset.nodeKey, child);

      const kept = new Set();
      let cursor = el.firstElementChild;
      entries.forEach((desc) => {
        let row = existing.get(desc.key);
        if (row) updatePropRow(row, desc, ctx);
        else row = propRow(desc, ctx);
        kept.add(desc.key);
        if (row === cursor) cursor = cursor.nextElementSibling;
        else el.insertBefore(row, cursor);
      });
      existing.forEach((row, key) => {
        if (kept.has(key)) return;
        teardownTree(row);
        row.remove();
      });
    },
  },

  control: {
    matches(el, node, ctx) {
      const desc = controlDescriptor(node, ctx);
      // The key alone is not identity for a placed descriptor: a chooser
      // pointed at another property builds a new one, and reusing the old
      // control's DOM would leave it writing to the property that is gone.
      return (
        el.dataset.controlName === desc.control.name &&
        (el.dataset.descKey || "") === (node.desc ? desc.key : "") &&
        el.__valueAdapter === node.params?.valueAdapter &&
        (!el.__controlActions || el.__controlActionKey === controlActionKey(node)) &&
        (!el.__valueAdapter || (el.__adapterSource === node.bind && Boolean(el.dataset.conversionFailed) === Boolean(desc.conversionError)))
      );
    },
    create(node, ctx, path) {
      let desc = controlDescriptor(node, ctx, path);
      if (!desc.control) throw new Error(`property "${node.bind}" has no control to place`);
      noteUnknownParams(node, desc.control, ctx.item && ctx.item.type);
      const scope = !desc.conversionError && Object.keys(desc.control.declarationActions || {}).length
        ? controlActions.create(ctx) : null;
      if (scope) desc = controlActions.bind(scope, node, desc);
      const el = !desc.conversionError && desc.control.mount
        ? mountWidget(desc.control, desc, ctx)
        : Object.assign(document.createElement("div"), { className: "mu-control" });
      el.__valueAdapter = node.params?.valueAdapter;
      if (el.__valueAdapter) el.__adapterSource = node.bind;
      el.dataset.controlName = desc.control.name;
      if (scope) {
        el.dataset.controlActions = "1";
        el.__controlActions = scope;
        el.__controlActionKey = controlActionKey(node);
      }
      if (node.desc) el.dataset.descKey = desc.key;
      if (desc.conversionError) {
        el.dataset.conversionFailed = "1";
        el.classList.add("mu-empty");
        el.setAttribute("role", "status");
        el.textContent = t("mu.control.conversionReadError", { message: desc.conversionError });
        return el;
      }
      if (!desc.control.mount) {
        el.append(desc.control.render(desc, (value) => ctx.onChange(desc, value)));
      }
      if (scope) scope.live = true;
      // A control that draws nodes inside itself (nestedNodes) draws them in `update`, and its `render`
      // is only the box they go in: without this the control is empty until something else redraws the
      // window, and a window just opened has nothing to do that.
      if (!desc.control.mount && desc.control.nestedNodes && typeof desc.control.update === "function") desc.control.update(el.firstElementChild, desc);
      NODE_KINDS.control.paintSink(el, node);
      el.classList.toggle("is-grow", Boolean(node.params && node.params.grow));
      paintReadonly(el, desc);
      viewHooks.paintExpand(el, node, ctx);
      return el;
    },
    update(el, node, ctx, path) {
      let desc = controlDescriptor(node, ctx, path);
      if (desc.conversionError) {
        const message = t("mu.control.conversionReadError", { message: desc.conversionError });
        if (el.textContent !== message) el.textContent = message;
        return;
      }
      if (el.__controlActions) desc = controlActions.bind(el.__controlActions, node, desc);
      // A mounted control is the host itself; a rendered one sits inside it.
      const target = el.dataset.widget ? el : el.firstElementChild;
      if (desc.control.update) desc.control.update(target, desc);
      NODE_KINDS.control.paintSink(el, node);
      el.classList.toggle("is-grow", Boolean(node.params && node.params.grow));
      paintReadonly(el, desc);
      viewHooks.paintExpand(el, node, ctx);
    },
    // A control placed with a `sink` ({accepts, put, label}) takes what is
    // dropped on it, the way a card's does.
    paintSink(el, node) {
      const sink = node.params && node.params.sink;
      if (sink) {
        viewHooks.attachSink(el, sink);
        el.__nodeSink = true;
      } else if (el.__nodeSink) {
        el.classList.remove("mu-port-sink");
        el.__sink = null;
        el.__nodeSink = false;
      }
    },
  },
};

export function controlActionKey(node) {
  return JSON.stringify([node.bind, node.params?.binds, node.params?.states]);
}

// A control node comes in two shapes. Bound: it names a property, and the
// descriptor is that property's -- so a placed control and the property
// table always show the same value. Standalone: it names a control and
// carries its own parameters, which is how a button exists without a
// property behind it.
export function controlDescriptor(node, ctx, path) {
  let base = controlDescriptorOf(node, ctx);
  if (node.params?.valueAdapter && base.property) {
    base = adaptDescriptor(base, node.params.valueAdapter, (message) => ctx.status?.(t("mu.control.conversionWriteError", { message })));
  }
  const bound = withBinds(named(base), node, ctx);
  const desc = path ? withControlState(bound, node, ctx, path) : bound;
  // Composite controls may place the same keyed nodes as an item body.
  // The renderer retains the item's context and handles updates and teardown.
  return desc.control?.nestedNodes ? {
    ...desc,
    renderNodes: (host, nodes, slot) => renderNodes(host, nodes || [], ctx, slot === undefined ? path : [...(path || []), ["slot", slot]]),
  } : desc;
}

// A stateful argument belongs to the item and the keyed placement of the
// control. A property binding or an explicit constant takes precedence.
export function withControlState(desc, node, ctx, path) {
  const table = desc.control?.params;
  if (!ctx.item || !table || Array.isArray(table)) return desc;
  const id = ctx.item.id;
  const saved = controlStates.get(id);
  const keys = new Map();
  const params = { ...desc.params };
  for (const [arg, spec] of Object.entries(table)) {
    if (arg === "view" && !node.params?.viewNodes?.length) continue;
    const name = Object.hasOwn(node.params?.states || {}, arg) ? node.params.states[arg] : undefined;
    if (spec.state !== true || Object.hasOwn(node.params?.binds || {}, arg) || (name === undefined && Object.hasOwn(params, arg))) continue;
    const key = JSON.stringify([path, desc.control.name, node.bind ?? desc.key, name ?? arg]);
    keys.set(arg, key);
    params[arg] = saved?.has(key) ? JSON.parse(saved.get(key)) : spec.default;
  }
  if (!keys.size) return desc;
  return {
    ...desc, params,
    readControlState(arg) {
      const key = keys.get(arg);
      if (!key) return params[arg];
      const encoded = controlStates.get(id)?.get(key);
      return encoded === undefined ? table[arg].default : JSON.parse(encoded);
    },
    set(arg, value) {
      const key = keys.get(arg);
      if (!key) return desc.set(arg, value);
      if (table[arg].bind !== "readwrite" || getItem(id) !== ctx.item) return false;
      const encoded = JSON.stringify(value);
      const entries = controlStates.get(id) || new Map();
      if (entries.get(key) === encoded) return true;
      if (encoded === undefined) {
        entries.delete(key);
        if (!entries.size) controlStates.delete(id);
      } else {
        entries.set(key, encoded);
        controlStates.set(id, entries);
      }
      viewChanged({ redraw: true });
      return true;
    },
  };
}

// Where a control's own arguments are kept, said as data on its node: `binds: { arg: "property" }`,
// or `{ arg: { field: "property", ... } }` for an argument that is a set of values (a card's display
// options). The arguments are read from those properties, and what the control writes back with
// `desc.set(arg, value)` goes into them -- the same door a declaration's `{ "bind": ... }` is compiled
// to, and the one an item's own body uses, so neither hands a control a function to call back.
// `desc.set` answers whether it kept the value: a control with nothing bound keeps it itself.
export function withBinds(desc, node, ctx) {
  const binds = node && node.params && node.params.binds;
  if (!binds || !ctx || typeof ctx.property !== "function") return { ...desc, set: () => false };
  const read = (key) => {
    try {
      return ctx.property(key).get();
    } catch {
      return undefined;
    }
  };
  const params = { ...desc.params };
  for (const [arg, to] of Object.entries(binds)) {
    params[arg] = typeof to === "string" ? read(to) : Object.fromEntries(Object.entries(to).map(([field, key]) => [field, read(key)]));
  }
  const set = (arg, value) => {
    if (!Object.hasOwn(binds, arg) || desc.control?.params?.[arg]?.bind !== "readwrite") return false;
    const to = binds[arg];
    if (typeof to === "string") {
      ctx.property(to).set(value);
    } else {
      for (const [field, key] of Object.entries(to)) {
        if (value && Object.hasOwn(value, field) && value[field] !== read(key)) ctx.property(key).set(value[field]);
      }
    }
    viewChanged({ redraw: true });
    return true;
  };
  return { ...desc, params, set };
}

// A card control is named by its descriptor's label, in its header, where it is an entry of a list (or
// says it is one): the same rule the property rows apply (paintPropRow), for the cards placed as controls.
export function named(desc) {
  const control = desc.control;
  if (!control || control.mount || typeof control.cardName !== "function" || !desc.label || desc.unlabeled) return desc;
  const params = desc.params || {};
  if (!entryAddress(params.port) && params.isListElement !== true) return desc;
  return desc.head === desc.label ? desc : { ...desc, head: desc.label };
}

// `readonly: true` on a control node (NODES.control(key, bind, { readonly: true })) makes this control
// read-only whatever the property behind it is: the same property can be typed into in one place and only
// shown in another. It cannot make a read-only property writable (`readonly: false` is not read).
// A control that knows what read-only means for it (a text card, a percent) says so itself from
// `desc.readonly`; for every other one the shell does the plain part (paintReadonly below), so that a
// control does not have to be written to be set read-only.
export function controlDescriptorOf(node, ctx) {
  const desc = controlDescriptorBase(node, ctx);
  return node.params && node.params.readonly === true && !desc.readonly ? { ...desc, readonly: true } : desc;
}

export function controlDescriptorBase(node, ctx) {
  // A descriptor the body built itself, placed as a control of its own.
  // What a property row gives such a field is a label column, and a field
  // whose meaning is the screen it is on -- the chooser's group filter --
  // has nothing to put in it. See describe()'s two rules: such a spec has
  // to read live and be keyed by what it points at.
  if (node.desc) {
    const control = node.control ? CONTROLS[node.control] : node.desc.control;
    if (!control) throw new Error(`control "${node.key}" wants unknown control "${node.control}"`);
    return {
      ...node.desc,
      control,
      params: node.params ? { ...node.desc.params, ...node.params } : node.desc.params,
    };
  }

  if (node.bind) {
    const found = itemProperties(ctx.item, ctx.api).find((desc) => desc.key === node.bind);
    if (!found) throw new Error(`control "${node.key}" is bound to unknown property "${node.bind}"`);
    const control = node.control ? CONTROLS[node.control] : found.control;
    if (!control) throw new Error(`control "${node.key}" wants unknown control "${node.control}"`);
    return {
      ...found,
      control,
      // A node may add parameters of its own on top of the property's spec.
      params: node.params ? { ...found.params, ...node.params } : found.params,
    };
  }

  const control = CONTROLS[node.control];
  if (!control) throw new Error(`control "${node.key}" wants unknown control "${node.control}"`);
  return {
    key: node.key,
    label: node.key,
    unlabeled: true,
    control,
    params: node.params || {},
    api: ctx.api,
    item: ctx.item,
    readonly: true,
  };
}

// The plain part of a read-only control, for any control: the text fields in it cannot be typed into
// and the choices cannot be changed, and it wears `is-readonly`. What a control sets itself (a hidden
// upload button, a muted colour) is its own business. Not for a control that stands on its own with no
// property behind it (a button): `unlabeled`, which is read-only by having nothing to write. Nor for one
// that says what to do when it is changed (`change`, an action): the value is only read, and the change
// goes by the action.
export function paintReadonly(el, desc) {
  const on = Boolean(desc.readonly) && !desc.unlabeled && !desc.control.mount && !(desc.params && typeof desc.params.change === "function");
  el.classList.toggle("is-readonly", on);
  // What it holds can still be carried out, but nothing is pasted, linked or shared into it (the guides
  // offer it as refused: see startPortMove).
  for (const port of [el, ...el.querySelectorAll(".mu-port")]) {
    if (on) port.dataset.portReadonly = "1";
    else delete port.dataset.portReadonly;
  }
  const fields = el.querySelectorAll('input:not([type="button"]):not([type="submit"]):not([type="hidden"]):not([type="file"]), textarea, select');
  for (const field of fields) {
    const way = field.tagName === "SELECT" || ["checkbox", "radio", "range", "color"].includes(field.type) ? "disabled" : "readOnly";
    if (on) {
      if (!field[way]) {
        field[way] = true;
        field.__readonlyBy = way;
      }
    } else if (field.__readonlyBy === way) {
      field[way] = false;
      delete field.__readonlyBy;
    }
  }
}

export const TOOL_OF_BUTTON = {
  "action-presets": "presets",
  "action-next-sash": "nextSash",
  "action-prev-sash": "prevSash",
  "action-collapse": "collapse",
  "action-pin": "pin",
  "action-delete": "close",
};

// The title in the middle of the bar -- while it fits there. Centred on the
// bar it ran into the buttons on the right long before the left was full,
// since the id is narrower than the buttons, and then it was cut short with
// room still standing empty on its left. So it is placed between the two
// ends that are really there: centred if it fits, moved left as far as the
// id allows if it does not, and only cut short when even that is not enough.
export const TITLE_GAP = 4; // px kept clear of the id and of the buttons

// ---- motion -----------------------------------------------------------
// Two changes move rather than jump. Folding and opening windows: every
// window's frame grows or shrinks from where it was to where it is now,
// and its title bar slides along with its edge -- but what is inside is
// laid out once, at the new size, and stays put: the frame is a window onto
// it that opens or closes (clip-path), so nothing scrolls or drifts. Switching a bay's
// sash: the bay's windows slide out and the next sash's slide in, along the
// row (sideways) or the column (up and down) the bay stands in.
//
// The layout is rebuilt by every commit, so both are played over the new
// DOM from measurements (or a copy) of the old one. Nothing is played for a
// person who asked for less motion.
export const MOTION_EASE = "linear";

// The shell setting `motionMs`, within its bounds.
export function motionMs() {
  const value = Number(viewHooks.motionMs());
  return Number.isFinite(value) ? Math.max(0, Math.min(2000, value)) : 200;
}

export function lessMotion() {
  if (!motionMs()) return true;
  return Boolean(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
}

// A state, as one row: a lamp, a name, a line of what it is now and, at the
// right end, the way into the detail -- which is a screen of its own, opened
// along the window's path. What a connected program, an app's links and a
// chain's run all say about themselves in an item's bar. `lamp` is one of
// ok / warn / failed / checking / idle.
export function paintStatusRow(host, { name = "", text = "", lamp = "idle", error = false, onMore = null, moreTitle = "" } = {}) {
  if (!host.__status) {
    host.classList.add("mu-statusrow");
    const dot = Object.assign(document.createElement("span"), { className: "mu-statusrow-dot" });
    const label = Object.assign(document.createElement("span"), { className: "mu-statusrow-name" });
    const line = Object.assign(document.createElement("span"), { className: "mu-statusrow-text" });
    const more = Object.assign(document.createElement("button"), { type: "button", className: "mu-icon-button mu-statusrow-more" });
    more.append(Object.assign(document.createElement("i"), { className: "bi bi-chevron-right" }));
    more.addEventListener("click", (event) => {
      event.stopPropagation();
      if (host.__status.onMore) host.__status.onMore();
    });
    host.append(dot, label, line, more);
    host.__status = { dot, label, line, more, onMore: null };
  }
  const parts = host.__status;
  parts.onMore = onMore;
  parts.dot.dataset.state = lamp;
  if (parts.label.textContent !== name) parts.label.textContent = name;
  if (parts.line.textContent !== text) parts.line.textContent = text;
  parts.line.classList.toggle("is-error", Boolean(error));
  parts.more.hidden = !onMore;
  parts.more.title = moreTitle;
  return host;
}

// What a card follows, said on its header with the way to stop -- for every
// card, whatever control drew it. A control that draws its own badge (a
// text card, an image card) is left to it: the one this adds is marked
// `data-auto` and goes when the control has its own.
export function syncLinkBadge(head, port, row = false) {
  // Only on a card's own header: a vertical one, or one that is not a
  // header at all, says what it follows its own way. (A property row's label
  // is the exception, and says so.)
  if (!head || (!row && !head.matches(".mu-card-head, .mu-listcard-head, .mu-nodecard-head, .workflow-card-head"))) return;
  const own = head.querySelector(":scope > .mu-port-link:not([data-auto])");
  let auto = head.querySelector(":scope > .mu-port-link[data-auto]");
  const following = port && !own ? portLink(port) || portShare(port) : null;
  if (!following) {
    if (auto) auto.remove();
    return;
  }
  if (!auto) {
    auto = makePortBadge();
    auto.dataset.auto = "1";
    // At the end, not beside the grip: some headers are read by the place
    // of their children (NODES.card's), and the one that looks after their
    // order (orderHead) puts a badge where a label goes anyway.
    head.append(auto);
  }
  syncPortBadge(auto, following, () => unlinkPort(port));
}

// The one badge for a value that follows another (a link) or is held in common with it (a share), on
// every card and row that can be either -- the shell's own and a plugin's alike, so they cannot come
// out different. It says only which ("linked", "shared"); pressed, it opens what it follows with the
// way to stop, so a long name never takes the room of the buttons beside it. A span, not a button:
// the buttons of a header are folded away by what they are, and this is not one of its tools.
// The header every card has -- a prompt, a picture, a voice -- built in one
// place, so a card of a new kind cannot come out different: the grip that
// carries it, what it says, what it follows (and the way to stop), then the
// card's own tools, shrink, and remove. `prefix` is the card's class prefix
// (mu-textcard, mu-imagecard): its CSS names the head, the label and the
// gap. `lead` goes before the label (the primary action), `tools` after the
// gap, in the order given.
export function buildCardHead(prefix, { lead = [], tools = [], onDiscard = null, grip: withGrip = true } = {}) {
  const make = (tag, className, props = {}) => Object.assign(document.createElement(tag), { className, ...props });
  const button = (className, iconName) => {
    const one = make("button", `mu-icon-button ${className}`, { type: "button" });
    one.append(make("i", `bi bi-${ICONS[iconName] || iconName}`));
    return one;
  };
  const head = make("div", `${prefix}-head mu-card-bar`);
  // A card inside another that is not carried on its own has no grip.
  const grip = withGrip ? button("mu-port-grip", "grip-vertical") : null;
  const label = make("span", `${prefix}-label mu-card-title`);
  const link = makePortBadge();
  const gap = make("span", `${prefix}-gap mu-card-gap`);
  const size = button(`${prefix}-size`, "arrows-collapse");
  const discard = button("mu-card-discard", "close");
  discard.addEventListener("click", (event) => {
    event.stopPropagation();
    if (onDiscard) onDiscard();
  });
  head.append(...(grip ? [grip] : []), ...lead, label, link, gap, ...tools, size, discard);
  return { head, grip, label, link, size, discard, button };
}

export function makePortBadge() {
  const badge = document.createElement("span");
  badge.className = "mu-port-link";
  badge.hidden = true;
  badge.setAttribute("role", "button");
  badge.tabIndex = 0;
  badge.append(
    Object.assign(document.createElement("i"), { className: "bi bi-link-45deg" }),
    Object.assign(document.createElement("span"), { className: "mu-port-link-name" })
  );
  badge.addEventListener("click", (event) => {
    event.stopPropagation();
    openPortDetail(badge);
  });
  badge.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    event.stopPropagation();
    openPortDetail(badge);
  });
  return badge;
}

// What the badge says now: `following` is {label, share} (or null: hidden), `unlink` the way to stop
// (or null: it is shown but cannot be stopped from here).
export function syncPortBadge(badge, following, unlink = null) {
  badge.hidden = !following;
  badge.__following = following || null;
  badge.__unlink = unlink;
  if (!following) {
    if (hintPopup && hintPopup.__anchor === badge) closeHint();
    return;
  }
  const [glyph, word] = badge.children;
  const icon = following.share ? "bi bi-share" : "bi bi-link-45deg";
  if (glyph.className !== icon) glyph.className = icon;
  const text = t(following.share ? "mu.port.badgeShare" : "mu.port.badgeLink");
  if (word.textContent !== text) word.textContent = text;
  badge.title = t(following.share ? "mu.port.sharing" : "mu.port.following", { name: following.label });
  badge.classList.toggle("is-share", Boolean(following.share));
}

export function openPortDetail(badge) {
  const following = badge.__following;
  if (!following) return;
  const content = document.createElement("div");
  content.className = "mu-port-detail";
  content.append(Object.assign(document.createElement("span"), { className: "mu-port-detail-text", textContent: badge.title }));
  if (badge.__unlink) {
    const release = document.createElement("button");
    release.type = "button";
    release.className = "mu-port-release";
    release.title = t(following.share ? "mu.port.unshare" : "mu.port.unlink");
    release.append(
      Object.assign(document.createElement("i"), { className: `bi bi-${ICONS.close || "x-lg"}` }),
      Object.assign(document.createElement("span"), { textContent: t("mu.port.release") })
    );
    release.addEventListener("click", (event) => {
      event.stopPropagation();
      closeHint();
      badge.__unlink();
    });
    content.append(release);
  }
  openPopup(badge, content, "mu-hint-popup mu-port-popup");
}

// A guide over a port or a pick target: an icon and a name on a button.
export function portGuide(name, icon, label = "") {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `mu-port-guide guide-${name}`;
  button.append(
    Object.assign(document.createElement("i"), { className: `bi bi-${icon}` }),
    Object.assign(document.createElement("span"), { textContent: label || t(`mu.port.${name}`) })
  );
  return button;
}

// A stylesheet on the page, once by its address (a plugin's styles, shell/plugins).
export function addStylesheet(href) {
  if (document.querySelector(`link[data-plugin-style="${href}"]`)) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = href;
  link.dataset.pluginStyle = href;
  document.head.append(link);
}

// The page read again (after a profile or a plugin change).
export function reloadPage() {
  window.location.reload();
}

// A bare element of the page, for a control that draws its own nodes into it.
export function element(tag, className = "") {
  const el = document.createElement(tag);
  if (className) el.className = className;
  return el;
}
