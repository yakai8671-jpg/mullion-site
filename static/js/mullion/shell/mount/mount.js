/* mount: moved out of core.js (docs/wiki/migration.md). */
import { APPS, CONTROLS, DEFAULT_ITEM_TYPE, ENFORCE_HEADER_NAMES, ENFORCE_KNOWN_PARAMS, ENFORCE_LIST_CARD_AT_START, ICONS, ITEM_TYPES, NODES, ROOT_ID, VALUE_TYPES, WINDOW_SETTINGS_TYPE, allItems, appDef, appItemOf, appOfWindow, applyTint, bayAxisOf, bindProperty, canLink, canMove, canShare, captureOperation, controlDescriptor, createItem, currentItemId, derivesFrom, designProblem, designProblems, dropItemsSince, eachGroup, eachLeaf, findLeaf, focusedWindow, getItem, grantApi, groupLabel, headerNameProblem, headerNames, iconEl, isSlotLeaf, isStandalone, isTyping, itemLabel, itemsMark, kindAt, layoutRoot, linkPort, linksOf, listCardProblem, listCardsFound, movePort, named, newWindowId, noteControl, openScreen, operationsReady, orderHead, outerAppFrame, paintExpanded, paintStatusRow, pastePort, portGuide, portLabel, portSpec, portValue, readAddress, readPort, refreshAppChrome, registerFramesHook, registerOperationsHook, registerPickersHook, registerViewHook, renderNodes, resolveHotkeyAddress, routeBetween, routeFor, row, runAction, samePort, scheduleFitPropRows, scheduleSave, sectionToolsProblem, setBuildingType, setDesignHandler, setExpanded, setUnnamedSink, sharePort, splitWindow, stageEl, stepsOf, syncLinkBadge, syncLinks, t, teardownTree, tintOf, truncatePath, unknownParams, unknownParamsProblem, unnamedCardsIn, valueTypeFor, windowEl, writable, Element, HTMLVideoElement, document, getComputedStyle, requestAnimationFrame, window } from "./deps.js";
import { writeValue } from "./deps.js";

// What mount hears of others: their events, through the bridge (setup).
let on = () => () => {};
export function connectEvents(emit, listen) {
  on = listen;
}

function paintExpand(el, node, ctx) {
  const card = el.matches(".mu-card") ? el : el.querySelector(".mu-card");
  const head = card && card.querySelector(":scope > .mu-card-bar");
  let button = head && head.querySelector(":scope > .mu-card-expand");
  if (ctx.expandKey === null || ctx.expandKey !== node.key || !head || !ctx.root.contains(el.isConnected ? el : ctx.root)) {
    if (button) button.remove();
    return;
  }
  if (!button) {
    button = document.createElement("button");
    button.type = "button";
    button.className = "mu-icon-button mu-card-expand";
    button.append(iconEl("expandCard"));
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      setExpanded(ctx.windowId, true);
    });
    head.append(button);
    orderHead(head);
  }
  button.title = t("mu.action.expandCard");
}

const takesNativeDrop = (target) =>
  target instanceof Element &&
  Boolean(target.closest("input, textarea, [contenteditable='true']")) &&
  !target.closest(".mu-port-guides");
const nativeDropRefused = (target) =>
  target instanceof Element && (Boolean(target.closest(".is-port-source")) || takesNativeDrop(target));

