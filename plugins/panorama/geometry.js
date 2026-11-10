/* The shape of the place in a panorama: floor, ceiling, walls and things.
 *
 * ComfyUI's MoGe-2 panorama node gives how far away every pixel is; the
 * depth app's workflow (template_depth.js) saves the result as the point
 * grid MoGePointMapToMesh makes of it -- a GLB whose vertices are the
 * pixels, row by row, with nothing dropped (discontinuity threshold 0).
 * Everything after that is here, in plain JS with no DOM, so it can be run
 * by itself.
 *
 * The frame is the viewer's: Y up, the middle of the picture straight
 * ahead down -Z, and +X to the right of it. That is also glTF's, which is
 * what MoGe's panorama mesh is written in, so the vertices need no turning.
 * A generated panorama is level -- its horizon runs across the middle --
 * so Y is taken to be up rather than found.
 *
 * What comes out:
 *   planes     flat pieces found by growing regions of pixels that agree on
 *              a plane: the floor (or ground), the ceiling, walls (outdoors,
 *              the faces of buildings), slopes and the tops of things.
 *              Each has a rectangle in its own plane, the mesh of it.
 *   objects    whatever stands on the floor and is not the room itself --
 *              furniture indoors, buildings and the like outdoors: joined
 *              pixels, split where the distance jumps, with a box.
 *   labels     per pixel of the grid: which plane or object it belongs to.
 *
 * MoGe's panorama distances have no scale (per-view scales do not agree
 * across the seams, so the node drops them). Where there is a floor, the
 * camera is taken to be at eye height above it and everything is scaled
 * to that, so what is shown reads in metres -- as a guess.
 */

// ---- reading the GLB -------------------------------------------------------------

// The vertices and the grid they are on. The grid's width is where the
// texture coordinate first steps down a row.
export function readGrid(buffer) {
  const view = new DataView(buffer);
  if (view.getUint32(0, true) !== 0x46546c67) throw new Error("not a GLB file");
  let offset = 12;
  let json = null;
  let bin = null;
  while (offset < view.byteLength) {
    const length = view.getUint32(offset, true);
    const type = view.getUint32(offset + 4, true);
    const start = offset + 8;
    if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, start, length)));
    else if (type === 0x004e4942) bin = start;
    offset = start + length;
  }
  if (!json || bin === null) throw new Error("GLB without its data");
  const attributes = json.meshes[0].primitives[0].attributes;
  const floats = (index, size) => {
    const accessor = json.accessors[index];
    const bufferView = json.bufferViews[accessor.bufferView];
    const at = bin + (bufferView.byteOffset || 0) + (accessor.byteOffset || 0);
    // Copied: the chunk need not sit on a four-byte boundary of the file.
    return new Float32Array(buffer.slice(at, at + accessor.count * size * 4));
  };
  const points = floats(attributes.POSITION, 3);
  const count = points.length / 3;
  let width = count;
  if (attributes.TEXCOORD_0 !== undefined) {
    const uvs = floats(attributes.TEXCOORD_0, 2);
    for (let i = 1; i < count; i += 1) {
      if (uvs[i * 2 + 1] > uvs[1]) {
        width = i;
        break;
      }
    }
  } else {
    width = Math.round(Math.sqrt(count * 2));
  }
  const height = Math.floor(count / width);
  if (width * height !== count || width < 8 || height < 4) throw new Error("GLB is not a point grid");
  return { points, width, height };
}

// ---- the analysis ------------------------------------------------------------------

export const EYE_HEIGHT = 1.6;
const DEG = Math.PI / 180;

// What a label is, for colour and for words.
export const KINDS = ["floor", "ceiling", "wall", "facade", "side", "top", "under", "slope", "object"];
// The label of a sky pixel.
export const SKY = 0xffff;

const DEFAULTS = {
  // How far a pixel's normal may lean from its region's.
  normalTolerance: 12 * DEG,
  // How far off a plane a pixel may lie, as a share of its distance.
  planeTolerance: 0.035,
  // Where the distance jumps by more than this share, it is an edge.
  edge: 0.06,
  // Least share of the sphere a plane or thing covers to be kept.
  minPlane: 0.0006,
  minObject: 0.0004,
  // Within this of level (or of upright), a plane is level (or upright).
  level: 15 * DEG,
};

