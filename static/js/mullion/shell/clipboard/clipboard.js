/* clipboard: the one way to the system clipboard. The browser gives it only
 * to a secure page that has the focus, and may refuse; so a write says whether
 * it went (true / false) instead of throwing, and a caller with nothing to show
 * for a failed copy can ignore it. Plugins have it as the permission
 * clipboard:write (shell/permissions). */
import { navigator } from "./deps.js";

const clip = () => (navigator && navigator.clipboard) || null;

/** Whether this page can write to the clipboard at all. */
export const available = () => Boolean(clip() && typeof clip().writeText === "function");

/** Writes `text`; resolves true when it went, false when the browser said no. */
export async function writeText(text) {
  if (!available()) return false;
  try {
    await clip().writeText(String(text ?? ""));
    return true;
  } catch {
    return false;
  }
}
