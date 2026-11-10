/* Media -- what a string that names a file is, read off the string.
 *
 * A picture, a video, a voice, a text can each be held several ways: the bytes
 * themselves (a data URL), a file the library keeps (backend/blobs.py), an
 * address that serves one (ComfyUI's /view, a file the server hands out), or a
 * place on this disk. Which way, and what the file is, is in the string --
 * never stored beside it, so the two cannot disagree. This is the one place
 * that reads it; the value types (image, video, audio), the controls and the
 * port conversions ask here instead of each keeping a list of extensions.
 *
 *   locate(value) -> { scheme, media, mime, ext, name, bytes } | null
 *
 *   scheme  "data"    the bytes themselves, as a data URL
 *           "kept"    where the library keeps them (named by their content)
 *           "served"  an address on this server or another one
 *           "disk"    a place on this disk, as a drive path or a share (`C:\x\a.png`)
 *   media   "image" | "video" | "audio" | "text" | "" (a folder, or nothing known)
 *   mime    the media type, "" where nothing says
 *   ext     the file's extension, lower case, no dot
 *   name    the file's name, where the string has one
 *   bytes   how many, where the string says (a data URL, a kept file); else null
 */

import { qs } from "./deps.js";

const TYPES = {
  image: {
    png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp",
    svg: "image/svg+xml", bmp: "image/bmp", ico: "image/x-icon", avif: "image/avif",
  },
  video: {
    webm: "video/webm", mp4: "video/mp4", m4v: "video/mp4", mov: "video/quicktime", mkv: "video/x-matroska",
  },
  audio: {
    mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg", flac: "audio/flac", m4a: "audio/mp4", weba: "audio/webm",
  },
  text: Object.fromEntries(
    ["txt", "md", "markdown", "json", "csv", "tsv", "log", "xml", "html", "css", "js", "mjs", "cjs", "ts", "py", "yaml", "yml", "ini", "toml", "abc"].map((ext) => [ext, "text/plain"])
  ),
};

const KIND_OF_EXTENSION = {};
for (const [media, table] of Object.entries(TYPES)) for (const ext of Object.keys(table)) KIND_OF_EXTENSION[ext] = media;

// A file name's extension, lower case.
export const extensionOf = (name) => ((String(name || "").match(/\.([a-z0-9]+)$/i) || [])[1] || "").toLowerCase();

// What a file name says it is: its media and media type.
export function mediaOfName(name) {
  const ext = extensionOf(name);
  const media = KIND_OF_EXTENSION[ext] || "";
  return { media, mime: media ? TYPES[media][ext] : "", ext };
}

const DATA_URL = /^data:((image|video|audio)\/[a-z0-9.+-]+);base64,([a-z0-9+/]*={0,2})$/i;
// backend/blobs.py: named by content, the size and the kind in the name.
const KEPT = /^\/api\/blob\?name=[0-9a-f]{24}-(\d+)\.([a-z0-9]+)$/;
const SERVED = /^(?:\/(?!\/)|https?:\/\/)\S+$/i;
const DISK = /^(?:[a-z]:[\\/]|\\\\)/i;

const baseName = (path) => String(path).split(/[\\/]/).pop();

// The file an address serves: a ComfyUI /view carries its name as `filename`, a
// file the server hands out as `path`, anything else ends with it.
function servedName(address) {
  try {
    const url = new URL(address, "http://address.invalid/");
    return baseName(url.searchParams.get("filename") || url.searchParams.get("path") || url.pathname);
  } catch {
    return "";
  }
}

export function locate(value) {
  if (typeof value !== "string" || !value) return null;
  const data = DATA_URL.exec(value);
  if (data) {
    const encoded = data[3];
    const padding = encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0;
    const mime = data[1].toLowerCase();
    const ext = mime.split("/")[1].replace("svg+xml", "svg").replace("jpeg", "jpg");
    return { scheme: "data", media: data[2].toLowerCase(), mime, ext, name: "", bytes: Math.floor((encoded.length * 3) / 4) - padding };
  }
  const kept = KEPT.exec(value);
  if (kept) {
    const found = mediaOfName(`.${kept[2]}`);
    return { scheme: "kept", media: found.media, mime: found.mime, ext: found.ext, name: "", bytes: Number(kept[1]) };
  }
  if (SERVED.test(value)) {
    const name = servedName(value);
    const found = mediaOfName(name);
    return { scheme: "served", media: found.media, mime: found.mime, ext: found.ext, name, bytes: null };
  }
  if (DISK.test(value)) {
    const name = baseName(value);
    const found = mediaOfName(name);
    return { scheme: "disk", media: found.media, mime: found.mime, ext: found.ext, name, bytes: null };
  }
  return null;
}

// Where the server hands a file on this disk out.
export const diskAddress = (path) => `/api/fs/download?${qs({ path })}`;
