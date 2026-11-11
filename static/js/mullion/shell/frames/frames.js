/* frames: moved out of core.js (docs/wiki/migration.md). */
import { APP_SETTINGS, BAY_SLIDES, DEFAULT_ITEM_TYPE, DIRECTIONS, HOTKEY_ACTIONS, ICONS, ITEM_TYPES, MOTION_EASE, ROOT_DEFAULT_ITEM, TITLE_GAP, WINDOW_SETTINGS_TYPE, activeSash, appDef, appOfWindow, appSettingValue, bayFrame, bayList, bayOf, bayRecord, checkContent, closeWindow, commit, commitPath, containsNode, countLeaves, currentItemId, defaultItemFor, defaultItemIn, describeNode, eachLeaf, findLeaf, findNodeParent, findParent, fitLaunched, flushFits, frameRoot, getItem, groupContent, groupOf, groupWindow, groupWindows, hotkeyCombo, hotkeyTargetLabel, iconEl, iconMarkup, titlebarMarkup, isContainer, isSlotLeaf, isStandalone, itemIcon, itemLabel, itemOfWindow, knownType, language, launchAppNode, launchNode, layoutRoot, leafIds, lessMotion, linkOptionsFor, motionMs, moveWindow, needBay, newWindowId, nextSash, normalizeBays, openTitleMenu, openWindowSettings, outerAppFrame, outerAppFrames, pendingHeads, placedNode, portGuide, prevSash, pruneItems, putInSlot, putLink, ratioOf, readonlyProp, redoOperation, registerAppsHook, registerBaysHook, registerHotkeysHook, registerInBay, registerOperationsHook, registerPickersHook, registerViewHook, removeBay, repairPaths, replaceNode, resolveHotkeyAddress, saved, scheduleFitPropRows, scheduleLaunchKeep, scheduleSave, screensOf, setIcon, setLayoutRoot, setScreens, settleLayout, splitWindow, stashedNode, syncLinks, t, takeContent, undoOperation, ResizeObserver, document, getComputedStyle, requestAnimationFrame, window, escapeHtml, applyTranslations, appItemsAround, CSS } from "./deps.js";
import { CUT_EPS, opposite, fullCuts, seamSegments, edgeFrames, splitAt, isolateSegment, swapNode, ancestorsOf, ratioAt, snapRatio } from "./deps.js";

// What frames hears of others: their events, through the bridge (setup).
let on = () => () => {};
export function connectEvents(emit, listen) {
  on = listen;
}


// Which window has the focus (mount reads it to ask in the right window).
function focusedWindow() {
  return focusedWindowId;
}

// The first draw: the app settings on the document, and the language the
// labels are in now.
function startFrames() {
  applyAppSettings();
  lastLanguage = language();
}

