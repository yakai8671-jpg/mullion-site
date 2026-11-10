/* What this module uses of other modules, handed in by setup (index.js). */
export let fetchJSON;
export let fetch;
export let locate;

export function connect(apis) {
  ({ fetchJSON, fetch } = apis.server);
  ({ locate } = apis.media);
}
