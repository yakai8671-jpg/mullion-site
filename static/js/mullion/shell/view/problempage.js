/* The page that says why the shell did not start (boot's startupProblems
 * found something): the shell's own look, drawn without the shell -- frames
 * and mount are what was stopped. It is the same page the server shows when
 * it cannot open the data (backend/problems.py).
 *
 * `problems`: [{ source, kind, message }]. */
import { document, t, preloadedProblemRestart } from "./deps.js";
import { titlebarMarkup } from "./chrome.js";
import { escapeHtml } from "./pagesettings.js";

const make = (tag, className = "", props = {}) => Object.assign(document.createElement(tag), { className, ...props });

// The whole page: the shell's window, with what was found, and what to do.
export function showProblemPage(problems) {
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
  // The restart button is problem.js's (the server's own problem page has it too), handed in by preload.
  const addRestart = preloadedProblemRestart();
  if (addRestart) addRestart(restart, { restart: t("mu.action.restart"), confirm: t("mu.confirm.restartBody"), working: t("mu.status.restarting"), restartFailed: t("mu.status.restartFailed") });

  // The shell's title bar (view/chrome.js), without its buttons: nothing here can move or close.
  const win = make("section", "mu-window is-focused");
  win.dataset.problem = "startup";
  win.innerHTML = titlebarMarkup({
    id: "mullion",
    draggable: false,
    middle: `<span class="mu-window-title"><i class="bi bi-exclamation-triangle-fill mu-problem-icon"></i><span class="mu-problem-window-title">${escapeHtml(t("mu.startup.window"))}</span></span>`,
  });
  const body = make("div", "mu-body");
  body.append(main);
  win.append(body);
  const stage = make("div", "mu-stage");
  stage.append(win);
  const content = make("div", "app-content");
  content.append(stage);
  const shell = make("div", "app-shell");
  shell.append(content);
  document.body.replaceChildren(shell);
}
