/* Character -- the value, and what it can be turned into.
 *
 * A character is who is in the picture, kept once and used by every app:
 * how they are described, what they can be wearing, pictures of them from
 * four sides, and what they can be seen doing. Nothing here draws
 * anything; this is the record, its repair, and the ways out of it.
 *
 *   {uid, name, description,
 *    outfits: [{id, src}],      pictures of what they wear
 *    sheet:   [{id, src}],      the four-view sheet, front to back
 *    actions: [{name, kind, media}]}
 *
 * The ways out are keyed by the block kinds a workflow tool takes
 * (`value.prompt_list`, `value.image`, ...). That table is the whole of what
 * a runner needs to know about a character: it asks for the kind it is
 * filling and gets the value for it, the same way the shell's picker asks a
 * type for its groups without knowing what the groups mean.
 *
 * Kept free of the shell so it can be checked without a browser -- only the
 * picture work at the bottom needs a canvas.
 */

// The four sides, in the order a sheet lays them out: what the sheet's
// entries are called when a sheet is cut into them.
export const VIEWS = ["front", "threeQuarter", "side", "back"];

const isRecord = (value) => !!value && typeof value === "object" && !Array.isArray(value);
const text = (value) => (typeof value === "string" ? value : "");

// Whether an address is a video's: by its media type, or the extension of
// the file it was kept as.
export const isVideoMedia = (src) =>
  /^data:video\//i.test(src || "") || /\.(webm|mp4|m4v|mov)($|[?&#])/i.test(src || "");

export const MEDIA_KINDS = ["image", "video"];

// An action -- what a character can be seen doing: its name, what kind of
// resource it has, and the resource (a picture or a video, as an address or
// a data URL).
export function coerceAction(value) {
  const from = isRecord(value) ? value : {};
  const media = typeof from.media === "string" ? from.media : "";
  const kind = MEDIA_KINDS.includes(from.kind) ? from.kind : isVideoMedia(media) ? "video" : "image";
  return { name: text(from.name), kind, media };
}

// A list of pictures, whatever it was given: {id, src} records, or bare
// addresses, which take their place in the list as their id.
export function coercePictures(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  return value
    .map((one, index) =>
      typeof one === "string"
        ? { id: String(index), src: one }
        : isRecord(one) && typeof one.src === "string"
          ? { id: String(one.id ?? index), src: one.src }
          : null
    )
    .filter((one) => one && one.src && !seen.has(one.id) && seen.add(one.id));
}

export function coerceReference(value) {
  const r = isRecord(value) ? value : {};
  return { id: text(r.id), name: text(r.name), kind: ["text", "image", "video"].includes(r.kind) ? r.kind : "text", data: text(r.data) };
}
export function coerceCharacter(value) {
  const from = isRecord(value) ? value : {};
  const views = isRecord(from.views) ? from.views : {};
  const appearance = isRecord(from.appearance) ? from.appearance : {};
  const description = text(from.description) || text(appearance.text);
  const sheet = Array.isArray(from.sheet) ? coercePictures(from.sheet) : VIEWS.filter(v => views[v]).map(v => ({src: views[v]}));
  const references = Array.isArray(from.references) ? from.references.map(coerceReference) : [
    ...(description ? [{name: "Description", kind: "text", data: description}] : []),
    ...coercePictures(from.outfits).map((p, i) => ({name: "Outfit " + (i + 1), kind: "image", data: p.src})),
    ...sheet.map((p, i) => ({name: "View " + (i + 1), kind: "image", data: p.src})),
  ];
  const seen = new Set();
  references.forEach((r, i) => { let id = r.id || `r${i}`; while (seen.has(id)) id += "_"; r.id = id; seen.add(id); });
  return { uid: text(from.uid), name: text(from.name), references, actions: (Array.isArray(from.actions) ? from.actions : []).filter(isRecord).map(coerceAction) };
}

