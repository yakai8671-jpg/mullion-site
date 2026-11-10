/* yue2.abccard -- the shell's text card, holding a song written in ABC, with
 * the score drawn from it and a way to hear it.
 *
 * YuE2 plans a song before it sings it: a first pass writes the melody (and
 * the chords, in "full" mode) as ABC, one voice for the vocal line and one
 * for the instruments, and the second pass makes the audio from that plan.
 * The plan is text a person can change -- a note, a bar, a whole section --
 * so this is where it is changed: the `texteditor` control with more around
 * it, like the JSON card. The grip, the link it can follow, copy and the
 * one-line fold are the shell's; what is added is
 *
 *   a Mullion action bar       score status, view switch, voice mutes, and
 *                            to-start / previous-line / play (it says the
 *                            page) / next-line / to-end controls
 *   the score                drawn by abcjs (vendor/, MIT) from the text,
 *                            again a moment after each change, a page of
 *                            lines at a time; a note clicked there selects
 *                            its letters in the text, and playing starts
 *                            from it
 *   the action bar status      how long it plays, its tempo, and what abcjs
 *                            could not read
 *
 * The document is always the text; the score is only ever drawn from it.
 * Playing is a few oscillators per note, scheduled a little ahead, so that
 * nothing is fetched (abcjs's own synth would load a sound font from the
 * web): it is for hearing the tune, not the song.
 *
 * Which view is shown is the placer's to keep (`options.view`, bound with
 * `binds: { options: { view: ... } }`; unbound, the card keeps it itself).
 * The placer may hand the card its one primary action (`action`: run, or
 * cancel while running) and say it is `busy`, which makes the text fixed
 * until the run is done.
 */

export const VIEWS = ["text", "score"];

// The width a score is laid out at, whatever the card: wide enough for four
// measures to a line (narrower, abcjs fits as many as it can -- 3, 5, 8 --
// and the lines come out different). It is scaled to the card after.
const SCORE_WIDTH = 1100;
// The score is shown a page at a time: this many staff lines (four measures
// each) to a page, drawn one line to an element so that a page is only which
// lines are shown. The page is wherever playing (or the place it starts from)
// is. One line to a page.
const PAGE_LINES = 1;
export const ABC_DEFAULTS = { view: "score" };

// abcjs is a UMD bundle: as a classic script it sets window.ABCJS. Loaded
// once, on the first card that draws a score.
let LIBRARY = null;
let ABCJS = null;
function library() {
  if (!LIBRARY) {
    LIBRARY = new Promise((resolve, reject) => {
      if (window.ABCJS) return resolve(window.ABCJS);
      const script = document.createElement("script");
      script.src = new URL("./vendor/abcjs-basic-min.js", import.meta.url).href;
      script.onload = () => (window.ABCJS ? resolve(window.ABCJS) : reject(new Error("abcjs did not load")));
      script.onerror = () => reject(new Error("abcjs did not load"));
      document.head.append(script);
    })
      .then((found) => (ABCJS = found))
      .catch((error) => {
        LIBRARY = null;
        throw error;
      });
  }
  return LIBRARY;
}

// How long after the last keystroke the score is drawn again: a long song is
// a few hundred milliseconds of layout, too much for every letter.
const REDRAW_MS = 400;

// The sound of each voice, by its place: the vocal line first, then the
// instruments, then the chords abcjs makes from the chord symbols. The levels
// were set by measuring the output beside the vocal (the instrument's notes are
// short, so its level is read at its peaks): at 0.16 the instrument's peaks were
// a third of the vocal's and its notes, short and quiet, were lost beside it.
const TIMBRES = [
  { type: "triangle", level: 0.5 },
  { type: "square", level: 0.4 },
  { type: "sine", level: 0.35 },
];
const timbreOf = (track) => TIMBRES[Math.min(track, TIMBRES.length - 1)];
const LOOKAHEAD_S = 0.4;
const PUMP_MS = 50;

const frequencyOf = (pitch) => 440 * 2 ** ((pitch - 69) / 12);

