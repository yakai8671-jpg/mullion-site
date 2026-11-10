import { abcDocument, abcOf, newId } from "./sections.js";

// Native ComfyUI YuE2 nodes: the generated duration sizes the audio latent.
export function graphOf(inputs, seed) {
  const mode = ["full", "melody"].includes(inputs.planning) ? inputs.planning : "off";
  const score = mode === "off" ? "" : abcDocument(inputs.abc);
  // A score changed after generation is treated as a manual edit and preserved.
  const edited = score && score !== (inputs.abcMade || "");
  const auto = mode !== "off" && inputs.abcAuto && !edited;
  const graph = {
    load: { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: inputs.model } },
    music: { class_type: "YuE2GenerateMusic", inputs: {
      clip: ["load", 1], style: inputs.style || "", lyrics: inputs.lyrics || "", abc: auto ? ["abc", 0] : score,
      seed, mode, max_duration: inputs.maxDuration, temperature: inputs.musicTemperature,
      top_p: 0.95, top_k: 100, repetition_penalty: 1.2,
    } },
    negative: { class_type: "ConditioningZeroOut", inputs: { conditioning: ["music", 0] } },
    latent: { class_type: "EmptyYuE2LatentAudio", inputs: { seconds: ["music", 1], batch_size: 1 } },
    sample: { class_type: "KSampler", inputs: { model: ["load", 0], positive: ["music", 0], negative: ["negative", 0], latent_image: ["latent", 0], seed, steps: inputs.steps, cfg: 1, sampler_name: "dpm_2", scheduler: "sgm_uniform", denoise: 1 } },
    decode: { class_type: "VAEDecodeAudio", inputs: { samples: ["sample", 0], vae: ["load", 2] } },
    save: { class_type: "SaveAudioAdvanced", inputs: { audio: ["decode", 0], filename_prefix: "audio/Mullion", format: { format: inputs.format || "mp3", ...((inputs.format || "mp3") === "mp3" ? { quality: "V0" } : inputs.format === "opus" ? { quality: "128k" } : {}) } } },
  };
  if (auto) {
    graph.abc = { class_type: "YuE2GenerateABC", inputs: { clip: ["load", 1], style: inputs.style || "", lyrics: inputs.lyrics || "", seed, mode, max_abc_tokens: 8192, temperature: inputs.abcTemperature, top_p: 0.9, top_k: 30, repetition_penalty: 1.005, penalty_window: 100 } };
    graph.abcText = { class_type: "PreviewAny", inputs: { source: ["abc", 0] } };
  }
  return graph;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function moveEntry(values, id, direction) {
  const out = [...(values || [])];
  const from = out.findIndex((entry) => entry.id === id);
  const to = from + Math.sign(direction);
  if (from < 0 || to < 0 || to >= out.length || to === from) return out;
  [out[from], out[to]] = [out[to], out[from]];
  return out;
}
export const actions = {
  "yue2.lyrics.move": { run: ({ lyrics, id, direction }) => ({ lyrics: moveEntry(lyrics, id, direction) }) },
  "yue2.abc.move": { run: ({ abc, id, direction }) => ({ abc: { ...abcOf(abc), sections: moveEntry(abcOf(abc).sections, id, direction) } }) },
  "yue2.transcribe": {
    async run({ audio, mode, model }, { api, signal, progress, status }) {
      let promptId;
      signal.addEventListener("abort", () => { if (promptId) api.comfy.interrupt().catch(() => {}); }, { once: true });
      try {
        const started = Date.now();
        progress("yue2.transcribe.status.uploading", {}, { on: "comfyui" });
        const upload = await api.comfy.upload(audio);
        if (signal.aborted) return;
        const graph = {
          load: { class_type: "LoadAudio", inputs: { audio: upload.name } },
          encoder: { class_type: "AudioEncoderLoader", inputs: { audio_encoder_name: model || "sheetsage2_bf16.safetensors" } },
          abc: { class_type: "SheetSage2AudioToABC", inputs: { audio_encoder: ["encoder", 0], audio: ["load", 0], mode: ["melody", "full"].includes(mode) ? mode : "melody" } },
          text: { class_type: "PreviewAny", inputs: { source: ["abc", 0] } },
        };
        const queued = await api.comfy.queue(graph);
        promptId = queued.prompt_id;
        if (signal.aborted) { await api.comfy.interrupt().catch(() => {}); return; }
        let failures = 0;
        while (!signal.aborted) {
          await sleep(1000);
          if (signal.aborted) return;
          let history;
          try { history = await api.comfy.history(promptId); failures = 0; }
          catch (error) { if (++failures >= 12) throw error; continue; }
          if (!history.done) { progress("yue2.transcribe.status.waiting", { s: Math.round((Date.now() - started) / 1000) }, { on: "comfyui" }); continue; }
          if (!history.ok) {
            const failure = (history.messages || []).find((entry) => entry?.[0] === "execution_error");
            throw new Error(failure?.[1]?.exception_message || "ComfyUI");
          }
          const output = history.outputs?.text?.text;
          const abc = (Array.isArray(output) ? output : [output]).map((one) => String(one ?? "")).join("\n").trim();
          if (!abc) { status("yue2.transcribe.status.nothing"); return; }
          status("yue2.transcribe.status.done", { s: Math.round((Date.now() - started) / 1000) });
          return { abc };
        }
      } catch (error) { if (!signal.aborted) status("yue2.transcribe.status.failed", { error: error.message || String(error) }); }
    },
  },
  "yue2.abc.add": { run: ({ abc }) => ({ abc: { ...abcOf(abc), sections: [...abcOf(abc).sections, { id: newId(), name: "verse", text: "" }] } }) },
  "yue2.abc.remove": { run: ({ abc, id }) => ({ abc: { ...abcOf(abc), sections: abcOf(abc).sections.filter((entry) => entry.id !== id) } }) },
  "yue2.score.change": { run: ({ parts, part, text }) => ({ parts: (parts || []).map((entry) => entry.id === part ? { ...entry, text } : entry) }) },
  "yue2.score.part": { run: ({ part }) => ({ part }) },
  "yue2.lyrics.add": { run: ({ lyrics }) => ({ lyrics: [...(lyrics || []), { id: newId(), name: "Verse", text: "" }] }) },
  "yue2.lyrics.remove": { run: ({ lyrics, id }) => ({ lyrics: (lyrics || []).filter((entry) => entry.id !== id) }) },
  "yue2.generate": {
    async run(inputs, { api, signal, progress, status, write }) {
      const seed = inputs.randomSeed ? Math.floor(Math.random() * Number.MAX_SAFE_INTEGER) : inputs.seed;
      let promptId;
      signal.addEventListener("abort", () => { if (promptId) api.comfy.interrupt().catch(() => {}); }, { once: true });
      try {
        const started = Date.now();
        const queued = await api.comfy.queue(graphOf(inputs, seed));
        promptId = queued.prompt_id;
        if (signal.aborted) { await api.comfy.interrupt().catch(() => {}); return; }
        let failures = 0;
        while (!signal.aborted) {
          await sleep(1000);
          if (signal.aborted) return;
          let history;
          try { history = await api.comfy.history(promptId); failures = 0; }
          catch (error) { if (++failures >= 12) throw error; continue; }
          if (!history.done) { progress("yue2.status.waiting", { s: Math.round((Date.now() - started) / 1000) }, { on: "comfyui" }); continue; }
          const written = history.outputs?.abcText?.text;
          const score = (Array.isArray(written) ? written : [written]).map((one) => String(one ?? "")).join("\n").trim();
          // Keep an intermediate score even if audio decoding fails afterwards.
          if (score && write) write({ abc: abcOf(score), abcMade: score });
          if (!history.ok) {
            const failure = (history.messages || []).find((entry) => entry?.[0] === "execution_error");
            throw new Error(failure?.[1]?.exception_message || "ComfyUI");
          }
          const audio = history.outputs?.save?.audio?.[0];
          if (!audio) { status("yue2.status.nothing"); return; }
          const result = { audio: (await api.comfy.keep(audio).catch(() => null)) || api.comfy.viewUrl(audio) };
          status("yue2.status.done", { s: Math.round((Date.now() - started) / 1000), len: "" });
          return result;
        }
      } catch (error) { if (!signal.aborted) status("yue2.status.failed", { error: error.message || String(error) }); }
    },
  },
};
