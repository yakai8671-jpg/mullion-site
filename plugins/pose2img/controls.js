import { SceneView, loadLibs } from "./scene.js";
import { LIVE } from "./hooks.js";

export const controls = {
  "pose2img.viewport": (api) => {
    const { core } = api;
    const t = core?.t || ((k) => k);
    const icon = (name) => {
      const node = document.createElement("i");
      node.className = `bi bi-${core?.ICONS?.[name] || name}`;
      return node;
    };

    return {
      mount(host, desc) {
        if (typeof document === "undefined" || !document.createElement) {
          host.__view = { desc };
          return;
        }
        host.classList.add("pose2img-viewport");
        const frame = Object.assign(document.createElement("div"), { className: "pose2img-viewport-frame" });
        const canvas = document.createElement("canvas");
        const note = Object.assign(document.createElement("div"), {
          className: "pose2img-viewport-note",
          textContent: t("pose2img.value.loading"),
        });
        const modes = Object.assign(document.createElement("div"), { className: "pose2img-modes" });
        for (const [mode, name] of [
          ["translate", "arrows-move"],
          ["rotate", "arrow-repeat"],
          ["scale", "arrows-angle-expand"],
        ]) {
          const button = document.createElement("button");
          button.type = "button";
          button.className = "mu-item-button mu-icontoggle";
          button.dataset.mode = mode;
          button.title = t(`pose2img.mode.${mode}`);
          button.append(icon(name));
          button.addEventListener("click", (event) => {
            event.stopPropagation();
            const p = host.__view?.desc?.params;
            if (p?.onMode) p.onMode(mode);
          });
          modes.append(button);
        }
        frame.append(canvas, modes, note);
        host.append(frame);

        const state = { desc, view: null, shot: "", timer: 0, key: "" };
        host.__view = state;

        state.report = () => {
          clearTimeout(state.timer);
          state.timer = setTimeout(() => {
            const view = state.view;
            const p = state.desc?.params;
            if (!view || !view.vrm || !p?.onShot) return;
            const aspect = Number(p.aspect) || 1;
            const w = aspect >= 1 ? 256 : Math.round(256 * aspect);
            const h = aspect >= 1 ? Math.round(256 / aspect) : 256;
            const picture = view.capturePreview(w, h, "image/jpeg");
            const angle = view.describeCamera();
            const key = JSON.stringify(angle) + picture.length + picture.slice(-64);
            if (key === state.shot) return;
            state.shot = key;
            p.onShot(picture, angle);
          }, 250);
        };
        state.fit = () => {
          if (!state.view) return;
          const box = frame.getBoundingClientRect();
          if (box.width <= 0 || box.height <= 0) return;
          state.view.fit(box.width, box.height, Number(state.desc.params.aspect) || 1);
        };
        if (typeof ResizeObserver !== "undefined") {
          state.observer = new ResizeObserver(() => state.fit());
          state.observer.observe(frame);
        }

        loadLibs()
          .then((libs) => {
            if (!host.__view) return;
            state.view = new SceneView(libs, canvas, {
              live: true,
              onEdit: (patch) => {
                const p = state.desc.params;
                if (p?.onEdit) p.onEdit(patch);
                state.report();
              },
              onLoaded: (error) => {
                note.hidden = !error && Boolean(state.view && state.view.vrm);
                note.textContent = error
                  ? t("pose2img.value.loadFailed", { error: error.message || error })
                  : t("pose2img.value.noModel");
                state.report();
              },
            });
            if (state.desc.params.sceneId) LIVE.set(state.desc.params.sceneId, state.view);
          })
          .catch((error) => {
            note.textContent = t("pose2img.value.loadFailed", { error: error.message || error });
          });
      },

      update(host, desc) {
        const state = host.__view;
        if (!state) return;
        state.desc = desc;
        const p = desc.params || {};
        if (host.style?.setProperty) {
          host.style.setProperty("--pose2img-aspect", String(Number(p.aspect) || 1));
        }
        if (host.querySelectorAll) {
          for (const button of host.querySelectorAll(".pose2img-modes > button")) {
            const on = button.dataset.mode === (p.mode || "translate");
            button.classList.toggle("is-active", on);
            button.setAttribute("aria-pressed", String(on));
          }
        }
        if (!state.view || !p.scene) return;
        state.view.setMode(p.mode || "translate");
        state.fit?.();
        const key = JSON.stringify(p.scene);
        if (key !== state.key) {
          state.key = key;
          state.view.apply(p.scene).catch(() => {});
          state.report?.();
        }
        if (p.aspect !== state.aspect) {
          state.aspect = p.aspect;
          state.report?.();
        }
      },

      unmount(host) {
        const state = host.__view;
        if (!state) return;
        clearTimeout(state.timer);
        state.observer?.disconnect();
        if (state.view) {
          const id = state.desc?.params?.sceneId;
          if (id && LIVE.get(id) === state.view) LIVE.delete(id);
          state.view.dispose();
        }
        delete host.__view;
      },
    };
  },

  "pose2img.scenecard": (api) => {
    const { core } = api;
    const icon = (name) => {
      const node = document.createElement("i");
      node.className = `bi bi-${core?.ICONS?.[name] || name}`;
      return node;
    };

    function update(el, desc) {
      const p = desc.params || {};
      const [head, body] = el.children || [];
      if (!head || !body) return;
      const { edit, summary, parts } = el.__head || {};
      if (parts) api.card.syncHead(el, parts, { name: desc.head || "" });
      el.__onEdit = p.onEdit;
      if (edit) {
        edit.title = p.editTitle || "";
        edit.disabled = !p.onEdit;
      }
      if (summary) {
        summary.textContent = p.summary || "";
        summary.title = p.summary || "";
      }
      const img = body.querySelector("img");
      if (!p.picture) {
        body.classList.add("is-empty");
        body.textContent = p.empty || "";
        return;
      }
      body.classList.remove("is-empty");
      if (img) {
        if (img.src !== p.picture) img.src = p.picture;
      } else {
        body.textContent = "";
        body.append(Object.assign(document.createElement("img"), { src: p.picture, alt: "" }));
      }
    }

    return {
      render(desc) {
        if (typeof document === "undefined" || !document.createElement) {
          return { __desc: desc };
        }
        const el = document.createElement("div");
        el.className = "mu-card workflow-card pose2img-card";
        const edit = document.createElement("button");
        edit.type = "button";
        edit.className = "mu-icon-button workflow-card-edit is-primary";
        edit.append(icon("pencil-square"));
        edit.addEventListener("click", (event) => {
          event.stopPropagation();
          if (el.__onEdit) el.__onEdit();
        });
        const summary = Object.assign(document.createElement("span"), { className: "pose2img-card-summary" });
        const parts = api.card.buildHead("workflow-card", { grip: false, lead: [edit, summary] });
        el.__head = { edit, summary, parts };
        const head = parts.head;
        const body = Object.assign(document.createElement("div"), { className: "workflow-card-body pose2img-card-body" });
        el.append(head, body);
        update(el, desc);
        return el;
      },
      update,
    };
  },
};