// m:ss
const clockOf = (seconds) => {
  const whole = Math.max(0, Math.round(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
};

// What abcjs is given is not quite the document's text, in two ways. A score's
// margin is narrow for "Vocal Melody": the staves are drawn with the voice's
// own id as their name ("Vocal", "Ins"). And a rest of several measures
// ("Z4") is written out as that many rests of one ("Z|Z|Z|Z|"): abcjs plays
// "Z4" as four measures but draws it one measure wide, so the voices that
// follow it were drawn under the wrong notes of the other voice (the second
// voice's notes stood beneath the first's while sounding two or three
// measures later). That changes the text abcjs is given, so what it says about
// where a note is (startChar) is moved back to the document's own: `edits` are
// {end, delta} in the drawn text.
function shortNames(text) {
  const edits = [];
  let shift = 0;
  let at = 0;
  const shown = text
    .split("\n")
    .map((line) => {
      const start = at;
      at += line.length + 1;
      let out = line;
      const voice = /^V:[ 	]*(\S+)([^\n]*)$/.exec(line);
      if (voice) {
        if (!/(?:name|snm)=/.test(voice[2])) return line;
        const clef = /clef=\S+/.exec(voice[2]);
        out = `V: ${voice[1]}${clef ? ` ${clef[0]}` : ""} name="${voice[1]}" snm="${voice[1]}"`;
        edits.push({ end: start + shift + out.length, delta: out.length - line.length });
        shift += out.length - line.length;
        return out;
      }
      // Music lines only: not the information fields ("T:", "W:"...) or comments.
      if (/^(?:[A-Za-z]:|%)/.test(line)) return line;
      let moved = 0;
      out = line.replace(/(?<![A-Za-z0-9"!])Z(\d+)\|/g, (match, count, index) => {
        const n = Number(count);
        if (n < 1 || n > 64) return match;
        const rests = "Z|".repeat(n);
        moved += rests.length - match.length;
        edits.push({ end: start + shift + index + moved + match.length, delta: rests.length - match.length });
        return rests;
      });
      shift += moved;
      return out;
    })
    .join("\n");
  return { shown, original: (offset) => offset - edits.reduce((sum, e) => (e.end <= offset ? sum + e.delta : sum), 0) };
}

// What abcjs says it could not read comes as HTML.
const plain = (html) => String(html || "").replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();

// The tune as notes to play: what abcjs's own audio would play, read from
// the same timing (start and length in whole notes), one list over all the
// voices, in time order.
function notesOf(tune) {
  const audio = tune.setUpAudio({});
  const secondsPerWhole = 240 / (Number(audio.tempo) || 120);
  const voices = [];
  const notes = [];
  // abcjs makes one more track of its own from the chord symbols: it has no
  // staff and no name, and it is the chords, played.
  const chordTracks = new Set();
  audio.tracks.forEach((track, index) => {
    let name = "";
    for (const event of track) {
      if (event.cmd === "text" && event.type === "name" && !name) name = String(event.text || "");
      if (event.cmd === "note" && Number.isFinite(event.pitch)) notes.push({ ...event, track: index });
    }
    if (!name) chordTracks.add(index);
    voices.push(name || `#${index + 1}`);
  });
  notes.sort((a, b) => a.start - b.start);
  return { notes, voices, chordTracks, secondsPerWhole, seconds: (Number(audio.totalDuration) || 0) * secondsPerWhole, tempo: audio.tempo };
}

// Where each rendered staff line begins, in whole notes -- one for every line,
// the lines of rests only included (a line is not skipped, or the lines of the
// score and the pages of the player no longer match). From abcjs's own timing,
// which has every line's first element; else (below) from the first note of
// each line, which a line of rests does not have.
function lineStartsOf(tune, sound) {
  try {
    const first = new Map();
    for (const event of new ABCJS.TimingCallbacks(tune, {}).noteTimings) {
      if (event.type !== "event" || !Number.isFinite(event.line) || !Number.isFinite(event.milliseconds)) continue;
      if (!first.has(event.line) || first.get(event.line) > event.milliseconds) first.set(event.line, event.milliseconds);
    }
    if (first.size) return [...first.keys()].sort((a, b) => a - b).map((line) => first.get(line) / 1000 / sound.secondsPerWhole);
  } catch {
    /* the notes tell it, below */
  }
  const starts = [];
  for (const line of (tune && tune.lines) || []) {
    const chars = [];
    const seen = new WeakSet();
    const visit = (value) => {
      if (!value || typeof value !== "object" || seen.has(value)) return;
      seen.add(value);
      if (Array.isArray(value)) {
        value.forEach(visit);
        return;
      }
      const element = value.abcelem && typeof value.abcelem === "object" ? value.abcelem : value;
      const kind = element.el_type || value.el_type;
      const at = Number(element.startChar ?? value.startChar);
      if (kind === "note" && Number.isFinite(at)) chars.push(at);
      for (const [key, child] of Object.entries(value)) {
        if (key !== "abselem" && key !== "elemset" && child && typeof child === "object") visit(child);
      }
    };
    visit(line);
    if (!chars.length) continue;
    const firstChar = Math.min(...chars);
    const note = sound.notes.find((one) => Number.isFinite(one.startChar) && one.startChar >= firstChar);
    if (note) starts.push(note.start);
  }
  if (!starts.length && sound && sound.notes.length) starts.push(sound.notes[0].start);
  return [...new Set(starts)].sort((a, b) => a - b);
}

// The chord symbols drawn in the score, each with the time it sounds (whole
// notes) and its text elements, so that the chords can be shown as they play:
// the chord track has no staff of its own. A symbol is drawn at the x of the
// note or rest it is written on, in that element's line, measure and voice.
function chordMarksOf(tune, sound) {
  const marks = [];
  try {
    const times = new Map();
    for (const event of new ABCJS.TimingCallbacks(tune, {}).noteTimings) {
      if (Number.isFinite(event.startChar) && Number.isFinite(event.milliseconds) && !times.has(event.startChar)) times.set(event.startChar, event.milliseconds);
    }
    for (const line of tune.lines || []) {
      for (const staff of line.staff || []) {
        for (const voice of staff.voices || []) {
          for (const element of voice) {
            if (!element.chord || !element.chord.length || !times.has(element.startChar)) continue;
            const found = tune.getElementFromChar(element.startChar);
            const node = found && found.abselem && found.abselem.elemset && found.abselem.elemset[0];
            if (!node || !node.ownerSVGElement) continue;
            const places = [...node.classList].filter((name) => /^abcjs-(l|m|v)\d+$/.test(name));
            const nodes = [...node.ownerSVGElement.querySelectorAll(".abcjs-chord")].filter((one) => (
              places.every((name) => one.classList.contains(name)) && Math.abs(parseFloat(one.getAttribute("x")) - found.abselem.x) < 0.5
            ));
            if (nodes.length) marks.push({ start: times.get(element.startChar) / 1000 / sound.secondsPerWhole, nodes });
          }
        }
      }
    }
  } catch {
    /* the chords are then only heard */
  }
  return marks.sort((a, b) => a.start - b.start);
}

// Also what the piano roll plays with (roll.js): `start` takes {voices, notes
// ({start, duration, pitch, volume, track} in whole notes), secondsPerWhole,
// seconds}.
export function createPlayer({ onTick, onEnd }) {
  let context = null;
  let state = null;

  function sound(note, at, length) {
    const { type, level } = timbreOf(note.track);
    const peak = (Math.min(127, Number(note.volume) || 90) / 127) * level;
    const oscillator = context.createOscillator();
    oscillator.type = type;
    oscillator.frequency.value = frequencyOf(note.pitch);
    const envelope = context.createGain();
    envelope.gain.setValueAtTime(0, at);
    envelope.gain.linearRampToValueAtTime(peak, at + 0.01);
    envelope.gain.setTargetAtTime(peak * 0.6, at + 0.01, 0.12);
    envelope.gain.setTargetAtTime(0, at + Math.max(0.02, length - 0.03), 0.03);
    oscillator.connect(envelope).connect(state.tracks[note.track]);
    oscillator.start(at);
    oscillator.stop(at + length + 0.2);
    state.sources.add(oscillator);
    oscillator.onended = () => state && state.sources.delete(oscillator);
  }

  function pump() {
    const now = context.currentTime;
    const { notes, secondsPerWhole, t0 } = state;
    while (state.next < notes.length) {
      const note = notes[state.next];
      const at = t0 + note.start * secondsPerWhole;
      if (at > now + LOOKAHEAD_S) break;
      state.next++;
      if (at >= now - 0.02) sound(note, at, Math.max(0.04, note.duration * secondsPerWhole));
    }
    // Never before where it began: the first ticks come ahead of the first note
    // (the start is scheduled a little in front, and a context that was
    // suspended is slow to run), and a place just before the start of a line
    // is the end of the line before -- which showed the page before.
    const position = Math.max(state.from, (now - t0) / secondsPerWhole);
    onTick(position);
    if (now > t0 + state.length + 0.3) {
      stop();
      onEnd();
    }
  }

  // `from` is in whole notes, as abcjs counts.
  function start(tune, muted, from = 0) {
    stop();
    context = context || new AudioContext();
    context.resume();
    const master = context.createGain();
    master.gain.value = 0.3;
    master.connect(context.destination);
    const tracks = tune.voices.map((_, index) => {
      const gain = context.createGain();
      gain.gain.value = muted.has(index) ? 0 : 1;
      gain.connect(master);
      return gain;
    });
    const first = tune.notes.findIndex((note) => note.start >= from - 1e-6);
    state = {
      notes: tune.notes,
      secondsPerWhole: tune.secondsPerWhole,
      t0: context.currentTime + 0.08 - from * tune.secondsPerWhole,
      length: tune.seconds,
      from,
      next: first < 0 ? tune.notes.length : first,
      master,
      tracks,
      sources: new Set(),
      timer: setInterval(pump, PUMP_MS),
    };
    pump();
  }

  function stop() {
    if (!state) return;
    clearInterval(state.timer);
    for (const source of state.sources) {
      try {
        source.stop();
      } catch {
        /* already stopped */
      }
    }
    state.master.disconnect();
    state = null;
    context.suspend().catch(() => {});
  }

  function mute(track, muted) {
    if (state && state.tracks[track]) state.tracks[track].gain.value = muted ? 0 : 1;
  }

  return { start, stop, mute, playing: () => Boolean(state) };
}

export default function registerCard(fw) {
  const { core, registerControl } = fw;
  const { t } = core;

  const make = (tag, className, props) => Object.assign(document.createElement(tag), { className, ...props });
  const icon = (name) => make("i", `bi bi-${name}`);
  const VIEW_ICONS = { text: "code-slash", score: "music-note-list" };

  // Put `text` where `from..to` is, through the browser's own editing, so
  // that undo works and the textarea says `input`.
  function replaceRange(area, from, to, text) {
    area.focus();
    area.setSelectionRange(from, to);
    let done = false;
    try {
      done = document.execCommand("insertText", false, text);
    } catch {
      done = false;
    }
    if (!done) {
      area.setRangeText(text, from, to, "end");
      area.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }

  function build(el) {
    const slots = fw.controls.texteditor.slots(el);
    const area = slots.area;
    const parts = {
      area,
      texts: [],
      local: { ...ABC_DEFAULTS },
      drawn: null,
      width: 0,
      tune: null,
      sound: null,
      muted: new Set(),
      from: 0,
      position: 0,
      lineStarts: [],
      chordMarks: [],
      // The lines of the score as drawn, each with its page: [{node, page}].
      rows: [],
      page: -1,
      lit: [],
      litKey: "",
    };
    const say = (node, key, attr = "title") => {
      parts.texts.push({ node, key, attr });
      return node;
    };
    const options = () => ({ ...ABC_DEFAULTS, ...(el.__desc.params.options || parts.local) });
    const setOption = (key, value) => {
      const desc = el.__desc;
      if (desc.set && desc.set("options", { ...options(), [key]: value })) return;
      parts.local[key] = value;
      update(el, desc);
    };

    // ---- the primary action, first in the header (when provided) ----
    parts.act = make("button", "mu-icon-button is-primary yue2-abc-act", { type: "button" });
    parts.act.append(icon("stars"), make("span", "mu-button-label"));
    parts.act.addEventListener("click", (event) => {
      event.stopPropagation();
      const action = el.__desc.params.action;
      if (action && !action.disabled) action.run();
    });
    slots.lead(parts.act);

    // ---- the Mullion action bar ----
    const bar = fw.card.bar(el);
    bar.classList.add("is-stack", "yue2-abc-bar");
    const controls = make("div", "mu-action-bar-row is-thirds yue2-abc-control-row");
    // One row: what the song is, then the voices (left), the transport (middle), text or score (right).
    const left = make("div", "mu-action-bar-start yue2-abc-left");
    const views = make("div", "mu-segments mu-action-bar-end yue2-abc-views");
    parts.views = {};
    for (const view of VIEWS) {
      const segment = make("button", "mu-segment", { type: "button" });
      segment.append(icon(VIEW_ICONS[view]), say(make("span", "mu-segment-label"), `yue2.abc.view.${view}`, "textContent"));
      segment.addEventListener("click", (event) => {
        event.stopPropagation();
        if (options().view !== view) setOption("view", view);
      });
      parts.views[view] = segment;
      views.append(segment);
    }
    // The layers played (and greyed in the score when left out): a popup checklist.
    parts.voices = fw.controls.popupchecklist.render({ params: { items: [] } });
    parts.transport = make("div", "mu-action-bar-middle yue2-abc-transport");
    parts.previous = say(make("button", "mu-icon-button yue2-abc-skip", { type: "button" }), "yue2.abc.prevLine");
    parts.previous.append(icon("skip-start-fill"));
    say(parts.previous, "yue2.abc.prevLine", "aria-label");
    parts.previous.addEventListener("click", (event) => {
      event.stopPropagation();
      skipLine(-1);
    });
    parts.play = make("button", "mu-icon-button is-primary yue2-abc-play", { type: "button" });
    parts.play.append(icon("play-fill"), make("span", "mu-button-label"));
    parts.play.addEventListener("click", (event) => {
      event.stopPropagation();
      togglePlay();
    });
    parts.next = say(make("button", "mu-icon-button yue2-abc-skip", { type: "button" }), "yue2.abc.nextLine");
    parts.next.append(icon("skip-end-fill"));
    say(parts.next, "yue2.abc.nextLine", "aria-label");
    parts.next.addEventListener("click", (event) => {
      event.stopPropagation();
      skipLine(1);
    });
    // The large moves: to the start, and to the last line (where it starts).
    const edgeButton = (direction) => {
      const key = direction < 0 ? "yue2.abc.toStart" : "yue2.abc.toEnd";
      const button = say(make("button", "mu-icon-button yue2-abc-skip yue2-abc-edge", { type: "button" }), key);
      button.append(icon(direction < 0 ? "skip-backward-fill" : "skip-forward-fill"));
      say(button, key, "aria-label");
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        goEdge(direction);
      });
      return button;
    };
    parts.first = edgeButton(-1);
    parts.last = edgeButton(1);
    parts.transport.append(parts.first, parts.previous, parts.play, parts.next, parts.last);
    parts.facts = make("span", "yue2-abc-facts mu-action-bar-extra");
    left.append(parts.facts, parts.voices);
    controls.append(left, parts.transport, views);
    const togglePlay = () => (parts.player.playing() ? stopPlaying() : startPlaying());

    // ---- the score ----
    parts.score = make("div", "yue2-abc-score");
    parts.paper = make("div", "yue2-abc-paper");
    parts.score.append(parts.paper);

    // ---- status sits in the same bar as the transport ----
    // What abcjs could not read is a row of its own, there only when there is something to say.
    parts.status = make("div", "mu-action-bar-row abc-status yue2-abc-status");
    parts.problem = make("span", "yue2-abc-problem");
    parts.status.append(parts.problem);
    bar.append(controls, parts.status);

    parts.player = createPlayer({
      onTick: (position) => {
        parts.position = position;
        light(position);
        syncSkip();
      },
      onEnd: () => {
        unlight();
        syncPlay();
      },
    });

    function startPlaying() {
      if (!parts.sound || !parts.sound.notes.length) return;
      parts.position = parts.from || 0;
      parts.player.start(parts.sound, parts.muted, parts.from || 0);
      syncPlay();
    }
    function stopPlaying() {
      parts.player.stop();
      unlight();
      syncPlay();
    }
    parts.stopPlaying = stopPlaying;

    function syncPlay() {
      const playing = parts.player.playing();
      const title = t(playing ? "yue2.abc.stop" : parts.from ? "yue2.abc.playFrom" : "yue2.abc.play", {
        at: clockOf((parts.from || 0) * (parts.sound ? parts.sound.secondsPerWhole : 0)),
      });
      const disabled = !playing && !(parts.sound && parts.sound.notes.length);
      parts.play.firstElementChild.className = `bi bi-${playing ? "stop-fill" : "play-fill"}`;
      parts.playLabel();
      parts.play.title = title;
      parts.play.setAttribute("aria-label", title);
      parts.play.setAttribute("aria-pressed", String(playing));
      parts.play.disabled = disabled;
      parts.play.classList.toggle("is-active", playing);
      syncSkip();
    }
    parts.syncPlay = syncPlay;
    // The play button says the page shown, of the pages there are (as the
    // score editor's says its song part); the word when there is only one.
    parts.playLabel = () => {
      const pages = parts.rows.length ? pageCount() : 0;
      const playing = parts.player.playing();
      const text = pages > 1 && parts.page >= 0 ? `${parts.page + 1}/${pages}` : t(playing ? "yue2.abc.stopShort" : "yue2.abc.playShort");
      if (parts.play.lastElementChild.textContent !== text) parts.play.lastElementChild.textContent = text;
    };

    function lineIndexAt(position) {
      let index = 0;
      while (index + 1 < parts.lineStarts.length && parts.lineStarts[index + 1] <= position + 0.01) index++;
      return index;
    }
    function syncSkip() {
      const lines = parts.lineStarts;
      if (!lines.length) {
        parts.previous.disabled = true;
        parts.next.disabled = true;
        parts.first.disabled = true;
        parts.last.disabled = true;
        return;
      }
      const position = parts.player.playing() ? parts.position : parts.from;
      const index = lineIndexAt(position);
      parts.previous.disabled = !(index > 0 || position > lines[index] + 0.01);
      parts.next.disabled = index >= lines.length - 1;
      parts.first.disabled = !(index > 0 || position > lines[0] + 0.01);
      parts.last.disabled = index >= lines.length - 1;
      showPage(pageOfLine(index));
    }
    // Playing (or the place it starts from) goes to `at`, in whole notes.
    function moveTo(at) {
      const playing = parts.player.playing();
      if (Math.abs(at - parts.from) < 1e-6 && !playing) return;
      parts.from = at;
      parts.position = at;
      if (playing) parts.player.start(parts.sound, parts.muted, at);
      syncPlay();
    }
    function skipLine(direction) {
      const lines = parts.lineStarts;
      if (!lines.length) return;
      const position = parts.player.playing() ? parts.position : parts.from;
      const index = lineIndexAt(position);
      let target = direction > 0
        ? index + 1
        : (position > lines[index] + 0.01 ? index : index - 1);
      target = Math.max(0, Math.min(lines.length - 1, target));
      moveTo(lines[target]);
    }
    // The start of the score / of its last line.
    function goEdge(direction) {
      const lines = parts.lineStarts;
      if (!lines.length) return;
      moveTo(direction < 0 ? lines[0] : lines[lines.length - 1]);
    }
    const pageCount = () => Math.max(1, Math.ceil(parts.lineStarts.length / PAGE_LINES));
    const pageOfLine = (index) => Math.floor(index / PAGE_LINES);
    // Only the lines of the page are shown (all of them when the score could
    // not be split into lines the playing knows).
    function showPage(page) {
      const rows = parts.rows;
      const shown = rows.length ? page : -1;
      if (shown === parts.page) return;
      parts.page = shown;
      rows.forEach((row) => row.node.classList.toggle("yue2-page-off", shown >= 0 && row.page !== shown));
      parts.playLabel();
    }

    // The notes sounding at `position`, marked in the score, and the score
    // scrolled to keep them in sight -- its own scroll only, not the window's.
    function light(position) {
      if (!el.isConnected) {
        stopPlaying();
        return;
      }
      if (!parts.tune || !parts.sound) return;
      const now = [];
      for (const note of parts.sound.notes) {
        if (note.start > position) break;
        if (note.start + note.duration > position && !parts.muted.has(note.track)) now.push(note.startChar);
      }
      // The chords sound from their own track: the symbol sounding is lit.
      let chord = -1;
      if (parts.chordMarks.length && [...parts.sound.chordTracks].some((track) => !parts.muted.has(track))) {
        parts.chordMarks.forEach((mark, index) => {
          if (mark.start <= position + 1e-6) chord = index;
        });
      }
      const key = `${now.join(",")}|${chord}`;
      if (key === parts.litKey) return;
      unlight();
      parts.litKey = key;
      for (const at of now) {
        const found = parts.tune.getElementFromChar(at);
        const set = (found && found.abselem && found.abselem.elemset) || [];
        for (const node of set) {
          if (node && node.classList) {
            node.classList.add("yue2-now");
            parts.lit.push(node);
          }
        }
      }
      if (chord >= 0) {
        for (const node of parts.chordMarks[chord].nodes) {
          node.classList.add("yue2-now");
          parts.lit.push(node);
        }
      }
      const first = parts.lit[0];
      if (first && first.getBoundingClientRect && parts.score.clientHeight > 0) {
        const box = first.getBoundingClientRect();
        const pane = parts.score.getBoundingClientRect();
        // A note on a page not shown has no box to bring into sight.
        if (box.height > 0 && (box.top < pane.top || box.bottom > pane.bottom)) {
          parts.score.scrollTop += box.top - pane.top - pane.height / 3;
        }
      }
    }
    function unlight() {
      for (const node of parts.lit) node.classList.remove("yue2-now");
      parts.lit = [];
      parts.litKey = "";
    }

    // A note clicked in the score: its letters selected in the text (when the
    // text is shown), and the place playing starts from.
    parts.onClick = (element) => {
      if (!element || !Number.isFinite(element.startChar)) return;
      const note = parts.sound && parts.sound.notes.find((one) => one.startChar === element.startChar);
      parts.from = note ? note.start : 0;
      syncPlay();
      if (options().view !== "score" && Number.isFinite(element.endChar)) {
        area.focus({ preventScroll: true });
        const back = parts.original || ((n) => n);
        area.setSelectionRange(back(element.startChar), back(element.endChar));
        // Bring the selection into the textarea's own view.
        const before = area.value.slice(0, back(element.startChar)).split("\n").length - 1;
        const lineHeight = parseFloat(getComputedStyle(area).lineHeight) || 18;
        const top = before * lineHeight;
        if (top < area.scrollTop || top > area.scrollTop + area.clientHeight - lineHeight) area.scrollTop = Math.max(0, top - area.clientHeight / 3);
      }
    };

    // Tab writes a tab; the score is ABC and its columns are the person's.
    area.addEventListener("keydown", (event) => {
      if (event.key === "Tab" && !event.ctrlKey && !event.altKey && !event.metaKey && !area.readOnly) {
        event.preventDefault();
        replaceRange(area, area.selectionStart, area.selectionEnd, "\t");
      }
    });

    let timer = 0;
    parts.later = () => {
      clearTimeout(timer);
      timer = setTimeout(() => draw(el), REDRAW_MS);
    };
    area.addEventListener("input", () => {
      stopPlaying();
      parts.later();
    });

    // Drawn again when the room it has changes width (a seam moved), and
    // first drawn when it can be seen at all.
    new ResizeObserver(() => {
      const width = parts.score.clientWidth;
      if (width > 0 && Math.abs(width - parts.width) > 24) parts.later();
    }).observe(parts.score);

    slots.body(parts.score);
    el.classList.add("yue2-abc-card");
    el.__abc = parts;
    return parts;
  }

  // The score, drawn from the text the card holds now.
  function draw(el) {
    const parts = el.__abc;
    const text = parts.area.value;
    // Parse text edits even in text-only view, so preview playback always
    // uses the current document. A visible resize will redraw the score.
    const width = parts.score.clientWidth || parts.width || 640;
    if (!ABCJS) {
      library()
        .then(() => draw(el))
        .catch((error) => {
          parts.problem.textContent = error.message || String(error);
        });
      return;
    }
    // Drawn once per text: the score is laid out at one width of its own and
    // scaled to the card, so a resize does not lay it out again.
    if (parts.drawn === text) return;
    const changed = parts.drawn !== text;
    parts.drawn = text;
    parts.width = width;
    if (changed) {
      parts.stopPlaying();
      parts.from = 0;
      parts.position = 0;
    }
    let problems = [];
    if (!text.trim()) {
      parts.paper.replaceChildren();
      parts.tune = null;
      parts.sound = null;
      parts.lineStarts = [];
      parts.chordMarks = [];
      parts.rows = [];
      parts.page = -1;
    } else {
      const accent = getComputedStyle(el).getPropertyValue("--accent").trim() || "#2563eb";
      try {
        const short = shortNames(text);
        parts.original = short.original;
        const tunes = ABCJS.renderAbc(parts.paper, short.shown, {
          add_classes: true,
          oneSvgPerLine: true,
          staffwidth: SCORE_WIDTH,
          responsive: "resize",
          // Four measures to a line, whatever they hold: a narrow limit on the
          // spacing made abcjs even the lines out instead (3, 4, 3 ...).
          wrap: { minSpacing: 1.0, maxSpacing: 6, preferredMeasuresPerLine: 4 },
          paddingleft: 0,
          paddingright: 0,
          paddingtop: 4,
          paddingbottom: 4,
          selectionColor: accent,
          clickListener: (element) => parts.onClick(element),
        });
        parts.tune = tunes[0] || null;
        problems = ((parts.tune && parts.tune.warnings) || []).map(plain);
        parts.sound = parts.tune ? notesOf(parts.tune) : null;
        parts.lineStarts = parts.tune ? lineStartsOf(parts.tune, parts.sound) : [];
        parts.rows = rowsOf(parts);
        parts.chordMarks = parts.tune ? chordMarksOf(parts.tune, parts.sound) : [];
      } catch (error) {
        parts.tune = null;
        parts.sound = null;
        parts.chordMarks = [];
        parts.lineStarts = [];
        parts.rows = [];
        problems = [error.message || String(error)];
      }
      parts.page = -1;
    }
    facts(el, problems);
  }

  // Where each drawn line begins, in whole notes, read from the elements drawn on
  // it (abcjs's timing says which elements sound when): so that the lines and
  // their places are the same lines whatever else is on the page. A line with
  // nothing that sounds takes the place of the one before it. Null when the
  // timing cannot be had.
  function rowStartsOf(parts, noted) {
    try {
      const index = new Map(noted.map((node, i) => [node, i]));
      const rowOf = (element) => {
        for (let node = element; node && node !== parts.paper; node = node.parentElement) if (index.has(node)) return index.get(node);
        return -1;
      };
      const starts = new Array(noted.length).fill(null);
      for (const event of new ABCJS.TimingCallbacks(parts.tune, {}).noteTimings) {
        if (!Number.isFinite(event.milliseconds)) continue;
        for (const element of (event.elements || []).flat()) {
          const i = rowOf(element);
          if (i >= 0 && (starts[i] === null || starts[i] > event.milliseconds)) starts[i] = event.milliseconds;
        }
      }
      if (starts.every((one) => one === null)) return null;
      let last = 0;
      return starts.map((one) => {
        last = Math.max(last, one === null ? last : one / 1000 / parts.sound.secondsPerWhole);
        return last;
      });
    } catch {
      return null;
    }
  }

  // The score's lines, one element each, with the page each is on. A page is a
  // drawn line: the places they begin at are read off the lines themselves, so
  // that the pages stay whenever the lines the player counts are not the
  // lines drawn (a line of words, one with nothing to play). Only when no
  // place can be had at all is the whole score shown.
  function rowsOf(parts) {
    const nodes = [...parts.paper.children];
    const noted = nodes.filter((node) => node.querySelector(".abcjs-note, .abcjs-rest"));
    if (!noted.length) return [];
    if (noted.length !== parts.lineStarts.length) {
      const starts = parts.sound ? rowStartsOf(parts, noted) : null;
      if (!starts) return [];
      parts.lineStarts = starts;
    }
    let seen = -1;
    let page = 0;
    return nodes.map((node) => {
      if (node === noted[seen + 1]) {
        seen++;
        page = Math.floor(seen / PAGE_LINES);
      }
      return { node, page };
    });
  }

  // How long the tune is and its tempo (the page is in the play button).
  function paintFacts(el) {
    const parts = el.__abc;
    const sound = parts.sound;
    const base = sound
      ? t("yue2.abc.facts", { length: clockOf(sound.seconds), bpm: Math.round(Number(sound.tempo) || 0), voices: sound.voices.length })
      : t(parts.area.value.trim() ? "yue2.abc.unread" : "yue2.abc.empty");
    if (parts.facts.textContent !== base) parts.facts.textContent = base;
  }

  // What the line under the score says, and the layers.
  function facts(el, problems = null) {
    const parts = el.__abc;
    const sound = parts.sound;
    if (problems) parts.problems = problems;
    const list = parts.problems || [];
    paintFacts(el);
    parts.problem.textContent = list.length ? t("yue2.abc.problems", { n: list.length, first: list[0] }) : "";
    parts.problem.title = list.join("\n");
    parts.problem.hidden = !list.length;
    parts.status.hidden = !list.length;

    const names = sound ? sound.voices : [];
    const named = `${names.join("\n")}|${sound ? [...sound.chordTracks].join(",") : ""}`;
    if (parts.voices.__names !== named) {
      parts.voices.__names = named;
      parts.muted = new Set([...parts.muted].filter((index) => index < names.length));
    }
    syncVoices(parts);
    parts.syncPlay();
  }

  function syncVoices(parts) {
    // A muted voice's staff is greyed in the score (CSS: [data-mute~="0"]).
    parts.paper.dataset.mute = [...parts.muted].join(" ");
    // The chord track has no staff to grey: its symbols are the chords.
    const chordMuted = Boolean(parts.sound) && parts.sound.chordTracks.size > 0 && [...parts.sound.chordTracks].every((track) => parts.muted.has(track));
    if (chordMuted) parts.paper.dataset.muteChords = "1";
    else delete parts.paper.dataset.muteChords;
    const names = parts.sound ? parts.sound.voices : [];
    parts.voices.hidden = !names.length;
    fw.controls.popupchecklist.update(parts.voices, {
      params: {
        icon: "layers",
        label: t("yue2.abc.layers"),
        title: t("yue2.abc.layersTitle"),
        // "Vocal Melody" is the staff's long name; the layer says the voice.
        // The chord track has no name of its own, nor a staff: it is the chords.
        items: names.map((name, index) => ({
          value: index,
          label: parts.sound.chordTracks.has(index) ? t("yue2.abc.chordVoice") : name.replace(/\s*Melody$/i, ""),
          checked: !parts.muted.has(index),
        })),
        onChange: (values) => {
          names.forEach((_, index) => {
            const muted = !values.includes(index);
            if (muted === parts.muted.has(index)) return;
            if (muted) parts.muted.add(index);
            else parts.muted.delete(index);
            parts.player.mute(index, muted);
          });
          syncVoices(parts);
        },
      },
    });
  }

  function update(el, desc) {
    fw.controls.texteditor.update(el, desc);
    el.__desc = desc;
    const parts = el.__abc;
    const p = desc.params;

    for (const { node, key, attr } of parts.texts) {
      const text = t(key);
      if (node[attr] !== text) node[attr] = text;
    }

    // A generation action stays in the card header; playback lives in its bar.
    const action = p.action || null;
    parts.act.hidden = !action;
    parts.play.hidden = false;
    if (action) {
      parts.act.firstElementChild.className = `bi bi-${action.icon || "stars"}`;
      parts.act.lastElementChild.textContent = action.label;
      parts.act.title = action.title || action.label;
      parts.act.disabled = Boolean(action.disabled);
    }

    // Fixed while a run is going to write over it.
    if (p.busy) parts.area.readOnly = true;
    el.classList.toggle("is-busy", Boolean(p.busy));

    const view = { ...ABC_DEFAULTS, ...(p.options || parts.local) }.view;
    el.dataset.view = VIEWS.includes(view) ? view : ABC_DEFAULTS.view;
    for (const one of VIEWS) {
      parts.views[one].classList.toggle("is-active", el.dataset.view === one);
      parts.views[one].setAttribute("aria-pressed", String(el.dataset.view === one));
    }

    if (parts.area.value !== parts.drawn) parts.later();
    else draw(el);
    facts(el);
    // A preview with nothing in it has nothing to play or to switch: no bar.
    // (One that can be typed into keeps it: the text view is the way to type.)
    const fixed = Boolean(desc.readonly || (p.read && !p.write));
    const bar = el.querySelector(":scope > .yue2-abc-bar");
    if (bar) bar.hidden = fixed && !parts.area.value.trim();
  }

  registerControl("yue2.abccard", {
    extends: "texteditor",
    label: "yue2.control.abccard",
    // The shell's text card holds the letters; it cannot show them as a
    // score or play them, which is what reading and fixing a song plan needs.
    why: "An ABC song plan as a score that can be played, over the text card it is written in.",
    params: { action: { type: "data" }, busy: { type: "boolean" } },
    render(desc, onChange) {
      const el = fw.controls.texteditor.render(desc, onChange);
      el.__desc = desc;
      build(el);
      update(el, desc);
      return el;
    },
    update,
  });
}
