/* home: moved out of core.js (docs/wiki/migration.md). Which apps Home shows,
 * in which groups: kept in the profile (/api/settings). */
import { isPlainObject, t, settings } from "./deps.js";

// What home says: "change" after its groups were written.
let homeChanged = () => {};
export function connectEvents(emit) {
  homeChanged = () => emit("change", {});
}

const HOME_KEY = "homeGroups";

function homeGroups() {
  const text = settings.get(HOME_KEY, "");
  if (typeof text !== "string" || !text) return null;
  try {
    const value = JSON.parse(text);
    if (!Array.isArray(value)) return null;
    return value
      .filter((one) => isPlainObject(one) && typeof one.id === "string" && one.id)
      .map((one) => ({
        id: one.id,
        name: typeof one.name === "string" ? one.name : "",
        apps: Array.isArray(one.apps) ? [...new Set(one.apps.filter((id) => typeof id === "string" && id))] : [],
      }));
  } catch {
    return null;
  }
}

// Home as it comes: the groups an unedited Home shows, and what an edit
// starts from. Which app is in which is this table's say (2026-10-22, the
// user's); an app that is not in it -- one that came later -- is still shown,
// after them, under "not in a group" (see the dashboard). An id that is not
// there (a plugin that is not installed) is skipped when Home is drawn.
const DEFAULT_HOME = [
  [
    "image",
    [
      "t2i.app", "imageedit.app", "rmbg.app", "panorama.editor", "pose2img.app", "pose2img.scene",
      "charsheet.app", "loratrain.app",
    ],
  ],
  // What makes or tidies prompts (2026-11-05, the user's: "prompt generation goes here").
  ["prompt", ["i2p.app", "prompt.generator", "prompt.assembler", "qwenpe.app", "h3.builder", "tagdict.viewer"]],
  ["video", ["wan.t2v", "wan.i2v", "h3.i2v", "rmbg.video"]],
  ["audio", ["speech.voicevox", "speech.irodori", "yue2.app", "yue2.editor"]],
  ["other", ["stage.scene", "character.editor", "reddi2ch.app"]],
  [
    "utility",
    ["notepad.editor", "jsoneditor.editor", "bseditor.cells", "files.browser", "clock.face", "terminal.shell", "compose.app", "propgroup.app", "scratch.board", "chain.app"],
  ],
  [
    "mullion",
    [
      "dashboard", "settings", "preview", "history", "hotkeys.manager", "bays.manager", "presetcreate", "workflow.history",
      "apps.list", "apps.editor", "services.manager", "devtools",
    ],
  ],
];

function defaultHomeGroups() {
  return DEFAULT_HOME.map(([id, apps]) => ({ id: `d-${id}`, name: t(`mu.home.group.${id}`), apps: [...apps] }));
}

function setHomeGroups(groups) {
  const text = groups ? JSON.stringify(groups) : "";
  // Into the cache first, so what is drawn next already reads it.
  settings.cache[HOME_KEY] = text;
  const saving = settings.update({ [HOME_KEY]: text }).catch((error) =>
    console.error("[mullion] Home was not saved:", error.message || error)
  );
  homeChanged();
  return saving;
}

export { HOME_KEY, DEFAULT_HOME, homeGroups, defaultHomeGroups, setHomeGroups };
