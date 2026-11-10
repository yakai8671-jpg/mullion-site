/* What Text Compose's scripts share: the variables, the embeds in a text, what an app offers and what it comes to. */
import { createVars, idsIn, insertRun, newId } from "./vars.js";

export const APP = "compose.app";
export const CATALOG = "compose.catalog";
const KINDS = ["text", "taglist", "prompt", "promptlist", "image", "imagelist", "chainvars"];

let core = null;
export let vars = null;
export function setup(shell) {
  core = shell;
  vars = createVars(shell, shell.t);
}

const isPlain = (value) => !!value && typeof value === "object" && !Array.isArray(value);

export const coerceEmbeds = (value) => {
  const seen = new Set();
  return (Array.isArray(value) ? value : [])
    .filter((one) => isPlain(one) && typeof one.id === "string" && one.id && typeof one.var === "string" && one.var)
    .filter((one) => !seen.has(one.id) && seen.add(one.id))
    .map((one) => ({ id: one.id, var: one.var, opts: isPlain(one.opts) ? one.opts : {} }));
};

export const coerceVariable = (value) => {
  const from = isPlain(value) ? value : {};
  return {
    key: typeof from.key === "string" ? from.key : "",
    name: typeof from.name === "string" ? from.name : "",
    value: typeof from.value === "string" ? from.value : "",
  };
};

export const nameOf = (variable, sources) => {
  if (variable.source === "now") return variable.label;
  const source = sources.find((one) => one.id === variable.source);
  const t = core?.t || ((key) => key);
  return `${(source && source.label) || t("compose.value.source")} · ${variable.label}`;
};

export const offeredOf = (entry) => {
  const kinded = entry.properties.filter((one) => KINDS.includes(one.kind) && one.params && one.params.link !== true);
  const said = kinded.filter((one) => one.params.variable === true);
  if (entry.properties.some((one) => one.params && one.params.variable === true)) return said;
  return kinded.filter((one) => one.params.variable !== false && (one.params.readonly || one.params.read));
};

export const sourcesOf = (api, ids) => {
  const seen = new Map();
  const out = [];
  for (const id of Array.isArray(ids) ? ids : []) {
    const entry = typeof id === "string" ? api?.items?.get?.(id) : null;
    if (!entry || entry.type === APP || entry.type === CATALOG) continue;
    for (const one of offeredOf(entry)) {
      const n = (seen.get(one.key) || 0) + 1;
      seen.set(one.key, n);
      out.push({ id: n > 1 ? `${one.key}@${n}` : one.key, label: `${entry.label} · ${one.label}`, kind: one.kind, value: one.value, item: id });
    }
  }
  return out;
};

export const composed = (text, embeds, sources) => vars.compose(String(text ?? ""), coerceEmbeds(embeds), sources || []);

// The name of the variable an embed stands for, by the embed's id (null if the text has no such embed).
export const labelFor = (embeds, sources) => {
  const all = vars.allVariables(sources || []);
  return (id) => {
    const embed = (embeds || []).find((one) => one.id === id);
    if (!embed) return null;
    const found = all.find((one) => one.key === embed.var);
    return found ? nameOf(found, sources || []) : embed.var.split(":").slice(1).join(":") || embed.var;
  };
};

export const variablesIn = (api, appId) => {
  const app = readApp(api, appId);
  if (!app) return [];
  return vars.allVariables(app.sources).map((variable) => ({
    key: variable.key,
    name: nameOf(variable, app.sources),
    value: String(vars.format(variable, {}) ?? ""),
  }));
};

// The parts of an app read through the connection to it.
export const readApp = (api, appId) => {
  const entry = appId ? api?.items?.get?.(appId) : null;
  if (!entry || entry.type !== APP) return null;
  const get = (key) => {
    const found = entry.properties.find((one) => one.key === key);
    return found ? found.value : undefined;
  };
  return { id: appId, text: String(get("text") ?? ""), embeds: coerceEmbeds(get("embeds")), sources: Array.isArray(get("sources")) ? get("sources") : [] };
};

// Where each text's caret is, in the stored text: what the catalog puts a variable at.
const CARETS = new Map();
export const setCaret = (itemId, offset) => CARETS.set(itemId, offset);
export const caretOf = (itemId) => CARETS.get(itemId);

// A variable put into the text of an app, where the caret was: the text and the list of embeds both.
export function embedVariable(api, appId, key) {
  const app = readApp(api, appId);
  if (!app) return false;
  const id = newId();
  const text = insertRun(app.text, CARETS.has(appId) ? CARETS.get(appId) : app.text.length, id);
  const order = idsIn(text);
  const embeds = [...app.embeds, { id, var: key, opts: {} }].sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  api.items.set(appId, "embeds", embeds);
  api.items.set(appId, "text", text);
  return true;
}
