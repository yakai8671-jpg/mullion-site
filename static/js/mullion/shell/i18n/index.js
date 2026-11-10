import { connect } from "./deps.js";
import { language, languages, registerTranslations, t, translationTables } from "./i18n.js";

export default {
  setup(ctx) {
    connect({ server: ctx.use("server"), preload: ctx.use("preload") });
    return { t, language, languages, translationTables, registerTranslations };
  },
};
