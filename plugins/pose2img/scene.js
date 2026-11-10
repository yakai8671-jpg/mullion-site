/* The 3D scene -- promptmanager's embedded scene editor, as a class.
 *
 * One figure (a VRM model, posed by a VRMA clip), a camera, and the two
 * pictures the app needs of them: the depth pass the workflow is run on,
 * and an ordinary render to show what was set up. The same class is the
 * live editor in the scene window and the renderer a run uses when that
 * window is not on screen, so what is sent is what the editor would have
 * sent -- there is one way of drawing the scene, not two.
 *
 * What the scene is set to is a plain value (see `blankScene`), kept by the
 * scene item. This class only draws it: `apply()` takes one in, and the
 * editor reports what the person did with the mouse as a patch to it.
 *
 * three.js and three-vrm are vendored under vendor/ and imported on first
 * use, so the shell does not pay for them until a scene is drawn.
 */

const VENDOR = new URL("./vendor/", import.meta.url).href;
const ASSETS = new URL("./assets/", import.meta.url).href;

// What ships with the app. A model or pose the person has of their own is
// a file path instead (see urlOf); these are only the ones already here.
export const MODELS = [
  { id: "sample", label: "pose2img.model.sample", file: "models/sample.vrm" },
  { id: "sample_model", label: "pose2img.model.vrm1", file: "models/sample_model.vrm" },
];
export const POSES = [
  ...Array.from({ length: 15 }, (_, index) => {
    const n = String(index + 1).padStart(2, "0");
    return { id: `pose${n}`, label: `POSE${n}`, file: `poses/pose${n}.vrma` };
  }),
  { id: "attention", label: "pose2img.pose.attention", file: "poses/pose_attention.vrma" },
  { id: "banzai", label: "pose2img.pose.banzai", file: "poses/pose_banzai.vrma" },
  { id: "wave", label: "pose2img.pose.wave", file: "poses/pose_wave.vrma" },
];

// "file" in either list means the path beside it; anything else is one of
// the bundled ones by id.
export const FILE = "file";

export const blankScene = () => ({
  model: "sample",
  modelUrl: "",
  pose: "pose05",
  poseUrl: "",
  actor: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
  camera: { position: [0, 1.3, 3], target: [0, 1, 0], fov: 30 },
});

// Where the model and the pose come from, or "" when there is nothing to
// load. A file's address is worked out by whoever set the path -- it takes
// the filesystem permission to ask -- and kept beside it.
export function urlOf(scene, which) {
  const id = scene[which];
  if (!id) return "";
  if (id === FILE) return scene[`${which}Url`] || "";
  const list = which === "model" ? MODELS : POSES;
  const found = list.find((one) => one.id === id);
  return found ? ASSETS + found.file : "";
}

// ---- the libraries ------------------------------------------------------
let LIBS = null;
export function loadLibs() {
  if (!LIBS) {
    LIBS = Promise.all([
      import(`${VENDOR}three/three.module.js`),
      import(`${VENDOR}three/addons/loaders/GLTFLoader.js`),
      import(`${VENDOR}three/addons/controls/OrbitControls.js`),
      import(`${VENDOR}three/addons/controls/TransformControls.js`),
      import(`${VENDOR}three-vrm/three-vrm.module.js`),
      import(`${VENDOR}three-vrm-animation/three-vrm-animation.module.js`),
    ]).then(([THREE, gltf, orbit, transform, vrm, anim]) => ({
      THREE,
      GLTFLoader: gltf.GLTFLoader,
      OrbitControls: orbit.OrbitControls,
      TransformControls: transform.TransformControls,
      VRMLoaderPlugin: vrm.VRMLoaderPlugin,
      VRMUtils: vrm.VRMUtils,
      VRMAnimationLoaderPlugin: anim.VRMAnimationLoaderPlugin,
      createVRMAnimationClip: anim.createVRMAnimationClip,
    }));
    LIBS.catch(() => (LIBS = null));
  }
  return LIBS;
}

