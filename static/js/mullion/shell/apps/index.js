import { connect } from "./deps.js";
import * as all from "./apps.js";

const { connectEvents, ...api } = all;

export default {
  setup(ctx) {
    connect({ server: ctx.use("server"), layout: ctx.use("layout"), items: ctx.use("items"), ports: ctx.use("ports"), bays: ctx.use("bays"), registry: ctx.use("registry"), library: ctx.use("library"), i18n: ctx.use("i18n") });
    connectEvents(ctx.emitter());
    return { ...api };
  },
};
