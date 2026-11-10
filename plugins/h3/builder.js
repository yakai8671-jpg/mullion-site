/* MiniMax H3 prompt builder -- the official prompt format as a form.
 *
 * MiniMax publishes how H3 wants to be asked
 * (huggingface.co/MiniMaxAI/MiniMax-H3, docs/VIDEO_PROMPT_WRITING_GUIDE_base_en.md):
 *
 *   <alignment sentence: which picture sits at which second -- none for
 *    text to video>
 *
 *   integrated_multimodal_description: [Shot 1] style, opening composition,
 *     what happens, the camera, who says what ... [Shot 2] At 00:03.500,
 *     the camera cuts to ...
 *
 *   overall_soundscape: ambience and the sounds of what is done
 *
 *   non_diegetic_music: the score only the audience hears, or N/A
 *
 * Most of that is bookkeeping a person should not have to do by hand: the
 * first line is fixed wording decided by which pictures the run has and
 * how long the video really is (the length snaps to the model's 17k+5
 * frame grid), shots after the first open on a formatted cut time, speakers
 * are numbered (S1), (S2) and their lines go in <d>[Language] ...</d>, and
 * camera moves are a fixed vocabulary of motion, amplitude and speed. So
 * the builder holds the parts and writes the prompt; its `output` is a port,
 * linked by the app into the run settings' prompt card.
 *
 *   h3.builder    the form, and the prompt it writes
 *   └ h3.writer     AI help: a speaker, a shot, a shot's lines, the music
 *                   ... each made on its own and carried into the builder
 *                   by its grip
 *
 * The form is two lists and some text: the speakers, and the shots -- and a
 * shot holds its own lines and on-screen texts, as lists of its own. Every
 * entry carries a uid, so every one has an address (item, list, entry, ...)
 * and is a port like any other: carried, pasted into, put in order by the
 * move guide among its own siblings. A line names its speaker by uid: the
 * (S1) a speaker is given is its place in the list, worked out when the
 * prompt is written, so reordering never makes a line point at somebody else.
 */


// The length row of both templates (node 6, seconds) and its default.
const SECONDS_SETTING = "6::value";
const DEFAULT_SECONDS = 5;
// Keyframe pictures and the frame each sits at: run settings slots, and the
// template's frame defaults (nodes 27 / 30 / 33).
const KEYFRAMES = [
  ["image3", "frame3", 24],
  ["image4", "frame4", 48],
  ["image5", "frame5", 72],
];

const MODES = ["auto", "t2va", "i2va", "fl2va", "l2va"];
// The mode while the app's reference engine (ref2va, see index.js) is
// chosen: not one to choose here. Its prompt
// is the guide's other format (VIDEO_PROMPT_WRITING_GUIDE_ref_en.md):
// subject_definitions, summary, retention_analysis, detailed_description,
// then the same two sound sections.
const REF_MODE = "ref2va";
// The run settings slots the reference pictures are in, in order: after
// the five frames.
const REF_SLOTS = ["image6", "image7", "image8", "image9", "image10", "image11", "image12", "image13", "image14"];
const TRANSITIONS = {
  cut: "the camera cuts to",
  dissolve: "the shot cross-dissolves to",
  fade: "the shot fades to",
  wipe: "the shot wipes to",
};
// The guide's camera vocabulary, each as the verb phrase the sentence
// "The camera ..." takes.
const CAMERA = {
  none: "",
  static: "holds a static shot",
  push_in: "pushes in",
  pull_out: "pulls out",
  zoom_in: "zooms in",
  zoom_out: "zooms out",
  pan_left: "pans left",
  pan_right: "pans right",
  truck_left: "trucks left",
  truck_right: "trucks right",
  tilt_up: "tilts up",
  tilt_down: "tilts down",
  pedestal_up: "pedestals up",
  pedestal_down: "pedestals down",
  arc: "arcs",
  tracking: "tracks",
  shake_slight: "shakes slightly",
  shake_strong: "shakes strongly",
  pov: "shows the subject's point of view",
  roll_cw: "rolls clockwise",
  roll_ccw: "rolls counterclockwise",
};
// What an arc or a tracking shot moves round or follows, when the
// continuation does not say.
const CAMERA_OBJECT = { arc: "around the subject", tracking: "the subject" };
const AMPLITUDE = { normal: "", small: "with small amplitude", large: "with large amplitude" };
const SPEED = { normal: "", slow: "at slow speed", fast: "at fast speed" };
const LANGUAGES = ["Japanese", "English", "Chinese", "Korean", "Spanish", "French", "German"];

export const newUid = () => Math.random().toString(36).slice(2, 10);
const str = (value) => (typeof value === "string" ? value : "");
const pick = (table, value, fallback) => (Object.prototype.hasOwnProperty.call(table, value) ? value : fallback);
const isRecord = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);

