/* What build uses of the registry module, handed in by setup (index.js).
 * Live bindings: the compile files import these names as before. */
export let APPS;
export let ITEM_TYPES;
export let isStandalone;
export let extendControl;
export let ICONS;
export let paramNames;
export let ACTIONS;
export let ITEM_FACTORIES;
export let bindElementByIdentity;
export let bindProperty;
export let bindSpec;
export let defaultFor;
export let describe;
export let describeProperty;
export let elementIdentity;

export function connect(registry, values) {
  ({ defaultFor } = values);
  ({ APPS, ITEM_TYPES, isStandalone, extendControl, ICONS, paramNames, ACTIONS, ITEM_FACTORIES, bindElementByIdentity, bindProperty, bindSpec, describe, describeProperty, elementIdentity } = registry);
}