// frames' listeners on the page, and what it puts into other modules. Called
// once, by core.js as it loads (where these statements were).
function wireFrames() {
  // frames: the windows are drawn in the stage.
  registerViewHook("stage", () => stage);
  // frames: view leaves card headers as they are while a seam is dragged.
  registerViewHook("resizing", () => Boolean(resizing));
  // frames: a placement under way ends before an undo or redo moves the layout.
  on("layout", "restore", ({ phase }) => phase === "before" && exitPlaceMode());
  // frames: what changed in the layout is drawn.
  on("layout", "change", (change) => (change.path ? drawPathChange(change.path.windowId, change.path.before) : drawLayoutChange(change.options)));
  // frames: another sash of a bay on screen slides in; a folded bay is told
  // apart; the focus follows the sash a step goes to.
  on("bays", "change", (change) => change.sash && redrawBay(change.sash.frame, change.sash.ahead, change.sash.wasShut));
  registerBaysHook("collapsed", (frame) => allCollapsed(frame));
  registerBaysHook("label", (node) => (node.type === "group" ? groupLabel(node) : itemLabel(currentItemId(node))));
  registerBaysHook("stepping", (bayId, step) => {
    focusAfterSash = bayId;
    try {
      return step();
    } finally {
      focusAfterSash = null;
    }
  });
  document.addEventListener("pointermove", (event) => {
    if (!resizing || event.pointerId !== resizing.pointerId) return;
    const pos = resizing.horizontal
      ? event.clientX - resizing.rect.left
      : event.clientY - resizing.rect.top;
    const at =
      resizing.from === null
        ? ratioAt(pos, resizing)
        : Math.min(0.98, Math.max(0.02, resizing.startRatio + ratioAt(pos, resizing) - resizing.from));
    const { ratio, snapped } = snapRatio(at, resizing.inner, resizing.targets, { snapDistance: SNAP_DISTANCE, minPane: MIN_PANE });
    resizing.ratio = ratio;
    paintResize(resizing.overlay, resizing.node, ratio, snapped);
    // The line is all that moves while the windows are too many to follow it:
    // they are sized once, where the seam is let go (see pointerup).
    if (resizing.deferred) return;
    const started = performance.now();
    resizing.node.ratio = ratio;
    applyRatio(resizing.childEls, ratio, resizing.node);
    // Laid out now, to know what this costs.
    resizing.childEls[0].getBoundingClientRect();
    if (performance.now() - started > LIVE_RESIZE_MS) resizing.deferred = true;
    // The ResizeObserver only watches the stage, which doesn't change size
    // while a seam moves -- so the new geometry, and which way the bars fit,
    // are pushed by hand, once a frame.
    relayoutSoon(true);
  });

  document.addEventListener("pointerup", (event) => {
    if (!resizing || event.pointerId !== resizing.pointerId) return;
    resizing.node.ratio = resizing.ratio;
    finishResize();
    // The seams are drawn again if moving one made a neighbouring seam
    // splittable, or stopped it being so; otherwise the sizes are set where
    // the windows stand.
    commit({ keep: true, inPlace: true });
  });

  document.addEventListener("pointercancel", () => cancelResize());
  registerAppsHook("workingFrame", () => workingAppFrame());
  registerOperationsHook("resizing", () => Boolean(resizing));
  document.addEventListener("keydown", (event) => {
    const combo = comboOf(event);
    const modified = event.ctrlKey || event.altKey || event.metaKey;

    if (!event.defaultPrevented && !event.isComposing && !isTyping(event) && !resizing && !dragSourceId &&
        !event.altKey && (event.ctrlKey || event.metaKey)) {
      const key = event.key.toLowerCase();
      if (key === "z" || (key === "y" && !event.shiftKey)) {
        event.preventDefault();
        if (key === "y" || event.shiftKey) redoOperation();
        else undoOperation();
        return;
      }
    }

    // 0. a hotkey the person bound: theirs, so it wins over everything
    if (runHotkey(event)) {
      event.preventDefault();
      return;
    }

    // 1. the item in the focused window gets first refusal
    if (focusedWindowId && framesHooks.keys(focusedWindowId, event, combo, modified)) return;

    // 2. then the shell, which never steals a bare key from a text field
    if (isTyping(event) && !modified && combo !== "Escape") return;
    const shell = SHELL_KEYS[combo];
    if (shell && shell() !== false) event.preventDefault();
  });
  Object.assign(HOTKEY_ACTIONS, {
    collapse: {
      label: "mu.hotkey.action.collapse",
      // Every frame on screen but the stage itself; the guide sits on the
      // button the key stands in for (whichever of fold/open is showing).
      icon: "collapse",
      // Only what is in an app: a binding is an app's (see below). A plain
      // group inside an app has no name in it, so it is not offered either.
      targets: () =>
        Array.from(stage.querySelectorAll(".mu-window:not(.is-root):not(.is-bay):not(.is-bay-slot)"))
          .filter((el) => el.getClientRects().length && el.getBoundingClientRect().width > 0)
          .filter((el) => {
            const node = findLeaf(el.dataset.id);
            return node && outerAppFrame(node.id) && (node.type === "leaf" || (node.app && appDef(node.app)));
          })
          .map((el) => {
            const bar = el.querySelector(":scope > .mu-titlebar");
            const shown = (sel) => {
              const button = bar && bar.querySelector(sel);
              return button && button.getClientRects().length ? button : null;
            };
            return {
              target: el.dataset.id,
              el: shown(".action-collapse") || shown(".action-expand") || bar || el,
            };
          }),
      run: (id) => toggleCollapsed(id),
      // What the window is called. One a bay's other sash keeps aside is
      // still there, only not on screen.
      labelOf: (id) => {
        const node = id && (findLeaf(id) || stashedNode(id));
        if (!node) return "";
        return node.type === "group" ? groupLabel(node) : itemLabel(currentItemId(node));
      },
      exists: (id) => Boolean(findLeaf(id) || stashedNode(id)),
    },
    // A bay's next and previous sash: the buttons every window in the bay wears.
    nextSash: baySashAction("mu.hotkey.action.nextSash", "nextSash", ".action-next-sash", (bayId) => nextSash(bayId)),
    prevSash: baySashAction("mu.hotkey.action.prevSash", "prevSash", ".action-prev-sash", (bayId) => prevSash(bayId)),
    // The rest of a window's title bar buttons. Each is offered where its
    // button is on screen; a binding keeps working when the button is switched
    // off or folded into the menu, since what it presses is the action.
    presets: windowToolAction("mu.hotkey.action.presets", "preset", ".action-presets", {
      run: (id) => {
        const leaf = findLeaf(id);
        const open = leaf && framesHooks.presetOpener(currentItemId(leaf));
        const el = windowEl(id);
        if (!open || !el) return false;
        const button = el.querySelector(":scope > .mu-titlebar .action-presets");
        open(button && button.getClientRects().length ? button : el.querySelector(":scope > .mu-titlebar") || el);
        return true;
      },
    }),
    pin: windowToolAction("mu.hotkey.action.pin", "pinned", ".action-pin", {
      run: (id) => togglePinned(id),
    }),
    close: windowToolAction("mu.hotkey.action.close", "close", ".action-delete", {
      run: (id) => {
        if (!findLeaf(id) || findLeaf(id) === layoutRoot()) return false;
        closeWindow(id);
        commit();
        return true;
      },
    }),
    ...Object.fromEntries(
      ["up", "down", "left", "right"].map((dir) => [
        `expand${dir[0].toUpperCase()}${dir.slice(1)}`,
        windowToolAction(`mu.hotkey.action.expand${dir[0].toUpperCase()}${dir.slice(1)}`, `expand${dir[0].toUpperCase()}${dir.slice(1)}`, `.action-expand-toward[data-dir="${dir}"]`, {
          run: (id) => expandToward(id, dir),
        }),
      ])
    ),
  });
  // hotkeys: picking a hotkey's target ends before an undo or redo.
  on("layout", "restore", ({ phase }) => phase === "before" && exitHotkeyPick());
  // The guides were laid over the screen as it was; one that moved under
  // them would leave them pointing at the wrong thing.
  window.addEventListener("resize", () => exitHotkeyPick());
  document.addEventListener(
    "keydown",
    (event) => {
      if (!hotkeyPick || event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      exitHotkeyPick();
    },
    true
  );
  registerPickersHook("windowEl", (windowId) => windowEl(windowId));
  registerPickersHook("openInWindow", (windowId, itemId) => openInWindow(windowId, itemId));
  registerHotkeysHook("order", (frames) => framesInOrder(frames));
  // frames: written app settings may change the language: the whole stage is
  // drawn again then, else the items are.
  on("apps", "change", (change) => {
    if (!change.settings) return;
    applyAppSettings();
    if (!applyLanguage()) framesHooks.refresh(true);
  });
  // Another tab changed the shared profile.
  on("server", "change", ({ incoming }) => {
    if (!incoming) return;
    applyAppSettings();
    if (!applyLanguage()) framesHooks.refresh(true);
  });
  window.addEventListener("resize", () => relayoutSoon(false));
  new ResizeObserver(() => relayoutSoon(true)).observe(stage);
  // A title measured before its font arrived is measured again once it has.
  if (document.fonts) document.fonts.ready.then(() => fitBars());
}

// The stage the windows are drawn in, and what shows when there are none:
// found once the page is handed in (findPageElements, index.js).
let stage = null;

let emptyState = null;
export function findPageElements() {
  stage = document ? document.getElementById("stage") : null;
  emptyState = document ? document.getElementById("empty-state") : null;
}
// The stage (mount and boot look into it).
function stageEl() {
  return stage;
}

const SNAP_RATIOS = [0.25, 0.5, 0.75];

const SNAP_DISTANCE = 18; // px from a guide before the magnet takes over
// px a pane may never shrink below. Enough for the narrow bar -- the
// handle, the id, the item's icon and the one button they fold into -- and
// a little of the body underneath. Smaller than this is not a window that
// has been made small, it is one that has been made useless.
const MIN_PANE = 144;

let focusedWindowId = null; // the window keystrokes are delivered to

let placing = null; // item type waiting for a guide to be clicked

let dragSourceId = null; // window being dragged by its handle
// A window dropped on a group's "inside" guide: still on its way, now to
// one of the windows in that group, chosen by clicking a guide there.
let pendingMove = null;
// Groups whose own guides have stepped aside for the windows inside them.
const openedGroups = new Set();

let guidePredicate = null;

let resizing = null; // in-flight resize, see wireResizer()

// Transient per-window UI state. Not part of the saved layout -- it only
// exists so items can report what the frame around them is doing.
const windowModes = new Map();

// ---- focus -----------------------------------------------------------
// What frames asks of others (registerFramesHook). The windows' bodies --
// the items in them -- are mount's: frames builds the frames and hands each
// body over, and asks again when what is on screen moved.
//   mount(windowId, body)        -- put the window's item into its body
//   unmount(windowId)            -- take it out
//   detach(keep)                 -- before the stage is rebuilt: let every
//                                   item go, or (keep) hold them aside; a token
//   attach(root, kept)           -- the bodies under root: an item held aside
//                                   moves in, else one is mounted; the rest of
//                                   kept let go. {arrived, left, reused}
//   refresh(bodies)              -- draw what changed (bodies too, or left alone)
//   settle(reused, wide)         -- of the bodies moved in, draw those that
//                                   changed or read the layout
//   layoutMoved(only, wide)      -- draw what reads the layout (in only)
//   windowChanged(windowId, all) -- the window's focus or mode changed: draw
//                                   its item if it reads that (all: anyway)
//   redrawAll()                  -- something was put or linked: draw it all
//   expandKey(windowId)          -- the card the window's item can expand
//   presetOpener(itemId)         -- how the item's presets open, or null
//   ask(el, kind, message, opts) -- a question in the window around el
//   takeOut(root)                -- the items under root leave the DOM now;
//                                   a function that lets them go (later)
//   keys(windowId, event, combo, modified) -- the item in the focused window
//                                   takes a key first; true when it did
const framesHooks = {
  mount: () => {},
  unmount: () => {},
  detach: () => null,
  attach: () => ({ arrived: 0, left: 0, reused: new Set() }),
  refresh: () => {},
  settle: () => {},
  layoutMoved: () => {},
  windowChanged: () => {},
  redrawAll: () => {},
  expandKey: () => null,
  presetOpener: () => null,
  ask: () => Promise.resolve(false),
  takeOut: () => () => {},
  keys: () => false,
};

function registerFramesHook(kind, fn) {
  framesHooks[kind] = fn;
}

// Exactly one window is active at a time, and keystrokes are delivered to
// it rather than to the document. Focus is deliberately transient: it is
// never written to the layout file.
function focusWindow(id, { moveDom = false } = {}) {
  const node = findLeaf(id);
  if (!node) return;
  // A group is a frame, not somewhere a keystroke can land, so focusing one
  // means focusing the first window inside it.
  if (node.type === "group") {
    const inside = leafIds(node);
    if (inside.length) focusWindow(inside[0], { moveDom });
    return;
  }
  const previous = focusedWindowId;
  focusedWindowId = id;
  unfocused = false;
  const outer = outerAppFrame(id);
  if (outer) lastAppFrameId = outer.id;
  if (previous !== id) {
    // Only the window itself, never the frames around it: a group's bar
    // says which group, and the tint says where the keystrokes go.
    stage.querySelectorAll(".mu-window").forEach((el) => {
      el.classList.toggle("is-focused", el.dataset.id === id);
    });
    // The focused fact is part of what an item can read, so both windows
    // redraw -- the one losing focus and the one gaining it -- if they read
    // it. Most do not, and a click on a window should not draw two apps.
    [previous, id].forEach((wid) => wid && framesHooks.windowChanged(wid));
  }
  if (moveDom) {
    const el = windowEl(id);
    if (el && !el.contains(document.activeElement)) el.focus({ preventScroll: true });
  }
}

// Nothing active, on purpose: no window is tinted, and keystrokes go to the
// shell alone. A state of its own, asked for (Escape) and left by the next
// window that is pointed at, so that a redraw does not hand the focus to a
// window the person never chose.
let unfocused = false;
// A bay whose sash has just been moved on: the focus follows to what it now
// shows, instead of falling to whichever window comes first in the layout.
let focusAfterSash = null;

function clearFocus() {
  if (focusedWindowId === null && unfocused) return false;
  const previous = focusedWindowId;
  focusedWindowId = null;
  unfocused = true;
  stage.querySelectorAll(".mu-window.is-focused").forEach((el) => el.classList.remove("is-focused"));
  if (document.activeElement && document.activeElement !== document.body && stage.contains(document.activeElement)) {
    document.activeElement.blur();
  }
  if (previous) framesHooks.windowChanged(previous, true);
  return true;
}

// Which items draw something from the layout -- which window is active, how
// the windows are arranged, the bays and the apps on screen. Only these are
// drawn again when the arrangement changes and nothing they hold did: for
// everything else a window moving, folding or taking focus is none of its
// business, and drawing every window each time is what made a layout of a
// few dozen windows slow to fold.
//
// Two sets. What a window's size or focus changes is read through the window
// and layout permissions, and the bays. Which apps are on screen -- what the
// launcher lights up, what an app's own preview looks for -- changes when a
// window comes or goes, not when it folds, so those are asked only then (`wide`).

// Keep a sensible window active after the layout changes under us.
function restoreFocus() {
  const ids = leafIds(layoutRoot());
  if (!ids.length) {
    focusedWindowId = null;
    return;
  }
  if (focusAfterSash) {
    const frame = bayFrame(focusAfterSash);
    focusAfterSash = null;
    const first = frame ? leafIds(frame)[0] : null;
    if (first) {
      focusedWindowId = null; // force the class + refresh pass
      focusWindow(first, { moveDom: true });
      return;
    }
  }
  if (unfocused) {
    // Still nothing active; only what the redraw built is made to say so.
    focusedWindowId = null;
    return;
  }
  const next = ids.includes(focusedWindowId) ? focusedWindowId : ids[0];
  focusedWindowId = null; // force the class + refresh pass
  focusWindow(next);
}

// Spatial navigation: from the focused window, the nearest one whose centre
// lies in the given direction. Geometry, not tree order -- what the eye
// expects when the layout is nested.
function neighbourWindow(direction) {
  const from = windowEl(focusedWindowId);
  if (!from) return null;
  const a = from.getBoundingClientRect();
  const origin = { x: a.left + a.width / 2, y: a.top + a.height / 2 };

  let best = null;
  // Windows only. A group's rectangle contains the windows inside it, so
  // its centre would win the comparison and hand focus to a frame.
  stage.querySelectorAll(".mu-window:not(.is-group)").forEach((el) => {
    if (el === from) return;
    const b = el.getBoundingClientRect();
    const point = { x: b.left + b.width / 2, y: b.top + b.height / 2 };
    const dx = point.x - origin.x;
    const dy = point.y - origin.y;
    const forward = { left: -dx, right: dx, up: -dy, down: dy }[direction];
    if (forward <= 1) return; // not in that direction at all
    // Prefer the closest window along the axis, then the least sideways drift.
    const drift = direction === "left" || direction === "right" ? Math.abs(dy) : Math.abs(dx);
    const score = forward + drift * 2;
    if (!best || score < best.score) best = { id: el.dataset.id, score };
  });
  return best ? best.id : null;
}



// Whether the splits in an arrangement run both ways: a row somewhere inside
// a column, or a column inside a row.
function mixedAxes(node) {
  return Boolean(node) && node.type === "split" && node.children.some((child) => child.type === "split" && (child.dir !== node.dir || mixedAxes(child)));
}

// An arrangement with every window in it minimised, and the splits among
// them running both ways (one above two, say): bars drawn the wide way
// round each took a share of the room and stood in a screen of nothing. So
// they lie sideways, as the bars of an open window's neighbours do, in a
// block as wide as they are: the lower two are columns side by side and the
// upper is as wide as both. `inherit` tells every bar in it, however the
// splits run (see splitChildContext, which starts it at any such split);
// `compact` is for the stage's own content, which would otherwise be as
// wide as the stage. Other arrangements are drawn as before.
function stageContext(node) {
  if (node !== layoutRoot()) return null;
  const content = groupContent(node);
  return content && mixedAxes(content) && allCollapsed(content) ? { dir: "row", siblingOpen: false, inherit: true, compact: true } : null;
}

// The context a split hands to its child `i`: the axis it divides, whether
// the other side still wants room (or something beyond the split does, along
// the same axis), and what was inherited.
function splitChildContext(node, context, shut, i) {
  const outerOpen = Boolean(context && context.dir === node.dir && context.siblingOpen);
  const out = { dir: node.dir, siblingOpen: !shut[1 - i] || outerOpen };
  // Everything here minimised and the splits running both ways: the bars lie sideways (see stageContext).
  if ((context && context.inherit) || (mixedAxes(node) && allCollapsed(node))) out.inherit = true;
  return out;
}

function swapWindows(aId, bId) {
  if (aId === bId) return false;
  const a = findLeaf(aId);
  const b = findLeaf(bId);
  if (!a || !b) return false;

  // Two plain windows trade what they are showing, which is everything
  // about them, so each frame keeps its id and its size. A group has more
  // than one thing to show and a frame of its own, so it trades places in
  // the tree instead -- the whole group moves, tabs and all.
  if (a.type === "leaf" && b.type === "leaf") {
    const carried = ["path", "collapsed"];
    carried.forEach((key) => {
      const value = a[key];
      if (b[key] === undefined) delete a[key];
      else a[key] = b[key];
      if (value === undefined) delete b[key];
      else b[key] = value;
    });
    commit();
    return true;
  }

  if (containsNode(a, b) || containsNode(b, a)) return false;
  const [aParent, aIndex] = findParent(aId);
  const [bParent, bIndex] = findParent(bId);
  replaceNode(aParent, aIndex, b);
  replaceNode(bParent, bIndex, a);
  commit();
  return true;
}

function applyAppSettings() {
  document.documentElement.lang = appSettingValue("language");
  document.documentElement.dataset.theme = appSettingValue("theme");
  document.documentElement.dataset.skin = appSettingValue("skin");
}



// ---- items -----------------------------------------------------------
// Instances live in one flat list; windows reference them by id. An item lives
// while a window's path, a screen or an app's frame holds it (see pruneItems):
// there is no owner above it, and what it works with it is connected to.

// Bring forward the window showing an item, if one is: focused, and
// expanded if it had been collapsed. False when nothing shows it, so the
// caller can put it somewhere instead.
function revealItem(itemId) {
  let found = null;
  eachLeaf(layoutRoot(), (leaf) => {
    if (!found && currentItemId(leaf) === itemId) found = leaf;
  });
  if (!found) return false;
  if (found.collapsed) {
    delete found.collapsed;
    commit();
  }
  focusWindow(found.id, { moveDom: true });
  const el = windowEl(found.id);
  if (el) {
    el.scrollIntoView({ block: "nearest", inline: "nearest" });
    el.classList.remove("is-revealed");
    // Restarted on every reveal, so a second click shows as a second one.
    void el.offsetWidth;
    el.classList.add("is-revealed");
  }
  return true;
}

function openInWindow(windowId, itemId) {
  const leaf = findLeaf(windowId);
  if (!leaf || !getItem(itemId)) return null;
  if (currentItemId(leaf) === itemId) return true;
  // Within a group's screens only: a group showing its windows has no item
  // of its own to open something from.
  if (leaf.type === "group") {
    if (!screensOf(leaf).length) return null;
    setScreens(leaf, [...screensOf(leaf), itemId]);
    commit();
    return true;
  }
  if (leaf.type !== "leaf") return null;
  const before = leaf.path;
  leaf.path = [...leaf.path, itemId];
  commitPath(windowId, before);
  return true;
}

function windowFacts(id) {
  let hit = null;
  (function walk(node, parent, index, path, share) {
    if (hit || !node) return;
    if (node.type === "leaf") {
      if (node.id === id) hit = { node, parent, index, path, share };
      return;
    }
    // A frame divides nothing: what it holds has the whole of its slot,
    // and goes on dividing that among itself.
    if (node.type === "group") {
      walk(node.children[0], node, 0, [...path, 0], share);
      return;
    }
    const ratio = ratioOf(node);
    walk(node.children[0], node, 0, [...path, 0], share * ratio);
    walk(node.children[1], node, 1, [...path, 1], share * (1 - ratio));
  })(layoutRoot(), null, -1, [], 1);
  if (!hit) return null;

  const el = windowEl(id);
  const rect = el ? el.getBoundingClientRect() : { width: 0, height: 0 };
  return {
    id,
    itemId: currentItemId(hit.node),
    itemPath: [...hit.node.path],
    path: hit.path.length ? hit.path.join(" › ") : "root",
    depth: hit.path.length,
    parent: hit.parent ? describeNode(hit.parent) : "root",
    // The frame this window is inside, if it is inside one at all.
    group: (groupOf(id) || {}).id || "",
    newItem: defaultItemFor(id),
    sibling: hit.parent ? describeNode(hit.parent.children[1 - hit.index]) : "—",
    share: hit.share,
    width: Math.round(rect.width),
    height: Math.round(rect.height),
    mode: windowModes.get(id) || t("mu.wmode.idle"),
    focused: id === focusedWindowId,
  };
}

// The same facts, in the descriptor shape every item renders through.
function windowProperties(id) {
  const w = windowFacts(id);
  if (!w) return [];
  return [
    readonlyProp("id", "mu.winprop.id", "string", w.id),
    readonlyProp("item", "mu.winprop.item", "string", w.itemId),
    readonlyProp("itemPath", "mu.winprop.itemPath", "string", w.itemPath.join(" › ")),
    readonlyProp("path", "mu.winprop.path", "string", w.path),
    readonlyProp("depth", "mu.winprop.depth", "number", w.depth),
    readonlyProp("parent", "mu.winprop.parent", "string", w.parent),
    readonlyProp("group", "mu.winprop.group", "string", w.group || t("mu.value.dash")),
    readonlyProp("newItem", "mu.winprop.newItem", "string", w.newItem),
    readonlyProp("sibling", "mu.winprop.sibling", "string", w.sibling),
    readonlyProp("share", "mu.winprop.share", "percent", w.share),
    readonlyProp("size", "mu.winprop.size", "string", `${w.width} × ${w.height}`),
    readonlyProp("mode", "mu.winprop.mode", "string", w.mode),
    readonlyProp("focused", "mu.winprop.focused", "boolean", w.focused),
  ];
}

// Every place a value type is used: "<item type>.<property key>", plus
// the app-wide settings, which are declared with the same vocabulary.
function propertyUsers(typeName) {
  const users = [];
  for (const [name, def] of Object.entries(ITEM_TYPES)) {
    for (const [key, spec] of Object.entries(def.properties || {})) {
      if (spec.type === typeName) users.push(`${name}.${key}`);
    }
  }
  for (const [key, spec] of Object.entries(APP_SETTINGS)) {
    if (spec.type === typeName) users.push(`app.${key}`);
  }
  return users;
}

// The window's item path, as clickable breadcrumbs.
// What a group is called: the app it is the frame of, or "group".
function groupLabel(group) {
  const app = group && group.app ? appDef(group.app) : null;
  if (app) return app.name;
  const held = group && group.defaultItem !== ROOT_DEFAULT_ITEM ? knownType(group.defaultItem) : null;
  return held ? t(ITEM_TYPES[held].label) : t("mu.value.groupFrame");
}

// A group's bar while it shows a screen: the group, then each screen.
function buildGroupCrumbs(group, held) {
  const nav = document.createElement("nav");
  nav.className = "mu-window-path";
  const crumb = (icon, label, title, current) => {
    const mark = document.createElement("span");
    mark.className = "mu-crumb";
    mark.append(iconEl(icon, "mu-crumb-icon"), Object.assign(document.createElement("span"), { className: "mu-crumb-label", textContent: label }));
    mark.title = title;
    if (current) mark.classList.add("is-current");
    return mark;
  };
  const screens = screensOf(group);
  nav.append(crumb(held ? ITEM_TYPES[held].icon || "group" : "group", groupLabel(group), `${groupLabel(group)} · ${group.id}`, !screens.length));
  screens.forEach((itemId, index) => {
    nav.append(Object.assign(document.createElement("span"), { className: "mu-crumb-sep", textContent: "›" }));
    nav.append(crumb(itemIcon(getItem(itemId)), itemLabel(itemId), `${itemLabel(itemId)} · ${itemId}`, index === screens.length - 1));
  });
  return nav;
}

// The path is shown, not walked: the way back from a screen opened inside
// another one is the button at the top of its body (see mountItem), so a
// crumb is only a mark of where the window is.
function buildBreadcrumbs(leaf) {
  const nav = document.createElement("nav");
  nav.className = "mu-window-path";
  leaf.path.forEach((itemId, index, shown) => {
    if (index > 0) {
      const sep = document.createElement("span");
      sep.className = "mu-crumb-sep";
      sep.textContent = "›";
      nav.append(sep);
    }
    const crumb = document.createElement("span");
    crumb.className = "mu-crumb";
    // A one-window app's window starts with the app, by its name.
    const app = index === 0 && leaf.app ? appDef(leaf.app) : null;
    crumb.append(
      iconEl(app ? app.icon || "window" : itemIcon(getItem(itemId)), "mu-crumb-icon"),
      Object.assign(document.createElement("span"), {
        className: "mu-crumb-label",
        textContent: app ? app.name : itemLabel(itemId),
      })
    );
    crumb.title = `${itemLabel(itemId)} · ${itemId}`;
    if (index === shown.length - 1) crumb.classList.add("is-current");
    nav.append(crumb);
  });
  return nav;
}





































// ---- a card control that fills its window -----------------------------
// An item whose body is one control, and that control draws a card, can have
// that card fill its window: its header gets a button (`bi-arrows-angle-expand`,
// just after the shrink button), and pressed, the card's frame and header are
// gone and it fills the window; the window's title bar then has the button back
// (`action-contract`). Nothing is asked for: the shape of the body decides --
// beside anything else there is nothing for the card to fill the window
// instead of. The state is the window's (`expanded` on its frame, saved with
// the layout); a window whose item does not qualify ignores it.

function setExpanded(windowId, on) {
  const node = findLeaf(windowId);
  if (!node) return false;
  if (on) node.expanded = true;
  else delete node.expanded;
  commit({ keep: true, inPlace: true });
  paintExpanded(windowId);
  return true;
}

// The window wears the state: its class (the CSS takes the frame off the
// card), and the button that undoes it.
function paintExpanded(windowId) {
  const el = windowEl(windowId);
  const node = findLeaf(windowId);
  if (!el || !node) return;
  const on = Boolean(node.expanded && framesHooks.expandKey(windowId) && el.querySelector(".mu-card-expand"));
  el.classList.toggle("is-card-expanded", on);
  const button = el.querySelector(":scope > .mu-titlebar .action-contract");
  if (button) button.hidden = !on;
}

// ---- item lifecycle ---------------------------------------------------
// One entry per window that currently shows an item. mount/unmount follow
// the DOM; destroy follows the instance (see pruneItems).

// Four directions to drop beside, one in the middle to join, and one to
// trade places with. Joining is offered whenever a window is on its way in
// -- placed, split off, or dragged -- because all three are the same
// question asked of the same frame: beside it, or in with it? Trading is
// only a drag's, there being nothing to swap with when the guides are open
// to pick a side for something new, so split and place mode hide it.
function guidesMarkup() {
  return (
    Object.keys(DIRECTIONS)
      .map(
        (d) =>
          `<button class="mu-guide guide-${d}" type="button" data-dir="${d}" title="${escapeHtml(
            t("mu.win.guide", { dir: t(`mu.dir.${d}`) })
          )}">${DIRECTIONS[d].label}</button>`
      )
      .join("") +
    `<button class="mu-guide guide-group" type="button" data-dir="group" title="${escapeHtml(
      t("mu.win.group")
    )}">${iconMarkup("group")}</button>` +
    `<button class="mu-guide guide-swap" type="button" data-dir="swap" title="${escapeHtml(
      t("mu.win.swap")
    )}">${iconMarkup("swap")}</button>` +
    // A bay placeholder's only one: in the sash, in the placeholder's place.
    `<button class="mu-guide guide-register" type="button" data-dir="register">${iconMarkup("bay")}<span class="mu-guide-label"></span></button>` +
    // A group's own: open it, and offer its windows' guides instead.
    `<button class="mu-guide guide-inside" type="button" data-dir="inside" title="${escapeHtml(
      t("mu.win.inside")
    )}"><i class="bi bi-box-arrow-in-down-right" aria-hidden="true"></i></button>`
  );
}

// The tool buttons of a title bar a person may switch off, per window --
// `hiddenTools` on the frame's node, saved with the layout. Only the ones
// that act on the window; the menu and the way back from a bar (expand)
// stay, or a window could be left with no way to be undone.
// One switch per button, in the order they matter -- which is the order the
// window's settings lists them in. The bar gives way from its left, so the
// buttons on its right are the ones that matter most: the close button
// first, then what lies to its left.
const TITLE_TOOLS = ["close", "collapse", "pin", "nextSash", "prevSash", "presets"];
// What each looks like (an icon role), and the class of its button.
const TITLE_TOOL_ICONS = { collapse: "collapse", close: "close", pin: "pin", prevSash: "prevSash", nextSash: "nextSash", presets: "preset" };

// frames: a window's hidden title-bar tools and its pinned size are read with it.

function hiddenToolsOf(node) {
  const saved = Array.isArray(node && node.hiddenTools) ? node.hiddenTools : [];
  // "sash" was one switch for both the sash buttons.
  const wanted = saved.flatMap((tool) => (tool === "sash" ? ["prevSash", "nextSash"] : [tool]));
  return TITLE_TOOLS.filter((tool) => wanted.includes(tool));
}

function toolShown(frameId, tool) {
  const node = findLeaf(frameId);
  return !node || !hiddenToolsOf(node).includes(tool);
}

function setToolShown(frameId, tool, shown) {
  const node = findLeaf(frameId);
  if (!node || !TITLE_TOOLS.includes(tool)) return false;
  const hidden = new Set(hiddenToolsOf(node));
  if (shown) hidden.delete(tool);
  else hidden.add(tool);
  if (hidden.size) node.hiddenTools = TITLE_TOOLS.filter((one) => hidden.has(one));
  else delete node.hiddenTools;
  commit({ keep: true, inPlace: true });
  return true;
}


// {axis: "horizontal" | "vertical", reverse}: along which axis the sashes
// slide, and whether going forward comes the other way round. The buttons
// that move along them point the same way.
function bayAxisOf(bayFrameNode) {
  const record = bayFrameNode && bayFrameNode.bay ? bayRecord(bayFrameNode.bay) : null;
  const mode = record && BAY_SLIDES.includes(record.slide) ? record.slide : "auto";
  if (mode !== "auto") {
    // `left`: the next sash comes in from the left, so forward moves right.
    return { axis: mode === "left" || mode === "right" ? "horizontal" : "vertical", reverse: mode === "left" || mode === "up" };
  }
  const found = bayFrameNode && findParent(bayFrameNode.id);
  return { axis: found && found[0] && found[0].type === "split" && found[0].dir === "col" ? "vertical" : "horizontal", reverse: false };
}

// Whether a collapsed frame's bar lies sideways (a column along the left or
// right) for the context it was drawn in: beside something open in a row, or
// inside a bay that stands so with everything in it minimised.
function barSideways(context) {
  return Boolean(context && ((context.dir === "row" && context.siblingOpen) || context.inherit));
}

// The chrome every frame wears: the bar with its handle, its id and its four
// buttons, and the guides. A group is a window from the outside, so it is
// the same bar -- only what sits in the middle of it differs.
function buildFrame(node, context, middle) {
  const el = document.createElement("div");
  el.className = "mu-window";
  // Collapsed, the bar lies along the axis its parent splits -- a window
  // beside an open one becomes a narrow column -- but only while there is
  // an open window to make room for. Once everything alongside is collapsed
  // too, the bars share the space and are drawn the wide way round.
  // Which way the bar would lie if the room allows it: along the axis its
  // parent splits, unless everything alongside is collapsed too and the
  // bars are sharing the space rather than making room for anyone.
  const sideways = barSideways(context);
  el.dataset.bar = sideways ? "vertical" : "horizontal";
  if (node.collapsed) {
    el.classList.add("is-collapsed", sideways ? "is-vertical" : "is-horizontal");
  }
  el.dataset.id = node.id;
  // Only a bar has these, and only the ways it has somewhere to go.
  const toward = node.collapsed ? expandDirections(node) : [];
  // Registered in a bay -- framed by it directly, not inside something
  // that is (an app's windows) and not its placeholder: the way to its
  // next sash.
  const frame = node.bay ? null : groupOf(node.id);
  const bayRec = frame && frame.bay && !isSlotLeaf(node) ? bayRecord(frame.bay) : null;
  const slide = bayRec ? bayAxisOf(frame) : { axis: "horizontal", reverse: false };
  const axis = slide.axis;
  const sashButton = (kind) =>
    `<button class="mu-icon-button action-${kind}-sash is-${axis}${slide.reverse ? " is-reversed" : ""}" type="button" data-bay="${escapeHtml(bayRec.id)}" title="${escapeHtml(
      t(`mu.bay.${kind}`, { name: bayRec.name })
    )}"${bayRec.sashes.length < 2 ? " disabled" : ""}>${iconMarkup(`${kind}Sash`)}</button>`;
  const nextButton = bayRec ? `${sashButton("prev")}${sashButton("next")}` : "";
  // What the person switched off in this window's settings.
  hiddenToolsOf(node).forEach((tool) => el.classList.add(`no-tool-${tool}`));
  if (node.expanded) el.classList.add("is-card-expanded");

  // Focusable so the browser can move focus here, but out of the tab order:
  // tabbing should walk the controls inside a window, not the frames.
  el.tabIndex = -1;
  el.innerHTML = titlebarMarkup({
    id: node.id,
    middle,
    dragTitle: t("mu.win.drag"),
    actions: `
        <button class="mu-icon-button action-contract" type="button"${node.expanded ? "" : " hidden"} title="${escapeHtml(
          t("mu.win.contract")
        )}">${iconMarkup("contractCard")}</button>
        <button class="mu-icon-button action-presets" type="button" hidden title="${escapeHtml(
          t("mu.win.presets")
        )}">${iconMarkup("preset")}</button>
        <button class="mu-icon-button action-menu" type="button" title="${escapeHtml(
          t("mu.win.menu")
        )}">${iconMarkup("menu")}</button>
        ${nextButton}
        <button class="mu-icon-button action-expand" type="button" title="${escapeHtml(
          t("mu.win.expand")
        )}">${iconMarkup("expand")}</button>
        ${toward
          .map(
            (d) =>
              `<button class="mu-icon-button action-expand-toward" type="button" data-dir="${d}" title="${escapeHtml(
                t("mu.win.expandToward", { dir: t(`mu.dir.${d}`) })
              )}">${iconMarkup(`expand${d[0].toUpperCase()}${d.slice(1)}`)}</button>`
          )
          .join("")}
        <button class="mu-icon-button action-pin${node.pinned ? " is-active" : ""}" type="button" title="${escapeHtml(
          t(node.pinned ? "mu.win.unpin" : "mu.win.pin")
        )}">${iconMarkup(node.pinned ? "pinned" : "pin")}</button>
        <button class="mu-icon-button action-collapse" type="button" title="${escapeHtml(
          t("mu.win.collapse")
        )}">${iconMarkup("collapse")}</button>
        <button class="mu-icon-button action-delete" type="button" title="${escapeHtml(
          node.type === "group" ? t("mu.win.closeGroup") : t("mu.win.close")
        )}">${iconMarkup("close")}</button>`,
  });
  return el;
}

