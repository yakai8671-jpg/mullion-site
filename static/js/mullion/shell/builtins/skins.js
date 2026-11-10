/* The skins the shell ships with.
 *
 * A skin is only a name and a label here; the look itself is a [data-skin]
 * block in static/css/skins.css. That is the whole mechanism -- selecting a
 * skin sets the attribute on the root element, so a plugin can add one by
 * shipping a stylesheet of its own and registering the name.
 */

import { registerSkin } from "./deps.js";

// Order is the order they appear in the settings. "prompt" is the house
// style and the default; "beta" is the plain look the shell was built with,
// kept because the other two are variations on it rather than on prompt.

// What this file registers, once the modules it uses are handed in (index.js).
export function install() {
  registerSkin("prompt", { label: "mu.skin.prompt" });
  registerSkin("beta", { label: "mu.skin.beta" });
  registerSkin("compact", { label: "mu.skin.compact" });
  registerSkin("framed", { label: "mu.skin.framed" });
}
