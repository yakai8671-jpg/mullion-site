/* Scratch Board declarative scripts */

let seq = 0;
export const newId = () => `s${Date.now().toString(36)}${(seq++).toString(36)}`;
export const copy = (value) => (value === undefined ? null : JSON.parse(JSON.stringify(value)));

export const coerceEntries = (value) => {
  const seen = new Set();
  return (Array.isArray(value) ? value : [])
    .filter((one) => one && typeof one === "object" && typeof one.kind === "string" && one.kind)
    .map((one, index) => {
      let id = typeof one.id === "string" && one.id ? one.id : `s${index}`;
      while (seen.has(id)) id = newId();
      seen.add(id);
      return { id, kind: one.kind, value: one.value === undefined ? null : one.value };
    });
};

const BLANK = { id: "", kind: "text", value: null };

export const shownAs = (kind, valueTypes = {}) => {
  const types = Object.entries(valueTypes);
  const found = types.find(([, def]) => def.stash === kind) || types.find(([, def]) => def.port === kind);
  if (!found) return null;
  return { type: found[0], control: "scratch.card" };
};

export const kindsShown = (valueTypes = {}) => [
  ...new Set(
    Object.values(valueTypes)
      .flatMap((def) => [def.stash, def.port])
      .filter((one) => typeof one === "string")
  ),
];

const el = (tag, className, props = {}) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return Object.assign(node, props);
};
const isVideo = (src) => /^data:video\//i.test(src || "") || /\.(webm|mp4|m4v|mov)($|[?&#])/i.test(src || "");

export const types = {
  "scratch.entry": {
    portKindOf: (entry) => (entry && entry.kind) || null,
    portRead: (entry) => entry?.value,
    defaultValue: () => ({ ...BLANK }),
    coerce: (value) => coerceEntries([value])[0] || { ...BLANK },
    coerceList: coerceEntries,
    format: (value) => (value && value.kind) || "\u2014",
  },
};

// A picture that came as an address on the ComfyUI server is not one the
// board can keep: fetched and kept as a file of the library's.
const isTransient = (value) => typeof value === "string" && /^\/api\/comfy\/view\?/.test(value);
const asDataUrl = async (src) => {
  const blob = await (await fetch(src)).blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
};

const withoutEntry = (entries, id) => coerceEntries(entries).filter((one) => one.id !== id);

export const actions = {
  "scratch.put": {
    async run({ entries, value, kind }) {
      return { entries: [...coerceEntries(entries), { id: newId(), kind, value: copy(value) }] };
    },
  },
  "scratch.remove": {
    async run({ entries, id }) {
      return { entries: withoutEntry(entries, id) };
    },
  },
  // Kept as a preset of the type the board shows it as, under a name asked for.
  "scratch.keep": {
    async run({ entries, id, type }, { api, prompt, status }) {
      const name = String((await prompt("mu.prompt.presetName", {}, { title: "mu.action.keepAsPreset" })) || "").trim();
      if (!name) return {};
      const one = coerceEntries(entries).find((other) => other.id === id);
      if (!one) return {};
      try {
        await api.store.save({ type, name, value: copy(one.value) });
        status("mu.status.kept", { name });
      } catch (error) {
        status("scratch.status.failed", { error: error.message || error });
      }
      return {};
    },
  },
  // Pictures and videos that came as addresses on the ComfyUI server, one after another; what is
  // on the board is read again before each is put back, so nothing put down meanwhile is lost.
  "scratch.settle": {
    async run({ entries }, { api, read, write, status }) {
      const failed = new Set();
      let latest = coerceEntries(entries);
      for (;;) {
        const next = latest.find((one) => (one.kind === "image" || one.kind === "video") && isTransient(one.value) && !failed.has(one.value));
        if (!next) return { entries: latest };
        const from = next.value;
        try {
          const kept = await api.store.keepFile(await asDataUrl(from));
          latest = coerceEntries(read("entries")).map((one) => (one.value === from ? { ...one, value: kept } : one));
          write({ entries: latest });
        } catch (error) {
          failed.add(from);
          status("scratch.status.failed", { error: error.message || error });
          latest = coerceEntries(read("entries"));
        }
      }
    },
  },
};