function buildWindow(node, context = null) {
  const el = buildFrame(node, context, `<span class="mu-window-title"></span>`);
  el.insertAdjacentHTML(
    "beforeend",
    `<div class="mu-body" data-role="body"></div>
     <div class="mu-notice" data-role="notice" hidden></div>
     <div class="mu-guides" hidden>${guidesMarkup()}</div>
     <div class="mu-link-strip"></div>`
  );
  el.querySelector(".mu-window-title").append(buildBreadcrumbs(node));
  if (isSlotLeaf(node)) {
    el.classList.add("is-bay-slot");
    el.querySelector(".action-delete").title = t("mu.bay.remove");
    const bay = bayOf(node.id);
    const sash = bay && activeSash(bayRecord(bay.bay));
    const label = t("mu.bay.register", { sash: sash ? sash.name : "" });
    const register = el.querySelector(":scope > .mu-guides > .guide-register");
    register.title = label;
    register.lastElementChild.textContent = label;
  }
  wireWindow(el, node.id);
  return el;
}

// A group: the same frame a window wears, with a layout inside it instead
// of an item. What the title bar says in the middle is what the frame holds
// -- the group's icon and how many windows are in it -- where a window says
// the path to what it is showing.
function buildGroup(node, context = null) {
  const el = buildFrame(node, context, `<span class="mu-window-title"></span>`);
  el.classList.add("is-group");
  // The stage's own frame: it has nowhere to be dragged, nothing beside it
  // to split into, and closing it would be closing everything -- so its bar
  // is the title and the id, and nothing that would move it.
  if (node === layoutRoot()) el.classList.add("is-root");
  if (node.bay) el.classList.add("is-bay");

  // A group launched as an app is that app: `defaultItem` is what a new
  // window in it becomes, which is the one thing a frame can be said to
  // hold, so the bar is named after it. A frame that holds nothing in
  // particular -- the stage, or a group somebody made by dropping two
  // windows together -- is named after nothing: "group, 4 windows" counted
  // what the frame already shows and named what it already looks like.
  const held = node.defaultItem === ROOT_DEFAULT_ITEM ? null : knownType(node.defaultItem);
  // Showing one of its screens: the bar is that path, and the body is the
  // screen's, mounted like any window's (see render).
  if (screensOf(node).length) {
    el.classList.add("has-screen");
    el.querySelector(".mu-window-title").append(buildGroupCrumbs(node, held));
    el.insertAdjacentHTML(
      "beforeend",
      `<div class="mu-body" data-role="body"></div>
       <div class="mu-notice" data-role="notice" hidden></div>
       <div class="mu-guides" hidden>${guidesMarkup()}</div>`
    );
    wireWindow(el, node.id);
    return el;
  }
  const app = node.app ? appDef(node.app) : null;
  if (held || app) {
    const title = document.createElement("span");
    title.className = "mu-group-title";
    title.append(
      iconEl(app ? app.icon || "window" : ITEM_TYPES[held].icon || "group", "mu-group-icon"),
      Object.assign(document.createElement("span"), {
        className: "mu-group-label",
        textContent: app ? app.name : t(ITEM_TYPES[held].label),
      })
    );
    el.querySelector(".mu-window-title").append(title);
  }

  el.insertAdjacentHTML(
    "beforeend",
    `<div class="mu-group-body"></div>
     <div class="mu-guides" hidden>${guidesMarkup()}</div>`
  );
  const content = groupContent(node);
  // Nothing special about what goes inside: it is the same builder the
  // stage uses, so a group holds splits, windows and groups alike.
  // A bay passes on where it sits, so a window folded in it lies the way
  // it would beside its neighbours outside.
  if (content) {
    const inner = node.bay ? context : stageContext(node);
    const drawn = buildNode(content, inner);
    drawn.classList.toggle("is-compact", Boolean(inner && inner.compact));
    el.querySelector(".mu-group-body").append(drawn);
  }
  wireWindow(el, node.id);
  return el;
}

function buildOverlay(node) {
  const overlay = document.createElement("div");
  overlay.className = "mu-resize-overlay";
  overlay.hidden = true;

  const horizontal = node.dir === "row";
  SNAP_RATIOS.forEach((value) => {
    const guide = document.createElement("div");
    guide.className = "mu-rguide";
    guide.dataset.ratio = String(value);
    guide.style[horizontal ? "left" : "top"] = `${value * 100}%`;
    guide.textContent = `${value * 100}%`;
    overlay.append(guide);
  });

  const live = document.createElement("div");
  live.className = "mu-rlive";
  const label = document.createElement("div");
  label.className = "mu-rlabel";
  overlay.append(live, label);
  return overlay;
}

// What each split node drew, so a drag can be handed to a node the surgery
// has just created. Keyed by the node object, so it goes away with it.
const splitCtx = new WeakMap();

function buildNode(node, context = null) {
  if (node.type === "leaf") return buildWindow(node, context);
  if (node.type === "group") return buildGroup(node, context);

  const el = document.createElement("div");
  el.className = `mu-split dir-${node.dir}`;

  const ratio = ratioOf(node);
  const shut = node.children.map(allCollapsed);
  // "Alongside" means along this axis, not just the one sibling this split
  // happens to pair a child with. Two windows collapsed side by side in a
  // row that also holds an open one are a split of their own inside that
  // row, and each of them sees only the other -- collapsed -- so both used
  // to decide there was nothing to make room for and lay their bars across,
  // leaving two tall columns each with a bar along the top. Whatever the
  // split around this one said about the other side still holds for
  // everything in here that lies along the same axis.
  const childEls = node.children.map((child, i) =>
    // Whether the other side still wants space decides both how this child
    // is sized and, if it is collapsed, which way its bar lies.
    buildNode(child, splitChildContext(node, context, shut, i))
  );
  applyRatio(childEls, ratio, node);

  const resizer = document.createElement("div");
  resizer.className = "mu-resizer";
  // A collapsed child is sized by its own bar, so the ratio has nothing to
  // divide and dragging the seam would do nothing. Say so by not offering --
  // unless the bar stands between two open windows, where this seam is the
  // edge of the one beyond it and dragging it is a thing to want: it moves
  // the two open windows' edges, the bars sliding between (see
  // isolateAcrossBars). `is-relay` says there is such a pair to move.
  if (node.children.some(allCollapsed)) {
    resizer.classList.add(seamRelay(node) ? "is-relay" : "is-inert");
  } else if (node.children.some((child) => pinnedSize(child, node.dir) !== null)) {
    // A frame held to its size has no share of the room to give or take.
    resizer.classList.add("is-inert");
  }

  const across = node.dir === "row" ? ["top", "height"] : ["left", "width"];
  const segments = seamSegments(node);
  const segEls = segments.map(([from, to]) => {
    const seg = document.createElement("div");
    seg.className = "mu-seg";
    seg.dataset.from = String(from);
    seg.dataset.to = String(to);
    seg.style[across[0]] = `${from * 100}%`;
    seg.style[across[1]] = `${(to - from) * 100}%`;
    seg.title = t(node.dir === "row" ? "mu.win.resizeRow" : "mu.win.resizeCol");
    return seg;
  });
  resizer.append(...segEls);
  markQuietBands(node, segEls);

  const overlay = buildOverlay(node);
  el.append(childEls[0], resizer, childEls[1], overlay);
  const ctx = { node, splitEl: el, childEls, overlay, segEls };
  splitCtx.set(node, ctx);
  resizer.__ctx = ctx;
  wireResizer(resizer, ctx);
  return el;
}

// A frame can be pinned: it keeps the size it had when the pin was pressed
// -- `pinned: {width, height}` on its node, in px, saved with the layout --
// however the windows around it are folded, closed or moved about. The
// room that is left is shared by the rest.
function pinOf(node) {
  const one = node && node.pinned;
  if (!one || typeof one !== "object") return null;
  const width = Math.round(Number(one.width));
  const height = Math.round(Number(one.height));
  return width > 0 && height > 0 ? { width, height } : null;
}

// How much room a node is held to along a split's axis (`dir`): a size in
// px, "auto" when what it is held to is its own content (a pinned frame beside
// bars is as wide as the two together, and the bar is the bar's own size), or
// null when it is not held. A pinned frame is held to its size. Two things
// side by side along the axis are held when each is held or is a bar; two
// across it share the one size along the axis, so one of them being held holds
// the lot. A group is a frame of its own: what is pinned inside it is held
// inside it.
// How thick the seam between two children is, along a split's axis. Two
// frames held to their sizes side by side are held to the two and the seam
// between them: held to the sizes alone, the split was short by a seam and
// the pair gave way by half of it each -- the frame pinned first shrank when
// the one beside it was pinned.
function seamSize(dir) {
  const seam = stage.querySelector(".mu-resizer");
  if (!seam) return 0;
  const box = seam.getBoundingClientRect();
  const size = dir === "row" ? box.width : box.height;
  return size > 0 ? Math.round(size) : 0;
}

function pinnedSize(node, dir) {
  if (!node || allCollapsed(node)) return null;
  const prop = dir === "row" ? "width" : "height";
  if (node.type === "split") {
    const sizes = node.children.map((child) => pinnedSize(child, dir));
    if (node.dir === dir) {
      const settled = node.children.every((child, i) => sizes[i] !== null || allCollapsed(child));
      if (!settled || sizes.every((size) => size === null)) return null;
      return sizes.every((size) => typeof size === "number") ? sizes[0] + sizes[1] + seamSize(dir) : "auto";
    }
    return sizes.find((size) => size !== null) ?? null;
  }
  const pin = pinOf(node);
  return pin ? pin[prop] : null;
}

// A child held to a size from pinnedSize(), laid out as that: the size as a
// width (or height) of its own rather than a flex basis, because a split
// held to its content is as wide as what is in it, and a flex container
// counts its items' widths, not their bases.
function holdChild(el, size, dir) {
  const prop = dir === "row" ? "width" : "height";
  if (size === "auto") {
    el.style.flex = "0 0 auto";
    el.style[prop] = "";
    return;
  }
  el.style.flex = "0 1 auto";
  el.style[prop] = `${size}px`;
}

// Pin a frame at the size it has now, or let it go.
function setPinned(id, on) {
  const node = findLeaf(id);
  const el = windowEl(id);
  if (!node || node === layoutRoot() || !el) return false;
  if (on) {
    if (node.collapsed) return false;
    const box = el.getBoundingClientRect();
    node.pinned = { width: Math.round(box.width), height: Math.round(box.height) };
  } else {
    delete node.pinned;
  }
  commit({ keep: true, inPlace: true });
  return true;
}

function togglePinned(id) {
  const node = findLeaf(id);
  return node ? setPinned(id, !pinOf(node)) : false;
}

// What a layout is made of, as one string, leaving out what folding and
// resizing change -- which windows and frames there are, and where. A drawn
// layout that still has this shape can be brought up to date where it
// stands (see patchLayout).
let renderedShape = "";

function shapeOf(node) {
  if (!node) return "";
  if (node.type === "leaf") return `L${node.id}:${node.path.join(">")}:${node.app || ""}`;
  if (node.type === "group") {
    return `G${node.id}:${node.bay || ""}:${node.app || ""}:${node.appItem || ""}:${node.defaultItem || ""}:${screensOf(node).join(">")}(${node.children.map(shapeOf).join(",")})`;
  }
  return `S${node.dir}(${node.children.map(shapeOf).join(",")})`;
}

// A fold, an opening, a button switched off: the layout is the same
// windows in the same places, so the frames that are on screen are changed
// where they stand -- a class, a flex size, the buttons that open a bar --
// instead of being built again and every window's contents put back into
// them. What stays keeps its layout too, which is most of what building
// again cost. Gives up (false) at anything it does not know how to change,
// and the caller draws everything.
function patchLayout() {
  if (!layoutRoot() || placing || pendingMove || dragSourceId || resizing) return false;
  frameRoot();
  normalizeBays();
  repairPaths();
  pruneItems();
  if (shapeOf(layoutRoot()) !== renderedShape) return false;
  const frames = new Map();
  stage.querySelectorAll(".mu-window").forEach((el) => frames.set(el.dataset.id, el));
  let ok = true;
  const walk = (node, context) => {
    if (!ok) return;
    if (node.type === "split") {
      const drawn = splitCtx.get(node);
      if (!drawn) {
        ok = false;
        return;
      }
      const shut = node.children.map(allCollapsed);
      node.children.forEach((child, i) => walk(child, splitChildContext(node, context, shut, i)));
      applyRatio(drawn.childEls, ratioOf(node), node);
      const resizer = drawn.segEls[0] && drawn.segEls[0].parentElement;
      if (resizer) {
        resizer.classList.remove("is-relay", "is-inert");
        if (node.children.some(allCollapsed)) resizer.classList.add(seamRelay(node) ? "is-relay" : "is-inert");
        else if (node.children.some((child) => pinnedSize(child, node.dir) !== null)) resizer.classList.add("is-inert");
      }
      markQuietBands(node, drawn.segEls);
      // The seam's pieces follow the ratios; a different cut is a different
      // seam, which is built, not patched.
      const pieces = seamSegments(node);
      if (pieces.length !== drawn.segEls.length || pieces.some(([from, to], i) => drawn.segEls[i].dataset.from !== String(from) || drawn.segEls[i].dataset.to !== String(to))) {
        ok = false;
      }
      return;
    }
    const el = frames.get(node.id);
    if (!el) {
      ok = false;
      return;
    }
    patchFrame(el, node, context);
    if (node.type === "group") {
      const content = groupContent(node);
      if (content) {
        const inner = node.bay ? context : stageContext(node);
        walk(content, inner);
        const drawn = splitCtx.get(content);
        if (drawn) drawn.splitEl.classList.toggle("is-compact", Boolean(inner && inner.compact));
      }
    }
  };
  walk(layoutRoot(), null);
  return ok;
}

// One frame brought up to date with its node: what buildFrame sets from the
// node's state.
function patchFrame(el, node, context) {
  const collapsed = Boolean(node.collapsed);
  const sideways = barSideways(context);
  el.dataset.bar = sideways ? "vertical" : "horizontal";
  el.classList.toggle("is-collapsed", collapsed);
  el.classList.toggle("is-vertical", collapsed && sideways);
  el.classList.toggle("is-horizontal", collapsed && !sideways);
  const hidden = hiddenToolsOf(node);
  for (const tool of TITLE_TOOLS) el.classList.toggle(`no-tool-${tool}`, hidden.includes(tool));
  const pin = el.querySelector(":scope > .mu-titlebar .action-pin");
  if (pin) {
    const pinned = Boolean(pinOf(node));
    pin.classList.toggle("is-active", pinned);
    pin.title = t(pinned ? "mu.win.unpin" : "mu.win.pin");
    setIcon(pin, pinned ? "pinned" : "pin");
  }
  // The ways a bar can open into what is beside it.
  const actions = el.querySelector(":scope > .mu-titlebar > .mu-title-actions");
  const anchor = actions && actions.querySelector(".action-collapse");
  if (!anchor) return;
  const wanted = collapsed ? expandDirections(node) : [];
  const have = Array.from(actions.querySelectorAll(".action-expand-toward"));
  if (have.map((button) => button.dataset.dir).join() === wanted.join()) return;
  have.forEach((button) => button.remove());
  for (const direction of wanted) {
    const button = document.createElement("button");
    button.className = "mu-icon-button action-expand-toward";
    button.type = "button";
    button.dataset.dir = direction;
    button.title = t("mu.win.expandToward", { dir: t(`mu.dir.${direction}`) });
    button.innerHTML = iconMarkup(`expand${direction[0].toUpperCase()}${direction.slice(1)}`);
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      expandToward(node.id, direction);
    });
    anchor.before(button);
  }
}

// A bar needs room along its own length for the handle, the item's icon and
// the two buttons. Below this it cannot show all four, and the icon is the
// first thing squeezed out -- which is the one thing the bar is for.
const MIN_BAR = 104; // px: 1.125 + 1.25 + 2 x 1.75rem, plus the gaps

const BAR_BUTTON = 28; // px: one more 1.75rem button

