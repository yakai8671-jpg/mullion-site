/* The overlay's drawing (moved from the Overlay item, shell/builtins/overlay.js):
 * the items, controls and values on the screen, outlined and named where they
 * sit, on one pointer-transparent layer outside the stage. The item says what
 * to show (showOverlay) and is told when the numbers move. */
import { ITEM_TYPES, portInfo, portLabel, t, MutationObserver, cancelAnimationFrame, document, getComputedStyle, requestAnimationFrame, window } from "./deps.js";

let settingsOf = () => null;
let countsChanged = () => {};

// What each kind is drawn with. `inset` keeps the frames of one box that is
// several things at once (a text card is a control and a value) apart.
const KINDS = [
  { id: "items", icon: "box", inset: 0 },
  { id: "controls", icon: "sliders", inset: 2 },
  { id: "values", icon: "tag", inset: 4 },
];

// Nothing smaller than this is worth a frame.
const MIN_SIZE = 6;
// A tag only fits a box that is wide enough to carry some of its name, and
// tall enough to hold it (a tag is 16px, and sits 2px in).
const MIN_TAG_WIDTH = 56;
const MIN_TAG_HEIGHT = 20;
// Layout can change without anything being touched (an image arriving, a
// transition ending), so the layer looks again now and then.
const HEARTBEAT_MS = 1000;
// How often the window's own numbers are redrawn when they move.
const COUNT_REDRAW_MS = 500;

let layer = null;
let observer = null;
let beat = 0;
let queued = 0;
let last = "";
let counts = { items: 0, controls: 0, values: 0 };
let countTimer = 0;

// ---- finding what is on the screen --------------------------------------

function typeName(type) {
  const def = ITEM_TYPES[type];
  return def ? t(def.label) : type;
}

// {el, kind, name} for everything that is showing, in the order of the page.
function collect(shown) {
  const found = [];
  if (shown.items) {
    document.querySelectorAll(".mu-item[data-item-id]").forEach((el) => {
      found.push({ el, kind: "items", name: `${typeName(el.dataset.itemType)} · ${el.dataset.itemId}` });
    });
  }
  if (shown.controls) {
    // Declarative containers are rendered as node kinds rather than control
    // widgets, but they are controls in an item layout too.
    document.querySelectorAll('[data-node-kind="section"], [data-node-kind="card"], [data-node-kind="bar"], [data-node-kind="pinned"]').forEach((el) => {
      const name = el.dataset.nodeKind;
      const key = el.dataset.nodeKey;
      found.push({ el, kind: "controls", name: key ? `${name} · ${key}` : name });
    });
    // A control a body placed...
    document.querySelectorAll("[data-control-name]").forEach((el) => {
      const key = el.dataset.nodeKey;
      found.push({ el, kind: "controls", name: key ? `${el.dataset.controlName} · ${key}` : el.dataset.controlName });
    });
    // ...and the one a property row is drawn with (its value cell, because the
    // row itself is a wrapper without a box of its own). A row that only
    // shows its value as text has no control to name.
    document.querySelectorAll(".mu-prop-row[data-control]").forEach((rowEl) => {
      const name = rowEl.dataset.control;
      const cell = rowEl.lastElementChild;
      if (!name || name === "static" || !cell) return;
      const label = rowEl.querySelector(":scope > dt .mu-prop-label");
      const text = label ? label.textContent.trim() : "";
      found.push({ el: cell, kind: "controls", name: text ? `${name} · ${text}` : name });
    });
  }
  if (shown.values) {
    document.querySelectorAll(".mu-port[data-port-item]").forEach((el) => {
      if (!el.dataset.portItem) return;
      found.push({ el, kind: "values", name: valueName(el) });
    });
  }
  return found;
}

// A value by the property it is of, and what it carries.
function valueName(el) {
  const address = { item: el.dataset.portItem, key: el.dataset.portKey };
  try {
    if (el.dataset.portPath) address.path = JSON.parse(el.dataset.portPath);
    const label = portLabel(address);
    const info = portInfo(address);
    return info && info.kind ? `${label} · ${info.kind}` : label;
  } catch {
    return `${address.item} · ${address.key}`;
  }
}

// The part of a box that can be seen: cut by every ancestor that clips. A
// control scrolled out of its window's body is not on the screen, and must not
// be drawn over the window next to it.
function visible(el, rect, clips) {
  let { left, top, right, bottom } = rect;
  for (let up = el.parentElement; up && up !== document.body; up = up.parentElement) {
    let box = clips.get(up);
    if (box === undefined) {
      const style = getComputedStyle(up);
      box = style.overflowX !== "visible" || style.overflowY !== "visible" ? up.getBoundingClientRect() : null;
      clips.set(up, box);
    }
    if (!box) continue;
    left = Math.max(left, box.left);
    top = Math.max(top, box.top);
    right = Math.min(right, box.right);
    bottom = Math.min(bottom, box.bottom);
    if (right - left < MIN_SIZE || bottom - top < MIN_SIZE) return null;
  }
  return { left, top, width: right - left, height: bottom - top };
}

