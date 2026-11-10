/* Running the actions compiled into item definitions and control
 * declarations (action-runtime.js, control-actions.js).
 *
 * What an action needs of the screen -- which window shows the item, how to
 * ask the person there, where a report or a service's progress goes, whether
 * a property may be written through its port -- comes from the
 * `items.actionHost` slot (filled by mount). When an action has changed
 * something, items says so with its `change` event instead of redrawing. */
import { createActionRuntime } from "./action-runtime.js";
import { createControlActions } from "./control-actions.js";

export function createActions({ registry, t, getItem, host, emit }) {
  const { ITEM_TYPES, bindProperty, defaultFor, grantApi } = registry;
  const refresh = () => emit("change", { cause: "action" });
  const titled = (options) => ({ ...options, title: options?.title ? t(options.title) : "" });

  const itemActions = createActionRuntime({
    definition: (item, name) => ITEM_TYPES[item.type]?.actions?.[name],
    // An action asks the person the way its item's window does: a question (`confirm`) or a text
    // (`prompt`), by translation key, beside the window showing the item (none: no, and nothing).
    context: (item) => ({
      itemId: item.id,
      confirm: (key, args, options = {}) => host().askerOf(item)?.confirm(t(key, args), titled(options)) ?? Promise.resolve(false),
      prompt: (key, args, options = {}) => host().askerOf(item)?.prompt(t(key, args), titled(options)) ?? Promise.resolve(null),
    }),
    live: (item) => Boolean(item && getItem(item.id) === item),
    serviceBlocker: (service, item) => host().serviceBlocker(service, item),
    property: (item, key) => bindProperty(item, key, host().itemApi(item)),
    defaultValue: (item, key) => defaultFor(ITEM_TYPES[item.type].properties[key]),
    apiFor: (item, permissions) => grantApi({ permissions }, { itemId: item.id, windowId: host().windowOf(item) }),
    refresh,
    report: (item, message) => host().report(item, message),
    progress: (item, service, message) => host().progress(item, service, message),
    t,
  });

  const controlActions = createControlActions({
    live: (item) => getItem(item.id) === item,
    serviceBlocker: (service, item) => host().serviceBlocker(service, item),
    permits: (ctx, permissions) => permissions.every((one) => ITEM_TYPES[ctx.item.type]?.permissions.includes(one)),
    writable: (desc) => host().writable(desc),
    defaultFor,
    apiFor: (ctx, permissions) => grantApi({ permissions }, { itemId: ctx.item.id, windowId: ctx.windowId }),
    refresh,
    report: (ctx, message) => ctx.status?.(message),
    progress: (item, service, message) => host().progress(item, service, message),
    t,
  });

  return {
    runAction: itemActions.run,
    actionStatus: itemActions.status,
    cancelAction: itemActions.cancel,
    retireItem: itemActions.retire,
    controlActions,
  };
}
