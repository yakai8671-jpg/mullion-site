/* yue2.roll -- a section of YuE2's ABC as a piano roll.
 *
 * The score is the dialect's own (abcmodel.js): two monophonic voices,
 * Vocal and Ins, and the chords above Vocal. Here it is notes you can see
 * and drag: time runs along, pitch up, the two voices in two colours, the
 * measures drawn from the meter, the chords in a lane over them.
 *
 *   click a bare place     a note there, as long as the last one (or the grid)
 *   drag a bare place      a note as long as the drag
 *   drag a note            move it in time and pitch
 *   drag its right edge    change its length
 *   click the chord lane   a chord there; drag one to move it
 *   Delete / arrows        remove / move the selected one ([ ] shorten, lengthen)
 *
 * What it edits is the section's text, and it hands the text back whole: the
 * writer (abcmodel.js) decides the tokens -- ties over barlines, rests,
 * accidentals against the key, the allowed durations -- so what is drawn
 * cannot be written wrongly. A voice stays monophonic: a note put over
 * others takes their place (one it lands inside is cut in two).
 *
 * The roll is a card, and its action bar has two rows, as the item's bar has
 * rows. The first is the score's: where the open part is among the song's
 * parts (`parts`, `part`, `onPart`), the layers shown (a popup checklist: Vocal,
 * Ins and the chords -- what is ticked is drawn, and is what play plays), the buttons for the
 * part before and after with play between them (as the ABC preview's
 * transport), and the zoom (the core's percent control). The second is the
 * note's: the note before and after on either side of the selected one drawn
 * as a card (note.js: the note, or the chord, as a value -- yue2.note,
 * yue2.chord -- in a card with a vertical header, its fields in one form and
 * delete at its end; "no note selected" alone when none is).
 *
 * A measure is selected by clicking its head, by moving among the measures,
 * and by selecting a note or chord in it. Its head has a handle (to move the
 * measure) and, while it is selected, icon buttons to add one and delete it.
 * Moving and adding use the shell's guides (mu-guides / mu-guide): taking
 * hold of the handle, or pressing add, covers the measures with the halves
 * a measure can go before or after; letting go over one (or pressing it, for
 * add) does it.
 *
 * Params: port, and the shell gives the card its name (`desc.head`, an entry of a list only) (the head of the roll's card: what its grip carries,
 * and its name), text (the section's body), ctx ({den, meter, key, bpm} where the
 * section begins), onChange(text), readonly, and for the part switch
 * parts ([{value, label}]), part (the open one's value), onPart(value).
 */

import {
  TICKS_PER_QUARTER,
  VOICES,
  parseBody,
  serializeBody,
  placeNote,
  insertBar,
  deleteBar,
  moveBar as moveBarTo,
  midiOf,
  spell,
  unitTicks,
  parseChord,
  chordText,
} from "./abcmodel.js";
import { createPlayer } from "./abccard.js";
import { ACC } from "./note.js";

