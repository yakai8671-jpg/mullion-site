import { connect } from "./deps.js";
import * as f0 from "./textfeatures.js";
import * as f1 from "./controls.js";

const files = [f0, f1];

export default {
  setup(ctx) {
    connect({ page: ctx.use("page"), server: ctx.use("server"), i18n: ctx.use("i18n"), registry: ctx.use("registry"), properties: ctx.use("properties"), media: ctx.use("media"), view: ctx.use("view"), apps: ctx.use("apps"), mount: ctx.use("mount"), ports: ctx.use("ports"), pickers: ctx.use("pickers") });
    for (const file of files) if (file.install) file.install();
    const api = {};
    for (const file of files) for (const [name, value] of Object.entries(file)) if (name !== "install") api[name] = value;
    return api;
  },
};