export function analyse(grid, options = {}) {
  const o = { ...DEFAULTS, ...options };
  const { width: W, height: H } = grid;
  const N = W * H;
  const right = (i) => (i % W === W - 1 ? i - W + 1 : i + 1);
  const left = (i) => (i % W === 0 ? i + W - 1 : i - 1);
  const neighbours = (i) => {
    const row = (i / W) | 0;
    return [left(i), right(i), row > 0 ? i - W : -1, row < H - 1 ? i + W : -1];
  };
  const stack = new Int32Array(N);
  const points = Float32Array.from(grid.points);

  // Distance, and how much of the sphere each pixel is (rows near the
  // poles are narrow).
  const dist = new Float32Array(N);
  for (let i = 0; i < N; i += 1) dist[i] = Math.hypot(points[i * 3], points[i * 3 + 1], points[i * 3 + 2]);
  const rowWeight = new Float32Array(H);
  let sphere = 0;
  for (let y = 0; y < H; y += 1) {
    rowWeight[y] = Math.cos(((y + 0.5) / H - 0.5) * Math.PI);
    sphere += rowWeight[y] * W;
  }
  const weight = (i) => rowWeight[(i / W) | 0] / sphere;
  const shareOf = (members) => members.reduce((acc, i) => acc + weight(i), 0);
  const areaOf = (members) => members.reduce((acc, i) => acc + weight(i) * dist[i] * dist[i], 0);

  const sky = skyOf(dist);
  const jump = (a, b) => Math.abs(dist[a] - dist[b]) > o.edge * Math.min(dist[a], dist[b]);
  const { normal, hasNormal, flatness } = normalsOf(points, sky, W, H, jump, left, right);

  // ---- the ground, and which way is up ----
  // The floor is the one plane there is surely something of below the
  // horizon, facing up. Found by trying planes through three such pixels
  // and keeping the one most of them lie on; its normal is up, which
  // corrects a picture that is not quite level. Everything is turned to
  // stand on it, and turned back when it is handed out.
  const ground = groundOf(points, normal, hasNormal, sky, W, H);
  const up = ground ? ground.normal : [0, 1, 0];
  const turn = rotationTo(up);
  if (ground) {
    turnAll(points, turn);
    turnAll(normal, turn);
  }
  const eye = ground ? -ground.offset : null;
  const scale = eye ? EYE_HEIGHT / eye : 1;
  const floorY = eye ? -eye : null;
  const across = (i) => Math.hypot(points[i * 3], points[i * 3 + 2]);
  // How far off a level plane a pixel may be and still be on it: more the
  // further off it is, as the distances are rougher there.
  const levelTolerance = (i, height) => 0.08 * Math.abs(height) + 0.025 * across(i);

  const label = new Uint8Array(N); // 0 not yet, 1 floor, 2 ceiling, 3 sky
  for (let i = 0; i < N; i += 1) if (sky[i]) label[i] = 3;
  if (floorY !== null) {
    for (let i = 0; i < N; i += 1) {
      if (label[i]) continue;
      const h = points[i * 3 + 1] - floorY;
      const ny = normal[i * 3 + 1];
      const onIt = Math.abs(h) < levelTolerance(i, floorY) && (!hasNormal[i] || ny > Math.cos(50 * DEG));
      // Below the floor and facing up: the far ground, which MoGe lets sag.
      const underIt = h < 0 && hasNormal[i] && ny > Math.cos(35 * DEG);
      if (onIt || underIt) label[i] = 1;
    }
  }

  // ---- the ceiling ----
  // Level, above, facing down, and a good deal of it: its height is where
  // most such pixels are.
  let ceilingY = null;
  {
    const heights = [];
    for (let i = 0; i < N; i += 1) {
      if (label[i] || !hasNormal[i] || normal[i * 3 + 1] > -Math.cos(25 * DEG) || points[i * 3 + 1] <= 0) continue;
      heights.push(points[i * 3 + 1]);
    }
    if (heights.length > N * 0.03) {
      const guess = modeOf(heights);
      const low = eye || guess;
      if (guess > 0.15 * low && guess < 4 * low) ceilingY = guess;
    }
  }
  if (ceilingY !== null) {
    let count = 0;
    for (let i = 0; i < N; i += 1) {
      if (label[i]) continue;
      const h = points[i * 3 + 1] - ceilingY;
      if (Math.abs(h) < levelTolerance(i, ceilingY) && (!hasNormal[i] || normal[i * 3 + 1] < -Math.cos(50 * DEG))) {
        label[i] = 2;
        count += 1;
      }
    }
    if (count < N * 0.02) {
      for (let i = 0; i < N; i += 1) if (label[i] === 2) label[i] = 0;
      ceilingY = null;
    }
  }

  // ---- the rest of the sky ----
  // MoGe does not always see all the sky for what it is, and what it does
  // not it puts high overhead. Outdoors, whatever joins the sky and is far
  // higher than anything standing would be is more sky.
  const outdoors = sky.share > 0.01 && ceilingY === null;
  if (outdoors && eye) {
    const tooHigh = (i) => points[i * 3 + 1] - floorY > 6 * eye && ((i / W) | 0) < H * 0.48;
    let top = 0;
    for (let i = 0; i < N; i += 1) if (label[i] === 3) stack[top++] = i;
    while (top > 0) {
      const i = stack[--top];
      for (const j of neighbours(i)) {
        if (j < 0 || label[j] || !tooHigh(j)) continue;
        label[j] = 3;
        stack[top++] = j;
      }
    }
  }

  // ---- regions of one plane each, from what is left ----
  const region = new Int32Array(N).fill(-1);
  const seeds = [];
  for (let i = 0; i < N; i += 1) if (!label[i] && hasNormal[i] && flatness[i] > 0.97) seeds.push(i);
  seeds.sort((a, b) => flatness[b] - flatness[a]);
  const cosTol = Math.cos(o.normalTolerance);
  const grown = [];
  for (const seed of seeds) {
    if (region[seed] !== -1) continue;
    const id = grown.length;
    const sum = [0, 0, 0, 0, 0, 0];
    let count = 0;
    let n = [normal[seed * 3], normal[seed * 3 + 1], normal[seed * 3 + 2]];
    let offset = dot3(n, points, seed);
    let top = 0;
    stack[top++] = seed;
    region[seed] = id;
    const members = [];
    while (top > 0) {
      const i = stack[--top];
      members.push(i);
      for (let k = 0; k < 3; k += 1) {
        sum[k] += normal[i * 3 + k];
        sum[3 + k] += points[i * 3 + k];
      }
      count += 1;
      // The plane follows the region as it grows, now and then.
      if ((count & (count - 1)) === 0 || count % 512 === 0) {
        n = norm([sum[0], sum[1], sum[2]]);
        offset = (n[0] * sum[3] + n[1] * sum[4] + n[2] * sum[5]) / count;
      }
      for (const j of neighbours(i)) {
        if (j < 0 || region[j] !== -1 || label[j] || !hasNormal[j] || jump(i, j)) continue;
        if (normal[j * 3] * n[0] + normal[j * 3 + 1] * n[1] + normal[j * 3 + 2] * n[2] < cosTol) continue;
        if (Math.abs(dot3(n, points, j) - offset) > o.planeTolerance * dist[j]) continue;
        region[j] = id;
        stack[top++] = j;
      }
    }
    grown.push({ members, ...planeOf(members, points) });
  }

  // Small regions are not planes; their pixels go back to being whatever.
  let planes = grown.filter((one) => (one.share = shareOf(one.members)) >= o.minPlane);
  for (const plane of planes) plane.area = areaOf(plane.members);

  // Which way each faces.
  const sinLevel = Math.sin(o.level);
  const cosLevel = Math.cos(o.level);
  for (const plane of planes) {
    const ny = plane.normal[1];
    plane.label = ny > cosLevel ? "top" : ny < -cosLevel ? "under" : Math.abs(ny) < sinLevel ? "upright" : "slope";
  }

  // A level piece only a little off the floor or the ceiling is more of it
  // -- a rug, a bump in the ground MoGe made -- where a table top is not.
  planes = planes.filter((plane) => {
    const height = plane.offset / plane.normal[1];
    const code =
      plane.label === "top" && floorY !== null && Math.abs(height - floorY) < 0.2 * eye ? 1
      : plane.label === "under" && ceilingY !== null && Math.abs(height - ceilingY) < 0.2 * (ceilingY - floorY) ? 2
      : 0;
    if (code) for (const i of plane.members) label[i] = code;
    return !code;
  });

  // The way the room runs: how its upright planes face, folded onto a
  // quarter turn.
  let cs = 0;
  let sn = 0;
  for (const plane of planes) {
    if (plane.label !== "upright") continue;
    const angle = Math.atan2(plane.normal[2], plane.normal[0]) * 4;
    cs += Math.cos(angle) * plane.area;
    sn += Math.sin(angle) * plane.area;
  }
  const yaw = cs || sn ? Math.atan2(sn, cs) / 4 : 0;
  const axes = { x: [Math.cos(yaw), 0, Math.sin(yaw)], z: [-Math.sin(yaw), 0, Math.cos(yaw)] };

  // An upright plane indoors is a wall if it stands most of the way from
  // floor to ceiling; a shorter one is the side of something. Outdoors,
  // they are the faces of whatever stands there.
  const roomHeight = floorY !== null && ceilingY !== null ? ceilingY - floorY : null;
  for (const plane of planes) {
    if (plane.label !== "upright") continue;
    if (outdoors || roomHeight === null) {
      plane.label = "facade";
      continue;
    }
    const heights = plane.members.map((i) => points[i * 3 + 1]);
    const tall = (quantile(heights, 0.98) - quantile(heights, 0.02)) / roomHeight;
    plane.label = tall > 0.5 ? "wall" : "side";
  }
  planes = mergePlanes(planes, points);

  // The floor and the ceiling are planes too.
  const levelPlane = (code, y, kind) => {
    const members = [];
    for (let i = 0; i < N; i += 1) if (label[i] === code) members.push(i);
    if (!members.length) return null;
    const normalY = kind === "floor" ? 1 : -1;
    return { members, normal: [0, normalY, 0], offset: normalY * y, centroid: [0, y, 0], share: shareOf(members), area: areaOf(members), label: kind };
  };
  const floorPlane = floorY !== null ? levelPlane(1, floorY, "floor") : null;
  const ceilingPlane = ceilingY !== null ? levelPlane(2, ceilingY, "ceiling") : null;
  planes = [floorPlane, ceilingPlane, ...planes].filter(Boolean);

  // Pixels at the edges of a plane that had no normal to go by -- along
  // an edge, at the poles -- belong to it if they lie on it.
  const owner = new Int32Array(N).fill(-1);
  planes.forEach((plane, n) => {
    for (const i of plane.members) owner[i] = n;
  });
  {
    let top = 0;
    for (let i = 0; i < N; i += 1) if (owner[i] !== -1) stack[top++] = i;
    while (top > 0) {
      const i = stack[--top];
      const plane = planes[owner[i]];
      for (const j of neighbours(i)) {
        if (j < 0 || owner[j] !== -1 || label[j] === 3 || jump(i, j)) continue;
        if (Math.abs(dot3(plane.normal, points, j) - plane.offset) > o.planeTolerance * dist[j]) continue;
        owner[j] = owner[i];
        plane.members.push(j);
        stack[top++] = j;
      }
    }
  }

  for (const plane of planes) {
    plane.rect = rectOf(plane, points, axes, plane.label === "wall" ? { floor: floorY, ceiling: ceilingY } : null);
  }

  // ---- things ----
  // Every pixel that is not the room itself or the sky, joined to its
  // neighbours unless the distance jumps between them. The sides and tops
  // of things are planes as well as parts of their thing.
  const isRoom = new Uint8Array(N);
  for (const plane of planes) {
    if (plane.label === "floor" || plane.label === "ceiling" || plane.label === "wall") {
      for (const i of plane.members) isRoom[i] = 1;
    }
  }
  const object = new Int32Array(N).fill(-1);
  let things = [];
  for (let seed = 0; seed < N; seed += 1) {
    if (object[seed] !== -1 || isRoom[seed] || label[seed] === 3) continue;
    const id = things.length;
    const members = [];
    let top = 0;
    stack[top++] = seed;
    object[seed] = id;
    while (top > 0) {
      const i = stack[--top];
      members.push(i);
      for (const j of neighbours(i)) {
        if (j < 0 || object[j] !== -1 || isRoom[j] || label[j] === 3 || jump(i, j)) continue;
        object[j] = id;
        stack[top++] = j;
      }
    }
    things.push({ id, members });
  }
  things = things.filter((thing) => (thing.share = shareOf(thing.members)) >= o.minObject);
  for (const thing of things) thing.box = boxOf(thing.members, points, axes, floorY);
  things.sort((a, b) => b.share - a.share);

  // ---- labels, and what they are ----
  // One per pixel: 0 nothing, 0xffff sky, then the planes, then the things.
  // A plane that is part of a thing keeps its own label, and says which
  // thing it is part of.
  const labels = new Uint16Array(N);
  things.forEach((thing, n) => {
    for (const i of thing.members) labels[i] = 1 + planes.length + n;
  });
  planes.forEach((plane, n) => {
    for (const i of plane.members) labels[i] = 1 + n;
  });
  for (let i = 0; i < N; i += 1) if (label[i] === 3) labels[i] = SKY;

  const back = transpose(turn);
  const turnBack = (corners) => corners.map((p) => apply(back, p));
  const thingLabel = new Map(things.map((thing, n) => [thing.id, 1 + planes.length + n]));
  const entries = [
    ...planes.map((plane, n) => {
      const entry = {
        id: 1 + n,
        kind: plane.label,
        normal: apply(back, plane.normal),
        share: plane.share,
        area: plane.area * scale * scale,
        corners: turnBack(plane.rect.corners),
        size: plane.rect.size.map((one) => one * scale),
      };
      // The thing most of its pixels were joined into.
      if (!isRoom[plane.members[0]]) {
        const votes = new Map();
        for (const i of plane.members) if (object[i] !== -1) votes.set(object[i], (votes.get(object[i]) || 0) + 1);
        let most = 0;
        for (const [id, count] of votes) {
          if (count > most && thingLabel.has(id)) {
            most = count;
            entry.of = thingLabel.get(id);
          }
        }
      }
      return entry;
    }),
    ...things.map((thing, n) => ({
      id: 1 + planes.length + n,
      kind: "object",
      share: thing.share,
      corners: turnBack(thing.box.corners),
      size: thing.box.size.map((one) => one * scale),
    })),
  ];

  let skyShare = 0;
  for (let i = 0; i < N; i += 1) if (label[i] === 3) skyShare += weight(i);
  return {
    width: W,
    height: H,
    labels,
    dist,
    entries,
    scale,
    outdoors,
    up,
    eye: eye ? EYE_HEIGHT : null,
    roomHeight: roomHeight ? roomHeight * scale : null,
    sky: skyShare,
  };
}

