/* What parts uses of other modules, handed in by setup (index.js). */
export let ICONS;
export let document;
export let window;
export let languages;
export let TEXT_LANGUAGES;
export let optionsOf;
export let appSettingValue;
export let attachPort;
export let explainer;
export let closeHint;
export let listCard;
export let openPopup;
export let paintStatusRow;
export let t;
export let registerControl;

export function connect(apis) {
  ({ document, window } = apis.page);
  ({ t, languages } = apis.i18n);
  ({ ICONS, registerControl } = apis.registry);
  ({ TEXT_LANGUAGES, optionsOf } = apis.properties);
  ({ closeHint, listCard, openPopup, paintStatusRow } = apis.view);
  ({ appSettingValue } = apis.apps);
  ({ attachPort, explainer } = apis.mount);
}
