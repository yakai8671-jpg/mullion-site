/* Templates -- promptmanager's tool-block layer, ported as a value.
 *
 * A workflow knows its own nodes and nothing about what they are for. A
 * tool -- text to image, background removal -- knows what it has to put in
 * and read back, and nothing about nodes. A template is what joins the two:
 * one workflow, one tool, and for each block the tool asks for, which of the
 * workflow's fields it goes to. Beside the blocks sit the workflow inputs
 * the template opens up as settings, and the ones it pins to a fixed value.
 *
 * Promptmanager checked on save that a template's blocks matched its tool
 * exactly, no more and no fewer. Here that is not a check but the shape:
 * the blocks are keyed by the tool's own block keys, and coercion keeps
 * those and only those, so a template cannot be out of step with its tool.
 * What can still be missing is an assignment, and `problems()` says which.
 *
 * The workflow is held as a copy, the way a slot holds a copy of a part: a
 * template is a decision about one graph, and editing the saved workflow
 * afterwards should not quietly change what it points at.
 */

// The tools, and the blocks each one asks for. `write` blocks are filled
// before running; `read` blocks are where the result comes out. A block
// with `selectors` takes one field per selector (an image size is a width
// and a height); every other block takes one field.
export const TOOLS = {
  t2i: [
    { key: "prompts", kind: "value.prompt_list", direction: "write" },
    // What not to draw, built from parts the same way the prompt is: it is
    // a prompt, and it was a plain string setting only because the block
    // layer had no second prompt in it. `optional` because a template made
    // before it existed has nothing assigned to it, and a negative prompt
    // nobody wrote is an empty string, not a broken template.
    { key: "negative_prompts", kind: "value.prompt_list", direction: "write", optional: true },
    { key: "image_size", kind: "value.image_size", direction: "write", selectors: ["width", "height"] },
    { key: "image", kind: "value.image", direction: "read" },
  ],
  // Text to image with a picture to keep to, when one is given: an edit
  // model that draws from the prompt and, if there is one, the reference.
  // Optional, so the same workflow runs from words alone (the picture's
  // node and its wire are taken out).
  t2i_ref: [
    { key: "prompts", kind: "value.prompt_list", direction: "write" },
    { key: "negative_prompts", kind: "value.prompt_list", direction: "write", optional: true },
    { key: "reference_image", kind: "value.image", direction: "write", optional: true },
    { key: "image_size", kind: "value.image_size", direction: "write", selectors: ["width", "height"] },
    { key: "image", kind: "value.image", direction: "read" },
  ],
  // A picture to change, said in words: the picture the result is made
  // from (its size is the result's) and, optionally, further pictures it
  // takes things from -- a person, a garment, a place -- which the prompt
  // refers to by number. Each further one is offered once the one before it
  // has a picture; a template leaves unassigned the ones its model cannot
  // take.
  image_edit: [
    { key: "prompts", kind: "value.prompt_list", direction: "write" },
    { key: "negative_prompts", kind: "value.prompt_list", direction: "write", optional: true },
    { key: "source_image", kind: "value.image", direction: "write" },
    ...Array.from({ length: 4 }, (_, index) => ({
      key: `ref_image_${index + 1}`,
      kind: "value.image",
      direction: "write",
      optional: true,
      ...(index ? { follows: true } : {}),
    })),
    { key: "image", kind: "value.image", direction: "read" },
  ],
  text_generation: [
    { key: "prompt", kind: "value.string", direction: "write" },
    { key: "result", kind: "value.string", direction: "read" },
  ],
  // A picture in, the words for it out -- a tagger on ComfyUI (WD14 and
  // the rest) or a vision model on Ollama, which is why the block is a
  // picture and a string rather than anything tagger-shaped. What comes
  // back is a prompt: it is read as one, saved as one, and dropped into a
  // slot like any other part.
  image_to_prompt: [
    { key: "source_image", kind: "value.image", direction: "write" },
    // A prompt, not a string. Nothing about the run changes -- what comes
    // back is text either way -- but it is what lets whoever holds the
    // answer know that keeping it means keeping a prompt part rather than
    // a line of text.
    { key: "prompt", kind: "value.prompt_single", direction: "read" },
  ],
  // Tags in, the same tags sorted into the categories asked for. The read
  // block is its own kind because what comes back is not a line of text but
  // a shape -- a list of groups, each a category and the tags put in it --
  // and a runner that knows that can ask the model for exactly that shape
  // (Ollama takes a JSON schema) instead of parsing prose.
  prompt_classify: [
    { key: "tags", kind: "value.string", direction: "write" },
    { key: "candidates", kind: "value.prompt_candidates", direction: "read" },
  ],
  background_removal: [
    { key: "source_image", kind: "value.image", direction: "write" },
    { key: "result_image", kind: "value.image", direction: "read" },
  ],
  image_restyle: [
    { key: "source_image", kind: "value.image", direction: "write" },
    { key: "instruction", kind: "value.prompt_single", direction: "write" },
    { key: "image_size", kind: "value.image_size", direction: "write", selectors: ["width", "height"] },
    { key: "result_image", kind: "value.image", direction: "read" },
  ],
  pose_estimation_3d: [
    { key: "source_image", kind: "value.image", direction: "write" },
    { key: "keypoints", kind: "value.string", direction: "read" },
  ],
  scene_3d_generation: [
    { key: "prompts", kind: "value.prompt_list", direction: "write" },
    // Optional for the same reason as t2i's: a template made before it had
    // nothing to assign it to.
    { key: "negative_prompts", kind: "value.prompt_list", direction: "write", optional: true },
    { key: "depth_image", kind: "value.image", direction: "write" },
    { key: "image_size", kind: "value.image_size", direction: "write", selectors: ["width", "height"] },
    { key: "image", kind: "value.image", direction: "read" },
  ],
  // t2i's blocks with a video where the picture was. What comes back is a
  // file ComfyUI saved (SaveWEBM and the like), read the way a picture is --
  // a reference to fetch -- and drawn as a video because of what the file
  // is. How long and how fast are settings, not blocks: a frame count is a
  // number on one node, not something the app has to fill in.
  t2v: [
    { key: "prompts", kind: "value.prompt_list", direction: "write" },
    { key: "negative_prompts", kind: "value.prompt_list", direction: "write", optional: true },
    { key: "image_size", kind: "value.image_size", direction: "write", selectors: ["width", "height"] },
    { key: "video", kind: "value.video", direction: "read" },
  ],
  // The same, starting from a picture: its first frame -- and, if one is
  // given, a second picture it has to end on. Optional, and the template
  // is expected to work without it: a runner leaves out the nodes an
  // empty optional picture would have gone into.
  i2v: [
    { key: "start_image", kind: "value.image", direction: "write" },
    { key: "end_image", kind: "value.image", direction: "write", optional: true },
    // Pictures it has to pass through on the way, each at a frame of its
    // own. Optional too, and in order: the second is only asked for once
    // the first is there.
    { key: "mid_image_1", kind: "value.keyframe", direction: "write", optional: true, selectors: ["image", "frame"] },
    { key: "mid_image_2", kind: "value.keyframe", direction: "write", optional: true, selectors: ["image", "frame"] },
    { key: "mid_image_3", kind: "value.keyframe", direction: "write", optional: true, selectors: ["image", "frame"] },
    { key: "prompts", kind: "value.prompt_list", direction: "write" },
    { key: "negative_prompts", kind: "value.prompt_list", direction: "write", optional: true },
    { key: "image_size", kind: "value.image_size", direction: "write", selectors: ["width", "height"] },
    { key: "video", kind: "value.video", direction: "read" },
  ],
  // The same, with every picture optional: a model that makes a video from
  // a first frame, a last frame, both, or neither (MiniMax H3). With none,
  // it is text to video.
  //
  // And pictures it keeps to as references rather than passes through --
  // who is in it (a character's sheet), what they wear, where it is --
  // which the prompt names in order, <Picture 1> and on. All optional;
  // `follows` offers each one only once the one before it has a picture.
  // A template may leave them unassigned (one model takes frames, another
  // both): an app with two picks by whether any is given.
  frames2v: [
    { key: "start_image", kind: "value.image", direction: "write", optional: true },
    { key: "end_image", kind: "value.image", direction: "write", optional: true },
    { key: "mid_image_1", kind: "value.keyframe", direction: "write", optional: true, selectors: ["image", "frame"] },
    { key: "mid_image_2", kind: "value.keyframe", direction: "write", optional: true, selectors: ["image", "frame"] },
    { key: "mid_image_3", kind: "value.keyframe", direction: "write", optional: true, selectors: ["image", "frame"] },
    ...Array.from({ length: 9 }, (_, index) => ({
      key: `ref_image_${index + 1}`,
      kind: "value.image",
      direction: "write",
      optional: true,
      ...(index ? { follows: true } : {}),
    })),
    { key: "prompts", kind: "value.prompt_list", direction: "write" },
    { key: "negative_prompts", kind: "value.prompt_list", direction: "write", optional: true },
    { key: "image_size", kind: "value.image_size", direction: "write", selectors: ["width", "height"] },
    { key: "video", kind: "value.video", direction: "read" },
  ],
  // A 360° panorama from words, and its depth in the same run: the
  // panorama (what the picture workflow ends with), the depth drawn as a
  // picture to look at, and the depth itself -- a file ComfyUI saved
  // (SaveGLB: the pixels as points), read by reference like a picture, for
  // whoever can make sense of it.
  panorama_scene: [
    { key: "prompts", kind: "value.prompt_list", direction: "write" },
    { key: "negative_prompts", kind: "value.prompt_list", direction: "write", optional: true },
    { key: "image_size", kind: "value.image_size", direction: "write", selectors: ["width", "height"] },
    { key: "image", kind: "value.image", direction: "read" },
    { key: "depth_image", kind: "value.image", direction: "read" },
    { key: "structure", kind: "value.mesh", direction: "read" },
  ],
};

