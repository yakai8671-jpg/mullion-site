/* What this module uses of other modules, handed in by setup (index.js). */
export let isPlainObject;
export let t;

export let settings;

export function connect(apis) {
  ({ settings } = apis.server);
  ({ isPlainObject } = apis.layout);
  ({ t } = apis.i18n);
}
