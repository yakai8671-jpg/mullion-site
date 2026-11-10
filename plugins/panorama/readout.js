/* What the structure over a panorama says, in words: the legend (which
 * colour is what, how many) and what is under the pointer. Drawn by
 * whatever view shows the structure; kept here so there is one way of
 * saying it.
 */

import { colourOf, pick } from "./structure.js";

const KIND_ORDER = ["floor", "ceiling", "wall", "facade", "object", "sky"];

// The legend: a swatch and a word for each kind found, and a line on the
// scale. `loaded` is what loadStructure resolved to, or null for none.
export function fillLegend(legend, loaded, t) {
  legend.replaceChildren();
  legend.hidden = !loaded;
  if (!loaded) return;
  const { result } = loaded;
  for (const kind of KIND_ORDER) {
    const entries = result.entries.filter((one) => one.kind === kind);
    const count = kind === "sky" ? (result.sky > 0.005 ? 1 : 0) : entries.length;
    if (!count) continue;
    const colour = kind === "sky" ? [140, 200, 255] : colourOf(result, entries[0]);
    const row = document.createElement("div");
    const swatch = Object.assign(document.createElement("span"), { className: "panorama-swatch" });
    swatch.style.background = `rgb(${colour.join(",")})`;
    const words = count > 1 ? t("panorama.structure.count", { kind: t(`panorama.kind.${kind}`), n: count }) : t(`panorama.kind.${kind}`);
    row.append(swatch, document.createTextNode(words));
    legend.append(row);
  }
  const scale = document.createElement("div");
  scale.className = "panorama-legend-note";
  scale.textContent = result.eye
    ? result.roomHeight
      ? t("panorama.structure.scaleRoom", { eye: result.eye, room: result.roomHeight.toFixed(1) })
      : t("panorama.structure.scale", { eye: result.eye })
    : t("panorama.structure.noScale");
  legend.append(scale);
}

// What is under the pointer at `at` ({u, v}): its kind, its size and how
// far off it is. "" for nothing worth a word.
export function tipText(loaded, at, t) {
  if (!at || !loaded) return "";
  const { result } = loaded;
  const found = pick(result, at.u, at.v);
  if (found.sky) return t("panorama.kind.sky");
  const entry = found.entry;
  if (!entry) return "";
  const parts = [];
  const thing = entry.of ? result.byId.get(entry.of) : null;
  parts.push(
    thing
      ? `${t(`panorama.kind.${entry.kind}`)} · ${t("panorama.kind.object")} ${thing.rank + 1}`
      : `${t(`panorama.kind.${entry.kind}`)}${entry.kind === "wall" || entry.kind === "facade" || entry.kind === "object" ? ` ${entry.rank + 1}` : ""}`
  );
  if (result.eye && entry.size) {
    const size = entry.kind === "object" ? [entry.size[0], entry.size[2], entry.size[1]] : entry.size;
    parts.push(size.map((one) => one.toFixed(1)).join(" × ") + " m");
  }
  if (result.eye) parts.push(t("panorama.structure.away", { m: found.distance.toFixed(1) }));
  return parts.join(" · ");
}
