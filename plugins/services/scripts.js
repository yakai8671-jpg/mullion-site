/* Connected Software (services) scripts
 *
 * What the declarations (items/*.json) cannot say: the values read from what the server last said of the
 * programs (`derived`), start and stop (`actions`), and the three controls that draw the settings rows, the
 * checklist and the watching (`controls`). The state row other apps place (services.state) is here too.
 */
import { act, canRead, entryOf, load, replace, stateOf, store, subscribe, wake, fail } from "./store.js";

const LAUNCH_KEYS = ["command", "args", "cwd"];
const SAVE_DELAY_MS = 600;
const DRAFTS = new Map();

const isServer = (check) => check.key === "server" || check.key.startsWith("server:");
const keyOf = (host, id) => `${host}:${id}`;

function viewOf(id, hostKey, onLoad, t) {
  const entry = entryOf(id);
  if (!entry) return null;
  const state = stateOf(entry);
  const error = store.errors.get(id);
  const asked = store.providers.get(hostKey);
  const found = asked ? asked(onLoad) : null;
  const theirs = found ? found.checks : [];

  const rows = [];
  const owner = entry.managed ? t("services.value.managed", { pid: entry.pid || "?" }) : entry.pid ? t("services.value.external", { pid: entry.pid }) : "";
  rows.push({
    key: "software",
    label: t("services.check.software"),
    state: error ? "error" : state === "running" ? "ok" : state === "starting" || state === "stopping" ? "checking" : "error",
    summary: error || t(`services.value.${state}`) + (state === "running" && entry.version ? `  ${entry.version}` : ""),
    detail: [owner, entry.url].filter(Boolean).join("\n"),
  });
  if (!error && state === "running") {
    const own = theirs.find(isServer);
    rows.push(
      own
        ? { ...own, key: "connection", label: t("services.check.connection") }
        : { key: "connection", label: t("services.check.connection"), state: "ok", summary: t("services.value.connected"), detail: entry.url }
    );
    rows.push(...theirs.filter((check) => !isServer(check)));
  }

  const problems = rows.filter((row) => row.state === "error" || row.state === "warn").length;
  const checking = rows.some((row) => row.state === "checking");
  const lamp = rows.some((row) => row.state === "error")
    ? "failed"
    : rows.some((row) => row.state === "warn")
      ? "warn"
      : checking
        ? "starting"
        : "running";
  return {
    entry,
    rows,
    problems,
    lamp,
    summary: problems ? t("services.summary.problems", { n: problems }) : checking ? t("services.summary.checking") : t("services.summary.ready"),
    refresh: found && found.refresh ? found.refresh : null,
  };
}

function noteRunning(holder, view) {
  if (!view) return;
  if (holder.__running !== undefined && holder.__running !== view.entry.running && view.refresh) setTimeout(view.refresh, 0);
  holder.__running = view.entry.running;
}

const LAMPS = { running: "ok", warn: "warn", starting: "checking", stopping: "checking", failed: "failed", unknown: "idle" };

function clearProvider(host) {
  if (host.__provider && store.providers.get(host.__provider.key) === host.__provider.probe) store.providers.delete(host.__provider.key);
  host.__provider = null;
}

// The state row (services.state), placed by other apps.
function paint(host, api) {
  const desc = host.__desc;
  if (!desc) return;
  const id = desc.params?.service;
  clearProvider(host);
  const core = api?.core || desc.api?.core;
  const t = (k, vars) => (core?.t ? core.t(k, vars) : k);
  if (!canRead(desc.api)) {
    core?.paintStatusRow?.(host, { name: id, text: t("services.value.unavailable"), lamp: "idle" });
    return;
  }
  host.dataset.service = id;
  const hostKey = keyOf(desc.item ? desc.item.id : "", id);
  if (desc.params?.probe) {
    store.providers.set(hostKey, desc.params.probe);
    host.__provider = { key: hostKey, probe: desc.params.probe };
  }

  const view = viewOf(id, hostKey, () => paint(host, api), t);
  if (!view) {
    core?.paintStatusRow?.(host, { name: id, text: t(store.list ? "services.value.unknownService" : "services.value.unknown"), lamp: "idle" });
    return;
  }
  noteRunning(host, view);
  const saying = core?.runText ? core.runText(desc.item ? desc.item.id : "", id) : "";
  core?.paintStatusRow?.(host, {
    name: view.entry.label,
    text: saying || view.summary,
    lamp: saying ? "checking" : LAMPS[view.lamp] || "idle",
    error: !saying && view.lamp === "failed",
    moreTitle: t("services.action.details"),
    onMore: () => {
      const now = host.__desc;
      if (now?.api?.services?.openDetail) now.api.services.openDetail(now.params?.service, now.item ? now.item.id : "");
    },
  });
}