export const controls = {
  "scratch.card": (api) => {
    const fw = api || {};
    const core = fw.core || {};
    const icon = (name) => el("i", `bi bi-${core.ICONS?.[name] || name}`);
    const t = fw.t || core.t || ((k) => k);

    // A thing put down on a board is the whole entry ({ id, kind, value }); the shell's preset maker
    // gives the card a bare value and says its kind.
    const asked = new Set();
    function updateCard(card, desc) {
      card.__desc = desc;
      const p = desc.params || {};
      const [head, nameRow, body] = card.children;
      const { keep } = card.__parts || {};
      const entry = desc.type === "scratch.entry" && desc.value && typeof desc.value === "object" ? desc.value : null;
      const kind = entry ? entry.kind : p.kind;
      const value = entry ? entry.value : desc.value;
      const shown = entry ? shownAs(kind, fw.valueTypes) : { type: desc.type };
      const empty = p.empty || (entry && !shown ? t("scratch.value.unknown", { kind }) : "");
      const onDiscard = p.discard ? () => p.discard({ id: entry?.id }) : p.onDiscard;
      const onKeep = p.keep && entry && shown ? () => p.keep({ id: entry.id, type: shown.type }) : p.onKeep;
      card.__onKeep = onKeep;
      card.__onDiscard = onDiscard;
      card.classList.toggle("is-bare", Boolean(p.bare));
      if (head) head.hidden = Boolean(p.bare);
      if (p.sink) {
        core.attachSink?.(card, p.sink);
      } else {
        card.classList.remove("mu-port-sink");
        card.__sink = null;
      }
      const def = (shown && fw.valueTypes && fw.valueTypes[shown.type]) || {};
      const caption = !kind && empty ? desc.label : def.label ? t(def.label) : kind || "";
      if (nameRow) {
        nameRow.hidden = !p.onName || Boolean(p.bare);
        const nameField = nameRow.firstElementChild;
        if (nameField) {
          nameField.placeholder = caption;
          if (document.activeElement !== nameField && nameField.value !== String(p.name || "")) nameField.value = String(p.name || "");
        }
      }
      if (keep) {
        keep.hidden = !onKeep;
        keep.title = t("mu.action.keepAsPreset");
      }
      const key = p.port ? core.portKey?.(p.port, "scratch") : `scratch:${desc.key}`;
      card.__key = key;
      const shrunk = !p.bare && core.cardIsShrunk?.(key);
      core.setCardSizeClass?.(card, shrunk);
      fw.card?.syncHead?.(card, card.__parts, {
        port: p.port && typeof p.port === "object" ? p.port : null,
        name: caption,
        onDiscard,
        size: {
          full: !shrunk,
          title: t(shrunk ? "mu.action.growCard" : "mu.action.shrinkCard"),
          toggle: () => {
            core.setCardShrunk?.(key, !shrunk);
            updateCard(card, card.__desc);
          },
        },
      });
      if (head) core.fitCardHead?.(head);

      if (!kind && empty) {
        body.__shown = undefined;
        body.replaceChildren(el("div", "scratch-card-said is-empty", { textContent: empty }));
        return;
      }
      if (entry && !shown) {
        body.__shown = undefined;
        body.replaceChildren(el("div", "scratch-card-said is-empty", { textContent: empty }));
        return;
      }
      if (kind === "text") {
        let area = body.querySelector(":scope > textarea");
        if (!area) {
          area = el("textarea", "input scratch-card-text", { spellcheck: false, rows: 3 });
          area.addEventListener("input", () => {
            const current = card.__desc?.type === "scratch.entry" ? card.__desc.value : null;
            if (card.__onChange) card.__onChange(current ? { ...current, value: area.value } : area.value);
          });
          body.replaceChildren(area);
        }
        area.readOnly = Boolean(desc.readonly);
        if (document.activeElement !== area && area.value !== String(value ?? "")) area.value = String(value ?? "");
        return;
      }
      const media = kind === "image" || kind === "video";
      // What the type says of the value: its picture and how it reads.
      const reading = !media && fw.describe ? fw.describe({ type: shown.type, read: () => value, readonly: true }, { api: desc.api, key: `${desc.key}:reading` }).property : null;
      const picture = media ? value : reading && reading.src ? reading.src() : "";
      const said = media ? "" : core.portConvert?.(value, kind, "text") ?? (reading && reading.format ? reading.format() : "");
      if (media && p.settle && isTransient(value) && !asked.has(value)) {
        asked.add(value);
        p.settle();
      }
      const shownKey = JSON.stringify([picture, said]);
      if (body.__shown === shownKey) return;
      body.__shown = shownKey;
      const parts = [];
      if (picture) {
        const mediaEl = isVideo(picture)
          ? el("video", "", { src: picture, muted: true, loop: true, autoplay: true, playsInline: true })
          : el("img", "", { src: picture, alt: "", draggable: false });
        const frame = el("div", "scratch-card-picture");
        frame.append(mediaEl);
        parts.push(frame);
      }
      if (said) parts.push(el("div", "scratch-card-said", { textContent: String(said) }));
      if (!parts.length) parts.push(el("div", "scratch-card-said is-empty", { textContent: t("scratch.value.nothingIn") }));
      body.replaceChildren(...parts);
    }

    return {
      render(desc, onChange) {
        const card = el("div", "mu-card scratch-card");
        const button = (className, name) => {
          const one = el("button", `mu-icon-button ${className}`, { type: "button" });
          one.append(icon(name));
          return one;
        };
        const keep = button("mu-card-keep", "preset");
        keep.append(el("i", `bi bi-${core.ICONS?.presetSave || "plus"} mu-icon-badge`));
        keep.addEventListener("click", (event) => {
          event.stopPropagation();
          if (card.__onKeep) card.__onKeep();
        });
        const parts = fw.card?.buildHead?.("scratch-card", {
          tools: [keep],
          onDiscard: () => card.__onDiscard && card.__onDiscard(),
        }) || { head: el("div", "mu-card-head") };
        const head = parts.head;
        card.__parts = { ...parts, keep };
        const nameRow = el("div", "scratch-card-name");
        const name = el("input", "input mu-prop-input", { type: "text", spellcheck: false });
        nameRow.append(name);
        name.addEventListener("change", () => {
          if (card.__desc?.params?.onName) card.__desc.params.onName(name.value.trim());
        });
        name.addEventListener("keydown", (event) => {
          if (event.key === "Enter") name.blur();
        });
        const body = el("div", "scratch-card-body");
        card.append(head, nameRow, body);
        card.__onChange = onChange;
        updateCard(card, desc);
        return card;
      },
      update: updateCard,
    };
  },

  "scratch.zone": (api) => {
    const core = api?.core || {};
    const t = api?.t || core.t || ((k) => k);
    return {
      render(desc) {
        const zone = el("div", "scratch-zone");
        zone.append(
          Object.assign(document.createElement("i"), { className: "bi bi-box-arrow-in-down" }),
          Object.assign(document.createElement("span"), { className: "scratch-zone-label" })
        );
        this.update(zone, desc);
        return zone;
      },
      update(zone, desc) {
        const empty = !(desc?.params?.entries || []).length;
        zone.classList.toggle("is-empty", empty);
        zone.lastElementChild.textContent = t(empty ? "scratch.value.empty" : "scratch.value.dropMore");
        zone.__put = desc?.params?.put;
        queueMicrotask(() => {
          const win = zone.closest?.(".mu-window");
          if (!win) return;
          win.classList.add("scratch-board-window");
          core.attachSink?.(win, {
            accepts: kindsShown(api?.valueTypes),
            put: (value, kind) => zone.__put && zone.__put({ value, kind }),
          });
        });
      },
    };
  },
};
