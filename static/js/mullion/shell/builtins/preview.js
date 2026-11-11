/* Preview (type id `preview`) -- whatever is carried to it, shown the way
 * its kind is shown.
 *
 * A window of its own for looking at something another window makes: an
 * app's output, a picture on a scratch board, a prompt editor's result. It
 * holds one value and the kind it came as ({kind, value}, a `portvalue`),
 * and takes any kind -- by the grip, pasted once or linked so that it
 * follows. What it shows follows what it holds: a picture or a video in an
 * image card, a list of pictures as that card's grid (one clicked fills
 * it), a voice in an audio card, and anything else as the text it reads as.
 *
 * Its card is a port in its own right: picked up again, it carries what it
 * holds as the kind it came as.
 *
 * A value type that carries a kind may draw it itself, with `portNodes`
 * ({api, item, ctx, port, value, set, clear, openChild} -> nodes): a property group is
 * shown as its entries, which can be added, renamed and taken out here.
 */

import { CONTROLS, describe, paramNames, portTypes, registerApp, registerItemType } from "./deps.js";
import { NODES, openScreen, portConvert, setKindNodes, registerPortConversion, t, unlinkPort } from "./deps.js";
import { coerceImageList } from "./deps.js";
import { diskAddress, mediaOfName } from "./deps.js";

// One picture is a list of one, and a list read as one picture is its
// first: so a single output can go where a batch is taken, and the other
// way round.

// A path to a file is a way to it: the address the server hands the file out
// at, which a card of that kind takes in like any other address. What the file
// is, is read off its name (media.js); a path to something else (a folder, a
// text) is no picture, no video, no voice, and gives none.
const servedAt = (path, media) => {
  const name = typeof path === "string" ? path.trim() : "";
  return name && mediaOfName(name).media === media ? diskAddress(name) : "";
};

// What a kind is called: the name of the type that carries it, else the
// kind itself.
function kindLabel(kind) {
  if (kind === "text") return t("mu.vtype.string");
  const type = portTypes().map(([, def]) => def).find((def) => def.port === kind);
  return type && type.label ? t(type.label) : kind;
}

// Find the value type that declares a preview for `kind`, or a previewable
// type that `kind` converts into (when `kind` has no preview or `portText` of
// its own).
function resolvePreview(kind, value) {
  if (!kind) return null;
  const direct = portTypes().find(([, def]) => def.port === kind && def.preview);
  if (direct) return { typeName: direct[0], typeDef: direct[1], kind, value };
  const hasPortText = portTypes().some(([, def]) => def.port === kind && typeof def.portText === "function");
  if (hasPortText) return null;
  for (const [typeName, typeDef] of portTypes()) {
    if (!typeDef.port || !typeDef.preview) continue;
    const converted = portConvert(value, kind, typeDef.port);
    if (converted !== null && converted !== undefined && converted !== "" && (!Array.isArray(converted) || converted.length > 0)) {
      return { typeName, typeDef, kind: typeDef.port, value: converted };
    }
  }
  return null;
}

