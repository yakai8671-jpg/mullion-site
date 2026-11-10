/* operations: moved out of core.js (docs/wiki/migration.md). The operation
 * history (undo, redo, restore), saving the layout to the profile, and layout
 * files. */
import { CONTROLS, ITEM_TYPES, OperationHistory, adopt, announceRestore, appDef, appList, applyHistorySnapshot, claimItemIds, claimWindowIds, commit, controlFor, isStandalone, layoutRoot, layoutText, nodeIds, partitionHistory, reservedItemIds, reservedWindowIds, serialize, t, settings, toast } from "./deps.js";

// What operations asks of others (registerOperationsHook):
//   halted()     -- the page has stopped: nothing is saved (mount)
//   resizing()   -- a seam is being dragged: no operation of its own (frames)
//   deferring()  -- a typed write is under way: merged into the last one (mount)
// and what it says: "change" with { history } after the history changed.
const operationsHooks = {
  halted: () => false,
  resizing: () => false,
  deferring: () => false,
};

function registerOperationsHook(kind, fn) {
  operationsHooks[kind] = fn;
}

let operationsChanged = () => {};
export function connectEvents(emit) {
  operationsChanged = (change) => emit("change", change);
}

// Whether a layout has been read (init): before that, nothing is recorded or saved.
let adopted = false;
let currentFile = null; // last file saved to / opened from
let saveTimer = null;

function operationsReady() {
  return adopted;
}

// The layout has been read: from here on changes are operations.
function startOperations() {
  adopted = true;
  syncHistoryExclusions();
  operationHistory.reset(operationSnapshot());
  refreshHistorySoon();
}

// The control a coming change is made through, named in its history entry.
function noteControl(control) {
  operationControl = control;
}

function currentFileName() {
  return currentFile;
}

function forgetFile() {
  currentFile = null;
}

function scheduleSave() {
  if (operationsHooks.halted()) return;
  if (!adopted) return;
  captureOperation();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    // Stored as a JSON string: the settings store deep-merges objects, which
    // would leave stale keys behind when a leaf turns into a split.
    settings.update({ mullion: { layout: JSON.stringify(serialize()) } }, { quiet: true }).catch(() => {});
  }, 400);
}

// History covers the serializable workspace. Disk writes, jobs, the library
// and profile settings belong to their services and are not replayed here.
// Made in setup, once history's OperationHistory has been handed in.
let operationHistory = null;
export function createHistory() {
  operationHistory = new OperationHistory();
}
let restoringOperation = false;
let historyRefreshPending = false;
let operationControl = null;
let historyExclusionKey = null;

function historyExclusions() {
  return new Set(appList().filter((app) => app.excludeHistory).map((app) => app.id));
}

function operationSnapshot() {
  return partitionHistory(serialize(), historyExclusions()).snapshot;
}

// Changing the scope starts a fresh baseline: old snapshots must not remove
// an app whose values were intentionally absent while it was excluded.
function syncHistoryExclusions() {
  const key = JSON.stringify([...historyExclusions()].sort());
  if (key === historyExclusionKey) return false;
  historyExclusionKey = key;
  if (operationHistory.current) {
    operationHistory.reset(operationSnapshot());
    refreshHistorySoon();
    return true;
  }
  return false;
}