const SINGLE = "value";
const VALUE_TYPES = ["string", "integer", "number", "boolean"];
const PROMPT_KINDS = ["value.prompt", "value.prompt_single", "value.prompt_list", "value.composed_prompt"];

export function registerTemplates(fw, wf) {
  const { core, describe, registerControl, registerItemType, registerValueType } = fw;
  const { NODES, t } = core;
  const { coerceWorkflow, nativeFields, fieldId, nodeCount, isRecord } = wf;

  const selectorsOf = (block) => block.selectors || [SINGLE];
  const blocksOf = (tool) => TOOLS[tool] || [];
  const toolLabel = (tool) => (TOOLS[tool] ? t(`workflow.tool.${tool}`) : t("workflow.value.noTool"));
  const blockLabel = (key) => t(`workflow.block.${key}`);

  // A target is a field of the workflow, named by node and input. Stored as
  // the pair rather than the joined id, so a saved template reads without
  // knowing how ids are spelled.
  const targetOf = (value) =>
    isRecord(value) ? fieldId(String(value.node_id ?? ""), String(value.input_key ?? "")) : "";
  const pairOf = (field) => ({ node_id: field.node_id, input_key: field.input_key });

  // What kind of value a workflow input takes, from what it holds now.
  const valueTypeOf = (value) =>
    typeof value === "boolean"
      ? "boolean"
      : typeof value === "number"
        ? Number.isInteger(value)
          ? "integer"
          : "number"
        : "string";

  const coerceSettingValue = (value, type) => {
    if (type === "boolean") return value === true || value === "true";
    if (type === "integer") {
      const n = Number.parseInt(value, 10);
      return Number.isFinite(n) ? n : 0;
    }
    if (type === "number") {
      const n = Number(value);
      return Number.isFinite(n) ? n : 0;
    }
    return value === null || value === undefined ? "" : String(value);
  };

  // The value, repaired against its own workflow and tool: assignments to
  // fields the workflow does not have, or in the wrong direction, are
  // dropped; a field is a setting or fixed, never both; and blocks are
  // exactly the tool's.
  const coerceTemplate = (value) => {
    const from = isRecord(value) ? value : {};
    const workflow = coerceWorkflow(from.workflow);
    const fields = new Map(nativeFields(workflow.graph).map((field) => [field.id, field]));
    const tool = TOOLS[from.tool] ? from.tool : "";

    const blocks = {};
    const given = isRecord(from.blocks) ? from.blocks : {};
    for (const block of blocksOf(tool)) {
      const was = isRecord(given[block.key]) ? given[block.key] : {};
      const assigned = {};
      for (const selector of selectorsOf(block)) {
        const field = fields.get(targetOf(was[selector]));
        const wanted = block.direction === "read" ? "output" : "input";
        if (field && field.direction === wanted) assigned[selector] = pairOf(field);
      }
      blocks[block.key] = assigned;
    }

    const taken = new Set();
    const inputAt = (entry) => {
      const id = targetOf(entry);
      const field = fields.get(id);
      if (!field || field.direction !== "input" || taken.has(id)) return null;
      taken.add(id);
      return field;
    };

    const settings = [];
    for (const one of Array.isArray(from.settings) ? from.settings : []) {
      const field = inputAt(one);
      if (!field) continue;
      const type = VALUE_TYPES.includes(one.value_type) ? one.value_type : valueTypeOf(field.default_value);
      const options = Array.isArray(one.options) ? one.options.map(String).filter(Boolean) : [];
      // Where the choices come from when they are not listed: a ComfyUI
      // node's own definition (the models a loader can load), asked for at
      // run time because what is installed changes.
      const source = isRecord(one.options_source) ? one.options_source : null;
      const optionsSource =
        source && source.class_type && source.input_key
          ? { class_type: String(source.class_type), input_key: String(source.input_key) }
          : null;
      settings.push({
        ...pairOf(field),
        label: typeof one.label === "string" ? one.label : "",
        value_type: type,
        default: coerceSettingValue(one.default ?? field.default_value, type),
        ...(options.length ? { options } : {}),
        ...(optionsSource ? { options_source: optionsSource } : {}),
        // Which settings sit together on screen. No heading of its own.
        ...(typeof one.group === "string" && one.group ? { group: one.group } : {}),
      });
    }

    const fixed = [];
    for (const one of Array.isArray(from.fixed) ? from.fixed : []) {
      const field = inputAt(one);
      if (!field) continue;
      const type = valueTypeOf(field.default_value);
      fixed.push({ ...pairOf(field), value: coerceSettingValue(one.value ?? field.default_value, type) });
    }

    return {
      name: typeof from.name === "string" ? from.name : "",
      tool,
      workflow,
      blocks,
      settings,
      fixed,
    };
  };

  // What still stands between this template and running it.
  const problemsOf = (value) => {
    const one = coerceTemplate(value);
    const found = [];
    if (!nodeCount(one.workflow)) found.push(t("workflow.problem.noWorkflow"));
    if (!one.tool) found.push(t("workflow.problem.noTool"));
    for (const block of blocksOf(one.tool)) {
      if (block.optional) continue;
      const missing = selectorsOf(block).filter((selector) => !one.blocks[block.key][selector]);
      if (missing.length) found.push(t("workflow.problem.unassigned", { block: blockLabel(block.key) }));
    }
    // A write block pointed at a field the template also sets or pins would
    // be written twice, and whichever went last would win without a word.
    const pinned = new Set([...one.settings, ...one.fixed].map(targetOf));
    for (const block of blocksOf(one.tool)) {
      if (block.direction !== "write") continue;
      if (Object.values(one.blocks[block.key]).some((pair) => pinned.has(targetOf(pair)))) {
        found.push(t("workflow.problem.overlap", { block: blockLabel(block.key) }));
      }
    }
    return found;
  };

  // A prompt block's value, written out the way promptmanager wrote it:
  // each enabled item's text, weighted where the weight is not 1.
  // A sentence (`sentence: true`) is written unweighted and joined to its
  // neighbours with a space: prose for a model that reads prose.
  const formatPrompt = (value) => {
    const items = Array.isArray(value) ? value : [value];
    let out = "";
    let last = null;
    for (const item of items) {
      const record = isRecord(item);
      if (record && item.enabled === false) continue;
      const text = record ? String(item.prompt_text ?? item.text ?? "").trim() : String(item ?? "").trim();
      if (!text) continue;
      const sentence = record && item.sentence === true;
      const weight = record ? Number(item.weight ?? 1) : 1;
      if (last) out += sentence || last.sentence ? " " : ", ";
      out += !sentence && Number.isFinite(weight) && weight !== 1 ? `(${text}:${weight})` : text;
      last = { sentence };
    }
    return out;
  };

  const blockValue = (block, selector, value) => {
    const picked = block.selectors ? (isRecord(value) ? value[selector] : undefined) : value;
    if (block.kind === "value.image_size") return Number.parseInt(picked, 10) || 0;
    if (PROMPT_KINDS.includes(block.kind)) return formatPrompt(picked);
    if (block.kind === "value.image") return picked;
    if (block.kind === "value.keyframe") return selector === "frame" ? Number.parseInt(picked, 10) || 0 : picked;
    if (isRecord(picked) || Array.isArray(picked)) return JSON.stringify(picked);
    return picked === undefined || picked === null ? "" : String(picked);
  };

  // The graph to post, with everything the template decides applied: the
  // fixed values, then the settings (what was passed, else the default),
  // then the write blocks. And where to read each read block from. Nothing
  // is sent anywhere -- that is a runner's job, and there is no runner.
  const buildRun = (value, blockValues = {}, settingValues = {}) => {
    const one = coerceTemplate(value);
    const graph = structuredClone(one.workflow.graph);
    const put = (pair, input) => {
      const node = graph[pair.node_id];
      if (node && isRecord(node.inputs)) node.inputs[pair.input_key] = input;
    };
    one.fixed.forEach((entry) => put(entry, entry.value));
    one.settings.forEach((entry) => {
      const id = targetOf(entry);
      const given = Object.prototype.hasOwnProperty.call(settingValues, id) ? settingValues[id] : entry.default;
      put(entry, coerceSettingValue(given, entry.value_type));
    });
    const reads = [];
    for (const block of blocksOf(one.tool)) {
      for (const selector of selectorsOf(block)) {
        const pair = one.blocks[block.key][selector];
        if (!pair) continue;
        if (block.direction === "read") {
          const input = graph[pair.node_id] && graph[pair.node_id].inputs[pair.input_key];
          reads.push({
            key: block.key,
            ...pair,
            ...(Array.isArray(input) ? { source_node_id: String(input[0]), output_index: input[1] } : {}),
          });
        } else if (Object.prototype.hasOwnProperty.call(blockValues, block.key)) {
          put(pair, blockValue(block, selector, blockValues[block.key]));
        }
      }
    }
    return { graph, reads };
  };

  // Every edit, value in and value out, for the same reason as the
  // workflow's: the editor writes through onChange so the screen follows.
  const edits = {
    name: (value, name) => ({ ...coerceTemplate(value), name: String(name ?? "") }),
    tool: (value, tool) => coerceTemplate({ ...coerceTemplate(value), tool }),
    // A new workflow keeps whatever assignments it still has fields for.
    workflow: (value, workflow) => coerceTemplate({ ...coerceTemplate(value), workflow }),
    target: (value, key, selector, id) => {
      const one = coerceTemplate(value);
      const field = nativeFields(one.workflow.graph).find((entry) => entry.id === id);
      const block = { ...one.blocks[key] };
      if (field) block[selector] = pairOf(field);
      else delete block[selector];
      return coerceTemplate({ ...one, blocks: { ...one.blocks, [key]: block } });
    },
    // Which role a workflow input plays: left at the workflow's value, opened
    // up as a setting, or pinned.
    mode: (value, id, mode) => {
      const one = coerceTemplate(value);
      const settings = one.settings.filter((entry) => targetOf(entry) !== id);
      const fixed = one.fixed.filter((entry) => targetOf(entry) !== id);
      const field = nativeFields(one.workflow.graph).find((entry) => entry.id === id);
      if (field && mode === "setting") settings.push({ ...pairOf(field), label: "" });
      if (field && mode === "fixed") fixed.push({ ...pairOf(field) });
      return coerceTemplate({ ...one, settings, fixed });
    },
    setting: (value, id, patch) => {
      const one = coerceTemplate(value);
      return coerceTemplate({
        ...one,
        settings: one.settings.map((entry) => (targetOf(entry) === id ? { ...entry, ...patch } : entry)),
      });
    },
    fixedValue: (value, id, input) => {
      const one = coerceTemplate(value);
      return coerceTemplate({
        ...one,
        fixed: one.fixed.map((entry) => (targetOf(entry) === id ? { ...entry, value: input } : entry)),
      });
    },
  };

  registerValueType("workflow.template", {
    label: "workflow.vtype.template",
    icon: "puzzle",
    params: ["default"],
    sample: { default: { name: "", tool: "text_generation", workflow: {}, blocks: {} } },
    // Saved templates fall into the tool they serve: a page that runs one
    // tool only ever wants that tool's templates.
    groups: {
      label: "workflow.field.tool",
      of: (value) => (isRecord(value) ? coerceTemplate(value).tool : ""),
    },
    defaultControl: "workflow.templatesummary",
    defaultValue: (p) => coerceTemplate(p.default),
    coerce: (value) => coerceTemplate(value),
    format: (value) => {
      const one = coerceTemplate(value);
      return `${one.name || t("workflow.value.unnamed")} · ${toolLabel(one.tool)}`;
    },
    methods: {
      name: (p) => coerceTemplate(p.get()).name,
      setName: (p, name) => p.set(edits.name(p.get(), name)),
      tool: (p) => coerceTemplate(p.get()).tool,
      setTool: (p, tool) => p.set(edits.tool(p.get(), tool)),
      toolOptions: () => Object.keys(TOOLS).map((value) => ({ value, label: toolLabel(value) })),
      workflow: (p) => coerceTemplate(p.get()).workflow,
      setWorkflow: (p, workflow) => p.set(edits.workflow(p.get(), workflow)),
      // The tool's blocks, each with what it is currently assigned to.
      blocks: (p) => {
        const one = coerceTemplate(p.get());
        return blocksOf(one.tool).map((block) => ({
          ...block,
          selectors: selectorsOf(block),
          assigned: one.blocks[block.key],
        }));
      },
      setTarget: (p, key, selector, id) => p.set(edits.target(p.get(), key, selector, id)),
      settings: (p) => coerceTemplate(p.get()).settings,
      fixed: (p) => coerceTemplate(p.get()).fixed,
      setMode: (p, id, mode) => p.set(edits.mode(p.get(), id, mode)),
      problems: (p) => problemsOf(p.get()),
      isReady: (p) => problemsOf(p.get()).length === 0,
      // blockValues by block key; settingValues by field id ("node::input").
      build: (p, blockValues, settingValues) => buildRun(p.get(), blockValues, settingValues),
    },
  });

  // ---- the controls ----------------------------------------------------
  registerControl("workflow.templatesummary", {
    label: "workflow.control.templatesummary",
    needs: ["name", "tool", "workflow", "problems"],
    render(desc) {
      const el = document.createElement("div");
      el.className = "workflow-summary";
      el.append(
        Object.assign(document.createElement("span"), { className: "workflow-summary-name" }),
        Object.assign(document.createElement("span"), { className: "workflow-summary-meta" })
      );
      fw.controls["workflow.templatesummary"].update(el, desc);
      return el;
    },
    update(el, desc) {
      const p = desc.property;
      const name = p.name() || t("workflow.value.unnamed");
      const workflow = p.workflow();
      const problems = p.problems().length;
      const meta = [
        toolLabel(p.tool()),
        nodeCount(workflow) ? workflow.name || t("workflow.value.unnamed") : t("workflow.value.empty"),
        problems ? t("workflow.value.problems", { n: problems }) : t("workflow.value.ready"),
      ].join(" · ");
      if (el.firstElementChild.textContent !== name) el.firstElementChild.textContent = name;
      if (el.lastElementChild.textContent !== meta) el.lastElementChild.textContent = meta;
      el.classList.toggle("has-problems", problems > 0);
    },
  });

  // What a runner needs from this layer. Handed back rather than exported,
  // because every one of these closes over the registry's translations.
  const exposed = { coerceTemplate, problemsOf, buildRun, blocksOf, blockLabel, toolLabel };

  fw.registerTranslations({
    en: {
      "workflow.vtype.template": "Workflow template",
      "workflow.control.templatesummary": "Template summary",
      "workflow.prop.template": "Template",
      "workflow.field.tool": "tool",
      "workflow.tool.t2i": "Text to image",
      "workflow.tool.t2i_ref": "Text to image, with a reference picture",
      "workflow.tool.image_edit": "Image edit (a picture and what to change)",
      "workflow.tool.text_generation": "Text generation",
      "workflow.tool.image_to_prompt": "Image to prompt",
      "workflow.tool.prompt_classify": "Sort tags into categories",
      "workflow.tool.background_removal": "Background removal",
      "workflow.tool.image_restyle": "Image restyle",
      "workflow.tool.pose_estimation_3d": "3D pose estimation",
      "workflow.tool.scene_3d_generation": "3D scene generation",
      "workflow.tool.t2v": "Text to video",
      "workflow.tool.i2v": "Image to video",
      "workflow.tool.frames2v": "Video from frames and references (all optional)",
      "workflow.tool.panorama_scene": "Panorama with depth",
      "workflow.block.panorama": "Panorama",
      "workflow.block.structure": "Depth (3D points)",
      "workflow.block.prompts": "Prompt parts",
      "workflow.block.negative_prompts": "Negative prompt",
      "workflow.block.tags": "Tags",
      "workflow.block.candidates": "Sorted tags",
      "workflow.block.image_size": "Image size",
      "workflow.block.image": "Generated image",
      "workflow.block.prompt": "Prompt",
      "workflow.block.result": "Result",
      "workflow.block.source_image": "Source image",
      "workflow.block.reference_image": "Reference picture",
      "workflow.block.result_image": "Result image",
      "workflow.block.instruction": "Instruction",
      "workflow.block.keypoints": "3D keypoints",
      "workflow.block.depth_image": "Depth image",
      "workflow.block.video": "Generated video",
      "workflow.block.start_image": "Start image",
      "workflow.block.end_image": "End image",
      "workflow.block.mid_image_1": "Keyframe 1",
      "workflow.block.mid_image_2": "Keyframe 2",
      "workflow.block.mid_image_3": "Keyframe 3",
      "workflow.block.ref_image_1": "Reference 1",
      "workflow.block.ref_image_2": "Reference 2",
      "workflow.block.ref_image_3": "Reference 3",
      "workflow.block.ref_image_4": "Reference 4",
      "workflow.block.ref_image_5": "Reference 5",
      "workflow.block.ref_image_6": "Reference 6",
      "workflow.block.ref_image_7": "Reference 7",
      "workflow.block.ref_image_8": "Reference 8",
      "workflow.block.ref_image_9": "Reference 9",
      "workflow.value.noTool": "no tool",
      "workflow.value.ready": "ready",
      "workflow.value.problems": "{n} to fix",
      "workflow.problem.noWorkflow": "No workflow is chosen.",
      "workflow.problem.noTool": "No tool is chosen.",
      "workflow.problem.unassigned": "\"{block}\" is not assigned to a field.",
      "workflow.problem.overlap": "\"{block}\" writes to a field that is also a setting or fixed.",
    },
    ja: {
      "workflow.vtype.template": "ワークフローテンプレート",
      "workflow.control.templatesummary": "テンプレート要約",
      "workflow.prop.template": "テンプレート",
      "workflow.field.tool": "対応ツール",
      "workflow.tool.t2i": "画像生成（T2I）",
      "workflow.tool.t2i_ref": "画像生成（参照画像つき）",
      "workflow.tool.image_edit": "画像編集（画像と変更内容）",
      "workflow.tool.text_generation": "テキスト生成",
      "workflow.tool.image_to_prompt": "画像からプロンプト生成",
      "workflow.tool.prompt_classify": "タグのカテゴリ分類",
      "workflow.tool.background_removal": "背景除去",
      "workflow.tool.image_restyle": "画像の描き直し",
      "workflow.tool.pose_estimation_3d": "3D姿勢推定",
      "workflow.tool.scene_3d_generation": "3Dシーン生成",
      "workflow.tool.t2v": "動画生成（T2V）",
      "workflow.tool.i2v": "画像から動画生成（I2V）",
      "workflow.tool.frames2v": "フレーム・参照画像から動画生成（画像は省略可）",
      "workflow.tool.panorama_scene": "パノラマ生成（奥行き付き）",
      "workflow.block.panorama": "パノラマ画像",
      "workflow.block.structure": "奥行き（3D点群）",
      "workflow.block.prompts": "プロンプトパーツリスト",
      "workflow.block.negative_prompts": "ネガティブプロンプト",
      "workflow.block.tags": "タグ",
      "workflow.block.candidates": "分類結果",
      "workflow.block.image_size": "画像サイズ",
      "workflow.block.image": "生成画像",
      "workflow.block.prompt": "プロンプト",
      "workflow.block.result": "生成結果",
      "workflow.block.source_image": "入力画像",
      "workflow.block.reference_image": "参照画像",
      "workflow.block.result_image": "結果画像",
      "workflow.block.instruction": "描き直しの指示",
      "workflow.block.keypoints": "3D関節座標",
      "workflow.block.depth_image": "Depth画像",
      "workflow.block.video": "生成動画",
      "workflow.block.start_image": "開始画像",
      "workflow.block.end_image": "終了画像",
      "workflow.block.mid_image_1": "中間画像 1",
      "workflow.block.mid_image_2": "中間画像 2",
      "workflow.block.mid_image_3": "中間画像 3",
      "workflow.block.ref_image_1": "参照画像 1",
      "workflow.block.ref_image_2": "参照画像 2",
      "workflow.block.ref_image_3": "参照画像 3",
      "workflow.block.ref_image_4": "参照画像 4",
      "workflow.block.ref_image_5": "参照画像 5",
      "workflow.block.ref_image_6": "参照画像 6",
      "workflow.block.ref_image_7": "参照画像 7",
      "workflow.block.ref_image_8": "参照画像 8",
      "workflow.block.ref_image_9": "参照画像 9",
      "workflow.value.noTool": "ツール未選択",
      "workflow.value.ready": "使用可能",
      "workflow.value.problems": "要修正 {n} 件",
      "workflow.problem.noWorkflow": "ワークフローが選ばれていません。",
      "workflow.problem.noTool": "対応ツールが選ばれていません。",
      "workflow.problem.unassigned": "「{block}」がフィールドに割り当てられていません。",
      "workflow.problem.overlap": "「{block}」の割り当て先が公開設定または固定値にもなっています。",
    },
  });
  return exposed;
}
