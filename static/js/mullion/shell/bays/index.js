import { connect } from "./deps.js";
import * as all from "./bays.js";

const { connectEvents, registerWithOthers, ...api } = all;

export default {
  setup(ctx) {
    connect({ values: ctx.use("values"), layout: ctx.use("layout"), items: ctx.use("items"), i18n: ctx.use("i18n") });
    connectEvents(ctx.emitter());
    registerWithOthers();
    return { ...api };
  },
};
