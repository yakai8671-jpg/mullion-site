import { connect } from "./deps.js";
import * as boot from "./boot.js";
import * as startup from "./startup.js";
import * as profilequery from "./profilequery.js";

export default {
  setup(ctx) {
    connect({ page: ctx.use("page"), server: ctx.use("server"), builtins: ctx.use("builtins"), registry: ctx.use("registry"), pickers: ctx.use("pickers"), layout: ctx.use("layout"), mount: ctx.use("mount"), items: ctx.use("items"), apps: ctx.use("apps"), view: ctx.use("view"), bays: ctx.use("bays"), ports: ctx.use("ports"), hotkeys: ctx.use("hotkeys"), operations: ctx.use("operations"), grants: ctx.use("grants"), frames: ctx.use("frames"), library: ctx.use("library"), permissions: ctx.use("permissions"), i18n: ctx.use("i18n") });
    boot.connectEvents((module, event, fn) => ctx.on(module, event, fn));
    ctx.fill("items.actionHost", () => boot.actionHost);
    boot.install();
    return {
      init: boot.init,
      resetLayout: boot.resetLayout,
      layoutFileName: boot.layoutFileName,
      ...Object.fromEntries(Object.entries(startup)),
      ...Object.fromEntries(Object.entries(profilequery)),
    };
  },
};
