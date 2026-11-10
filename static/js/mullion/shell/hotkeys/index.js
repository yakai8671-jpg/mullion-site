import { connect } from "./deps.js";
import * as all from "./hotkeys.js";

const { connectEvents, ...api } = all;

export default {
  setup(ctx) {
    connect({ items: ctx.use("items"), layout: ctx.use("layout"), apps: ctx.use("apps"), bays: ctx.use("bays"), i18n: ctx.use("i18n"), registry: ctx.use("registry"), operations: ctx.use("operations") });
    connectEvents(ctx.emitter());
    return { ...api };
  },
};
