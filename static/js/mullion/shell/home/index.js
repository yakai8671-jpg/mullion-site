import { connect } from "./deps.js";
import * as all from "./home.js";

const { connectEvents, ...api } = all;

export default {
  setup(ctx) {
    connect({ server: ctx.use("server"), layout: ctx.use("layout"), i18n: ctx.use("i18n") });
    connectEvents(ctx.emitter());
    return { ...api };
  },
};