// A value shown the way its kind is shown, read-only (unless its type's
// preview declares `editable: true` and `set` is given): a picture or a video
// in an image card, a list of pictures as that card's grid, a voice in an audio
// card, a type's own `preview` control or layout, and anything else as the text
// it reads as. `port` is where the card's grip takes it from, `clear` what its
// close button does (none: no button), `prefix` keeps the keys of two of these
// apart, `name` leads the keys of its nodes (two shown in one window need
// different ones); `label` is what the card is called, where the kind's name is
// not the one wanted. Offered to the plugins as the helper "kindNodes": the
// chain shows a run's result with it, the list items their list.
export function kindNodes({ kind, value, port, clear = null, set = null, api = null, prefix = "", name = "", empty = "", compact = false, label = null, readText = null }) {
  const nodes = [];
  const resolved = resolvePreview(kind, value);
  if (resolved) {
    const { typeName, typeDef, kind: shownKind, value: shownValue } = resolved;
    const preview = typeDef.preview;
    const writable = Boolean(preview.editable && typeof set === "function" && shownKind === kind);
    if (typeof preview.build === "function") {
      return preview.build({
        api,
        value: shownValue,
        port,
        clear,
        set: writable ? set : null,
        readonly: !writable,
        prefix: `${prefix}-${name}${shownKind}`,
        label: label ?? kindLabel(shownKind),
      }).map((node) => (name ? { ...node, key: `${name}${node.key}` } : node));
    }
    const controlName = preview.control;
    if (controlName === "imagecard") {
      const images =
        shownKind === "imagelist"
          ? coerceImageList(shownValue).map((one) => one.src)
          : typeof shownValue === "string" && shownValue
            ? [shownValue]
            : [];
      nodes.push(
        NODES.control(`${name}picture`, {
          control: "imagecard",
          port,
          images,
          showSize: false,
          fill: !compact,
          // The picture itself takes the room when the card fills the window.
          grow: true,
          // Looking at it is what this window is for: open large unless
          // shrunk by hand (an image card is shrunk until opened elsewhere).
          // Not so where it is only one part of a window (`compact`).
          defaultFull: !compact,
          empty: empty || t(shownKind ? "mu.preview.nothing" : "mu.preview.empty"),
          onClear: shownKind ? clear : null,
        })
      );
      return nodes;
    }
    if (controlName === "audiocard") {
      nodes.push(
        NODES.control(`${name}audio`, {
          control: "audiocard",
          port,
          src: typeof shownValue === "string" ? shownValue : "",
          empty: empty || t("mu.preview.nothing"),
          onClear: clear,
        })
      );
      return nodes;
    }
    const control = CONTROLS[controlName];
    const allowed = new Set(paramNames(control));
    const options = {};
    for (const [k, v] of Object.entries(preview.options || {})) {
      if (k !== "value") options[k] = v;
    }
    const key = controlName === "multitext" ? `${name}text` : `${name}preview`;
    const descKey = controlName === "multitext" ? `${prefix}-text-${shownKind}` : `${prefix}-preview-${shownKind}`;
    nodes.push(
      NODES.control(key, {
        control: controlName,
        ...(allowed.has("port") ? { port } : {}),
        ...(clear && allowed.has("onDiscard") ? { onDiscard: clear } : {}),
        ...(clear && !allowed.has("onDiscard") && allowed.has("onClear") ? { onClear: clear } : {}),
        ...(empty && allowed.has("empty") ? { empty } : {}),
        ...(allowed.has("fill") && options.fill === undefined ? { fill: !compact } : {}),
        ...(allowed.has("defaultFull") && options.defaultFull === undefined ? { defaultFull: !compact } : {}),
        ...options,
        grow: true,
        readonly: !writable,
        desc: describe(
          {
            ...(typeDef.defaults || {}),
            type: typeName,
            readonly: !writable,
            read: () => shownValue,
            ...(writable ? { write: (_api, next) => set(next) } : {}),
          },
          { api, key: descKey, label: label ?? kindLabel(shownKind) }
        ),
      })
    );
    return nodes;
  }

  // Anything else, as the text it reads as: a prompt list as its prompt,
  // tags as a line. What has no way to text is shown as it is stored.
  // A kind may say how it reads for showing (`portText`: a property group's
  // name, then its entries), apart from how it reads as text when carried.
  const shown = portTypes().map(([, def]) => def).find((def) => def.port === kind && typeof def.portText === "function");
  const text =
    typeof value === "string"
      ? value
      : shown
        ? shown.portText(value)
        : (portConvert(value, kind, "text") ?? JSON.stringify(value, null, 2) ?? "");
  nodes.push(
    NODES.control(`${name}text`, {
      control: "texteditor",
      port,
      onDiscard: clear,
      // The text takes the room when the card fills the window.
      grow: true,
      // Read-only: what is shown is what was carried, and is changed by
      // carrying something else here.
      desc: describe(
        { type: "string", readonly: true, read: () => String(readText ? readText() : text) },
        { key: `${prefix}-text-${kind}`, label: label ?? kindLabel(kind) }
      ),
    })
  );
  return nodes;
}

// A path is a place, not its contents. Recognize the file kinds the preview
// can show; other extensions get a guide. A video that a browser does not
// play (a .mov, a .mkv) is among them.
const PLAYED = new Set(["mp4", "webm", "m4v"]);
function filePreviewKind(path) {
  const { media, ext } = mediaOfName(typeof path === "string" ? path : "");
  return media === "video" && !PLAYED.has(ext) ? "" : media;
}