// Normals, facing the camera, from the neighbours across each pixel --
// none where that crosses an edge or the sky, or at the poles -- smoothed
// over a few pixels; how well they agreed there is how flat it is.
function normalsOf(points, sky, W, H, jump, left, right) {
  const N = W * H;
  const normal = new Float32Array(N * 3);
  const hasNormal = new Uint8Array(N);
  for (let y = 1; y < H - 1; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const i = y * W + x;
      if (sky[i]) continue;
      const l = left(i), r = right(i), u = i - W, d = i + W;
      if (sky[l] || sky[r] || sky[u] || sky[d] || jump(l, r) || jump(u, d) || jump(i, l) || jump(i, u)) continue;
      const ax = points[r * 3] - points[l * 3], ay = points[r * 3 + 1] - points[l * 3 + 1], az = points[r * 3 + 2] - points[l * 3 + 2];
      const bx = points[d * 3] - points[u * 3], by = points[d * 3 + 1] - points[u * 3 + 1], bz = points[d * 3 + 2] - points[u * 3 + 2];
      let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
      const len = Math.hypot(nx, ny, nz);
      if (!(len > 0)) continue;
      if (nx * points[i * 3] + ny * points[i * 3 + 1] + nz * points[i * 3 + 2] > 0) {
        nx = -nx;
        ny = -ny;
        nz = -nz;
      }
      normal[i * 3] = nx / len;
      normal[i * 3 + 1] = ny / len;
      normal[i * 3 + 2] = nz / len;
      hasNormal[i] = 1;
    }
  }
  const flatness = smoothNormals(normal, hasNormal, W, H, 2);
  return { normal, hasNormal, flatness };
}

