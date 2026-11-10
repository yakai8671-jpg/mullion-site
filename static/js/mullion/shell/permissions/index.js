import { connect } from "./deps.js";
import * as f0 from "./permissions.js";

const files = [f0];

export default {
  setup(ctx) {
    connect({ server: ctx.use("server"), media: ctx.use("media"), library: ctx.use("library"), grants: ctx.use("grants"), items: ctx.use("items"), layout: ctx.use("layout"), registry: ctx.use("registry"), apps: ctx.use("apps"), bays: ctx.use("bays"), ports: ctx.use("ports"), pickers: ctx.use("pickers"), mount: ctx.use("mount"), frames: ctx.use("frames"), operations: ctx.use("operations"), i18n: ctx.use("i18n"), hotkeys: ctx.use("hotkeys"), plugins: ctx.use("plugins") });
    for (const file of files) if (file.install) file.install();
    const api = {};
    for (const file of files) for (const [name, value] of Object.entries(file)) if (name !== "install") api[name] = value;
    return api;
  },
};
