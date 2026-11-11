/* Mullion -- the startup gate.
 *
 * Everything that registers -- the core's own types and every plugin's -- has
 * to match the current spec before the shell opens a layout. If anything does
 * not (a plugin that did not load, that lists what it did not register, that
 * declares a type the registry cannot hold together), the shell does not
 * start: it shows what is wrong, in the shell's own look, and opens and
 * writes nothing, so a layout it could not have read faithfully is never
 * saved back as something else.
 *
 * This decides; the page that says it is the screen's (view.showProblemPage),
 * the same page the server shows when it cannot open the data
 * (backend/problems.py).
 */

import { bodyProblems } from "./deps.js";
import { registryProblems } from "./deps.js";

// Every reason not to start: plugins that are not loaded, and what the
// registry found wrong with what is.
export function startupProblems(plugins) {
  const out = [];
  for (const one of plugins) {
    // Off in this profile is a choice, not a failure; one that needs the
    // server where there is none is said once at start (boot.js), not a stop.
    if (one.status !== "loaded" && one.status !== "disabled" && one.status !== "unavailable") out.push({ source: one.id, kind: one.status, message: one.error || one.status });
  }
  for (const one of registryProblems()) out.push({ source: one.source, kind: "spec", message: one.message });
  // Only once the registry holds together: a body is built from what it holds.
  if (!out.length) for (const one of bodyProblems()) out.push({ source: one.source, kind: "spec", message: one.message });
  return out;
}
