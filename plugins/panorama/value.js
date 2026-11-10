/* A panorama as a value: the picture, and -- when it has been worked out --
 * the depth of it.
 *
 *   {name, image, depth}
 *
 * `image` is a picture as a picture is held (an address or a data URL);
 * `depth` is the file ComfyUI saved for it (a GLB of the pixels as points,
 * what geometry.js reads), by reference -- {filename, subfolder, type} -- and
 * with `src`, the address of the copy kept here, once it has been copied: it
 * is read from that, so the structure shows with ComfyUI not running.
 * A panorama with no depth is still a panorama -- it is a picture to look
 * around in, and has no floor to stand things on yet. A value with no
 * picture is no value.
 */

export function coercePanorama(value) {
  if (!value || typeof value !== "object") return null;
  const image = typeof value.image === "string" ? value.image : "";
  if (!image) return null;
  // `structure` is what the depth was called before a panorama held it.
  const file = value.depth || value.structure;
  const depth =
    file && typeof file === "object" && typeof file.filename === "string" && file.filename
      ? {
          filename: file.filename,
          subfolder: String(file.subfolder || ""),
          type: String(file.type || "output"),
          // The copy kept here (an address of its own files), once there is one:
          // shown from it, ComfyUI or not.
          ...(typeof file.src === "string" && file.src ? { src: file.src } : {}),
        }
      : null;
  return { name: String(value.name || ""), image, depth };
}

// A panorama is a whole sphere, and a whole sphere is a big picture:
// 2048 wide is several MB as a PNG.
export const PANORAMA_BYTES = 8 * 1024 * 1024;
