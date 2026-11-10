/* The group, drawn: one card to an entry, in the group's card, shared by the screen that shows the group the app
 * holds and by the result cards of the forms. `port` is the card's address, `set` writes the group back, `clear`
 * empties it, `openChild` opens the add form for it. */
import { coerceGroup, copy, newId, kindLabel, kindsHeld, nameOf, shownAs } from "./lib.js";

export function groupNodes({ core, describe, api, itemId, port, read, set, clear, openChild, readonly = false, tools }) {
  const { NODES, t } = core;
  const held = () => coerceGroup(read());
  const now = () => held().entries;
  const write = (entries) => set({ ...held(), entries });
  const change = (id, patch) => write(now().map((one) => (one.id === id ? { ...one, ...patch } : one)));
  const remove = (id) => write(now().filter((one) => one.id !== id));

  const group = held();
  // One card to an entry, in the group's card: a card with cards in it folds in steps (the entries first, then
  // itself), as every list of cards does.
  const nodes = group.entries.map((entry) => {
    const type = shownAs(entry.kind);
    if (!type) {
      return NODES.card(`entry-${entry.id}`, nameOf(entry), [], [], {
        isListElement: true,
        empty: t("propgroup.value.unknown", { kind: entry.kind }),
        onDiscard: readonly ? null : () => remove(entry.id),
      });
    }
    const name = describe(
      {
        type: "string",
        control: "propgroup.namebox",
        placeholder: kindLabel(entry.kind),
        read: () => (now().find((other) => other.id === entry.id) || entry).name,
        write: (_api, value) => change(entry.id, { name: String(value || "").trim() }),
      },
      { api, key: `${itemId}-group-${entry.id}-name`, label: t("propgroup.field.name") }
    );
    const value = describe(
      {
        type,
        control: "scratch.card",
        readonly,
        // Read and written through the group, so the card edits the entry it stands for.
        read: () => {
          const one = now().find((other) => other.id === entry.id);
          return one ? one.value : null;
        },
        write: (_api, next) => change(entry.id, { value: copy(next) }),
        kind: entry.kind,
        bare: true,
        rowPorts: false,
      },
      { api, key: `${itemId}-group-${entry.id}`, label: nameOf(entry) }
    );
    return NODES.card(
      `entry-${entry.id}`,
      nameOf(entry),
      [...(readonly ? [] : [NODES.props(`entry-name-${entry.id}`, [name])]), NODES.control(`entry-value-${entry.id}`, { desc: value })],
      [],
      { icon: "collection", onDiscard: readonly ? null : () => remove(entry.id) }
    );
  });
  if (!readonly) nodes.push(NODES.control("zone", { control: "propgroup.zone", empty: !group.entries.length }));

  // The entries are a list of their own, a property of the group: one card that is its port, named outside like
  // any property's, so that it can be pointed at (a path into the group's value, `entries`).
  const entriesPort = port ? { ...port, path: [...(port.path || []), "entries"] } : null;
  const entries = NODES.listCard("entries", nodes, {
    title: t("propgroup.field.entryList"),
    icon: "collection",
    ...(entriesPort ? { port: entriesPort } : {}),
    isListElement: false,
  });

  return [
    NODES.card(
      "group",
      group.name || t("propgroup.item.group"),
      [entries],
      tools || [{ key: "add", primary: true, icon: "plus-lg", label: t("propgroup.action.addEntry"), run: () => openChild() }],
      {
        icon: "collection",
        port,
        onDiscard: clear,
        // Whatever is carried over the card is put down in it, as one more.
        sink: readonly
          ? null
          : {
              accepts: kindsHeld(),
              put: (value, kind) => write([...now(), { id: newId(), kind, name: "", value: copy(value) }]),
            },
      }
    ),
  ];
}