// ---- the four kinds of entry ----------------------------------------------
// `appearance` is how they look and what they wear, written to follow their
// name ("has short blonde hair and wears a red racing jacket"): said once,
// in the first shot they speak in.
// `refs` is, for the reference app, which of its pictures show them
// ("1, 2"): it makes them a <Subject N> of the prompt.
export const blankSpeaker = () => ({ uid: newUid(), name: "", voice: "", appearance: "", refs: "" });
export const blankScene = (time = 0) => ({
  uid: newUid(),
  time,
  transition: "cut",
  content: "",
  camera: "none",
  amplitude: "normal",
  speed: "normal",
  cameraMore: "",
  // What is said and what is read in this shot.
  lines: [],
  screens: [],
});
export const blankLine = (speaker = "") => ({ uid: newUid(), speaker, lang: "Japanese", verb: "", text: "", voiceover: false });
// On-screen text: each string with where it shows, since a shot can have
// several and the guide wants each quoted on its own.
export const blankScreen = () => ({ uid: newUid(), text: "", where: "" });
// The shot a builder has before any is stored: the same uid every time it
// is made, so an edit to it lands on it rather than on a fresh one.
const firstScene = () => ({ ...blankScene(), uid: "scene-1" });

export const coerceSpeaker = (one) => ({
  ...blankSpeaker(),
  ...(isRecord(one) ? one : {}),
  name: str((one || {}).name),
  voice: str((one || {}).voice),
  appearance: str((one || {}).appearance),
  refs: str((one || {}).refs),
});
export const coerceScene = (one) => {
  const scene = { ...blankScene(), ...(isRecord(one) ? one : {}) };
  return {
    uid: str(scene.uid) || newUid(),
    time: Math.max(0, Number(scene.time) || 0),
    transition: pick(TRANSITIONS, scene.transition, "cut"),
    content: str(scene.content),
    camera: pick(CAMERA, scene.camera, "none"),
    amplitude: pick(AMPLITUDE, scene.amplitude, "normal"),
    speed: pick(SPEED, scene.speed, "normal"),
    cameraMore: str(scene.cameraMore),
    lines: listOf(scene.lines, coerceLine),
    screens: listOf(scene.screens, coerceScreen),
  };
};
export const coerceLine = (one) => {
  const line = { ...blankLine(), ...(isRecord(one) ? one : {}) };
  return {
    uid: str(line.uid) || newUid(),
    speaker: str(line.speaker),
    lang: LANGUAGES.includes(line.lang) ? line.lang : "Japanese",
    verb: str(line.verb),
    text: str(line.text),
    voiceover: Boolean(line.voiceover),
  };
};
export const coerceScreen = (one) => {
  const entry = { ...blankScreen(), ...(isRecord(one) ? one : {}) };
  return { uid: str(entry.uid) || newUid(), text: str(entry.text), where: str(entry.where) };
};
export const listOf = (value, coerce) => (Array.isArray(value) ? value : []).map(coerce);

// The whole form, read off a builder's properties.
export function docOf(props) {
  const raw = Array.isArray(props.scenes) && props.scenes.length ? props.scenes : [firstScene()];
  return {
    mode: MODES.includes(props.mode) ? props.mode : "auto",
    style: str(props.style),
    speakers: listOf(props.speakers, coerceSpeaker),
    // Each shot holds its own lines and on-screen texts.
    scenes: raw.map(coerceScene),
    soundscape: str(props.soundscape),
    music: str(props.music),
    // The reference format's own: what else the pictures give (a place,
    // a prop), one per line, and the one-paragraph summary.
    subjects: str(props.subjects),
    summary: str(props.summary),
    // The run it was written for -- the length, where the pictures sit, which
    // engine -- without the pictures themselves. What turns it into a prompt
    // (the first line, which picture is at which second) needs it, and a
    // draft carried to a prompt card has no builder beside it to say.
    run: isRecord(props.run) ? slimRun(props.run) : null,
  };
}
// A run with its pictures left out: all the prompt's wording needs of one.
const slimRun = (run) => ({ ...coerceRun(run), pictures: [], pictureNotes: [], pictureTags: [] });

// ---- what the run will be ---------------------------------------------
// Which pictures are in, where the keyframes sit, and how long the video
// really is. The app works it out from its run settings (`appRun`); a builder
// and a writer are linked to the video app as an app (an item link, the `app`
// property) and read it from there, each as `runOf`. Nothing here reaches for
// another item without that link: not linked, there are no pictures.
const frameCount = (seconds) => {
  const f = Math.max(5, Math.round(seconds * 24));
  return f + ((5 - (f % 17)) % 17 + 17) % 17;
};

