/* Prompt declarative scripts */

import createPrompt from "./prompt_core.js";
import { keepRun } from "../workflow/runner.js";

let generation;
let promptCore;
export let types;
export function initialize(api) {
  promptCore = api.core;
  // The drawing of the plugin's own controls, the hooks of its values and the asking of Ollama: prompt_core.js.
  generation = createPrompt(api);
  const hooks = generation.types;
  const hooked = (id, names) => Object.fromEntries(names.filter((name) => hooks[id]?.[name] !== undefined).map((name) => [name, hooks[id][name]]));
  const common = ["defaultValue", "coerce", "format", "methods"];
  types = {
    "prompt.part": { ...hooked("prompt.part", [...common, "presetName", "presetEditor"]), groups: { of: hooks["prompt.part"]?.groups?.of || ((v) => v?.category || "") } },
    "prompt.category": hooked("prompt.category", ["presetName"]),
    "prompt.sentence": { ...hooked("prompt.sentence", [...common, "presetName", "presetEditor"]), groups: { of: hooks["prompt.sentence"]?.groups?.of || ((v) => v?.category || "") } },
    "prompt.slot": hooked("prompt.slot", [...common, "coerceList", "portPut"]),
    "prompt.tag": hooked("prompt.tag", [...common, "coerceList"]),
    "prompt.description": {},
    "prompt.text": {},
  };
}

export const derived = {
  assembled: (_api, item) => generation.assemble((item && item.props.slots) || [], item ? item.props.separator ?? ", " : ", "),
};

// Controls whose drawing is in prompt_core.js.
const DRAWN = ["prompt.tagcard", "prompt.sentencecard", "prompt.sentenceedit", "prompt.partedit", "prompt.promptline", "prompt.promptlist", "prompt.tagline"];

export const controls = {
  "prompt.modelselect": () => ({
    render(desc, onChange) {
      const select = document.createElement("select");
      select.className = "input mu-prop-input";
      select.__desc = desc;
      select.__onChange = onChange;
      select.addEventListener("change", () => onChange(select.value));
      const load = async () => {
        if (select.__loading) return;
        select.__loading = true;
        try {
          const state = await select.__desc.api.ollama.status();
          const models = (state?.models || []).map(String).filter(Boolean);
          const current = String(select.__desc.value || "");
          select.replaceChildren(...models.map((model) => {
            const option = document.createElement("option"); option.value = model; option.textContent = model; return option;
          }));
          if (models.length) {
            const chosen = models.includes(current) ? current : models[0];
            select.value = chosen;
            if (chosen !== current) select.__onChange(chosen);
          } else if (current) {
            const option = document.createElement("option"); option.value = current; option.textContent = current; select.append(option); select.value = current;
          }
        } catch (_) { /* Keep the current selection while the service is unavailable. */ }
        finally { select.__loading = false; }
      };
      select.addEventListener("focus", load);
      load();
      return select;
    },
    update(select, desc) {
      select.__desc = desc;
      if ([...select.options].some((option) => option.value === String(desc.value || ""))) select.value = desc.value;
      select.disabled = Boolean(desc.readonly);
    },
  }),
  ...Object.fromEntries(DRAWN.map((id) => [id, () => ({ render: generation.controls[id].render, update: generation.controls[id].update })])),
};

const outputFor = { text: "resultText", style: "resultStyle", taglist: "resultTags", prompt: "resultPrompt", promptlist: "resultList" };
export const actions = {
  "prompt.restore": {
    run({ entry }) {
      if (!entry || typeof entry !== "object") return;
      const run = entry.run && typeof entry.run === "object" ? entry.run : null;
      if (run && outputFor[run.kind]) {
        const empty = { text: "", style: "", taglist: [], prompt: null, promptlist: [] };
        return { kind: run.kind, description: String(run.description ?? entry.summary ?? ""),
          ...(run.model ? { model: String(run.model) } : {}), [outputFor[run.kind]]: run.result ?? empty[run.kind] };
      }
      return { kind: "text", description: String(entry.summary ?? ""), resultText: String(entry.output ?? "") };
    },
  },
  "prompt.generate": {
    async run({ description, kind, model, dictionary }, { api, signal, status, progress }) {
      const key = outputFor[kind];
      if (!key) return;
      const started = Date.now();
      try {
        const info = { onPhase: (phase) => progress(phase === "search" ? "prompt.status.searching" : "prompt.status.asking", { s: 0 }, { on: "ollama" }) };
        const made = await generation.askFor(api, kind, description.trim(), model, dictionary, info);
        if (signal.aborted) return;
        if (!made || (Array.isArray(made) && !made.length)) { status("prompt.status.nothingWritten"); return; }
        const written = String((typeof made === "string" ? made : promptCore.portConvert(made, kind, "text")) ?? "");
        keepRun(api, {
          app: "prompt.generator", label: promptCore.t("prompt.item.generator"), at: new Date(started),
          summary: description.trim(), output: written,
          run: { description: description.trim(), kind, model, result: structuredClone(made), ...(info.candidates ? { keywords: info.keywords, candidates: info.candidates } : {}) },
          results: [{ kind: "text", text: written }], seconds: Math.round((Date.now() - started) / 100) / 10,
        }).catch(() => {});
        if (info.missing) status("prompt.status.noDictionary");
        else if (info.unknown?.length) status("prompt.status.notInDictionary", { n: info.unknown.length, tags: info.unknown.slice(0, 6).join(", ") });
        return { [key]: made };
      } catch (error) { if (!signal.aborted) status("prompt.status.ollamaFailed", { error: error.message || String(error) }); }
    },
  },
};
