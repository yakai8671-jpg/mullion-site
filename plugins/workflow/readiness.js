/* Readiness -- whether this app can actually run here.
 *
 * A template says what to run. Whether the machine it is pointed at can run
 * it is a different question, and one the template cannot answer: the graph
 * names nodes that may not be installed and models that may not be on disk.
 * Promptmanager never had to ask, because whoever ran a workflow was
 * whoever built it. An app that ships its workflow does have to ask.
 *
 * Two questions, and they are not the same:
 *
 *   a node the graph names is missing   the run will fail, and there is
 *                                       nothing in the app to fix it
 *   a model a setting names is missing  the run will fail, but the setting
 *                                       is right there to change
 *
 * So the first is an error and stops the run, and the second is a warning
 * and does not. Both are shown in one place -- with the template's own
 * problems, which to the person asking "does this work" are one question --
 * by the run settings' server row.
 *
 * What the server answers is cached here rather than in an item: it is the
 * server's state, not the app's, and two apps on one ComfyUI should not ask
 * twice. Nothing is saved -- what is installed changes, and a layout that
 * remembered otherwise would be wrong tomorrow.
 */

// The servers, as last answered. `names` is ComfyUI's class_types and
// `models` Ollama's; null while unasked.
const ENV = {
  comfyui: { state: "unknown", url: "", version: "", names: null, error: "" },
  ollama: { state: "unknown", url: "", models: null, error: "" },
};

// Choices for a node input -- the models a loader can load -- by
// "class_type::input_key": the list once it has arrived, "pending" while it
// is on its way, "failed" if it could not be had.
const CHOICES = new Map();

const sourceKey = (source) => `${source.class_type}::${source.input_key}`;

// The list for a source, or null while there is none to draw on. "failed"
// and an empty list both read as null: an input ComfyUI lists no choices
// for is not a choice, and neither is one it would not talk about.
export function choicesFor(source) {
  const found = source ? CHOICES.get(sourceKey(source)) : null;
  return Array.isArray(found) && found.length ? found : null;
}

// Ask for the ones not asked for yet. `onLoad` is called as each lands,
// because a body cannot wait for them.
export function wantChoices(api, sources, onLoad) {
  for (const source of sources) {
    if (!source || !source.class_type || !source.input_key) continue;
    const key = sourceKey(source);
    if (CHOICES.has(key)) continue;
    CHOICES.set(key, "pending");
    api.comfy
      .options(source.class_type, source.input_key)
      .then((answer) => CHOICES.set(key, answer.choices))
      .catch(() => CHOICES.set(key, "failed"))
      .finally(onLoad);
  }
}

// Ask the server what it is and what it has. Once per page, unless
// something asks again.
function wantEnvironment(api, platform, onLoad) {
  const env = ENV[platform];
  if (!env || env.state !== "unknown") return;
  env.state = "checking";
  env.error = "";
  if (platform === "ollama") {
    api.ollama
      .status()
      .then((info) => Object.assign(env, { state: "up", url: info.url, models: info.models || [] }))
      .catch((error) => Object.assign(env, { state: "down", error: error.message || String(error) }))
      .finally(onLoad);
    return;
  }
  api.comfy
    .status()
    .then((info) => {
      Object.assign(env, { state: "up", url: info.url, version: info.version || "" });
      // The node list is the slow half -- /object_info on a loaded install
      // -- so it is asked for only once the server has said it is there,
      // and the element says it is connected before it says it can run.
      //
      // Its own failure is not the server's: a ComfyUI that answers but
      // will not list its nodes is still there to run on, so the node check
      // is the only thing given up. "failed" rather than an empty list --
      // an empty list would read as "it has no nodes" and condemn the graph
      // for a question that was never answered.
      return api.comfy
        .nodes()
        .then((answer) => {
          env.names = answer.names || [];
        })
        .catch(() => {
          env.names = "failed";
        });
    })
    .catch((error) => Object.assign(env, { state: "down", error: error.message || String(error) }))
    .finally(onLoad);
}

// The models Ollama has, for a window offering one to choose -- the same
// answer the readiness rows check against, so the list and the warning can
// never disagree, and "check again" refreshes both. Empty until it lands.
export function ollamaModelsFor(api, onLoad) {
  wantEnvironment(api, "ollama", onLoad);
  return Array.isArray(ENV.ollama.models) ? ENV.ollama.models : [];
}

