/* hotkeys: moved out of core.js (docs/wiki/migration.md). */
import { ICONS, allBays, appDef, appList, bayFrame, containsNode, eachOwnNode, findIn, findLeaf, freeTag, getItem, groupOf, isContainer, launchItemAt, layoutRoot, scheduleLaunchKeep, scheduleSave, setApp, t } from "./deps.js";

// What a binding can do, by action name: filled by frames, which draws the
// guides and presses what the key stands in for (label, icon, bay, targets,
// run, labelOf, exists).
const HOTKEY_ACTIONS = {};

// What hotkeys asks of others (registerHotkeysHook):
//   order(frames)  -- an app's frames, the one being worked in first (frames)
// and what it says: "change" with { drafts } after a row with no target changed.
const hotkeysHooks = {
  order: (frames) => frames,
};

function registerHotkeysHook(kind, fn) {
  hotkeysHooks[kind] = fn;
}

let hotkeysChanged = () => {};
export function connectEvents(emit) {
  hotkeysChanged = (change) => emit("change", change);
}

// ---- hotkeys ------------------------------------------------------------
// A key the person bound to something on screen: folding a window (or an
// app's frame) and opening it again, or sliding a bay's next sash in. The
// shell runs them; the Hotkeys app edits them through hotkeys:read /
// hotkeys:write.
//
// Keys are read by position (event.code), not by character: Shift+1 is
// "!" on one keyboard and something else on the next.
const HOTKEY_KEYS = [
  // F5 reloads, F11 is full screen and F12 the developer tools: the
  // browser keeps those whatever the page says.
  ...["F1", "F2", "F3", "F4", "F6", "F7", "F8", "F9", "F10"],
  // A key on its own. Never taken from a field being typed into (see
  // runHotkey): there it is a letter, not a command.
  ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ".split(""),
  ..."1234567890".split(""),
  ..."1234567890".split("").map((d) => `Alt+${d}`),
  ..."1234567890".split("").map((d) => `Ctrl+Alt+${d}`),
  ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").map((c) => `Ctrl+Alt+${c}`),
];

// What a binding can do. Each action says which frames it can be pointed
// at -- the pick mode's guides -- and what pressing the key does to one.
// frames: what a binding can do on screen goes into hotkeys' table.

function stashedNode(id) {
  for (const record of allBays()) {
    for (const sash of record.sashes) {
      const hit = findIn(sash.content, id);
      if (hit) return hit;
    }
  }
  return null;
}

// The bindings are an app's: a property of the app value (`hotkeys`,
// [{id, key, action, at}]), saved with it -- in a person's own app's
// preset, in a built-in app's override. A window that is not part of any
// app has none. `at` says where the target is, from the outermost app frame
// it is in: the tags of the apps nested inside it on the way down (that is
// what tells the same app in two places apart), then the target in the
// innermost one --
//
//   frame            that app's frame itself
//   self | a.b       its main item's window, or the window of an item it
//                    owns (the launch layout's names)
//   +a1              a window added to it by type, by its tag
//   bay:b1           a bay inside it
//
// e.g. "b1/preview": the preview of the app tagged b1 inside this one. With
// the same app open more than once, a key works in the one being worked
// in (or, failing that, the one worked in last).
let hotkeyDrafts = []; // rows with no target yet: [{id, key}], not saved

function hotkeyCombo(event) {
  const code = event.code || "";
  let key = null;
  if (/^F\d{1,2}$/.test(code)) key = code;
  else if (/^Digit\d$/.test(code)) key = code.slice(5);
  else if (/^Key[A-Z]$/.test(code)) key = code.slice(3);
  if (!key) return null;
  const parts = [];
  if (event.ctrlKey) parts.push("Ctrl");
  if (event.altKey) parts.push("Alt");
  if (event.shiftKey) parts.push("Shift");
  parts.push(key);
  return parts.join("+");
}

// The app frame around a node, itself included: the nearest, or the
// outermost.
function innerAppFrame(id) {
  for (let node = id ? findLeaf(id) : null; node; node = groupOf(node.id)) {
    if (node.app && appDef(node.app)) return node;
  }
  return null;
}

function outerAppFrame(id) {
  let found = null;
  for (let node = id ? findLeaf(id) : null; node; node = groupOf(node.id)) {
    if (node.app && appDef(node.app)) found = node;
  }
  return found;
}

// The app frames on screen that are not inside another.
function outerAppFrames() {
  const out = [];
  (function walk(node) {
    if (!node) return;
    if (node !== layoutRoot() && node.app && appDef(node.app)) {
      out.push(node);
      return;
    }
    if (isContainer(node)) node.children.forEach(walk);
  })(layoutRoot());
  return out;
}

function frameMain(frame) {
  return frame.type === "group" ? getItem(frame.appItem) : getItem(frame.path[0]);
}

function rolePath(app, itemId) {
  return app && itemId === app.id ? "self" : null;
}

