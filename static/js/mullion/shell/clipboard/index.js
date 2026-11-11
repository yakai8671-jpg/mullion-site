import { connect } from "./deps.js";
import { available, writeText } from "./clipboard.js";

export default {
  setup(ctx) {
    connect({ page: ctx.use("page") });
    return { available, writeText };
  },
};
