/* Prompt Editor -- promptmanager's main screen, ported. (Called the
 * Prompt Assembler until 2026-10; the type id is still prompt.assembler.)
 *
 * A prompt is built out of parts. A part is a name and some tags, saved in
 * the library, carrying its own category. A template is a
 * list of slots, and a slot is one part with a weight and a note of which
 * categories to look in when picking another. Assembling is then just:
 * take each slot's part, and
 * join the tags.
 *
 * Two items, because there are two jobs. The document -- the template --
 * lives on `prompt.slots`, which is where it is edited; `prompt.assembler`
 * owns one of those and shows the result. Put the editor in its own window
 * and you have the sidebar-and-preview arrangement of the original, two
 * windows onto one document.
 *
 * The parts a slot holds are copies, not references: a slot is a decision
 * about what to say, and it should not change under you because somebody
 * edited the saved part. Templates are the other way round -- they are saved
 * and loaded as a whole, through the preset control on `slots`.
 */

// What a prompt generator's run is kept as: a line of the run history.
import { keepRun, runKind } from "../workflow/runner.js";
import { coerceTag, coerceTags, newTagId, retag, tagEntries, tagTexts } from "./tags.js";
import { candidateLines, indexOf as tagIndexOf, retrieve, snapAll } from "./rag.js";

