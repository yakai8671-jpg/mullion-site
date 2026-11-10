/* What the picture app and the video app of this plugin have in common: the
 * models a removal can run, and the small parts of talking to ComfyUI that
 * are the same whichever of the two is asking. */

// Which model, and which node runs it. BiRefNet's variants are one node and
// RMBG-2.0 / BEN2 / InSPyReNet another, with the same inputs bar one: the
// RMBG node also asks at what size to look.
export const MODELS = [
  { value: "BiRefNet-general", node: "BiRefNetRMBG" },
  { value: "BiRefNet-HR", node: "BiRefNetRMBG" },
  { value: "BiRefNet_toonout", node: "BiRefNetRMBG" },
  { value: "BiRefNet-portrait", node: "BiRefNetRMBG" },
  { value: "BiRefNet-matting", node: "BiRefNetRMBG" },
  { value: "BiRefNet-HR-matting", node: "BiRefNetRMBG" },
  { value: "BiRefNet_lite", node: "BiRefNetRMBG" },
  { value: "RMBG-2.0", node: "RMBG" },
  { value: "BEN2", node: "RMBG" },
  { value: "INSPYRENET", node: "RMBG" },
];
export const modelOf = (value) => MODELS.find((one) => one.value === value) || MODELS[0];

export const POLL_MS = 700;
export const POLL_RETRIES = 12;
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// The settings both apps have for the removal itself, as property specs.
export function removalProperties(t) {
  return {
    model: {
      label: "rmbg.prop.model",
      type: "enum",
      default: MODELS[0].value,
      options: () => MODELS.map((one) => ({ value: one.value, label: t(`rmbg.model.${one.value}`) })),
    },
    sensitivity: { label: "rmbg.prop.sensitivity", type: "percent", default: 1 },
    offset: { label: "rmbg.prop.offset", type: "number", default: 0, min: -20, max: 20 },
    blur: { label: "rmbg.prop.blur", type: "number", default: 0, min: 0, max: 64 },
    refine: { label: "rmbg.prop.refine", type: "boolean", default: false },
    // Only the RMBG node's models look at a size of their own; BiRefNet
    // decides it itself. Shown for all, read for those.
    resolution: { label: "rmbg.prop.resolution", type: "number", default: 1024, min: 256, max: 2048 },
  };
}

// The inputs both removal nodes share. `process_res` is the RMBG node's
// alone; BiRefNet decides the size it looks at itself.
export function removalInputs(props, image, { background = "Alpha", color = "#222222" } = {}) {
  const model = modelOf(props.model);
  const inputs = {
    image,
    model: model.value,
    sensitivity: Math.min(1, Math.max(0, Number(props.sensitivity) || 0)),
    mask_blur: Math.floor(Number(props.blur) || 0),
    mask_offset: Math.floor(Number(props.offset) || 0),
    invert_output: false,
    refine_foreground: Boolean(props.refine),
    background,
    background_color: color,
  };
  if (model.node === "RMBG") inputs.process_res = Math.round((Number(props.resolution) || 1024) / 8) * 8;
  return { class_type: model.node, inputs };
}

// What ComfyUI said went wrong, from the history's messages.
export function errorOf(messages) {
  const failed = (messages || []).find((one) => Array.isArray(one) && one[0] === "execution_error");
  const detail = failed && failed[1];
  return detail ? `${detail.node_type || detail.node_id || ""}: ${detail.exception_message || ""}`.trim() : "ComfyUI";
}

// A picture or video as a data URL: a ComfyUI address is only good for as
// long as the output folder keeps the file.
export async function dataUrlOf(src) {
  if (typeof src === "string" && src.startsWith("data:")) return src;
  const blob = await (await fetch(src)).blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
