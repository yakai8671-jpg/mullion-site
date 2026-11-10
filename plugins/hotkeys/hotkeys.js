/* Hotkeys -- what its declarations (items/manager.json) cannot say.
 *
 * The keys are the shell's own: it keeps the bindings with the layout and
 * runs them whichever window has focus. This app holds nothing of its own --
 * the list is what hotkeys:read says now (`derived`), the way the file
 * manager's listing is what the disk says -- and every change goes through
 * hotkeys:write (`actions`).
 *
 * A binding is made in three steps: add a row, choose its key from the
 * dropdown, then click the thing on screen it should act on (the shell lays a
 * guide over every control the key can stand in for).
 */

// ---- the values the manager reads ------------------------------------------
export const derived = {
  // The bindings, each with the title its card shows: the key, and what it
  // acts on -- the app it is kept in first, since a key is an app's.
  "hotkeys.rows": (api, _item, { t }) =>
    api.hotkeys.list().map((binding) => ({
      ...binding,
      title: [binding.key || t("hotkeys.key.none"), binding.app ? `${binding.appName} › ${binding.targetLabel}` : ""]
        .filter(Boolean)
        .join(" · "),
    })),
  // Every key a binding may use, and which binding holds it now.
  "hotkeys.keys": (api) => api.hotkeys.keys(),
};

// ---- what it does ----------------------------------------------------------
// Waiting for the click on screen that says what a binding acts on. Which row
// is waiting is the item's `picking` while it lasts.
async function pickTarget(api, id, write) {
  write({ picking: id });
  const answer = await api.hotkeys.pick();
  // The row may have been removed while the guides were up.
  if (answer && api.hotkeys.list().some((one) => one.id === id)) {
    await api.hotkeys.set(id, { action: answer.action, target: answer.target });
  }
  return { picking: "" };
}

export const actions = {
  "hotkeys.add": {
    async run(_inputs, { api }) {
      api.hotkeys.add();
      return {};
    },
  },
  "hotkeys.remove": {
    async run({ id }, { api }) {
      api.hotkeys.remove(id);
      return {};
    },
  },
  // A key chosen: and, straight away, the next step for a key with nothing to
  // act on yet.
  "hotkeys.key": {
    async run({ id, key }, { api, write }) {
      api.hotkeys.set(id, { key });
      const binding = api.hotkeys.list().find((one) => one.id === id);
      if (key && binding && (!binding.app || binding.missing)) return pickTarget(api, id, write);
      return { picking: "" };
    },
  },
  "hotkeys.pick": {
    async run({ id }, { api, write }) {
      return pickTarget(api, id, write);
    },
  },
};

// ---- one binding's row: its key and what it acts on ---------------------------
const GROUPS = [
  ["hotkeys.group.single", (key) => /^[A-Z0-9]$/.test(key)],
  ["hotkeys.group.function", (key) => /^F\d+$/.test(key)],
  ["hotkeys.group.alt", (key) => /^Alt\+\d$/.test(key)],
  ["hotkeys.group.ctrlAltDigit", (key) => /^Ctrl\+Alt\+\d$/.test(key)],
  ["hotkeys.group.ctrlAltLetter", (key) => /^Ctrl\+Alt\+[A-Z]$/.test(key)],
];

export const controls = {
  "hotkeys.binding": ({ core }) => {
    const { t, ICONS, language } = core;
    const el = (tag, className, props = {}) => Object.assign(document.createElement(tag), { className, ...props });
    const icon = (name) => {
      const one = el("i", `bi bi-${ICONS[name] || name}`);
      one.setAttribute("aria-hidden", "true");
      return one;
    };

    // The key dropdown: every key the shell allows, grouped, the ones another
    // binding holds marked (choosing one moves it here).
    function fillKeys(select, keys, binding) {
      const signature = JSON.stringify([keys, binding.id, language()]);
      if (select.__signature !== signature) {
        select.__signature = signature;
        select.replaceChildren(el("option", "", { value: "", textContent: t("hotkeys.key.choose") }));
        for (const [label, test] of GROUPS) {
          const group = el("optgroup", "", { label: t(label) });
          for (const one of keys.filter((k) => test(k.key))) {
            const taken = one.usedBy && one.usedBy !== binding.id;
            group.append(el("option", "", { value: one.key, textContent: taken ? t("hotkeys.key.taken", { key: one.key }) : one.key }));
          }
          if (group.children.length) select.append(group);
        }
      }
      if (select.value !== binding.key) select.value = binding.key;
    }

    function update(row, desc) {
      const p = desc.params;
      const binding = p.binding || {};
      row.__params = p;
      row.__binding = binding;
      const [select, target] = row.children;
      fillKeys(select, p.keys || [], binding);
      const picking = p.picking === binding.id;
      const placed = Boolean(binding.app);
      let text;
      if (picking) text = t("hotkeys.target.picking");
      else if (binding.missing) text = t("hotkeys.target.missing", { id: `${binding.appName} · ${binding.at}` });
      else if (binding.offScreen) text = t("hotkeys.target.offScreen", { app: binding.appName, at: binding.at });
      else if (placed) text = `${binding.actionLabel} · ${binding.appName} › ${binding.targetLabel}`;
      else text = t("hotkeys.target.choose");
      const glyph = `bi bi-${placed ? binding.icon : "hand-index"}`;
      if (target.firstElementChild.className !== glyph) target.firstElementChild.className = glyph;
      const span = target.lastElementChild;
      if (span.textContent !== text) span.textContent = text;
      target.title = placed ? t("hotkeys.target.title") : "";
      target.classList.toggle("is-active", picking);
      target.classList.toggle("is-empty", !placed || binding.missing);
      row.classList.toggle("is-missing", Boolean(binding.missing));
    }

    return {
      render(desc) {
        const row = el("div", "hotkeys-row");
        const select = el("select", "select hotkeys-key");
        const target = el("button", "mu-item-button hotkeys-target", { type: "button" });
        target.append(icon("arrows-collapse"), el("span", "hotkeys-target-text"));
        row.append(select, target);
        select.addEventListener("change", () => row.__params.key({ id: row.__binding.id, key: select.value }));
        target.addEventListener("click", (event) => {
          event.stopPropagation();
          row.__params.pick({ id: row.__binding.id });
        });
        update(row, desc);
        return row;
      },
      update,
    };
  },
};
