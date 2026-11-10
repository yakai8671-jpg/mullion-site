/* pickers: moved out of core.js (docs/wiki/migration.md). */
import { ICONS, ITEM_TYPES, bindProperty, commit, createItem, currentItemId, eachLeaf, findLeaf, getItem, grants, layoutRoot, portGuide, portInfo, readAddress, screensOf, setScreens, sharePort, truncatePath, currentFileName, layoutText, loadLayoutText, operationsHalted, rememberFile, t, Element, document, getComputedStyle, window, toast } from "./deps.js";

// What pickers asks of others (registerPickersHook), while they are core.js:
//   surface(itemId)            -- what an app shows that can be picked (mount)
//   windowEl(windowId)         -- a window's element on screen (frames)
//   openInWindow(windowId, id) -- show an item in a window (frames)
//   hasPresets(itemId)         -- whether a window's preset button is there (mount)
//   pickFile()                 -- open a layout file without a file picker (boot: the page's file input)
const pickersHooks = {
  surface: () => null,
  windowEl: () => null,
  openInWindow: () => false,
  hasPresets: () => false,
  pickFile: () => {},
};

function registerPickersHook(kind, fn) {
  pickersHooks[kind] = fn;
}

// ---- picking a property of an app on screen ------------------------------
// Pressing "select" on a property-pick control covers every control of the
// given apps' windows that is one of the app's inputs with a guide, the way a
// card is covered while a value is carried; pressing one of them answers
// with which input of which app it is. An input says which control is its
// own with `node` on the surface (a node key, a list of them, or a function
// of one); else it is the control keyed by the input's key, in any of the
// forms an item draws its own.
//
// Only what is on screen can be pointed at: a window that is collapsed, or
// away in another sash, has nothing to cover.
let picking = null;

function endPick(result = null) {
  if (!picking) return;
  const done = picking;
  picking = null;
  done.cleanup();
  done.resolve(result);
}

// The name a control goes by on the window it is drawn in.
function shownLabel(el) {
  const row = el.matches(".mu-prop-row") ? el : el.closest(".mu-prop-row");
  const named = row && row.querySelector(":scope > dt .mu-prop-label");
  if (named && named.textContent.trim()) return named.textContent.trim();
  for (let at = el.closest(".mu-view-section"); at; at = at.parentElement && at.parentElement.closest(".mu-view-section")) {
    const title = at.querySelector(":scope > .mu-view-title > .mu-view-label");
    if (title && title.textContent.trim()) return title.textContent.trim();
  }
  return "";
}

function pickProperty(itemIds, what = "input") {
  endPick(null);
  // An item may bring its form back on screen first (`prepare`, an action that answers later): wait for it, and for the
  // redraw it causes, before covering what is drawn.
  const waits = [];
  for (const itemId of itemIds) {
    const surface = pickersHooks.surface(itemId);
    const made = surface && surface.prepare ? surface.prepare() : null;
    if (made && typeof made.then === "function") waits.push(made);
  }
  if (waits.length) return Promise.all(waits).then(() => new Promise((wake) => setTimeout(wake, 80))).then(() => pickNow(itemIds, what));
  return pickNow(itemIds, what);
}

