/* What this module uses of other modules, handed in by setup (index.js). */
export let CONTROLS;
export let ITEM_TYPES;
export let OperationHistory;
export let adopt;
export let announceRestore;
export let appDef;
export let appList;
export let applyHistorySnapshot;
export let claimItemIds;
export let claimWindowIds;
export let commit;
export let controlFor;
export let isStandalone;
export let layoutRoot;
export let layoutText;
export let nodeIds;
export let partitionHistory;
export let reservedItemIds;
export let reservedWindowIds;
export let serialize;
export let t;

export let settings;

export let toast;
export function connect(apis) {
  ({ toast } = apis.view);
  ({ settings } = apis.server);
  ({ adopt, announceRestore, claimWindowIds, commit, layoutRoot, layoutText, nodeIds, reservedWindowIds, serialize } = apis.layout);
  ({ claimItemIds, reservedItemIds } = apis.items);
  ({ appDef, appList } = apis.apps);
  ({ OperationHistory, applyHistorySnapshot, partitionHistory } = apis.history);
  ({ CONTROLS, ITEM_TYPES, controlFor, isStandalone } = apis.registry);
  ({ t } = apis.i18n);
}
