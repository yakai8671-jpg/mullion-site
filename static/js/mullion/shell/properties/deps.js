/* What this module uses of other modules, handed in by setup (index.js). */
export let ITEM_TYPES;
export let VALUE_TYPES;
export let appSettingValue;
export let bindElement;
export let bindProperty;
export let defaultFor;
export let derivesFrom;
export let formatValue;
export let getItem;
export let locate;
export let mediaOfName;
export let paramsFor;
export let presetSpecOf;
export let presetTypeDef;
export let presetTypeFor;
export let presetTypes;
export let registerPortConversion;
export let registerValueType;
export let saved;
export let savedValue;
export let t;
export let valueTypeFor;

export let fetch;

export function connect(apis) {
  ({ defaultFor, formatValue } = apis.values);
  ({ fetch } = apis.server);
  ({ ITEM_TYPES, VALUE_TYPES, bindElement, bindProperty, derivesFrom, paramsFor, presetSpecOf, presetTypeDef, presetTypeFor, presetTypes, registerValueType, valueTypeFor } = apis.registry);
  ({ appSettingValue } = apis.apps);
  ({ getItem } = apis.items);
  ({ registerPortConversion } = apis.ports);
  ({ t } = apis.i18n);
  ({ locate, mediaOfName } = apis.media);
  ({ saved, savedValue } = apis.library);
}
