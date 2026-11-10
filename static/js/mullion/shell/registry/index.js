import * as registry from "./registry.js";

const { connect, ...api } = registry;

export default {
  setup(ctx) {
    connect(ctx.use("i18n"));
    return { ...api };
  },
};
