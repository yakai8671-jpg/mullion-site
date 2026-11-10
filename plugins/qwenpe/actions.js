const TASKS = {
  t2i: {
    model: "qwen3.5_9b_qwen_image_2.1_pe_t2i.int8_convrot.safetensors",
    prompt: "system_prompt_t2i.txt",
    presencePenalty: 1.5,
  },
  edit: {
    model: "qwen3.5_9b_qwen_image_2.1_pe_i2i.int8_convrot.safetensors",
    prompt: "system_prompt_edit.txt",
    presencePenalty: 0,
  },
};
const taskOf = (mode) => TASKS[mode] || TASKS.t2i;

const PICTURES = ["image1", "image2", "image3", "image4"];
const VISION_BLOCK = "<|vision_start|><|image_pad|><|vision_end|>";

const POLL_MS = 1000;
const POLL_RETRIES = 12;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const PROMPTS = new Map();
async function systemPrompt(file) {
  if (!PROMPTS.has(file)) {
    const promise = (async () => {
      const url = new URL(`./prompts/${file}`, import.meta.url);
      const answer = await fetch(url);
      if (!answer.ok) throw new Error(`${file}: ${answer.status}`);
      const text = await answer.text();
      return text.trim();
    })().catch((error) => {
      PROMPTS.delete(file);
      throw error;
    });
    PROMPTS.set(file, promise);
  }
  return PROMPTS.get(file);
}

function chatOf(system, request, pictures) {
  return (
    `<|im_start|>system\n${system}<|im_end|>\n` +
    `<|im_start|>user\n${VISION_BLOCK.repeat(pictures)}${request}<|im_end|>\n` +
    "<|im_start|>assistant\n<think>\n"
  );
}

function objectsIn(text) {
  const spans = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === "}" && depth > 0) {
      depth--;
      if (depth === 0 && start >= 0) spans.push(text.slice(start, i + 1));
    }
  }
  return spans;
}

function answerOf(text) {
  const answer = String(text || "").trim();
  for (const candidate of objectsIn(answer).reverse()) {
    let found;
    try {
      found = JSON.parse(candidate);
    } catch {
      continue;
    }
    if (!found || typeof found !== "object") continue;
    const prompt = found.rewritten_prompt || found.rewrited_prompt;
    if (typeof prompt !== "string" || !prompt.trim()) continue;
    return {
      prompt: prompt.trim(),
      ratio: String(found.wh_ratio || "").trim(),
      follow: String(found.ratio_follow || "").trim(),
      ok: true,
    };
  }
  return { prompt: answer, ratio: "", follow: "", ok: false };
}

function graphOf(props, chat, uploaded) {
  const task = taskOf(props.mode);
  const graph = {
    clip: { class_type: "CLIPLoader", inputs: { clip_name: props.model || task.model, type: "qwen_image", device: "default" } },
  };
  const generate = {
    clip: ["clip", 0],
    prompt: chat,
    max_length: Math.max(256, Math.floor(Number(props.maxLength) || 4096)),
    sampling_mode: "on",
    "sampling_mode.temperature": 1.0,
    "sampling_mode.top_k": 20,
    "sampling_mode.top_p": 0.95,
    "sampling_mode.min_p": 0,
    "sampling_mode.repetition_penalty": 1.0,
    "sampling_mode.seed": Math.floor(Math.random() * 2 ** 31),
    "sampling_mode.presence_penalty": task.presencePenalty,
    thinking: true,
    use_default_template: false,
    mtp: "auto",
  };
  if (uploaded.length) {
    uploaded.forEach((name, index) => {
      graph[`load${index}`] = { class_type: "LoadImage", inputs: { image: name } };
    });
    graph.scale = {
      class_type: "ImageScaleToTotalPixels",
      inputs: { image: ["load0", 0], upscale_method: "area", megapixels: 1.0, resolution_steps: 1 },
    };
    if (uploaded.length === 1) generate.image = ["scale", 0];
    else {
      const inputs = { "images.image0": ["scale", 0] };
      for (let index = 1; index < uploaded.length; index++) inputs[`images.image${index}`] = [`load${index}`, 0];
      graph.batch = { class_type: "BatchImagesNode", inputs };
      generate.image = ["batch", 0];
    }
  }
  graph.generate = { class_type: "TextGenerate", inputs: generate };
  graph.text = { class_type: "PreviewAny", inputs: { source: ["generate", 0] } };
  graph.reasoning = { class_type: "PreviewAny", inputs: { source: ["generate", 1] } };
  return graph;
}

