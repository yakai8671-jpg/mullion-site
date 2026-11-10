/* yue2.note, yue2.chord -- what one note (or chord) of the piano roll is made
 * of, as values; and yue2.notecard, the control that draws either as a card.
 *
 *   yue2.note    {layer, letter, alt, oct, len}   layer: Vocal | Ins; len in ticks
 *   yue2.chord   {root, quality, bass}
 *
 * A value type declares its fields (flat, each a property of its own): the
 * card is made of them, one drop-down per field in the core's fieldform, in a
 * card with a vertical header (the grip) and the way to delete at its end. It
 * knows nothing of the roll: the roll describes the selected note as a value
 * (`fw.describe`, reading and writing live) and the card shows and writes it.
 *
 * Params: `lead` ([{key, label, value}], readouts before the fields -- the
 * chord's layer), `options` ({field: [{value, label}]}: a field's choices when
 * they are not the type's own -- a note's lengths depend on the score),
 * `empty` (what it says while the value is null: nothing selected), `onRemove`
 * (the delete button; none, none shown enabled), `readonly`.
 */
import { VOICES, LETTERS, QUALITIES, CHORD_ROOTS } from "./abcmodel.js";

export const ACC = { "-2": "\u{1d12b}", "-1": "♭", 0: "", 1: "♯", 2: "\u{1d12a}" };

// Every length a note can be given, longest first, in ticks (256 to a quarter).
const LENGTHS = [
  [1024, "1"], [768, "1/2."], [512, "1/2"], [384, "1/4."], [256, "1/4"], [192, "1/8."], [128, "1/8"],
  [96, "1/16."], [64, "1/16"], [48, "1/32."], [32, "1/32"], [16, "1/64"],
];

const pick = (value, options, fallback) => (options.some((one) => String(one) === String(value)) ? value : fallback);

export const noteOf = (value) => {
  if (value === null || value === undefined) return null;
  const v = typeof value === "object" ? value : {};
  const len = Math.round(Number(v.len));
  return {
    layer: pick(v.layer, VOICES, VOICES[0]),
    letter: pick(v.letter, [...LETTERS], "C"),
    alt: Math.max(-2, Math.min(2, Math.round(Number(v.alt)) || 0)),
    oct: Math.max(1, Math.min(7, Math.round(Number(v.oct)) || 5)),
    len: len > 0 ? len : 256,
  };
};

export const chordOf = (value) => {
  if (value === null || value === undefined) return null;
  const v = typeof value === "object" ? value : {};
  return {
    root: pick(v.root, CHORD_ROOTS, "C"),
    quality: pick(v.quality, QUALITIES, ""),
    bass: pick(v.bass, ["", ...CHORD_ROOTS], ""),
  };
};

export default function registerNote(fw) {
  const { t } = fw.core;
  const asOptions = (list) => list.map((value) => ({ value, label: String(value) }));

  fw.registerValueType("yue2.note", {
    label: "yue2.vtype.note",
    icon: "music-note-beamed",
    params: ["default"],
    fields: {
      layer: { type: "enum", label: "yue2.roll.layer", options: asOptions(VOICES) },
      letter: { type: "enum", label: "yue2.roll.letter", options: asOptions([...LETTERS]) },
      alt: { type: "enum", label: "yue2.roll.accidental", options: [-2, -1, 0, 1, 2].map((a) => ({ value: a, label: a === 0 ? "♮" : ACC[a] })) },
      oct: { type: "enum", label: "yue2.roll.octave", options: asOptions([1, 2, 3, 4, 5, 6, 7]) },
      len: { type: "enum", label: "yue2.roll.length", options: LENGTHS.map(([value, label]) => ({ value, label })) },
    },
    sample: { default: { layer: "Vocal", letter: "A", alt: 0, oct: 5, len: 256 } },
    defaultControl: "yue2.notecard",
    defaultValue: () => ({ layer: "Vocal", letter: "C", alt: 0, oct: 5, len: 256 }),
    coerce: noteOf,
    format: (value) => {
      const v = noteOf(value);
      return v ? `${v.layer} · ${v.letter}${ACC[v.alt] ?? ""}${v.oct}` : "";
    },
  });

  fw.registerValueType("yue2.chord", {
    label: "yue2.vtype.chord",
    icon: "music-note-list",
    params: ["default"],
    fields: {
      root: { type: "enum", label: "yue2.roll.root", options: asOptions(CHORD_ROOTS) },
      quality: { type: "enum", label: "yue2.roll.quality", options: QUALITIES.map((q) => ({ value: q, label: q || "major" })) },
      bass: { type: "enum", label: "yue2.roll.bass", options: [{ value: "", label: "—" }, ...asOptions(CHORD_ROOTS)] },
    },
    sample: { default: { root: "C", quality: "", bass: "" } },
    defaultControl: "yue2.notecard",
    defaultValue: () => ({ root: "C", quality: "", bass: "" }),
    coerce: chordOf,
    format: (value) => {
      const v = chordOf(value);
      return v ? `${v.root}${v.quality}${v.bass ? `/${v.bass}` : ""}` : "";
    },
  });

  fw.registerControl("yue2.notecard", {
    label: "yue2.control.notecard",
    why: "A note or chord of the piano roll as one card: a vertical header with the grip, a drop-down per field of the value in one form, delete at the end -- the shell has no card of a value's fields with a vertical header for a plugin's DOM to place.",
    standalone: true,
    params: ["lead", "options", "empty", "onRemove", "readonly"],
    sampleParams: { empty: "-" },
    render(desc) {
      const { card, body, grip } = fw.card.buildSide("yue2-notecard");
      const form = fw.controls.fieldform.render({ params: { fields: [] } });
      const remove = Object.assign(document.createElement("button"), { type: "button", className: "mu-icon-button yue2-notecard-remove" });
      remove.append(Object.assign(document.createElement("i"), { className: "bi bi-trash" }));
      remove.addEventListener("click", (event) => {
        event.stopPropagation();
        if (card.__remove) card.__remove();
      });
      body.append(form, remove);
      card.__parts = { grip, form, remove };
      fw.controls["yue2.notecard"].update(card, desc);
      return card;
    },
    update(card, desc) {
      const p = desc.params;
      const { form, remove, grip } = card.__parts;
      const readonly = Boolean(desc.readonly);
      const value = desc.value;
      const fields = (p.lead || []).map((one) => ({ key: one.key, kind: "readout", label: one.label, value: one.value }));
      if (value === null || value === undefined) {
        fields.push({ key: "empty", kind: "readout", label: p.emptyLabel || "", value: p.empty || "" });
      } else {
        for (const name of desc.property.fields()) {
          const field = desc.property.field(name);
          const choices = ((p.options && p.options[name]) || field.options()).map((one) => [one.value, one.label]);
          fields.push({
            key: name,
            label: t(field.params.label || name),
            value: value[name],
            options: choices,
            // The option's own value, not the select's text: a number stays one.
            onChange: (raw) => {
              const found = choices.find(([option]) => String(option) === String(raw));
              if (found) desc.property.set({ ...desc.property.get(), [name]: found[0] });
            },
          });
        }
      }
      fw.controls.fieldform.update(form, { params: { fields, readonly } });
      // Nothing selected: the guide alone -- no header, no delete.
      const empty = value === null || value === undefined;
      card.classList.toggle("is-empty", empty);
      remove.hidden = empty;
      card.__remove = p.onRemove || null;
      remove.title = t("yue2.roll.remove");
      remove.setAttribute("aria-label", t("yue2.roll.remove"));
      remove.disabled = readonly || !p.onRemove || empty;
      grip.title = t("mu.port.grip");
    },
  });
}
