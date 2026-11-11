import { connect } from "./deps.js";
import * as all from "./view.js";
import * as overlay from "./overlay.js";
import * as pagesettings from "./pagesettings.js";
import * as problempage from "./problempage.js";
import * as chrome from "./chrome.js";
import * as nodekinds from "./nodekinds.js";
import * as descriptors from "./descriptors.js";
import meta from "./module.json" with { type: "json" };

const { connectEvents, registerWithOthers, ...api } = all;

export default {
  setup(ctx) {
    connect({ preload: ctx.use("preload"), values: ctx.use("values"), page: ctx.use("page"), server: ctx.use("server"), registry: ctx.use("registry"),
      items: ctx.use("items"),
      ports: ctx.use("ports"),
      build: ctx.use("build"),
      layout: ctx.use("layout"),
      i18n: ctx.use("i18n"),
    });
    connectEvents(ctx.emitter(), (module, event, fn) => ctx.on(module, event, fn));
    registerWithOthers();
    // A server that cannot open its data: its own page says why.
    ctx.fill("server.problem", () => api.reloadPage());
    // The profile changed, here or in another tab: the theme follows.
    ctx.on("server", "change", () => pagesettings.applyTheme());
    // What other modules and plugins use (module.json api); the rest of the files is view's own.
    const every = { ...api, ...nodekinds, ...descriptors, ...overlay, ...pagesettings, ...problempage, ...chrome };
    return Object.fromEntries(meta.api.map((name) => [name, every[name]]));
  },
};
