import { connect } from "./deps.js";
import * as parts from "./parts.js";

const { install, ...api } = parts;

export default {
  setup(ctx) {
    connect({ page: ctx.use("page"), i18n: ctx.use("i18n"), registry: ctx.use("registry"), properties: ctx.use("properties"), view: ctx.use("view"), apps: ctx.use("apps"), mount: ctx.use("mount") });
    install();
    return { ...api };
  },
};
