/* Mullion -- the built-in controls.
 *
 * A control is the UI half of a property: it draws something and writes
 * back through the property's methods. It declares the methods it needs
 * (`needs`) and any parameters it cannot work without (`requiresParams`),
 * and validateRegistry() refuses a pairing that does not fit.
 *
 * These live in the shell rather than in plugins on purpose. A plugin that
 * reuses them gets the house style for free; one that writes its own DOM is
 * the only way a layout starts looking like two different applications.
 *
 * Each control gets a descriptor: {key, label, params, value, property}
 * where `property` is the bound accessor from the registry.
 */

import { CONTROLS, ICONS, ITEM_TYPES, VALUE_TYPES, describeProperty, formatValue, registerControl, ResizeObserver, document, getComputedStyle, window, fetch, languages } from "./deps.js";
import { TEXT_LANGUAGES, blobToDataUrl, describeImage, formatAxis, formatBytes, imageFacts, optionsOf, pickLanguage } from "./deps.js";
import { locate } from "./deps.js";
import { TEXTCARD_DEFAULTS, TEXTCARD_FEATURES, ZOOM_MAX, ZOOM_MIN, buildFeatures, updateFeatures } from "./textfeatures.js";
import { animateCardResize, appSettingValue, attachPort, portKey, attachSink, cardIsShrunk, fitCardHead, buildCardHead, foldIcon, hasCardSize, explainer, closeHint, hintButton, listCard, openIconPicker, openPopup, openValuePicker, paintCardTools, paintStatusRow, portInfo, portIsEntry, portLink, portShare, refreshAll, setCardShrunk, setCardSizeClass, t, unlinkPort, makePortBadge, syncPortBadge } from "./deps.js";

// Shown large or small: what the card was told (a property's), else the
// saved card choice, else the instance's or control's default.
function fullOf(p, key, controlDefault) {
  if (typeof p.full === "boolean") return p.full;
  if (hasCardSize(key)) return !cardIsShrunk(key);
  if (typeof p.defaultFull === "boolean") return p.defaultFull;
  return controlDefault !== false;
}

// Where a card's grip takes it from: the port the host handed it, else its
// own property. Only an address counts as handed -- a property spec's
// `port: "text"` is the kind it carries, not where it is, and was taken for
// one.
export function cardPortOf(desc) {
  const given = desc.params.port;
  if (given && typeof given === "object") return given;
  const item = desc.property && desc.property.item;
  return item ? { item: item.id, key: desc.property.key } : null;
}

// A card's action bar is always installed immediately after its shared header
// (or first for a card whose bar is its header). Callers only fill it.
export function cardBar(card) {
  if (!card || !card.classList.contains("mu-card")) throw new Error("an action bar needs a card");
  const existing = card.querySelector(":scope > .mu-action-bar");
  if (existing) return existing;
  const bar = document.createElement("div");
  bar.className = "mu-action-bar";
  const header = card.querySelector(":scope > .mu-card-bar");
  if (header) header.after(bar);
  else card.prepend(bar);
  return bar;
}

// The bar's rows, one above the other, as the item's own bar has them: `key`
// names a row (made when first asked for, in the order asked), `thirds` lays
// it out as start / middle / end (`mu-action-bar-start`, `-middle`, `-end`,
// which the caller fills). The first row stacks the bar.
export function cardBarRow(card, key, { thirds = false } = {}) {
  const bar = cardBar(card);
  bar.classList.add("is-stack");
  const found = [...bar.children].find((one) => one.dataset.row === key);
  if (found) return found;
  const row = document.createElement("div");
  row.className = `mu-action-bar-row${thirds ? " is-thirds" : ""}`;
  row.dataset.row = key;
  bar.append(row);
  return row;
}

function paintTextCardSlots(el, desc, full) {
  if (!desc.renderNodes) return;
  const { body = [], bars = [], lead = [], tools = [] } = desc.params.slotNodes || {};
  if (!el.__declaredSlots && !body.length && !bars.some((row) => row.length) && !lead.length && !tools.length) return;
  const hosts = el.__declaredSlots ||= new Map();
  const slots = BUILT_IN.texteditor.slots(el);
  const groups = new Map([["lead", lead], ["tools", []]]);
  for (const anchor of BUILT_IN.texteditor.declarationToolAnchors) groups.set(`tools:${anchor}`, []);
  for (const button of tools) (groups.get(`tools:${button.after}`) || groups.get("tools")).push(button);
  for (const [name, buttons] of groups) {
    let holder = hosts.get(name);
    if (!buttons.length) {
      holder?.remove();
      hosts.delete(name);
      continue;
    }
    if (!holder) {
      const primary = name === "lead";
      holder = Object.assign(document.createElement("span"), { className: primary ? "mu-nodecard-lead" : "mu-nodecard-tools" });
      if (primary) slots.lead(holder);
      else slots.tools(holder, name.split(":")[1]);
      hosts.set(name, holder);
    }
    paintCardTools(holder, buttons, name === "lead");
  }
  slots.fit();
  const layouts = new Map([["body", body], ...bars.map((nodes, index) => [`bar-${index}`, nodes])]);
  for (const [name, host] of hosts) {
    if (groups.has(name) || layouts.get(name)?.length) continue;
    desc.renderNodes(host, [], name);
    const parent = host.parentElement;
    host.remove();
    if (name !== "body" && parent && !parent.childNodes.length) parent.remove();
    hosts.delete(name);
  }
  for (const [name, nodes] of layouts) {
    if (!nodes.length) continue;
    let host = hosts.get(name);
    if (!host) {
      if (name === "body") {
        host = document.createElement("div");
        host.className = "mu-textcard-slot-body";
        slots.body(host);
      } else {
        host = cardBarRow(el, `declared:${name}`);
      }
      host.classList.add("mu-textcard-declared-slot");
      hosts.set(name, host);
    }
    desc.renderNodes(host, nodes, name);
    host.hidden = !full;
  }
}

function paintTextCardViews(el, desc, selected, full) {
  const views = desc.params.viewNodes || [];
  let ui = el.__declaredViews;
  if (!views.length || !desc.renderNodes) {
    if (!ui || !desc.renderNodes) return;
    desc.renderNodes(ui.body, [], ["view", ui.key]);
    ui.body.remove();
    const bar = ui.row.parentElement;
    ui.row.remove();
    if (bar && !bar.childNodes.length) bar.remove();
    delete el.__declaredViews;
    return;
  }
  const selector = {
    params: { labels: "all" },
    value: selected.key,
    property: { options: () => views.map(({ key, label, icon }) => ({ value: key, label, icon })) },
  };
  if (!ui) {
    const row = cardBarRow(el, "declared:views");
    const segments = BUILT_IN.segments.render(selector, (key) => {
      if (ui.desc.params.viewNodes.some((view) => view.key === key)) ui.desc.set("view", key);
    });
    segments.setAttribute("role", "group");
    const body = Object.assign(document.createElement("div"), { className: "mu-textcard-view-body" });
    BUILT_IN.texteditor.slots(el).body(body);
    row.append(segments);
    ui = el.__declaredViews = { row, segments, body };
  } else BUILT_IN.segments.update(ui.segments, selector);
  ui.desc = desc;
  ui.segments.setAttribute("aria-label", t("mu.control.textcardViews"));
  ui.row.hidden = !full || views.length < 2;
  if (ui.key !== selected.key && ui.key !== undefined) desc.renderNodes(ui.body, [], ["view", ui.key]);
  ui.key = selected.key;
  desc.renderNodes(ui.body, selected.layout || [], ["view", selected.key]);
  ui.body.hidden = !full || !selected.layout;
}

// The header every card has: buildCardHead, kept in core (NODES.card is built
// with it too) and handed on from here to the controls and the plugins.
export { buildCardHead };

// A card with its header down its left side -- the grip at the top of a
// narrow strip, the card's own things beside it, centred -- for a plugin's
// DOM: the same look as a `NODES.card` with `side`, which only the shell's
// node renderer can make. Returns {card, head, grip, body}; the caller fills
// `body` and says what the grip carries with `attachPort(card, grip, port)`
// (none: the grip is there and says so when held). `prefix` names the card's
// own classes.
export function buildSideCard(prefix = "mu-sidecard") {
  const make = (tag, className) => Object.assign(document.createElement(tag), { className });
  const card = make("div", `mu-card mu-sidecard ${prefix}`);
  const head = make("div", "mu-sidecard-head mu-card-bar");
  const grip = make("button", "mu-icon-button mu-port-grip");
  grip.type = "button";
  grip.append(make("i", "bi bi-grip-vertical"));
  grip.title = t("mu.port.grip");
  head.append(grip);
  const body = make("div", "mu-sidecard-body");
  card.append(head, body);
  attachPort(card, grip, null);
  return { card, head, grip, body };
}

// What the header says now: the grip's port, its name, what the card
// follows, whether it can be removed here, and shrink -- `size` is
// {full, title, toggle}. Resolves to what it follows (or null).
export function syncCardHead(host, parts, { port = null, name = "", onDiscard = null, size = null } = {}) {
  const { grip, label, link, discard, size: sizeButton } = parts;
  discard.hidden = !onDiscard;
  // The close button means the card itself goes, and only an element of a list has one. A card that
  // holds a property's value (not an entry) lets it go with a primary "delete" button instead.
  const releasing = Boolean(onDiscard) && Boolean(port && port.item) && !portIsEntry(port);
  discard.classList.toggle("is-primary", releasing);
  let word = discard.querySelector(":scope > .mu-button-label");
  if (releasing) {
    if (!word) discard.append((word = Object.assign(document.createElement("span"), { className: "mu-button-label" })));
    word.textContent = t("mu.action.delete");
    discard.firstElementChild.className = "bi bi-trash";
  } else {
    if (word) word.remove();
    discard.firstElementChild.className = `bi bi-${ICONS.close || "close"}`;
  }
  discard.title = releasing ? t("mu.action.delete") : t("mu.action.discard");
  if (grip) {
    attachPort(host, grip, port);
    grip.title = t("mu.port.grip");
  }
  // The card's own name, which only an entry of a list has (the control is given it as `desc.head`
  // by the shell): a property's label stands outside the card, as a row's does.
  label.textContent = name || "";
  label.hidden = !name;
  const following = port ? portLink(port) || portShare(port) : null;
  syncPortBadge(link, following, following ? () => unlinkPort(port) : null);
  host.classList.toggle("is-linked", Boolean(following));
  // A card that cannot be shrunk says so by passing no `size`.
  sizeButton.hidden = !size;
  if (size) {
    const icon = foldIcon(!size.full);
    if (sizeButton.firstElementChild.className !== icon) sizeButton.firstElementChild.className = icon;
    sizeButton.title = size.title;
    // `toggle` is pressed while the card is `full`: shrinking is what it
    // does then (setCardShrunk(key, full)), growing when it is shrunk.
    sizeButton.onclick = (event) => {
      event.stopPropagation();
      size.toggle();
    };
  }
  return following;
}

// What a media card is told about its kind: what it takes in, how big, the
// player it shows, the words it says and the port kind it carries.
const MEDIA = {
  audio: {
    kind: "audio",
    label: "mu.control.audiocard",
    accept: "audio/*,.wav,.mp3,.m4a,.flac,.ogg",
    maxBytes: 60 * 1024 * 1024,
    types: { wav: "audio/wav", mp3: "audio/mpeg", ogg: "audio/ogg", flac: "audio/flac", m4a: "audio/mp4", aac: "audio/mp4", webm: "audio/webm" },
    player: () => Object.assign(document.createElement("audio"), { controls: true, preload: "metadata" }),
    saveAs: { name: "voice", ext: /\.(mp3|ogg|flac|m4a|weba|wav)(\?|$)/i, fallback: ".wav" },
    words: {
      notIt: "mu.value.notAudio",
      drop: "mu.value.dropAudioHere",
      reading: "mu.value.readingAudio",
      pick: "mu.action.pickAudio",
      clear: "mu.action.clearAudio",
      save: "mu.action.saveAudio",
      type: "mu.vtype.audio",
    },
  },
  video: {
    kind: "video",
    label: "mu.control.videocard",
    accept: "video/*,.mkv,.mov",
    maxBytes: 400 * 1024 * 1024,
    types: { mp4: "video/mp4", m4v: "video/mp4", webm: "video/webm", mov: "video/quicktime", mkv: "video/x-matroska" },
    // Muted and looping: it is shown to be recognised, not watched.
    player: () => Object.assign(document.createElement("video"), { controls: true, muted: true, loop: true, playsInline: true, preload: "metadata" }),
    saveAs: { name: "video", ext: /\.(mp4|m4v|webm|mov|mkv)(\?|$)/i, fallback: ".mp4" },
    words: {
      notIt: "mu.value.notVideo",
      drop: "mu.value.dropVideoHere",
      reading: "mu.value.readingVideo",
      pick: "mu.action.pickVideo",
      clear: "mu.action.clearVideo",
      save: "mu.action.saveVideo",
      type: "mu.vtype.video",
    },
  },
};

// The media type of a file the browser may not name (a .mkv, a .m4a), by
// kind and extension; "" when it is not of that kind.
function mediaTypeOf(media, file) {
  if (file.type && file.type.startsWith(`${media.kind}/`)) return file.type;
  return media.types[String(file.name || "").split(".").pop().toLowerCase()] || "";
}

function mediaCard(name, media) {
  const self = () => BUILT_IN[name];
  return {
    label: media.label,
    standalone: true,
    params: {
      src: { type: "string", bind: "read" },
      port: { type: "data" },
      empty: { type: "label" },
      busy: { type: "boolean", bind: "read" },
      emptyAction: { type: "action" },
      onClear: { type: "action" },
      name: { type: "string", bind: "readwrite", state: true },
      onName: { type: "action" },
      onPresets: { type: "action" },
      presetsTitle: { type: "label" },
      filename: { type: "string", bind: "read" },
      full: { type: "boolean", bind: "readwrite", state: true },
      onFull: { type: "action" },
      onDiscard: { type: "action" },
      defaultFull: { type: "boolean" },
    },
    defaultFull: true,
    sampleParams: { src: "" },

    mount(host, desc, onChange) {
      host.classList.add("mu-card", "mu-imagecard", "mu-mediacard", `mu-${media.kind}card`);
      host.__onChange = onChange || null;
      const button = (className, iconName) => {
        const one = document.createElement("button");
        one.type = "button";
        one.className = `mu-icon-button ${className}`;
        one.append(Object.assign(document.createElement("i"), { className: `bi bi-${ICONS[iconName] || iconName}` }));
        return one;
      };
      const act = button("is-primary mu-imagecard-act", "play-fill");
      act.append(Object.assign(document.createElement("span"), { className: "mu-button-label" }));
      const save = button("mu-mediacard-save", "download");
      const presets = button("mu-imagecard-presets", "preset");
      const parts = buildCardHead("mu-imagecard", {
        lead: [act],
        tools: [save, presets],
        onDiscard: () => {
          const run = host.__desc && host.__desc.params.onDiscard;
          if (run) run();
        },
      });
      const head = parts.head;

      const stage = Object.assign(document.createElement("div"), { className: "mu-mediacard-stage" });
      const player = media.player();
      const note = Object.assign(document.createElement("span"), { className: "mu-mediacard-note" });
      stage.append(player, note);
      const facts = Object.assign(document.createElement("div"), { className: "mu-imagecard-facts" });
      const file = Object.assign(document.createElement("input"), { type: "file", accept: media.accept, hidden: true });
      host.append(head, stage, facts, file);
      host.__card = { ...parts, act, save, presets, stage, player, note, facts };

      // A file taken in: read here, kept as a file where the item may keep
      // one (its address is what it holds), refused with a note when it is
      // too big or not of this kind.
      const take = async (chosen) => {
        if (!chosen || !host.__input) return;
        const d = host.__desc;
        const type = mediaTypeOf(media, chosen);
        if (!type) {
          note.hidden = false;
          note.textContent = t(media.words.notIt, { name: chosen.name });
          return;
        }
        if (chosen.size > media.maxBytes) {
          note.hidden = false;
          note.textContent = t("mu.value.imageTooLarge", { size: formatBytes(chosen.size), max: formatBytes(media.maxBytes) });
          return;
        }
        host.__reading = true;
        note.hidden = false;
        note.textContent = t(media.words.reading);
        try {
          const dataUrl = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result));
            reader.onerror = () => reject(reader.error || new Error("read failed"));
            reader.readAsDataURL(type === chosen.type ? chosen : new Blob([chosen], { type }));
          });
          const keep = d.api && d.api.store && d.api.store.keepFile;
          const address = keep ? await d.api.store.keepFile(dataUrl).catch(() => dataUrl) : dataUrl;
          if (d.params.onName) d.params.onName(chosen.name || "");
          else if (d.set) d.set("name", chosen.name || "");
          host.__nameFor = address;
          host.__reading = false;
          self().write(host, address);
        } catch (error) {
          host.__reading = false;
          note.hidden = false;
          note.textContent = error.message || String(error);
        }
      };
      file.addEventListener("change", () => {
        const chosen = file.files && file.files[0];
        file.value = "";
        take(chosen);
      });
      const carriesFile = (event) => Boolean(event.dataTransfer && [...event.dataTransfer.types].includes("Files"));
      host.addEventListener("dragover", (event) => {
        if (!host.__input || !carriesFile(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
        host.classList.add("is-dragover");
      });
      host.addEventListener("dragleave", () => host.classList.remove("is-dragover"));
      host.addEventListener("drop", (event) => {
        if (!host.__input || !carriesFile(event)) return;
        event.preventDefault();
        host.classList.remove("is-dragover");
        take(event.dataTransfer.files[0]);
      });
      note.addEventListener("click", () => {
        if (host.__input && !host.__reading && !self().srcOf(host.__desc)) file.click();
      });
      host.__pick = () => file.click();
      act.addEventListener("click", (event) => {
        event.stopPropagation();
        if (host.__act) host.__act();
      });
      save.addEventListener("click", (event) => {
        event.stopPropagation();
        const src = self().srcOf(host.__desc);
        if (!src) return;
        const one = Object.assign(document.createElement("a"), {
          href: src,
          download: String(host.__desc.params.filename || media.saveAs.name) + (media.saveAs.ext.test(src) ? "" : media.saveAs.fallback),
        });
        one.click();
      });
      presets.addEventListener("click", (event) => {
        event.stopPropagation();
        const d = host.__desc;
        if (Object.prototype.hasOwnProperty.call(d.params, "onPresets")) {
          if (d.params.onPresets) d.params.onPresets(presets);
        } else openValuePicker(d, presets);
      });
      self().update(host, desc);
    },

    // The address held: given (an output), or the property's (an input).
    srcOf(desc) {
      if (typeof desc.params.src === "string") return desc.params.src;
      const src = desc.property && desc.property.src ? desc.property.src() : desc.value;
      return typeof src === "string" ? src : "";
    },

    // Whether it takes a file in: bound to a property that can set one, and
    // not handed what to show.
    isInput(desc) {
      const p = desc.params;
      if (typeof p.src === "string" || p.emptyAction || p.onClear) return false;
      return Boolean(desc.property && desc.property.setSrc) && !desc.readonly;
    },

    write(host, value) {
      if (host.__onChange) host.__onChange(value);
      else host.__desc.property.set(value);
    },

    update(host, desc) {
      const card = host.__card;
      if (!card) return;
      host.__desc = desc;
      const p = desc.params;
      const src = self().srcOf(desc);
      const input = self().isInput(desc);
      host.__input = input;
      host.classList.toggle("is-input", input);
      host.classList.toggle("is-busy", Boolean(p.busy));
      const { act, save, presets } = card;
      const port = cardPortOf(desc);

      // The one primary action: an input's upload, or remove once there is a
      // file; an output's run (cancel while running), or remove.
      let action = null;
      if (input) {
        action = src
          ? {
              icon: ICONS.close || "x",
              label: t("mu.action.delete"),
              title: t(media.words.clear),
              run: () => {
                // What is linked would be written back at the next redraw, so
                // taking it away stops the following first.
                if (port && portLink(port)) unlinkPort(port);
                if (p.onName) p.onName("");
                else if (desc.set) desc.set("name", "");
                self().write(host, "");
              },
            }
          : { icon: "upload", label: t("mu.action.uploadShort"), title: t(media.words.pick), run: () => host.__pick() };
      } else {
        const empty = p.emptyAction || null;
        action = src
          ? p.onClear && { icon: ICONS.close || "x", label: t("mu.action.delete"), title: t("mu.action.clearOutput"), run: p.onClear }
          : empty && { icon: p.busy ? "stop-fill" : "play-fill", label: empty.label, title: empty.title || empty.label, run: empty.run, disabled: empty.disabled };
      }
      act.hidden = !action;
      if (action) {
        act.firstElementChild.className = `bi bi-${action.icon}`;
        act.lastElementChild.textContent = action.label;
        act.title = action.title;
        act.disabled = Boolean(action.disabled);
      }
      host.__act = action ? action.run : null;

      save.hidden = !src;
      save.title = t(media.words.save);
      const handed = Object.prototype.hasOwnProperty.call(p, "onPresets");
      presets.hidden = !input || (handed && !p.onPresets);
      presets.title = p.presetsTitle || t("mu.action.presets", { type: t(media.words.type) });

      // The player, set only when the address changed: a redraw must not
      // restart what is playing.
      const { player, note, facts } = card;
      if ((player.getAttribute("src") || "") !== src) {
        if (src) player.setAttribute("src", src);
        else {
          player.pause();
          player.removeAttribute("src");
          player.load();
        }
      }
      player.hidden = !src;
      if (src) note.textContent = "";
      else if (!host.__reading) note.textContent = p.empty || (input ? t(media.words.drop) : "");
      note.hidden = !note.textContent;

      // The file's name only while it is that file: a recording pasted or
      // linked over it is not the one the name was given for.
      const said = input && src && (host.__nameFor === undefined || host.__nameFor === src) ? p.name || "" : "";
      if (facts.__said !== said) {
        facts.__said = said;
        facts.textContent = said;
      }
      facts.hidden = !said;

      host.__sizeKey = `${name}:${desc.key}`;
      const full = fullOf(p, host.__sizeKey, self().defaultFull);
      const hadSize = typeof host.__full === "boolean";
      host.__full = full;
      syncCardHead(host, card, {
        port,
        name: desc.head,
        onDiscard: p.onDiscard,
        size: {
          full,
          title: t(full ? "mu.action.shrinkCard" : "mu.action.growCard"),
          toggle: () => {
            if (p.onFull) return p.onFull(!full);
            setCardShrunk(host.__sizeKey, full);
            self().update(host, host.__desc);
          },
        },
      });
      const resize = () => host.classList.toggle("is-shrunk", !full);
      if (hadSize && host.classList.contains("is-shrunk") !== !full) animateCardResize(host, resize);
      else resize();
      fitCardHead(card.head);
    },

    unmount(host) {
      delete host.__card;
    },
  };
}

