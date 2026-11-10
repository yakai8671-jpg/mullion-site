/* Text Compose declarative scripts: the values the screens read, what they do, and the controls that cannot be said in a declaration. */
import createInput from "./input.js";
import { CATALOG, coerceEmbeds, coerceVariable, composed, embedVariable, labelFor, setup, sourcesOf, variablesIn, vars } from "./lib.js";
import { dropRuns } from "./vars.js";

export function initialize(api) {
  setup(api.core);
}

export const types = {
  "compose.embed": {
    defaultValue: () => ({ id: "", var: "", opts: {} }),
    coerce: (value) => coerceEmbeds([value])[0] || { id: "", var: "", opts: {} },
    coerceList: coerceEmbeds,
    format: (value) => (value && value.var) || "—",
  },
  "compose.variable": {
    defaultValue: () => coerceVariable(null),
    coerce: coerceVariable,
    coerceList: (value) => (Array.isArray(value) ? value.map(coerceVariable) : []),
    format: (value) => coerceVariable(value).name || "—",
  },
};

// One embedded variable as the list shows it (type compose.embedview): its name with its place, what kind of
// variable it is, what it reads as now, and each option its kind has (the default where none is set).
function embedViews(api, item, context = {}) {
  const embeds = coerceEmbeds(item?.props?.embeds);
  const sources = sourcesOf(api, item?.props?.targets);
  const all = vars.allVariables(sources);
  const label = labelFor(embeds, sources);
  const t = (key) => (typeof context.t === "function" ? context.t(key) : key);
  return embeds.map((embed, index) => {
    const variable = all.find((one) => one.key === embed.var);
    const kind = variable ? variable.type : "";
    const opts = embed.opts || {};
    const options = Object.fromEntries(
      Object.values(vars.OPTIONS).flat().map((spec) => [spec.key, spec.default])
    );
    for (const spec of vars.OPTIONS[kind] || []) {
      const held = opts[spec.key];
      options[spec.key] = held === undefined || held === null ? spec.default : held;
    }
    return {
      id: embed.id,
      name: `${index + 1}. ${label(embed.id)}`,
      kind,
      typeLabel: variable ? t(`compose.type.${kind}`) : t("compose.value.gone"),
      value: variable ? String(vars.format(variable, opts) ?? "") : "",
      ...options,
    };
  });
}

export const derived = {
  embedViews,
  sources: (api, item) => sourcesOf(api, item?.props?.targets),
  result: (api, item) => composed(item?.props?.text, item?.props?.embeds, sourcesOf(api, item?.props?.targets)),
  variables: (api, item) => variablesIn(api, item?.props?.app),
  // Something is offered, but nothing is connected to the app: only the basic ones.
  needsConnection: (api, item) => {
    const all = variablesIn(api, item?.props?.app);
    return all.length > 0 && all.every((one) => one.key.startsWith("now:"));
  },
};

// ---- what it does ------------------------------------------------------------------------------
export const actions = {
  // How one embedded variable is written.
  "textcompose.embed.opts": {
    async run({ embeds, id, opts }) {
      return { embeds: coerceEmbeds(embeds).map((one) => (one.id === id ? { ...one, opts: opts && typeof opts === "object" ? opts : {} } : one)) };
    },
  },
  // One option of how one embedded variable is written.
  "textcompose.embed.opt": {
    async run({ embeds, id, key, value }) {
      // A field hands over what is typed: a number option is kept as a number.
      const spec = Object.values(vars.OPTIONS).flat().find((one) => one.key === key);
      const held = spec && spec.kind === "number" ? (Number.isFinite(Number(value)) ? Number(value) : spec.default) : value;
      return { embeds: coerceEmbeds(embeds).map((one) => (one.id === id ? { ...one, opts: { ...(one.opts || {}), [key]: held } } : one)) };
    },
  },
  // A variable taken out of the list leaves the text too.
  "textcompose.embed.remove": {
    async run({ text, embeds, id }) {
      return { text: dropRuns(String(text ?? ""), new Set([id])), embeds: coerceEmbeds(embeds).filter((one) => one.id !== id) };
    },
  },
  // Beside the app if its catalog is a window of the app's frame (fronted), else one step along this window.
  "textcompose.catalog.open": {
    async run({ catalog }, { api, itemId }) {
      if (catalog && api.window.reveal(catalog)) return {};
      api.window.openScreen(CATALOG, { app: itemId });
      return {};
    },
  },
  // A variable of the catalog put into the text of the app it belongs to, where the caret was.
  "textcompose.catalog.embed": {
    async run({ app, key }, { api }) {
      embedVariable(api, app, key);
      return {};
    },
  },
};

// ---- the controls ------------------------------------------------------------------------------
export const controls = {
  // The shell's text card, with the variables as badges in the text.
  "compose.input": (api) => createInput(api),

  "compose.formatbox": (api) => {
    const base = () => api?.controls?.textbox;
    return {
      render(desc, onChange) {
        return base()?.render ? base().render(desc, onChange) : document.createElement("input");
      },
      update(el, desc) {
        if (base()?.update) base().update(el, desc);
      },
    };
  },
};
