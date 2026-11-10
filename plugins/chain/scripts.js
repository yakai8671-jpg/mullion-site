/* Chain declarative scripts: the values the screens read, what they do, the value types and the two controls. */
import { appEmbed } from "../workflow/runner.js";
import { createEditor } from "./editor.js";
import { REPORTS, RUNS, coerceBlock, coerceBlocks, coerceDecls, coerceVariables, copyValue, declaredVariables, labelOf, newRun, remember, runChain, setup, variableValues, viewOf } from "./lib.js";

let CORE;
export function initialize(api) {
  CORE = api.core;
  VT = api.valueTypes;
  IT = api.types;
  setup({ core: api.core, valueTypes: api.valueTypes });
}
let VT;
let IT;

// ---- the values the screens read --------------------------------------------------------------
export const derived = {
  // The variables the chain holds, and what they are worth now: what a text composer's catalog is linked to.
  chainVariables: (_api, item) => variableValues(item.id, item.props),
  // What the chain is now: the lamp and the line, the checks, the blocks as the screen draws them.
  chainView: (api, item) => viewOf(api, item.id, item.props, () => CORE.refreshAll()),
  // The same, for the screen behind the state row: it reaches the chain it shows through the link.
  hostView: (_api, item) => {
    const report = REPORTS.get(item.props.host);
    return report ? viewOf(report.api, item.props.host, report.props, () => CORE.refreshAll()) : null;
  },
};

// ---- what it does ------------------------------------------------------------------------------
function cancelChain(api, itemId) {
  const state = RUNS.get(itemId);
  if (!state || !state.running) return;
  state.cancelled = true;
  const block = state.blocks.find((one) => one.id === state.current);
  // The app's own stop, when it has one.
  if (block && block.kind === "run" && block.button && block.button.app) {
    Promise.resolve()
      .then(() => api.apps.press(block.button.app, "cancel"))
      .catch(() => {});
  }
}

export const actions = {
  "chain.run": {
    async run({ blocks, apps, variableList }, { api, itemId, signal, status, progress, read }) {
      remember(api);
      const embed = appEmbed();
      const before = RUNS.get(itemId);
      if (!embed || (before && before.running)) return {};
      const state = newRun({
        blocks,
        apps: (Array.isArray(apps) ? apps : []).filter((id) => api.items.get(id)),
        declared: declaredVariables({ blocks, variableList }),
      });
      RUNS.set(itemId, state);
      const env = {
        api,
        embed,
        signal,
        read: (key) => read(key),
        progress: () => {
          state.version += 1;
          CORE.refreshAll();
        },
        running: (app) => progress("chain.status.running", { name: labelOf(api, app) }),
        kept: () => {},
      };
      CORE.refreshAll();
      try {
        await runChain(state, env);
        status("chain.status.done");
      } catch (error) {
        if (state.current) state.errors.set(state.current, error.message || String(error));
        status("chain.status.failed", { error: error.message || String(error) });
      }
      state.running = false;
      state.current = "";
      // What the kept variables ended with, for the next run.
      const kept = declaredVariables({ blocks: read("blocks"), variableList: read("variableList") }).map((one) =>
        one.keep && state.vars.has(one.name.trim()) ? { ...one, value: copyValue(state.vars.get(one.name.trim())) } : one
      );
      CORE.refreshAll();
      return { variableList: kept };
    },
  },
  "chain.cancel": {
    async run(_inputs, { api, itemId }) {
      cancelChain(api, itemId);
      return {};
    },
  },
  // The screen behind the state row stops the chain it shows.
  "chain.stop": {
    async run({ host }, { api }) {
      cancelChain(api, host);
      return {};
    },
  },
  // Something the window's controls have to say to the person.
  "chain.say": {
    async run({ key }, { status }) {
      status(key);
      return {};
    },
  },
  // The screen behind the state row, opened along this window's path.
  "chain.open": {
    async run(_inputs, { api, itemId }) {
      api.window.openScreen("chain.status", { host: itemId });
      return {};
    },
  },
};

// ---- the screens and the controls ---------------------------------------------------------------
export const screens = {
  // The chain: its blocks, what the linked apps offer, and its variables.
  "chain.app": (fw) => createEditor(fw, VT, IT),
  // The checklist behind the state row: the apps, the blocks, the servers and, while it runs, where it is.
  "chain.status": (fw) => {
    const { NODES, t } = fw.core;
    return {
      body(s) {
        const view = s.props.report;
        if (!view) return [NODES.section("state", "", [], { empty: t("chain.state.gone") })];
        return [
          NODES.card(
            "chain-state",
            t("chain.section.state"),
            [NODES.control("checks", { control: "checklist", checks: view.checks })],
            [
              ...(view.running ? [{ key: "cancel", primary: true, icon: "stop-fill", label: t("chain.action.cancel"), run: () => s.run("stop") }] : []),
              { key: "refresh", icon: "arrow-clockwise", title: t("chain.action.recheck"), run: () => fw.core.refreshAll() },
            ],
            { icon: "diagram-3" }
          ),
        ];
      },
    };
  },
};


export const types = {
  "chain.variablevalue": {
    defaultValue: () => ({ name: "", type: "string", value: "" }),
    coerce: (value) => coerceVariables([value])[0] || { name: "", type: "string", value: "" },
    coerceList: coerceVariables,
    format: (value) => (value && value.name) || "\u2014",
  },
  "chain.variable": {
    defaultValue: () => ({ id: "", name: "", type: "string", keep: false, value: null }),
    coerce: (value) => coerceDecls([value])[0] || { id: "", name: "", type: "string", keep: false, value: null },
    coerceList: coerceDecls,
    format: (value) => (value && value.name) || "\u2014",
    portRead: (value) => ({ variable: value.id }),
  },
  "chain.block": ({ core }) => ({
    defaultValue: (p) => coerceBlock(p?.default),
    coerce: (value) => coerceBlock(value),
    coerceList: coerceBlocks,
    format: (value) => core.t(`chain.kind.${coerceBlock(value).kind}`),
    portRead: (value) => ({ block: value.id }),
    groups: {
      of: (value) => core.t(`chain.kind.${coerceBlock(value).kind}`),
    },
  }),
};
