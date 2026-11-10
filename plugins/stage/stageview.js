/* The stage: a panorama seen from its centre, with pictures standing in it.
 *
 * The panorama viewer does the background (and the structure over it, if
 * asked); this adds sprites -- a picture on an upright card, turned to
 * face the camera -- at places in the room. What makes it a room rather
 * than a picture with stickers on it is the depth: every pixel of the
 * panorama knows how far away it is (geometry.js), so a sprite's pixel
 * that lies further off than the panorama's pixel in the same direction is
 * behind something -- a wall, a sofa -- and is not drawn.
 *
 * Positions are in metres, in the frame of the floor: x to the right of
 * straight ahead, z towards the camera, y up from the floor. The camera
 * stands at eye height over the floor's origin (the depth is scaled to
 * that, see EYE_HEIGHT), and the floor's up is the one the analysis found,
 * so a picture that is not quite level still has its sprites standing
 * straight on its floor.
 *
 * The distances come as a float texture, which needs WebGL2; on WebGL1 the
 * sprites are drawn over everything.
 *
 * A sprite may be a video (a prop's action can be): it plays silently and
 * on a loop, and while one is on the stage every frame is drawn, each
 * taking the video's current picture.
 *
 * Two things keep a sprite from looking pasted on. Its colours are leaned
 * towards the room's (blend): the average colour of the panorama around
 * where it stands, against the average colour of the sprite itself, gives a
 * gain per channel -- a warm room warms the person in it, a dark one darkens
 * them -- and the half-transparent fringe of a cut-out, which holds the
 * colour of wherever it was cut from, is pulled to the room's colour. And a
 * soft shadow lies on the floor under it, so it stands on something. The
 * depth itself can be looked at (showDepth): a colour for each pixel's
 * distance, laid over the picture.
 */

import { PanoramaView } from "../panorama/viewer.js";

const RAD = Math.PI / 180;

const SPRITE_VERTEX = `
attribute vec2 a_corner;
varying vec2 v_uv;
varying vec3 v_world;
uniform vec3 u_base;
uniform vec3 u_right;
uniform vec3 u_up;
uniform vec2 u_size;
uniform float u_yaw;
uniform float u_pitch;
uniform vec2 u_tan;
void main() {
  v_uv = vec2(a_corner.x + 0.5, 1.0 - a_corner.y);
  vec3 w = u_base + u_right * (a_corner.x * u_size.x) + u_up * (a_corner.y * u_size.y);
  v_world = w;
  float cy = cos(u_yaw), sy = sin(u_yaw);
  vec3 p = vec3(w.x * cy + w.z * sy, w.y, -w.x * sy + w.z * cy);
  float cp = cos(u_pitch), sp = sin(u_pitch);
  p = vec3(p.x, p.y * cp + p.z * sp, -p.y * sp + p.z * cp);
  float near = 0.001;
  float depth = -p.z;
  gl_Position = vec4(p.x / u_tan.x, p.y / u_tan.y, depth - 2.0 * near, depth);
}`;

