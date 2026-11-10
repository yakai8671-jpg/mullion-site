/* boot: what joins the modules and starts the page (core-modules-proposal,
 * stage 4): the hooks one module fills for another, what an action needs of
 * the screen (items.actionHost), the page's own add button and file input,
 * and the first load (init). */
import { APPS, ICON_PICKER_TYPE, ITEM_TYPES, PICKER_ITEM_TYPE, ROOT_ID, actionWindow, adopt, allItems, appDef, appItemOf, appOfWindow, appSettingValue, cancelLaunchKeep, cardSizes, clearBays, clearLinks, coerceHotkeys, collapseOneWindowFrames, commit, controlStates, currentFileName, currentItemId, derivesFrom, eachGroup, eachLeaf, findLeaf, foldedLists, forgetFile, forgetIds, freshRoot, getItem, grants, groupOf, hiddenToolsOf, isStandalone, itemApi, launchNode, layoutRoot, linkSlotsOf, linkedIds, loadLayoutText, mountedItems, noteControl, notify, openingCards, operationsReady, pinOf, portInfo, portLink, portShare, registerAppsHook, registerHolder, registerLayoutHook, registerOperationsHook, registerViewHook, render, reseedFrames, retireItem, saved, scheduleLaunchKeep, scheduleSave, screensOf, serviceBlocker, setItems, setLayoutRoot, setRunText, stageEl, startFrames, startOperations, wireFrames, wireMount, writable, setLayoutReset, catchUp, installBuiltins, registerPickersHook, document, window, settings, applyTranslations, applyTheme } from "./deps.js";

// What boot hears of others: their events, through the bridge (setup).
let on = () => () => {};
export function connectEvents(listen) {
  on = listen;
}

function onLayout(event, fn) {
  return on("layout", event, fn);
}

function onView(fn) {
  return on("view", "change", fn);
}

function onBays(fn) {
  return on("bays", "change", fn);
}

function onPorts(fn) {
  return on("ports", "change", fn);
}

// What an action needs of the screen: the window showing its item, and how
// things are asked, reported and written there (shell/items/actions.js).
// Filled in install; boot fills the slot items.actionHost with it.
export const actionHost = {};

