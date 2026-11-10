/* Stage / Panorama plugin scripts */
import { loadStructure, pick } from "../panorama/structure.js";
import { DEFAULT_VIEW, FOV_MAX, FOV_MIN } from "../panorama/viewer.js";
import { fillLegend, tipText } from "../panorama/readout.js";
import { TRIGGER } from "../panorama/templates.js";
import { PANORAMA_BYTES, coercePanorama } from "../panorama/value.js";
import { coerceMedia, hasMedia, nameOf, portWrite, shownOf } from "../character/media.js";
import { StageView, directionOf } from "./stageview.js";
import { asDataUrl, fitImage } from "../workflow/runner.js";

const APP = "panorama.editor";
const VIEW = "stage.view";
const SCENE = "stage.scene";
const PLACEMENT = "stage.placement";
const PLACEMENTS = "stage.placements";
const STAGE = "stage";
const PANORAMA = "panorama";
const MEDIA = "character.media";

const valueIn = (entry, key) => {
  if (!entry) return undefined;
  const prop = entry.properties?.find((one) => one.key === key);
  if (prop && prop.value !== undefined) return prop.value;
  return entry.props?.[key];
};
const number = (value, fallback) => (Number.isFinite(Number(value)) ? Number(value) : fallback);
const clamp = (value, lo, hi) => Math.min(hi, Math.max(lo, value));
const round = (value, places) => Math.round(value * 10 ** places) / 10 ** places;

export const mediaOf = (placement) => shownOf(placement?.source);

export function coercePlacement(value) {
  const one = value && typeof value === "object" ? value : {};
  return {
    id: typeof one.id === "string" && one.id ? one.id : "",
    source: coerceMedia(one.source),
    height: clamp(number(one.height, 1.6), 0.01, 1000),
    azimuth: round(((((number(one.azimuth, 0) + 180) % 360) + 360) % 360) - 180, 2),
    distance: clamp(number(one.distance, 3), 0, 1000),
    lift: clamp(number(one.lift, 0), -100, 1000),
    scale: clamp(number(one.scale, 1), 0.01, 100),
  };
}

export const newObjectId = () => `o${Math.random().toString(36).slice(2, 8)}`;

export function coerceStage(value) {
  const one = value && typeof value === "object" ? value : {};
  const seen = new Set();
  const objects = (Array.isArray(one.objects) ? one.objects : []).map((raw, index) => {
    const object = coercePlacement(raw);
    let id = object.id || `o${index + 1}`;
    while (seen.has(id)) id = newObjectId();
    seen.add(id);
    return { ...object, id };
  });
  return { panorama: coercePanorama(one.panorama), objects };
}

const FIELDS = [
  ["height", { type: "number", min: 0.01, max: 1000, step: 0.1 }],
  ["azimuth", { type: "number", min: -180, max: 180, step: 5 }],
  ["distance", { type: "number", min: 0, max: 1000, step: 0.1 }],
  ["lift", { type: "number", min: -100, max: 1000, step: 0.1 }],
  ["scale", { type: "number", min: 0.01, max: 100, step: 0.1 }],
];

const floorPoint = (placement) => {
  const turn = (placement.azimuth * Math.PI) / 180;
  return [Math.sin(turn) * placement.distance, placement.lift, -Math.cos(turn) * placement.distance];
};

const withSource = (one, value) => ({ ...one, source: coerceMedia(value) });

const VOLATILE = /^\/api\/comfy\/view\?/;
const keeping = new Set();
async function keepPicture(api, sceneId, address) {
  if (keeping.has(address)) return;
  keeping.add(address);
  try {
    const kept = await fitImage(await asDataUrl(address), Math.floor((PANORAMA_BYTES * 4) / 3));
    const scene = api.items.get(sceneId);
    const now = coerceStage((scene.properties?.find((one) => one.key === "stage") || scene.props?.stage || {}).value ?? scene?.props?.stage);
    if (kept && now.panorama && now.panorama.image === address) {
      api.items.set(sceneId, "stage", { ...now, panorama: { ...now.panorama, image: kept } });
    }
  } catch (error) {
    console.warn("[mullion] the panorama could not be kept as a picture:", error);
  } finally {
    keeping.delete(address);
  }
}