// A target on screen (a window, or a bay) as {app, at}: from its outermost
// app frame. null when it is in no app. Tags a target or a nested app
// needs and lacks are given now, and kept with the app's layout.
function hotkeyAddress(action, target) {
  const forBay = Boolean(HOTKEY_ACTIONS[action] && HOTKEY_ACTIONS[action].bay);
  const node = forBay ? bayFrame(target) : findLeaf(target);
  if (!node) return null;
  const outer = outerAppFrame(node.id);
  if (!outer) return null;
  const home = action === "collapse" && node.app && appDef(node.app) ? node : innerAppFrame(forBay ? groupOf(node.id).id : node.id);
  if (!home) return null;
  let tagged = false;
  // The apps between: each named by its tag in the app around it.
  const steps = [];
  for (let at = home; at && at !== outer; at = innerAppFrame(groupOf(at.id) && groupOf(at.id).id)) {
    if (!at.tag) {
      at.tag = freeTag(innerAppFrame(groupOf(at.id).id), "b");
      tagged = true;
    }
    steps.unshift(at.tag);
  }
  let last;
  if (forBay) {
    if (!node.tag) {
      node.tag = freeTag(home, "y");
      tagged = true;
    }
    last = `bay:${node.tag}`;
  }
  else if (node === home) last = "frame";
  else if (node.type === "leaf") {
    last = rolePath(frameMain(home), node.path[0]);
    if (!last) {
      if (!node.tag) {
        node.tag = freeTag(home, "a");
        tagged = true;
      }
      last = `+${node.tag}`;
    }
  } else return null; // a plain group inside an app has no name to be found by
  if (tagged) {
    scheduleSave();
    scheduleLaunchKeep();
  }
  return { app: outer.app, at: [...steps, last].join("/") };
}

// An address in one frame of its app: the window id (or bay id) it names
// there now, or null.
function resolveHotkeyAddress(frame, at) {
  if (!frame || typeof at !== "string" || !at) return null;
  const steps = at.split("/");
  let home = frame;
  const tagged = (within, tag, app) => {
    let hit = null;
    eachOwnNode(within, (node) => {
      if (!hit && node !== within && node.tag === tag && (app ? node.app && appDef(node.app) : node.type === "leaf")) hit = node;
    });
    return hit;
  };
  for (const tag of steps.slice(0, -1)) {
    home = tagged(home, tag, true);
    if (!home) return null;
  }
  const last = steps[steps.length - 1];
  if (last === "frame") return home.id;
  if (last.startsWith("bay:")) {
    // By its tag in the app (an older binding: by the bay's own id).
    const name = last.slice(4);
    let bay = null;
    eachOwnNode(home, (node) => {
      if (!bay && node.bay && node.tag === name) bay = node;
    });
    if (!bay) bay = bayFrame(name);
    return bay && containsNode(home, bay) ? bay.bay : null;
  }
  if (last.startsWith("+")) {
    const leaf = tagged(home, last.slice(1), false);
    return leaf ? leaf.id : null;
  }
  const main = frameMain(home);
  const itemId = main ? launchItemAt(main, last) : null;
  let found = null;
  eachOwnNode(home, (node) => {
    if (!found && node.type === "leaf" && node.path[0] === itemId) found = node.id;
  });
  return found;
}

// The frames of an app a key could work in, the one being worked in first.

// What a target on screen is called, for the pick guides and the list.
function hotkeyTargetLabel(action, id) {
  const spec = HOTKEY_ACTIONS[action];
  return spec && id ? spec.labelOf(id) : "";
}

const DRAFT = "#";

// Every binding of every app, and the rows still waiting for a target.
// `id` is "<app>#<binding>", or "#<draft>". Where the app is open, the
// target is looked up in the frame worked in (`target`, a window or bay
// id); `offScreen` when it is not open at all.
function hotkeyList() {
  const out = [];
  const frames = outerAppFrames();
  const describeAction = (action) => ({
    actionLabel: t(HOTKEY_ACTIONS[action].label),
    icon: ICONS[HOTKEY_ACTIONS[action].icon] || HOTKEY_ACTIONS[action].icon,
  });
  for (const def of appList()) {
    const mine = hotkeysHooks.order(frames.filter((frame) => frame.app === def.id));
    for (const one of def.hotkeys || []) {
      const target = mine.length ? resolveHotkeyAddress(mine[0], one.at) : null;
      out.push({
        id: `${def.id}${DRAFT}${one.id}`,
        app: def.id,
        appName: def.name,
        key: one.key,
        action: one.action,
        at: one.at,
        target: target || "",
        targetLabel: target ? hotkeyTargetLabel(one.action, target) : one.at,
        missing: Boolean(mine.length) && !target,
        offScreen: !mine.length,
        ...describeAction(one.action),
      });
    }
  }
  for (const draft of hotkeyDrafts) {
    out.push({
      id: `${DRAFT}${draft.id}`,
      app: "",
      appName: "",
      key: draft.key,
      action: "collapse",
      at: "",
      target: "",
      targetLabel: "",
      missing: false,
      offScreen: false,
      draft: true,
      ...describeAction("collapse"),
    });
  }
  return out;
}

function hotkeyParts(id) {
  const at = String(id || "").indexOf(DRAFT);
  if (at < 0) throw new Error(`unknown hotkey: ${id}`);
  return { app: String(id).slice(0, at), binding: String(id).slice(at + 1) };
}

