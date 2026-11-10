import { connect } from "./deps.js";
import * as all from "./pickers.js";

const api = { ...all };

export default {
  setup(ctx) {
    connect({ page: ctx.use("page"), i18n: ctx.use("i18n"), operations: ctx.use("operations"), items: ctx.use("items"), layout: ctx.use("layout"), ports: ctx.use("ports"), grants: ctx.use("grants"), registry: ctx.use("registry"), view: ctx.use("view") });
    return { ...api };
  },
};
