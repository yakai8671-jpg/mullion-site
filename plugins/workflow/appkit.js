/* App kit -- what every workflow app has besides its run.
 *
 * An app built on the runner -- the workflow app, Text to Image, Image to
 * Prompt -- is more than its two working windows. It can be pointed at a
 * saved way of running, and its dashboard lists its windows:
 *
 *   <app>                      the dashboard: readiness, presets, windows
 *   ├ workflow.settings          run settings
 *   └ workflow.preview           output preview
 *
 * What it has done is not the app's: every finished run goes into one
 * history, kept and shown by the History app (`workflow.history`), and is
 * put back by dragging its card onto the run settings of the app it came
 * from. The app's colour and the way its windows open are the shell's, in
 * the window settings behind the window's id.
 *
 * Two kinds of saved value, both ordinary library entries:
 *
 *   workflow.runpreset     how a run is set up, saved by hand from the run
 *                          settings and loaded from the dashboard
 *   workflow.historyentry  one finished run, kept automatically: the same
 *                          record with the picture, the output and the time
 */

import { appEmbed, resultAddress, retireWorkflowExecution, runAppKit, runKind, workflowRunAction } from "./runner.js";
import { tagTexts } from "../prompt/tags.js";
import { withAttention } from "./attention.js";

// The permissions an app type needs for what this adds: store:read for the
// picker to be offered, store:write to save one, window:write to open its
// windows in place.
export const APP_PERMISSIONS = ["store:read", "store:write", "window:write"];

// An app that is its own run settings: one window, which is where it is
// set up, run and its output looked at. What the app has besides -- a 3D
// scene, a panorama viewer, a prompt builder -- are windows it owns, beside
// it in its launch layout.
//
//   registerRunApp(fw, "t2i.app", {
//     label, icon,
//     template,                    the template, or (item) => template
//     engines,                     or several: [{key, label, template}],
//                                  one chosen in the app (see below)
//     properties,                  the app's own, beside the run settings'
//                                  (a `chain`, the windows it owns)
//     layout,                      where its windows go: "self" and {owned}
//     props,                       what a new one starts with ({ size })
//     sections(api, app, ctx),     nodes of its own above the inputs
//     permissions, ...rest         promptText, supplies, output -- read off
//                                  the type by the run settings as before
//   })
//
// Registered through the caller's own surface, so the type is the caller's,
// declared in its manifest.
//
// Engines: one app over more than one model -- Anima or Qwen for the same
// picture, MiniMax H3's frame or reference checkpoint -- rather than an app
// per model. Each engine is a whole template; the app runs the one chosen
// in its `engine` row, shown at the top of the run settings. A template's
// detailed settings are kept by node id, and two templates number their
// nodes alike, so each engine keeps its own: changing engine puts the
// current ones away and takes out the new engine's (`engineSettings`).
export function registerRunApp(fw, type, spec) {
  const { item, app } = defineRunApp(fw, type, spec);
  fw.registerApp(type, app);
  return fw.registerItemType(type, item);
}

