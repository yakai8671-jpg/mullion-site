// Session-local snapshots. JSON strings keep later mutations out of old states.
export class OperationHistory {
  constructor(limit = 100) {
    this.limit = limit;
    this.entries = [];
    this.position = -1;
    this.sequence = 0;
  }

  reset(value) {
    this.entries = [{ id: ++this.sequence, json: JSON.stringify(value), time: Date.now(), change: { kind: "initial" } }];
    this.position = 0;
  }

  record(value, change, merge = false) {
    const json = JSON.stringify(value);
    const last = this.entries[this.position];
    if (!last) { this.reset(value); return false; }
    if (last.json === json) return false;
    const now = Date.now();
    const combine = merge && this.position > 0 && this.position === this.entries.length - 1 &&
      last.change.mergeKey && last.change.mergeKey === change.mergeKey && now - last.time < 800;
    this.entries.splice(this.position + 1);
    const entry = { id: ++this.sequence, json, time: now, change };
    if (combine) this.entries[this.position] = entry;
    else { this.entries.push(entry); this.position += 1; }
    if (this.entries.length > this.limit + 1) { this.entries.shift(); this.position -= 1; }
    return true;
  }

  get current() { return this.entries[this.position]; }
  get canUndo() { return this.position > 0; }
  get canRedo() { return this.position < this.entries.length - 1; }

  move(position) {
    if (!Number.isInteger(position) || position < 0 || position >= this.entries.length || position === this.position) return null;
    this.position = position;
    return JSON.parse(this.current.json);
  }

  list() {
    return this.entries.map(({ id, time, change }, index) => ({
      id, time, ...change, index, current: index === this.position, future: index > this.position,
    }));
  }
}

const clone = (value) => JSON.parse(JSON.stringify(value));
const idsIn = (node, out = []) => {
  if (!node) return out;
  if (node.id) out.push(node.id);
  for (const child of node.children || []) idsIn(child, out);
  return out;
};

// Replace excluded instances with value-free layout anchors. Removing their
// split branches would also discard the included neighbours' sizes/order.
export function partitionHistory(value, excludedApps, omitAnchors = false) {
  const data = clone(value);
  const excludedItems = new Set();
  const excludedNodes = new Set();
  const excludedBays = new Set();
  const anchorIds = new Set();
  const items = new Map(data.items.map((item) => [item.id, item]));
  const mark = (node) => {
    if (!node) return;
    if (node.id) excludedNodes.add(node.id);
    if (node.bay) excludedBays.add(node.bay);
    for (const id of [...(node.path || []), ...(node.screens || []), node.appItem].filter(Boolean)) excludedItems.add(id);
    for (const child of node.children || []) mark(child);
  };
  const project = (node, owner = "") => {
    if (!node) return null;
    if (node.type === "history-excluded") {
      anchorIds.add(node.id);
      return omitAnchors ? null : node;
    }
    const app = node.app || owner;
    const type = items.get(node.path?.[0] || node.appItem)?.type;
    if (excludedApps.has(app || type)) {
      mark(node);
      anchorIds.add(node.id);
      return omitAnchors ? null : { type: "history-excluded", id: node.id };
    }
    if (!node.children) return node;
    const children = node.children.map((child) => project(child, app)).filter(Boolean);
    if (!children.length) return null;
    if (node.type === "split" && children.length === 1) return children[0];
    return { ...node, children };
  };
  const root = project(data.root);
  const bays = (data.bays || []).map((bay) => ({ ...bay, sashes: bay.sashes.map((sash) => ({ ...sash, content: project(sash.content) })) }));
  for (const bay of data.bays || []) if (excludedBays.has(bay.id)) for (const sash of bay.sashes) mark(sash.content);
  let grew = true;
  while (grew) {
    grew = false;
    for (const item of data.items) if (excludedItems.has(item.parent) && !excludedItems.has(item.id)) {
      excludedItems.add(item.id);
      grew = true;
    }
  }
  const excludedAddress = (key) => [...excludedItems, ...excludedNodes]
    .some((id) => new RegExp(`(?:^|[^A-Za-z0-9])${id}(?![A-Za-z0-9])`).test(key));
  const snapshot = {
    ...data,
    root,
    items: data.items.filter((item) => !excludedItems.has(item.id)),
    bays: bays.filter((bay) => !excludedBays.has(bay.id)),
    links: (data.links || []).filter((link) => !excludedItems.has(link.to.item) && !excludedItems.has(link.from.item)),
    grants: (data.grants || []).filter((grant) => !excludedItems.has(grant.holder) && !excludedItems.has(grant.root)),
    folds: (data.folds || []).filter((key) => !excludedAddress(key)),
    cardSizes: (data.cardSizes || []).filter(([key]) => !excludedAddress(key)),
    controlStates: (data.controlStates || []).filter(([id]) => !excludedItems.has(id)),
  };
  return { snapshot, data, excludedItems, excludedNodes, excludedBays, anchorIds };
}