// mount's listeners on the page, and what it puts into other modules. Called
// once, by core.js as it loads (where these statements were).
function wireMount() {
  // mount: an action that changed something is drawn.
  on("items", "change", () => refreshAll());
  // mount: a deferred redraw is dropped before an undo or redo, and every item
  // is taken down just before the tree is replaced.
  on("layout", "restore", ({ phase }) => {
    if (phase !== "before") return;
    clearTimeout(deferredTimer);
    deferredSince = 0;
  });
  on("layout", "restore", ({ phase }) => phase === "swap" && unmountAllItems()); // mount
  registerFramesHook("mount", (windowId, body) => mountItem(windowId, body));
  registerFramesHook("unmount", (windowId) => unmountItem(windowId));
  registerFramesHook("detach", (keep) => detachBodies(keep));
  registerFramesHook("attach", (root, kept) => attachBodies(root, kept));
  registerFramesHook("refresh", (bodies = false) => refreshItems({ bodies }));
  registerFramesHook("settle", (reused, wide) => settleBodies(reused, wide));
  registerFramesHook("layoutMoved", (only, wide) => refreshLayoutReaders(only, wide));
  registerFramesHook("windowChanged", (windowId, all) => {
    const ctx = mountedItems.get(windowId);
    if (ctx && (all || readsLayout(ctx))) refreshItem(windowId);
  });
  registerFramesHook("redrawAll", () => refreshAll());
  registerFramesHook("expandKey", (windowId) => mountedItems.get(windowId)?.expandKey || null);
  registerFramesHook("presetOpener", (itemId) => presetOpeners.get(itemId) || null);
  registerFramesHook("ask", (el, kind, message, options) => askNear(el, kind, message, options));
  registerFramesHook("takeOut", (root) => {
    const leaving = [];
    root.querySelectorAll('[data-role="body"]').forEach((body) => {
      const host = body.closest(".mu-window");
      const ctx = host && mountedItems.get(host.dataset.id);
      if (!ctx) return;
      mountedItems.delete(host.dataset.id);
      leaving.push(ctx);
    });
    return () => leaving.forEach(letGoBody);
  });
  registerFramesHook("keys", (windowId, event, combo, modified) => itemKeys(windowId, event, combo, modified));
  // mount: what changed through a port is drawn.
  on("ports", "change", () => refreshAll());
  registerViewHook("noDrag", (grip, cardOf) => wireNoDrag(grip, cardOf));
  // mount: a card's grip carries its port; an element takes what is dropped on
  // it; a card control fills its window; a list's changed view is drawn.
  registerViewHook("attachPort", (card, grip, port) => attachPort(card, grip, port));
  registerViewHook("attachSink", (el, sink) => attachSink(el, sink));
  registerViewHook("paintExpand", (el, node, ctx) => paintExpand(el, node, ctx));
  on("view", "change", (change) => change.redraw && refreshAll());

  // mount: a changed bay is drawn.
  on("bays", "change", (change) => change.touched && refreshItems());

  // mount: what an app change touched is drawn.
  on("apps", "change", (change) => {
    if (change.redraw === "all") refreshAll();
    else if (change.redraw === "items") refreshItems();
  });
  document.addEventListener(
    "dragover",
    (event) => {
      if (!portDrag || !nativeDropRefused(event.target)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "none";
    },
    true
  );
  document.addEventListener(
    "drop",
    (event) => {
      if (!portDrag || !nativeDropRefused(event.target)) return;
      event.preventDefault();
      event.stopPropagation();
    },
    true
  );

  // ports: a port move under way ends before an undo or redo.
  on("layout", "restore", ({ phase }) => phase === "before" && endPortMove());
  registerOperationsHook("halted", () => halted);
  registerOperationsHook("deferring", () => Boolean(deferringMs || deferredSince));
  // mount: the history changed: the History items are drawn again.
  on("operations", "change", (change) => {
    if (change.history) for (const [id, ctx] of mountedItems) if (ctx.item.type === "history") refreshItem(id);
  });
  // mount: Home's groups changed: every window is drawn again.
  on("home", "change", () => refreshAll());
  registerPickersHook("surface", (itemId) => appSurface(itemId));
  registerPickersHook("hasPresets", (itemId) => presetOpeners.has(itemId));
  on("hotkeys", "change", () => refreshItems());
}

const LAYOUT_READERS = ["window:read", "layout:read", "bays:read", "hotkeys:read"];
// (`layout:place` is no reader: it is how an app puts a window of its own on
// screen, and every workflow app has it.)
const SCREEN_READERS = [...LAYOUT_READERS, "apps:read"];

function readsLayout(ctx, wide = false) {
  const wanted = wide ? SCREEN_READERS : LAYOUT_READERS;
  return ctx.item.type === WINDOW_SETTINGS_TYPE || (ctx.def.permissions || []).some((one) => wanted.includes(one));
}

function refreshLayoutReaders(only = null, wide = false) {
  for (const [windowId, ctx] of mountedItems) {
    if ((!only || only.has(windowId)) && readsLayout(ctx, wide)) refreshItem(windowId);
  }
}

function surfaceKindOf(spec) {
  const def = valueTypeFor(spec) || {};
  if (derivesFrom(spec.type, "boolean")) return "boolean";
  if (derivesFrom(spec.type, "number")) return "number";
  if (derivesFrom(spec.type, "image")) return "image";
  if (derivesFrom(spec.type, "string") || derivesFrom(spec.type, "enum")) return "text";
  return typeof def.port === "string" ? def.port : "";
}

// The ctx an item's body is drawn with when no window shows it.
function headlessCtx(item, def) {
  const element = document.createElement("div");
  const ctx = {
    windowId: null,
    item,
    def,
    trailKey: "",
    sig: sigOf(item),
    element,
    root: element,
    api: grantApi(def, { windowId: null, itemId: item.id }),
    refresh: () => {},
    refreshAll: () => refreshAll(),
    status: () => {},
    progress: () => {},
    // Nobody to ask: no window shows this.
    confirm: () => Promise.resolve(false),
    prompt: () => Promise.resolve(null),
    property: (key) => bindProperty(item, key, ctx.api),
    get: (key) => bindProperty(item, key, ctx.api).get(),
    set: (key, value) => {
      bindProperty(item, key, ctx.api).set(value);
      refreshAll();
    },
    onChange: (desc, value) => {
      writeOf(desc, value);
      refreshAll();
    },
  };
  return ctx;
}

// What a control's edit does: the property is written, or -- for a control told what to do when it is
// changed (`change`, an action: a value that is only read, such as a field of an element of a read-only
// list) -- the action is run with { value }.
function writeOf(desc, value) {
  if (desc.params && typeof desc.params.change === "function") desc.params.change({ value });
  else desc.property.set(value);
}

function controlSlotNodes(node) {
  const slots = node.params?.slotNodes;
  const views = node.params?.viewNodes;
  return [...(slots?.body || []), ...(slots?.bars || []).flat(), ...(views || []).flatMap((view) => view.layout || [])];
}

function surfaceButtons(nodes, found = new Map()) {
  const add = (node, one, extra = {}) => {
    if (!one || typeof one.run !== "function") return;
    const label = one.label || one.title || "";
    const key = `${node.key}:${one.key}`;
    if (found.has(key)) return;
    found.set(key, {
      key,
      label,
      primary: Boolean(one.primary || extra.primary),
      disabled: Boolean(one.disabled),
      // Where it is drawn: the node it belongs to and its own key there.
      node: node.key,
      tool: one.key,
      run: one.run,
    });
  };
  for (const node of nodes || []) {
    if (!node) continue;
    // A tool that takes the button it was pressed from opens something there
    // (a preset chooser): not a thing to press from somewhere else.
    for (const tool of (node.kind === "section" ? [] : node.tools || [])) if (typeof tool.run === "function" && tool.run.length === 0) add(node, tool);
    if (node.kind === "card" && node.add) add(node, { key: "add", label: node.add.label, run: node.add.run });
    if (node.kind === "control") {
      const params = node.params || {};
      if (node.control === "buttonrow") for (const button of params.buttons || []) add(node, button);
      const slots = params.slotNodes;
      if (slots) {
        for (const button of [...(slots.lead || []), ...(slots.tools || [])]) add(node, button);
        surfaceButtons([...(slots.body || []), ...(slots.bars || []).flat()], found);
      }
      if (params.emptyAction) add(node, { key: "empty", ...params.emptyAction }, { primary: true });
      // The hooks a control is given by convention: run is its main act, and
      // `runLabel` is what the control calls that button (a generator says
      // "Generate"): the name here is the name on the button.
      if (typeof params.onRun === "function") add(node, { key: "run", label: params.runLabel || params.runTitle || t("mu.action.run"), run: params.onRun }, { primary: true });
      if (typeof params.onClear === "function") add(node, { key: "clear", label: params.clearLabel || t("mu.action.clear"), run: params.onClear });
    }
    if (node.children) surfaceButtons(node.children, found);
  }
  return found;
}

function appSurface(itemId) {
  const item = getItem(itemId);
  const def = item && ITEM_TYPES[item.type];
  if (!def) return null;
  // Drawn where it is shown, when it is: the same ctx its buttons were made with.
  let ctx = null;
  for (const mounted of mountedItems.values()) {
    if (mounted.item.id === itemId) ctx = mounted;
  }
  if (!ctx) ctx = headlessCtx(item, def);
  const extra = typeof def.appSurface === "function" ? def.appSurface(ctx.api, item, ctx) || {} : {};
  const buttons = new Map();
  const inputs = [];
  const outputs = [];
  for (const one of extra.buttons || []) buttons.set(one.key, one);
  if (!extra.exclusive) {
    try {
      for (const [key, one] of surfaceButtons(def.body(ctx.api, item, ctx))) if (!buttons.has(key)) buttons.set(key, one);
    } catch (error) {
      console.warn(`[mullion] the surface of ${item.type} could not be read:`, error);
    }
    // A type that draws several properties as one control says which control
    // is which: `surfaceNodes` (or a function of the item) by property key.
    const nodes = (typeof def.surfaceNodes === "function" ? def.surfaceNodes(item) : def.surfaceNodes) || {};
    for (const [key, spec] of Object.entries(def.properties || {})) {
      if (!spec || spec.link || derivesFrom(spec.type, "ref")) continue;
      const kind = surfaceKindOf(spec);
      if (!kind) continue;
      const label = spec.label ? t(spec.label) : key;
      const readable = () => bindProperty(item, key, ctx.api);
      if (!spec.readonly && !spec.read) {
        const { read, write, placed, label: ignored, ...bare } = spec;
        // Drawn as a card of its own, under a heading, rather than as a field
        // in a row of label and control.
        const card = kind === "image" || kind === "imagelist" || ["texteditor", "textarea"].includes(spec.control);
        inputs.push({ key, prop: key, label, kind, spec: bare, wide: card, node: nodes[key], set: (value) => readable().set(value) });
      }
      // What an app holds that is its answer rather than its setting: a
      // value nobody types (read-only, read through), or a type that has a
      // port kind of its own (a picture, tags, a prompt).
      if (spec.readonly || spec.read || typeof (VALUE_TYPES[spec.type] || {}).port === "string") {
        const { read: ignoredRead, write: ignoredWrite, placed: ignoredPlaced, label: ignoredLabel, ...shown } = spec;
        outputs.push({ key, label, kind, spec: shown, node: nodes[key], read: () => readable().get() });
      }
    }
  }
  const merge = (own, more) => [...(more || []), ...own.filter((one) => !(more || []).some((other) => other.key === one.key))];
  return {
    itemId,
    prepare: typeof extra.prepare === "function" ? extra.prepare : null,
    buttons: [...buttons.values()].sort((a, b) => Number(b.primary) - Number(a.primary)),
    inputs: merge(inputs, extra.inputs),
    outputs: merge(outputs, extra.outputs),
  };
}

// Press one of an app's buttons and wait for it, when it has something to
// wait for.
async function pressApp(itemId, key) {
  const surface = appSurface(itemId);
  const button = surface && surface.buttons.find((one) => one.key === key);
  if (!button) throw new Error(`no button ${key} on ${itemId}`);
  return button.run(null);
}

function setAppInput(itemId, key, value, kind) {
  const surface = appSurface(itemId);
  const input = surface && surface.inputs.find((one) => one.key === key);
  if (!input) throw new Error(`no input ${key} on ${itemId}`);
  const result = input.set(value, kind);
  if (result && typeof result.then === "function") {
    return Promise.resolve(result).then((answer) => {
      refreshAll();
      return answer;
    });
  }
  refreshAll();
  return result;
}

function readAppOutput(itemId, key) {
  const surface = appSurface(itemId);
  const output = surface && surface.outputs.find((one) => one.key === key);
  return output ? output.read() : undefined;
}

function onDesignProblem(handler) {
  setDesignHandler(handler);
}




// A saved layout can name a type that has since been removed, so pickers
// resolve through this rather than trusting the stored value.
function pickedType(value) {
  return ITEM_TYPES[value] ? value : DEFAULT_ITEM_TYPE;
}

function expandOf(nodes) {
  const list = (Array.isArray(nodes) ? nodes : []).filter((node) => node && node.kind !== "pinned");
  return list.length === 1 && (list[0].kind === "control" || list[0].kind === "card") ? list[0].key : null;
}

// A control placed with `grow: true` is the one that takes all the room there is when its card
// fills the window: the text of a text card, the picture of an image card, the page of a
// preview. Said by whoever places it (the shell cannot tell which part of a card is the thing
// it shows); the CSS gives it the height the expanded card has left.
//
// The button in the header of the body's one card (a card, or a control that draws one).

const mountedItems = new Map();

// What a body was drawn from, as one string: the item's values. A body kept
// across a change of layout is drawn again only if this has changed since it was.
function sigOf(item) {
  return JSON.stringify(item.props);
}

// What the crumbs at the top of a window's body were made from: a body is
// still the right one for a window when this has not changed.
function trailKeyOf(node) {
  const trail = node && node.type === "group" ? [null, ...screensOf(node)] : node ? node.path : [];
  return trail.map((id) => (id === null ? "." : id)).join(">");
}

function mountItem(windowId, bodyEl) {
  unmountItem(windowId);

  const node = findLeaf(windowId);
  const itemId = node ? currentItemId(node) : null;
  const item = getItem(itemId);
  // The steps back: a window's path, or a group (null) and its screens.
  const trail = node && node.type === "group" ? [null, ...screensOf(node)] : node ? node.path : [];
  if (!item) {
    bodyEl.replaceChildren();
    const missing = document.createElement("div");
    missing.className = "mu-item-missing";
    missing.textContent = t("mu.value.noItem", { id: itemId || "unset" });
    bodyEl.append(missing);
    return;
  }

  const def = ITEM_TYPES[item.type];
  const el = document.createElement("div");
  el.className = "mu-item";
  el.dataset.itemId = item.id;
  // Plugin stylesheets need something to hook onto that is not a class the
  // shell might rename.
  el.dataset.itemType = item.type;

  const root = document.createElement("div");
  root.className = "mu-item-body";
  // What an item is -- its name, its id, its type -- is a fact about the
  // window rather than part of what the item has to say, so it is behind
  // the window's id in the title bar (see openWindowSettings) and no longer a
  // line above every body.
  //
  // The way back, though, belongs in the body: a screen opened from inside
  // another one (a chooser, an inspector's target) is read top-down, and
  // the crumbs in the title bar are small and easy to miss. It names where
  // it goes, because "back" alone does not say what you are returning to.
  //
  // It is one of the three things the item's bar holds, which stays at the
  // top while the body scrolls under it: the way back, what the item is
  // linked to, and whatever the item pins there (NODES.pinned -- the state
  // of a program it needs). All three are things wanted at the bottom of a
  // long screen as much as at its top; the bar is hidden while there is
  // none of them.
  const bar = document.createElement("div");
  bar.className = "mu-action-bar is-stack";
  const barTrail = document.createElement("div");
  barTrail.className = "mu-action-bar-row mu-action-bar-trail";
  const barLinks = document.createElement("div");
  barLinks.className = "mu-action-bar-row mu-action-bar-links";
  const barPins = document.createElement("div");
  barPins.className = "mu-action-bar-row mu-action-bar-pins";
  const barAsk = document.createElement("div");
  barAsk.className = "mu-action-bar-row mu-action-bar-ask";
  bar.append(barAsk, barTrail, barLinks, barPins);
  if (trail.length > 1) {
    const crumbs = barTrail;
    const before = trail[trail.length - 2];
    const back = document.createElement("button");
    back.type = "button";
    back.className = "mu-item-back";
    back.append(
      iconEl("back", "mu-item-back-icon"),
      Object.assign(document.createElement("span"), {
        textContent: t("mu.action.backTo", { name: before === null ? groupLabel(node) : itemLabel(before) }),
      })
    );
    back.addEventListener("click", (event) => {
      event.stopPropagation();
      truncatePath(windowId, trail.length - 2);
    });
    // The other way out of a screen opened inside another one: instead of
    // going back, keep both -- this window returns to where it came from
    // and what was on top of it goes into a window of its own, wherever
    // the guides are clicked. Opposite ends of the same row, because they
    // are the two answers to the same question.
    // Built like the button beside it, because it is the same kind of
    // thing: the other answer to "what now" at the top of a screen opened
    // inside another one.
    const detach = document.createElement("button");
    detach.type = "button";
    detach.className = "mu-item-back mu-item-detach";
    detach.title = t("mu.action.detachTitle");
    detach.append(
      iconEl("detach", "mu-item-back-icon"),
      Object.assign(document.createElement("span"), { textContent: t("mu.action.detach") })
    );
    detach.addEventListener("click", (event) => {
      event.stopPropagation();
      const shown = currentItemId(node);
      // The window is made first and the path shortened after. A screen
      // opened inside another one lives only as long as something is
      // showing it, so letting go of it here before it had anywhere else
      // to be would take it with the path.
      if (!splitWindow(windowId, "right", { type: "leaf", id: newWindowId(), path: [shown] })) return;
      truncatePath(windowId, node.path.length - 2);
    });
    // A group's screen has no window to step back into while it goes
    // elsewhere: only the way back.
    crumbs.append(back, ...(node.type === "group" ? [] : [detach]));
  }
  el.append(bar, root);
  bodyEl.replaceChildren(el);

  const ctx = {
    windowId,
    item,
    def,
    trailKey: trailKeyOf(node),
    sig: sigOf(item),
    element: el,
    root,
    bar,
    pins: barPins,
    api: grantApi(def, { windowId, itemId: item.id }),
    // For an item whose body changes without anyone touching a property --
    // a clock, a tailed log. Cheaper and narrower than a full refresh.
    refresh: () => refreshItem(windowId),
    // After changing a property from outside an editor: redraw every window
    // (others may be previewing this item) and persist.
    refreshAll: () => refreshAll(),
    // A line in this item's own window, which fades. An item speaks for
    // itself: there is no shell-wide strip for it to write into.
    status: (message) => notify(windowId, message),
    // What a run says while it goes on (queued, 40 of 120, loading): in the
    // state row of the program that does the work -- the item's own bar, where
    // its lamp already is -- and cleared with "" when the run ends. An item
    // that pins no such row says it in its own window, as `status` does.
    progress: (message, service = "comfyui") => {
      setRunText(item.id, service, message || "");
      if (message && !el.querySelector(`[data-service="${service}"]`)) notify(windowId, message);
    },
    // Asking before something irreversible. The question is a row of this item's own bar
    // (askIn): in the window it is about, covering nothing; the shell draws it, so every
    // plugin asks in the same voice, and in the reader's language.
    confirm: (message, options) => askIn(ctx, "confirm", message, options),
    // Asking for a text (a name). The same row, with a field.
    prompt: (message, options) => askIn(ctx, "prompt", message, options),
    // The same accessor a control writes through, for an item's own code.
    property: (key) => bindProperty(item, key, ctx.api),
    get: (key) => bindProperty(item, key, ctx.api).get(),
    set: (key, value) => {
      bindProperty(item, key, ctx.api).set(value);
      refreshAll();
    },
    onChange(desc, value) {
      noteControl({
        itemId: desc.property?.item?.id || item.id,
        windowId,
        propertyKey: desc.property?.key || desc.key,
        propertyName: desc.label || "",
        controlName: desc.control?.label ? t(desc.control.label) : "",
        controlType: Object.keys(CONTROLS).find((key) => CONTROLS[key] === desc.control) || "",
      });
      // One door for every write: the control's edit and the item's own code
      // both end up in the property's set(), so coercion and any spec hook
      // run exactly once either way.
      // A control that is typed into may ask for the redraw to wait for a
      // pause (`deferRefresh`, ms): drawing every window is far slower than a
      // keystroke, and a burst of keys would queue behind it. The value is
      // written at once; only the redrawing of what derives from it waits --
      // at most `DEFER_MAX_MS`, so a long burst still saves along the way.
      // Anything the write itself asks to have redrawn (a property's own
      // `write` calling ctx.set, say) waits with it.
      const wait = desc.control && desc.control.deferRefresh;
      if (wait) deferringMs = wait;
      // A redraw the write itself asks for (a property's `write` calling
      // ctx.set) is the one below: drawing every window twice per click is
      // what made a switch like "show details" stall.
      writingControl++;
      try {
        writeOf(desc, value);
      } finally {
        deferringMs = 0;
        writingControl--;
      }
      // The history entry waits too: recording one serialises the whole
      // workspace several times over (~100 ms at 6 MB), per key. The redraw
      // that follows the pause records it, and undo flushes it first.
      if (wait) {
        deferRedraw(wait);
        return;
      }
      // Push the change everywhere: another window may be previewing this
      // item. Editors are diffed, so the one being typed into survives.
      refreshAll();
    },
  };

  mountedItems.set(windowId, ctx);
  if (def.mount) def.mount(ctx);
  refreshItem(windowId);
  refreshLinkBar();
}

// ---- asking, in the window --------------------------------------------
// A question is a row at the top of the item's bar: a title, the words, a field for a
// text, and the way to answer. Nothing is covered and nothing is blocked -- the rest of
// the window goes on, and the answer comes when it comes. One at a time per window (the
// next waits its turn); a window that goes takes its question with it, answered as
// "no". `confirm` resolves true or false, `prompt` the text (empty is a text) or null.
const askTails = new WeakMap();

function askIn(ctx, kind, message, options = {}) {
  const row = ctx && ctx.bar ? ctx.bar.querySelector(":scope > .mu-action-bar-ask") : null;
  const nothing = kind === "prompt" ? null : false;
  if (!row) return Promise.resolve(nothing);
  const { title = "", okText = t("mu.ask.ok"), danger = false, value = "", validate = null } = options || {};
  const show = () =>
    new Promise((resolve) => {
      if (!mountedItems.has(ctx.windowId) || mountedItems.get(ctx.windowId) !== ctx) return resolve(nothing);
      const box = document.createElement("div");
      box.className = "mu-ask";
      const parts = [];
      if (title) parts.push(Object.assign(document.createElement("div"), { className: "mu-ask-title", textContent: title }));
      if (message) parts.push(Object.assign(document.createElement("div"), { className: "mu-ask-message", textContent: message }));
      let input = null;
      if (kind === "prompt") {
        input = Object.assign(document.createElement("input"), { type: "text", className: "input mu-prop-input", value });
        parts.push(input);
      }
      const error = Object.assign(document.createElement("div"), { className: "mu-ask-error" });
      const cancel = Object.assign(document.createElement("button"), { type: "button", className: "btn", textContent: t("mu.ask.cancel") });
      const ok = Object.assign(document.createElement("button"), { type: "button", className: danger ? "btn btn-danger" : "btn btn-primary", textContent: okText });
      const actions = Object.assign(document.createElement("div"), { className: "mu-ask-actions" });
      actions.append(cancel, ok);
      box.append(...parts, error, actions);
      row.classList.toggle("is-danger", Boolean(danger));
      row.append(box);
      fitActionBar(ctx.bar);
      let done = false;
      const finish = (answer) => {
        if (done) return;
        done = true;
        ctx.asks.delete(giveUp);
        box.remove();
        row.classList.remove("is-danger");
        fitActionBar(ctx.bar);
        resolve(answer);
      };
      const giveUp = () => finish(nothing);
      ctx.asks = ctx.asks || new Set();
      ctx.asks.add(giveUp);
      const accept = () => {
        if (kind !== "prompt") return finish(true);
        const text = input.value.trim();
        const problem = validate ? validate(text) : "";
        if (problem) {
          error.textContent = problem;
          return;
        }
        finish(text);
      };
      ok.addEventListener("click", accept);
      cancel.addEventListener("click", giveUp);
      box.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          giveUp();
        } else if (event.key === "Enter" && kind === "prompt") {
          event.preventDefault();
          accept();
        }
      });
      requestAnimationFrame(() => {
        if (input) {
          input.focus();
          input.select();
        } else {
          ok.focus();
        }
        box.scrollIntoView({ block: "nearest" });
      });
    });
  const tail = askTails.get(row) || Promise.resolve();
  const answer = tail.then(show, show);
  askTails.set(row, answer.then(() => {}, () => {}));
  return answer;
}

