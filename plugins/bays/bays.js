/* Bays -- what its declarations (items/manager.json) cannot say.
 *
 * A bay is one place on screen; its sashes are sets of windows, one of them
 * in that place at a time. The bays are the shell's own, kept with the
 * layout: this app holds nothing of its own -- the list is what bays:read says
 * now (`derived`) -- and every change goes through bays:write (`actions`).
 *
 * The list is a card per bay, and in each a card per sash: its windows as the
 * layout preview draws them, and its primary button to make it the one shown.
 * Adding a sash makes it the shown one, empty -- the bay's placeholder, for
 * windows to be dropped on -- and if the bay is not on screen yet, the place
 * guides come up to say where it goes.
 */

const SLIDES = ["auto", "left", "right", "up", "down"];
const SLIDE_ICON = { auto: "arrows-move", left: "arrow-left", right: "arrow-right", up: "arrow-up", down: "arrow-down" };

// ---- the bays, as the manager reads them -----------------------------------
export const derived = {
  // Each bay with what its card shows; its sashes with theirs. Written back,
  // only their order changes: a sash card's grip puts it among its bay's.
  "bays.list": {
    read: (api, _item, { t }) =>
      api.bays.list().map((bay) => {
        const slide = bay.slide || "auto";
        return {
          id: bay.id,
          name: bay.name,
          placed: Boolean(bay.placed),
          offScreen: !bay.placed,
          slide,
          title: `${bay.name}${bay.placed ? "" : ` · ${t("bays.value.offScreen")}`}`,
          slideIcon: SLIDE_ICON[slide] || SLIDE_ICON.auto,
          slideTitle: `${t("bays.action.slide")}: ${t(`bays.slide.${slide}`)}`,
          sashes: bay.sashes.map((sash) => ({
            id: sash.id,
            bay: bay.id,
            title: sash.label || t("bays.value.emptySash"),
            tree: sash.tree || null,
            hasTree: Boolean(sash.tree),
            active: Boolean(sash.active),
            shownLabel: t(sash.active ? "bays.value.shown" : "bays.action.activate"),
            shownIcon: sash.active ? "check2-circle" : "play-fill",
            unit: sash.unit || "",
            noUnit: !sash.unit,
            windows: sash.windows || 0,
          })),
        };
      }),
    write: (api, value) => {
      for (const bay of Array.isArray(value) ? value : []) {
        api.bays.order(bay.id, (bay.sashes || []).map((sash) => sash.id));
      }
    },
  },
};

// ---- what it does ----------------------------------------------------------
const place = (api, id, status) => {
  api.bays.place(id);
  status("bays.status.place");
};

export const actions = {
  "bays.add": { async run(_inputs, { api }) { api.bays.add(); return {}; } },
  "bays.remove": {
    async run({ id, name }, { api, confirm }) {
      if (await confirm("bays.confirm.removeBay", { name }, { title: name, danger: true })) api.bays.remove(id);
      return {};
    },
  },
  "bays.rename": {
    async run({ id, name }, { api, prompt, confirm: _confirm }) {
      const given = await prompt("bays.prompt.name", {}, { title: name, value: name });
      const next = given == null ? "" : String(given).trim();
      if (next) api.bays.rename(id, next);
      return {};
    },
  },
  // One press moves along: each press is the next way, round to the first.
  "bays.slide": {
    async run({ id, slide }, { api, status }) {
      const next = SLIDES[(SLIDES.indexOf(slide || "auto") + 1) % SLIDES.length];
      api.bays.setSlide(id, next);
      status(`bays.slide.${next}`);
      return {};
    },
  },
  "bays.place": { async run({ id }, { api, status }) { place(api, id, status); return {}; } },
  "bays.unplace": { async run({ id }, { api }) { api.bays.unplace(id); return {}; } },
  "bays.addSash": {
    async run({ id }, { api, status }) {
      const made = api.bays.addSash(id);
      if (!made.placed) place(api, id, status);
      return {};
    },
  },
  "bays.removeSash": {
    async run({ bay, id, title, windows }, { api, confirm }) {
      if (windows && !(await confirm("bays.confirm.removeSash", { name: title, n: windows }, { title, danger: true }))) return {};
      api.bays.removeSash(bay, id);
      return {};
    },
  },
  "bays.activate": { async run({ bay, id }, { api }) { api.bays.activate(bay, id); return {}; } },
  "bays.unregister": { async run({ bay, id, unit }, { api }) { api.bays.unregister(bay, id, unit); return {}; } },
};
