/* Mullion -- the built-in permission namespaces.
 *
 * Each entry is a factory: given the context of the item asking (its window
 * and its own id), it returns the methods that namespace grants. A plugin
 * can add namespaces of its own with registerPermission().
 */

import { deleteValue, libraryLoaded, saveValue, savedOfType, savedTypes, savedValue, currentFileName, fetchJSON, locate, qs, settings } from "./deps.js";
import { grants } from "./deps.js";
import { allItems, getItem as itemById, layoutRoot } from "./deps.js";
import { APPS, CONTROLS, ITEM_TYPES, VALUE_TYPES, bindProperty, bindSpec, formatValue, presetTypes, registerPermission, registerBaseApi, paramNames } from "./deps.js";
import { APP_SETTINGS, DEFAULT_ITEM_TYPE, DIRECTIONS, appSettingValue, commit, setBaySlide, linksInto, linksOf, isLinkedInto, pickProperty, sharedInfo, pickShare, unlinkPort, appSurface, runAction, cancelAction, pressApp, setAppInput, readAppOutput, portKind, refreshAll, countLeaves, countGroups, createGroupNode, defaultItemFor, groupOf, launchNode, fitLaunched, setGroupDefault, contentNode, checkContent, groupWindows, enterPlaceMode, exitPlaceMode, layoutText, loadLayoutText, openLayoutFile, saveLayoutFile, createItem, createWindowNode, currentItemId, findLeaf, focusWindow, getItem, itemProperties, moveWindow, openInWindow, openScreen, closeScreen, revealItem, defaultLeafBeside, launchLayoutOf, chosenLaunchLayout, setChosenLaunchLayout, captureLaunchLayout, propertyUsers, removeWindow, setAppSetting, splitWindow, newWindowId, t, usedBy, windowFacts, windowProperties, bayList, addBay, renameBay, removeBay, addSash, renameSash, removeSash, activateSash, nextSash, prevSash, placeBay, unplaceBay, unregisterFromSash, orderSashes, appList, runningApps, appDef, coerceApp, setApp, resetApp, addApp, duplicateApp, removeApp, placeApp, placeAlone, captureApp, appLayoutTree, appOfWindow, pickWindow, HOTKEY_KEYS, HOTKEY_ACTIONS, hotkeyList, addHotkey, setHotkey, removeHotkey, pickHotkeyTarget, exitHotkeyPick, historyState, undoOperation, redoOperation, restoreOperation } from "./deps.js";
import { loadedPlugins } from "./deps.js";

// ---- the item API and its permissions --------------------------------
// A permission is "<namespace>:<verb>". A type is handed only the
// namespaces it asked for, so an item that never declared window:write
// simply has no method to edit the layout with.
// What an item reaches by itself, with no permission: itself and the items
// connected to it. The user made the connection, or the app's layout did -- that
// is the grant. There is no owner above an item and no part below it: what two
// items share is a property one holds and the other is a window onto (a share).
// `items:read` and `items:write` widen this to every item (and what they reach
// beyond the scope is recorded, see familyUses).
export const familyUses = new Map();
function recordUse(kind, holderId, targetId, how) {
  const holder = getItem(holderId);
  const target = getItem(targetId);
  if (!holder || !target) return;
  const key = `${kind} ${holder.type} -> ${target.type} (${how})`;
  familyUses.set(key, (familyUses.get(key) || 0) + 1);
}
function inScope(holderId, targetId, how) {
  if (!holderId || !targetId) return false;
  return holderId === targetId || linksInto(holderId, targetId);
}

function itemEntry(ctx, item) {
  return {
    id: item.id,
    type: item.type,
    label: ITEM_TYPES[item.type] ? t(ITEM_TYPES[item.type].label) : item.type,
    windows: usedBy(item.id),
    // Values come back as read-only descriptors, so a viewer renders them with
    // the same code that draws the real editors.
    // `kind`: what the property is carried as (a port's kind), or null.
    properties: itemProperties(item, null).map((desc) => ({ ...desc, readonly: true, kind: portKind(desc.params) })),
  };
}

// Writing a property of another item through the accessor, so the coercion and
// any write hook run exactly as they would for the item's own code.
function writeProperty(holderId, itemId, key, value) {
  const target = getItem(itemId);
  if (!target) throw new Error("unknown item: " + itemId);
  const spec = (ITEM_TYPES[target.type].properties || {})[key];
  if (!spec) throw new Error(target.type + " has no property " + key);
  bindProperty(target, key, null).set(value);
  refreshAll();
  return true;
}

const BUILT_IN = {};

// The backend services each permission's functions reach (server.hasService
// answers for them; docs/backend-contract.md). Every permission is listed,
// those that need nothing too, so a new one cannot be left out by mistake.
// What the page answers itself (settings, store, blob, plugins) is no service.
const NEEDS = {
  "window:read": [], "window:write": [], "items:read": [], "items:write": [],
  "history:read": [], "history:write": [], "layout:read": [], "layout:write": [], "layout:place": [],
  "grant:write": [], "props:read": [], "app:read": [], "app:write": [],
  "store:read": [], "store:write": [], "hotkeys:read": [], "hotkeys:write": [],
  "apps:read": [], "apps:write": [], "bays:read": [], "bays:write": [],
  "plugins:read": [], "plugins:write": [],
  "fs:read": ["fs"], "fs:write": ["fs"],
  "shell:exec": ["shell"],
  "comfy:run": ["comfy"],
  "ollama:run": ["ollama"],
  "speech:run": ["speech"],
  "services:read": ["services"], "services:write": ["services"],
  "reddit:read": ["reddit"],
  "app:control": ["control"],
};

