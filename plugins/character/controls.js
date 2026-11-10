/* Character -- who is in the picture, kept once, used by every app.
 *
 *   character          the record: how they are described, pictures of
 *                      what they wear, a four-view sheet, and what they
 *                      can be seen doing (see model.js). Carried whole as
 *                      kind "character"
 *   character.action   one thing they can be seen doing ({name, kind,
 *                      media}: a picture or a video), carried as
 *                      "character.action"; an action list's entries
 *   character.media    a picture, a video or a character, and which of
 *                      its actions it is doing: what an object on a stage
 *                      is. Taken in as whichever of the three it is given
 *   character.editor   the Character Editor: one character, in one window
 *   character.preview  its references and actions, shown in a linked window
 *
 * The outfits and the sheet are lists of pictures (the shell's
 * `imagelist`, edited with its generic input), not types of their own: a
 * sheet carried from the sheet maker and a picture carried from anywhere
 * are the same thing to them.
 *
 * A character is referred to, not copied. A run holds only which
 * character it means, because a character's looks being fixed once and
 * everywhere is the point of having one. The reference is the character's
 * own `uid` rather than its library id -- the chooser hands out values, not
 * ids -- so a character carries it from its first save on.
 *
 * What a character can become is the `yields` table on its type: block kind
 * in, value for that kind out. The runner fills its blocks from that table
 * and knows nothing else about characters -- which is what lets a picture
 * be a four-sided sheet in one app and a sentence in the next.
 */

import { YIELDS, coerceAction, coerceCharacter } from "./model.js";
import { coerceMedia, hasMedia, isVideoMedia, shownOf } from "./media.js";

const TYPE = "character";

