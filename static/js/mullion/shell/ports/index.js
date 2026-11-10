import { connect } from "./deps.js";
import * as all from "./links.js";

const { connectEvents, registerWithOthers, ...api } = all;

export default {
  setup(ctx) {
    connect({ registry: ctx.use("registry"), layout: ctx.use("layout"), items: ctx.use("items"), i18n: ctx.use("i18n") });
    connectEvents(ctx.emitter());
    registerWithOthers();
    return { ...api };
  },
};