function actionTarget(ctx, itemId, name) {
  const item = getItem(itemId);
  const actions = item && ITEM_TYPES[item.type]?.actions;
  let allowed = inScope(ctx.itemId, itemId, "set");
  if (ctx.itemId && !allowed) {
    const seen = new Set();
    for (let owner = item?.parent; owner && !seen.has(owner); owner = getItem(owner)?.parent) {
      if (owner === ctx.itemId) { allowed = true; break; }
      seen.add(owner);
    }
  }
  if (!item || !allowed ||
      !actions || !Object.hasOwn(actions, name) || actions[name].connected !== true) {
    throw new Error(`action "${name}" is not available on this connected item`);
  }
  return item;
}

// What every item has (see grantApi): what its connections give it.
const BASE = {};

// Throwing the layout away and starting from one window (layout:write `reset`)
// is boot's: it touches every module that keeps something of a layout.
let resetLayout = () => {};
export function setLayoutReset(fn) {
  resetLayout = fn;
}

// What this file registers, once the modules it uses are handed in (index.js).
export function install() {
  Object.assign(BUILT_IN, {
    "window:read": (ctx) => ({
      get: () => windowFacts(ctx.windowId),
      properties: () => windowProperties(ctx.windowId),
    }),
    "window:write": (ctx) => ({
      // Editing the layout from inside an item: the same operations the
      // frame's own buttons use, scoped to the window hosting the item.
      //
      // A type left out is what the frame around this window asks for; a
      // type that opens as a group (see launchNode) opens as one here too.
      split: (direction, itemType) => {
        if (!DIRECTIONS[direction]) throw new Error(`unknown direction: ${direction}`);
        // Nothing asked for is what the frame asks for -- and inside an app's
        // frame that is the app itself, not a second one.
        if (itemType === undefined) {
          if (!splitWindow(ctx.windowId, direction, defaultLeafBeside(ctx.windowId))) return null;
          commit();
          return true;
        }
        if (!ITEM_TYPES[itemType]) throw new Error(`unknown item type: ${itemType}`);
        const node = fitLaunched(launchNode(itemType), defaultItemFor(ctx.windowId));
        if (!splitWindow(ctx.windowId, direction, node)) return null;
        commit();
        return true;
      },
      // A screen of the plugin's own, opened in this window along its path --
      // one step further, back where it was by the way back (a state's detail).
      // `options.share`: {<a property of the screen>: <a property of this item>}
      // -- the screen is a window onto that property of the item, and what it
      // edits is the item's own. Only the item's own properties can be given.
      openScreen: (type, props = {}, options = {}) => {
        if (!ITEM_TYPES[type]) throw new Error(`unknown item type: ${type}`);
        const shares = Object.entries(options.share || {}).map(([key, mine]) => [key, { item: ctx.itemId, key: mine }]);
        return openScreen(ctx.windowId, type, { props, shares });
      },
      // Same, but the new window shows an item that already exists -- how a
      // child gets its own window without being duplicated.
      splitWith: (direction, itemId) => {
        if (!DIRECTIONS[direction]) throw new Error(`unknown direction: ${direction}`);
        if (!getItem(itemId)) throw new Error(`unknown item: ${itemId}`);
        const leaf = { type: "leaf", id: newWindowId(), path: [itemId] };
        if (!splitWindow(ctx.windowId, direction, leaf)) return null;
        commit();
        return true;
      },
      // A frame around this window, with what is asked for inside it beside
      // this one. Unlike split() the room comes from this window's own slot:
      // a group divides what it was already given, so nothing outside the new
      // frame moves. `items` is a content spec -- a type, a list of them, or
      // an arrangement (see splitGroup).
      group: (items = defaultItemFor(ctx.windowId), direction = "right") => {
        if (!DIRECTIONS[direction]) throw new Error(`unknown direction: ${direction}`);
        checkContent(items);
        if (!groupWindows(ctx.windowId, contentNode(items), direction)) return null;
        commit();
        return true;
      },
      // Same, for an item that already exists -- splitWith's counterpart.
      groupWith: (itemId, direction = "right") => {
        if (!DIRECTIONS[direction]) throw new Error(`unknown direction: ${direction}`);
        if (!getItem(itemId)) throw new Error(`unknown item: ${itemId}`);
        const leaf = { type: "leaf", id: newWindowId(), path: [itemId] };
        if (!groupWindows(ctx.windowId, leaf, direction)) return null;
        commit();
        return true;
      },
      // A whole group beside this window in one call: where it goes, and how
      // it is arranged inside. This is how something launched from elsewhere
      // -- a dashboard, a workflow -- arrives already laid out rather than
      // being assembled a window at a time on screen.
      //
      //   splitGroup("right", ["notepad.editor", "terminal.shell"])
      //   splitGroup("right", { dir: "row", ratio: 0.4, children: [
      //     "files.browser",
      //     { dir: "col", children: ["notepad.editor", "clock.face"] },
      //   ]})
      splitGroup: (direction, items) => {
        if (!DIRECTIONS[direction]) throw new Error(`unknown direction: ${direction}`);
        checkContent(items);
        if (!splitWindow(ctx.windowId, direction, createGroupNode(items))) return null;
        commit();
        return true;
      },
      // What a new window in the frame around this one shows -- the group
      // this window is in, not one it might contain. null goes back to
      // whatever the frame outside that one says.
      setGroupDefault: (itemType) => {
        const group = groupOf(ctx.windowId);
        if (!group) return null;
        return setGroupDefault(group.id, itemType);
      },
      // Drill into an item in place: it is pushed onto this window's path.
      open: (itemId) => openInWindow(ctx.windowId, itemId),
      // Back out of it again: the screen this window showed before. False
      // when there is none -- this is where the window started.
      back: () => closeScreen(ctx.windowId),
      // The window already showing an item, brought forward. False when none
      // does, which is the caller's cue to open one.
      reveal: (itemId) => revealItem(itemId),
      focus: () => {
        focusWindow(ctx.windowId, { moveDom: true });
        return true;
      },
      close: () => {
        if (!removeWindow(ctx.windowId)) return null;
        commit();
        return true;
      },
      move: (targetWindowId, direction) => {
        if (!DIRECTIONS[direction]) throw new Error(`unknown direction: ${direction}`);
        moveWindow(ctx.windowId, targetWindowId, direction);
        return true;
      },
      setItem: (itemId) => {
        const leaf = findLeaf(ctx.windowId);
        if (!leaf || !getItem(itemId)) return null;
        leaf.path = [itemId];
        commit();
        return true;
      },
    }),

    // Reflection over the item system itself: what types exist, and what has
    // actually been instantiated. Read-only -- creating is a separate grant.
    // Every item, not only the connected ones (see `items` in BASE below):
    // a viewer of the whole layout -- the inventory, the developer tools.
    "items:read": (ctx) => {
      const entry = (item) => itemEntry(ctx, item);
      return {
      types: () =>
        Object.entries(ITEM_TYPES).map(([name, def]) => ({
          name,
          label: t(def.label),
          // Whether it can be opened on its own (an app of its own).
          standalone: def.standalone === true,
          icon: def.icon,
          source: def.source || "core",
          permissions: [...def.permissions],
          properties: Object.entries(def.properties || {}).map(([key, spec]) => ({
            key,
            label: spec.label || key,
            type: spec.type,
            itemType: spec.itemType,
          })),
          hooks: ["body", "mount", "update", "unmount", "destroy"].filter(
            (hook) => typeof def[hook] === "function"
          ),
          // Whether opening one gives a group rather than a window -- worth a
          // launcher saying so before it happens.
          opensAsGroup: Boolean(APPS[name] && APPS[name].layout),
          // The app this type is one window of, by its dashboard: a launcher
          // lists the app, and the app's dashboard lists its windows.
          partOf: def.partOf || null,
        })),
      list: () => allItems().map(entry),
      // One item's entry, made on its own: asking for one is the common case,
      // and building every item's entry to find it was what made an app's
      // redraw cost the square of the items there are.
      get(id) {
        const item = itemById(id);
        if (item && !inScope(ctx.itemId, id, "get")) recordUse("beyond", ctx.itemId, id, "get");
        return item ? entry(item) : null;
      },
      };
    },
    // The arrangement itself: what used to be the toolbar. Reading is cheap
    // and harmless; opening or resetting throws away what is on screen, so it
    // is a separate grant.
    "history:read": () => ({ state: historyState }),
    "history:write": () => ({ undo: undoOperation, redo: redoOperation, restore: restoreOperation }),
    "layout:read": () => ({
      summary: () => ({
        file: currentFileName(),
        windows: countLeaves(layoutRoot()),
        groups: countGroups(layoutRoot()),
        items: allItems().length,
        bytes: layoutText().length,
      }),
      text: () => layoutText(),
    }),
    "layout:write": () => ({
      save: () => saveLayoutFile(),
      open: () => openLayoutFile(),
      load: (text, name) => loadLayoutText(text, name),
      reset: () => resetLayout(),
    }),

    // Asking the person where a new window should go. Layout-wide -- every
    // window offers its guides -- so it is not something window:write could
    // honestly grant, being scoped to the item's own window.
    //
    // What is placed may be a whole arrangement rather than one type, and
    // then it is one group holding it: the question the guides ask is
    // unchanged, and the middle one answers it with "inside that window's
    // frame" either way.
    "layout:place": (ctx) => ({
      start: (items) => enterPlaceMode(items),
      // An app (by id), placed: opened where a guide is clicked.
      startApp: (appId) => placeApp(appId),
      // An item type as a window of its own: an app that has not been kept.
      startAlone: (type) => placeAlone(type),
      cancel: () => exitPlaceMode(),
      // Where something already is: the window showing it, brought forward.
      reveal: (itemId) => revealItem(itemId),
      // Where an app's windows go when it is opened. Only for the asker's own
      // app -- its own type -- since what is set is how every future instance of
      // that type arrives.
      launch: (() => {
        const mine = (type) => {
          const at = getItem(ctx.itemId);
          if (at && at.type === type) return true;
          throw new Error(`${type} is not this item's app`);
        };
        const ownerOf = (itemId) => {
          if (itemId === ctx.itemId) return true;
          throw new Error(`${itemId} is not this item`);
        };
        return {
          // What it opens as: the chosen layout if there is one, the type's
          // own otherwise -- and which of the two that is.
          get: (type) => {
            mine(type);
            const def = ITEM_TYPES[type];
            return {
              layout: launchLayoutOf(type),
              chosen: Boolean(chosenLaunchLayout(type)),
              defaultLayout: (APPS[type] && APPS[type].layout) || null,
            };
          },
          set: (type, spec) => {
            mine(type);
            return setChosenLaunchLayout(type, spec);
          },
          reset: (type) => {
            mine(type);
            return setChosenLaunchLayout(type, null);
          },
          // The arrangement the app's frame has now, or null when it has none.
          capture: (appItemId) => {
            ownerOf(appItemId);
            return captureLaunchLayout(appItemId);
          },
        };
      })(),
    }),

    // Writing through a grant: one property address the shell handed to this
    // item, because an item that could already write it asked the shell to.
    // Named for what it touches, like every other namespace -- the chooser is
    // the only thing holding a grant today, but a grant is not a picker's.
    //
    // The asker never says which property. It can only ask about the grant
    // made to itself, looked up by the id the shell gave this API, so there
    // is nothing to forge and nothing else to reach. Narrower than family
    // authority, not wider: a child with items:write may set any property of
    // its parent, while this reaches one address.
    "grant:write": (ctx) => {
      const resolve = () => {
        const grant = grants.get(ctx.itemId);
        // A subtree grant is an inspector's, and is not an address to write.
        if (!grant || grant.kind === "subtree") return null;
        const item = getItem(grant.itemId);
        if (!item) return null;
        return { grant, property: bindSpec(grant.spec, { item, key: grant.key, api: grant.api }) };
      };
      return {
        // What the grant is for, as data. The spec comes back without its
        // read and write hooks: what it is shaped like is the holder's
        // business, and writing goes through set().
        target: () => {
          const found = resolve();
          if (!found) return null;
          const { read, write, presetValue, presetName, ...shape } = found.grant.spec;
          const value = found.property.get();
          return {
            itemId: found.grant.itemId,
            key: found.grant.key,
            label: found.grant.label,
            type: found.grant.type,
            spec: shape,
            value,
            // What a preset made from here would be called, when the value
            // has a name of its own to offer -- a workflow, a template.
            suggestedName: presetName ? String(presetName(value) || "") : "",
            // Whether a preset of this is something other than its value --
            // run settings are a snapshot of several windows -- and so cannot
            // be started from the type's empty default when there is none.
            derivedPreset: Boolean(presetValue),
            // Where the one who opened this asked it to start looking. A copy:
            // the holder seeds its own search from it and edits that.
            query: {
              groups: [...found.grant.query.groups],
              text: found.grant.query.text,
            },
          };
        },
        // What a new preset made from this address would hold: the value as
        // it is now, unless the spec says a preset of it is something else --
        // run settings are a snapshot of several windows, not the empty value
        // their loader reads as. null means there is nothing worth keeping.
        // Taken when asked rather than handed out with target(), because it
        // can be large and is only wanted at the moment of saving. A copy,
        // for the same reason set() takes one.
        capture: () => {
          const found = resolve();
          if (!found) return null;
          const value = found.property.get();
          const kept = found.grant.spec.presetValue ? found.grant.spec.presetValue(value) : value;
          if (kept === null || kept === undefined) return null;
          return typeof kept !== "object" ? kept : JSON.parse(JSON.stringify(kept));
        },
        // A copy, through the property's own accessor, so its coercion and
        // any write hook run as they would for the item's own code. The copy
        // is taken here, at the boundary, because "the library hands out
        // copies" is only true if it is true where the value crosses over --
        // some types hand the same object back when they coerce it.
        // `set`, the same word the property accessor and items:write use for
        // the same act.
        set: (value) => {
          const found = resolve();
          if (!found) return false;
          const copy =
            value === null || typeof value !== "object" ? value : JSON.parse(JSON.stringify(value));
          found.property.set(copy);
          refreshAll();
          return true;
        },
      };
    },

    // ---- capabilities ---------------------------------------------------
    // These wrap endpoints the server already had. The point of routing them
    // through permissions is not new power -- it is that a type's declaration
    // now says what it can reach, and the manifest of the plugin providing it
    // has to agree (see plugins.js).
    //
    // Paths are whatever the server accepts; containment and size limits stay
    // where they were, in backend/security.py and config.MAX_FILE_SIZE. An
    // error from the server arrives as a thrown Error with its message.
    "fs:read": () => ({
      list: (path = "") => fetchJSON(`/api/fs/list?${qs({ path })}`),
      read: (path) => fetchJSON(`/api/fs/read?${qs({ path })}`),
      // For handing a file to an <img>/<a>, rather than reading it as text.
      downloadUrl: (path) => `/api/fs/download?${qs({ path })}`,
    }),
    "fs:write": () => ({
      write: (path, content) =>
        fetchJSON("/api/fs/write", { method: "POST", body: { path, content } }),
      mkdir: (parent, name) =>
        fetchJSON("/api/fs/mkdir", { method: "POST", body: { path: parent, name } }),
      remove: (path) => fetchJSON("/api/fs/delete", { method: "POST", body: { path } }),
      rename: (path, newName) =>
        fetchJSON("/api/fs/rename", { method: "POST", body: { path, new_name: newName } }),
    }),

    // One shell command per call, with the working directory passed in and
    // handed back: a shell item keeps its cwd in its own properties, which is
    // what lets several of them live in one tab and survive a reload.
    "shell:exec": () => ({
      run: (command, { cwd } = {}) =>
        fetchJSON("/api/shell/exec", { method: "POST", body: { command, cwd } }),
      program: () => settings.get("shell.program", "cmd"),
    }),

    // The ComfyUI and Ollama servers named in the profile, through the relay
    // in backend/handlers/ai_api.py. The item never says where they are --
    // that is the profile's -- only what to send.
    "comfy:run": () => ({
      // A ComfyUI that is not running answers (running: false), and is thrown
      // here as what it is, so every caller reads "down" the one way.
      status: () =>
        fetchJSON("/api/comfy/status").then((info) => {
          if (info && info.running === false) throw new Error(info.error || "ComfyUI is not running");
          return info;
        }),
      queue: (graph, { clientId } = {}) =>
        fetchJSON("/api/comfy/prompt", { method: "POST", body: { graph, client_id: clientId } }),
      history: (promptId) => fetchJSON(`/api/comfy/history?${qs({ prompt_id: promptId })}`),
      queueState: () => fetchJSON("/api/comfy/queue"),
      // Which nodes this ComfyUI has, by class_type: what a graph asks for
      // is either among them or the run is going to fail.
      nodes: () => fetchJSON("/api/comfy/nodes"),
      // What a node input can be set to, from the node's definition.
      options: (classType, inputKey) =>
        fetchJSON(`/api/comfy/options?${qs({ class_type: classType, input_key: inputKey })}`),
      interrupt: () => fetchJSON("/api/comfy/interrupt", { method: "POST", body: {} }),
      // A picture as a data URL in; the name a LoadImage node takes out. A
      // file of a dataset folder (a picture, or its caption as text/plain) says
      // where it goes -- `subfolder` "mullion_lora/<name>", `filename` without
      // its extension -- and is put there over what was there.
      upload: (dataUrl, { subfolder = "", filename = "" } = {}) =>
        fetchJSON("/api/comfy/upload", { method: "POST", body: { data_url: dataUrl, subfolder, filename } }),
      // An output copied to where this keeps its own files: the address it is
      // kept at, or null when ComfyUI could not hand it over (not running, the
      // file gone). What a run made is kept so that showing it later needs
      // nothing from ComfyUI.
      keep: ({ filename, subfolder = "", type = "output" }) =>
        fetchJSON("/api/comfy/keep", { method: "POST", body: { filename, subfolder, type } }).then((answer) => (answer && answer.src) || null),
      // For an <img>: an output image, by the reference ComfyUI's history gave.
      viewUrl: ({ filename, subfolder = "", type = "output" }) =>
        `/api/comfy/view?${qs({ filename, subfolder, type })}`,
    }),
    "ollama:run": () => ({
      status: () => fetchJSON("/api/ollama/status"),
      generate: (request) => fetchJSON("/api/ollama/generate", { method: "POST", body: request }),
    }),
    // The voice engines named in the profile (backend/handlers/speech_api.py).
    // What a synthesis returns is the address the audio is kept at, not the
    // audio itself.
    "speech:run": () => ({
      voicevox: {
        status: () => fetchJSON("/api/voicevox/status"),
        speakers: () => fetchJSON("/api/voicevox/speakers"),
        // `signal` lets a caller stop waiting; the engine finishes regardless.
        synthesize: (request, { signal } = {}) =>
          fetchJSON("/api/voicevox/synthesize", { method: "POST", body: request, signal }),
      },
      irodori: {
        status: () => fetchJSON("/api/irodori/status"),
        synthesize: (request, { signal } = {}) =>
          fetchJSON("/api/irodori/synthesize", { method: "POST", body: request, signal }),
      },
    }),
    // The programs Mullion works with (backend/services.py): whether each is
    // answering, and, with the second grant, starting and stopping them and
    // saying how they are started. Apart because it runs programs.
    "services:read": (ctx) => ({
      // The detail of one program, opened as a screen in the window asking: one
      // step further along its path, back where it was by the way back. `host`
      // is the item the details are about (see plugins/services).
      openDetail: (service, host) => {
        if (!ITEM_TYPES["services.detail"]) throw new Error("the services plugin is not loaded");
        return openScreen(ctx.windowId, "services.detail", { props: { service: String(service), host: String(host || "") } });
      },
      status: () => fetchJSON("/api/services/status", { cache: "no-store" }).then((body) => body.services),
      log: (id) => fetchJSON(`/api/services/log?${qs({ id })}`, { cache: "no-store" }).then((body) => body.log),
    }),
    "services:write": () => ({
      start: (id) => fetchJSON("/api/services/start", { method: "POST", body: { id } }).then((body) => body.service),
      stop: (id) => fetchJSON("/api/services/stop", { method: "POST", body: { id } }).then((body) => body.service),
      configure: (id, config) =>
        fetchJSON("/api/services/config", { method: "POST", body: { id, ...config } }).then((body) => body.service),
    }),
    // Reddit's JSON, through the relay in backend/handlers/reddit_api.py,
    // which fixes the host, allows only the board / thread / morechildren
    // paths, and attaches the session from the reddi2ch app's settings.
    "reddit:read": () => ({
      status: () => fetchJSON("/api/reddit/status"),
      get: (path, params = {}) => fetchJSON("/api/reddit/fetch", { method: "POST", body: { path, params } }),
    }),

    // What the shell loaded from outside itself, including what refused to
    // load. Read-only: installing is not something an item gets to do.
    "plugins:read": () => ({
      list: () =>
        loadedPlugins.map((entry) => ({
          id: entry.id,
          status: entry.status,
          error: entry.error || "",
          name: entry.manifest ? entry.manifest.name : entry.id,
          version: entry.manifest ? entry.manifest.version : "",
          permissions: entry.manifest ? entry.manifest.permissions : [],
          requires: entry.manifest ? entry.manifest.requires || [] : [],
          requiredBy: entry.manifest ? entry.manifest.requiredBy || [] : [],
          // Switched off by this profile, or off because a plugin it requires is.
          enabled: entry.status !== "disabled",
          offBecause: entry.manifest && entry.manifest.off ? entry.manifest.off.because || [] : [],
        })),
    }),
    // Which plugins this profile uses. The shell loads plugins once, so a change is
    // taken up when the page is read again (the caller reloads it).
    "plugins:write": () => ({
      // {id, enabled, together}. Others that have to change with it, and `together` not
      // true: it rejects with `.conflict = {needs: "dependents" | "requirements", others: [{id, name}]}`
      // and nothing changed.
      setEnabled: async (id, enabled, together = false) => {
        try {
          return await fetchJSON("/api/plugins/enabled", { method: "POST", body: { id, enabled, together } });
        } catch (error) {
          if (error.status === 409 && error.body && error.body.needs) error.conflict = error.body;
          throw error;
        }
      },
    }),

    // Reflection over the property system: what value types exist, what
    // parameters each accepts, and who is using them.
    "props:read": () => ({
      // What a value is: its parameters, what it defaults to, and the methods
      // it implements -- which is what decides the controls it can be shown in.
      types: () =>
        presetTypes().map(([name, def]) => ({
          name,
          label: def.label ? t(def.label) : name,
          // A list kept as a preset is offered to be chosen, but is not a type to be documented.
          legacy: Boolean(def.legacy || def.listOf),
          icon: def.icon,
          params: def.params || [],
          methods: Object.keys(def.methods || {}),
          defaultControl: def.defaultControl,
          storable: def.storable !== false,
          source: def.source || "core",
          sample: def.sample || {},
          sampleValue: def.defaultValue(def.sample || {}),
          // A way to read the sample that a type's own hook cannot (its default is nothing) is no
          // reason for the listing of types to fail.
          sampleText: (() => {
            try {
              return formatValue({
                type: def.listOf ? "list" : name,
                params: def.listOf ? { ...(def.sample || {}), each: def.defaults.each } : def.sample || {},
                value: def.defaultValue(def.sample || {}),
              });
            } catch (error) {
              return "";
            }
          })(),
          usedBy: propertyUsers(name),
          // Every control this value can be edited with, worked out by method
          // set rather than by name.
          controls: Object.entries(CONTROLS)
            .filter(([, control]) =>
              control.needs.every((method) => typeof (def.methods || {})[method] === "function")
            )
            .map(([controlName]) => controlName),
        })),
      // How a value is edited. A control belongs to the shell, which is what
      // keeps two plugins from inventing two different sliders.
      controls: () =>
        Object.entries(CONTROLS).map(([name, def]) => ({
          name,
          label: def.label ? t(def.label) : name,
          needs: [...def.needs],
          params: paramNames(def),
          requiresParams: [...def.requiresParams],
          widget: Boolean(def.widget),
          standalone: Boolean(def.standalone),
          sampleParams: def.sampleParams || null,
          source: def.source || "core",
          why: typeof def.why === "string" ? def.why : "",
          accepts: Object.entries(VALUE_TYPES)
            .filter(([, type]) =>
              def.needs.every((method) => typeof (type.methods || {})[method] === "function")
            )
            .map(([typeName]) => typeName),
        })),
      get(name) {
        return this.types().find((entry) => entry.name === name) || null;
      },
    }),

    // The shell-wide profile, limited to the keys declared in APP_SETTINGS.
    "app:read": () => ({
      keys: () => Object.keys(APP_SETTINGS),
      get: (key) => appSettingValue(key),
      // The whole table as descriptors, for anything that wants to show it.
      // The value here is what the profile literally holds, not what the
      // shell resolved it to: a stale name falling back is exactly what this
      // row exists to make visible.
      settings: () =>
        Object.entries(APP_SETTINGS).map(([key, spec]) => ({
          key,
          label: t(spec.label),
          type: spec.type,
          params: spec,
          value: settings.get(key, spec.default),
          readonly: true,
        })),
    }),
    "app:write": () => ({
      set: (key, value) => {
        setAppSetting(key, value);
        return true;
      },
    }),

    // The server process itself: stopping it, and starting it again (see
    // backend/handlers/control_api.py). Apart from app:write because it ends
    // the session for every tab, not just changes a setting.
    "app:control": () => ({
      quit: () => fetchJSON("/api/control/quit", { method: "POST", body: {} }),
      // The profiles (backend/profiles.py): where the data is kept, one directory each.
      // Switching is a restart: it resolves with the id of the server that was asked,
      // like `restart`, and waitBack(id) says when the other one answers.
      profiles: () => fetchJSON("/api/profiles", { cache: "no-store" }),
      // `dir`: a full path to keep it in; left out, it is made under profiles/ beside the server.
      createProfile: (name, dir = "") => fetchJSON("/api/profiles/create", { method: "POST", body: { name, dir } }),
      renameProfile: (id, name) => fetchJSON("/api/profiles/rename", { method: "POST", body: { id, name } }),
      removeProfile: (id) => fetchJSON("/api/profiles/remove", { method: "POST", body: { id } }),
      // The one a server opens when a page does not ask for another: nothing restarts.
      setDefaultProfile: (id) => fetchJSON("/api/profiles/default", { method: "POST", body: { id } }),
      // Open one: the server starts again with it asked for (the default is not changed).
      switchProfile: (id) =>
        fetchJSON("/api/profiles/activate", { method: "POST", body: { id } }).then((body) => body.boot),
      // Resolves with the id of the server that was asked; waitBack(id) then
      // resolves true once a server with another id answers, false when none
      // does within `timeout` ms.
      restart: () =>
        fetchJSON("/api/control/restart", { method: "POST", body: {} }).then((body) => body.boot),
      waitBack: async (was, { timeout = 90000, interval = 500 } = {}) => {
        const until = Date.now() + timeout;
        while (Date.now() < until) {
          await new Promise((resolve) => setTimeout(resolve, interval));
          try {
            const body = await fetchJSON("/api/control/status", { cache: "no-store" });
            if (body && body.boot && body.boot !== was) return true;
          } catch {
            // Down between the old server and the new one: keep asking.
          }
        }
        return false;
      },
    }),

    // The library. Reading is how a picker fills its list; writing is how the
    // Library item edits a value that every item pointing at it will see, so
    // the two are separate grants.
    // Saved values, by type or by id. There is nothing structural to ask
    // about any more -- no drawers to enumerate -- so this is the whole of
    // reading the library: what is saved of a type, and what one of them is.
    "store:read": () => ({
      saved: (type) => savedOfType(type),
      value: (id) => savedValue(id),
      types: () => savedTypes(),
      loaded: () => libraryLoaded(),
    }),
    "store:write": () => ({
      save: (value) => saveValue(value),
      remove: (id) => deleteValue(id),
      // A picture or video as a data URL in, the address it is kept at out
      // (backend/blobs.py): for a draft that should hold the address rather
      // than megabytes of the file.
      keepFile: (dataUrl) =>
        fetchJSON("/api/blob/put", { method: "POST", body: { data_url: dataUrl } }).then((body) => body.address),
      // Whether `src` is such an address already (nothing to keep again).
      isKept: (src) => (locate(src) || {}).scheme === "kept",
    }),

    // The keys the person bound to things on screen. The shell runs them;
    // these are how an app lists and edits the bindings. Layout-wide, like
    // placing: a binding can point at any window.
    "hotkeys:read": () => ({
      list: () => hotkeyList(),
      // Every key a binding may use, and which binding has it now.
      // The list is built once: building it resolves every app, and doing that
      // per key made each redraw of the hotkey manager take hundreds of ms.
      keys: () => {
        const list = hotkeyList();
        return HOTKEY_KEYS.map((key) => ({ key, usedBy: (list.find((one) => one.key === key) || {}).id || "" }));
      },
      actions: () => Object.entries(HOTKEY_ACTIONS).map(([key, spec]) => ({ key, label: t(spec.label) })),
    }),
    "hotkeys:write": () => ({
      add: (binding) => addHotkey(binding),
      set: (id, patch) => setHotkey(id, patch),
      remove: (id) => removeHotkey(id),
      // The guides over every control the action can stand in for; resolves
      // to {action, target} for the one clicked, or null.
      pick: (action) => pickHotkeyTarget(action),
      cancelPick: () => exitHotkeyPick(),
    }),

    // Apps: what a launcher offers, as values (see "apps" in core). Built-in
    // ones are changed by override and put back with reset; a person's own
    // are added, changed and removed. Changes reach the open frames at once.
    "apps:read": () => ({
      list: () => appList(),
      get: (id) => appDef(id),
      // The ids of the apps with a window open.
      running: () => [...runningApps()],
      // An app's windows as the layout preview draws them: by id, or for a
      // value that is not saved anywhere.
      tree: (app) => appLayoutTree(typeof app === "string" ? appDef(app) : coerceApp(app)),
      // The app a window is part of, or null.
      ofWindow: (windowId) => {
        const app = appOfWindow(windowId);
        return app ? app.id : null;
      },
    }),
    "apps:write": () => ({
      add: (value) => addApp(value),
      set: (id, patch) => setApp(id, patch),
      reset: (id) => resetApp(id),
      remove: (id) => removeApp(id),
      duplicate: (id) => duplicateApp(id),
      place: (id) => placeApp(id),
      // A window on screen (and the app frame it is in) as an app value.
      capture: (windowId) => captureApp(windowId),
      // The window guides: resolves to the id of the window chosen, or null.
      pickWindow: () => pickWindow(),
    }),

    // Bays: places on screen whose windows are swapped by the sash. The
    // shell keeps them with the layout; these are how an app lists and edits
    // them. Layout-wide, like placing.
    "bays:read": () => ({
      // [{id, name, placed, active, sashes: [{id, name, active, windows, tree}]}]
      // -- `tree` is the sash's arrangement as the layout preview draws one.
      list: () => bayList(),
      get: (id) => bayList().find((one) => one.id === id) || null,
    }),
    "bays:write": () => ({
      add: (name) => addBay(name),
      rename: (id, name) => renameBay(id, name),
      // Which way the sashes slide: auto, left, right, up or down (where the next one comes in from).
      setSlide: (id, mode) => setBaySlide(id, mode),
      remove: (id) => removeBay(id),
      // A new sash, active at once: {id, placed} -- not placed means the bay
      // is not on screen yet, which is what place() is for.
      addSash: (bayId, name) => addSash(bayId, name),
      renameSash: (bayId, sashId, name) => renameSash(bayId, sashId, name),
      removeSash: (bayId, sashId) => removeSash(bayId, sashId),
      activate: (bayId, sashId) => activateSash(bayId, sashId),
      next: (bayId) => nextSash(bayId),
      prev: (bayId) => prevSash(bayId),
      // The place guides; the bay's frame where one is clicked.
      place: (bayId) => placeBay(bayId),
      unplace: (bayId) => unplaceBay(bayId),
      // A window (or group) the sash holds, out of it and onto the screen
      // beside the bay. `windowId` is a pane's `id` in the list's `tree`.
      unregister: (bayId, sashId, windowId) => unregisterFromSash(bayId, sashId, windowId),
      // The sashes in another order (their ids, first to last).
      order: (bayId, sashIds) => orderSashes(bayId, sashIds),
    }),

    // Every item, not only the connected ones: making items, and writing any
    // property of any of them. A strong permission, for what works on the layout
    // as a whole (an inspector, a preset loader); an item that works with other
    // items is given them by a connection and needs none of this.
    "items:write": (ctx) => ({
      create: (type) => {
        if (!ITEM_TYPES[type]) throw new Error(`unknown item type: ${type}`);
        return createItem(type).id;
      },
      set: (itemId, key, value) => {
        if (getItem(itemId) && !inScope(ctx.itemId, itemId, "set")) recordUse("beyond", ctx.itemId, itemId, "set");
        return writeProperty(ctx.itemId, itemId, key, value);
      },
    }),
  });
  Object.assign(BASE, {
    // Reading and writing the properties of the items it reaches -- itself, the
    // items connected to it and what they own, the items it is part of. The
    // ones it does not reach are not there (`get` answers null; `set` refuses).
    items: (ctx) => ({
      get: (id) => {
        const item = itemById(id);
        return item && inScope(ctx.itemId, id, "get") ? itemEntry(ctx, item) : null;
      },
      set: (itemId, key, value) => {
        if (!getItem(itemId)) throw new Error("unknown item: " + itemId);
        if (!inScope(ctx.itemId, itemId, "set")) throw new Error(itemId + " is not connected to " + ctx.itemId);
        return writeProperty(ctx.itemId, itemId, key, value);
      },
      runAction: (itemId, name, report) => {
        const item = actionTarget(ctx, itemId, name);
        return runAction(item, name, undefined, report);
      },
      cancelAction: (itemId, name) => cancelAction(actionTarget(ctx, itemId, name), name),
    }),

    // Driving the apps connected to the item: what they offer to press, set and
    // read (see appSurface in core), and doing it -- and pointing, on screen, at
    // what the connected apps show.
    apps: (ctx) => {
      const connected = (id) => {
        if (!linksInto(ctx.itemId, id)) throw new Error(id + " is not connected to " + ctx.itemId);
        return id;
      };
      return {
        // Data only: what there is, not the way to do it.
        surface: (id) => {
          const found = appSurface(connected(id));
          if (!found) return null;
          return {
            // What is drawn as a button. `hidden` ones -- an app's own stop,
            // which shares a button with its run -- are for `press` only.
            buttons: found.buttons.filter((one) => !one.hidden).map(({ key, label, primary, disabled, node }) => ({ key, label, primary, disabled, node })),
            inputs: found.inputs.map(({ key, prop, label, kind, defaultKind, spec, wide }) => ({ key, prop, label, kind, defaultKind, spec, wide: Boolean(wide) })),
            outputs: found.outputs.map(({ key, label, kind, spec, node, display }) => ({ key, label, kind, spec, node, display: Boolean(display) })),
          };
        },
        press: (id, key) => pressApp(connected(id), key),
        setInput: (id, key, value, kind) => setAppInput(connected(id), key, value, kind),
        output: (id, key) => readAppOutput(connected(id), key),
        // The user points at a control of the connected apps (a button, an input,
        // an output) on their windows; the answer says which.
        pick: (what) => pickProperty(linksOf(getItem(ctx.itemId)).map((one) => one.to), what),
        // Whether another window's property feeds an input of a connected app (what
        // is set there is overwritten at the next refresh), and the way to stop it.
        fed: (id, key) => isLinkedInto(connected(id), key),
        unfeed: (id, key) => unlinkPort({ item: connected(id), key }),
      };
    },

    // What the user put into the item's own properties (a drag onto its card, or
    // pointing at one): what a property shares -- its type, whether it can be
    // written to, what it is called, a way to read and write it, never where it
    // is -- and having the user point at something to share. Only the item's own
    // properties; the click is the grant.
    props: (ctx) => ({
      shared: (key) => sharedInfo(ctx.itemId, key),
      pick: (key, options) => pickShare(ctx.itemId, key, options),
      unshare: (key) => unlinkPort({ item: ctx.itemId, key }),
      // Let go of what one of its own ports follows or shares (a card's "stop
      // following"): the port is an address in this item, a property, an entry or
      // a field of it. Not another item's.
      release: (port) => {
        if (!port || port.item !== ctx.itemId) return false;
        unlinkPort(port);
        return true;
      },
    }),
  });
  for (const [namespace, factory] of Object.entries(BASE)) registerBaseApi(namespace, factory);
  for (const [name, factory] of Object.entries(BUILT_IN)) {
    if (!(name in NEEDS)) throw new Error(`permission "${name}" says nothing of the services it needs (NEEDS in permissions.js)`);
    registerPermission(name, factory, { needs: NEEDS[name] });
  }
}
