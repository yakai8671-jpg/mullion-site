const newId = () => `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

const coerceSample = (value) => {
  const from = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    id: typeof from.id === "string" && from.id ? from.id : "",
    src: typeof from.src === "string" ? from.src : "",
    caption: typeof from.caption === "string" ? from.caption : "",
  };
};

const coerceDataset = (value) => {
  const seen = new Set();
  return (Array.isArray(value) ? value : [])
    .map(coerceSample)
    .filter((one) => one.id && one.src && !seen.has(one.id) && seen.add(one.id));
};

const readFile = (file) =>
  new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => resolve("");
    reader.readAsDataURL(file);
  });

export const types = {
  "loratrain.sample": {
    defaultValue: () => ({ id: "", src: "", caption: "" }),
    coerce: (value) => coerceSample(value),
    coerceList: coerceDataset,
    portRead: (value) => value.src,
  },
};

export const controls = {
  "loratrain.dataset": (api) => {
    const { core, card } = api;
    const t = core?.t || ((k) => k);

    const el = (tag, className, props = {}) => {
      const node = Object.assign(document.createElement(tag), props);
      if (className) node.className = className;
      return node;
    };
    const icon = (name) => {
      const node = document.createElement("i");
      node.className = `bi bi-${name}`;
      return node;
    };

    function update(wrap, desc) {
      wrap.__desc = desc;
      const { add, all, grid, tiles } = wrap.__parts;
      const items = coerceDataset(desc.property ? desc.property.items() : desc.params?.value || []);
      const readonly = Boolean(desc.readonly);
      const busy = desc.params?.busyIds || new Set();
      const port = card ? card.portOf(desc) : null;
      if (card?.syncHead) {
        card.syncHead(wrap, wrap.__parts, { port, caption: items.length ? t("loratrain.value.count", { n: items.length }) : "" });
      }

      if (add) {
        add.hidden = readonly;
        if (add.lastElementChild) add.lastElementChild.textContent = t("loratrain.action.add");
        add.title = t("loratrain.action.addTitle");
      }
      if (all) {
        all.hidden = readonly || !desc.params?.onCaption || !items.length;
        if (all.lastElementChild) all.lastElementChild.textContent = t("loratrain.action.captionAll");
        all.title = t("loratrain.action.captionAll");
        all.disabled = items.every((one) => one.caption.trim() || busy.has(one.id));
      }

      const write = (id, caption) => {
        const current = desc.property ? desc.property.items() : desc.params?.value || [];
        wrap.__commit(coerceDataset(current).map((one) => (one.id === id ? { ...one, caption } : one)));
      };

      const keep = new Set();
      const nodes = items.map((one) => {
        keep.add(one.id);
        let tile = tiles.get(one.id);
        if (!tile) {
          const box = el("div", "loratrain-sample");
          const picture = el("div", "loratrain-sample-picture");
          const img = el("img", "loratrain-sample-img");
          const tools = el("div", "loratrain-sample-tools");
          const ask = el("button", "mu-icon-button", { type: "button" });
          ask.append(icon("magic"));
          const remove = el("button", "mu-icon-button", { type: "button" });
          remove.append(icon("x"));
          tools.append(ask, remove);
          picture.append(img, tools);
          const text = el("textarea", "input loratrain-sample-caption", { rows: 3, spellcheck: false });
          box.append(picture, text);
          tile = { box, img, ask, remove, text };
          tiles.set(one.id, tile);

          text.addEventListener("click", (event) => event.stopPropagation());
          text.addEventListener("input", () => write(one.id, text.value));
          ask.addEventListener("click", (event) => {
            event.stopPropagation();
            if (wrap.__desc.params?.onCaption) wrap.__desc.params.onCaption([one.id]);
          });
          remove.addEventListener("click", (event) => {
            event.stopPropagation();
            const current = wrap.__desc.property ? wrap.__desc.property.items() : wrap.__desc.params?.value || [];
            wrap.__commit(coerceDataset(current).filter((other) => other.id !== one.id));
          });
        }
        if (tile.img.getAttribute("src") !== one.src) tile.img.setAttribute("src", one.src);
        if (document.activeElement !== tile.text && tile.text.value !== one.caption) tile.text.value = one.caption;
        const asking = busy.has(one.id);
        tile.box.classList.toggle("is-busy", asking);
        tile.text.readOnly = readonly || asking;
        tile.text.placeholder = t("loratrain.field.caption");
        tile.ask.hidden = readonly || !desc.params?.onCaption;
        tile.ask.disabled = asking;
        tile.ask.title = t("loratrain.action.captionOne");
        tile.remove.hidden = readonly;
        tile.remove.title = t("loratrain.action.remove");
        return tile.box;
      });

      for (const id of [...tiles.keys()]) if (!keep.has(id)) tiles.delete(id);
      const settled = grid.childNodes.length === nodes.length && nodes.every((node, i) => grid.childNodes[i] === node);
      if (!settled) grid.replaceChildren(...nodes);
      if (core?.fitCardHead && wrap.__parts?.head) core.fitCardHead(wrap.__parts.head);
    }

    return {
      render(desc, commit) {
        if (typeof document === "undefined" || !document.createElement) {
          return { __desc: desc, __commit: commit };
        }
        const wrap = el("div", "mu-card loratrain-dataset");
        wrap.__commit = commit;
        const add = el("button", "mu-icon-button is-primary", { type: "button" });
        add.append(icon("upload"), el("span", "mu-button-label"));
        const all = el("button", "mu-icon-button", { type: "button" });
        all.append(icon("magic"), el("span", "mu-button-label"));
        const parts = card?.buildHead ? card.buildHead("loratrain-dataset", { lead: [add], tools: [all] }) : { head: el("div", "head") };
        const grid = el("div", "loratrain-dataset-grid");
        const file = el("input", "", { type: "file", accept: "image/*", multiple: true, hidden: true });
        wrap.append(parts.head, grid, file);

        const take = async (files) => {
          const added = [];
          for (const chosen of Array.from(files || [])) {
            if (!chosen || !/^image\//.test(chosen.type)) continue;
            const dataUrl = await readFile(chosen);
            if (!dataUrl) continue;
            const itemApi = wrap.__desc.api;
            const src = itemApi && itemApi.store && itemApi.store.keepFile ? await itemApi.store.keepFile(dataUrl).catch(() => dataUrl) : dataUrl;
            added.push({ id: newId(), src, caption: "" });
          }
          if (added.length) {
            const current = wrap.__desc.property ? wrap.__desc.property.items() : wrap.__desc.params?.value || [];
            wrap.__commit([...current, ...added]);
          }
        };

        add.addEventListener("click", (event) => {
          event.stopPropagation();
          file.click();
        });
        file.addEventListener("change", () => {
          take(file.files);
          file.value = "";
        });
        all.addEventListener("click", (event) => {
          event.stopPropagation();
          if (wrap.__desc.params?.onCaption) wrap.__desc.params.onCaption(null);
        });
        wrap.addEventListener("dragover", (event) => {
          if (event.dataTransfer && [...event.dataTransfer.types].includes("Files")) event.preventDefault();
        });
        wrap.addEventListener("drop", (event) => {
          const files = event.dataTransfer && event.dataTransfer.files;
          if (!files || !files.length) return;
          event.preventDefault();
          take(files);
        });

        wrap.__parts = { ...parts, add, all, grid, tiles: new Map() };
        update(wrap, desc);
        return wrap;
      },
      update,
    };
  },
};
