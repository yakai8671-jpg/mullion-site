import { connect } from "./deps.js";
import * as all from "./operations.js";

const { connectEvents, createHistory, ...api } = all;

export default {
  setup(ctx) {
    connect({ view: ctx.use("view"), server: ctx.use("server"), layout: ctx.use("layout"), items: ctx.use("items"), apps: ctx.use("apps"), history: ctx.use("history"), registry: ctx.use("registry"), i18n: ctx.use("i18n") });
    connectEvents(ctx.emitter());
    createHistory();
    return { ...api };
  },
};