// What the app's run settings come to: worked out from its own settings.
export function appRun(props) {
  props = props || {};
  const setting = (Array.isArray(props.settings) ? props.settings : []).find((one) => one && one.id === SECONDS_SETTING);
  const asked = setting && Number(setting.value) > 0 ? Number(setting.value) : DEFAULT_SECONDS;
  const seconds = frameCount(asked) / 24;
  const has = (key) => typeof props[key] === "string" && props[key] !== "";
  const middle = KEYFRAMES.filter(([image]) => has(image)).map(([image, frame, fallback]) => {
    const at = Number(props[frame]);
    return { src: props[image], at: Math.min(seconds, (Number.isFinite(at) && props[frame] !== undefined ? at : fallback) / 24) };
  });
  const keyframes = middle.map((one) => one.at);
  // The reference engine is what makes it the reference format; its
  // pictures are numbered as the runner sends them: the given ones, in
  // slot order.
  const references = props.engine === "references";
  const refs = references ? REF_SLOTS.filter(has).map((key) => props[key]) : [];
  // The pictures themselves, for a model that can look at them: the frames
  // in the order of the video (the keyframes too -- the shots between the
  // ends are written from them), then the references (four at most, all
  // told), each with what it is.
  const framed = [
    ...(has("image") ? [{ src: props.image, at: 0, tag: "first", note: "the first frame (0.00 s)" }] : []),
    ...middle.map((one) => ({ ...one, tag: "key", note: `a keyframe at ${two(one.at)} s` })),
    ...(has("image2") ? [{ src: props.image2, at: seconds, tag: "last", note: `the last frame (${two(seconds)} s)` }] : []),
  ].sort((a, b) => a.at - b.at);
  const shown = [
    ...framed,
    ...refs.map((src, index) => ({ src, tag: "ref", n: index + 1, note: `reference <Picture ${index + 1}>` })),
  ].slice(0, 4);
  return {
    start: has("image"),
    end: has("image2"),
    pictures: shown.map((one) => one.src),
    pictureNotes: shown.map((one) => one.note),
    // The same, as the window says it: what each is, and where it sits.
    pictureTags: shown.map((one) => ({ tag: one.tag, at: one.at, n: one.n })),
    keyframes: keyframes.sort((a, b) => a - b),
    seconds,
    takesPictures: true,
    references,
    refs: refs.length,
  };
}

// A run as it is held: what was carried in, made well-formed. Nothing
// carried in is a run with no pictures and the default length -- text to
// video -- which is what a builder that is not linked to an app is.
export function coerceRun(value) {
  const one = isRecord(value) ? value : {};
  const list = (x) => (Array.isArray(x) ? x : []);
  const pictures = list(one.pictures).map(str).slice(0, 4);
  const seconds = Number(one.seconds) > 0 ? Number(one.seconds) : frameCount(DEFAULT_SECONDS) / 24;
  return {
    start: Boolean(one.start),
    end: Boolean(one.end),
    pictures,
    pictureNotes: pictures.map((_, index) => str(list(one.pictureNotes)[index])),
    pictureTags: pictures.map((_, index) => {
      const tag = list(one.pictureTags)[index];
      return isRecord(tag) ? { tag: str(tag.tag), at: Number(tag.at) || 0, n: Number(tag.n) || 0 } : { tag: "", at: 0, n: 0 };
    }),
    keyframes: list(one.keyframes).map(Number).filter(Number.isFinite).sort((a, b) => a - b),
    seconds,
    takesPictures: isRecord(value),
    references: Boolean(one.references),
    refs: Math.max(0, Math.floor(Number(one.refs) || 0)),
  };
}

export function modeOf(chosen, run) {
  if (run.references) return REF_MODE;
  if (chosen && chosen !== "auto" && MODES.includes(chosen)) return chosen;
  if (run.start && run.end) return "fl2va";
  if (run.start) return "i2va";
  if (run.end) return "l2va";
  return "t2va";
}