// The joins, once every module is handed in (index.js). The page's own
// listeners only on a page: the modules are also started by the Node tests.
export function install() {
  // Listening to the layout's events (the layout module's, through the bridge).

  // view's, which core.js exported itself before view was a module.

  registerHolder((hold) => {
    eachLeaf(layoutRoot(), (leaf) => leaf.path.forEach(hold));
    eachGroup(layoutRoot(), (group) => screensOf(group).forEach(hold));
    eachGroup(layoutRoot(), (group) => {
      if (group.appItem && getItem(group.appItem)) hold(group.appItem);
    });
  });

  registerLayoutHook("launch", (type, props) => launchNode(type, props));

  on("items", "remove", ({ ids }) => ids.forEach((id) => grants.delete(id)));

  registerLayoutHook("dropFromPath", (item) =>
    (item.type === PICKER_ITEM_TYPE && !grants.has(item.id) && !item.props.type) ||
    (item.type === ICON_PICKER_TYPE && !grants.has(item.id)));

  Object.assign(actionHost, {
    askerOf: (item) => mountedItems.get(actionWindow(item)),
    windowOf: (item) => actionWindow(item),
    serviceBlocker: (service, item) => serviceBlocker(service, item),
    itemApi: (item) => itemApi(item),
    report: (item, message) => {
      const id = actionWindow(item);
      if (id) notify(id, message);
    },
    progress: (item, service, message) => setRunText(item.id, service, message),
    writable: (desc) => {
      const property = desc.property;
      if (!property || desc.readonly || (property.params.read && !property.params.write)) return false;
      const address = property.item && { item: property.item.id, key: property.key };
      const following = address && (portLink(address) || portShare(address));
      return !following || Boolean(following.share && portInfo(address)?.writable);
    },
  });
  // An action that changed something: redraw.

  registerLayoutHook("nodeFields", (saved, node) => {
    const hidden = hiddenToolsOf(saved);
    if (hidden.length) node.hiddenTools = hidden;
    const pinned = pinOf(saved);
    if (pinned) node.pinned = pinned;
  });

  registerLayoutHook("oldFiles", () => {
    // An app's frame saved before frames said which instance they were: the
    // instance is the first window inside it showing that type -- which is
    // what launched it, since a launch puts the app's own dashboard in it.
    eachGroup(layoutRoot(), (group) => {
      if (group.appItem || !group.defaultItem || group.id === ROOT_ID) return;
      let found = null;
      eachLeaf(group, (leaf) => {
        if (found) return;
        const hit = leaf.path.map(getItem).find((one) => one && one.type === group.defaultItem);
        if (hit) found = hit.id;
      });
      if (found) group.appItem = found;
    });
    // An app's frame from before frames named their app: its main item's
    // built-in app.
    eachGroup(layoutRoot(), (group) => {
      if (group.app || !appItemOf(group)) return;
      const main = getItem(group.appItem);
      if (main && appDef(main.type)) group.app = main.type;
    });
    // An app's frame that holds nothing but the app's own window, of an app
    // that is one window -- how it was saved when it opened as a group of
    // one -- is that window.
    if (layoutRoot()) layoutRoot().children = layoutRoot().children.map((child) => collapseOneWindowFrames(child));
    // And a one-window app's window from then: outside every app's frame,
    // showing a built-in app's type -- that app.
    eachLeaf(layoutRoot(), (leaf) => {
      if (leaf.app || appOfWindow(leaf.id)) return;
      for (let up = groupOf(leaf.id); up; up = groupOf(up.id)) if (appItemOf(up)) return;
      const main = getItem(leaf.path[0]);
      const def = main && ITEM_TYPES[main.type];
      if (isStandalone(def) && !def.partOf && appDef(main.type)) leaf.app = main.type;
    });
  });
  // apps: a one-window app that is put in a group becomes the group's app: the
  // frame is the app's now (the reverse of collapseOneWindowFrames), so what is
  // put beside it is in the app -- connected to it, and kept with its layout.
  registerLayoutHook("frameAround", (group, target) => {
    const framed = target.type === "leaf" && typeof target.app === "string" ? appDef(target.app) : null;
    const main = framed && getItem(target.path[0]);
    if (framed && main && main.type === framed.type) {
      group.app = target.app;
      group.appItem = main.id;
      group.defaultItem = (APPS[main.type] && APPS[main.type].defaultItem) || main.type;
      delete target.app;
    }
  });

  onLayout("restore", ({ phase }) => phase === "before" && cancelLaunchKeep());
  // apps: an app link to an app that is gone follows nothing.
  onLayout("pruned", () => {
    for (const item of allItems()) {
      for (const [key, spec] of linkSlotsOf(item)) {
        if (derivesFrom(spec.type, "list")) {
          const held = linkedIds(item, key, spec);
          const alive = held.filter((id) => getItem(id));
          if (alive.length !== held.length) item.props[key] = alive;
        } else if (item.props[key] && !getItem(item.props[key])) item.props[key] = null;
      }
    }
  });

  // apps: an app whose windows moved keeps its new launch layout.
  onLayout("change", () => scheduleLaunchKeep());

  // apps: a link is part of how an app is set out, kept with its layout.
  onPorts((change) => change.links && scheduleLaunchKeep());

  // apps: the motion setting is the shell's app setting `motionMs`.
  registerViewHook("motionMs", () => appSettingValue("motionMs"));

  onLayout("loaded", () => reseedFrames());

  // operations: design problems are reported, and launch layouts kept, once a layout has been read.
  registerViewHook("ready", () => operationsReady());
  registerAppsHook("ready", () => operationsReady());

  // operations asks what the screen is doing: a halted page saves nothing, a
  // seam being dragged or a typed write under way is not an operation of its own.

  // operations: every change of the layout is recorded and saved.
  onLayout("change", () => scheduleSave());

  // operations: a folded card is saved with the layout.
  onView((change) => change.save && scheduleSave());

  // operations: a changed bay is saved with the layout.
  onBays((change) => change.touched && scheduleSave());

  registerAppsHook("coerceHotkeys", (value) => coerceHotkeys(value));

  // pickers asks: what an app shows (mount), a window's element and showing an
  // item in it (frames), whether a window has a preset button (mount).

  // hotkeys asks frames for an app's frames, the one being worked in first;
  // mount draws the Hotkeys app again when a row with no target changed.

  // mount's, which core.js exported itself before mount was a module.

  // permissions: layout:write `reset` throws the layout away (resetLayout below).
  setLayoutReset(() => resetLayout());

  // mount: its listeners and what it puts into other modules.

  // frames', which core.js exported itself before frames was a module.

  const page = typeof document !== "undefined" && typeof document.createElement === "function";
  if (!page) return;
  // The built-in items (shell/builtins), registered before the plugins load.
  installBuiltins();
  // library: read again when the tab is looked at again (another tab may have saved meanwhile).
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") catchUp();
  });
  window.addEventListener("focus", catchUp);
  const addBtn = document.getElementById("add-btn");
  const fileInput = document.getElementById("file-input");
  document.addEventListener("click", (event) => {
    const button = event.target.closest?.("button");
    const frame = button?.closest(".mu-window");
    if (!frame || !stageEl().contains(frame)) return;
    const node = findLeaf(frame.dataset.id);
    if (!node) return;
    const itemId = currentItemId(node);
    noteControl({
      windowId: frame.dataset.id, itemId, propertyKey: "", propertyName: "",
      controlName: button.title || button.textContent.trim(), controlType: "button",
    });
  }, true);

  // operations: with no file picker, a file is opened through the page's file input.
  registerPickersHook("pickFile", () => {
    fileInput.value = "";
    fileInput.click();
  });

  fileInput.addEventListener("change", async () => {
    const [file] = fileInput.files;
    if (file) await loadLayoutText(await file.text(), file.name);
  });

  // ---- the empty state --------------------------------------------------
  // The empty state's only button. Every other way to change the layout is
  // an item, but with no windows there is nothing to hold one.
  addBtn.addEventListener("click", () => {
    if (layoutRoot()) return; // splitting is the only way to grow a live layout
    setLayoutRoot(freshRoot());
    commit();
  });

  // mount and frames: their listeners and what they put into other modules.
  wireMount();
  wireFrames();
}

