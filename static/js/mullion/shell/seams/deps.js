/* What seams uses of other modules, handed in by setup (index.js). */
export let ratioOf;
export let layoutRoot;
export let setLayoutRoot;
export let isContainer;

export function connect(apis) {
  ({ ratioOf, layoutRoot, setLayoutRoot, isContainer } = apis.layout);
}
