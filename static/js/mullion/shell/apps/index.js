import { connect } from "./deps.js";
import * as main from "./apps.js";
import * as launch from "./launch.js";
import * as links from "./links.js";
import meta from "./module.json" with { type: "json" };

const all = { ...main, ...launch, ...links };
const { connectEvents } = all;
// What other modules and plugins use (module.json api); the rest of apps.js is its own.
const api = Object.fromEntries(meta.api.map((name) => [name, all[name]]));

export default {
  setup(ctx) {
    connect({ values: ctx.use("values"), server: ctx.use("server"), layout: ctx.use("layout"), items: ctx.use("items"), ports: ctx.use("ports"), bays: ctx.use("bays"), registry: ctx.use("registry"), library: ctx.use("library"), i18n: ctx.use("i18n") });
    connectEvents(ctx.emitter());
    // A window with nothing of its own left shows what its group would (layout.repairPaths).
    ctx.fill("layout.defaultLeafBeside", all.defaultLeafBeside);
    return { ...api };
  },
};