export default function createPrompt(api) {
  const { core, describe, describeProperty } = api;
  // What this plugin draws and how its values behave, for the plugin's scripts to hand to the shell
  // (`export const controls` / `types`); the shell's own controls are the prototype of `controls`.
  const controls = Object.create(api.controls || null);
  const typeHooks = {};
  const registerControl = (id, def) => {
    controls[id] = def;
  };
  const registerValueType = (id, def) => {
    typeHooks[id] = def;
  };
  const { NODES, refreshAll, row, t } = core;
  const { groupsIn } = api.grouping;

  // ---- the values ------------------------------------------------------
  // Both records are repaired rather than trusted: a value may come from a
  // saved layout, from the database, or from a control mid-edit, and coerce
  // is the one door all three go through.
  const coercePart = (value) => {
    const from = value && typeof value === "object" ? value : {};
    return {
      name: typeof from.name === "string" ? from.name : "",
      tags: coerceTags(from.tags),
      // Which sort of part this is: an expression, a pose. It is in the
      // value because it is a fact about this part, and because the
      // library has nowhere else to put it -- a saved value is addressed
      // by its type and its name and nothing more.
      category: typeof from.category === "string" ? from.category : "",
    };
  };

  // A sentence: the same record as a part with a line of prose where the
  // tags were. For a model that reads language rather than tags -- Wan's
  // umt5, Qwen -- where "a girl walks toward the camera, then waves" says
  // what a list of tags cannot: who does what, in which order.
  const coerceSentence = (value) => {
    const from = value && typeof value === "object" ? value : {};
    return {
      name: typeof from.name === "string" ? from.name : "",
      text: typeof from.text === "string" ? from.text : "",
      category: typeof from.category === "string" ? from.category : "",
    };
  };
  const SENTENCE = "sentence";

  // ---- one prompt ------------------------------------------------------
  // A tag list or a line of text, and how much it weighs. That is all a
  // prompt is now: what was a slot -- a part copied out of the library,
  // the categories to look in for another, a name -- became more than one
  // row could show, and choosing is done elsewhere and carried here (see
  // ports in core.js). The id is what keeps an entry of a list the same
  // entry while the list is reordered, so a link to it stays put.
  const TAGS = "tags";
  const TEXT = "text";
  let promptSeq = 0;
  const newPromptId = () => `p${Date.now().toString(36)}${(promptSeq++).toString(36)}`;
  const splitTags = (line) =>
    String(line ?? "")
      .split(",")
      .map((one) => one.trim())
      .filter(Boolean);

  // Every shape a prompt has been saved in reads: a slot holding a part or
  // a sentence, a shortlist with an index, and this.
  const coerceSlot = (value, fallbackId = "") => {
    const from = value && typeof value === "object" ? value : {};
    let old = from.part && typeof from.part === "object" ? from.part : null;
    if (!old && Array.isArray(from.parts) && from.parts.length) {
      const chosen = Number(from.chosen);
      old = from.parts[Number.isInteger(chosen) && chosen >= 0 && chosen < from.parts.length ? chosen : 0] || null;
    }
    const oldIsText = Boolean(old && typeof old.text === "string" && !Array.isArray(old.tags));
    const kind = from.kind === TEXT || from.kind === SENTENCE || (!from.kind && oldIsText) ? TEXT : TAGS;
    const tags = Array.isArray(from.tags) ? from.tags : old && Array.isArray(old.tags) ? old.tags : [];
    const text = typeof from.text === "string" ? from.text : old && typeof old.text === "string" ? old.text : "";
    const weight = Number(from.weight);
    return {
      id: typeof from.id === "string" && from.id ? from.id : fallbackId,
      kind,
      tags: kind === TAGS ? coerceTags(tags) : [],
      text: kind === TEXT ? text : "",
      weight: Number.isFinite(weight) && weight > 0 ? weight : 1,
    };
  };

  // A list of them, each with an id of its own. One read before it was
  // ever written gets one from its place, which it keeps once written.
  const coercePrompts = (list) => {
    const seen = new Set();
    return (Array.isArray(list) ? list : []).map((raw, index) => {
      const one = coerceSlot(raw, `p${index}`);
      if (!one.id || seen.has(one.id)) one.id = `p${index}`;
      while (seen.has(one.id)) one.id = newPromptId();
      seen.add(one.id);
      return one;
    });
  };

  const promptText = (one) => (one.kind === TEXT ? one.text.trim() : tagTexts(one.tags).join(", "));
  // The tags a prompt says, as entries: a text prompt is the one tag it is.
  const promptTags = (one) => (one.kind === TEXT ? tagEntries([one.text]) : one.tags);
  // What typing into a row does: text is kept as typed, a tag list is the
  // tags the line holds.

  const partName = (part) => {
    if (part && typeof part.text === "string" && !Array.isArray(part.tags)) {
      const one = coerceSentence(part);
      return one.name || one.text || t("prompt.value.empty");
    }
    const one = coercePart(part);
    return one.name || tagTexts(one.tags).join(", ") || t("prompt.value.empty");
  };

  // One prompt part: what it is called, the tags it contributes, and what
  // sort of part it is. All three are in the value, including the name --
  // a slot holds a copy of a part, and a copy that lost its name would be
  // unreadable.
  registerValueType("prompt.part", {
    label: "prompt.vtype.part",
    icon: "tag",
    params: ["default"],
    sample: {
      default: { name: "blue eyes", tags: tagEntries(["blue eyes", "detailed eyes"]), category: "character" },
    },
    // This type divides its own values, and this is the whole of how the
    // shell learns that. Nothing else in Mullion knows what a category is:
    // the picker's filter, the library's listing and the inventory all work
    // from this declaration, which is why they need no prompt-specific code
    // and why the database can stay one flat table.
    groups: {
      label: "prompt.field.category",
      of: (value) => (value && typeof value === "object" ? value.category : ""),
    },
    // The properties a part's value holds. A field keeps how it is shown
    // beside its type: the frame decides that, not the place that uses it.
    // The tags carry no control here: what a tag card needs (a model to write
    // them with, what to start from) comes from where it stands, so
    // presetEditor sets that field up itself.
    fields: {
      name: { type: "string" },
      category: {
        type: "prompt.category",
        control: "preset",
        inner: "textbox",
        placeholder: "prompt.placeholder.category",
      },
      tags: { type: "list", each: { type: "prompt.tag", placeholder: "prompt.placeholder.oneTag" } },
    },
    defaultControl: "prompt.partedit",
    // A part carries its own name, so a preset of one is called what the
    // part is called -- the maker asks for no second name.
    presetName: (value) => coercePart(value).name,
    // Made as three rows rather than the compact editor: the name, the
    // category -- with its own presets, so an existing one is picked
    // rather than retyped -- and the tags as a list, one per row.
    presetEditor: (desc) => {
      // A field the part declares, drawn as the property it is.
      const inField = (key, label, params = null) =>
        describeProperty(desc.property.field(key), { key: `${desc.key}-${key}`, label: t(label), params });
      return {
        fields: [
          inField("name", "prompt.field.name"),
          inField("category", "prompt.field.oneCategory"),
          {
            ...inField("tags", "prompt.field.tags", { control: "prompt.tagcard" }),
            // Across the whole screen: two columns of cards in half a row
            // left each tag a quarter of it.
            wide: true,
          },
        ],
      };
    },
    defaultValue: (p) => coercePart(p.default),
    coerce: (value) => coercePart(value),
    format: (value) => partName(value),
    methods: {
      name: (p) => coercePart(p.get()).name,
      setName: (p, name) => p.set({ ...coercePart(p.get()), name: String(name) }),
      // The tags as words, for the chips: setting them again keeps the
      // entry of every word that is still there.
      tags: (p) => tagTexts(coercePart(p.get()).tags),
      setTags: (p, texts) => {
        const part = coercePart(p.get());
        return p.set({ ...part, tags: retag(texts, part.tags) });
      },
      category: (p) => coercePart(p.get()).category,
      setCategory: (p, category) =>
        p.set({ ...coercePart(p.get()), category: String(category || "") }),
      // What this part contributes to the assembled prompt.
      text: (p) => tagTexts(coercePart(p.get()).tags).join(", "),
    },
  });

  // ---- the tags of a part, as a card ------------------------------------
  // The tags a part is made with: the shell's card grid over the list, as cards in two columns.
  // (The card used to have a second view in which a model wrote them from a description; that
  // was dropped on 2026-11-05 -- the AI prompt generator does it now. The sentence card below
  // still has one.)
  //
  // The model the sentence card asks of is remembered for the session -- choosing it once is enough.
  let tagModel = "";
  let knownModels = null;

  registerControl("prompt.tagcard", {
    label: "prompt.control.tagcard",
    needs: ["items", "set", "blank"],
    params: ["each"],
    render(desc, onChange) {
      const card = document.createElement("div");
      card.className = "prompt-tagcard";
      const body = document.createElement("div");
      body.className = "prompt-tagcard-body prompt-tagcard-manual";
      body.append(controls.cardgrid.render(desc, (value) => onChange(value)));
      card.append(body);
      return card;
    },
    update(card, desc) {
      controls.cardgrid.update(card.firstElementChild.firstElementChild, desc);
    },
  });

  // The models, asked once per session and when the sentence card's AI view first opens.
  function loadModels(card, control = "prompt.tagcard") {
    if (knownModels || card.__loading) return;
    const models = card.__desc.params.models;
    if (typeof models !== "function") return;
    card.__loading = true;
    Promise.resolve(models())
      .then((list) => {
        knownModels = (Array.isArray(list) ? list : []).map(String).filter(Boolean);
      })
      .catch((error) => {
        knownModels = [];
        card.__note = t("prompt.status.ollamaFailed", { error: error.message || error });
      })
      .finally(() => {
        card.__loading = false;
        controls[control].update(card, card.__desc);
      });
  }

  // A part's category, as a value of its own: a word, but one that can be
  // kept as a preset and picked from a chooser rather than retyped. What
  // the chooser offers is what is kept of it, and every category parts are
  // already filed under besides -- those exist whether anyone kept them.
  registerValueType("prompt.category", {
    base: "string",
    label: "prompt.vtype.category",
    icon: "bookmark",
    sample: { default: "" },
    presetName: (value) => String(value || ""),
    // The categories parts and sentences are already filed under: one
    // list, since "camera" is a category whichever way it is said.
    offers: () => {
      const seen = new Set();
      return [...groupsIn("prompt.part"), ...groupsIn("prompt.sentence")]
        .filter((one) => one.id && !seen.has(one.id) && seen.add(one.id))
        .map((one) => ({ id: `category:${one.id}`, name: one.label, value: one.id }));
    },
  });

  // ---- a sentence --------------------------------------------------------
  // Saved and grouped the way a part is -- by its own category -- and edited
  // as three rows: a name, a category, and the sentence itself in a box
  // big enough to read it in.
  registerValueType("prompt.sentence", {
    label: "prompt.vtype.sentence",
    icon: "chat-quote",
    params: ["default"],
    sample: {
      default: { name: "slow push-in", text: "The camera slowly pushes in toward her face.", category: "camera" },
    },
    groups: {
      label: "prompt.field.category",
      of: (value) => (value && typeof value === "object" ? value.category : ""),
    },
    defaultControl: "prompt.sentenceedit",
    presetName: (value) => coerceSentence(value).name,
    presetEditor: (desc) => {
      const one = () => coerceSentence(desc.property.get());
      const set = (patch) => desc.property.set({ ...one(), ...patch });
      const field = (key, label, spec, read, write) =>
        describe(
          { ...spec, read: () => read(one()), write: (_api, value) => write(value) },
          { api: desc.api, key: `${desc.key}-${key}`, label: t(label) }
        );
      return {
        fields: [
          field("name", "prompt.field.name", { type: "string" }, (v) => v.name, (v) => set({ name: String(v) })),
          field(
            "category",
            "prompt.field.oneCategory",
            { type: "prompt.category", control: "preset", inner: "textbox", placeholder: "prompt.placeholder.category" },
            (v) => v.category,
            (v) => set({ category: String(v || "") })
          ),
          {
            ...field(
              "text",
              "prompt.field.sentence",
              {
                type: "string",
                control: "prompt.sentencecard",
                // Written by a model from a description, which starts as
                // the preset name and its category -- as a part's tags are.
                instruction: () => [one().name, one().category].filter(Boolean).join(" / "),
                models: async () => ((await desc.api.ollama.status()) || {}).models || [],
                generate: async ({ instruction, model, current }) => {
                  const reply = await desc.api.ollama.generate({
                    model,
                    system: SENTENCE_SYSTEM,
                    prompt: current ? `${instruction}\n\nCurrent text to improve:\n${current}` : instruction,
                    format: SENTENCE_FORMAT,
                  });
                  return sentenceFromResponse(reply && reply.response);
                },
              },
              (v) => v.text,
              (v) => set({ text: String(v ?? "") })
            ),
            wide: true,
          },
        ],
      };
    },
    defaultValue: (p) => coerceSentence(p.default),
    coerce: (value) => coerceSentence(value),
    format: (value) => partName(coerceSentence(value)),
    methods: {
      name: (p) => coerceSentence(p.get()).name,
      setName: (p, name) => p.set({ ...coerceSentence(p.get()), name: String(name) }),
      category: (p) => coerceSentence(p.get()).category,
      setCategory: (p, category) => p.set({ ...coerceSentence(p.get()), category: String(category || "") }),
      text: (p) => coerceSentence(p.get()).text,
      setText: (p, text) => p.set({ ...coerceSentence(p.get()), text: String(text ?? "") }),
    },
  });

  // ---- a sentence, as a card ---------------------------------------------
  // The tag card's twin: a header switching between writing the sentence
  // by hand and having a model write it from a description. The model's
  // answer replaces the sentence -- a sentence is one thing, not a set to
  // add to -- and, when there is a sentence already, the model is shown it
  // to improve on rather than starting again. Which model is shared with
  // the tag card: it is the same Ollama, and choosing once is enough.
  registerControl("prompt.sentencecard", {
    label: "prompt.control.sentencecard",
    needs: ["setText"],
    params: ["instruction", "models", "generate", "placeholder"],
    render(desc, onChange) {
      const card = document.createElement("div");
      card.className = "prompt-tagcard prompt-sentencecard";
      card.__desc = desc;
      card.__onChange = onChange;
      card.__view = "manual";

      const head = document.createElement("div");
      head.className = "prompt-tagcard-head";
      const viewDesc = describe(
        {
          type: "enum",
          control: "segments",
          labels: "selected",
          options: () => [
            { value: "manual", label: t("prompt.opt.sentenceManual"), icon: "pencil" },
            { value: "ai", label: t("prompt.opt.tagsAi"), icon: "stars" },
          ],
          read: () => card.__view,
          write: (_api, value) => {
            card.__view = value === "ai" ? "ai" : "manual";
            controls["prompt.sentencecard"].update(card, card.__desc);
            if (card.__view === "ai") loadModels(card, "prompt.sentencecard");
          },
        },
        { key: `${desc.key}-view`, label: t("prompt.field.sentence") }
      );
      card.__viewDesc = viewDesc;
      head.append(controls.segments.render(viewDesc, (value) => viewDesc.property.set(value)));

      const manual = document.createElement("div");
      manual.className = "prompt-tagcard-body";
      const area = document.createElement("textarea");
      area.className = "input prompt-sentence-text";
      area.rows = 5;
      area.placeholder = t(desc.params.placeholder || "prompt.placeholder.sentence");
      area.addEventListener("input", () => card.__onChange(area.value));
      manual.append(area);

      const ai = document.createElement("div");
      ai.className = "prompt-tagcard-body prompt-tagcard-ai";
      const model = document.createElement("select");
      model.className = "input prompt-tagcard-model";
      model.addEventListener("change", () => {
        tagModel = model.value;
      });
      const instruction = document.createElement("textarea");
      instruction.className = "input prompt-tagcard-instruction";
      instruction.rows = 3;
      instruction.placeholder = t("prompt.placeholder.sentenceInstruction");
      instruction.addEventListener("input", () => {
        card.__instruction = instruction.value;
      });
      const row = document.createElement("div");
      row.className = "mu-item-actions";
      const run = document.createElement("button");
      run.type = "button";
      run.className = "mu-item-button prompt-tagcard-run";
      run.addEventListener("click", () => generateSentence(card));
      const note = document.createElement("span");
      note.className = "prompt-tagcard-note";
      row.append(run, note);
      ai.append(model, instruction, row);

      card.append(head, manual, ai);
      controls["prompt.sentencecard"].update(card, desc);
      return card;
    },
    update(card, desc) {
      card.__desc = desc;
      const canAsk = typeof desc.params.generate === "function";
      if (!canAsk) card.__view = "manual";
      const [head, manual, ai] = card.children;
      head.hidden = !canAsk;
      controls.segments.update(head.firstElementChild, { ...card.__viewDesc, value: card.__view });
      manual.hidden = card.__view !== "manual";
      ai.hidden = card.__view !== "ai";
      const area = manual.firstElementChild;
      const text = String(desc.value ?? "");
      if (document.activeElement !== area && area.value !== text) area.value = text;

      const [model, instruction, row] = ai.children;
      if (card.__instruction === undefined && desc.params.instruction) {
        const start = desc.params.instruction();
        if (document.activeElement !== instruction && instruction.value !== start) instruction.value = start;
      }
      const models = knownModels || [];
      const wanted = models.includes(tagModel) ? tagModel : models[0] || "";
      const shown = Array.from(model.options).map((one) => one.value);
      if (shown.join("\u0000") !== models.join("\u0000")) {
        model.replaceChildren(
          ...models.map((name) => Object.assign(document.createElement("option"), { value: name, textContent: name }))
        );
      }
      if (model.value !== wanted) model.value = wanted;
      model.disabled = !models.length;
      const [runButton, note] = row.children;
      runButton.textContent = card.__busy
        ? t("prompt.action.generatingSentence")
        : t(text.trim() ? "prompt.action.improveSentence" : "prompt.action.generateSentence");
      runButton.disabled = Boolean(card.__busy) || !models.length;
      note.textContent = card.__note || (knownModels && !models.length ? t("prompt.status.noModel") : "");
    },
  });

  async function generateSentence(card) {
    const desc = card.__desc;
    const [, , ai] = card.children;
    const [model, instruction] = ai.children;
    const asked = instruction.value.trim();
    if (!asked) {
      card.__note = t("prompt.status.noInstruction");
      controls["prompt.sentencecard"].update(card, desc);
      return;
    }
    card.__busy = true;
    card.__note = "";
    controls["prompt.sentencecard"].update(card, desc);
    try {
      const current = String(desc.value ?? "").trim();
      const written = await desc.params.generate({ instruction: asked, model: model.value, current });
      if (!written) throw new Error(t("prompt.status.nothingWritten"));
      card.__view = "manual";
      card.__onChange(written);
    } catch (error) {
      card.__note = t("prompt.status.ollamaFailed", { error: error.message || error });
    } finally {
      card.__busy = false;
      controls["prompt.sentencecard"].update(card, card.__desc);
    }
  }

  // What the model is asked to do: prose for a model that reads prose. Wan
  // and its kind were trained on captions of video, so what helps is what
  // a caption says -- who, doing what, in which order, how the camera
  // moves -- and not tags, weights or a list.
  const SENTENCE_SYSTEM = [
    "You write one passage of a prompt for a text-to-video / image model that reads natural language (Wan 2.2, Qwen-Image).",
    "The user describes one element of the scene, possibly in Japanese. Write it in English.",
    "Use plain present-tense sentences: the subject, what it does in order, and, if relevant, how the camera moves and the look of the shot.",
    "One to three sentences. No tags, no lists, no weights or brackets, no quotation marks, no preamble.",
    "If a current text is given, rewrite it to follow the user's description, keeping what still fits.",
    "Reply with JSON only: {\"text\": \"...\"}.",
  ].join("\n");

  const SENTENCE_FORMAT = {
    type: "object",
    properties: { text: { type: "string" } },
    required: ["text"],
  };

  function sentenceFromResponse(response) {
    const raw = String(response || "").trim();
    let parsed = null;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      const match = raw.match(/\{[\s\S]*\}/);
      if (match) {
        try {
          parsed = JSON.parse(match[0]);
        } catch (inner) {
          parsed = null;
        }
      }
    }
    // A model that ignored the format usually still wrote the sentence.
    const text = parsed && typeof parsed.text === "string" ? parsed.text : raw;
    return text.replace(/^["'\s]+|["'\s]+$/g, "").replace(/\s+/g, " ").trim();
  }

  // A sentence where it is placed as a property: the sentence in a box,
  // the name and category being the library's business.
  registerControl("prompt.sentenceedit", {
    label: "prompt.control.sentenceedit",
    needs: ["text", "setText"],
    render(desc, onChange) {
      const area = document.createElement("textarea");
      area.className = "input mu-prop-note";
      area.rows = 3;
      area.placeholder = t("prompt.placeholder.sentence");
      area.value = desc.property.text();
      area.addEventListener("input", () => desc.property.setText(area.value));
      return area;
    },
    update(el, desc) {
      if (document.activeElement !== el) el.value = desc.property.text();
    },
  });

  // One prompt (see coerceSlot): a tag list or a line of text, and its
  // weight. Carried as a "prompt"; text or a tag list put into one becomes
  // its content (conversions below).
  registerValueType("prompt.slot", {
    label: "prompt.vtype.slot",
    icon: "chat-left-text",
    port: "prompt",
    identity: "id",
    // A prompt put over one brings its own weight; text or tags put into an
    // entry take the weight the entry already had.
    portPut: (entry, value, _kind, fromKind) => {
      const incoming = coerceSlot(value, entry.id);
      return { ...incoming, id: entry.id, weight: fromKind === "prompt" ? incoming.weight : entry.weight };
    },
    params: ["default"],
    sample: { default: { kind: TAGS, tags: tagEntries(["blue eyes"]), weight: 1 } },
    defaultControl: "prompt.promptline",
    defaultValue: (p) => coerceSlot(p.default, "p0"),
    coerce: (value) => coerceSlot(value, "p0"),
    coerceList: coercePrompts,
    list: { port: "promptlist", label: "prompt.vtype.template", icon: "list-columns-reverse", defaultControl: "prompt.promptlist", presetEditor: (_desc, { itemId }) => ({ control: "prompt.promptlist", itemId }) },
    format: (value) => {
      const one = coerceSlot(value);
      const text = promptText(one) || t("prompt.value.empty");
      return one.weight === 1 ? text : `${text} × ${one.weight}`;
    },
    methods: {
      weight: (p) => coerceSlot(p.get()).weight,
      setWeight: (p, weight) => p.set({ ...coerceSlot(p.get()), weight }),
      text: (p) => promptText(coerceSlot(p.get())),
      kind: (p) => coerceSlot(p.get()).kind,
    },
  });

  // One tag: {id, text}. The id keeps it the same tag while the list around
  // it is edited or carried, which is what lets a tag be a property of its
  // own, with a port of its own. Its one field is its text.
  registerValueType("prompt.tag", {
    label: "prompt.vtype.tag",
    icon: "tag",
    port: "tag",
    identity: "id",
    params: ["default", "placeholder"],
    fields: { text: { type: "string" } },
    sample: { default: { id: "t0", text: "blue eyes" } },
    defaultControl: "prompt.tagline",
    defaultValue: () => ({ id: newTagId(), text: "" }),
    coerce: (value) => coerceTag(value),
    coerceList: coerceTags,
    list: { port: "taglist", preview: { control: "badges", options: { value: { bind: "value" } } }, label: "prompt.vtype.tags", icon: "tags", each: { placeholder: "prompt.placeholder.oneTag" } },
    format: (value) => coerceTag(value).text || "\u2014",
    methods: {
      text: (p) => coerceTag(p.get()).text,
      setText: (p, text) => p.set({ ...coerceTag(p.get()), text: String(text ?? "") }),
    },
  });

  // What the AI generator is asked for, in words. A type of its own so the
  // descriptions saved as presets are a shelf of their own, not every
  // string in the library.
  registerValueType("prompt.description", {
    base: "string",
    label: "prompt.vtype.description",
    icon: "chat-square-text",
  });

  // A prompt's text, saved on a shelf of its own: what the preset button
  // of a text prompt loads and saves (a tag prompt uses prompt.tags).
  registerValueType("prompt.text", {
    base: "string",
    label: "prompt.vtype.text",
    icon: "text-paragraph",
  });

  // ---- how one kind is read as another ---------------------------------
  // So that the place a value lands does not have to be the same kind as
  // where it came from: a prompt list linked into a run's text prompt is
  // the prompt it adds up to, a line of text pasted into a row is that row's
  // text. One step each; the ids a conversion makes are fixed, so a link
  // through one does not see a new list on every pass.
  {
    const conv = core.registerPortConversion;
    const asPrompt = (kind, body) => ({ id: "p0", kind, tags: [], text: "", weight: 1, ...body });
    conv("taglist", "text", (tags) => tagTexts(tags).join(", "));
    conv("text", "taglist", (text) => tagEntries(splitTags(text)));
    conv("prompt", "text", (one) => assemble([one], ", "));
    conv("prompt", "taglist", (one) => tagEntries(tagTexts(promptTags(coerceSlot(one)))));
    conv("text", "prompt", (text) => asPrompt(TEXT, { text: String(text ?? "") }));
    conv("taglist", "prompt", (tags) => asPrompt(TAGS, { tags: coerceTags(tags) }));
    conv("promptlist", "text", (list) => assemble(list, ", "));
    conv("promptlist", "taglist", (list) => tagEntries(coercePrompts(list).flatMap((one) => tagTexts(promptTags(one)))));
    // One tag, and the words it says.
    conv("tag", "text", (tag) => coerceTag(tag).text);
    conv("text", "tag", (text) => ({ id: "t0", text: String(text ?? "").trim() }));
    // Nothing becomes a whole prompt list but a prompt list: text or tags
    // dropped on a list go into one prompt, or onto its add button.
  }

  // ---- the controls ----------------------------------------------------
  // A line of tags, however it was typed: "a, b, c" or one at a time. Tags
  // are a set -- the same tag twice in one part means nothing -- so they
  // are added rather than appended.
  const commitTags = (desc, line) => {
    const wanted = String(line)
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean);
    if (!wanted.length) return;
    const tags = desc.property.tags();
    wanted.forEach((tag) => {
      if (!tags.includes(tag)) tags.push(tag);
    });
    desc.property.setTags(tags);
  };

  // The part editor: a name, and its tags as chips. Matched by method, so
  // any type that can answer name/tags can be edited with it.
  registerControl("prompt.partedit", {
    label: "prompt.control.partedit",
    needs: ["name", "setName", "tags", "setTags", "category", "setCategory"],
    render(desc) {
      const wrap = document.createElement("div");
      wrap.className = "prompt-part";

      const name = document.createElement("input");
      name.type = "text";
      name.className = "input prompt-part-name";
      name.placeholder = t("prompt.placeholder.partName");
      name.addEventListener("input", () => desc.property.setName(name.value));

      const chips = document.createElement("div");
      chips.className = "prompt-chips";

      const add = document.createElement("input");
      add.type = "text";
      add.className = "input prompt-chip-add";
      add.placeholder = t("prompt.placeholder.tag");
      // Enter commits, and so does a comma: tags usually arrive as a
      // comma-separated line, and splitting one beats retyping it.
      add.addEventListener("keydown", (event) => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        commitTags(desc, add.value);
        add.value = "";
      });
      add.addEventListener("input", () => {
        if (!add.value.includes(",")) return;
        commitTags(desc, add.value);
        add.value = "";
      });

      // What sort of part this is. A plain field with suggestions rather
      // than a list to pick from: the categories that exist are the ones
      // parts are in, so typing a new one is how a new category comes to
      // exist, and that has to be possible here or nowhere.
      const category = document.createElement("input");
      category.type = "text";
      category.className = "input prompt-part-category";
      category.placeholder = t("prompt.placeholder.category");
      category.setAttribute("list", "prompt-categories");
      category.addEventListener("input", () => desc.property.setCategory(category.value));

      wrap.append(name, category, chips, add);
      wrap.__desc = desc;
      // Through update(), so the fields are filled the same way on the
      // first pass as on every later one. Painting only the chips here left
      // the name and the category blank until something else caused a
      // redraw.
      controls["prompt.partedit"].update(wrap, desc);
      return wrap;
    },
    update(el, desc) {
      el.__desc = desc;
      const name = el.querySelector(".prompt-part-name");
      // Never fight the person typing: the same rule every editor follows.
      if (document.activeElement !== name && name.value !== desc.property.name()) {
        name.value = desc.property.name();
      }
      const category = el.querySelector(".prompt-part-category");
      if (document.activeElement !== category && category.value !== desc.property.category()) {
        category.value = desc.property.category();
      }
      paintChips(el, desc);
      paintCategories();
    },
  });

  // The suggestions behind every category field. One list for the document
  // rather than one per editor, because the answer does not depend on which
  // part is open.
  function paintCategories() {
    let list = document.getElementById("prompt-categories");
    if (!list) {
      list = document.createElement("datalist");
      list.id = "prompt-categories";
      document.body.append(list);
    }
    const known = groupsIn("prompt.part").map((one) => one.id).filter(Boolean);
    const shown = Array.from(list.children).map((option) => option.value);
    if (shown.join("\u0000") === known.join("\u0000")) return;
    list.replaceChildren(
      ...known.map((id) => Object.assign(document.createElement("option"), { value: id }))
    );
  }

  function paintChips(el, desc) {
    const chips = el.querySelector(".prompt-chips");
    const tags = desc.property.tags();
    // Keyed by the tag itself: a tag is its own identity, so a chip is
    // reused when the list is reordered rather than rewritten.
    const existing = new Map();
    Array.from(chips.children).forEach((chip) => existing.set(chip.dataset.tag, chip));
    chips.replaceChildren(
      ...tags.map((tag) => {
        const found = existing.get(tag);
        if (found) return found;
        const chip = document.createElement("span");
        chip.className = "prompt-chip";
        chip.dataset.tag = tag;
        const label = document.createElement("span");
        label.textContent = tag;
        const drop = document.createElement("button");
        drop.type = "button";
        drop.className = "prompt-chip-drop";
        drop.textContent = "×";
        drop.title = t("prompt.action.dropTag");
        drop.addEventListener("mousedown", (event) => event.preventDefault());
        drop.addEventListener("click", (event) => {
          event.stopPropagation();
          const current = el.__desc;
          current.property.setTags(current.property.tags().filter((one) => one !== tag));
        });
        chip.append(label, drop);
        return chip;
      })
    );
  }

  // The sidebar: every slot as a card, in order. Bound to the list,
  // because reordering and removing rewrite it.
  //
  // A card has no selected state. It used to open a panel below with the
  // slot's details in it; the details are screens of their own now -- the
  // chooser, reached from the badge and from the body -- so selecting a
  // card would mark something and change nothing.
  // ---- a prompt, as a card ---------------------------------------------------
  // A card with no header: the grip, what it says, its weight, and the way
  // to take it out. What it says is a card of its own with its header down
  // the left side -- just the preset button -- and the tags as badges or the
  // text as text beside it. That card is where anything carried to the
  // prompt lands: its guides are drawn over it. Its content comes from a
  // preset or from something carried in; there is no typing in place (an
  // edit button on the header may come later).
  const el = (tag, className, props = {}) => Object.assign(document.createElement(tag), { className, ...props });
  const icon = (name) => el("i", `bi bi-${core.ICONS[name] || name}`);
  // Keep as a preset: the preset mark with the add badge, as on every card.
  const keepButton = (run) => {
    const one = el("button", "mu-icon-button mu-card-keep", { type: "button" });
    one.append(icon("preset"), el("i", `bi bi-${core.ICONS.presetSave || "plus"} mu-icon-badge`));
    one.addEventListener("click", (event) => {
      event.stopPropagation();
      run();
    });
    return one;
  };

  // The preset button's two shelves: a prompt's content is tags or text,
  // and either can be loaded or saved -- and loading one makes the prompt
  // that kind.
  let presetMenu = null;
  const closePresetMenu = () => {
    if (presetMenu) presetMenu.remove();
    presetMenu = null;
  };
  document.addEventListener("pointerdown", (event) => {
    if (presetMenu && !presetMenu.contains(event.target)) closePresetMenu();
  });
  function openPresetMenu(anchor, line) {
    const again = presetMenu && presetMenu.__anchor === anchor;
    closePresetMenu();
    if (again) return;
    const menu = el("div", "prompt-preset-menu");
    menu.__anchor = anchor;
    for (const kind of [TAGS, TEXT]) {
      const entry = el("button", "prompt-preset-entry", { type: "button" });
      entry.append(icon(kind === TEXT ? "text-paragraph" : "tags"), el("span", "", { textContent: t(kind === TEXT ? "prompt.kind.text" : "prompt.kind.taglist") }));
      entry.addEventListener("click", (event) => {
        event.stopPropagation();
        closePresetMenu();
        const one = line.__prompt;
        const type = kind === TEXT ? "prompt.text" : "prompt.tags";
        const desc = describe(
          {
            type: kind === TEXT ? type : "list",
            ...(kind === TEXT ? {} : { each: { type: "prompt.tag", placeholder: "prompt.placeholder.oneTag" } }),
            control: "preset",
            inner: "none",
            read: () => (kind === TEXT ? promptText(line.__prompt) : promptTags(line.__prompt)),
            write: (_api, value) => line.__onContent && line.__onContent(kind, value),
          },
          { api: line.__api, key: `preset-${type}-${one.id}`, label: t(kind === TEXT ? "prompt.kind.text" : "prompt.kind.taglist") }
        );
        core.openValuePicker(desc, anchor);
      });
      menu.append(entry);
    }
    const box = anchor.getBoundingClientRect();
    Object.assign(menu.style, { left: `${box.left}px`, top: `${box.bottom + 4}px` });
    document.body.append(menu);
    presetMenu = menu;
  }

  // A prompt card: a header down its left side, and two rows beside it --
  // what it says (with the link, when it follows something), then its
  // weight. The header holds the grip, the shrink and the remove; when the
  // card is shrunk (what it says down to one line) or simply too short for
  // three buttons in a column, it holds the grip and a menu with the other
  // two in it instead.
  const remPx = () => parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  // Three icon buttons stacked, with the gaps between them.
  const FULL_SIDE_REM = 3 * 1.75 + 2 * 0.25;
  // Measured by what the two rows need, not by the card: a column of three
  // buttons stretches the card to its own height, and a card measured that
  // way is never short.
  const fitSide = (line) => {
    const main = line.children[1];
    const [top, weight] = main.children;
    const style = getComputedStyle(main);
    const needs =
      top.offsetHeight + weight.offsetHeight + (parseFloat(style.rowGap) || 0) +
      (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0);
    const short = top.offsetHeight > 0 && needs < FULL_SIDE_REM * remPx();
    line.classList.toggle("is-compact", line.classList.contains("is-shrunk") || short);
  };
  const sideObserver = typeof ResizeObserver === "function"
    ? new ResizeObserver((entries) => entries.forEach((entry) => fitSide(entry.target.closest(".prompt-line"))))
    : null;

  let lineMenu = null;
  const closeLineMenu = () => {
    if (lineMenu) lineMenu.remove();
    lineMenu = null;
  };
  document.addEventListener("pointerdown", (event) => {
    if (lineMenu && !lineMenu.contains(event.target)) closeLineMenu();
  });
  function openLineMenu(anchor, entries) {
    const again = lineMenu && lineMenu.__anchor === anchor;
    closeLineMenu();
    if (again) return;
    const menu = el("div", "prompt-preset-menu");
    menu.__anchor = anchor;
    for (const entry of entries) {
      const button = el("button", "prompt-preset-entry", { type: "button" });
      button.append(icon(entry.icon), el("span", "", { textContent: entry.label }));
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        closeLineMenu();
        entry.run();
      });
      menu.append(button);
    }
    const box = anchor.getBoundingClientRect();
    Object.assign(menu.style, { left: `${box.left}px`, top: `${box.bottom + 4}px` });
    document.body.append(menu);
    lineMenu = menu;
  }

  function buildLine() {
    const line = el("div", "prompt-line");
    const side = el("div", "prompt-line-side");
    const grip = el("button", "mu-icon-button mu-port-grip", { type: "button" });
    grip.append(icon("grip-vertical"));
    const shrink = el("button", "mu-icon-button prompt-line-shrink", { type: "button" });
    shrink.append(icon("arrows-collapse"));
    shrink.addEventListener("click", (event) => {
      event.stopPropagation();
      if (line.__toggleShrink) line.__toggleShrink();
    });
    const remove = el("button", "mu-icon-button prompt-line-remove", { type: "button" });
    // The same mark as a window's close button.
    remove.append(icon("close"));
    remove.addEventListener("click", (event) => {
      event.stopPropagation();
      if (line.__onRemove) line.__onRemove();
    });
    const more = el("button", "mu-icon-button prompt-line-more", { type: "button" });
    more.append(icon("list"));
    more.addEventListener("click", (event) => {
      event.stopPropagation();
      const entries = [
        {
          icon: line.classList.contains("is-shrunk") ? "arrows-expand" : "arrows-collapse",
          label: t(line.classList.contains("is-shrunk") ? "prompt.action.expandPrompt" : "prompt.action.shrinkPrompt"),
          run: () => line.__toggleShrink && line.__toggleShrink(),
        },
      ];
      if (line.__onRemove) entries.push({ icon: "close", label: t("prompt.action.removePrompt"), run: () => line.__onRemove() });
      openLineMenu(more, entries);
    });
    side.append(grip, shrink, remove, more);

    const main = el("div", "prompt-line-main");
    const top = el("div", "prompt-line-top");
    const body = el("div", "prompt-body");
    const head = el("div", "prompt-body-head");
    const presets = el("button", "mu-icon-button prompt-body-presets", { type: "button" });
    presets.append(icon("preset"));
    presets.addEventListener("click", (event) => {
      event.stopPropagation();
      openPresetMenu(presets, line);
    });
    const keep = keepButton(() => line.__keep && line.__keep());
    keep.classList.add("prompt-body-keep");
    head.append(presets, keep);
    body.append(head, el("div", "prompt-body-view"));
    const link = el("button", "mu-icon-button prompt-line-link", { type: "button" });
    link.append(icon("link-45deg"));
    top.append(body, link);

    // The weight as the shell's vector control with one axis: the same
    // label-and-value that opens into a stepper as everywhere else.
    const weightDesc = describe(
      {
        type: "vector",
        axes: ["W"],
        min: 0.1,
        max: 10,
        step: 0.1,
        read: () => [line.__prompt ? line.__prompt.weight : 1],
        write: (_api, value) => {
          const next = Number(value && value[0]);
          if (line.__onWeight && Number.isFinite(next) && next > 0) line.__onWeight(next);
        },
      },
      { key: "weight", label: t("prompt.field.weight") }
    );
    const weight = el("div", "prompt-line-weight");
    weight.append(controls.vector.render(weightDesc, (value) => weightDesc.property.set(value)));
    weight.__desc = weightDesc;
    main.append(top, weight);

    line.append(side, main);
    if (sideObserver) sideObserver.observe(top);
    return line;
  }

  function paintLine(line, one, { port = null, sizeKey = "", fixed = false, api = null, onContent, onWeight, onRemove } = {}) {
    const [side, main] = line.children;
    const [grip, shrink, remove, more] = side.children;
    const [top, weight] = main.children;
    const [body, link] = top.children;
    const [head, view] = body.children;
    line.__prompt = one;
    line.__api = api;
    core.attachPort(line, grip, port);
    grip.title = t("mu.port.grip");
    const following = core.portLink(port);
    link.hidden = !following;
    if (following) {
      link.title = `${t("mu.port.following", { name: following.label })} — ${t("mu.port.unlink")}`;
      link.onclick = (event) => {
        event.stopPropagation();
        if (api) api.props.release(port);
      };
    }
    const locked = fixed || Boolean(following);
    line.classList.toggle("is-fixed", locked);
    head.hidden = locked && !line.__keepGiven;
    head.firstElementChild.hidden = locked;
    head.firstElementChild.title = t("prompt.action.presets");
    head.lastElementChild.hidden = !line.__keepGiven;
    head.lastElementChild.title = t("mu.action.keepAsPreset");

    // What it says: tags as badges, text as text, nothing as a hint.
    const text = promptText(one);
    const shown = JSON.stringify([one.kind, one.tags, one.text]);
    if (view.__shown !== shown) {
      view.__shown = shown;
      view.classList.toggle("is-text", one.kind === TEXT);
      view.classList.toggle("is-empty", !text);
      if (!text) view.replaceChildren(el("span", "prompt-body-empty", { textContent: t("prompt.value.emptyPrompt") }));
      else if (one.kind === TEXT) view.replaceChildren(el("span", "prompt-body-text", { textContent: one.text }));
      else view.replaceChildren(...tagTexts(one.tags).map((tag) => el("span", "prompt-badge", { textContent: tag })));
    }
    view.title = text;

    // Shrunk or not is part of the saved layout, keyed by the row's address
    // or by its owning control and stable prompt id.
    const where = port
      ? core.portKey(port, "prompt")
      : `prompt:${sizeKey || "line"}:${one.id}`;
    const shrunk = core.cardIsShrunk(where);
    core.setCardSizeClass(line, shrunk);
    line.__toggleShrink = () => {
      core.setCardShrunk(where, !core.cardIsShrunk(where));
      paintLine(line, line.__prompt, line.__opts);
    };
    line.__opts = { port, sizeKey, fixed, api, onContent, onWeight, onRemove };
    shrink.firstElementChild.className = `bi bi-${shrunk ? "arrows-expand" : "arrows-collapse"}`;
    shrink.title = t(shrunk ? "prompt.action.expandPrompt" : "prompt.action.shrinkPrompt");
    more.title = t("prompt.action.more");

    controls.vector.update(weight.firstElementChild, weight.__desc);
    weight.classList.toggle("is-fixed", locked);
    remove.hidden = fixed || !onRemove;
    remove.title = t("prompt.action.removePrompt");
    line.__onContent = locked ? null : onContent;
    line.__onWeight = locked ? null : onWeight;
    line.__onRemove = fixed ? null : onRemove;
    fitSide(line);
  }

  // What putting content into a prompt does: it becomes that kind, and
  // keeps its weight.
  const withContent = (one, kind, value) =>
    kind === TEXT
      ? { ...one, kind: TEXT, text: String(value ?? ""), tags: [] }
      : { ...one, kind: TAGS, tags: Array.isArray(value) ? coerceTags(value) : tagEntries(splitTags(value)), text: "" };

  // Rows for a list of prompts, in `box`, keyed by id so a row (and the
  // field being typed into) stays with its prompt when the list moves.
  function paintLines(box, list, { port = null, sizeKey = "", fixed = false, write = null, empty = "", api = null } = {}) {
    if (!box.__rows) box.__rows = new Map();
    const rows = list.map((one) => {
      let line = box.__rows.get(one.id);
      if (!line) {
        line = buildLine();
        box.__rows.set(one.id, line);
      }
      const replace = (next) => write && write(list.map((other) => (other.id === one.id ? next : other)));
      paintLine(line, one, {
        port: port ? { ...port, path: [...(port.path || []), one.id] } : null,
        sizeKey: sizeKey ? `${sizeKey}:${one.id}` : "",
        fixed: fixed || !write,
        api,
        onContent: (kind, value) => replace(withContent(one, kind, value)),
        onWeight: (value) => replace({ ...one, weight: value }),
        onRemove: write ? () => write(list.filter((other) => other.id !== one.id)) : null,
      });
      return line;
    });
    const ids = new Set(list.map((one) => one.id));
    [...box.__rows.keys()].forEach((id) => ids.has(id) || box.__rows.delete(id));
    if (!box.__empty) box.__empty = el("div", "prompt-lines-empty");
    box.__empty.textContent = empty;
    const wanted = rows.length ? rows : empty ? [box.__empty] : [];
    // Only when the order changed: taking a focused field out of the
    // document to put it back blurs it.
    const settled = box.childNodes.length === wanted.length && wanted.every((node, i) => box.childNodes[i] === node);
    if (!settled) box.replaceChildren(...wanted);
  }

  // One prompt property on its own: the same card.
  registerControl("prompt.promptline", {
    label: "prompt.control.promptline",
    needs: ["weight", "setWeight"],
    params: ["port", "onDiscard", "onKeep"],
    render(desc, onChange) {
      const line = buildLine();
      line.classList.add("is-single");
      line.__write = onChange;
      controls["prompt.promptline"].update(line, desc);
      return line;
    },
    update(line, desc) {
      const one = coerceSlot(desc.value);
      const item = desc.property && desc.property.item;
      line.__keepGiven = Boolean(desc.params.onKeep);
      line.__keep = desc.params.onKeep || null;
      paintLine(line, one, {
        port: desc.params.port || (item ? { item: item.id, key: desc.property.key } : null),
        sizeKey: desc.key,
        fixed: Boolean(desc.readonly),
        api: desc.api,
        onContent: (kind, value) => line.__write(withContent(one, kind, value)),
        onWeight: (value) => line.__write({ ...one, weight: value }),
        // Where it can be thrown away from (a scratch board), its remove.
        onRemove: desc.params.onDiscard || null,
      });
    },
  });

  // The whole list as a saved value of its own, for the chooser to load one into it.
  const presetDesc = (wrap) =>
    describe(
      {
        type: "list", each: { type: "prompt.slot" },
        control: "preset",
        inner: "none",
        read: () => wrap.__desc.property.items(),
        write: (_api, value) => wrap.__onChange(value),
      },
      { api: wrap.__desc.api, key: `preset-${wrap.__desc.params.itemId || wrap.__desc.key || ""}`, label: t("prompt.vtype.template") }
    );

  // A prompt list, in a list card: a grip for the whole list at the left
  // end of its header and the fold at the right, the cards (each with a
  // grip of its own), and the way to add one.
  registerControl("prompt.promptlist", {
  // Draws as a card, and has no header to put a name in (see core unnamedCardsIn).
  cardName: () => "",
    label: "prompt.control.promptlist",
    needs: ["items", "set"],
    params: ["itemId", "port", "empty", "rowPorts", "onDiscard", "onKeep", "onLoad"],
    render(desc, onChange) {
      const body = el("div", "prompt-promptlist");
      const lines = el("div", "prompt-lines");
      const add = el("button", "mu-add prompt-slot-add", { type: "button" });
      const append = (one) => {
        const list = coercePrompts(wrap.__desc.property.items());
        wrap.__onChange([...list, { id: newPromptId(), tags: [], text: "", ...one, weight: 1 }]);
      };
      add.addEventListener("click", (event) => {
        event.stopPropagation();
        append({ kind: TAGS });
      });
      // Text or tags carried here are a new prompt, weighing 1.
      const zone = el("div", "prompt-add");
      zone.append(add);
      core.attachSink(zone, {
        accepts: [TEXT, "taglist", "prompt"],
        put: (value, kind) => {
          if (kind === TEXT) append({ kind: TEXT, text: String(value ?? "") });
          else if (kind === "taglist") append({ kind: TAGS, tags: coerceTags(value) });
          else {
            const one = coerceSlot(value);
            append({ kind: one.kind, tags: one.tags, text: one.text });
          }
        },
      });
      body.append(lines, zone);
      const wrap = core.listCard(body, { key: `prompts:${desc.params.itemId || desc.key || ""}` });
      wrap.classList.add("prompt-listcard");
      wrap.__onChange = onChange;
      const head = wrap.querySelector(".mu-listcard-head");
      head.classList.add("prompt-listcard-head");
      // The grip is the card's own (see listCard).
      const grip = wrap.__grip;
      const link = core.makePortBadge();
      const discard = el("button", "mu-icon-button mu-card-discard", { type: "button" });
      discard.append(icon("close"));
      discard.addEventListener("click", (event) => {
        event.stopPropagation();
        if (wrap.__discard) wrap.__discard();
      });
      const keep = keepButton(() => wrap.__keep && wrap.__keep());
      // Loading a saved list into this one: opens the chooser at the button.
      const load = el("button", "mu-icon-button mu-card-load", { type: "button" });
      load.append(icon("preset"));
      load.addEventListener("click", (event) => {
        event.stopPropagation();
        if (wrap.__load) wrap.__load(load);
      });
      head.prepend(link);
      head.insertBefore(load, head.querySelector(".mu-listcard-fold"));
      head.insertBefore(keep, head.querySelector(".mu-listcard-fold"));
      head.insertBefore(discard, head.querySelector(".mu-listcard-fold"));
      // Guides for the whole list go on its header, so the cards under it
      // can still offer their own.
      wrap.__portHead = head;
      wrap.__parts = { grip, discard, keep, load, link, lines, add, zone };
      controls["prompt.promptlist"].update(wrap, desc);
      return wrap;
    },
    update(wrap, desc) {
      wrap.__desc = desc;
      const { grip, discard, keep, load, link, lines, add, zone } = wrap.__parts;
      // Loading a saved list into this one: asked for with `load` (the shell's chooser, over this list), or
      // given as a function by a placer in code.
      const onLoad = desc.params.onLoad || (desc.params.load ? (anchor) => core.openValuePicker(presetDesc(wrap), anchor) : null);
      load.hidden = !onLoad;
      load.title = t("mu.action.presets", { type: t("prompt.vtype.template") });
      wrap.__load = onLoad;
      keep.hidden = !desc.params.onKeep;
      keep.title = t("mu.action.keepAsPreset");
      wrap.__keep = desc.params.onKeep || null;
      discard.hidden = !desc.params.onDiscard;
      discard.title = t("mu.action.discard");
      wrap.__discard = desc.params.onDiscard || null;
      const item = desc.property && desc.property.item;
      const port = desc.params.port || (item ? { item: item.id, key: desc.property.key } : null);
      core.attachPort(wrap, grip, port);
      grip.title = t("mu.port.grip");
      const following = core.portLink(port);
      core.syncPortBadge(link, following, following ? () => desc.api && desc.api.props.release(port) : null);
      const fixed = Boolean(desc.readonly || following);
      wrap.classList.toggle("is-fixed", fixed);
      core.fitCardHead(wrap.querySelector(".mu-listcard-head"));
      zone.hidden = fixed;
      add.textContent = t("prompt.action.addPrompt");
      paintLines(lines, coercePrompts(desc.property.items()), {
        // A list held inside something else's entry has no address for its
        // rows of their own, so they are not carried one at a time.
        port: desc.params.rowPorts === false ? null : port,
        sizeKey: desc.key,
        fixed,
        api: desc.api,
        write: fixed ? null : (next) => wrap.__onChange(next),
      });
    },
  });

  // One tag, as a line of text: the `text` field of the tag, drawn by the
  // shell's own textbox.
  registerControl("prompt.tagline", {
    label: "prompt.control.tagline",
    needs: ["text", "setText"],
    params: ["placeholder"],
    render(desc, onChange) {
      const wrap = el("div", "prompt-tagline");
      wrap.__onChange = onChange;
      const input = el("input", "input", { type: "text" });
      input.addEventListener("input", () => wrap.__desc.property.setText(input.value));
      wrap.append(input);
      controls["prompt.tagline"].update(wrap, desc);
      return wrap;
    },
    update(wrap, desc) {
      wrap.__desc = desc;
      const input = wrap.firstElementChild;
      input.placeholder = desc.params.placeholder ? t(desc.params.placeholder) : "";
      input.readOnly = Boolean(desc.readonly);
      const text = desc.property.text();
      if (document.activeElement !== input && input.value !== text) input.value = text;
    },
  });

  // ---- assembling ------------------------------------------------------
  // The one place the output format is decided. The types know nothing
  // about it: a weight written as (tag:1.2) is a convention of the thing
  // being written for, not a property of the value.
  //
  // A sentence is joined to its neighbours with a space, not the separator:
  // "She waves., The camera pans." is not how anyone writes.
  function assemble(slots, separator) {
    let out = "";
    let last = null;
    for (const one of coercePrompts(Array.isArray(slots) ? slots : [slots])) {
      const text = promptText(one);
      if (!text) continue;
      const piece = one.weight === 1 ? text : `(${text}:${one.weight})`;
      if (last) out += one.kind === TEXT || last.kind === TEXT ? " " : separator;
      out += piece;
      last = one;
    }
    return out;
  }

  // ---- asking Ollama ------------------------------------------------------
  // One request per kind of answer. JSON, with a schema, because a small
  // model asked for "a list of tags" returns prose about tags.
  const parseJson = (raw) => {
    const text = String(raw || "");
    try {
      return JSON.parse(text);
    } catch (_error) {
      const match = text.match(/\{[\s\S]*\}/);
      return match ? JSON.parse(match[0]) : null;
    }
  };
  const TAG_RULES = "Write concise English tags for an image model, one idea per tag, most important first.";
  const ASKS = {
    text: {
      system: [
        "Write one image-generation prompt as natural, descriptive English prose: one paragraph saying who or what is there, what they do, where, the light and the camera.",
        "The request may be in Japanese.",
        'Return JSON only: {"text":"..."}',
      ],
      format: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
      read: (json) => String((json && json.text) || "").trim(),
    },
    // YuE2's style prompt: the genre, voice, tempo, instruments and feel of a
    // song, as one line of English words (its own examples are written so).
    style: {
      system: [
        "Write the style prompt of a song for a music model, as one line of comma-separated English descriptors.",
        "Cover, in this order when the request gives them: language of the lyrics, genre, vocal (gender, timbre), mood, tempo in BPM, instruments, and the feel of the rhythm and the diction.",
        "Example: English, warm female vocal, contemporary pop, 96 BPM, piano, rounded electric bass, restrained drums, clear diction",
        "Musical instructions only: no lyrics, no title, no sentences.",
        "The request may be in Japanese.",
        'Return JSON only: {"style":"..."}',
      ],
      format: { type: "object", properties: { style: { type: "string" } }, required: ["style"] },
      read: (json) => String((json && json.style) || "").replace(/\s+/g, " ").trim(),
    },
    taglist: {
      system: [TAG_RULES, "The request may be in Japanese.", 'Return JSON only: {"tags":["tag"]}'],
      format: { type: "object", properties: { tags: { type: "array", items: { type: "string" } } }, required: ["tags"] },
      read: (json) => tagEntries(splitTags(((json && json.tags) || []).join(","))),
    },
    prompt: {
      system: [
        TAG_RULES,
        "All of it is one prompt: one coherent concern.",
        "The request may be in Japanese.",
        'Return JSON only: {"tags":["tag"]}',
      ],
      format: { type: "object", properties: { tags: { type: "array", items: { type: "string" } } }, required: ["tags"] },
      read: (json) => {
        const tags = splitTags(((json && json.tags) || []).join(","));
        return tags.length ? { id: "p0", kind: TAGS, tags: tagEntries(tags), text: "", weight: 1 } : null;
      },
    },
    promptlist: {
      system: [
        "Build an image-generation prompt as an ordered list of prompts, one concern each: subject, appearance, pose, setting, lighting, camera, style.",
        TAG_RULES,
        "The request may be in Japanese.",
        'Return JSON only: {"parts":[{"tags":["tag"],"weight":1}]}',
        "Omit empty parts.",
        // Small models read "weight" as a ranking and counted down from
        // 10, which as (tags:10) wrecks a picture. It is emphasis.
        "weight is emphasis, not order: use 1 for almost every part, 1.1-1.4 only to stress one, 0.6-0.9 to soften one.",
      ],
      format: {
        type: "object",
        properties: {
          parts: {
            type: "array",
            items: {
              type: "object",
              properties: { tags: { type: "array", items: { type: "string" } }, weight: { type: "number" } },
              required: ["tags", "weight"],
            },
          },
        },
        required: ["parts"],
      },
      read: (json) =>
        coercePrompts(
          ((json && json.parts) || [])
            .map((part, index) => ({ id: `p${index}`, kind: TAGS, tags: tagEntries(part.tags), weight: part.weight }))
            .filter((one) => one.tags.length)
        ),
    },
  };

  // ---- looking the tags up first (RAG) -----------------------------------------
  // The kinds that answer in tags can be shown the dictionary's own tags for the request: a
  // first, short question has the model say what the request is made of as English keywords;
  // those and the request's own words are searched in the tag dictionary (./rag.js); the best
  // few dozen come with their definitions into the question proper, and what is written is put
  // back on the dictionary's spelling.
  const TAG_KINDS = ["taglist", "prompt", "promptlist"];
  const KEYWORDS_ASK = {
    system: [
      "List what an image request is made of, as English search keywords for a Danbooru-style tag database.",
      "Cover the subject (1girl, 2boys ...), hair, eyes, clothes, expression, pose, setting, lighting, camera and style when the request gives them.",
      "Each keyword is one to three words, as a tag would be written: blue eyes, school uniform, looking back.",
      "The request may be in Japanese.",
      'Return JSON only: {"keywords":["keyword"]}',
    ],
    format: { type: "object", properties: { keywords: { type: "array", items: { type: "string" } } }, required: ["keywords"] },
  };
  const FROM_DICTIONARY =
    "The request is followed by candidate tags from the tag dictionary, each with its meaning. Write a candidate exactly as given when the request calls for what it means, and leave out one it does not call for. Add a tag of your own only for something the request asks for that no candidate covers.";
  const CANDIDATES = 40;

  // The tags of an answer, put on the dictionary's spelling: {tags: [...]} or {parts: [{tags}]}.
  function snapJson(index, json, unknown) {
    if (!json || typeof json !== "object") return json;
    const fix = (tags) => {
      const done = snapAll(index, tags);
      unknown.push(...done.unknown);
      return done.tags;
    };
    if (Array.isArray(json.tags)) json.tags = fix(json.tags);
    if (Array.isArray(json.parts)) for (const part of json.parts) if (part && Array.isArray(part.tags)) part.tags = fix(part.tags);
    return json;
  }

  // Looks the request up in the tag dictionary: {index, prompt, rule} -- `prompt` is the request
  // with its candidates, `rule` the line telling the model what they are (empty when nothing was
  // found), `index` null when there is no dictionary (`info.missing` says so). `info` is told
  // what happened ({keywords, candidates}) and `info.onPhase` hears when the search is over.
  async function lookUp(api, model, instruction, info = {}) {
    const index = await tagIndexOf(api).catch(() => null);
    if (!index) {
      info.missing = true;
      return { index: null, prompt: instruction, rule: "" };
    }
    info.phase = "search";
    if (info.onPhase) info.onPhase("search");
    let keywords = [];
    try {
      const first = await api.ollama.generate({ model, system: KEYWORDS_ASK.system.join("\n"), prompt: instruction, format: KEYWORDS_ASK.format });
      const said = parseJson(first && first.response);
      keywords = ((said && said.keywords) || []).map(String);
    } catch (_error) {
      // Without the keywords the request's own words are still searched.
    }
    const hits = retrieve(index, { description: instruction, keywords, limit: CANDIDATES });
    info.keywords = keywords;
    info.candidates = hits.map((hit) => hit.name);
    info.phase = "ask";
    if (info.onPhase) info.onPhase("ask");
    if (!hits.length) return { index, prompt: instruction, rule: "" };
    return { index, prompt: `Request:\n${instruction}\n\nCandidate tags:\n${candidateLines(hits)}`, rule: FROM_DICTIONARY };
  }

  // `use` is whether to look the tags up; `info` as for `lookUp`, and `info.unknown` is the tags
  // written that the dictionary does not have.
  async function askFor(api, kind, instruction, model, use = false, info = {}) {
    const ask = ASKS[kind];
    const found = use && TAG_KINDS.includes(kind) ? await lookUp(api, model, instruction, info) : { index: null, prompt: instruction, rule: "" };
    const index = found.index;
    const prompt = found.prompt;
    const system = ask.system.slice();
    if (found.rule) system.splice(1, 0, found.rule);
    const reply = await api.ollama.generate({ model, system: system.join("\n"), prompt, format: ask.format });
    const json = parseJson(reply && reply.response);
    const unknown = [];
    if (index) snapJson(index, json, unknown);
    info.unknown = [...new Set(unknown)];
    return ask.read(json);
  }

  return { askFor, assemble, types: typeHooks, controls: Object.fromEntries(Object.entries(controls)) };
}
