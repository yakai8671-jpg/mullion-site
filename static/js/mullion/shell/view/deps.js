/* What this module uses of other modules, handed in by setup (index.js). */
export let CONTROLS;
export let ICONS;
export let ITEM_TYPES;
export let formatValue;
export let paramNames;
export let actionStatus;
export let cancelAction;
export let controlActions;
export let getItem;
export let itemProperties;
export let runAction;
export let kindAt;
export let linkOf;
export let portInfo;
export let portIsEntry;
export let portLink;
export let portShare;
export let portSpec;
export let stepsOf;
export let unlinkPort;
export let writable;
export let adaptDescriptor;
export let registerPart;
export let t;
export let describeSpec;
export let portLabel;
export let MutationObserver;
export let ResizeObserver;
export let cancelAnimationFrame;
export let document;
export let getComputedStyle;
export let requestAnimationFrame;
export let window;

export let language;
export let settings;

export function connect(apis) {
  ({ settings } = apis.server);
  ({ MutationObserver, ResizeObserver, cancelAnimationFrame, document, getComputedStyle, requestAnimationFrame, window } = apis.page);
  ({ CONTROLS, ICONS, ITEM_TYPES, formatValue, paramNames, describe: describeSpec } = apis.registry);
  ({ actionStatus, cancelAction, controlActions, getItem, itemProperties, runAction } = apis.items);
  ({ kindAt, linkOf, portInfo, portIsEntry, portLink, portShare, portSpec, stepsOf, unlinkPort, writable, portLabel } = apis.ports);
  ({ adaptDescriptor } = apis.build);
  ({ registerPart } = apis.layout);
  ({ t, language } = apis.i18n);
}
