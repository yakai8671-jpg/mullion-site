/* Workflow declarative scripts */

import { declareRunApp, registerAppKit } from "./appkit.js";
import { registerRunner, runAppKit, appEmbed, useComfyView } from "./runner.js";
import { registerTemplates, TOOLS } from "./template.js";
import { registerReadiness } from "./readiness.js";

const isRecord = (value) => !!value && typeof value === "object" && !Array.isArray(value);

// Coerce workflow helpers from index.js
const PLATFORMS = ["comfyui", "ollama"];
const OLLAMA_NODE = "ollama_generate";

const coerceGraph = (value) => {
  let from = value;
  if (typeof from === "string") {
    try {
      from = JSON.parse(from);
    } catch {
      from = null;
    }
  }
  if (!isRecord(from)) return {};
  const graph = {};
  for (const [id, node] of Object.entries(from)) {
    if (!isRecord(node) || !isRecord(node.inputs)) continue;
    graph[String(id)] = node;
  }
  return graph;
};

const platformOf = (graph) =>
  isRecord(graph[OLLAMA_NODE]) && graph[OLLAMA_NODE].class_type === "OllamaGenerate"
    ? "ollama"
    : "comfyui";

const nodeName = (node, id) =>
  (isRecord(node._meta) && node._meta.title) || node.class_type || String(id);

const nativeType = (node, key, value) => {
  const cls = String(node.class_type || "");
  if (cls.includes("PreviewImage") || cls.includes("SaveImage")) return "IMAGE";
  if (key === "image" || key === "images" || key === "pixels") return "IMAGE";
  if (key === "schema") return "JSON_SCHEMA";
  if (typeof value === "boolean") return "BOOLEAN";
  if (typeof value === "number") return Number.isInteger(value) ? "INT" : "FLOAT";
  return "STRING";
};

const fieldId = (nodeId, key) => `${nodeId}::${key}`;

const nativeFields = (graph) => {
  const fields = [];
  for (const [nodeId, node] of Object.entries(graph)) {
    const name = nodeName(node, nodeId);
    if (node.class_type === "OllamaGenerate") {
      fields.push({
        id: fieldId(nodeId, "result"),
        node_id: nodeId,
        input_key: "result",
        node_name: name,
        native_type: "STRING",
        direction: "output",
        source_node_id: nodeId,
        output_index: 0,
      });
    }
    for (const [key, value] of Object.entries(node.inputs)) {
      const linked = Array.isArray(value) && value.length >= 2;
      fields.push({
        id: fieldId(nodeId, key),
        node_id: nodeId,
        input_key: key,
        node_name: name,
        native_type: nativeType(node, key, linked ? undefined : value),
        direction: linked ? "output" : "input",
        ...(linked
          ? { source_node_id: String(value[0]), output_index: value[1] }
          : { default_value: value }),
      });
    }
  }
  return fields;
};

const coerceWorkflow = (value) => {
  const from = isRecord(value) ? value : {};
  const graph = coerceGraph(from.graph);
  const native = new Map(nativeFields(graph).map((field) => [field.id, field]));
  const seen = new Set();
  const fields = [];
  for (const one of Array.isArray(from.fields) ? from.fields : []) {
    if (!isRecord(one)) continue;
    const id = fieldId(String(one.node_id ?? ""), String(one.input_key ?? ""));
    const found = native.get(id);
    if (!found || seen.has(id)) continue;
    seen.add(id);
    fields.push({
      node_id: found.node_id,
      input_key: found.input_key,
      direction: found.direction,
      label: typeof one.label === "string" ? one.label : "",
    });
  }
  const platform = Object.keys(graph).length
    ? platformOf(graph)
    : PLATFORMS.includes(from.platform)
      ? from.platform
      : "comfyui";
  return {
    name: typeof from.name === "string" ? from.name : "",
    platform,
    graph,
    fields,
  };
};

const nodeCount = (value) => Object.keys(coerceWorkflow(value).graph).length;

// Self-initialization harness for runner, templates, appkit
const mockControls = {};
const ITEM_DEFS = {};
const mockValueTypes = {};

// 1. Export item factories
export const itemFactories = {
  "workflow.run": declareRunApp,
};

