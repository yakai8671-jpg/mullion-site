/* What this module uses of other modules, handed in by setup (index.js). */
export let qs;

export function connect(apis) {
  ({ qs } = apis.server);
}
