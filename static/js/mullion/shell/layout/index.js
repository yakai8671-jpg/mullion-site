import * as tree from "./tree.js";
import { connect } from "./deps.js";
import * as structureAll from "./structure.js";

const { connectEvents, ...structure } = structureAll;

export default {
  setup(ctx) {
    connect({ registry: ctx.use("registry"), items: ctx.use("items"), i18n: ctx.use("i18n") });
    connectEvents(ctx.emitter());
    return { ...tree, ...structure };
  },
};
