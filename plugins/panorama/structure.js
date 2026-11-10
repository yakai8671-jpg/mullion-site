/* What the viewer draws of a panorama's structure (geometry.js): a colour
 * over each pixel for what it is, and the outlines of the planes and the
 * boxes of the things, in the room's own space.
 *
 *   floor     green       ceiling   blue
 *   walls     orange, each its own shade (outdoors, the faces of what
 *             stands there, a redder orange)
 *   things    one colour each, their tops and sides included
 *   sky       a faint blue, to show it was seen as sky
 */

import { SKY } from "./geometry.js";

const KIND_COLOURS = {
  floor: [62, 207, 110],
  ceiling: [91, 140, 255],
  wall: [255, 154, 60],
  facade: [255, 106, 61],
  side: [236, 210, 70],
  top: [40, 214, 214],
  under: [150, 120, 255],
  slope: [236, 210, 70],
  object: [230, 70, 200],
};
// Things, one after another: hues far enough apart to tell side by side,
// none of them the floor's green or the walls' orange.
const THING_COLOURS = [
  [230, 70, 200],
  [40, 200, 230],
  [250, 220, 60],
  [150, 110, 255],
  [255, 90, 120],
  [60, 230, 180],
  [200, 150, 255],
  [120, 190, 255],
];
const SKY_COLOUR = [140, 200, 255];

// The colour an entry is drawn in: a part of a thing in the thing's.
export function colourOf(result, entry) {
  if (!entry) return null;
  const thing = entry.kind === "object" ? entry : entry.of ? result.byId.get(entry.of) : null;
  if (thing) return THING_COLOURS[thing.rank % THING_COLOURS.length];
  const base = KIND_COLOURS[entry.kind] || [255, 255, 255];
  if (entry.kind !== "wall" && entry.kind !== "facade") return base;
  // Walls side by side are told apart by how light they are.
  const shade = [1, 0.78, 1.12, 0.9, 0.68][entry.rank % 5];
  return base.map((one) => Math.min(255, Math.round(one * shade)));
}

// Numbers the things and the walls in order, and indexes the entries.
export function prepare(result) {
  result.byId = new Map(result.entries.map((entry) => [entry.id, entry]));
  const counters = {};
  for (const entry of result.entries) {
    const group = entry.kind === "object" ? "object" : entry.kind;
    entry.rank = counters[group] = (counters[group] ?? -1) + 1;
  }
  return result;
}

// The overlay picture, as RGBA over the grid: the colour of what each
// pixel is, a little stronger where one thing meets another.
export function paint(result) {
  const { width: W, height: H, labels } = result;
  const colours = new Map();
  for (const entry of result.entries) colours.set(entry.id, colourOf(result, entry));
  const rgba = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const i = y * W + x;
      const label = labels[i];
      if (!label) continue;
      const colour = label === SKY ? SKY_COLOUR : colours.get(label);
      if (!colour) continue;
      const r = labels[y * W + ((x + 1) % W)];
      const d = y + 1 < H ? labels[i + W] : label;
      const edge = r !== label || d !== label;
      rgba[i * 4] = edge ? colour[0] * 0.35 : colour[0];
      rgba[i * 4 + 1] = edge ? colour[1] * 0.35 : colour[1];
      rgba[i * 4 + 2] = edge ? colour[2] * 0.35 : colour[2];
      rgba[i * 4 + 3] = label === SKY ? 60 : edge ? 230 : 140;
    }
  }
  return { rgba, width: W, height: H };
}

// The outlines: the rectangle of the floor, the ceiling and each wall,
// and the box of each thing big enough to be worth one. Pairs of points
// with a colour each, for GL lines.
export function outlines(result) {
  const points = [];
  const colours = [];
  const line = (a, b, colour) => {
    points.push(...a, ...b);
    colours.push(...colour, ...colour);
  };
  // Only what is big enough to read as a part of the room: every sliver of
  // wall between two pictures with its own frame is only clutter.
  const big = (entry) => entry.share > 0.004;
  for (const entry of result.entries) {
    const colour = colourOf(result, entry).map((one) => one / 255);
    const c = entry.corners;
    if (entry.kind === "floor" || entry.kind === "ceiling" || ((entry.kind === "wall" || entry.kind === "facade") && big(entry))) {
      for (let k = 0; k < 4; k += 1) line(c[k], c[(k + 1) % 4], colour);
    } else if (entry.kind === "object" && big(entry)) {
      for (let k = 0; k < 4; k += 1) {
        line(c[k], c[(k + 1) % 4], colour);
        line(c[4 + k], c[4 + ((k + 1) % 4)], colour);
        line(c[k], c[4 + k], colour);
      }
    }
  }
  return { points: new Float32Array(points), colours: new Float32Array(colours) };
}

// What is at a place in the picture (u, v in 0..1): its entry, or "sky",
// and how far away it is in metres (a guess: see geometry.js).
export function pick(result, u, v) {
  const { width: W, height: H, labels, dist, scale } = result;
  const x = Math.min(W - 1, Math.max(0, Math.floor(u * W)));
  const y = Math.min(H - 1, Math.max(0, Math.floor(v * H)));
  const i = y * W + x;
  const label = labels[i];
  if (label === SKY) return { sky: true };
  return { entry: result.byId.get(label) || null, distance: dist[i] * scale };
}

// ---- loading -------------------------------------------------------------------

// Worked out once per GLB, in a worker, and kept while the page is open:
// switching the overlay off and on again, or another window of the same
// picture, costs nothing.
const CACHE = new Map();
let worker = null;
let nextId = 0;
const waiting = new Map();

function analyseOffThread(buffer) {
  if (!worker) {
    worker = new Worker(new URL("./structure_worker.js", import.meta.url), { type: "module" });
    worker.onmessage = (event) => {
      const { id, result, error } = event.data;
      const one = waiting.get(id);
      waiting.delete(id);
      if (!one) return;
      if (error) one.reject(new Error(error));
      else one.resolve(result);
    };
    worker.onerror = (event) => {
      for (const one of waiting.values()) one.reject(new Error(event.message || "worker failed"));
      waiting.clear();
      worker = null;
    };
  }
  const id = nextId++;
  return new Promise((resolve, reject) => {
    waiting.set(id, { resolve, reject });
    worker.postMessage({ id, buffer }, [buffer]);
  });
}

export function loadStructure(url) {
  if (!CACHE.has(url)) {
    const loading = (async () => {
      const response = await fetch(url);
      if (!response.ok) {
        // The server says why in its answer ({error}): ComfyUI not running,
        // or the file gone from it -- not only that the relay failed.
        const said = await response.json().then((body) => (body && body.error ? String(body.error) : ""), () => "");
        throw new Error(`${response.status} ${response.statusText}${said ? ` -- ${said}` : ""}`);
      }
      const result = prepare(await analyseOffThread(await response.arrayBuffer()));
      return { result, overlay: paint(result), lines: outlines(result) };
    })();
    CACHE.set(url, loading);
    loading.catch(() => CACHE.delete(url));
  }
  return CACHE.get(url);
}
