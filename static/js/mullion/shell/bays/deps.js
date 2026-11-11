/* What this module uses of other modules, handed in by setup (index.js). */
export let commit;
export let containsNode;
export let currentItemId;
export let eachGroup;
export let eachLeaf;
export let findLeaf;
export let findParent;
export let groupContent;
export let groupOf;
export let isContainer;
export let layoutRoot;
export let newWindowId;
export let nodeIds;
export let ratioOf;
export let removeWindow;
export let replaceNode;
export let setLayoutRoot;
export let splitNode;
export let splitWindow;
export let validateNode;
export let registerPart;
export let registerHolder;
export let registerLayoutHook;
export let claimWindowIds;
export let screensOf;
export let createItem;
export let getItem;
export let itemIcon;
export let itemLabel;
export let t;

export let writeValue;

export function connect(apis) {
  ({ writeValue } = apis.values);
  ({ commit, containsNode, currentItemId, eachGroup, eachLeaf, findLeaf, findParent, groupContent, groupOf, isContainer, layoutRoot, newWindowId, nodeIds, ratioOf, removeWindow, replaceNode, setLayoutRoot, splitNode, splitWindow, validateNode, registerPart, registerHolder, registerLayoutHook, claimWindowIds, screensOf } = apis.layout);
  ({ createItem, getItem, itemIcon, itemLabel } = apis.items);
  ({ t } = apis.i18n);
}
