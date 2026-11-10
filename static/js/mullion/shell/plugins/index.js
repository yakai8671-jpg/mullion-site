import { connect } from "./deps.js";
import * as f0 from "./plugins.js";

const files = [f0];

export default {
  setup(ctx) {
    connect({ server: ctx.use("server"), i18n: ctx.use("i18n"), grants: ctx.use("grants"), media: ctx.use("media"), history: ctx.use("history"), library: ctx.use("library"), registry: ctx.use("registry"), build: ctx.use("build"), items: ctx.use("items"), layout: ctx.use("layout"), ports: ctx.use("ports"), view: ctx.use("view"), bays: ctx.use("bays"), apps: ctx.use("apps"), home: ctx.use("home"), operations: ctx.use("operations"), pickers: ctx.use("pickers"), hotkeys: ctx.use("hotkeys"), frames: ctx.use("frames"), mount: ctx.use("mount"), properties: ctx.use("properties"), controls: ctx.use("controls") });
    for (const file of files) if (file.install) file.install();
    const api = {};
    for (const file of files) for (const [name, value] of Object.entries(file)) if (name !== "install") api[name] = value;
    return api;
  },
};
