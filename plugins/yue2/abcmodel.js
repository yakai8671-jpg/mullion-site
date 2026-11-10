/* The ABC dialect YuE2 and SheetSage2 write, as a model a GUI can edit, and
 * back.
 *
 * Not ABC in general: the bounded two-voice dialect of YuE2's own reference
 * tool (skills/yue2-music/scripts/abc_tools.py, "native ABC"), whose rules
 * are followed here word for word:
 *
 *   - two monophonic voices, `V: Vocal` and `V: Ins`, written as blocks of
 *     one to four measures, a Vocal block then an Ins block, over and over;
 *   - a block is optional `M:`/`K:` lines, then ONE music line ending in `|`;
 *   - durations are multiples 1 2 3 4 6 8 12 16 24 32 48 of the unit `L:`;
 *     a longer or odd length is written as tied notes (`C8-C2`) or rests
 *     (`z8z2`); a rest is never tied;
 *   - a whole resting measure is `Z` (`Z2`..`Z4` for several);
 *   - chord symbols in quotes, in Vocal only, before the token they start at;
 *     a chord change inside a held note splits it with a tie;
 *   - accidentals hold for the rest of the measure BY LETTER across octaves,
 *     and are written only when they differ from that state; a tied
 *     continuation across a barline keeps its pitch.
 *
 * The model is what sounds, not how it was spelled: a note is one entry
 * however many tied tokens it took, so the GUI edits notes and the writer
 * decides the tokens. Reading refuses (with the reason) anything outside the
 * dialect rather than guessing -- the text stays the document, and the GUI
 * is only offered where nothing would be lost.
 *
 * Time is in ticks: 256 to a quarter note, so any unit down to 1/1024 is a
 * whole number of ticks.
 */

export const TICKS_PER_QUARTER = 256;
export const DURATIONS = [48, 32, 24, 16, 12, 8, 6, 4, 3, 2, 1];
export const VOICES = ["Vocal", "Ins"];
export const NATURAL = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
export const LETTERS = "CDEFGAB";

const KEY_COUNT = {
  ...Object.fromEntries(["Cb", "Gb", "Db", "Ab", "Eb", "Bb", "F", "C", "G", "D", "A", "E", "B", "F#", "C#"].map((k, i) => [k, i - 7])),
  ...Object.fromEntries(["Abm", "Ebm", "Bbm", "Fm", "Cm", "Gm", "Dm", "Am", "Em", "Bm", "F#m", "C#m", "G#m", "D#m", "A#m"].map((k, i) => [k, i - 7])),
};
export const KEY_NAMES = Object.keys(KEY_COUNT);

// {C:0, D:0, ... F:1 ...}: what the key signature does to each letter.
export function keyAccidentals(key) {
  const count = KEY_COUNT[key];
  if (count === undefined) return null;
  const result = Object.fromEntries(LETTERS.split("").map((l) => [l, 0]));
  for (const letter of (count > 0 ? "FCGDAEB" : "BEADGCF").slice(0, Math.abs(count))) result[letter] = count > 0 ? 1 : -1;
  return result;
}

// ---- chords ---------------------------------------------------------------
const PITCH_NAME = "[A-G](?:bb|##|b|#)?";
export const QUALITIES = ["", "m", "dim", "aug", "7", "maj7", "m7", "dim7", "m7b5", "sus4", "sus2", "6", "m6", "7sus4", "m(maj7)"];
export const CHORD_ROOTS = ["C", "C#", "Db", "D", "D#", "Eb", "E", "F", "F#", "Gb", "G", "G#", "Ab", "A", "A#", "Bb", "B"];
const CHORD = new RegExp(
  `^(${PITCH_NAME})(${QUALITIES.map((q) => q.replace(/[()]/g, "\\$&")).sort((a, b) => b.length - a.length).join("|")})(?:/(${PITCH_NAME}))?$`
);

// "Am7/G" → {root:"A", quality:"m7", bass:"G"}; null when it is not one YuE2 knows.
export function parseChord(text) {
  const match = CHORD.exec(String(text || ""));
  return match ? { root: match[1], quality: match[2], bass: match[3] || "" } : null;
}
export const chordText = ({ root, quality = "", bass = "" }) => `${root}${quality}${bass ? `/${bass}` : ""}`;

