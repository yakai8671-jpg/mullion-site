/* What the profile and the language do to the page: the theme and skin on the
 * root element, the icons drawn in that theme, the strings of static markup,
 * and a notice for what went wrong with nobody to ask. The profile itself is
 * server's, the strings i18n's; this is where they meet the page. */
import { document, t, language, settings } from "./deps.js";

/** Puts the profile's theme and skin on the root element; when the theme
 * changed, the icons (drawn per theme by backend/icons.py and cached like any
 * image) are fetched again so the favicon and the topbar follow. */
let appliedTheme = null;
export function applyTheme() {
  const theme = settings.get("theme", "dark");
  document.documentElement.dataset.theme = theme;
  document.documentElement.dataset.skin = settings.get("skin", "prompt");
  if (appliedTheme !== null && appliedTheme !== theme) refreshIcons();
  appliedTheme = theme;
}

function refreshIcons() {
  const bust = Date.now();
  const link = document.querySelector('link[rel="icon"]');
  if (link) link.setAttribute("href", `${link.getAttribute("href").split("?")[0]}?t=${bust}`);
  document.querySelectorAll("img.app-icon").forEach((img) => {
    img.setAttribute("src", `${img.getAttribute("src").split("?")[0]}?t=${bust}`);
  });
}

/** Translates static markup: data-i18n sets the text, data-i18n-title the
 * tooltip, data-i18n-placeholder the placeholder. Safe to run again, which
 * is what makes switching language without a reload possible. */
export function applyTranslations(root = document) {
  root.querySelectorAll("[data-i18n]").forEach((el) => {
    el.textContent = t(el.dataset.i18n);
  });
  root.querySelectorAll("[data-i18n-title]").forEach((el) => {
    el.title = t(el.dataset.i18nTitle);
  });
  root.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
    el.placeholder = t(el.dataset.i18nPlaceholder);
  });
  document.documentElement.lang = language();
}

/** A notice, for what went wrong with nobody to ask. Not a dialog: it covers
 * nothing, goes by itself and goes at a click. Asking something of someone is
 * done in the window the question is about (ctx.confirm, ctx.prompt). */
export function toast(message, { ms = 8000 } = {}) {
  let host = document.querySelector(".mu-toasts");
  if (!host) {
    host = Object.assign(document.createElement("div"), { className: "mu-toasts" });
    document.body.appendChild(host);
  }
  const el = Object.assign(document.createElement("div"), { className: "mu-toast", textContent: String(message || "") });
  el.addEventListener("click", () => el.remove());
  host.append(el);
  setTimeout(() => el.remove(), ms);
}

const HTML_ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
/** Text made safe to put into markup, attributes included. */
export const escapeHtml = (str) => String(str ?? "").replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