// ---- drawing ------------------------------------------------------------

function ensureLayer() {
  if (layer) return layer;
  layer = document.createElement("div");
  layer.className = "mu-overlay-layer";
  layer.setAttribute("aria-hidden", "true");
  document.body.append(layer);
  return layer;
}

// The i-th box of the layer, made when there are not enough yet.
function boxAt(index) {
  let box = layer.children[index];
  if (box) return box;
  box = document.createElement("div");
  const tag = document.createElement("span");
  tag.className = "mu-overlay-tag";
  tag.append(Object.assign(document.createElement("i"), { className: "bi" }), document.createElement("span"));
  box.append(tag);
  layer.append(box);
  return box;
}

function paint() {
  queued = 0;
  const shown = settingsOf();
  if (!shown || !shown.active) return clear();

  const clips = new Map();
  const drawn = [];
  for (const one of collect(shown)) {
    if (one.el.closest(".mu-overlay-layer")) continue;
    const rect = one.el.getBoundingClientRect();
    if (rect.width < MIN_SIZE || rect.height < MIN_SIZE) continue;
    const at = visible(one.el, rect, clips);
    if (!at) continue;
    const inset = KINDS.find((kind) => kind.id === one.kind).inset;
    drawn.push({
      kind: one.kind,
      name: one.name,
      left: Math.round(at.left + inset),
      top: Math.round(at.top + inset),
      width: Math.max(MIN_SIZE, Math.round(at.width - inset * 2)),
      height: Math.max(MIN_SIZE, Math.round(at.height - inset * 2)),
    });
  }

  const now = { items: 0, controls: 0, values: 0 };
  drawn.forEach((one) => (now[one.kind] += 1));
  counted(now);

  // The same picture as last time is not drawn again.
  const signature = JSON.stringify([drawn, shown.names]);
  if (signature === last) return;
  last = signature;

  ensureLayer();
  drawn.forEach((one, index) => {
    const box = boxAt(index);
    box.hidden = false;
    box.className = `mu-overlay-box kind-${one.kind}`;
    box.style.left = `${one.left}px`;
    box.style.top = `${one.top}px`;
    box.style.width = `${one.width}px`;
    box.style.height = `${one.height}px`;
    const tag = box.firstElementChild;
    const named = shown.names && one.width >= MIN_TAG_WIDTH && one.height >= MIN_TAG_HEIGHT;
    tag.hidden = !named;
    if (!named) return;
    const kind = KINDS.find((entry) => entry.id === one.kind);
    tag.firstElementChild.className = `bi bi-${kind.icon}`;
    tag.lastElementChild.textContent = one.name;
  });
  while (layer.children.length > drawn.length) layer.lastElementChild.remove();
}

function clear() {
  last = "";
  if (layer) layer.replaceChildren();
}

// The numbers shown in the window, kept current without redrawing it for
// every frame of a scroll.
function counted(now) {
  if (now.items === counts.items && now.controls === counts.controls && now.values === counts.values) return;
  counts = now;
  if (countTimer) return;
  countTimer = window.setTimeout(() => {
    countTimer = 0;
    countsChanged();
  }, COUNT_REDRAW_MS);
}

function schedule() {
  if (queued) return;
  queued = requestAnimationFrame(paint);
}

// ---- running ------------------------------------------------------------

function start() {
  if (observer) return;
  const stage = document.getElementById("stage");
  observer = new MutationObserver(schedule);
  if (stage) observer.observe(stage, { subtree: true, childList: true, attributes: true, attributeFilter: ["class", "style", "hidden", "data-port-item"] });
  window.addEventListener("resize", schedule);
  // Scrolling inside a window does not bubble, but it can be captured.
  window.addEventListener("scroll", schedule, true);
  window.addEventListener("transitionend", schedule, true);
  beat = window.setInterval(schedule, HEARTBEAT_MS);
}

function stop() {
  if (observer) observer.disconnect();
  observer = null;
  window.removeEventListener("resize", schedule);
  window.removeEventListener("scroll", schedule, true);
  window.removeEventListener("transitionend", schedule, true);
  window.clearInterval(beat);
  beat = 0;
  if (queued) cancelAnimationFrame(queued);
  queued = 0;
  if (countTimer) window.clearTimeout(countTimer);
  countTimer = 0;
  last = "";
  if (layer) layer.remove();
  layer = null;
}

/** Draw over the screen while `read()` says it is active ({ active, items,
 * controls, values, names }); `told()` when the numbers found change. */
export function showOverlay(read, told) {
  settingsOf = read;
  countsChanged = told;
  start();
  schedule();
}

export function hideOverlay() {
  stop();
}

/** What is outlined now ({ items, controls, values }), or null while hidden. */
export function overlayCounts() {
  return observer ? counts : null;
}