// Settle which way every bar lies, and label the buttons with it. Runs
// after layout because it is a measurement, and starts from the tree's
// preference every time so that the same layout always gives the same
// answer rather than alternating between two.
function fitBars() {
  // Measuring and changing are kept apart, one pass each over every window.
  // Done window by window, each change made the next measurement lay the
  // whole page out again -- a layout with a few dozen windows spent most of
  // a fold or an open in that.
  const frames = Array.from(stage.querySelectorAll(".mu-window")).map((el) => ({
    el,
    preferred: el.dataset.bar === "vertical" ? "vertical" : "horizontal",
    collapsed: el.classList.contains("is-collapsed"),
  }));

  // 1. How a collapsed bar lies is the tree's preference to begin with, so
  //    that the same layout always gives the same answer.
  for (const one of frames) {
    if (!one.collapsed) continue;
    one.el.classList.toggle("is-vertical", one.preferred === "vertical");
    one.el.classList.toggle("is-horizontal", one.preferred === "horizontal");
  }
  // 2. How long the bar may be -- read once, for all of them.
  for (const one of frames) {
    // For a window still open that is its own width or height: what it has
    // now is what the bar would get. For one already collapsed it is the
    // parent's, because a collapsed window is sized by its own content along
    // that axis -- measuring itself would ask how wide its buttons are
    // rather than how much room there is, and a lone window collapsed to a
    // bar across the top would answer by becoming a sliver down the side.
    let host = one.collapsed ? one.el.parentElement || one.el : one.el;
    if (one.collapsed && host.classList.contains("mu-group-body") && host.parentElement.classList.contains("is-bay")) {
      host = host.parentElement.parentElement || host;
    }
    const box = host.getBoundingClientRect();
    const room = one.preferred === "horizontal" ? box.width : box.height;
    // Each way it can expand into is one more button the bar has to hold.
    const extra = one.el.querySelectorAll(":scope > .mu-titlebar .action-expand-toward").length;
    one.actual = room >= MIN_BAR + extra * BAR_BUTTON ? one.preferred : one.preferred === "horizontal" ? "vertical" : "horizontal";
  }
  // 3. Which way each bar lies is settled; the buttons say it.
  for (const one of frames) {
    if (one.collapsed) {
      one.el.classList.toggle("is-vertical", one.actual === "vertical");
      one.el.classList.toggle("is-horizontal", one.actual === "horizontal");
    }
    const vertical = one.actual === "vertical";
    setIcon(one.el.querySelector(".action-collapse"), vertical ? "collapseVertical" : "collapse");
    setIcon(one.el.querySelector(".action-expand"), vertical ? "expandVertical" : "expand");
  }
  // 4. Wide enough to wear its own buttons? An open window's bar lies across
  //    the top whatever the tree would prefer -- only a collapsed one ever
  //    turns on its side -- so this is the window's own width, not the room
  //    `actual` was decided from.
  fitBarsTools(frames);
  // 5. The titles, last, in what room the buttons left.
  placeTitles(frames);
}

// What an open bar gives up when it is short of room, in the order a card's
// header does: first its buttons, folded into the one that opens them
// (is-tools-folded), and only then its title -- the path down to the
// current item's icon (is-narrow). Measured, not by a fixed width: a bar
// with a short title keeps its buttons longer than one with a long path.
//
// Every bar at once: all are put back to start from, then all measured, then
// the ones that do not fit are folded, and those measured again.
function fitBarsTools(frames) {
  const bars = [];
  for (const { el, collapsed } of frames) {
    el.classList.remove("is-tools-folded", "is-narrow");
    if (collapsed) continue;
    const bar = el.querySelector(":scope > .mu-titlebar");
    const title = bar && bar.querySelector(":scope > .mu-window-title");
    if (!title) continue;
    // The title at its own width, whatever it was allowed before.
    title.style.maxWidth = "none";
    bars.push({ el, bar, title, start: bar.querySelector(":scope > .mu-window-id"), end: bar.querySelector(":scope > .mu-title-actions") });
  }
  const measure = (one) => {
    const box = one.bar.getBoundingClientRect();
    if (!box.width) return null;
    const lo = (one.start && one.start.offsetWidth ? one.start.getBoundingClientRect().right - box.left : 0) + TITLE_GAP;
    const hi = (one.end && one.end.offsetWidth ? one.end.getBoundingClientRect().left - box.left : box.width) - TITLE_GAP;
    return { wanted: one.title.getBoundingClientRect().width, room: hi - lo };
  };
  const tight = bars.filter((one) => {
    const m = measure(one);
    return m && m.wanted > m.room;
  });
  tight.forEach((one) => one.el.classList.add("is-tools-folded"));
  // Each bar is measured on its own, so all are read before any is changed:
  // a change between two reads would lay the page out again for each.
  const narrow = tight.filter((one) => {
    const m = measure(one);
    return m && m.wanted > m.room;
  });
  narrow.forEach((one) => one.el.classList.add("is-narrow"));
  bars.forEach((one) => {
    one.title.style.maxWidth = "";
  });
}

function placeTitle(el) {
  placeTitles([{ el, collapsed: el.classList.contains("is-collapsed") }]);
}

// Every title at once: put back to their own widths, measured together, and
// only then placed.
function placeTitles(frames) {
  const titles = [];
  for (const { el } of frames) {
    const bar = el.querySelector(":scope > .mu-titlebar");
    const title = bar && bar.querySelector(":scope > .mu-window-title");
    if (!title) continue;
    title.style.left = "";
    title.style.transform = "";
    title.style.maxWidth = "";
    if (el.classList.contains("is-collapsed")) continue;
    titles.push({ bar, title, start: bar.querySelector(":scope > .mu-window-id"), end: bar.querySelector(":scope > .mu-title-actions") });
  }
  // The room each has, read in one go.
  for (const one of titles) {
    const box = bar_box(one.bar);
    one.box = box;
    if (!box.width) continue;
    const lo = (one.start && one.start.offsetWidth ? one.start.getBoundingClientRect().right - box.left : 0) + TITLE_GAP;
    const hi = (one.end && one.end.offsetWidth ? one.end.getBoundingClientRect().left - box.left : box.width) - TITLE_GAP;
    one.lo = lo;
    one.hi = hi;
    one.room = Math.max(0, hi - lo);
  }
  const live = titles.filter((one) => one.box.width);
  for (const one of live) {
    one.title.style.maxWidth = `${one.room}px`;
    one.title.style.transform = "none";
  }
  // Their widths with that room, read in one go.
  for (const one of live) one.width = one.title.getBoundingClientRect().width;
  for (const one of live) {
    const left = Math.max(one.lo, Math.min((one.box.width - one.width) / 2, one.hi - one.width));
    one.title.style.left = `${left}px`;
  }
}

function bar_box(bar) {
  return bar.getBoundingClientRect();
}

// Drawing a change of one window's path in place, when the rest of the
// layout is as it was drawn; otherwise the whole layout (frames).
function drawPathChange(windowId, before) {
  const node = findLeaf(windowId);
  const el = windowEl(windowId);
  if (!node || node.type !== "leaf" || !el || placing || pendingMove || dragSourceId || resizing) return drawLayoutChange();
  // Settling the tree is the layout's, but stays here, after the checks
  // above, as before (render settles after ending a placement).
  settleLayout();
  // The layout as it was drawn, with only this window's path changed.
  const was = `L${node.id}:${before.join(">")}:${node.app || ""}`;
  const now = shapeOf(node);
  if (!renderedShape.includes(was) || shapeOf(layoutRoot()) !== renderedShape.replace(was, now)) return drawLayoutChange();
  const body = el.querySelector(':scope > [data-role="body"]');
  const title = el.querySelector(":scope > .mu-titlebar .mu-window-title");
  if (!body || !title) return drawLayoutChange();
  framesHooks.unmount(windowId);
  title.replaceChildren(buildBreadcrumbs(node));
  framesHooks.mount(windowId, body);
  renderedShape = shapeOf(layoutRoot());
  restoreFocus();
  fitBars();
  framesHooks.refresh();
  framesHooks.layoutMoved(null, true);
}

// Drawing a change of the layout: in place when asked and possible, else
// the whole of it (frames).
function drawLayoutChange(options = { keep: true }) {
  if (options.inPlace && patchLayout()) {
    fitBars();
    framesHooks.refresh();
    // What reads the layout is told it moved; sizes changed, so the rows of
    // property tables fit again.
    framesHooks.layoutMoved();
    scheduleFitPropRows();
  } else {
    render(options);
  }
}

// frames: draw what changed.

// `keep`: the layout changed and the windows' contents did not -- a window
// folded or opened, a sash moved on. Each window that is still there with the
// same item keeps the body it has, moved into its new frame instead of being
// torn down and built again; only what reads the layout is drawn again.
// `quiet` is for a change of shape that moves nothing the windows can see (the
// frames of a seam about to be dragged): the bodies are kept and not asked
// whether the layout they read has changed.
function render({ keep = false, quiet = false } = {}) {
  placing = null;
  dragSourceId = null;
  pendingMove = null;
  openedGroups.clear();
  guidePredicate = null;
  windowModes.clear();
  settleLayout();
  // The whole layout is rebuilt here, so every mounted item leaves the DOM
  // and has to be told (mount), or is held aside to move into its new frame.
  const kept = framesHooks.detach(keep);
  stage.replaceChildren();
  if (layoutRoot()) stage.append(buildNode(layoutRoot()));
  // What every body is drawn from -- the links between items, and which
  // window is active -- is settled before they are drawn, so that each is
  // drawn once instead of once as it is mounted and again when everything is
  // in place.
  syncLinks();
  restoreFocus();
  // By the body rather than by the frame: a group is a frame with no body
  // of its own, and the windows inside it are found the same way as any.
  const { arrived, left, reused } = framesHooks.attach(stage, kept);
  fitBars();

  const count = countLeaves(layoutRoot());
  stage.hidden = count === 0;
  emptyState.hidden = count > 0;
  framesHooks.refresh();
  renderedShape = shapeOf(layoutRoot());
  // A window coming or going changes which apps are on screen, which a
  // folding does not.
  if (reused.size && !quiet) framesHooks.settle(reused, arrived > 0 || left > 0);
}

// The colour an app has chosen for its windows, or "": the type setting
// of the item in the window or of any item that owns it -- so an app's
// preview and the editors it owns all wear the app's colour, and nothing
// below the app has to know it has one. A window's settings wear the
// colour of what they set up, so a colour chosen there shows where it is
// chosen.
function tintOf(item, windowId = null) {
  // The app the window is part of says, first; a window's settings wear
  // the colour of the window they set up.
  // An app inside a group follows the group's theme -- the nearest frame
  // around it that is an app, a group in a group having its own -- and only
  // a window outside every app's frame has an app of its own to wear.
  const at = item && item.type === WINDOW_SETTINGS_TYPE ? item.props.frame : windowId;
  for (let up = at ? groupOf(at) : null; up; up = groupOf(up.id)) {
    const own = up.app ? appDef(up.app) : null;
    if (own) return own.accent || "";
  }
  const framed = appOfWindow(at);
  if (framed) return framed.accent || "";
  const current = item && item.type === WINDOW_SETTINGS_TYPE ? getItem(item.props.target) : item;
  // Out of any app's frame -- a preview opened on its own -- an item wears
  // its own app's colour: the built-in app of its type or an owner's.
  const def = current && ITEM_TYPES[current.type];
  if (def && isStandalone(def)) {
    const own = appDef(current.type);
    if (own && own.accent) return own.accent;
  }
  return "";
}

// Worn as the window's own accent, so everything inside that already asks
// for the accent -- a primary button, a focused field, the title bar --
// takes the app's colour without being told.
function applyTint(windowId, item) {
  const el = windowEl(windowId);
  if (!el) return;
  const tint = tintOf(item, windowId);
  // Said as a class as well, for the bar: the accent alone cannot tell a
  // window that chose a colour from one wearing the theme's.
  el.classList.toggle("has-tint", Boolean(tint));
  if (tint) {
    if (el.style.getPropertyValue("--accent") !== tint) el.style.setProperty("--accent", tint);
  } else if (el.style.getPropertyValue("--accent")) {
    el.style.removeProperty("--accent");
  }
}

// An app's frame wears the app's colour as well: its bar is the app's name,
// and a frame in one colour around windows in another said two things.
// The app a frame is, when it was never made one: a group put together by
// hand has no app of its own, but if every window in it is a window of one
// app, that is what it is -- its colour is that app's, and its settings are
// that app's. Null for a mix, or windows that belong to no app.

function windowEl(id) {
  return stage.querySelector(`.mu-window[data-id="${CSS.escape(id)}"]`);
}

// An item's own message, shown in that item's own window and gone a few
// seconds later. Transient by design -- it is not part of the item's state
// and is never saved -- which is why it is written to the DOM and nowhere
// else. A render rebuilds the windows and clears them, and that is fine:
// nothing that matters is ever only a notice.

// What a window is in the middle of, as the window facts say it. It changes
// at every pointer move over a guide while something is dragged, and drawing
// an item's whole body for each was the lag: only a window that reads the
// layout can show it, and only when it is a different mode than it was.
function setWindowMode(id, mode) {
  if (windowModes.get(id) === mode) return;
  windowModes.set(id, mode);
  framesHooks.windowChanged(id);
}

// ---- guide visibility -------------------------------------------------
// An expanded group is full of windows offering guides of their own, and
// its own guides would lie over every one of them -- so it offers them only
// when it was asked for them (its way inside, when something is on its way
// in), where nothing else is competing for the same square of screen. Collapsed, it has no inside
// to cover, and it offers them like any other bar.
//
// So while a window is on its way somewhere -- dragged or placed -- an
// expanded group offers its guides along its own title bar instead, laid
// out the way a collapsed bar's are. The inside stays its windows'; the
// bar is the group's, and dropping there means beside the whole group,
// into it, or in its place. It is also the one way for a window inside a
// group to get out of it: its own group's bar is a target like any other.
//
// That changed (2026-10): dropping on the group itself -- beside it, into
// it, in its place -- is what is wanted far more often than reaching a
// window inside it, and a title bar is a narrow place to aim for. So an
// expanded group now offers its guides over the whole of itself, the way
// any window does, and the windows inside offer none. In the middle, next
// to the usual two, is one more guide: open the group. Pressed (in place
// mode) or dropped on (while dragging), the group's guides go and its
// windows' guides come, and the same again for a group inside it.
function showGuides(predicate) {
  guidePredicate = predicate;
  paintGuides();
}

function paintGuides() {
  if (!guidePredicate) return;
  // A window being moved from inside a group starts there: the group it is
  // in (and any around that) is open from the first, its windows offering
  // their guides, and the group's own guides go along its title bar -- the
  // way out of it.
  const source = dragSourceId || pendingMove;
  const home = new Set();
  for (let up = source && windowEl(source) && windowEl(source).parentElement.closest(".mu-window.is-group"); up; up = up.parentElement && up.parentElement.closest(".mu-window.is-group")) {
    if (!up.classList.contains("is-root") && !up.classList.contains("is-bay")) home.add(up.dataset.id);
  }
  const opened = (group) =>
    group.classList.contains("is-root") || group.classList.contains("is-bay") || openedGroups.has(group.dataset.id) || home.has(group.dataset.id);
  stage.querySelectorAll(".mu-window").forEach((el) => {
    const id = el.dataset.id;
    const guides = el.querySelector(":scope > .mu-guides");
    const group = el.classList.contains("is-group") && !el.classList.contains("is-collapsed") && !el.classList.contains("is-root");
    // Reachable: every expanded group around it has been opened.
    let reachable = true;
    for (let up = el.parentElement && el.parentElement.closest(".mu-window.is-group"); up; up = up.parentElement && up.parentElement.closest(".mu-window.is-group")) {
      if (!up.classList.contains("is-collapsed") && !opened(up)) {
        reachable = false;
        break;
      }
    }
    // `:scope >` throughout: a group holds whole windows, so an unscoped
    // query for anything below the title bar would find one of theirs.
    // The root is the stage: there is no beside it and nothing to swap it
    // with, so it never offers a guide at all.
    const homeBar = group && home.has(id) && !openedGroups.has(id);
    const shown = reachable && guidePredicate(id) && !el.classList.contains("is-root") && (!(group && opened(el)) || homeBar);
    guides.hidden = !shown;
    el.classList.toggle("has-bar-guides", homeBar && shown);
    // The way inside: for a group, when what is on its way could go there.
    el.classList.toggle("has-inside", group && shown && !homeBar);
  });
}

function openGroupGuides(id) {
  openedGroups.add(id);
  paintGuides();
}

// The window that was dropped on a group's way inside, still waiting for
// where it goes. Escape, or a click on no guide, puts it back.
function startPendingMove(source) {
  pendingMove = source;
  const el = windowEl(source);
  if (el) el.classList.add("is-drag-source");
  setWindowMode(source, t("mu.wmode.pending"));
}

function exitPendingMove() {
  if (!pendingMove) return false;
  const source = pendingMove;
  pendingMove = null;
  const el = windowEl(source);
  if (el) el.classList.remove("is-drag-source");
  setWindowMode(source, t("mu.wmode.idle"));
  hideGuides();
  return true;
}

function hideGuides() {
  guidePredicate = null;
  openedGroups.clear();
  stage.querySelectorAll(".mu-guides").forEach((g) => {
    g.hidden = true;
  });
  stage.querySelectorAll(".mu-window.has-bar-guides").forEach((el) => el.classList.remove("has-bar-guides"));
  stage.querySelectorAll(".mu-guide.is-over").forEach((g) => g.classList.remove("is-over"));
}

// Placement: every window offers its guides, and the one clicked says where
// the new window goes. Nothing is marked as the target -- they all are.
// What is being placed is a content spec, not a type: one name is one
// window and anything with an arrangement to it is a group (see
// contentNode). The old one-type call reads unchanged.
//
// The spec is checked here rather than when a guide is clicked, so a bad
// one is an error where it was asked for instead of a mode that turns out
// to do nothing.
function enterPlaceMode(spec) {
  const request = spec === undefined ? DEFAULT_ITEM_TYPE : spec;
  checkContent(request);
  placing = { content: request };
  showGuides(() => true);
  stage.querySelectorAll(".mu-window").forEach((el) => el.classList.add("is-place-mode"));
  leafIds(layoutRoot()).forEach((id) => setWindowMode(id, t("mu.wmode.place")));
  return true;
}

// Same guides, for a node made when one is clicked (`make`, null for
// nothing after all). Never inside a bay: a bay does not hold another.
function enterPlaceNode(make, where = (wid) => !bayOf(wid)) {
  placing = { make };
  showGuides(where);
  stage.querySelectorAll(".mu-window").forEach((el) => el.classList.add("is-place-mode"));
  leafIds(layoutRoot()).forEach((id) => setWindowMode(id, t("mu.wmode.place")));
  return true;
}

function exitPlaceMode() {
  if (!placing) return false;
  placing = null;
  hideGuides();
  stage.querySelectorAll(".mu-window").forEach((el) => el.classList.remove("is-place-mode"));
  leafIds(layoutRoot()).forEach((id) => setWindowMode(id, t("mu.wmode.idle")));
  return true;
}




// How many bar motions are playing: the stage stops clipping bars while
// any is, and starts again only when the last has ended -- not when the
// first of two quick folds does, which cut the second off half way.
let barMotions = 0;

