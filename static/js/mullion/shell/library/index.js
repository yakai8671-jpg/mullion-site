import { connect } from "./deps.js";
import * as library from "./library.js";

const api = { ...library };

export default {
  setup(ctx) {
    connect({ server: ctx.use("server"), media: ctx.use("media") });
    return { ...api };
  },
};