// The same, for something that is not an item's own code: the window around an element
// (a control with no ctx of its own, a button on the frame). Nothing there to ask in:
// no, or no text.
function askNear(element, kind, message, options = {}) {
  const win = element && element.closest ? element.closest(".mu-window") : null;
  const ctx = win ? mountedItems.get(win.dataset.id) : null;
  return ctx ? askIn(ctx, kind, message, options) : Promise.resolve(kind === "prompt" ? null : false);
}

function unmountItem(windowId) {
  const ctx = mountedItems.get(windowId);
  if (!ctx) return;
  // A question this window was asking is answered "no": there is no one to answer it.
  if (ctx.asks) [...ctx.asks].forEach((giveUp) => giveUp());
  teardownTree(ctx.root);
  if (ctx.pins) teardownTree(ctx.pins);
  if (ctx.def.unmount) ctx.def.unmount(ctx);
  mountedItems.delete(windowId);
}

// What an action needs of the screen: the window showing its item, and how
// things are asked, reported and written there (shell/items/actions.js).

function actionWindow(item) {
  const focused = focusedWindow();
  if (mountedItems.get(focused)?.item === item) return focused;
  for (const [id, ctx] of mountedItems) if (ctx.item === item) return id;
  return null;
}

function unmountAllItems() {
  Array.from(mountedItems.keys()).forEach(unmountItem);
}

