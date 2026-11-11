/* seams: the geometry of the layout tree's seams, with no page (Node can test
 * it as it is: tests/seams.mjs). Where cuts run across a subtree, the bands a
 * seam is drawn in, cutting a subtree along a line and isolating one band of a
 * seam as a split of its own -- the tree surgery a seam drag needs before it
 * starts -- and the snapping of a ratio to guides. Drawing the seams and
 * dragging them is frames'; it calls these. */
import { ratioOf, layoutRoot, setLayoutRoot, isContainer } from "./deps.js";

export const CUT_EPS = 0.001; // ratios are floats; two cuts this close are one cut

export function opposite(dir) {
  return dir === "row" ? "col" : "row";
}

// Where a cut of direction `dir` runs edge to edge across `node`, as
// fractions of node's extent. A col split cuts horizontally, a row split
// vertically; a cut crosses a split of the other direction only if both of
// its children have that same cut, which is what the intersection is.
// A group is a solid rectangle like a leaf: nothing inside it reaches an
// edge, because its tabs are stacked rather than laid out.
export function fullCuts(node, dir) {
  if (!node || node.type !== "split") return [];
  const ratio = ratioOf(node);
  if (node.dir === dir) {
    return [
      ...fullCuts(node.children[0], dir).map((cut) => cut * ratio),
      ratio,
      ...fullCuts(node.children[1], dir).map((cut) => ratio + cut * (1 - ratio)),
    ];
  }
  const other = fullCuts(node.children[1], dir);
  return fullCuts(node.children[0], dir).filter((cut) =>
    other.some((cut2) => Math.abs(cut2 - cut) <= CUT_EPS)
  );
}

// The pieces a seam is drawn in: one per band between consecutive cuts that
// cross both sides. One piece means the seam cannot be broken up.
export function seamSegments(node) {
  const stops = [0, ...fullCuts(node, opposite(node.dir)), 1];
  const segments = [];
  for (let i = 0; i < stops.length - 1; i += 1) segments.push([stops[i], stops[i + 1]]);
  return segments;
}

// The windows that touch one edge of a subtree, over a band of the seam's
// length (fractions of the cross axis, as seamSegments gives them): the
// subtree's last (`edge` "end") or first ("start") windows along `dir`. A
// window or a group is one frame; a split along the axis offers its near
// child; a split across it offers both, each for the part of the band it
// covers.
export function edgeFrames(node, dir, edge, from, to) {
  if (!node) return [];
  if (node.type !== "split") return [node];
  if (node.dir === dir) return edgeFrames(node.children[edge === "end" ? 1 : 0], dir, edge, from, to);
  const ratio = ratioOf(node);
  const found = [];
  if (from < ratio - CUT_EPS) found.push(...edgeFrames(node.children[0], dir, edge, from / ratio, Math.min(to, ratio) / ratio));
  if (to > ratio + CUT_EPS) found.push(...edgeFrames(node.children[1], dir, edge, (Math.max(from, ratio) - ratio) / (1 - ratio), (to - ratio) / (1 - ratio)));
  return found;
}

// Cut a subtree in two along a line that crosses it completely. Leaves are
// reused rather than copied, so window ids and item paths survive.
//
// `eps` is CUT_EPS in this subtree's own coordinates: going down a level
// divides positions by the child's share, and the tolerance with them, so
// "the same cut" means what it meant to fullCuts -- within CUT_EPS of the
// whole. (With a fixed tolerance, two cuts fullCuts had taken for one could
// miss each other deeper down and end in a window: "cannot cut a window".)
export function splitAt(node, dir, pos, eps = CUT_EPS) {
  if (node.type !== "split") throw new Error("cannot cut a window");
  const ratio = ratioOf(node);
  if (node.dir === dir) {
    if (Math.abs(pos - ratio) <= eps) return [node.children[0], node.children[1]];
    if (pos < ratio) {
      const [before, after] = splitAt(node.children[0], dir, pos / ratio, eps / ratio);
      return [
        before,
        // `after` covers [pos, ratio] of a piece that runs to 1.
        { type: "split", dir, ratio: (ratio - pos) / (1 - pos), children: [after, node.children[1]] },
      ];
    }
    const [before, after] = splitAt(node.children[1], dir, (pos - ratio) / (1 - ratio), eps / (1 - ratio));
    return [
      { type: "split", dir, ratio: ratio / pos, children: [node.children[0], before] },
      after,
    ];
  }
  // A cut across the other direction cuts both children at the same place.
  const [a0, b0] = splitAt(node.children[0], dir, pos, eps);
  const [a1, b1] = splitAt(node.children[1], dir, pos, eps);
  return [
    { type: "split", dir: node.dir, ratio, children: [a0, a1] },
    { type: "split", dir: node.dir, ratio, children: [b0, b1] },
  ];
}

