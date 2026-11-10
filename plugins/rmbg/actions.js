import { POLL_MS, POLL_RETRIES, dataUrlOf, errorOf, removalInputs, sleep } from "./common.js";

const IMAGE_TIMEOUT_MS = 10 * 60 * 1000;
const VIDEO_TIMEOUT_MS = 60 * 60 * 1000;

const OUTPUTS = {
  webm: { format: "video/webm", options: { pix_fmt: "yuva420p", crf: 20, save_metadata: false, trim_to_audio: false } },
  prores: { format: "video/ProRes", options: { profile: "4444" } },
  mp4: {
    format: "video/h264-mp4",
    options: { pix_fmt: "yuv420p", crf: 19, save_metadata: false, trim_to_audio: false },
    flat: true,
  },
  matte: {
    format: "video/h264-mp4",
    options: { pix_fmt: "yuv420p", crf: 19, save_metadata: false, trim_to_audio: false },
    matte: true,
  },
};

const COLORS = {
  green: "#00b140",
  blue: "#0047bb",
  black: "#000000",
  white: "#ffffff",
  gray: "#222222",
};

const NO_AUDIO = /failed to extract audio/i;

function imageGraph(props, uploaded) {
  return {
    1: { class_type: "LoadImage", inputs: { image: uploaded } },
    2: removalInputs(props, ["1", 0]),
    3: { class_type: "SaveImage", inputs: { images: ["2", 0], filename_prefix: "Mullion/rmbg" } },
  };
}

function videoGraph(props, uploaded, audio = true) {
  const output = OUTPUTS[props.output] || OUTPUTS.webm;
  const load = {
    video: uploaded,
    force_rate: Math.max(0, Number(props.fps) || 0),
    custom_width: Math.max(0, Math.floor(Number(props.width) || 0)),
    custom_height: 0,
    frame_load_cap: Math.max(0, Math.floor(Number(props.limit) || 0)),
    skip_first_frames: Math.max(0, Math.floor(Number(props.skip) || 0)),
    select_every_nth: Math.max(1, Math.floor(Number(props.every) || 1)),
    format: "None",
  };
  const combine = {
    images: ["2", output.matte ? 2 : 0],
    frame_rate: ["3", 0],
    loop_count: 0,
    filename_prefix: "Mullion/rmbg_video",
    format: output.format,
    pingpong: false,
    save_output: true,
    ...output.options,
  };
  if (audio && props.audio !== false && !output.matte) combine.audio = ["1", 2];
  const removal = removalInputs(props, ["1", 0], {
    background: output.flat ? "Color" : "Alpha",
    color: COLORS[props.background] || COLORS.green,
  });
  return {
    1: { class_type: "VHS_LoadVideo", inputs: load },
    2: removal,
    3: { class_type: "VHS_VideoInfoLoaded", inputs: { video_info: ["1", 3] } },
    4: { class_type: "VHS_VideoCombine", inputs: combine },
  };
}

async function uploadable(api, src) {
  if (src.startsWith("data:") || api.store.isKept(src)) return src;
  const data = await dataUrlOf(src);
  return api.store && api.store.keepFile ? api.store.keepFile(data) : data;
}