function bayAxis(bayFrameNode) {
  return bayAxisOf(bayFrameNode).axis;
}

function appIdOfLeaf(leaf) {
  if (!leaf || leaf.type === "group") return "";
  if (leaf.app && appDef(leaf.app)) return leaf.app;
  const framed = appOfWindow(leaf.id);
  if (framed) return framed.id;
  const item = getItem(currentItemId(leaf));
  const def = item && ITEM_TYPES[item.type];
  return isStandalone(def) && !def.partOf && appDef(item.type) ? item.type : "";
}

function inferredAppOf(group) {
  if (!group || group.type !== "group" || group.app || group.id === ROOT_ID) return null;
  const apps = new Set();
  eachLeaf(group, (leaf) => {
    if (isSlotLeaf(leaf)) return;
    apps.add(appIdOfLeaf(leaf));
  });
  if (apps.size !== 1) return null;
  const [only] = [...apps];
  return only ? appDef(only) : null;
}

function applyGroupTints() {
  eachGroup(layoutRoot(), (group) => {
    const el = windowEl(group.id);
    if (!el) return;
    const own = group.app ? appDef(group.app) : inferredAppOf(group);
    const app = appItemOf(group) ? getItem(group.appItem) : null;
    const tint = own ? own.accent || "" : app ? tintOf(app) : "";
    el.classList.toggle("has-tint", Boolean(tint));
    if (tint) {
      if (el.style.getPropertyValue("--accent") !== tint) el.style.setProperty("--accent", tint);
    } else if (el.style.getPropertyValue("--accent")) {
      el.style.removeProperty("--accent");
    }
  });
}

// An item of one property whose whole body is one section holding one control or card is that
// control: the window is the property, so the section's title (the property's name) is not drawn
// and the card can fill the window (see expandOf). A section with a hint or an empty text keeps
// its title -- they are said beside it. Only the item's own properties count, not the fields of
// the values they hold.
function unwrapSoleSection(nodes, item) {
  const def = item && ITEM_TYPES[item.type];
  if (!def || !Array.isArray(nodes)) return nodes;
  const shown = nodes.filter(Boolean);
  if (shown.length !== 1 || shown[0].kind !== "section" || shown[0].hint || shown[0].empty) return nodes;
  if (Object.keys(def.properties || {}).length !== 1) return nodes;
  const inside = (shown[0].children || []).filter(Boolean);
  return inside.length === 1 && (inside[0].kind === "control" || inside[0].kind === "card") ? inside : nodes;
}