function operationTargets(before, next, changes, control) {
  const targets = [];
  const walk = (node, fn, owner = "") => {
    if (!node) return;
    const app = node.app || owner;
    fn(node, app);
    for (const child of node.children || []) walk(child, fn, app);
  };
  const windows = (snapshot) => {
    const out = [];
    const add = (node, app) => { if (node.id && node.id !== "root" && node.type !== "history-excluded") out.push({ node, app }); };
    walk(snapshot.root, add);
    for (const bay of snapshot.bays || []) for (const sash of bay.sashes) walk(sash.content, add);
    return out;
  };
  const current = windows(next);
  const prior = windows(before);
  const describe = (item, key = "", place = null) => {
    const def = item && ITEM_TYPES[item.type];
    const spec = def?.properties?.[key];
    const editor = spec && controlFor(spec);
    const owner = item;
    const owned = new Set(item ? [item.id] : []);
    place ||= [...current, ...prior].find(({ node }) => [...(node.path || []), ...(node.screens || []), node.appItem].some((id) => owned.has(id)));
    const appId = place?.app || (owner && isStandalone(ITEM_TYPES[owner.type]) ? owner.type : "");
    const app = appDef(appId);
    const sameControl = control && item?.id === control.itemId && (!key || key === control.propertyKey);
    return {
      windowId: place?.node.id || "",
      windowName: place ? place.node.tag || place.node.name || (def ? t(def.label) : place.node.id) : "",
      appId, appName: app?.name || "",
      itemId: item?.id || "", itemType: item?.type || "", itemName: def ? t(def.label) : item?.type || "",
      propertyKey: key, propertyName: sameControl && control.propertyName || (spec ? t(spec.label || key) : key),
      controlType: sameControl ? control.controlType : spec?.control || (editor && Object.keys(CONTROLS).find((name) => CONTROLS[name] === editor)) || "",
      controlName: sameControl ? control.controlName : editor?.label ? t(editor.label) : "",
    };
  };
  for (const item of changes) {
    const old = before.items.find((one) => one.id === item.id);
    const newer = next.items.find((one) => one.id === item.id);
    const keys = old && newer ? [...new Set([...Object.keys(old.props), ...Object.keys(newer.props)])]
      .filter((key) => JSON.stringify(old.props[key]) !== JSON.stringify(newer.props[key])) : [];
    for (const key of keys.length ? keys : [""]) targets.push(describe(item, key));
  }
  if (!targets.length) {
    for (const place of [...current, ...prior]) {
      const other = (current.includes(place) ? prior : current).find((one) => one.node.id === place.node.id);
      if (JSON.stringify(place.node) === JSON.stringify(other?.node)) continue;
      const id = place.node.path?.at(-1) || place.node.appItem;
      const item = [...next.items, ...before.items].find((one) => one.id === id);
      targets.push(describe(item, "", place));
    }
    // A ratio change can leave the leaves identical; record its windows.
    if (!targets.length && JSON.stringify(before.root) !== JSON.stringify(next.root)) {
      for (const place of current.filter(({ node }) => node.type === "leaf")) {
        targets.push(describe(next.items.find((one) => one.id === place.node.path?.at(-1)), "", place));
      }
    }
  }
  return targets.filter((target, index) => targets.findIndex((other) => JSON.stringify(other) === JSON.stringify(target)) === index);
}

function refreshHistorySoon() {
  if (historyRefreshPending) return;
  historyRefreshPending = true;
  queueMicrotask(() => {
    historyRefreshPending = false;
    operationsChanged({ history: true });
  });
}

function captureOperation(merge = false) {
  if (restoringOperation || operationsHooks.resizing() || !operationHistory.current) return;
  const control = operationControl;
  operationControl = null;
  if (syncHistoryExclusions()) return;
  const next = operationSnapshot();
  if (JSON.stringify(next) === operationHistory.current.json) return;
  const before = JSON.parse(operationHistory.current.json);
  // Opening/closing an excluded app alone is not an operation. Keep its
  // anchor in the current baseline so later shared seam edits are recorded.
  const priorParts = partitionHistory(before, new Set(), true);
  const nextParts = partitionHistory(next, new Set(), true);
  if (JSON.stringify([...priorParts.anchorIds].sort()) !== JSON.stringify([...nextParts.anchorIds].sort()) &&
      JSON.stringify(priorParts.snapshot) === JSON.stringify(nextParts.snapshot)) {
    operationHistory.current.json = JSON.stringify(next);
    return;
  }
  const changed = next.items.filter((one) => {
    const old = before.items.find((other) => other.id === one.id);
    return old && JSON.stringify(old) !== JSON.stringify(one);
  });
  const added = next.items.filter((one) => !before.items.some((old) => old.id === one.id));
  const removed = before.items.filter((one) => !next.items.some((other) => other.id === one.id));
  let change = { kind: "layout" };
  if (added.length) change = { kind: "add", type: added[0].type };
  else if (removed.length) change = { kind: "remove", type: removed[0].type };
  else if (changed.length) {
    const one = changed[0];
    const old = before.items.find((other) => other.id === one.id);
    const keys = [...new Set([...Object.keys(old.props), ...Object.keys(one.props)])]
      .filter((key) => JSON.stringify(old.props[key]) !== JSON.stringify(one.props[key]));
    change = { kind: "edit", type: one.type, key: keys.join(", ") };
    if (changed.length === 1 && keys.length === 1 && JSON.stringify(before.root) === JSON.stringify(next.root)) {
      change.mergeKey = `${one.id}:${keys[0]}`;
    }
  }
  change.targets = operationTargets(before, next, [...added, ...removed, ...changed], control);
  if (operationHistory.record(next, change, merge || operationsHooks.deferring())) refreshHistorySoon();
}