// ---- the values the screens read -----------------------------------------------
// One program as its card needs it: its name, and the button that starts or stops it with the words on it now.
function recordOf(entry, t, { detail = false } = {}) {
  const state = stateOf(entry);
  const working = store.working.get(entry.id);
  const record = { id: entry.id, label: entry.label, icon: entry.icon || "plug", known: true };
  if (working) {
    return { ...record, runLabel: t(`services.action.${working === "stop" ? "stopping" : "starting"}`), runIcon: "hourglass-split", runTitle: "", runDisabled: true };
  }
  if (entry.running) {
    return { ...record, runLabel: t("services.action.stop"), runIcon: "stop-fill", runTitle: t("services.action.stopTitle", { name: entry.label }), runDisabled: false };
  }
  return {
    ...record,
    runLabel: t(!detail && state === "starting" ? "services.action.starting" : "services.action.start"),
    runIcon: "play-fill",
    runTitle: entry.canStart ? t("services.action.startTitle", { name: entry.label }) : t("services.warning.noProgram"),
    runDisabled: !entry.canStart || state === "starting",
  };
}

export const derived = {
  // Every program the server knows, as cards.
  "services.entries": (api, _item, { t }) => (canRead(api) ? (store.list || []).map((entry) => recordOf(entry, t)) : []),
  // The program a detail screen is about.
  "services.entry": (api, _item, { t, read }) => {
    const id = String(read("service") || "");
    const entry = canRead(api) ? entryOf(id) : null;
    return entry
      ? recordOf(entry, t, { detail: true })
      : { id, label: id, icon: "plug", known: false, runLabel: "", runIcon: "play-fill", runTitle: "", runDisabled: true };
  },
};

// ---- what it does ----------------------------------------------------------------
export const actions = {
  // Stop it if it runs (asking first about what was not started from here), start it if it does not.
  "services.toggle": {
    async run({ id }, { api, status, confirm, t }) {
      const entry = entryOf(id);
      if (!entry) return {};
      const kind = entry.running ? "stop" : "start";
      try {
        const fresh = await act(api, entry, kind, (one) =>
          confirm("services.confirm.stopBody", { name: one.label, pid: one.pid || "?" }, { title: "services.action.stop", okText: t("services.confirm.stopOk"), danger: true })
        );
        if (!fresh) return {};
        status(kind === "start" ? "services.status.started" : fresh.running ? "services.status.stillRunning" : "services.status.stopped", { name: entry.label });
      } catch (error) {
        // `act` has put the failure on the program's row; this is the window's line.
        status("services.status.failed", { error: error.message || String(error) });
      }
      return {};
    },
  },
  // Ask again: the server, and the questions the asking item registered for the program.
  "services.check": {
    async run({ id, host }, { api, t }) {
      const view = id ? viewOf(id, keyOf(host, id), () => {}, t) : null;
      if (view?.refresh) view.refresh();
      await load(api);
      return {};
    },
  },
};

// ---- the controls ---------------------------------------------------------------
// A field typed into: shown at once, sent when the typing stops.
function draft(api, entry, key, value) {
  const id = `${entry.id}.${key}`;
  const held = DRAFTS.get(id);
  if (held) clearTimeout(held.timer);
  entry[key] = value;
  const timer = setTimeout(() => {
    DRAFTS.delete(id);
    api.services
      .configure(entry.id, { [key]: value })
      .then((fresh) => {
        // What is still being typed in another field is not overwritten.
        for (const other of LAUNCH_KEYS) if (DRAFTS.has(`${entry.id}.${other}`)) fresh[other] = entry[other];
        replace(fresh);
        wake();
      })
      .catch((error) => fail(entry.id, error));
  }, SAVE_DELAY_MS);
  DRAFTS.set(id, { value, timer });
}