// Re-run one item's body() and diff the result against what is on screen.
// mount: the bodies frames builds (see framesHooks). Before the stage is
// rebuilt every item leaves the DOM -- or, keeping, is held aside to move
// into its new frame.
function detachBodies(keep) {
  const kept = keep ? new Map(mountedItems) : null;
  if (kept) mountedItems.clear();
  else unmountAllItems();
  return kept;
}

function letGoBody(ctx) {
  teardownTree(ctx.root);
  if (ctx.def.unmount) ctx.def.unmount(ctx);
}

// Every body under root: an item held aside that is still the window's moves
// in as it is, anything else is mounted; what is left of kept is let go.
function attachBodies(root, kept = null) {
  const reused = new Set();
  let arrived = 0;
  root.querySelectorAll('[data-role="body"]').forEach((body) => {
    const host = body.closest(".mu-window");
    if (!host) return;
    const windowId = host.dataset.id;
    const old = kept && kept.get(windowId);
    if (old) {
      kept.delete(windowId);
      const node = findLeaf(windowId);
      const item = node ? getItem(currentItemId(node)) : null;
      if (item === old.item && ITEM_TYPES[item.type] === old.def && old.trailKey === trailKeyOf(node)) {
        body.replaceChildren(old.element);
        mountedItems.set(windowId, old);
        applyTint(windowId, item);
        reused.add(windowId);
        return;
      }
      letGoBody(old);
    }
    arrived += 1;
    mountItem(windowId, body);
  });
  // Windows that are no longer there.
  const left = kept ? kept.size : 0;
  if (kept) kept.forEach(letGoBody);
  return { arrived, left, reused };
}

// Of the bodies moved in, those whose item changed or that read the layout.
function settleBodies(reused, wide) {
  for (const windowId of reused) {
    const ctx = mountedItems.get(windowId);
    if (ctx && (ctx.sig !== sigOf(ctx.item) || readsLayout(ctx, wide))) refreshItem(windowId);
  }
  scheduleFitPropRows();
}



// mount: the item in the focused window takes a key before the shell: a
// binding of its app, then its own keys. True when it took it.
function itemKeys(windowId, event, combo, modified) {
  const ctx = mountedItems.get(windowId);
  if (ctx && !event.defaultPrevented && !event.isComposing && !event.metaKey && (modified || !isTyping(event))) {
    const outer = outerAppFrame(windowId);
    const hotkeys = (outer && APPS[outer.app]?.hotkeys) || APPS[ctx.item.type]?.hotkeys || [];
    for (const binding of hotkeys) {
      if (binding.key !== combo) continue;
      if (outer && binding.at !== "self") {
        const winId = resolveHotkeyAddress(outer, binding.at);
        const leaf = winId ? findLeaf(winId) : null;
        const targetItem = leaf && leaf.type === "leaf" ? getItem(leaf.path[0]) : null;
        const targetDef = targetItem && ITEM_TYPES[targetItem.type];
        if (targetItem && targetDef && Object.hasOwn(targetDef.actions || {}, binding.action)) {
          event.preventDefault();
          if (!event.repeat) runAction(targetItem, binding.action);
          return true;
        }
      } else if (binding.at === "self" && Object.hasOwn(ctx.def.actions || {}, binding.action)) {
        event.preventDefault();
        if (!event.repeat) runAction(ctx.item, binding.action);
        return true;
      }
    }
  }
  if (ctx && ctx.def.keys && (modified || !isTyping(event))) {
    const handler = ctx.def.keys[combo];
    if (handler && handler(ctx, event) !== false) {
      event.preventDefault();
      return true;
    }
  }
  return false;
}

function refreshItem(windowId) {
  drawSerial += 1;
  const ctx = mountedItems.get(windowId);
  if (!ctx) return;
  if (ctx.def.drop) {
    const drop = ctx.def.drop;
    attachSink(ctx.element, { accepts: [drop.kind], icon: "arrow-counterclockwise", label: t(drop.label), put: (value) => drop.put(ctx.item, value) });
  }
  applyTint(windowId, ctx.item);
  // What the body pins goes to the item's bar, the rest under it.
  setBuildingType(ctx.item.type);
  let nodes;
  try {
    nodes = unwrapSoleSection(ctx.def.body(ctx.api, ctx.item, ctx), ctx.item);
  } finally {
    setBuildingType("");
  }
  // Pinned controls belong to this item, never to a nested body or card.
  const checkPinned = (node, parent) => {
    if (!node) return;
    if (parent && node.kind === "pinned") designProblem(`pinned controls ("${node.key}") must be at the top level of an item`);
    for (const child of [...(node.children || []), ...(node.bar || [])]) checkPinned(child, node);
  };
  for (const node of nodes) checkPinned(node, null);
  const pinned = nodes.filter((node) => node && node.kind === "pinned").flatMap((node) => node.children || []);
  ctx.expandKey = expandOf(nodes);
  // An item of one property (its body is that one control or card, which can fill the window): the
  // property's label is not drawn -- the window is the property (see `.is-single` in the CSS).
  ctx.root.classList.toggle("is-single", ctx.expandKey !== null);
  renderNodes(ctx.root, pinned.length ? nodes.filter((node) => !node || node.kind !== "pinned") : nodes, ctx);
  paintExpanded(windowId);
  if (ctx.pins) {
    renderNodes(ctx.pins, pinned, ctx, [["pins"]]);
    ctx.pins.hidden = !pinned.length;
    fitActionBar(ctx.bar);
  }
  if (ctx.def.update) ctx.def.update(ctx);
  ctx.sig = sigOf(ctx.item);
  // The body may have changed which properties are shown, or what they
  // hold; either can change whether a row still fits on one line.
  scheduleFitPropRows();
}

// The preset button of a window's title bar. An item that has presets of
// its own -- an app's run settings -- hands over the way to open them while
// it draws (setPresetOpener); the bar shows the button while the window's
// current item has one, so it follows the window as its path moves, and is
// not there while the chooser itself is what the window shows.
const presetOpeners = new Map();

function setPresetOpener(itemId, open) {
  if (typeof open === "function") presetOpeners.set(itemId, open);
  else presetOpeners.delete(itemId);
}

function paintPresetButtons() {
  for (const id of Array.from(presetOpeners.keys())) {
    if (!getItem(id)) presetOpeners.delete(id);
  }
  stageEl().querySelectorAll(".mu-window").forEach((el) => {
    const button = el.querySelector(":scope > .mu-titlebar .action-presets");
    const leaf = button && findLeaf(el.dataset.id);
    if (!leaf) return;
    const shown = presetOpeners.has(currentItemId(leaf));
    if (button.hidden === shown) button.hidden = !shown;
  });
}

// How many times the items have been drawn: what is asked of a source while one draw goes on is asked once.
let drawSerial = 0;

const currentDrawSerial = () => drawSerial;

function refreshItems({ bodies = true } = {}) {
  drawSerial += 1;
  syncLinks();
  if (bodies) Array.from(mountedItems.keys()).forEach(refreshItem);
  paintPresetButtons();
  applyGroupTints();
  refreshAppChrome();
  refreshLinkBar();
}

// A property changed: persist it and let every window redraw what it
// derives from shared state (previews of other items, mostly).
// Set when the shell is not going to start (see startup.js): nothing is
// drawn and nothing is saved, so a layout that was never read is never
// written over with an empty one.
let halted = false;

function halt() {
  halted = true;
}