const DEPTH_TRIED = new Map();
async function keepDepth(api, sceneId, depth) {
  const key = `${depth.type}/${depth.subfolder}/${depth.filename}`;
  if (Date.now() - (DEPTH_TRIED.get(key) || 0) < 60 * 1000) return;
  DEPTH_TRIED.set(key, Date.now());
  const src = await api.comfy?.keep?.(depth).catch(() => null);
  if (!src) return;
  const scene = api.items.get(sceneId);
  const now = coerceStage(valueIn(scene, "stage"));
  const same = now.panorama && now.panorama.depth && now.panorama.depth.filename === depth.filename;
  if (same) api.items.set(sceneId, "stage", { ...now, panorama: { ...now.panorama, depth: { ...now.panorama.depth, src } } });
}

// comfy:run's address for an output (initialize hands it in).
let viewUrl = () => "";
const address = (ref) => viewUrl(ref);
const panoramaOf = (results) => {
  const list = Array.isArray(results) ? results : [];
  const picture = list.find((one) => one.kind === "image" && one.ref);
  const mesh = list.find((one) => one.kind === "mesh" && one.ref);
  const depth = mesh ? { ...mesh.ref, ...(mesh.src ? { src: mesh.src } : {}) } : null;
  return picture ? { name: "", image: picture.src || address(picture.ref), depth } : null;
};

function resolveViewParams(api, desc) {
  const p = { ...desc?.params };
  if (p.itemId && api?.items) {
    const item = api.items.get(p.itemId);
    if (item) {
      const sceneId = item.props?.scene;
      const scene = sceneId ? api.items.get(sceneId) : null;
      const stage = coerceStage(valueIn(scene, "stage"));
      const background = stage.panorama;
      if (sceneId && background && background.depth && !background.depth.src) {
        keepDepth(api, sceneId, background.depth);
      }
      const placements = stage.objects;
      const selectedId = String(valueIn(scene, "selected") || "");
      const selected = placements.findIndex((one) => one.id === selectedId);
      const sprites = placements
        .map((one, index) => ({ one, index, shown: mediaOf(one) }))
        .filter(({ shown }) => shown.src)
        .map(({ one, index, shown }) => ({
          src: shown.src,
          video: shown.kind === "video",
          at: floorPoint(one),
          height: one.height * one.scale,
          selected: index === selected,
        }));
      p.src = background ? background.image : "";
      p.structure = background && background.depth ? background.depth.src || api.comfy?.viewUrl?.(background.depth) || "" : "";
      p.sprites = sprites;
      p.selected = selected;
      p.view = { yaw: item.props?.yaw ?? DEFAULT_VIEW.yaw, pitch: item.props?.pitch ?? DEFAULT_VIEW.pitch, fov: item.props?.fov ?? DEFAULT_VIEW.fov };
      p.overlay = item.props?.showStructure;
      p.depth = item.props?.showDepth;
      p.blend = item.props?.blend;
      p.auto = item.props?.autoRotate;
      p.empty = p.empty || (api.t ? api.t("stage.value.empty") : "stage.value.empty");
      p.onView = (view) => {
        api.items.set(item.id, "yaw", Math.round(view.yaw * 10) / 10);
        api.items.set(item.id, "pitch", Math.round(view.pitch * 10) / 10);
        api.items.set(item.id, "fov", Math.round(view.fov * 10) / 10);
      };
      p.onOverlay = (on) => api.items.set(item.id, "showStructure", on);
      p.onDepth = (on) => api.items.set(item.id, "showDepth", on);
      p.onBlend = (on) => api.items.set(item.id, "blend", on);
      p.onAuto = (on) => api.items.set(item.id, "autoRotate", on);
      p.onPlace = (where) => {
        if (!sceneId || !(selected >= 0) || selected >= placements.length) return;
        const next = placements.map((one, index) => (index === selected ? { ...one, ...where } : one));
        api.items.set(sceneId, "stage", { ...stage, objects: next });
      };
    }
  }
  return p;
}