function toggleLog(api, entry) {
  if (store.logs.has(entry.id)) {
    store.logs.delete(entry.id);
    wake();
    return;
  }
  store.logs.set(entry.id, "");
  wake();
  api.services
    .log(entry.id)
    .then((text) => {
      if (store.logs.has(entry.id)) store.logs.set(entry.id, text);
    })
    .catch(() => {})
    .finally(wake);
}

// What changes what the screens show, as one line: when it is the same as last time nothing is drawn.
const signature = () => JSON.stringify([store.list, [...store.working], [...store.errors], [...store.logs]]);

export const controls = {
  "services.state": (api) => ({
    mount(host, desc) {
      host.__desc = desc;
      host.__stop = subscribe(desc.api, () => paint(host, api));
      const core = api?.core || desc.api?.core;
      host.__stopSaying = core?.onRunText?.((itemId, service) => {
        const now = host.__desc;
        if (now && now.item && now.item.id === itemId && now.params?.service === service) paint(host, api);
      });
      paint(host, api);
    },
    update(host, desc) {
      const previousApi = host.__desc?.api;
      host.__desc = desc;
      if (previousApi !== desc.api) {
        if (host.__stop) host.__stop();
        host.__stop = subscribe(desc.api, () => paint(host, api));
        host.__running = undefined;
      }
      paint(host, api);
    },
    unmount(host) {
      if (host.__stop) host.__stop();
      host.__stop = null;
      if (host.__stopSaying) host.__stopSaying();
      host.__stopSaying = null;
      host.__desc = null;
    },
  }),

  // Nothing to see: it asks the server while the screen is there, and has the screen drawn again when the
  // answer is not what was drawn.
  "services.watch": (api) => ({
    mount(host, desc) {
      host.hidden = true;
      let drawn = signature();
      host.__stop = subscribe(desc.api, () => {
        const now = signature();
        if (now === drawn) return;
        drawn = now;
        api.core.refreshAll();
      });
    },
    update() {},
    unmount(host) {
      if (host.__stop) host.__stop();
      host.__stop = null;
    },
  }),
};

// ---- the screens -------------------------------------------------------------------------------
// What is in them is what the server says of each program right now, so they are drawn here.
const RUNNING = new Map(); // detail item id -> whether its program ran when it was last drawn

// The rows of one program's card: how it is found and started (typed, sent after a pause), and its output.
function rowNodes(fw, hostApi, id) {
  const { NODES, row, t } = fw.core;
  const { describe } = fw;
  const entry = entryOf(String(id || ""));
  if (!entry || !canRead(hostApi)) return [];
  const state = stateOf(entry);
  // `type`: "filepath" for what is a place (the program, the folder to start in), so a path from the
  // File Manager can be pasted or linked in.
  const text = (key, labelKey, type = "string") =>
    describe(
      { type, read: () => entry[key] || "", write: (_api, value) => draft(hostApi, entry, key, String(value)) },
      { api: hostApi, key: `${entry.id}-${key}`, label: t(labelKey) }
    );
  // Where it answers is the profile's, not this window's: the relays and the apps that use the program
  // read the same key.
  const address = describe(
    {
      type: "string",
      read: () => hostApi.app.get(entry.urlKey) || entry.url || "",
      write: (_api, value) => {
        hostApi.app.set(entry.urlKey, String(value).trim());
        wake();
      },
    },
    { api: hostApi, key: `${entry.id}-url`, label: t("services.field.url") }
  );
  // What would be started when nothing is typed is the program found on this PC, so it is what an empty
  // field shows.
  const command = text("command", "services.field.command", "filepath");
  command.params.placeholder = (entry.detected && entry.detected.command) || t("services.hint.command");
  const args = text("args", "services.field.args");
  if (entry.detected && !entry.command) args.params.placeholder = entry.detected.args || "";
  const cwd = text("cwd", "services.field.cwd", "filepath");
  cwd.params.placeholder = t("services.hint.cwd");

  const failure = store.errors.get(entry.id);
  const statusText =
    failure ||
    t(`services.value.${state}`) +
      (entry.running && entry.version ? `  ${entry.version}` : "") +
      (entry.pid && entry.running ? `  (${t(entry.managed ? "services.value.managed" : "services.value.external", { pid: entry.pid })})` : "");

  const nodes = [NODES.props(`rows-${entry.id}`, [row("status", t("services.field.status"), statusText), address, command, args, cwd])];
  if (entry.hasLog || store.logs.has(entry.id)) {
    nodes.push(
      NODES.actions(`log-tools-${entry.id}`, [
        { key: `log-${entry.id}`, label: t("services.action.log"), title: t("services.action.logTitle"), run: () => toggleLog(hostApi, entry) },
      ])
    );
    if (store.logs.has(entry.id)) {
      nodes.push(
        NODES.control(`log-${entry.id}`, {
          control: "texteditor",
          desc: describe(
            { type: "string", readonly: true, read: () => store.logs.get(entry.id) || "", write: () => {} },
            { api: hostApi, key: `${entry.id}-log`, label: t("services.action.log") }
          ),
          placeholder: t("services.log.empty"),
        })
      );
    }
  }
  return nodes;
}