// Every item type's body, built once before anything is drawn, so a body that
// breaks the spec stops the shell at start-up and is not found by whoever
// opens that window. Each type is given an item of its own, its stored
// properties seeded from what their types say a typical value is (so a list
// has an entry to be drawn), and the item is gone again afterwards. A body
// that cannot be built without a window is left out of the check, and said.
const bodyChecked = { checked: [], skipped: [] };
// `drawn: true` finds a card with no name by drawing the bodies off screen
// instead of reading what the controls declare (`cardName`): slower, and what
// the declarations are checked against (tests/card-names.browser.js).
function bodyProblems({ drawn = false } = {}) {
  const found = [];
  const before = itemsMark();
  const designBefore = designProblems.length;
  bodyChecked.checked = [];
  bodyChecked.skipped = [];
  // An item made with what it owns (a writer is only drawn inside its
  // builder), and each of them built.
  const probes = [];
  for (const type of Object.keys(ITEM_TYPES)) {
    const mark = allItems().length;
    try {
      createItem(type);
    } catch {
      bodyChecked.skipped.push(type);
    }
    probes.push(...allItems().slice(mark));
  }
  // Each body is built twice: as it comes, and with every switch it has turned
  // on (a body that holds something back until a switch -- the detailed
  // settings -- would otherwise never be built here, and a mistake in it only
  // found by whoever flips the switch).
  for (const pass of [0, 1])
  for (const item of probes) {
    const type = item.type;
    const def = ITEM_TYPES[type];
    try {
      for (const [key, spec] of Object.entries(def.properties || {})) {
        if (spec.read || spec.link || derivesFrom(spec.type, "ref")) continue;
        const sample = (VALUE_TYPES[spec.type] || {}).sample;
        const seed = sample && "default" in sample ? sample.default : undefined;
        // Nothing in it: no value, or only lists with nothing in them.
        const bare = (v) => v === undefined || v === null || v === "" || (Array.isArray(v) ? !v.length : typeof v === "object" && Object.values(v).every(bare));
        if (!bare(seed) && bare(spec.default)) writeValue(item, key, JSON.parse(JSON.stringify(seed)), { by: "mount" });
      }
      if (pass === 1) {
        for (const [key, spec] of Object.entries(def.properties || {})) {
          if (!spec.read && !spec.link && derivesFrom(spec.type, "boolean")) writeValue(item, key, true, { by: "mount" });
        }
      }
      const ctx = headlessCtx(item, def);
      const nodes = def.body(ctx.api, item, ctx);
      if (!bodyChecked.checked.includes(type)) bodyChecked.checked.push(type);
      const mine = [];
      const walk = (node, parent) => {
        if (!node) return;
        if (node.kind === "pinned" && parent) {
          mine.push(`pinned controls ("${node.key}") must be at the top level of an item`);
        }
        if (node.kind === "section" && parent) {
          mine.push(`a section ("${node.key}") inside a ${parent.kind} ("${parent.key}"): sections are only the top level of a body`);
        }
        if (node.kind === "section") {
          const problem = sectionToolsProblem(node);
          if (problem) mine.push(problem);
          if (!drawn) {
            const unnamed = unnamedCardsIn(node, ctx);
            if (unnamed) mine.push(unnamed);
          }
        }
        // A card that only holds another card is a wrapper (see NODE_KINDS.card).
        if (node.kind === "card" && /-content$/.test(String(node.key)) && !node.title && (node.children || []).length === 1 && node.children[0].kind === "card") {
          mine.push(`card "${node.key}" only wraps another card; give the inner card the tools, and drop the wrapper`);
        }
        const named = headerNameProblem(node, ctx);
        if (named) {
          if (ENFORCE_HEADER_NAMES) mine.push(named);
          else headerNames.add(`item type "${type}": ${named}`);
        }
        const unlisted = listCardProblem(node, parent);
        if (unlisted) {
          if (ENFORCE_LIST_CARD_AT_START) mine.push(unlisted);
          else listCardsFound.add(`item type "${type}": ${unlisted}`);
        }
        if (node.kind === "control") {
          let control = null;
          try {
            control = controlDescriptor(node, ctx).control;
          } catch {
            // A node that cannot be resolved without a window is the window's to report.
          }
          const unknown = unknownParamsProblem(node, control);
          if (unknown) {
            if (ENFORCE_KNOWN_PARAMS) mine.push(unknown);
            else unknownParams.add(`item type "${type}": ${unknown}`);
          }
        }
        for (const child of [...(node.children || []), ...(node.bar || []), ...controlSlotNodes(node)]) walk(child, node);
      };
      (Array.isArray(nodes) ? nodes : []).forEach((node) => walk(node, null));
      if (drawn) {
        const host = document.createElement("div");
        setUnnamedSink(mine);
        try {
          renderNodes(host, Array.isArray(nodes) ? nodes : [], ctx);
        } catch {
          // drawn later, by a window
        } finally {
          setUnnamedSink(null);
          try {
            teardownTree(host);
          } catch {
            // nothing of it is kept
          }
        }
      }
      for (const message of mine) found.push({ source: def.source || "core", message: `item type "${type}": ${message}` });
    } catch (error) {
      // A name that is not there is a mistake wherever the body is drawn; the
      // rest (a body that wants a window) is left to the window.
      if (error instanceof ReferenceError) found.push({ source: def.source || "core", message: `item type "${type}": its body throws ${error.message}${pass ? " (with its switches on)" : ""}` });
      else if (!bodyChecked.skipped.includes(type)) bodyChecked.skipped.push(type);
    }
  }
  // What the nodes said as they were built (a card, or a section, holding a section).
  for (const message of designProblems.slice(designBefore)) {
    if (!found.some((one) => one.message.includes(message))) found.push({ source: "core", message });
  }
  if (headerNames.size) {
    console.warn(`[mullion] ${headerNames.size} cards put a name in their header without being an entry of a list (the rule of card labels): ` + [...headerNames].join(" | "));
    headerNames.clear();
  }
  if (listCardsFound.size) {
    console.warn(`[mullion] ${listCardsFound.size} lists are made with NODES.card (make them with NODES.listCard, or a list control in a declaration): ` + [...listCardsFound].join(" | "));
    listCardsFound.clear();
  }
  const unknownFound = [...unknownParams].filter((one) => one.startsWith("item type "));
  if (unknownFound.length) {
    console.warn(`[mullion] ${unknownFound.length} control nodes are given params their control does not take: ` + unknownFound.join(" | "));
  }
  // The probes were never there.
  dropItemsSince(before);
  return found.filter((one, index, all) => all.findIndex((other) => other.message === one.message) === index);
}

function refreshAll() {
  if (halted) return;
  // A control's write is under way: its onChange redraws once it is done.
  if (writingControl) return;
  if (operationsReady()) captureOperation();
  if (deferringMs) {
    deferRedraw(deferringMs);
    return;
  }
  clearTimeout(deferredTimer);
  deferredSince = 0;
  refreshItems();
  scheduleSave();
}

// A redraw a typed-into control asked to put off (see onChange).
const DEFER_MAX_MS = 1500;

let deferredTimer = 0;

let deferredSince = 0;

let deferringMs = 0; // set while a typed-into control's write is under way

let writingControl = 0; // set while a control's write is under way (see onChange)

function deferRedraw(wait) {
  const now = performance.now();
  if (!deferredSince) deferredSince = now;
  clearTimeout(deferredTimer);
  deferredTimer = setTimeout(refreshAll, Math.max(0, Math.min(wait, deferredSince + DEFER_MAX_MS - now)));
}

const NOTICE_MS = 4000;

const noticeTimers = new Map();

function notify(windowId, message) {
  const el = windowEl(windowId);
  if (!el) return;
  const notice = el.querySelector('[data-role="notice"]');
  clearTimeout(noticeTimers.get(windowId));
  notice.textContent = message || "";
  notice.hidden = !message;
  if (!message) return;
  noticeTimers.set(
    windowId,
    setTimeout(() => {
      notice.hidden = true;
      notice.textContent = "";
    }, NOTICE_MS)
  );
}

const runTexts = new Map();

const runListeners = new Set();

const runText = (itemId, service) => runTexts.get(`${itemId}\n${service}`) || "";

const onRunText = (fn) => {
  runListeners.add(fn);
  return () => runListeners.delete(fn);
};

function setRunText(itemId, service, text) {
  const key = `${itemId}\n${service}`;
  if ((runTexts.get(key) || "") === text) return;
  if (text) runTexts.set(key, text);
  else runTexts.delete(key);
  runListeners.forEach((fn) => fn(itemId, service));
}