// The ground plane: below the horizon, facing up, the plane through three
// such pixels that the most of the others lie on, then fitted to those.
// Null when there is too little of it to go by.
function groundOf(points, normal, has, sky, W, H) {
  const candidates = [];
  for (let y = Math.ceil(H * 0.53); y < H - 1; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const i = y * W + x;
      if (!sky[i] && has[i] && normal[i * 3 + 1] > Math.cos(30 * DEG)) candidates.push(i);
    }
  }
  if (candidates.length < W * H * 0.01) return null;
  const sample = candidates.filter((_, n) => n % 7 === 0);
  const fits = (n, offset, i) => {
    const across = Math.hypot(points[i * 3], points[i * 3 + 2]);
    return Math.abs(dot3(n, points, i) - offset) < 0.06 * Math.abs(offset) + 0.02 * across;
  };
  // A fixed sequence, so the same picture always comes out the same.
  let random = 12345;
  const pick = () => {
    random = (random * 1103515245 + 12345) & 0x7fffffff;
    return candidates[random % candidates.length];
  };
  let best = null;
  for (let k = 0; k < 300; k += 1) {
    const a = pick(), b = pick(), c = pick();
    const pa = [points[a * 3], points[a * 3 + 1], points[a * 3 + 2]];
    const u = [points[b * 3] - pa[0], points[b * 3 + 1] - pa[1], points[b * 3 + 2] - pa[2]];
    const v = [points[c * 3] - pa[0], points[c * 3 + 1] - pa[1], points[c * 3 + 2] - pa[2]];
    let n = norm(cross(u, v));
    if (n[1] < 0) n = [-n[0], -n[1], -n[2]];
    if (!(n[1] > Math.cos(20 * DEG))) continue;
    const offset = dot(n, pa);
    if (!(offset < 0)) continue;
    let score = 0;
    for (const i of sample) if (fits(n, offset, i)) score += 1;
    if (!best || score > best.score) best = { normal: n, offset, score };
  }
  if (!best) return null;
  let plane = best;
  for (let k = 0; k < 3; k += 1) {
    const members = candidates.filter((i) => fits(plane.normal, plane.offset, i));
    if (members.length < 16) break;
    const fitted = planeOf(members, points);
    let n = fitted.normal;
    if (n[1] < 0) n = [-n[0], -n[1], -n[2]];
    plane = { normal: n, offset: dot(n, fitted.centroid) };
  }
  return plane.offset < 0 ? plane : null;
}