// Depth with the view-space distance mapped straight onto near..far: white
// is near, black is far (and the empty sky). MeshDepthMaterial is not
// linear, and with a floor in the picture its precision all went to the
// foreground and the figure came out flat. Skinning comes from the standard
// chunks: three sets USE_SKINNING for a SkinnedMesh, so the pose is drawn.
function linearDepthMaterial(THREE, near, far) {
  return new THREE.ShaderMaterial({
    uniforms: { uNear: { value: near }, uFar: { value: far } },
    vertexShader: [
      "#include <common>",
      "#include <skinning_pars_vertex>",
      "varying float vViewZ;",
      "void main() {",
      "  #include <skinbase_vertex>",
      "  #include <begin_vertex>",
      "  #include <skinning_vertex>",
      "  #include <project_vertex>",
      "  vViewZ = -mvPosition.z;",
      "}",
    ].join("\n"),
    fragmentShader: [
      "uniform float uNear;",
      "uniform float uFar;",
      "varying float vViewZ;",
      "void main() {",
      "  float depth = clamp((vViewZ - uNear) / max(0.001, uFar - uNear), 0.0, 1.0);",
      "  gl_FragColor = vec4(vec3(1.0 - depth), 1.0);",
      "}",
    ].join("\n"),
  });
}

// near/far are taken from the box around the figure and the floor, so what
// is actually in frame can be a slice of that range -- from above, the
// levels came out between 98 and 172. Stretched to the full 0..255 here so
// the ControlNet reads a depth map rather than a grey card.
function stretchDepth(canvas) {
  const out = document.createElement("canvas");
  out.width = canvas.width;
  out.height = canvas.height;
  const g = out.getContext("2d", { willReadFrequently: true });
  g.drawImage(canvas, 0, 0);
  const pixels = g.getImageData(0, 0, out.width, out.height);
  const data = pixels.data;
  let min = 255;
  let max = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i] < min) min = data[i];
    if (data[i] > max) max = data[i];
  }
  const span = Math.max(1, max - min);
  for (let i = 0; i < data.length; i += 4) {
    const v = Math.round(((data[i] - min) / span) * 255);
    data[i] = data[i + 1] = data[i + 2] = v;
    data[i + 3] = 255;
  }
  g.putImageData(pixels, 0, 0);
  return out.toDataURL("image/png");
}

