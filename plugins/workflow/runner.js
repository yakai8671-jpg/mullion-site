/* Runner -- a template, filled in and sent.
 *
 * This is the page promptmanager had for every tool, made into one item:
 * pick a template, fill in what its blocks take, adjust the settings it
 * opened up, run. What is filled in is the item's, so a saved layout comes
 * back with the same prompt, the same picture and the same settings.
 *
 * Every tool asks for at most one text, one picture and one size, so those
 * are three ordinary properties rather than a structure that changes shape
 * with the template -- the body simply shows the ones the template's tool
 * writes. The settings are the one part whose shape is the template's, so
 * they are a list of {id, value} and drawn from the template each time.
 *
 * The run itself is not state. Which job is in flight is kept beside the
 * item, not in it: a layout reopened mid-run has nothing to resume, and
 * saying so beats pretending. What a run produced is kept -- as ComfyUI's
 * own references to its output files, not the pictures, so the layout stays
 * small and the pictures are fetched from ComfyUI when shown.
 */

import { choicesFor, ollamaModelsFor, serverRows, wantChoices } from "./readiness.js";
import { tagEntries, tagTexts } from "../prompt/tags.js";
import { coerceCategory, fillCategories, usableCategories } from "./categories.js";

const SEED_KEYS = ["seed", "noise_seed"];
const TEXT_KEYS = ["text", "string", "strings"];
const POLL_MS = 1000;
// Polls in a row that may go unanswered before ComfyUI is taken to be
// gone: each waits up to the relay's ten seconds, so about two minutes.
const POLL_RETRIES = 12;
const TIMEOUT_MS = 30 * 60 * 1000;

// Runs in flight, by item id. Beside the items rather than in them.
const JOBS = new Map();

// How to run, cancel and check each runner, by item id, kept by the runner
// itself each time it draws. An app's run button is on its output preview
// and its connection check on its dashboard -- windows that are not the
// runner -- and this is how they reach it: they ask it, rather than
// knowing how. Each call takes where to report to, so the message appears
// in the window whose button was pressed.
const CONTROLLERS = new Map();
const EXECUTE = Symbol("workflow execution");

export const controllerOf = (runnerId) => CONTROLLERS.get(runnerId) || null;

export function workflowRunAction() {
  return {
    connected: true,
    cancellable: true,
    permissions: [], inputs: {}, outputs: {}, constants: {}, nonEmpty: [],
    ready(_inputs, { itemId }) {
      if (JOBS.get(itemId)?.cancelled) return [CORE.t("workflow.run.cancelling")];
      const controller = CONTROLLERS.get(itemId);
      return controller?.[EXECUTE] ? [controller.problem].filter(Boolean) : [CORE.t("workflow.value.openSettings")];
    },
    async run(_inputs, { itemId, signal, status }) {
      await CONTROLLERS.get(itemId)?.[EXECUTE]?.(status, signal);
    },
  };
}

export function retireWorkflowExecution(itemId) {
  CONTROLLERS.delete(itemId);
}

function interruptRun(api, job) {
  job.cancelled = true;
  if (job.promptId && !job.interrupt) job.interrupt = api.comfy.interrupt().catch(() => {});
  return job.interrupt;
}

// An app driven by a host that is not a window (see plugins/chain). Set when the
// runner registers, so a plugin that requires `workflow` can reach it.
let EMBED = null;
export const appEmbed = () => EMBED;

// What an app that is its own run settings is made of (see registerRunApp
// in appkit.js): the run settings' properties, their permissions and their
// body. Set when the runner registers, so a plugin that requires `workflow`
// can reach it.
let RUN_KIT = null;
export const runAppKit = () => RUN_KIT;

// Where a run's output is shown from: the copy kept here (`src`, made when the
// run finished -- see keepOutputs) and only without one ComfyUI's own file, by
// the reference its history gave. A kept output needs no ComfyUI to be seen.
// The address is comfy:run's (viewUrl): the plugin never names the server's
// routes itself. Handed in by initialize (scripts.js, useComfyView).
let comfyView = null;
export function useComfyView(viewUrl) {
  comfyView = viewUrl;
}

// The clipboard is clipboard:write's (handed in by initialize, scripts.js).
let clipboardWrite = null;
export function useClipboard(writeText) {
  clipboardWrite = writeText;
}
const comfyAddress = (ref) => (comfyView && ref && ref.filename ? comfyView(ref) : "");
export const resultAddress = (one) => (one && one.src) || comfyAddress((one && one.ref) || {});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Whether an editor has a run in flight -- for the windows that show it
// without being it: the preview and the app dashboard.
export const isRunning = (runnerId) => JOBS.has(runnerId);

// ---- a run, as a value -------------------------------------------------
// What a run settings window is set to, as one record: the properties it
// holds and the documents its editors hold -- the prompt parts, the
// negative ones, the categories. It is what a run preset saves and what a
// history entry keeps, and one shape for both is what lets an entry be
// restored by the same code that loads a preset.
//
// The picture going in is left out unless asked for. A preset is how a
// run is set up, and the picture is what it is run on; a history entry is
// what happened, and there the picture is part of it.
// `engine` and `engineSettings` belong to an app over several engines (see
// registerRunApp): the settings are the engine's, so the engine goes with them.
const RUN_KEYS = ["text", "promptText", "negativeText", "size", "seed", "randomSeed", "settings", "ollamaModel", "sortKind", "engine", "engineSettings"];
// The lists a run is made of besides its plain properties: the app's own (it
// holds them; the editor windows are views of them).
const RUN_DOCS = ["parts", "negativeParts", "categoryEditor"];
// Where the pictures going in are kept: the tool's first picture block in
// `image`, its second in `image2` (Wan's first and last frame), and so on,
// each with the name of the file beside it -- and, for a keyframe, the frame
// it goes at. By order rather than by block key, so a run preset or history
// entry of one picture tool fits any other.
const PICTURES = [
  ["image", "imageName"],
  ["image2", "image2Name"],
  ["image3", "image3Name", "frame3"],
  ["image4", "image4Name", "frame4"],
  ["image5", "image5Name", "frame5"],
  // Further pictures with no frame: references (MiniMax H3 takes nine,
  // after its five frames).
  ...[6, 7, 8, 9, 10, 11, 12, 13, 14].map((n) => [`image${n}`, `image${n}Name`]),
];
const clone = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));
const valueIn = (entry, key) => entry && (entry.properties.find((one) => one.key === key) || {}).value;

// An optional picture nobody gave: the node it would have been loaded
// into goes, and with it every node that takes it as its picture (an
// `image` or `images` input -- a resize, a crop) further down. Any other
// input pointing at what went is left unconnected instead: that is the
// consumer's own optional input, the one the picture was for.
//
// Unless the consumer says it is only there for that picture. A node whose
// `_meta.passThrough` names, per output, the input to hand on in its place
// is stepped over instead: whoever took its output n takes that input. It
// is how a chain of nodes each adding one keyframe to a strip loses a link
// without breaking -- the node for a missing keyframe hands on the strip it
// was given. ComfyUI never reads `_meta`, so the graph runs as it is when
// every picture is there.
function unwire(graph, assignment) {
  const gone = new Set(
    Object.values(assignment || {})
      .map((pair) => pair && String(pair.node_id))
      .filter(Boolean)
  );
  const fedBy = (value) => Array.isArray(value) && gone.has(String(value[0]));
  for (let grew = true; grew; ) {
    grew = false;
    for (const [id, node] of Object.entries(graph)) {
      // A node that can be stepped over is, even when the picture it lost
      // came in as `image` (MiniMax H3's AddGuide takes it that way).
      const steps = node._meta && Array.isArray(node._meta.passThrough);
      if (!gone.has(id) && !steps && (fedBy(node.inputs.image) || fedBy(node.inputs.images))) {
        gone.add(id);
        grew = true;
      }
    }
  }
  const stepped = new Map();
  for (const [id, node] of Object.entries(graph)) {
    const pass = node._meta && node._meta.passThrough;
    if (!gone.has(id) && Array.isArray(pass) && Object.values(node.inputs).some(fedBy)) stepped.set(id, pass);
  }
  // Where a link to a stepped-over node really leads, through any number
  // of them in a row.
  const follow = (link) => {
    for (let hops = 0; Array.isArray(link) && stepped.has(String(link[0])) && hops < 64; hops++) {
      const [id, slot] = link;
      link = graph[String(id)].inputs[stepped.get(String(id))[slot]];
    }
    return link;
  };
  for (const [id, node] of Object.entries(graph)) {
    if (gone.has(id) || stepped.has(id)) continue;
    for (const [key, value] of Object.entries(node.inputs)) {
      if (Array.isArray(value) && stepped.has(String(value[0]))) {
        const to = follow(value);
        if (to === undefined) delete node.inputs[key];
        else node.inputs[key] = to;
      }
    }
  }
  for (const id of [...gone, ...stepped.keys()]) delete graph[id];
  for (const node of Object.values(graph)) {
    for (const [key, value] of Object.entries(node.inputs)) if (fedBy(value)) delete node.inputs[key];
  }
}

export function snapshotOf(api, settingsId, { withImage = false } = {}) {
  const settings = api.items.get(settingsId);
  if (!settings) return null;
  const snap = {};
  for (const key of RUN_KEYS) {
    const value = valueIn(settings, key);
    if (value !== undefined) snap[key] = clone(value);
  }
  for (const key of RUN_DOCS) {
    const value = valueIn(settings, key);
    if (Array.isArray(value)) snap[key] = clone(value);
  }
  if (withImage) {
    for (const [key, nameKey, frameKey] of PICTURES) {
      snap[key] = valueIn(settings, key) || "";
      snap[nameKey] = valueIn(settings, nameKey) || "";
      if (frameKey) snap[frameKey] = valueIn(settings, frameKey);
    }
  }
  return snap;
}

// Written back through items:write, so the api has to be the run settings'
// own or an owner's: the app dashboard loading a preset, the run settings
// restoring an entry. Only what the record holds is written -- a preset
// saved before categories existed leaves the categories alone.
export function applySnapshot(api, settingsId, snap, { results } = {}) {
  const settings = api.items.get(settingsId);
  if (!settings || !snap || typeof snap !== "object") return false;
  for (const key of RUN_KEYS) {
    if (key in snap) api.items.set(settingsId, key, clone(snap[key]));
  }
  for (const [key, nameKey, frameKey] of PICTURES) {
    if (!(key in snap)) continue;
    api.items.set(settingsId, key, snap[key] || "");
    api.items.set(settingsId, nameKey, snap[nameKey] || "");
    if (frameKey && typeof snap[frameKey] === "number") api.items.set(settingsId, frameKey, snap[frameKey]);
  }
  for (const key of RUN_DOCS) {
    if (key in snap && Array.isArray(snap[key])) api.items.set(settingsId, key, clone(snap[key]));
  }
  if (results) api.items.set(settingsId, "results", clone(results));
  return true;
}

// The run history: one list for every app, newest first. Kept by the
// History app (`workflow.history`), whose type settings say whether runs
// are kept and how many; each entry says which app it came from.
export const HISTORY_APP = "workflow.history";
export const DEFAULT_HISTORY_MAX = 500;

// The plugin surface's `core`, set when the plugin registers: what a function
// outside a body (no api in hand) needs of it.
let CORE = null;

// Read with the store when there is an api, and from the library's cache
// when there is not: a read-through value is read with no API (items:read
// lists every property that way, and a port is read the same way).
const historyEntries = (api) =>
  (api && api.store ? api.store.saved("workflow.historyentry") : CORE.store.saved("workflow.historyentry")) || [];

export const historyOf = (api, appType = "") =>
  historyEntries(api)
    .filter((one) => one.value && (!appType || one.value.app === appType))
    .sort((a, b) => String(b.value.at || "").localeCompare(String(a.value.at || "")));

// Past the limit, the oldest go -- of one app's runs when one is named,
// of all of them otherwise.
export async function pruneHistory(api, max, appType = "") {
  const keep = Math.max(0, Math.floor(Number(max) || 0));
  for (const old of historyOf(api, appType).slice(keep)) await api.store.remove(old.id);
}

// Keeps one run in the history -- the only place an entry is written. A run
// of an app and a prompt a writer made are the same to the list: when, which
// app, what went in, what came out, and how long it took. `value.app` is the
// item type, which is also what names it in the list. Needs `store:write`.
export async function keepRun(api, { app, label, at = new Date(), template = "", summary = "", output = "", run = null, results = [], seconds = null }) {
  const core = CORE;
  if (core.appSettingValue("historyEnabled") === false) return false;
  const max = Math.floor(Number(core.appSettingValue("historyMax")));
  if (!(max > 0)) return false;
  const when = at instanceof Date ? at : new Date(at);
  const pad = (n) => String(n).padStart(2, "0");
  const stamp = `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())} ${pad(when.getHours())}:${pad(when.getMinutes())}:${pad(when.getSeconds())}`;
  const taken = new Set(api.store.saved("workflow.historyentry").map((one) => one.name));
  const base = `${label || app} ${stamp}`;
  let name = base;
  for (let n = 2; taken.has(name); n += 1) name = `${base} (${n})`;
  await api.store.save({
    type: "workflow.historyentry",
    name,
    value: { app, at: when.toISOString(), template, summary, output, run, results, seconds },
  });
  await pruneHistory(api, max);
  return true;
}

// What a history entry is carried as: a run of one app, which only that
// app's run settings take (see the sink in settingsBody).
export const runKind = (appType) => `workflow.run:${appType}`;