function frameRects() {
  const rects = new Map();
  stage.querySelectorAll(".mu-window:not(.is-root)").forEach((el) => {
    const bar = el.querySelector(":scope > .mu-titlebar");
    if (!el.getClientRects().length) return;
    rects.set(el.dataset.id, {
      frame: el.getBoundingClientRect(),
      bar: bar && bar.getClientRects().length ? bar.getBoundingClientRect() : null,
    });
  });
  return rects;
}

// Animations made over a layout that was rebuilt a moment ago: held at
// their first frame until the page has drawn it, then played. Started at
// once, their clock ran through the heavy frames the rebuild costs (laying
// out, painting and mounting every window anew), and they showed up part
// way through -- the jump the longer the rebuild took. `done` runs once
// they are over. A page that draws no frames (hidden) never gets to play
// them: they are finished on the spot instead.
function playSettled(anims, done) {
  anims.forEach((one) => one.pause());
  let started = false;
  let ended = false;
  const end = () => {
    if (ended) return;
    ended = true;
    done();
  };
  const finishAll = () =>
    anims.forEach((one) => {
      try {
        one.finish();
      } catch {
        /* gone with the layout it was over */
      }
    });
  const start = () => {
    if (started) return;
    started = true;
    anims.forEach((one) => one.play());
    Promise.allSettled(anims.map((one) => one.finished)).then(end);
    // By the clock as well, should a frame never come to end them.
    setTimeout(() => {
      finishAll();
      end();
    }, motionMs() + 150);
  };
  // Two frames: the first draws the rebuilt layout (and whatever it sets
  // off -- resize observers, bars fitted), the second is where motion
  // begins.
  requestAnimationFrame(() => requestAnimationFrame(start));
  setTimeout(() => {
    if (started) return;
    started = true;
    finishAll();
    end();
  }, 500);
}

// Run a change that folds or opens windows, with the frames moving.
//
// Each window is laid out where it ends up; what moves is how much of it
// shows. Its clip starts at the rectangle it had and ends at its own box --
// past the box where it was bigger, with its own colour painted out there
// for the while (a spread shadow) -- so neighbours share every moving edge
// and the seam between them travels with it. The bar slides with the
// frame's top-left, its colour stretched along to the frame's sides.
function withBarMotion(change) {
  if (lessMotion() || !layoutRoot()) return change();
  const before = frameRects();
  const result = change();
  const moving = [];
  const timing = { duration: motionMs(), easing: MOTION_EASE };
  const near = (a, b) => Math.abs(a - b) < 1;
  stage.querySelectorAll(".mu-window:not(.is-root)").forEach((el) => {
    const was = before.get(el.dataset.id);
    if (!was || !el.getClientRects().length) return;
    const now = el.getBoundingClientRect();
    const old = was.frame;
    if (near(old.left, now.left) && near(old.top, now.top) && near(old.right, now.right) && near(old.bottom, now.bottom)) return;
    const top = old.top - now.top;
    const right = now.right - old.right;
    const bottom = now.bottom - old.bottom;
    const left = old.left - now.left;
    el.classList.add("is-moving-frame");
    moving.push(el.animate([{ clipPath: `inset(${top}px ${right}px ${bottom}px ${left}px)` }, { clipPath: "inset(0px 0px 0px 0px)" }], timing));
    const bar = el.querySelector(":scope > .mu-titlebar");
    if (!was.bar || !bar || !bar.getClientRects().length) return;
    const barNow = bar.getBoundingClientRect();
    const dx = was.bar.left - barNow.left;
    const dy = was.bar.top - barNow.top;
    if (near(dx, 0) && near(dy, 0)) return;
    moving.push(bar.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }], timing));
  });
  if (!moving.length) return result;
  // A bar on its way crosses its window's edge: nothing clips it meanwhile.
  barMotions += 1;
  stage.classList.add("is-bar-motion");
  playSettled(moving, () => {
    barMotions = Math.max(0, barMotions - 1);
    if (barMotions) return;
    stage.classList.remove("is-bar-motion");
    stage.querySelectorAll(".mu-window.is-moving-frame").forEach((one) => one.classList.remove("is-moving-frame"));
  });
  return result;
}

// What buildNode was handed for a node when the layout was drawn: the
// axis of the split it sits in and whether the other side still wants
// room -- worked out again from the tree, for drawing one frame anew.
function contextFor(node) {
  const found = findParent(node.id);
  const parent = found && found[0];
  if (!parent) return null;
  if (parent.type === "group") return parent.bay ? contextFor(parent) : stageContext(parent);
  const index = found[1];
  return splitChildContext(parent, contextOfSplit(parent), parent.children.map(allCollapsed), index);
}

// The same for a split, found by identity (splits have no id).
function contextOfSplit(split) {
  const trail = ancestorsOf(split) || [];
  const parent = trail[trail.length - 1];
  if (!parent) return null;
  if (parent.type === "group") return parent.bay ? contextFor(parent) : stageContext(parent);
  const index = parent.children.indexOf(split);
  return splitChildContext(parent, contextOfSplit(parent), parent.children.map(allCollapsed), index);
}



// A bay showing another sash: only the bay is drawn again, not the whole
// layout. Redrawing everything rebuilt every other window too -- pictures
// loaded afresh and flickered, scroll bars came and went while the content
// found its height. The windows leaving slide away as they are (not a
// copy: a canvas copies blank), out of the item bookkeeping at once and
// torn down when they are gone. Anything that is not a plain switch -- a
// gesture in progress, the bay's room changing (folded content) -- falls
// back to drawing everything.
function redrawBay(frame, forward, wasShut) {
  const old = windowEl(frame.id);
  if (!old || placing || pendingMove || dragSourceId || resizing || wasShut !== allCollapsed(frame)) {
    commit();
    return;
  }
  normalizeBays();
  repairPaths();
  pruneItems();
  if (bayFrame(frame.bay) !== frame) {
    commit();
    return;
  }
  const oldBody = old.querySelector(":scope > .mu-group-body");
  const finish = framesHooks.takeOut(old);
  const fresh = buildNode(frame, contextFor(frame));
  fresh.style.flex = old.style.flex;
  fresh.style.width = old.style.width;
  fresh.style.height = old.style.height;
  old.replaceWith(fresh);
  // The split the bay stands in keeps its children by element, to size them
  // when a seam is dragged or a neighbour is folded or opened. Left pointing
  // at the frame just replaced, it sized the one that is gone: the seam beside
  // the bay then jumped away from the pointer, and moved twice as far as it.
  const beside = findParent(frame.id);
  const sideCtx = beside && beside[0] && splitCtx.get(beside[0]);
  if (sideCtx) {
    const at = sideCtx.childEls.indexOf(old);
    if (at >= 0) sideCtx.childEls[at] = fresh;
  }
  framesHooks.attach(fresh, null);
  restoreFocus();
  fitBars();
  // The windows the sash brought in were drawn as they were mounted; of the
  // others, only what shows the bays and the layout has anything to say.
  framesHooks.refresh();
  renderedShape = shapeOf(layoutRoot());
  framesHooks.layoutMoved(null, true);
  scheduleSave();
  scheduleLaunchKeep();
  slideSash(fresh, oldBody, forward, finish);
}

// The sash's windows sliding: the old ones out, the new ones in, along the
// row (sideways) or the column (up and down) the bay stands in. `forward`
// is the way along the sashes.
function slideSash(el, oldBody, forward, finish) {
  const body = el.querySelector(":scope > .mu-group-body");
  if (lessMotion() || !oldBody || !body || !body.getClientRects().length) {
    finish();
    return;
  }
  const how = bayAxisOf(findLeaf(el.dataset.id));
  const axis = how.axis === "vertical" ? "Y" : "X";
  // Reversed: forward comes in from the other side.
  if (how.reverse) forward = !forward;
  // Where the old windows are now: part way in, when the last switch is
  // still sliding.
  const from = getComputedStyle(oldBody).transform;
  oldBody.getAnimations().forEach((one) => one.cancel());
  // Only a picture now: nothing in it answers to a window's id or is mounted.
  [oldBody, ...oldBody.querySelectorAll("[data-id], [data-role]")].forEach((one) => {
    one.removeAttribute("data-id");
    one.removeAttribute("data-role");
  });
  oldBody.classList.add("mu-bay-ghost");
  oldBody.setAttribute("aria-hidden", "true");
  oldBody.inert = true;
  el.classList.add("is-sliding");
  el.append(oldBody);
  const out = forward ? -100 : 100;
  const move = (start, to) => [{ transform: `translate${axis}(${start}%)` }, { transform: `translate${axis}(${to}%)` }];
  const leave = move(0, out);
  if (from && from !== "none") leave[0] = { transform: from };
  const duration = motionMs();
  playSettled(
    [
      oldBody.animate(leave, { duration, easing: MOTION_EASE, fill: "forwards" }),
      body.animate(move(-out, 0), { duration, easing: MOTION_EASE }),
    ],
    () => {
      oldBody.remove();
      el.classList.remove("is-sliding");
      finish();
    }
  );
}

// ---- collapsing ------------------------------------------------------
// Whether everything under a node is collapsed. A split with one open child
// is not: it still has to divide its space.
function allCollapsed(node) {
  if (!node) return false;
  // A bay has no bar of its own: it is as folded as what it shows, and
  // gives up its room the way that would.
  if (node.bay) return allCollapsed(groupContent(node));
  // A group collapses as one frame, the way a window does -- its tabs have
  // no bar of their own to be reduced to.
  if (node.type !== "split") return node.collapsed === true;
  return node.children.every(allCollapsed);
}

// The last window still open in a group does not go down on its own: the
// group does instead. A group whose every window is a bar still holds its
// share of the stage, and bars have nothing to fill it with -- so what that
// asks for is the group reduced to its bar, and that is what it gets. The
// window keeps its size inside, for when the group is opened again. The
// same question is then asked one level out, which is how collapsing the
// last open thing in a group inside a group folds both.
//
// Not the root: it is the stage, and has no bar to be reduced to.
function collapseTarget(node) {
  const group = groupOf(node.id);
  if (!group || group === layoutRoot() || group.collapsed || group.bay) return node;
  node.collapsed = true;
  const everything = allCollapsed(groupContent(group));
  delete node.collapsed;
  return everything ? collapseTarget(group) : node;
}

function setCollapsed(id, collapsed) {
  const node = findLeaf(id);
  if (!node) return false;
  return withBarMotion(() => {
    // The room freed by a fold, or taken by an opening, is shared by what is
    // beside it on both sides.
    const target = collapsed ? collapseTarget(node) : node;
    const sides = restoreSides(target);
    // The size a frame had when it was folded, to give it back when it is
    // opened: the ratios do not remember it, since the seams moved to share
    // what it left, and opening by them would not return what was shared.
    const remembered = collapsed ? null : foldedSizes.get(target.id);
    if (collapsed && sides) foldedSizes.set(target.id, sides.bar);
    if (!collapsed) foldedSizes.delete(target.id);
    if (collapsed) target.collapsed = true;
    else delete target.collapsed; // absent rather than false: it is the default
    commit({ keep: true, inPlace: true });
    if (sides) restoreFromBothSides(target, sides, remembered);
    return true;
  });
}

// What lies on both sides of a bar that is about to open, along the axis of
// the split it is in: for each side its seam, which child of it the bar is,
// and how much room the open frames there have now. null unless there are
// open frames on both sides -- with one side only, there is only one side to
// take from, and opening does just that.
function restoreSides(node) {
  const found = findParent(node.id);
  const parent = found && found[0];
  if (!parent || parent.type !== "split") return null;
  const dirs = parent.dir === "row" ? ["left", "right"] : ["up", "down"];
  const prop = parent.dir === "row" ? "width" : "height";
  const sizeOf = (el) => (el ? el.getBoundingClientRect()[prop] : 0);
  const sides = [];
  for (const direction of dirs) {
    const side = neighbourSide(node.id, direction);
    if (!side || allCollapsed(side.beside)) return null;
    // A neighbour held to its size gives and takes nothing.
    if (pinnedSize(side.beside, parent.dir) !== null) return null;
    const ctx = splitCtx.get(side.split);
    if (!ctx) return null;
    sides.push({ ...side, size: sizeOf(ctx.childEls[1 - side.index]) });
  }
  return { sides, prop, bar: sizeOf(windowEl(node.id)) };
}

// A bar opens with the room it was given by the ratios, which comes from
// whichever side the split it sits in puts it on: one neighbour gives up
// all of it. Here each gives up half. The seams are moved by what was
// measured: the outer one first, then the one inside it, each time against
// the sizes the last move left.
const MIN_NEIGHBOUR = 48; // px a neighbour is never squeezed below

const foldedSizes = new Map();

function restoreFromBothSides(node, { sides, prop, bar }, remembered = null) {
  const sizeOf = (el) => (el ? el.getBoundingClientRect()[prop] : 0);
  // What the frame took (opening) or gave back (folding), signed; each side
  // gives up half of it, or is given half.
  const need = (remembered || sizeOf(windowEl(node.id))) - bar;
  if (Math.abs(need) < 2) return;
  const half = need / 2;
  if (sides.some((side) => side.size - half < MIN_NEIGHBOUR)) return;
  const depth = (split) => (ancestorsOf(split) || []).length;
  for (const side of [...sides].sort((a, b) => depth(a.split) - depth(b.split))) {
    // A seam whose own side is all bars has no ratio to move -- the bar is as
    // big as itself, and the neighbour beside it takes what the seam outside
    // leaves. (Moving it anyway would leave the bar a sliver of the ratio when
    // it is opened again.)
    if (allCollapsed(side.split.children[side.index])) continue;
    const ctx = splitCtx.get(side.split);
    if (!ctx) return;
    const total = sizeOf(ctx.childEls[0]) + sizeOf(ctx.childEls[1]);
    if (!(total > 0)) return;
    // The child the neighbour is, at the size it should end up. `side.index`
    // is where the bar is: the neighbour is the other one.
    const wanted = side.size - half;
    const first = side.index === 1 ? wanted : total - wanted;
    side.split.ratio = Math.min(0.95, Math.max(0.05, first / total));
    // The seam moves in the layout already drawn: drawing everything again
    // for each of the two would cost far more than the opening itself.
    applyRatio(ctx.childEls, side.split.ratio, side.split);
  }
  scheduleSave();
  scheduleLaunchKeep();
}

// What lies beside a frame in one direction: the other side of the nearest
// split, walking up, that divides along that axis with the frame on the
// near side. Only inside the frame's own group -- the group's edge is as
// far as its windows can grow. null when nothing is there.
function neighbourSide(id, direction) {
  const { dir, first } = DIRECTIONS[direction];
  let found = findParent(id);
  while (found && found[0] && found[0].type === "split") {
    const [parent, index] = found;
    // `first` is the newcomer's side for a guide: up/left is child 0, so
    // what is above or to the left of this side is child 0 too.
    if (parent.dir === dir && index === (first ? 1 : 0)) {
      return { split: parent, index, beside: parent.children[first ? 0 : 1] };
    }
    found = findNodeParent(parent);
    found = found ? [found.parent, found.index] : null;
  }
  return null;
}

function neighbourToward(id, direction) {
  const side = neighbourSide(id, direction);
  return side ? side.beside : null;
}

// The open frames of `node` that a window on its `near` side would meet
// walking outward along `dir`, bars skipped: the ones it would be next to.
// Along the axis that is the frame at the near edge, or, where that is all
// bars, the one past them; across it, every row or column has its own.
function openAtEdge(node, dir, near) {
  if (!node || allCollapsed(node)) return [];
  if (node.type !== "split") return [node];
  if (node.dir !== dir) return node.children.flatMap((child) => openAtEdge(child, dir, near));
  const nearest = openAtEdge(node.children[near], dir, near);
  return nearest.length ? nearest : openAtEdge(node.children[1 - near], dir, near);
}

// The directions a collapsed frame can open into by taking the room of
// what is there: only along the row or column it is in (the split it sits
// in divides that way -- left and right in a row, up and down in a
// column), only where something is, and only where it is not all bars
// already -- there plain expanding gives the same room.
function expandDirections(node) {
  const found = findParent(node.id);
  const parent = found && found[0];
  const axis = parent && parent.type === "split" ? parent.dir : null;
  return Object.keys(DIRECTIONS).filter((d) => {
    if (DIRECTIONS[d].dir !== axis) return false;
    const beside = neighbourToward(node.id, d);
    return beside && !allCollapsed(beside);
  });
}

// A frame folded: a window or a group goes down as one. A bay has no bar of
// its own to go down to (and its `collapsed` is never kept), so what it holds
// folds instead: the window or the group its sash holds, to the bar it is.
function foldWithin(node) {
  if (node.type === "split") node.children.forEach(foldWithin);
  else if (node.bay) {
    const content = groupContent(node);
    if (content) foldWithin(content);
  } else node.collapsed = true;
}

// Open a frame and collapse what it is next to in that direction -- the
// open windows it meets, not everything on that side: with A | bar | C | D
// the row's others stay as they are when D goes left. A group goes down as
// one frame, as it does from its own bar.
//
// The room C held has to become D's, and a split keeps its ratio while
// anything beside it is open (collapsing C alone only hands its room to
// the rest of that side), so the seam is moved by what the folded frames
// gave up: each one's size less a bar's, the least of them where several
// stand across the edge. Where nothing is left open beside, the ratio is
// not used and D takes the rest on its own.
function expandToward(id, direction) {
  const node = findLeaf(id);
  const side = node && neighbourSide(id, direction);
  if (!side) return false;
  const { split, index, beside } = side;
  const { dir, first } = DIRECTIONS[direction];
  const targets = openAtEdge(beside, dir, first ? 1 : 0);
  if (!targets.length) return false;

  // Measured before anything changes.
  const prop = dir === "row" ? "width" : "height";
  const sizeOf = (el) => (el ? el.getBoundingClientRect()[prop] : 0);
  const ctx = splitCtx.get(split);
  const bar = sizeOf(windowEl(id));
  const gain = Math.max(0, Math.min(...targets.map((one) => sizeOf(windowEl(one.id)) - bar)));
  const total = ctx ? sizeOf(ctx.childEls[0]) + sizeOf(ctx.childEls[1]) : 0;
  const besideSize = ctx ? sizeOf(ctx.childEls[1 - index]) : 0;

  return withBarMotion(() => {
    delete node.collapsed;
    targets.forEach(foldWithin);
    if (total > 0 && gain > 0 && !allCollapsed(beside)) {
      const share = (besideSize - gain) / total; // of the beside side
      const toFirst = index === 1 ? share : 1 - share;
      split.ratio = Math.min(0.95, Math.max(0.05, toFirst));
    }
    commit({ keep: true, inPlace: true });
    return true;
  });
}

// ---- seams -----------------------------------------------------------
// A split's seam is one line, but it may border several windows on each
// side, and dragging it moves all of them: the split has a single ratio.
// In a 2x2 that means the vertical seam always moves both rows.
//
// The arrangement you actually want -- top pair moved, bottom pair left
// alone -- is still a tree, just a different one:
//
//   row( col(A,B), col(C,D) )   ->   col( row(A,C), row(B,D) )
//
// Same rectangles, but now the A|C seam is a ratio of its own. So the seam
// is drawn in segments, and grabbing one rewrites the tree so that segment
// is a cut of its own before the drag starts. Where no such rewrite exists
// -- two windows on the left, one on the right, where moving half the seam
// would make an L-shape -- the seam has one segment and behaves as before.