// Ask everything again: the server, and every choice list drawn from it.
// What the refresh button does.
export function invalidate(platform) {
  const env = ENV[platform];
  if (env) Object.assign(env, { state: "unknown", names: null, models: null, error: "" });
  CHOICES.clear();
}

// Each setting and fixed value that names something by name -- a
// checkpoint, a LoRA -- with where to ask what is installed. A template
// need not have said `options_source`: the node's class_type is in the
// graph, so the question can always be put together.
//
// `run` is what the run chooses that no template setting holds -- today the
// Ollama model, which is picked per run rather than opened up as a setting.
function namedValues(tpl, values, run = {}) {
  const graph = tpl.workflow.graph || {};
  const given = Array.isArray(values) ? values : [];
  const found = [];
  const add = (entry, value, label) => {
    if (typeof value !== "string" || !value) return;
    const node = graph[entry.node_id];
    if (!node || !node.class_type) return;
    found.push({
      value,
      label: label || entry.input_key,
      source: entry.options_source || { class_type: node.class_type, input_key: entry.input_key },
    });
  };
  // On Ollama there is one thing named by name -- the model -- and the
  // choices are the models it has. A system prompt is a string too, and
  // comparing it against that list said it was not installed.
  const onlyModel = tpl.workflow.platform === "ollama";
  for (const setting of tpl.settings) {
    if (onlyModel && setting.input_key !== "model") continue;
    const held = given.find((one) => one.id === `${setting.node_id}::${setting.input_key}`);
    add(setting, held ? held.value : setting.default, setting.label);
  }
  // Pinned values are the ones worth checking most: they have no editor to
  // put right, so a missing one is invisible until the run fails.
  for (const entry of tpl.fixed) {
    if (onlyModel && entry.input_key !== "model") continue;
    add(entry, entry.value, "");
  }
  // A model neither opened up nor pinned is still asked for: it is the one
  // in the graph, or the one this run chose instead. Without this row an
  // Ollama step whose model is chosen per run was never checked at all.
  if (onlyModel && !found.length) {
    const node = (tpl.workflow.graph || {}).ollama_generate;
    const chosen = typeof run.ollamaModel === "string" && run.ollamaModel.trim();
    if (node && node.inputs) {
      add({ node_id: "ollama_generate", input_key: "model" }, chosen || node.inputs.model, bound.t("workflow.prop.ollamaModel"));
    }
  }
  return found;
}

// What the answers below are read with: the shell's translation table, and
// the template value type. Both are the workflow plugin's, and are set when
// it registers -- so `readinessOf` is a plain function any plugin that
// requires `workflow` can import, rather than something only the plugin
// that registered it can reach.
let bound = null;


// Everything known about one app's chances, worked out from the caches
// above -- synchronously, because a body cannot await. What is missing is
// asked for on the way, and `onLoad` redraws when it arrives.
//
// The answer is one check per question rather than one verdict: "cannot
// run" is not a thing to read, it is three things -- is the server there,
// does it have the nodes, does it have the models -- and which of them
// failed is the only part worth acting on. Each says its state in a word
// and keeps the names behind a hint, because a list of eleven checkpoints
// is not what is wanted from a glance.
//
// `errors` is what stops a run, gathered across the checks: the template's
// own problems, and a node the server does not have. A missing model is a
// warning and is not in it -- the setting is right there to change.
// One value or a list of them. An app that runs a chain -- a tagger on
// ComfyUI and then a model on Ollama -- is only ready when both servers
// are, so both are asked and the rows say which server each one is about.
export function readinessOf(api, value, values, onLoad, run = {}) {
  const { coerceTemplate } = bound;
  const all = (Array.isArray(value) ? value : [value])
    .map((one) => coerceTemplate(one))
    .filter((one) => one.tool && Object.keys(one.workflow.graph || {}).length);
  if (all.length > 1) return mergedReadiness(api, all, values, onLoad, run);
  return oneReadiness(api, all[0] || coerceTemplate(value), values, onLoad, run);
}

