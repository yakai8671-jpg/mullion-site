/* The library: values saved in the database and referenced from anywhere.
 *
 * A saved value has a type -- a value type registered here -- a name,
 * and the value itself. That is the whole of it. There is no drawer: a
 * drawer was a second place to say what the type already said, and it made
 * the shell hold an opinion about grouping when grouping is something only
 * some value types have. A type that needs it groups its own values
 * (see `groups` in registerValueType), which is why a prompt part
 * carries its category and a vector needs nothing.
 *
 * An item that uses a saved value keeps its id, so editing the value
 * changes every item that references it -- which is the point of putting it
 * here rather than in the item.
 *
 * The whole thing is cached in memory because reading a property has to be
 * synchronous: a body() runs during a render and cannot await a fetch. The
 * cache is loaded once at boot and refreshed after every write, and a write
 * from another tab arrives over the same BroadcastChannel the profile uses.
 */

import { fetchJSON, fetch, locate } from "./deps.js";

const cache = { saved: [], loaded: false };
const channel = typeof globalThis.BroadcastChannel === "function" ? new globalThis.BroadcastChannel("mullion-library") : null;
// It does not keep a process alive by itself (the Node tests have one too).
if (channel && typeof channel.unref === "function") channel.unref();

// Set by core once it is ready to redraw. Kept as a hook rather than an
// import so this module owes nothing to the shell.
let onChanged = () => {};

export function watchLibrary(fn) {
  onChanged = fn;
}

// ---- reading (synchronous, off the cache) -----------------------------
export function saved() {
  return cache.saved;
}

export function savedOfType(type) {
  return type ? cache.saved.filter((one) => one.type === type) : cache.saved;
}

export function savedValue(id) {
  if (id === null || id === undefined) return null;
  return cache.saved.find((one) => one.id === Number(id)) || null;
}

// Which types have anything saved, and how much. The library manager and
// the inventory both want this, and neither should have to group the list
// itself.
export function savedTypes() {
  const counts = new Map();
  cache.saved.forEach((one) => counts.set(one.type, (counts.get(one.type) || 0) + 1));
  return [...counts.entries()].map(([type, count]) => ({ type, count })).sort((a, b) =>
    a.type.localeCompare(b.type)
  );
}

export function libraryLoaded() {
  return cache.loaded;
}

// ---- loading ----------------------------------------------------------
export async function loadLibrary() {
  try {
    const body = await fetchJSON("/api/store/saved");
    cache.saved = body.saved || [];
    cache.loaded = true;
  } catch (error) {
    // A library that will not load is not a reason to lose the layout: the
    // references stay in the items and resolve once it comes back.
    console.error("[mullion] library did not load:", error.message || error);
  }
  return cache;
}

// Reload and redraw, then tell the other tabs to do the same. `quiet` is
// for the reload that a message from another tab asked for -- passing it on
// would bounce forever.
async function refresh(quiet = false) {
  await loadLibrary();
  onChanged();
  if (!quiet && channel) channel.postMessage({ changed: Date.now() });
}

if (channel) channel.onmessage = () => refresh(true);

// Changes made outside this browser -- another device, another server
// process, the database edited by hand -- reach no write and no broadcast
// here. Coming back to the page is the moment they might matter, so that
// is when the library is fetched again: on an event, not on a timer.
//
// Only a library that actually changed redraws anything. Fetching returns
// fresh objects every time, and redrawing every window on every focus would
// also schedule a layout save for nothing.
let catchingUp = null;
export function catchUp() {
  if (catchingUp) return catchingUp;
  const before = JSON.stringify(cache.saved);
  catchingUp = loadLibrary()
    .then(() => {
      if (JSON.stringify(cache.saved) !== before) onChanged();
    })
    .finally(() => {
      catchingUp = null;
    });
  return catchingUp;
}

// ---- writing ----------------------------------------------------------
// A picture held by an address that only serves it for a while -- what ComfyUI
// hands a run's output at, a file on this disk -- is not one a saved value can
// lean on: the server may be gone, the file moved. Such an address anywhere in
// a value is fetched into the picture itself, which the server then keeps as
// a file of its own (backend/blobs.py). What cannot be fetched stays as it is.
const SERVED = /^\/api\/(?:comfy\/view|fs\/download)\?/;

async function keepServed(value) {
  if (typeof value === "string") {
    if (!SERVED.test(value)) return value;
    try {
      const response = await fetch(value);
      if (!response.ok) return value;
      const blob = await response.blob();
      // The server hands files over as octet-stream: the kind is the file's
      // name, which the address carries (media.js reads it).
      const found = locate(value);
      const mime = blob.type.startsWith("image/") ? blob.type : found && found.media === "image" ? found.mime : "";
      if (!mime) return value;
      return await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob.type === mime ? blob : new Blob([blob], { type: mime }));
      });
    } catch {
      return value;
    }
  }
  if (Array.isArray(value)) return Promise.all(value.map(keepServed));
  if (value && typeof value === "object") {
    const kept = await Promise.all(Object.values(value).map(keepServed));
    return Object.fromEntries(Object.keys(value).map((key, index) => [key, kept[index]]));
  }
  return value;
}

export async function saveValue({ id = null, type, name, value }) {
  value = await keepServed(value);
  const body = await fetchJSON("/api/store/saved/save", {
    method: "POST",
    body: { id, type, name, value },
  });
  await refresh();
  return body.saved;
}

export async function deleteValue(id) {
  await fetchJSON("/api/store/saved/delete", { method: "POST", body: { id } });
  await refresh();
}

// The library for a read-through value: a port reads and writes with no api
// (see portSpec), so what such a value keeps in the library goes by this.
export const store = { saved: (type) => savedOfType(type), save: (value) => saveValue(value) };