// Anchors retain the saved split topology without saving excluded app values.
// Fill them with live instances, then place newly opened excluded windows.
export function applyHistorySnapshot(saved, live, excludedApps) {
  const parts = partitionHistory(live, excludedApps);
  const result = clone(partitionHistory(saved, excludedApps).snapshot);
  const { data, excludedItems, excludedNodes, excludedBays } = parts;
  const liveNodes = new Map();
  const index = (node) => {
    if (!node) return;
    if (node.id) liveNodes.set(node.id, node);
    for (const child of node.children || []) index(child);
  };
  index(data.root);
  for (const bay of data.bays || []) for (const sash of bay.sashes) index(sash.content);
  const fillAnchors = (node) => {
    if (!node) return null;
    if (node.type === "history-excluded") {
      return excludedNodes.has(node.id) && liveNodes.has(node.id) ? clone(liveNodes.get(node.id)) : null;
    }
    if (!node.children) return node;
    const children = node.children.map(fillAnchors).filter(Boolean);
    if (!children.length) return null;
    if (node.type === "split" && children.length === 1) return children[0];
    return { ...node, children };
  };
  result.root = fillAnchors(result.root);
  for (const bay of result.bays) for (const sash of bay.sashes) sash.content = fillAnchors(sash.content);
  const restoredIds = new Set(idsIn(result.root));
  for (const bay of result.bays) for (const sash of bay.sashes) idsIn(sash.content).forEach((id) => restoredIds.add(id));
  const missingExcluded = new Set([...excludedNodes].filter((id) => !restoredIds.has(id)));
  const hasExcluded = (node) => idsIn(node).some((id) => missingExcluded.has(id));
  const find = (node, ids) => {
    if (!node) return null;
    if (ids.has(node.id)) return node;
    for (const child of node.children || []) { const hit = find(child, ids); if (hit) return hit; }
    return null;
  };
  const replace = (node, target, replacement) => node === target ? replacement : node?.children
    ? { ...node, children: node.children.map((child) => replace(child, target, replacement)) } : node;
  const preserve = (target, current) => {
    if (!current || !hasExcluded(current)) return target;
    if (excludedNodes.has(current.id)) {
      if (find(target, new Set([current.id]))) return target;
      return target ? { type: "split", dir: "row", ratio: 0.5, children: [target, clone(current)] } : clone(current);
    }
    if (current.type === "group") {
      const match = find(target, new Set([current.id]));
      if (match) return replace(target, match, { ...match, children: [preserve(match.children[0], current.children[0])] });
      const includedLeaf = (node) => node && (node.type === "leaf" ? !excludedNodes.has(node.id) : node.children?.some(includedLeaf));
      if (!includedLeaf(current)) {
        const kept = { ...current, children: [preserve(null, current.children[0])] };
        return target ? { type: "split", dir: "row", ratio: 0.5, children: [target, kept] } : kept;
      }
      return preserve(target, current.children[0]);
    }
    if (current.type !== "split") return target;
    for (let side = 0; side < 2; side++) {
      const child = current.children[side];
      if (!hasExcluded(child)) continue;
      const sibling = current.children[1 - side];
      const ownIds = new Set(idsIn(child).filter((id) => !excludedNodes.has(id)));
      const own = find(target, ownIds);
      if (own) { target = replace(target, own, preserve(own, child)); continue; }
      const kept = preserve(null, child);
      if (!kept) continue;
      const anchor = find(target, new Set(idsIn(sibling))) || (target?.id === "root" ? target.children[0] : target);
      if (!anchor) { target = kept; continue; }
      const children = side === 0 ? [kept, anchor] : [anchor, kept];
      target = replace(target, anchor, { ...current, children });
    }
    return target;
  };
  result.root = preserve(result.root, data.root);
  if (result.root && result.root.id !== "root") result.root = { type: "group", id: "root", children: [result.root] };
  result.items.push(...data.items.filter((item) => excludedItems.has(item.id)));
  const knownItems = new Set(result.items.map((item) => item.id));
  result.links.push(...(data.links || []).filter((link) => (excludedItems.has(link.to.item) || excludedItems.has(link.from.item)) &&
    knownItems.has(link.to.item) && knownItems.has(link.from.item)));
  result.grants.push(...(data.grants || []).filter((grant) => (excludedItems.has(grant.holder) || excludedItems.has(grant.root)) &&
    knownItems.has(grant.holder) && knownItems.has(grant.root)));
  result.folds.push(...(data.folds || []).filter((key) => !parts.snapshot.folds.includes(key)));
  result.cardSizes.push(...(data.cardSizes || []).filter(([key]) => !parts.snapshot.cardSizes.some(([other]) => other === key)));
  result.controlStates.push(...(data.controlStates || []).filter(([id]) => excludedItems.has(id)));
  for (const bay of data.bays || []) {
    if (excludedBays.has(bay.id)) { result.bays.push(bay); continue; }
    const stored = result.bays.find((one) => one.id === bay.id);
    for (const sash of bay.sashes) if (hasExcluded(sash.content)) {
      if (!stored) {
        result.bays.push({ ...bay, sashes: bay.sashes.map((one) => ({ ...one, content: preserve(null, one.content) })) });
        break;
      }
      const prior = stored.sashes.find((one) => one.id === sash.id);
      if (prior) prior.content = preserve(prior.content, sash.content);
      else stored.sashes.push({ ...sash, content: preserve(null, sash.content) });
    }
  }
  return result;
}
