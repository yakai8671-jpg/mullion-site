/* The buttons on the page that says Mullion cannot start (backend/problems.py).
 * Each button runs the action it names on the server, shows the server's log
 * as it comes back, and opens the shell again once the problem is gone. It
 * stands alone: nothing of the shell is loaded on that page. */
(function () {
  var words = {};
  try {
    words = JSON.parse(document.currentScript.dataset.words || "{}");
  } catch (error) {
    words = {};
  }

  // Available even when the shell never finished loading.
  window.muProblemRestart = function (section, labels) {
    var wrap = document.createElement("div");
    wrap.className = "mu-problem-action";
    var button = document.createElement("button");
    button.type = "button";
    button.className = "btn btn-primary";
    var mark = document.createElement("i");
    mark.className = "bi bi-arrow-clockwise";
    var label = document.createElement("span");
    label.textContent = labels.restart;
    var status = document.createElement("p");
    status.setAttribute("role", "status");
    wrap.append(button, status);
    button.append(mark, label);
    section.append(wrap);
    button.addEventListener("click", async function () {
      if (!window.confirm(labels.confirm)) return;
      button.disabled = true;
      label.textContent = labels.working;
      mark.className = "bi bi-arrow-repeat";
      status.textContent = "";
      try {
        var response = await fetch("/api/control/restart", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
        if (!response.ok) throw new Error("restart failed");
        var old = (await response.json()).boot;
        if (!old) throw new Error("missing boot id");
        var until = Date.now() + 90000;
        while (Date.now() < until) {
          await new Promise(function (resolve) { setTimeout(resolve, 500); });
          try {
            var check = await fetch("/api/control/status", { cache: "no-store" });
            if (check.ok && (await check.json()).boot !== old) { location.reload(); return; }
          } catch (_) { /* Server is restarting. */ }
        }
        throw new Error("restart timed out");
      } catch (_) {
        button.disabled = false;
        label.textContent = labels.restart;
        mark.className = "bi bi-arrow-clockwise";
        status.textContent = labels.restartFailed || labels.failed;
      }
    });
  };
  var restartSection = document.querySelector("[data-problem-restart]");
  if (restartSection) window.muProblemRestart(restartSection, words);

  function icon(button, name) {
    var mark = button.querySelector("i");
    if (mark) mark.className = "bi bi-" + name;
  }

  function show(log, lines) {
    log.hidden = !lines.length;
    log.replaceChildren();
    lines.forEach(function (line) {
      var row = document.createElement("div");
      if (line.error) row.className = "is-error";
      row.textContent = line.text;
      log.append(row);
    });
    log.scrollTop = log.scrollHeight;
  }

  document.querySelectorAll("[data-problem-action]").forEach(function (button) {
    var section = button.closest(".mu-problem-section");
    var log = section.querySelector(".mu-problem-log");
    var label = button.querySelector("span");
    var first = label.textContent;
    var firstIcon = (button.querySelector("i") || {}).className || "";
    var result = document.createElement("p");
    result.className = "mu-problem-result";
    result.setAttribute("role", "status");
    result.hidden = true;
    section.insertBefore(result, log);

    function say(text, state) {
      result.hidden = !text;
      result.textContent = text || "";
      result.dataset.state = state || "";
    }

    function failed(text, lines) {
      button.disabled = false;
      label.textContent = words.again || first;
      icon(button, "arrow-clockwise");
      say(text, "failed");
      if (lines) show(log, lines);
    }

    button.addEventListener("click", function () {
      button.disabled = true;
      label.textContent = words.working || "…";
      icon(button, "arrow-repeat");
      say("", "");
      show(log, []);
      fetch("/api/problem/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: button.dataset.problemAction }),
      })
        .then(function (res) {
          return res.json();
        })
        .then(function (data) {
          show(log, data.log || []);
          if (data.resolved) {
            label.textContent = words.done || "";
            icon(button, "check-lg");
            say(words.done, "ok");
            setTimeout(function () {
              location.reload();
            }, 1200);
          } else {
            failed(words.failed, null);
          }
        })
        .catch(function () {
          failed(words.offline, null);
        });
    });

    button.querySelector("i").className = firstIcon;
  });
})();
