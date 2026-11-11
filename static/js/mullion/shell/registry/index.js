import * as registry from "./registry.js";

const { connect, ...api } = registry;

export default {
  setup(ctx) {
    connect(ctx.use("i18n"), { write: ctx.slot("write"), defaultOf: ctx.slot("defaultOf"), format: ctx.slot("format") });
    return { ...api };
  },
};
