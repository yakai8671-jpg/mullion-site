/* What clipboard uses of other modules, handed in by setup (index.js). */
export let navigator;

export function connect(apis) {
  ({ navigator } = apis.page);
}