// ---- the prompt ---------------------------------------------------------
const two = (n) => n.toFixed(2);
const clock = (seconds) => {
  const ms = Math.round(Math.max(0, seconds) * 1000);
  const m = Math.floor(ms / 60000);
  const s = (ms % 60000) / 1000;
  return `${String(m).padStart(2, "0")}:${s.toFixed(3).padStart(6, "0")}`;
};
// A sentence, ended: what someone typed may or may not have its full stop.
const sentence = (text) => {
  const clean = str(text).trim();
  if (!clean) return "";
  return /[.!?。！？"”')\]]$/.test(clean) ? clean : `${clean}.`;
};
const join = (...parts) => parts.map((one) => str(one).trim()).filter(Boolean).join(" ");
// A later shot's content follows "the camera cuts to": a cut phrase it
// already starts with would be said twice, and a capital article reads as
// a new sentence.
const afterCut = (text) =>
  str(text)
    .trim()
    .replace(/^(the\s+)?(camera|shot)\s+(cuts|transitions|changes|switches|cross-dissolves|fades|wipes)\s+to\s+/i, "")
    .replace(/^(The|A|An)\b/, (word) => word.toLowerCase());

// Which shot is running at a second: the last one that has started.
const shotAt = (scenes, seconds) => {
  let at = 1;
  scenes.forEach((scene, index) => {
    if (index === 0 || scene.time <= seconds + 1e-6) at = index + 1;
  });
  return at;
};

function alignment(mode, scenes, run) {
  const last = scenes.length;
  const end = two(run.seconds);
  const marks = (pictures) =>
    `How the reference pictures align with the target video — ${pictures
      .map((p, index) => `Picture ${index + 1} (from Shot ${p.shot}) aligns with the ${two(p.at)}-second mark of the target video`)
      .join("; ")}.`;
  const middle = run.keyframes.map((at) => ({ at, shot: shotAt(scenes, at) }));
  if (mode === "t2va") return "";
  if (mode === "i2va") {
    // Keyframes are this app's own addition to the four modes: written the
    // way the guide aligns more than one picture.
    if (middle.length) return marks([{ at: 0, shot: 1 }, ...middle]);
    return "For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.";
  }
  if (mode === "l2va") {
    return `How the reference pictures align with the target video — <Picture 1> (from [Shot ${last}]) aligns with the ${end}-second mark of the target video.`;
  }
  return marks([{ at: 0, shot: 1 }, ...middle, { at: run.seconds, shot: last }]);
}

function cameraSentence(scene) {
  const verb = CAMERA[scene.camera];
  if (!verb) return sentence(scene.cameraMore ? `The camera ${scene.cameraMore}` : "");
  const more = str(scene.cameraMore).trim() || CAMERA_OBJECT[scene.camera] || "";
  return sentence(join("The camera", verb, AMPLITUDE[scene.amplitude], SPEED[scene.speed], more));
}

// Picture numbers out of what was typed ("1, 2", "1・3"), those the run has.
const refsOf = (text, count) => [...new Set((str(text).match(/\d+/g) || []).map(Number).filter((n) => n >= 1 && n <= count))];
const pictureList = (numbers) => {
  const tags = numbers.map((n) => `<Picture ${n}>`);
  return tags.length > 1 ? `${tags.slice(0, -1).join(", ")} and ${tags[tags.length - 1]}` : tags[0] || "";
};

// The reference format's subjects: each speaker the pictures show, then
// each line of "other references", then any picture nobody claimed -- a
// reference the prompt never names is one the model is left to guess at.
function subjectsOf(doc, run) {
  const out = [];
  doc.speakers.forEach((speaker) => {
    const pictures = refsOf(speaker.refs, run.refs);
    if (pictures.length) out.push({ speaker, pictures });
  });
  str(doc.subjects)
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/[.。]$/, ""))
    .filter(Boolean)
    .forEach((text) => out.push({ text, pictures: refsOf((text.match(/<Picture\s*\d+>/gi) || []).join(" "), run.refs) }));
  const claimed = new Set(out.flatMap((one) => one.pictures));
  for (let n = 1; n <= run.refs; n++) if (!claimed.has(n)) out.push({ text: `the subject shown in <Picture ${n}>`, pictures: [n] });
  return out.map((one, index) => ({ ...one, label: `<Subject ${index + 1}>` }));
}

