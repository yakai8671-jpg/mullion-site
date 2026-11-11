/* What layout uses of other modules, handed in by setup (index.js). */
export let APPS;
export let ITEM_TYPES;
export let isStandalone;
export let defaultFor;
export let versionOf;
export let upgradeValue;
export let t;
export let DEFAULT_ITEM_TYPE;
export let MISSING_ITEM_TYPE;
export let allItems;
export let claimItemIds;
export let createItem;
export let forgetItemIds;
export let getItem;
export let removeItems;
export let retireItem;
export let setItems;

export function connect({ registry, items, i18n, values }) {
  ({ APPS, ITEM_TYPES, isStandalone } = registry);
  ({ defaultFor, versionOf, upgradeValue } = values);
  ({ t } = i18n);
  ({ DEFAULT_ITEM_TYPE, MISSING_ITEM_TYPE, allItems, claimItemIds, createItem, forgetItemIds, getItem, removeItems, retireItem, setItems } = items);
}