// The most common of some values, to a hundredth of their spread.
function modeOf(values) {
  const lo = quantile(values, 0.02);
  const hi = quantile(values, 0.98);
  const bins = new Float32Array(102);
  const step = (hi - lo) / 100 || 1;
  for (const v of values) {
    const k = Math.floor((v - lo) / step);
    if (k >= 0 && k < 100) bins[k + 1] += 1;
  }
  let best = 1;
  const around = (k) => bins[k - 1] + bins[k] + bins[k + 1];
  for (let k = 2; k <= 100; k += 1) if (around(k) > around(best)) best = k;
  return lo + (best - 0.5) * step;
}

// The turn that takes `up` to +Y, as a 3x3 matrix by rows (Rodrigues,
// about up x Y).
function rotationTo(up) {
  const [x, y, z] = norm(up);
  const s = Math.hypot(x, z);
  if (s < 1e-9) return [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const k = [-z / s, 0, x / s];
  const c = y;
  const t = 1 - c;
  return [
    t * k[0] * k[0] + c, -s * k[2], t * k[0] * k[2],
    s * k[2], c, -s * k[0],
    t * k[0] * k[2], s * k[0], t * k[2] * k[2] + c,
  ];
}
const apply = (m, p) => [m[0] * p[0] + m[1] * p[1] + m[2] * p[2], m[3] * p[0] + m[4] * p[1] + m[5] * p[2], m[6] * p[0] + m[7] * p[1] + m[8] * p[2]];
const transpose = (m) => [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];
function turnAll(values, m) {
  for (let i = 0; i < values.length; i += 3) {
    const x = values[i], y = values[i + 1], z = values[i + 2];
    values[i] = m[0] * x + m[1] * y + m[2] * z;
    values[i + 1] = m[3] * x + m[4] * y + m[5] * z;
    values[i + 2] = m[6] * x + m[7] * y + m[8] * z;
  }
}
const dot3 = (n, points, i) => n[0] * points[i * 3] + n[1] * points[i * 3 + 1] + n[2] * points[i * 3 + 2];

// The sky has no distance: MoGe puts every pixel it did not see as ground
// at the one far value, five times the 95th percentile. So the sky is the
// pixels at the very greatest distance -- when there are enough of them.
function skyOf(dist) {
  let far = 0;
  for (const d of dist) if (d > far) far = d;
  const sky = new Uint8Array(dist.length);
  let count = 0;
  for (let i = 0; i < dist.length; i += 1) {
    if (dist[i] >= far * 0.999) {
      sky[i] = 1;
      count += 1;
    }
  }
  if (count < dist.length * 0.002) {
    sky.fill(0);
    count = 0;
  }
  // By pixels, which overstates the rows near the top a little: only its
  // being there at all is used.
  sky.share = count / dist.length;
  return sky;
}

// A box blur of the normals, wrapping across the back; returns how long the
// averaged normal is before normalising -- 1 where they all agreed.
function smoothNormals(normal, has, W, H, radius) {
  const N = W * H;
  const tmp = new Float32Array(N * 4);
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      let sx = 0, sy = 0, sz = 0, c = 0;
      for (let k = -radius; k <= radius; k += 1) {
        const j = y * W + ((x + k + W) % W);
        if (!has[j]) continue;
        sx += normal[j * 3];
        sy += normal[j * 3 + 1];
        sz += normal[j * 3 + 2];
        c += 1;
      }
      const i = y * W + x;
      tmp[i * 4] = sx;
      tmp[i * 4 + 1] = sy;
      tmp[i * 4 + 2] = sz;
      tmp[i * 4 + 3] = c;
    }
  }
  const flat = new Float32Array(N);
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const i = y * W + x;
      if (!has[i]) continue;
      let sx = 0, sy = 0, sz = 0, c = 0;
      for (let k = -radius; k <= radius; k += 1) {
        const yy = y + k;
        if (yy < 0 || yy >= H) continue;
        const j = yy * W + x;
        sx += tmp[j * 4];
        sy += tmp[j * 4 + 1];
        sz += tmp[j * 4 + 2];
        c += tmp[j * 4 + 3];
      }
      const len = Math.hypot(sx, sy, sz);
      normal[i * 3] = sx / len;
      normal[i * 3 + 1] = sy / len;
      normal[i * 3 + 2] = sz / len;
      flat[i] = c ? len / c : 0;
    }
  }
  return flat;
}