// `doc` is docOf()'s shape.
export function compose(doc, run) {
  const { speakers, scenes } = doc;
  const mode = modeOf(doc.mode, run);
  const refMode = mode === REF_MODE;
  const subjects = refMode ? subjectsOf(doc, run) : [];
  const subjectOf = (uid) => subjects.find((one) => one.speaker && one.speaker.uid === uid);
  const ids = new Map(speakers.map((one, index) => [one.uid, `S${index + 1}`]));
  const introduced = new Set();
  const who = (uid) => {
    const id = ids.get(uid);
    const speaker = speakers.find((one) => one.uid === uid);
    if (!id || !speaker) return "Someone";
    const name = str(speaker.name).trim() || "the speaker";
    const first = !introduced.has(uid);
    introduced.add(uid);
    const voice = str(speaker.voice).trim();
    // A speaker the pictures show is called by their subject label, the
    // way the reference guide writes it: "<Subject 1> (S1), the girl, ...".
    const subject = subjectOf(uid);
    if (subject) return first ? `${subject.label} (${id}), ${voice ? `${name}, ${voice},` : `${name},`}` : `${subject.label} (${id})`;
    return first && voice ? `${name}, ${voice}, (${id})` : `${name} (${id})`;
  };
  const capital = (text) => (text ? text[0].toUpperCase() + text.slice(1) : text);
  // How a speaker looks, said before the camera and the lines of the first
  // shot they speak in -- where the guide wants identity established.
  const shown = new Set();
  const looks = (scene) =>
    scene.lines
      .filter((line) => str(line.text).trim())
      .map((line) => speakers.find((one) => one.uid === line.speaker))
      .filter((speaker) => speaker && str(speaker.appearance).trim() && !shown.has(speaker.uid) && shown.add(speaker.uid))
      .map((speaker) => {
        const subject = subjectOf(speaker.uid);
        const name = str(speaker.name).trim() || "the speaker";
        return sentence(subject ? `${subject.label}, ${name}, ${str(speaker.appearance).trim()}` : `${capital(name)} ${str(speaker.appearance).trim()}`);
      });
  const lineText = (line) => {
    const said = `<d>[${line.lang}] ${str(line.text).trim()}</d>`;
    if (line.voiceover) return `${capital(who(line.speaker))} says in an off-screen voiceover: ${said} while their lips remain completely closed.`;
    return `${capital(who(line.speaker))} ${str(line.verb).trim() || "says"}: ${said}`;
  };

  const shots = scenes.map((scene, index) => {
    // The style may lead into the content ("..., a medium shot frames"):
    // ended only when it does not run on.
    const style = str(doc.style).trim();
    // In the reference format the style is said before [Shot 1], so the
    // first shot starts on its content.
    const opening = refMode ? "" : /[,:;]$/.test(style) ? style : sentence(style);
    const head = index === 0 ? opening : `At ${clock(scene.time)}, ${TRANSITIONS[scene.transition]}`;
    const screens = scene.screens
      .filter((entry) => str(entry.text).trim())
      .map((entry) => `${str(entry.where).trim() || "On-screen text"} reading "${str(entry.text).trim()}".`);
    return join(
      `[Shot ${index + 1}]`,
      join(head, sentence(index === 0 ? (refMode ? capital(str(scene.content).trim()) : scene.content) : afterCut(scene.content))),
      ...looks(scene),
      cameraSentence(scene),
      ...scene.lines.filter((line) => str(line.text).trim()).map(lineText),
      ...screens
    );
  });

  if (refMode) return composeRef(doc, run, subjects, shots);
  const body = [
    `integrated_multimodal_description: ${shots.join(" ")}`,
    `overall_soundscape: ${str(doc.soundscape).trim() || "N/A"}`,
    `non_diegetic_music: ${str(doc.music).trim() || "N/A"}`,
  ].join("\n\n");
  const first = alignment(mode, scenes, run);
  return first ? `${first}\n\n${body}` : body;
}

// The reference format, one section to a block: what each reference is, a
// summary, how each is kept, then the shots and the sound.
function composeRef(doc, run, subjects, shots) {
  const shotsOf = (subject) => {
    const own = subject.speaker
      ? doc.scenes
          .map((scene, index) =>
            scene.lines.some((line) => line.speaker === subject.speaker.uid && str(line.text).trim()) ? index + 1 : 0
          )
          .filter(Boolean)
      : [];
    return (own.length ? own : doc.scenes.map((_, index) => index + 1)).map((n) => `[Shot ${n}]`).join(", ");
  };
  const definitions = subjects.map((one) => {
    if (!one.speaker) return sentence(`${one.label} is ${one.text}`);
    const looks = str(one.speaker.appearance).trim();
    return sentence(`${one.label} is ${str(one.speaker.name).trim() || "the character"} in ${pictureList(one.pictures)}${looks ? `, who ${looks}` : ""}`);
  });
  const framed = run.start || run.end || run.keyframes.length > 0;
  const named = subjects.map((one) => one.label);
  const list = named.length > 1 ? `${named.slice(0, -1).join(", ")} and ${named[named.length - 1]}` : named[0] || "";
  const summary =
    str(doc.summary).trim() ||
    (list ? `The target video follows ${list} through ${shots.length} shot${shots.length > 1 ? "s" : ""}, keeping each as its references show.` : "");
  const retention = subjects.map((one) => {
    const from = one.pictures.length ? ` from ${pictureList(one.pictures)}` : "";
    const what = one.speaker ? `the identity, face, hair and clothing${from} are retained` : `the features${from} are retained`;
    return `${one.label} (appears in ${shotsOf(one)}): fully_preserved - ${what}.`;
  });
  return [
    `subject_definitions:\n${definitions.join("\n") || "N/A"}`,
    // Frames pinned on the timeline make it keyframe completion as well.
    `summary:\n${sentence(`[${framed ? "keyframe completion + " : ""}reference generation] ${summary}`)}`,
    `retention_analysis:\n${retention.join("\n") || "N/A"}`,
    `detailed_description:\n${[sentence(doc.style), ...shots].filter(Boolean).join("\n")}`,
    `overall_soundscape:\n${str(doc.soundscape).trim() || "N/A"}`,
    `non_diegetic_music:\n${str(doc.music).trim() || "N/A"}`,
  ].join("\n\n");
}

