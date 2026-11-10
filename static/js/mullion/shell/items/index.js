import * as store from "./store.js";
import { createActions } from "./actions.js";

const { connect, ...api } = store;

export default {
  setup(ctx) {
    const registry = ctx.use("registry");
    connect(registry, ctx.use("i18n"));
    const emit = ctx.emitter();
    const actions = createActions({
      registry,
      t: ctx.use("i18n").t,
      getItem: api.getItem,
      host: ctx.slot("actionHost"),
      emit,
    });
    // The items `keep` says no to leave: their jobs end, their type lets go
    // of them (destroy), and items says which went (`remove`).
    function removeItems(keep) {
      const gone = api.keepItems(keep);
      for (const item of gone) {
        actions.retireItem(item);
        registry.ITEM_TYPES[item.type]?.destroy?.(item);
      }
      if (gone.length) emit("remove", { ids: gone.map((item) => item.id) });
      return gone;
    }
    return { ...api, ...actions, removeItems };
  },
};