// A picture as a data URL, whichever way it is held: kept pictures are an
// address (backend/blobs.py) and are fetched.
export async function asDataUrl(src) {
  if (!src || src.startsWith("data:")) return src || "";
  const blob = await (await fetch(src)).blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

// The run settings' picture box takes 4 MB; as base64, a third more.
export const KEEP_IMAGE_CHARS = Math.floor((4 * 1024 * 1024 * 4) / 3);

// A picture no bigger than it has to be. One that already fits is kept as
// it is; one that does not is drawn again smaller, as a JPEG, until it
// does -- softer is better than refused.
export async function fitImage(dataUrl, maxChars = KEEP_IMAGE_CHARS) {
  if (!dataUrl || dataUrl.length <= maxChars) return dataUrl || "";
  const img = new Image();
  img.src = dataUrl;
  try {
    await img.decode();
  } catch {
    return "";
  }
  for (const side of [1024, 768, 512, 384, 256]) {
    const scale = Math.min(1, side / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
    const out = canvas.toDataURL("image/jpeg", 0.82);
    if (out.length <= maxChars) return out;
  }
  return "";
}

export function registerRunner(fw, template, readiness) {
  const { core, describe, registerControl, registerItemType, registerValueType } = fw;
  CORE = core;
  const { NODES, t } = core;
  // The shell's own way of saying how big a file is. Not on the plugin
  // surface, and three lines rather than a reason to widen it.
  const formatBytes = (n) =>
    n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;

  // An image size: two numbers, width and height, in steps of 8. Derived
  // from vector rather than being one, because that is what gives it saved
  // values of its own -- a plain vector saved for a position is not a size,
  // and the preset button should not offer it as one. Grouped by shape, so
  // the chooser can narrow to the tall ones.
  registerValueType("workflow.image_size", {
    base: "vector",
    label: "workflow.vtype.imageSize",
    icon: "aspect-ratio",
    defaults: { axes: ["W", "H"], min: 64, max: 8192, step: 8, default: [1024, 1024] },
    sample: { default: [1024, 1024] },
    groups: {
      label: "workflow.field.orientation",
      of: (value) => {
        const [w, h] = Array.isArray(value) ? value.map(Number) : [0, 0];
        if (!w || !h) return "";
        return t(w === h ? "workflow.orientation.square" : w < h ? "workflow.orientation.portrait" : "workflow.orientation.landscape");
      },
    },
    format: (value) => (Array.isArray(value) ? `${value[0]} × ${value[1]}` : ""),
  });
  const { coerceTemplate, problemsOf, buildRun, blocksOf, blockLabel } = template;

  const idOf = (pair) => `${pair.node_id}::${pair.input_key}`;
  const isRecord = (value) => !!value && typeof value === "object" && !Array.isArray(value);
  const nodeCountOf = (tpl) => Object.keys((tpl.workflow && tpl.workflow.graph) || {}).length;
  // How one card in a window is being read, and the write that changes it.
  // Kept by key on the item, so the cards in one window are independent of
  // each other and a layout comes back the way it was left.
  const shownAs = (ctx, key) => (ctx.get("views") || []).find((one) => one.key === key) || {};
  const setShownAs = (ctx, key, patch) => {
    const rest = (ctx.get("views") || []).filter((one) => one.key !== key);
    ctx.set("views", [...rest, { ...shownAs(ctx, key), key, ...patch }]);
  };
  // The descriptor handed to the imagebox inside an image card. Not
  // compact: compact is already a thumbnail beside a small button, which is
  // the shrunk state and nothing else -- inside a card the picture is meant
  // to be looked at, and the header's toggle is what makes it small.
  const writes = (tool, kind) =>
    blocksOf(tool).some((block) => block.direction === "write" && kind(block.kind));
  const isImage = (kind) => kind === "value.image";
  const isVideo = (kind) => kind === "value.video";
  // A picture and the frame it goes at.
  const isKeyframe = (kind) => kind === "value.keyframe";
  const isPicture = (kind) => isImage(kind) || isKeyframe(kind);
  const isSize = (kind) => kind === "value.image_size";
  // A list of prompts is built from prompt parts; every other prompt is
  // one piece of text.
  const isParts = (kind) => kind === "value.prompt_list";
  const isText = (kind) => !isPicture(kind) && !isVideo(kind) && !isSize(kind) && !isParts(kind);

  // Slots as the prompt blocks read them: the part's tags as one piece of
  // text, with its weight. The template writes them out -- (text:1.2) --
  // the same way the prompt assembler does.
  //
  // Each slot goes through the slot type's own coercion first. A slot is
  // stored in more than one shape -- a template saved before slots held one
  // part holds a shortlist and an index instead -- and the prompt plugin
  // reads every shape through that coercion; reading `part` raw here meant
  // an older template assembled to nothing.
  const partsValue = (slots) => {
    const coerceSlot = (fw.valueTypes["prompt.slot"] || {}).coerce || ((value) => value);
    return (Array.isArray(slots) ? slots : []).map((raw) => {
      const one = coerceSlot(raw) || {};
      // Text is said as written and joined to the rest with a space rather
      // than a comma; a tag list is its tags. Either may carry a weight.
      const weight = Number(one.weight) > 0 ? Number(one.weight) : 1;
      if (one.kind === "text") return { text: String(one.text || "").trim(), weight, sentence: true };
      return { text: tagTexts(one.tags).join(", "), weight };
    });
  };

  // A setting's editor, built from the template's declaration of it. The
  // value lives in the item's `settings` list; an absent entry means the
  // template's default.
  function settingSpec(setting) {
    const fetched = setting.options_source ? choicesFor(setting.options_source) : null;
    const listed = setting.options && setting.options.length ? setting.options : fetched;
    if (listed && listed.length) {
      // The default stays choosable even when it is not installed, so a
      // template never silently changes what it asks for.
      const values = listed.includes(String(setting.default)) ? listed : [String(setting.default), ...listed];
      return { type: "enum", options: values.map((value) => ({ value, label: value })) };
    }
    if (setting.value_type === "boolean") return { type: "boolean" };
    if (setting.value_type === "integer") return { type: "number", step: 1 };
    if (setting.value_type === "number") return { type: "number", step: 0.05 };
    return { type: "string" };
  }

  const settingValues = (list) =>
    Object.fromEntries((Array.isArray(list) ? list : []).map((entry) => [entry.id, entry.value]));

  // What a finished ComfyUI job produced for one read block: the images
  // written by the node it names (or the node feeding it), else any text.
  // A video is one of the images: SaveWEBM and SaveVideo report their file
  // under `images` as well, and VideoHelperSuite's combine under `gifs`.
  // Kept as a reference like a picture -- what it is, a still or a moving
  // one, is the file's to say, and whatever draws it looks there.
  function collect(outputs, read) {
    const found = [];
    for (const nodeId of [read.node_id, read.source_node_id]) {
      const output = nodeId && outputs[nodeId];
      if (!output) continue;
      [...(output.images || []), ...(output.gifs || [])].forEach((ref) =>
        found.push({ key: read.key, kind: "image", ref: { filename: ref.filename, subfolder: ref.subfolder || "", type: ref.type || "output" } })
      );
      // A 3D file (SaveGLB and the like report theirs under `3d`): kept by
      // reference the way a picture is, and drawn by nothing here -- the
      // app that asked for one knows what it is for.
      (output["3d"] || []).forEach((ref) =>
        found.push({ key: read.key, kind: "mesh", ref: { filename: ref.filename, subfolder: ref.subfolder || "", type: ref.type || "output" } })
      );
      if (found.length) return found;
      for (const key of TEXT_KEYS) {
        const value = output[key];
        const text = Array.isArray(value) ? value.filter(Boolean).join(", ") : typeof value === "string" ? value : "";
        if (text) return [{ key: read.key, kind: "text", text }];
      }
    }
    return found;
  }

  // What a run made is copied to where Mullion keeps its own files as soon as
  // it is made: the pictures, videos and 3D files, which ComfyUI reports by
  // reference. From here on they are shown from the copy (`src`), put in the
  // history and carried to other windows by it, and none of that asks ComfyUI
  // for anything. When ComfyUI cannot hand one over, the reference stays and
  // is tried again where it is next shown (see healOutputs).
  async function keepOutputs(api, ctx, results) {
    const todo = results.filter((one) => (one.kind === "image" || one.kind === "mesh") && one.ref && !one.src);
    if (!todo.length) return;
    ctx.status(t("workflow.run.keeping"));
    await Promise.all(
      todo.map(async (one) => {
        try {
          const src = await api.comfy.keep(one.ref);
          if (src) one.src = src;
        } catch (error) {
          console.warn("[mullion] an output could not be kept:", error.message || error);
        }
      })
    );
  }

  // Outputs made before they were kept here (or while ComfyUI could not hand
  // them over) still point at ComfyUI. Where an app's results are drawn, they
  // are asked for again -- at most once a minute each, so a ComfyUI that is
  // not running costs a line in the network log and nothing else -- and the
  // copy, once there is one, takes the place of the reference.
  const HEALED = new Map();
  const HEAL_EVERY_MS = 60 * 1000;
  const unkept = (one) => one && (one.kind === "image" || one.kind === "mesh") && one.ref && !one.src;
  const healKey = (ref) => `${ref.type || "output"}/${ref.subfolder || ""}/${ref.filename}`;
  async function healOutputs(api, ctx, id) {
    if (JOBS.has(id)) return;
    const now = Date.now();
    const todo = (ctx.get("results") || []).filter(unkept).filter((one) => now - (HEALED.get(healKey(one.ref)) || 0) > HEAL_EVERY_MS);
    if (!todo.length) return;
    for (const one of todo) HEALED.set(healKey(one.ref), now);
    const kept = new Map();
    await Promise.all(
      todo.map(async (one) => {
        const src = await api.comfy.keep(one.ref).catch(() => null);
        if (src) kept.set(healKey(one.ref), src);
      })
    );
    if (!kept.size) return;
    // The results as they are now: the run may have made new ones meanwhile.
    ctx.set(
      "results",
      (ctx.get("results") || []).map((one) => (unkept(one) && kept.has(healKey(one.ref)) ? { ...one, src: kept.get(healKey(one.ref)) } : one))
    );
  }

  function errorOf(messages) {
    const failed = (messages || []).find((one) => Array.isArray(one) && one[0] === "execution_error");
    const detail = failed && failed[1];
    return detail
      ? `${detail.node_type || detail.node_id || ""}: ${detail.exception_message || ""}`.trim()
      : t("workflow.run.failed");
  }

  // Where a job has got, as one line for the status bar: what ComfyUI's
  // socket said (see backend/comfy_progress.py) -- the node running, its
  // steps, how many of the graph's nodes are done -- or its place in the
  // queue before it starts. Just the time when nothing is known.
  function progressLine(graph, progress, s) {
    if (!progress || (!progress.started && progress.ahead === undefined)) return t("workflow.run.waiting", { s });
    if (!progress.started) return t("workflow.run.queued", { n: progress.ahead, s });
    const total = Object.keys(graph).length;
    const done = new Set([...(progress.done || []), ...(progress.cached || [])].filter((id) => graph[id])).size;
    const node = progress.node && graph[progress.node];
    const name = node ? (node._meta && node._meta.title) || node.class_type : "";
    const steps = progress.max > 0 ? t("workflow.run.steps", { value: progress.value, max: progress.max, pct: Math.round((progress.value / progress.max) * 100) }) : "";
    return [t("workflow.run.waiting", { s }), [name, steps].filter(Boolean).join(" "), t("workflow.run.nodes", { done: Math.min(done, total), total })]
      .filter(Boolean)
      .join(" · ");
  }

  async function runComfy(api, ctx, job, tpl, graph, reads) {
    if (job.cancelled) return null;
    // The seed is a number the item keeps, so the picture that came out can
    // be asked for again. Re-rolling is a switch beside it: on, a new one
    // is drawn and written back before the run, so what is in the field is
    // always what was actually sent -- the old switch changed the seed
    // without ever saying to what.
    //
    // A seed the template pins or opens up as a setting is the template's,
    // and is left alone.
    const rolling = ctx.get("randomSeed");
    const seed = rolling ? Math.floor(Math.random() * 2 ** 32) : Math.floor(Number(ctx.get("seed")) || 0);
    if (rolling) ctx.set("seed", seed);
    const decided = new Set([...tpl.settings, ...tpl.fixed].map(idOf));
    for (const [nodeId, node] of Object.entries(graph)) {
      for (const key of SEED_KEYS) {
        if (typeof node.inputs[key] === "number" && !decided.has(`${nodeId}::${key}`)) {
          node.inputs[key] = seed;
        }
      }
    }
    job.promptId = null;
    const { prompt_id: promptId } = await api.comfy.queue(graph);
    job.promptId = promptId;
    if (job.cancelled) {
      await interruptRun(api, job);
      return null;
    }
    const started = Date.now();
    // ComfyUI can stop answering for a while in the middle of a job -- a
    // node busy in Python holds its server up (MoGe's panorama merge does,
    // for longer than the relay waits) -- so a poll that fails is asked
    // again, and only a run of them is taken for ComfyUI being gone.
    let unanswered = 0;
    while (!job.cancelled) {
      if (Date.now() - started > TIMEOUT_MS) throw new Error(t("workflow.run.timeout"));
      await sleep(POLL_MS);
      if (job.cancelled) return null;
      let history;
      try {
        history = await api.comfy.history(promptId);
        unanswered = 0;
      } catch (error) {
        unanswered += 1;
        if (unanswered >= POLL_RETRIES) throw error;
        ctx.progress(t("workflow.run.waiting", { s: Math.round((Date.now() - started) / 1000) }));
        continue;
      }
      if (job.cancelled) return null;
      if (!history.done) {
        ctx.progress(progressLine(graph, history.progress, Math.round((Date.now() - started) / 1000)));
        continue;
      }
      if (!history.ok) throw new Error(errorOf(history.messages));
      const outputs = history.outputs || {};
      const results = reads.flatMap((read) => collect(outputs, read));
      await keepOutputs(api, ctx, results);
      // Nothing where the read blocks point, but pictures somewhere else:
      // the template is reading the wrong node. ComfyUI reports only what
      // its output nodes -- PreviewImage, SaveImage -- made, so a read block
      // pointed at any other node finds nothing. Say which node did make
      // something, so the template can be pointed at it.
      if (!results.length) {
        const nodeName = (id) => `${(graph[id] && graph[id].class_type) || "?"} #${id}`;
        const made = Object.entries(outputs)
          .filter(([, output]) => [output.images, output.gifs].some((list) => Array.isArray(list) && list.length))
          .map(([id]) => nodeName(id));
        if (made.length) {
          job.hint = t("workflow.run.readElsewhere", {
            target: reads.map((read) => `${nodeName(read.node_id)} · ${read.input_key}`).join(", "),
            found: made.join(", "),
          });
        }
      }
      return results;
    }
    return null;
  }

  // `userPrompt`: the prompt written whole (an app's own text card for it),
  // sent as it is instead of the template's with the carried text put in.
  async function runOllama(api, tpl, graph, reads, categories = [], userPrompt = null) {
    const node = graph.ollama_generate;
    if (!node) throw new Error(t("workflow.run.notOllama"));
    const inputs = node.inputs;
    // Promptmanager's user prompt was a template: where it says {input},
    // the text a block wrote goes in, and the rest of it stays.
    const original = String(tpl.workflow.graph.ollama_generate.inputs.user_prompt ?? "");
    const wroteUserPrompt = blocksOf(tpl.tool).some(
      (block) =>
        block.direction === "write" &&
        Object.values(tpl.blocks[block.key]).some((pair) => pair.input_key === "user_prompt")
    );
    let prompt = String(inputs.user_prompt ?? "");
    if (wroteUserPrompt && original.includes("{input}")) prompt = original.split("{input}").join(prompt);
    if (typeof userPrompt === "string" && userPrompt.trim()) prompt = userPrompt;

    const image = typeof inputs.image === "string" && inputs.image.startsWith("data:") ? inputs.image : "";
    let format = inputs.schema;
    if (typeof format === "string" && format.trim()) {
      try {
        format = JSON.parse(format);
      } catch {
        // A bare "json" is a valid format too.
      }
    }
    const answer = await api.ollama.generate({
      model: inputs.model,
      system: inputs.system_prompt || "",
      prompt,
      images: image ? [image.slice(image.indexOf(",") + 1)] : [],
      format: format || undefined,
      options: {
        ...(typeof inputs.temperature === "number" ? { temperature: inputs.temperature } : {}),
        ...(typeof inputs.num_ctx === "number" ? { num_ctx: inputs.num_ctx } : {}),
      },
    });
    return reads.map((read) => {
      const block = blocksOf(tpl.tool).find((one) => one.key === read.key);
      if (block && block.kind === "value.prompt_candidates") {
        const groups = candidatesOf(answer.response || "", categories);
        // A model that answered with something other than the shape it was
        // given is worth seeing rather than swallowing.
        return groups
          ? { key: read.key, kind: "candidates", groups }
          : { key: read.key, kind: "text", text: answer.response || "" };
      }
      return { key: read.key, kind: "text", text: answer.response || "" };
    });
  }

  // An app that is its own run settings: its type says so (registerRunApp).
  // Its settings, results and controller are the app item's own; anything
  // that used to ask the app for its `editor` asks the app itself.
  const isRunApp = (type) => Boolean((fw.types[type] || {}).runApp);

  // The app a run settings item runs for: itself. (The workflow app's run
  // settings were a window of their own once, and went to the app that owned
  // them; every run settings item is its own app now.)
  const appEntryOf = (api, settings) => (settings && isRunApp(settings.type) ? api.items.get(settings.id) : null);

  // ---- what a chained step needs that its template cannot hold ---------
  // A workflow is a decision about a graph; which model to ask and which
  // categories to sort into are decisions about a run. So they are written
  // into the built graph on the way out rather than pinned in the template.
  //
  // The schema is the interesting one. Ollama will hold a model to a JSON
  // shape if it is given one, so instead of asking for prose and reading it
  // back hopefully, the categories chosen for this run become an `enum` and
  // what comes back is already sorted. `{categories}` in either prompt is
  // filled with the same list, because a model that is told the shape still
  // reads better for being told the words.
  const CATEGORY_SCHEMA = (names) => ({
    type: "object",
    properties: {
      groups: {
        type: "array",
        items: {
          type: "object",
          properties: {
            category: names.length ? { type: "string", enum: names } : { type: "string" },
            tags: { type: "array", items: { type: "string" } },
          },
          required: ["category", "tags"],
        },
      },
    },
    required: ["groups"],
  });

  const readsCandidates = (tpl) =>
    blocksOf(tpl.tool).some((block) => block.direction === "read" && block.kind === "value.prompt_candidates");

  // The list the model reads carries each category's description beside its
  // name: "pose" alone leaves the model to guess whether a hand on a hip is
  // a pose or a gesture, and one line saying what goes where settles it.
  // It is the list as it is held -- a list of descriptions, written out as
  // JSON (categories.js) -- so what the model reads is exactly what is
  // edited. The enum is the names alone -- they are what comes back.
  function prepareStep(step, built, ctx, categories) {
    const node = built.graph.ollama_generate;
    if (!node || !isRecord(node.inputs)) return;
    const model = String(ctx.get("ollamaModel") || "").trim();
    if (model) node.inputs.model = model;
    if (!readsCandidates(step)) return;
    node.inputs.schema = JSON.stringify(CATEGORY_SCHEMA(categories.map((one) => one.name)));
    for (const key of ["system_prompt", "user_prompt"]) {
      if (typeof node.inputs[key] === "string") node.inputs[key] = fillCategories(node.inputs[key], categories);
    }
  }

  // ---- categories: a list of descriptions -------------------------------
  // A category is a description (the shell's value type): a name and what
  // belongs under it. The name is what the model files tags under and what a
  // kept part is filed as; the description is what tells the model which tags
  // those are (see categories.js for how a list is read).
  // The categories a run settings item sorts into: its own list. One reader,
  // because the settings, the preview and the run all ask.
  const categoriesOfSettings = (_api, settings) => {
    const held = settings && (settings.properties.find((one) => one.key === "categoryEditor") || {}).value;
    return usableCategories(held);
  };

  // What a sorted answer looks like once it is a result: one group per
  // category that was asked for, in the order they were asked for, whether
  // or not the model put anything in it -- an empty card is the answer to
  // "is there anything of this in the picture", and leaving it out would
  // make that question unanswerable.
  function candidatesOf(text, categories) {
    const names = categories.map((one) => one.name);
    let parsed = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      return null;
    }
    const given = Array.isArray(parsed && parsed.groups) ? parsed.groups : [];
    const found = new Map();
    for (const group of given) {
      if (!isRecord(group)) continue;
      const name = String(group.category ?? "").trim();
      const tags = (Array.isArray(group.tags) ? group.tags : []).map((one) => String(one).trim()).filter(Boolean);
      if (!found.has(name)) found.set(name, []);
      found.get(name).push(...tags);
    }
    const groups = names.map((name) => ({ category: name, tags: found.get(name) || [] }));
    // Anything the model invented a category for is kept rather than
    // dropped: it is still a tag that was in the picture, and losing it
    // silently would be worse than one card nobody asked for.
    for (const [name, tags] of found) {
      if (!names.includes(name) && tags.length) groups.push({ category: name, tags });
    }
    return groups;
  }

  // ---- two runners, one body ------------------------------------------
  // The same run in two places. `workflow.runner` stands alone: it holds a
  // template, can be pointed at another one, and draws the prompt parts
  // inline. An app of the run kit (RUN_KIT) is its own run settings: the
  // template is its type's, so there is nothing to switch, and the prompt
  // parts are a window of their own with a preview here. Everything else -- the inputs
  // the tool takes, the settings the template opened up, running,
  // cancelling -- is this one body, handed what differs.

  // The inputs and results both hold, in one place so the two stay alike.
  const RUN_PROPS = {
    text: {
      label: "workflow.prop.text",
      type: "string",
      control: "textarea",
      default: "",
      placed: true,
    },
    // The prompt as plain text, for an app that says `promptText: true`:
    // no parts and no slot editor owned for them, only a text card. The
    // detailed work is done in the prompt editor (or anywhere else that
    // makes text), and what lands here is linked to it or pasted from it --
    // by the card's grip, see ports in core.js.
    promptText: {
      label: "workflow.prop.promptText",
      type: "string",
      control: "texteditor",
      placeholder: "workflow.placeholder.promptText",
      default: "",
      placed: true,
    },
    negativeText: {
      label: "workflow.prop.negativeText",
      type: "string",
      control: "texteditor",
      placeholder: "workflow.placeholder.negativeText",
      default: "",
      placed: true,
    },
    // Where the picture came from. A data URL carries its bytes and nothing
    // else, so the name is kept beside it -- which is what lets the card say
    // which file is in it after the layout has been opened again.
    imageName: {
      label: "workflow.prop.imageName",
      type: "string",
      default: "",
      placed: true,
    },
    image: {
      label: "workflow.prop.image",
      type: "image",
      control: "imagebox",
      // Larger than the default, because a picture to remove the
      // background from is rarely a thumbnail. It is still kept in the
      // layout, so not without limit.
      maxBytes: 4 * 1024 * 1024,
      default: "",
      placed: true,
    },
    // A tool's second picture -- the last frame of a video, say. Its label
    // is only for the property table; where it is drawn, it is named after
    // its block like the first.
    image2Name: {
      label: "workflow.prop.image2Name",
      type: "string",
      default: "",
      placed: true,
    },
    image2: {
      label: "workflow.prop.image2",
      type: "image",
      control: "imagebox",
      maxBytes: 4 * 1024 * 1024,
      default: "",
      placed: true,
    },
    // Keyframes: a picture, and the frame it goes at, counted from 0.
    image3Name: { label: "workflow.prop.image3Name", type: "string", default: "", placed: true },
    image3: {
      label: "workflow.prop.image3",
      type: "image",
      control: "imagebox",
      maxBytes: 4 * 1024 * 1024,
      default: "",
      placed: true,
    },
    frame3: { label: "workflow.prop.frame3", type: "number", min: 0, step: 1, default: 12, placed: true },
    image4Name: { label: "workflow.prop.image4Name", type: "string", default: "", placed: true },
    image4: {
      label: "workflow.prop.image4",
      type: "image",
      control: "imagebox",
      maxBytes: 4 * 1024 * 1024,
      default: "",
      placed: true,
    },
    frame4: { label: "workflow.prop.frame4", type: "number", min: 0, step: 1, default: 24, placed: true },
    image5Name: { label: "workflow.prop.image5Name", type: "string", default: "", placed: true },
    image5: {
      label: "workflow.prop.image5",
      type: "image",
      control: "imagebox",
      maxBytes: 4 * 1024 * 1024,
      default: "",
      placed: true,
    },
    frame5: { label: "workflow.prop.frame5", type: "number", min: 0, step: 1, default: 36, placed: true },
    // Pictures six to fourteen: references, which have no frame.
    ...Object.fromEntries(
      [6, 7, 8, 9, 10, 11, 12, 13, 14].flatMap((n) => [
        [`image${n}Name`, { label: `workflow.prop.image${n}Name`, type: "string", default: "", placed: true }],
        [
          `image${n}`,
          { label: `workflow.prop.image${n}`, type: "image", control: "imagebox", maxBytes: 4 * 1024 * 1024, default: "", placed: true },
        ],
      ])
    ),
    // Loaded from and saved to the library like any preset -- the sizes
    // a model was trained at are a short list worth keeping by name.
    size: {
      label: "workflow.prop.size",
      type: "workflow.image_size",
      control: "preset",
      inner: "vector",
      default: [1024, 1024],
      placed: true,
    },
    // The number that was sent, and whether to draw a new one next time.
    // Two properties: the number is a number, the dice is a plain on/off
    // property of its own (a generic toggle, labelled ランダムシード).
    seed: {
      label: "workflow.prop.seed",
      type: "number",
      min: 0,
      step: 1,
      default: 0,
      placed: true,
    },
    randomSeed: {
      label: "workflow.prop.randomSeed",
      type: "boolean",
      default: true,
      placed: true,
    },
    // How each card in this window is being read: a prompt as the text it
    // adds up to or as the parts it is made of, and anything at its full
    // size or shrunk. Per card, not per window -- the prompt being written
    // is worth the room and the negative one usually is not, and a switch
    // that moved both meant never being able to say so. {key, view, full}
    // for each card that has been changed from the default.
    views: {
      label: "workflow.prop.views",
      type: "data",
      default: [],
      placed: true,
    },
    // {id: "node::input", value} for each setting that differs from the
    // template's default. Drawn from the template, so no control here.
    settings: { label: "workflow.prop.settings", type: "data", default: [], placed: true },
    // The model a sorting step asks. The run's rather than the workflow's:
    // which model can answer depends on what is installed here. Empty is
    // "the one the workflow names", which the row shows as that name --
    // there is no separate "default" to choose, the default is a model.
    // (The categories it sorts into are a document of their own, in the
    // editor the run settings own.)
    ollamaModel: {
      label: "workflow.prop.ollamaModel",
      type: "string",
      default: "",
      placed: true,
    },
    // What the last run produced: {key, kind: "image", ref},
    // {key, kind: "text", text} or {key, kind: "candidates", groups}.
    results: { label: "workflow.prop.results", type: "data", default: [], placed: true },
  };

  // The prompt parts as one line of text, exactly as the run will send
  // them -- (tags:weight) where the weight is not 1, joined with commas, a
  // sentence joined with a space. The template's formatPrompt writes the
  // same line; the two are kept alike.
  const partsLine = (parts) => {
    let out = "";
    let last = null;
    for (const one of parts) {
      if (!one.text) continue;
      if (last) out += one.sentence || last.sentence ? " " : ", ";
      out += one.weight !== 1 ? `(${one.text}:${one.weight})` : one.text;
      last = one;
    }
    return out;
  };
  const partsText = (slots) => partsLine(partsValue(slots));
  // What went into a run, in a line: the prompt it adds up to, or the text,
  // or the picture's name. A history entry and a run preset both carry it.
  const runSummary = (run) =>
    partsText(run.parts) || String(run.promptText || "").trim() || String(run.text || "").trim() || run.imageName || "";

  // A text prompt as the slots the run reads: one sentence, said as it is
  // written -- no weight put round it, so (tag:1.2) typed into it is sent
  // as typed.
  const textPropOf = (key) => (key === "negative_prompts" ? "negativeText" : "promptText");
  const textSlots = (text) =>
    String(text || "").trim() ? [{ kind: "sentence", categories: [], part: { name: "", text: String(text) } }] : [];

  // `cfg` is what differs between the two:
  //   template()      the template to run
  //   chain()         templates to run after it, fed what it read back
  //   parts(key)      one prompt block's parts, as slots
  //   head            nodes above the inputs (the template chooser)
  //   promptInput(key)  nodes for one prompt block's parts
  //   actions         whether run and check are drawn here
  //   details         whether the template's settings are drawn
  //   detailsToggle   the node that switches that, if there is one
  //   categories()    what a sorting step sorts into, as {label, description}
  //   categoryInput() nodes for those categories, under the detailed settings
  //   onFinished(results)  told when a run has finished with an answer
  //   prepare({width, height, report})  what the app makes for a run itself,
  //                   as {images: {blockKey: dataUrl}, parts: {blockKey: [{text, weight}]}}
  //   imageInput()    nodes for a picture the app makes, in place of the box
  function runnerBody(api, item, ctx, cfg) {
    const tpl = coerceTemplate(cfg.template());
    const job = JOBS.get(item.id);
    const platform = tpl.workflow.platform;
    const categories = cfg.categories ? cfg.categories() : [];
    const sorts = Boolean(cfg.chain && cfg.chain().some((one) => readsCandidates(coerceTemplate(one))));
    // What stands in the way of running: the template's own problems, and
    // what the server it runs on does not have. A missing node is not
    // something this window can put right, so it stops the run the same way
    // an unassigned block does -- see readiness.js for why a missing model
    // does not.
    const steps = [cfg.template(), ...(cfg.chain ? cfg.chain() : [])];
    // Sorting into nothing is not a run worth sending: the schema would
    // leave the model free to invent names, and the cards would be empty.
    const problems = [
      ...readiness.blockersOf(api, steps, ctx.get("settings"), () => ctx.refreshAll()),
      ...(sorts && !categories.length ? [t("workflow.run.noCategories")] : []),
    ];

    async function execute(report = ctx.status, signal) {
      if (JOBS.has(item.id) || signal?.aborted) return;
      const current = coerceTemplate(cfg.template());
      const blocking = readiness.blockersOf(
        api,
        [cfg.template(), ...(cfg.chain ? cfg.chain() : [])],
        ctx.get("settings"),
        () => ctx.refreshAll()
      );
      if (blocking.length) return report(blocking[0]);
      const sortInto = cfg.categories ? cfg.categories() : [];
      if (sorts && !sortInto.length) return report(t("workflow.run.noCategories"));
      const running = { cancelled: false, promptId: null };
      // What the run says as it goes: in the state row of the program it works with. A chained step runs on its own
      // program (the tagger on ComfyUI, the sorting on Ollama), so it says which.
      const programOf = (one) => (one === "ollama" ? "ollama" : "comfyui");
      const say = (message, on = platform) => ctx.progress(message, programOf(on));
      // From the press to the answer, kept with the run in the history.
      const startedAt = Date.now();
      const abort = () => interruptRun(api, running);
      signal?.addEventListener("abort", abort, { once: true });
      JOBS.set(item.id, running);
      try {
        // Everywhere, not just here: the preview says a run is on, too.
        ctx.refreshAll();
        const onComfy = current.workflow.platform === "comfyui";
        // What the app makes for the run itself rather than asking for: a
        // picture it draws (the 3D pose app's depth pass), parts it adds to
        // a prompt. Made now, at the size the run is at, so what is sent is
        // what is set up at the moment of pressing run.
        const [width, height] = ctx.get("size") || [1024, 1024];
        const supplied = cfg.prepare ? (await cfg.prepare({ width, height, report: say })) || {} : {};
        if (running.cancelled) return;
        const blockValues = {};
        // Optional pictures left empty, whose nodes are taken out below.
        const unfilled = [];
        let pictureAt = 0;
        for (const block of blocksOf(current.tool)) {
          if (block.direction !== "write") continue;
          if (isPicture(block.kind)) {
            // What the app draws comes first, then whatever was put in
            // the box.
            const slot = PICTURES[pictureAt++] || [];
            // A keyframe's frame is its own node's business; only the
            // picture's nodes come out when there is no picture.
            const pictureOf = (assignment) => (isKeyframe(block.kind) ? { image: assignment.image } : assignment);
            const picture =
              (supplied.images || {})[block.key] ||
              (slot[0] ? ctx.get(slot[0]) : "");
            if (!picture && block.optional) {
              unfilled.push(pictureOf(current.blocks[block.key]));
              continue;
            }
            if (!picture) throw new Error(t("workflow.run.noImage"));
            say(onComfy ? t("workflow.run.uploading") : t("workflow.run.sending"));
            // ComfyUI's upload takes a kept picture by its address; Ollama
            // is sent the bytes, so a kept one is fetched first.
            const sent = onComfy ? (await api.comfy.upload(picture)).name : await asDataUrl(picture);
            if (running.cancelled) return;
            blockValues[block.key] = isKeyframe(block.kind)
              ? { image: sent, frame: Math.max(0, Math.floor(Number(ctx.get(slot[2])) || 0)) }
              : sent;
          } else if (isSize(block.kind)) {
            blockValues[block.key] = { width, height };
          } else if (isParts(block.kind)) {
            blockValues[block.key] = [
              ...partsValue(cfg.parts(block.key)),
              ...((supplied.parts || {})[block.key] || []),
            ];
          } else {
            blockValues[block.key] = ctx.get("text");
          }
        }
        const { graph, reads } = buildRun(current, blockValues, settingValues(ctx.get("settings")));
        for (const assignment of unfilled) unwire(graph, assignment);
        say(t("workflow.run.sending"));
        const comfyCtx = {
          get: (key) => ctx.get(key),
          set: (key, value) => ctx.set(key, value),
          status: report,
          progress: (message) => ctx.progress(message),
        };
        let results = onComfy
          ? await runComfy(api, comfyCtx, running, current, graph, reads)
          : await runOllama(api, current, graph, reads);
        if (running.cancelled || results === null) {
          report(t("workflow.run.cancelled"));
          return;
        }

        // ---- and then the next one --------------------------------------
        // A chained template is fed what the one before it read back: the
        // tagger writes words and the model that sorts them takes words, so
        // the join is the block kinds and nothing else. Promptmanager ran
        // these as two separate presses; there is no reason for the second
        // one to exist as a thing you have to remember to do.
        //
        // Only what the last step read is kept. The tags on their own are
        // not an answer -- they are the question the next step is asked --
        // and keeping both left two outputs where the person wanted one.
        for (const next of cfg.chain ? cfg.chain() : []) {
          const step = coerceTemplate(next);
          if (!step.tool || !nodeCountOf(step)) continue;
          const carried = results.find((one) => one.kind === "text");
          const stepValues = {};
          for (const block of blocksOf(step.tool)) {
            if (block.direction !== "write") continue;
            stepValues[block.key] = carried ? carried.text : "";
          }
          const built = buildRun(step, stepValues, settingValues(ctx.get("settings")));
          // The words the step before read, as tags the app holds (`stepTags`)
          // -- what a text composed for this step takes them from -- and the
          // prompt the app has written for it (`sortPrompt`, typed or linked
          // to a composed text), with `{input}` standing for the same words.
          const owns = fw.types[item.type].properties || {};
          const said = carried ? carried.text : "";
          if (owns.stepTags) ctx.set("stepTags", tagEntries(said.split(/,|\n/)));
          // `{notes}`: what the app says the words mean (its `tagNotes`), where it has something to say.
          const notes = owns.tagNotes ? String(ctx.get("tagNotes") ?? "") : "";
          const writtenPrompt = owns.sortPrompt
            ? fillCategories(String(ctx.get("sortPrompt") ?? "").split("{input}").join(said).split("{notes}").join(notes), sortInto)
            : "";
          // What this step needs that the template cannot hold: the model
          // to ask, and the categories to sort into -- both are chosen per
          // run, not baked into a workflow.
          prepareStep(step, built, ctx, sortInto);
          // The step before is done: its program stops saying anything, and this one's begins.
          say("", running.on || platform);
          running.on = step.workflow.platform;
          say(t("workflow.run.sorting"), running.on);
          const stepResults =
            step.workflow.platform === "comfyui"
              ? await runComfy(api, comfyCtx, running, step, built.graph, built.reads)
              : await runOllama(api, step, built.graph, built.reads, sortInto, writtenPrompt);
          if (running.cancelled || stepResults === null) {
            report(t("workflow.run.cancelled"));
            return;
          }
          results = stepResults;
        }

        ctx.set("results", results);
        report(results.length ? t("workflow.run.done") : running.hint || t("workflow.run.noResults"));
        // Kept after it is shown rather than before: the answer is what was
        // waited for, and the history is a record of it, not a step of it.
        if (results.length && cfg.onFinished) {
          try {
            await cfg.onFinished(results, current, { seconds: (Date.now() - startedAt) / 1000 });
          } catch (error) {
            report(t("workflow.status.historyFailed", { error: error.message || error }));
          }
        }
      } catch (error) {
        if (!running.cancelled) {
          const message = t("workflow.status.failed", { error: error.message || error });
          if (signal) throw new Error(message);
          report(message);
        }
      } finally {
        signal?.removeEventListener("abort", abort);
        if (JOBS.get(item.id) === running) JOBS.delete(item.id);
        // Every program the run spoke on, not only the first one's.
        say("", platform);
        if (running.on) say("", running.on);
        ctx.refreshAll();
      }
    }

    async function cancel(report = ctx.status) {
      const running = JOBS.get(item.id);
      if (!running || running.cancelled) return;
      if (engineAction) await api.items.cancelAction(item.id, "run");
      else await interruptRun(api, running);
      report(t("workflow.run.cancelling"));
    }

    async function check(report = ctx.status) {
      const target = platform === "ollama" ? api.ollama : api.comfy;
      try {
        const info = await target.status();
        report(
          platform === "ollama"
            ? t("workflow.run.ollamaOk", { url: info.url, n: info.models.length })
            : t("workflow.run.comfyOk", { url: info.url, version: info.version || "?" })
        );
      } catch (error) {
        report(t("workflow.status.failed", { error: error.message || error }));
      }
    }

    // Closing an output: the results were this runner's, so they are
    // taken away here, whoever asked.
    const clear = () => ctx.set("results", []);
    const engineAction = Boolean(fw.types[item.type]?.actions?.run?.connected && api.items?.runAction && api.items?.cancelAction);
    const run = engineAction ? (report = ctx.status) => api.items.runAction(item.id, "run", report) : execute;

    CONTROLLERS.set(item.id, {
      ...(engineAction ? { [EXECUTE]: execute } : {}),
      run,
      cancel,
      check,
      clear,
      setResults: (next) => ctx.set("results", next),
      problem: problems[0] || "",
    });

    // The buttons, for whichever window draws them.
    const runActions = [
      job
        ? { key: "cancel", label: t("workflow.action.cancel"), run: () => cancel() }
        : {
            key: "run",
            label: runLabelOf(item.type),
            title: problems[0] || t("workflow.action.runTitle"),
            run: () => run(),
          },
      { key: "check", label: t("workflow.action.check"), title: t("workflow.action.checkTitle"), run: () => check() },
    ];

    // One of this item's own properties as a labelled row, for a table
    // that is not the item's whole property table. Reads and writes go
    // through ctx, so it is the same property wherever it is drawn.
    const own = (key) => {
      const spec = fw.types[item.type].properties[key];
      return describe(
        { ...spec, read: () => ctx.get(key), write: (_api, value) => ctx.set(key, value) },
        { api, key: `${item.id}-${key}`, label: t(spec.label) }
      );
    };

    // One picture box, bound to the slot it fills.
    const pictureSection = ([key, nameKey], title, after = []) =>
      NODES.section(key, title, [
        NODES.control(key, key, {
          control: "imagecard",
          // Unset until toggled: the control's default (small) applies.
          full: shownAs(ctx, key).full,
          onFull: (value) => setShownAs(ctx, key, { full: value }),
          name: ctx.get(nameKey),
          onName: (value) => ctx.set(nameKey, value),
          onPresets: (anchor) => core.openValuePicker(own(key), anchor),
          presetsTitle: t("mu.action.presets", { type: t("mu.vtype.image") }),
        }),
        ...after,
      ]);

    // ---- inputs: only what the tool writes ----
    // Each under the name of the block it fills, the way a property row
    // has its label -- a prompt, a picture and a size are three things, and
    // one heading over all of them said none of them.
    const inputs = [];
    // Inputs drawn under the detailed settings' switch instead.
    const detailInputs = [];
    const blockName = (kind) => {
      const block = blocksOf(tpl.tool).find((one) => one.direction === "write" && kind(one.kind));
      return block ? blockLabel(block.key) : "";
    };
    // A tool may write more than one prompt list -- what to draw and what
    // not to -- so each gets a section of its own, named after its block.
    for (const block of blocksOf(tpl.tool)) {
      if (block.direction !== "write" || !isParts(block.kind)) continue;
      // An optional prompt the workflow has nowhere to put -- MiniMax H3
      // has no negative prompt -- is not asked for.
      if (block.optional && !Object.keys(tpl.blocks[block.key] || {}).length) continue;
      const title = block.key === "prompts" ? cfg.partsTitle || blockLabel(block.key) : blockLabel(block.key);
      // What not to draw is seldom touched -- and on a distilled model run
      // at CFG 1 it does nothing at all -- so it waits in the detailed
      // settings rather than standing beside the prompt.
      (block.key === "negative_prompts" ? detailInputs : inputs).push(
        NODES.section(`parts-${block.key}`, title, cfg.promptInput(block.key))
      );
    }
    if (writes(tpl.tool, isText)) {
      inputs.push(NODES.section("text", blockName(isText), [NODES.control("text", "text")]));
    }
    // A picture the app draws itself is shown as the app wants it shown --
    // what it is made from, and the way to where it is made -- instead of
    // a box to drop a file on that would be ignored.
    if (writes(tpl.tool, isImage) && cfg.imageInput) {
      inputs.push(NODES.section("image", blockName(isImage), cfg.imageInput()));
    } else if (writes(tpl.tool, isImage)) {
      // An optional first picture says so, as every further one does.
      const first = blocksOf(tpl.tool).find((block) => block.direction === "write" && isImage(block.kind));
      const name = blockName(isImage);
      inputs.push(pictureSection(PICTURES[0], first && first.optional ? t("workflow.value.optional", { name }) : name));
    }
    // Every further picture, when the tool takes more: a box of its own
    // each. An optional one says so, since leaving it empty is a choice. A
    // keyframe has the frame it goes at under it, and the next keyframe's
    // box is only offered once this one has a picture -- three empty boxes
    // in a row would say nothing the first one does not.
    //
    // An optional picture this template leaves unassigned is not offered:
    // the tool takes it, but this engine's workflow has nowhere to put it
    // (MiniMax H3's references, on its frames checkpoint).
    const assigned = (block) => Object.values(tpl.blocks[block.key] || {}).some(Boolean);
    let offered = true;
    blocksOf(tpl.tool)
      .filter((block) => block.direction === "write" && isPicture(block.kind))
      .slice(1, PICTURES.length)
      .forEach((block, index) => {
        if (block.optional && !assigned(block)) return;
        const slot = PICTURES[index + 1];
        if (isKeyframe(block.kind)) {
          if (!offered && !ctx.get(slot[0])) return;
          offered = Boolean(ctx.get(slot[0]));
        }
        // A reference that `follows` waits for the picture before it.
        if (block.follows && !ctx.get(PICTURES[index][0]) && !ctx.get(slot[0])) return;
        const name = blockLabel(block.key);
        const title = block.optional ? t("workflow.value.optional", { name }) : name;
        // A frame row only for a keyframe: slots 3-5 hold one, but a plain
        // picture put there (a reference) goes at no frame.
        const frame = slot[2] && isKeyframe(block.kind) ? [NODES.props(slot[2], [own(slot[2])])] : [];
        inputs.push(pictureSection(slot, title, frame));
      });
    if (writes(tpl.tool, isSize)) inputs.push(NODES.props("size", [own("size")]));
    // What a chained sorting step asks of this run rather than of its
    // workflow: its kind, which model, which categories, and the prompt the
    // model is sent. Changed per run, so they are not in the detailed
    // settings -- and they come right under the output, before the inputs:
    // the output is what they make.
    const sortNodes = [];
    const detailSort = [];
    if (sorts) {
      // The model the workflow names is the default, and it is one of the
      // choices under its own name rather than behind a "default" entry: a
      // choice that says which model it is beats one that says whose it is.
      // It stays choosable when it is not installed -- the dashboard warns
      // about that -- so the workflow never silently asks for another.
      const step = coerceTemplate(cfg.chain().find((one) => readsCandidates(coerceTemplate(one))));
      const node = (step.workflow.graph || {}).ollama_generate;
      const named = node && node.inputs && typeof node.inputs.model === "string" ? node.inputs.model : "";
      const installed = ollamaModelsFor(api, () => ctx.refreshAll());
      const chosen = String(ctx.get("ollamaModel") || "").trim() || named;
      const models = [...new Set([chosen, named, ...installed].filter(Boolean))];
      const model = describe(
        {
          type: "enum",
          options: models.map((one) => ({ value: one, label: one })),
          read: () => chosen,
          // The workflow's own model is stored as nothing, so an app whose
          // workflow later names another model follows it.
          write: (_api, value) => ctx.set("ollamaModel", value === named ? "" : String(value || "")),
        },
        { api, key: `${item.id}-ollamaModel-${models.length}`, label: t("workflow.prop.ollamaModel") }
      );
      // An app that has more than one way of sorting says which in `sortKind`.
      const owned = fw.types[item.type].properties || {};
      sortNodes.push(
        NODES.section("sorting", t("workflow.section.sorting"), [
          NODES.props("model", [...(owned.sortKind ? [own("sortKind")] : []), model]),
        ]),
      );
      // The categories are a card, named by a section of its own: a card is named outside its box, and a heading
      // that says "sorting" did not say it was the categories. Like the prompt below it, they are the app's default
      // and are changed seldom, so they wait under the detailed settings' switch too.
      if (cfg.categoryInput) detailSort.push(NODES.section("categories", t("workflow.prop.categories"), cfg.categoryInput()));
      // What the model is sent, and what it was sent as the words to sort,
      // are settled once and looked at when something went wrong: they wait
      // under the detailed settings' switch. The prompt is a text card that
      // takes a link or a paste (a composed text, say) -- the app's own
      // `sortPrompt` -- and what the tagger read, which it is made from, is
      // shown as it was: read only, the app's own `stepTags`.
      if (owned.sortPrompt) {
        detailSort.push(NODES.section("sortPrompt", t("workflow.prop.sortPrompt"), [NODES.control("sortPrompt", "sortPrompt")]));
      }
      if (owned.stepTags) {
        detailSort.push(NODES.section("stepTags", t("workflow.prop.stepTags"), [NODES.control("stepTags", "stepTags")]));
      }
    }

    const openedUp = [tpl, ...steps.slice(1).map((one) => coerceTemplate(one))].flatMap((step) =>
      step.settings.map((setting) => ({ setting, from: step.name }))
    );
    // Choices for settings that take them from ComfyUI, fetched once per
    // page; the row is a text field until they arrive. The cache is
    // readiness's, which is also asking about these inputs.
    if (platform === "comfyui") {
      wantChoices(
        api,
        openedUp.map(({ setting }) => setting.options_source).filter(Boolean),
        () => ctx.refresh()
      );
    }

    // ---- settings: one editor per setting any step opened up ----
    // Every template in the run, not only the first: a chained step's
    // settings are settings of this run too -- the wording of what the
    // model is asked is the clearest example -- and putting them anywhere
    // else would mean a second settings window for the second half of one
    // press. The values share one list because a setting is addressed by
    // node and input, and two workflows do not share node ids.
    const settingRows = openedUp.map(({ setting, from }) => {
      const id = idOf(setting);
      return describe(
        {
          ...settingSpec(setting),
          read: () => {
            const entry = (ctx.get("settings") || []).find((one) => one.id === id);
            return entry ? entry.value : setting.default;
          },
          write: (_api, value) => {
            const rest = (ctx.get("settings") || []).filter((one) => one.id !== id);
            ctx.set("settings", [...rest, { id, value }]);
          },
        },
        {
          api,
          // Keyed by template too: a different template's setting on the
          // same node input is a different thing to edit.
          key: `${item.id}-${from}-${id}-${settingSpec(setting).type}`,
          label: setting.label || setting.input_key,
        }
      );
    });
    // Grouped the way the template groups them, in the order the groups
    // first appear: a model, its LoRAs and the sampler are three things,
    // and a dozen rows in one table said so to nobody. Settings in no group
    // come first, untitled. The seed switch goes with the sampler when
    // there is one, and last otherwise.
    const byGroup = [];
    openedUp.forEach(({ setting }, index) => {
      const name = setting.group || "";
      let group = byGroup.find((one) => one.name === name);
      if (!group) byGroup.push((group = { name, rows: [] }));
      group.rows.push(settingRows[index]);
    });
    byGroup.sort((a, b) => (a.name ? 1 : 0) - (b.name ? 1 : 0));
    const detailRows = byGroup.map((group, index) =>
      group.name
        ? NODES.section(`group-${index}`, group.name, [NODES.props(`settings-${index}`, group.rows)])
        : NODES.props(`settings-${index}`, group.rows)
    );
    // The seed and the random-seed switch: two rows of one table, the switch
    // a property of its own. Last, under the template's own settings,
    // because unlike them they are not the template's.
    //
    // Only where there is a seed to set: a workflow with none -- a tagger,
    // say -- would otherwise show a field that changes nothing, and the one
    // thing a setting must not do is nothing.
    const decided = new Set([...tpl.settings, ...tpl.fixed].map(idOf));
    const hasSeed =
      platform === "comfyui" &&
      Object.entries(tpl.workflow.graph || {}).some(([nodeId, node]) =>
        SEED_KEYS.some((key) => typeof node.inputs[key] === "number" && !decided.has(`${nodeId}::${key}`))
      );
    if (hasSeed) {
      detailRows.push(NODES.props("seed-row", [own("randomSeed"), own("seed")]));
    }

    // ---- results ----
    const stored = ctx.get("results") || [];
    const results = outputNodes(api, {
      results: stored,
      tpl,
      size: ctx.get("size"),
      running: Boolean(job),
      fill: false,
      shown: (key) => shownAs(ctx, key),
      setShown: (key, patch) => setShownAs(ctx, key, patch),
      onSort: (index, groups) => {
        const next = (ctx.get("results") || []).map((one) => ({ ...one }));
        const at = next.filter((one) => one.kind === "candidates")[index];
        if (at) at.groups = groups;
        ctx.set("results", next);
      },
      sorts,
      categories,
    });

    return [
      ...cfg.head,
      // What the template itself is missing, said where it is put right.
      // The environment's half of it -- a node this ComfyUI does not have
      // -- is the app dashboard's to say, and saying it here too would be
      // the same sentence in two windows; a runner standing on its own has
      // no dashboard, so it says all of it.
      ...(() => {
        const shown = cfg.actions === false ? problemsOf(tpl) : problems;
        return shown.length && tpl.tool ? [NODES.section("problems", "", [NODES.card("problems" + "-content", "", [], [NODES.warning(shown.join(" / "), "problems")])])] : [];
      })(),
      // The inputs are what this window is, and each carries its own label
      // as a section of the body (sections are only the top level of one):
      // the buttons that belong to all of them have a heading row of their
      // own, untitled, above.
      ...(tpl.tool ? [...sortNodes, ...inputs] : []),
      // The switch that shows the settings has no heading of its own: it is
      // named for what it opens, so a title over it repeated the words
      // directly underneath them. What it shows follows as sections and rows
      // of the body.
      ...(cfg.detailsToggle || (cfg.details && (detailInputs.length || detailRows.length || detailSort.length))
        ? [
            ...(cfg.detailsToggle ? [NODES.section("settings", "", [cfg.detailsToggle(own)])] : []),
            ...(cfg.details ? [...detailInputs, ...detailSort, ...detailRows] : []),
          ]
        : []),
      ...(cfg.actions === false ? [] : [NODES.actions("run", runActions)]),
      ...(cfg.results === false
        ? []
        : [NODES.section("results", t("workflow.section.results", { n: stored.length }), results)]),
    ];
  }

  // ---- one shape for what a run takes in and gives back ----------------
  // A card with its header along the top: what to do with the thing on the
  // left, how to look at it on the right, and the thing itself underneath.
  // The picture going in, the prompt going in and the text coming back are
  // three different things to hold and one thing to read, so they are built
  // by the same helpers and wear the same class names.
  //
  // Two kinds of button, and they look like two kinds: an action is a plain
  // icon, a toggle is the shell's icon toggle -- the same control a boolean
  // gets anywhere else, so a pressed one reads as pressed here for the same
  // reason it does there.
  // A card: the shell's header (grip, label, what it follows, the buttons
  // given here, shrink -- see fw.card) over a body of this plugin's.
  const cardFrame = (head = {}) => {
    const parts = fw.card.buildHead("workflow-card", head);
    const el = document.createElement("div");
    el.className = "mu-card workflow-card";
    const body = Object.assign(document.createElement("div"), { className: "workflow-card-body" });
    el.append(parts.head, body);
    return { el, head: parts.head, body, parts };
  };
  // What the header says now: where the grip takes it from, its label, and
  // shrink (`onFull` is asked for the size the card should go to).
  const syncCard = (el, parts, p, { name = p.label, full, onFull }) =>
    fw.card.syncHead(el, parts, {
      port: p.port && typeof p.port === "object" ? p.port : null,
      name,
      size: {
        full,
        title: t(full ? "workflow.opt.shrink" : "workflow.opt.grow"),
        toggle: () => onFull && onFull(!full),
      },
    });
  // `badge` is a second, small icon in the corner: two buttons that are the
  // same thing pointing opposite ways -- taking a value out of the library
  // and putting one in -- are told apart by it rather than by their titles.
  // `primary` marks the one button on the bar worth finding without reading.
  const cardAction = (name, icon, { badge = "", primary = false, label = "" } = {}) => {
    const one = document.createElement("button");
    one.type = "button";
    one.className = `mu-icon-button workflow-card-${name}${primary ? " is-primary" : ""}`;
    one.append(Object.assign(document.createElement("i"), { className: `bi bi-${core.ICONS[icon] || icon}` }));
    // The primary one says what it does in words as well (see the pill in
    // mullion.css): its own label, or the card verb of its name.
    if (primary) {
      one.append(Object.assign(document.createElement("span"), { className: "mu-button-label", textContent: label || t(`workflow.card.${name}`) }));
    }
    if (badge) {
      one.append(
        Object.assign(document.createElement("i"), {
          className: `bi bi-${core.ICONS[badge] || badge} mu-icon-badge`,
        })
      );
    }
    return one;
  };
  // A toggle that really is one -- text or parts -- is the shell's icon toggle.
  const cardToggle = (name) => {
    const one = document.createElement("button");
    one.type = "button";
    one.className = `mu-item-button mu-icontoggle workflow-card-${name}`;
    one.append(Object.assign(document.createElement("i"), { className: "bi" }));
    return one;
  };

  // Set a toggle: which icon it wears, what it says, and whether it is on.
  const setToggle = (button, on, icon, title) => {
    const wanted = `bi bi-${core.ICONS[icon] || icon}`;
    if (button.firstElementChild.className !== wanted) button.firstElementChild.className = wanted;
    button.title = title;
    button.classList.toggle("is-active", on);
    button.setAttribute("aria-pressed", String(on));
  };

  const paintCardSize = (frame, body, shrunk) => {
    if (body.classList.contains("is-shrunk") === shrunk) return;
    core.animateCardResize(frame, () => body.classList.toggle("is-shrunk", shrunk));
  };

  // ---- the text coming back ---------------------------------------------
  // What a tool that writes words wrote, in the same card: a copy, the same
  // size toggle, and the way to put it away again. No presets and no edit --
  // it is an answer, not something being written.
  registerControl("workflow.textout", {
  // Draws as a card, and has no header to put a name in (see core unnamedCardsIn).
  cardName: () => "",
    why: "the text a tool wrote, as an output card: run again, copy, keep, clear; no editing",
    label: "workflow.control.textout",
    standalone: true,
    params: ["text", "empty", "full", "onFull", "onClear", "onRun", "runTitle", "running", "onKeep", "port"],
    sampleParams: { text: "1girl, solo, looking at viewer", full: true },
    render(desc) {
      // First, and on its own: running again is what is done with an output
      // more often than anything else, and a tool that writes only words
      // has no stage for the big button to sit in the middle of.
      const run = cardAction("run", "play-fill", { primary: true });
      const copy = cardAction("copy", "clipboard");
      copy.addEventListener("click", (event) => {
        event.stopPropagation();
        // No feedback beyond the icon: a copy that worked is its own
        // confirmation, and one that did not throws.
        if (clipboardWrite) clipboardWrite(el.__text || "");
      });
      const clear = cardAction("clear", "close");
      clear.classList.add("action-delete");
      // Keeping the answer, beside copying it: the same verb with the
      // library for a destination instead of the clipboard.
      const { el, body, parts } = cardFrame({ lead: [run], tools: [copy, cardAction("keep", "preset", { badge: "presetSave" }), clear] });
      el.__parts = { ...parts, run, copy, clear };
      body.classList.add("workflow-card-text");
      fw.controls["workflow.textout"].update(el, desc);
      return el;
    },
    update(el, desc) {
      const p = desc.params;
      const [head, body] = el.children;
      const { run, copy, clear } = el.__parts;
      const keep = head.querySelector(":scope > .workflow-card-keep");
      core.fitCardHead(head);
      const text = p.text || "";
      el.__text = text;
      run.hidden = !p.onRun;
      run.disabled = Boolean(p.running);
      run.title = p.runTitle || t("workflow.action.run");
      run.onclick = (event) => {
        event.stopPropagation();
        if (p.onRun) p.onRun();
      };
      copy.title = t("mu.action.copy");
      copy.disabled = !text;
      keep.hidden = !p.onKeep;
      keep.disabled = !text;
      keep.title = p.onKeep ? p.onKeep.title : "";
      keep.onclick = (event) => {
        event.stopPropagation();
        if (p.onKeep) p.onKeep.run();
      };
      clear.title = t("mu.action.clearOutput");
      clear.hidden = !p.onClear;
      clear.disabled = !text;
      clear.onclick = (event) => {
        event.stopPropagation();
        if (p.onClear) p.onClear();
      };
      const full = p.full !== false;
      syncCard(el, el.__parts, p, { name: "", full, onFull: p.onFull });
      paintCardSize(el, body, !full);
      body.classList.toggle("is-empty", !text);
      const said = text || p.empty || "";
      if (body.textContent !== said) body.textContent = said;
    },
  });

  // ---- the categories to sort into --------------------------------------
  // A list of descriptions (the shell's value type: a name and what it is). The
  // name is what tags are filed under, the description is what tells the model
  // which tags those are. The list is a document, the way a prompt template is
  // -- edited in a window of its own, read as a preview where the run is set
  // up, saved and loaded as a whole through the library (as a description
  // list, which any other list of descriptions shares).

  // A field's name over something that is not a property row -- a card.
  // Built out of the property table's own elements, a row with a label and
  // no value, so whatever the shell and the skin say a label looks like,
  // this looks like too; copying the rules would drift the first time a
  // skin changed them.
  registerControl("workflow.fieldlabel", {
    why: "a field's name over something that is not a property row; built from the property table's own elements so skins reach it",
    label: "workflow.control.fieldlabel",
    standalone: true,
    params: ["text"],
    sampleParams: { text: "Categories" },
    render(desc) {
      const el = document.createElement("dl");
      el.className = "mu-props workflow-field-label";
      const row = Object.assign(document.createElement("div"), { className: "mu-prop-row" });
      const dt = document.createElement("dt");
      dt.append(Object.assign(document.createElement("span"), { className: "mu-prop-label" }));
      row.append(dt);
      el.append(row);
      fw.controls["workflow.fieldlabel"].update(el, desc);
      return el;
    },
    update(el, desc) {
      const label = el.querySelector(".mu-prop-label");
      const text = desc.params.text || "";
      if (label.textContent !== text) label.textContent = text;
    },
  });

  // ---- tags, sorted -----------------------------------------------------
  // The answer of a sorting step, as the shell's own cards: a card that is the list -- the run, and once there is
  // an answer the way to put it away, and the grip that carries every tag -- and in it a card for each category:
  // its name and how many tags in the header, "keep these as a prompt part" among its buttons, and the tags as
  // badges. A badge is dragged from one category's card to another's: the model's answer is a first draft, and
  // moving "smiling" from appearance to pose should cost one drag rather than a retype.
  //
  // The categories are drawn whether or not there is an answer yet, from the run settings' list: the cards are
  // where the tags will go, and seeing them before the first run is how you know which categories you asked for. An
  // answer that came back fills them in, and anything the model filed under a name nobody asked for follows them.
  //
  // What comes back out is the groups, so a move is a write like any other -- the results are the runner's, and
  // the card asks it to change them (onChange) rather than keeping an edited copy of its own.
  function sortedCard(api, { groups, categories, empty, onChange, onRun, runLabel, runTitle, running, onClear, onKeep, port }) {
    const answered = new Map(groups.map((one) => [one.category, one.tags]));
    const asked = usableCategories(categories).map((one) => one.name);
    const all = asked.map((category) => ({ category, tags: answered.get(category) || [] }));
    for (const [category, tags] of answered) {
      if (!asked.includes(category) && tags.length) all.push({ category, tags });
    }
    const hasAnswer = groups.length > 0;
    const move = (index, from, to) => {
      if (!onChange || from === to) return;
      const next = all.map((group) => ({ category: group.category, tags: [...group.tags] }));
      const source = next.find((group) => group.category === from);
      const target = next.find((group) => group.category === to);
      if (!source || !target) return;
      const [tag] = source.tags.splice(index, 1);
      if (tag === undefined) return;
      target.tags.push(tag);
      onChange(next);
    };
    const cards = all.map((group) =>
      NODES.card(
        `group-${group.category}`,
        `${group.category} (${group.tags.length})`,
        [
          NODES.control(`tags-${group.category}`, {
            control: "badges",
            bare: true,
            moveKey: group.category,
            onMove: move,
            desc: describe(
              { type: "list", each: { type: "prompt.tag" }, readonly: true, read: () => tagEntries(group.tags) },
              { api, key: `sorted-${group.category}`, label: group.category }
            ),
          }),
        ],
        onKeep
          ? [
              {
                key: "keep",
                icon: "preset",
                badge: "presetSave",
                title: t("workflow.action.keepGroup", { name: group.category }),
                disabled: !group.tags.length,
                run: () => onKeep(group.category, group.tags),
              },
            ]
          : [],
        { icon: "tag", isListElement: true }
      )
    );
    // Empty, the run; with an answer, the way to put it away (the card's own delete) -- one or the other.
    const tools =
      !hasAnswer && onRun
        ? [{ key: "run", primary: true, icon: "play-fill", label: runLabel || t("workflow.action.run"), title: runTitle || "", disabled: Boolean(running), run: () => onRun() }]
        : [];
    return NODES.listCard("groups", cards, { tools: tools, list: true, port, empty, onDiscard: hasAnswer ? onClear : null });
  }

  // ---- what a prompt list looks like when it is not being edited -------
  // The assembled prompt in the same card: the way into the parts, the
  // presets for the whole template and a copy on one side; on the other the
  // two toggles, text or parts and full or shrunk. The parts view is not an
  // editor -- editing is the slot editor's, one button away -- it is the
  // same list seen as what it is rather than as one run-on line, which is
  // the only way to tell at a glance which part carries which weight.
  registerControl("workflow.promptpreview", {
  // Draws as a card, named by its label (see core unnamedCardsIn).
  cardName: (desc) => desc.params.label || "",
    why: "the assembled prompt as text or as one card per part, with the way into the slot editor",
    label: "workflow.control.promptpreview",
    standalone: true,
    params: ["label", "parts", "text", "empty", "view", "onView", "full", "onFull", "onEdit", "editTitle", "onPresets", "port"],
    sampleParams: {
      parts: [
        { text: "blue eyes", weight: 1 },
        { text: "smile", weight: 1.2 },
      ],
      text: "blue eyes, (smile:1.2)",
      view: "text",
      full: true,
    },
    render(desc) {
      const copy = cardAction("copy", "clipboard");
      const edit = cardAction("edit", "pencil-square", { primary: true });
      // Loading the whole prompt as a template: it was in the slot editor,
      // which is the one window where the list is already in front of you,
      // and is here instead, where the prompt is read.
      const presets = cardAction("presets", "preset");
      const view = cardToggle("view");
      const { el, body, parts } = cardFrame({ lead: [edit], tools: [presets, copy, view] });
      el.__parts = { ...parts, edit, presets, copy, view };
      copy.addEventListener("click", (event) => {
        event.stopPropagation();
        if (clipboardWrite) clipboardWrite(el.__text || "");
      });
      body.classList.add("workflow-card-text");
      fw.controls["workflow.promptpreview"].update(el, desc);
      return el;
    },
    update(el, desc) {
      const p = desc.params;
      const [head, body] = el.children;
      const { edit, presets, copy, view } = el.__parts;
      core.fitCardHead(head);
      const text = p.text || "";
      el.__text = text;

      edit.title = p.editTitle || t("workflow.action.editParts");
      edit.onclick = (event) => {
        event.stopPropagation();
        if (p.onEdit) p.onEdit();
      };
      presets.title = t("mu.action.presets", { type: t("prompt.vtype.template") });
      presets.hidden = !p.onPresets;
      presets.onclick = (event) => {
        event.stopPropagation();
        if (p.onPresets) p.onPresets(presets);
      };
      copy.title = t("mu.action.copy");
      copy.disabled = !text;

      // One icon for the two ways of reading it: pressed is "laid out as
      // parts", unpressed is the line of text it would otherwise be.
      const cards = p.view === "cards";
      setToggle(view, cards, "text-paragraph", t(cards ? "workflow.opt.promptText" : "workflow.opt.promptCards"));
      view.onclick = (event) => {
        event.stopPropagation();
        if (p.onView) p.onView(cards ? "text" : "cards");
      };
      const full = p.full !== false;
      syncCard(el, el.__parts, p, { full, onFull: p.onFull });

      const parts = (p.parts || []).filter((one) => one.text);
      body.classList.toggle("is-cards", cards && parts.length > 0);
      body.classList.toggle("is-empty", !text);
      paintCardSize(el, body, !full);
      if (!text) {
        body.textContent = p.empty || "";
        return;
      }
      if (!cards || !parts.length) {
        body.textContent = text;
        return;
      }
      // One card per part, its weight beside it where it is not 1 -- the
      // same rule the assembled text follows when it writes (tags:weight).
      body.textContent = "";
      for (const part of parts) {
        const card = document.createElement("div");
        card.className = "workflow-prompt-part";
        card.append(Object.assign(document.createElement("span"), { textContent: part.text }));
        if (part.weight !== 1) {
          card.append(
            Object.assign(document.createElement("span"), {
              className: "workflow-prompt-weight",
              textContent: String(part.weight),
            })
          );
        }
        body.append(card);
      }
    },
  });

  // ---- run settings: one app's runner -------------------------------------
  // The runner as an app of its own (see RUN_KIT): its template is fixed by
  // the app's type, so there is nothing here to switch. The prompt parts
  // are a window of their own -- the prompt plugin's slot editor, owned by
  // this -- and what is shown here is the prompt they add up to, with the
  // way to that editor.

  // ---- history --------------------------------------------------------
  // A finished run, kept in the library as a `workflow.historyentry`: when,
  // which app, what it was set to -- the picture included -- and what came
  // out. Whether runs are kept, and how many, is the History app's setting;
  // the oldest go once there are more than that, whichever app made them.
  async function recordRun(api, item, results, current, took) {
    const app = appEntryOf(api, item);
    if (!app) return;
    if (core.appSettingValue("historyEnabled") === false) return;
    const max = Math.floor(Number(core.appSettingValue("historyMax")));
    if (!(max > 0)) return;
    const run = snapshotOf(api, item.id, { withImage: true });
    if (!run) return;
    // Kept whole: the server writes pictures out as files by their content
    // (backend/blobs.py), so an entry costs the library an address, and the
    // same picture run ten times is one file.
    const at = new Date();
    // What came out is read off the results.
    const summary = runSummary(run);
    const output = results
      .map((one) =>
        one.kind === "text"
          ? one.text
          : one.kind === "candidates"
            ? (one.groups || []).flatMap((group) => group.tags || []).join(", ")
            : ""
      )
      .filter(Boolean)
      .join(" / ");
    await keepRun(api, {
      app: app.type,
      label: app.label,
      at,
      template: (current && current.name) || "",
      summary,
      output,
      run,
      results,
      seconds: took && Number.isFinite(took.seconds) ? Math.round(took.seconds * 10) / 10 : null,
    });
  }

  // A run settings' prompt as one line: its parts, or its text.
  const promptLineOf = (item, docKey, textKey) => {
    if (!item) return "";
    const held = item.props[docKey];
    const parts = partsValue(Array.isArray(held) ? held : []);
    return partsLine(parts) || String(item.props[textKey] || "");
  };

  // The run settings' properties: what a run is set to, the parts editors
  // it owns, and what the last run made. A function, so that an app that is
  // its own run settings (registerRunApp) takes a set of its own.
  function settingsProperties() {
    return {
      // The prompt's parts, as a list of the app's own: the editor beside it is a
      // window onto this list, not a place the app keeps it.
      parts: {
        label: "workflow.prop.parts",
        type: "list", each: { type: "prompt.slot" },
        default: [],
        placed: true,
      },
      // The negative prompt's parts, in an editor of their own. Two lists,
      // two windows: a slot editor is a document, and what to draw and what
      // not to draw are two documents.
      negativeParts: {
        label: "workflow.prop.negativeParts",
        type: "list", each: { type: "prompt.slot" },
        default: [],
        placed: true,
      },
      // The categories a sorting step sorts into, in an editor of their
      // own: a list of names each with a description is a document, and
      // the prompt parts already showed where a document goes -- a window
      // beside this one, previewed here.
      categoryEditor: {
        label: "workflow.prop.categoryEditor",
        type: "list", each: { type: "description" },
        default: [],
        placed: true,
      },
      // What each prompt card shows, as text: what its grip carries.
      promptLine: {
        label: "workflow.prop.promptLine",
        type: "string",
        readonly: true,
        placed: true,
        read: (_api, item) => promptLineOf(item, "parts", "promptText"),
      },
      negativeLine: {
        label: "workflow.prop.negativeLine",
        type: "string",
        readonly: true,
        placed: true,
        read: (_api, item) => promptLineOf(item, "negativeParts", "negativeText"),
      },
      // Whether the settings the template opened up are drawn. Off, the
      // window is the inputs and the run button: what is changed every run,
      // and nothing that is set once and left.
      showDetails: {
        label: "workflow.prop.showDetails",
        type: "boolean",
        default: false,
        placed: true,
      },
      ...RUN_PROPS,
      // What the last run made, for other windows to be handed by a grip --
      // the output preview at the top of these settings carries them.
      ...outputProps((item) => item.props.results || []),
      // How the output at the top is being looked at: full size or shrunk.
      views: {
        label: "workflow.prop.views",
        type: "data",
        default: [],
        placed: true,
      },
    };
  }

  RUN_KIT = {
    properties: () => ({
      ...settingsProperties(),
    }),
    permissions: ["store:read", "store:write", "comfy:run", "ollama:run", "window:write", "services:read", "services:write"],
    body: (api, item, ctx) => settingsBody(api, item, ctx),
  };

  function settingsBody(api, item, ctx) {
    const app = appEntryOf(api, item);
    healOutputs(api, ctx, item.id);
    // An app that is its own run settings has no dashboard: what the
    // dashboard said -- whether the server can run it, the run presets --
    // is said here.
    const own = isRunApp(item.type);
    const readFrom = (entry, key) => entry && (entry.properties.find((one) => one.key === key) || {}).value;
    // Which list holds which block's parts. Everything else about the two is
    // the same, so they are drawn by the same code.
    const propOf = (key) => (key === "negative_prompts" ? "negativeParts" : "parts");
    const slotsOf = (key) => ctx.get(propOf(key)) || [];
    // A window onto one of this app's own lists, to edit it: a screen of the
    // editor's kind whose list is this one (it shares it).
    const editList = (type, listKey, docKey) => () => api.window.openScreen(type, {}, { share: { [docKey]: listKey } });
    // The whole prompt as a saved template -- the button the slot editor used
    // to carry.
    const presetOf = (key) =>
      describe(
        {
          type: "list", each: { type: "prompt.slot" },
          control: "preset",
          inner: "none",
          read: () => slotsOf(key),
          write: (_api, value) => ctx.set(propOf(key), value),
        },
        { api, key: `${item.id}-preset-${key}`, label: t("prompt.vtype.template") }
      );

    // What the app makes for a run itself, declared on its type as
    // `supplies: {prepare, imageInput, onFinished}` -- the 3D pose app draws its depth
    // picture from its scene. Asked of the app rather than known here, the
    // same way its template is.
    const supplies = (app && (fw.types[app.type] || {}).supplies) || {};
    // A prompt that is text rather than parts: the app's type says so.
    const textMode = Boolean(app && (fw.types[app.type] || {}).promptText);
    // An app that has just moved to text (Anima did, 2026-10) still holds
    // its prompt as parts. Carried over into the text once, while the text
    // is empty -- after this redraw, not during it.
    if (textMode) {
      for (const block of ["prompts", "negative_prompts"]) {
        const textKey = textPropOf(block);
        const slots = slotsOf(block);
        if (String(ctx.get(textKey) || "").trim() || !slots.length) continue;
        const line = partsLine(partsValue(slots));
        // The parts are emptied as they are carried, so a text cleared on
        // purpose later is not filled from them again.
        queueMicrotask(() => {
          if (line) ctx.set(textKey, line);
          ctx.set(propOf(block), []);
        });
      }
    }

    // A run from the History app, dragged here: put back -- settings,
    // picture and output. Only this app's runs are offered a guide, so a
    // run of another app's template never lands in this one.
    const restore = (entry) => {
      // The seed it was run with, and re-rolling off: an entry is put
      // back so that it can be looked at or run again, and running it
      // again with a new seed would not be running it again.
      const run = { ...(entry.run || {}), randomSeed: false };
      applySnapshot(api, item.id, run, { results: entry.results || [] });
    };
    if (app && ctx.element) {
      core.attachSink(ctx.element, {
        accepts: [runKind(app.type)],
        icon: "arrow-counterclockwise",
        label: t("workflow.port.restore"),
        put: (value) => {
          if (!value || typeof value !== "object") return;
          restore(value);
          ctx.status(t("workflow.status.restored"));
        },
      });
    }

    // What the last run made, first: the run settings are where an app is
    // run, and what a run makes is shown where it was asked for. Its grip
    // hands the output on -- to the Preview app, for a window of its own.
    const self = api.items.get(item.id);
    const output = self
      ? [
          NODES.section(
            "output",
            "",
            previewNodes(api, ctx, self, {
              shown: (key) => shownAs(ctx, key),
              setShown: (key, patch) => setShownAs(ctx, key, patch),
              fill: false,
              keeperFor: item.id,
              port: { item: item.id },
            })
          ),
        ]
      : [];

    // Saved run settings: loaded into these, and made from them -- the
    // picker's first tile is "these, as they are now".
    const appLabel = app ? t((fw.types[app.type] || {}).label || app.type) : "";
    const runPresets = own
      ? describe(
          {
            type: "workflow.runpreset",
            control: "preset",
            inner: "none",
            read: () => null,
            // A history entry without when and how long: the app, the
            // template and what went in (`run`), and what it made. Kept
            // from the chooser's first card -- see the preset maker.
            presetValue: () => {
              const run = snapshotOf(api, item.id, { withImage: true });
              if (!run) return null;
              const template = readFrom(app, "template");
              return {
                app: item.type,
                template: (template && template.name) || "",
                summary: runSummary(run),
                run,
                results: clone(ctx.get("results") || []),
              };
            },
            write: (_api, value) => {
              if (!value || typeof value !== "object") return;
              if (value.app && value.app !== item.type) {
                ctx.status(t("workflow.status.otherApp"));
                return;
              }
              if (!value.run || typeof value.run !== "object") return;
              applySnapshot(api, item.id, value.run, { results: Array.isArray(value.results) ? value.results : [] });
            },
          },
          { api, key: `${item.id}-runpreset`, label: t("workflow.vtype.runpreset") }
        )
      : null;
    // The same loader from the window's title bar, which is where an app's
    // presets are one press away whatever is scrolled out of sight.
    core.setPresetOpener(
      item.id,
      runPresets ? (anchor) => core.openValuePicker(runPresets, anchor, { groups: [appLabel] }) : null
    );

    // Whether the server can run this, asked of every step: the template,
    // and what runs after it.
    const readinessNodes = () => {
      if (!own || !app) return [];
      // The questions, as a function: the detail of a row is a screen of its
      // own, which asks them again while this body is not drawn.
      const probe = (onLoad) => {
        const now = appEntryOf(api, item);
        const next = readFrom(now, "chain");
        const steps = [readFrom(now, "template"), ...(next && next.tool ? [next] : [])];
        return readiness.readinessOf(api, steps.length > 1 ? steps : steps[0], ctx.get("settings"), onLoad, {
          ollamaModel: ctx.get("ollamaModel"),
        });
      };
      // Pinned to the window's bar: whether the program is there, whatever
      // is being looked at -- one row for each server a step runs on.
      return [NODES.pinned("ready", serverRows(NODES, probe(() => ctx.refreshAll()), probe))];
    };

    return [...output, ...(own && app && fw.types[app.type].sections ? fw.types[app.type].sections(api, app, ctx) : []), ...runnerBody(api, item, ctx, {
      template: () => readFrom(app, "template"),
      // The output preview above shows what the run made.
      results: false,
      prepare: supplies.prepare ? (opts) => supplies.prepare(api, app, opts) : null,
      imageInput: supplies.imageInput ? () => supplies.imageInput(api, app, ctx) : null,
      // What the app wants run after its template, if anything. Read the
      // same way the template is, so an app that has one says so simply
      // by holding it.
      chain: () => {
        const next = readFrom(app, "chain");
        return next && next.tool ? [next] : [];
      },
      parts: textMode ? (key) => textSlots(ctx.get(textPropOf(key))) : slotsOf,
      categories: () => categoriesOfSettings(api, api.items.get(item.id)),
      // The app's own word on a finished run first (`supplies.onFinished`:
      // the Panorama Generator puts the panorama in its stage), then the
      // history's.
      onFinished: async (results, current, took) => {
        if (supplies.onFinished) {
          try {
            await supplies.onFinished(api, app, results);
          } catch (error) {
            console.error("[mullion] the app's word on a finished run failed:", error);
          }
        }
        return recordRun(api, item, results, current, took);
      },
      // The categories as the prompt is: a preview here, with the way to
      // the editor and the presets for a whole list in its header.
      // The categories as a list of the shell's own cards: a card for each description -- its name in the header, the
      // name and what belongs in it to edit inside, a cross to drop it -- in a card that is the list, with the way
      // to the saved lists among its buttons and the way to a new one under the cards.
      categoryInput: () => {
        const held = () => (ctx.get("categoryEditor") || []).map(coerceCategory);
        const put = (next) => ctx.set("categoryEditor", next);
        const edit = (index, patch) => put(held().map((one, i) => (i === index ? { ...one, ...patch } : one)));
        const presets = describe(
          {
            type: "list", each: { type: "description" },
            control: "preset",
            inner: "none",
            read: held,
            write: (_api, value) => put(value),
          },
          { api, key: `${item.id}-preset-categories`, label: t("workflow.vtype.categories") }
        );
        const cards = held().map((one, index) =>
          NODES.card(
            `category-${index}`,
            one.name,
            [
              NODES.props(`category-${index}-fields`, [
                describe(
                  { type: "string", read: () => one.name, write: (_api, value) => edit(index, { name: value }) },
                  { api, key: `${item.id}-category-${index}-name`, label: t("mu.placeholder.descriptionName") }
                ),
              ]),
              // What belongs in it: no label, the width of the card, and the guide where the words go.
              NODES.control(`category-${index}-text`, {
                desc: describe(
                  {
                    type: "string",
                    control: "textarea",
                    rows: 2,
                    placeholder: "mu.placeholder.descriptionText",
                    read: () => one.description,
                    write: (_api, value) => edit(index, { description: value }),
                  },
                  { api, key: `${item.id}-category-${index}-text`, label: t("mu.placeholder.descriptionText") }
                ),
              }),
            ],
            [],
            { icon: "tag", isListElement: true, onDiscard: () => put(held().filter((_, i) => i !== index)) }
          )
        );
        return [
          NODES.listCard("categories",
            cards, { tools: [{ key: "presets", icon: "preset", title: t("mu.action.presets", { type: t("workflow.vtype.categories") }), run: (anchor) => core.openValuePicker(presets, anchor) }], list: true,
              port: { item: item.id, key: "categoryEditor" },
              add: { label: t("workflow.action.addCategory"), run: () => put([...held(), { name: "", description: "" }]) } }),
        ];
      },
      head: app ? [] : [NODES.section("orphan", "", [NODES.card("orphan" + "-content", "", [], [NODES.warning(t("workflow.value.noApp"))])])],
      // What the parts add up to, and the three things wanted of it: the
      // way into the parts themselves, a copy of the text, and the choice
      // of reading it as that text or as the parts it is made of. They
      // are a header on the preview rather than buttons under it, because
      // they are all about the one thing below them.
      promptInput: (key) => {
        // A text card, whose grip carries it and takes a link or a paste.
        // Its section is already headed with the block's name.
        if (textMode) return [NODES.control(`text-${key}`, textPropOf(key))];
        const label = blockLabel(key);
        // What is sent: the preview is of the prompt, not of this one
        // editor's slots.
        const sent = partsValue(slotsOf(key));
        return [
          NODES.control(`prompt-${key}`, {
            control: "workflow.promptpreview",
            port: { item: item.id, key: key === "negative_prompts" ? "negativeLine" : "promptLine" },
            parts: sent,
            text: partsLine(sent),
            view: shownAs(ctx, key).view || "text",
            onView: (value) => setShownAs(ctx, key, { view: value }),
            full: shownAs(ctx, key).full !== false,
            onFull: (value) => setShownAs(ctx, key, { full: value }),
            onPresets: (anchor) => core.openValuePicker(presetOf(key), anchor),
            editTitle: t("workflow.action.editPartsBesideTitle", { name: label }),
            // The editor is a window onto this list: one step further along this window.
            onEdit: editList("prompt.slots", propOf(key), "slots"),
          }),
        ];
      },
      // Run is on the output preview at the top of these settings (and on
      // the app's preview window), the connection check on its dashboard.
      actions: false,
      // What the parts add up to is what is sent: the prompt, not the
      // list of parts, which is the child window's business.
      partsTitle: t("workflow.section.inputPrompt"),
      details: Boolean(ctx.get("showDetails")),
      detailsToggle: (own) => NODES.props("details-toggle", [own("showDetails")]),
    }), ...readinessNodes()];
  }

  // ---- an app, as a control --------------------------------------------
  // An app is usually its windows. Here it is one card inside some other
  // item: the prompt a tagger writes as the input of something else, a
  // picture made in place. The app is still the app -- an instance of it,
  // owned by the item the card is in, with its run settings, its editors
  // and its results exactly where they always are -- and the card is a
  // view onto it, the way the output preview is.
  //
  // What makes that possible is running without a window. The run settings'
  // body is what builds the run (see runnerBody) and registers the way to
  // start it; drawn by nobody, it would never exist. So the card's owner
  // draws it for them, off screen, with a ctx that reads and writes the
  // run settings through the owner's items:write -- it owns them, through
  // the app. Nothing of the run settings' own is changed by it: the same
  // body, handed a different pair of hands.
  const itemLike = (entry) => ({
    id: entry.id,
    type: entry.type,
    parent: entry.parent,
    props: Object.fromEntries(entry.properties.map((one) => [one.key, one.value])),
  });

  // The controller for one run settings item, drawn for if need be.
  function driveSettings(api, settingsId, host) {
    const entry = api.items.get(settingsId);
    if (!entry) return null;
    const ctx = {
      get: (key) => valueIn(api.items.get(settingsId), key),
      set: (key, value) => api.items.set(settingsId, key, value),
      status: host.status,
      progress: host.progress || ((message) => { if (message) host.status?.(message); }),
      refresh: host.refresh,
      refreshAll: host.refreshAll,
      prompt: host.prompt,
      confirm: host.confirm,
    };
    settingsBody(api, itemLike(entry), ctx);
    return controllerOf(settingsId);
  }

  // Where things are, for an app instance: its run settings, its template,
  // what runs after it.
  function appParts(api, appId) {
    const app = appId ? api.items.get(appId) : null;
    const settingsId = app ? (isRunApp(app.type) ? app.id : valueIn(app, "editor")) : null;
    const settings = typeof settingsId === "string" ? api.items.get(settingsId) : null;
    if (!app || !settings) return null;
    const tpl = coerceTemplate(valueIn(app, "template"));
    const next = valueIn(app, "chain");
    const chain = next && next.tool ? [coerceTemplate(next)] : [];
    return { app, settings, settingsId: settings.id, tpl, chain };
  }

  // Every run setting an app has that a card could offer, in the order the
  // run settings window shows them: what the tool takes, what a sorting
  // step asks, the seed, then the template's own.
  function embedFields(api, appId) {
    const parts = appParts(api, appId);
    if (!parts) return [];
    const { tpl, chain } = parts;
    const out = [];
    let text = false;
    let pictureAt = 0;
    for (const block of blocksOf(tpl.tool)) {
      if (block.direction !== "write") continue;
      if (isParts(block.kind)) out.push({ key: `parts:${block.key}`, label: blockLabel(block.key) });
      else if (isPicture(block.kind)) {
        const slot = PICTURES[pictureAt++];
        // One this template does not use is not offered (see the inputs).
        if (block.optional && !Object.values(tpl.blocks[block.key] || {}).some(Boolean)) continue;
        if (slot) out.push({ key: slot[0], label: blockLabel(block.key) });
        if (slot && slot[2] && isKeyframe(block.kind)) out.push({ key: slot[2], label: t(`workflow.prop.${slot[2]}`) });
      }
      else if (isSize(block.kind)) out.push({ key: "size", label: t("workflow.prop.size") });
      else if (!text) {
        text = true;
        out.push({ key: "text", label: blockLabel(block.key) });
      }
    }
    if (chain.some(readsCandidates)) {
      out.push({ key: "ollamaModel", label: t("workflow.prop.ollamaModel") });
      out.push({ key: "categories", label: t("workflow.prop.categories") });
    }
    const decided = new Set([...tpl.settings, ...tpl.fixed].map(idOf));
    const hasSeed =
      tpl.workflow.platform === "comfyui" &&
      Object.entries(tpl.workflow.graph || {}).some(([nodeId, node]) =>
        SEED_KEYS.some((key) => typeof node.inputs[key] === "number" && !decided.has(`${nodeId}::${key}`))
      );
    if (hasSeed) {
      out.push({ key: "seed", label: t("workflow.prop.seed") });
      out.push({ key: "randomSeed", label: t("workflow.prop.randomSeed") });
    }
    for (const step of [tpl, ...chain]) {
      for (const setting of step.settings) {
        out.push({ key: `setting:${idOf(setting)}`, label: setting.label || setting.input_key, group: setting.group || "" });
      }
    }
    return out;
  }

  // What the app last made, in the shapes a card shows and a host reads:
  // the pictures, and the words -- sorted tags counted as their words.
  function embedOutput(api, appId) {
    const parts = appParts(api, appId);
    const results = (parts && valueIn(parts.settings, "results")) || [];
    const images = results.filter((one) => one.kind === "image" && one.ref).map((one) => resultAddress(one));
    const groups = results.filter((one) => one.kind === "candidates").flatMap((one) => one.groups || []);
    const texts = results.filter((one) => one.kind === "text").map((one) => one.text).filter(Boolean);
    const words = [...texts, ...groups.flatMap((group) => group.tags || [])];
    return { images, groups, texts, text: words.join(", "), empty: !results.length };
  }

  // ---- an app, driven by a host that is not a window --------------------
  // What a chain (plugins/chain) needs of an app, as data and with no card:
  // which inputs it takes and of what kind, putting a value in, loading a
  // saved run into it, running it, and what it made. The kinds are the
  // chain's vocabulary for converting a carried value into the input:
  //   image  a picture            text   a line or paragraph
  //   promptlist  prompt parts    size   [width, height]
  //   number / boolean / value    a seed, the dice, a detailed setting
  const frameKeys = new Set(PICTURES.map((one) => one[2]).filter(Boolean));
  function embedInputs(api, appId) {
    const parts = appParts(api, appId);
    if (!parts) return [];
    const textMode = Boolean((fw.types[parts.app.type] || {}).promptText);
    const settingOf = (id) => [parts.tpl, ...parts.chain].flatMap((one) => one.settings).find((one) => idOf(one) === id);
    const kindOf = (key) => {
      if (key.startsWith("parts:")) return textMode ? "text" : "promptlist";
      if (PICTURES.some((one) => one[0] === key)) return "image";
      if (key === "text" || key === "ollamaModel") return "text";
      if (key === "size") return "size";
      if (key === "seed" || frameKeys.has(key)) return "number";
      if (key === "randomSeed") return "boolean";
      if (key.startsWith("setting:")) return settingOf(key.slice("setting:".length)) ? "value" : "";
      return "";
    };
    return embedFields(api, appId)
      .map((field) => ({ ...field, kind: kindOf(field.key) }))
      .filter((field) => field.kind);
  }

  // Put one value into one input. `value` is already of the input's kind.
  function embedSetInput(api, appId, key, value) {
    const parts = appParts(api, appId);
    if (!parts) throw new Error(t("workflow.value.noApp"));
    const { settingsId, settings, tpl, chain } = parts;
    const set = (name, next) => api.items.set(settingsId, name, next);
    if (key.startsWith("parts:")) {
      const block = key.slice("parts:".length);
      if ((fw.types[parts.app.type] || {}).promptText) return set(textPropOf(block), String(value ?? ""));
      const docProp = block === "negative_prompts" ? "negativeParts" : "parts";
      const slots = Array.isArray(value)
        ? value
        : String(value ?? "").trim()
          ? [{ id: `c${Date.now().toString(36)}`, kind: "text", tags: [], text: String(value), weight: 1 }]
          : [];
      return set(docProp, slots);
    }
    const picture = PICTURES.find(([one]) => one === key);
    if (picture) {
      set(key, String(value || ""));
      return set(picture[1], value ? "chain-input.png" : "");
    }
    if (key.startsWith("setting:")) {
      const id = key.slice("setting:".length);
      const setting = [tpl, ...chain].flatMap((one) => one.settings).find((one) => idOf(one) === id);
      if (!setting) throw new Error(key);
      const rest = (valueIn(settings, "settings") || []).filter((one) => one.id !== id);
      let next = value;
      if (typeof setting.default === "number") next = Number(value);
      else if (typeof setting.default === "boolean") next = value === true || /^(1|true|on|yes)$/i.test(String(value));
      return set("settings", [...rest, { id, value: next }]);
    }
    if (key === "size") return set("size", Array.isArray(value) ? value.map((one) => Math.max(1, Math.round(Number(one) || 0))) : valueIn(settings, "size"));
    if (key === "seed" || frameKeys.has(key)) return set(key, Number(value) || 0);
    if (key === "randomSeed") return set(key, value === true);
    return set(key, String(value ?? ""));
  }

  // What an input is edited with, as the spec of a property (no value: the
  // host reads and writes its own). `wide` is for one that wants the whole
  // width under a label of its own -- a picture, a list of prompt parts.
  function embedInputSpec(api, appId, key) {
    const parts = appParts(api, appId);
    if (!parts) return null;
    // The spec the app edits the property with, as it is: the same control,
    // not a stand-in -- what it is drawn as in the app is what it is drawn as
    // wherever it is set from.
    const bare = (spec) => {
      const { read, write, placed, label, ...rest } = spec || {};
      return rest;
    };
    if (key.startsWith("parts:")) {
      if ((fw.types[parts.app.type] || {}).promptText) return { spec: bare(RUN_PROPS[textPropOf(key.slice(6))]), wide: true };
      return { spec: { type: "list", each: { type: "prompt.slot" }, control: "prompt.promptlist" }, wide: true };
    }
    if (PICTURES.some(([one]) => one === key)) {
      // Drawn in the app as an image card (see pictureSection).
      return { spec: { ...bare(RUN_PROPS[key] || RUN_PROPS.image), control: "imagecard", defaultFull: true }, wide: true };
    }
    if (key.startsWith("setting:")) {
      const id = key.slice("setting:".length);
      const setting = [parts.tpl, ...parts.chain].flatMap((one) => one.settings).find((one) => idOf(one) === id);
      return setting ? { spec: settingSpec(setting) } : null;
    }
    if (RUN_PROPS[key]) {
      const spec = bare(RUN_PROPS[key]);
      // A text drawn as a card of its own in the run settings stays one.
      return { spec, wide: ["texteditor", "textarea"].includes(spec.control) };
    }
    return null;
  }

  // What stops the app from running, as the app's own run settings ask it:
  // its template's problems and what its server does not have.
  function embedProblems(api, appId, onLoad) {
    const parts = appParts(api, appId);
    if (!parts) return [t("workflow.value.noApp")];
    const next = valueIn(parts.app, "chain");
    const steps = [valueIn(parts.app, "template"), ...(next && next.tool ? [next] : [])];
    return readiness.blockersOf(api, steps, valueIn(parts.settings, "settings"), onLoad || (() => {}));
  }

  // A saved run (see workflow.runpreset) put into the app's run settings.
  function embedApplyPreset(api, appId, record) {
    const parts = appParts(api, appId);
    if (!parts || !record || typeof record !== "object" || !record.run) return false;
    return applySnapshot(api, parts.settingsId, record.run);
  }

  // Run it and wait. Resolves to what it made, or throws what stopped it.
  async function embedRun(api, appId, host) {
    const parts = appParts(api, appId);
    if (!parts) throw new Error(t("workflow.value.noApp"));
    const controller = driveSettings(api, parts.settingsId, host);
    if (!controller) throw new Error(t("workflow.value.noApp"));
    if (controller.problem) throw new Error(controller.problem);
    controller.clear();
    let last = "";
    await controller.run((message) => {
      last = String(message || "");
      if (host.status) host.status(message);
    });
    const output = embedOutput(api, appId);
    if (output.empty) throw new Error(last || t("workflow.run.noResults"));
    return { image: output.images[0] || "", images: output.images, text: output.text };
  }

  function embedCancel(api, appId) {
    const parts = appParts(api, appId);
    const controller = parts && controllerOf(parts.settingsId);
    if (controller) return controller.cancel(() => {});
    return null;
  }

  // The app as core's appSurface sees it (see `appSurface` on a type): the
  // run, the inputs the run settings take and what it made. Not read off the
  // body, which is a card of the app's output and not the app's buttons.
  function embedSurface(api, appId) {
    const parts = appParts(api, appId);
    if (!parts) return { exclusive: true };
    const host = { status: () => {}, refresh: () => {}, refreshAll: () => core.refreshAll(), prompt: () => null, confirm: () => false };
    const outputOf = () => embedOutput(api, appId);
    const textMode = Boolean((fw.types[parts.app.type] || {}).promptText);
    const propOf = (key) => {
      if (key.startsWith("parts:")) return textMode ? textPropOf(key.slice(6)) : "";
      if (key.startsWith("setting:")) return "settings";
      return key;
    };
    const nodeOf = (key) => {
      if (key.startsWith("parts:")) return [`parts-${key.slice(6)}`, `text-${key.slice(6)}`];
      if (key.startsWith("setting:")) {
        const id = key.slice(8);
        return (domKey) => domKey.startsWith(`${appId}-`) && domKey.includes(`-${id}-`);
      }
      if (key === "size" || key === "seed" || key === "randomSeed") return [`${appId}-${key}`];
      return [key, `${appId}-${key}`];
    };
    return {
      exclusive: true,
      buttons: [
        // Drawn as the output card's act button, which is also its stop.
        { key: "run", label: t("workflow.action.run"), primary: true, node: "output", selector: ".mu-imagecard-act, .mu-imagestage-run", run: async () => { await embedRun(api, appId, host); } },
        { key: "cancel", label: t("workflow.action.cancel"), hidden: true, node: "output", run: () => embedCancel(api, appId) },
      ],
      inputs: [
        // The whole run settings, as one of the runs kept for the app: picked
        // on the window's top bar, where its presets button is.
        { key: "preset", label: t("workflow.action.presets"), kind: "preset", spec: { type: "string" }, wide: false, titlebar: true, prop: "", set: () => {} },
        ...embedInputs(api, appId).map((field) => {
        const made = embedInputSpec(api, appId, field.key);
        return {
          key: field.key,
          // The name the run settings window gives it: its prompt is "Input
          // prompt" there, where the template calls the block something else.
          label: field.key === "parts:prompts" ? t("workflow.section.inputPrompt") : field.group ? `${field.group} · ${field.label}` : field.label,
          kind: field.kind,
          spec: made ? made.spec : { type: "string" },
          wide: Boolean(made && made.wide),
          // Which control of the run settings window is this input's: the
          // keys the body draws them under (see runnerBody).
          node: nodeOf(field.key),
          // The run settings property it is written to, for whoever asks if
          // something else feeds it (a prompt editor linked in).
          prop: propOf(field.key),
          set: (value) => embedSetInput(api, appId, field.key, value),
        };
      }),
      ],
      outputs: [
        // All three are the one output card of the run settings window.
        { key: "image", label: t("workflow.surface.image"), kind: "image", spec: { type: "image" }, node: ["output"], read: () => outputOf().images[0] || "" },
        { key: "images", label: t("workflow.surface.images"), kind: "imagelist", spec: { type: "list", each: { type: "picture" } }, node: ["output"], read: () => outputOf().images },
        { key: "text", label: t("workflow.surface.text"), kind: "text", spec: { type: "string" }, node: ["output"], read: () => outputOf().text },
      ],
    };
  }

  // What other plugins reach: the surface (core's appSurface asks for it
  // through `appSurface` on the type), loading a saved run, and what stops
  // an app that runs on a server.
  EMBED = {
    surface: embedSurface,
    problems: embedProblems,
    applyPreset: embedApplyPreset,
    isApp: (type) => isRunApp(type),
  };


  // ---- the preview: what a runner made, with room to see it ------------
  // A view of its owner and nothing else. It holds no results of its own --
  // they are the runner's, read here through items:read -- so the two can
  // never disagree, and the preview can be closed and opened again without
  // losing anything. System kind: it is made by a runner, never picked.
  // What a run made, drawn the way promptmanager draws it: the images on a
  // stage the shape of the output -- the size asked for until there is a
  // picture -- and any text under it. A tool that reads no picture back
  // gets no stage, only its text.
  function outputNodes(
    api,
    {
      results,
      tpl,
      size,
      running,
      fill,
      emptyAction = null,
      onClear = null,
      shown = null,
      setShown = null,
      onKeep = null,
      onKeepImage = null,
      // The app keeps its output whole, not a picture of it: the keep is
      // offered over the grid too (see imagestage's keepAll).
      keepWhole = false,
      onSort = null,
      // Whether the run ends in a sorting step, and the categories it sorts
      // into -- which is what decides the cards drawn before any answer.
      sorts = false,
      categories = [],
      onKeepGroup = null,
      // What the image card's grip carries, if anything: the preview's own
      // `output` property.
      port = null,
      // The read block whose picture is not an output of its own but goes
      // over the first (a panorama's depth map), as the app declares on
      // its `output.overlay`.
      overlayKey = "",
      // The property of the app whose value the card's grip carries,
      // when the app's output is a value of its own type (a panorama with
      // its depth, not the picture of it): `output.port` on its type.
      portKey = "",
    }
  ) {
    const readsImage =
      !tpl.tool || blocksOf(tpl.tool).some((block) => block.direction === "read" && (isImage(block.kind) || isVideo(block.kind)));
    const [width, height] = Array.isArray(size) ? size : [1024, 1024];
    const overlaid = overlayKey ? results.find((result) => result.kind === "image" && result.key === overlayKey) : null;
    const images = results
      .filter((result) => result.kind === "image" && !(overlayKey && result.key === overlayKey))
      .map((result) => resultAddress(result));
    const texts = results.filter((result) => result.kind === "text");
    const sorted = results.filter((result) => result.kind === "candidates");
    const waiting = t(running ? "workflow.value.running" : "workflow.value.noOutput");
    return [
      ...(readsImage
        ? [
            NODES.control("stage", {
              control: "imagecard",
              // A video carried as a video, several pictures as the list.
              port: port
                ? {
                    item: port.item,
                    key:
                      portKey ||
                      (images.length && /\.(webm|mp4|m4v|mov|mkv)($|[?&#])/i.test(images[0])
                        ? "outputVideo"
                        : images.length > 1
                          ? "outputs"
                          : "output"),
                  }
                : null,
              // Unset until toggled: the image card's default (small).
              full: shown ? shown("stage").full : undefined,
              onFull: setShown ? (value) => setShown("stage", { full: value }) : null,
              images,
              overlay: overlaid && images.length === 1 ? resultAddress(overlaid) : "",
              width,
              height,
              // Only when the size is the tool's to be asked for: a
              // background removal's output is its input's size, and a
              // number here would say otherwise.
              showSize: writes(tpl.tool, isSize),
              busy: running,
              empty: waiting,
              fill,
              emptyAction,
              onClear: images.length ? onClear : null,
              onKeep: onKeepImage,
              keepAll: keepWhole,
            }),
          ]
        : []),
      // A run that ends in sorting shows its card of categories whether or
      // not there is an answer yet: the categories are where the tags will
      // go, and seeing them before the first run is how you know which you
      // asked for. Its own header carries the run, the clear and the size,
      // so nothing is left to sit underneath it.
      ...(sorts || sorted.length
        ? [
            sortedCard(api, {
              port: port ? { item: port.item, key: "outputTags" } : null,
              groups: sorted.length ? sorted[0].groups || [] : [],
              categories,
              empty: waiting,
              onChange: onSort ? (groups) => onSort(0, groups) : null,
              onRun: emptyAction ? emptyAction.run : null,
              runLabel: emptyAction ? emptyAction.label : "",
              runTitle: emptyAction ? emptyAction.title : "",
              running,
              onClear,
              onKeep: onKeepGroup,
            }),
          ]
        : []),
      // One card, whether or not there is anything in it yet. An output is
      // where the answer will be, and a window that shows nothing until the
      // first run gives you nowhere to look and nothing to press -- the run
      // is in the card's own header, so the card has to be there.
      ...(readsImage || sorts || sorted.length
        ? []
        : (texts.length ? texts : [{ text: "" }]).map((result, index) =>
            NODES.control(`text-${index}`, {
              control: "workflow.textout",
              port: port && index === 0 ? { item: port.item, key: "outputText" } : null,
              text: result.text || "",
              empty: waiting,
              onRun: emptyAction ? emptyAction.run : null,
              runTitle: emptyAction ? emptyAction.title : "",
              running,
              full: shown ? shown(`out-${index}`).full !== false : true,
              onFull: shown ? (value) => setShown(`out-${index}`, { full: value }) : null,
              onClear,
              onKeep,
            })
          )),
    ];
  }

  // ---- the preview: what the app made, with room to see it ---------------
  // A view and nothing else. It holds no results of its own -- they are the
  // property editor's, read here through items:read -- so the two can never
  // disagree, and the preview can be closed and opened again without losing
  // anything. System kind: the app makes it, nobody picks it.
  const isVideoRef = (ref) => /\.(webm|mp4|m4v|mov|mkv)$/i.test((ref && ref.filename) || "");

  // ---- what a run made, as properties --------------------------------------
  // The run's results as values other windows can be handed: the pictures
  // it made (a list, one picture or many -- a batch is still one output),
  // the first of them on its own, a video, the words it read back, and a
  // sorting step's tags. Read-only and read through: the results are the
  // run settings', and these only say them in the shapes a port carries.
  //
  // `resultsOf(item)` finds the results from the item holding these: the
  // run settings themselves, or a preview window reading its app's.
  //
  // Addresses are written out as comfy:run's viewUrl makes them: a
  // read-through value is read with no API (items:read lists every property
  // that way), so there is no comfy:run to ask.
  function outputProps(resultsOf) {
    const address = resultAddress;
    const pictures = (item) =>
      resultsOf(item).filter((one) => one.kind === "image" && one.ref && !isVideoRef(one.ref));
    return {
      outputs: {
        label: "workflow.prop.outputs",
        type: "list", each: { type: "picture" },
        readonly: true,
        placed: true,
        read: (_api, item) => pictures(item).map((one, index) => ({ id: String(index), src: address(one) })),
      },
      output: {
        label: "workflow.prop.output",
        type: "image",
        control: "imagecard",
        readonly: true,
        placed: true,
        read: (_api, item) => {
          const [first] = pictures(item);
          return first ? address(first) : "";
        },
      },
      outputVideo: {
        label: "workflow.prop.outputVideo",
        type: "video",
        readonly: true,
        placed: true,
        read: (_api, item) => {
          const first = resultsOf(item).find((one) => one.kind === "image" && one.ref && isVideoRef(one.ref));
          return first ? address(first) : "";
        },
      },
      outputText: {
        label: "workflow.prop.outputText",
        type: "string",
        readonly: true,
        placed: true,
        read: (_api, item) => {
          const text = resultsOf(item).find((one) => one.kind === "text");
          return text ? String(text.text || "") : "";
        },
      },
      outputTags: {
        label: "workflow.prop.outputTags",
        type: "list", each: { type: "prompt.tag", placeholder: "prompt.placeholder.oneTag" },
        readonly: true,
        placed: true,
        read: (_api, item) => {
          const sorted = resultsOf(item).find((one) => one.kind === "candidates");
          return sorted ? tagEntries((sorted.groups || []).flatMap((group) => group.tags || [])) : [];
        },
      },
    };
  }

  // Keeping a picture is the keeper item's (keeper.js): the preview opens it on a picture.

  // The word on an app's run button: its own (`runLabel`, a translation key -- the tag generator says what it
  // makes), else "Run".
  const runLabelOf = (type) => {
    const key = (fw.types[type] || {}).runLabel;
    return t(key || "workflow.action.run");
  };

  // What a preview shows of a runner: the output, with everything that is
  // done to it -- keeping it, sorting it, clearing it, running again. A
  // function of its own so the app card can show the same thing the
  // preview window does. `inCard` leaves out the run and the clear: the
  // card has its own, in its header.
  function previewNodes(api, ctx, runner, { shown, setShown, fill = true, inCard = false, keeperFor = null, port = null }) {
    const read = (key) => (runner.properties.find((one) => one.key === key) || {}).value;
    const results = read("results") || [];
    const running = JOBS.has(runner.id);
    // A standalone runner holds its template; run settings read their
    // app's.
    const owner = isRunApp(runner.type) ? runner : null;
    const template =
      read("template") ?? (owner && (owner.properties.find((one) => one.key === "template") || {}).value);
    // What the run ends in decides what is drawn before there is anything
    // to draw: a chain that finishes by sorting shows its categories.
    const chained = owner && (owner.properties.find((one) => one.key === "chain") || {}).value;
    const sorts = Boolean(chained && chained.tool && readsCandidates(coerceTemplate(chained)));
    // An app's run button lives here, under what it makes. A standalone
    // runner keeps its own.
    const settingsLike = isRunApp(runner.type);
    const controller = settingsLike ? controllerOf(runner.id) : null;
    // In the middle of the empty stage, promptmanager's way: run while
    // there is nothing to show, cancel while something is on its way.
    // Once there is an output, its close button takes it away and the run
    // button comes back.
    const ownsRun = settingsLike;
    const emptyAction = !ownsRun
      ? null
      : running
        ? {
            label: t("workflow.action.cancel"),
            run: () => controller && controller.cancel(ctx.status),
          }
        : {
            label: runLabelOf(runner.type),
            // Until the run settings have been drawn once there is
            // nothing to ask; say where to go instead.
            title: controller ? controller.problem || t("workflow.action.runTitle") : t("workflow.value.openSettings"),
            run: () => (controller ? controller.run(ctx.status) : ctx.status(t("workflow.value.openSettings"))),
          };
    const onClear = ownsRun && controller ? () => controller.clear() : null;

    // What a kept output is saved as, from the tool's own declaration of
    // what it reads back. A prompt becomes a prompt part -- split on the
    // commas, because that is what a part is made of and what lets a slot
    // weight the pieces -- and anything else becomes the string it is.
    // Nothing here is this or that app's: a tool that says it writes a
    // prompt gets the prompt treatment wherever it is run.
    const tool = coerceTemplate(template);
    const reads = blocksOf(tool.tool).find((block) => block.direction === "read" && !isImage(block.kind) && !isVideo(block.kind));
    const answer = results.find((one) => one.kind === "text");
    const asPrompt = Boolean(reads && /^value\.prompt/.test(reads.kind));
    const onKeep =
      answer && answer.text
        ? {
            title: t(asPrompt ? "workflow.action.keepPrompt" : "workflow.action.keepText"),
            run: async () => {
              const name = await ctx.prompt(t("workflow.prompt.keepName"), {
                title: t(asPrompt ? "workflow.action.keepPrompt" : "workflow.action.keepText"),
              });
              if (!name) return;
              const tags = answer.text
                .split(",")
                .map((one) => one.trim())
                .filter(Boolean);
              try {
                await api.store.save(
                  asPrompt
                    ? { type: "prompt.part", name, value: { name, tags: tagEntries(tags), category: "" } }
                    : { type: "string", name, value: answer.text }
                );
                ctx.status(t("workflow.status.kept", { name }));
              } catch (error) {
                ctx.status(t("workflow.status.failed", { error: error.message || error }));
              }
            },
          }
        : null;
    // A picture it made, kept as an image preset -- the same type the
    // run settings' picture box offers, so what one app made is what
    // another can start from. Fetched back from ComfyUI as it is, unless
    // it is too big for the box that would take it.
    //
    // With a keeper -- the preview's own child window for this -- it is
    // opened on the picture instead, where the name and what to keep it as
    // are chosen while looking at it.
    const onKeepImage = async (src) => {
      if (keeperFor && owner) {
        api.window.openScreen("workflow.keeper", { app: keeperFor, src, name: "", as: "" });
        return;
      }
      const name = await ctx.prompt(t("workflow.prompt.keepName"), { title: t("mu.action.keepImage") });
      if (!name) return;
      try {
        const value = await fitImage(await asDataUrl(src), KEEP_IMAGE_CHARS);
        if (!value) throw new Error(t("workflow.status.imageTooBig"));
        await api.store.save({ type: "image", name, value });
        ctx.status(t("workflow.status.kept", { name }));
      } catch (error) {
        ctx.status(t("workflow.status.failed", { error: error.message || error }));
      }
    };
    return outputNodes(api, {
          results,
          tpl: coerceTemplate(template),
          size: read("size"),
          running,
          fill,
          emptyAction: inCard ? null : emptyAction,
          onClear: inCard ? null : onClear,
          shown,
          setShown,
          onKeep,
          onKeepImage,
          keepWhole: Boolean(keeperFor && owner && ((fw.types[owner.type] || {}).output || {}).value),
          overlayKey: (owner && ((fw.types[owner.type] || {}).output || {}).overlay) || "",
          // Only where the card stands in the app itself: a preview
          // window's grip is its own `output`.
          portKey: (isRunApp(runner.type) && owner && ((fw.types[owner.type] || {}).output || {}).port) || "",
          port,
          sorts,
          categories: categoriesOfSettings(api, runner),
          // One category's tags, kept as a prompt part filed under that
          // category -- which is what makes the slot editor offer it when
          // a slot is narrowed to that category.
          onKeepGroup: async (category, tags) => {
            if (!tags.length) return;
            const name = await ctx.prompt(t("workflow.prompt.keepName"), {
              title: t("workflow.action.keepGroup", { name: category }),
              value: category,
            });
            if (!name) return;
            try {
              await api.store.save({ type: "prompt.part", name, value: { name, tags: tagEntries(tags), category } });
              ctx.status(t("workflow.status.kept", { name }));
            } catch (error) {
              ctx.status(t("workflow.status.failed", { error: error.message || error }));
            }
          },
          // Moving a tag from one card to another edits the run's
          // results, which are the runner's -- so it is asked to make
          // the change, the same way clearing them is.
          onSort:
            ownsRun && controller
              ? (index, groups) => {
                  const next = results.map((one) => ({ ...one }));
                  const at = next.filter((one) => one.kind === "candidates")[index];
                  if (at) at.groups = groups;
                  controller.setResults(next);
                }
              : null,
    });
  }

  fw.registerTranslations({
    en: {
      "workflow.surface.image": "Picture",
      "workflow.surface.images": "Pictures",
      "workflow.surface.text": "Text",
      "workflow.section.inputPrompt": "Input prompt",
      "workflow.value.openSettings": "Open this app's run settings once to run it",
      "workflow.prop.parts": "Prompt parts",
      "workflow.prop.showDetails": "Show detailed settings",
      "workflow.value.noApp": "This window's app is gone.",
      "workflow.action.editPartsBesideTitle": "Open {name}",
      "workflow.item.keeper": "Save as a Preset",
      "workflow.card.upload": "Upload",
      "workflow.card.run": "Run",
      "workflow.card.edit": "Edit",
      "workflow.action.presets": "Presets",
      "workflow.prop.keepSrc": "Picture",
      "workflow.prop.keepApp": "App",
      "workflow.prop.keepName": "Name",
      "workflow.prop.keepAs": "Save as",
      "workflow.value.nothingToKeep": "Nothing to save. Use the bookmark on an output to save it here.",
      "workflow.action.keep": "Save",
      "workflow.action.cancelKeep": "Cancel",
      "workflow.status.nameFirst": "Give it a name first",
      "workflow.prop.preview": "Preview",
      "workflow.value.noOutput": "Nothing yet",
      "workflow.value.running": "running…",
      "workflow.prop.text": "Text",
      "workflow.prop.output": "Output",
      "workflow.prop.outputs": "Output pictures",
      "workflow.prop.outputVideo": "Output video",
      "workflow.prop.outputText": "Output text",
      "workflow.prop.outputTags": "Sorted tags",
      "workflow.prop.promptLine": "Prompt (as text)",
      "workflow.prop.negativeLine": "Negative prompt (as text)",
      "workflow.prop.promptText": "Prompt",
      "workflow.prop.negativeText": "Negative prompt",
      "workflow.placeholder.promptText": "Type it, or drag a prompt editor's result here by its grip to paste or link it",
      "workflow.placeholder.negativeText": "What not to draw",
      "workflow.prop.image": "Image",
      "workflow.prop.imageName": "Picture file",
      "workflow.prop.image2": "Second picture",
      "workflow.prop.image2Name": "Second picture file",
      "workflow.value.optional": "{name} (optional)",
      "workflow.prop.image3": "Keyframe 1",
      "workflow.prop.image3Name": "Keyframe 1 file",
      "workflow.prop.frame3": "Frame (0 = first)",
      "workflow.prop.image4": "Keyframe 2",
      "workflow.prop.image4Name": "Keyframe 2 file",
      "workflow.prop.frame4": "Frame (0 = first)",
      "workflow.prop.image5": "Keyframe 3",
      "workflow.prop.image5Name": "Keyframe 3 file",
      "workflow.prop.frame5": "Frame (0 = first)",
      "workflow.prop.image6": "Picture 6",
      "workflow.prop.image6Name": "Picture 6 file",
      "workflow.prop.image7": "Picture 7",
      "workflow.prop.image7Name": "Picture 7 file",
      "workflow.prop.image8": "Picture 8",
      "workflow.prop.image8Name": "Picture 8 file",
      "workflow.prop.image9": "Picture 9",
      "workflow.prop.image9Name": "Picture 9 file",
      "workflow.prop.image10": "Picture 10",
      "workflow.prop.image10Name": "Picture 10 file",
      "workflow.prop.image11": "Picture 11",
      "workflow.prop.image11Name": "Picture 11 file",
      "workflow.prop.image12": "Picture 12",
      "workflow.prop.image12Name": "Picture 12 file",
      "workflow.prop.image13": "Picture 13",
      "workflow.prop.image13Name": "Picture 13 file",
      "workflow.prop.image14": "Picture 14",
      "workflow.prop.image14Name": "Picture 14 file",
      "workflow.prop.size": "Image size",
      "workflow.prop.prompts": "Prompt parts",
      "workflow.vtype.imageSize": "Image size",
      "workflow.field.orientation": "shape",
      "workflow.orientation.square": "square",
      "workflow.orientation.portrait": "portrait",
      "workflow.orientation.landscape": "landscape",
      "workflow.control.promptpreview": "Prompt preview",
      "workflow.prop.negativePrompts": "Negative prompt",
      "workflow.prop.negativeParts": "Negative prompt parts",
      "workflow.prop.seed": "Seed",
      "workflow.prop.views": "How this window shows things",
      "workflow.opt.promptText": "As text",
      "workflow.opt.promptCards": "As parts",
      "workflow.control.textout": "Text output",
      "workflow.opt.shrink": "Shrink it",
      "workflow.opt.grow": "Show all of it",
      "workflow.action.editParts": "Edit the parts",
      "workflow.prop.categories": "Categories",
      "workflow.prop.ollamaModel": "Model",
      "workflow.section.sorting": "Sorting",
      "workflow.prop.sortPrompt": "Classification prompt",
      "workflow.prop.stepTags": "Tagger output",
      "workflow.vtype.categories": "Category list",
      "workflow.action.addCategory": "Add a category",
      "workflow.control.fieldlabel": "Field label",
      "workflow.prop.categoryEditor": "Categories",
      "workflow.value.categoryCount": "{n} categories",
      "workflow.run.noCategories": "there are no categories to sort into",
      "workflow.status.historyFailed": "Could not keep this run in the history: {error}",
      "workflow.action.keepGroup": "Keep {name} as a prompt part",
      "workflow.run.sorting": "Sorting the tags...",
      "workflow.action.keepPrompt": "Keep as a prompt part",
      "workflow.action.keepText": "Keep as a saved string",
      "workflow.prompt.keepName": "A name for it",
      "workflow.status.kept": "Kept {name}",
      "workflow.status.imageTooBig": "The picture is too big to keep",
      "workflow.prop.randomSeed": "Random seed",
      "workflow.prop.settings": "Settings",
      "workflow.prop.engine": "Engine",
      "workflow.prop.engineSettings": "Other engines' settings",
      "workflow.prop.results": "Results",
      "workflow.section.results": "Results ({n})",
      "workflow.action.run": "Run",
      "workflow.action.runTitle": "Send this template to its server",
      "workflow.action.cancel": "Cancel",
      "workflow.action.check": "Check connection",
      "workflow.action.checkTitle": "Ask the server this template runs on whether it is up",
      "workflow.run.uploading": "uploading the image…",
      "workflow.run.sending": "sending…",
      "workflow.run.keeping": "keeping the outputs…",
      "workflow.run.waiting": "running… {s}s",
      "workflow.run.queued": "waiting in the ComfyUI queue ({n} before it) · {s}s",
      "workflow.run.steps": "{value}/{max} ({pct}%)",
      "workflow.run.nodes": "nodes {done}/{total}",
      "workflow.run.done": "done",
      "workflow.run.noResults": "finished, but the read blocks found no output",
      "workflow.run.readElsewhere":
        "Finished, but nothing came out of {target}. Pictures came out of {found} -- point the template's output block there.",
      "workflow.run.cancelling": "cancelling…",
      "workflow.run.cancelled": "cancelled",
      "workflow.run.failed": "the run failed",
      "workflow.run.timeout": "no answer after 30 minutes",
      "workflow.run.noImage": "there is no image to send",
      "workflow.run.notOllama": "this is not an Ollama workflow",
      "workflow.run.comfyOk": "ComfyUI {version} at {url}",
      "workflow.run.ollamaOk": "Ollama at {url} · {n} models",
    },
    ja: {
      "workflow.surface.image": "画像",
      "workflow.surface.images": "画像リスト",
      "workflow.surface.text": "テキスト",
      "workflow.section.inputPrompt": "入力プロンプト",
      "workflow.value.openSettings": "実行するには、このアプリの実行設定を一度開いてください",
      "workflow.prop.parts": "プロンプトパーツ",
      "workflow.prop.showDetails": "詳細設定を表示",
      "workflow.value.noApp": "このウィンドウのアプリはもうありません。",
      "workflow.action.editPartsBesideTitle": "{name}を開く",
      "workflow.item.keeper": "プリセットとして保存",
      "workflow.card.upload": "アップロード",
      "workflow.card.run": "実行",
      "workflow.card.edit": "編集",
      "workflow.action.presets": "プリセット",
      "workflow.prop.keepSrc": "画像",
      "workflow.prop.keepApp": "アプリ",
      "workflow.prop.keepName": "名前",
      "workflow.prop.keepAs": "保存する型",
      "workflow.value.nothingToKeep": "保存するものがありません。出力のブックマークボタンからここで保存できます。",
      "workflow.action.keep": "保存",
      "workflow.action.cancelKeep": "キャンセル",
      "workflow.status.nameFirst": "名前を入力してください",
      "workflow.prop.preview": "プレビュー",
      "workflow.value.noOutput": "まだ何もありません",
      "workflow.value.running": "実行中…",
      "workflow.prop.text": "テキスト",
      "workflow.prop.output": "出力",
      "workflow.prop.outputs": "出力画像",
      "workflow.prop.outputVideo": "出力動画",
      "workflow.prop.outputText": "出力テキスト",
      "workflow.prop.outputTags": "仕分けたタグ",
      "workflow.prop.promptLine": "プロンプト（文字列）",
      "workflow.prop.negativeLine": "ネガティブプロンプト（文字列）",
      "workflow.prop.promptText": "プロンプト",
      "workflow.prop.negativeText": "ネガティブプロンプト",
      "workflow.placeholder.promptText": "直接入力するか、プロンプトエディタの結果をハンドルでここへドラッグして貼り付け／リンク",
      "workflow.placeholder.negativeText": "描かないもの",
      "workflow.prop.image": "画像",
      "workflow.prop.imageName": "画像のファイル名",
      "workflow.prop.image2": "2枚目の画像",
      "workflow.prop.image2Name": "2枚目の画像のファイル名",
      "workflow.value.optional": "{name}（任意）",
      "workflow.prop.image3": "中間画像 1",
      "workflow.prop.image3Name": "中間画像 1 のファイル名",
      "workflow.prop.frame3": "フレーム位置（0 = 最初）",
      "workflow.prop.image4": "中間画像 2",
      "workflow.prop.image4Name": "中間画像 2 のファイル名",
      "workflow.prop.frame4": "フレーム位置（0 = 最初）",
      "workflow.prop.image5": "中間画像 3",
      "workflow.prop.image5Name": "中間画像 3 のファイル名",
      "workflow.prop.frame5": "フレーム位置（0 = 最初）",
      "workflow.prop.image6": "画像 6",
      "workflow.prop.image6Name": "画像 6 のファイル名",
      "workflow.prop.image7": "画像 7",
      "workflow.prop.image7Name": "画像 7 のファイル名",
      "workflow.prop.image8": "画像 8",
      "workflow.prop.image8Name": "画像 8 のファイル名",
      "workflow.prop.image9": "画像 9",
      "workflow.prop.image9Name": "画像 9 のファイル名",
      "workflow.prop.image10": "画像 10",
      "workflow.prop.image10Name": "画像 10 のファイル名",
      "workflow.prop.image11": "画像 11",
      "workflow.prop.image11Name": "画像 11 のファイル名",
      "workflow.prop.image12": "画像 12",
      "workflow.prop.image12Name": "画像 12 のファイル名",
      "workflow.prop.image13": "画像 13",
      "workflow.prop.image13Name": "画像 13 のファイル名",
      "workflow.prop.image14": "画像 14",
      "workflow.prop.image14Name": "画像 14 のファイル名",
      "workflow.prop.size": "画像サイズ",
      "workflow.prop.prompts": "プロンプトパーツ",
      "workflow.vtype.imageSize": "画像サイズ",
      "workflow.field.orientation": "向き",
      "workflow.orientation.square": "正方形",
      "workflow.orientation.portrait": "縦長",
      "workflow.orientation.landscape": "横長",
      "workflow.control.promptpreview": "プロンプトプレビュー",
      "workflow.prop.negativePrompts": "ネガティブプロンプト",
      "workflow.prop.negativeParts": "ネガティブプロンプトのパーツ",
      "workflow.prop.seed": "シード",
      "workflow.prop.views": "このウィンドウの表示方法",
      "workflow.opt.promptText": "テキストで表示",
      "workflow.opt.promptCards": "パーツで表示",
      "workflow.control.textout": "テキスト出力",
      "workflow.opt.shrink": "縮小表示にする",
      "workflow.opt.grow": "全体を表示する",
      "workflow.action.editParts": "パーツを編集する",
      "workflow.prop.categories": "カテゴリ",
      "workflow.prop.ollamaModel": "モデル",
      "workflow.section.sorting": "分類",
      "workflow.prop.sortPrompt": "分類プロンプト",
      "workflow.prop.stepTags": "タガーの出力",
      "workflow.vtype.categories": "カテゴリリスト",
      "workflow.action.addCategory": "カテゴリを追加",
      "workflow.control.fieldlabel": "項目名",
      "workflow.prop.categoryEditor": "カテゴリ",
      "workflow.value.categoryCount": "{n} 件",
      "workflow.run.noCategories": "分類先のカテゴリがありません",
      "workflow.status.historyFailed": "実行履歴に保存できませんでした: {error}",
      "workflow.action.keepGroup": "{name} をプロンプトパーツとして保存",
      "workflow.run.sorting": "タグを分類中…",
      "workflow.action.keepPrompt": "プロンプトパーツとして保存",
      "workflow.action.keepText": "文字列として保存",
      "workflow.prompt.keepName": "保存する名前",
      "workflow.status.kept": "{name} を保存しました",
      "workflow.status.imageTooBig": "画像が大きすぎて保存できません",
      "workflow.prop.randomSeed": "ランダムシード",
      "workflow.prop.settings": "設定",
      "workflow.prop.engine": "エンジン",
      "workflow.prop.engineSettings": "ほかのエンジンの設定",
      "workflow.prop.results": "結果",
      "workflow.section.results": "結果 ({n})",
      "workflow.action.run": "実行",
      "workflow.action.runTitle": "このテンプレートをサーバーに送る",
      "workflow.action.cancel": "中止",
      "workflow.action.check": "接続確認",
      "workflow.action.checkTitle": "このテンプレートの実行先サーバーが応答するか確認する",
      "workflow.run.uploading": "画像をアップロード中…",
      "workflow.run.sending": "送信中…",
      "workflow.run.keeping": "出力を取り込み中…",
      "workflow.run.waiting": "実行中… {s}秒",
      "workflow.run.queued": "ComfyUIの順番待ち（前に{n}件）· {s}秒",
      "workflow.run.steps": "{value}/{max}（{pct}%）",
      "workflow.run.nodes": "ノード {done}/{total}",
      "workflow.run.done": "完了しました",
      "workflow.run.noResults": "完了しましたが、出力ブロックに結果がありませんでした",
      "workflow.run.readElsewhere":
        "完了しましたが、{target} からは何も出力されていません。画像を出力したのは {found} です。テンプレートの出力ブロックをそちらに割り当ててください",
      "workflow.run.cancelling": "中止しています…",
      "workflow.run.cancelled": "中止しました",
      "workflow.run.failed": "実行に失敗しました",
      "workflow.run.timeout": "30分応答がありません",
      "workflow.run.noImage": "送る画像がありません",
      "workflow.run.notOllama": "Ollamaのワークフローではありません",
      "workflow.run.comfyOk": "ComfyUI {version} ({url})",
      "workflow.run.ollamaOk": "Ollama ({url}) · モデル {n} 個",
    },
  });
}