// What this file registers, once the modules it uses are handed in (index.js).
export function install() {
  registerPortConversion("image", "imagelist", (src) => (typeof src === "string" && src ? [{ id: "0", src }] : []));
  registerPortConversion("imagelist", "image", (list) => (coerceImageList(list)[0] || {}).src || "");
  for (const media of ["image", "video", "audio"]) registerPortConversion("filepath", media, (path) => servedAt(path, media));
  registerPortConversion("filepath", "imagelist", (path) => {
    const src = servedAt(path, "image");
    return src ? [{ id: "0", src }] : [];
  });
  setKindNodes(kindNodes);
  registerApp("preview", { home: "mullion", homeOrder: 30 });
  registerItemType("preview", {
    label: "mu.item.preview",
    standalone: true,
    icon: "eye",
    permissions: ["fs:read"],
    properties: {
      input: { label: "mu.prop.preview.input", type: "portvalue", placed: true },
    },

    mount(ctx) {
      ctx.filePreviewPath = null;
      ctx.filePreview = null;
    },

    unmount(ctx) {
      ctx.filePreviewPath = null;
    },

    update(ctx) {
      const held = ctx.get("input");
      const path = held && held.kind === "filepath" && typeof held.value === "string" ? held.value : "";
      if (ctx.filePreviewPath === path) return;
      ctx.filePreviewPath = path;
      ctx.filePreview = null;
      ctx.filePreviewMessage = path ? t("mu.preview.fileUnsupported") : t("mu.preview.nothing");
      const kind = filePreviewKind(path);
      if (kind === "text") {
        ctx.filePreviewMessage = t("mu.preview.fileLoading");
        ctx.api.fs.read(path).then((result) => {
          if (ctx.filePreviewPath !== path) return;
          ctx.filePreview = { kind, value: result.content };
          ctx.refresh();
        }).catch((error) => {
          if (ctx.filePreviewPath !== path) return;
          ctx.filePreviewMessage = error.message || String(error);
          ctx.refresh();
        });
      } else if (kind) {
        ctx.filePreview = { kind, value: ctx.api.fs.downloadUrl(path) };
      }
      ctx.refresh();
    },

    body(api, item, ctx) {
      const port = { item: item.id, key: "input" };
      const held = ctx.get("input") || { kind: "", value: null };
      const kind = held.kind || "";
      // Empty again: what it follows let go of, too.
      const clear = () => {
        unlinkPort(port);
        ctx.set("input", { kind: "", value: null });
      };

      if (kind === "filepath") {
        const current = typeof held.value === "string" ? held.value : "";
        const file = ctx.filePreviewPath === current ? ctx.filePreview : null;
        if (!file) {
          return [NODES.card("file-guide", t("mu.prop.preview.input"), [], [], {
            port, onDiscard: clear,
            empty: ctx.filePreviewPath === current ? (ctx.filePreviewMessage || t("mu.preview.nothing")) : t("mu.preview.fileLoading"),
          })];
        }
        return kindNodes({
          kind: file.kind, value: file.value, port, clear, prefix: item.id,
          readText: file.kind === "text" ? () => String((ctx.filePreview || {}).value ?? "") : null,
        });
      }

      // A kind whose type says how it is shown (`portNodes`: a property group,
      // with its entries to look after) draws itself; what it changes is
      // written back as the same kind.
      const own = kind && portTypes().map(([, def]) => def).find((def) => def.port === kind && typeof def.portNodes === "function");
      if (own) {
        return own.portNodes({
          api,
          item,
          ctx,
          port,
          value: held.value,
          set: (value) => ctx.set("input", { kind, value }),
          clear,
          // A kind's editing screens are opened one step along this window's path,
          // connected to this preview (their `preview`), which is what they write back to.
          openChild: (type) => openScreen(ctx.windowId, type, { props: { preview: item.id } }),
        });
      }

      // Nothing in it: a card that says what to do. It is the preview's port
      // like any card here, so what is carried to it is pasted or linked there.
      if (!kind) {
        return [
          NODES.card("guide", t("mu.prop.preview.input"), [], [], {
            icon: "eye",
            port,
            empty: t("mu.preview.empty"),
          }),
        ];
      }

      return kindNodes({
        kind,
        value: held.value,
        port,
        clear,
        set: (value) => ctx.set("input", { kind, value }),
        api,
        prefix: item.id,
      });
    },
  });
}
