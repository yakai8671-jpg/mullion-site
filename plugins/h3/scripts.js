import {
  blankLine,
  blankScene,
  blankScreen,
  blankSpeaker,
  coerceLine,
  coerceRun,
  coerceScene,
  coerceScreen,
  coerceSpeaker,
  compose,
  docOf,
  appRun,
  listOf,
  newUid,
} from "./builder.js";

const isRecord = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);

const propsOf = (entry) => {
  if (!entry) return {};
  if (entry.props) return entry.props;
  if (Array.isArray(entry.properties)) return Object.fromEntries(entry.properties.map((one) => [one.key, one.value]));
  return {};
};

const appOf = (api, item) => {
  const linked = api && item && item.props && item.props.app ? api.items.get(item.props.app) : null;
  return linked && linked.type === "h3.i2v" ? linked : null;
};

const runOf = (api, item) => {
  const app = appOf(api, item);
  return coerceRun(app ? appRun(propsOf(app)) : null);
};

const fresh = (list, coerce) => listOf(list, coerce).map((one) => ({ ...one, uid: newUid() }));

export const derived = {
  "h3.output": (api, item) => (item ? compose(docOf(item.props), runOf(api, item)) : ""),
  "h3.draft": {
    read: (_api, item) => {
      const { mode: _mode, ...doc } = docOf(item.props);
      return doc;
    },
    write: (_api, value, item) => {
      if (!isRecord(value)) return;
      const doc = docOf(value);
      Object.assign(item.props, {
        style: doc.style,
        speakers: doc.speakers,
        scenes: doc.scenes,
        soundscape: doc.soundscape,
        music: doc.music,
      });
    },
  },
};

export const types = {
  "h3.speaker": {
    coerce: coerceSpeaker,
    format: (v) => v.name || "—",
  },
  "h3.scene": {
    coerce: coerceScene,
    format: (v) => v.content || "—",
    portPut: (entry, value) => {
      const taken = coerceScene(value);
      return {
        ...taken,
        uid: entry.uid,
        time: entry.time,
        lines: fresh(taken.lines, coerceLine),
        screens: fresh(taken.screens, coerceScreen),
      };
    },
  },
  "h3.line": {
    coerce: coerceLine,
    format: (v) => v.text || "—",
  },
  "h3.screen": {
    coerce: coerceScreen,
    format: (v) => v.text || "—",
  },
  "h3.draft": {
    defaultValue: () => null,
    coerce: docOf,
    // Read as the script it is: the same text the builder sends.
    format: (v) => compose(docOf(v), coerceRun(null)),
  },
};