// 2. Export value type hooks
export let types;
export function initialize(api) {
useComfyView(api.granted("comfy:run").viewUrl);
const harness = {
  core: api.core,
  describe: api.describe,
  describeProperty: api.describeProperty,
  card: api.card,
  grouping: api.grouping,
  controls: mockControls,
  valueTypes: mockValueTypes,
  types: api.types,
  registerControl(id, def) {
    mockControls[id] = def;
  },
  registerValueType(id, def) {
    mockValueTypes[id] = def;
  },
  registerItemType(id, def) {
    ITEM_DEFS[id] = def;
  },
  registerApp() {},
  registerAction() {},
  registerTranslations() {},
  registerItemFactory() {},
};

const templates = registerTemplates(harness, { coerceWorkflow, nativeFields, fieldId, nodeCount, isRecord });
const readiness = registerReadiness(harness, templates);
registerRunner(harness, templates, readiness);
registerAppKit(harness);

types = {
  "workflow.template": {
    defaultValue: mockValueTypes["workflow.template"]?.defaultValue || ((p) => p?.default || {}),
    coerce: mockValueTypes["workflow.template"]?.coerce || ((v) => v),
    format: mockValueTypes["workflow.template"]?.format || ((v) => v?.name || ""),
    methods: mockValueTypes["workflow.template"]?.methods || {},
    groups: {
      of: mockValueTypes["workflow.template"]?.groups?.of || ((value) => (isRecord(value) ? value.tool || "" : "")),
    },
  },
  "workflow.image_size": {
    format: mockValueTypes["workflow.image_size"]?.format || ((v) => (Array.isArray(v) ? `${v[0]} × ${v[1]}` : "")),
    groups: {
      of: mockValueTypes["workflow.image_size"]?.groups?.of || (() => ""),
    },
  },
  "workflow.runpreset": {
    defaultValue: mockValueTypes["workflow.runpreset"]?.defaultValue || ((p) => p?.default || {}),
    coerce: mockValueTypes["workflow.runpreset"]?.coerce || ((v) => v),
    format: mockValueTypes["workflow.runpreset"]?.format || ((v) => v?.summary || ""),
    presetPreview: mockValueTypes["workflow.runpreset"]?.presetPreview,
    presetEditor: mockValueTypes["workflow.runpreset"]?.presetEditor,
    groups: {
      of: mockValueTypes["workflow.runpreset"]?.groups?.of || ((value) => (isRecord(value) ? value.app || "" : "")),
    },
  },
  "workflow.historyentry": {
    defaultValue: mockValueTypes["workflow.historyentry"]?.defaultValue || ((p) => p?.default || {}),
    coerce: mockValueTypes["workflow.historyentry"]?.coerce || ((v) => v),
    format: mockValueTypes["workflow.historyentry"]?.format || ((v) => v?.summary || ""),
    groups: {
      of: mockValueTypes["workflow.historyentry"]?.groups?.of || ((value) => (isRecord(value) ? value.app || "" : "")),
    },
  },
  "workflow.historyrun": {
    defaultValue: mockValueTypes["workflow.historyrun"]?.defaultValue || (() => ({ id: "", name: "", value: {} })),
    coerce: mockValueTypes["workflow.historyrun"]?.coerce || ((v) => v),
    coerceList: mockValueTypes["workflow.historyrun"]?.coerceList || ((v) => (Array.isArray(v) ? v : [])),
    format: mockValueTypes["workflow.historyrun"]?.format || ((v) => v?.name || "\u2014"),
    portKindOf: mockValueTypes["workflow.historyrun"]?.portKindOf,
    portRead: mockValueTypes["workflow.historyrun"]?.portRead,
  },
};
}



// 3. Export control hooks as drawing factories: (api) => ({ render, update })
export const controls = {
  "workflow.templatesummary": (_api) => ({
    render: mockControls["workflow.templatesummary"].render,
    update: mockControls["workflow.templatesummary"].update,
  }),
  "workflow.promptpreview": (_api) => ({
    render: mockControls["workflow.promptpreview"].render,
    update: mockControls["workflow.promptpreview"].update,
  }),
  "workflow.textout": (_api) => ({
    render: mockControls["workflow.textout"].render,
    update: mockControls["workflow.textout"].update,
  }),
  "workflow.fieldlabel": (_api) => ({
    render: mockControls["workflow.fieldlabel"].render,
    update: mockControls["workflow.fieldlabel"].update,
  }),
  "workflow.summaryline": (_api) => ({
    render: mockControls["workflow.summaryline"].render,
    update: mockControls["workflow.summaryline"].update,
  }),
  "workflow.historylist": (_api) => ({
    render: mockControls["workflow.historylist"].render,
    update: mockControls["workflow.historylist"].update,
  }),
};
