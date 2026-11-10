/* File Manager declarative scripts: the listing the browser keeps, what the other two screens do, and the control that draws the browser. */

// What the disk said of each browser's folder, by item: asked again whenever the folder changes, kept while the
// window is there, never saved.
const LISTINGS = new Map();

export function setListing(itemId, listing) {
  if (listing) LISTINGS.set(itemId, listing);
  else LISTINGS.delete(itemId);
}

export function getListing(itemId) {
  return LISTINGS.get(itemId);
}

function size(entry, t) {
  if (entry.is_dir) return t("files.value.folder");
  const bytes = entry.size;
  if (bytes == null) return "";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
}

export const derived = {
  selectedPath: (_api, item) => {
    const listing = LISTINGS.get(item && item.id);
    const found = listing && listing.entries?.find((entry) => entry.name === item?.props?.selected);
    return found ? found.path : "";
  },
};

// ---- what it does ------------------------------------------------------------------------------
export const actions = {
  // The two small screens, opened along this window's path with the place they work on.
  "files.openmkdir": {
    async run({ path }, { api }) {
      api.window.openScreen("files.mkdir", { path });
      return {};
    },
  },
  "files.openinfo": {
    async run({ path }, { api }) {
      api.window.openScreen("files.info", { path });
      return {};
    },
  },
  // Something the browser has to say to the person.
  "files.say": {
    async run({ key, error }, { status }) {
      status(key, { error });
      return {};
    },
  },
  "files.mkdir": {
    async run({ path, name }, { api, status }) {
      const named = String(name || "").trim();
      if (!named) {
        status("files.status.needName");
        return {};
      }
      try {
        await api.fs.mkdir(path, named);
        status("files.status.created", { name: named });
      } catch (error) {
        status("files.status.failed", { error: error.message || String(error) });
      }
      return {};
    },
  },
  "files.rename": {
    async run({ path, name }, { api, status }) {
      const named = String(name || "").trim();
      if (!path) {
        status("files.status.needSelection");
        return {};
      }
      if (!named) {
        status("files.status.needName");
        return {};
      }
      try {
        const result = await api.fs.rename(path, named);
        status("files.status.renamed", { name: named });
        return result && result.path ? { path: result.path } : {};
      } catch (error) {
        status("files.status.failed", { error: error.message || String(error) });
        return {};
      }
    },
  },
  "files.delete": {
    async run({ path }, { api, status, confirm, t }) {
      if (!path) {
        status("files.status.needSelection");
        return {};
      }
      const ok = await confirm("files.confirm.delete", { name: path }, { title: "files.confirm.deleteTitle", okText: t("files.action.delete"), danger: true });
      if (!ok) return {};
      try {
        await api.fs.remove(path);
        status("files.status.deleted", { name: path });
        return { path: "" };
      } catch (error) {
        status("files.status.failed", { error: error.message || String(error) });
        return {};
      }
    },
  },
};

// ---- the browser -------------------------------------------------------------------------------
// The folder and what is picked in it are properties; the listing is what the disk says right now, so it is
// asked for again whenever the folder changes and kept by item (LISTINGS), not saved. The whole body is
// drawn here: what is in it comes from the disk.
const ASKED = new Map(); // item id -> the folder last asked of the disk