function nextBindingId(list, prefix) {
  let n = 1;
  while (list.some((one) => one.id === `${prefix}${n}`)) n += 1;
  return `${prefix}${n}`;
}

// A new row: a key, then a target -- it belongs to an app once it has one.
function addHotkey({ key = "" } = {}) {
  const draft = { id: nextBindingId(hotkeyDrafts, "d"), key: "" };
  hotkeyDrafts.push(draft);
  const id = `${DRAFT}${draft.id}`;
  if (key) setHotkey(id, { key });
  else hotkeysChanged({ drafts: true });
  return id;
}

// One key does one thing in an app: binding a key already in use there
// takes it from the binding that had it. A target (a window or bay id, from
// the pick) is turned into where it is in its app, and the binding goes to
// that app -- from the row it was, or from another app.
function setHotkey(id, patch = {}) {
  const { app, binding } = hotkeyParts(id);
  if (patch.key !== undefined && patch.key && !HOTKEY_KEYS.includes(patch.key)) throw new Error(`not a hotkey: ${patch.key}`);
  if (patch.action !== undefined && !HOTKEY_ACTIONS[patch.action]) throw new Error(`unknown hotkey action: ${patch.action}`);
  const draft = app ? null : hotkeyDrafts.find((one) => one.id === binding);
  const def = app ? appDef(app) : null;
  const saved = def ? (def.hotkeys || []).find((one) => one.id === binding) : null;
  if (!draft && !saved) throw new Error(`unknown hotkey: ${id}`);
  const key = patch.key !== undefined ? patch.key : (draft || saved).key;
  const action = patch.action !== undefined ? patch.action : saved ? saved.action : "collapse";

  if (patch.target === undefined) {
    if (draft) {
      draft.key = key;
      hotkeysChanged({ drafts: true });
      return Promise.resolve(id);
    }
    const list = def.hotkeys.map((one) =>
      one.id === binding ? { ...one, key, action } : key && one.key === key ? { ...one, key: "" } : one
    );
    return setApp(app, { hotkeys: list }).then(() => id);
  }

  const place = hotkeyAddress(action, patch.target);
  if (!place) throw new Error("only something inside an app can have a hotkey");
  // Out of where it was...
  const leaving = draft
    ? (() => {
        hotkeyDrafts = hotkeyDrafts.filter((one) => one !== draft);
        return Promise.resolve();
      })()
    : place.app === app
      ? Promise.resolve()
      : setApp(app, { hotkeys: def.hotkeys.filter((one) => one.id !== binding) });
  // ...and into its app.
  const home = appDef(place.app);
  const others = (home.hotkeys || []).filter((one) => !(place.app === app && one.id === binding));
  const newId = place.app === app ? binding : nextBindingId(others, "k");
  const list = [
    ...others.map((one) => (key && one.key === key ? { ...one, key: "" } : one)),
    { id: newId, key, action, at: place.at },
  ];
  return leaving.then(() => setApp(place.app, { hotkeys: list })).then(() => `${place.app}${DRAFT}${newId}`);
}

function removeHotkey(id) {
  const { app, binding } = hotkeyParts(id);
  if (!app) {
    hotkeyDrafts = hotkeyDrafts.filter((one) => one.id !== binding);
    hotkeysChanged({ drafts: true });
    return Promise.resolve(true);
  }
  const def = appDef(app);
  if (!def) return Promise.resolve(false);
  return setApp(app, { hotkeys: (def.hotkeys || []).filter((one) => one.id !== binding) });
}

// hotkeys: an app value's hotkeys are hotkeys' to make whole.

function coerceHotkeys(list) {
  const seen = new Set();
  const keys = new Set();
  return (Array.isArray(list) ? list : [])
    .filter((one) => one && typeof one.id === "string" && one.id && HOTKEY_ACTIONS[one.action] && typeof one.at === "string" && one.at)
    .filter((one) => !seen.has(one.id) && seen.add(one.id))
    .map((one) => {
      let key = HOTKEY_KEYS.includes(one.key) ? one.key : "";
      if (key && keys.has(key)) key = "";
      if (key) keys.add(key);
      return { id: one.id, key, action: one.action, at: one.at };
    });
}

// Choosing what a key acts on: every control a key can stand in for wears
// a guide -- of one action, or of all of them when none is named -- and
// the one clicked is the answer, with the action it belongs to. Escape, or
// a click anywhere else, is no answer (null).

export {
  HOTKEY_ACTIONS,
  hotkeysHooks,
  registerHotkeysHook,
  HOTKEY_KEYS,
  stashedNode,
  hotkeyCombo,
  innerAppFrame,
  outerAppFrame,
  outerAppFrames,
  frameMain,
  rolePath,
  hotkeyAddress,
  resolveHotkeyAddress,
  hotkeyTargetLabel,
  DRAFT,
  hotkeyList,
  hotkeyParts,
  nextBindingId,
  addHotkey,
  setHotkey,
  removeHotkey,
  coerceHotkeys,
};
