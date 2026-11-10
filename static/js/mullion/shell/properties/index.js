import { connect } from "./deps.js";
import * as f0 from "./properties.js";

const files = [f0];

export default {
  setup(ctx) {
    connect({ server: ctx.use("server"), registry: ctx.use("registry"), apps: ctx.use("apps"), items: ctx.use("items"), ports: ctx.use("ports"), i18n: ctx.use("i18n"), media: ctx.use("media"), library: ctx.use("library") });
    for (const file of files) if (file.install) file.install();
    const api = {};
    for (const file of files) for (const [name, value] of Object.entries(file)) if (name !== "install") api[name] = value;
    return api;
  },
};
