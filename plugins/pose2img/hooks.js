import { openChild } from "../workflow/appkit.js";
import { tagTexts } from "../prompt/tags.js";
import { FILE, MODELS, POSES, renderOffscreen, urlOf } from "./scene.js";

export const LIVE = new Map();

const ANGLE_CATEGORY = "カメラアングル";
const ANGLE_PARTS = {
  high_angle: "俯瞰",
  eye_level: "目線",
  low_angle: "煽り",
  front: "正面",
  three_quarter: "斜め",
  side: "横",
  back: "背面",
  full_body: "全身",
  upper_body: "バストアップ",
  close_up: "クローズアップ",
};

const valueIn = (entry, key) => {
  if (!entry) return undefined;
  if (entry.props && entry.props[key] !== undefined) return entry.props[key];
  const row = entry.properties?.find((one) => one.key === key);
  return row ? row.value : undefined;
};

export const sceneOf = (read) => ({
  model: read("model"),
  modelUrl: read("modelUrl"),
  pose: read("pose"),
  poseUrl: read("poseUrl"),
  actor: { position: read("position"), rotation: read("rotation"), scale: read("scale") },
  camera: { position: read("cameraPosition"), target: read("cameraTarget"), fov: read("fov") },
});

export const angleWords = (angle) =>
  (Array.isArray(angle) ? angle : [])
    .map((key) => ANGLE_PARTS[key])
    .filter(Boolean)
    .join(" / ");

function angleParts(api, angle) {
  if (!angle || !api?.store?.saved) return [];
  const saved = api.store.saved("prompt.part");
  return ["pitch", "facing", "shot"]
    .map((axis) => {
      const name = ANGLE_PARTS[angle[axis]];
      const found =
        saved.find((one) => one.name === name && one.value && one.value.category === ANGLE_CATEGORY) ||
        saved.find((one) => one.name === name);
      const tags = found && found.value ? tagTexts(found.value.tags) : [];
      return tags.length ? { text: tags.join(", "), weight: 1 } : null;
    })
    .filter(Boolean);
}

export const items = {
  "pose2img.app": ({ core }) => {
    const { NODES, t } = core;
    return {
      supplies: {
        async prepare(api, app, { width, height, report }) {
          const sceneId = valueIn(app, "scene");
          const entry = typeof sceneId === "string" ? api.items.get(sceneId) : null;
          if (!entry) throw new Error(t("pose2img.run.noScene"));
          const scene = sceneOf((key) => valueIn(entry, key));
          if (!urlOf(scene, "model")) throw new Error(t("pose2img.run.noModel"));
          report(t("pose2img.run.depth"));
          let drawn;
          const live = LIVE.get(sceneId);
          if (live) {
            await live.ready();
            if (live.vrm) drawn = { depth: live.captureDepth(width, height), camera: live.describeCamera() };
          }
          if (!drawn) drawn = await renderOffscreen(scene, width, height);
          const words = valueIn(entry, "cameraPrompts") ? angleParts(api, drawn.camera) : [];
          return { images: { depth_image: drawn.depth }, parts: { prompts: words } };
        },
        imageInput(api, app) {
          const sceneId = valueIn(app, "scene");
          const entry = typeof sceneId === "string" ? api.items.get(sceneId) : null;
          const label = (list, id, file) => {
            if (id === FILE) return file ? file.split(/[\\/]/).pop() : t("pose2img.value.fromFile");
            const found = list.find((one) => one.id === id);
            return found ? t(found.label) : "";
          };
          const read = (key) => valueIn(entry, key);
          const summary = entry
            ? [
                label(MODELS, read("model"), read("modelPath")),
                label(POSES, read("pose"), read("posePath")) || t("pose2img.value.noPose"),
                read("cameraPrompts") ? angleWords(read("angle")) : "",
              ]
                .filter(Boolean)
                .join(" · ")
            : "";
          return [
            NODES.control("scene", {
              control: "pose2img.scenecard",
              picture: read("snapshot") || "",
              summary,
              empty: t("pose2img.value.openScene"),
              editTitle: t("pose2img.action.editScene"),
              onEdit: sceneId ? () => openChild(api, sceneId) : null,
            }),
          ];
        },
      },
    };
  },
};