const ROW_H = 12;
const GUTTER_W = 44;
const BARS_H = 24;
const CHORDS_H = 24;
// How wide a quarter note is at 100%, and how far the zoom goes (percent).
const ZOOM_BASE = 48;
const ZOOM_MIN = 40;
const ZOOM_MAX = 340;
// The narrowest a grid step may be drawn, in pixels: the grid follows the zoom.
const SNAP_MIN_PX = 10;
const SNAPS = [1024, 512, 256, 128, 64, 32, 16, 8, 4, 2, 1];
const SHARPS = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
const BLACK = new Set([1, 3, 6, 8, 10]);
// The layers of a roll: the two voices, and the chords over them.
const CHORDS = "Chords";
const LAYER_SWATCH = { Vocal: "var(--accent)", Ins: "#d9822b", [CHORDS]: "var(--fg-muted)" };
// What a chord is made of, as steps over its root.
const CHORD_STEPS = {
  "": [0, 4, 7], m: [0, 3, 7], dim: [0, 3, 6], aug: [0, 4, 8], 7: [0, 4, 7, 10], maj7: [0, 4, 7, 11], m7: [0, 3, 7, 10],
  dim7: [0, 3, 6, 9], m7b5: [0, 3, 6, 10], sus4: [0, 5, 7], sus2: [0, 2, 7], 6: [0, 4, 7, 9], m6: [0, 3, 7, 9],
  "7sus4": [0, 5, 7, 10], "m(maj7)": [0, 3, 7, 11],
};
const rootSemitone = (name) => ({ C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[name[0]] + (name[1] === "#" ? 1 : name[1] === "b" ? -1 : 0) + 12) % 12;

const make = (tag, className, props) => Object.assign(document.createElement(tag), { className, ...props });
const icon = (name) => make("i", `bi bi-${name}`);
const gcd = (a, b) => (b ? gcd(b, a % b) : a);

// One shared voice for hearing a note as it is put down.
let AUDIO = null;
function blip(midi) {
  try {
    AUDIO = AUDIO || new AudioContext();
    AUDIO.resume();
    const at = AUDIO.currentTime;
    const osc = AUDIO.createOscillator();
    const gain = AUDIO.createGain();
    osc.type = "triangle";
    osc.frequency.value = 440 * 2 ** ((midi - 69) / 12);
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(0.18, at + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, at + 0.3);
    osc.connect(gain).connect(AUDIO.destination);
    osc.start(at);
    osc.stop(at + 0.32);
  } catch {
    /* no sound is not an error */
  }
}

const noteName = (n) => `${n.letter}${ACC[n.alt] ?? ""}${n.oct}`;

export default function registerRoll(fw) {
  const { core, registerControl } = fw;
  const { t } = core;

  // ---- one roll -------------------------------------------------------------
  function build(host) {
    const st = {
      sig: null,
      text: null,
      parsed: null,
      model: null,
      sel: null, // {kind: "note", voice, note} | {kind: "chord", chord}
      voice: "Vocal", // the voice a new note goes to: that of the note last selected
      layers: new Set([...VOICES, CHORDS]), // what is shown, and played
      zoom: 100, // percent
      auto: 128, // the grid the score itself is on
      snap: 128,
      lastLen: 0,
      lo: 55,
      hi: 79,
      drag: null,
      fresh: true,
      from: 0, // where playing starts, in ticks: the line in the roll
      measure: -1, // the measure selected, by its number from 0
      barCols: [],
      barHeads: [],
      pick: null, // the guides on show: {kind: "add"} | {kind: "move", index, over}
    };
    host.__roll = st;
    host.classList.add("yue2-roll");
    host.tabIndex = 0;

    // The roll is a card: its head (the grip carries the open part), and one
    // action bar of two rows -- the score's operations (the song part, playing,
    // the roll's tools) over the selected note's.
    host.classList.add("mu-card");
    st.cardHead = fw.card.buildHead("mu-textcard", {});
    host.append(st.cardHead.head);
    st.bar = fw.card.bar(host);
    st.bar.classList.add("yue2-roll-bar");
    st.scroll = make("div", "yue2-roll-scroll");
    st.message = make("div", "yue2-roll-bad mu-empty");
    host.append(st.scroll, st.message);

    // The scroller: a sticky head over a row of gutter + plot.
    st.headRow = make("div", "yue2-roll-headrow");
    st.corner = make("div", "yue2-roll-corner");
    st.head = make("div", "yue2-roll-head");
    st.headRow.append(st.corner, st.head);
    st.bodyRow = make("div", "yue2-roll-bodyrow");
    st.gutter = make("div", "yue2-roll-gutter");
    st.plot = make("div", "yue2-roll-plot");
    st.playhead = make("div", "yue2-roll-playhead");
    // The shell's guides over the plot: where a measure may be added or moved to.
    st.host = host;
    st.guides = make("div", "mu-guides yue2-roll-guides");
    st.guides.hidden = true;
    st.guides.addEventListener("pointerdown", (event) => event.stopPropagation());
    st.guides.addEventListener("click", (event) => {
      if (event.target === st.guides) cancelPick(st);
    });
    st.bodyRow.append(st.gutter, st.plot);
    st.scroll.append(st.headRow, st.bodyRow);
    st.player = createPlayer({
      onTick: (position) => tickPlay(host, st, position),
      onEnd: () => stopPlay(st),
    });

    buildBar(host, st);
    wirePlot(host, st);
    wireKeys(host, st);
    return st;
  }

  const px = (st) => (ZOOM_BASE * st.zoom) / 100 / TICKS_PER_QUARTER; // ticks → pixels
  const endOf = (st) => (st.model.bars.length ? st.model.bars[st.model.bars.length - 1].t + st.model.bars[st.model.bars.length - 1].len : 0);
  const keyAt = (st, tick) => (st.model.bars.find((b) => tick >= b.t && tick < b.t + b.len) || st.model.bars[st.model.bars.length - 1] || { key: st.p.ctx.key }).key;
  const rowOf = (st, midi) => st.hi - midi;

  // ---- the toolbar ----------------------------------------------------------
  function buildBar(host, st) {
    const chip = (className, label, title, run, iconName) => {
      const b = make("button", className, { type: "button", title });
      if (iconName) b.append(icon(iconName));
      if (className.includes("yue2-chip")) b.append(make("span", "yue2-chip-label", { textContent: label }));
      b.addEventListener("click", (event) => {
        event.stopPropagation();
        run();
      });
      return b;
    };
    // The layers shown (and played): a popup checklist.
    st.layerList = fw.controls.popupchecklist.render({ params: { items: [] } });
    // The zoom as the shell's percent control: no label, the figure between its
    // -/+ (the name is its tooltip).
    st.zoomSpec = {
      type: "number", min: ZOOM_MIN, max: ZOOM_MAX, step: 10, default: 100,
      read: () => st.zoom,
      write: (_api, value) => setZoom(host, st, Number(value)),
    };
    st.zoomDesc = fw.describe(st.zoomSpec, { key: "zoom", label: t("yue2.roll.zoom") });
    st.zoomBox = make("div", "yue2-roll-zoom");
    st.zoomBox.append(fw.controls.percent.render(st.zoomDesc, (value) => st.zoomDesc.property.set(value)));
    // Row one, the score, laid out as the ABC preview's: which layers are shown;
    // the transport -- to the start (or the song part before), the measure
    // before, play (it says which song part is open), the measure after, the
    // song part after; the zoom. Row two, the measure selected: which
    // it is, and add / delete. Row three, the note: a card with a vertical
    // header, the note before and after around what it is made of, and delete
    // at its end. The icons are the transport's:
    // skip-backward / -forward for the large moves (a whole song part),
    // skip-start / -end for the small (a measure, a note).
    const skip = (run, iconName) => chip("mu-icon-button yue2-abc-skip", "", "", run, iconName);
    st.partBack = skip(() => backPart(host, st), "skip-backward-fill");
    st.prevBar = skip(() => moveBar(host, st, -1), "skip-start-fill");
    st.nextBar = skip(() => moveBar(host, st, 1), "skip-end-fill");
    st.partNext = skip(() => movePart(st, 1), "skip-forward-fill");
    st.play = make("button", "mu-icon-button is-primary yue2-abc-play", { type: "button" });
    st.play.append(icon("play-fill"), make("span", "mu-button-label"));
    st.play.addEventListener("click", (event) => {
      event.stopPropagation();
      if (st.player.playing()) stopPlay(st);
      else startPlay(host, st);
    });
    const scoreRow = fw.card.barRow(host, "score", { thirds: true });
    st.scoreStart = make("div", "mu-action-bar-start yue2-roll-start");
    st.scoreStart.append(st.layerList);
    st.scoreMiddle = make("div", "mu-action-bar-middle yue2-abc-transport");
    st.scoreMiddle.append(st.partBack, st.prevBar, st.play, st.nextBar, st.partNext);
    st.tools = make("div", "mu-action-bar-end yue2-roll-end");
    st.tools.append(st.zoomBox);
    scoreRow.append(st.scoreStart, st.scoreMiddle, st.tools);

    st.prevNote = skip(() => stepSelection(host, st, -1), "skip-start-fill");
    st.nextNote = skip(() => stepSelection(host, st, 1), "skip-end-fill");
    // The note's row: the selected one as a card -- a vertical header, its form,
    // delete at its end -- with the buttons that move the selection outside it,
    // one on either side.
    st.noteRow = fw.card.barRow(host, "note");
    st.noteRow.classList.add("yue2-roll-noterow");
    st.noteCard = fw.controls["yue2.notecard"].render(fw.describe({ type: "yue2.note", read: () => null, readonly: true }, { key: "note" }));
    st.noteRow.append(st.prevNote, st.noteCard, st.nextNote);
  }

  // ---- the layers ------------------------------------------------------------------
  const shown = (st, layer) => st.layers.has(layer);
  // The voice a new note goes to: the one last selected, or else the first shown.
  const activeVoice = (st) => (shown(st, st.voice) ? st.voice : VOICES.find((v) => shown(st, v)) || null);

  function setLayers(host, st, values) {
    st.layers = new Set(values);
    if (st.sel && (st.sel.kind === "chord" ? !shown(st, CHORDS) : !shown(st, st.sel.voice))) st.sel = null;
    // What is heard follows what is shown.
    if (st.player.playing()) startPlay(host, st);
    if (st.model) draw(host, st);
    syncBar(st);
  }

  function syncLayers(host, st) {
    fw.controls.popupchecklist.update(st.layerList, {
      params: {
        icon: "layers",
        label: t("yue2.roll.layers"),
        title: t("yue2.roll.layersTitle"),
        items: [
          ...VOICES.map((voice) => ({ value: voice, label: voice, checked: shown(st, voice), swatch: LAYER_SWATCH[voice] })),
          { value: CHORDS, label: t("yue2.roll.layerChords"), checked: shown(st, CHORDS), swatch: LAYER_SWATCH[CHORDS] },
        ],
        onChange: (values) => setLayers(host, st, values),
      },
    });
  }

  // ---- moving the place ------------------------------------------------------------
  // The first note of the layers shown that begins in [from, to): the earliest,
  // the first voice on a tie. Moving to a part or a measure selects it, so the
  // form is there to work on at once.
  function firstNoteIn(st, from, to) {
    let best = null;
    for (const voice of VOICES) {
      if (!shown(st, voice)) continue;
      for (const n of st.model.notes[voice]) {
        if (n.t >= from && n.t < to && (!best || n.t < best.note.t)) best = { kind: "note", voice, note: n };
      }
    }
    return best;
  }

  function selectFirst(st, from, to) {
    st.sel = firstNoteIn(st, from, to);
    if (st.sel) st.voice = st.sel.voice;
  }

  // The song part before or after the open one: its first note is selected
  // once it has been loaded (see load).
  function movePart(st, direction) {
    const parts = Array.isArray(st.p.parts) ? st.p.parts : [];
    const at = parts.findIndex((one) => String(one.value) === String(st.p.part));
    const target = parts[at + direction];
    if (target && st.p.onPart) {
      st.wantFirst = true;
      st.p.onPart(target.value);
    }
  }

  // The large move back: to the start of the part, and from the start to the
  // part before.
  function backPart(host, st) {
    if (st.from > 0) {
      moveTo(host, st, 0);
      selectFirst(st, 0, Infinity);
      draw(host, st);
    } else movePart(st, -1);
  }

  // The measure before (or the start of this one) / after.
  function moveBar(host, st, direction) {
    const bars = st.model ? st.model.bars : [];
    if (!bars.length) return;
    const at = barAt(st, st.from);
    const target = direction > 0 ? bars[at + 1] : (st.from > bars[at].t ? bars[at] : bars[at - 1]);
    if (!target) return;
    moveTo(host, st, target.t);
    selectFirst(st, target.t, target.t + target.len);
    draw(host, st);
  }

  const barAt = (st, tick) => {
    let at = 0;
    st.model.bars.forEach((bar, i) => {
      if (bar.t <= tick) at = i;
    });
    return at;
  };

  // The measure selected is the one the place is in.
  function follow(st) {
    st.measure = st.model && st.model.bars.length ? barAt(st, st.from) : -1;
    paintMeasure(st);
    if (st.pick && st.pick.kind === "add") cancelPick(st);
  }

  function selectMeasure(st, index) {
    st.measure = st.model && index >= 0 && index < st.model.bars.length ? index : -1;
    paintMeasure(st);
    if (st.pick && st.pick.kind === "add") cancelPick(st);
  }

  function paintMeasure(st) {
    st.barCols.forEach((one, i) => one.classList.toggle("is-selected", i === st.measure));
    st.barHeads.forEach((one, i) => one.classList.toggle("is-selected", i === st.measure));
  }

  // Playing starts from here -- and goes from here now, if it is going.
  function moveTo(host, st, tick) {
    st.from = Math.max(0, tick);
    follow(st);
    placeHead(st);
    if (st.player.playing()) startPlay(host, st);
    else syncBar(st);
    revealX(st, st.from, 0);
  }

  const placeHead = (st) => {
    st.playhead.style.left = `${st.from * px(st)}px`;
  };

  // ---- the measures: the shell's guides --------------------------------------------------
  const cancelPick = (st) => setPick(st, null);

  function setPick(st, pick) {
    st.pick = pick;
    paintGuides(st);
  }

  // The halves of the measures a measure may be put before (left) or after
  // (right): the selected one's, to add; every other's, to move -- except
  // the two that are where it is already.
  function paintGuides(st) {
    const pick = st.pick;
    const bars = st.model ? st.model.bars : [];
    const valid = pick && bars.length && !st.p.readonly && (pick.kind === "move" || (st.measure >= 0 && bars[st.measure]));
    st.head.querySelectorAll(".yue2-roll-barbtn.is-add").forEach((one) => one.classList.toggle("is-active", Boolean(valid && pick.kind === "add")));
    if (!valid) {
      st.pick = null;
      st.guides.hidden = true;
      st.guides.replaceChildren();
      return;
    }
    const k = px(st);
    const targets = [];
    bars.forEach((bar, i) => {
      if (pick.kind === "add" ? i !== st.measure : i === pick.index) return;
      if (pick.kind === "add" || i !== pick.index + 1) targets.push([i, "left"]);
      if (pick.kind === "add" || i !== pick.index - 1) targets.push([i, "right"]);
    });
    st.guides.replaceChildren(...targets.map(([i, side]) => {
      const bar = bars[i];
      const half = (bar.len * k) / 2;
      const guide = make("button", "mu-guide yue2-roll-guide", {
        type: "button",
        textContent: side === "left" ? "\u2190" : "\u2192",
        title: t(side === "left" ? "yue2.roll.guideBefore" : "yue2.roll.guideAfter"),
      });
      guide.style.left = `${bar.t * k + (side === "left" ? 0 : half)}px`;
      guide.style.width = `${half}px`;
      guide.dataset.bar = String(i);
      guide.dataset.side = side;
      if (pick.kind === "add") {
        guide.addEventListener("click", (event) => {
          event.stopPropagation();
          addMeasure(st.host, st, side === "left" ? i : i + 1);
        });
      }
      return guide;
    }));
    st.guides.hidden = false;
  }

  // The measure added so that it becomes number `at` (from 0).
  function addMeasure(host, st, at) {
    if (st.p.readonly || !st.model) return;
    const bar = insertBar(st.model, at, st.p.ctx);
    st.pick = null;
    st.sel = null;
    st.measure = at;
    st.from = bar.t;
    commit(host, st);
    placeHead(st);
    revealX(st, bar.t, bar.len);
  }

  function deleteMeasure(host, st) {
    if (st.p.readonly || !st.model) return;
    const index = st.measure;
    const bar = st.model.bars[index];
    if (!bar) return;
    const inside = (tick) => tick >= bar.t && tick < bar.t + bar.len;
    const sounding = VOICES.some((v) => st.model.notes[v].some((n) => n.t < bar.t + bar.len && n.t + n.d > bar.t)) || st.model.chords.some((c) => inside(c.t));
    const run = () => {
      st.pick = null;
      deleteBar(st.model, index);
      const left = st.model.bars.length;
      st.sel = null;
      st.measure = left ? Math.min(index, left - 1) : -1;
      st.from = left ? st.model.bars[st.measure].t : 0;
      commit(host, st);
      placeHead(st);
    };
    // Sounding bars are asked about in the window (not blocking it): the bar goes when the answer is yes.
    if (!sounding) return run();
    core.askNear(host, "confirm", t("yue2.roll.delBarConfirm"), { danger: true }).then((ok) => {
      if (ok) run();
    });
  }

  // ---- playing ------------------------------------------------------------------
  // The roll's notes as the player takes them: whole notes (1024 ticks), the
  // two voices and the chords as three tracks -- the layers that are shown, and
  // only those. A chord sounds as its notes held until the next chord; the tempo
  // is the one the part begins under.
  function soundOf(st) {
    const secondsPerWhole = 240 / (Number(st.p.ctx.bpm) || 120);
    const notes = VOICES.flatMap((voice, track) => (shown(st, voice) ? st.model.notes[voice] : []).map((n) => ({
      start: n.t / 1024, duration: n.d / 1024, pitch: midiOf(n), volume: 90, track,
    })));
    if (shown(st, CHORDS)) {
      const chords = [...st.model.chords].sort((a, b) => a.t - b.t);
      chords.forEach((chord, i) => {
        const parts = parseChord(chord.text);
        if (!parts) return;
        const stop = i + 1 < chords.length ? chords[i + 1].t : endOf(st);
        const pitches = (CHORD_STEPS[parts.quality] || CHORD_STEPS[""]).map((step) => 48 + rootSemitone(parts.root) + step);
        if (parts.bass) pitches.push(36 + rootSemitone(parts.bass));
        for (const pitch of pitches) notes.push({ start: chord.t / 1024, duration: (stop - chord.t) / 1024, pitch, volume: 60, track: VOICES.length });
      });
    }
    notes.sort((a, b) => a.start - b.start);
    return { voices: [...VOICES, CHORDS], notes, secondsPerWhole, seconds: (endOf(st) / 1024) * secondsPerWhole };
  }

  function startPlay(host, st) {
    if (!st.model) return;
    const sound = soundOf(st);
    if (!sound.notes.length) return;
    st.player.start(sound, new Set(), st.from / 1024);
    syncBar(st);
  }

  function stopPlay(st) {
    st.player.stop();
    placeHead(st);
    if (st.p) syncBar(st);
  }

  // The playhead goes along, and the roll's own scroll follows it.
  function tickPlay(host, st, position) {
    if (!host.isConnected) return stopPlay(st);
    const x = position * 1024 * px(st);
    st.playhead.style.left = `${x}px`;
    const at = x + GUTTER_W;
    const view = st.scroll;
    if (at < view.scrollLeft + GUTTER_W || at > view.scrollLeft + view.clientWidth - 24) view.scrollLeft = Math.max(0, at - view.clientWidth / 3);
  }

  // The roll's own scroll brought to a tick.
  function revealX(st, tick, width) {
    const view = st.scroll;
    const x = tick * px(st) + GUTTER_W;
    const w = width * px(st);
    if (x < view.scrollLeft + GUTTER_W) view.scrollLeft = Math.max(0, x - GUTTER_W - 20);
    else if (x + w > view.scrollLeft + view.clientWidth) view.scrollLeft = x + w - view.clientWidth + 20;
  }

  // ---- the selection's neighbours ------------------------------------------------
  // The ones the selection moves among: the chords when a chord is selected,
  // else the notes of the selected note's voice (the chosen voice when nothing is).
  function neighbours(st) {
    const sel = st.sel;
    if (!st.model) return { list: [], at: -1 };
    if (sel && sel.kind === "chord") {
      const list = [...st.model.chords].sort((a, b) => a.t - b.t);
      return { list, at: list.indexOf(sel.chord) };
    }
    const voice = sel ? sel.voice : activeVoice(st);
    if (!voice) return { list: [], at: -1 };
    const list = [...st.model.notes[voice]].sort((a, b) => a.t - b.t || midiOf(a) - midiOf(b));
    return { list, voice, at: sel ? list.indexOf(sel.note) : -1 };
  }

  function stepSelection(host, st, direction) {
    const { list, voice, at } = neighbours(st);
    const sel = st.sel;
    // With nothing selected, forward is the first one and back the last.
    const target = list[at < 0 ? (direction > 0 ? 0 : list.length - 1) : at + direction];
    if (!target) return;
    if (sel && sel.kind === "chord") st.sel = { kind: "chord", chord: target };
    else {
      st.voice = voice;
      st.sel = { kind: "note", voice, note: target };
    }
    st.from = target.t;
    follow(st);
    syncBar(st);
    draw(host, st);
    placeHead(st);
    reveal(st, target);
    if (st.sel.kind === "note") blip(midiOf(target));
  }

  // Scrolled so the one selected is in sight: along the roll's own scroll, and
  // up or down the window's (the roll is as tall as its rows).
  function reveal(st, target) {
    revealX(st, target.t, target.d || 0);
    const el = [...st.plot.querySelectorAll(".yue2-roll-note, .yue2-roll-chord")].find((one) => one.__note === target || one.__chord === target)
      || [...st.head.querySelectorAll(".yue2-roll-chord")].find((one) => one.__chord === target);
    if (el && el.scrollIntoView) el.scrollIntoView({ block: "nearest", inline: "nearest" });
  }

  function syncBar(st) {
    syncLayers(st.host, st);
    fw.controls.percent.update(st.zoomBox.firstElementChild, { ...st.zoomDesc, value: st.zoom, readonly: Boolean(st.p && st.p.readonly) });

    // The song part open, among the song's parts (none given: no way to move
    // among them), and the measures of this one.
    const parts = Array.isArray(st.p.parts) ? st.p.parts : [];
    const place = parts.findIndex((one) => String(one.value) === String(st.p.part));
    const bars = st.model ? st.model.bars : [];
    const barAtFrom = bars.length ? barAt(st, st.from) : 0;
    st.partBack.disabled = !(st.from > 0 || place > 0);
    st.partNext.disabled = place < 0 || place >= parts.length - 1;
    st.prevBar.disabled = !bars.length || st.from <= 0;
    st.nextBar.disabled = !bars.length || barAtFrom >= bars.length - 1;
    for (const [button, key] of [
      [st.partBack, st.from > 0 || place <= 0 ? "yue2.roll.toStart" : "yue2.roll.prevPart"],
      [st.prevBar, "yue2.roll.prevBar"], [st.nextBar, "yue2.roll.nextBar"], [st.partNext, "yue2.roll.nextPart"],
      [st.prevNote, "yue2.roll.prevNote"], [st.nextNote, "yue2.roll.nextNote"],
    ]) {
      button.title = t(key);
      button.setAttribute("aria-label", t(key));
    }

    // Play, or stop while it plays: and which song part is open, in the button.
    const playing = st.player.playing();
    const playable = Boolean(st.model && (VOICES.some((v) => shown(st, v) && st.model.notes[v].length) || (shown(st, CHORDS) && st.model.chords.length)));
    const word = t(playing ? "yue2.abc.stop" : "yue2.abc.play");
    const named = place >= 0 ? `${parts[place].label}(${place + 1}/${parts.length})` : "";
    st.play.firstElementChild.className = `bi bi-${playing ? "stop-fill" : "play-fill"}`;
    st.play.lastElementChild.textContent = named || t(playing ? "yue2.abc.stopShort" : "yue2.abc.playShort");
    st.play.title = word;
    st.play.setAttribute("aria-label", word);
    st.play.setAttribute("aria-pressed", String(playing));
    st.play.classList.toggle("is-active", playing);
    st.play.disabled = !playing && !playable;

    // The selection's neighbours: the note row.
    const { list, at } = neighbours(st);
    st.prevNote.disabled = at < 0 ? !list.length : at <= 0;
    st.nextNote.disabled = at < 0 ? !list.length : at >= list.length - 1;
  }

  function setZoom(host, st, percent) {
    st.zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.round(percent)));
    st.snap = snapFor(st);
    syncBar(st);
    if (st.model) draw(host, st);
  }

  // The grid notes are placed on follows the zoom, as a sequencer's does: the
  // finest step that is still wide enough to aim at, but never coarser than
  // what the score itself sits on (so its notes can be moved without leaving
  // their places).
  function snapFor(st) {
    const unit = unitTicks(st.p.ctx);
    const steps = SNAPS.filter((s) => s % unit === 0 || s === unit).reverse();
    const wide = steps.find((s) => s * px(st) >= SNAP_MIN_PX) || steps[steps.length - 1] || unit;
    return Math.min(st.auto, wide);
  }

  // ---- loading the text -------------------------------------------------------
  function load(host, st) {
    const p = st.p;
    const sig = `${p.text}\u0000${JSON.stringify(p.ctx)}`;
    if (sig === st.sig) return false;
    st.player.stop();
    st.from = 0;
    st.measure = -1;
    st.sig = sig;
    st.text = p.text;
    const parsed = parseBody(p.text, p.ctx);
    st.parsed = parsed;
    st.model = parsed.ok ? parsed.model : null;
    st.sel = null;
    if (parsed.ok) {
      st.auto = autoSnap(st);
      st.snap = snapFor(st);
      fitRange(st);
      if (st.wantFirst) selectFirst(st, 0, Infinity);
      st.fresh = true;
    }
    return true;
  }

  // The coarsest grid every note and measure of this score sits on, not coarser than an eighth.
  function autoSnap(st) {
    const unit = unitTicks(st.p.ctx);
    let g = 0;
    for (const bar of st.model.bars) g = gcd(g, bar.len);
    for (const voice of VOICES) for (const n of st.model.notes[voice]) g = gcd(gcd(g, n.t), n.d);
    for (const c of st.model.chords) g = gcd(g, c.t);
    const fits = SNAPS.filter((s) => s % unit === 0 && (g === 0 || g % s === 0) && s <= 128);
    return fits[0] || unit;
  }

  // After an edit the range only widens, so the picture does not shift under the pointer.
  function growRange(st) {
    const all = VOICES.flatMap((v) => st.model.notes[v]).map(midiOf);
    if (!all.length) return;
    st.lo = Math.max(0, Math.min(st.lo, Math.min(...all) - 2));
    st.hi = Math.min(127, Math.max(st.hi, Math.max(...all) + 2));
  }

  function fitRange(st) {
    const all = VOICES.flatMap((v) => st.model.notes[v]).map(midiOf);
    if (!all.length) {
      st.lo = 55;
      st.hi = 79;
      return;
    }
    let lo = Math.min(...all) - 4;
    let hi = Math.max(...all) + 4;
    if (hi - lo < 24) {
      const mid = Math.round((hi + lo) / 2);
      lo = mid - 12;
      hi = mid + 12;
    }
    st.lo = Math.max(0, lo);
    st.hi = Math.min(127, hi);
  }

  // ---- drawing ------------------------------------------------------------------
  function draw(host, st) {
    const bad = !st.parsed || !st.parsed.ok;
    st.scroll.hidden = bad;
    st.message.hidden = !bad;
    st.noteRow.hidden = bad;
    // What cannot be drawn leaves the part switch (and the way out of it) in place.
    st.tools.hidden = st.layerList.hidden = bad;
    if (bad) {
      st.message.textContent = t("yue2.roll.unsupported", { reason: st.parsed ? st.parsed.reason : "" });
      return;
    }
    const k = px(st);
    const end = endOf(st);
    const width = Math.max(40, end * k);
    const rows = st.hi - st.lo + 1;
    const height = rows * ROW_H;

    st.head.style.width = st.plot.style.width = `${width}px`;
    st.head.style.height = st.corner.style.height = `${BARS_H + CHORDS_H}px`;
    const ro = Boolean(st.p.readonly);
    if (st.measure >= st.model.bars.length) st.measure = -1;
    st.plot.style.height = st.gutter.style.height = `${height}px`;

    // Pitch labels and stripes.
    const gutter = [];
    const stripes = [];
    for (let m = st.hi; m >= st.lo; m--) {
      const pc = ((m % 12) + 12) % 12;
      const top = rowOf(st, m) * ROW_H;
      const label = make("div", `yue2-roll-key${BLACK.has(pc) ? " is-black" : ""}${pc === 0 ? " is-c" : ""}`, {
        textContent: pc === 0 || !BLACK.has(pc) ? `${SHARPS[pc]}${pc === 0 ? Math.floor(m / 12) - 1 : ""}` : "",
      });
      label.style.top = `${top}px`;
      gutter.push(label);
      const stripe = make("div", `yue2-roll-row${BLACK.has(pc) ? " is-black" : ""}${pc === 0 ? " is-c" : ""}`);
      stripe.style.top = `${top}px`;
      stripes.push(stripe);
    }
    st.gutter.replaceChildren(...gutter);

    // An icon button in a measure's head.
    const barButton = (iconName, title, run, extra = "") => {
      const b = make("button", `mu-icon-button yue2-roll-barbtn ${extra}`, { type: "button", title });
      b.append(icon(iconName));
      b.setAttribute("aria-label", title);
      b.addEventListener("click", (event) => {
        event.stopPropagation();
        run();
      });
      return b;
    };
    // Measures: shaded in turn, a line at each beat, the number above.
    const bars = [];
    const numbers = [];
    st.barCols = [];
    st.barHeads = [];
    st.model.bars.forEach((bar, i) => {
      const col = make("div", `yue2-roll-barcol${i % 2 ? " is-odd" : ""}${i === st.measure ? " is-selected" : ""}`);
      col.style.left = `${bar.t * k}px`;
      col.style.width = `${bar.len * k}px`;
      bars.push(col);
      st.barCols.push(col);
      for (let b = TICKS_PER_QUARTER; b < bar.len; b += TICKS_PER_QUARTER) {
        const beat = make("div", "yue2-roll-beat");
        beat.style.left = `${(bar.t + b) * k}px`;
        bars.push(beat);
      }
      // The head of the measure: a handle at its left (to move it), its number in the
      // middle, and -- while it is the one selected -- icon buttons to add one and delete it.
      const wide = bar.len * k;
      const num = make("div", `yue2-roll-barnum${i === st.measure ? " is-selected" : ""}`);
      num.style.left = `${bar.t * k}px`;
      num.style.width = `${wide}px`;
      num.title = `${bar.meter[0]}/${bar.meter[1]} · ${bar.key}`;
      if (!ro && wide >= 44) {
        const handle = make("span", "yue2-roll-handle", { title: t("yue2.roll.handle") });
        handle.append(icon("grip-vertical"));
        num.append(handle);
      }
      num.append(make("span", "yue2-roll-barno", { textContent: String(i + 1) }));
      // Present in every head, shown by the one selected (the selection moves without a redraw).
      if (!ro && wide >= 60) {
        if (wide < 100) num.classList.add("is-tight");
        const tools = make("span", "yue2-roll-bartools");
        tools.append(
          barButton("plus-lg", t("yue2.roll.measureAddTitle"), () => setPick(st, st.pick && st.pick.kind === "add" ? null : { kind: "add" }), "is-add"),
          barButton("trash", t("yue2.roll.measureDelTitle"), () => deleteMeasure(host, st))
        );
        num.append(tools);
      }
      num.__bar = i;
      st.barHeads.push(num);
      numbers.push(num);
    });

    // With no measure at all, the one thing to do is add the first.
    if (!st.model.bars.length && !ro) numbers.push(barButton("plus-lg", t("yue2.roll.measureAddTitle"), () => addMeasure(host, st, 0), "is-first"));

    // Notes.
    const noteEls = [];
    for (const voice of VOICES) {
      if (!shown(st, voice)) continue;
      for (const n of st.model.notes[voice]) {
        if (midiOf(n) < st.lo || midiOf(n) > st.hi) continue;
        noteEls.push(noteEl(st, voice, n, k));
      }
    }
    st.plot.replaceChildren(...stripes, ...bars, ...noteEls, st.playhead, st.guides);
    st.playhead.style.height = `${height}px`;
    placeHead(st);

    // Chords over the measures.
    const chordEls = (shown(st, CHORDS) ? st.model.chords : []).map((c) => {
      const el = make("button", `yue2-roll-chord${st.sel && st.sel.chord === c ? " is-selected" : ""}`, { type: "button", textContent: c.text });
      el.style.left = `${c.t * k}px`;
      el.style.top = `${BARS_H}px`;
      el.__chord = c;
      if (!parseChord(c.text)) el.classList.add("is-unknown");
      return el;
    });
    const lane = make("div", "yue2-roll-lane");
    st.head.replaceChildren(...numbers, lane, ...chordEls);
    paintGuides(st);
    st.lane = lane;

    drawInspector(host, st);
    if (st.fresh) {
      st.fresh = false;
      const centre = (st.model.notes.Vocal.length ? st.model.notes.Vocal : st.model.notes.Ins).map(midiOf);
      const mid = centre.length ? centre.reduce((a, b) => a + b, 0) / centre.length : (st.hi + st.lo) / 2;
      requestAnimationFrame(() => {
        st.scroll.scrollTop = Math.max(0, rowOf(st, mid) * ROW_H - st.scroll.clientHeight / 2 + BARS_H + CHORDS_H);
      });
    }
  }

  function noteEl(st, voice, n, k) {
    // With two voices shown, the one a new note would go to is the one not dimmed.
    const dim = VOICES.filter((v) => shown(st, v)).length > 1 && activeVoice(st) !== voice;
    const el = make("div", `yue2-roll-note v-${voice}${dim ? " is-dim" : ""}${st.sel && st.sel.note === n ? " is-selected" : ""}`);
    el.style.left = `${n.t * k}px`;
    el.style.top = `${rowOf(st, midiOf(n)) * ROW_H}px`;
    el.style.width = `${Math.max(3, n.d * k - 1)}px`;
    if (n.d * k > 30) el.textContent = noteName(n);
    el.__note = n;
    el.__voice = voice;
    el.append(make("span", "yue2-roll-grow"));
    return el;
  }

  // ---- the selected one ---------------------------------------------------------
  // What a note is changed to, written back: its layer (which moves it to the
  // other voice, which is then shown), pitch and length.
  function applyNote(host, st, sel, value) {
    const n = sel.note;
    let voice = sel.voice;
    if (value.layer !== voice) {
      st.model.notes[voice] = st.model.notes[voice].filter((one) => one !== n);
      voice = value.layer;
      st.layers.add(voice);
      st.voice = voice;
      st.sel = { kind: "note", voice, note: n };
    }
    Object.assign(n, { letter: value.letter, alt: value.alt, oct: value.oct });
    n.d = Math.max(unitTicks(st.p.ctx), Math.min(value.len, endOf(st) - n.t));
    placeNote(st.model, voice, n);
    growRange(st);
    commit(host, st);
    blip(midiOf(n));
  }

  // The notes' lengths this score can be written in: whole units of its L:.
  function lengthOptions(st, n) {
    const unit = unitTicks(st.p.ctx);
    const label = { 4: "1", 3: "1/2.", 2: "1/2", 1.5: "1/4.", 1: "1/4", 0.75: "1/8.", 0.5: "1/8", 0.375: "1/16.", 0.25: "1/16", 0.1875: "1/32.", 0.125: "1/32", 0.0625: "1/64" };
    const list = Object.keys(label)
      .map(Number)
      .sort((a, b) => b - a)
      .map((q) => ({ value: Math.round(q * TICKS_PER_QUARTER), label: label[q] }))
      .filter((one) => one.value % unit === 0);
    if (!list.some((one) => one.value === n.d)) list.push({ value: n.d, label: `${n.d / unit}` });
    return list;
  }

  function drawInspector(host, st) {
    const sel = st.sel;
    syncBar(st);
    // What is selected, as a value in a card: the note, the chord, or none.
    let spec;
    if (!sel) {
      spec = { type: "yue2.note", read: () => null, empty: t("yue2.roll.noSelection"), emptyLabel: t("yue2.roll.selected") };
    } else if (sel.kind === "note") {
      const n = sel.note;
      spec = {
        type: "yue2.note",
        read: () => ({ layer: sel.voice, letter: n.letter, alt: n.alt, oct: n.oct, len: n.d }),
        write: (_api, value) => applyNote(host, st, sel, value),
        options: { len: lengthOptions(st, n) },
      };
    } else {
      const c = sel.chord;
      spec = {
        type: "yue2.chord",
        lead: [{ key: "layer", label: t("yue2.roll.layer"), value: t("yue2.roll.layerChords") }],
        read: () => parseChord(c.text) || { root: "C", quality: "", bass: "" },
        write: (_api, value) => {
          c.text = chordText(value);
          commit(host, st);
        },
      };
    }
    const desc = fw.describe({ ...spec, readonly: Boolean(st.p.readonly), onRemove: () => removeSelected(host, st) }, { key: "note", label: t("yue2.roll.noteCard") });
    fw.controls["yue2.notecard"].update(st.noteCard, desc);
  }

  function removeSelected(host, st) {
    const sel = st.sel;
    if (!sel || st.p.readonly) return;
    if (sel.kind === "note") st.model.notes[sel.voice] = st.model.notes[sel.voice].filter((n) => n !== sel.note);
    else st.model.chords = st.model.chords.filter((c) => c !== sel.chord);
    st.sel = null;
    commit(host, st);
  }

  // ---- writing back ------------------------------------------------------------
  function commit(host, st) {
    st.model.chords.sort((a, b) => a.t - b.t);
    // What is heard is what was there when it began.
    st.player.stop();
    const text = serializeBody(st.model, st.p.ctx);
    st.text = text;
    st.sig = `${text}\u0000${JSON.stringify(st.p.ctx)}`;
    draw(host, st);
    st.p.onChange(text);
  }

  // ---- the pointer ---------------------------------------------------------------
  function wirePlot(host, st) {
    const where = (event, el = st.plot) => {
      const r = el.getBoundingClientRect();
      return { x: event.clientX - r.left, y: event.clientY - r.top };
    };
    const snapDown = (ticks) => Math.floor(ticks / st.snap + 1e-9) * st.snap;
    const toTicks = (x) => x / px(st);

    st.plot.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || st.p.readonly) return;
      host.focus({ preventScroll: true });
      const { x, y } = where(event);
      const target = event.target.closest(".yue2-roll-note");
      const end = endOf(st);
      capture(st.plot, event);
      if (target) {
        const n = target.__note;
        const voice = target.__voice;
        // Pressed again while selected (and not moved): it is let go of.
        const was = Boolean(st.sel && st.sel.note === n);
        st.voice = voice;
        st.sel = { kind: "note", voice, note: n };
        // Playing would start from the note taken hold of.
        st.from = n.t;
        follow(st);
        placeHead(st);
        const edge = target.getBoundingClientRect().right - event.clientX < 7;
        st.drag = { kind: edge ? "resize" : "move", n, voice, x0: x, y0: y, t: n.t, d: n.d, midi: midiOf(n), moved: false, was, orig: { letter: n.letter, alt: n.alt, oct: n.oct } };
        syncBar(st);
        drawInspector(host, st);
        for (const el of st.plot.querySelectorAll(".yue2-roll-note")) el.classList.toggle("is-selected", el.__note === n);
        return;
      }
      st.sel = null;
      const t0 = snapDown(toTicks(x));
      if (t0 >= end || x < 0) return;
      const voice = activeVoice(st);
      if (!voice) return;
      const midi = st.hi - Math.floor(y / ROW_H);
      st.drag = { kind: "create", voice, t0, midi, x0: x, d: st.lastLen || st.snap, moved: false };
      st.drag.draft = make("div", `yue2-roll-note is-draft v-${voice}`);
      st.plot.append(st.drag.draft);
      layoutDraft(st);
    });

    st.plot.addEventListener("pointermove", (event) => {
      const d = st.drag;
      if (!d) return;
      const { x, y } = where(event);
      const end = endOf(st);
      if (d.kind === "create") {
        if (Math.abs(x - d.x0) > 4) d.moved = true;
        if (d.moved) d.d = Math.max(st.snap, snapDown(toTicks(x)) + st.snap - d.t0);
        d.d = Math.min(d.d, end - d.t0);
        layoutDraft(st);
      } else if (d.kind === "move") {
        if (Math.abs(x - d.x0) > 3 || Math.abs(y - d.y0) > 3) d.moved = true;
        if (!d.moved) return;
        const dt = Math.round(toTicks(x - d.x0) / st.snap) * st.snap;
        d.n.t = Math.max(0, Math.min(end - d.n.d, d.t + dt));
        const dm = -Math.round((y - d.y0) / ROW_H);
        const midi = Math.max(0, Math.min(127, d.midi + dm));
        if (dm === 0) Object.assign(d.n, d.orig);
        else Object.assign(d.n, spell(midi, keyAt(st, d.n.t)));
        const el = [...st.plot.querySelectorAll(".yue2-roll-note")].find((e) => e.__note === d.n);
        if (el) {
          el.style.left = `${d.n.t * px(st)}px`;
          el.style.top = `${rowOf(st, midiOf(d.n)) * ROW_H}px`;
        }
      } else if (d.kind === "resize") {
        d.moved = true;
        const stop = snapDown(toTicks(x)) + st.snap;
        d.n.d = Math.max(st.snap, Math.min(end - d.n.t, stop - d.n.t));
        const el = [...st.plot.querySelectorAll(".yue2-roll-note")].find((e) => e.__note === d.n);
        if (el) el.style.width = `${Math.max(3, d.n.d * px(st) - 1)}px`;
      }
    });

    const finish = (event, cancelled) => {
      const d = st.drag;
      st.drag = null;
      if (!d) return;
      if (d.draft) d.draft.remove();
      if (cancelled) {
        if (d.n) Object.assign(d.n, { t: d.t, d: d.d, ...d.orig });
        return;
      }
      if (d.kind === "create") {
        const unit = unitTicks(st.p.ctx);
        if (d.d < unit) return;
        const note = { t: d.t0, d: d.d, ...spell(Math.max(0, Math.min(127, d.midi)), keyAt(st, d.t0)) };
        placeNote(st.model, d.voice, note);
        st.lastLen = d.d;
        st.sel = { kind: "note", voice: d.voice, note };
        growRange(st);
        commit(host, st);
        blip(midiOf(note));
      } else if (d.moved) {
        placeNote(st.model, d.voice, d.n);
        st.lastLen = d.n.d;
        growRange(st);
        commit(host, st);
        blip(midiOf(d.n));
      } else if (d.was) {
        st.sel = null;
        draw(host, st);
      } else blip(midiOf(d.n));
    };
    st.plot.addEventListener("pointerup", (event) => finish(event, false));
    st.plot.addEventListener("pointercancel", (event) => finish(event, true));

    // The chord lane: click for a chord, click a chord to select, drag to move.
    st.head.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || st.p.readonly) return;
      // The buttons of a measure's head act by their own click.
      if (event.target.closest(".yue2-roll-barbtn")) return;
      host.focus({ preventScroll: true });
      const { x } = where(event, st.head);
      const chip = event.target.closest(".yue2-roll-chord");
      const inBars = !chip && event.clientY - st.head.getBoundingClientRect().top < BARS_H && st.model.bars.length;
      // The handle of a measure: taken hold of to move it; the guides show where it may go.
      const handle = inBars && event.target.closest(".yue2-roll-handle");
      if (handle) {
        const index = handle.parentElement.__bar;
        capture(st.head, event);
        selectMeasure(st, index);
        st.from = st.model.bars[index].t;
        placeHead(st);
        syncBar(st);
        st.drag = { kind: "bar", index, over: null };
        st.barCols[index].classList.add("is-moving");
        setPick(st, { kind: "move", index });
        return;
      }
      // The head of a measure: it is selected, and playing starts from it.
      if (inBars) {
        moveTo(host, st, st.model.bars[barAt(st, toTicks(x))].t);
        return;
      }
      capture(st.head, event);
      if (chip) {
        st.sel = { kind: "chord", chord: chip.__chord };
        st.from = chip.__chord.t;
        follow(st);
        placeHead(st);
        st.drag = { kind: "chord", c: chip.__chord, x0: x, t: chip.__chord.t, moved: false };
        for (const el of st.head.querySelectorAll(".yue2-roll-chord")) el.classList.toggle("is-selected", el.__chord === chip.__chord);
        for (const el of st.plot.querySelectorAll(".yue2-roll-note")) el.classList.remove("is-selected");
        drawInspector(host, st);
        return;
      }
      if (shown(st, CHORDS) && event.target.closest(".yue2-roll-lane") && event.clientY - st.head.getBoundingClientRect().top >= BARS_H) {
        const tick = Math.min(snapDown(toTicks(x)), endOf(st) - unitTicks(st.p.ctx));
        if (tick < 0) return;
        const before = [...st.model.chords].filter((c) => c.t <= tick).pop();
        st.model.chords = st.model.chords.filter((c) => c.t !== tick);
        const c = { t: tick, text: before ? before.text : "C" };
        st.model.chords.push(c);
        st.sel = { kind: "chord", chord: c };
        commit(host, st);
      }
    });
    // The half of a measure under the pointer, when it is one the measure taken may go to.
    const overHalf = (x) => {
      const bars = st.model.bars;
      const tick = toTicks(x);
      if (!bars.length || tick > endOf(st)) return null;
      const at = barAt(st, tick);
      const side = tick - bars[at].t < bars[at].len / 2 ? "left" : "right";
      return st.guides.querySelector(`.mu-guide[data-bar="${at}"][data-side="${side}"]`) ? { bar: at, side } : null;
    };
    st.head.addEventListener("pointermove", (event) => {
      const d = st.drag;
      if (d && d.kind === "bar") {
        const { x } = where(event, st.head);
        d.over = overHalf(x);
        for (const guide of st.guides.children) {
          guide.classList.toggle("is-over", Boolean(d.over) && guide.dataset.bar === String(d.over.bar) && guide.dataset.side === d.over.side);
        }
        return;
      }
      if (!d || d.kind !== "chord") return;
      const { x } = where(event, st.head);
      if (Math.abs(x - d.x0) > 3) d.moved = true;
      if (!d.moved) return;
      d.c.t = Math.max(0, Math.min(endOf(st) - unitTicks(st.p.ctx), d.t + Math.round(toTicks(x - d.x0) / st.snap) * st.snap));
      const el = [...st.head.querySelectorAll(".yue2-roll-chord")].find((e) => e.__chord === d.c);
      if (el) el.style.left = `${d.c.t * px(st)}px`;
    });
    const endChord = (event) => {
      const d = st.drag;
      if (d && d.kind === "bar") {
        st.drag = null;
        cancelPick(st);
        if (st.barCols[d.index]) st.barCols[d.index].classList.remove("is-moving");
        if (event.type !== "pointercancel" && d.over) {
          const at = moveBarTo(st.model, d.index, d.over.side === "left" ? d.over.bar : d.over.bar + 1);
          if (at >= 0) {
            st.sel = null;
            st.measure = at;
            st.from = st.model.bars[at].t;
            commit(host, st);
            placeHead(st);
          }
        }
        return;
      }
      if (!d || d.kind !== "chord") return;
      st.drag = null;
      if (d.moved) {
        st.model.chords = st.model.chords.filter((c) => c === d.c || c.t !== d.c.t);
        commit(host, st);
      }
    };
    st.head.addEventListener("pointerup", endChord);
    st.head.addEventListener("pointercancel", endChord);
  }

  // A pointer that is gone (a synthetic event, a lifted finger) is not an error.
  function capture(el, event) {
    try {
      el.setPointerCapture(event.pointerId);
    } catch {
      /* not active */
    }
  }

  function layoutDraft(st) {
    const d = st.drag;
    const k = px(st);
    const sp = spell(Math.max(0, Math.min(127, d.midi)), keyAt(st, d.t0));
    d.draft.style.left = `${d.t0 * k}px`;
    d.draft.style.top = `${rowOf(st, d.midi) * ROW_H}px`;
    d.draft.style.width = `${Math.max(3, d.d * k - 1)}px`;
    d.draft.textContent = d.d * k > 30 ? noteName({ ...sp }) : "";
  }

  // ---- the keyboard ------------------------------------------------------------------
  function wireKeys(host, st) {
    host.addEventListener("keydown", (event) => {
      if (/^(INPUT|SELECT|TEXTAREA)$/.test(event.target.tagName) || st.p.readonly || !st.model) return;
      if (event.key === "Escape" && st.pick) {
        cancelPick(st);
        return;
      }
      if (event.key === "Escape" && (st.sel || st.measure >= 0)) {
        st.sel = null;
        st.measure = -1;
        draw(host, st);
        syncBar(st);
        return;
      }
      if (!st.sel) return;
      const sel = st.sel;
      const end = endOf(st);
      let handled = true;
      if (event.key === "Delete" || event.key === "Backspace") return removeSelected(host, st), event.preventDefault();
      if (sel.kind === "note") {
        const n = sel.note;
        if (event.key === "ArrowLeft") n.t = Math.max(0, n.t - st.snap);
        else if (event.key === "ArrowRight") n.t = Math.min(end - n.d, n.t + st.snap);
        else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
          const step = (event.key === "ArrowUp" ? 1 : -1) * (event.shiftKey ? 12 : 1);
          Object.assign(n, spell(Math.max(0, Math.min(127, midiOf(n) + step)), keyAt(st, n.t)));
        } else if (event.key === "[") n.d = Math.max(st.snap, n.d - st.snap);
        else if (event.key === "]") n.d = Math.min(end - n.t, n.d + st.snap);
        else handled = false;
        if (handled) {
          placeNote(st.model, sel.voice, n);
          growRange(st);
          commit(host, st);
          blip(midiOf(n));
        }
      } else if (sel.kind === "chord") {
        const c = sel.chord;
        if (event.key === "ArrowLeft") c.t = Math.max(0, c.t - st.snap);
        else if (event.key === "ArrowRight") c.t = Math.min(end - unitTicks(st.p.ctx), c.t + st.snap);
        else handled = false;
        if (handled) {
          st.model.chords = st.model.chords.filter((x) => x === c || x.t !== c.t);
          commit(host, st);
        }
      } else handled = false;
      if (handled) event.preventDefault();
    });
  }

  // ---- the control ---------------------------------------------------------------------
  registerControl("yue2.roll", {
    label: "yue2.control.roll",
    // A score as notes to drag and chords to set, with the rules of YuE2's
    // dialect kept by the writer: no shell card draws pitch against time.
    why: "A section of YuE2's ABC as a piano roll: notes of the two voices and the chords, edited by dragging, written back as ABC text.",
    standalone: true,
    params: ["text", "ctx", "onChange", "readonly", "parts", "part", "onPart", "port"],
    sampleParams: {
      text: "V: Vocal\n\"C\"C8D8E8G8|\nV: Ins\nZ|",
      ctx: { den: 32, meter: [4, 4], key: "C" },
      onChange: () => {},
    },
    render(desc) {
      const host = make("div", "");
      const st = build(host);
      st.p = desc.params;
      fw.controls["yue2.roll"].update(host, desc);
      return host;
    },
    update(host, desc) {
      const st = host.__roll;
      st.p = { onChange: () => {}, ...desc.params };
      // The head: the grip carrying the open part, and its name.
      fw.card.syncHead(host, st.cardHead, { port: st.p.port || null, name: desc.head || "" });
      const changed = load(host, st);
      st.wantFirst = false;
      syncBar(st);
      host.classList.toggle("is-readonly", Boolean(st.p.readonly));
      if (changed || !st.drawn) {
        st.drawn = true;
        draw(host, st);
      }
    },
  });
}