// What to look at again before running, said in the builder.
function warningsOf(doc, run, t) {
  const found = [];
  const { scenes } = doc;
  scenes.forEach((scene, index) => {
    if (index === 0) return;
    const before = index === 1 ? 0 : scenes[index - 1].time;
    if (scene.time <= before) found.push(t("h3.warn.order", { n: index + 1 }));
    if (scene.time >= run.seconds) found.push(t("h3.warn.late", { n: index + 1, s: two(run.seconds) }));
  });
  const english = [
    [t("h3.prop.style"), doc.style],
    [t("h3.prop.soundscape"), doc.soundscape],
    [t("h3.prop.music"), doc.music],
    ...scenes.flatMap((scene, index) => [
      [t("h3.field.sceneContent", { n: index + 1 }), scene.content],
      [t("h3.field.sceneCamera", { n: index + 1 }), scene.cameraMore],
    ]),
    ...scenes.flatMap((scene, index) => scene.screens.map((entry) => [t("h3.field.sceneScreenWhere", { n: index + 1 }), entry.where])),
    ...doc.speakers.flatMap((one, index) => [
      [t("h3.field.speakerName", { n: index + 1 }), one.name],
      [t("h3.field.speakerVoice", { n: index + 1 }), one.voice],
      [t("h3.field.speakerAppearance", { n: index + 1 }), one.appearance],
    ]),
  ];
  for (const [label, text] of english) {
    const value = str(text);
    if (/[぀-ヿ㐀-鿿]/.test(value)) found.push(t("h3.warn.notEnglish", { field: label }));
    if (/\b(no|not|without|never|don't|avoid)\b/i.test(value)) found.push(t("h3.warn.negative", { field: label }));
  }
  const spoken = scenes.flatMap((scene) => scene.lines).filter((line) => str(line.text).trim());
  if (spoken.some((line) => !doc.speakers.some((one) => one.uid === line.speaker))) found.push(t("h3.warn.noSpeaker"));
  if (run.references) {
    if (!run.refs) found.push(t("h3.warn.noRefs"));
    doc.speakers.forEach((one, index) => {
      const asked = (str(one.refs).match(/\d+/g) || []).map(Number);
      if (asked.some((n) => n < 1 || n > run.refs)) found.push(t("h3.warn.refMissing", { n: index + 1, count: run.refs }));
    });
    for (const [key, text] of [["h3.prop.subjects", doc.subjects], ["h3.prop.summary", doc.summary]]) {
      if (/[぀-ヿ㐀-鿿]/.test(text)) found.push(t("h3.warn.notEnglish", { field: t(key) }));
    }
  }
  return found;
}

// ---- Ollama, asked once per page ----------------------------------------
let ollamaState = null;
let askingOllama = null;
function ollamaOf(api, ctx) {
  if (ollamaState || askingOllama) return ollamaState || { pending: true, models: [] };
  askingOllama = Promise.resolve(api.ollama.status())
    .then((status) => {
      ollamaState = {
        ok: true,
        models: ((status || {}).models || []).map(String).filter(Boolean),
        // What each model can do, where this Ollama says (older ones do not).
        capabilities: (status || {}).capabilities || {},
      };
    })
    .catch((error) => {
      ollamaState = { ok: false, models: [], error: String((error && error.message) || error) };
    })
    .finally(() => {
      askingOllama = null;
      ctx.refreshAll();
    });
  return { pending: true, models: [] };
}
// A picture as Ollama takes it: bare base64, shrunk so a vision model
// reads it quickly.
// Decoded from the bytes rather than through an <img>: an image's decode()
// waits for the page to be drawn, and a hidden window is never drawn.
async function forOllama(src) {
  const bitmap = await createImageBitmap(await (await fetch(src)).blob());
  const scale = Math.min(1, 768 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const url = canvas.toDataURL("image/jpeg", 0.85);
  return url.slice(url.indexOf(",") + 1);
}
// Whether a model really sees what it is sent, found out by showing it a
// picture whose colours are known. What a model says about itself is not
// enough: one that lists "vision" can still be blind where it runs (the
// picture goes in and the description comes out of the request alone), and a
// prompt written that way is about something else than the picture.
// Asked once per model and page.
const sight = new Map();
// What was found, for the window to say before anything is asked again.
const sightFound = new Map();
function canSee(api, model) {
  if (!sight.has(model)) {
    sight.set(
      model,
      (async () => {
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = 192;
        const g = canvas.getContext("2d");
        g.fillStyle = "#f2d600";
        g.fillRect(0, 0, 192, 192);
        g.fillStyle = "#7a1fd1";
        g.beginPath();
        g.arc(96, 96, 56, 0, Math.PI * 2);
        g.fill();
        const url = canvas.toDataURL("image/png");
        const reply = await api.ollama.generate({
          model,
          system: "Answer with JSON only.",
          prompt: "What colour is the background of the picture, and what colour is the large circle in the middle? Answer as JSON {background, circle}, each one colour word in English.",
          images: [url.slice(url.indexOf(",") + 1)],
          format: { type: "object", properties: { background: { type: "string" }, circle: { type: "string" } }, required: ["background", "circle"] },
          options: { num_predict: 40, temperature: 0 },
        });
        const said = parseJson(reply && reply.response) || {};
        const sees = /yellow|gold|amber/i.test(String(said.background)) && /purple|violet|indigo|magenta/i.test(String(said.circle));
        sightFound.set(model, sees);
        return sees;
      })().catch((error) => {
        sight.delete(model);
        // Said in so many words: it takes no pictures. Anything else (the
        // server is down, a timeout) is not an answer, so it is asked again.
        if (/image|vision|multimodal/i.test(String((error && error.message) || error))) {
          sightFound.set(model, false);
          return false;
        }
        throw error;
      })
    );
  }
  return sight.get(model);
}
// Asked with the run's pictures when there are any. A model that cannot look
// at them is not asked again without: what it wrote then would be a
// description of nothing, and the video made from it would ignore the pictures.
// `blind` is what is said instead.
async function askOllama(api, request, pictures, blind) {
  if (!pictures.length) return api.ollama.generate(request);
  const images = await Promise.all(pictures.map(forOllama));
  try {
    return await api.ollama.generate({ ...request, images });
  } catch (error) {
    if (/image|vision|multimodal/i.test(String((error && error.message) || error))) throw new Error(blind);
    throw error;
  }
}
const parseJson = (raw) => {
  const text = String(raw || "");
  try {
    return JSON.parse(text);
  } catch (_error) {
    const match = text.match(/\{[\s\S]*\}/);
    return match ? JSON.parse(match[0]) : null;
  }
};

// The guide's rules, for the model that writes the parts.
const RULES = [
  "You write parts of a prompt for MiniMax H3, a model that generates video with synchronized audio.",
  "Write in English. The user's request may be in Japanese or another language.",
  "Describe only what is visible or audible, concretely.",
  "Phrase everything positively: naming an unwanted thing makes it appear. Write 'the sign is blank', not 'no text'.",
  "Never write dialogue, field labels, shot labels, timestamps or speaker IDs unless asked.",
];
const FIELD_RULES = {
  style: "Write the overall visual style and the opening composition that begins Shot 1, e.g. 'Live-action, cinematic, a medium-wide shot frames a baker at the counter of a small bakery.' One or two sentences. Common styles: Live-action, cinematic, 2D-animated, 3D CG, claymation, watercolor, vintage film.",
  content: "Describe what this shot shows and what happens in it: subjects, appearance, positions, actions in order, reactions. No camera movement, no dialogue. One to three sentences.",
  contentLater: "Describe what this later shot shows and what happens in it. The text directly follows 'the camera cuts to', so begin with what the new shot frames, e.g. 'a close-up of steam rising from the sliced bread as ...'. No camera movement, no dialogue. One to three sentences.",
  cameraMore: "Complete the camera sentence after its motion words: what the camera moves toward or reveals, e.g. 'toward the folded letter in her hands' or ', revealing the open doorway'. A short phrase, lower case, no full stop.",
  screenWhere: "Write where the on-screen text appears, as the start of a sentence that will continue with 'reading \"...\"', e.g. 'A red neon sign above the doorway'.",
  speakerName: "Write a short way to name this speaker in English, e.g. 'the baker', 'the young woman'.",
  speakerVoice: "Write a short phrase identifying this speaker's voice: age, gender, pitch, timbre, speaking rate or accent, e.g. 'middle-aged with a calm, slightly raspy voice'.",
  speakerAppearance: "Write how this speaker looks and what they wear, as words that follow their name, e.g. 'has short blonde hair and wears a red racing jacket and blue goggles'. Hair, face, build, clothing, accessories; one sentence.",
  soundscape: "Write overall_soundscape: one to four sentences in one paragraph summarizing ambient sound, physical action sounds and non-verbal human sounds across the whole video (wind, footsteps, impacts, breathing, laughter). Do not repeat dialogue, singing or music.",
  music: "Write non_diegetic_music: one to three sentences describing background score only the audience hears: instruments, tempo, rhythm, dynamic changes. No mood words. Write exactly N/A if there should be no score.",
};

const DRAFT_FORMAT = {
  type: "object",
  properties: {
    style: { type: "string" },
    speakers: {
      type: "array",
      items: {
        type: "object",
        properties: { name: { type: "string" }, voice: { type: "string" }, appearance: { type: "string" } },
        required: ["name", "voice", "appearance"],
      },
    },
    scenes: {
      type: "array",
      items: {
        type: "object",
        properties: {
          time: { type: "number" },
          transition: { type: "string", enum: Object.keys(TRANSITIONS) },
          content: { type: "string" },
          camera: { type: "string", enum: Object.keys(CAMERA) },
          amplitude: { type: "string", enum: Object.keys(AMPLITUDE) },
          speed: { type: "string", enum: Object.keys(SPEED) },
          // What the camera moves toward, follows or reveals: "toward her
          // hands", "her as she runs", ", revealing the doorway".
          cameraMore: { type: "string" },
          lines: {
            type: "array",
            items: {
              type: "object",
              properties: {
                speaker: { type: "integer" },
                lang: { type: "string", enum: LANGUAGES },
                verb: { type: "string" },
                text: { type: "string" },
                voiceover: { type: "boolean" },
              },
              required: ["speaker", "lang", "text"],
            },
          },
          screens: {
            type: "array",
            items: { type: "object", properties: { text: { type: "string" }, where: { type: "string" } }, required: ["text", "where"] },
          },
        },
        required: ["time", "content", "camera"],
      },
    },
    soundscape: { type: "string" },
    music: { type: "string" },
  },
  required: ["style", "speakers", "scenes", "soundscape", "music"],
};

// The attached pictures are looked at before anything is planned: a model
// that must commit to a style and an opening shot first writes them from the
// request, and the video then starts from something the picture is not.
// `pictures` comes first so each is described before the plan depends on it.
function draftFormat(run) {
  if (!run || !run.pictures.length) return DRAFT_FORMAT;
  return {
    ...DRAFT_FORMAT,
    properties: { pictures: { type: "array", items: { type: "string" } }, ...DRAFT_FORMAT.properties },
    required: ["pictures", ...DRAFT_FORMAT.required],
  };
}

function draftSystem(run, mode) {
  const seen = run.pictures.length > 0;
  return [
    ...RULES,
    `Plan a ${two(run.seconds)}-second video as JSON with these fields:`,
    seen
      ? `pictures: ${run.pictures.length} attached picture${run.pictures.length > 1 ? "s" : ""}, in this order: ${run.pictureNotes
          .map((note, index) => `${index + 1} = ${note}`)
          .join("; ")}. Write this field first: one plain, factual description of two or three sentences per picture, in that order -- the medium and art style, who or what is in it (age, build, hair, face, clothing, accessories), the setting, what they are doing, where they are in the frame, the shot size and the lighting. Describe what you see in the picture itself; take nothing from the request here and invent nothing.`
      : "",
    "style: overall visual style and opening composition of Shot 1 (e.g. 'Live-action, cinematic, a medium-wide shot frames ...').",
    "speakers: only characters who speak or sing; name is a short English way to call them, voice is age, gender, pitch, timbre; appearance is how they look and what they wear, as words following the name ('has short blonde hair and wears a red jacket').",
    "scenes: shots in order. The first has time 0. Later shots start at a strictly increasing time in seconds, inside the video. Prefer few shots; a cut must bring new information.",
    "Write only what the request and the pictures give: do not add people, objects, events, dialogue, singing or on-screen text that neither mentions. Where the request names no speaker or line, speakers, lines and screens are empty lists. Only what the request implies is added to make it playable, such as how the action moves.",
    "  content: what the shot shows and what happens, without camera or dialogue; for a later shot it follows 'the camera cuts to', so start with what it frames.",
    "  camera: one of the given motions, amplitude small/normal/large, speed slow/normal/fast, cameraMore: the rest of the sentence after 'The camera <motion>' (e.g. 'toward her hands', 'her as she rides away'), without repeating the motion.",
    "  lines: dialogue or singing. speaker is the 1-based index into speakers. text is the words verbatim, in their own language; lang names that language. verb is how it is said (says, whispers, shouts, sings). voiceover true for an off-screen voiceover.",
    "  screens: visible on-screen text, each string verbatim (text) with where it appears as the start of a sentence (where, e.g. 'A red neon sign above the door'); empty if none.",
    "soundscape: 1-4 sentences of ambience and action sounds across the video, only those of what is shown, no dialogue or music.",
    "music: 1-3 sentences of score only the audience hears (instruments, tempo, dynamics); N/A unless the request asks for music.",
    seen
      ? "The video is conditioned on the attached pictures, so the plan must agree with their descriptions. The request says what should happen; the pictures say what is there. Never change the people, their appearance and clothing, the setting, the art style or the framing the pictures show, and add nobody who is not in them. If the request contradicts a picture, keep the picture and put the request's action after it."
      : "",
    mode === "i2va"
      ? "The video starts on the attached picture: style and the opening of Shot 1 restate that picture's description (art style, subjects, clothing, setting, positions, shot size) in the same words, and only then say what begins to happen. Develop forward from it in the later shots."
      : "",
    mode === "fl2va"
      ? "The video moves from the first attached picture to the last: keep the subjects, their appearance and the art style the pictures share, but do not describe the two pictures again. Write the motion that connects them, in a single continuous shot where possible, ending on what the last picture shows."
      : "",
    run.keyframes.length ? "The keyframes are pictures the video passes through at the seconds given: the shot running at that second shows what the keyframe shows." : "",
    mode === "l2va" ? "It ends on the attached picture: take its style and subjects from it, and make the last shot end exactly on what it shows." : "",
    mode === REF_MODE
      ? "The attached reference pictures are not frames: character sheets, outfits or places the video must keep to. Describe the people in them exactly as they look there (hair, face, clothing), and place them in new shots and poses."
      : "",
    "Keep dialogue in the language the user asked for; default to Japanese if the request is Japanese.",
    "Return JSON only.",
  ].filter(Boolean);
}