// ---- pitch ----------------------------------------------------------------
// A note: {t, d, letter, alt, oct} -- start and length in ticks, the written
// letter, how far it is raised (+1 sharp, -1 flat), and its octave (C4 = 60).
export const midiOf = (note) => 12 * (note.oct + 1) + NATURAL[note.letter] + note.alt;

// A pitch the key can spell: in its own scale as the signature has it, else
// with sharps in a sharp key (and C), flats in a flat key.
export function spell(midi, key) {
  const sig = keyAccidentals(key) || keyAccidentals("C");
  const pc = ((midi % 12) + 12) % 12;
  for (const letter of LETTERS) {
    if ((NATURAL[letter] + sig[letter] + 120) % 12 === pc) return { letter, alt: sig[letter], oct: Math.floor((midi - sig[letter] - NATURAL[letter]) / 12) - 1 };
  }
  // A white key outside the scale is the natural (written with =).
  for (const letter of LETTERS) if (NATURAL[letter] === pc) return { letter, alt: 0, oct: Math.floor(midi / 12) - 1 };
  const flats = (KEY_COUNT[key] ?? 0) < 0;
  for (const letter of flats ? [..."CDEFGAB"].reverse() : LETTERS) {
    const alt = pc - NATURAL[letter];
    if (alt === (flats ? -1 : 1)) return { letter, alt, oct: Math.floor((midi - alt - NATURAL[letter]) / 12) - 1 };
  }
  return { letter: "C", alt: 0, oct: Math.floor(midi / 12) - 1 };
}

// The first ABC part of a document supplies its header; a score without part
// comments (SheetSage's) goes on into music in the same part. The header
// is what is above the first plain `V: Vocal` / `V: Ins` line.
export function splitHeader(text) {
  const lines = String(text || "").split("\n");
  const at = lines.findIndex((l) => /^V:\s*(Vocal|Ins)\s*$/.test(l.trim()));
  return at < 0
    ? { header: lines.join("\n"), body: "" }
    : { header: lines.slice(0, at).join("\n"), body: lines.slice(at).join("\n") };
}

// ---- context --------------------------------------------------------------
// What the header and the sections before this one have set: the unit
// length, the meter and key in force where this section begins.
export function contextOf(texts) {
  const ctx = { den: 8, meter: [4, 4], key: "C", bpm: 120 };
  for (const text of texts) {
    for (const line of String(text || "").split(/\r?\n/)) {
      const m = /^([LMKQ]):\s*(.*?)\s*$/.exec(line);
      if (!m) continue;
      if (m[1] === "L") {
        const d = /^1\/(\d+)$/.exec(m[2]);
        if (d) ctx.den = Number(d[1]);
      } else if (m[1] === "M") {
        const d = /^(\d+)\/(\d+)$/.exec(m[2]);
        if (d) ctx.meter = [Number(d[1]), Number(d[2])];
      } else if (m[1] === "K") ctx.key = m[2];
      else {
        const d = /^1\/4=(\d+)$/.exec(m[2]);
        if (d) ctx.bpm = Number(d[1]);
      }
    }
  }
  return ctx;
}

export const unitTicks = (ctx) => (4 * TICKS_PER_QUARTER) / ctx.den;
export const barTicks = (meter) => (4 * TICKS_PER_QUARTER * meter[0]) / meter[1];

const isPow2 = (n) => Number.isInteger(n) && n > 0 && (n & (n - 1)) === 0;
const bad = (reason) => ({ ok: false, reason });

// ---- the header ----------------------------------------------------------------
// YuE2's header is fixed but for four things -- the lines the reference tool
// expects, in this order:
//
//   X:1
//   T:
//   M:4/4              the meter
//   L:1/32             the unit the durations count in
//   Q:1/4=120          the tempo, in quarter notes
//   V: Vocal clef=treble name="Vocal Melody" snm="Vocal"
//   V: Ins clef=treble name="Ins Melody" snm="Inst."
//   K:D                the key
//
// A header is edited by these four; the lines that are not one of them stay as
// they are.
export const HEADER_DEFAULTS = { meter: [4, 4], den: 32, bpm: 120, key: "C" };
// The YuE reference checker accepts any power-of-two unit through 1/1024.
export const UNIT_DENOMINATORS = Array.from({ length: 11 }, (_, power) => 2 ** power);
export const METER_DENOMINATORS = UNIT_DENOMINATORS;
export const METERS = [[2, 2], [2, 4], [3, 4], [4, 4], [5, 4], [3, 8], [6, 8], [7, 8], [12, 8]];