// Every template's checks in one list, named by the server they are about
// where more than one server is involved.
function mergedReadiness(api, templates, values, onLoad, run) {
  const { t } = bound;
  const parts = templates.map((one) => oneReadiness(api, one, values, onLoad, run));
  const platforms = new Set(templates.map((one) => one.workflow.platform));
  const checks = [];
  const seen = new Set();
  parts.forEach((part, index) => {
    const server = t(`workflow.platform.${templates[index].workflow.platform}`);
    for (const check of part.checks) {
      const key = platforms.size > 1 ? `${check.key}:${templates[index].workflow.platform}` : check.key;
      // Two steps on one server ask the same questions; the answers are the
      // same too, so the row is written once.
      if (seen.has(key)) continue;
      seen.add(key);
      checks.push({ ...check, key, label: platforms.size > 1 ? `${server} · ${check.label}` : check.label });
    }
  });
  return {
    checks,
    errors: parts.flatMap((part) => part.errors),
    platform: templates[0] ? templates[0].workflow.platform : "comfyui",
    platforms: [...platforms],
    refresh: () => {
      for (const platform of platforms) invalidate(platform);
      onLoad();
    },
  };
}

function oneReadiness(api, tpl, values, onLoad, run = {}) {
  const { t, problemsOf } = bound;
  const platform = tpl.workflow.platform;
  const env = ENV[platform] || ENV.comfyui;
  const onComfy = platform === "comfyui";

  wantEnvironment(api, platform, onLoad);
  const named = namedValues(tpl, values, run);
  if (onComfy && env.state === "up") {
    wantChoices(
      api,
      named.map((one) => one.source),
      onLoad
    );
  }

  const checks = [];
  const errors = [];
  const add = (key, state, summary, detail = "") =>
    checks.push({ key, label: t(`workflow.ready.check.${key}`), state, summary, detail });

  // ---- the template itself ----
  // Only when there is something to put right. These rows are about the
  // server: in an app whose workflow ships with it there is no template to
  // speak of, and "template: nothing wrong" was a line about a thing whoever
  // is using it has never heard of. It still stops the run, and it still
  // says why when there is a why.
  const problems = problemsOf(tpl);
  if (problems.length) {
    errors.push(...problems);
    add("template", "error", t("workflow.ready.template.problems", { n: problems.length }), problems.join("\n"));
  }

  // ---- the server ----
  add(
    "server",
    env.state === "up" ? "ok" : env.state === "down" ? "error" : "checking",
    env.state === "up"
      ? t("workflow.ready.server.up")
      : env.state === "down"
        ? t("workflow.ready.server.down")
        : t("workflow.ready.asking"),
    env.state === "up"
      ? onComfy
        ? t("workflow.run.comfyOk", { url: env.url, version: env.version || "?" })
        : t("workflow.run.ollamaOk", { url: env.url, n: (env.models || []).length })
      : env.error
  );

  // ---- the nodes the graph names ----
  // ComfyUI's question alone: an Ollama workflow is one node, and it is the
  // node Ollama is.
  if (onComfy) {
    const wanted = [
      ...new Set(
        Object.values(tpl.workflow.graph || {})
          .map((node) => node.class_type)
          .filter(Boolean)
      ),
    ];
    if (env.state !== "up" || env.names === null) {
      add("nodes", "checking", t("workflow.ready.asking"));
    } else if (env.names === "failed") {
      // Not asked and answered no: the check is given up, not failed.
      add("nodes", "warn", t("workflow.ready.nodes.unknown"), t("workflow.ready.noNodeList"));
    } else {
      const installed = new Set(env.names);
      const missing = wanted.filter((name) => !installed.has(name));
      if (missing.length) {
        errors.push(t("workflow.ready.missingNodes", { nodes: missing.join(", ") }));
        add("nodes", "error", t("workflow.ready.nodes.missing", { n: missing.length }), missing.join("\n"));
      } else {
        // The names, even when they are all there: what a hint is for is
        // "which ones did you check", and that question is asked of a row
        // that passed as often as of one that did not.
        add("nodes", "ok", t("workflow.ready.nodes.ok", { n: wanted.length }), wanted.join("\n"));
      }
    }
  }

  // ---- the models the settings name ----
  // Only where there are any: a workflow that names nothing by name has
  // nothing to check, and a row saying so would be a row about nothing.
  if (named.length) {
    const asking =
      env.state !== "up" ||
      named.some((one) => CHOICES.get(sourceKey(one.source)) === "pending");
    const missing = [];
    if (env.state === "up") {
      for (const one of named) {
        const choices = onComfy ? choicesFor(one.source) : env.models;
        if (!choices || !choices.length) continue;
        if (!choices.includes(one.value)) missing.push({ ...one });
      }
    }
    const listed = (which) =>
      which.map((one) => t("workflow.ready.missingModel", { label: one.label, value: one.value })).join("\n");
    if (asking) add("models", "checking", t("workflow.ready.asking"));
    else if (missing.length)
      add("models", "warn", t("workflow.ready.models.missing", { n: missing.length }), listed(missing));
    else add("models", "ok", t("workflow.ready.models.ok", { n: named.length }), listed(named));
  }

  return {
    checks,
    errors,
    platform,
    platforms: [platform],
    refresh: () => {
      invalidate(platform);
      onLoad();
    },
  };
}