function pickNow(itemIds, what = "input") {
  return new Promise((resolve) => {
    // Overlays by the control they cover: one control may answer for several
    // things (the run button and the output of an app's output card).
    const covers = new Map();
    const restore = [];
    const matcherOf = (itemId, one) => {
      if (typeof one.node === "function") return one.node;
      if (one.node !== undefined) {
        const keys = [].concat(one.node);
        return (domKey) => keys.includes(domKey);
      }
      return (domKey) =>
        domKey === one.key ||
        domKey === `${itemId}-${one.key}` ||
        domKey === `${one.key}-${itemId}` ||
        domKey.startsWith(`${one.key}-${itemId}-`);
    };
    // The element a thing is drawn as, in one window's body.
    const targetOf = (body, nodes, itemId, one) => {
      if (what === "control") {
        const found = nodes.filter((el) => el.dataset.nodeKey === one.node);
        return found.find((el) => !found.some((other) => other !== el && el.contains(other))) || null;
      }
      if (what === "button") {
        if (one.selector) return body.querySelector(one.selector);
        const home = nodes.find((el) => el.dataset.nodeKey === one.node);
        if (!home) return null;
        return (one.tool && home.querySelector(`[data-tool-key="${CSS.escape(String(one.tool))}"]`)) || home;
      }
      const match = matcherOf(itemId, one);
      const found = nodes.filter((el) => match(el.dataset.nodeKey));
      // The control itself, not the section around it.
      return found.find((el) => !found.some((other) => other !== el && el.contains(other))) || null;
    };
    for (const itemId of itemIds) {
      const surface = pickersHooks.surface(itemId);
      if (!surface) continue;
      // A control: what is drawn together -- a run button and the output
      // it fills -- under the key of the node they are in.
      let things;
      if (what === "control") {
        const groups = new Map();
        const home = (one) => (Array.isArray(one.node) ? one.node[0] : typeof one.node === "string" ? one.node : one.key);
        for (const one of surface.buttons.filter((b) => !b.hidden)) {
          const g = groups.get(home(one)) || { buttons: [], outputs: [] };
          g.buttons.push(one);
          groups.set(home(one), g);
        }
        for (const one of surface.outputs) {
          const g = groups.get(home(one));
          if (g) g.outputs.push(one);
        }
        things = [...groups].map(([node, g]) => {
          const lead = g.buttons.find((b) => b.primary) || g.buttons[0];
          return {
            key: lead.key,
            label: lead.label || lead.key,
            node,
            output: g.outputs[0] ? g.outputs[0].key : "",
            outputKind: g.outputs[0] ? g.outputs[0].kind : "",
          };
        });
      } else {
        things = what === "button" ? surface.buttons.filter((one) => !one.hidden) : what === "output" ? surface.outputs : surface.inputs.filter((one) => !one.hidden);
      }
      for (const leafId of usedBy(itemId)) {
        const leaf = findLeaf(leafId);
        const frame = pickersHooks.windowEl(leafId);
        if (!leaf || !frame || frame.classList.contains("is-collapsed") || currentItemId(leaf) !== itemId) continue;
        const body = frame.querySelector(":scope > .mu-body");
        if (!body) continue;
        const nodes = Array.from(body.querySelectorAll("[data-node-key]"));
        for (const one of things) {
          // What stands for the whole item -- its preset -- is picked on the
          // window's top bar, where the presets button is.
          const target = one.titlebar ? (pickersHooks.hasPresets(itemId) ? frame.querySelector(":scope > .mu-titlebar") : null) : targetOf(body, nodes, itemId, one);
          if (!target) continue;
          if (!covers.has(target)) covers.set(target, []);
          covers.get(target).push({
            item: itemId,
            key: one.key,
            label: one.label || one.key,
            // What it is called where it is drawn: the heading of its section,
            // or the label of its row -- the name a person knows it by.
            shown: one.kind === "*" || one.titlebar ? one.label : shownLabel(target),
            // What a value of it is carried as (an input's, or the output a
            // control holds): what a link between two properties is made of.
            kind: one.kind || "",
            output: one.output || "",
            outputKind: one.outputKind || "",
          });
        }
      }
    }
    if (!covers.size) return resolve(undefined);
    const guides = [];
    for (const [target, answers] of covers) {
      if (getComputedStyle(target).position === "static") {
        restore.push([target, target.style.position]);
        target.style.position = "relative";
      }
      const overlay = document.createElement("div");
      overlay.className = `mu-port-guides is-pick${answers.length === 1 ? " is-single" : ""}`;
      for (const answer of answers) {
        const button = portGuide("pick", "cursor", answer.shown || answer.label);
        button.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          endPick(answer);
        });
        overlay.append(button);
      }
      // One thing here: the whole cover answers for it.
      if (answers.length === 1) {
        overlay.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          endPick(answers[0]);
        });
      }
      target.append(overlay);
      guides.push(overlay);
    }
    const onKey = (event) => {
      if (event.key === "Escape") endPick(null);
    };
    // After the press that started this, not by it.
    const onDown = (event) => {
      if (!(event.target instanceof Element) || !event.target.closest(".mu-port-guides.is-pick")) endPick(null);
    };
    const timer = setTimeout(() => document.addEventListener("pointerdown", onDown, true), 0);
    document.addEventListener("keydown", onKey, true);
    document.body.classList.add("is-picking");
    picking = {
      resolve,
      cleanup: () => {
        clearTimeout(timer);
        document.removeEventListener("pointerdown", onDown, true);
        document.removeEventListener("keydown", onKey, true);
        document.body.classList.remove("is-picking");
        guides.forEach((one) => one.remove());
        restore.forEach(([el, was]) => (el.style.position = was));
      },
    };
  });
}

