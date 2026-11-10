import { coercePanorama } from "./value.js";

const PANORAMA = "panorama";

export const types = {
  panorama: {
    coerce: (value) => coercePanorama(value),
    defaultValue: (p) => coercePanorama(p?.default),
    format: (value, params, { t } = {}) => {
      const held = coercePanorama(value);
      if (!held) return t ? t("mu.value.noImage") : "No image";
      return held.depth
        ? (t ? t("panorama.value.withDepth") : "With depth")
        : (t ? t("panorama.value.noDepth") : "Picture only");
    },
    portWrite: (value, kind) =>
      kind === PANORAMA ? coercePanorama(value) : coercePanorama({ image: typeof value === "string" ? value : "" }),
    methods: {
      src: (p) => (coercePanorama(p.get()) || {}).image || "",
      hasDepth: (p) => Boolean((coercePanorama(p.get()) || {}).depth),
    },
    supplies: {
      image: (value, params, { t }) => {
        const held = coercePanorama(value);
        return held
          ? [{ name: held.name || (t ? t("panorama.vtype.panorama") : "Panorama"), value: held.image }]
          : [];
      },
    },
  },
};

export const controls = {
  "panorama.card": (api) => {
    const core = api?.core || {};
    const t = core.t || ((k) => k);
    const icon = (name) =>
      Object.assign(document.createElement("i"), { className: `bi bi-${core.ICONS?.[name] || name}` });

    return {
      render(desc) {
        const el = document.createElement("div");
        el.className = "panorama-card";
        const img = Object.assign(document.createElement("img"), { alt: "", draggable: false });
        const badge = Object.assign(document.createElement("span"), { className: "panorama-card-badge" });
        badge.append(icon("badge-3d"), document.createTextNode(t("panorama.value.withDepth")));
        el.append(img, badge);
        this.update(el, desc);
        return el;
      },
      update(el, desc) {
        const src = desc.property && desc.property.src ? desc.property.src() : "";
        const img = el.firstElementChild;
        if (img.getAttribute("src") !== src) {
          if (src) img.setAttribute("src", src);
          else img.removeAttribute("src");
        }
        el.classList.toggle("is-empty", !src);
        el.lastElementChild.hidden = !(desc.property && desc.property.hasDepth && desc.property.hasDepth());
      },
    };
  },
};