function defineRunApp(fw, type, spec) {
  const kit = runAppKit();
  const { label, icon, template: given, engines = null, properties = {}, layout = null, props = null, permissions = [], sections, appName = null, ...rest } = spec;
  const { core, describe } = fw;
  const { NODES, t } = core;
  const engineOf = (item) => {
    const key = item && item.props ? item.props.engine : "";
    return engines.find((one) => one.key === key) || engines[0];
  };
  const template = engines ? (item) => engineOf(item).template : given;
  const engineProps = engines
    ? {
        engine: {
          label: "workflow.prop.engine",
          type: "enum",
          control: "select",
          default: engines[0].key,
          options: () => engines.map((one) => ({ value: one.key, label: t(one.label) })),
          placed: true,
        },
        // Each other engine's detailed settings while it is not the one in
        // use: [{engine, settings}].
        engineSettings: { label: "workflow.prop.engineSettings", type: "data", default: [], placed: true },
      }
    : {};
  // The engine row: changing it swaps the detailed settings with it.
  const engineSection = (api, app, ctx) => {
    const spec2 = fw.types[type].properties.engine;
    const row = describe(
      {
        ...spec2,
        read: () => engineOf({ props: { engine: ctx.get("engine") } }).key,
        write: (_api, value) => {
          const from = engineOf({ props: { engine: ctx.get("engine") } }).key;
          if (value === from) return;
          const kept = (ctx.get("engineSettings") || []).filter((one) => one && one.engine !== from);
          const next = (kept.find((one) => one.engine === value) || {}).settings || [];
          ctx.set("engineSettings", [...kept.filter((one) => one.engine !== value), { engine: from, settings: ctx.get("settings") || [] }]);
          ctx.set("settings", next);
          ctx.set("engine", value);
        },
      },
      { api, key: `${app.id}-engine`, label: t(spec2.label) }
    );
    return NODES.props("engine", [row]);
  };
  // `appName`: what the app as a whole is called, when that is not what its
  // own window is (the group is the panorama, the window generates it).
  // `keep`: what an app made from one of these keeps of its main item: the
  // engine, and whatever it is opened with.
  const app = {
    layout: layout || { children: ["self"] },
    defaultItem: type,
    ...(props ? { props } : {}),
    ...(appName ? { name: appName } : {}),
    keep: [...(engines ? ["engine"] : []), ...Object.keys(props || {})],
  };
  const item = {
    label,
    icon,
    standalone: true,
    // What tells the runner that this item is its own run settings.
    runApp: true,
    // What a chain may press, set and read of it (core's appSurface).
    appSurface: (api, item) => {
      const embed = appEmbed();
      return embed ? embed.surface(api, item.id) : {};
    },
    ...rest,
    permissions: [...new Set([...kit.permissions, "layout:place", ...APP_PERMISSIONS, ...permissions])],
    properties: {
      // Read-through: the workflow is the module's, so nothing of it is
      // kept in the layout and an app saved before the workflow was changed
      // comes back running the new one.
      template: {
        label: "workflow.prop.template",
        type: "workflow.template",
        read: (_api, item) => (typeof template === "function" ? template(item) : template),
        placed: true,
      },
      ...engineProps,
      ...kit.properties(),
      ...properties,
    },
    ...(engines || sections
      ? { sections: (api, app, ctx) => [...(engines ? [engineSection(api, app, ctx)] : []), ...(sections ? sections(api, app, ctx) : [])] }
      : {}),
    body: (api, item, ctx) => kit.body(api, item, ctx),
  };
  return { item, app };
}