// The plane through some points: the centroid, and the normal of least
// spread (the smallest eigenvector of the covariance, by a few rounds of
// inverse iteration). Facing the camera, as the pixel normals do.
function planeOf(members, points) {
  let cx = 0, cy = 0, cz = 0;
  for (const i of members) {
    cx += points[i * 3];
    cy += points[i * 3 + 1];
    cz += points[i * 3 + 2];
  }
  const n = members.length;
  cx /= n;
  cy /= n;
  cz /= n;
  let xx = 0, xy = 0, xz = 0, yy = 0, yz = 0, zz = 0;
  for (const i of members) {
    const dx = points[i * 3] - cx, dy = points[i * 3 + 1] - cy, dz = points[i * 3 + 2] - cz;
    xx += dx * dx;
    xy += dx * dy;
    xz += dx * dz;
    yy += dy * dy;
    yz += dy * dz;
    zz += dz * dz;
  }
  const normal = smallestAxis([xx, xy, xz, xy, yy, yz, xz, yz, zz]);
  if (normal[0] * cx + normal[1] * cy + normal[2] * cz > 0) {
    normal[0] = -normal[0];
    normal[1] = -normal[1];
    normal[2] = -normal[2];
  }
  return { normal, centroid: [cx, cy, cz], offset: normal[0] * cx + normal[1] * cy + normal[2] * cz };
}

