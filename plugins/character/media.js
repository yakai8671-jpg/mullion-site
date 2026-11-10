/* Media -- a picture, a video, or a character, and which of the
 * character's actions it is doing: what an object on a stage is made of.
 *
 *   {kind: "image" | "video" | "character", media, character, action}
 *
 * `media` is the picture or video (an address, or a data URL) for the first
 * two; `character` is the whole character, copied in, for the third; and
 * `action` is the name of the character's action being shown ("" is its
 * own, the first). Nothing here draws anything; the control that does is
 * `character.mediainput` (index.js).
 *
 * A character's actions are what it can be seen doing -- each a name and a
 * picture or a video -- so one character is a person who can stand, sit and
 * walk, and an object that is that character shows whichever it is told.
 */

import { MEDIA_KINDS, coerceAction, coerceCharacter, isVideoMedia } from "./model.js";

export { MEDIA_KINDS, coerceAction, isVideoMedia };

const isRecord = (value) => !!value && typeof value === "object" && !Array.isArray(value);

// The empty one, and what it is when something has been put in.
export function coerceMedia(value) {
  const one = isRecord(value) ? value : {};
  const character = isRecord(one.character) ? coerceCharacter(one.character) : null;
  const media = typeof one.media === "string" ? one.media : "";
  if (one.kind === "character" && character) {
    return { kind: "character", media: "", character, action: typeof one.action === "string" ? one.action : "" };
  }
  if (media) return { kind: isVideoMedia(media) ? "video" : "image", media, character: null, action: "" };
  return { kind: "image", media: "", character: null, action: "" };
}

export const hasMedia = (value) => {
  const one = coerceMedia(value);
  return one.kind === "character" ? Boolean(one.character) : Boolean(one.media);
};

// What is shown: the action a character is doing (its own when none is
// named), or -- a character with no action yet -- its front picture.
export function shownOf(value) {
  const one = coerceMedia(value);
  if (one.kind !== "character") return { src: one.media, kind: one.kind };
  const c = one.character;
  const action = c.actions.find((a) => a.name === one.action) || c.actions[0] || null;
  if (action && action.media) return { src: action.media, kind: action.kind };
  const side = c.references.find(r => r.kind === "image" && r.data)?.data || "";
  return { src: side, kind: "image" };
}

// What it is called where a name is wanted.
export const nameOf = (value) => {
  const one = coerceMedia(value);
  return one.kind === "character" && one.character ? one.character.name : "";
};

// ---- carried and put down -------------------------------------------------
// The kind it is carried as is what is in it: a picture goes where a
// picture is wanted, a character where a character is, whatever the
// property it is in.
export const portKindOf = (value) => {
  const one = coerceMedia(value);
  if (one.kind === "character") return one.character ? "character" : null;
  return one.media ? one.kind : null;
};
export const portRead = (value) => {
  const one = coerceMedia(value);
  return one.kind === "character" ? one.character : one.media;
};
export const portWrite = (carried, kind) =>
  kind === "character"
    ? coerceMedia({ kind: "character", character: carried })
    : coerceMedia({ kind: kind === "video" ? "video" : "image", media: String(carried || "") });
