import { connect } from "./deps.js";
import * as f0 from "./skins.js";
import * as f1 from "./input.js";
import * as f2 from "./settings.js";
import * as f3 from "./history.js";
import * as f4 from "./applinks.js";
import * as f5 from "./devtools.js";
import * as f6 from "./dashboard.js";
import * as f7 from "./catalog.js";
import * as f8 from "./pluginstatus.js";
import * as f9 from "./profilelist.js";
import * as f10 from "./catalogentry.js";
import * as f11 from "./propcatalog.js";
import * as f12 from "./controlcatalog.js";
import * as f13 from "./inventory.js";
import * as f14 from "./overlay.js";
import * as f15 from "./presetview.js";
import * as f16 from "./chooser.js";
import * as f17 from "./presetmaker.js";
import * as f18 from "./presetcreate.js";
import * as f19 from "./presetlist.js";
import * as f20 from "./windowsettings.js";
import * as f21 from "./preview.js";
import * as f22 from "./bayslot.js";
import * as f23 from "./apptype.js";
import * as f24 from "./iconpicker.js";
import * as f25 from "./homeeditor.js";
import * as f26 from "./missing.js";

const byName = { "skins": f0, "input": f1, "settings": f2, "history": f3, "applinks": f4, "devtools": f5, "dashboard": f6, "catalog": f7, "pluginstatus": f8, "profilelist": f9, "catalogentry": f10, "propcatalog": f11, "controlcatalog": f12, "inventory": f13, "overlay": f14, "presetview": f15, "chooser": f16, "presetmaker": f17, "presetcreate": f18, "presetlist": f19, "windowsettings": f20, "preview": f21, "bayslot": f22, "apptype": f23, "iconpicker": f24, "homeeditor": f25, "missing": f26 };
const files = [f0, f1, f2, f3, f4, f5, f6, f7, f8, f9, f10, f11, f12, f13, f14, f15, f16, f17, f18, f19, f20, f21, f22, f23, f24, f25, f26];

const installed = new Set();
function install(file) {
  if (!file || installed.has(file) || !file.install) return;
  installed.add(file);
  file.install();
}

export default {
  setup(ctx) {
    connect({ values: ctx.use("values"), server: ctx.use("server"), registry: ctx.use("registry"), apps: ctx.use("apps"), items: ctx.use("items"), layout: ctx.use("layout"), view: ctx.use("view"), mount: ctx.use("mount"), i18n: ctx.use("i18n"), frames: ctx.use("frames"), pickers: ctx.use("pickers"), ports: ctx.use("ports"), properties: ctx.use("properties"), media: ctx.use("media") });

    // The built-in items are the page's: boot installs them all (installBuiltins);
    // the Node tests take only those they need (installBuiltin).
    return { installBuiltin: (name) => install(byName[name]), installBuiltins: () => files.forEach(install) };
  },
};