// ---- boot -------------------------------------------------------------
// The file the layout was last saved to or opened from, if any.
export function layoutFileName() {
  return currentFileName();
}

// Throw the layout away and start from one window. Reachable through
// layout:write; the shell no longer has a button of its own for it.
export function resetLayout() {
  freshLayout();
  forgetFile();
  commit();
}

function freshLayout() {
  for (const item of allItems()) retireItem(item);
  setLayoutRoot(null);
  setItems([]);
  forgetIds();
  clearLinks();
  clearBays();
  foldedLists.clear();
  cardSizes.clear();
  controlStates.clear();
  openingCards.clear();
  setLayoutRoot(freshRoot());
}

export async function init() {
  // theme-boot.js read the profile before the first paint, and every change
  // since has come through this page's own cache (an update here, or another
  // tab's over the channel), so it is read again only when that first read
  // failed. Asking again here put the first render behind every other request
  // the page had just sent, and a page start sends dozens.
  if (!Object.keys(settings.cache).length) {
    try {
      await settings.refresh();
    } catch {
      /* server unreachable -- fall through to a fresh layout */
    }
  }

  startFrames();
  applyTheme();
  applyTranslations(document);

  const saved = settings.get("mullion.layout", "");
  if (saved) {
    try {
      adopt(JSON.parse(saved));
    } catch {
      freshLayout();
    }
  } else {
    freshLayout();
  }
  render();
  startOperations();
}