export function nativeHeader({ meter, den, bpm, key }) {
  return [
    "X:1",
    "T:",
    `M:${meter[0]}/${meter[1]}`,
    `L:1/${den}`,
    `Q:1/4=${bpm}`,
    'V: Vocal clef=treble name="Vocal Melody" snm="Vocal"',
    'V: Ins clef=treble name="Ins Melody" snm="Inst."',
    `K:${key}`,
  ].join("\n");
}

// What the header says, as the controls show it. `blank`: it says nothing yet.
export function headerFields(header) {
  const ctx = contextOf([header]);
  const blank = !String(header || "").trim();
  return blank
    ? { ...HEADER_DEFAULTS, blank }
    : { meter: ctx.meter, den: ctx.den, bpm: ctx.bpm, key: ctx.key, blank };
}

const HEADER_ORDER = { X: 0, T: 1, M: 2, L: 3, Q: 4, V: 5, K: 6 };

// The header with one field set: "M" ([n, d]), "L" (the denominator), "Q" (bpm)
// or "K" (the key). A blank header becomes the whole native one first; a field
// the header lacks is put where the native one has it.
export function withHeaderField(header, field, value) {
  const base = String(header || "").trim() ? String(header) : nativeHeader(HEADER_DEFAULTS);
  const line = { M: `M:${value[0]}/${value[1]}`, L: `L:1/${value}`, Q: `Q:1/4=${value}`, K: `K:${value}` }[field];
  const lines = base.split("\n");
  const at = lines.findIndex((one) => one.startsWith(`${field}:`));
  if (at >= 0) lines[at] = line;
  else {
    const rank = HEADER_ORDER[field];
    let place = lines.length;
    for (let i = 0; i < lines.length; i++) {
      const letter = (/^([A-Z]):/.exec(lines[i]) || [])[1];
      if (letter !== undefined && (HEADER_ORDER[letter] ?? HEADER_ORDER.V) > rank) {
        place = i;
        break;
      }
    }
    lines.splice(place, 0, line);
  }
  return lines.join("\n");
}

// The sections' texts written again for a header whose unit length or key is
// not the one they were written for: the same notes, the same measures, the
// durations counted in the new unit and the accidentals against the new key.
// Not for a new meter (the measures would have to change) -- that is only for
// a score with nothing in it. {ok, texts} or {ok: false, reason}.
export function recount(texts, oldHeader, newHeader) {
  const out = [];
  const oldKey = contextOf([oldHeader]).key;
  const newKey = contextOf([newHeader]).key;
  for (let i = 0; i < texts.length; i++) {
    if (!String(texts[i] || "").trim()) {
      out.push(texts[i]);
      continue;
    }
    const before = contextOf([oldHeader, ...texts.slice(0, i)]);
    const after = contextOf([newHeader, ...out]);
    const parsed = parseBody(texts[i], before);
    if (!parsed.ok) return { ok: false, section: i + 1, reason: parsed.reason };
    const model = parsed.model;
    const unit = unitTicks(after);
    const onGrid = (n) => n % unit === 0;
    const fits =
      model.bars.every((bar) => onGrid(bar.len)) &&
      VOICES.every((voice) => model.notes[voice].every((note) => onGrid(note.t) && onGrid(note.d))) &&
      model.chords.every((chord) => onGrid(chord.t));
    if (!fits) return { ok: false, section: i + 1, grid: after.den };
    // The header's own key was the measures' key unless a section said otherwise.
    for (const bar of model.bars) if (bar.key === oldKey) bar.key = newKey;
    out.push(serializeBody(model, after));
  }
  return { ok: true, texts: out };
}

// ---- reading --------------------------------------------------------------
const TOKEN = /"([^"\n]*)"|(\^\^|__|\^|_|=)?([A-Ga-gz])([,']*)([0-9]*)(-?)/y;