function historyState() {
  return { entries: operationHistory.list(), canUndo: operationHistory.canUndo, canRedo: operationHistory.canRedo };
}

function restoreOperation(index) {
  // Flush an edit whose redraw was deferred before choosing the destination.
  captureOperation();
  const target = operationHistory.entries.findIndex((entry) => entry.id === index);
  if (target < 0 || target === operationHistory.position) return false;
  announceRestore("before");
  const previous = operationHistory.position;
  const reservedItems = reservedItemIds();
  const reservedWindows = reservedWindowIds();
  const data = applyHistorySnapshot(operationHistory.move(target), serialize(), historyExclusions());
  restoringOperation = true;
  try {
    announceRestore("swap");
    adopt(data);
    claimItemIds(reservedItems);
    claimWindowIds(reservedWindows);
    // An undone id must not be handed to a different item in this session.
    for (const entry of operationHistory.entries) {
      const saved = JSON.parse(entry.json);
      claimItemIds(saved.items.map((item) => item.id));
      claimWindowIds(nodeIds(saved.root));
      for (const bay of saved.bays || []) for (const sash of bay.sashes) claimWindowIds(nodeIds(sash.content));
    }
    commit({ keep: false });
    // A live excluded window may have opened/closed since this entry was
    // captured. Its accommodation must not become a new edit and erase redo.
    operationHistory.current.json = JSON.stringify(operationSnapshot());
  } catch (error) {
    operationHistory.position = previous;
    throw error;
  } finally {
    restoringOperation = false;
    refreshHistorySoon();
  }
  return true;
}

function undoOperation() {
  captureOperation();
  const entry = operationHistory.entries[operationHistory.position - 1];
  return entry ? restoreOperation(entry.id) : false;
}

function redoOperation() {
  captureOperation();
  const entry = operationHistory.entries[operationHistory.position + 1];
  return entry ? restoreOperation(entry.id) : false;
}

// ---- layout files ------------------------------------------------------
// Reading one is here (the layout and the file's name are operations'); the
// browser's file picker and download are the pickers module's.

// The file a layout came from or went to: remembered, for the next save.
function rememberFile(name) {
  currentFile = name;
}

// Whether the page has stopped (nothing is saved then).
function operationsHalted() {
  return operationsHooks.halted();
}

async function loadLayoutText(text, name) {
  try {
    adopt(JSON.parse(text));
    currentFile = name;
    commit();
  } catch (error) {
    toast(t("mu.status.loadFailed", { error: error.message || error }));
  }
}


export { operationsHooks, registerOperationsHook, operationsReady, startOperations, noteControl, currentFileName, forgetFile, scheduleSave, historyExclusions, operationSnapshot, syncHistoryExclusions, operationTargets, refreshHistorySoon, captureOperation, historyState, restoreOperation, undoOperation, redoOperation, loadLayoutText, rememberFile, operationsHalted };
