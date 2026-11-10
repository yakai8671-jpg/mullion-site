/* The five screens of reddi2ch, drawn: the app (what it works with, and its windows), the board, the thread, how it
 * reads (the view) and the settings of this machine. Each is an item's body, given what it shows (`report`, from the
 * derived values of scripts.js) and doing what it does through the item's actions. */
import { APP, MODELS, REDDIT, appSetting, askSession, modelsFor, services, sessionText, setAppSetting, tr } from "./state.js";

export function createScreens(fw, tables) {
  const { core, describe } = fw;
  const { NODES } = core;
  const { APP_SETTINGS, APP_SETTING_SECTIONS, VIEW_SETTINGS, VIEW_SECTIONS } = tables;

  // A value of the item's own, as a row: read from the item, written back to it.
  const own = (s, specs, key, extra = {}) =>
    describe(
      { ...specs[key], ...extra, read: () => s.read(key), write: (_api, value) => s.set(key, value) },
      { api: s.api, key: `${s.item.id}-${key}`, label: tr(specs[key].label) }
    );

  // ---- the app: what it works with, and its windows ------------------------------------------
  const app = {
    body(s) {
      const p = s.props;
      const facts = Array.isArray(p.facts) ? p.facts : [];
      const tiles = Array.isArray(p.tiles) ? p.tiles : [];
      const run = (tile) => () => {
        if (tile.key === "view") return s.run("openview");
        if (tile.key === "settings") return s.run("opensettings");
        return s.run("show", { key: tile.key });
      };
      return [
        NODES.section("state", tr("reddi2ch.section.state"), [
          NODES.card(
            "state-content",
            "",
            [NODES.props("facts", facts.map((one) => describe({ type: "string", read: () => one.value, readonly: true }, { api: s.api, key: `${s.item.id}-${one.key}`, label: one.label })))],
            [{ key: "again", icon: "arrow-clockwise", title: tr("reddi2ch.action.checkAgain"), run: () => s.run("again") }]
          ),
        ]),
        NODES.section("windows", tr("reddi2ch.section.windows"), [NODES.gallery("windows", tiles.map((tile) => ({ ...tile, run: run(tile) })), "rows")]),
      ];
    },
  };

  // ---- the board: the subject list of a subreddit ----------------------------------------------
  const BOARD_SPECS = {
    subreddit: { label: "reddi2ch.prop.subreddit", type: "string" },
    sort: { label: "reddi2ch.prop.sort", type: "enum", options: ["hot", "new", "top", "rising"].map((value) => ({ value, label: `reddi2ch.sort.${value}` })), control: "segments", labels: "all" },
    span: { label: "reddi2ch.prop.span", type: "enum", options: ["day", "week", "month", "year", "all"].map((value) => ({ value, label: `reddi2ch.span.${value}` })), control: "segments", labels: "all" },
  };
  const board = {
    body(s) {
      const report = s.props.report || {};
      const row = (key) => own(s, BOARD_SPECS, key);
      return [
        NODES.section("board", report.heading || tr("reddi2ch.section.board"), [
          NODES.card(
            "board-content",
            "",
            [
              NODES.props("where", [row("subreddit"), row("sort")]),
              ...(report.sort === "top" ? [NODES.props("span", [row("span")])] : []),
              ...(report.status ? [NODES.props("notes", [core.row("status", tr("reddi2ch.field.status"), report.status)])] : []),
              NODES.control("list", {
                control: "reddi2ch.board",
                list: report.list || null,
                loading: report.loading || "",
                error: report.error || "",
                current: report.current || "",
                onOpen: (permalink) => s.run("open", { permalink }),
              }),
              ...(report.hasMore ? [NODES.actions("more", [{ key: "more", label: tr("reddi2ch.action.more"), icon: "chevron-double-down", run: () => s.run("more") }])] : []),
            ],
            [
              {
                key: "translate",
                icon: "translate",
                title: tr(report.translating ? "reddi2ch.action.showOriginalTitles" : "reddi2ch.action.translateTitles"),
                active: Boolean(report.translating),
                run: () => s.run("translate"),
              },
              { key: "reload", icon: "arrow-clockwise", title: tr("reddi2ch.action.reload"), run: () => s.run("reload") },
            ]
          ),
        ]),
      ];
    },
  };

  // ---- the thread: one flat run of posts --------------------------------------------------------
  const thread = {
    body(s) {
      const report = s.props.report || {};
      return [
        NODES.section("thread", report.heading || tr("reddi2ch.section.thread"), [
          NODES.card(
            "thread-content",
            "",
            [
              ...(report.notes ? [NODES.props("notes", [core.row("status", tr("reddi2ch.field.status"), report.notes)])] : []),
              ...(report.canRetry ? [NODES.actions("retry", [{ key: "retry", label: tr("reddi2ch.action.retryTranslate"), run: () => s.run("retry") }])] : []),
              NODES.control("page", {
                control: "reddi2ch.thread",
                thread: report.thread || null,
                loading: report.loading || "",
                error: report.error || "",
                empty: tr("reddi2ch.value.pickThread"),
                onOpen: (path) => s.run("setcurrent", { path }),
              }),
            ],
            [
              {
                key: "translate",
                icon: "translate",
                title: tr(report.translating ? "reddi2ch.action.showOriginal" : "reddi2ch.action.translate"),
                active: Boolean(report.translating),
                run: () => s.run("translate"),
              },
              { key: "reload", icon: "arrow-clockwise", title: tr("reddi2ch.action.reload"), run: () => s.run("reload") },
              {
                key: "source",
                icon: "box-arrow-up-right",
                title: tr("reddi2ch.action.openReddit"),
                run: () => report.permalink && typeof window !== "undefined" && window.open?.(`${REDDIT}${report.permalink}`, "_blank", "noopener,noreferrer"),
              },
            ]
          ),
        ]),
      ];
    },
  };

  // ---- how it reads: the view settings, kept on the item ------------------------------------------
  const view = {
    body(s) {
      return VIEW_SECTIONS.map(([section, keys]) =>
        NODES.section(section, tr(`reddi2ch.section.${section}`), [NODES.props(section, keys.filter((key) => key !== "minScore" || s.props.useMinScore).map((key) => own(s, VIEW_SETTINGS, key)))])
      );
    },
  };

  // ---- the settings of this machine: kept per type -----------------------------------------------
  const settings = {
    body(s) {
      const api = s.api;
      const state = services(api);
      modelsFor(api);
      const field = (key) =>
        describe(
          {
            ...APP_SETTINGS[key],
            read: () => appSetting(key),
            write: (_api, value) => {
              setAppSetting(key, value);
              if (key === "redditCookie") askSession(api);
            },
          },
          { api, key: `${s.item.id}-${key}`, label: tr(APP_SETTINGS[key].label) }
        );
      return APP_SETTING_SECTIONS.map(([section, keys]) =>
        NODES.section(
          section,
          tr(`reddi2ch.section.${section}`),
          [
            NODES.card(
              `${section}-content`,
              "",
              [
                NODES.props(section, keys.map(field)),
                ...(section === "reddit" && state.session ? [NODES.props("session", [core.row("session", tr("reddi2ch.field.session"), sessionText(state.session))])] : []),
              ],
              [...(section === "translate" && !MODELS.length ? [NODES.warning(tr("reddi2ch.status.noModel"))] : [])]
            ),
          ],
          section === "reddit" ? { hint: tr("reddi2ch.hint.cookie") } : {}
        )
      );
    },
  };

  return {
    "reddi2ch.app": app,
    "reddi2ch.board": board,
    "reddi2ch.thread": thread,
    "reddi2ch.view": view,
    "reddi2ch.settings": settings,
  };
}
