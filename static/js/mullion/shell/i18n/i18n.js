/* Translation. The tables are the page's (static/js/i18n.js, handed in by
 * preload), with what plugins add (registerTranslations, kept here); the
 * language is the profile's setting. A module that translates declares i18n
 * in deps. Everything degrades to the key when it is missing, so an
 * untranslated string still reads. Putting the strings on the page
 * (data-i18n) is the screen's: view.applyTranslations. */
import { preload, settings } from "./deps.js";

const FALLBACK_LANGUAGE = "en";

/** The current language code. */
export const language = () => settings.get("language", FALLBACK_LANGUAGE);

/** The languages one can choose, [{ value, label }]. */
export const languages = () => preload.preloadedLanguages() || [{ value: "en", label: "English" }];

// What plugins added, by language. The page's own table stays as it is.
const added = {};

function tables() {
  const base = preload.preloadedTranslations();
  if (!base && !Object.keys(added).length) return null;
  const out = { ...(base || {}) };
  for (const [lang, strings] of Object.entries(added)) out[lang] = { ...(out[lang] || {}), ...strings };
  return out;
}

const lookup = (lang, key) => (added[lang] || {})[key] ?? ((preload.preloadedTranslations() || {})[lang] || {})[key];

/** The string for `key` in the current language, {placeholders} filled from vars. */
export function t(key, vars) {
  const template = lookup(language(), key) ?? lookup(FALLBACK_LANGUAGE, key) ?? key;
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name) => (vars[name] === undefined ? match : String(vars[name])));
}

/** The translation tables by language ({ ja: {key: text}, en: ... }), or null
 * before the page's table (static/js/i18n.js) is there. */
export const translationTables = () => tables();

// Kept beside the page's table, so a plugin ships its own strings without
// touching the core file.
export function registerTranslations(tables) {
  const known = (preload.preloadedLanguages() || []).map((one) => one.value);
  // A table that names a language the shell does not speak, or holds
  // something that is not text, is a mistake in the plugin that wrote it;
  // read as nothing, it would never be noticed.
  for (const [language, strings] of Object.entries(tables || {})) {
    if (known.length && !known.includes(language)) {
      throw new Error(`a translation table for "${language}", which the shell does not speak (${known.join(", ")})`);
    }
    for (const [key, value] of Object.entries(strings || {})) {
      if (typeof value !== "string") throw new Error(`the ${language} translation of "${key}" is not text`);
    }
    added[language] = { ...(added[language] || {}), ...strings };
  }
}
