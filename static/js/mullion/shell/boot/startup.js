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
 * It is the same page the server shows when it cannot open the data
 * (backend/problems.py), drawn here because the checks are made by the
 * registry, in the browser.
 */

import { bodyProblems, t, document, window } from "./deps.js";
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

const make = (tag, className = "", props = {}) => Object.assign(document.createElement(tag), { className, ...props });

// The whole page: the shell's window, with what was found, and what to do.
export function showStartupProblems(problems) {
  if (!document.querySelector('link[data-startup-style]')) {
    const style = make("link", "", { rel: "stylesheet", href: new URL("../../../../css/problem.css", import.meta.url).href });
    style.dataset.startupStyle = "1";
    document.head.append(style);
  }
  document.title = `Mullion — ${t("mu.startup.window")}`;

  const facts = make("div", "mu-problem-facts");
  for (const one of problems) {
    const row = make("div", "mu-problem-fact");
    row.dataset.state = "failed";
    const dot = make("span", "mu-statusrow-dot");
    dot.dataset.state = "failed";
    row.append(
      dot,
      make("span", "mu-problem-fact-label", { textContent: `${one.source} · ${t(`mu.startup.kind.${one.kind}`)}` }),
      make("span", "mu-problem-fact-value", { textContent: one.message })
    );
    facts.append(row);
  }

  const steps = make("ol");
  for (const key of ["mu.startup.step1", "mu.startup.step2"]) steps.append(make("li", "", { textContent: t(key) }));

  const main = make("main", "mu-problem");
  main.setAttribute("role", "alert");
  main.append(
    Object.assign(make("header", "mu-problem-head"), {}),
    Object.assign(make("section", "mu-problem-section"), {}),
    Object.assign(make("section", "mu-problem-section"), {})
  );
  const [head, found, how] = main.children;
  head.append(make("h1", "", { textContent: t("mu.startup.title") }), make("p", "", { textContent: t("mu.startup.body") }));
  found.append(make("h2", "", { textContent: t("mu.startup.found", { n: problems.length }) }), facts);
  how.append(make("h2", "", { textContent: t("mu.startup.how") }), steps);
  const restart = make("section", "mu-problem-section");
  main.append(restart);
  window.muProblemRestart(restart, { restart: t("mu.action.restart"), confirm: t("mu.confirm.restartBody"), working: t("mu.status.restarting"), restartFailed: t("mu.status.restartFailed") });

  const titlebar = make("header", "mu-titlebar");
  titlebar.append(
    make("span", "mu-drag-handle", { innerHTML: '<i class="bi bi-grip-vertical"></i>' }),
    make("span", "mu-window-id", { textContent: "mullion" }),
    Object.assign(make("div", "mu-window-title"), {
      innerHTML: '<i class="bi bi-exclamation-triangle-fill mu-problem-icon"></i>',
    })
  );
  titlebar.querySelector(".mu-window-title").append(make("span", "mu-problem-window-title", { textContent: t("mu.startup.window") }));
  const body = make("div", "mu-body");
  body.append(main);
  const win = make("section", "mu-window is-focused");
  win.dataset.problem = "startup";
  win.append(titlebar, body);
  const stage = make("div", "mu-stage");
  stage.append(win);
  const content = make("div", "app-content");
  content.append(stage);
  const shell = make("div", "app-shell");
  shell.append(content);
  document.body.replaceChildren(shell);
}
