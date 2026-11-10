/* What this module uses of other modules, handed in by setup (index.js). */
export let ICONS;
export let ITEM_TYPES;
export let bindProperty;
export let commit;
export let createItem;
export let currentItemId;
export let eachLeaf;
export let findLeaf;
export let getItem;
export let grants;
export let layoutRoot;
export let portGuide;
export let portInfo;
export let readAddress;
export let screensOf;
export let setScreens;
export let sharePort;
export let truncatePath;
export let currentFileName;
export let loadLayoutText;
export let operationsHalted;
export let rememberFile;
export let layoutText;
export let t;
export let Element;
export let document;
export let getComputedStyle;
export let window;

export let toast;
export function connect(apis) {
  ({ Element, document, getComputedStyle, window } = apis.page);
  ({ t } = apis.i18n);
  ({ currentFileName, loadLayoutText, operationsHalted, rememberFile } = apis.operations);
  ({ createItem, getItem } = apis.items);
  ({ commit, currentItemId, eachLeaf, findLeaf, layoutRoot, screensOf, setScreens, truncatePath, layoutText } = apis.layout);
  ({ portInfo, readAddress, sharePort } = apis.ports);
  ({ grants } = apis.grants);
  ({ ICONS, ITEM_TYPES, bindProperty } = apis.registry);
  ({ portGuide, toast } = apis.view);
}