// Whether an output address is a video rather than a picture. Asked of the
// file's name (media.js reads it off the address) because a run's result is a
// reference to a file and nothing else says what kind.
export function isVideoSrc(src) {
  const found = locate(src);
  return Boolean(found) && found.media === "video";
}

// Never fight the person typing into a control.
function setValue(el, value) {
  if (!el || document.activeElement === el) return;
  if (el.value !== String(value)) el.value = value;
}

// The vector as it stands on screen, with one axis replaced. Read off the
// DOM rather than off a captured descriptor, for the same reason the
// stepper does: a click may come many refreshes after the render.
function vectorWith(wrap, index, value) {
  return Array.from(wrap.children).map((axis, i) =>
    i === index ? value : Number(axis.querySelector(".mu-stepper-input").value) || 0
  );
}

function setActiveAxis(wrap, index) {
  if (index === null) delete wrap.dataset.active;
  else wrap.dataset.active = String(index);
  wrap.classList.toggle("has-active", index !== null);
  Array.from(wrap.children).forEach((axis, i) => {
    const isActive = i === index;
    axis.classList.toggle("is-active", isActive);
    axis.lastElementChild.hidden = !isActive;
  });
  if (index !== null) wrap.children[index].querySelector(".mu-stepper-input").focus();
}

// ---- multilingual text ---------------------------------------------------------------
// The language a card shows is the reader's choice, kept by where the card is (its port, else its key)
// so it survives a redraw; until one is made it is the reader's own language, else the first there is.
const LANGUAGE_CHOSEN = new Map();
const languageKey = (desc) => {
  const port = cardPortOf(desc);
  return `multitext:${port ? portKey(port) : desc.key}`;
};
function chosenLanguage(desc) {
  const have = desc.property.languages();
  const kept = LANGUAGE_CHOSEN.get(languageKey(desc));
  if (kept && (have.includes(kept) || !desc.readonly)) return kept;
  const own = appSettingValue("language");
  return have.includes(own) ? own : have[0] || (TEXT_LANGUAGES.includes(own) ? own : TEXT_LANGUAGES[0]);
}
// The descriptor the text card is given: the same, with the text of the chosen language as its text.
function shownIn(desc) {
  const lang = chosenLanguage(desc);
  const property = Object.create(desc.property);
  property.text = () => desc.property.text(lang);
  property.setText = (text) => desc.property.setText(text, lang);
  return { ...desc, property, value: desc.property.text(lang) };
}
// The choice of language, in the card's bar: one segment for each language.
function paintLanguages(card, desc) {
  const bar = cardBar(card);
  let segments = bar.querySelector(":scope > .mu-multitext-languages");
  if (!segments) {
    segments = Object.assign(document.createElement("div"), { className: "mu-segments mu-multitext-languages" });
    bar.append(segments);
  }
  const have = desc.property.languages();
  const chosen = chosenLanguage(desc);
  const labels = Object.fromEntries(languages().map((one) => [one.value, one.label]));
  diffChildren(segments, TEXT_LANGUAGES.map((value) => ({ value })), (one) => one.value, {
    create: () => {
      const button = Object.assign(document.createElement("button"), { type: "button", className: "mu-segment" });
      button.append(Object.assign(document.createElement("span"), { className: "mu-segment-label" }));
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        LANGUAGE_CHOSEN.set(languageKey(card.__multi), button.dataset.nodeKey);
        BUILT_IN.multitext.update(card, card.__multi);
      });
      return button;
    },
    update: (button, one) => {
      const on = one.value === chosen;
      button.firstElementChild.textContent = labels[one.value] || one.value;
      button.classList.toggle("is-active", on);
      button.disabled = !on && !have.includes(one.value) && Boolean(desc.readonly);
      button.title = labels[one.value] || one.value;
    },
  });
}

// ---- badges that explain themselves ----------------------------------------------------------
// What explains the elements of a list (mount's explainer for the type of its elements), given an element,
// answering a text (or multilingual text) or nothing.
function explainerOf(desc) {
  const each = desc.property.params && desc.property.params.each;
  return each ? explainer(each.type) : null;
}
// What a badge says, as a popup under it: its name, then the text in the reader's language, with the
// other language one press away when there is one.
function openExplanation(anchor, title, found) {
  const content = document.createElement("div");
  content.className = "mu-explain";
  const value = typeof found === "string" ? { [appSettingValue("language") === "ja" ? "ja" : "en"]: found } : found;
  const have = TEXT_LANGUAGES.filter((lang) => value && typeof value[lang] === "string" && value[lang]);
  if (!have.length) return;
  let lang = have.includes(appSettingValue("language")) ? appSettingValue("language") : have[0];
  const labels = Object.fromEntries(languages().map((one) => [one.value, one.label]));
  const paint = () => {
    const head = Object.assign(document.createElement("div"), { className: "mu-explain-head" });
    head.append(Object.assign(document.createElement("strong"), { textContent: title }));
    if (have.length > 1) {
      const segments = Object.assign(document.createElement("div"), { className: "mu-segments" });
      for (const one of have) {
        const button = Object.assign(document.createElement("button"), { type: "button", className: `mu-segment${one === lang ? " is-active" : ""}` });
        button.append(Object.assign(document.createElement("span"), { className: "mu-segment-label", textContent: labels[one] || one }));
        button.addEventListener("click", (event) => {
          event.stopPropagation();
          lang = one;
          paint();
        });
        segments.append(button);
      }
      head.append(segments);
    }
    content.replaceChildren(head, Object.assign(document.createElement("div"), { className: "mu-explain-text", textContent: value[lang] }));
  };
  paint();
  openPopup(anchor, content, "mu-hint-popup mu-explain-popup");
}

// The badge being dragged from one list of badges to another: where it comes from, and which it is.
let BADGE_DRAG = null;

// What a list says while it has nothing in it (hidden while it has).
function emptyGuide() {
  return Object.assign(document.createElement("div"), { className: "mu-empty", textContent: t("mu.value.emptyList"), hidden: true });
}

function rowButton(glyph, titleKey, run) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "mu-row-btn";
  button.tabIndex = -1;
  button.textContent = glyph;
  button.title = t(titleKey);
  button.addEventListener("mousedown", (event) => event.preventDefault());
  button.addEventListener("click", (event) => run(event.currentTarget.closest(".mu-row")));
  return button;
}

function stepperButton(glyph, titleKey, run) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "mu-stepper-btn";
  button.tabIndex = -1; // the field is the tab stop; the buttons are the mouse's
  button.textContent = glyph;
  button.title = t(titleKey);
  button.addEventListener("mousedown", (event) => event.preventDefault());
  button.addEventListener("click", run);
  return button;
}

function textInput(type, className) {
  return {
    render(desc, onChange) {
      const input = document.createElement("input");
      input.type = type;
      input.className = className;
      if (desc.params.placeholder) input.placeholder = t(desc.params.placeholder);
      if (desc.params.min !== undefined) input.min = desc.params.min;
      if (desc.params.max !== undefined) input.max = desc.params.max;
      if (desc.params.step !== undefined) input.step = desc.params.step;
      input.value = desc.value ?? "";
      input.addEventListener("input", () => onChange(input.value));
      return input;
    },
    update(el, desc) {
      if (desc.params.placeholder) {
        const placeholder = t(desc.params.placeholder);
        if (el.placeholder !== placeholder) el.placeholder = placeholder;
      }
      setValue(el, desc.value ?? "");
    },
  };
}

// The way from a property into the chooser, for the preset control: one
// button, and it opens the screen of saved values. It used to be a dropdown
// crammed into the row -- too small to see what a value holds before taking
// it, and hopeless once more than a handful are saved.
function presetButton(desc) {
  const open = document.createElement("button");
  open.type = "button";
  open.className = "mu-icon-button mu-preset-open";
  // The library's own icon, because that is what the button opens. Plain:
  // opening the library is what the bookmark means on its own, and it is
  // the button that puts a value *in* that carries the mark.
  open.innerHTML = `<i class="bi bi-${ICONS.preset}" aria-hidden="true"></i>`;
  // Never take focus: on a skin that folds a row's controls away when
  // something inside has focus, a button that focused itself would move out
  // from under the pointer.
  open.addEventListener("mousedown", (event) => event.preventDefault());
  open.addEventListener("click", (event) => {
    event.stopPropagation();
    openValuePicker(desc, open);
  });
  // Named by the type, which is what the presets are of. A property whose
  // saved values deserve a word of their own gets it by being a type of its
  // own -- see prompt.template -- rather than by borrowing its label here.
  open.title = t("mu.action.presets", {
    type: t(VALUE_TYPES[desc.type] ? VALUE_TYPES[desc.type].label : desc.type),
  });
  return open;
}

// A picture on its way: its box says so until it has arrived (or failed
// to), with the words in the box's data-loading for the stylesheet.
function loadingWhile(box, media, loading, event = "load") {
  if (!box) return;
  box.dataset.loading = t("mu.value.loading");
  box.classList.toggle("mu-is-loading", loading);
  if (!loading) return;
  const done = () => box.classList.remove("mu-is-loading");
  media.addEventListener(event, done, { once: true });
  media.addEventListener("error", done, { once: true });
}

