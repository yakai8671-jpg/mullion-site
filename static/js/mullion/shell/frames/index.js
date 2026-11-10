import { connect } from "./deps.js";
import * as all from "./frames.js";

const { connectEvents, findPageElements, ...api } = all;

export default {
  setup(ctx) {
    connect({ server: ctx.use("server"), page: ctx.use("page"), apps: ctx.use("apps"), bays: ctx.use("bays"), items: ctx.use("items"), layout: ctx.use("layout"), hotkeys: ctx.use("hotkeys"), registry: ctx.use("registry"), view: ctx.use("view"), pickers: ctx.use("pickers"), i18n: ctx.use("i18n"), operations: ctx.use("operations"), library: ctx.use("library"), ports: ctx.use("ports") });
    findPageElements();
    connectEvents(ctx.emitter(), (module, event, fn) => ctx.on(module, event, fn));
    return { ...api };
  },
};