// Behind the panorama's own surface in that direction, a pixel is hidden --
// or, for the sprite being edited, a faint ghost, so it can still be found.
const SPRITE_FRAGMENT = `
precision highp float;
varying vec2 v_uv;
varying vec3 v_world;
uniform sampler2D u_tex;
uniform sampler2D u_depth;
uniform float u_hasDepth;
uniform float u_selected;
uniform float u_blend;
uniform vec3 u_gain;
uniform vec3 u_ambient;
uniform vec3 u_right;
uniform vec3 u_up;
uniform vec3 u_light;
uniform float u_lightAmount;
uniform vec3 u_lightTint;
uniform sampler2D u_pano;
uniform vec2 u_edge;
const float PI = 3.14159265358979;
void main() {
  vec4 colour = texture2D(u_tex, v_uv);
  if (colour.a < 0.05) discard;
  float alpha = colour.a;
  // Where this pixel looks into the panorama: what is behind it.
  float d = length(v_world);
  vec3 dir = v_world / d;
  float lon = atan(dir.x, -dir.z);
  float lat = asin(clamp(dir.y, -1.0, 1.0));
  vec2 uv = vec2(fract(lon / (2.0 * PI) + 0.5), 0.5 - lat / PI);
  if (u_hasDepth > 0.5) {
    float wall = texture2D(u_depth, uv).r;
    if (d > wall * 1.03) {
      if (u_selected < 0.5) discard;
      alpha *= 0.25;
    }
  }
  vec3 rgb = colour.rgb;
  if (u_blend > 0.5) {
    rgb = clamp(rgb * u_gain, 0.0, 1.0);
    // The fringe holds the colour of what it was cut out of.
    rgb = mix(rgb, u_ambient, (1.0 - colour.a) * 0.75);
    // A card has no shape; give it a rounded one -- a cylinder across, a
    // little leaning back at the top -- and light that by the room's light:
    // the side towards the light brighter, the far side darker.
    vec3 front = normalize(cross(u_right, u_up));
    float across = (v_uv.x - 0.5) * 2.0;
    float lift = 0.5 - v_uv.y;
    vec3 n = normalize(u_right * across * 0.9 + front * sqrt(max(0.0, 1.0 - across * across)) + u_up * lift * 0.6);
    float lam = max(dot(n, u_light), 0.0);
    // Seen from the front, a card lit from the side is lit on about a third
    // of it on average, so that is where it is left as it is.
    float shade = clamp(1.0 + u_lightAmount * (lam - 0.33) * 1.5, 0.6, 1.4);
    rgb = clamp(rgb * shade * mix(vec3(1.0), u_lightTint, lam * u_lightAmount * 0.5), 0.0, 1.0);

    // The boundary. How near the picture's edge this pixel is, from the
    // least opaque of the pixels a screen pixel and a half round it; there
    // the colour is the panorama's own behind it (what a real edge catches
    // of its surroundings) and the pixel is let through a little, with the
    // faint rim of a cut-out tightened first.
    float aMin = min(
      min(texture2D(u_tex, v_uv + vec2(u_edge.x, 0.0)).a, texture2D(u_tex, v_uv - vec2(u_edge.x, 0.0)).a),
      min(texture2D(u_tex, v_uv + vec2(0.0, u_edge.y)).a, texture2D(u_tex, v_uv - vec2(0.0, u_edge.y)).a)
    );
    float edge = clamp(1.0 - min(aMin, colour.a), 0.0, 1.0);
    alpha = smoothstep(0.08, 0.92, alpha);
    rgb = mix(rgb, texture2D(u_pano, uv).rgb, edge * 0.6);
    alpha *= 1.0 - edge * 0.3;
  }
  if (u_selected > 0.5) rgb = mix(rgb, vec3(1.0, 0.85, 0.3), 0.12);
  gl_FragColor = vec4(rgb, alpha);
}`;

// A soft dark patch on the floor: a square of the floor's own axes, a
// round falloff in it, hidden behind the panorama's surface like a sprite.
const SHADOW_VERTEX = `
attribute vec2 a_corner;
varying vec2 v_p;
varying vec3 v_world;
uniform vec3 u_base;
uniform vec3 u_ex;
uniform vec3 u_ez;
uniform float u_radius;
uniform float u_yaw;
uniform float u_pitch;
uniform vec2 u_tan;
void main() {
  v_p = a_corner;
  vec3 w = u_base + u_ex * (a_corner.x * u_radius) + u_ez * (a_corner.y * u_radius);
  v_world = w;
  float cy = cos(u_yaw), sy = sin(u_yaw);
  vec3 p = vec3(w.x * cy + w.z * sy, w.y, -w.x * sy + w.z * cy);
  float cp = cos(u_pitch), sp = sin(u_pitch);
  p = vec3(p.x, p.y * cp + p.z * sp, -p.y * sp + p.z * cp);
  float near = 0.001;
  float depth = -p.z;
  gl_Position = vec4(p.x / u_tan.x, p.y / u_tan.y, depth - 2.0 * near, depth);
}`;

const SHADOW_FRAGMENT = `
precision highp float;
varying vec2 v_p;
varying vec3 v_world;
uniform sampler2D u_depth;
uniform float u_hasDepth;
uniform float u_strength;
uniform float u_fade;
uniform vec3 u_colour;
const float PI = 3.14159265358979;
void main() {
  float r = length(v_p);
  if (r >= 1.0) discard;
  if (u_hasDepth > 0.5) {
    float d = length(v_world);
    vec3 dir = v_world / d;
    float lon = atan(dir.x, -dir.z);
    float lat = asin(clamp(dir.y, -1.0, 1.0));
    vec2 uv = vec2(fract(lon / (2.0 * PI) + 0.5), 0.5 - lat / PI);
    if (d > texture2D(u_depth, uv).r * 1.03) discard;
  }
  // Along the patch (+x is away from the foot) it thins out.
  float fade = mix(1.0, u_fade, clamp((v_p.x + 1.0) * 0.5, 0.0, 1.0));
  float a = pow(1.0 - r, 1.7) * u_strength * fade;
  gl_FragColor = vec4(u_colour, a);
}`;