const BUILT_IN = {
  // ---- controls with no property behind them ---------------------------
  // A standalone control takes its configuration from the node that placed
  // it rather than from a property spec. `run` is a function, so it lives
  // on the node -- transient, and never part of a saved layout.
  button: {
    label: "mu.control.button",
    standalone: true,
    params: ["label", "title", "run"],
    // What to show it with when there is nothing real to bind -- the
    // control catalog renders this to demonstrate the control itself.
    sampleParams: { label: "Button", title: "", run: () => {} },
    render(desc) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "mu-item-button";
      applyButton(button, desc.params);
      return button;
    },
    update(el, desc) {
      applyButton(el, desc.params);
    },
  },

  // One button that is only its icon -- at the end of a bar, say, where a
  // word would crowd out what the bar is for. `title` says what it does.
  iconbutton: {
    label: "mu.control.iconbutton",
    standalone: true,
    params: ["icon", "title", "run", "disabled"],
    sampleParams: { icon: "gear", title: "Settings", run: () => {} },
    render(desc) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "mu-icon-button";
      button.append(document.createElement("i"));
      BUILT_IN.iconbutton.update(button, desc);
      return button;
    },
    update(button, desc) {
      const p = desc.params;
      const icon = `bi bi-${ICONS[p.icon] || p.icon}`;
      if (button.firstElementChild.className !== icon) button.firstElementChild.className = icon;
      button.title = p.title || "";
      button.setAttribute("aria-label", p.title || "");
      button.disabled = Boolean(p.disabled);
      button.onclick = (event) => {
        event.stopPropagation();
        p.run(button);
      };
    },
  },

  // A short value said in a bar, with nothing to change: "3/12" between the buttons that move
  // through pages. `title` says what it is.
  readout: {
    label: "mu.control.readout",
    standalone: true,
    params: ["text", "title"],
    sampleParams: { text: "3/12", title: "Page" },
    render(desc) {
      const span = document.createElement("span");
      span.className = "mu-prop-static mu-readout";
      BUILT_IN.readout.update(span, desc);
      return span;
    },
    update(span, desc) {
      const p = desc.params;
      if (span.textContent !== String(p.text ?? "")) span.textContent = String(p.text ?? "");
      span.title = p.title || "";
    },
  },

  buttonrow: {
    label: "mu.control.buttonrow",
    standalone: true,
    params: { buttons: { type: "buttons" } },
    sampleParams: {
      buttons: [
        { key: "one", label: "One", run: () => {} },
        { key: "two", label: "Two", run: () => {} },
      ],
    },
    render(desc) {
      const el = document.createElement("div");
      el.className = "mu-item-actions";
      BUILT_IN.buttonrow.update(el, desc);
      return el;
    },
    update(el, desc) {
      diffChildren(el, desc.params.buttons || [], (spec) => spec.key, {
        create: () => {
          const button = document.createElement("button");
          button.type = "button";
          button.className = "mu-item-button";
          return button;
        },
        update: applyButton,
      });
    },
  },

  // Choices, text and readouts in one frame, set apart by dividers as a
  // vector's axes are. Nothing stands beside a cell to name it: a drop-down
  // names itself in the list it opens (its heading), a text field in its
  // placeholder, a readout in its title -- so what the form shows is only
  // values. `fields` is [{key, label, kind, value, options, onChange}]: kind
  // is "select" (the default; `options` is [[value, text]]), "text" or
  // "readout" (a value shown, not changed). `readonly` fixes the whole form.
  // `layout` is "row" (the default: side by side) or "stack": one cell above the
  // next, for values that read top to bottom (an edge's outer and inner space).
  fieldform: {
    label: "mu.control.fieldform",
    standalone: true,
    params: ["fields", "readonly", "layout"],
    sampleParams: {
      fields: [
        { key: "state", label: "State", kind: "readout", value: "ready" },
        { key: "mode", label: "Mode", value: "a", options: [["a", "A"], ["b", "B"]], onChange: () => {} },
        { key: "name", label: "Name", kind: "text", value: "", onChange: () => {} },
      ],
    },
    render(desc) {
      const el = document.createElement("div");
      el.className = "mu-fieldform";
      BUILT_IN.fieldform.update(el, desc);
      return el;
    },
    update(el, desc) {
      const readonly = Boolean(desc.params.readonly);
      el.classList.toggle("is-readonly", readonly);
      el.classList.toggle("is-stack", desc.params.layout === "stack");
      // A cell of another kind is another cell: the kind is part of its key.
      diffChildren(el, desc.params.fields || [], (field) => `${field.key}:${field.kind || "select"}`, {
        create: createFieldCell,
        update: (cell, field) => updateFieldCell(cell, field, readonly),
      });
    },
  },

  // Several things to tick, behind one button: it says what the list is for and
  // how many are ticked, and opens a popup of check boxes beside it. The popup
  // stays open while boxes are ticked and closes on a press outside it or
  // Escape. `items` is [{value, label, checked, swatch}] (`swatch` is a colour
  // for a dot before the label); `onChange(values)` gets every ticked value.
  popupchecklist: {
    label: "mu.control.popupchecklist",
    standalone: true,
    params: ["items", "label", "icon", "title", "onChange"],
    sampleParams: {
      icon: "layers",
      label: "Layers",
      items: [
        { value: "a", label: "A", checked: true },
        { value: "b", label: "B", checked: false },
      ],
      onChange: () => {},
    },
    render(desc) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "mu-popcheck";
      button.append(
        document.createElement("i"),
        Object.assign(document.createElement("span"), { className: "mu-popcheck-label" }),
        Object.assign(document.createElement("span"), { className: "mu-popcheck-count" }),
        Object.assign(document.createElement("i"), { className: "bi bi-chevron-down mu-popcheck-caret" })
      );
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        openChecklist(button);
      });
      BUILT_IN.popupchecklist.update(button, desc);
      return button;
    },
    update(button, desc) {
      button.__desc = desc;
      const p = desc.params;
      const items = p.items || [];
      const [icon, label, count] = button.children;
      const iconClass = p.icon ? `bi bi-${ICONS[p.icon] || p.icon}` : "";
      if (icon.className !== iconClass) icon.className = iconClass;
      icon.hidden = !p.icon;
      label.textContent = p.label || "";
      label.hidden = !p.label;
      count.textContent = `${items.filter((item) => item.checked).length}/${items.length}`;
      const title = p.title || p.label || "";
      button.title = title;
      button.setAttribute("aria-label", title);
      button.setAttribute("aria-haspopup", "true");
      if (checklistPopup && checklistPopup.button === button) paintChecklist(button);
    },
  },

  // A property to be picked off an app on screen: a dashed button like a
  // list's add, which hands the press to whoever asked (`onPick`) -- who
  // covers the controls with guides and takes the answer. What is picked is
  // drawn by the caller, as a card around the property's own control.
  propertypick: {
    label: "mu.control.propertypick",
    standalone: true,
    params: ["label", "title", "onPick"],
    sampleParams: { label: "Select", onPick: () => {} },
    render(desc) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "mu-add mu-nodecard-add mu-propertypick";
      button.append(
        Object.assign(document.createElement("i"), { className: "bi bi-cursor" }),
        Object.assign(document.createElement("span"), { className: "mu-propertypick-label" })
      );
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        const now = button.__desc && button.__desc.params.onPick;
        if (now) now(button);
      });
      BUILT_IN.propertypick.update(button, desc);
      return button;
    },
    update(button, desc) {
      button.__desc = desc;
      const label = desc.params.label || "";
      const text = button.lastElementChild;
      if (text.textContent !== label) text.textContent = label;
      button.title = desc.params.title || label;
    },
  },

  // A set of actions to choose from, as icon tiles or as rows. The items are
  // the same either way -- {key, label, icon, title, run, active, tint, lit} -- so the layout
  // is a presentation choice and belongs to whoever placed the control.
  gallery: {
    label: "mu.control.gallery",
    standalone: true,
    params: ["items", "layout"],
    sampleParams: {
      items: [
        { key: "one", label: "One", icon: "star", run: () => {} },
        { key: "two", label: "Two", icon: "heart", run: () => {} },
      ],
      layout: "grid",
    },
    render(desc) {
      const el = document.createElement("div");
      el.className = "mu-gallery";
      BUILT_IN.gallery.update(el, desc);
      return el;
    },
    update(el, desc) {
      const list = desc.params.layout === "list";
      el.classList.toggle("is-list", list);
      el.classList.toggle("is-grid", !list);
      diffChildren(el, desc.params.items || [], (spec) => spec.key, {
        create: () => {
          const button = document.createElement("button");
          button.type = "button";
          button.className = "mu-tile";
          button.append(
            Object.assign(document.createElement("i"), { className: "bi" }),
            Object.assign(document.createElement("span"), { className: "mu-tile-label" })
          );
          return button;
        },
        update: (button, spec) => {
          const icon = `bi bi-${ICONS[spec.icon] || spec.icon || ICONS.value}`;
          if (button.firstElementChild.className !== icon) {
            button.firstElementChild.className = icon;
          }
          const label = button.lastElementChild;
          if (label.textContent !== spec.label) label.textContent = spec.label;
          button.title = spec.title || spec.label || "";
          // Which one is in effect now, where there is such a thing -- the
          // template an app has loaded, say.
          button.classList.toggle("is-active", Boolean(spec.active));
          button.setAttribute("aria-pressed", String(Boolean(spec.active)));
          // A colour of its own, for what has one -- an app wears its
          // theme colour on its tile.
          const tint = typeof spec.tint === "string" ? spec.tint : "";
          button.classList.toggle("has-tint", Boolean(tint));
          button.classList.toggle("is-lit", Boolean(tint) && Boolean(spec.lit));
          if (tint) {
            if (button.style.getPropertyValue("--tile-tint") !== tint) button.style.setProperty("--tile-tint", tint);
          } else if (button.style.getPropertyValue("--tile-tint")) {
            button.style.removeProperty("--tile-tint");
          }
          // Replaced rather than added: body() hands over a fresh closure
          // each pass, the same rule applyButton follows.
          button.onclick = (event) => {
            event.stopPropagation();
            spec.run();
          };
        },
      });
    },
  },

  // A set of switches, each a card: an icon, a name and the switch itself,
  // in a grid, in the order given. For a handful of things that are on or
  // off and are told apart by what they look like -- a window's title bar
  // buttons -- where a table of checkboxes would say nothing about which is
  // which.
  //
  //   items: [{key, icon, label, title?, on, set(value)}]
  toolcards: {
    label: "mu.control.toolcards",
    standalone: true,
    params: ["items"],
    sampleParams: {
      items: [
        { key: "one", icon: "star", label: "One", on: true, set: () => {} },
        { key: "two", icon: "heart", label: "Two", on: false, set: () => {} },
      ],
    },
    render(desc) {
      const el = document.createElement("div");
      el.className = "mu-toolcards";
      BUILT_IN.toolcards.update(el, desc);
      return el;
    },
    update(el, desc) {
      diffChildren(el, desc.params.items || [], (spec) => spec.key, {
        create: () => {
          const card = document.createElement("div");
          card.className = "mu-toolcard";
          const label = document.createElement("span");
          label.className = "mu-toolcard-label";
          const toggle = document.createElement("button");
          toggle.type = "button";
          toggle.className = "mu-toolcard-switch";
          toggle.setAttribute("role", "switch");
          card.append(document.createElement("i"), label, toggle);
          return card;
        },
        update: (card, spec) => {
          const [icon, label, toggle] = card.children;
          const glyph = `bi bi-${ICONS[spec.icon] || spec.icon || ICONS.value}`;
          if (icon.className !== glyph) icon.className = glyph;
          if (label.textContent !== spec.label) label.textContent = spec.label;
          card.title = spec.title || spec.label || "";
          card.classList.toggle("is-on", Boolean(spec.on));
          toggle.setAttribute("aria-checked", String(Boolean(spec.on)));
          toggle.setAttribute("aria-label", spec.label || "");
          // Replaced rather than added: body() hands over a fresh closure
          // each pass.
          toggle.onclick = (event) => {
            event.stopPropagation();
            spec.set(!spec.on);
          };
        },
      });
    },
  },

  // A groupset, as one chip per group.
  //
  // Chips rather than rows of checkboxes: a group is a word, so a row each
  // spent a screenful on the filter and left the values it filters below
  // the fold. Which groups are being looked at is said in colour -- a chip
  // is either lit or it is not -- so there is no box to read as well.
  //
  // Folded away by default, showing only the groups that are picked. Most
  // of the time the filter is not the question: either nothing is picked,
  // and every group shows anyway, or it was set from the property that
  // opened the screen, and what matters is which few survived. Whether it
  // is open is view state, like a caret, so it lives on the element and is
  // never written to the layout.
  grouppick: {
    label: "mu.control.grouppick",
    needs: ["offered", "showing", "picked", "toggled"],
    params: ["layout"],
    render(desc, onChange) {
      const el = document.createElement("div");
      el.className = "mu-grouppick";
      // update() is called with the descriptor and nothing else, so the way
      // to write has to be kept on the element rather than in a closure the
      // next pass will not have.
      el.__onChange = onChange;
      el.__open = false;
      const chips = document.createElement("div");
      chips.className = "mu-group-chips";
      const more = document.createElement("button");
      more.type = "button";
      more.className = "mu-group-more";
      more.append(Object.assign(document.createElement("i"), { className: "bi", "aria-hidden": "true" }));
      more.addEventListener("click", (event) => {
        event.stopPropagation();
        el.__open = !el.__open;
        BUILT_IN.grouppick.update(el, el.__desc);
      });
      el.append(chips, more);
      BUILT_IN.grouppick.update(el, desc);
      return el;
    },
    update(el, desc) {
      // Kept on the element for the same reason as __onChange: the fold
      // button redraws from a later pass than the one that built it.
      el.__desc = desc;
      const offered = desc.property.offered();
      const picked = desc.property.picked();
      const showing = desc.property.showing();
      const narrowed = picked.length > 0;
      el.classList.toggle("is-narrowed", narrowed);
      el.classList.toggle("is-open", el.__open);

      // Nothing to fold while nothing is picked: every group is showing, so
      // hiding them behind a button would hide the only way to pick one.
      // The fold exists for the other case -- a filter set by whatever
      // opened the screen, where what matters is the few that survived.
      const shown = el.__open || !narrowed
        ? offered
        : offered.filter((group) => picked.includes(group.id));
      const [chips, more] = el.children;
      diffChildren(chips, shown, (group) => group.id || "(none)", {
        create: () => {
          const chip = document.createElement("button");
          chip.type = "button";
          chip.className = "mu-group-chip";
          return chip;
        },
        update: (chip, group) => {
          if (chip.textContent !== group.label) chip.textContent = group.label;
          // Lit means "being looked at". With no filter set every group is
          // showing, which is true but says nothing, so nothing is lit.
          chip.classList.toggle("is-on", narrowed && showing.includes(group.id));
          chip.title = t("mu.action.toggleGroup", { id: group.label });
          chip.onclick = (event) => {
            event.stopPropagation();
            // The type works out what the filter becomes; writing it is the
            // control's job, and onChange is the only door -- it is what
            // saves the value and redraws what depends on it.
            el.__onChange(desc.property.toggled(group.id));
          };
        },
      });

      // An icon, not a word: what it does is "show the rest" or "put them
      // away", which a chevron says in the space of one chip.
      more.hidden = !narrowed;
      const label = el.__open
        ? t("mu.action.foldGroups")
        : t("mu.action.showGroups", { n: offered.length - picked.length });
      const icon = `bi bi-${ICONS[el.__open ? "foldUp" : "foldDown"]}`;
      if (more.firstElementChild.className !== icon) more.firstElementChild.className = icon;
      more.title = label;
      more.setAttribute("aria-label", label);
    },
  },

  // Selecting from a list is an edit like any other: the chosen id goes
  // through the property's set(), not straight into props.
  // A list to choose one from. Always in a card -- a list is a card, like every
  // other list control (see listCard) -- so it folds, has the grip of one, and
  // is not a bare run of rows among a window's properties.
  picker: {
    // Draws as a card, and has no header to put a name in (see unnamedCardsIn) -- unless it
    // is `bare`: then it is only the rows, for a card that already holds them (its name is
    // that card's).
    cardName: (desc) => (desc && desc.params && desc.params.bare ? "bare" : ""),
    label: "mu.control.picker",
    needs: ["set"],
    // `toggle`: pressing the entry that is picked lets go of it (the value is then empty).
    params: {
      entries: { type: "data", bind: "read" },
      selected: { type: "string", bind: "read" },
      bare: { type: "boolean" },
      toggle: { type: "boolean" },
    },
    sampleParams: {
      entries: [
        { id: "alpha", primary: "Alpha", secondary: "first" },
        { id: "beta", primary: "Beta", secondary: "second" },
      ],
    },
    render(desc, onChange) {
      const list = document.createElement("div");
      list.className = "mu-list";
      const wrap = desc.params.bare ? Object.assign(list, { __list: list }) : listCard(list, { key: `picker:${desc.key || ""}` });
      // Said under the rows, in the card: only a card that holds nothing else has room for it.
      if (!desc.params.bare) list.after(emptyGuide());
      wrap.__onChange = onChange;
      BUILT_IN.picker.update(wrap, desc);
      return wrap;
    },
    update(wrap, desc) {
      const el = wrap.__list;
      el.__onChange = wrap.__onChange;
      const entries = desc.params.entries || [];
      const guide = el.nextElementSibling;
      if (guide && guide.classList.contains("mu-empty")) guide.hidden = entries.length > 0;
      if (!entries.length) {
        el.replaceChildren();
        return;
      }
      diffChildren(el, entries, (entry) => entry.id, {
        create: () => {
          const row = document.createElement("button");
          row.type = "button";
          row.className = "mu-list-row";
          row.append(
            Object.assign(document.createElement("span"), { className: "mu-list-primary" }),
            Object.assign(document.createElement("span"), { className: "mu-list-secondary" })
          );
          row.addEventListener("click", (event) => {
            event.stopPropagation();
            el.__onChange(desc.params.toggle && row.classList.contains("is-selected") ? "" : row.dataset.nodeKey);
          });
          return row;
        },
        update: (row, entry) => {
          row.firstElementChild.textContent = entry.primary;
          row.lastElementChild.textContent = entry.secondary || "";
          row.classList.toggle("is-selected", entry.id === desc.params.selected);
        },
      });
    },
  },

  // An append-only view of a list of rows: {id?, kind, text}. The rows live
  // in the property, so a transcript survives a reload; the scroll position
  // does not, because it is not part of the value.
  log: {
    label: "mu.control.log",
    needs: ["items"],
    params: { follow: { type: "boolean", bind: "read" } },
    sampleParams: {},
    render(desc) {
      const el = document.createElement("div");
      el.className = "mu-log";
      BUILT_IN.log.update(el, desc);
      return el;
    },
    update(el, desc) {
      const rows = desc.property.items();
      // Follow the tail only if the reader was already at it -- scrolling
      // back to read something must not be undone by the next line.
      const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24;

      if (!rows.length) {
        el.replaceChildren();
        return;
      }

      diffChildren(el, rows, (row, index) => row.id ?? index, {
        create: () => {
          const line = document.createElement("div");
          line.className = "mu-log-row";
          return line;
        },
        update: (line, row) => {
          const kind = row.kind || "stdout";
          if (line.dataset.kind !== kind) line.dataset.kind = kind;
          if (line.textContent !== row.text) line.textContent = row.text;
        },
      });

      if (atBottom || desc.params.follow !== false) el.scrollTop = el.scrollHeight;
    },
  },

  // A single line that submits. The text is an ordinary string property;
  // what makes it a command line is that the node hands it something to do
  // on Enter, and optionally a history to walk with the arrow keys.
  commandline: {
    label: "mu.control.commandline",
    needs: ["setText"],
    params: {
      onSubmit: { type: "action" }, history: { type: "data", bind: "read" },
      prompt: { type: "string" }, placeholder: { type: "label" }, status: { type: "data" },
    },
    sampleParams: { onSubmit: () => {} },
    render(desc, onChange) {
      const wrap = document.createElement("div");
      wrap.className = "mu-commandline";

      const prompt = document.createElement("span");
      prompt.className = "mu-commandline-prompt";
      const input = document.createElement("input");
      input.type = "text";
      input.className = "input mu-commandline-input";
      input.spellcheck = false;
      wrap.append(prompt, input);
      wrap.__cursor = null; // where we are in the history, if anywhere

      input.addEventListener("input", () => {
        wrap.__cursor = null;
        onChange(input.value);
      });
      input.addEventListener("keydown", (event) => {
        const history = wrap.__history || [];
        if (event.key === "Enter") {
          event.preventDefault();
          wrap.__cursor = null;
          if (wrap.__onSubmit) wrap.__onSubmit();
          return;
        }
        if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
        if (!history.length) return;
        event.preventDefault();
        const at = wrap.__cursor === null ? history.length : wrap.__cursor;
        const next = event.key === "ArrowUp"
          ? Math.max(0, at - 1)
          : Math.min(history.length, at + 1);
        wrap.__cursor = next;
        input.value = next === history.length ? "" : history[next];
        onChange(input.value);
      });

      BUILT_IN.commandline.update(wrap, desc);
      return wrap;
    },
    update(el, desc) {
      el.__onSubmit = desc.params.onSubmit;
      el.__history = desc.params.history || [];
      el.setAttribute("aria-busy", String(desc.params.status?.state === "busy"));
      const input = el.lastElementChild;
      el.firstElementChild.textContent = desc.params.prompt || "\u276f";
      if (desc.params.placeholder) input.placeholder = t(desc.params.placeholder);
      setValue(input, desc.value ?? "");
    },
  },

  // ---- property editors -------------------------------------------------
  textbox: {
    label: "mu.control.textbox",
    needs: ["setText"],
    // `change`: what is done when it is changed (given { value }), for a value that is read and not written here;
    // `port`: where the value stands when it is an element's field (the shell gives it).
    params: { change: { type: "action", payload: { value: "string" } }, port: { type: "data" } },
    // Typing writes at once; the windows are drawn again after a pause (see
    // onChange in core): a keystroke must not wait for every window.
    deferRefresh: 250,
    // A text that follows another (a text composer's result, say) is put in a
    // one-line field by the grip: its row is a port (see paintRowPort).
    linkable: true,
    ...textInput("text", "input mu-prop-input"),
  },

  // A text field that says what it is for with an icon instead of a word.
  // The placeholder was "part of a name", which is the only thing anyone
  // ever types into a search box -- a magnifier says it in no language and
  // leaves the field its full width.
  searchbox: {
    label: "mu.control.searchbox",
    needs: ["text", "setText"],
    params: ["placeholder"],
    render(desc, onChange) {
      const wrap = document.createElement("div");
      wrap.className = "mu-searchbox";
      const icon = document.createElement("i");
      icon.className = `bi bi-${ICONS.search}`;
      icon.setAttribute("aria-hidden", "true");
      const input = document.createElement("input");
      input.type = "search";
      input.className = "input mu-prop-input";
      // Named for what it does, since there is no visible label to read.
      input.setAttribute("aria-label", t("mu.prop.search"));
      input.addEventListener("input", () => onChange(input.value));
      wrap.append(icon, input);
      BUILT_IN.searchbox.update(wrap, desc);
      return wrap;
    },
    update(el, desc) {
      const input = el.lastElementChild;
      if (desc.params.placeholder) {
        const placeholder = t(desc.params.placeholder);
        if (input.placeholder !== placeholder) input.placeholder = placeholder;
      }
      setValue(input, desc.value ?? "");
      // The magnifier is this field's label, and a label is read before the
      // field is used: once there is something typed the field says what it
      // is for by what is in it, so the icon goes and gives back the room
      // it was holding.
      el.classList.toggle("is-filled", Boolean(input.value));
    },
  },

  textarea: {
    label: "mu.control.textarea",
    needs: ["setText"],
    deferRefresh: 250,
    params: ["rows", "fill"],
    render(desc, onChange) {
      const area = document.createElement("textarea");
      area.className = "input mu-prop-note";
      // `fill` is a presentation choice, so it belongs to the control: the
      // same string is a one-line field here and a whole editor there.
      if (desc.params.fill) area.classList.add("is-filling");
      area.rows = desc.params.rows || 2;
      if (desc.params.placeholder) area.placeholder = t(desc.params.placeholder);
      area.value = desc.value ?? "";
      area.spellcheck = false;
      area.addEventListener("input", () => onChange(area.value));
      return area;
    },
    update(el, desc) {
      setValue(el, desc.value ?? "");
    },
  },

  numberbox: {
    label: "mu.control.numberbox",
    needs: ["setNumber"],
    // `change`: what is done when it is changed (given { value }), for a value that is read and not written here;
    // `port`: where the value stands when it is an element's field (the shell gives it).
    params: { step: { type: "number" }, change: { type: "action", payload: { value: "number" } }, port: { type: "data" } },
    // Typing writes at once and the windows are drawn after a pause, as for
    // the text box: a digit must not wait for every window.
    deferRefresh: 250,
    ...textInput("number", "input mu-prop-input"),
  },

  // A number field with its own -/+ buttons either side. The property does
  // the clamping -- `set` coerces, so a step past min or max simply lands on
  // it -- which is why this asks for nothing but setNumber and works with
  // any numeric property, bounded or not.
  stepper: {
    label: "mu.control.stepper",
    needs: ["setNumber"],
    params: ["step"],
    // A press or a digit writes the property at once; the windows are drawn
    // after a pause (see onChange in core), so a run of presses is not a run
    // of redraws of every window.
    deferRefresh: 250,
    render(desc, onChange) {
      const wrap = document.createElement("div");
      wrap.className = "mu-stepper";

      const input = document.createElement("input");
      input.type = "number";
      input.className = "input mu-stepper-input";
      if (desc.params.min !== undefined) input.min = desc.params.min;
      if (desc.params.max !== undefined) input.max = desc.params.max;

      // The current value is read off the field rather than off the desc
      // captured here: update() keeps the field right, and a click may come
      // many refreshes after the render.
      const bump = (direction) => {
        const step = Number(wrap.dataset.step) || 1;
        const from = Number(input.value) || 0;
        // Steps land on multiples of the step rather than drifting from
        // wherever a typed value happened to be.
        const next = Math.round((from + direction * step) / step) * step;
        // Floating point: 0.1 + 0.2 must read back as 0.3, not 0.30000000004.
        onChange(Number(next.toPrecision(12)));
        // update() will not touch a focused field -- that is what protects
        // the caret while typing -- so a press has to write the field back
        // itself, or the next press would step from stale text. Read from
        // the property rather than from `next`, so a clamp shows.
        input.value = desc.property.get();
      };

      wrap.append(
        stepperButton("\u2212", "mu.action.stepDown", () => bump(-1)),
        input,
        stepperButton("+", "mu.action.stepUp", () => bump(1))
      );
      input.addEventListener("input", () => onChange(input.value));
      BUILT_IN.stepper.update(wrap, desc);
      return wrap;
    },
    update(el, desc) {
      el.dataset.step = String(desc.params.step ?? 1);
      const input = el.querySelector(".mu-stepper-input");
      input.step = desc.params.step ?? "any";
      setValue(input, desc.value ?? 0);
    },
  },

  // A number shown as a percentage, with the figure centred between its own
  // -/+ buttons. It has no label (the property's name is its tooltip): where it
  // stands says what it is. Pressing the figure opens it for typing, and then
  // the "%" is gone and so are the buttons; they are there all the other
  // times, not only under the pointer. `scale` is what the property's number
  // is multiplied by to be the percentage -- 1 when it already is one (a zoom
  // of 100), 100 for the shell's `percent` type, a proportion.
  percent: {
    label: "mu.control.percent",
    needs: ["setNumber"],
    params: ["step", "scale"],
    deferRefresh: 250,
    render(desc, onChange) {
      const wrap = document.createElement("div");
      wrap.className = "mu-percent";
      const input = document.createElement("input");
      input.type = "text";
      input.inputMode = "decimal";
      input.className = "mu-percent-input";
      const scale = () => Number(wrap.dataset.scale) || 1;
      const clean = (n) => Number(Number(n).toPrecision(12));
      // The property's own answer, in percent: a clamp shows.
      const shown = () => clean(Number(desc.property.get()) * scale());
      const write = (percent) => onChange(clean(percent / scale()));
      const bump = (direction) => {
        const step = Number(wrap.dataset.step) || 1;
        const from = wrap.classList.contains("is-editing") ? Number(input.value) || 0 : shown();
        write(Math.round((from + direction * step) / step) * step);
        input.value = wrap.classList.contains("is-editing") ? String(shown()) : `${shown()}%`;
      };
      input.addEventListener("focus", () => {
        wrap.classList.add("is-editing");
        input.value = String(shown());
        input.select();
      });
      input.addEventListener("input", () => {
        const n = Number(input.value);
        if (input.value.trim() !== "" && Number.isFinite(n)) write(n);
      });
      input.addEventListener("blur", () => {
        wrap.classList.remove("is-editing");
        input.value = `${shown()}%`;
      });
      input.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === "Escape") {
          event.stopPropagation();
          input.blur();
        }
      });
      wrap.append(
        stepperButton("\u2212", "mu.action.stepDown", () => bump(-1)),
        input,
        stepperButton("+", "mu.action.stepUp", () => bump(1))
      );
      BUILT_IN.percent.update(wrap, desc);
      return wrap;
    },
    update(el, desc) {
      el.dataset.step = String(desc.params.step ?? 1);
      el.dataset.scale = String(desc.params.scale ?? (desc.type === "percent" ? 100 : 1));
      el.classList.toggle("is-readonly", Boolean(desc.readonly));
      const input = el.querySelector(".mu-percent-input");
      input.readOnly = Boolean(desc.readonly);
      el.title = desc.label || "";
      if (el.classList.contains("is-editing")) return;
      const n = Number((Number(desc.value ?? 0) * Number(el.dataset.scale)).toPrecision(12));
      const text = `${n}%`;
      if (input.value !== text) input.value = text;
    },
  },

  // Picking a saved value: a list of what is in the drawer, and a readout
  // of the one chosen. The value itself is not edited here -- it belongs to
  // the library, and editing it here would edit it for everything else that
  // points at it without saying so. The Library item is where that happens.
  // A list, one row per element, each drawn by the element type's own
  // control. The rows are keyed by position, so the DOM (and anything being
  // typed into it) survives a value change; a reorder moves the values
  // through the existing rows rather than rebuilding them.
  rows: {
    label: "mu.control.rows",
    needs: ["items", "set", "blank"],
    requiresParams: ["each"],
    render(desc, onChange) {
      const wrap = document.createElement("div");
      wrap.className = "mu-rows";
      wrap.__onChange = onChange;

      const list = document.createElement("div");
      list.className = "mu-rows-list";
      const add = document.createElement("div");
      add.className = "mu-item-actions";
      const button = document.createElement("button");
      button.type = "button";
      button.className = "mu-item-button";
      button.textContent = t("mu.action.addRow");
      button.title = t("mu.action.addRowTitle");
      button.addEventListener("click", () => {
        const property = wrap.__desc.property;
        onChange([...property.items(), property.blank()]);
      });
      add.append(button);
      wrap.append(list, emptyGuide(), add);

      BUILT_IN.rows.update(wrap, desc);
      return wrap;
    },
    update(el, desc) {
      // The descriptor is kept because a button pressed later needs the
      // list as it is then, not as it was when the row was built.
      el.__desc = desc;
      const items = desc.property.items();
      el.querySelector(":scope > .mu-empty").hidden = items.length > 0;
      const write = (next) => el.__onChange(next);
      const move = (index, by) => {
        const next = [...desc.property.items()];
        const to = index + by;
        if (to < 0 || to >= next.length) return;
        [next[index], next[to]] = [next[to], next[index]];
        write(next);
      };
      const remove = (index) => {
        const next = [...desc.property.items()];
        next.splice(index, 1);
        write(next);
      };

      diffChildren(
        el.firstElementChild,
        items.map((value, index) => ({ index, value })),
        (entry) => entry.index,
        {
          create: () => {
            const row = document.createElement("div");
            row.className = "mu-row";
            const slot = document.createElement("div");
            slot.className = "mu-row-slot";
            const tools = document.createElement("div");
            tools.className = "mu-row-tools";
            tools.append(
              rowButton("\u2191", "mu.action.rowUp", (row2) => move(Number(row2.dataset.nodeKey), -1)),
              rowButton("\u2193", "mu.action.rowDown", (row2) => move(Number(row2.dataset.nodeKey), 1)),
              rowButton("\u00d7", "mu.action.rowRemove", (row2) => remove(Number(row2.dataset.nodeKey)))
            );
            row.append(slot, tools);
            return row;
          },
          update: (row, entry) => {
            // The element is a property of the list, reached by position, so
            // the element's control never learns it is in one.
            const inner = describeProperty(desc.property.element(entry.index, write), {
              key: `${desc.key}.${entry.index}`,
              label: String(entry.index + 1),
            });
            const slot = row.firstElementChild;
            const control = inner.control;
            if (!control) return;
            if (row.dataset.control !== control.name) {
              row.dataset.control = control.name;
              // Through the element's own set(), not straight to write():
              // that is where the element type coerces, and skipping it
              // would put a select's string where a number belongs.
              slot.replaceChildren(
                control.render(inner, (value) => inner.property.set(value))
              );
            } else {
              control.update(slot.firstElementChild, inner);
            }
          },
        }
      );
    },
  },

  // A list as cards in two columns, one element each, with no header: a
  // grip to carry it, the element's own control, and a cross to drop it.
  // For a list of short things -- tags -- where a row each spends a screen
  // on what fits in half of one, and order still matters.
  //
  // Moved by the grip, the same gesture as the prompt's slot cards: while a
  // card is in flight every other one offers its two drops -- before it and
  // after it, left and right as the grid reads -- and the one under the
  // pointer fills in. Cards are keyed by position, as `rows` are, so what is
  // being typed into survives a value change and a move only moves values.
  cardgrid: {
    label: "mu.control.cardgrid",
    needs: ["items", "set", "blank"],
    requiresParams: ["each"],
    render(desc, onChange) {
      const wrap = document.createElement("div");
      wrap.className = "mu-cardgrid";
      wrap.__onChange = onChange;

      const grid = document.createElement("div");
      grid.className = "mu-cardgrid-list";
      const add = document.createElement("div");
      add.className = "mu-item-actions";
      const button = document.createElement("button");
      button.type = "button";
      button.className = "mu-item-button";
      button.textContent = t("mu.action.addRow");
      button.title = t("mu.action.addRowTitle");
      button.addEventListener("click", () => {
        const property = wrap.__desc.property;
        onChange([...property.items(), property.blank()]);
      });
      add.append(button);
      wrap.append(grid, emptyGuide(), add);

      BUILT_IN.cardgrid.update(wrap, desc);
      return wrap;
    },
    update(el, desc) {
      // Kept for what is pressed or dropped later, which needs the list as
      // it is then rather than as it was when the card was built.
      el.__desc = desc;
      const items = desc.property.items();
      el.querySelector(":scope > .mu-empty").hidden = items.length > 0;
      const write = (next) => el.__onChange(next);

      diffChildren(
        el.firstElementChild,
        items.map((value, index) => ({ index, value })),
        (entry) => entry.index,
        {
          create: () => cardgridCard(el),
          update: (card, entry) => {
            card.classList.toggle("is-dragging", el.__dragging === entry.index);
            // Through its position, so the element's control never learns it
            // is in a list.
            const inner = describeProperty(el.__desc.property.element(entry.index, write), {
              key: `${desc.key}.${entry.index}`,
              label: String(entry.index + 1),
            });
            const slot = card.querySelector(".mu-cardgrid-slot");
            const control = inner.control;
            if (!control) return;
            if (slot.dataset.control !== control.name) {
              slot.dataset.control = control.name;
              // Through the element's own set(), where it coerces.
              slot.replaceChildren(control.render(inner, (value) => inner.property.set(value)));
            } else {
              control.update(slot.firstElementChild, inner);
            }
          },
        }
      );
    },
  },

  // How the library reaches an ordinary property. The property is an
  // ordinary one -- a vector, a string -- and keeps its own value; this
  // wraps its normal control with a way into the chooser, and what comes
  // back is a copy. After that the value is the item's and diverges freely.
  // There is no linking alternative: a copy is the only thing the library
  // hands out, which is why deleting a saved value never breaks anything.
  //
  // `inner` names the control to wrap, because the type's default is this
  // one as soon as a spec asks for it.
  preset: {
    label: "mu.control.preset",
    needs: ["set"],
    // Nothing required: where a value comes from and where it is saved are
    // both "the library, under this property's type". A drawer to name was
    // the one thing this used to need, and there are no drawers now.
    params: ["inner"],
    render(desc, onChange) {
      const wrap = document.createElement("div");
      wrap.className = "mu-preset";
      // `inner: "none"` is for a property whose value is drawn elsewhere --
      // a list with its own editor below it, say. The row is then the label
      // and the way in, and nothing else.
      const inner = innerControl(desc);
      wrap.dataset.inner = inner ? inner.name : "none";
      if (inner) wrap.append(inner.render(desc, onChange));

      // The button that opens the chooser. In a property row it is the
      // row's accessory instead, beside the label (see accessory below):
      // next to the name of what it loads, rather than at the far end of
      // the value, where it read as part of the value. Only a preset placed
      // on its own, with no label to sit beside, carries it here.
      if (!desc.inRow) {
        const open = presetButton(desc);
        // A card has a header of buttons of its own, and the way into its
        // presets is one of them: beside the card the button stood outside
        // its width, narrowing it against every card around it.
        const head = inner && wrap.firstElementChild ? wrap.firstElementChild.querySelector(":scope > .mu-card-bar") : null;
        if (head) {
          head.append(open);
          fitCardHead(head);
        } else wrap.append(open);
      }

      BUILT_IN.preset.update(wrap, desc);
      return wrap;
    },
    accessory(desc) {
      return presetButton(desc);
    },
    update(el, desc) {
      const inner = innerControl(desc);
      if (inner) inner.update(el.firstElementChild, desc);
      // No count on the button. What is saved is a fact about the library,
      // not about this property, and reading it here meant scanning a
      // number that changes for reasons the row has nothing to do with.
    },
  },

  // Several numbers on one line. Each axis is a label and a value until it
  // is picked; then it becomes a stepper and the others fold back to their
  // label. Nothing is rebuilt when that happens -- both halves of every
  // axis exist from the start and one of them is hidden -- so a value can
  // be typed into without the row moving under the caret.
  vector: {
    label: "mu.control.vector",
    needs: ["axes", "axisValue", "setAxis"],
    requiresParams: ["axes"],
    params: ["step"],
    render(desc, onChange) {
      const wrap = document.createElement("div");
      wrap.className = "mu-vector";

      desc.property.axes().forEach((name, index) => {
        const axis = document.createElement("div");
        axis.className = "mu-vector-axis";
        axis.dataset.axis = String(index);

        const label = document.createElement("span");
        label.className = "mu-vector-label";
        label.textContent = name;

        const value = document.createElement("span");
        value.className = "mu-vector-value";

        const stepper = document.createElement("div");
        stepper.className = "mu-stepper";
        stepper.hidden = true;
        const input = document.createElement("input");
        input.type = "number";
        input.className = "input mu-stepper-input";

        const write = (next) => onChange(vectorWith(wrap, index, next));
        const bump = (direction) => {
          const step = Number(wrap.dataset.step) || 1;
          const from = Number(input.value) || 0;
          write(Number((Math.round((from + direction * step) / step) * step).toPrecision(12)));
          // See the stepper: the field has focus, so nothing else will
          // write it, and a second press would otherwise repeat the first.
          input.value = desc.property.axisValue(index);
        };
        input.addEventListener("input", () => write(input.value));
        // Leaving the field closes the axis: the open one is only ever the
        // one being edited.
        input.addEventListener("blur", () => setActiveAxis(wrap, null));
        input.addEventListener("keydown", (event) => {
          if (event.key === "Escape") input.blur();
        });

        stepper.append(
          stepperButton("\u2212", "mu.action.stepDown", () => bump(-1)),
          input,
          stepperButton("+", "mu.action.stepUp", () => bump(1))
        );
        axis.append(label, value, stepper);
        axis.addEventListener("mousedown", (event) => {
          if (Number(wrap.dataset.active) === index) return; // already open
          event.preventDefault(); // do not put the caret where the label was
          setActiveAxis(wrap, index);
        });
        wrap.append(axis);
      });

      BUILT_IN.vector.update(wrap, desc);
      return wrap;
    },
    update(el, desc) {
      el.dataset.step = String(desc.params.step ?? 1);
      const active = el.dataset.active === undefined ? null : Number(el.dataset.active);
      Array.from(el.children).forEach((axis, index) => {
        const isActive = index === active;
        axis.classList.toggle("is-active", isActive);
        const [, value, stepper] = axis.children;
        const number = desc.property.axisValue(index);
        value.textContent = formatAxis(number, desc.params);
        stepper.hidden = !isActive;
        const input = stepper.querySelector(".mu-stepper-input");
        input.step = desc.params.step ?? "any";
        setValue(input, number);
      });
      el.classList.toggle("has-active", active !== null);
    },
  },

  slider: {
    label: "mu.control.slider",
    // A slider is meaningless without both ends, so it asks for them by
    // method and refuses a property that cannot answer.
    needs: ["setNumber", "min", "max"],
    params: {
      step: { type: "number" },
    },
    render(desc, onChange) {
      const wrap = document.createElement("div");
      wrap.className = "mu-prop-inline";
      const input = document.createElement("input");
      input.type = "range";
      input.className = "mu-prop-range";
      input.min = desc.property.min() ?? 0;
      input.max = desc.property.max() ?? 1;
      input.step = desc.params.step ?? 0.01;
      input.value = desc.value;
      const readout = document.createElement("span");
      readout.className = "mu-prop-readout";
      readout.textContent = desc.property.format();
      input.addEventListener("input", () => {
        onChange(Number(input.value));
        readout.textContent = desc.property.format();
      });
      wrap.append(input, readout);
      return wrap;
    },
    update(el, desc) {
      setValue(el.querySelector("input"), desc.value);
      el.querySelector(".mu-prop-readout").textContent = desc.property.format();
    },
  },

  checkbox: {
    label: "mu.control.checkbox",
    needs: ["toggle"],
    // `change`: what is done when it is switched (given { value }), for a value that is read and not written here.
    // (`port`: a value that is an element of a list is carried by its address; a checkbox has nothing to carry it by.)
    params: { change: { type: "action", payload: { value: "boolean" } }, port: { type: "data" } },
    render(desc, onChange) {
      const input = document.createElement("input");
      input.type = "checkbox";
      input.className = "mu-prop-check";
      input.checked = Boolean(desc.value);
      input.addEventListener("change", () => {
        if (desc.params && typeof desc.params.change === "function") desc.params.change({ value: input.checked });
        else onChange(input.checked);
      });
      return input;
    },
    update(el, desc) {
      if (el.checked !== Boolean(desc.value)) el.checked = Boolean(desc.value);
    },
  },

  // A boolean as one pressable icon: on it is filled and pressed, off it is
  // the outline. For a switch that belongs beside the thing it acts on
  // rather than in a table of its own -- re-rolling a seed sits next to the
  // seed, and a row saying "new seed every run" underneath the number said
  // the same thing twice as far apart as it could be put.
  icontoggle: {
    label: "mu.control.icontoggle",
    needs: ["toggle"],
    // `icon` is the look when it is off, `onIcon` when it is on -- the same
    // shape filled, usually. One icon for both is fine: pressed says it.
    params: ["icon", "onIcon", "title", "onTitle"],
    sampleParams: { icon: "dice-5", onIcon: "dice-5-fill" },
    render(desc, onChange) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "mu-item-button mu-icontoggle";
      button.append(Object.assign(document.createElement("i"), { className: "bi" }));
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        onChange(!button.classList.contains("is-active"));
      });
      BUILT_IN.icontoggle.update(button, desc);
      return button;
    },
    update(el, desc) {
      const on = Boolean(desc.value);
      const name = (on && desc.params.onIcon) || desc.params.icon || "toggle-on";
      const icon = `bi bi-${ICONS[name] || name}`;
      if (el.firstElementChild.className !== icon) el.firstElementChild.className = icon;
      const title = t((on && desc.params.onTitle) || desc.params.title || desc.label || "");
      if (el.title !== title) el.title = title;
      el.classList.toggle("is-active", on);
      el.setAttribute("aria-pressed", String(on));
    },
  },

  select: {
    label: "mu.control.select",
    needs: ["options"],
    // `change`: what is done when it is changed (given { value }), for a value that is read and not written here;
    // `port`: where the value stands when it is an element's field (the shell gives it).
    params: { change: { type: "action", payload: { value: "string" } }, port: { type: "data" } },
    render(desc, onChange) {
      const select = document.createElement("select");
      select.className = "select mu-prop-select";
      fillOptions(select, desc);
      select.value = desc.value;
      select.addEventListener("change", () => onChange(select.value));
      return select;
    },
    update(el, desc) {
      fillOptions(el, desc);
      setValue(el, desc.value);
    },
  },

  // A choice laid out as buttons rather than folded into a dropdown: every
  // option visible, the chosen one filled. Matched by method, so it works
  // with any value type that can list its options and take a write.
  segments: {
    label: "mu.control.segments",
    needs: ["set", "options"],
    // Which buttons say what they are, in words:
    //   "selected" -- only the chosen one (the rest are their icon alone)
    //   "all"      -- every one of them
    //   "none"     -- none, provided they all have an icon
    params: ["labels"],
    render(desc, onChange) {
      const el = document.createElement("div");
      el.className = "mu-segments";
      el.__onChange = onChange;
      BUILT_IN.segments.update(el, desc);
      return el;
    },
    update(el, desc) {
      const labels = desc.params.labels || "selected";
      diffChildren(el, desc.property.options(), (option) => option.value, {
        create: () => {
          const button = document.createElement("button");
          button.type = "button";
          button.className = "mu-segment";
          button.append(
            Object.assign(document.createElement("i"), { className: "bi" }),
            Object.assign(document.createElement("span"), { className: "mu-segment-label" })
          );
          button.addEventListener("click", (event) => {
            event.stopPropagation();
            el.__onChange(button.dataset.nodeKey);
          });
          return button;
        },
        update: (button, option) => {
          const chosen = String(option.value) === String(desc.value);
          const icon = option.icon ? `bi bi-${ICONS[option.icon] || option.icon}` : "bi";
          if (button.firstElementChild.className !== icon) {
            button.firstElementChild.className = icon;
          }
          button.firstElementChild.hidden = !option.icon;

          const label = button.lastElementChild;
          if (label.textContent !== option.label) label.textContent = option.label;
          // Without an icon there is nothing to shrink to, so the word stays
          // whatever `labels` says.
          const worded = !option.icon || labels === "all" || (labels === "selected" && chosen);
          label.hidden = !worded;

          button.classList.toggle("is-active", chosen);
          button.setAttribute("aria-pressed", String(chosen));
          button.title = option.label;
        },
      });
    },
  },

  // A choice of colour, as the colours. The option with no value is the
  // theme's own accent, drawn with a slash so it reads as "none chosen".
  swatches: {
    label: "mu.control.swatches",
    needs: ["set", "options"],
    render(desc, onChange) {
      const el = document.createElement("div");
      el.className = "mu-swatches";
      el.__onChange = onChange;
      BUILT_IN.swatches.update(el, desc);
      return el;
    },
    update(el, desc) {
      const current = desc.value || "";
      diffChildren(el, desc.property.options(), (option) => option.value || "default", {
        create: () => {
          const button = document.createElement("button");
          button.type = "button";
          button.className = "mu-swatch";
          button.addEventListener("click", (event) => {
            event.stopPropagation();
            el.__onChange(button.__value);
          });
          return button;
        },
        update: (button, option) => {
          const label = t(option.label);
          button.__value = option.value;
          button.title = label;
          button.setAttribute("aria-label", label);
          button.classList.toggle("is-default", !option.value);
          button.style.setProperty("--swatch", option.value || "var(--accent)");
          button.classList.toggle("is-active", option.value === current);
          button.setAttribute("aria-pressed", String(option.value === current));
        },
      });
    },
  },

  // Where an app's windows go when it is opened, as a picture of itself:
  // the frame, cut the way the app will be cut, each piece named for the
  // window that goes there. What can be done to the layout sits along the
  // top -- load a saved one, take the arrangement on screen now. Resetting
  // an app to its defaults is a labeled action in Window Settings.
  //
  // `tree` is the layout with every window already named:
  //   { dir, ratio, children: [a, b] }  or  { label, icon, collapsed, missing }
  layoutpreview: {
    // Draws as a card, and has no header to put a name in (see unnamedCardsIn).
    cardName: () => "",
    label: "mu.control.layoutpreview",
    standalone: true,
    // `links`: [{to, from, missing}] as text, listed under the panes.
    // `bare`: only the panes -- no header, frame or ground of its own, for
    // a card that is already all of that.
    // Typed, so a declaration can show a tree (a bay's sash, an app's layout).
    params: {
      tree: { type: "data", bind: "read" },
      note: { type: "label" },
      actions: { type: "data" },
      links: { type: "data" },
      linksTitle: { type: "label" },
      bare: { type: "boolean" },
    },
    sampleParams: {
      tree: {
        dir: "row",
        ratio: 0.3,
        children: [
          { label: "Run Settings", icon: "sliders" },
          { label: "Output Preview", icon: "image" },
        ],
      },
      actions: [],
    },
    render(desc) {
      const el = document.createElement("div");
      el.className = "mu-card mu-layoutcard";
      const head = Object.assign(document.createElement("div"), { className: "mu-card-head mu-card-bar mu-layoutcard-head" });
      const body = Object.assign(document.createElement("div"), { className: "mu-layoutcard-body" });
      const linked = Object.assign(document.createElement("div"), { className: "mu-layoutcard-links" });
      el.append(head, body, linked);
      BUILT_IN.layoutpreview.update(el, desc);
      return el;
    },
    update(el, desc) {
      const p = desc.params;
      const [head, body, linked] = el.children;
      const actions = p.actions || [];
      el.classList.toggle("is-bare", Boolean(p.bare));
      // The buttons, then what the layout is -- the app's own, or chosen.
      if (head.children.length !== actions.length + 2) {
        head.replaceChildren(
          ...actions.map(() => {
            const button = document.createElement("button");
            button.type = "button";
            button.className = "mu-icon-button";
            button.append(document.createElement("i"));
            return button;
          }),
          Object.assign(document.createElement("span"), { className: "mu-card-gap" }),
          // What the layout is -- the card's name, as a card's title is.
          Object.assign(document.createElement("span"), { className: "mu-layoutcard-note mu-card-title" })
        );
      }
      actions.forEach((one, index) => {
        const button = head.children[index];
        const icon = `bi bi-${ICONS[one.icon] || one.icon}`;
        if (button.firstElementChild.className !== icon) button.firstElementChild.className = icon;
        button.title = one.title;
        button.disabled = Boolean(one.disabled);
        button.onclick = (event) => {
          event.stopPropagation();
          one.run();
        };
      });
      const note = head.lastElementChild;
      if (note.textContent !== (p.note || "")) note.textContent = p.note || "";

      // Rebuilt: a small tree, and nothing in it is typed into.
      //
      // Whether everything under a node is minimised -- the shell's own
      // rule: a split of two bars is sized as a bar, not given a share.
      const shut = (node) => (node.children ? node.children.every(shut) : Boolean(node.collapsed));
      const draw = (node, bar = "") => {
        if (node.children) {
          const box = document.createElement("div");
          box.className = `mu-layoutcard-split is-${node.dir === "col" ? "col" : "row"}`;
          const [a, b] = node.children;
          const ratio = Number(node.ratio) > 0 && Number(node.ratio) < 1 ? Number(node.ratio) : 0.5;
          // A minimised window is a bar, the way the shell draws one: as
          // thin as a title bar across the seam, lying along it -- upright
          // in a row, flat in a column -- and the other side takes the rest.
          const along = node.dir === "col" ? "is-bar-h" : "is-bar-v";
          const closed = [shut(a), shut(b)];
          const either = closed[0] !== closed[1];
          const [first, second] = [a, b].map((child, index) => {
            const part = draw(child, closed[index] ? along : "");
            // Beside a bar, the other side is everything that is left --
            // its ratio was a share of room the bar no longer takes. Two
            // bars side by side are each as thin as a bar.
            part.style.flex = closed[index] ? "0 0 auto" : either ? "1 1 0" : `${index ? 1 - ratio : ratio} 1 0`;
            return part;
          });
          box.append(first, second);
          return box;
        }
        const pane = document.createElement("div");
        // An icon over its name -- or beside it, where the pane is too low
        // for two lines (a container query on the pane, see the CSS).
        const face = (icon, label, className = "mu-layoutcard-face") => {
          const el = Object.assign(document.createElement("div"), { className });
          el.append(
            Object.assign(document.createElement("i"), { className: `bi bi-${ICONS[icon] || icon}` }),
            Object.assign(document.createElement("span"), { textContent: label })
          );
          return el;
        };
        // A bay: a pane like any other -- its icon and name -- with, under
        // them, the windows its sashes hold in a frame of their own, one
        // to a line: one shows at a time, so they are not drawn side by
        // side, which would read as a group.
        if (node.bay) {
          pane.className = `mu-layoutcard-pane mu-layoutcard-bay${node.collapsed ? ` is-collapsed ${bar || "is-bar-h"}` : ""}`;
          pane.title = node.bay.label;
          const inside = Object.assign(document.createElement("div"), { className: "mu-layoutcard-bay-items" });
          for (const one of node.bay.items || []) {
            const line = face(one.icon, one.label, `mu-layoutcard-bay-item${one.missing ? " is-missing" : ""}`);
            inside.append(line);
          }
          pane.append(face(ICONS.bay || "window-stack", node.bay.label), inside);
          inside.hidden = !inside.children.length;
          return pane;
        }
        pane.className = `mu-layoutcard-pane${node.missing ? " is-missing" : ""}${
          node.collapsed ? ` is-collapsed ${bar || "is-bar-h"}` : ""
        }`;
        pane.title = node.collapsed ? t("mu.value.paneCollapsed", { name: node.label }) : node.label;
        pane.append(face(node.icon, node.label));
        return pane;
      };
      body.replaceChildren(p.tree ? draw(p.tree) : document.createTextNode(""));

      // Which window follows which: one line per link, the follower first.
      const list = Array.isArray(p.links) ? p.links : [];
      linked.hidden = !list.length;
      linked.replaceChildren(
        ...(list.length ? [Object.assign(document.createElement("div"), { className: "mu-layoutcard-links-title", textContent: p.linksTitle || "" })] : []),
        ...list.map((one) => {
          const line = document.createElement("div");
          line.className = `mu-layoutcard-link${one.missing ? " is-missing" : ""}`;
          line.append(
            Object.assign(document.createElement("i"), { className: `bi bi-${ICONS.link || "link-45deg"}` }),
            Object.assign(document.createElement("span"), { textContent: `${one.to} ← ${one.from}` })
          );
          return line;
        })
      );
    },
  },

  // A piece of text as a card of its own: a grip on the left to carry it
  // somewhere (see ports in core.js), copy and the one-line/full toggle on
  // the right, the text underneath. Small on purpose -- it is where a
  // result is put and read, not where it is worked on: that is done in an
  // app made for it, and what lands here is linked to or pasted from there.
  //
  // Linked, it says what it follows and stops taking typing; what it shows
  // is that other text, kept up to date by the shell. A read-only value --
  // an output -- has the grip and nothing to put into it.
  texteditor: {
    // Draws as a card, named in its header only as an entry of a list (see unnamedCardsIn).
    cardName: (desc) => desc.head || "",
    label: "mu.control.texteditor",
    nestedNodes: true,
    declarationSlotNames: ["lead", "tools", "body", "bars"],
    declarationToolAnchors: ["copy", "keep"],
    declarationSupportsViews: true,
    // A card whose name goes in its header when it is an entry of a list, and
    // outside it, as a row's label, when it is a field of a dict or a
    // property (see paintPropRow).
    cardCaption: true,
    needs: ["setText"],
    deferRefresh: 250,
    // `lines`: how tall the text starts, for a field that holds a few
    // words rather than a paragraph.
    // `bare`: the text only, with no card round it (it stands in a card that already is one).
    // `features`: what of an editor the card has around it -- some of
    // TEXTCARD_FEATURES (see textfeatures.js), fixed when the card is made --
    // with `options` (how it is shown; bound with `binds`, written back with desc.set),
    // `scrollKey` (where its scroll is remembered across redraws) and `fill`
    // (take the height it is given rather than growing with the text).
    // Typed (see the declarative design): `options` is the one written back
    // (desc.set("options", ...)), kept wherever the placer binds it.
    params: {
      placeholder: { type: "label" },
      full: { type: "boolean" },
      onFull: { type: "action" },
      port: { type: "data" },
      onDiscard: { type: "action" },
      onKeep: { type: "action" },
      lines: { type: "number" },
      bare: { type: "boolean" },
      features: { type: "data" },
      options: { type: "data", bind: "readwrite", state: true },
      view: { type: "string", bind: "readwrite", state: true },
      scrollKey: { type: "string" },
      fill: { type: "boolean" },
    },
    // What a placer of the features needs to know: the options and their
    // defaults, and the range of the size.
    textcard: { features: TEXTCARD_FEATURES, defaults: TEXTCARD_DEFAULTS, zoomMin: ZOOM_MIN, zoomMax: ZOOM_MAX },
    render(desc, onChange) {
      const el = document.createElement("div");
      el.className = "mu-card mu-textcard";
      const button = (className, iconName) => {
        const one = Object.assign(document.createElement("button"), { type: "button", className: `mu-icon-button ${className}` });
        one.append(Object.assign(document.createElement("i"), { className: `bi bi-${ICONS[iconName] || iconName}` }));
        return one;
      };
      const copy = button("mu-textcard-copy", "copy");
      copy.addEventListener("click", (event) => {
        event.stopPropagation();
        navigator.clipboard.writeText(el.__text || "").catch(() => {});
      });
      // Keep as a preset: only where whoever placed it says how.
      const keep = button("mu-card-keep", "preset");
      keep.append(Object.assign(document.createElement("i"), { className: `bi bi-${ICONS.presetSave || "plus"} mu-icon-badge` }));
      keep.addEventListener("click", (event) => {
        event.stopPropagation();
        if (el.__keep) el.__keep();
      });
      // Remove is only where the card can be thrown away from (a scratch
      // board).
      const parts = buildCardHead("mu-textcard", { tools: [copy, keep], onDiscard: () => el.__discard && el.__discard() });
      const head = parts.head;
      el.__parts = { ...parts, copy, keep };

      const area = document.createElement("textarea");
      area.className = "input mu-textcard-input";
      area.spellcheck = false;
      area.addEventListener("input", () => {
        if (!area.readOnly) onChange(area.value);
      });
      // One line is drawn as a line, not as a textarea one row high: a
      // textarea cannot end in an ellipsis, so a long prompt just looked
      // cut off. Pressing it opens the whole text again.
      const line = Object.assign(document.createElement("div"), { className: "mu-textcard-line" });
      line.addEventListener("click", (event) => {
        event.stopPropagation();
        el.querySelector(".mu-textcard-size").click();
      });
      el.append(head, area, line);
      // Kept, not found by position: a card made of this one may put a bar of
      // its own between the head and the text (see cardBar).
      Object.assign(el.__parts, { area, line });
      const features = desc.params.features ?? desc.control?.textcard?.defaultFeatures;
      if (Array.isArray(features) && features.length) {
        buildFeatures(el, features, desc, { slots: BUILT_IN.texteditor.slots(el), bar: cardBar, barRow: cardBarRow });
      }
      BUILT_IN.texteditor.update(el, desc);
      return el;
    },
    // Where a card made from this one (`extends: "texteditor"`) puts what it
    // adds, by name rather than by reaching into the card's DOM: `area`, the
    // text itself; `lead(node)`, a primary button first in the header, before
    // the name; `body(...nodes)`, what goes under the text (panels, a status
    // line, another view of it); `fit()`, the header measured again once what
    // it holds has changed. The card bar is the shell's for every card
    // (fw.card.bar / barRow).
    slots(el) {
      const { head, label, area, size, copy, keep } = el.__parts;
      return {
        area,
        lead: (node) => head.insertBefore(node, label),
        tools: (node, after) => {
          const anchor = after === "copy" ? copy : after === "keep" ? keep : null;
          if (anchor) {
            node.dataset.afterCardTool = after;
            anchor.after(node);
          } else head.insertBefore(node, size);
        },
        body: (...nodes) => el.append(...nodes),
        fit: () => fitCardHead(head),
      };
    },
    update(el, desc) {
      const p = desc.params;
      const { head, area, line, copy, keep } = el.__parts;
      keep.hidden = !p.onKeep;
      keep.title = t("mu.action.keepAsPreset");
      el.__keep = p.onKeep || null;
      el.__discard = p.onDiscard || null;
      const port = cardPortOf(desc);

      // A value that is not text itself but reads as text (an ABC score kept as
      // a header and its sections) is shown as what it reads as.
      const text =
        typeof desc.value !== "string" && desc.property && typeof desc.property.text === "function"
          ? String(desc.property.text() ?? "")
          : String(desc.value ?? "");
      el.__text = text;

      // One line, or all of it. The params' when the host keeps it; the
      // saved layout's otherwise, by address, so it survives a restart.
      const address = port
        ? portKey(port)
        : desc.key;
      const where = `textcard:${address}`;
      const full = p.bare ? true : typeof p.full === "boolean" ? p.full : !cardIsShrunk(where);
      el.classList.toggle("is-bare-text", Boolean(p.bare));
      const hadSize = typeof el.__textCardFull === "boolean";
      const following = syncCardHead(el, el.__parts, {
        port,
        name: desc.head,
        onDiscard: p.onDiscard,
        size: {
          full,
          title: t(full ? "mu.action.oneLine" : "mu.action.showAll"),
          toggle: () => {
            if (p.onFull) return p.onFull(!full);
            setCardShrunk(where, full);
            BUILT_IN.texteditor.update(el, desc);
          },
        },
      });
      // Nothing to type into: an output, or text that follows another.
      // A link is a copy that is made again at every change, so what is typed in it would be lost; a
      // share is the very property it shares, so it is typed in unless that one cannot be.
      const frozen = Boolean(following) && (!following.share || !(port && (portInfo(port) || {}).writable));
      const fixed = Boolean(desc.readonly || (p.read && !p.write) || frozen);
      area.readOnly = fixed;
      el.classList.toggle("is-fixed", fixed);
      area.placeholder = p.placeholder ? t(p.placeholder) : "";
      const tall = Number(p.lines) > 0 ? `${Number(p.lines)}lh` : "";
      if (area.style.minHeight !== tall) area.style.minHeight = tall;
      setValue(area, text);
      copy.title = t("mu.action.copy");
      copy.disabled = !text;

      if (hadSize) setCardSizeClass(el, !full, "is-oneline");
      else el.classList.toggle("is-oneline", !full);
      el.__textCardFull = full;
      fitCardHead(head);
      const selected = p.viewNodes?.find((view) => view.key === p.view) ?? p.viewNodes?.[0];
      const alternate = Boolean(selected?.layout) && Boolean(desc.renderNodes);
      el.classList.toggle("is-alternate-view", alternate);
      area.hidden = !full || alternate;
      line.hidden = full;
      // The whole text on one line: line breaks read as spaces here.
      const one = text.replace(/\s*\n\s*/g, " ");
      line.textContent = one || (p.placeholder ? t(p.placeholder) : "");
      line.classList.toggle("is-empty", !one);
      line.title = t("mu.action.showAll");
      if (el.__tx) updateFeatures(el, desc);
      paintTextCardViews(el, desc, selected, full);
      paintTextCardSlots(el, desc, full);
    },
  },

  // A list of checks: a state, a name, a sentence, and a hint that opens
  // what it found. The shape every "is the server there" section takes --
  // ComfyUI's for a run, Ollama's for asking a model -- so they read alike.
  // Asking again is the section's button, not this element's: it acts on
  // the whole list, not on any one row.
  //
  //   checks: [{key, label, state: ok|warn|error|checking, summary, detail}]
  // A list of pictures as an input: the pictures as tiles -- each with a
  // grip of its own that carries it as a picture, and its remove -- and the
  // way to more: upload (several at once), or files dropped on the list.
  // The list's own grip, in its header, carries all of them as a list.
  // Anything that is a list of pictures (`imagelist`) is edited with this.
  imagelistinput: {
    // Draws as a card, and has no header to put a name in (see unnamedCardsIn).
    cardName: () => "",
    label: "mu.control.imagelistinput",
    needs: ["items", "set"],
    params: ["port"],
    sampleParams: {},
    render(desc) {
      const grid = Object.assign(document.createElement("div"), { className: "mu-imagelist" });
      const wrap = listCard(grid, { key: `imagelist:${desc.key || ""}` });
      const head = wrap.firstElementChild;
      const upload = Object.assign(document.createElement("button"), { type: "button", className: "mu-icon-button is-primary mu-imagelist-upload" });
      upload.append(
        Object.assign(document.createElement("i"), { className: `bi bi-${ICONS.upload || "upload"}` }),
        Object.assign(document.createElement("span"), { className: "mu-button-label" })
      );
      head.insertBefore(upload, head.querySelector(":scope > .mu-card-gap"));
      const file = Object.assign(document.createElement("input"), { type: "file", accept: "image/*", multiple: true, hidden: true });
      wrap.append(file);
      const empty = Object.assign(document.createElement("div"), { className: "mu-imagelist-empty" });
      grid.append(empty);

      const take = async (files) => {
        const current = wrap.__desc;
        const added = [];
        for (const chosen of Array.from(files || [])) {
          if (!chosen || !/^image\//.test(chosen.type)) continue;
          const dataUrl = await new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result));
            reader.onerror = () => resolve("");
            reader.readAsDataURL(chosen);
          });
          if (!dataUrl) continue;
          const kept =
            current.api && current.api.store && current.api.store.keepFile ? await current.api.store.keepFile(dataUrl).catch(() => dataUrl) : dataUrl;
          added.push({ id: `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, src: kept });
        }
        if (added.length) current.property.set([...current.property.items(), ...added]);
      };
      upload.addEventListener("click", (event) => {
        event.stopPropagation();
        file.click();
      });
      file.addEventListener("change", () => {
        take(file.files);
        file.value = "";
      });
      grid.addEventListener("dragover", (event) => {
        if (event.dataTransfer && [...event.dataTransfer.types].includes("Files")) event.preventDefault();
      });
      grid.addEventListener("drop", (event) => {
        const files = event.dataTransfer && event.dataTransfer.files;
        if (!files || !files.length) return;
        event.preventDefault();
        take(files);
      });
      wrap.__parts = { grid, upload, empty, tiles: new Map() };
      BUILT_IN.imagelistinput.update(wrap, desc);
      return wrap;
    },
    update(wrap, desc) {
      wrap.__desc = desc;
      const { grid, upload, empty, tiles } = wrap.__parts;
      const items = desc.property.items();
      const item = desc.property && desc.property.item;
      const base = desc.params.port || (item ? { item: item.id, key: desc.property.key } : null);
      const readonly = Boolean(desc.readonly);
      attachPort(wrap, wrap.__grip, base);
      wrap.__grip.title = t("mu.port.grip");
      upload.hidden = readonly;
      upload.lastElementChild.textContent = t("mu.action.addPictures");
      upload.title = t("mu.action.addPicturesTitle");
      empty.textContent = t("mu.value.noPictures");
      empty.hidden = items.length > 0;

      const keep = new Set();
      const nodes = items.map((one) => {
        keep.add(one.id);
        let tile = tiles.get(one.id);
        if (!tile) {
          const box = Object.assign(document.createElement("div"), { className: "mu-imagelist-tile" });
          const img = Object.assign(document.createElement("img"), { alt: "", draggable: false });
          const grip = Object.assign(document.createElement("button"), { type: "button", className: "mu-icon-button mu-port-grip mu-imagelist-grip" });
          grip.append(Object.assign(document.createElement("i"), { className: "bi bi-grip-vertical" }));
          const remove = Object.assign(document.createElement("button"), { type: "button", className: "mu-icon-button mu-imagelist-remove" });
          remove.append(Object.assign(document.createElement("i"), { className: `bi bi-${ICONS.close || "x"}` }));
          box.append(img, grip, remove);
          tile = { box, img, grip, remove, id: one.id };
          tiles.set(one.id, tile);
        }
        if (tile.img.getAttribute("src") !== one.src) tile.img.setAttribute("src", one.src);
        attachPort(tile.box, tile.grip, base ? { ...base, path: [...(base.path || []), one.id] } : null);
        tile.grip.title = t("mu.port.grip");
        tile.remove.hidden = readonly;
        tile.remove.title = t("mu.action.discard");
        tile.remove.onclick = (event) => {
          event.stopPropagation();
          // What is linked would be written back at the next redraw, so
          // taking a picture out stops the following first.
          if (base && portLink(base)) unlinkPort(base);
          wrap.__desc.property.set(wrap.__desc.property.items().filter((other) => other.id !== one.id));
        };
        return tile.box;
      });
      for (const id of [...tiles.keys()]) if (!keep.has(id)) tiles.delete(id);
      const wanted = [...nodes, empty];
      const settled = grid.childNodes.length === wanted.length && wanted.every((node, i) => grid.childNodes[i] === node);
      if (!settled) grid.replaceChildren(...wanted);
      fitCardHead(wrap.firstElementChild);
    },
  },

  // An icon, as a card: the icon and its name, and "choose" -- the icon
  // picker, one step along the window, writes the one chosen back here.
  // Its header runs down its left side, the grip and "choose", which is
  // only ever its icon there; what the icon is for is said outside it, by
  // the row it sits in.
  iconcard: {
    label: "mu.control.iconcard",
    sampleParams: {},
    render(desc) {
      const card = document.createElement("div");
      card.className = "mu-iconcard";
      const head = Object.assign(document.createElement("div"), { className: "mu-iconcard-head" });
      const grip = Object.assign(document.createElement("button"), { type: "button", className: "mu-icon-button mu-port-grip", disabled: true });
      grip.append(Object.assign(document.createElement("i"), { className: "bi bi-grip-vertical" }));
      const choose = Object.assign(document.createElement("button"), { type: "button", className: "mu-icon-button is-primary" });
      choose.append(Object.assign(document.createElement("i"), { className: "bi bi-hand-index" }));
      head.append(grip, choose);
      const body = Object.assign(document.createElement("div"), { className: "mu-iconcard-body" });
      body.append(Object.assign(document.createElement("i"), { className: "bi" }), Object.assign(document.createElement("span"), { className: "mu-iconcard-name" }));
      card.append(head, body);
      choose.addEventListener("click", (event) => {
        event.stopPropagation();
        openIconPicker(card.__desc, choose);
      });
      BUILT_IN.iconcard.update(card, desc);
      return card;
    },
    update(card, desc) {
      card.__desc = desc;
      const [head, body] = card.children;
      const choose = head.lastElementChild;
      choose.title = t("mu.action.choose");
      choose.setAttribute("aria-label", desc.label ? `${desc.label} · ${t("mu.action.choose")}` : t("mu.action.choose"));
      const value = typeof desc.value === "string" ? desc.value : "";
      const glyph = `bi bi-${ICONS[value] || value || "question-square"}`;
      if (body.firstElementChild.className !== glyph) body.firstElementChild.className = glyph;
      body.lastElementChild.textContent = value || t("mu.value.noIcon");
    },
  },

  checklist: {
    label: "mu.control.checklist",
    standalone: true,
    params: ["checks"],
    sampleParams: {
      checks: [{ key: "server", label: "Connection", state: "ok", summary: "Connected", detail: "" }],
    },
    render(desc) {
      const el = document.createElement("ul");
      el.className = "mu-checklist";
      BUILT_IN.checklist.update(el, desc);
      return el;
    },
    update(list, desc) {
      const STATES = {
        ok: "check-circle-fill",
        warn: "exclamation-triangle-fill",
        error: "x-octagon-fill",
        checking: "hourglass-split",
      };
      const checks = desc.params.checks || [];
      // Keyed, so that a hint somebody opened stays open while the state
      // behind it changes -- which is exactly when it is being read.
      const existing = new Map();
      for (const li of Array.from(list.children)) existing.set(li.dataset.check, li);
      const kept = new Set();
      let cursor = list.firstElementChild;
      for (const check of checks) {
        let li = existing.get(check.key);
        if (!li) {
          li = document.createElement("li");
          li.dataset.check = check.key;
          li.append(
            Object.assign(document.createElement("i"), { className: "bi" }),
            Object.assign(document.createElement("span"), { className: "mu-checklist-name" }),
            Object.assign(document.createElement("span"), { className: "mu-checklist-said" }),
            hintButton()
          );
        }
        const [icon, name, said, hint] = li.children;
        li.dataset.state = check.state;
        const wanted = `bi bi-${STATES[check.state] || STATES.checking}`;
        if (icon.className !== wanted) icon.className = wanted;
        if (name.textContent !== check.label) name.textContent = check.label;
        if (said.textContent !== check.summary) said.textContent = check.summary;
        // Nothing more to say, nothing to press.
        hint.setHint(check.detail || "", t("mu.checklist.hint", { name: check.label }));
        kept.add(check.key);
        if (li === cursor) cursor = cursor.nextElementSibling;
        else list.insertBefore(li, cursor);
      }
      existing.forEach((li, key) => {
        if (!kept.has(key)) li.remove();
      });
    },
  },

  swatch: {
    label: "mu.control.swatch",
    needs: ["setText"],
    render(desc, onChange) {
      const wrap = document.createElement("div");
      wrap.className = "mu-prop-inline";
      const input = document.createElement("input");
      input.type = "color";
      input.className = "mu-prop-color";
      input.value = desc.value;
      const readout = document.createElement("span");
      readout.className = "mu-prop-readout";
      readout.textContent = desc.value;
      input.addEventListener("input", () => {
        readout.textContent = input.value;
        onChange(input.value);
      });
      wrap.append(input, readout);
      return wrap;
    },
    update(el, desc) {
      setValue(el.querySelector("input"), desc.value);
      el.querySelector(".mu-prop-readout").textContent = String(desc.value);
    },
  },

  // A picture from a URL, and nothing to edit. Standalone, because what it
  // shows is worked out by whoever places it -- an image property's url(),
  // a path's file -- and a URL is not a value anybody authored.
  //
  // `fill` takes the height the section was given, the way a textarea told
  // to fill does; `fit` is "contain" (the whole picture, scaled down) or
  // "actual" (its own pixels, scrolled). Both are presentation, so they are
  // the placer's to say.
  imageview: {
    label: "mu.control.imageview",
    standalone: true,
    params: ["src", "alt", "fill", "fit"],
    sampleParams: { src: "", alt: "" },
    render(desc) {
      const el = document.createElement("div");
      el.className = "mu-imageview";
      const img = document.createElement("img");
      img.className = "mu-imageview-img";
      img.draggable = false;
      const note = document.createElement("div");
      note.className = "mu-imageview-note";
      img.addEventListener("load", () => {
        note.textContent = `${img.naturalWidth} × ${img.naturalHeight}`;
        el.classList.remove("is-broken");
      });
      img.addEventListener("error", () => {
        if (!img.getAttribute("src")) return;
        note.textContent = t("mu.value.imageFailed");
        el.classList.add("is-broken");
      });
      el.append(img, note);
      BUILT_IN.imageview.update(el, desc);
      return el;
    },
    update(el, desc) {
      const [img, note] = el.children;
      const src = desc.params.src || "";
      // Compared as written, not as resolved: img.src is absolute, and
      // setting it again would fetch the picture again on every redraw.
      if (img.getAttribute("src") !== src) {
        note.textContent = src ? t("mu.value.loading") : t("mu.value.noImage");
        el.classList.remove("is-broken");
        if (src) img.setAttribute("src", src);
        else img.removeAttribute("src");
      }
      img.hidden = !src;
      img.alt = desc.params.alt || "";
      el.classList.toggle("is-filling", Boolean(desc.params.fill));
      el.dataset.fit = desc.params.fit === "actual" ? "actual" : "contain";
    },
  },

  // An image property: the picture itself, and a way to put one in. The
  // file picker reads the file here, in the browser, into the value -- the
  // picture is data, so taking one needs no filesystem permission and the
  // file can be gone afterwards. Too large a picture is refused with a
  // note rather than written and then refused by the library.
  //
  // Laid out the way promptmanager's image blocks are: with nothing in it,
  // one dashed button across the whole width that says what it does; with
  // a picture, the picture itself, with a round button to take it away
  // that shows when the pointer is over it. A file dropped anywhere on it
  // is taken the same as one picked.
  //
  // `compact` is the one-line form, for a property table: a small button,
  // a thumbnail and the note, side by side.
  imagebox: {
    label: "mu.control.imagebox",
    needs: ["setSrc", "clear", "facts", "maxBytes"],
    params: ["maxBytes", "compact"],
    render(desc, onChange) {
      const wrap = document.createElement("div");
      wrap.className = "mu-imagebox";

      const file = document.createElement("input");
      file.type = "file";
      file.accept = "image/*";
      file.hidden = true;

      const drop = document.createElement("button");
      drop.type = "button";
      drop.className = "mu-imagebox-drop";
      drop.append(
        Object.assign(document.createElement("i"), { className: "bi bi-upload" }),
        Object.assign(document.createElement("span"), { className: "mu-imagebox-drop-label" })
      );
      drop.addEventListener("click", (event) => {
        event.stopPropagation();
        file.click();
      });

      const preview = document.createElement("div");
      preview.className = "mu-imagebox-preview";
      const img = document.createElement("img");
      img.className = "mu-imagebox-img";
      img.draggable = false;
      const clear = document.createElement("button");
      clear.type = "button";
      clear.className = "mu-round-btn is-danger mu-imagebox-clear";
      clear.title = t("mu.action.clearImage");
      clear.setAttribute("aria-label", t("mu.action.clearImage"));
      clear.append(Object.assign(document.createElement("i"), { className: "bi bi-x-lg" }));
      clear.addEventListener("click", (event) => {
        event.stopPropagation();
        onChange("");
      });
      preview.append(img, clear);

      const note = document.createElement("span");
      note.className = "mu-imagebox-note";

      const hold = (text) => {
        note.textContent = text;
        wrap.__noteHeld = true;
      };
      const take = async (chosen) => {
        if (!chosen) return;
        // Read off the element: the descriptor this was rendered with may be
        // many redraws old by the time a file is chosen.
        const limit = wrap.__maxBytes;
        if (limit && chosen.size > limit) {
          return hold(t("mu.value.imageTooLarge", { size: formatBytes(chosen.size), max: formatBytes(limit) }));
        }
        if (chosen.type && !chosen.type.startsWith("image/")) {
          return hold(t("mu.value.notAnImage", { name: chosen.name }));
        }
        try {
          wrap.__noteHeld = false;
          onChange(await blobToDataUrl(chosen, chosen.name));
        } catch (error) {
          hold(error.message || String(error));
        }
      };
      file.addEventListener("change", () => {
        const chosen = file.files && file.files[0];
        file.value = "";
        take(chosen);
      });

      // Files only: a window's handle being dragged across is text, and is
      // the layout's business, not this box's.
      const carriesFile = (event) =>
        Boolean(event.dataTransfer && [...event.dataTransfer.types].includes("Files"));
      wrap.addEventListener("dragover", (event) => {
        if (!carriesFile(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
        wrap.classList.add("is-dragover");
      });
      wrap.addEventListener("dragleave", () => wrap.classList.remove("is-dragover"));
      wrap.addEventListener("drop", (event) => {
        if (!carriesFile(event)) return;
        event.preventDefault();
        wrap.classList.remove("is-dragover");
        take(event.dataTransfer.files[0]);
      });

      wrap.append(drop, preview, note, file);
      BUILT_IN.imagebox.update(wrap, desc);
      return wrap;
    },
    update(el, desc) {
      const src = desc.property.src ? desc.property.src() : desc.value || "";
      const facts = desc.property.facts();
      const compact = Boolean(desc.params.compact);
      el.__maxBytes = desc.property.maxBytes();
      el.classList.toggle("is-compact", compact);
      el.classList.toggle("has-image", Boolean(src));

      const label = el.querySelector(".mu-imagebox-drop-label");
      const wanted = t(compact ? "mu.action.pickImage" : "mu.action.uploadImage");
      if (label.textContent !== wanted) label.textContent = wanted;

      const img = el.querySelector(".mu-imagebox-img");
      // Compared as written: img.src is absolute, and setting it again would
      // decode the picture again on every redraw.
      if (img.getAttribute("src") !== src) {
        // Said while it arrives: a picture put back from the history or a
        // preset can take a while, and an old one sitting there meanwhile
        // looks like nothing happened.
        loadingWhile(img.parentElement, img, Boolean(src));
        if (src) img.setAttribute("src", src);
        else img.removeAttribute("src");
      }

      const note = el.querySelector(".mu-imagebox-note");
      // A refusal stays until something else happens to the value.
      if (el.__noteHeld && el.__lastSrc === src) return;
      el.__noteHeld = false;
      el.__lastSrc = src;
      const text = facts ? describeImage(facts) : compact ? t("mu.value.noImage") : "";
      if (note.textContent !== text) note.textContent = text;
    },
  },

  // What a run made, the way promptmanager shows it: a dark stage, and on
  // it a canvas the shape of the output -- the size the run was asked for
  // until there is a picture, then the picture's own -- over a checkerboard,
  // so what a background removal took away shows as missing rather than as
  // white. Nothing there yet, it says what will be, and how big. Several
  // pictures share the stage as a grid; one clicked fills it, and the round
  // buttons in the corner go back to the grid or open it in a tab.
  //
  // It owns its DOM because fitting the canvas is a measurement: the stage
  // is watched, and the canvas redrawn to the largest box of that shape
  // that fits whenever the stage changes size.
  //
  // `emptyAction` is a button in the middle of the empty canvas -- what
  // makes something to show, promptmanager's way -- and `onClear` puts a
  // round close button in the corner of what is shown, to take it away
  // again. Both are read off the descriptor when pressed, so a redraw that
  // changes nothing on screen still hands them the latest closure.
  imagestage: {
    label: "mu.control.imagestage",
    standalone: true,
    // `overlay` is a second picture of the same shape for the one picture
    // shown: laid over it while the round layers button is on (a panorama's
    // depth map over the panorama, say), instead of a second picture beside.
    params: ["images", "overlay", "width", "height", "showSize", "empty", "busy", "fill", "emptyAction", "onClear", "clearTitle", "onKeep", "keepTitle", "keepAll", "bare"],
    sampleParams: { images: [], width: 1024, height: 1024 },

    mount(host, desc) {
      host.classList.add("mu-imagestage");
      const canvas = document.createElement("div");
      canvas.className = "mu-imagestage-canvas";
      const actions = document.createElement("div");
      actions.className = "mu-imagestage-actions";
      host.append(canvas, actions);

      const state = { desc, zoom: null, natural: null, key: "" };
      host.__stage = state;
      state.fit = () => {
        const p = state.desc.params;
        const grid = state.images.length > 1 && state.zoom === null;
        if (grid) {
          canvas.style.width = "100%";
          canvas.style.height = "100%";
          return;
        }
        const [w, h] = state.natural || [Number(p.width) || 1024, Number(p.height) || 1024];
        // The room inside the stage's border, not its outside: measured by
        // the bounding box, the canvas came out a border wider and taller
        // than the stage and stuck out past it by a pixel.
        const room = { width: host.clientWidth, height: host.clientHeight };
        // Not laid out yet: guessing from zero would write a 1px canvas and
        // make it jump on the next redraw. The observer calls again.
        if (room.width <= 0 || room.height <= 0) return;
        const ratio = w / h;
        const wide = room.width / room.height > ratio;
        canvas.style.width = `${wide ? room.height * ratio : room.width}px`;
        canvas.style.height = `${wide ? room.height : room.width / ratio}px`;
      };
      state.observer = new ResizeObserver(() => state.fit());
      state.observer.observe(host);
      BUILT_IN.imagestage.update(host, desc);
    },

    update(host, desc) {
      const state = host.__stage;
      if (!state) return;
      state.desc = desc;
      const p = desc.params;
      const images = (Array.isArray(p.images) ? p.images : []).filter(Boolean);
      if (state.zoom !== null && state.zoom >= images.length) state.zoom = null;
      host.classList.toggle("is-filling", Boolean(p.fill));

      // Redrawn only when something it shows changed: an item refreshes on
      // every edit anywhere, and rebuilding the pictures each time would
      // make them flicker as they are decoded again.
      const act = p.emptyAction || null;
      const overlay = typeof p.overlay === "string" ? p.overlay : "";
      const key = JSON.stringify([
        images, overlay, Boolean(state.overlayOn), state.zoom, p.width, p.height, p.showSize, p.empty, p.busy,
        act && [act.label, act.title, Boolean(act.disabled)], Boolean(p.onClear), p.clearTitle, Boolean(p.onKeep), p.keepTitle, Boolean(p.keepAll), Boolean(p.bare),
      ]);
      if (key === state.key) return;
      if (JSON.stringify(images) !== JSON.stringify(state.images || [])) state.natural = null;
      state.key = key;
      state.images = images;

      const [canvas, actions] = host.children;
      canvas.replaceChildren();
      actions.replaceChildren();
      host.classList.toggle("has-results", images.length > 0);
      host.classList.toggle("is-busy", Boolean(p.busy));

      const shown = state.zoom !== null ? [images[state.zoom]] : images;
      if (images.length) {
        const grid = document.createElement("div");
        grid.className = shown.length > 1 ? "mu-imagestage-results is-grid" : "mu-imagestage-results";
        shown.forEach((src, index) => {
          // A video on its own sits in a plain box: its controls are
          // buttons, and a button cannot hold buttons.
          const cell = document.createElement(shown.length === 1 && isVideoSrc(src) ? "div" : "button");
          if (cell.tagName === "BUTTON") cell.type = "button";
          cell.className = "mu-imagestage-result";
          // A video is drawn as one: playing, looping, silent -- what a
          // run made is looked at over and over while deciding whether to
          // keep it. Controls only when it fills the stage; in a grid a
          // click is what zooms, and the controls would take it.
          const video = isVideoSrc(src);
          const img = document.createElement(video ? "video" : "img");
          loadingWhile(cell, img, true, video ? "loadeddata" : "load");
          img.src = src;
          if (video) {
            Object.assign(img, { autoplay: true, loop: true, muted: true, playsInline: true, controls: shown.length === 1 });
          } else {
            img.alt = "";
            img.decoding = "async";
          }
          img.draggable = false;
          // One picture sets the canvas to its own shape once it is known.
          if (shown.length === 1) {
            img.addEventListener(video ? "loadedmetadata" : "load", () => {
              state.natural = video ? [img.videoWidth, img.videoHeight] : [img.naturalWidth, img.naturalHeight];
              state.fit();
            });
          }
          cell.append(img);
          if (overlay && shown.length === 1 && !video) {
            const over = document.createElement("img");
            over.className = "mu-imagestage-overlay";
            over.src = overlay;
            over.alt = "";
            over.decoding = "async";
            over.draggable = false;
            over.hidden = !state.overlayOn;
            cell.classList.add("has-overlay");
            cell.append(over);
          }
          if (shown.length > 1) {
            cell.title = t("mu.action.zoomImage");
            cell.addEventListener("click", (event) => {
              event.stopPropagation();
              state.zoom = index;
              state.natural = null;
              BUILT_IN.imagestage.update(host, state.desc);
            });
          }
          grid.append(cell);
        });
        canvas.append(grid);

        const action = (icon, title, run) => {
          const button = document.createElement("button");
          button.type = "button";
          button.className = "mu-round-btn";
          button.title = title;
          button.setAttribute("aria-label", title);
          button.append(Object.assign(document.createElement("i"), { className: `bi bi-${icon}` }));
          button.addEventListener("click", (event) => {
            event.stopPropagation();
            run();
          });
          actions.append(button);
        };
        if (overlay && shown.length === 1 && !isVideoSrc(shown[0])) {
          action("layers-half", t("mu.action.overlayImage"), () => {
            state.overlayOn = !state.overlayOn;
            BUILT_IN.imagestage.update(host, state.desc);
          });
          actions.lastElementChild.classList.toggle("is-active", Boolean(state.overlayOn));
          actions.lastElementChild.setAttribute("aria-pressed", String(Boolean(state.overlayOn)));
        }
        if (state.zoom !== null) {
          action("grid-3x3-gap", t("mu.action.backToGrid"), () => {
            state.zoom = null;
            BUILT_IN.imagestage.update(host, state.desc);
          });
        }
        // `bare`: a card around the stage has these on its header instead.
        if (shown.length === 1 && !p.bare) {
          action("box-arrow-up-right", t("mu.action.openImage"), () => window.open(shown[0], "_blank", "noopener"));
        }
        // Keeping the picture on the stage: one at a time, so in a grid it
        // is offered once one is opened. A video is not a picture to keep.
        // `keepAll` is for an output kept whole -- a panorama and its depth
        // -- which is the same thing to keep whichever picture is open, so
        // it is offered over the grid too.
        if (p.onKeep && (shown.length === 1 || p.keepAll) && !isVideoSrc(shown[0])) {
          action("bookmark-plus", p.keepTitle || t("mu.action.keepImage"), () => {
            const keep = state.desc.params.onKeep;
            if (keep) keep(shown[0]);
          });
        }
        if (p.onClear) {
          action("x-lg", p.clearTitle || t("mu.action.clearOutput"), () => {
            const clear = state.desc.params.onClear;
            if (clear) clear();
          });
          actions.lastElementChild.classList.add("is-danger");
        }
      } else {
        const empty = document.createElement("div");
        empty.className = "mu-imagestage-empty";
        empty.append(Object.assign(document.createElement("i"), { className: "bi bi-image mu-imagestage-icon" }));
        if (p.showSize !== false) {
          empty.append(
            Object.assign(document.createElement("span"), {
              className: "mu-imagestage-size",
              textContent: `${Number(p.width) || 1024} × ${Number(p.height) || 1024}`,
            })
          );
        }
        empty.append(
          Object.assign(document.createElement("span"), { textContent: p.empty || t("mu.value.imageHere") })
        );
        if (act) {
          const button = document.createElement("button");
          button.type = "button";
          button.className = "mu-imagestage-run";
          button.textContent = act.label;
          button.title = act.title || act.label;
          button.disabled = Boolean(act.disabled);
          button.addEventListener("click", (event) => {
            event.stopPropagation();
            const now = state.desc.params.emptyAction;
            if (now && now.run) now.run();
          });
          empty.append(button);
        }
        canvas.append(empty);
      }
      state.fit();
    },

    unmount(host) {
      const state = host.__stage;
      if (!state) return;
      state.observer.disconnect();
      delete host.__stage;
    },
  },

  // The image stage in a card with a header, like every other card that
  // holds an output: on the left the grip (what the card shows, carried as
  // a port) and the one action there is -- run while there is nothing,
  // cancel while it runs, delete once there is something; on the right
  // open in a new tab, keep as a preset, and shrink. Full width normally;
  // shrunk, the card is its header and nothing else.
  //
  // The stage is the imagestage control underneath, told to draw none of
  // its own round buttons except the way back to the grid: the header has
  // the rest.
  imagecard: {
    label: "mu.control.imagecard",
    standalone: true,
    // Two uses, one card. As an output (`images` given): run, cancel or
    // delete in the primary place, open and keep on the right. As an input
    // (bound to an image property it may write): upload, or delete once
    // there is a picture, and a file dropped anywhere on it is taken; on
    // the right open, presets (load) and keep (save as a preset). Either
    // way: the grip on the left, shrink on the right, and a scratch
    // board's remove when it is on one.
    params: {
      images: { type: "list", each: { type: "picture" }, bind: "read" },
      overlay: { type: "image", bind: "read" },
      width: { type: "number", bind: "read" },
      height: { type: "number", bind: "read" },
      showSize: { type: "boolean" },
      empty: { type: "label" },
      busy: { type: "boolean", bind: "read" },
      fill: { type: "boolean" },
      emptyAction: { type: "action" },
      onClear: { type: "action" },
      onKeep: { type: "action" },
      keepTitle: { type: "label" },
      keepAll: { type: "boolean" },
      port: { type: "data" },
      full: { type: "boolean", bind: "readwrite", state: true },
      onFull: { type: "action" },
      onDiscard: { type: "action" },
      name: { type: "string", bind: "readwrite", state: true },
      onName: { type: "action" },
      onPresets: { type: "action" },
      presetsTitle: { type: "label" },
      defaultFull: { type: "boolean" },
    },
    // Shown small until opened: an input or an output is one thing among
    // several in a window. Where the picture is the window's point (the
    // Preview app), the instance says `defaultFull: true`.
    defaultFull: false,
    sampleParams: { images: [], width: 1024, height: 1024 },

    mount(host, desc, onChange) {
      host.classList.add("mu-card", "mu-imagecard");
      host.__onChange = onChange || null;
      const button = (className, iconName) => {
        const one = document.createElement("button");
        one.type = "button";
        one.className = `mu-icon-button ${className}`;
        one.append(Object.assign(document.createElement("i"), { className: `bi bi-${ICONS[iconName] || iconName}` }));
        return one;
      };
      const act = button("is-primary mu-imagecard-act", "play-fill");
      act.append(Object.assign(document.createElement("span"), { className: "mu-button-label" }));
      const open = button("mu-imagecard-open", "box-arrow-up-right");
      const presets = button("mu-imagecard-presets", "preset");
      const keep = button("mu-imagecard-keep", "preset");
      keep.append(Object.assign(document.createElement("i"), { className: `bi bi-${ICONS.presetSave || "plus"} mu-icon-badge` }));
      const parts = buildCardHead("mu-imagecard", {
        lead: [act],
        tools: [open, presets, keep],
        onDiscard: () => {
          const run = host.__desc && host.__desc.params.onDiscard;
          if (run) run();
        },
      });
      const head = parts.head;
      const stage = document.createElement("div");
      const facts = Object.assign(document.createElement("div"), { className: "mu-imagecard-facts" });
      const file = Object.assign(document.createElement("input"), { type: "file", accept: "image/*", hidden: true });
      host.append(head, stage, facts, file);
      host.__card = { ...parts, act, open, presets, keep, stage, facts };

      // What the stage shows on its own: the picture opened from the
      // grid, or the only one there is. Read off the stage when pressed.
      const shownSrc = () => {
        const state = stage.__stage;
        const images = (state && state.images) || [];
        if (!images.length) return "";
        return state.zoom !== null && images[state.zoom] ? images[state.zoom] : images[0];
      };
      // A picture taken in: read here, in the browser, into the value --
      // refused with a note when it is too big or not a picture.
      const take = async (chosen) => {
        if (!chosen || !host.__input) return;
        const d = host.__desc;
        const limit = d.property.maxBytes ? d.property.maxBytes() : 0;
        if (limit && chosen.size > limit) {
          facts.textContent = t("mu.value.imageTooLarge", { size: formatBytes(chosen.size), max: formatBytes(limit) });
          return;
        }
        if (chosen.type && !chosen.type.startsWith("image/")) {
          facts.textContent = t("mu.value.notAnImage", { name: chosen.name });
          return;
        }
        try {
          const value = await blobToDataUrl(chosen, chosen.name);
          if (d.params.onName) d.params.onName(chosen.name);
          else if (d.set) d.set("name", chosen.name);
          BUILT_IN.imagecard.write(host, value);
        } catch (error) {
          facts.textContent = error.message || String(error);
        }
      };
      file.addEventListener("change", () => {
        const chosen = file.files && file.files[0];
        file.value = "";
        take(chosen);
      });
      const carriesFile = (event) => Boolean(event.dataTransfer && [...event.dataTransfer.types].includes("Files"));
      host.addEventListener("dragover", (event) => {
        if (!host.__input || !carriesFile(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
        host.classList.add("is-dragover");
      });
      host.addEventListener("dragleave", () => host.classList.remove("is-dragover"));
      host.addEventListener("drop", (event) => {
        if (!host.__input || !carriesFile(event)) return;
        event.preventDefault();
        host.classList.remove("is-dragover");
        take(event.dataTransfer.files[0]);
      });
      host.__pick = () => file.click();
      // A picture carried here by a grip (an output preview's, a scratch
      // board's): taken as the picture itself. One that comes as an
      // address on a server is fetched first -- an image property holds the
      // picture, and the address would be refused.
      host.__sinkSpec = {
        accepts: ["image"],
        icon: "clipboard-plus",
        label: t("mu.port.paste"),
        put: async (value) => {
          const src = String(value || "");
          if (!src) return;
          try {
            if (/^data:image\//.test(src) || /^\/api\/blob\?/.test(src)) {
              BUILT_IN.imagecard.write(host, src);
              return;
            }
            const blob = await (await fetch(src)).blob();
            // The server hands files over as octet-stream: the kind is read
            // off the address, which names the file (`filename`, or `path`).
            const params = new URL(src, location.href).searchParams;
            const named = (params.get("filename") || params.get("path") || "").split(/[\\/]/).pop();
            const type = blob.type.startsWith("image/") ? blob.type : (imageFacts(src) || {}).mime || "image/png";
            await take(new File([blob], named || "image.png", { type }));
          } catch (error) {
            facts.hidden = false;
            facts.textContent = error.message || String(error);
          }
        },
      };

      act.addEventListener("click", (event) => {
        event.stopPropagation();
        if (host.__act) host.__act();
      });
      open.addEventListener("click", (event) => {
        event.stopPropagation();
        const src = shownSrc();
        if (src) window.open(src, "_blank", "noopener");
      });
      presets.addEventListener("click", (event) => {
        event.stopPropagation();
        const d = host.__desc;
        if (Object.prototype.hasOwnProperty.call(d.params, "onPresets")) {
          if (d.params.onPresets) d.params.onPresets(presets);
        } else openValuePicker(d, presets);
      });
      keep.addEventListener("click", (event) => {
        event.stopPropagation();
        const src = shownSrc();
        const run = host.__desc && host.__desc.params.onKeep;
        if (src && run) run(src);
      });
      BUILT_IN.imagestage.mount(stage, BUILT_IN.imagecard.stageDesc(desc));
      BUILT_IN.imagecard.update(host, desc);
    },

    // Bound to a property, the picture is its value.
    imagesOf(desc) {
      const p = desc.params;
      if (Array.isArray(p.images)) {
        return p.images.map((one) => (one && typeof one === "object" ? String(one.src || "") : String(one || ""))).filter(Boolean);
      }
      if (desc.property && typeof desc.property.items === "function") {
        return desc.property.items().map((one) => (one && typeof one === "object" ? String(one.src || "") : String(one || ""))).filter(Boolean);
      }
      const src = desc.property && desc.property.src ? desc.property.src() : desc.value;
      if (Array.isArray(src)) {
        return src.map((one) => (one && typeof one === "object" ? String(one.src || "") : String(one || ""))).filter(Boolean);
      }
      return typeof src === "string" && src ? [src] : [];
    },

    // Whether it takes pictures in: bound to a property that can set one.
    isInput(desc) {
      const p = desc.params;
      if (Array.isArray(p.images) || p.emptyAction || p.onClear) return false;
      return Boolean(desc.property && desc.property.setSrc) && !desc.readonly;
    },

    // One way to write, as an input: through the handler it was mounted
    // with when there is one, so the screen follows the value.
    write(host, value) {
      if (host.__onChange) host.__onChange(value);
      else host.__desc.property.set(value);
    },

    stageDesc(desc) {
      const input = BUILT_IN.imagecard.isInput(desc);
      return {
        ...desc,
        params: {
          ...desc.params,
          images: BUILT_IN.imagecard.imagesOf(desc),
          emptyAction: null,
          onClear: null,
          onKeep: null,
          bare: true,
          ...(input ? { showSize: false, empty: desc.params.empty || t("mu.value.dropImageHere") } : {}),
        },
      };
    },

    update(host, desc) {
      const card = host.__card;
      if (!card) return;
      host.__desc = desc;
      const p = desc.params;
      const input = BUILT_IN.imagecard.isInput(desc);
      host.__input = input;
      host.classList.toggle("is-input", input);
      // Only an input takes a picture carried to it.
      if (input) attachSink(host, host.__sinkSpec);
      else {
        host.classList.remove("mu-port-sink");
        host.__sink = null;
      }
      const { act, open, presets, keep } = card;
      const port = cardPortOf(desc);

      const images = BUILT_IN.imagecard.imagesOf(desc);
      let action = null;
      if (input) {
        // Upload while empty; delete once there is a picture.
        action = images.length
          ? {
              icon: ICONS.close || "x",
              label: t("mu.action.delete"),
              title: t("mu.action.clearImage"),
              run: () => {
                if (p.onName) p.onName("");
                else if (desc.set) desc.set("name", "");
                BUILT_IN.imagecard.write(host, "");
              },
            }
          : { icon: "upload", label: t("mu.action.uploadShort"), title: t("mu.action.pickImage"), run: () => host.__pick() };
      } else {
        const empty = p.emptyAction || null;
        // Something there: the action is taking it away. Nothing: whatever
        // makes something -- run, or cancel while running.
        action = images.length
          ? p.onClear && { icon: ICONS.close || "x", label: t("mu.action.delete"), title: p.clearTitle || t("mu.action.clearOutput"), run: p.onClear }
          : empty && { icon: p.busy ? "stop-fill" : "play-fill", label: empty.label, title: empty.title || empty.label, run: empty.run, disabled: empty.disabled };
      }
      act.hidden = !action;
      if (action) {
        act.firstElementChild.className = `bi bi-${action.icon}`;
        act.lastElementChild.textContent = action.label;
        act.title = action.title;
        act.disabled = Boolean(action.disabled);
      }
      host.__act = action ? action.run : null;
      open.title = t("mu.action.openImage");
      open.disabled = !images.length;
      // Presets to load from: an input's, unless whoever placed it put the
      // button somewhere else (null) -- see the run settings' liftPresets.
      const handed = Object.prototype.hasOwnProperty.call(p, "onPresets");
      presets.hidden = !input || (handed && !p.onPresets);
      const typeDef = VALUE_TYPES[desc.type] || {};
      presets.title = p.presetsTitle || t("mu.action.presets", { type: t(typeDef.label || "mu.vtype.image") });
      keep.title = p.keepTitle || t("mu.action.keepImage");
      keep.hidden = !p.onKeep;
      keep.disabled = !images.length;

      // Where the picture came from and what it is, under an input's.
      const shape = input && images.length && desc.property.facts ? desc.property.facts() : null;
      const said = [p.name || "", shape ? describeImage(shape) : ""].filter(Boolean).join(" · ");
      if (card.facts.__said !== said) {
        card.facts.__said = said;
        card.facts.textContent = said;
      }
      card.facts.hidden = !input || !images.length;

      host.__sizeKey = `imagecard:${desc.key}`;
      const full = fullOf(p, host.__sizeKey, BUILT_IN.imagecard.defaultFull);
      const hadSize = typeof host.__full === "boolean";
      host.__full = full;
      syncCardHead(host, card, {
        port,
        name: desc.head,
        onDiscard: p.onDiscard,
        size: {
          full,
          title: t(full ? "mu.action.shrinkCard" : "mu.action.growCard"),
          toggle: () => {
            if (p.onFull) return p.onFull(!full);
            setCardShrunk(host.__sizeKey, full);
            BUILT_IN.imagecard.update(host, host.__desc);
          },
        },
      });
      const resize = () => {
        host.classList.toggle("is-shrunk", !full);
        host.classList.toggle("is-filling", Boolean(p.fill) && full);
      };
      const sizeChanged =
        host.classList.contains("is-shrunk") !== !full ||
        host.classList.contains("is-filling") !== (Boolean(p.fill) && full);
      if (hadSize && sizeChanged) animateCardResize(host, resize);
      else resize();
      fitCardHead(card.head);
      BUILT_IN.imagestage.update(card.stage, BUILT_IN.imagecard.stageDesc(desc));
    },

    unmount(host) {
      const card = host.__card;
      if (card) BUILT_IN.imagestage.unmount(card.stage);
      delete host.__card;
    },
  },

  // The audio card and the video card: the image card's own chrome -- grip,
  // the one primary action, a label, the link badge, presets, shrink, remove
  // -- over a player instead of a picture, so a voice or a clip reads as the
  // same kind of thing as a picture or a prompt. One implementation (see
  // mediaCard), told which kind it is. They wear the image card's classes
  // (the frame is the same frame) and add the player's.
  //
  // Two uses, as there: an output (`src` given): run, cancel or remove in
  // the primary place, and the file's save on the right; an input (bound to
  // an `audio` / `video` property that may be written): choose or drop a
  // file, which is kept as a file and held by its address, and remove once
  // there is one. A file dragged over it is taken; an address carried here
  // by a grip of the same kind is pasted.
  audiocard: mediaCard("audiocard", MEDIA.audio),
  videocard: mediaCard("videocard", MEDIA.video),

  // A state as one row (see paintStatusRow in core): what a connected
  // program, an app's links or a chain's run says about itself, with the way
  // into its detail at the right end. Placed with NODES.pinned, it sits in the
  // item's bar.
  statusrow: {
    label: "mu.control.statusrow",
    standalone: true,
    params: ["name", "text", "lamp", "error", "onMore", "moreTitle"],
    sampleParams: { name: "ComfyUI", text: "Ready", lamp: "ok" },
    render(desc) {
      const host = document.createElement("div");
      paintStatusRow(host, desc.params);
      return host;
    },
    update(host, desc) {
      paintStatusRow(host, desc.params);
    },
  },

  // A path and what the file holds, on one line: the type first, because it
  // is what decides whether a path means anything. With `of` narrowing it to
  // one type there is nothing to choose, and the dropdown says so by being
  // disabled rather than by disappearing.
  pathbox: {
    label: "mu.control.pathbox",
    needs: ["setPath", "setPointsTo", "typeOptions"],
    render(desc, onChange) {
      const wrap = document.createElement("div");
      wrap.className = "mu-pathbox";
      const select = document.createElement("select");
      select.className = "select mu-pathbox-type";
      const input = document.createElement("input");
      input.type = "text";
      input.className = "input mu-prop-input mu-pathbox-path";
      input.placeholder = t(desc.params.placeholder || "mu.placeholder.path");
      // Both halves are read off the DOM when either changes, so an edit is
      // never computed from the value as it was when this was drawn.
      const write = () => onChange({ type: select.value, path: input.value });
      select.addEventListener("change", write);
      input.addEventListener("input", write);
      wrap.append(select, input);
      BUILT_IN.pathbox.update(wrap, desc);
      return wrap;
    },
    update(el, desc) {
      const [select, input] = el.children;
      const options = desc.property.typeOptions();
      const value = desc.value || {};
      const wanted = options.map((option) => `${option.value} ${option.label}`).join("");
      if (select.dataset.options !== wanted) {
        select.dataset.options = wanted;
        select.replaceChildren(
          ...options.map((option) => new Option(option.label, option.value))
        );
      }
      // A type that is not offered (its plugin is gone) is still shown as
      // what the value says, rather than silently as the first option.
      if (value.type && !options.some((option) => option.value === value.type)) {
        select.append(new Option(value.type, value.type));
        select.dataset.options = "";
      }
      setValue(select, value.type || "");
      select.disabled = options.length < 2;
      setValue(input, value.path || "");
    },
  },

  // Read-only presentations. A control is still the right home for these:
  // they are a way of showing a value, not a kind of value.
  reflabel: {
    label: "mu.control.reflabel",
    needs: ["target"],
    render(desc) {
      const span = document.createElement("span");
      span.className = "mu-prop-static";
      span.textContent = describeRef(desc);
      return span;
    },
    update(el, desc) {
      el.textContent = describeRef(desc);
    },
  },

  listcount: {
    label: "mu.control.listcount",
    needs: ["length"],
    render(desc) {
      const span = document.createElement("span");
      span.className = "mu-prop-static";
      span.textContent = desc.property.format();
      return span;
    },
    update(el, desc) {
      el.textContent = desc.property.format();
    },
  },

  // A value said in a line, as its type formats it: for a record nobody
  // types into -- a saved launch layout -- whose name is what tells it apart.
  // One entry's text, on a line: the `text` field of an {id, text}.
  entrytext: {
    label: "mu.control.entrytext",
    needs: ["text", "setText"],
    params: ["placeholder"],
    render(desc) {
      const input = document.createElement("input");
      input.type = "text";
      input.className = "input";
      input.addEventListener("input", () => input.__desc.property.setText(input.value));
      input.__desc = desc;
      BUILT_IN.entrytext.update(input, desc);
      return input;
    },
    update(input, desc) {
      input.__desc = desc;
      input.readOnly = Boolean(desc.readonly);
      const text = desc.property.text();
      if (document.activeElement !== input && input.value !== text) input.value = text;
    },
  },

  // Any list, read only, as a card of badges: one badge for each element, said the way the
  // element's type says it (its `format`). A list of tags is its words; anything whose
  // format is short reads the same. The card is a list's: the grip carries the whole list
  // (the control's own property, or the `port` it is given), and it folds. Editing is
  // `rows`' and `cardgrid`'s.
  badges: {
    label: "mu.control.badges",
    needs: ["items"],
    requiresParams: ["each"],
    // `bare`: only the badges, for a card that already is one (an element of a list). `moveKey` + `onMove`: a badge
    // can be dragged to another list of badges that has a `moveKey` too -- `onMove(index, fromKey, toKey)` is told
    // where it was dropped, by the one it was dropped on (the card the badges are in is the place to drop).
    params: ["port", "bare", "moveKey", "onMove"],
    render(desc) {
      const list = document.createElement("div");
      list.className = "mu-badges";
      if (desc.params.bare) {
        list.__list = list;
        BUILT_IN.badges.update(list, desc);
        return list;
      }
      const guide = emptyGuide();
      const wrap = listCard(list, { key: `badges:${desc.key || ""}` });
      wrap.classList.add("mu-badgecard");
      list.after(guide);
      BUILT_IN.badges.update(wrap, desc);
      return wrap;
    },
    update(wrap, desc) {
      const items = desc.property.items();
      const item = desc.property.item;
      const bare = Boolean(desc.params.bare);
      if (!bare) {
        attachPort(wrap, wrap.__grip, desc.params.port || (item ? { item: item.id, key: desc.property.key } : null));
        wrap.__grip.title = t("mu.port.grip");
      }
      const list = wrap.__list;
      const said = items.map((_, index) => desc.property.element(index).format());
      // Redrawn only when what it says changed: a badge is not typed into, so there is nothing
      // to keep alive between draws.
      const sig = JSON.stringify(said);
      if (list.__sig !== sig) {
        list.__sig = sig;
        list.replaceChildren(...said.map((text) => Object.assign(document.createElement("span"), { className: "mu-badge", textContent: text, title: text })));
      }
      // A badge whose element has an explanation (a helper "explain:<element type>", from whoever knows
      // what the element is) opens it on a press: what it says, in the reader's language.
      list.__desc = desc;
      const explain = explainerOf(desc);
      const elements = items;
      [...list.children].forEach((badge, index) => {
        // Only a badge that has something to say can be pressed.
        const has = Boolean(explain && explain(elements[index]));
        badge.classList.toggle("is-explained", has);
        badge.onclick = has
          ? (event) => {
              event.stopPropagation();
              const found = explain(list.__desc.property.items()[index]);
              if (found) openExplanation(badge, said[index], found);
            }
          : null;
      });
      // Dragging a badge to another list: this list takes what is dropped on the card it is in.
      list.__moving = desc.params.moveKey ? { key: desc.params.moveKey, onMove: desc.params.onMove } : null;
      list.classList.toggle("is-movable", Boolean(list.__moving));
      [...list.children].forEach((badge) => {
        badge.draggable = Boolean(list.__moving);
        if (badge.__dragWired) return;
        badge.__dragWired = true;
        badge.addEventListener("dragstart", (event) => {
          if (!list.__moving) return;
          BADGE_DRAG = { key: list.__moving.key, index: [...list.children].indexOf(badge) };
          badge.classList.add("is-dragging");
          if (event.dataTransfer) {
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData("text/plain", badge.textContent);
          }
        });
        badge.addEventListener("dragend", () => {
          BADGE_DRAG = null;
          badge.classList.remove("is-dragging");
          document.querySelectorAll(".mu-badge-drop.is-over").forEach((one) => one.classList.remove("is-over"));
        });
      });
      const zone = list.closest(".mu-nodecard") || list;
      zone.__badgeList = list;
      if (!zone.__dropWired) {
        zone.__dropWired = true;
        zone.classList.add("mu-badge-drop");
        zone.addEventListener("dragover", (event) => {
          const mine = zone.__badgeList.__moving;
          if (!BADGE_DRAG || !mine || BADGE_DRAG.key === mine.key) return;
          event.preventDefault();
          if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
          zone.classList.add("is-over");
        });
        zone.addEventListener("dragleave", (event) => {
          if (!zone.contains(event.relatedTarget)) zone.classList.remove("is-over");
        });
        zone.addEventListener("drop", (event) => {
          const mine = zone.__badgeList.__moving;
          if (!BADGE_DRAG || !mine || BADGE_DRAG.key === mine.key) return;
          event.preventDefault();
          zone.classList.remove("is-over");
          const from = BADGE_DRAG;
          BADGE_DRAG = null;
          if (mine.onMove) mine.onMove(from.index, from.key, mine.key);
        });
      }
      if (bare) return;
      list.nextElementSibling.hidden = items.length > 0;
      list.hidden = items.length === 0;
    },
  },

  // A text in more than one language, as the shell's text card: the text in the language chosen
  // in the card's bar (the reader's own to begin with, else English, else what there is). A
  // language it has nothing in is there but cannot be chosen -- unless the text can be written,
  // when choosing it is how it is begun.
  multitext: {
    // The text card, over the language shown: its declaration is the text card's.
    extends: "texteditor",
    label: "mu.control.multitext",
    needs: ["text", "languages"],
    render(desc, onChange) {
      const el = BUILT_IN.texteditor.render(shownIn(desc), (text) => {
        const now = el.__multi;
        onChange({ ...(now.property.get() || {}), [chosenLanguage(now)]: text });
      });
      BUILT_IN.multitext.update(el, desc);
      return el;
    },
    update(el, desc) {
      el.__multi = desc;
      BUILT_IN.texteditor.update(el, shownIn(desc));
      paintLanguages(el, desc);
    },
  },

  // A description's two fields, a line for the name and a box for what it is.
  descriptionfields: {
    label: "mu.control.descriptionfields",
    needs: ["name", "setName", "description", "setDescription"],
    params: ["placeholder"],
    render(desc) {
      const wrap = document.createElement("div");
      wrap.className = "mu-description";
      const name = document.createElement("input");
      name.type = "text";
      name.className = "input mu-description-name";
      name.placeholder = t("mu.placeholder.descriptionName");
      name.addEventListener("input", () => wrap.__desc.property.setName(name.value));
      const text = document.createElement("textarea");
      text.className = "input mu-description-text";
      text.rows = 2;
      text.placeholder = t("mu.placeholder.descriptionText");
      text.addEventListener("input", () => wrap.__desc.property.setDescription(text.value));
      wrap.append(name, text);
      BUILT_IN.descriptionfields.update(wrap, desc);
      return wrap;
    },
    update(wrap, desc) {
      wrap.__desc = desc;
      const [name, text] = wrap.children;
      name.readOnly = text.readOnly = Boolean(desc.readonly);
      // Never fight the person typing.
      const said = desc.property.name();
      if (document.activeElement !== name && name.value !== said) name.value = said;
      const explained = desc.property.description();
      if (document.activeElement !== text && text.value !== explained) text.value = explained;
    },
  },

  summary: {
    label: "mu.control.summary",
    render(desc) {
      const span = document.createElement("span");
      span.className = "mu-prop-static";
      span.textContent = desc.property.format();
      return span;
    },
    update(el, desc) {
      const said = desc.property.format();
      if (el.textContent !== said) el.textContent = said;
    },
  },

  // A widget: it owns its DOM, so it gets mount/unmount instead of render.
  // The strokes it draws still live in the list property it is bound to.
  sketch: {
    label: "mu.control.sketch",
    needs: ["get", "set"],
    widget: true,

    mount(host, desc, onChange) {
      host.classList.add("mu-sketch");
      const canvas = document.createElement("canvas");
      host.append(canvas);

      const state = { strokes: strokesOf(desc), drawing: null, onChange };
      host.__sketch = state;

      const point = (event) => {
        const rect = canvas.getBoundingClientRect();
        return [
          Math.min(1, Math.max(0, (event.clientX - rect.left) / (rect.width || 1))),
          Math.min(1, Math.max(0, (event.clientY - rect.top) / (rect.height || 1))),
        ];
      };

      state.onPointerDown = (event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        canvas.setPointerCapture(event.pointerId);
        state.drawing = [point(event)];
        paintSketch(canvas, state);
      };
      state.onPointerMove = (event) => {
        if (!state.drawing) return;
        state.drawing.push(point(event));
        paintSketch(canvas, state);
      };
      state.onPointerUp = () => {
        if (!state.drawing) return;
        // Only a finished stroke reaches the property -- mid-drag points
        // would rewrite the layout file on every pointer move.
        const stroke = state.drawing;
        state.drawing = null;
        if (stroke.length > 1) state.onChange([...state.strokes, stroke]);
        else paintSketch(canvas, state);
      };

      canvas.addEventListener("pointerdown", state.onPointerDown);
      canvas.addEventListener("pointermove", state.onPointerMove);
      canvas.addEventListener("pointerup", state.onPointerUp);
      canvas.addEventListener("pointercancel", state.onPointerUp);

      state.observer = new ResizeObserver(() => paintSketch(canvas, state));
      state.observer.observe(host);
      paintSketch(canvas, state);
    },

    update(host, desc) {
      const state = host.__sketch;
      if (!state) return;
      state.strokes = strokesOf(desc);
      paintSketch(host.querySelector("canvas"), state);
    },

    unmount(host) {
      const state = host.__sketch;
      if (!state) return;
      state.observer.disconnect();
      const canvas = host.querySelector("canvas");
      canvas.removeEventListener("pointerdown", state.onPointerDown);
      canvas.removeEventListener("pointermove", state.onPointerMove);
      canvas.removeEventListener("pointerup", state.onPointerUp);
      canvas.removeEventListener("pointercancel", state.onPointerUp);
      delete host.__sketch;
    },
  },
};

// The strokes a sketch pad holds: the property's value, which is data -- an
// array of strokes, each an array of points -- and not a list of values.
function strokesOf(desc) {
  const value = desc.property.get();
  // Only what is a stroke -- a list of [x, y] -- is drawn: a value that is
  // something else, whoever wrote it, is no reason for the pad to throw.
  const point = (one) => Array.isArray(one) && Number.isFinite(one[0]) && Number.isFinite(one[1]);
  return Array.isArray(value) ? value.filter((stroke) => Array.isArray(stroke) && stroke.every(point)) : [];
}

function applyButton(el, spec) {
  if (el.textContent !== spec.label) el.textContent = spec.label;
  el.disabled = Boolean(spec.disabled);
  // Which button it is, for whoever points at it (see pickControl in core).
  el.dataset.toolKey = spec.key || "";
  el.title = spec.title || "";
  // Replaced rather than added: body() hands over a fresh closure each pass.
  el.onclick = (event) => {
    event.stopPropagation();
    if (spec.confirm) askFirst(el, spec);
    else spec.run(el);
  };
}

// A button that asks before it acts (`confirm: {message, title?, okText?, danger?}`): a popup under the
// button with what is about to happen, and a way out. Only a press on the OK button runs it; a press outside
// the popup, or on Cancel, lets it go. The same for every button that does something that cannot be undone --
// restart, quit, a reset to the defaults -- so they ask the same way.
function askFirst(anchor, spec) {
  const ask = spec.confirm;
  const content = document.createElement("div");
  content.className = "mu-confirm";
  if (ask.title) content.append(Object.assign(document.createElement("div"), { className: "mu-confirm-title", textContent: ask.title }));
  content.append(Object.assign(document.createElement("div"), { className: "mu-confirm-message", textContent: ask.message || "" }));
  const actions = Object.assign(document.createElement("div"), { className: "mu-confirm-actions" });
  const cancel = Object.assign(document.createElement("button"), { type: "button", className: "mu-item-button", textContent: ask.cancelText || t("mu.ask.cancel") });
  const ok = Object.assign(document.createElement("button"), {
    type: "button",
    className: `mu-item-button mu-confirm-ok${ask.danger ? " is-danger" : ""}`,
    textContent: ask.okText || t("mu.ask.ok"),
  });
  cancel.addEventListener("click", (event) => {
    event.stopPropagation();
    closeHint();
  });
  ok.addEventListener("click", (event) => {
    event.stopPropagation();
    closeHint();
    spec.run(anchor);
  });
  actions.append(cancel, ok);
  content.append(actions);
  const popup = openPopup(anchor, content, "mu-hint-popup mu-confirm-popup");
  // Asking again on the same button is letting go of the question (openPopup toggles); a new one starts at "no".
  if (popup) cancel.focus();
}

// Keyed child diffing, the same rule the body renderer uses one level up:
// match by key, update in place, move only when the order really changed.
// One card of a cardgrid. Everything it does reads its position off the
// element when it happens, so the same card serves whatever element ends up
// at its place.
function cardgridCard(wrap) {
  const card = document.createElement("div");
  card.className = "mu-cardgrid-card";
  const at = () => Number(card.dataset.nodeKey);

  const handle = document.createElement("span");
  handle.className = "mu-cardgrid-handle";
  handle.draggable = true;
  handle.title = t("mu.action.dragCard");
  handle.innerHTML = '<i class="bi bi-grip-vertical" aria-hidden="true"></i>';
  handle.addEventListener("dragstart", (event) => {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", String(at()));
    wrap.__dragging = at();
    card.classList.add("is-dragging");
    wrap.classList.add("is-dragging");
  });
  // Fires on the source however the drag ended, outside the grid included.
  handle.addEventListener("dragend", () => endCardDrag(wrap));

  const slot = document.createElement("div");
  slot.className = "mu-cardgrid-slot";

  const drop = document.createElement("button");
  drop.type = "button";
  drop.className = "mu-cardgrid-remove";
  drop.tabIndex = -1;
  drop.textContent = "\u00d7";
  drop.title = t("mu.action.rowRemove");
  drop.addEventListener("mousedown", (event) => event.preventDefault());
  drop.addEventListener("click", (event) => {
    event.stopPropagation();
    const next = [...wrap.__desc.property.items()];
    next.splice(at(), 1);
    wrap.__onChange(next);
  });

  // Where a carried card would land: before this one or after it.
  const guides = document.createElement("div");
  guides.className = "mu-cardgrid-guides";
  const guide = (where, glyph, titleKey) => {
    const one = document.createElement("button");
    one.type = "button";
    one.className = `mu-cardgrid-guide guide-${where}`;
    one.textContent = glyph;
    one.title = t(titleKey);
    one.addEventListener("dragover", (event) => {
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      one.classList.add("is-over");
    });
    one.addEventListener("dragleave", () => one.classList.remove("is-over"));
    one.addEventListener("drop", (event) => {
      event.preventDefault();
      one.classList.remove("is-over");
      endCardDrag(wrap);
      const from = Number(event.dataTransfer.getData("text/plain"));
      const target = at();
      // Moving forward, the gap left behind pulls the target back by one.
      const to =
        where === "after" ? (from < target ? target : target + 1) : from < target ? target - 1 : target;
      const next = [...wrap.__desc.property.items()];
      if (from === to || next[from] === undefined || to < 0 || to >= next.length) return;
      const [taken] = next.splice(from, 1);
      next.splice(to, 0, taken);
      wrap.__onChange(next);
    });
    return one;
  };
  guides.append(guide("before", "\u2190", "mu.action.dropBefore"), guide("after", "\u2192", "mu.action.dropAfter"));

  card.append(handle, slot, drop, guides);
  return card;
}

function endCardDrag(wrap) {
  wrap.__dragging = null;
  wrap.classList.remove("is-dragging");
  wrap.querySelectorAll(".is-dragging").forEach((one) => one.classList.remove("is-dragging"));
}

function diffChildren(parent, entries, keyOf, handlers) {
  const existing = new Map();
  for (const child of Array.from(parent.children)) existing.set(child.dataset.nodeKey, child);

  const kept = new Set();
  let cursor = parent.firstElementChild;
  entries.forEach((entry, index) => {
    const key = String(keyOf(entry, index));
    let el = existing.get(key);
    if (!el) {
      el = handlers.create(entry);
      el.dataset.nodeKey = key;
    }
    handlers.update(el, entry);
    kept.add(key);
    if (el === cursor) cursor = cursor.nextElementSibling;
    else parent.insertBefore(el, cursor);
  });
  existing.forEach((el, key) => {
    if (!kept.has(key)) el.remove();
  });
}

// The one checklist popup that may be open, and the button it belongs to.
let checklistPopup = null;

function closeChecklist() {
  if (!checklistPopup) return;
  checklistPopup.button.classList.remove("is-open");
  checklistPopup.el.remove();
  checklistPopup = null;
}

function paintChecklist(button) {
  const { rows: el, all } = checklistPopup;
  if (!button.isConnected) {
    closeChecklist();
    return;
  }
  const items = button.__desc.params.items || [];
  // One button for all of them, and only the one that can be pressed: all are
  // chosen, or not yet.
  const every = items.length > 0 && items.every((item) => item.checked);
  all.textContent = t(every ? "mu.action.uncheckAll" : "mu.action.checkAll");
  all.hidden = !items.length;
  all.dataset.all = every ? "none" : "all";
  diffChildren(el, items, (item) => String(item.value), {
    create: (item) => {
      const row = document.createElement("label");
      row.className = "mu-popcheck-row";
      const box = document.createElement("input");
      box.type = "checkbox";
      box.className = "mu-prop-check";
      box.addEventListener("change", () => {
        const values = Array.from(el.children).filter((one) => one.firstElementChild.checked).map((one) => one.__value);
        const onChange = button.__desc.params.onChange;
        if (onChange) onChange(values);
      });
      row.append(
        box,
        Object.assign(document.createElement("span"), { className: "mu-popcheck-swatch" }),
        Object.assign(document.createElement("span"), { className: "mu-popcheck-text" })
      );
      return row;
    },
    update: (row, item) => {
      row.__value = item.value;
      const [box, swatch, text] = row.children;
      box.checked = Boolean(item.checked);
      swatch.hidden = !item.swatch;
      swatch.style.setProperty("--swatch", item.swatch || "transparent");
      text.textContent = item.label;
    },
  });
}

function openChecklist(button) {
  const was = checklistPopup && checklistPopup.button;
  closeChecklist();
  if (was === button) return;
  const el = document.createElement("div");
  el.className = "mu-popcheck-popup";
  const rows = document.createElement("div");
  rows.className = "mu-popcheck-rows";
  const all = document.createElement("button");
  all.type = "button";
  all.className = "mu-popcheck-all";
  all.addEventListener("click", (event) => {
    event.stopPropagation();
    const onChange = button.__desc.params.onChange;
    const items = button.__desc.params.items || [];
    if (onChange) onChange(all.dataset.all === "all" ? items.map((item) => item.value) : []);
  });
  el.append(all, rows);
  document.body.append(el);
  checklistPopup = { button, el, rows, all };
  button.classList.add("is-open");
  paintChecklist(button);
  // Under the button, pulled back inside the viewport where that would put it
  // off an edge (above it when there is no room below).
  const at = button.getBoundingClientRect();
  const size = el.getBoundingClientRect();
  const left = Math.max(4, Math.min(at.left, window.innerWidth - size.width - 4));
  const below = at.bottom + 4;
  const top = below + size.height > window.innerHeight - 4 ? Math.max(4, at.top - size.height - 4) : below;
  el.style.left = `${Math.round(left)}px`;
  el.style.top = `${Math.round(top)}px`;
  // The button to choose all or none is at the end of the list the button that
  // opened it is nearer: the top when the list hangs below it, the bottom when
  // it stands above.
  if (top < at.top) el.append(all);
  else el.prepend(all);
}

// Listening to the page (install), not outside a page.
function listenToPage() {
  document.addEventListener(
    "pointerdown",
    (event) => {
      if (checklistPopup && !checklistPopup.el.contains(event.target) && !checklistPopup.button.contains(event.target)) closeChecklist();
    },
    true
  );
  document.addEventListener(
    "keydown",
    (event) => {
      if (event.key === "Escape" && checklistPopup) {
        event.stopPropagation();
        closeChecklist();
      }
    },
    true
  );
}

// One cell of a field form. The field it shows is kept on the cell, so that
// the listeners (made once) always speak for the latest.
function createFieldCell(field) {
  const kind = field.kind || "select";
  const cell = document.createElement("label");
  cell.className = `mu-fieldform-cell is-${kind}`;
  if (kind === "readout") {
    cell.append(Object.assign(document.createElement("span"), { className: "mu-fieldform-readout" }));
  } else if (kind === "text") {
    const input = document.createElement("input");
    input.type = "text";
    input.className = "mu-fieldform-input";
    input.addEventListener("input", () => cell.__field.onChange && cell.__field.onChange(input.value));
    cell.append(input);
  } else {
    const select = document.createElement("select");
    select.className = "mu-fieldform-select";
    select.addEventListener("change", () => cell.__field.onChange && cell.__field.onChange(select.value));
    cell.append(select);
  }
  return cell;
}

function updateFieldCell(cell, field, readonly) {
  cell.__field = field;
  const kind = field.kind || "select";
  const control = cell.firstElementChild;
  cell.title = field.label || "";
  if (kind === "readout") {
    const text = String(field.value ?? "");
    if (control.textContent !== text) control.textContent = text;
    return;
  }
  control.disabled = readonly;
  control.setAttribute("aria-label", field.label || "");
  if (kind === "text") {
    control.placeholder = field.label || "";
    setValue(control, field.value ?? "");
    return;
  }
  // The label is the heading of the list the drop-down opens.
  const options = field.options || [];
  const signature = JSON.stringify([field.label, options]);
  if (control.__signature !== signature) {
    control.__signature = signature;
    const group = document.createElement("optgroup");
    group.label = field.label || "";
    for (const [value, text] of options) group.append(Object.assign(document.createElement("option"), { value: String(value), textContent: text }));
    control.replaceChildren(group);
  }
  if (control.value !== String(field.value)) control.value = String(field.value);
}

// The control the preset control wraps: whatever the spec named, or the
// type's own default -- never the preset control itself, which is what the
// spec asked for.
function innerName(spec) {
  const params = spec.params || spec;
  if (params.inner) return params.inner;
  const def = VALUE_TYPES[spec.type || params.type];
  return def ? def.defaultControl : "textbox";
}

function innerControl(desc) {
  const name = innerName(desc);
  if (name === "none") return null;
  const control = CONTROLS[name];
  if (!control) throw new Error(`the saved-value control wraps unknown control "${name}"`);
  return control;
}

// Why a library control is offering nothing. Both cases are a mistake in
// the item type rather than anything the reader did, so they name the
// drawer: whoever wrote the property is the one who can fix it.
function fillOptions(select, desc) {
  // A property that knows its own domain answers for it; anything else --
  // a plain list of options handed in by a control -- goes through optionsOf.
  const options =
    desc.property && desc.property.options
      ? desc.property.options()
      : optionsOf(desc.params, desc.api);
  const same =
    select.options.length === options.length &&
    options.every(
      (option, i) =>
        select.options[i].value === String(option.value) &&
        select.options[i].textContent === option.label
    );
  if (same) return;
  select.replaceChildren();
  options.forEach((option) => {
    const el = document.createElement("option");
    el.value = option.value;
    el.textContent = option.label;
    select.append(el);
  });
}

// A child as a row says it: by its own `name` when it has one, which is what
// a person calls a layer, and by its type otherwise.
function childLabel(item) {
  const own = item.props && typeof item.props.name === "string" ? item.props.name.trim() : "";
  if (own) return own;
  const def = ITEM_TYPES[item.type];
  return def ? t(def.label) : item.type;
}

// Where the add button puts a new node: just below the selection, beside
// it in its own container -- or at the end of the top level.
function insertionPoint(property) {
  const selected = property.selected();
  const node = selected ? property.locate(selected) : null;
  if (!node) return { container: property, parentId: property.item.id, index: null };
  return { container: node.container, parentId: node.container.item.id, index: node.index + 1 };
}

function getItemOf(container, id) {
  return container.children().find((child) => child.id === id) || null;
}

// The ids with one moved a step, clamped to the ends.
function moved(ids, id, by) {
  const next = [...ids];
  const from = next.indexOf(id);
  const to = Math.max(0, Math.min(next.length - 1, from + by));
  if (from < 0 || to === from) return next;
  next.splice(to, 0, ...next.splice(from, 1));
  return next;
}

function describeRef(desc) {
  const target = desc.property.target();
  return target ? `${target.id} · ${target.type}` : "—";
}

function paintSketch(canvas, state) {
  const host = canvas.parentElement;
  const width = Math.max(1, Math.round(host.clientWidth));
  const height = Math.max(1, Math.round(host.clientHeight));
  const dpr = window.devicePixelRatio || 1;
  if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
    canvas.width = width * dpr;
    canvas.height = height * dpr;
  }
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;

  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.strokeStyle = getComputedStyle(canvas).color;
  ctx.lineWidth = 1.5;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  const draw = (stroke) => {
    if (!stroke || stroke.length < 2) return;
    ctx.beginPath();
    stroke.forEach(([x, y], i) => {
      const px = x * width;
      const py = y * height;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.stroke();
  };

  state.strokes.forEach(draw);
  draw(state.drawing);
}

// What this file registers, once the modules it uses are handed in (index.js).
export function install() {
  if (document) listenToPage();
  for (const [name, def] of Object.entries(BUILT_IN)) registerControl(name, def);
}
