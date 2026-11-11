/* The shell window's title bar, as markup: one shape for every window that
 * has one -- frames' windows and groups, and the problem page, which is drawn
 * while frames is stopped. A change to the title bar is made here, once.
 *
 *   id        the label on the left (a window's id; "mullion" on the problem page)
 *   middle    markup for the title (frames: crumbs to be filled; the problem page: its title)
 *   actions   markup for the buttons on the right (none on the problem page)
 *   dragTitle the grip's tooltip
 *   draggable whether the grip starts a drag (only a live window can move)
 */
import { iconMarkup } from "./view.js";
import { escapeHtml } from "./pagesettings.js";

export function titlebarMarkup({ id = "", middle = "", actions = "", dragTitle = "", draggable = true } = {}) {
  return `<div class="mu-titlebar">` +
    `<span class="mu-drag-handle"${draggable ? ' draggable="true"' : ""} title="${escapeHtml(dragTitle)}">${iconMarkup("drag")}</span>` +
    `<span class="mu-window-id">${escapeHtml(id)}</span>` +
    middle +
    `<span class="mu-title-actions">${actions}</span>` +
    `</div>`;
}
