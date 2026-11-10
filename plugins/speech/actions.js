export const actions = {
  "speech.voicevox.run": {
    async run(inputs, { api, signal, progress, status }) {
      const started = Date.now();
      const seconds = () => Math.round((Date.now() - started) / 1000);
      progress("speech.status.waiting", { s: 0 }, { on: "voicevox" });
      const ticker = setInterval(() => {
        if (!signal.aborted) progress("speech.status.waiting", { s: seconds() }, { on: "voicevox" });
      }, 1000);
      try {
        const answer = await api.speech.voicevox.synthesize(
          {
            text: inputs.text,
            speaker: Number(inputs.speaker),
            speedScale: Number(inputs.speedScale),
            pitchScale: Number(inputs.pitchScale),
            intonationScale: Number(inputs.intonationScale),
            volumeScale: Number(inputs.volumeScale),
            prePhonemeLength: Number(inputs.prePhonemeLength),
            postPhonemeLength: Number(inputs.postPhonemeLength),
          },
          { signal }
        );
        if (signal.aborted) return;
        status("speech.status.done", { s: seconds(), len: answer.seconds == null ? "?" : answer.seconds });
        return {
          result: answer.address,
          resultSeconds: Number(answer.seconds) || 0,
          resultName: String(inputs.text).replace(/\s+/g, " ").slice(0, 24),
        };
      } finally {
        clearInterval(ticker);
      }
    },
    cancel() {},
  },

  "speech.irodori.run": {
    async run(inputs, { api, signal, progress, status }) {
      const started = Date.now();
      const seconds = () => Math.round((Date.now() - started) / 1000);
      progress("speech.status.waiting", { s: 0 }, { on: "irodori" });
      const ticker = setInterval(() => {
        if (!signal.aborted) progress("speech.status.waiting", { s: seconds() }, { on: "irodori" });
      }, 1000);
      try {
        const answer = await api.speech.irodori.synthesize(
          {
            text: inputs.text,
            caption: inputs.caption,
            ref: inputs.ref,
            num_steps: Number(inputs.steps),
            cfg_scale_text: Number(inputs.cfgText),
            cfg_scale_caption: Number(inputs.cfgCaption),
            cfg_scale_speaker: Number(inputs.cfgSpeaker),
          },
          { signal }
        );
        if (signal.aborted) return;
        status("speech.status.done", { s: seconds(), len: answer.seconds == null ? "?" : answer.seconds });
        return {
          result: answer.address,
          resultSeconds: Number(answer.seconds) || 0,
          resultName: String(inputs.text).replace(/\s+/g, " ").slice(0, 24),
        };
      } finally {
        clearInterval(ticker);
      }
    },
    cancel() {},
  },
};