// The shell's translator, for the formats of the value types (which are not handed one).
let core;
export function initialize(api) {
  core = api.core;
  viewUrl = api.granted("comfy:run").viewUrl;
}

export const types = {
  "stage.placement": {
    portRead: (value) => coercePlacement(value),
    defaultValue: (p) => coercePlacement(p?.default),
    coerce: (value) => coercePlacement(value),
    format: (value, api) => {
      const t = api?.t || core?.t || ((k) => k);
      const one = coercePlacement(value);
      const name = nameOf(one.source) || (hasMedia(one.source) ? t("stage.value.picture") : t("stage.value.noSource"));
      return `${name} · ${one.azimuth}° · ${one.distance} m`;
    },
  },
  stage: {
    defaultValue: (p) => coerceStage(p?.default),
    coerce: (value) => coerceStage(value),
    format: (value, api) => {
      const t = api?.t || core?.t || ((k) => k);
      const one = coerceStage(value);
      const room = one.panorama ? t("stage.value.withPanorama") : t("stage.value.noPanorama");
      return `${room} · ${t("stage.value.objectCount", { n: one.objects.length })}`;
    },
    methods: {
      src: (p) => (coerceStage(p.get()).panorama || {}).image || "",
    },
  },
};

export const controls = {
  "stage.objectedit": (api) => {
    const t = api.core?.t || ((k) => k);
    const describe = api.describe || ((spec, opts) => ({ property: spec, ...opts }));
    return {
      render(desc, onChange) {
        if (typeof document === "undefined" || !document.createElement) return {};
        const el = document.createElement("dl");
        el.className = "mu-props stage-objectedit";
        el.__desc = desc;
        el.__onChange = onChange;
        const current = () => coercePlacement(el.__desc.property.get());
        const write = (next) => (el.__onChange ? el.__onChange(next) : el.__desc.property.set(next));
        const row = (key, control) => {
          const line = document.createElement("div");
          line.className = "mu-prop-row";
          const label = document.createElement("dt");
          label.append(Object.assign(document.createElement("span"), { className: "mu-prop-label", textContent: t(`stage.field.${key}`) }));
          const cell = document.createElement("dd");
          cell.append(control);
          line.append(label, cell);
          el.append(line);
        };
        const sourceSpec = () =>
          describe(
            { type: MEDIA, read: () => current().source, write: (_api, value) => write(withSource(current(), value)) },
            { api: el.__desc.api, key: `${el.__desc.key || "object"}-source`, label: t("stage.field.source") }
          );
        const sourceControl = api.controls["character.mediainput"] || { render: () => document.createElement("div"), update: () => {} };
        const source = sourceControl.render(sourceSpec(), () => {});
        row("source", source);
        const stepperControl = api.controls.stepper || { render: () => document.createElement("div"), update: () => {} };
        const steppers = FIELDS.map(([key, spec]) => {
          const specNow = () =>
            describe(
              { ...spec, read: () => current()[key], write: (_api, value) => write({ ...current(), [key]: value }) },
              { api: el.__desc.api, key: `${el.__desc.key || "object"}-${key}`, label: t(`stage.field.${key}`) }
            );
          const stepper = stepperControl.render(specNow(), (value) => specNow().property.set(value));
          row(key, stepper);
          return { stepper, specNow };
        });
        el.__parts = { source, sourceSpec, steppers };
        return el;
      },
      update(el, desc) {
        if (!el.__parts) return;
        el.__desc = desc;
        const { source, sourceSpec, steppers } = el.__parts;
        const sourceControl = api.controls["character.mediainput"] || { update: () => {} };
        sourceControl.update(source, sourceSpec());
        const stepperControl = api.controls.stepper || { update: () => {} };
        for (const { stepper, specNow } of steppers) stepperControl.update(stepper, specNow());
      },
    };
  },

  "stage.view": (api) => {
    const t = api.core?.t || ((k) => k);
    const icon = (name) => {
      if (typeof document === "undefined" || !document.createElement) return null;
      return Object.assign(document.createElement("i"), { className: `bi bi-${api.core?.ICONS?.[name] || name}` });
    };

    function showTip(host, state, at, event) {
      const { tip } = state.els;
      const p = state.resolvedParams;
      let text = "";
      if (p.overlay) text = tipText(state.loaded, at, t);
      else if (p.depth && state.loaded && at) {
        const found = pick(state.loaded.result, at.u, at.v);
        if (found && found.distance > 0) text = `${round(found.distance, 1)} m`;
      }
      tip.textContent = text;
      tip.hidden = !text;
      if (!text) return;
      const box = host.getBoundingClientRect();
      tip.style.left = `${Math.min(event.clientX - box.left + 14, box.width - tip.offsetWidth - 4)}px`;
      tip.style.top = `${Math.min(event.clientY - box.top + 16, box.height - tip.offsetHeight - 4)}px`;
    }

    function showNote(state) {
      const p = state.resolvedParams;
      const { note, status } = state.els;
      const text =
        (state.failed && !state.view ? `${state.failed} ${state.retryTimer ? "" : t("stage.value.retryWebgl")}` : state.failed) ||
        (state.pending ? t("mu.value.loading") : p.src ? "" : p.empty || "");
      note.textContent = text;
      note.style.cursor = state.failed && !state.view && !state.retryTimer ? "pointer" : "";
      note.hidden = !text;
      note.classList.toggle("is-loading", Boolean(state.pending) && !state.failed);
      const hint =
        state.loadError ||
        (state.wanted && !state.loaded
          ? t("panorama.structure.loading")
          : p.src && p.selected >= 0
            ? t("stage.value.clickToPlace")
            : "");
      status.textContent = hint;
      status.hidden = !hint;
      status.classList.toggle("is-error", Boolean(state.loadError));
    }

    function place(state, at) {
      const p = state.resolvedParams;
      if (!at || !p.onPlace || !(p.selected >= 0) || !state.view) return;
      const view = state.view;
      const direction = directionOf(at);
      const found = state.loaded ? pick(state.loaded.result, at.u, at.v) : null;
      let point = null;
      let lift = null;
      if (found && !found.sky && found.distance > 0) {
        point = view.toFloor(direction.map((one) => one * found.distance));
        const kind = found.entry ? found.entry.kind : "";
        lift = kind !== "floor" && (kind === "top" || point[1] < -0.3) ? round(point[1], 2) : 0;
      } else {
        const { up, ex, ez } = view.floorAxes();
        const down = -(direction[0] * up[0] + direction[1] * up[1] + direction[2] * up[2]);
        if (down < 0.01) return;
        const reach = view.floor.eye / down;
        const flat = direction.map((one) => one * reach);
        point = [flat[0] * ex[0] + flat[1] * ex[1] + flat[2] * ex[2], 0, flat[0] * ez[0] + flat[1] * ez[1] + flat[2] * ez[2]];
      }
      const across = Math.hypot(point[0], point[2]) * 0.97;
      const azimuth = (Math.atan2(point[0], -point[2]) * 180) / Math.PI;
      p.onPlace({ azimuth: round(azimuth, 1), distance: round(across, 2), ...(lift === null ? {} : { lift }) });
    }

    return {
      mount(host, desc) {
        if (typeof document === "undefined" || !document.createElement) {
          host.__stage = { desc, resolvedParams: desc.params };
          return;
        }
        host.classList.add("panorama-view", "stage-view");
        const canvas = document.createElement("canvas");
        const note = Object.assign(document.createElement("div"), { className: "panorama-note" });
        const status = Object.assign(document.createElement("div"), { className: "panorama-status", hidden: true });
        const tools = Object.assign(document.createElement("div"), { className: "panorama-tools" });
        const legend = Object.assign(document.createElement("div"), { className: "panorama-legend", hidden: true });
        const tip = Object.assign(document.createElement("div"), { className: "panorama-tip", hidden: true });
        const state = { desc, resolvedParams: resolveViewParams(desc.api || api, desc), view: null, els: { note, status, tools, legend, tip }, wanted: "", loaded: null, requested: null };
        host.__stage = state;
        const button = (key, name, run) => {
          const one = document.createElement("button");
          one.type = "button";
          one.className = "mu-item-button mu-icontoggle";
          one.dataset.key = key;
          one.title = t(`stage.action.${key}`);
          one.append(icon(name));
          one.addEventListener("click", (event) => {
            event.stopPropagation();
            run();
          });
          tools.append(one);
        };
        button("auto", "arrow-repeat", () => state.resolvedParams.onAuto && state.resolvedParams.onAuto(!state.resolvedParams.auto));
        button("overlay", "layers", () => state.resolvedParams.onOverlay && state.resolvedParams.onOverlay(!state.resolvedParams.overlay));
        button("depth", "layers-half", () => state.resolvedParams.onDepth && state.resolvedParams.onDepth(!state.resolvedParams.depth));
        button("blend", "sun", () => state.resolvedParams.onBlend && state.resolvedParams.onBlend(state.resolvedParams.blend === false));
        button("zoomIn", "zoom-in", () => state.view && (state.view.setView({ fov: state.view.view.fov / 1.25 }), state.view.settled()));
        button("zoomOut", "zoom-out", () => state.view && (state.view.setView({ fov: state.view.view.fov * 1.25 }), state.view.settled()));
        button("reset", "compass", () => state.view && (state.view.setView(DEFAULT_VIEW), state.view.settled()));
        button("fullscreen", "arrows-fullscreen", () => {
          if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
          else if (host.requestFullscreen) host.requestFullscreen().catch(() => {});
        });
        host.append(canvas, note, status, tools, legend, tip);
        state.canvas = canvas;

        const start = () => {
          state.retryTimer = 0;
          if (!host.__stage) return;
          try {
            state.view = new StageView(state.canvas, {
              onView: (view) => {
                state.sent = JSON.stringify(view);
                if (state.resolvedParams.onView) state.resolvedParams.onView(view);
              },
              onClick: (at) => place(state, at),
              onHover: (at, event) => showTip(host, state, at, event),
            });
          } catch (error) {
            state.view = null;
            state.failed = t("panorama.value.noWebgl", { error: error.message || error });
            state.tries = (state.tries || 0) + 1;
            if (state.tries < 8) state.retryTimer = setTimeout(start, 1500);
            api.controls["stage.view"]?.update?.(host, state.desc);
            return;
          }
          state.tries = 0;
          state.failed = "";
          state.requested = null;
          state.wanted = "";
          state.loaded = null;
          state.shownOverlay = null;
          state.sent = undefined;
          state.applied = undefined;
          state.view.resize();
          state.canvas.addEventListener("webglcontextlost", (event) => {
            event.preventDefault();
            if (state.view) state.view.dispose();
            state.view = null;
            const fresh = document.createElement("canvas");
            state.canvas.replaceWith(fresh);
            state.canvas = fresh;
            state.failed = t("stage.value.contextLost");
            state.tries = 0;
            api.controls["stage.view"]?.update?.(host, state.desc);
            state.retryTimer = setTimeout(start, 400);
          });
          api.controls["stage.view"]?.update?.(host, state.desc);
        };
        state.start = start;
        note.addEventListener("click", () => {
          if (state.view || state.retryTimer) return;
          state.tries = 0;
          start();
        });
        state.observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => state.view && state.view.resize()) : { observe() {}, disconnect() {} };
        state.observer.observe(host);
        start();
      },

      update(host, desc) {
        const state = host.__stage;
        if (!state) return;
        state.desc = desc;
        state.resolvedParams = resolveViewParams(desc.api || api, desc);
        const p = state.resolvedParams;
        if (state.els?.tools) {
          for (const one of state.els.tools.children) {
            const key = one.dataset.key;
            const flags = { overlay: p.overlay, depth: p.depth, auto: p.auto, blend: p.blend !== false };
            if (!(key in flags)) continue;
            const on = Boolean(flags[key]);
            if (key === "overlay" || key === "depth") one.hidden = !p.structure;
            one.classList.toggle("is-active", on);
            one.setAttribute("aria-pressed", String(on));
          }
        }
        if (!state.view) return showNote(state);
        const view = { ...DEFAULT_VIEW, ...(p.view || {}) };
        const key = JSON.stringify(view);
        if (key !== state.sent && key !== state.applied) state.view.setView(view);
        state.applied = key;

        if ((p.src || "") !== state.requested) {
          const src = p.src || "";
          state.requested = src;
          state.pending = src;
          state.failed = "";
          state.view
            .setImage(src)
            .then(() => {
              if (state.requested !== src) return;
              state.pending = "";
              showNote(state);
            })
            .catch((error) => {
              if (state.requested !== src) return;
              state.pending = "";
              state.failed = t("panorama.value.loadFailed", { error: error.message || error });
              showNote(state);
            });
        }
        const wanted = p.structure || "";
        if (wanted !== state.wanted) {
          state.wanted = wanted;
          state.loaded = null;
          state.loadError = "";
          state.view.setDepth(null);
          state.view.setOverlay(null, null);
          if (wanted) {
            loadStructure(wanted)
              .then((loaded) => {
                if (state.wanted !== wanted || !state.view) return;
                state.loaded = loaded;
                state.view.setDepth(loaded.result);
                state.shownOverlay = null;
                api.controls["stage.view"]?.update?.(host, state.desc);
              })
              .catch((error) => {
                if (state.wanted !== wanted) return;
                state.loadError = t("panorama.structure.loadFailed", { error: error.message || error });
                showNote(state);
              });
          }
        }
        if (state.loaded && Boolean(p.overlay) !== state.shownOverlay) {
          state.shownOverlay = Boolean(p.overlay);
          state.view.setOverlay(p.overlay ? state.loaded.overlay : null, p.overlay ? state.loaded.lines : null);
          if (state.els?.legend) fillLegend(state.els.legend, p.overlay ? state.loaded : null, t);
        }
        state.view.setAuto(Boolean(p.auto));
        state.view.setShowDepth(p.depth);
        state.view.setBlend(p.blend);
        state.view.setSprites(p.sprites || []);
        showNote(state);
      },

      unmount(host) {
        const state = host.__stage;
        if (!state) return;
        state.observer?.disconnect();
        clearTimeout(state.retryTimer);
        if (state.view) state.view.dispose();
        delete host.__stage;
      },
    };
  },
};