// Rewrite `node` so the band between `from` and `to` of its seam is a split
// of its own. Returns the replacement and, inside it, the node the drag is
// now against.
export function isolateSegment(node, from, to) {
  const across = opposite(node.dir);
  const ratio = ratioOf(node);

  // Each side of the seam is cut into up to three bands: above, the one
  // being grabbed, below.
  const slice = (child) => {
    let rest = child;
    let before = null;
    let after = null;
    if (from > CUT_EPS) [before, rest] = splitAt(rest, across, from);
    if (to < 1 - CUT_EPS) [rest, after] = splitAt(rest, across, (to - from) / (1 - from), CUT_EPS / (1 - from));
    return [before, rest, after];
  };
  const [before0, middle0, after0] = slice(node.children[0]);
  const [before1, middle1, after1] = slice(node.children[1]);

  const band = (left, right) => ({ type: "split", dir: node.dir, ratio, children: [left, right] });
  const target = band(middle0, middle1);

  const parts = [];
  if (before0) parts.push({ size: from, node: band(before0, before1) });
  parts.push({ size: to - from, node: target });
  if (after0) parts.push({ size: 1 - to, node: band(after0, after1) });

  // Stack the bands back up, right-leaning, with each ratio the band's
  // share of what is left below it.
  let stacked = parts[parts.length - 1];
  for (let i = parts.length - 2; i >= 0; i -= 1) {
    const part = parts[i];
    stacked = {
      size: part.size + stacked.size,
      node: {
        type: "split",
        dir: across,
        ratio: part.size / (part.size + stacked.size),
        children: [part.node, stacked.node],
      },
    };
  }
  return { replacement: stacked.node, target };
}

// Where a split node sits, by identity. findParent() only knows leaves,
// and the surgery above swaps out an interior node.
export function swapNode(target, replacement) {
  if (layoutRoot() === target) {
    setLayoutRoot(replacement);
    return true;
  }
  const walk = (node) => {
    if (!isContainer(node)) return false;
    for (let i = 0; i < node.children.length; i += 1) {
      if (node.children[i] === target) {
        node.children[i] = replacement;
        return true;
      }
      if (walk(node.children[i])) return true;
    }
    return false;
  };
  return walk(layoutRoot());
}

// The splits from the root down to `target`, nearest last. Null when the
// node is not in the tree.
export function ancestorsOf(target, node = layoutRoot(), trail = []) {
  if (!node || node === target) return node === target ? trail : null;
  if (node.type === "leaf") return null;
  for (const child of node.children) {
    const found = ancestorsOf(target, child, [...trail, node]);
    if (found) return found;
  }
  return null;
}

export function ratioAt(position, geom) {
  return (position - geom.seam / 2) / geom.inner;
}

// The magnet: snap to the best target within `snapDistance` px, then clamp so
// neither pane is under `minPane` px (frames' rules, handed in).
//
// A seam beats a percentage outright, not merely on a tie. They are usually
// a couple of pixels apart -- a neighbour sitting at 50.4% next to the 50%
// guide -- and with the nearer one winning, the round number would keep
// stealing the drag and the two seams could never be made to meet, which is
// the whole point of the magnet. Between two seams, the nearer wins.
export function snapRatio(raw, inner, targets, { snapDistance, minPane }) {
  let ratio = raw;
  let snapped = null;
  let best = Infinity;
  for (const target of targets) {
    const distance = Math.abs(raw - target.ratio) * inner;
    if (distance > snapDistance) continue;
    const beatsKind = snapped === null || (target.align && !snapped.align);
    const sameKind = snapped !== null && target.align === snapped.align;
    if (beatsKind || (sameKind && distance < best)) {
      best = distance;
      ratio = target.ratio;
      snapped = target;
    }
  }
  const min = Math.min(0.5, minPane / inner);
  return { ratio: Math.min(Math.max(ratio, min), 1 - min), snapped };
}
