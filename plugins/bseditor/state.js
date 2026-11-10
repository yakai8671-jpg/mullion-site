/* What the screens and the values of BsEditor keep between one drawing and the next: how typing is told from a
 * change for undo, the writes that wait for a pause in typing, what puts a decoration in a composer's text, and
 * the cell an editor last held. None of it is saved. */
import * as ops from "./ops.js";

// What puts a decoration in a composer's text, by the composer: set by its text card when it is drawn, used by the
// catalog that is connected to it.
export const composers = new Map();

// Text typed in a run is one step of undo for every second or so of typing, not one for every pause.
let lastTyped = { sid: "", key: "", at: 0 };
// Set by whoever is about to write a cell that is being typed in.
export const state = { typing: "" };
export function rememberFor(doc, key = "") {
  const now = Date.now();
  const same = key && lastTyped.sid === doc.sid && lastTyped.key === key && now - lastTyped.at < 2000;
  if (!same) ops.remember(doc);
  lastTyped = key ? { sid: doc.sid, key, at: now } : { sid: "", key: "", at: 0 };
}
// What is written while it is being typed is one step of undo, not one to a key.
export const typed = (key, fn) => {
  state.typing = key;
  try {
    return fn();
  } finally {
    state.typing = "";
  }
};
// A write that waits for a pause in typing (a field that writes at each key).
const pending = new Map();
export const later = (key, fn, ms = 350) => {
  clearTimeout(pending.get(key));
  pending.set(
    key,
    setTimeout(() => {
      pending.delete(key);
      fn();
    }, ms)
  );
};

// The cell an editor holds: what its `cell` shares if it shares one, else its own. The cell it last had, and the
// share it last had it through, for a read or a write that comes with no api of the item's own (a grip's, a link's):
// the share is the item's api's to give, so it is kept from the last time the item was drawn.
const lastHeld = new Map();
const lastShare = new Map();
export const heldCell = (api, item) => {
  if (!api || !api.props) {
    const shared = lastShare.get(item.id);
    return ops.coerceCell(shared ? shared.read() : item.props.cell) || lastHeld.get(item.id) || null;
  }
  const shared = api.props.shared("cell");
  if (shared) lastShare.set(item.id, shared);
  else lastShare.delete(item.id);
  const cell = ops.coerceCell(shared ? shared.read() : item.props.cell);
  if (cell) lastHeld.set(item.id, cell);
  return cell;
};
export const putCell = (api, item, cell) => {
  const shared = api && api.props ? api.props.shared("cell") : lastShare.get(item.id);
  if (shared) shared.write(cell);
  else item.props.cell = cell;
};