export const derived = {
  "stage.panorama": {
    read: (api, item) => coerceStage(item.props?.stage).panorama,
    write: (api, value, item) => {
      item.props.stage = { ...coerceStage(item.props?.stage), panorama: coercePanorama(value) };
    },
  },
  "stage.objects": {
    read: (api, item) => coerceStage(item.props?.stage).objects,
    write: (api, value, item) => {
      item.props.stage = { ...coerceStage(item.props?.stage), objects: Array.isArray(value) ? value : [] };
    },
  },
};


export const items = {
  "stage.editor": ({ core }) => {
    const t = core?.t || ((k) => k);
    return {
      properties: {
        panorama: {
          read: (_api, item) => panoramaOf(item.props?.results),
        },
      },
      supplies: {
        prepare: () => ({ parts: { prompts: [{ text: TRIGGER, weight: 1 }] } }),
      },
      output: {
        type: "panorama",
        overlay: "depth_image",
        port: "panorama",
        note: "stage.value.keepPanorama",
        value: async (api, { results, name }) => {
          const picture = results.find((one) => one.kind === "image" && one.ref);
          const mesh = results.find((one) => one.kind === "mesh" && one.ref);
          if (!picture) throw new Error(t("stage.value.noPanoramaYet"));
          const image = await fitImage(await asDataUrl(picture.src || api.comfy.viewUrl(picture.ref)), Math.floor((PANORAMA_BYTES * 4) / 3));
          return { name, image, depth: mesh ? { ...mesh.ref, ...(mesh.src ? { src: mesh.src } : {}) } : null };
        },
      },
    };
  },
};