// The seam geometry (CUT_EPS, fullCuts, splitAt, isolateSegment, ...) is shell/seams.





// Whether a band of a split's seam divides anything: a seam is drawn where an
// open window is beside it. Between two bars there is nothing to divide -- a
// bar is its own size -- and no line is drawn there, nor can it be taken hold of.
function seamBandShown(node, from, to) {
  const beside = [
    ...edgeFrames(node.children[0], node.dir, "end", from, to),
    ...edgeFrames(node.children[1], node.dir, "start", from, to),
  ];
  return beside.some((frame) => !allCollapsed(frame));
}

// Say which pieces of a drawn seam are drawn.
function markQuietBands(node, segEls) {
  for (const seg of segEls) {
    seg.classList.toggle("is-quiet", !seamBandShown(node, Number(seg.dataset.from), Number(seg.dataset.to)));
  }
}




// ---- resizing --------------------------------------------------------
// A split's measurements for the length of a drag: how long it is, how much
// of that the seam takes, and what is left for the two children to divide.
// The ratio divides `inner`, so the middle of the seam sits at
// inner * ratio + seam / 2 -- which is what these two convert between.
function seamGeometry(ctx, segEl) {
  const horizontal = ctx.node.dir === "row";
  const rect = ctx.splitEl.getBoundingClientRect();
  const seamBox = segEl.parentElement.getBoundingClientRect();
  const size = horizontal ? rect.width : rect.height;
  const seam = horizontal ? seamBox.width : seamBox.height;
  return { horizontal, rect, size, seam, inner: Math.max(1, size - seam) };
}


// Every seam elsewhere in the layout that runs the same way as this one, as
// a fraction of the split being dragged. Lining a seam up with one of these
// is what turns a ragged layout into a grid -- and it is what makes the seam
// across them splittable, since a shared cut is exactly what seamSegments()
// looks for.
//
// Seams inside the split being dragged are left out: they move with it, so
// there would be nothing to line up against. Everything outside it stays
// where it is for the length of the drag, so this is measured once.
function alignmentTargets(ctx, geom) {
  const selector = geom.horizontal
    ? ".mu-split.dir-row > .mu-resizer"
    : ".mu-split.dir-col > .mu-resizer";
  const origin = geom.horizontal ? geom.rect.left : geom.rect.top;
  const targets = [];
  stage.querySelectorAll(selector).forEach((el) => {
    if (ctx.splitEl.contains(el)) return;
    const box = el.getBoundingClientRect();
    // Seam centre to seam centre: a neighbour's seam may be a different
    // thickness (a plugin's skin), and the middle is what lines up.
    const centre = geom.horizontal ? box.left + box.width / 2 : box.top + box.height / 2;
    const ratio = ratioAt(centre - origin, geom);
    if (ratio <= 0.001 || ratio >= 0.999) return;
    // Seams a few pixels apart -- two columns' seams that nearly meet --
    // are one place to line up with, and one guide.
    if (targets.some((target) => Math.abs(target.ratio - ratio) * geom.inner < SNAP_DISTANCE / 2)) return;
    targets.push({ ratio, align: true });
  });
  return targets;
}


// The seams to line up with, drawn like the percentage guides but dotted,
// and thrown away when the drag ends.
function addAlignGuides(overlay, targets, horizontal) {
  targets.forEach((target) => {
    const guide = document.createElement("div");
    guide.className = "mu-rguide is-align";
    guide.dataset.ratio = String(target.ratio);
    guide.style[horizontal ? "left" : "top"] = `${target.ratio * 100}%`;
    guide.textContent = `${Math.round(target.ratio * 100)}%`;
    overlay.append(guide);
  });
}

function paintResize(overlay, node, ratio, snapped) {
  const horizontal = node.dir === "row";
  const axis = horizontal ? "left" : "top";
  const pct = `${ratio * 100}%`;

  overlay.querySelectorAll(".mu-rguide").forEach((guide) => {
    // By position rather than by identity: an alignment guide's ratio is
    // whatever the measurement made it, never a round number.
    guide.classList.toggle(
      "is-snapped",
      snapped !== null && Math.abs(Number(guide.dataset.ratio) - snapped.ratio) < CUT_EPS
    );
  });
  overlay.querySelector(".mu-rlive").style[axis] = pct;

  const label = overlay.querySelector(".mu-rlabel");
  label.style[axis] = pct;
  label.style[horizontal ? "top" : "left"] = "50%";
  label.textContent = `${Math.round(ratio * 100)}% / ${Math.round((1 - ratio) * 100)}%`;
}

// Flex sizing for a split's two children. A collapsed one is sized by its
// content (`flex: 0 0 auto`), which is what makes the other one take the
// rest without the ratio having to know anything about it.
function applyRatio(childEls, ratio, node) {
  const shut = childEls.map((_, i) => (node ? allCollapsed(node.children[i]) : false));
  // Whatever a hold set last time is let go of first.
  for (const el of childEls) {
    if (el.style.width) el.style.width = "";
    if (el.style.height) el.style.height = "";
  }

  // Nothing collapsed: the ratio divides the space, which is the usual case --
  // unless one side is held to its size (a pinned frame), which keeps it and
  // leaves the rest to the other.
  if (!shut.some(Boolean)) {
    const held = node ? node.children.map((child) => pinnedSize(child, node.dir)) : [null, null];
    // Either side held, or both: each held side keeps its size, and what is
    // left goes to the one that is not. Both held used to fall through to the
    // ratio, which gave a pinned frame a share of the room again -- the one
    // beside it resized when a second was pinned.
    if (held[0] !== null || held[1] !== null) {
      childEls.forEach((el, i) => {
        // It may still give way when there is not the room (flex-shrink),
        // which is a window that does not fit, not a pin that was let go.
        if (held[i] !== null) holdChild(el, held[i], node.dir);
        else el.style.flex = "1 1 0";
      });
      return;
    }
    childEls.forEach((el, i) => {
      el.style.flex = `${i === 0 ? ratio : 1 - ratio} 1 0`;
    });
    return;
  }

  // Everything collapsed: there is nobody to give the space to, so the bars
  // keep it and share it. Grown from their own size rather than from zero --
  // the split above is sized by its content, and a basis of zero would leave
  // it nothing to measure.
  if (shut.every(Boolean)) {
    childEls.forEach((el) => {
      el.style.flex = "1 1 auto";
    });
    return;
  }

  // One of each: the bar takes the size of its own title bar and the open
  // window takes the rest. It has to be told so with a grow factor of 1 --
  // factors summing to less than one leave the remainder unused rather than
  // handing it over.
  childEls.forEach((el, i) => {
    // The open one is the rest -- unless it is held to its size, which it
    // keeps (and the room it would have taken goes to what is beyond).
    const size = shut[i] || !node ? null : pinnedSize(node.children[i], node.dir);
    if (shut[i]) el.style.flex = "0 0 auto";
    else if (size !== null) holdChild(el, size, node.dir);
    else el.style.flex = "1 1 0";
  });
}


// A seam with a bar on one side has nothing of its own to divide. But
// between two open windows --  A | bar | B  -- it is B's edge, and moving it
// is moving B's edge: the bar keeps its width, so what B gives up goes to
// A. Whether there is such a seam beyond the bars is what this answers (a
// seam with no open window past its bars is not offered); the drag itself is
// the seam's own (see isolateAcrossBars). Found by walking outward along the
// same axis while there are only bars in between; a frame, a turn of axis or
// running out of layout ends the walk with nothing.
function seamRelay(split) {
  if (!split || split.type !== "split") return null;
  const shut = split.children.map(allCollapsed);
  if (!shut.some(Boolean) || shut.every(Boolean)) return null;
  // The bars are on this side of the seam; the seam wanted is beyond them.
  return seamBeyond(split, shut[0] ? 0 : 1);
}

// The first seam met walking outward from `split` towards `side` (0: where
// children[0] is, 1: children[1]) with only bars in between, or null.
function seamBeyond(split, side) {
  const trail = ancestorsOf(split) || [];
  let cur = split;
  for (let i = trail.length - 1; i >= 0; i -= 1) {
    const parent = trail[i];
    if (parent.type !== "split" || parent.dir !== split.dir) return null;
    const at = parent.children.indexOf(cur);
    // Bars on the near side of the seam lead outward only through the
    // parent's seam on that same side. A parent that has this split on the
    // bars' side of its own seam has only what lies behind it to offer: its
    // seam is not beyond the bars, but the walk goes on outward past it --
    // Z | (W | bar) | bar | W is the same as W | bar | bar | W.
    if (at === 1 - side && !allCollapsed(parent.children[side])) return parent;
    cur = parent;
  }
  return null;
}

// ---- whole lines --------------------------------------------------------
// A seam is often one piece of a longer straight line: the seams of two
// columns that happen to meet, a seam broken into bands by the cuts across
// it. Coming onto a seam, the pointer has the whole line -- every seam lying
// on it inside the same frame, drawn as one solid divider; moved about on
// the seam by a little, it has just the pair the seam is between; a little
// more, the whole line again. By how far it moves, not where it is: the
// hit area is a few pixels across, too narrow to aim inside.
const LINE_SWITCH = 96; // px of pointer travel on a seam between whole and pair

// The seam's middle, along the axis it divides.
function seamCentre(ctx) {
  const box = ctx.splitEl.querySelector(":scope > .mu-resizer").getBoundingClientRect();
  return ctx.node.dir === "row" ? box.left + box.width / 2 : box.top + box.height / 2;
}

// The whole line a split's seam is part of: the outermost split around it,
// inside the same frame, that the line crosses completely ({node, pos}),
// else the split itself when its seam is in bands ({node, pos: null}), else
// null -- the seam is a line of its own, and the pair is the whole.
function wholeLineOf(ctx) {
  const split = ctx.node;
  const horizontal = split.dir === "row";
  const line = seamCentre(ctx);
  let best = null;
  const trail = ancestorsOf(split) || [];
  for (let i = trail.length - 1; i >= 0; i -= 1) {
    const outer = trail[i];
    // A frame is where a line ends: what is outside it is another layout.
    if (outer.type !== "split") break;
    const outerCtx = splitCtx.get(outer);
    if (!outerCtx) break;
    const rect = outerCtx.splitEl.getBoundingClientRect();
    const size = horizontal ? rect.width : rect.height;
    if (size <= 0) break;
    const at = ((horizontal ? line - rect.left : line - rect.top) / size);
    const cut = fullCuts(outer, split.dir).find((one) => Math.abs(one - at) * size <= 4);
    if (cut === undefined) break;
    best = { node: outer, pos: cut };
  }
  if (best) return best;
  return ctx.segEls.length > 1 ? { node: split, pos: null } : null;
}

// The seam bands lying on a whole line, to light up together.
function wholeLineSegs(ctx, whole) {
  if (whole.pos === null) return [...ctx.segEls];
  const outerCtx = splitCtx.get(whole.node);
  if (!outerCtx) return [...ctx.segEls];
  const horizontal = ctx.node.dir === "row";
  const line = seamCentre(ctx);
  const selector = horizontal ? ".mu-split.dir-row > .mu-resizer" : ".mu-split.dir-col > .mu-resizer";
  const segs = [];
  outerCtx.splitEl.querySelectorAll(selector).forEach((resizer) => {
    // Not past a frame: a group inside is a layout of its own.
    const frame = resizer.closest(".mu-window.is-group");
    if (frame && outerCtx.splitEl.contains(frame)) return;
    const box = resizer.getBoundingClientRect();
    const centre = horizontal ? box.left + box.width / 2 : box.top + box.height / 2;
    if (Math.abs(centre - line) <= 4) segs.push(...resizer.querySelectorAll(":scope > .mu-seg"));
  });
  return segs;
}

// The pointer on a seam: which seam, whether it has the whole line, and
// how far it has moved since that last changed.
let onSeam = null; // { resizer, whole, travel, x, y }

// Which the pointer has: the whole line or the pair.
function wantsWhole(resizer) {
  return Boolean(onSeam && onSeam.resizer === resizer && onSeam.whole);
}

// The whole line, lit as one solid divider over the bands it is made of
// -- they leave gaps where other seams cross it.
let litLine = null;

function lightLine(segs) {
  if (!segs.length) {
    if (litLine) litLine.remove();
    litLine = null;
    return;
  }
  const boxes = segs.map((seg) => seg.getBoundingClientRect());
  const left = Math.min(...boxes.map((box) => box.left));
  const top = Math.min(...boxes.map((box) => box.top));
  const right = Math.max(...boxes.map((box) => box.right));
  const bottom = Math.max(...boxes.map((box) => box.bottom));
  if (!litLine) {
    litLine = document.createElement("div");
    litLine.className = "mu-seam-line";
    document.body.append(litLine);
  }
  Object.assign(litLine.style, { left: `${left}px`, top: `${top}px`, width: `${right - left}px`, height: `${bottom - top}px` });
}

// Drag the whole line: a split's own seam in bands is dragged as it is;
// a line across an outer split becomes that split's one seam first -- the
// outer split cut along the line (see splitAt), the reverse of isolating a
// band -- and is then dragged.
function startWholeDrag(ctx, whole, event) {
  if (whole.pos === null) {
    beginResize(ctx, ctx.segEls[0], event, false);
    ctx.segEls.forEach((seg) => seg.classList.add("is-resizing"));
    return;
  }
  const outer = whole.node;
  const replacement = { type: "split", dir: ctx.node.dir, ratio: whole.pos, children: splitAt(outer, ctx.node.dir, whole.pos) };
  if (!swapNode(outer, replacement)) return;
  render({ keep: true, quiet: true });
  const fresh = splitCtx.get(replacement);
  if (!fresh) return;
  // Cut along the line, the far pieces of the row came with it: keep them
  // where they are, and move only what lies on either side of the line.
  beginPairResize(fresh, fresh.segEls[0], event, false);
  const dragged = resizing && splitCtx.get(resizing.node);
  (dragged || fresh).segEls.forEach((seg) => seg.classList.add("is-resizing"));
}

function wireResizer(resizer, ctx) {
  // Coming on, the whole line (when there is one longer than the pair);
  // every LINE_SWITCH px of travel on the seam, the other one.
  const show = () => {
    const whole = wantsWhole(resizer) ? wholeLineOf(ctx) : null;
    resizer.classList.toggle("is-whole", Boolean(whole));
    lightLine(whole ? wholeLineSegs(ctx, whole) : []);
  };
  resizer.addEventListener("pointermove", (event) => {
    if (resizing || resizer.classList.contains("is-relay") || resizer.classList.contains("is-inert")) return;
    if (!onSeam || onSeam.resizer !== resizer) {
      onSeam = { resizer, whole: Boolean(wholeLineOf(ctx)), travel: 0, x: event.clientX, y: event.clientY };
    } else {
      onSeam.travel += Math.hypot(event.clientX - onSeam.x, event.clientY - onSeam.y);
      onSeam.x = event.clientX;
      onSeam.y = event.clientY;
      if (onSeam.travel >= LINE_SWITCH) {
        onSeam.travel = 0;
        onSeam.whole = !onSeam.whole && Boolean(wholeLineOf(ctx));
      }
    }
    show();
  });
  resizer.addEventListener("pointerleave", () => {
    if (resizing) return;
    if (onSeam && onSeam.resizer === resizer) onSeam = null;
    resizer.classList.remove("is-whole");
    lightLine([]);
  });
  resizer.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    if (!event.target.closest(".mu-seg")) return;
    event.preventDefault();
    lightLine([]);
    // A seam beside a bar is taken hold of like any other: it moves the two
    // open windows it divides, across the bars between (see isolateAcrossBars).
    const whole = wantsWhole(resizer) ? wholeLineOf(ctx) : null;
    onSeam = null;
    if (whole) {
      startWholeDrag(ctx, whole, event);
      return;
    }
    startSeamDrag(ctx, event.target.closest(".mu-seg"), event, false);
  });
}

// The windows along a split's own axis, in order, with how much room each
// takes there (px, from the drawn layout): a same-way split is opened up
// into its pieces; anything else -- a window, a group, a split the other
// way -- is one piece. null when something is not drawn.
function piecesAlong(node, dir, out = []) {
  if (node.type === "split" && node.dir === dir) {
    node.children.forEach((child) => piecesAlong(child, dir, out));
    return out;
  }
  const el = node.type === "split" ? splitCtx.get(node) && splitCtx.get(node).splitEl : windowEl(node.id);
  if (!el || !el.getClientRects().length) return null;
  const box = el.getBoundingClientRect();
  out.push({ node, size: dir === "row" ? box.width : box.height });
  return out;
}

// A seam dragged moves the two things either side of it and nothing else.
// In A | B | C held as (A | B) | C, the seam between B and C is the outer
// split's, and dragging it scaled A along with B -- reaching across B, a
// bay most noticeably, to a window that was not beside the seam at all.
// So the split is rebuilt, before the drag, with the two neighbours as a
// split of their own and everything else around them at the size it has.
// Returns {replacement, target}, or null when it already is that.
function isolatePair(split) {
  const dir = split.dir;
  const left = piecesAlong(split.children[0], dir);
  const right = piecesAlong(split.children[1], dir);
  if (!left || !right || (left.length === 1 && right.length === 1)) return null;
  const pieces = [...left, ...right];
  // A bar is sized by itself, not by a share: leave such a row as it is.
  if (pieces.some((one) => allCollapsed(one.node))) return null;
  const resizer = splitCtx.get(split) && splitCtx.get(split).splitEl.querySelector(":scope > .mu-resizer");
  const seam = resizer ? (dir === "row" ? resizer.getBoundingClientRect().width : resizer.getBoundingClientRect().height) : 0;
  const k = left.length - 1;
  const join = (a, b, first, second) => ({
    node: { type: "split", dir, ratio: Math.min(0.98, Math.max(0.02, a / (a + b))), children: [first, second] },
    size: a + seam + b,
  });
  const target = join(pieces[k].size, pieces[k + 1].size, pieces[k].node, pieces[k + 1].node);
  let built = target;
  for (let i = k - 1; i >= 0; i -= 1) built = join(pieces[i].size, built.size, pieces[i].node, built.node);
  for (let j = k + 2; j < pieces.length; j += 1) built = join(built.size, pieces[j].size, built.node, pieces[j].node);
  return { replacement: built.node, target: target.node };
}

