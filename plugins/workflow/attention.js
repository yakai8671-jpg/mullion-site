/* Comfy Kitchen attention -- the faster attention, put into a baked app.
 *
 * ComfyUI (0.38 on) has a core node, ModelAttentionBackend, that sets which
 * dense attention a model's sampling uses: plain PyTorch, or Comfy Kitchen's
 * quantized INT8 kernel (Nvidia and AMD only). It patches the model's
 * options rather than its weights, so it can sit anywhere on the model's
 * way to the sampler and every LoRA or sampling node after it keeps it.
 *
 * Here it goes straight after each model loader: every `model` input that
 * took the loader's model takes the patched one instead. It is done to the
 * template when an app registers, not written into the template files,
 * because those are regenerated from the template editor -- a node added by
 * hand there would be lost on the next export, and this way one call puts
 * it into every app that wants it.
 *
 * The backend is a run setting, not fixed: some models are known to go
 * wrong under quantized attention, and that is for the person running it
 * to find and turn off. Where Comfy Kitchen is not available the node falls
 * back to PyTorch attention on its own, with a warning in ComfyUI's log.
 */

const NODE = "ModelAttentionBackend";
export const KITCHEN = "comfy kitchen attention";

// A string id, so it never meets a regenerated template's numbered nodes
// and a saved setting for it keeps its address.
const idFor = (graph, n) => {
  const base = "kitchen_attention";
  const id = n ? `${base}_${n + 1}` : base;
  return graph[id] ? idFor(graph, n + 1) : id;
};

const isLink = (value) => Array.isArray(value) && value.length === 2 && typeof value[0] === "string";

export function withAttention(template, { backend = KITCHEN } = {}) {
  const copy = JSON.parse(JSON.stringify(template));
  const graph = copy.workflow.graph;

  // The loaders: whatever a `model` input points at that takes no model
  // itself. One patch each, keyed by the output it patches.
  const patched = new Map();
  for (const node of Object.values(graph)) {
    const from = node.inputs && node.inputs.model;
    if (!isLink(from)) continue;
    const source = graph[from[0]];
    if (!source || isLink(source.inputs && source.inputs.model)) continue;
    const key = `${from[0]}:${from[1]}`;
    if (!patched.has(key)) {
      const id = idFor(graph, patched.size);
      graph[id] = {
        inputs: { model: [from[0], from[1]], attention: backend },
        class_type: NODE,
        _meta: { title: "Model Attention Backend" },
      };
      patched.set(key, id);
    }
    node.inputs.model = [patched.get(key), 0];
  }

  // A row each in the model group. The apps here have one model, so one
  // row; a graph with two would number them.
  const ids = [...patched.values()];
  copy.settings = [
    ...(copy.settings || []),
    ...ids.map((id, n) => ({
      node_id: id,
      input_key: "attention",
      label: ids.length > 1 ? `アテンション ${n + 1}` : "アテンション",
      group: "モデル",
      options_source: { class_type: NODE, input_key: "attention" },
    })),
  ];
  return copy;
}