// What a window is linked to, said in the item's bar, in a row of its own
// beside the way back and what is pinned: one state row (see
// paintStatusRow) -- the app's name for one link, "N apps" for more -- and
// behind its button the links themselves, one by one, as a screen of their
// own (`applinks`). Made again only when what it says changed.

// The bar is there while any of its rows has something in it.
function fitActionBar(bar) {
  if (!bar) return;
  const has = Array.from(bar.children).some((row) => !row.hidden && row.childElementCount > 0);
  if (bar.hidden === has) bar.hidden = !has;
}

function refreshLinkBar() {  // the links row of every action bar
  for (const ctx of mountedItems.values()) {
    const item = getItem(ctx.item.id);
    const el = ctx.element;
    if (!item || !el) continue;
    const links = linksOf(item);
    const sig = links.map((one) => `${one.key}:${one.to}:${itemLabel(one.to)}`).join("|");
    if (el.__linkSig === sig) continue;
    el.__linkSig = sig;
    const row = ctx.bar && ctx.bar.querySelector(":scope > .mu-action-bar-links");
    if (!row) continue;
    row.replaceChildren();
    if (!links.length) {
      fitActionBar(ctx.bar);
      continue;
    }
    const host = document.createElement("div");
    paintStatusRow(host, {
      name: t("mu.link.state"),
      text: links.length === 1 ? itemLabel(links[0].to) : t("mu.link.count", { n: links.length }),
      lamp: "ok",
      onMore: () => openScreen(ctx.windowId, "applinks", { props: { host: item.id } }),
      moreTitle: t("mu.link.details"),
    });
    row.append(host);
    fitActionBar(ctx.bar);
  }
}

// Listening to what ports says (the ports module's event, through the bridge).

let portDrag = null; // the port whose grip is held











// ---- walking a path ---------------------------------------------------------
// Every place a path can lead -- the property, a field, an element, a piece
// that is not a field -- is a node that can say what it is carried as, what
// it takes, what it carries, and how a value is put into it. The rest of
// this section asks nodes and never looks at what they are made of.











// What one part of the shell makes for another to use without importing it.
// kindNodes(...): the nodes that show a value by its kind -- made by the
// Preview item (items/preview.js, setKindNodes), used by plugins that show
// results. Nothing until it is set.
let kindNodesOf = null;
function setKindNodes(fn) {
  kindNodesOf = fn;
}
function kindNodes(...args) {
  return kindNodesOf ? kindNodesOf(...args) : [];
}

// explainer(type): what explains an element of that type -- a badge's
// popup text (controls.js) -- registered by whoever knows (registerExplainer,
// e.g. the tag dictionary for prompt.tag).
const EXPLAINERS = new Map();
function registerExplainer(type, fn) {
  EXPLAINERS.set(type, fn);
}
function explainer(type) {
  return EXPLAINERS.get(type) || null;
}

// serviceBlocker(service, item): why an action may not start while a program it
// needs is not there ("" when it may) -- set by whoever watches the programs
// (setServiceBlocker). Nothing sets it in the shell yet; the tests do.
let blockerOf = null;
function setServiceBlocker(fn) {
  blockerOf = typeof fn === "function" ? fn : null;
}
function serviceBlocker(service, item) {
  return (blockerOf && blockerOf(service, item)) || "";
}

function showNoDrag(card) {
  if (!card || card.querySelector(":scope > .mu-port-guides.is-nodrag")) return;
  const guides = document.createElement("div");
  guides.className = "mu-port-guides is-refused is-nodrag";
  guides.append(Object.assign(document.createElement("span"), { textContent: t("mu.port.noDrag") }));
  // The guide is laid over the card, so the card has to hold it.
  const placed = getComputedStyle(card).position === "static";
  if (placed) card.style.position = "relative";
  card.append(guides);
  const done = () => {
    guides.remove();
    if (placed) card.style.position = "";
    window.removeEventListener("pointerup", done, true);
  };
  window.addEventListener("pointerup", done, true);
  setTimeout(done, 1400);
}

// Said once, on a grip, for the card `cardOf` finds when it is held.
// mount: a card's own grip does not start a window drag.

function wireNoDrag(grip, cardOf) {
  if (grip.__noDrag) return;
  grip.__noDrag = true;
  grip.addEventListener("pointerdown", () => {
    if (grip.classList.contains("is-inert")) showNoDrag(cardOf());
  });
}

function attachPort(card, grip, port) {
  card.classList.add("mu-port");
  syncLinkBadge(grip.parentElement, port);
  card.dataset.portItem = port ? port.item : "";
  card.dataset.portKey = port ? port.key : "";
  card.dataset.portPath = port && stepsOf(port.path).length ? JSON.stringify(stepsOf(port.path)) : "";
  // Always there (every card has one); with nothing to carry it is greyed
  // and, held, says it cannot be dragged (see showNoDrag).
  grip.hidden = false;
  grip.disabled = false;
  grip.classList.toggle("is-inert", !port);
  wireNoDrag(grip, () => card);
  if (grip.__portWired) return;
  grip.__portWired = true;
  grip.draggable = true;
  // The drag is the browser's, and a mousedown that is cancelled never
  // starts one. A control that keeps the focus where it is by cancelling
  // mousedown on its buttons would otherwise leave a grip that looks
  // draggable and silently is not -- the capture phase runs first on the
  // grip itself, so the cancel is made a no-op for this event.
  grip.addEventListener(
    "mousedown",
    (event) => {
      event.preventDefault = () => {};
    },
    true
  );
  grip.addEventListener("dragstart", (event) => {
    event.stopPropagation();
    const from = readAddress(card);
    const found = from.item && portSpec(from);
    if (!found) {
      // Refused, and said so on the card: not a grip that does nothing.
      event.preventDefault();
      showNoDrag(card);
      return;
    }
    const kind = kindAt(found);
    const route = routeFor(kind, ["text"]);
    const value = readPort(found, from);
    event.dataTransfer.effectAllowed = "copyLinkMove";
    // The text as well, so a grip dropped outside Mullion -- into a text
    // box anywhere -- still puts down what it was carrying. Only for what is
    // text: a picture's or a voice's address is no sentence, and a text field
    // taking it as one was never what was meant.
    const media = MEDIA_KINDS.has(kind);
    const plain = media ? "" : route ? route.convert(value) : typeof value === "string" ? value : "";
    event.dataTransfer.setData(PORT_MIME, kind || "");
    if (!media) event.dataTransfer.setData("text/plain", String(plain ?? ""));
    // What is being held, shown with the pointer: its kind and what it is.
    const chip = dragChip(kind, card, value, plain);
    event.dataTransfer.setDragImage(chip, 14, 14);
    setTimeout(() => chip.remove(), 0);
    startPortMove(from, card);
  });
  grip.addEventListener("dragend", endPortMove);
}

// Kinds whose value is an address of a file, not words.
const MEDIA_KINDS = new Set(["image", "imagelist", "video", "audio"]);

const PORT_MIME = "application/x-mullion-port";

// What a grip is holding, drawn small to go with the pointer: the kind's
// icon and name, then a glimpse -- a picture's thumbnail, the first words of
// a text. An element is needed in the page for the browser to take a
// snapshot of; it is gone again at once.
function dragChip(kind, card, value, plain) {
  const def = Object.values(VALUE_TYPES).find((one) => one.port === kind) || {};
  const chip = document.createElement("div");
  chip.className = "mu-drag-chip";
  const head = document.createElement("div");
  head.className = "mu-drag-chip-head";
  head.append(
    Object.assign(document.createElement("i"), { className: `bi bi-${ICONS[def.icon] || def.icon || (kind === "text" ? "fonts" : "box-arrow-up-right")}` }),
    Object.assign(document.createElement("span"), {
      textContent: kind === "text" ? t("mu.vtype.string") : def.label ? t(def.label) : String(kind || ""),
    })
  );
  chip.append(head);
  const media = card.querySelector("img, video");
  if (media && (kind === "image" || kind === "video" || kind === "imagelist")) {
    const thumb = media.cloneNode(false);
    thumb.className = "mu-drag-chip-thumb";
    if (thumb instanceof HTMLVideoElement) thumb.muted = true;
    chip.append(thumb);
  } else if (typeof plain === "string" && plain.trim()) {
    chip.append(Object.assign(document.createElement("div"), { className: "mu-drag-chip-text", textContent: plain.trim().replace(/\s+/g, " ").slice(0, 80) }));
  } else if (Array.isArray(value)) {
    chip.append(Object.assign(document.createElement("div"), { className: "mu-drag-chip-text", textContent: String(value.length) }));
  }
  document.body.append(chip);
  return chip;
}