// ---- picking a port on screen --------------------------------------------
// Like pickProperty, but over anything that is a port -- a card or a row with
// a grip -- on any window shown, whatever item it belongs to: the guides cover
// the ports `accept(info)` takes (see portInfo), and the one pressed answers
// with its address and what it is. A port the app draws for something it
// shows without owning (a chain block's result) is as good as a property.
// `except` is an item whose own ports are left alone. Resolves null when
// cancelled, and undefined when nothing on screen can be pointed at.
function pickPort(accept, { except = "" } = {}) {
  endPick(null);
  return new Promise((resolve) => {
    const found = [];
    eachLeaf(layoutRoot(), (leaf) => {
      const frame = pickersHooks.windowEl(leaf.id);
      if (!frame || frame.classList.contains("is-collapsed")) return;
      const body = frame.querySelector(":scope > .mu-body");
      if (!body) return;
      for (const el of body.querySelectorAll("[data-port-item]")) {
        if (!el.dataset.portItem || el.offsetParent === null) continue;
        const address = readAddress(el);
        if (address.item === except) continue;
        let info = null;
        try {
          info = portInfo(address);
        } catch (error) {
          info = null;
        }
        if (info && accept(info)) found.push({ el, info });
      }
    });
    // The innermost: a card that holds another to point at is not itself.
    const covers = found.filter((one) => !found.some((other) => other !== one && one.el.contains(other.el)));
    if (!covers.length) return resolve(undefined);
    const restore = [];
    const guides = [];
    for (const { el, info } of covers) {
      if (getComputedStyle(el).position === "static") {
        restore.push([el, el.style.position]);
        el.style.position = "relative";
      }
      const overlay = document.createElement("div");
      overlay.className = "mu-port-guides is-pick is-single";
      const answer = { ...info.address, label: info.label, kind: info.kind, type: info.type };
      const button = portGuide("pick", "cursor", info.label);
      const choose = (event) => {
        event.preventDefault();
        event.stopPropagation();
        endPick(answer);
      };
      button.addEventListener("click", choose);
      overlay.addEventListener("click", choose);
      overlay.append(button);
      el.append(overlay);
      guides.push(overlay);
    }
    const onKey = (event) => {
      if (event.key === "Escape") endPick(null);
    };
    const onDown = (event) => {
      if (!(event.target instanceof Element) || !event.target.closest(".mu-port-guides.is-pick")) endPick(null);
    };
    const timer = setTimeout(() => document.addEventListener("pointerdown", onDown, true), 0);
    document.addEventListener("keydown", onKey, true);
    document.body.classList.add("is-picking");
    picking = {
      resolve,
      cleanup: () => {
        clearTimeout(timer);
        document.removeEventListener("pointerdown", onDown, true);
        document.removeEventListener("keydown", onKey, true);
        document.body.classList.remove("is-picking");
        guides.forEach((one) => one.remove());
        restore.forEach(([el, was]) => (el.style.position = was));
      },
    };
  });
}

function usedBy(itemId) {
  const windows = [];
  eachLeaf(layoutRoot(), (leaf) => {
    if (leaf.path.includes(itemId)) windows.push(leaf.id);
  });
  return windows;
}


// permissions: an ability handed to an item dies with it, so a later item
// given the same id inherits nothing.

