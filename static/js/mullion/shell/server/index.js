import { backend, connect, fetch, fetchJSON, qs, settings } from "./server.js";

export default {
  setup(ctx) {
    connect(ctx.emitter(), ctx.slot("problem"), ctx.use("preload"));
    return { fetchJSON, fetch, qs, settings, backend };
  },
};