// A program's card: its start/stop button leads the header, `tools` after it, `children` in it.
function programCard(fw, record, run, tools, children) {
  const { NODES } = fw.core;
  const lead = record.known === false
    ? []
    : [{ key: "run", primary: true, label: record.runLabel, title: record.runTitle, icon: record.runIcon, disabled: record.runDisabled, run }];
  return NODES.card(`svc-${record.id}`, record.label, children, [...lead, ...tools], { icon: record.icon });
}

export const screens = {
  // Every program: one card each, with the rows it is found and started by.
  "services.manager": (fw) => {
    const { NODES, t } = fw.core;
    return {
      body(screen) {
        const api = screen.api;
        const records = canRead(api) ? (store.list || []).map((entry) => recordOf(entry, t)) : [];
        const cards = records.map((record) => programCard(fw, record, () => screen.run("run", { id: record.id }), [], rowNodes(fw, api, record.id)));
        return [
          NODES.section("all", t("services.section.all"), [
            NODES.card("programs", "", [NODES.control("watch", { control: "services.watch" }), ...cards], [
              { key: "check", label: t("services.action.check"), title: t("services.action.check"), icon: "arrow-clockwise", run: () => screen.run("check") },
            ]),
          ]),
        ];
      },
    };
  },

  // One program, as an asking item pins it: its card with the checklist in full.
  "services.detail": (fw) => {
    const { NODES, t } = fw.core;
    return {
      body(screen) {
        const api = screen.api;
        const id = String(screen.read("service") || "");
        const entry = canRead(api) ? entryOf(id) : null;
        const record = entry ? recordOf(entry, t, { detail: true }) : { id, label: id, icon: "plug", known: false };
        const view = canRead(api) ? viewOf(id, keyOf(screen.read("host") || "", id), () => fw.core.refreshAll(), t) : null;
        // The program started or stopped since the last draw: what the asking item checks is asked again.
        if (view) {
          const was = RUNNING.get(screen.item.id);
          if (was !== undefined && was !== view.entry.running && view.refresh) setTimeout(view.refresh, 0);
          RUNNING.set(screen.item.id, view.entry.running);
        }
        const checks = view
          ? [NODES.control("checks", { control: "checklist", checks: view.rows })]
          : [NODES.card("none", "", [], [], { empty: t(store.list ? "services.value.unknownService" : "services.value.unknown") })];
        return [
          programCard(
            fw,
            record,
            () => screen.run("run"),
            [{ key: "refresh", label: t("services.action.check"), title: t("services.action.check"), icon: "arrow-clockwise", run: () => screen.run("check") }],
            [NODES.control("watch", { control: "services.watch" }), ...checks]
          ),
        ];
      },
    };
  },
};