// ---- picking a saved value ---------------------------------------------
// Where a control hands over when its property can be loaded from the
// library. Browsing what is saved needs more room than a property row --
// filters, a search, a preview -- and it is the same screen whatever the
// property is, so it happens in the chooser rather than in a widget
// repeated per control. A control cannot open a screen by itself, having
// no window and no permissions, so this is the shell's job, the same way
// the frame's own buttons are.
//
// What the picker is given is a grant, recorded against the picker's own
// id: how to reach the one property it is choosing for. It reads the grant
// through the `grant:write` permission, whose API knows who is asking. So
// there is nothing to forge -- no string naming an item and a key that
// anyone could assemble -- and the ability to write that property exists
// only for the item the shell just made, only for that one address.
//
// The spec is enough even when it was built on the fly, because such a spec
// is already required to reach the value live when called rather than close
// over a copy -- see describe()'s first rule.
const PICKER_ITEM_TYPE = "chooser";

const ICON_PICKER_TYPE = "iconpicker";
// pickers: a picker left open when the layout was saved. Its grant was a thing
// that happened in the session that opened it -- a control handing over one
// address -- and it went with that session, so the screen has nothing to
// choose for. The window goes back to what it was showing before, which is
// where the control that opens it lives. One opened on a type rather than a
// property -- from Home's preset list -- never had a grant, and still has
// what it was opened for. An icon picker always chooses for someone; with
// nobody, it goes.

// Tiles or rows, remembered for the session. It belongs to the person
// rather than to any one screen, and the screens themselves do not live
// long enough to remember anything.
let pickerView = "grid";

// Called by the picker when it is laid out differently, so the next one
// opens the same way -- and read by the next one when it sets itself up.
function rememberPickerView(view) {
  pickerView = view === "list" ? "list" : "grid";
}

function rememberedPickerView() {
  return pickerView;
}

// Open the picker over this descriptor's property, in the window the
// control was clicked in.
//
// `query` is where to start looking -- a search condition, kept apart from
// the descriptor because the descriptor says what a value must be, and a
// condition says which saved ones are worth showing first. Its fields are
// the ones any type can be searched by, whatever the type:
//
//   groups  the type's own groups to look in (see `groups` on a type)
//   text    part of a saved value's name
//
// It seeds the picker rather than binding it: narrowing or widening the
// search on that screen is a normal thing to want, and changes nothing here.
function openValuePicker(desc, fromEl, query = {}) {
  return openGrantScreen(PICKER_ITEM_TYPE, desc, fromEl, query);
}

// The same, for an icon: the icon picker, whose presets are every icon.
function openIconPicker(desc, fromEl) {
  return openGrantScreen(ICON_PICKER_TYPE, desc, fromEl, {});
}

// Every Bootstrap icon by name, read once from the icon stylesheet the page
// already has: what the icon picker offers.
let iconNameList = null;

function iconNames() {
  if (iconNameList && iconNameList.length) return iconNameList;
  const names = new Set();
  for (const sheet of document.styleSheets) {
    let rules;
    try {
      rules = sheet.cssRules;
    } catch {
      continue; // another origin's sheet: nothing of ours
    }
    for (const rule of rules || []) {
      const found = /^\.bi-([a-z0-9-]+)::?before$/.exec(rule.selectorText || "");
      if (found) names.add(found[1]);
    }
  }
  iconNameList = [...names].sort();
  return iconNameList;
}

function openGrantScreen(screenType, desc, fromEl, query = {}) {
  const frame = fromEl && fromEl.closest(".mu-window");
  const leaf = frame && findLeaf(frame.dataset.id);
  if (!leaf) return false;
  const itemId = currentItemId(leaf);
  if (!itemId) return false;

  // Parentless, and one per open. A child is what outlives its window --
  // pruneItems() keeps any child of a live item -- and this is a screen,
  // not a document: it should exist while it is being looked at and not a
  // moment longer. Parentless makes the path the only thing holding it, so
  // navigating away collects it, and two windows opened on two different
  // properties each get their own rather than fighting over one.
  const picker = createItem(screenType, null);
  grants.set(picker.id, {
    itemId,
    key: desc.key,
    label: desc.label,
    type: desc.type,
    spec: desc.params,
    api: desc.api,
    // Copied, so a caller changing its own array afterwards changes nothing.
    query: {
      groups: Array.isArray(query.groups) ? query.groups.map(String) : [],
      text: typeof query.text === "string" ? query.text : "",
    },
  });
  // Nothing of the picker's own is written here. How it stores its search
  // and its layout is its business; it reads what it was handed when it
  // mounts. See the chooser's mount().
  return pickersHooks.openInWindow(leaf.id, picker.id);
}

