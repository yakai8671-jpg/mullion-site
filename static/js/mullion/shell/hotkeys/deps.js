/* What this module uses of other modules, handed in by setup (index.js). */
export let ICONS;
export let allBays;
export let appDef;
export let appList;
export let bayFrame;
export let containsNode;
export let eachOwnNode;
export let findIn;
export let findLeaf;
export let freeTag;
export let getItem;
export let groupOf;
export let isContainer;
export let launchItemAt;
export let layoutRoot;
export let scheduleLaunchKeep;
export let scheduleSave;
export let setApp;
export let t;

export function connect(apis) {
  ({ getItem } = apis.items);
  ({ containsNode, findLeaf, groupOf, isContainer, layoutRoot } = apis.layout);
  ({ appDef, appList, eachOwnNode, freeTag, launchItemAt, scheduleLaunchKeep, setApp } = apis.apps);
  ({ allBays, bayFrame, findIn } = apis.bays);
  ({ t } = apis.i18n);
  ({ ICONS } = apis.registry);
  ({ scheduleSave } = apis.operations);
}