function smallestAxis(m) {
  // Inverse iteration on m + a little, from a start that is not in the
  // plane of the other two.
  const e = 1e-9 * (m[0] + m[4] + m[8] + 1e-12);
  const a = [m[0] + e, m[1], m[2], m[3], m[4] + e, m[5], m[6], m[7], m[8] + e];
  const det =
    a[0] * (a[4] * a[8] - a[5] * a[7]) - a[1] * (a[3] * a[8] - a[5] * a[6]) + a[2] * (a[3] * a[7] - a[4] * a[6]);
  const inv = [
    (a[4] * a[8] - a[5] * a[7]) / det,
    (a[2] * a[7] - a[1] * a[8]) / det,
    (a[1] * a[5] - a[2] * a[4]) / det,
    (a[5] * a[6] - a[3] * a[8]) / det,
    (a[0] * a[8] - a[2] * a[6]) / det,
    (a[2] * a[3] - a[0] * a[5]) / det,
    (a[3] * a[7] - a[4] * a[6]) / det,
    (a[1] * a[6] - a[0] * a[7]) / det,
    (a[0] * a[4] - a[1] * a[3]) / det,
  ];
  let v = [0.57, 0.58, 0.577];
  for (let k = 0; k < 24; k += 1) {
    const w = [
      inv[0] * v[0] + inv[1] * v[1] + inv[2] * v[2],
      inv[3] * v[0] + inv[4] * v[1] + inv[5] * v[2],
      inv[6] * v[0] + inv[7] * v[1] + inv[8] * v[2],
    ];
    const len = Math.hypot(w[0], w[1], w[2]) || 1;
    v = [w[0] / len, w[1] / len, w[2] / len];
  }
  return v;
}

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => {
  const len = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / len, a[1] / len, a[2] / len];
};

