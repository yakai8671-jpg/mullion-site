/* Which apps Home shows, in which groups: kept in the profile (/api/settings).
 * Home's own: only the Home item (dashboard.js) and its group editor
 * (homeeditor.js) read and write it, so it lives beside them in builtins
 * (it was the home module until 2026-11-11).
 *
 * Named groups, each a list of app ids, in order. null is Home as it comes
 * (defaultHomeGroups) and is what "back to the default" puts back. Kept in
 * the profile as JSON text, for the reason launch layouts are: the profile
 * merges objects key by key, and a list merged into the one before it would
 * keep what was taken out. */
import { APPS, refreshAll, settings, t } from "./deps.js";

const isPlainObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);


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

// Home's groups, in order: their ids and names are the core's. Which app sits
// in which is the app's own say -- `home` (and `homeOrder`, smaller first) in
// its declaration -- so this file names no plugin. An app that says nothing,
// or names a group that is not here, is still shown, after them, under "not in
// a group" (see the dashboard); an app whose plugin did not load is not there.
const HOME_GROUPS = ["image", "prompt", "video", "audio", "other", "utility", "mullion"];

function defaultHomeGroups() {
  const order = (app) => (Number.isFinite(app.homeOrder) ? app.homeOrder : Infinity);
  return HOME_GROUPS.map((id) => ({
    id: `d-${id}`,
    name: t(`mu.home.group.${id}`),
    apps: Object.values(APPS)
      .filter((app) => app.home === id)
      .sort((a, b) => order(a) - order(b) || a.type.localeCompare(b.type))
      .map((app) => app.type),
  }));
}

function setHomeGroups(groups) {
  const text = groups ? JSON.stringify(groups) : "";
  // Into the cache first, so what is drawn next already reads it.
  settings.cache[HOME_KEY] = text;
  const saving = settings.update({ [HOME_KEY]: text }).catch((error) =>
    console.error("[mullion] Home was not saved:", error.message || error)
  );
  // Home is drawn from these, in every window that shows it.
  refreshAll();
  return saving;
}

export { homeGroups, defaultHomeGroups, setHomeGroups };