// What stops a run, for the runner to ask before it starts one -- the same
// list the element shows, so the button and the element cannot disagree
// about whether this works.
// What a run's servers are, as the rows pinned to the window's bar: one for
// each server involved, with the checks that are about it (the connection,
// then the nodes and models a graph asked for) and the way to ask again. The
// checks of a run on more than one server are named by it ("server:ollama").
//
// `probe(onLoad)` is the question put again, for the detail of a row -- a
// screen that is drawn while the app's own body is not.
export function serverRows(NODES, ready, probe) {
  const platforms = ready.platforms || [ready.platform];
  return platforms.map((platform) =>
    NODES.control(`server-${platform}`, {
      control: "services.state",
      service: platform,
      probe: (onLoad) => {
        const now = probe(onLoad);
        const mine = now.checks.filter((check) => {
          const at = check.key.split(":")[1];
          return at ? at === platform : platforms.length === 1;
        });
        return {
          checks: platforms.length > 1 ? mine.map((check) => ({ ...check, label: check.label.split(" · ").pop() })) : mine,
          refresh: now.refresh,
        };
      },
    })
  );
}

export const blockersOf = (api, value, values, onLoad) =>
  readinessOf(api, value, values, onLoad).errors;

export function registerReadiness(fw, template) {
  const { core } = fw;
  const { t } = core;
  bound = { t, ...template };

  fw.registerTranslations({
    en: {
      "workflow.ready.check.template": "Template",
      "workflow.ready.check.server": "Connection",
      "workflow.ready.check.nodes": "Nodes",
      "workflow.ready.check.models": "Models",
      "workflow.ready.template.problems": "{n} to put right",
      "workflow.ready.server.up": "Connected",
      "workflow.ready.server.down": "Cannot be reached",
      "workflow.ready.nodes.ok": "All {n} are installed",
      "workflow.ready.nodes.missing": "{n} not installed",
      "workflow.ready.nodes.unknown": "Could not be checked",
      "workflow.ready.models.ok": "All {n} are installed",
      "workflow.ready.models.missing": "{n} not installed",
      "workflow.ready.asking": "Checking...",
      "workflow.ready.noNodeList": "The server would not say which nodes it has.",
      "workflow.ready.missingNodes": "This ComfyUI does not have: {nodes}",
      "workflow.ready.missingModel": "“{label}” asks for {value}",
    },
    ja: {
      "workflow.ready.check.template": "テンプレート",
      "workflow.ready.check.server": "接続",
      "workflow.ready.check.nodes": "ノード",
      "workflow.ready.check.models": "モデル",
      "workflow.ready.template.problems": "{n} 件の未設定",
      "workflow.ready.server.up": "接続済み",
      "workflow.ready.server.down": "接続できません",
      "workflow.ready.nodes.ok": "{n} 件すべてあります",
      "workflow.ready.nodes.missing": "{n} 件がありません",
      "workflow.ready.nodes.unknown": "確認できませんでした",
      "workflow.ready.models.ok": "{n} 件すべてあります",
      "workflow.ready.models.missing": "{n} 件がありません",
      "workflow.ready.asking": "確認中…",
      "workflow.ready.noNodeList": "サーバーがノード一覧を返しませんでした。",
      "workflow.ready.missingNodes": "このComfyUIに無いノード: {nodes}",
      "workflow.ready.missingModel": "「{label}」が指定する {value}",
    },
  });

  return { readinessOf, blockersOf, invalidate, serverRows };
}