// text: the body of a section (voice blocks only). → {ok, model} | {ok:false, reason}
export function parseBody(text, ctx) {
  if (!isPow2(ctx.den) || ctx.den > 1024) return bad("L: が 1/2のべき乗ではありません");
  const unit = unitTicks(ctx);
  const lines = String(text || "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const model = { bars: [], notes: { Vocal: [], Ins: [] }, chords: [] };
  const voiceState = { Vocal: { pending: null }, Ins: { pending: null } };
  let meter = ctx.meter;
  let key = ctx.key;
  let time = 0;
  let at = 0;

  while (at < lines.length) {
    // One group: blocks of distinct voices, until a voice comes round again.
    const blocks = [];
    while (at < lines.length) {
      const head = /^V:\s*(\S+)\s*$/.exec(lines[at]);
      if (!head) return bad(`声部の行 (V: Vocal / V: Ins) が必要です: ${lines[at].slice(0, 24)}`);
      if (!VOICES.includes(head[1])) return bad(`声部 ${head[1]} は扱えません (Vocal と Ins のみ)`);
      if (blocks.some((b) => b.voice === head[1])) break;
      at++;
      const fields = {};
      while (at < lines.length && /^[MK]:/.test(lines[at])) {
        const f = /^([MK]):\s*(.+)$/.exec(lines[at]);
        if (fields[f[1]]) return bad("同じブロックに M:/K: が重複しています");
        fields[f[1]] = f[2].trim();
        at++;
      }
      if (at >= lines.length || /^[VMK]:/.test(lines[at]) || lines[at].startsWith("%")) return bad("音符の行がありません");
      const music = lines[at++];
      if (!music.endsWith("|") || music.endsWith("||")) return bad("音符の行は小節線 | で終わる必要があります");
      blocks.push({ voice: head[1], fields, music });
    }

    for (const field of ["M", "K"]) {
      const values = [...new Set(blocks.map((b) => b.fields[field]).filter(Boolean))];
      if (values.length > 1) return bad(`声部の ${field}: が食い違っています`);
      if (values[0]) {
        if (field === "M") {
          const d = /^(\d+)\/(\d+)$/.exec(values[0]);
          if (!d || !isPow2(Number(d[2])) || Number(d[2]) > 1024) return bad(`拍子 ${values[0]} は扱えません`);
          meter = [Number(d[1]), Number(d[2])];
        } else {
          if (!keyAccidentals(values[0])) return bad(`調 ${values[0]} は扱えません`);
          key = values[0];
        }
      }
    }
    const len = barTicks(meter);
    if (!Number.isInteger(len) || len % unit) return bad("小節の長さが L: の単位で割り切れません");

    const split = blocks.map((b) => {
      const bars = [];
      for (const raw of b.music.slice(0, -1).split("|")) {
        const bar = raw.trim();
        if (!bar) return null;
        const z = /^Z([2-4])?$/.exec(bar);
        if (z) for (let i = 0; i < Number(z[1] || 1); i++) bars.push("Z");
        else bars.push(bar);
      }
      return bars;
    });
    if (split.some((s) => !s || !s.length)) return bad("空の小節、または扱えない小節線があります");
    const count = split[0].length;
    if (split.some((s) => s.length !== count)) return bad("声部の小節数が揃っていません");

    for (let i = 0; i < count; i++) {
      const bar = { t: time + i * len, len, meter, key };
      model.bars.push(bar);
      for (let b = 0; b < blocks.length; b++) {
        const r = parseBar(split[b][i], blocks[b].voice, bar, unit, voiceState[blocks[b].voice], model);
        if (r) return bad(`${blocks[b].voice} の ${model.bars.length} 小節目: ${r}`);
      }
    }
    time += count * len;
  }
  for (const voice of VOICES) if (voiceState[voice].pending) return bad(`${voice}: 末尾に結ばれていないタイがあります (セクションをまたぐタイ)`);
  return { ok: true, model };
}

// One measure of one voice into the model; an error message or null.
function parseBar(body, voice, bar, unit, state, model) {
  if (body === "Z") {
    if (state.pending) return "タイが全休符に入っています";
    return null;
  }
  const sig = keyAccidentals(bar.key);
  const local = {};
  let offset = 0;
  TOKEN.lastIndex = 0;
  let cursor = 0;
  while (cursor < body.length) {
    if (/\s/.test(body[cursor])) {
      cursor++;
      continue;
    }
    TOKEN.lastIndex = cursor;
    const m = TOKEN.exec(body);
    if (!m) return `扱えない記号: ${body.slice(cursor, cursor + 12)}`;
    cursor = TOKEN.lastIndex;
    if (m[1] !== undefined) {
      if (voice !== "Vocal") return "コード記号は Vocal にだけ置けます";
      if (offset >= bar.len) return "小節の終わりのあとにコード記号があります";
      model.chords.push({ t: bar.t + offset, text: m[1] });
      continue;
    }
    const [, , acc, name, marks, digits, tie] = m;
    if (offset >= bar.len) return "小節の長さを超えています";
    const units = Number(digits || "1");
    if (!DURATIONS.includes(units)) return `音価 ${units} は扱えません (タイで分けてください)`;
    const d = units * unit;
    if (offset + d > bar.len) return "音符が小節をはみ出しています";
    if (marks.includes(",") && marks.includes("'")) return "オクターブ記号が混在しています";
    if (name === "z") {
      if (acc || marks || tie) return "休符に臨時記号・オクターブ・タイは付けられません";
      if (state.pending) return "タイが休符に入っています";
    } else {
      const letter = name.toUpperCase();
      const oct = 4 + (name === name.toLowerCase() ? 1 : 0) + (marks.split("'").length - 1) - (marks.split(",").length - 1);
      let alt = local[letter] ?? sig[letter];
      if (acc) {
        alt = { "=": 0, _: -1, __: -2, "^": 1, "^^": 2 }[acc];
        local[letter] = alt;
      }
      const p = state.pending;
      if (p) {
        // A tied continuation without its own accidental keeps the pitch.
        if (!acc && p.letter === letter && p.oct === oct) alt = p.alt;
        if (p.letter !== letter || p.oct !== oct || p.alt !== alt) return "タイが別の高さにつながっています";
        p.note.d += d;
      } else {
        model.notes[voice].push({ t: bar.t + offset, d, letter, alt, oct });
      }
      state.pending = tie ? { letter, alt, oct, note: p ? p.note : model.notes[voice][model.notes[voice].length - 1] } : null;
    }
    offset += d;
  }
  return offset === bar.len ? null : `小節の長さが合いません (${offset / unit} / ${bar.len / unit})`;
}

// ---- writing ----------------------------------------------------------------
function pieces(units) {
  const out = [];
  let rest = units;
  while (rest > 0) {
    const d = DURATIONS.find((x) => x <= rest);
    out.push(d);
    rest -= d;
  }
  return out;
}

const octaveMarks = (name, oct) => (oct >= 5 ? name.toLowerCase() + "'".repeat(oct - 5) : name + ",".repeat(4 - oct));

// The text of a section body from its model. Notes are clipped to the bars,
// a note overlapping the next in its voice is cut at it.
export function serializeBody(model, ctx) {
  const unit = unitTicks(ctx);
  const end = model.bars.length ? model.bars[model.bars.length - 1].t + model.bars[model.bars.length - 1].len : 0;
  const chords = [...model.chords].filter((c) => c.t >= 0 && c.t < end).sort((a, b) => a.t - b.t);
  const chordAt = new Map();
  for (const c of chords) chordAt.set(c.t, c.text);

  const voiceNotes = {};
  for (const voice of VOICES) {
    const sorted = [...model.notes[voice]].filter((n) => n.t < end && n.d > 0).sort((a, b) => a.t - b.t || a.d - b.d);
    voiceNotes[voice] = sorted.map((n, i) => {
      const next = sorted[i + 1];
      const stop = Math.min(n.t + n.d, end, next && next.t > n.t ? next.t : Infinity);
      return { ...n, d: stop - n.t };
    }).filter((n) => n.d > 0);
  }

  const lines = [];
  let meter = ctx.meter;
  let key = ctx.key;
  let i = 0;
  while (i < model.bars.length) {
    const first = model.bars[i];
    let j = i + 1;
    while (j < model.bars.length && j - i < 4 && sameField(model.bars[j], first)) j++;
    const group = model.bars.slice(i, j);
    const fieldLines = [];
    if (first.meter[0] !== meter[0] || first.meter[1] !== meter[1]) fieldLines.push(`M:${first.meter[0]}/${first.meter[1]}`);
    if (first.key !== key) fieldLines.push(`K:${first.key}`);
    meter = first.meter;
    key = first.key;
    for (const voice of VOICES) {
      lines.push(`V: ${voice}`, ...fieldLines, writeLine(group, voice, voiceNotes[voice], voice === "Vocal" ? chords : [], chordAt, unit));
    }
    i = j;
  }
  return lines.join("\n");
}

const sameField = (a, b) => a.meter[0] === b.meter[0] && a.meter[1] === b.meter[1] && a.key === b.key;

function writeLine(group, voice, notes, chords, chordAt, unit) {
  const cells = group.map((bar) => writeBar(bar, voice, notes, chords, chordAt, unit));
  const out = [];
  for (let k = 0; k < cells.length; ) {
    if (cells[k] === "Z") {
      let run = 1;
      while (k + run < cells.length && cells[k + run] === "Z") run++;
      out.push(run === 1 ? "Z" : `Z${run}`);
      k += run;
    } else out.push(cells[k++]);
  }
  return `${out.join("|")}|`;
}

function writeBar(bar, voice, notes, chords, chordAt, unit) {
  const bs = bar.t;
  const be = bar.t + bar.len;
  const sig = keyAccidentals(bar.key);
  const local = {};
  // Segments: notes and rests tiling the measure.
  let segs = [];
  let cursor = bs;
  for (const n of notes) {
    if (n.t >= be || n.t + n.d <= bs) continue;
    const s = Math.max(n.t, bs);
    const e = Math.min(n.t + n.d, be);
    if (s > cursor) segs.push({ s: cursor, e: s, rest: true });
    segs.push({ s, e, note: n });
    cursor = e;
  }
  if (cursor < be) segs.push({ s: cursor, e: be, rest: true });
  // A chord change inside a note or rest splits it (a note, tied).
  const inside = chords.filter((c) => c.t > bs && c.t < be).map((c) => c.t);
  if (inside.length) {
    segs = segs.flatMap((seg) => {
      const cuts = inside.filter((t) => t > seg.s && t < seg.e);
      if (!cuts.length) return [seg];
      const edges = [seg.s, ...cuts, seg.e];
      return edges.slice(0, -1).map((s, k) => ({ ...seg, s, e: edges[k + 1] }));
    });
  }
  const chordIn = chords.some((c) => c.t >= bs && c.t < be);
  if (segs.length === 1 && segs[0].rest && !chordIn) return "Z";

  let text = "";
  segs.forEach((seg, k) => {
    if (voice === "Vocal" && chordAt.has(seg.s)) text += `"${chordAt.get(seg.s)}"`;
    const units = Math.max(1, Math.round((seg.e - seg.s) / unit));
    const parts = pieces(units);
    if (seg.rest) {
      text += parts.map((u) => `z${u === 1 ? "" : u}`).join("");
      return;
    }
    const n = seg.note;
    const continues = k + 1 < segs.length && !segs[k + 1].rest && segs[k + 1].note === n;
    const tieOut = continues || n.t + n.d > be;
    // The accidental the note needs, against what the measure has already said.
    const state = local[n.letter] ?? sig[n.letter];
    let acc = "";
    if (n.alt !== state) {
      acc = { "-2": "__", "-1": "_", 0: "=", 1: "^", 2: "^^" }[n.alt] ?? "";
      local[n.letter] = n.alt;
    }
    parts.forEach((u, p) => {
      const head = p === 0 ? acc : "";
      text += `${head}${octaveMarks(n.letter, n.oct)}${u === 1 ? "" : u}${p < parts.length - 1 || tieOut ? "-" : ""}`;
    });
  });
  return text;
}

// ---- editing helpers (the roll's) --------------------------------------------
// Put `note` in its voice as a monophonic line: what it covers is taken from
// the notes it overlaps (one that surrounds it is cut in two).
export function placeNote(model, voice, note, others = model.notes[voice]) {
  const s = note.t;
  const e = note.t + note.d;
  const next = [];
  for (const m of others) {
    if (m === note) continue;
    const ms = m.t;
    const me = m.t + m.d;
    if (me <= s || ms >= e) next.push(m);
    else {
      if (ms < s) next.push({ ...m, d: s - ms });
      if (me > e) next.push({ ...m, t: e, d: me - e });
    }
  }
  next.push(note);
  model.notes[voice] = next.sort((a, b) => a.t - b.t);
  return note;
}

// Add a bar of rests at the end (the last bar's meter and key).
export function appendBar(model, ctx) {
  const last = model.bars[model.bars.length - 1];
  const meter = last ? last.meter : ctx.meter;
  const key = last ? last.key : ctx.key;
  const len = barTicks(meter);
  model.bars.push({ t: last ? last.t + last.len : 0, len, meter, key });
}

// Drop the last bar and whatever sounds in it.
export function removeLastBar(model) {
  const last = model.bars.pop();
  if (!last) return;
  for (const voice of VOICES) {
    model.notes[voice] = model.notes[voice]
      .filter((n) => n.t < last.t)
      .map((n) => (n.t + n.d > last.t ? { ...n, d: last.t - n.t } : n));
  }
  model.chords = model.chords.filter((c) => c.t < last.t);
}

// ---- measures (the roll's) -----------------------------------------------------
// The bars laid end to end again from the first, after one was added, taken
// out or moved.
function retime(model) {
  let t = 0;
  for (const bar of model.bars) {
    bar.t = t;
    t += bar.len;
  }
}

// Notes that cross `tick` are cut in two there (the second half is their own
// note: the writer ties what is next to each other).
function cutAt(model, tick) {
  for (const voice of VOICES) {
    const next = [];
    for (const n of model.notes[voice]) {
      if (n.t < tick && n.t + n.d > tick) next.push({ ...n, d: tick - n.t }, { ...n, t: tick, d: n.t + n.d - tick });
      else next.push(n);
    }
    model.notes[voice] = next;
  }
}

// Everything from `tick` on moves along by `delta`.
function shiftFrom(model, tick, delta) {
  for (const voice of VOICES) for (const n of model.notes[voice]) if (n.t >= tick) n.t += delta;
  for (const c of model.chords) if (c.t >= tick) c.t += delta;
}

// What sounds in bar `index`, taken out of the timeline (notes cut at the
// barlines) and returned with its time from the bar's start; the bar stays,
// empty.
function lift(model, index) {
  const bar = model.bars[index];
  const a = bar.t;
  const b = bar.t + bar.len;
  cutAt(model, a);
  cutAt(model, b);
  const held = { notes: {}, chords: [] };
  for (const voice of VOICES) {
    held.notes[voice] = model.notes[voice].filter((n) => n.t >= a && n.t < b).map((n) => ({ ...n, t: n.t - a }));
    model.notes[voice] = model.notes[voice].filter((n) => n.t < a || n.t >= b);
  }
  held.chords = model.chords.filter((c) => c.t >= a && c.t < b).map((c) => ({ ...c, t: c.t - a }));
  model.chords = model.chords.filter((c) => c.t < a || c.t >= b);
  return held;
}

// Add a bar of rests so that it becomes bar number `at` (0 = before the first,
// bars.length = at the end), in the meter and key of the bar before it (or
// after it, when it is the first). Returns it.
export function insertBar(model, at, ctx, like = null) {
  const near = like || model.bars[at - 1] || model.bars[at];
  const meter = near ? near.meter : ctx.meter;
  const key = near ? near.key : ctx.key;
  const len = barTicks(meter);
  const t = at < model.bars.length ? model.bars[at].t : endTick(model);
  cutAt(model, t);
  shiftFrom(model, t, len);
  const bar = { t, len, meter, key };
  model.bars.splice(at, 0, bar);
  retime(model);
  return bar;
}

const endTick = (model) => (model.bars.length ? model.bars[model.bars.length - 1].t + model.bars[model.bars.length - 1].len : 0);

// Take bar `index` out, with what sounds in it; what comes after closes up.
export function deleteBar(model, index) {
  const bar = model.bars[index];
  if (!bar) return;
  lift(model, index);
  shiftFrom(model, bar.t + bar.len, -bar.len);
  model.bars.splice(index, 1);
  retime(model);
}

// Move bar `index`, with what sounds in it, to the place before bar `to`
// (the numbering before the move; bars.length = the end). Returns the bar's
// new number, or -1 when it would not move.
export function moveBar(model, index, to) {
  if (!model.bars[index] || to === index || to === index + 1) return -1;
  const bar = model.bars[index];
  const held = lift(model, index);
  shiftFrom(model, bar.t + bar.len, -bar.len);
  model.bars.splice(index, 1);
  retime(model);
  const at = to > index ? to - 1 : to;
  const placed = insertBar(model, at, null, bar);
  for (const voice of VOICES) model.notes[voice] = [...model.notes[voice], ...held.notes[voice].map((n) => ({ ...n, t: n.t + placed.t }))].sort((a, b) => a.t - b.t);
  model.chords = [...model.chords, ...held.chords.map((c) => ({ ...c, t: c.t + placed.t }))].sort((a, b) => a.t - b.t);
  return at;
}
