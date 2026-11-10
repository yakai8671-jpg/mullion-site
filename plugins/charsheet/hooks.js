/* Four-view Sheet -- a character's front, three-quarter, side and back,
 * drawn in one picture and cut into the four a character keeps.
 *
 * An image generation app like t2i (a declared `workflow.run`, see
 * items/charsheet.json), on Qwen-Image 2512:
 * the prompt says who, and the app adds what makes it a sheet -- the four
 * views in one row, left to right, on white. The picture comes back as
 * the output, and is cut into four equal columns: the `sheet` (a list of
 * four pictures, the shell's `imagelist`), whose list's grip carries it to
 * the Character Editor's sheet.
 *
 * Two engines (the declaration's `config.engines`): Qwen-Image 2512 from words
 * alone, and Qwen-Image-Edit, which also takes a picture of the character
 * (the run settings' reference picture) and keeps to it -- its face, hair
 * and clothes -- drawing it from the four sides. Without a picture the
 * edit engine draws from the words too.
 *
 * A LoRA for sheets helps the four agree. None is shipped or assumed: the
 * template has a second LoRA loader for one, at strength 0 -- where
 * ComfyUI does not load it at all -- so the run works with none installed,
 * and choosing one and raising its strength is all it takes.
 *
 *   charsheet.app     this: run settings, the output, and the sheet cut
 *                     out of it
 *
 * This file holds what the declaration cannot: the sheet words added to a
 * run (`supplies`) and the section that cuts the picture (`sections`), given
 * to the derived item as its hooks.
 */

import { asDataUrl } from "../workflow/runner.js";
import { VIEWS, VIEW_MAX_CHARS, fitPicture } from "../character/model.js";

// What makes the picture a sheet, said after the person's own words. One
// sentence a language model reads (Qwen), not tags. Each view's angle is
// spelled out -- said only by name, the three-quarter view and the profile
// came out as the same side twice.
const VIEW_ORDER =
  "four different angles in a single row, from left to right: " +
  "1) front view, facing the viewer, both eyes visible; " +
  "2) three-quarter view, turned 45 degrees to the viewer's left, both eyes still visible, the far side of the face partly hidden; " +
  "3) side view, a full 90-degree profile facing the viewer's left, only one eye visible; " +
  "4) back view, facing away from the viewer, the face not visible, only the back of the head. " +
  "No two views are the same angle.";
const SHEET_PROMPT =
  "Character turnaround reference sheet of this one character: the same character shown four times, " + VIEW_ORDER + " " +
  "Full body, standing upright in a neutral pose, arms slightly away from the body, the same scale, height and outfit in every view, " +
  "each view centred in its own equal-width column, plain white background, no text, no labels.";
// The same, for a picture to keep to: what is in it is the character, and
// the sheet is made from it rather than made up -- in the picture's own
// medium, so a photograph stays a photograph rather than turning into an
// illustration (the words "redraw" and "drawn" pulled it that way).
const SHEET_FROM_PICTURE =
  "Show the person in the picture from four sides: the same person, with the same face, hair, body and outfit as in the picture, " +
  VIEW_ORDER + " " +
  "Keep the exact visual style and medium of the picture: if it is a photograph, the result is a realistic photograph of the same person " +
  "with the same lighting and realism, not a drawing, not an illustration, not anime; if it is a drawing, the same drawing style. " +
  "Full body, standing upright in a neutral pose, the same scale in every view, " +
  "each view centred in its own equal-width column, plain white background, no text, no labels.";
const SHEET_NEGATIVE = "multiple characters, different outfits, cropped, cut off feet, text, watermark, frames, borders";

// One property of the app as the items API hands it over.
const valueOf = (entry, key) =>
  ((entry && Array.isArray(entry.properties) ? entry.properties : []).find((one) => one.key === key) || {}).value;

const loadImage = (src) =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image did not decode"));
    img.src = src;
  });

// The picture in four equal columns, each kept as a file of the library's
// (a run's picture is an address on the ComfyUI server, which does not
// last), in the order a sheet lists its views.
async function cutSheet(api, src) {
  const img = await loadImage(await asDataUrl(src));
  const w = Math.floor(img.naturalWidth / VIEWS.length);
  const h = img.naturalHeight;
  const sheet = [];
  for (const [index, view] of VIEWS.entries()) {
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    canvas.getContext("2d").drawImage(img, index * w, 0, w, h, 0, 0, w, h);
    const small = await fitPicture(canvas.toDataURL("image/png"), VIEW_MAX_CHARS);
    sheet.push({ id: view, src: await api.store.keepFile(small) });
  }
  return sheet;
}

// What the derived item is given beyond its declaration (`hooks`).
export const items = {
  "charsheet.app": ({ core }) => {
    const { NODES, t } = core;
    const cutting = new Set();
    return {
      supplies: {
        prepare: (_api, app) => ({
          parts: {
            prompts: [
              {
                text: valueOf(app, "engine") === "edit" && valueOf(app, "image") ? SHEET_FROM_PICTURE : SHEET_PROMPT,
                weight: 1,
                sentence: true,
              },
            ],
            negative_prompts: [{ text: SHEET_NEGATIVE, weight: 1, sentence: true }],
          },
        }),
      },
      sections(api, app, ctx) {
        const src = String(ctx.get("output") || "");
        if (src && src !== ctx.get("sheetFrom") && !cutting.has(app.id)) {
          cutting.add(app.id);
          cutSheet(api, src)
            .then((sheet) => {
              ctx.set("sheet", sheet);
              ctx.set("sheetFrom", src);
            })
            .catch((error) => ctx.status(t("charsheet.status.failed", { error: error.message || error })))
            .finally(() => cutting.delete(app.id));
        }
        const has = (ctx.get("sheet") || []).length > 0;
        return [
          NODES.section("sheet", t("charsheet.section.sheet"), [NODES.control("sheet", "sheet")], { hint: t(has ? "charsheet.hint.sheet" : "charsheet.hint.empty") }),
        ];
      },
    };
  },
};