// Open a screen one step further along a window's path: the preset list
// from Home, the chooser for one type from that list, the preset maker
// from a chooser. Parentless for the chooser's reason -- a screen lives as
// long as the path holds it, and going back collects it.
//
// `props` seeds the new screen's own properties before it first mounts.
// `grantFrom` hands it the same address another screen was granted, so the
// maker a chooser opens knows what it is making a preset of -- the same
// one property, never a wider one.
function openScreen(windowId, type, { props = {}, grantFrom = null, shares = [] } = {}) {
  const leaf = findLeaf(windowId);
  if (!leaf || !ITEM_TYPES[type]) return null;
  const screen = createItem(type, null);
  for (const [key, value] of Object.entries(props)) {
    bindProperty(screen, key, null).set(value);
  }
  // Properties of the screen that are the same property as one of the item it
  // was opened from: a window onto that item's list, which edits the list
  // itself. [[screen key, address of the property it shares]].
  for (const [key, from] of shares) sharePort({ item: screen.id, key }, from);
  const grant = grantFrom ? grants.get(grantFrom) : null;
  if (grant && grant.kind !== "subtree") {
    grants.set(screen.id, { ...grant, query: { ...grant.query, groups: [...grant.query.groups] } });
  }
  return pickersHooks.openInWindow(leaf.id, screen.id);
}

// Step back out of the screen a window is showing, to the one it was
// opened from -- what the crumbs' back button does, for a screen that has
// finished its job.
function closeScreen(windowId) {
  const leaf = findLeaf(windowId);
  // A group's last screen closes too: what is beneath it is the group.
  if (leaf && leaf.type === "group") {
    if (!screensOf(leaf).length) return false;
    setScreens(leaf, screensOf(leaf).slice(0, -1));
    commit();
    return true;
  }
  if (!leaf || leaf.type !== "leaf" || leaf.path.length < 2) return false;
  truncatePath(windowId, leaf.path.length - 2);
  return true;
}

// ---- inspecting a selection --------------------------------------------
// A list and the properties of what is selected in it are two things, so
// they are two items in two windows rather than one body doing both. The
// inspector is the second: it follows an item, and shows whichever child
// that item has selected -- the selection itself stays where it is, in the
// document's own `ref` property, so it is saved and reproduced with it.
//
// Following another inspector follows what *that* one shows, which is how a
// chain is inspected a level at a time: layers in one window, the selected
// layer in the next, its selected effect in a third.
//

// Swap the icon inside a button that already has one.
function setIcon(button, name) {
  const icon = button && button.querySelector(".bi");
  if (!icon) return;
  const wanted = `bi bi-${ICONS[name] || name}`;
  if (icon.className !== wanted) icon.className = wanted;
}


// The icon for whatever an item is: its type's, or its kind's.


// ---- window settings ------------------------------------------------
// What a window is, and how the thing in it is set up, behind the window's
// id. It used to be a popup of facts; it is a screen now, one step along
// the window's path, because it is somewhere settings are changed -- the
// colour an app wears, where its windows go when it is opened -- and a
// glance that the next click takes away is no place to change anything.
//
// A group's open over the whole group, as the first of its screens (see
// screensOf): its bar becomes the way back, its windows wait beneath.
// Pressing the id again, while they are showing, steps back out.
const WINDOW_SETTINGS_TYPE = "windowsettings";

// What a window shows under any settings screens stacked on it.
function shownBeneathSettings(leaf) {
  for (const itemId of [...leaf.path].reverse()) {
    const item = getItem(itemId);
    if (item && item.type !== WINDOW_SETTINGS_TYPE) return item.id;
  }
  return "";
}