// The same, for a seam in a row that has bars in it. A bar is its own size,
// so what a seam beside one divides is the open windows on either side of the
// bars: in A | bar | bar | B each of the three seams moves A's edge and B's, the
// bars sliding along, and nothing else changes size. The seam under the pointer
// is the one that moves: the row is rebuilt with a split whose seam is this one,
// A and the bars up to it on one side, the bars past it and B on the other --
// and what lies beyond A and B at the size it has. Returns {top, replacement,
// target}; {refuse: true} when there is no open window on one side; and null
// when the row has no bars, or this split already is that (nothing to rebuild:
// the drag is then the plain one, which is how a second drag costs nothing).
function isolateAcrossBars(split) {
  const dir = split.dir;
  // The whole row along this axis: every split the same way above this one.
  let top = split;
  const trail = ancestorsOf(split) || [];
  for (let i = trail.length - 1; i >= 0; i -= 1) {
    if (trail[i].type === "split" && trail[i].dir === dir) top = trail[i];
    else break;
  }
  const pieces = piecesAlong(top, dir);
  const left = piecesAlong(split.children[0], dir);
  const right = piecesAlong(split.children[1], dir);
  if (!pieces || !left || !right || !pieces.some((one) => allCollapsed(one.node))) return null;
  const first = pieces.findIndex((one) => one.node === left[0].node);
  if (first < 0) return null;
  const k = first + left.length - 1;
  // The open windows the seam divides: the nearest on each side, past any bars.
  let a = k;
  while (a >= 0 && allCollapsed(pieces[a].node)) a -= 1;
  let b = k + 1;
  while (b < pieces.length && allCollapsed(pieces[b].node)) b += 1;
  if (a < 0 || b >= pieces.length) return { refuse: true };
  // Already a split of just these: its seam is this one and nothing else is in it.
  if (left.length === k - a + 1 && left[0].node === pieces[a].node && right.length === b - k && right[right.length - 1].node === pieces[b].node) return null;
  const resizer = splitCtx.get(split) && splitCtx.get(split).splitEl.querySelector(":scope > .mu-resizer");
  const seam = resizer ? resizer.getBoundingClientRect()[dir === "row" ? "width" : "height"] : 0;
  const join = (x, y, first, second) => ({
    node: { type: "split", dir, ratio: Math.min(0.98, Math.max(0.02, x / (x + y))), children: [first, second] },
    size: x + seam + y,
  });
  const run = (from, to) => {
    let one = { node: pieces[to].node, size: pieces[to].size };
    for (let i = to - 1; i >= from; i -= 1) one = join(pieces[i].size, one.size, pieces[i].node, one.node);
    return one;
  };
  const near = run(a, k);
  const far = run(k + 1, b);
  const target = join(near.size, far.size, near.node, far.node);
  let built = target;
  for (let i = a - 1; i >= 0; i -= 1) built = join(pieces[i].size, built.size, pieces[i].node, built.node);
  for (let j = b + 1; j < pieces.length; j += 1) built = join(built.size, pieces[j].size, built.node, pieces[j].node);
  return { top, replacement: built.node, target: target.node };
}

// Drag a split's seam as the pair it is between (see isolatePair).
function beginPairResize(ctx, segEl, event, relayed) {
  const bars = relayed ? null : isolateAcrossBars(ctx.node);
  if (bars) {
    if (bars.refuse) return;
    if (swapNode(bars.top, bars.replacement)) {
      render({ keep: true, quiet: true });
      const fresh = splitCtx.get(bars.target);
      if (fresh) beginResize(fresh, fresh.segEls[0], event, false);
      return;
    }
  }
  const pair = relayed ? null : isolatePair(ctx.node);
  if (!pair || !swapNode(ctx.node, pair.replacement)) {
    beginResize(ctx, segEl, event, relayed);
    return;
  }
  // Only the frames around the windows change shape: the bodies they hold are
  // kept, not drawn again, or the seam would not move until every one was.
  render({ keep: true, quiet: true });
  const fresh = splitCtx.get(pair.target);
  if (fresh) beginResize(fresh, fresh.segEls[0], event, relayed);
}

function startSeamDrag(ctx, segEl, event, relayed) {
  {

    const from = Number(segEl.dataset.from);
    const to = Number(segEl.dataset.to);
    if (from <= CUT_EPS && to >= 1 - CUT_EPS) {
      beginPairResize(ctx, segEl, event, relayed);
      return;
    }

    // Part of a seam: rewrite the tree so this band is a cut of its own,
    // then drag that. The layout looks identical either side of this, so
    // there is nothing to see -- but the tree really has changed shape,
    // which is why it happens before the first move rather than after.
    const { replacement, target } = isolateSegment(ctx.node, from, to);
    if (!swapNode(ctx.node, replacement)) return;
    render({ keep: true, quiet: true });
    const fresh = splitCtx.get(target);
    if (fresh) beginPairResize(fresh, fresh.segEls[0], event, relayed);
  }
}

// How long moving a seam may take, laid out, before the windows stop
// following it and only its line does. A few windows follow at any speed;
// with dozens each step is a layout of all of them, and the seam lags behind
// the hand.
const LIVE_RESIZE_MS = 40;

function beginResize(ctx, segEl, event, relayed = false) {
  const geom = seamGeometry(ctx, segEl);
  if (geom.size <= 0) return;

  // A percentage guide with a seam sitting on top of it is three lines and
  // two labels in the same few pixels, and the percentage is the one you
  // did not ask for -- so it is dropped from the targets and from the
  // overlay for the length of the drag.
  const aligned = alignmentTargets(ctx, geom);
  const eclipsed = (ratio) =>
    aligned.some((target) => Math.abs(target.ratio - ratio) * geom.inner <= SNAP_DISTANCE / 2);
  const targets = [
    ...SNAP_RATIOS.filter((ratio) => !eclipsed(ratio)).map((ratio) => ({ ratio, align: false })),
    ...aligned,
  ];
  ctx.overlay.querySelectorAll(".mu-rguide").forEach((guide) => {
    guide.hidden = eclipsed(Number(guide.dataset.ratio));
  });

  resizing = {
    ...ctx,
    ...geom,
    segEl,
    targets,
    startRatio: ratioOf(ctx.node),
    ratio: ratioOf(ctx.node),
    pointerId: event.pointerId,
    // Relayed from a seam beside a bar: the pointer is not on this seam,
    // so the ratio follows how far it moves rather than where it is.
    from: relayed ? ratioAt(geom.horizontal ? event.clientX - geom.rect.left : event.clientY - geom.rect.top, geom) : null,
  };
  addAlignGuides(ctx.overlay, aligned, geom.horizontal);

  // Captured on the root element rather than on the seam, because the seam
  // may have been replaced a moment ago by the surgery above. A browser is
  // allowed to refuse; the document listeners below still see the drag.
  try {
    document.documentElement.setPointerCapture(event.pointerId);
  } catch {
    /* not capturable -- carry on uncaptured */
  }
  segEl.classList.add("is-resizing");
  lightLine([]);
  ctx.overlay.hidden = false;
  document.body.classList.add(geom.horizontal ? "mu-resizing-row" : "mu-resizing-col");
  leafIds(ctx.node).forEach((id) => setWindowMode(id, t("mu.wmode.resizing")));
  paintResize(ctx.overlay, ctx.node, resizing.ratio, null);
}

function finishResize() {
  if (!resizing) return;
  const { segEl, overlay, pointerId, horizontal } = resizing;
  const root = document.documentElement;
  try {
    if (root.hasPointerCapture(pointerId)) root.releasePointerCapture(pointerId);
  } catch {
    /* released already */
  }
  // Every piece that was lit for the drag -- a whole line lights the bands of
  // more than one seam -- not only the one it began on.
  stage.querySelectorAll(".mu-seg.is-resizing").forEach((seg) => seg.classList.remove("is-resizing"));
  segEl.classList.remove("is-resizing");
  lightLine([]);
  overlay.querySelectorAll(".mu-rguide.is-align").forEach((guide) => guide.remove());
  overlay.querySelectorAll(".mu-rguide").forEach((guide) => (guide.hidden = false));
  overlay.hidden = true;
  document.body.classList.remove(horizontal ? "mu-resizing-row" : "mu-resizing-col");
  leafIds(resizing.node).forEach((id) => setWindowMode(id, t("mu.wmode.idle")));
  resizing = null;
  // The headers that changed width under it, fitted now, and what reads the
  // layout told.
  if (pendingHeads.size) queueMicrotask(flushFits);
  relayoutSoon(true);
}

// Escape puts the ratio back. The tree keeps whatever shape the surgery
// gave it, which is invisible: it describes the same rectangles.
function cancelResize() {
  if (!resizing) return;
  resizing.node.ratio = resizing.startRatio;
  applyRatio(resizing.childEls, resizing.startRatio, resizing.node);
  finishResize();
  relayoutSoon(true);
}

// ---- per-window wiring ------------------------------------------------
function wireWindow(el, id) {
  // Anything that puts the caret or the pointer in this window makes it the
  // active one -- including clicking into one of its editors.
  //
  // Only when it lands in this frame and not in a frame inside it. Groups
  // are frames too, the root among them, and they hear a click in any of
  // their windows first (capture runs outside in): answering it would focus
  // the group -- which means its first window, the top-left one -- a moment
  // before the window actually clicked, and redraw both.
  const ownEvent = (event) => event.target.closest(".mu-window") === el;
  // The bay frame this window is the placeholder of, if it is one: beside
  // it is beside the bay, and closing it is removing the bay.
  const slotBay = () => {
    const leaf = findLeaf(id);
    return leaf && isSlotLeaf(leaf) ? bayOf(id) : null;
  };
  const besideAt = (dir) => (DIRECTIONS[dir] && slotBay() ? slotBay().id : id);
  el.addEventListener("pointerdown", (event) => ownEvent(event) && focusWindow(id), true);
  el.addEventListener("focusin", (event) => ownEvent(event) && focusWindow(id));

  // The id says which window this is; clicking it opens the window's
  // settings, and clicking it again closes them.
  const idEl = el.querySelector(".mu-window-id");
  idEl.title = t("mu.win.settings");
  idEl.addEventListener("click", (event) => {
    event.stopPropagation();
    openWindowSettings(id);
  });

  // Only ever shown on a bar too narrow for the buttons themselves, and it
  // opens exactly those buttons.
  const menu = el.querySelector(".action-menu");
  menu.addEventListener("click", (event) => {
    event.stopPropagation();
    openTitleMenu(menu, el);
  });

  el.querySelector(".action-pin").addEventListener("click", (event) => {
    event.stopPropagation();
    togglePinned(id);
  });

  el.querySelector(".action-contract").addEventListener("click", (event) => {
    event.stopPropagation();
    setExpanded(id, false);
  });

  el.querySelector(".action-collapse").addEventListener("click", (event) => {
    event.stopPropagation();
    setCollapsed(id, true);
  });

  el.querySelector(".action-expand").addEventListener("click", (event) => {
    event.stopPropagation();
    setCollapsed(id, false);
  });

  el.querySelectorAll(":scope > .mu-titlebar .action-expand-toward").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      expandToward(id, button.dataset.dir);
    });
  });

  // The app's presets, for a window whose item has some (see
  // setPresetOpener): the same chooser its input card opens, brought to the
  // bar so it is one press away from wherever the window is.
  const presets = el.querySelector(":scope > .mu-titlebar .action-presets");
  presets.addEventListener("click", (event) => {
    event.stopPropagation();
    const leaf = findLeaf(id);
    const open = leaf && framesHooks.presetOpener(currentItemId(leaf));
    if (open) open(presets);
  });

  const next = el.querySelector(":scope > .mu-titlebar .action-next-sash");
  if (next) {
    next.addEventListener("click", (event) => {
      event.stopPropagation();
      nextSash(next.dataset.bay);
    });
  }
  const prev = el.querySelector(":scope > .mu-titlebar .action-prev-sash");
  if (prev) {
    prev.addEventListener("click", (event) => {
      event.stopPropagation();
      prevSash(prev.dataset.bay);
    });
  }

  el.querySelector(".action-delete").addEventListener("click", async (event) => {
    event.stopPropagation();
    const bay = slotBay();
    if (bay) {
      // The bay itself, and every window its other sashes keep aside.
      const record = bayRecord(bay.bay);
      const kept = bayList().find((one) => one.id === bay.bay);
      const windows = kept ? kept.sashes.reduce((n, one) => n + one.windows, 0) : 0;
      if (windows && !(await framesHooks.ask(el, "confirm", t("mu.bay.confirmRemove", { name: record.name, n: windows }), { title: record.name, danger: true }))) return;
      removeBay(bay.bay);
      return;
    }
    closeWindow(id);
    commit();
  });

  // Dragging the handle offers the guides of every *other* window --
  // dropping there moves this window into that slot.
  const handle = el.querySelector(".mu-drag-handle");

  handle.addEventListener("dragstart", (event) => {
    // A bay's placeholder carries the bay: what moves is its whole frame,
    // and never into a bay (they do not nest).
    const bay = slotBay();
    const moving = bay ? bay.id : id;
    dragSourceId = moving;
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", moving);
    event.dataTransfer.setDragImage(el, 20, 12);
    el.classList.add("is-drag-source");
    setWindowMode(id, t("mu.wmode.dragging"));
    showGuides(bay ? (wid) => wid !== moving && !bayOf(wid) : (wid) => wid !== id);
    if (!bay) showLinkGuides(id);
  });

  handle.addEventListener("dragend", () => {
    hideLinkGuides();
    stage.querySelectorAll(".mu-window").forEach((w) => w.classList.remove("is-drop-target"));
    stage.querySelectorAll(".mu-guide.is-over").forEach((g) => g.classList.remove("is-over"));
    dragSourceId = null;
    // Dropped on a group's way inside: still going, by click from here.
    if (pendingMove) return;
    el.classList.remove("is-drag-source");
    setWindowMode(id, t("mu.wmode.idle"));
    hideGuides();
  });

  const guides = el.querySelector(":scope > .mu-guides");
  guides.addEventListener("click", (event) => {
    if (event.target !== guides) return;
    if (exitPendingMove()) return;
    exitPlaceMode();
  });

  guides.querySelectorAll(".mu-guide").forEach((guide) => {
    const dir = guide.dataset.dir;

    guide.addEventListener("click", () => {
      // The way inside a group: its windows' guides instead of its own.
      if (dir === "inside") {
        if (placing || pendingMove) openGroupGuides(id);
        return;
      }
      // A window dropped on a way inside, arriving where it was clicked.
      if (pendingMove) {
        const source = pendingMove;
        if (source === id) return;
        exitPendingMove();
        if (dir === "register") registerInBay(source, id);
        else if (dir === "swap") swapWindows(source, id);
        else if (dir === "group") groupWindow(source, id);
        else moveWindow(source, besideAt(dir), dir);
        return;
      }
      if (dir === "swap") return; // nothing to trade places with
      // Placing something: this window and this side are the answer, and
      // the middle means in with it rather than beside it.
      if (placing) {
        const { content: placed, make } = placing;
        exitPlaceMode();
        // In with it: what was placed lands inside the target's frame,
        // which is made around the target if it had none.
        const target = findLeaf(id);
        const host =
          dir === "group" && target && target.type === "group"
            ? defaultItemIn(target)
            : defaultItemFor(id);
        const node = make ? make() : fitLaunched(placedNode(placed), host);
        if (!node) return;
        if (dir === "register") {
          putInSlot(id, node);
          commit();
          return;
        }
        if (dir === "group") groupWindows(id, node);
        else splitWindow(besideAt(dir), dir, node);
        commit();
        return;
      }
    });

    guide.addEventListener("dragover", (event) => {
      if (!dragSourceId || dragSourceId === id) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      guide.classList.add("is-over");
      el.classList.add("is-drop-target");
      setWindowMode(
        id,
        dir === "register"
          ? t("mu.wmode.register")
          : dir === "swap"
          ? t("mu.wmode.swap")
          : dir === "group"
            ? t("mu.wmode.group")
            : dir === "inside"
              ? t("mu.wmode.inside")
              : t("mu.wmode.drop", { dir: t(`mu.dir.${dir}`) })
      );
    });

    guide.addEventListener("dragleave", () => {
      guide.classList.remove("is-over");
      el.classList.remove("is-drop-target");
      setWindowMode(id, t("mu.wmode.idle"));
    });

    guide.addEventListener("drop", (event) => {
      event.preventDefault();
      const source = dragSourceId || event.dataTransfer.getData("text/plain");
      if (!source || source === id) return;
      // The drag ends here, but the move does not: the group opens, and the
      // window goes where the next guide clicked says.
      if (dir === "inside") {
        startPendingMove(source);
        openGroupGuides(id);
        return;
      }
      if (dir === "register") registerInBay(source, id);
      else if (dir === "swap") swapWindows(source, id);
      else if (dir === "group") groupWindow(source, id);
      else moveWindow(source, besideAt(dir), dir);
    });
  });
}

// ---- app links: an app that depends on another one ------------------------
// A property link carries one value between two properties, and what may be
// carried is decided by the value types. An app link is for an app that
// leans on one particular other app -- a builder on the app it writes for --
// and it is decided by the app's type: the item type says, with a `ref`
// property marked `link: true` and an `itemType` (a name, or a list of
// them), which apps it may be linked to. What is stored is the id of the
// app, the way a child's id is, so the one linked reads the other's
// information the way a child reads its parent's. It does not own it: the
// link goes when either goes, and is never put into a preset or a saved
// app (a `ref` is not storable).
//
// It is made the way a window is moved: dragging a window by its handle
// offers its guides to every other window, and a window that has such a
// property for the dragged app's type also puts a guide along its own title
// bar. Once linked, the window says so at the top of its item. What is wanted from an app's one property is carried by an ordinary
// property link.

function showLinkGuides(draggedWindowId) {
  hideLinkGuides();
  const dragged = itemOfWindow(draggedWindowId);
  if (!dragged) return;
  // What the window stands for, by itself first, then by the apps around it.
  const standsFor = [dragged.id, ...appItemsAround(draggedWindowId)];
  // A list of links -- the screen behind an item's links row -- takes the
  // window too: its add zone is a drop place, with one guide per slot.
  stage.querySelectorAll(".mu-nodecard-addzone").forEach((zone) => {
    const options = zone.__windowDrop && !zone.hidden ? zone.__windowDrop(standsFor) : [];
    if (!options.length) return;
    const guides = Object.assign(document.createElement("div"), { className: "mu-port-guides is-window" });
    for (const option of options) {
      const guide = portGuide("add", ICONS.link || "link-45deg", option.label);
      guide.addEventListener("dragover", (event) => {
        if (!dragSourceId) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        guide.classList.add("is-over");
      });
      guide.addEventListener("dragleave", () => guide.classList.remove("is-over"));
      guide.addEventListener("drop", (event) => {
        event.preventDefault();
        event.stopPropagation();
        option.put();
        framesHooks.redrawAll();
      });
      guides.append(guide);
    }
    zone.append(guides);
  });
  eachLeaf(layoutRoot(), (leaf) => {
    if (leaf.id === draggedWindowId || isSlotLeaf(leaf)) return;
    const item = getItem(currentItemId(leaf));
    const el = item && windowEl(leaf.id);
    const strip = el && el.querySelector(":scope > .mu-link-strip");
    if (!strip) return;
    for (const option of linkOptionsFor(item, standsFor)) {
      const { source, name } = option;
      const guide = document.createElement("button");
      guide.type = "button";
      guide.className = "mu-guide guide-link";
      guide.title = t("mu.link.guideTitle", { app: itemLabel(source), name });
      guide.append(
        Object.assign(document.createElement("i"), { className: `bi bi-${ICONS.link || "link-45deg"}` }),
        Object.assign(document.createElement("span"), { className: "mu-guide-label", textContent: t("mu.link.guide", { name }) })
      );
      guide.addEventListener("dragover", (event) => {
        if (!dragSourceId) return;
        event.preventDefault();
        // The drag was started as a move (effectAllowed): any other effect is
        // refused by the browser and the drop never happens.
        event.dataTransfer.dropEffect = "move";
        guide.classList.add("is-over");
        el.classList.add("is-drop-target");
        setWindowMode(leaf.id, t("mu.wmode.link", { name }));
      });
      guide.addEventListener("dragleave", () => {
        guide.classList.remove("is-over");
        el.classList.remove("is-drop-target");
        setWindowMode(leaf.id, t("mu.wmode.idle"));
      });
      guide.addEventListener("drop", (event) => {
        event.preventDefault();
        event.stopPropagation();
        putLink(item, option);
        setWindowMode(leaf.id, t("mu.wmode.idle"));
        framesHooks.redrawAll();
      });
      strip.append(guide);
    }
    el.classList.toggle("has-link-guide", strip.children.length > 0);
  });
}

