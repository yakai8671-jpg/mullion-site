import { connect } from "./deps.js";
import * as all from "./mount.js";

const { connectEvents, ...api } = all;

export default {
  setup(ctx) {
    connect({ page: ctx.use("page"), registry: ctx.use("registry"), items: ctx.use("items"), view: ctx.use("view"), layout: ctx.use("layout"), pickers: ctx.use("pickers"), apps: ctx.use("apps"), frames: ctx.use("frames"), ports: ctx.use("ports"), operations: ctx.use("operations"), bays: ctx.use("bays"), hotkeys: ctx.use("hotkeys"), i18n: ctx.use("i18n") });
    connectEvents(ctx.emitter(), (module, event, fn) => ctx.on(module, event, fn));
    return { ...api };
  },
};
