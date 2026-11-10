/* What this module uses of other modules, handed in by setup (index.js). */
export let settings;
export let preload;

export function connect(apis) {
  ({ settings } = apis.server);
  preload = apis.preload;
}
