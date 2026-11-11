import { connect } from "./deps.js";
import * as all from "./seams.js";

export default {
  setup(ctx) {
    connect({ layout: ctx.use("layout") });
    return { ...all };
  },
};