export class SceneView {
  // `live` is an editor: it has controls, a loop, and says what was done
  // through `onEdit(patch)`. Otherwise it is only ever drawn off screen.
  constructor(libs, canvas, { live = false, onEdit = () => {}, onLoaded = () => {} } = {}) {
    const { THREE } = libs;
    this.libs = libs;
    this.THREE = THREE;
    this.live = live;
    this.onEdit = onEdit;
    this.onLoaded = onLoaded;
    this.aspect = 1;
    this.vrm = null;
    this.mixer = null;
    this.modelUrl = "";
    this.poseUrl = "";
    this.loading = Promise.resolve();
    this.state = blankScene();

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setPixelRatio(live ? window.devicePixelRatio || 1 : 1);
    this.renderer = renderer;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x2b2b2b);
    scene.add(new THREE.AmbientLight(0xffffff, 0.8));
    const light = new THREE.DirectionalLight(0xffffff, Math.PI);
    light.position.set(1, 2, 2);
    scene.add(light);
    this.grid = new THREE.GridHelper(4, 10, 0x555555, 0x3a3a3a);
    scene.add(this.grid);
    // Drawn in the depth pass only. Depth of the figure alone says nothing
    // about where the horizon is, so a shot from above came back with a
    // background seen from eye level; a floor gives the model the slope.
    this.floor = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: 0x808080 }));
    this.floor.rotation.x = -Math.PI / 2;
    this.floor.visible = false;
    scene.add(this.floor);
    this.scene = scene;

    this.camera = new THREE.PerspectiveCamera(30, 1, 0.1, 20);
    this.target = new THREE.Vector3(0, 1, 0);

    this.loader = new libs.GLTFLoader();
    this.loader.register((parser) => new libs.VRMLoaderPlugin(parser));
    this.loader.register((parser) => new libs.VRMAnimationLoaderPlugin(parser));

    if (live) {
      const orbit = new libs.OrbitControls(this.camera, canvas);
      // No damping: the camera would drift on after the drag ended and was
      // written down, and the next redraw would pull it back.
      orbit.addEventListener("end", () => this.editCamera());
      this.orbit = orbit;
      this.target = orbit.target;
      const transform = new libs.TransformControls(this.camera, canvas);
      transform.addEventListener("dragging-changed", (event) => {
        orbit.enabled = !event.value;
        if (!event.value) this.editActor();
      });
      scene.add(transform.getHelper());
      this.transform = transform;
      const loop = () => {
        this.frame = requestAnimationFrame(loop);
        this.orbit.update();
        this.renderer.render(this.scene, this.camera);
      };
      loop();
    }
  }

  // ---- the value in -----------------------------------------------------
  // Everything the scene is set to, applied: a different model or pose is
  // loaded, the rest is set where it stands. Loading is asynchronous, and
  // `ready()` is what waits for it.
  apply(next) {
    this.state = next;
    const modelUrl = urlOf(next, "model");
    const poseUrl = urlOf(next, "pose");
    this.placeCamera();
    if (modelUrl !== this.modelUrl || poseUrl !== this.poseUrl) {
      const changedModel = modelUrl !== this.modelUrl;
      this.modelUrl = modelUrl;
      this.poseUrl = poseUrl;
      this.loading = this.loading
        .catch(() => {})
        .then(() => (changedModel ? this.loadModel(modelUrl) : null))
        .then(() => this.loadPose(poseUrl))
        .then(() => {
          this.placeActor();
          this.onLoaded(null);
        })
        .catch((error) => {
          this.onLoaded(error);
          throw error;
        });
    } else {
      this.placeActor();
    }
    return this.loading;
  }

  ready() {
    return this.loading;
  }

  placeCamera() {
    const cam = this.state.camera || {};
    if (Array.isArray(cam.position)) this.camera.position.set(...cam.position);
    if (Array.isArray(cam.target)) this.target.set(...cam.target);
    if (Number(cam.fov) > 0) this.camera.fov = Number(cam.fov);
    this.camera.lookAt(this.target);
    this.camera.updateProjectionMatrix();
    if (this.orbit) this.orbit.update();
  }

  placeActor() {
    if (!this.vrm) return;
    const actor = this.state.actor || {};
    const root = this.vrm.scene;
    if (Array.isArray(actor.position)) root.position.set(...actor.position);
    if (Array.isArray(actor.rotation)) root.rotation.set(...actor.rotation.map((deg) => (deg * Math.PI) / 180));
    if (Array.isArray(actor.scale)) root.scale.set(...actor.scale);
  }

  async loadModel(url) {
    if (this.vrm) {
      if (this.transform) this.transform.detach();
      this.scene.remove(this.vrm.scene);
      this.libs.VRMUtils.deepDispose(this.vrm.scene);
      this.vrm = null;
      this.mixer = null;
    }
    if (!url) return;
    const gltf = await this.loader.loadAsync(url);
    const vrm = gltf.userData.vrm;
    if (!vrm) throw new Error("not a VRM model");
    this.libs.VRMUtils.rotateVRM0(vrm);
    this.scene.add(vrm.scene);
    this.vrm = vrm;
    if (this.transform) this.transform.attach(vrm.scene);
  }

  // A pose is the first frame of a VRMA clip, held still. The hips'
  // position track is dropped so the figure stays where it was put.
  async loadPose(url) {
    if (!this.vrm) return;
    if (this.mixer) {
      this.mixer.stopAllAction();
      this.mixer = null;
    }
    this.vrm.humanoid.resetNormalizedPose();
    if (url) {
      const gltf = await this.loader.loadAsync(url);
      const animation = gltf.userData.vrmAnimations && gltf.userData.vrmAnimations[0];
      if (animation) {
        const clip = this.libs.createVRMAnimationClip(animation, this.vrm);
        clip.tracks = clip.tracks.filter((track) => !track.name.endsWith(".position"));
        if (!(clip.duration > 0)) clip.duration = 1;
        this.mixer = new this.THREE.AnimationMixer(this.vrm.scene);
        this.mixer.clipAction(clip).play();
        this.mixer.update(0);
      }
    }
    this.vrm.update(0);
  }

  // ---- the value out ----------------------------------------------------
  editCamera() {
    const v = (vector) => vector.toArray().map((n) => Math.round(n * 1000) / 1000);
    this.onEdit({ camera: { position: v(this.camera.position), target: v(this.target), fov: this.camera.fov } });
  }

  editActor() {
    if (!this.vrm) return;
    const root = this.vrm.scene;
    const r = (n) => Math.round(n * 1000) / 1000;
    this.onEdit({
      actor: {
        position: root.position.toArray().map(r),
        rotation: [root.rotation.x, root.rotation.y, root.rotation.z].map((rad) => r((rad * 180) / Math.PI)),
        scale: root.scale.toArray().map(r),
      },
    });
  }

  setMode(mode) {
    if (this.transform) this.transform.setMode(mode);
  }

  // The live view letterboxed to the picture's shape, so what is framed in
  // the editor is what the depth pass will frame.
  fit(width, height, aspect) {
    this.aspect = aspect > 0 ? aspect : width / Math.max(1, height);
    const w = Math.max(1, Math.round(Math.min(width, height * this.aspect)));
    const h = Math.max(1, Math.round(w / this.aspect));
    this.renderer.setSize(w, h, true);
    this.camera.aspect = this.aspect;
    this.camera.updateProjectionMatrix();
  }

  // ---- pictures of it ---------------------------------------------------
  // One frame at a given size, with the gizmo and the grid hidden. The pose
  // is applied first: the loop does that every frame, but this is drawn
  // outside it (and off screen there is no loop at all).
  renderAt(width, height, prepare, type = "image/png") {
    const { renderer, camera } = this;
    const oldRatio = renderer.getPixelRatio();
    const oldSize = renderer.getSize(new this.THREE.Vector2());
    const oldAspect = camera.aspect;
    const helper = this.transform ? this.transform.getHelper() : null;
    const helperShown = helper ? helper.visible : false;
    const gridShown = this.grid.visible;
    renderer.setPixelRatio(1);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    if (helper) helper.visible = false;
    this.grid.visible = false;
    if (this.mixer) this.mixer.update(0);
    if (this.vrm) this.vrm.update(0);
    let restore = () => {};
    try {
      restore = (prepare && prepare()) || restore;
      renderer.render(this.scene, camera);
      return prepare ? stretchDepth(renderer.domElement) : renderer.domElement.toDataURL(type, 0.85);
    } finally {
      restore();
      if (helper) helper.visible = helperShown;
      this.grid.visible = gridShown;
      renderer.setPixelRatio(oldRatio);
      renderer.setSize(oldSize.x, oldSize.y, false);
      camera.aspect = oldAspect;
      camera.updateProjectionMatrix();
    }
  }

  capturePreview(width, height, type) {
    return this.renderAt(width, height, null, type);
  }

  // The depth pass: the figure and a floor under it, white near and black
  // far, stretched to the full range.
  captureDepth(width, height) {
    if (!this.vrm) throw new Error("no model");
    const { THREE, camera, scene, renderer } = this;
    return this.renderAt(width, height, () => {
      const box = new THREE.Box3().setFromObject(this.vrm.scene);
      const sphere = box.getBoundingSphere(new THREE.Sphere());
      const size = Math.max(4, sphere.radius * 16);
      this.floor.scale.set(size, size, 1);
      this.floor.position.set(sphere.center.x, box.min.y, sphere.center.z);
      this.floor.visible = true;
      this.floor.updateMatrixWorld(true);
      // near/far wrap the figure and the floor along the line of sight.
      camera.updateMatrixWorld();
      const bounds = box.clone().union(new THREE.Box3().setFromObject(this.floor));
      const corner = new THREE.Vector3();
      let nearZ = Infinity;
      let farZ = -Infinity;
      for (let i = 0; i < 8; i += 1) {
        corner
          .set(i & 1 ? bounds.max.x : bounds.min.x, i & 2 ? bounds.max.y : bounds.min.y, i & 4 ? bounds.max.z : bounds.min.z)
          .applyMatrix4(camera.matrixWorldInverse);
        nearZ = Math.min(nearZ, -corner.z);
        farZ = Math.max(farZ, -corner.z);
      }
      nearZ = Math.max(0.05, nearZ);
      farZ = Math.max(nearZ + 0.1, farZ);
      const oldNear = camera.near;
      const oldFar = camera.far;
      const oldBackground = scene.background;
      camera.near = nearZ * 0.95;
      camera.far = farZ * 1.05;
      camera.updateProjectionMatrix();
      scene.background = new THREE.Color(0x000000);
      const material = linearDepthMaterial(THREE, nearZ, farZ);
      scene.overrideMaterial = material;
      renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
      return () => {
        scene.overrideMaterial = null;
        material.dispose();
        this.floor.visible = false;
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        scene.background = oldBackground;
        camera.near = oldNear;
        camera.far = oldFar;
      };
    });
  }

  // Where the camera is, in the three words a prompt uses for it: looking
  // down or up at the figure, which side of it, and how much of it fills
  // the frame. The model faces +Z.
  describeCamera() {
    if (!this.vrm) return null;
    const { THREE, camera } = this;
    const box = new THREE.Box3().setFromObject(this.vrm.scene);
    const toCamera = camera.position.clone().sub(this.target);
    const distance = Math.max(1e-4, toCamera.length());
    const elevation = THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp(toCamera.y / distance, -1, 1)));
    const forward = new THREE.Vector3(0, 0, 1)
      .applyQuaternion(this.vrm.scene.getWorldQuaternion(new THREE.Quaternion()))
      .setY(0);
    const across = toCamera.clone().setY(0);
    const facing =
      forward.lengthSq() < 1e-8 || across.lengthSq() < 1e-8
        ? 0
        : THREE.MathUtils.radToDeg(forward.normalize().angleTo(across.normalize()));
    const tall = Math.max(1e-4, box.max.y - box.min.y);
    const seen = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * distance;
    const coverage = tall / Math.max(1e-4, seen);
    return {
      pitch: elevation >= 15 ? "high_angle" : elevation <= -15 ? "low_angle" : "eye_level",
      facing: facing <= 25 ? "front" : facing <= 70 ? "three_quarter" : facing <= 115 ? "side" : "back",
      shot: coverage <= 1.1 ? "full_body" : coverage <= 2.2 ? "upper_body" : "close_up",
    };
  }

  dispose() {
    cancelAnimationFrame(this.frame);
    if (this.vrm) this.libs.VRMUtils.deepDispose(this.vrm.scene);
    this.floor.geometry.dispose();
    this.floor.material.dispose();
    if (this.transform) this.transform.dispose();
    if (this.orbit) this.orbit.dispose();
    this.renderer.dispose();
    this.vrm = null;
  }
}

// ---- off screen ---------------------------------------------------------
// The one renderer a run draws with when the scene is not on screen. Kept,
// because a browser allows only a handful of WebGL contexts and a model is
// slow to load twice; and one at a time, because it is one scene.
let OFFSCREEN = null;
let QUEUE = Promise.resolve();

export function renderOffscreen(state, width, height) {
  const job = QUEUE.then(async () => {
    const libs = await loadLibs();
    if (!OFFSCREEN) OFFSCREEN = new SceneView(libs, document.createElement("canvas"));
    await OFFSCREEN.apply(state);
    if (!OFFSCREEN.vrm) throw new Error("no model");
    return {
      depth: OFFSCREEN.captureDepth(width, height),
      camera: OFFSCREEN.describeCamera(),
    };
  });
  QUEUE = job.catch(() => {});
  return job;
}