export default function createControls(fw) {
  const defs = {};
  const { core, describe } = fw;
  const registerControl = (id, def) => { defs[id] = def; };
  const { NODES, t } = core;

  // ---- the values ----------------------------------------------------



  // ---- the ways to show them ------------------------------------------
  const firstPicture = (c) => c.references.find(one => one.kind === "image" && one.data)?.data || "";
  function summaryOf(c) {
    return {
      name: c.name || t("character.value.unnamed"),
      detail: [
        t("character.references.count", { n: c.references.length }),
        t("character.value.actionCount", { n: c.actions.length }),
      ]
        .filter(Boolean)
        .join(" · "),
      thumb: firstPicture(c),
    };
  }

  const el = (tag, className, props = {}) => Object.assign(document.createElement(tag), { className, ...props });
  const icon = (name) => el("i", `bi bi-${core.ICONS[name] || name}`);
  const button = (name, iconName, title, onClick) => {
    const one = el("button", `mu-icon-button character-${name}`, { type: "button", title });
    one.append(icon(iconName));
    one.addEventListener("mousedown", (event) => event.preventDefault());
    one.addEventListener("click", (event) => {
      event.stopPropagation();
      onClick(one);
    });
    return one;
  };

  const paintSummary = (host, summary) => {
    const [thumb, text] = host.children;
    thumb.classList.toggle("is-empty", !summary.thumb);
    if (thumb.getAttribute("src") !== (summary.thumb || "")) {
      if (summary.thumb) thumb.setAttribute("src", summary.thumb);
      else thumb.removeAttribute("src");
    }
    const [name, detail] = text.children;
    if (name.textContent !== summary.name) name.textContent = summary.name;
    if (detail.textContent !== summary.detail) detail.textContent = summary.detail;
  };
  const summaryShell = () => {
    const host = el("div", "character-summary");
    const thumb = el("img", "character-thumb", { draggable: false });
    const text = el("div", "character-summary-text");
    text.append(el("span", "character-name"), el("span", "character-detail"));
    host.append(thumb, text);
    return host;
  };

  registerControl("character.summary", {
    label: "character.control.summary",
    needs: ["summary"],
    render(desc) {
      const host = summaryShell();
      paintSummary(host, desc.property.summary());
      return host;
    },
    update(host, desc) {
      paintSummary(host, desc.property.summary());
    },
  });

  const resourceKind = (media) => (isVideoMedia(media) ? "video" : "image");

  // One action: {id, name, kind, media}. Carried as the action it is (without
  // its id), put over by another -- what it shows, and its name if this one
  // has none -- and its picture or video alone is a port of its own: what an
  // output's grip carries in, and what a scratch board can take out. It is a
  // facet, not a field, because putting a picture in changes its kind too.


  // A picture, a video or a character, and which of its actions: what an
  // object on a stage is made of (see media.js).


  // ---- a picture, a video or a character, as an input ---------------------
  // A card: the grip carries what is in it; upload (or, once there is
  // something, remove) leads; and on the right choose a character or a
  // saved picture. A file dropped on it is taken. When a character is in
  // it, the action it is doing is chosen in the card itself.
  //
  // `allowCharacter: false` is a plain picture-or-video input (an action's
  // resource is one). Kept files are the library's, as an address, not the
  // megabytes of a data URL (store:write, where the asker has it).
  const readFile = (chosen, api) => {
    if (!chosen || !/^(image|video)\//.test(chosen.type)) return Promise.resolve("");
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => resolve("");
      reader.readAsDataURL(chosen);
    }).then((dataUrl) =>
      dataUrl && api && api.store && api.store.keepFile ? api.store.keepFile(dataUrl).catch(() => dataUrl) : dataUrl
    );
  };

  registerControl("character.mediainput", {
  // Draws as a card, and has no header to put a name in (see core unnamedCardsIn).
  cardName: () => "",
    label: "character.control.mediainput",
    why: "holds a picture, a video or a character with its action as one value; the card is the shell's header over its own body",
    params: ["allowCharacter", "port"],
    render(desc) {
      const wrap = el("div", "mu-card mu-imagecard character-media");
      const button = (className, iconName) => {
        const one = el("button", `mu-icon-button ${className}`, { type: "button" });
        one.append(icon(iconName));
        return one;
      };
      const main = button("is-primary character-media-main", "upload");
      main.append(el("span", "mu-button-label"));
      const person = button("character-media-person", "person-badge");
      const presets = button("character-media-presets", "preset");
      // The shell card's header: grip, what it follows, then these.
      const parts = fw.card.buildHead("mu-imagecard", { lead: [main], tools: [person, presets] });
      const head = parts.head;

      const body = el("div", "character-media-body");
      const shown = el("div", "character-media-shown");
      const row = el("label", "character-media-action");
      const select = el("select", "select mu-prop-select");
      row.append(el("span", "", { textContent: t("character.field.action") }), select);
      body.append(shown, row);
      const file = el("input", "", { type: "file", accept: "image/*,video/*", hidden: true });
      wrap.append(head, body, file);

      const now = () => coerceMedia(wrap.__desc.property.get());
      const put = (next) => wrap.__desc.property.set(next);
      const take = (chosen) =>
        readFile(chosen, wrap.__desc.api).then((media) => {
          if (media) put({ kind: resourceKind(media), media, character: null, action: "" });
        });
      // What is linked would be written back at the next redraw, so taking
      // it away stops the following first.
      const release = () => {
        const address = wrap.__port;
        if (address && core.portLink(address) && wrap.__desc.api) wrap.__desc.api.props.release(address);
      };
      main.addEventListener("click", (event) => {
        event.stopPropagation();
        if (hasMedia(now())) {
          release();
          put(coerceMedia({}));
        } else file.click();
      });
      file.addEventListener("change", () => {
        take(file.files && file.files[0]);
        file.value = "";
      });
      shown.addEventListener("click", (event) => {
        event.stopPropagation();
        if (!hasMedia(now())) file.click();
      });
      shown.addEventListener("dragover", (event) => {
        if (event.dataTransfer && [...event.dataTransfer.types].includes("Files")) event.preventDefault();
      });
      shown.addEventListener("drop", (event) => {
        const chosen = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0];
        if (!chosen) return;
        event.preventDefault();
        take(chosen);
      });
      person.addEventListener("click", (event) => {
        event.stopPropagation();
        const target = describe(
          {
            type: TYPE,
            read: () => now().character || coerceCharacter({}),
            write: (_api, value) => put({ kind: "character", media: "", character: coerceCharacter(value), action: "" }),
          },
          { api: wrap.__desc.api, key: `${wrap.__desc.key}-character`, label: t("character.vtype.character") }
        );
        core.openValuePicker(target, person);
      });
      presets.addEventListener("click", (event) => {
        event.stopPropagation();
        const target = describe(
          {
            type: "image",
            read: () => (now().kind === "image" ? now().media : ""),
            write: (_api, value) => put({ kind: "image", media: String(value || ""), character: null, action: "" }),
          },
          { api: wrap.__desc.api, key: `${wrap.__desc.key}-picture`, label: t("character.value.media.image") }
        );
        core.openValuePicker(target, presets);
      });
      select.addEventListener("click", (event) => event.stopPropagation());
      select.addEventListener("change", () => put({ ...now(), action: select.value }));

      wrap.__parts = { ...parts, main, person, presets, shown, row, select };
      fw.controls["character.mediainput"].update(wrap, desc);
      return wrap;
    },
    update(wrap, desc) {
      wrap.__desc = desc;
      const { main, person, presets, shown, row, select } = wrap.__parts;
      const one = coerceMedia(desc.property.get());
      const filled = hasMedia(one);
      const readonly = Boolean(desc.readonly);
      wrap.__port = fw.card.portOf(desc);
      fw.card.syncHead(wrap, wrap.__parts, { port: wrap.__port });

      main.hidden = readonly;
      main.firstElementChild.className = `bi bi-${core.ICONS[filled ? "close" : "upload"] || (filled ? "x" : "upload")}`;
      main.lastElementChild.textContent = filled ? t("character.action.removeMedia") : t("character.action.uploadMedia");
      main.title = filled ? t("character.action.removeMedia") : t("character.action.uploadMediaTitle");
      person.hidden = readonly || desc.params.allowCharacter === false;
      person.title = t("character.action.pick");
      presets.hidden = readonly;
      presets.title = t("mu.action.presets", { type: t("character.value.media.image") });

      // What it shows: the picture or video, or what the character is doing.
      const showing = shownOf(one);
      const key = `${showing.kind}\u0000${showing.src}`;
      if (shown.__key !== key) {
        shown.__key = key;
        if (!showing.src) {
          shown.replaceChildren(el("span", "character-media-empty", { textContent: t(desc.params.allowCharacter === false ? "character.value.noMedia" : "character.value.noMediaOrCharacter") }));
        } else if (showing.kind === "video") {
          shown.replaceChildren(Object.assign(document.createElement("video"), { src: showing.src, muted: true, loop: true, autoplay: true, playsInline: true, preload: "metadata" }));
        } else {
          shown.replaceChildren(Object.assign(document.createElement("img"), { src: showing.src, alt: "", draggable: false }));
        }
      }
      shown.classList.toggle("is-empty", !showing.src);

      // The action, only for a character that has some.
      const actions = one.kind === "character" && one.character ? one.character.actions : [];
      row.hidden = !actions.length;
      const options = JSON.stringify(actions.map((a) => a.name));
      if (select.__options !== options) {
        select.__options = options;
        select.replaceChildren(
          el("option", "", { value: "", textContent: t("character.value.ownAction", { name: actions[0] ? actions[0].name || t("character.value.actionN", { n: 1 }) : "" }) }),
          ...actions.map((a, index) => el("option", "", { value: a.name, textContent: a.name || t("character.value.actionN", { n: index + 1 }) }))
        );
      }
      const wanted = actions.some((a) => a.name === one.action) ? one.action : "";
      if (select.value !== wanted) select.value = wanted;
      select.disabled = readonly;
      core.fitCardHead(wrap.__parts.head);
    },
  });

  // ---- the cards ------------------------------------------------------
  // Every card here is the shared card: a header with the grip on the left
  // and its buttons on the right (core.fitCardHead orders and folds them),
  // and the thing itself underneath.
  // The buttons keep the focus where it is. The grip must not: a cancelled
  // mousedown never starts the native drag it exists for.
  const cardButton = (className, iconName, { dragged = false } = {}) => {
    const one = el("button", `mu-icon-button ${className}`, { type: "button" });
    one.append(icon(iconName));
    if (!dragged) one.addEventListener("mousedown", (event) => event.preventDefault());
    return one;
  };
  const keepButton = (className) => {
    const one = cardButton(className, "preset");
    one.append(el("i", `bi bi-${core.ICONS.presetSave || "plus"} mu-icon-badge`));
    return one;
  };
  const portOf = (desc) => {
    if (desc.params.port) return desc.params.port;
    const item = desc.property && desc.property.item;
    return item ? { item: item.id, key: desc.property.key } : null;
  };
  const sizeKeyOf = (desc) => {
    const port = portOf(desc);
    return port
      ? core.portKey(port, "character")
      : `character:${desc.key}`;
  };

  // The whole character: the one card that takes one in and gives one out.
  // Its grip carries the character; a character carried here, or loaded
  // with the presets button, replaces it (the property is read/write), and
  // the keep button saves it to the library. Under the header, whether it
  // is saved and the ways to a new one; then who it is and what an app
  // gets from it -- the prompt, the sentence, the negative.
  //
  // Bound to a character put down on a scratch board, it only shows it.
  registerControl("character.card", {
    label: "character.control.card",
    why: "the whole character: a card that takes one in and gives one out, with its summary, state and the prompt it yields",
    needs: ["character"],
    params: ["port", "state", "onKeep", "onSaveAsNew", "onPresets", "onNew", "onDiscard"],
    render(desc) {
      const card = el("div", "mu-card mu-imagecard character-card");
      const presets = cardButton("character-card-presets", "preset");
      const keep = keepButton("character-card-keep");
      // The shell card's header: grip, name, what it follows, these, shrink, remove.
      const parts = fw.card.buildHead("mu-imagecard", { tools: [presets, keep], onDiscard: () => call("onDiscard") });
      const head = parts.head;

      card.append(head);
      const crumbs = fw.card.bar(card);
      crumbs.classList.add("workflow-card-crumbs", "character-card-crumbs");
      const state = el("span", "character-card-state");
      const saveNew = el("button", "mu-item-button character-card-savenew", { type: "button" });
      const fresh = el("button", "mu-item-button character-card-new", { type: "button" });
      crumbs.append(state, el("span", "mu-card-gap workflow-card-gap"), saveNew, fresh);

      const body = el("div", "character-card-body");
      const out = el("dl", "character-card-out");
      body.append(summaryShell(), out);
      card.append(body);
      card.__parts = { ...parts, presets, keep, crumbs, state, saveNew, fresh, body, out };

      const call = (name, ...args) => {
        const fn = card.__desc.params[name];
        if (fn) fn(...args);
      };
      presets.addEventListener("click", (event) => {
        event.stopPropagation();
        call("onPresets", presets);
      });
      keep.addEventListener("click", (event) => {
        event.stopPropagation();
        call("onKeep");
      });
      saveNew.addEventListener("click", (event) => {
        event.stopPropagation();
        call("onSaveAsNew");
      });
      fresh.addEventListener("click", (event) => {
        event.stopPropagation();
        call("onNew");
      });
      fw.controls["character.card"].update(card, desc);
      return card;
    },
    update(card, desc) {
      card.__desc = desc;
      const p = desc.params;
      const { head, presets, keep, crumbs, state, saveNew, fresh, body, out } = card.__parts;
      const c = coerceCharacter(desc.property.character());
      // Its size is kept by the property's address, in the layout.
      const sizeKey = sizeKeyOf(desc);
      const small = core.cardIsShrunk(sizeKey);
      core.setCardSizeClass(card, small);
      fw.card.syncHead(card, card.__parts, {
        port: fw.card.portOf(desc),
        name: desc.head,
        onDiscard: p.onDiscard,
        size: {
          full: !small,
          title: t(small ? "mu.action.growCard" : "mu.action.shrinkCard"),
          toggle: () => {
            core.setCardShrunk(sizeKey, !small);
            fw.controls["character.card"].update(card, card.__desc);
          },
        },
      });
      presets.hidden = !p.onPresets;
      presets.title = t("mu.action.presets", { type: t("character.vtype.character") });
      keep.hidden = !p.onKeep;
      keep.title = t("character.action.save");
      core.fitCardHead(head);

      crumbs.hidden = !p.state;
      state.textContent = p.state ? t(`character.state.${p.state}`) : "";
      state.dataset.state = p.state || "";
      saveNew.hidden = !p.onSaveAsNew;
      saveNew.textContent = t("character.action.saveAsNew");
      fresh.hidden = !p.onNew;
      fresh.textContent = t("character.action.new");

      paintSummary(body.firstElementChild, summaryOf(c));
      const rows = [["text", YIELDS["value.prompt_single"](c)]];
      const said = JSON.stringify(rows);
      if (out.__said !== said) {
        out.__said = said;
        out.replaceChildren(
          ...rows.flatMap(([key, value]) => [
            el("dt", "", { textContent: t(`character.output.${key}`) }),
            el("dd", value ? "" : "is-empty", { textContent: value || "—" }),
          ])
        );
      }
    },
  });

  // Two read-only galleries make up the dedicated preview window. Each
  // keeps its DOM while the other part of the character is edited, so an
  // unchanged image is not decoded again on every redraw.
  const registerPreviewPanel = (name, labelKey, emptyKey, entriesOf, fields, renderEntry, why) => {
    registerControl(name, {
      label: labelKey,
      why,
      params: ["character"],
      render(desc) {
        const panel = el("div", `character-preview-panel ${name.replace(/\./g, "-")}`);
        const list = el("div", "character-preview-items");
        panel.append(list);
        fw.controls[name].update(panel, desc);
        return panel;
      },
      update(panel, desc) {
        const character = coerceCharacter(desc.params.character);
        const entries = entriesOf(character);
        const previous = panel.__entries;
        const same = Array.isArray(previous) && previous.length === entries.length && previous.every((one, index) =>
          fields.every((field) => one[field] === entries[index][field])
        );
        if (same) return;
        panel.__entries = entries.map((one) => Object.fromEntries(fields.map((field) => [field, one[field]])));
        const children = entries.length
          ? entries.map((one, index) => renderEntry(one, index))
          : [el("div", "character-preview-empty", { textContent: t(emptyKey) })];
        panel.firstElementChild.replaceChildren(...children);
      },
    });
  };

  const mediaPreview = (src, kind, alt = "") => {
    if (!src) return el("div", "character-preview-empty", { textContent: t("character.preview.noMedia") });
    if (kind === "video") {
      const video = el("video", "character-preview-media", {
        src, muted: true, loop: true, autoplay: true, playsInline: true, preload: "metadata",
      });
      video.setAttribute("aria-label", alt);
      return video;
    }
    return el("img", "character-preview-media", { src, alt, draggable: false, loading: "lazy" });
  };
  const referenceEntry = (reference, index) => {
    const card = el("article", "character-preview-entry");
    card.append(el("h3", "character-preview-entry-title", {
      textContent: reference.name || t("character.references.itemN", { n: index + 1 }),
    }));
    if (reference.kind === "text") {
      card.append(reference.data
        ? el("div", "character-preview-text", { textContent: reference.data })
        : el("div", "character-preview-empty", { textContent: t("character.preview.noContent") }));
    } else card.append(mediaPreview(reference.data, reference.kind, reference.name));
    return card;
  };
  const actionEntry = (action, index) => {
    const card = el("article", "character-preview-entry");
    card.append(el("h3", "character-preview-entry-title", {
      textContent: action.name || t("character.value.actionN", { n: index + 1 }),
    }));
    card.append(mediaPreview(action.media, action.kind, action.name));
    return card;
  };

  registerPreviewPanel(
    "character.referencepreview",
    "character.preview.references",
    "character.preview.noReferences",
    (character) => character.references,
    ["id", "name", "kind", "data"],
    referenceEntry,
    "shows every named text and media reference together in a read-only gallery"
  );
  registerPreviewPanel(
    "character.actionpreview",
    "character.preview.actions",
    "character.preview.noActions",
    (character) => character.actions,
    ["name", "kind", "media"],
    actionEntry,
    "shows every action's picture or video together in a read-only gallery"
  );



  return defs;
}