function quantile(values, q) {
  if (!values.length) return 0;
  const sorted = Float32Array.from(values).sort();
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(q * (sorted.length - 1))))];
}

// The rectangle a plane's pixels cover, in the plane: level planes along
// the room's axes, upright ones along the floor and up, slopes along the
// fall line. Its corners are on the plane, not on the pixels -- the plane
// is what is being shown. Walls may be told the floor and ceiling to run to.
function rectOf(plane, points, axes, reach = null) {
  const n = plane.normal;
  let s;
  let t;
  if (Math.abs(n[1]) > 0.9) {
    s = axes.x;
    t = axes.z;
  } else {
    s = norm(cross([0, 1, 0], n));
    t = norm(cross(n, s));
  }
  const us = [];
  const vs = [];
  for (const i of plane.members) {
    const p = [points[i * 3], points[i * 3 + 1], points[i * 3 + 2]];
    us.push(dot(p, s));
    vs.push(dot(p, t));
  }
  const u0 = quantile(us, 0.01), u1 = quantile(us, 0.99);
  let v0 = quantile(vs, 0.01), v1 = quantile(vs, 0.99);
  // Upright: t is up, so v is height.
  if (reach && Math.abs(n[1]) < 0.3) {
    if (reach.floor !== null) v0 = reach.floor;
    if (reach.ceiling !== null) v1 = reach.ceiling;
  }
  const origin = [n[0] * plane.offset, n[1] * plane.offset, n[2] * plane.offset];
  const at = (u, v) => [0, 1, 2].map((k) => origin[k] + s[k] * u + t[k] * v);
  return { corners: [at(u0, v0), at(u1, v0), at(u1, v1), at(u0, v1)], size: [u1 - u0, v1 - v0] };
}

// Pieces of one wall, joined: the same plane, cut apart by what stands in
// front of it. Only walls -- two buildings whose fronts line up are two.
function mergePlanes(planes, points) {
  const parent = planes.map((_, n) => n);
  const find = (n) => (parent[n] === n ? n : (parent[n] = find(parent[n])));
  for (let a = 0; a < planes.length; a += 1) {
    for (let b = a + 1; b < planes.length; b += 1) {
      const p = planes[a];
      const q = planes[b];
      if (p.label !== "wall" || q.label !== "wall") continue;
      if (dot(p.normal, q.normal) < Math.cos(8 * DEG)) continue;
      const range = Math.max(Math.abs(p.offset), Math.abs(q.offset), 1e-6);
      if (Math.abs(p.offset - q.offset) > 0.05 * range) continue;
      parent[find(b)] = find(a);
    }
  }
  const groups = new Map();
  planes.forEach((plane, n) => {
    const root = find(n);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(plane);
  });
  const merged = [];
  for (const group of groups.values()) {
    if (group.length === 1) {
      merged.push(group[0]);
      continue;
    }
    const members = group.flatMap((one) => one.members);
    merged.push({
      members,
      ...planeOf(members, points),
      label: group[0].label,
      share: group.reduce((acc, one) => acc + one.share, 0),
      area: group.reduce((acc, one) => acc + one.area, 0),
    });
  }
  merged.sort((a, b) => b.share - a.share);
  return merged;
}

// A thing's box along the room's axes, down to the floor if it is near it.
function boxOf(members, points, axes, floorY) {
  const xs = [];
  const ys = [];
  const zs = [];
  for (const i of members) {
    const p = [points[i * 3], points[i * 3 + 1], points[i * 3 + 2]];
    xs.push(dot(p, axes.x));
    ys.push(p[1]);
    zs.push(dot(p, axes.z));
  }
  const x0 = quantile(xs, 0.02), x1 = quantile(xs, 0.98);
  let y0 = quantile(ys, 0.02);
  const y1 = quantile(ys, 0.98);
  const z0 = quantile(zs, 0.02), z1 = quantile(zs, 0.98);
  if (floorY !== null && Math.abs(y0 - floorY) < 0.15 * -floorY) y0 = floorY;
  const at = (x, y, z) => [0, 1, 2].map((k) => axes.x[k] * x + (k === 1 ? y : 0) + axes.z[k] * z);
  return {
    corners: [
      at(x0, y0, z0), at(x1, y0, z0), at(x1, y0, z1), at(x0, y0, z1),
      at(x0, y1, z0), at(x1, y1, z0), at(x1, y1, z1), at(x0, y1, z1),
    ],
    size: [x1 - x0, y1 - y0, z1 - z0],
  };
}
