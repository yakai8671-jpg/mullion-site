/* The workflows the Panorama Generator runs: a panorama from a prompt, and
 * in the same run its depth.
 *
 * The picture comes from template.js (Flux with an equirectangular LoRA)
 * or template_qwen.js (Qwen-Image), each ending in the seam pass that
 * makes it wrap round. The depth is template_depth.js's MoGe-2 nodes,
 * joined on behind it: the finished picture (node 34's input in both) is
 * what MoGe is handed, in place of the file the depth template loads.
 * Joined here rather than written into a template of its own, so a change
 * to either half is made where that half lives.
 *
 * The depth's nodes take numbers past the picture's (each plus 100), so a
 * setting kept by node id still means the node it meant.
 */

import { withAttention } from "../workflow/attention.js";
import { TEMPLATE as FLUX } from "./template.js";
import { TEMPLATE as QWEN } from "./template_qwen.js";
import { TEMPLATE as DEPTH } from "./template_depth.js";

// What equirectangular_flux_lora_v3 was trained on (its ss_tag_frequency):
// not the person's to remember, so the app adds it to the prompt at run
// time. qwen-360-diffusion answers to the same words.
export const TRIGGER = "equirectangular 360 degree panorama";
// Twice as wide as tall is the whole sphere. Flux wants multiples of 16,
// and the seam pass halves the width, so 2048 rather than anything odd.
export const SIZE = [2048, 1024];

// The last node of both picture templates: a preview of the finished
// panorama, which is also the block they read the picture from.
const FINAL = "34";
const OFFSET = 100;
const nodeId = (id) => String(Number(id) + OFFSET);

function withDepth(base, name) {
  const copy = JSON.parse(JSON.stringify(base));
  const graph = copy.workflow.graph;
  const picture = graph[FINAL].inputs.images;
  const depth = JSON.parse(JSON.stringify(DEPTH));

  for (const [id, node] of Object.entries(depth.workflow.graph)) {
    // The loaded picture and the preview of it: the run has the picture.
    if (id === "1" || id === "8") continue;
    for (const [key, value] of Object.entries(node.inputs)) {
      if (Array.isArray(value)) node.inputs[key] = value[0] === "1" ? picture : [nodeId(value[0]), value[1]];
    }
    graph[nodeId(id)] = node;
  }

  copy.name = name;
  copy.tool = "panorama_scene";
  copy.workflow.name = "panorama_scene";
  copy.blocks.depth_image = { value: { node_id: nodeId("7"), input_key: "images" } };
  copy.blocks.structure = { value: { node_id: nodeId("5"), input_key: "mesh" } };
  copy.settings = [
    ...(copy.settings || []),
    ...(depth.settings || []).map((one) => ({
      ...one,
      node_id: nodeId(one.node_id),
      // Two models in one run: said apart.
      label: one.input_key === "model_name" ? "奥行きモデル" : one.label,
    })),
  ];
  return copy;
}

// One app over two models, as the picture apps are: [{key, label, template}].
export const ENGINES = [
  { key: "flux", label: "panorama.engine.flux", template: withAttention(withDepth(FLUX, "Flux 360°パノラマ + MoGe-2 奥行き")) },
  { key: "qwen", label: "panorama.engine.qwen", template: withAttention(withDepth(QWEN, "Qwen 360°パノラマ + MoGe-2 奥行き")) },
];