function startPortMove(from, sourceCard) {
  portDrag = from;
  sourceCard.classList.add("is-port-source");
  document.body.classList.add("is-port-moving");
  const fromKind = kindAt(portSpec(from));
  const value = portValue(from);

  // Which ports are offered something, first: a port with ports inside it
  // (a list and its rows) puts its guides on its header only while its rows
  // have guides of their own, and over the whole of itself otherwise.
  const offers = [];
  stageEl().querySelectorAll(".mu-port").forEach((card) => {
    const to = readAddress(card);
    if (!to.item || samePort(to, from)) return;
    // The list the carried entry is in, or an entry inside the carried
    // list: nothing to offer either way.
    if (card.contains(sourceCard) || sourceCard.contains(card)) return;
    // Trading places is a write: a read-only list -- a history read from
    // the library -- has no order of its own to change.
    const moves = canMove(to, from);
    // Being the same property is offered where the type allows it, whether or
    // not a value of this kind could be copied in.
    const shares = canShare(to, from);
    // A port of a kind there is no way into is offered nothing.
    if (!moves && !shares && !routeBetween(to, from)) return;
    offers.push({ card, to, moves, shares });
  });
  const offered = new Set(offers.map((one) => one.card));

  const wire = (button, effect, act) => {
    button.addEventListener("dragover", (event) => {
      if (!portDrag || button.disabled) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = effect;
      button.classList.add("is-over");
    });
    button.addEventListener("dragleave", () => button.classList.remove("is-over"));
    button.addEventListener("drop", (event) => {
      event.preventDefault();
      const carried = portDrag;
      endPortMove();
      if (carried) act(carried);
    });
  };

  for (const { card, to, moves, shares } of offers) {
    const guides = document.createElement("div");
    guides.className = "mu-port-guides";
    const nested = card.__portHead && [...offered].some((other) => other !== card && card.contains(other));
    (card.__portDrop || (nested ? card.__portHead : card)).append(guides);
    if (!writable(portSpec(to)) || card.dataset.portReadonly === "1") {
      guides.classList.add("is-refused");
      guides.append(Object.assign(document.createElement("span"), { textContent: t("mu.port.refused") }));
      continue;
    }
    if (moves) {
      const move = portGuide("move", "arrow-down-up");
      guides.append(move);
      wire(move, "move", (carried) => movePort(to, carried));
    }
    if (routeBetween(to, from)) {
      const paste = portGuide("paste", "clipboard-plus");
      const link = portGuide("link", "link-45deg");
      if (!canLink(to, from)) {
        link.disabled = true;
        link.title = t("mu.port.loops");
      }
      guides.append(paste, link);
      wire(paste, "copy", (carried) => pastePort(to, carried));
      wire(link, "link", (carried) => linkPort(to, carried));
    }
    if (shares) {
      const share = portGuide("share", "share");
      guides.append(share);
      wire(share, "link", (carried) => sharePort(to, carried));
    }
  }

  // Places that take a value without being one: a list's add button, which
  // makes a new entry out of what is dropped on it. Paste only -- there is
  // nothing there yet to keep following anything.
  stageEl().querySelectorAll(".mu-port-sink").forEach((sink) => {
    const spec = sink.__sink;
    // Not the place it is being carried from, either way round: a board's
    // card picked up is not put down on its own board again.
    if (!spec || sourceCard.contains(sink) || sink.contains(sourceCard)) return;
    // Only the kinds it names, as they are: a sink is asked for something
    // specific (text or tags for a new prompt), and a whole list read as
    // text is not that.
    if (!(spec.accepts || []).includes(fromKind)) return;
    const route = { kind: fromKind, convert: (one) => one };
    const source = portSpec(portDrag);
    const sourceType = source && source.spec ? source.spec.type : "";
    const guides = document.createElement("div");
    guides.className = "mu-port-guides";
    sink.append(guides);
    // `modes` (["paste", "link"]): the guides a card has, for a place that can
    // keep following where a value came from -- `put` is then told which, and
    // the address it came from.
    if (Array.isArray(spec.modes) && spec.modes.length) {
      for (const mode of spec.modes) {
        const guide = portGuide(mode, mode === "link" ? "link-45deg" : "clipboard-plus");
        guides.append(guide);
        wire(guide, mode === "link" ? "link" : "copy", (carried) => {
          // The place is told what it is called (not where it is from); for a
          // link it answers with the property that is to follow, and the link
          // is made here.
          const made = spec.put(route.convert(value), route.kind, sourceType, portLabel(carried), mode);
          if (mode === "link" && made && made.link) linkPort(made.link, carried);
          refreshAll();
        });
      }
      return;
    }
    const add = portGuide("add", spec.icon || "plus-lg", spec.label || "");
    guides.append(add);
    wire(add, "copy", () => {
      spec.put(route.convert(value), route.kind, sourceType);
      refreshAll();
    });
  });
}

// For a control: make `el` take dropped values -- `accepts` the kinds it
// takes (exactly; no conversion), `put(value, kind, sourceType)` what it does
// with one. `sourceType` is the property's exact type when available.
function attachSink(el, sink) {
  el.classList.add("mu-port-sink");
  el.__sink = sink;
}

// The card being carried takes nothing. Its own text field would otherwise
// take the text the drag carries for the world outside -- a caret showed in
// it, and letting go there pasted the text into itself.
// And no text field takes it by the browser's own rules: a field already has
// guides (paste, link) for what is carried, and the native drop wrote the
// carried text -- or an address -- into it behind them.

function endPortMove() {
  portDrag = null;
  document.body.classList.remove("is-port-moving");
  document.querySelectorAll(".mu-port-guides").forEach((one) => one.remove());
  stageEl().querySelectorAll(".is-port-source").forEach((one) => one.classList.remove("is-port-source"));
}





// apps: app frames saved by older versions, brought up to date.

export {
  wireMount,
  LAYOUT_READERS,
  SCREEN_READERS,
  readsLayout,
  refreshLayoutReaders,
  surfaceKindOf,
  headlessCtx,
  controlSlotNodes,
  surfaceButtons,
  appSurface,
  pressApp,
  setAppInput,
  readAppOutput,
  onDesignProblem,
  pickedType,
  expandOf,
  mountedItems,
  sigOf,
  trailKeyOf,
  mountItem,
  askTails,
  askIn,
  askNear,
  unmountItem,
  actionWindow,
  unmountAllItems,
  bayAxis,
  appIdOfLeaf,
  inferredAppOf,
  applyGroupTints,
  unwrapSoleSection,
  detachBodies,
  letGoBody,
  attachBodies,
  settleBodies,
  itemKeys,
  refreshItem,
  presetOpeners,
  setPresetOpener,
  paintPresetButtons,
  currentDrawSerial,
  refreshItems,
  halt,
  bodyChecked,
  bodyProblems,
  refreshAll,
  DEFER_MAX_MS,
  deferRedraw,
  NOTICE_MS,
  noticeTimers,
  notify,
  runTexts,
  runListeners,
  runText,
  onRunText,
  setRunText,
  fitActionBar,
  refreshLinkBar,
  setKindNodes,
  kindNodes,
  registerExplainer,
  explainer,
  setServiceBlocker,
  serviceBlocker,
  showNoDrag,
  wireNoDrag,
  attachPort,
  MEDIA_KINDS,
  PORT_MIME,
  dragChip,
  startPortMove,
  attachSink,
  endPortMove,
};