export const screens = {
  "files.browser": (fw) => {
    const { NODES, t } = fw.core;
    const { describe } = fw;
    return {
      body(screen) {
        const itemId = screen.item.id;
        const live = () => ({ path: String(screen.read("path") || ""), selected: String(screen.read("selected") || ""), mode: screen.read("view") });
        const p = live();
        const path = p.path;
        if (ASKED.get(itemId) !== path) {
          ASKED.set(itemId, path);
          setListing(itemId, null);
          screen.api.fs
            .list(path)
            .then((listing) => {
              if (ASKED.get(itemId) !== path) return;
              setListing(itemId, listing);
              fw.core.refreshAll();
            })
            .catch((error) => {
              if (ASKED.get(itemId) !== path) return;
              setListing(itemId, { path, parent: null, entries: [] });
              screen.run("say", { key: "files.status.failed", error: error.message || String(error) });
              fw.core.refreshAll();
            });
        }
        const listing = getListing(itemId) || null;
        const entries = listing ? listing.entries : [];
        const chosen = entries.find((entry) => entry.name === p.selected);
        const goTo = (to) => {
          screen.set("path", to);
          screen.set("selected", "");
        };
        const reload = () => {
          ASKED.delete(itemId);
          fw.core.refreshAll();
        };
        const addressValue = describe(
          {
            type: "filepath",
            placeholder: "files.placeholder.path",
            read: () => {
              const now = getListing(itemId);
              const current = now && now.entries.find((entry) => entry.name === live().selected && !entry.is_dir);
              return current ? current.path : live().path;
            },
            write: (_api, value) => goTo(value),
          },
          { api: screen.api, key: `${itemId}-address`, label: t("files.prop.path") }
        );
        const address = NODES.card("address", "", [NODES.control("folder", { desc: addressValue })], [], {
          side: true,
          port: { item: itemId, key: chosen && !chosen.is_dir ? "selectedPath" : "path" },
        });
        const view = describe(
          {
            type: "enum",
            control: "segments",
            options: ["list", "grid"],
            read: () => (live().mode === "grid" ? "grid" : "list"),
            write: (_api, value) => screen.set("view", value),
          },
          { api: screen.api, key: `${itemId}-view`, label: t("mu.prop.dashboard.view") }
        );
        const controlsBar = [
          address,
          NODES.control("mkdir", { control: "iconbutton", icon: "folder-plus", title: t("files.item.mkdir"), run: () => screen.run("openmkdir", { path: live().path }) }),
          NODES.control("info", { control: "iconbutton", icon: "info-circle", title: t("files.item.info"), run: () => screen.run("openinfo", { path: chosen ? chosen.path : "" }) }),
          NODES.control("refresh", { control: "iconbutton", icon: "arrow-clockwise", title: t("files.action.refreshTitle"), run: reload }),
          NODES.control("view", { desc: view }),
        ];
        const choose = (value) => {
          const now = getListing(itemId);
          if (value === ".." && now && now.parent !== null) return goTo(now.parent);
          const entry = now && now.entries.find((one) => one.name === value);
          if (entry && entry.is_dir) return goTo(entry.path);
          screen.set("selected", live().selected === value ? "" : value);
        };
        const rows = [...(listing && listing.parent !== null ? [{ name: "..", path: listing.parent, is_dir: true }] : []), ...entries];
        const picker = describe(
          {
            type: "string",
            control: "picker",
            bare: true,
            entries: rows.map((entry) => ({ id: entry.name, primary: entry.is_dir ? `${entry.name}/` : entry.name, secondary: entry.name === ".." ? "" : size(entry, t) })),
            selected: p.selected,
            read: () => live().selected,
            write: (_api, value) => choose(value),
          },
          { api: screen.api, key: `${itemId}-listing`, label: t("files.item.browser") }
        );
        // The list is the one thing in the card, so it is what takes the room when the card fills the window.
        const grown = (node) => ({ ...node, params: { ...(node.params || {}), grow: true } });
        const list =
          p.mode === "grid"
            ? grown(
                NODES.gallery(
                  "list",
                  rows.map((entry) => ({
                    key: entry.name,
                    label: entry.is_dir ? `${entry.name}/` : entry.name,
                    icon: entry.name === ".." ? "arrow-up" : entry.is_dir ? "folder" : "file-earmark",
                    title: entry.name === ".." ? t("files.action.upTitle") : [entry.name, size(entry, t)].filter(Boolean).join(" · "),
                    active: entry.name === p.selected,
                    run: () => choose(entry.name),
                  })),
                  "grid"
                )
              )
            : NODES.control("list", { desc: picker, grow: true });
        return [NODES.card("files", t("files.section.list"), [list], [], { port: { item: itemId, key: "selectedPath" }, bar: controlsBar })];
      },
    };
  },
};