// `extras` (from the derived item's declaration): `permissions`, `properties`
// it adds (data), and `hooks` from its scripts -- `properties` (a property's
// functions: read, options, ...), `supplies`, `sections`, and `output`, as a
// run app written in code passes them.
const RUN_HOOKS = ["properties", "supplies", "sections", "output"];
export function declareRunApp(fw, type, presentation, config, asset, extras = {}) {
  const record = (value) => value && typeof value === "object" && !Array.isArray(value);
  if (!record(config) || Object.keys(config).some((key) => !["engines", "template", "promptText", "attention", "runLabel"].includes(key))) {
    throw new Error("config: expected engines or template, and optional promptText, attention and runLabel");
  }
  const { engines, template: single, promptText = false, attention = false, runLabel } = config;
  if (runLabel !== undefined && (typeof runLabel !== "string" || !runLabel)) throw new Error("config.runLabel: expected a translation key");
  const { permissions = [], properties: added = {}, hooks = {} } = extras;
  const unknownHook = Object.keys(hooks).find((key) => !RUN_HOOKS.includes(key));
  if (unknownHook) throw new Error(`hooks: "${unknownHook}" is not a hook of workflow.run (${RUN_HOOKS.join(", ")})`);
  for (const [key, own] of Object.entries(hooks.properties || {})) {
    if (!Object.hasOwn(added, key)) throw new Error(`hooks.properties.${key}: only a property the item adds can take functions`);
    if (Object.entries(own).some(([field, fn]) => typeof fn !== "function" || Object.hasOwn(added[key], field))) {
      throw new Error(`hooks.properties.${key}: expected functions for fields its declaration does not give`);
    }
  }
  const own = {
    ...presentation,
    ...(runLabel ? { runLabel } : {}),
    permissions,
    properties: Object.fromEntries(Object.entries(added).map(([key, spec]) => [key, { ...spec, ...(hooks.properties?.[key] || {}) }])),
    ...(hooks.supplies ? { supplies: hooks.supplies } : {}),
    ...(hooks.sections ? { sections: hooks.sections } : {}),
    ...(hooks.output ? { output: hooks.output } : {}),
  };
  if (typeof promptText !== "boolean" || typeof attention !== "boolean") throw new Error("config: promptText and attention must be boolean");
  // One workflow and no engine to choose (`template`), or several (`engines`).
  const checked = (file, path) => {
    const template = asset(file);
    if (typeof file !== "string" || !record(template?.workflow?.graph)) throw new Error(`${path}: expected a declared JSON workflow asset`);
    const graph = template.workflow.graph;
    if (!Object.keys(graph).length || Object.values(graph).some((node) =>
      !record(node) || typeof node.class_type !== "string" || !record(node.inputs))) {
      throw new Error(`${path}.workflow.graph: expected nonempty ComfyUI nodes with inputs`);
    }
    return attention ? withAttention(template) : template;
  };
  if ((engines === undefined) === (single === undefined)) throw new Error("config: expected exactly one of engines and template");
  if (single !== undefined) {
    return defineRunApp(fw, type, {
      ...own, template: checked(single, "config.template"), promptText,
      actions: { run: workflowRunAction() },
      destroy: (item) => retireWorkflowExecution(item.id),
    });
  }
  if (!Array.isArray(engines) || !engines.length) throw new Error("config.engines: expected at least one engine");
  const keys = new Set();
  const compiled = engines.map((engine, index) => {
    const path = `config.engines[${index}]`;
    if (!record(engine) || Object.keys(engine).some((key) => !["key", "label", "template"].includes(key)) ||
        typeof engine.key !== "string" || !engine.key || keys.has(engine.key) ||
        typeof engine.label !== "string" || !engine.label || typeof engine.template !== "string") {
      throw new Error(`${path}: expected a unique key, label and workflow template`);
    }
    keys.add(engine.key);
    const template = asset(engine.template);
    if (!record(template?.workflow?.graph)) throw new Error(`${path}.template: expected a declared JSON workflow asset`);
    const graph = template.workflow.graph;
    if (!Object.keys(graph).length || Object.values(graph).some((node) =>
      !record(node) || typeof node.class_type !== "string" || !record(node.inputs))) {
      throw new Error(`${path}.template.workflow.graph: expected nonempty ComfyUI nodes with inputs`);
    }
    return { ...engine, template: attention ? withAttention(template) : template };
  });
  return defineRunApp(fw, type, {
    ...own, engines: compiled, promptText,
    actions: { run: workflowRunAction() },
    destroy: (item) => retireWorkflowExecution(item.id),
  });
}

// Showing an item one of an app's windows owns -- its settings, an editor,
// its history. Brought forward where it is already on screen; otherwise
// opened in the window that asked, one step along its path, with the way
// back in its crumbs. A window of its own, placed by guides, is for what
// is asked for as one -- launching an app -- not for going to a child.
export function openChild(api, id) {
  if (!id) return false;
  if (api.window && api.window.reveal && api.window.reveal(id)) return true;
  if (api.layout && api.layout.reveal && api.layout.reveal(id)) return true;
  if (api.window && api.window.open) return Boolean(api.window.open(id));
  if (api.layout && api.layout.start) api.layout.start({ item: id });
  return true;
}

