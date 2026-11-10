/* What this module uses of other modules, handed in by setup (index.js). */
export let ACTIONS;
export let API_VERSIONS;
export let CONTROLS;
export let ITEM_FACTORIES;
export let ITEM_TYPES;
export let PERMISSIONS;
export let SKINS;
export let VALUE_TYPES;
export let bindSpec;
export let buildPlugin;
export let buildSideCard;
export let cardBar;
export let cardBarRow;
export let cardPortOf;
export let controlCardHead;
export let core;
export let describe;
export let describeProperty;
export let groupingOf;
export let groupsIn;
export let paramNames;
export let propertyGroupOf;
export let registerAction;
export let registerApp;
export let registerControl;
export let registerItemFactory;
export let registerItemType;
export let registerPermission;
export let registerSkin;
export let registerTranslations;
export let registerValueType;
export let setRegistrationSource;
export let syncCardHead;
export let unexplainedControls;
export let addStylesheet;

export let fetchJSON;
export let grantApi;
export let qs;

export function connect(apis) {
  ({ fetchJSON, qs } = apis.server);
  ({ grantApi } = apis.registry);
  ({ addStylesheet } = apis.view);
  ({ registerTranslations } = apis.i18n);
  // What a plugin's `core` is made of: every module's surface (plugins.js keeps
  // it to the names a plugin may take, OPEN and GUARDED).
  core = Object.assign({}, ...Object.values(apis));
  ({ ACTIONS, CONTROLS, ITEM_FACTORIES, ITEM_TYPES, PERMISSIONS, SKINS, VALUE_TYPES, bindSpec, describe, describeProperty, paramNames, registerAction, registerApp, registerControl, registerItemFactory, registerItemType, registerPermission, registerSkin, registerValueType, setRegistrationSource, unexplainedControls } = apis.registry);
  ({ buildSideCard, cardBar, cardBarRow, cardPortOf, buildCardHead: controlCardHead, syncCardHead } = apis.controls);
  ({ groupingOf, groupsIn, groupOf: propertyGroupOf } = apis.properties);
  ({ API_VERSIONS, buildPlugin } = apis.build);
}