export const newUid = () =>
  `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

// The saved entry a run's uid names, or null -- none chosen, or deleted
// since. Through the asker's own store:read.
export const findCharacter = (api, uid) =>
  (uid && api && api.store
    ? api.store.saved("character").find((entry) => coerceCharacter(entry.value).uid === uid)
    : null) || null;

// ---- the ways out -------------------------------------------------------
// Parts in the shape the runner's prompt blocks read: the description, as
// one part. What not to draw is no longer a character's to say.
function promptSentence(character, { role = "" } = {}) {
  return role === "negative" ? "" : coerceCharacter(character).references.filter(r => r.kind === "text").map(r => r.data.trim()).filter(Boolean).join("\n");
}
function promptParts(character, options = {}) {
  const sentence = promptSentence(character, options);
  return sentence ? [{ text: sentence, weight: 1 }] : [];
}
function reference(character) { return Promise.resolve(coerceCharacter(character).references.find(r => r.kind === "image")?.data || ""); }
export const YIELDS = { "value.prompt_list": promptParts, "value.prompt_single": promptSentence, "value.prompt": promptSentence, "value.string": promptSentence, "value.image": reference };
export const hasSheet = character => coerceCharacter(character).references.some(r => r.kind === "image" && r.data);

// ---- pictures (browser only) ---------------------------------------------
const loadImage = (src) =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image did not decode"));
    img.src = src;
  });

// The sides at one height, left to right on white: a reference sheet as an
// edit model expects one. Capped so the sheet stays an upload rather than a
// poster -- four 2048px sides would be an 8000px strip.
const SHEET_HEIGHT = 1024;
const SHEET_MAX_WIDTH = 4096;

// The last sheet drawn, by what it was drawn from: the editor's preview and
// a run straight after it ask for the same one.
let lastSheet = { key: "", url: "" };

export async function composeSheet(sources) {
  const key = sources.map((one) => `${one.length}:${one.slice(-64)}`).join("|");
  if (lastSheet.key === key) return lastSheet.url;
  const images = await Promise.all(sources.map(loadImage));
  const widths = images.map((img) => (img.naturalWidth * SHEET_HEIGHT) / img.naturalHeight);
  const total = widths.reduce((sum, w) => sum + w, 0);
  const scale = Math.min(1, SHEET_MAX_WIDTH / total);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(total * scale);
  canvas.height = Math.round(SHEET_HEIGHT * scale);
  const g = canvas.getContext("2d");
  g.fillStyle = "#ffffff";
  g.fillRect(0, 0, canvas.width, canvas.height);
  let x = 0;
  images.forEach((img, index) => {
    const w = widths[index] * scale;
    g.drawImage(img, x, 0, w, canvas.height);
    x += w;
  });
  const url = canvas.toDataURL("image/png");
  lastSheet = { key, url };
  return url;
}

// About a megabyte a view. The library keeps pictures as files now (see
// backend/blobs.py), so this is no longer what makes a character fit in
// one value -- it keeps four views from being four camera originals, which
// every run would upload whole. One that already fits is kept exactly as it is; one that
// does not is drawn again, as a JPEG, smaller each time until it does.
export const VIEW_MAX_CHARS = 1_400_000;

export async function fitPicture(dataUrl, maxChars = VIEW_MAX_CHARS) {
  if (!dataUrl || dataUrl.length <= maxChars) return dataUrl;
  const img = await loadImage(dataUrl);
  let scale = Math.min(1, 2048 / Math.max(img.naturalWidth, img.naturalHeight));
  for (let tries = 0; tries < 8; tries += 1) {
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const g = canvas.getContext("2d");
    g.fillStyle = "#ffffff";
    g.fillRect(0, 0, canvas.width, canvas.height);
    g.drawImage(img, 0, 0, canvas.width, canvas.height);
    const out = canvas.toDataURL("image/jpeg", 0.9);
    if (out.length <= maxChars) return out;
    scale *= 0.8;
  }
  throw new Error("picture is too large to keep");
}