// Open a child from the control that was pressed, even when another window
// already shows the same document. Preview cards use this form: they are a
// doorway further into the current window, so the breadcrumb path must be
// the one that changes.
export function openChildInPath(api, id) {
  if (!id) return false;
  if (api.window && api.window.open) return Boolean(api.window.open(id));
  return openChild(api, id);
}

export function registerAppKit(fw) {
  fw.registerItemFactory("workflow.run", declareRunApp);
  const { core, describe, registerControl, registerItemType, registerValueType } = fw;
  const { NODES, t } = core;

  const appLabelOf = (type) => (type && fw.types[type] ? t(fw.types[type].label) : "");
  const isRecord = (value) => !!value && typeof value === "object" && !Array.isArray(value);
  const when = (iso) => {
    const at = new Date(iso);
    return Number.isNaN(at.getTime()) ? "" : at.toLocaleString();
  };
  // ---- the two saved values --------------------------------------------
  // Grouped by app, which is how the picker narrows to the presets that fit
  // the app it was opened from.
  const record = (value) => (isRecord(value) ? value : {});
  registerControl("workflow.summaryline", {
    label: "workflow.control.summaryline",
    render(desc) {
      const el = document.createElement("span");
      el.className = "workflow-summaryline";
      fw.controls["workflow.summaryline"].update(el, desc);
      return el;
    },
    update(el, desc) {
      const said = desc.property.format();
      if (el.textContent !== said) el.textContent = said;
    },
  });

  // An app's preset: a history entry without when it ran and how long it
  // took -- {app, template, summary, run, results} -- so a run is put back
  // by the same code whichever of the two it came from. `run` is the run
  // settings (see snapshotOf), `results` what it made.
  const isVideo = (ref) => /\.(mp4|webm|mov|mkv|gif)$/i.test(String((ref && ref.filename) || ""));
  // The run's keys edited as the properties they are on the app: its own
  // spec (a size is a size, a seed a number), with the value read from the
  // draft instead of an item.
  const RUN_FIELDS = ["text", "promptText", "negativeText", "size", "seed", "randomSeed", "ollamaModel", "engine"];
  const RUN_PICTURES = ["image", "image2", "image3", "image4", "image5"];
  const stripped = (spec) => {
    const { read, write, placed, label, ...rest } = spec || {};
    return rest;
  };

  registerValueType("workflow.runpreset", {
    label: "workflow.vtype.runpreset",
    icon: "sliders",
    params: ["default"],
    sample: { default: { app: "", template: "", summary: "", run: {}, results: [] } },
    defaultControl: "workflow.summaryline",
    defaultValue: (p) => record(p.default),
    coerce: (value) => record(value),
    groups: { label: "workflow.field.app", of: (value) => appLabelOf(record(value).app) },
    format: (value) => {
      const one = record(value);
      return [appLabelOf(one.app), one.summary].filter(Boolean).join(" · ") || t("workflow.vtype.runpreset");
    },
    // What it made, or -- before it has run -- the picture it was set up on.
    presetPreview: (value) => {
      const one = record(value);
      const made = (Array.isArray(one.results) ? one.results : [])
        .filter((result) => result && result.kind === "image" && result.ref && !isVideo(result.ref))
        .map((result) => resultAddress(result));
      const given = [record(one.run).image].filter((src) => typeof src === "string" && src);
      return {
        images: made.length ? made : given,
        text: [appLabelOf(one.app), one.summary].filter(Boolean).join(" · ") || t("workflow.vtype.runpreset"),
      };
    },
    // One row per thing the run holds, as the editor that sets it up has it:
    // which rows there are follows the app the preset is of.
    presetEditor: (desc, { itemId }) => {
      const value = () => record(desc.property.get());
      const run = () => record(value().run);
      // The line a run goes by in lists follows what it was set to, as it
      // does when a run is kept: the prompt, else the text, else the picture.
      const slotLine = (slots) =>
        (Array.isArray(slots) ? slots : [])
          .map((one) => (one && (one.kind === "text" ? one.text : tagTexts(one.tags).join(", "))) || "")
          .filter(Boolean)
          .join(", ");
      const summaryOf = (one) =>
        slotLine(one.parts) || String(one.promptText || "").trim() || String(one.text || "").trim() || one.imageName || "";
      const setRun = (patch) => {
        const next = { ...run(), ...patch };
        desc.property.set({ ...value(), summary: summaryOf(next), run: next });
      };
      const props = () => (fw.types[value().app] || {}).properties || {};
      const field = (key, label, spec, read, write, extra = {}) => ({
        ...describe(
          { ...spec, ...extra, read, write: (_api, next) => write(next) },
          { api: desc.api, key: `${desc.key}-${key}`, label }
        ),
        key: `${desc.key}-${key}`,
      });
      const fields = [
        field("app", t("workflow.field.app"), { type: "string", readonly: true }, () => appLabelOf(value().app), () => {}),
        field("template", t("workflow.prop.template"), { type: "string", readonly: true }, () => String(value().template || ""), () => {}),
        field("summary", t("workflow.field.summary"), { type: "string", readonly: true }, () => String(value().summary || ""), () => {}),
      ];
      for (const key of RUN_FIELDS) {
        const spec = props()[key];
        if (!spec || !(key in run())) continue;
        fields.push(field(key, t(spec.label), stripped(spec), () => run()[key], (next) => setRun({ [key]: next })));
      }
      for (const key of RUN_PICTURES) {
        const spec = props()[key];
        if (!spec || !run()[key]) continue;
        fields.push({
          ...field(key, t(spec.label), stripped(spec), () => run()[key] || "", (next) => setRun({ [key]: next || "" })),
          wide: true,
        });
      }
      for (const [key, label] of [
        ["parts", "prompt.vtype.template"],
        ["negativeParts", "workflow.prop.negativeParts"],
      ]) {
        if (!Array.isArray(run()[key])) continue;
        fields.push({
          ...field(key, t(label), { type: "list", each: { type: "prompt.slot" }, control: "prompt.promptlist" }, () => run()[key], (next) => setRun({ [key]: next }), {
            itemId,
          }),
          wide: true,
        });
      }
      if (Array.isArray(run().categoryEditor)) {
        fields.push({
          ...field(
            "categories",
            t("workflow.vtype.categories"),
            { type: "list", each: { type: "description" } },
            () => run().categoryEditor,
            (next) => setRun({ categoryEditor: next })
          ),
          wide: true,
        });
      }
      return { fields };
    },
  });

  registerValueType("workflow.historyentry", {
    label: "workflow.vtype.historyentry",
    icon: "clock-history",
    params: ["default"],
    sample: { default: { app: "", at: "" } },
    defaultControl: "workflow.summaryline",
    defaultValue: (p) => record(p.default),
    coerce: (value) => record(value),
    groups: { label: "workflow.field.app", of: (value) => appLabelOf(record(value).app) },
    format: (value) => {
      const one = record(value);
      return [when(one.at), one.summary].filter(Boolean).join(" · ");
    },
  });

  // ---- the history as a list -------------------------------------------
  // One card per run: the grip it is carried by, what it made, which app
  // made it and when, what went in and what came out, and the one thing
  // done to it here -- throw it away. Putting it back is done by carrying
  // it to that app's run settings.
  registerControl("workflow.historylist", {
  // Draws as a card, and has no header to put a name in (see core unnamedCardsIn).
  cardName: () => "",
    label: "workflow.control.historylist",
    standalone: true,
    // `bare`: the rows alone, for a card of the body's own to hold (see the history item).
    params: ["entries", "empty", "bare"],
    sampleParams: {
      entries: [{ key: "1", when: "2026/9/22 10:00", took: "took 8.4 s", app: "Text to Image", summary: "1girl, smile", output: "" }],
    },
    render(desc) {
      const el = document.createElement("div");
      el.className = "workflow-history";
      fw.controls["workflow.historylist"].update(el, desc);
      return desc.params.bare ? el : core.listCard(el, { key: `history:${desc.key || ""}` });
    },
    update(wrap, desc) {
      const el = wrap.__list || wrap;
      const entries = desc.params.entries || [];
      el.classList.toggle("is-empty", !entries.length);
      if (!entries.length) {
        el.textContent = desc.params.empty || "";
        return;
      }
      // Rebuilt rather than diffed: nothing in a card is typed into, and
      // the list changes a card at a time.
      el.textContent = "";
      for (const entry of entries) {
        const card = document.createElement("div");
        card.className = "workflow-history-card";
        const grip = document.createElement("button");
        grip.type = "button";
        grip.className = "mu-icon-button mu-port-grip";
        grip.title = t("workflow.action.carryRun");
        grip.append(Object.assign(document.createElement("i"), { className: "bi bi-grip-vertical" }));
        core.attachPort(card, grip, entry.port || null);
        const thumb = document.createElement("div");
        thumb.className = "workflow-history-thumb";
        if (entry.thumb) {
          // A video's first frame: loaded as far as that and no further.
          thumb.append(
            /[?&]filename=[^&]*\.(webm|mp4|m4v|mov|mkv)(&|$)/i.test(entry.thumb)
              ? Object.assign(document.createElement("video"), { src: entry.thumb, muted: true, preload: "metadata" })
              : Object.assign(document.createElement("img"), { src: entry.thumb, alt: "", loading: "lazy" })
          );
        } else {
          thumb.append(Object.assign(document.createElement("i"), { className: "bi bi-card-text" }));
        }
        const info = document.createElement("div");
        info.className = "workflow-history-info";
        const top = Object.assign(document.createElement("span"), { className: "workflow-history-when" });
        if (entry.app) {
          top.append(Object.assign(document.createElement("span"), { className: "workflow-history-app", textContent: entry.app }));
        }
        top.append(document.createTextNode(entry.when));
        if (entry.took) {
          top.append(Object.assign(document.createElement("span"), { className: "workflow-history-took", textContent: entry.took }));
        }
        info.append(top);
        for (const [cls, text] of [
          ["workflow-history-summary", entry.summary],
          ["workflow-history-output", entry.output],
        ]) {
          if (!text) continue;
          info.append(Object.assign(document.createElement("span"), { className: cls, textContent: text, title: text }));
        }
        const tools = document.createElement("div");
        tools.className = "workflow-history-tools";
        const button = (icon, title, run, extra = "") => {
          const one = document.createElement("button");
          one.type = "button";
          one.className = `mu-icon-button ${extra}`.trim();
          one.title = title;
          one.append(Object.assign(document.createElement("i"), { className: `bi bi-${icon}` }));
          one.onclick = (event) => {
            event.stopPropagation();
            run();
          };
          return one;
        };
        tools.append(button("trash", t("workflow.action.deleteRun"), entry.onDelete, "action-delete"));
        card.append(grip, thumb, info, tools);
        el.append(card);
      }
    },
  });

  // ---- run history -----------------------------------------------------
  // Every app's finished runs, as one list a read-through property holds:
  // carried one at a time, as a run of the app that made it, which only
  // that app's run settings take. Nothing is put into it from outside --
  // a run is kept by finishing it.
  const historyEntries = (value) => (Array.isArray(value) ? value.filter((one) => one && one.id != null) : []);
  // One of them is a run as the library keeps it ({id, name, value}), the
  // value being the `workflow.historyentry` it made: carried as that value, in
  // the kind of the app that made it.
  registerValueType("workflow.historyrun", {
    label: "workflow.vtype.historyrun",
    icon: "clock-history",
    storable: false,
    presetNew: false,
    identity: "id",
    portKindOf: (entry) => runKind(record(entry && entry.value).app),
    portReceive: false,
    portRead: (entry) => entry.value,
    params: ["default"],
    sample: { default: { id: "h0", name: "run", value: { app: "", at: "" } } },
    defaultControl: "summary",
    defaultValue: () => ({ id: "", name: "", value: {} }),
    coerce: (value) => (isRecord(value) ? value : { id: "", name: "", value: {} }),
    coerceList: historyEntries,
    list: { storable: false, label: "workflow.vtype.historyentries", icon: "clock-history" },
    format: (value) => (value && value.name) || "\u2014",
  });

  fw.registerTranslations({
    en: {
      "workflow.item.history": "Run History",
      "workflow.setting.historyEnabled": "Keep a run history",
      "workflow.setting.historyMax": "Runs kept at most",
      "workflow.prop.historyEntries": "Runs",
      "workflow.prop.historyApp": "App",
      "workflow.vtype.runpreset": "Run settings",
      "workflow.field.summary": "Summary",
      "workflow.vtype.historyentry": "Run history entry",
      "workflow.vtype.historyentries": "Run history",
      "workflow.vtype.historyrun": "Run",
      "workflow.field.app": "app",
      "workflow.control.summaryline": "Summary",
      "workflow.control.historylist": "History list",
      "workflow.section.history": "Runs ({n})",
      "workflow.action.loadRunPresetTitle": "Load saved run settings into this app's run settings",
      "workflow.action.carryRun": "Drag onto the run settings of the app that made it to put this run back: its settings, picture and output",
      "workflow.action.deleteRun": "Delete this run from the history",
      "workflow.action.clearHistory": "Clear the history",
      "workflow.prompt.clearHistory": "Delete all {n} runs in the history?",
      "workflow.prompt.clearAppHistory": "Delete all {n} runs of {app}?",
      "workflow.port.restore": "Restore this run",
      "workflow.status.restored": "Run restored",
      "workflow.status.otherApp": "Those run settings belong to another app",
      "workflow.value.allApps": "All apps",
      "workflow.value.historyOff": "Keeping runs is switched off in Mullion's settings. Click to switch it on.",
      "workflow.value.took": "took {time}",
      "workflow.unit.s": "s",
      "workflow.unit.min": "min",
    },
    ja: {
      "workflow.item.history": "実行履歴",
      "workflow.setting.historyEnabled": "実行履歴を保存する",
      "workflow.setting.historyMax": "履歴の最大保存数",
      "workflow.prop.historyEntries": "実行",
      "workflow.prop.historyApp": "アプリ",
      "workflow.vtype.runpreset": "実行設定",
      "workflow.field.summary": "概要",
      "workflow.vtype.historyentry": "実行履歴",
      "workflow.vtype.historyentries": "実行履歴",
      "workflow.vtype.historyrun": "実行 1 回",
      "workflow.field.app": "アプリ",
      "workflow.control.summaryline": "要約",
      "workflow.control.historylist": "履歴リスト",
      "workflow.section.history": "実行 ({n})",
      "workflow.action.loadRunPresetTitle": "保存した実行設定をこのアプリの実行設定に読み込む",
      "workflow.action.carryRun": "実行元アプリの実行設定へドラッグすると、この実行を復元します（設定・画像・出力）",
      "workflow.action.deleteRun": "この実行を履歴から削除",
      "workflow.action.clearHistory": "履歴をすべて削除",
      "workflow.prompt.clearHistory": "実行履歴 {n} 件をすべて削除しますか？",
      "workflow.prompt.clearAppHistory": "{app} の実行履歴 {n} 件をすべて削除しますか？",
      "workflow.port.restore": "この実行を復元",
      "workflow.status.restored": "実行を復元しました",
      "workflow.status.otherApp": "この実行設定は別のアプリのものです",
      "workflow.value.allApps": "すべてのアプリ",
      "workflow.value.historyOff": "実行履歴の保存がオフになっています（Mullion の設定）。クリックでオンにします。",
      "workflow.value.took": "所要 {time}",
      "workflow.unit.s": "秒",
      "workflow.unit.min": "分",
    },
  });
}