function openWindowSettings(frameId) {
  const node = findLeaf(frameId);
  if (!node || !ITEM_TYPES[WINDOW_SETTINGS_TYPE]) return false;
  if (node.type !== "leaf" && node.type !== "group") return false;
  const shown = getItem(currentItemId(node));
  if (shown && shown.type === WINDOW_SETTINGS_TYPE && shown.props.frame === frameId) return closeScreen(node.id);
  // Set directly rather than through the properties: they are the shell's
  // to say, and not offered as editors (see the type).
  const screen = createItem(WINDOW_SETTINGS_TYPE, null);
  screen.props.frame = frameId;
  screen.props.target = node.type === "group" ? node.appItem || "" : shownBeneathSettings(node);
  if (node.type === "group") {
    setScreens(node, [...screensOf(node), screen.id]);
    commit();
    return true;
  }
  return pickersHooks.openInWindow(node.id, screen.id);
}









// Which cards are put away is part of how a layout looks, so it is kept with
// it: a change is saved (the layout is, a moment after), and read back when
// the layout is.

// The user points at a port on screen and the item's own property shares it:
// the click is the permission, and the item is told only whether it was done
// (true / false), cancelled (null) or that there was nothing to point at
// (undefined). `options`: {list: only lists, writable: only what can be written to}.
async function pickShare(itemId, key, options = {}) {
  const found = await pickPort((info) => (!options.list || info.isList) && (!options.writable || info.writable), { except: itemId });
  if (found === undefined) return undefined;
  if (!found) return null;
  return sharePort({ item: itemId, key }, { item: found.item, key: found.key, path: found.path });
}















// A grip with nothing to carry is not dead: held, it says so on the card
// itself, where the person is looking, instead of doing nothing.

// ---- layout files ------------------------------------------------------
// (moved from operations: the browser's side of saving and opening a layout file)
// Save/load go through real files, the way Notepad does: the File System
// Access API when the browser has it, a download / <input type=file> pair
// everywhere else.
const FILE_TYPES = [
  { description: "Window layout (JSON)", accept: { "application/json": [".json"] } },
];


function suggestedName() {
  return currentFileName() || "layout.json";
}

function downloadFallback(filename) {
  const url = URL.createObjectURL(new Blob([layoutText()], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
  rememberFile(filename);
}

async function saveLayoutFile() {
  if (operationsHalted()) return;
  if (!layoutRoot()) return;
  if ("showSaveFilePicker" in window) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: suggestedName(),
        types: FILE_TYPES,
      });
      const writable = await handle.createWritable();
      await writable.write(layoutText());
      await writable.close();
      rememberFile(handle.name);
      return;
    } catch (error) {
      if (error.name === "AbortError") return;
      toast(t("mu.status.saveFailed", { error: error.message || error }));
      return;
    }
  }
  downloadFallback(suggestedName());
}

async function openLayoutFile() {
  if ("showOpenFilePicker" in window) {
    try {
      const [handle] = await window.showOpenFilePicker({ multiple: false, types: FILE_TYPES });
      const file = await handle.getFile();
      await loadLayoutText(await file.text(), file.name);
      return;
    } catch (error) {
      if (error.name === "AbortError") return;
      toast(t("mu.status.openFailed", { error: error.message || error }));
      return;
    }
  }
  pickersHooks.pickFile();
}

export {
  FILE_TYPES,
  suggestedName,
  downloadFallback,
  saveLayoutFile,
  openLayoutFile,
  registerPickersHook,
  endPick,
  shownLabel,
  pickProperty,
  pickNow,
  pickPort,
  usedBy,
  PICKER_ITEM_TYPE,
  ICON_PICKER_TYPE,
  rememberPickerView,
  rememberedPickerView,
  openValuePicker,
  openIconPicker,
  iconNames,
  openGrantScreen,
  openScreen,
  closeScreen,
  setIcon,
  WINDOW_SETTINGS_TYPE,
  shownBeneathSettings,
  openWindowSettings,
  pickShare,
};