function errorOf(messages) {
  const failed = (messages || []).find((one) => Array.isArray(one) && one[0] === "execution_error");
  const detail = failed && failed[1];
  return detail ? `${detail.node_type || detail.node_id || ""}: ${detail.exception_message || ""}`.trim() : "ComfyUI";
}

const textOf = (outputs, node) => {
  const text = ((outputs || {})[node] || {}).text;
  return Array.isArray(text) ? String(text[0] ?? "") : String(text ?? "");
};

const picturesOf = (props) => {
  const out = [];
  for (const key of PICTURES) {
    if (!props[key]) break;
    out.push(props[key]);
  }
  return out;
};

export const actions = {
  "qwenpe.run": {
    ready(inputs, { t }) {
      if (inputs.mode === "edit") {
        const pictures = picturesOf(inputs);
        if (!pictures.length) return [t("qwenpe.value.noPicture")];
      }
    },
    async run(inputs, { api, signal, progress, status, t }) {
      const request = String(inputs.request || "").trim();
      if (!request) {
        status("qwenpe.value.noRequest");
        return;
      }
      const pictures = inputs.mode === "edit" ? picturesOf(inputs) : [];
      if (inputs.mode === "edit" && !pictures.length) {
        status("qwenpe.value.noPicture");
        return;
      }

      let promptId = null;
      signal.addEventListener("abort", () => {
        if (promptId) api.comfy.interrupt().catch(() => {});
      });

      const started = Date.now();
      const seconds = () => Math.round((Date.now() - started) / 1000);

      try {
        const system = await systemPrompt(taskOf(inputs.mode).prompt);
        if (signal.aborted) return;

        const uploaded = [];
        if (pictures.length) progress("qwenpe.status.uploading", {}, { on: "comfyui" });
        for (const picture of pictures) {
          const res = await api.comfy.upload(picture);
          uploaded.push(res.name);
          if (signal.aborted) return;
        }

        const chat = chatOf(system, request, uploaded.length);
        const { prompt_id } = await api.comfy.queue(graphOf(inputs, chat, uploaded));
        promptId = prompt_id;
        if (signal.aborted) {
          api.comfy.interrupt().catch(() => {});
          return;
        }

        let unanswered = 0;
        while (!signal.aborted) {
          await sleep(POLL_MS);
          if (signal.aborted) return;
          let history;
          try {
            history = await api.comfy.history(promptId);
            unanswered = 0;
          } catch (error) {
            if (++unanswered >= POLL_RETRIES) throw error;
            continue;
          }
          if (!history.done) {
            const prog = history.progress || {};
            if (prog.ahead) {
              progress("qwenpe.status.queued", { n: prog.ahead }, { on: "comfyui" });
            } else if (prog.node === "generate" && prog.max) {
              progress("qwenpe.status.tokens", { n: prog.value || 0, max: prog.max, s: seconds() }, { on: "comfyui" });
            } else {
              progress("qwenpe.status.waiting", { s: seconds() }, { on: "comfyui" });
            }
            continue;
          }
          if (!history.ok) throw new Error(errorOf(history.messages));

          const text = textOf(history.outputs, "text");
          const reasoning = textOf(history.outputs, "reasoning");

          if (!text.trim()) {
            status("qwenpe.status.truncated", { s: seconds() });
            return {
              result: "",
              ratio: "",
              follow: "",
              parsed: true,
              truncated: true,
              thinking: reasoning,
            };
          }

          const answer = answerOf(text);
          status(answer.ok ? "qwenpe.status.done" : "qwenpe.value.notOk", { s: seconds() });
          return {
            result: answer.prompt,
            ratio: answer.ratio,
            follow: answer.follow,
            parsed: answer.ok,
            truncated: false,
            thinking: reasoning,
          };
        }
      } catch (error) {
        if (signal.aborted) {
          status("qwenpe.status.cancelled");
        } else {
          status("qwenpe.status.failed", { error: error.message || error });
          throw error;
        }
      } finally {
        progress("", {}, { on: "comfyui" });
      }
    },
  },
};