function hideLinkGuides() {
  stage.querySelectorAll(".mu-port-guides.is-window").forEach((guides) => guides.remove());
  stage.querySelectorAll(".mu-link-strip").forEach((strip) => strip.replaceChildren());
  stage.querySelectorAll(".mu-window.has-link-guide").forEach((el) => el.classList.remove("has-link-guide"));
}

// What a run is saying now, by item and program (see ctx.progress): kept here,
// and told to whoever draws that program's state row.

// The app frame being worked in: the nearest group above the focused
// window that is an app's frame.
function workingAppFrame() {
  let group = focusedWindowId ? groupOf(focusedWindowId) : null;
  while (group && !(group.appItem && getItem(group.appItem))) group = groupOf(group.id);
  return group;
}

// ---- keyboard ---------------------------------------------------------
// One dispatcher, three layers: an in-flight gesture first, then the item
// in the focused window, then the shell's own shortcuts. Nothing is handled
// document-wide any more, which is what lets real apps live in the windows.
function comboOf(event) {
  const parts = [];
  if (event.ctrlKey) parts.push("ctrl");
  if (event.altKey) parts.push("alt");
  if (event.shiftKey) parts.push("shift");
  parts.push(event.key.length === 1 ? event.key.toLowerCase() : event.key);
  return parts.join("+");
}

// A bare key belongs to whatever is being typed into; a modified one is a
// shortcut and reaches the shell even from inside a field.
function isTyping(event) {
  const el = event.target;
  if (!el || !el.matches) return false;
  return el.matches("input, textarea, select") || Boolean(el.closest('[contenteditable]:not([contenteditable="false"])'));
}

const SHELL_KEYS = {
  "alt+ArrowLeft": () => moveFocus("left"),
  "alt+ArrowRight": () => moveFocus("right"),
  "alt+ArrowUp": () => moveFocus("up"),
  "alt+ArrowDown": () => moveFocus("down"),
  Escape: () => {
    // The lightest thing open goes first: a popup is a glance, not a mode.
    if (resizing) return cancelResize(), true;
    if (pendingMove) return exitPendingMove();
    if (placing) return exitPlaceMode();
    // Nothing left to cancel: let go of the focus. Not "handled" for the
    // browser's sake -- an open dialog still gets its own Escape.
    clearFocus();
    return false;
  },
};

function moveFocus(direction) {
  // With nothing active there is nowhere to move from: the first window.
  if (!focusedWindowId) {
    const first = leafIds(layoutRoot())[0];
    if (!first) return false;
    focusWindow(first, { moveDom: true });
    return true;
  }
  const id = neighbourWindow(direction);
  if (!id) return false;
  focusWindow(id, { moveDom: true });
  return true;
}

function reopenApp(frame) {
  const id = frame && frame.app;
  if (!id || !appDef(id)) return false;
  const fresh = launchAppNode(id);
  if (!fresh || !swapNode(frame, fresh)) return false;
  commit();
  return true;
}

function placeApp(id) {
  if (!appDef(id)) throw new Error(`unknown app: ${id}`);
  return enterPlaceNode(() => launchAppNode(id), () => true);
}

// An item type as one window of its own, opened where a guide is clicked: an
// app that has not been kept -- it is no app's frame, so nothing is
// remembered about it -- until it is made one (captureApp, "keep as app").
// Only what can be opened on its own.
function placeAlone(type) {
  if (!isStandalone(ITEM_TYPES[type])) throw new Error(`${type} cannot be opened on its own`);
  return enterPlaceNode(() => launchNode(type, {}, null, { alone: true }), () => true);
}

function refreshAppChrome() {
  (function walk(node) {
    if (!node) return;
    if (node.app) {
      const def = appDef(node.app);
      const el = windowEl(node.id);
      const bar = el && el.querySelector(":scope > .mu-titlebar");
      if (def && bar) {
        const label = bar.querySelector(node.type === "group" ? ".mu-group-label" : ".mu-crumb:first-child .mu-crumb-label");
        const icon = bar.querySelector(node.type === "group" ? ".mu-group-icon" : ".mu-crumb:first-child .mu-crumb-icon");
        if (label && label.textContent !== def.name) {
          label.textContent = def.name;
          placeTitle(el);
        }
        const wanted = `${node.type === "group" ? "mu-group-icon" : "mu-crumb-icon"} bi bi-${ICONS[def.icon] || def.icon || "window"}`;
        if (icon && icon.className !== wanted) icon.className = wanted;
      }
    }
    if (isContainer(node)) node.children.forEach(walk);
  })(layoutRoot());
}

// A bay's way along its sashes as a hotkey action: pointed at the bay, found
// on the button every window it frames wears.
function baySashAction(label, icon, selector, run) {
  return {
    label,
    icon,
    bay: true,
    targets: () =>
      Array.from(stage.querySelectorAll(`.mu-window > .mu-titlebar ${selector}`))
        .filter((button) => button.getClientRects().length)
        .filter((button) => {
          const bay = bayFrame(button.dataset.bay);
          return bay && outerAppFrame(bay.id);
        })
        .map((button) => ({ target: button.dataset.bay, el: button })),
    run,
    labelOf: (bayId) => (bayRecord(bayId) || {}).name || "",
    exists: (bayId) => Boolean(bayRecord(bayId)),
  };
}

// One of a window's title bar buttons as a hotkey action, pointed at the
// window. Only windows that are part of an app (a binding is an app's), and
// only where the button is showing: a guide goes on the button itself.
function windowToolAction(label, icon, selector, { run }) {
  return {
    label,
    icon,
    targets: () =>
      Array.from(stage.querySelectorAll(".mu-window:not(.is-root):not(.is-bay):not(.is-bay-slot)"))
        .filter((el) => {
          const node = findLeaf(el.dataset.id);
          return node && outerAppFrame(node.id) && (node.type === "leaf" || (node.app && appDef(node.app)));
        })
        .map((el) => ({ target: el.dataset.id, el: el.querySelector(`:scope > .mu-titlebar ${selector}`) }))
        .filter(({ el }) => el && el.getClientRects().length && !el.disabled),
    run,
    labelOf: (id) => {
      const node = id && (findLeaf(id) || stashedNode(id));
      if (!node) return "";
      return node.type === "group" ? groupLabel(node) : itemLabel(currentItemId(node));
    },
    exists: (id) => Boolean(findLeaf(id) || stashedNode(id)),
  };
}

let hotkeyPick = null; // the open pick mode: {overlay, resolve}

let lastAppFrameId = null; // the outermost app frame worked in last

function framesInOrder(frames) {
  const focused = focusedWindowId ? outerAppFrame(focusedWindowId) : null;
  return [...frames].sort((a, b) => {
    const rank = (one) => (one === focused ? 0 : one.id === lastAppFrameId ? 1 : 2);
    return rank(a) - rank(b);
  });
}

function runHotkey(event) {
  if (hotkeyPick) return false;
  const combo = hotkeyCombo(event);
  if (!combo) return false;
  for (const frame of framesInOrder(outerAppFrames())) {
    const def = appDef(frame.app);
    const binding = def && (def.hotkeys || []).find((one) => one.key === combo);
    if (!binding) continue;
    const target = resolveHotkeyAddress(frame, binding.at);
    if (!target) continue;
    // The shell's rule for its own keys too: a bare key belongs to
    // whatever is being typed into. F keys type nothing, so they always
    // reach here.
    if (!event.ctrlKey && !event.altKey && !event.metaKey && !/^F\d+$/.test(combo) && isTyping(event)) return false;
    // Held down, the key would fold and open the window over and over.
    if (!event.repeat) HOTKEY_ACTIONS[binding.action].run(target);
    return true;
  }
  return false;
}

// Fold a frame, or open it again. Open counts what the person sees: a
// window inside a group that folded with it (collapseTarget) is shown as
// that group's bar, so opening it opens the group too.
function toggleCollapsed(id) {
  const node = findLeaf(id);
  if (!node || node === layoutRoot()) return false;
  const folded = [node];
  for (let group = groupOf(id); group && group !== layoutRoot(); group = groupOf(group.id)) folded.push(group);
  const closed = folded.filter((one) => one.collapsed);
  if (!closed.length) return setCollapsed(id, true);
  // One frame to open is opened as the button opens it.
  if (closed.length === 1) return setCollapsed(closed[0].id, false);
  return withBarMotion(() => {
    closed.forEach((one) => delete one.collapsed);
    commit({ keep: true, inPlace: true });
    return true;
  });
}

function pickHotkeyTarget(only = null) {
  if (only && !HOTKEY_ACTIONS[only]) throw new Error(`unknown hotkey action: ${only}`);
  const targets = Object.entries(HOTKEY_ACTIONS)
    .filter(([action]) => !only || action === only)
    .flatMap(([action, spec]) =>
      spec.targets().map((one) => {
        const label = hotkeyTargetLabel(action, one.target);
        return { el: one.el, label, title: `${t(HOTKEY_ACTIONS[action].label)} · ${label}`, answer: { action, target: one.target } };
      })
    );
  return openPick(targets, t("mu.hotkey.pickBanner"), t("mu.hotkey.pickNone"));
}

// Choosing a window on screen: every frame -- a window or a group, not the
// stage and not a bay's bar-less frame -- wears a guide over its title bar,
// named; the one clicked is the answer (its id), Escape or a click
// elsewhere none (null).
function pickWindow() {
  const targets = Array.from(stage.querySelectorAll(".mu-window:not(.is-root):not(.is-bay)"))
    .map((el) => {
      const bar = el.querySelector(":scope > .mu-titlebar");
      if (!bar || !bar.getClientRects().length || !bar.getBoundingClientRect().width) return null;
      const node = findLeaf(el.dataset.id);
      if (!node) return null;
      const label = node.type === "group" ? groupLabel(node) : itemLabel(currentItemId(node));
      return { el: bar, label, title: `${label} · ${node.id}`, answer: node.id };
    })
    .filter(Boolean);
  // A bay has no bar of its own: it is offered by a tab on its lower edge.
  stage.querySelectorAll(".mu-window.is-bay").forEach((el) => {
    const record = bayRecord(findLeaf(el.dataset.id) && findLeaf(el.dataset.id).bay);
    const box = el.getBoundingClientRect();
    if (!record || !box.width || !box.height) return;
    const width = Math.min(160, box.width - 8);
    const tab = { left: box.left + (box.width - width) / 2, top: box.bottom - 30, width, height: 24 };
    const label = `${record.name} · ${t("mu.item.bayslot")}`;
    targets.push({ el: { getBoundingClientRect: () => tab }, label, title: label, answer: el.dataset.id, tagAbove: true });
  });
  return openPick(targets, t("mu.pick.window"), t("mu.pick.noWindow"));
}

// The overlay both are drawn in: a guide over each target's element, with
// its name on a tag. Resolves to the clicked one's `answer`, or null.
function openPick(targets, bannerText, noneText) {
  exitHotkeyPick();
  exitPlaceMode();
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "mu-hotkey-pick";
    const banner = document.createElement("div");
    banner.className = "mu-hotkey-pick-banner";
    banner.textContent = targets.length ? bannerText : noneText;
    overlay.append(banner);
    for (const one of targets) {
      const box = one.el.getBoundingClientRect();
      const guide = document.createElement("button");
      guide.type = "button";
      guide.className = "mu-guide mu-hotkey-guide";
      const pad = 3;
      Object.assign(guide.style, {
        left: `${box.left - pad}px`,
        top: `${box.top - pad}px`,
        width: `${box.width + pad * 2}px`,
        height: `${box.height + pad * 2}px`,
      });
      guide.title = one.title || one.label;
      const tag = document.createElement("span");
      tag.className = `mu-hotkey-guide-tag${one.tagAbove ? " is-above" : ""}`;
      tag.textContent = one.label;
      guide.append(tag);
      guide.addEventListener("click", (event) => {
        event.stopPropagation();
        exitHotkeyPick(one.answer);
      });
      overlay.append(guide);
    }
    overlay.addEventListener("click", () => exitHotkeyPick());
    overlay.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      exitHotkeyPick();
    });
    document.body.append(overlay);
    hotkeyPick = { overlay, resolve };
  });
}

function exitHotkeyPick(answer = null) {
  if (!hotkeyPick) return false;
  const { overlay, resolve } = hotkeyPick;
  hotkeyPick = null;
  overlay.remove();
  resolve(answer);
  return true;
}































// Put a bay on screen: the place guides, and the frame where one is
// clicked. Already there, it is brought forward instead.
function placeBay(bayId) {
  needBay(bayId);
  const frame = bayFrame(bayId);
  if (frame) {
    const first = leafIds(frame)[0];
    if (first) focusWindow(first, { moveDom: true });
    return true;
  }
  enterPlaceNode(() => {
    const record = bayRecord(bayId);
    if (!record || bayFrame(bayId)) return null;
    return { type: "group", id: newWindowId(), bay: bayId, children: [takeContent(record)] };
  });
  return true;
}
















// Another tab (or the Settings page) changed the shared profile: redraw so
// the settings item shows the new value instead of a stale one.
let lastLanguage = null;

// A language change has to rebuild everything, not just refresh: labels are
// baked into the breadcrumbs, the editors and the static chrome alike.
function applyLanguage() {
  const now = language();
  if (now === lastLanguage) return false;
  lastLanguage = now;
  applyTranslations(document);
  if (layoutRoot()) render();
  return true;
}

// The page or the stage changing size can change which way a bar fits, as
// well as what the items that read the window's geometry are told. Both come
// in bursts while a window is dragged larger, so they are answered once a
// frame, and only the items that read the geometry are drawn again: the rest
// have their own observers for what they lay out.
let relayoutFrame = 0;

let relayoutBars = false;

function relayoutSoon(bars) {
  relayoutBars = relayoutBars || bars;
  if (relayoutFrame) return;
  relayoutFrame = requestAnimationFrame(() => {
    relayoutFrame = 0;
    const fit = relayoutBars;
    relayoutBars = false;
    if (fit) fitBars();
    // Not while a seam is dragged: what reads the layout is drawn again
    // where it is let go, not at every step of the way.
    if (!resizing) framesHooks.layoutMoved();
  });
}
// frames: its listeners and what it puts into other modules.

// Whether a window's title bar wears a button now (`action` as in .action-<action>).
function barHas(windowId, action) {
  const el = windowEl(windowId);
  return Boolean(el && el.querySelector(`:scope > .mu-titlebar .action-${action}`));
}

export {
  barHas,
  focusedWindow,
  startFrames,
  wireFrames,
  stageEl,
  SNAP_RATIOS,
  SNAP_DISTANCE,
  MIN_PANE,
  openedGroups,
  windowModes,
  framesHooks,
  registerFramesHook,
  focusWindow,
  clearFocus,
  restoreFocus,
  neighbourWindow,
  mixedAxes,
  stageContext,
  splitChildContext,
  swapWindows,
  applyAppSettings,
  revealItem,
  openInWindow,
  windowFacts,
  windowProperties,
  propertyUsers,
  groupLabel,
  buildGroupCrumbs,
  buildBreadcrumbs,
  setExpanded,
  paintExpanded,
  guidesMarkup,
  TITLE_TOOLS,
  TITLE_TOOL_ICONS,
  hiddenToolsOf,
  toolShown,
  setToolShown,
  bayAxisOf,
  barSideways,
  buildFrame,
  buildWindow,
  buildGroup,
  buildOverlay,
  splitCtx,
  buildNode,
  pinOf,
  seamSize,
  pinnedSize,
  holdChild,
  setPinned,
  togglePinned,
  shapeOf,
  patchLayout,
  patchFrame,
  MIN_BAR,
  BAR_BUTTON,
  fitBars,
  fitBarsTools,
  placeTitle,
  placeTitles,
  bar_box,
  drawPathChange,
  drawLayoutChange,
  render,
  tintOf,
  applyTint,
  windowEl,
  setWindowMode,
  showGuides,
  paintGuides,
  openGroupGuides,
  startPendingMove,
  exitPendingMove,
  hideGuides,
  enterPlaceMode,
  enterPlaceNode,
  exitPlaceMode,
  frameRects,
  playSettled,
  withBarMotion,
  contextFor,
  contextOfSplit,
  redrawBay,
  slideSash,
  allCollapsed,
  collapseTarget,
  setCollapsed,
  restoreSides,
  MIN_NEIGHBOUR,
  foldedSizes,
  restoreFromBothSides,
  neighbourSide,
  neighbourToward,
  openAtEdge,
  expandDirections,
  foldWithin,
  expandToward,
  CUT_EPS,
  opposite,
  fullCuts,
  seamSegments,
  edgeFrames,
  seamBandShown,
  markQuietBands,
  splitAt,
  isolateSegment,
  swapNode,
  seamGeometry,
  ratioAt,
  alignmentTargets,
  snapRatio,
  addAlignGuides,
  paintResize,
  applyRatio,
  ancestorsOf,
  seamRelay,
  seamBeyond,
  LINE_SWITCH,
  seamCentre,
  wholeLineOf,
  wholeLineSegs,
  wantsWhole,
  lightLine,
  startWholeDrag,
  wireResizer,
  piecesAlong,
  isolatePair,
  isolateAcrossBars,
  beginPairResize,
  startSeamDrag,
  LIVE_RESIZE_MS,
  beginResize,
  finishResize,
  cancelResize,
  wireWindow,
  showLinkGuides,
  hideLinkGuides,
  workingAppFrame,
  comboOf,
  isTyping,
  SHELL_KEYS,
  moveFocus,
  reopenApp,
  placeApp,
  placeAlone,
  refreshAppChrome,
  baySashAction,
  windowToolAction,
  framesInOrder,
  runHotkey,
  toggleCollapsed,
  pickHotkeyTarget,
  pickWindow,
  openPick,
  exitHotkeyPick,
  placeBay,
  applyLanguage,
  relayoutSoon,
};
