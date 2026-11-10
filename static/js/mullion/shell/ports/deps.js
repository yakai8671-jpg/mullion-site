/* What this module uses of other modules, handed in by setup (index.js). */
export let ITEM_TYPES;
export let VALUE_TYPES;
export let bindElement;
export let bindProperty;
export let bindSpec;
export let derivesFrom;
export let grantApi;
export let listOfPortKind;
export let setShareResolver;
export let valueTypeFor;
export let MAX_NESTING;
export let registerPart;
export let getItem;
export let itemLabel;
export let t;

export function connect(apis) {
  ({ ITEM_TYPES, VALUE_TYPES, bindElement, bindProperty, bindSpec, derivesFrom, grantApi, listOfPortKind, setShareResolver, valueTypeFor } = apis.registry);
  ({ MAX_NESTING, registerPart } = apis.layout);
  ({ getItem, itemLabel } = apis.items);
  ({ t } = apis.i18n);
}
