const MODEL = {
  unet: "anima-base-v1.0.safetensors",
  clip: "qwen_3_06b_base.safetensors",
  vae: "qwen_image_vae.safetensors",
  turbo: "Turbo-ANIMA-v3.safetensors",
};

const POLL_MS = 1000;
const POLL_RETRIES = 12;
const TIMEOUT_MS = 6 * 60 * 60 * 1000;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function errorOf(messages) {
  const failed = (messages || []).find((one) => Array.isArray(one) && one[0] === "execution_error");
  const detail = failed && failed[1];
  return detail ? `${detail.node_type || detail.node_id || ""}: ${detail.exception_message || ""}`.trim() : "ComfyUI";
}

const asciiOf = (text) => String(text || "").replace(/[^A-Za-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);
const stamp = () => {
  const d = new Date();
  const two = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${two(d.getMonth() + 1)}${two(d.getDate())}-${two(d.getHours())}${two(d.getMinutes())}${two(d.getSeconds())}`;
};
const captionLine = (props, one) => [String(props.trigger || "").trim(), (one.caption || "").trim()].filter(Boolean).join(", ");
const intOf = (value, fallback, min, max) => {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

const loadImage = (src) =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`could not read ${String(src).slice(0, 60)}`));
    img.src = src;
  });

async function scaled(src, area, { step = 16, type = "image/png", quality } = {}) {
  if (typeof Image === "undefined" || typeof document === "undefined" || !document.createElement) {
    return src;
  }
  const img = await loadImage(src);
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  const s = Math.sqrt(area / (w * h));
  const width = Math.max(step * 4, Math.round((w * s) / step) * step);
  const height = Math.max(step * 4, Math.round((h * s) / step) * step);
  const canvas = Object.assign(document.createElement("canvas"), { width, height });
  const g = canvas.getContext("2d");
  g.fillStyle = "#ffffff";
  g.fillRect(0, 0, width, height);
  g.imageSmoothingQuality = "high";
  g.drawImage(img, 0, 0, width, height);
  return canvas.toDataURL(type, quality);
}

const textDataUrl = (text) => {
  if (typeof TextEncoder !== "undefined") {
    const bytes = new TextEncoder().encode(text);
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return `data:text/plain;base64,${btoa(binary)}`;
  }
  return `data:text/plain;base64,${Buffer.from(text).toString("base64")}`;
};

function graphOf(props, folder, samples) {
  const turbo = props.sampleTurbo !== false;
  const prompt = String(props.samplePrompt || "").trim() || captionLine(props, samples[0]);
  return {
    unet: { class_type: "UNETLoader", inputs: { unet_name: MODEL.unet, weight_dtype: "default" } },
    clip: { class_type: "CLIPLoader", inputs: { clip_name: MODEL.clip, type: "stable_diffusion", device: "default" } },
    vae: { class_type: "VAELoader", inputs: { vae_name: MODEL.vae } },
    data: { class_type: "LoadImageTextDataSetFromFolder", inputs: { folder } },
    encode: { class_type: "MakeTrainingDataset", inputs: { images: ["data", 0], vae: ["vae", 0], clip: ["clip", 0], texts: ["data", 1] } },
    train: {
      class_type: "TrainLoraNode",
      inputs: {
        model: ["unet", 0],
        latents: ["encode", 0],
        positive: ["encode", 1],
        batch_size: 1,
        grad_accumulation_steps: 1,
        steps: intOf(props.steps, 500, 1, 100000),
        learning_rate: Math.min(1, Math.max(1e-7, Number(props.learningRate) || 0.0002)),
        rank: intOf(props.rank, 16, 1, 128),
        optimizer: props.optimizer || "AdamW",
        loss_function: "MSE",
        seed: intOf(props.seed, 0, 0, 2 ** 31),
        training_dtype: "bf16",
        lora_dtype: "bf16",
        quantized_backward: false,
        algorithm: props.algorithm || "LoRA",
        gradient_checkpointing: true,
        checkpoint_depth: intOf(props.checkpointDepth, 2, 1, 5),
        offloading: false,
        existing_lora: "[None]",
        bucket_mode: false,
        bypass_mode: false,
      },
    },
    save: { class_type: "MullionSaveLoRA", inputs: { lora: ["train", 0], name: String(props.name || "").trim() || "my_lora" } },
    loss: { class_type: "LossGraphNode", inputs: { loss: ["train", 1], filename_prefix: "Mullion/loratrain_loss" } },
    apply: { class_type: "LoraModelLoader", inputs: { model: ["unet", 0], lora: ["train", 0], strength_model: 1, bypass: false } },
    ...(turbo
      ? { turbo: { class_type: "LoraLoaderModelOnly", inputs: { model: ["apply", 0], lora_name: MODEL.turbo, strength_model: 1 } } }
      : {}),
    positive: { class_type: "CLIPTextEncode", inputs: { text: prompt, clip: ["clip", 0] } },
    negative: { class_type: "CLIPTextEncode", inputs: { text: "", clip: ["clip", 0] } },
    latent: { class_type: "EmptyLatentImage", inputs: { width: 1024, height: 1024, batch_size: 1 } },
    sampler: {
      class_type: "KSampler",
      inputs: {
        seed: intOf(props.seed, 0, 0, 2 ** 31),
        steps: turbo ? 8 : 30,
        cfg: turbo ? 1 : 4,
        sampler_name: "euler_ancestral",
        scheduler: "simple",
        denoise: 1,
        model: [turbo ? "turbo" : "apply", 0],
        positive: ["positive", 0],
        negative: ["negative", 0],
        latent_image: ["latent", 0],
      },
    },
    decode: { class_type: "VAEDecode", inputs: { samples: ["sampler", 0], vae: ["vae", 0] } },
    picture: { class_type: "SaveImage", inputs: { images: ["decode", 0], filename_prefix: "Mullion/loratrain" } },
  };
}

const keepOf = async (api, ref) => {
  if (!ref) return "";
  const made = { filename: ref.filename, subfolder: ref.subfolder || "", type: ref.type || "output" };
  return (await api.comfy.keep(made).catch(() => null)) || api.comfy.viewUrl(made);
};

export const actions = {
  "loratrain.run": {
    async run(inputs, { api, signal, progress, status, t }) {
      const samples = Array.isArray(inputs.dataset) ? inputs.dataset : [];
      if (!samples.length) {
        status("loratrain.value.noPictures");
        return;
      }

      let promptId = null;
      signal.addEventListener("abort", () => {
        if (promptId) api.comfy.interrupt().catch(() => {});
      });

      const started = Date.now();
      const seconds = () => Math.round((Date.now() - started) / 1000);

      try {
        const nodes = await api.comfy.nodes().catch(() => null);
        const known = nodes && nodes.names;
        if (Array.isArray(known) && !known.includes("MullionSaveLoRA")) {
          throw new Error(t("loratrain.status.noNode"));
        }

        const size = intOf(inputs.resolution, 768, 256, 2048);
        const folder = `mullion_lora/${asciiOf(inputs.name) || "lora"}_${stamp()}`;

        for (const [index, one] of samples.entries()) {
          if (signal.aborted) return;
          progress("loratrain.status.preparing", { i: index + 1, n: samples.length }, { on: "comfyui" });
          const filename = String(index).padStart(3, "0");
          await api.comfy.upload(await scaled(one.src, size * size), { subfolder: folder, filename });
          await api.comfy.upload(textDataUrl(captionLine(inputs, one)), { subfolder: folder, filename });
        }

        if (signal.aborted) return;

        const { prompt_id } = await api.comfy.queue(graphOf(inputs, folder, samples));
        promptId = prompt_id;
        if (signal.aborted) {
          api.comfy.interrupt().catch(() => {});
          return;
        }

        let unanswered = 0;
        while (!signal.aborted) {
          if (Date.now() - started > TIMEOUT_MS) throw new Error("timeout");
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
            const p = history.progress || {};
            if (!p.started && p.ahead) {
              progress("loratrain.status.queued", { n: p.ahead }, { on: "comfyui" });
            } else if (p.node === "train" && p.max > 0) {
              progress("loratrain.status.training", { value: p.value, max: p.max, s: seconds() }, { on: "comfyui" });
            } else if ((p.done || []).includes("train")) {
              progress("loratrain.status.sampling", { s: seconds() }, { on: "comfyui" });
            } else {
              progress("loratrain.status.loading", { s: seconds() }, { on: "comfyui" });
            }
            continue;
          }

          if (!history.ok) throw new Error(errorOf(history.messages));

          const outputs = history.outputs || {};
          const name = ((outputs.save || {}).text || [])[0] || "";
          const resultImg = await keepOf(api, ((outputs.picture || {}).images || [])[0]);
          const lossImg = await keepOf(api, ((outputs.loss || {}).images || [])[0]);

          status("loratrain.status.done", { name, s: seconds() });
          return {
            result: resultImg,
            loss: lossImg,
            loraName: name,
          };
        }
      } catch (error) {
        if (signal.aborted) {
          status("loratrain.status.cancelled");
        } else {
          status("loratrain.status.failed", { error: error.message || error });
          throw error;
        }
      } finally {
        progress("", {}, { on: "comfyui" });
      }
    },
  },
};