export const actions = {
  "rmbg.run": {
    async run(inputs, { api, signal, progress, status, t }) {
      const started = Date.now();
      const seconds = () => Math.round((Date.now() - started) / 1000);
      let promptId = null;
      signal.addEventListener("abort", () => {
        if (promptId) api.comfy.interrupt().catch(() => {});
      });

      progress("rmbg.status.uploading", {}, { on: "comfyui" });
      const { name } = await api.comfy.upload(inputs.source);
      if (signal.aborted) return;

      const { prompt_id } = await api.comfy.queue(imageGraph(inputs, name));
      promptId = prompt_id;
      if (signal.aborted) {
        api.comfy.interrupt().catch(() => {});
        return;
      }

      let unanswered = 0;
      while (!signal.aborted) {
        if (Date.now() - started > IMAGE_TIMEOUT_MS) throw new Error("timeout");
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
          progress("rmbg.status.waiting", { s: seconds() }, { on: "comfyui" });
          continue;
        }
        if (!history.ok) throw new Error(errorOf(history.messages));
        const ref = (((history.outputs || {})["3"] || {}).images || [])[0];
        if (!ref) throw new Error(t("rmbg.status.nothing"));
        const made = { filename: ref.filename, subfolder: ref.subfolder || "", type: ref.type || "output" };
        const result = (await api.comfy.keep(made).catch(() => null)) || api.comfy.viewUrl(made);
        status("rmbg.status.done", { s: seconds() });
        return { result };
      }
    },
    cancel({ api }) {
      api.comfy.interrupt().catch(() => {});
    },
  },

  "rmbg.keep": {
    async run({ src, sourceName }, { api, prompt, status }) {
      const baseName = (String(sourceName || "").replace(/\.[^.]+$/, "") || "image").slice(0, 80);
      const name = await prompt("rmbg.prompt.keepName", {}, {
        title: "mu.action.keepImage",
        value: `${baseName}_nobg`,
      });
      if (!name) return;
      try {
        await api.store.save({ type: "image", name, value: await dataUrlOf(src) });
        status("rmbg.status.kept", { name });
      } catch (error) {
        status("rmbg.status.failed", { error: error.message || error });
      }
    },
  },

  "rmbg.video.run": {
    async run(inputs, { api, signal, progress, status, t }) {
      const started = Date.now();
      const seconds = () => Math.round((Date.now() - started) / 1000);
      let promptId = null;
      signal.addEventListener("abort", () => {
        if (promptId) api.comfy.interrupt().catch(() => {});
      });

      async function finish(graph) {
        const { prompt_id } = await api.comfy.queue(graph);
        promptId = prompt_id;
        let unanswered = 0;
        while (!signal.aborted) {
          if (Date.now() - started > VIDEO_TIMEOUT_MS) throw new Error("timeout");
          await sleep(POLL_MS);
          if (signal.aborted) return null;
          let history;
          try {
            history = await api.comfy.history(promptId);
            unanswered = 0;
          } catch (error) {
            if (++unanswered >= POLL_RETRIES) throw error;
            continue;
          }
          if (history.done) return history;
          progress("rmbg.video.status.waiting", { s: seconds() }, { on: "comfyui" });
        }
        return null;
      }

      async function hasSound(name) {
        if (inputs.audio === false || (OUTPUTS[inputs.output] || {}).matte) return false;
        const history = await finish({
          1: {
            class_type: "VHS_LoadVideo",
            inputs: { video: name, force_rate: 0, custom_width: 0, custom_height: 0, frame_load_cap: 1, skip_first_frames: 0, select_every_nth: 1, format: "None" },
          },
          2: { class_type: "PreviewAudio", inputs: { audio: ["1", 2] } },
        }).catch(() => null);
        return !(history && !history.ok && NO_AUDIO.test(errorOf(history.messages)));
      }

      progress("rmbg.video.status.uploading", {}, { on: "comfyui" });
      const { name } = await api.comfy.upload(await uploadable(api, inputs.source));
      if (signal.aborted) return;
      let audio = await hasSound(name);
      if (signal.aborted) return;
      for (;;) {
        const history = await finish(videoGraph(inputs, name, audio));
        if (!history || signal.aborted) return;
        if (!history.ok) {
          const message = errorOf(history.messages);
          if (audio && NO_AUDIO.test(message)) {
            audio = false;
            continue;
          }
          throw new Error(message);
        }
        const ref = (((history.outputs || {})["4"] || {}).gifs || [])[0];
        if (!ref) throw new Error(t("rmbg.video.status.nothing"));
        const made = { filename: ref.filename, subfolder: ref.subfolder || "", type: ref.type || "output" };
        const result = (await api.comfy.keep(made).catch(() => null)) || api.comfy.viewUrl(made);
        status("rmbg.video.status.done", { s: seconds() });
        return { result };
      }
    },
    cancel({ api }) {
      api.comfy.interrupt().catch(() => {});
    },
  },
};
