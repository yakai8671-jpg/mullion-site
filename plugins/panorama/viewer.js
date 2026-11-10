/* The 360° viewer: an equirectangular picture seen from inside.
 *
 * No three.js. Looking around a sphere from its centre does not need a
 * sphere: every pixel of the canvas is a direction, and a direction is a
 * longitude and a latitude, which is exactly how an equirectangular
 * picture is addressed. So it is one triangle over the canvas and a
 * fragment shader that turns each pixel into a place in the picture --
 * no mesh, no seam where a mesh's texture coordinates would wrap, and the
 * whole of it fits here.
 *
 * The view is three numbers: yaw and pitch in degrees, and the field of
 * view across the longer side of the canvas -- across the width in a wide
 * window, so a short strip of a window does not look through more than
 * half the sphere at once. Yaw 0 looks at the middle of the picture.
 *
 * Over the picture it can lay the structure found in it (structure.js):
 * a second picture of the same shape, a colour for what each pixel is,
 * mixed in by the same shader; and lines in the room's own space -- the
 * outlines of floor, ceiling and walls and the boxes of things -- drawn by
 * a second program that turns the view the other way and projects.
 */

const VERTEX = `
attribute vec2 a_pos;
varying vec2 v_ndc;
void main() {
  v_ndc = a_pos;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

const FRAGMENT = `
precision highp float;
varying vec2 v_ndc;
uniform sampler2D u_tex;
uniform sampler2D u_overlay;
uniform float u_overlayOn;
uniform float u_yaw;
uniform float u_pitch;
uniform vec2 u_tan;
const float PI = 3.14159265358979;
void main() {
  vec3 d = normalize(vec3(v_ndc * u_tan, -1.0));
  float cp = cos(u_pitch), sp = sin(u_pitch);
  d = vec3(d.x, d.y * cp - d.z * sp, d.y * sp + d.z * cp);
  float cy = cos(u_yaw), sy = sin(u_yaw);
  d = vec3(d.x * cy - d.z * sy, d.y, d.x * sy + d.z * cy);
  float lon = atan(d.x, -d.z);
  float lat = asin(clamp(d.y, -1.0, 1.0));
  vec2 uv = vec2(fract(lon / (2.0 * PI) + 0.5), 0.5 - lat / PI);
  vec4 colour = texture2D(u_tex, uv);
  vec4 over = texture2D(u_overlay, uv) * u_overlayOn;
  gl_FragColor = vec4(mix(colour.rgb, over.rgb, over.a), 1.0);
}`;

// A point in the room, as seen from the centre: the view's turn undone
// (yaw, then pitch), then a perspective with the same field of view the
// picture is drawn with. w is the depth, so the GPU clips what is behind.
const LINE_VERTEX = `
attribute vec3 a_pos;
attribute vec3 a_colour;
varying vec3 v_colour;
uniform float u_yaw;
uniform float u_pitch;
uniform vec2 u_tan;
void main() {
  v_colour = a_colour;
  float cy = cos(u_yaw), sy = sin(u_yaw);
  vec3 p = vec3(a_pos.x * cy + a_pos.z * sy, a_pos.y, -a_pos.x * sy + a_pos.z * cy);
  float cp = cos(u_pitch), sp = sin(u_pitch);
  p = vec3(p.x, p.y * cp + p.z * sp, -p.y * sp + p.z * cp);
  float near = 0.001;
  float w = -p.z;
  gl_Position = vec4(p.x / u_tan.x, p.y / u_tan.y, w - 2.0 * near, w);
}`;

const LINE_FRAGMENT = `
precision mediump float;
varying vec3 v_colour;
void main() {
  gl_FragColor = vec4(v_colour, 0.9);
}`;

export const FOV_MIN = 30;
export const FOV_MAX = 120;
export const DEFAULT_VIEW = { yaw: 0, pitch: 0, fov: 90 };

const clamp = (value, lo, hi) => Math.min(hi, Math.max(lo, value));
const RAD = Math.PI / 180;
// Degrees a second when turning by itself: a full turn a minute.
const AUTO_SPEED = 6;

export class PanoramaView {
  // `onView(view)` is told when the person has moved the view and let go,
  // so whoever keeps the view can keep it without being told every frame.
  constructor(canvas, { onView, onHover, onClick } = {}) {
    this.canvas = canvas;
    this.onView = onView;
    // `onHover({u, v}, event)` is told where in the picture the pointer is.
    this.onHover = onHover;
    this.onClick = onClick;
    this.view = { ...DEFAULT_VIEW };
    this.auto = false;
    this.src = "";
    this.hasImage = false;
    this.frame = 0;
    this.last = 0;

    const gl = canvas.getContext("webgl2", { antialias: false }) || canvas.getContext("webgl", { antialias: false });
    if (!gl) throw new Error("WebGL is not available");
    this.gl = gl;
    // WebGL1 cannot repeat a picture whose sides are not powers of two;
    // the shader's fract() does the wrapping either way, so it only
    // matters for the one texel the filter reaches across the back.
    this.repeat = typeof WebGL2RenderingContext !== "undefined" && gl instanceof WebGL2RenderingContext;
    this.program = this.link(VERTEX, FRAGMENT);
    this.quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    this.quadAt = gl.getAttribLocation(this.program, "a_pos");
    this.uniforms = Object.fromEntries(
      ["u_tex", "u_overlay", "u_overlayOn", "u_yaw", "u_pitch", "u_tan"].map((name) => [
        name,
        gl.getUniformLocation(this.program, name),
      ])
    );
    this.texture = gl.createTexture();
    this.overlayTexture = gl.createTexture();
    this.hasOverlay = false;

    this.lineProgram = this.link(LINE_VERTEX, LINE_FRAGMENT);
    this.lineUniforms = Object.fromEntries(
      ["u_yaw", "u_pitch", "u_tan"].map((name) => [name, gl.getUniformLocation(this.lineProgram, name)])
    );
    this.lineAt = gl.getAttribLocation(this.lineProgram, "a_pos");
    this.lineColourAt = gl.getAttribLocation(this.lineProgram, "a_colour");
    this.linePoints = gl.createBuffer();
    this.lineColours = gl.createBuffer();
    this.lineCount = 0;

    this.bindInput();
  }

  link(vertex, fragment) {
    const gl = this.gl;
    const shader = (type, source) => {
      const one = gl.createShader(type);
      gl.shaderSource(one, source);
      gl.compileShader(one);
      if (!gl.getShaderParameter(one, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(one));
      return one;
    };
    const program = gl.createProgram();
    gl.attachShader(program, shader(gl.VERTEX_SHADER, vertex));
    gl.attachShader(program, shader(gl.FRAGMENT_SHADER, fragment));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
    gl.useProgram(program);
    return program;
  }

  // Drag to look around, the wheel to zoom, a double click to look ahead
  // again. Dragging moves the picture with the pointer, the way a map does.
  bindInput() {
    const canvas = this.canvas;
    let drag = null;
    this.handlers = {
      pointerdown: (event) => {
        if (event.button !== 0) return;
        canvas.setPointerCapture(event.pointerId);
        drag = { x: event.clientX, y: event.clientY, view: { ...this.view } };
        canvas.classList.add("is-dragging");
      },
      pointermove: (event) => {
        if (!drag) {
          if (this.onHover) this.onHover(this.pickAt(event), event);
          return;
        }
        // Degrees per CSS pixel, so the point under the pointer stays
        // under it whatever the zoom.
        const per = this.view.fov / Math.max(1, canvas.clientWidth, canvas.clientHeight);
        drag.moved = Math.max(drag.moved || 0, Math.hypot(event.clientX - drag.x, event.clientY - drag.y));
        this.setView({
          yaw: drag.view.yaw - (event.clientX - drag.x) * per,
          pitch: drag.view.pitch + (event.clientY - drag.y) * per,
        });
      },
      pointerleave: () => {
        if (!drag && this.onHover) this.onHover(null);
      },
      pointerup: (event) => {
        if (!drag) return;
        // A press that did not move the view is a click on the picture:
        // `onClick({u, v}, event)` is told where.
        const clicked = event.type === "pointerup" && (drag.moved || 0) < 4;
        drag = null;
        canvas.classList.remove("is-dragging");
        this.settled();
        if (clicked && this.onClick) this.onClick(this.pickAt(event), event);
      },
      wheel: (event) => {
        event.preventDefault();
        this.setView({ fov: this.view.fov * Math.exp(event.deltaY * 0.001) });
        this.settled();
      },
      dblclick: () => {
        this.setView({ ...DEFAULT_VIEW, yaw: this.view.yaw });
        this.settled();
      },
    };
    this.handlers.pointercancel = this.handlers.pointerup;
    for (const [name, handler] of Object.entries(this.handlers)) {
      canvas.addEventListener(name, handler, name === "wheel" ? { passive: false } : undefined);
    }
  }

  // Told once the view has stopped moving for a moment.
  settled() {
    clearTimeout(this.settleTimer);
    this.settleTimer = setTimeout(() => this.onView && this.onView({ ...this.view }), 250);
  }

  setView(patch) {
    const next = { ...this.view, ...patch };
    // Yaw kept in (-180, 180], so what is saved reads as a direction.
    next.yaw = ((((next.yaw + 180) % 360) + 360) % 360) - 180;
    next.pitch = clamp(next.pitch, -89, 89);
    next.fov = clamp(next.fov, FOV_MIN, FOV_MAX);
    this.view = next;
    this.draw();
  }

  setAuto(on) {
    this.auto = Boolean(on);
    if (this.auto) this.draw();
  }

  // A picture by its address. The same address twice is not loaded twice.
  async setImage(src) {
    if (src === this.src) return;
    this.src = src;
    if (!src) {
      this.hasImage = false;
      this.draw();
      return;
    }
    const image = new Image();
    image.decoding = "async";
    image.src = src;
    await image.decode();
    if (this.src !== src || !this.gl) return;
    // Width over height: 2 for a whole sphere. Anything else is stretched
    // over it, which the control says.
    this.ratio = image.naturalWidth / image.naturalHeight;
    const gl = this.gl;
    // Wider than the GPU takes, it is drawn down first.
    const max = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    let source = image;
    if (image.naturalWidth > max || image.naturalHeight > max) {
      const scale = max / Math.max(image.naturalWidth, image.naturalHeight);
      source = document.createElement("canvas");
      source.width = Math.floor(image.naturalWidth * scale);
      source.height = Math.floor(image.naturalHeight * scale);
      source.getContext("2d").drawImage(image, 0, 0, source.width, source.height);
    }
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, this.repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    // No mipmaps: the longitude jumps from 1 to 0 across the back, and a
    // mip level chosen from that jump would draw a line down it.
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    this.hasImage = true;
    this.imageLoaded(source);
    this.draw();
  }

  // For a subclass: told when a picture has been put on the sphere, with
  // what it was drawn from (an image or a canvas).
  imageLoaded() {}

  // For a subclass: drawn over the picture and under the lines, in the
  // view's own tangents.
  drawBackdrop() {}

  // The structure over the picture: an RGBA picture of the same shape (or
  // null for none), and lines as pairs of points with a colour each.
  setOverlay(overlay, lines) {
    const gl = this.gl;
    if (!gl) return;
    this.hasOverlay = Boolean(overlay);
    if (overlay) {
      gl.bindTexture(gl.TEXTURE_2D, this.overlayTexture);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, overlay.width, overlay.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, overlay.rgba);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, this.repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      // Nearest: a label is not something to blend with the one beside it.
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    }
    this.lineCount = lines ? lines.points.length / 3 : 0;
    if (lines && this.lineCount) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.linePoints);
      gl.bufferData(gl.ARRAY_BUFFER, lines.points, gl.STATIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.lineColours);
      gl.bufferData(gl.ARRAY_BUFFER, lines.colours, gl.STATIC_DRAW);
    }
    this.draw();
  }

  // Where in the picture a place on the canvas looks at, as the shader
  // works it out: u across, v down, both 0..1.
  pickAt(event) {
    const rect = this.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const ndcX = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    const ndcY = 1 - ((event.clientY - rect.top) / rect.height) * 2;
    const tan = Math.tan((this.view.fov * RAD) / 2);
    const long = Math.max(rect.width, rect.height);
    let d = [ndcX * ((tan * rect.width) / long), ndcY * ((tan * rect.height) / long), -1];
    const len = Math.hypot(d[0], d[1], d[2]);
    d = d.map((one) => one / len);
    const cp = Math.cos(this.view.pitch * RAD), sp = Math.sin(this.view.pitch * RAD);
    d = [d[0], d[1] * cp - d[2] * sp, d[1] * sp + d[2] * cp];
    const cy = Math.cos(this.view.yaw * RAD), sy = Math.sin(this.view.yaw * RAD);
    d = [d[0] * cy - d[2] * sy, d[1], d[0] * sy + d[2] * cy];
    const lon = Math.atan2(d[0], -d[2]);
    const lat = Math.asin(clamp(d[1], -1, 1));
    return { u: (((lon / (2 * Math.PI) + 0.5) % 1) + 1) % 1, v: 0.5 - lat / Math.PI };
  }

  // The canvas at the size it is shown, in device pixels.
  resize() {
    const ratio = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.round(this.canvas.clientWidth * ratio));
    const height = Math.max(1, Math.round(this.canvas.clientHeight * ratio));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    this.draw();
  }

  // Drawn on the next frame, once however often it is asked for; and
  // again after that while turning by itself.
  draw() {
    if (this.frame || !this.gl) return;
    this.frame = requestAnimationFrame((now) => {
      this.frame = 0;
      if (this.auto && this.last) this.view.yaw = ((this.view.yaw + ((now - this.last) / 1000) * AUTO_SPEED + 180) % 360) - 180;
      this.last = this.auto ? now : 0;
      this.render();
      if (this.auto) this.draw();
    });
  }

  render() {
    const gl = this.gl;
    const { width, height } = this.canvas;
    gl.viewport(0, 0, width, height);
    gl.clearColor(0.12, 0.12, 0.12, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (!this.hasImage) return;
    const tan = Math.tan((this.view.fov * RAD) / 2);
    const long = Math.max(width, height);
    const tanX = (tan * width) / long;
    const tanY = (tan * height) / long;

    gl.useProgram(this.program);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.enableVertexAttribArray(this.quadAt);
    gl.vertexAttribPointer(this.quadAt, 2, gl.FLOAT, false, 0, 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.uniform1i(this.uniforms.u_tex, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.overlayTexture);
    gl.uniform1i(this.uniforms.u_overlay, 1);
    gl.uniform1f(this.uniforms.u_overlayOn, this.hasOverlay ? 1 : 0);
    gl.uniform1f(this.uniforms.u_yaw, this.view.yaw * RAD);
    gl.uniform1f(this.uniforms.u_pitch, this.view.pitch * RAD);
    gl.uniform2f(this.uniforms.u_tan, tanX, tanY);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.disableVertexAttribArray(this.quadAt);
    this.drawBackdrop(tanX, tanY);

    if (!this.lineCount) return;
    gl.useProgram(this.lineProgram);
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.linePoints);
    gl.enableVertexAttribArray(this.lineAt);
    gl.vertexAttribPointer(this.lineAt, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.lineColours);
    gl.enableVertexAttribArray(this.lineColourAt);
    gl.vertexAttribPointer(this.lineColourAt, 3, gl.FLOAT, false, 0, 0);
    gl.uniform1f(this.lineUniforms.u_yaw, this.view.yaw * RAD);
    gl.uniform1f(this.lineUniforms.u_pitch, this.view.pitch * RAD);
    gl.uniform2f(this.lineUniforms.u_tan, tanX, tanY);
    gl.drawArrays(gl.LINES, 0, this.lineCount);
    gl.disableVertexAttribArray(this.lineAt);
    gl.disableVertexAttribArray(this.lineColourAt);
    gl.disable(gl.BLEND);
  }

  dispose() {
    cancelAnimationFrame(this.frame);
    clearTimeout(this.settleTimer);
    for (const [name, handler] of Object.entries(this.handlers || {})) this.canvas.removeEventListener(name, handler);
    const lose = this.gl && this.gl.getExtension("WEBGL_lose_context");
    if (lose) lose.loseContext();
    this.gl = null;
  }
}