// The panorama's distances as colours, over the picture: near is warm, far
// is cool (Google's polynomial fit of the turbo map), spread on a log scale
// between the near and far the picture has.
const DEPTH_VERTEX = `
attribute vec2 a_pos;
varying vec2 v_ndc;
void main() {
  v_ndc = a_pos;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

const DEPTH_FRAGMENT = `
precision highp float;
varying vec2 v_ndc;
uniform sampler2D u_depth;
uniform float u_yaw;
uniform float u_pitch;
uniform vec2 u_tan;
uniform vec2 u_range;
uniform float u_mix;
const float PI = 3.14159265358979;
vec3 turbo(float x) {
  const vec4 kR = vec4(0.13572138, 4.61539260, -42.66032258, 132.13108234);
  const vec4 kG = vec4(0.09140261, 2.19418839, 4.84296658, -14.18503333);
  const vec4 kB = vec4(0.10667330, 12.64194608, -60.58204836, 110.36276771);
  const vec2 kR2 = vec2(-152.94239396, 59.28637943);
  const vec2 kG2 = vec2(4.27729857, 2.82956604);
  const vec2 kB2 = vec2(-89.90310912, 27.34824973);
  x = clamp(x, 0.0, 1.0);
  vec4 v4 = vec4(1.0, x, x * x, x * x * x);
  vec2 v2 = v4.zw * v4.z;
  return clamp(vec3(dot(v4, kR) + dot(v2, kR2), dot(v4, kG) + dot(v2, kG2), dot(v4, kB) + dot(v2, kB2)), 0.0, 1.0);
}
void main() {
  vec3 d = normalize(vec3(v_ndc * u_tan, -1.0));
  float cp = cos(u_pitch), sp = sin(u_pitch);
  d = vec3(d.x, d.y * cp - d.z * sp, d.y * sp + d.z * cp);
  float cy = cos(u_yaw), sy = sin(u_yaw);
  d = vec3(d.x * cy - d.z * sy, d.y, d.x * sy + d.z * cy);
  float lon = atan(d.x, -d.z);
  float lat = asin(clamp(d.y, -1.0, 1.0));
  vec2 uv = vec2(fract(lon / (2.0 * PI) + 0.5), 0.5 - lat / PI);
  float metres = max(texture2D(u_depth, uv).r, u_range.x);
  float t = 1.0 - clamp(log(metres / u_range.x) / log(u_range.y / u_range.x), 0.0, 1.0);
  gl_FragColor = vec4(turbo(t), u_mix);
}`;

// How far the sampled patch of the room reaches round a sprite (radians).
const AMBIENT_LON = 0.5;
const AMBIENT_LAT = 0.4;
// How far a sprite's colours go towards the room's, and how far at most.
const BLEND_STRENGTH = 0.6;
const GAIN_MIN = 0.75;
const GAIN_MAX = 1.35;
// The depth's colours, against the picture under them.
const DEPTH_MIX = 0.85;
const clamp = (value, lo, hi) => Math.min(hi, Math.max(lo, value));

// The average colour of a picture (squares, so it is the light and not the
// numbers that are averaged), where it is not transparent. [r, g, b] in 0..1,
// or null for a picture that cannot be read (a tainted canvas).
function meanColour(source, width, height) {
  try {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(source, 0, 0, width, height);
    const data = ctx.getImageData(0, 0, width, height).data;
    const sum = [0, 0, 0];
    let total = 0;
    for (let i = 0; i < data.length; i += 4) {
      const a = data[i + 3] / 255;
      if (a < 0.5) continue;
      for (let k = 0; k < 3; k += 1) sum[k] += (data[i + k] / 255) ** 2;
      total += 1;
    }
    return total ? sum.map((one) => Math.sqrt(one / total)) : null;
  } catch (error) {
    return null;
  }
}

export class StageView extends PanoramaView {
  constructor(canvas, options = {}) {
    super(canvas, options);
    const gl = this.gl;
    this.spriteProgram = this.link(SPRITE_VERTEX, SPRITE_FRAGMENT);
    this.spriteUniforms = Object.fromEntries(
      [
        "u_base", "u_right", "u_up", "u_size", "u_yaw", "u_pitch", "u_tan", "u_tex", "u_depth", "u_hasDepth", "u_selected",
        "u_blend", "u_gain", "u_ambient", "u_light", "u_lightAmount", "u_lightTint", "u_pano", "u_edge",
      ].map((name) => [name, gl.getUniformLocation(this.spriteProgram, name)])
    );
    this.cornerAt = gl.getAttribLocation(this.spriteProgram, "a_corner");
    this.corners = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.corners);
    // Bottom-centre at the origin, one unit wide and tall.
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-0.5, 0, 0.5, 0, 0.5, 1, -0.5, 0, 0.5, 1, -0.5, 1]), gl.STATIC_DRAW);

    this.shadowProgram = this.link(SHADOW_VERTEX, SHADOW_FRAGMENT);
    this.shadowUniforms = Object.fromEntries(
      ["u_base", "u_ex", "u_ez", "u_radius", "u_yaw", "u_pitch", "u_tan", "u_depth", "u_hasDepth", "u_strength", "u_fade", "u_colour"].map(
        (name) => [name, gl.getUniformLocation(this.shadowProgram, name)]
      )
    );
    this.shadowCornerAt = gl.getAttribLocation(this.shadowProgram, "a_corner");
    this.shadowCorners = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.shadowCorners);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1]), gl.STATIC_DRAW);

    this.depthProgram = this.link(DEPTH_VERTEX, DEPTH_FRAGMENT);
    this.depthUniforms = Object.fromEntries(
      ["u_depth", "u_yaw", "u_pitch", "u_tan", "u_range", "u_mix"].map((name) => [
        name,
        gl.getUniformLocation(this.depthProgram, name),
      ])
    );
    this.depthAt = gl.getAttribLocation(this.depthProgram, "a_pos");

    this.depthTexture = gl.createTexture();
    this.hasDepth = false;
    this.depthRange = [0.5, 30];
    this.showDepth = false;
    // Sprites take on the room's colours and cast a shadow, unless told not.
    this.blend = true;
    // The panorama shrunk to a few thousand pixels, to read the room's
    // colour from; and what has been worked out from it so far.
    this.ambient = null;
    this.ambientCache = new Map();
    // Which way the room's light comes from (see estimateLight).
    this.light = { ...NO_LIGHT };
    this.sprites = [];
    // Pictures by address, loaded once each.
    this.pictures = new Map();
    this.floor = { up: [0, 1, 0], eye: 1.6 };
  }

  // The panorama's distances, in metres (the analysis of geometry.js), and
  // the floor they stand on. Null for none: sprites are then drawn over
  // everything, on a floor taken to be level at eye height below.
  setDepth(result) {
    const gl = this.gl;
    if (!gl) return;
    this.floor = { up: result && result.up ? result.up : [0, 1, 0], eye: (result && result.eye) || 1.6 };
    this.hasDepth = false;
    const webgl2 = typeof WebGL2RenderingContext !== "undefined" && gl instanceof WebGL2RenderingContext;
    if (result && webgl2) {
      const metres = new Float32Array(result.dist.length);
      for (let i = 0; i < metres.length; i += 1) metres[i] = result.dist[i] * result.scale;
      this.depthRange = rangeOf(metres);
      gl.bindTexture(gl.TEXTURE_2D, this.depthTexture);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, result.width, result.height, 0, gl.RED, gl.FLOAT, metres);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      this.hasDepth = true;
    }
    this.draw();
  }

  // Whether the panorama's distances are shown, as colours over it. Only
  // where there are distances to show (WebGL2).
  setShowDepth(on) {
    this.showDepth = Boolean(on);
    this.draw();
  }

  // Whether the sprites are brought into the room's colours and shadowed.
  setBlend(on) {
    this.blend = on !== false;
    this.draw();
  }

  // The picture is on the sphere: keep it shrunk, to read the room's colour
  // from.
  imageLoaded(source) {
    this.ambientCache.clear();
    this.ambient = null;
    try {
      const width = 128;
      const height = 64;
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(source, 0, 0, width, height);
      this.ambient = { width, height, data: ctx.getImageData(0, 0, width, height).data };
      this.light = estimateLight(this.ambient);
    } catch (error) {
      // A picture the page may not read: sprites are shadowed, not tinted.
      this.ambient = null;
      this.light = { ...NO_LIGHT };
    }
  }

  // The room's colour around a direction (in the view's frame): the average
  // of the patch of the panorama there, [r, g, b] in 0..1, or null.
  ambientAt(point) {
    if (!this.ambient) return null;
    const len = Math.hypot(point[0], point[1], point[2]) || 1;
    const d = [point[0] / len, point[1] / len, point[2] / len];
    const key = `${d[0].toFixed(2)},${d[1].toFixed(2)},${d[2].toFixed(2)}`;
    if (this.ambientCache.has(key)) return this.ambientCache.get(key);
    const { width, height, data } = this.ambient;
    const lon0 = Math.atan2(d[0], -d[2]);
    const lat0 = Math.asin(clamp(d[1], -1, 1));
    // The patch is wider across when it is near a pole.
    const lonSpan = Math.min(Math.PI, AMBIENT_LON / Math.max(0.2, Math.cos(lat0)));
    const sum = [0, 0, 0];
    let total = 0;
    for (let y = 0; y < height; y += 1) {
      const lat = (0.5 - (y + 0.5) / height) * Math.PI;
      if (Math.abs(lat - lat0) > AMBIENT_LAT) continue;
      const weight = Math.cos(lat);
      for (let x = 0; x < width; x += 1) {
        const lon = ((x + 0.5) / width - 0.5) * 2 * Math.PI;
        let across = Math.abs(lon - lon0);
        if (across > Math.PI) across = 2 * Math.PI - across;
        if (across > lonSpan) continue;
        const i = (y * width + x) * 4;
        for (let k = 0; k < 3; k += 1) sum[k] += (data[i + k] / 255) ** 2 * weight;
        total += weight;
      }
    }
    const colour = total ? sum.map((one) => Math.sqrt(one / total)) : null;
    this.ambientCache.set(key, colour);
    return colour;
  }

  // The depth as colours over the picture, before the lines.
  drawBackdrop(tanX, tanY) {
    const gl = this.gl;
    if (!this.showDepth || !this.hasDepth) return;
    const u = this.depthUniforms;
    gl.useProgram(this.depthProgram);
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.enableVertexAttribArray(this.depthAt);
    gl.vertexAttribPointer(this.depthAt, 2, gl.FLOAT, false, 0, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.depthTexture);
    gl.uniform1i(u.u_depth, 1);
    gl.uniform1f(u.u_yaw, this.view.yaw * RAD);
    gl.uniform1f(u.u_pitch, this.view.pitch * RAD);
    gl.uniform2f(u.u_tan, tanX, tanY);
    gl.uniform2f(u.u_range, this.depthRange[0], this.depthRange[1]);
    gl.uniform1f(u.u_mix, DEPTH_MIX);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.disableVertexAttribArray(this.depthAt);
    gl.disable(gl.BLEND);
    gl.activeTexture(gl.TEXTURE0);
  }

  // The floor's frame in the view's: up, and two level axes.
  floorAxes() {
    const up = norm(this.floor.up);
    const ez = norm(sub([0, 0, 1], scale(up, up[2])));
    const ex = cross(up, ez);
    return { up, ex, ez };
  }

  // A place on the floor (x, y, z in the floor's frame) in the view's.
  toView([x, y, z]) {
    const { up, ex, ez } = this.floorAxes();
    const lift = y - this.floor.eye;
    return [0, 1, 2].map((k) => ex[k] * x + up[k] * lift + ez[k] * z);
  }

  // A point in the view's frame, in the floor's.
  toFloor(p) {
    const { up, ex, ez } = this.floorAxes();
    return [dot(p, ex), dot(p, up) + this.floor.eye, dot(p, ez)];
  }

  // What stands where: [{src, video, at: [x, y, z] on the floor, height,
  // selected}].
  // A sprite's width is its picture's, to scale.
  setSprites(sprites) {
    this.sprites = sprites || [];
    for (const sprite of this.sprites) this.pictureFor(sprite.src, sprite.video);
    // A video no sprite shows any more stops playing.
    const shown = new Set(this.sprites.map((one) => one.src));
    for (const [src, entry] of this.pictures) {
      if (entry.video && !shown.has(src)) entry.video.pause();
      else if (entry.video && entry.video.paused) entry.video.play().catch(() => {});
    }
    this.draw();
  }

  newTexture() {
    const gl = this.gl;
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    return texture;
  }

  // Its frame now, into its texture. Straight alpha, as a PNG holds it.
  // `mips` for a still picture on WebGL2: shrunk, it is then averaged
  // rather than picked from, which is what keeps an edge from crawling.
  upload(entry, source, mips = false) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, entry.texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    if (mips && this.repeat) {
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    }
  }

  pictureFor(src, video = false) {
    if (!src || this.pictures.has(src)) return this.pictures.get(src) || null;
    const entry = { texture: null, aspect: 1 };
    this.pictures.set(src, entry);
    if (video) {
      const element = Object.assign(document.createElement("video"), {
        src,
        muted: true,
        loop: true,
        playsInline: true,
        crossOrigin: "anonymous",
      });
      element.addEventListener("loadeddata", () => {
        if (!this.gl) return;
        entry.aspect = element.videoWidth / Math.max(1, element.videoHeight);
        entry.mean = meanColour(element, 48, Math.max(1, Math.round(48 / entry.aspect)));
        entry.texture = this.newTexture();
        this.upload(entry, element);
        this.draw();
      });
      element.addEventListener("error", () => {
        entry.failed = true;
      });
      entry.video = element;
      element.play().catch(() => {});
      return entry;
    }
    const image = new Image();
    image.decoding = "async";
    image.src = src;
    image
      .decode()
      .then(() => {
        if (!this.gl) return;
        entry.aspect = image.naturalWidth / Math.max(1, image.naturalHeight);
        entry.mean = meanColour(image, 48, Math.max(1, Math.round(48 / entry.aspect)));
        entry.texture = this.newTexture();
        // The colour of the picture carried out under its transparent
        // pixels: filtered, an edge then blends with its own colour and
        // not with the black or white the file keeps there.
        this.upload(entry, bled(image) || image, true);
        this.draw();
      })
      .catch(() => {
        entry.failed = true;
      });
    return entry;
  }

  render() {
    super.render();
    const gl = this.gl;
    if (!gl || !this.hasImage || !this.sprites.length) return;
    const { width, height } = this.canvas;
    const tan = Math.tan((this.view.fov * RAD) / 2);
    const long = Math.max(width, height);
    const u = this.spriteUniforms;
    const { up } = this.floorAxes();

    gl.useProgram(this.spriteProgram);
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.corners);
    gl.enableVertexAttribArray(this.cornerAt);
    gl.vertexAttribPointer(this.cornerAt, 2, gl.FLOAT, false, 0, 0);
    gl.uniform1f(u.u_yaw, this.view.yaw * RAD);
    gl.uniform1f(u.u_pitch, this.view.pitch * RAD);
    gl.uniform2f(u.u_tan, (tan * width) / long, (tan * height) / long);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.depthTexture);
    gl.uniform1i(u.u_depth, 1);
    gl.uniform1f(u.u_hasDepth, this.hasDepth ? 1 : 0);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.uniform1i(u.u_pano, 2);
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform1i(u.u_tex, 0);
    const s = this.shadowUniforms;
    gl.useProgram(this.shadowProgram);
    gl.uniform1f(s.u_yaw, this.view.yaw * RAD);
    gl.uniform1f(s.u_pitch, this.view.pitch * RAD);
    gl.uniform2f(s.u_tan, (tan * width) / long, (tan * height) / long);
    gl.uniform1i(s.u_depth, 1);
    gl.uniform1f(s.u_hasDepth, this.hasDepth ? 1 : 0);
    gl.useProgram(this.spriteProgram);

    // Far to near, so the nearer ones are blended over the further.
    const placed = this.sprites
      .map((sprite) => ({ sprite, base: this.toView(sprite.at), picture: this.pictures.get(sprite.src) }))
      .filter((one) => one.picture && one.picture.texture)
      .sort((a, b) => Math.hypot(...b.base) - Math.hypot(...a.base));
    let playing = false;
    for (const { sprite, base, picture } of placed) {
      // A video's picture now; and another frame to come after this one.
      if (picture.video && picture.video.readyState >= 2) {
        this.upload(picture, picture.video);
        playing = playing || !picture.video.paused;
      }
      // Turned to face the camera about its own upright axis, so it stands
      // up however it is looked at.
      const toCamera = scale(base, -1);
      const level = sub(toCamera, scale(up, dot(toCamera, up)));
      const right = norm(cross(up, level.every((one) => Math.abs(one) < 1e-6) ? [0, 0, 1] : level));
      const wide = sprite.height * picture.aspect;

      // The room's colour round it, and the gain that takes the sprite's
      // average towards it.
      let ambient = null;
      let gain = [1, 1, 1];
      if (this.blend) {
        ambient = this.ambientAt(base.map((one, k) => one + up[k] * sprite.height * 0.5));
        if (ambient && picture.mean) {
          gain = [0, 1, 2].map((k) =>
            clamp((ambient[k] / Math.max(picture.mean[k], 0.04)) ** BLEND_STRENGTH, GAIN_MIN, GAIN_MAX)
          );
        }
        this.drawShadow(sprite, base, wide, ambient);
        gl.useProgram(this.spriteProgram);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.corners);
        gl.enableVertexAttribArray(this.cornerAt);
        gl.vertexAttribPointer(this.cornerAt, 2, gl.FLOAT, false, 0, 0);
      }
      gl.uniform1f(u.u_blend, ambient && picture.mean ? 1 : 0);
      gl.uniform3fv(u.u_gain, gain);
      gl.uniform3fv(u.u_ambient, ambient || [0, 0, 0]);
      const { dir, amount, colour } = this.light;
      const luma = Math.max(0.05, 0.2126 * colour[0] + 0.7152 * colour[1] + 0.0722 * colour[2]);
      gl.uniform3fv(u.u_light, dir);
      gl.uniform1f(u.u_lightAmount, amount);
      gl.uniform3fv(u.u_lightTint, colour.map((one) => clamp(one / luma, 0.75, 1.25)));
      gl.bindTexture(gl.TEXTURE_2D, picture.texture);
      gl.uniform3fv(u.u_base, base);
      gl.uniform3fv(u.u_right, right);
      gl.uniform3fv(u.u_up, up);
      gl.uniform2f(u.u_size, wide, sprite.height);
      // A screen pixel and a half, in the picture's own coordinates.
      const perMetre = long / (2 * tan * Math.max(0.1, Math.hypot(...base)));
      gl.uniform2f(u.u_edge, 1.5 / Math.max(4, wide * perMetre), 1.5 / Math.max(4, sprite.height * perMetre));
      gl.uniform1f(u.u_selected, sprite.selected ? 1 : 0);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }
    gl.disableVertexAttribArray(this.cornerAt);
    gl.disable(gl.BLEND);
    if (playing) this.draw();
  }

  // What lies on the floor under a sprite, in a dark tint of the room's own
  // colour: a tight dark patch where it stands (the contact, fainter the
  // higher off the floor it is) and, when the room's light has a side, the
  // shadow it throws away from that light, as long as the light is low.
  drawShadow(sprite, base, wide, ambient) {
    const { up, ex, ez } = this.floorAxes();
    const foot = this.toView([sprite.at[0], 0, sprite.at[2]]);
    const lift = Math.max(0, sprite.at[1]);
    const colour = ambient ? ambient.map((one) => one * 0.15) : [0, 0, 0];
    const radius = Math.max(wide * 0.5, sprite.height * 0.18);
    const { dir, amount } = this.light;

    const high = dot(dir, up);
    const across = sub(dir, scale(up, high));
    const flat = Math.hypot(across[0], across[1], across[2]);
    // How far the top of the sprite's shadow falls: its height times how
    // far the light is round from straight above. Low sun, long shadow.
    const reach = amount > 0 && flat > 1e-3 ? Math.min(sprite.height * 2.2, (sprite.height * flat) / Math.max(high, 0.15)) * amount : 0;
    if (reach > radius * 0.3) {
      const away = scale(across, -1 / flat);
      const side = cross(up, away);
      // Off the floor, the shadow lands further on, by the same slope.
      const shift = (lift * flat) / Math.max(high, 0.15);
      const half = reach / 2 + radius;
      const centre = [0, 1, 2].map((k) => foot[k] + away[k] * (reach / 2 + shift));
      this.shadowPatch(centre, scale(away, half), scale(side, radius * 0.85), (0.5 + 0.5 * amount) * 0.65 / (1 + lift * 1.5), 0.35, colour);
    }
    this.shadowPatch(foot, scale(ex, radius * 0.75), scale(ez, radius * 0.75), 0.8 / (1 + lift * 4), 1, colour);
  }

  // A soft patch on the floor, as the square of its two axes (view frame)
  // about `centre`, thinning from the first axis' + end by `fade`.
  shadowPatch(centre, axisA, axisB, strength, fade, colour) {
    const gl = this.gl;
    const s = this.shadowUniforms;
    gl.useProgram(this.shadowProgram);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.shadowCorners);
    gl.enableVertexAttribArray(this.shadowCornerAt);
    gl.vertexAttribPointer(this.shadowCornerAt, 2, gl.FLOAT, false, 0, 0);
    gl.uniform3fv(s.u_base, centre);
    gl.uniform3fv(s.u_ex, axisA);
    gl.uniform3fv(s.u_ez, axisB);
    gl.uniform1f(s.u_radius, 1);
    gl.uniform1f(s.u_strength, strength);
    gl.uniform1f(s.u_fade, fade);
    gl.uniform3fv(s.u_colour, colour);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.disableVertexAttribArray(this.shadowCornerAt);
  }

  dispose() {
    for (const entry of this.pictures.values()) {
      if (entry.video) {
        entry.video.pause();
        entry.video.removeAttribute("src");
      }
    }
    this.pictures.clear();
    super.dispose();
  }
}

// Which way the light in a room comes from, read off its panorama: the
// brightest few percent of what is at or above the horizon (a window, a
// lamp, the sky through a door) -- where they are on average, and what colour.
// `amount` is how much it is one light from one side: 0 for an evenly lit
// room, up to 1 for a single bright window in a dim room. dir is in the
// view's frame, towards the light; with no light to speak of it is straight up.
const NO_LIGHT = { dir: [0, 1, 0], amount: 0, colour: [1, 1, 1] };
function estimateLight({ width, height, data }) {
  const lum = new Float32Array(width * height);
  const weight = new Float32Array(height);
  let wsum = 0;
  let mean = 0;
  for (let y = 0; y < height; y += 1) {
    weight[y] = Math.cos((0.5 - (y + 0.5) / height) * Math.PI);
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      const [r, g, b] = [data[i] / 255, data[i + 1] / 255, data[i + 2] / 255];
      const l = Math.sqrt(0.2126 * r * r + 0.7152 * g * g + 0.0722 * b * b);
      lum[y * width + x] = l;
      mean += l * weight[y];
      wsum += weight[y];
    }
  }
  mean /= wsum;
  // The level above which lie the brightest 4% of the sphere's area.
  const bins = new Float32Array(64);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) bins[Math.min(63, Math.floor(lum[y * width + x] * 64))] += weight[y];
  }
  let above = 0;
  let level = 63;
  while (level > 0 && above + bins[level] < wsum * 0.04) above += bins[level--];
  const threshold = level / 64;

  const sum = [0, 0, 0];
  const colour = [0, 0, 0];
  let total = 0;
  let bright = 0;
  let area = 0;
  for (let y = 0; y < height; y += 1) {
    const lat = (0.5 - (y + 0.5) / height) * Math.PI;
    // Below the horizon is the floor's, lit by the light, not a light.
    if (lat < -0.09) continue;
    for (let x = 0; x < width; x += 1) {
      const l = lum[y * width + x];
      if (l < threshold) continue;
      const lon = ((x + 0.5) / width - 0.5) * 2 * Math.PI;
      const w = (l - threshold + 0.02) * weight[y];
      sum[0] += w * Math.cos(lat) * Math.sin(lon);
      sum[1] += w * Math.sin(lat);
      sum[2] += w * -Math.cos(lat) * Math.cos(lon);
      const i = (y * width + x) * 4;
      for (let k = 0; k < 3; k += 1) colour[k] += w * (data[i + k] / 255) ** 2;
      total += w;
      bright += l * weight[y];
      area += weight[y];
    }
  }
  const length = Math.hypot(sum[0], sum[1], sum[2]);
  if (!total || !length || !area) return { ...NO_LIGHT };
  const contrast = clamp(((bright / area - mean) / (bright / area + 0.05)) * 1.4, 0, 1);
  const amount = contrast * clamp((length / total) * 1.3, 0, 1);
  if (amount < 0.08) return { ...NO_LIGHT };
  return {
    dir: [sum[0] / length, sum[1] / length, sum[2] / length],
    amount,
    colour: colour.map((one) => Math.sqrt(one / total)),
  };
}

// A picture as straight-alpha pixels with the colour of its edge carried
// outwards a few pixels into what is transparent (a canvas keeps nothing
// under alpha 0, so it is done on the pixels). Null for a picture with
// nothing transparent in it, or one that cannot be read -- it is then
// uploaded as it is.
const BLEED_PIXELS = 4;
const BLEED_MAX = 1536;
function bled(image) {
  try {
    const k = Math.min(1, BLEED_MAX / Math.max(image.naturalWidth, image.naturalHeight));
    const w = Math.max(1, Math.round(image.naturalWidth * k));
    const h = Math.max(1, Math.round(image.naturalHeight * k));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(image, 0, 0, w, h);
    const picture = ctx.getImageData(0, 0, w, h);
    const px = picture.data;
    let have = new Uint8Array(w * h);
    let hollow = 0;
    for (let i = 0; i < have.length; i += 1) {
      if (px[i * 4 + 3] > 8) have[i] = 1;
      else hollow += 1;
    }
    if (!hollow || hollow === have.length) return null;
    for (let pass = 0; pass < BLEED_PIXELS; pass += 1) {
      const next = have.slice();
      for (let y = 0; y < h; y += 1) {
        for (let x = 0; x < w; x += 1) {
          const i = y * w + x;
          if (have[i]) continue;
          let r = 0, g = 0, b = 0, n = 0;
          for (let dy = -1; dy <= 1; dy += 1) {
            const yy = y + dy;
            if (yy < 0 || yy >= h) continue;
            for (let dx = -1; dx <= 1; dx += 1) {
              const xx = x + dx;
              if (xx < 0 || xx >= w) continue;
              const j = yy * w + xx;
              if (!have[j]) continue;
              r += px[j * 4];
              g += px[j * 4 + 1];
              b += px[j * 4 + 2];
              n += 1;
            }
          }
          if (n) {
            px[i * 4] = r / n;
            px[i * 4 + 1] = g / n;
            px[i * 4 + 2] = b / n;
            next[i] = 1;
          }
        }
      }
      have = next;
    }
    return picture;
  } catch (error) {
    return null;
  }
}

// Where most of a picture's distances lie, for the depth's colours: from
// the nearer end to the far, leaving out the odd one at either end (and the
// sky, which is as far as the model likes).
function rangeOf(metres) {
  const step = Math.max(1, Math.floor(metres.length / 20000));
  const sample = [];
  for (let i = 0; i < metres.length; i += step) if (Number.isFinite(metres[i]) && metres[i] > 0) sample.push(metres[i]);
  if (!sample.length) return [0.5, 30];
  sample.sort((a, b) => a - b);
  const near = Math.max(0.2, sample[Math.floor(sample.length * 0.02)]);
  const far = Math.max(near * 1.5, sample[Math.min(sample.length - 1, Math.floor(sample.length * 0.98))]);
  return [near, far];
}

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => {
  const len = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / len, a[1] / len, a[2] / len];
};

// Where in the view's frame a place in the picture (u across, v down, as
// PanoramaView.pickAt gives it) looks: the viewer's own mapping, reversed.
export function directionOf({ u, v }) {
  const lon = (u - 0.5) * 2 * Math.PI;
  const lat = (0.5 - v) * Math.PI;
  return [Math.cos(lat) * Math.sin(lon), Math.sin(lat), -Math.cos(lat) * Math.cos(lon)];
}
