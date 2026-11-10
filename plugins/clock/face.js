/* Clock -- the face (control `clock.face`, declared in controls/face.json).
 *
 * Deliberately *stateful*: it holds an interval, so it only behaves if
 * mount/unmount are honoured. Close its window and the timer has to stop; a
 * leaked interval here would be a leaked terminal or a leaked file watcher in
 * a bigger plugin. The time is read when the face is drawn, once a second,
 * and how it is shown comes from its arguments (the clock's own properties).
 */

const SVG = "http://www.w3.org/2000/svg";
const svgEl = (name, attrs = {}) => {
  const el = document.createElementNS(SVG, name);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, String(value));
  return el;
};
const html = (tag, className, extra = {}) => Object.assign(document.createElement(tag), { className, ...extra });

const digitalText = (now, settings) =>
  now.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: settings.seconds ? "2-digit" : undefined,
    hour12: settings.hours === "h12",
  });

function analogFace() {
  const svg = svgEl("svg", { viewBox: "-50 -50 100 100", class: "clock-analog", role: "img" });
  svg.append(svgEl("circle", { r: 48, class: "clock-dial" }));
  for (let i = 0; i < 60; i++) {
    const major = i % 5 === 0;
    const inner = major ? 40 : 44;
    const a = (i * 6 * Math.PI) / 180;
    svg.append(
      svgEl("line", {
        x1: Math.sin(a) * inner,
        y1: -Math.cos(a) * inner,
        x2: Math.sin(a) * 46,
        y2: -Math.cos(a) * 46,
        class: major ? "clock-tick is-major" : "clock-tick",
      })
    );
  }
  for (const [name, length] of [["hour", 24], ["minute", 36], ["second", 40]]) {
    svg.append(svgEl("line", { x1: 0, y1: 4, x2: 0, y2: -length, class: `clock-hand is-${name}` }));
  }
  svg.append(svgEl("circle", { r: 2, class: "clock-pivot" }));
  return svg;
}

export const controls = {
  "clock.face": ({ core }) => {
    const { t, ICONS } = core;

    // The face as it is now: the time is read here, and what the settings say.
    function draw(root) {
      const p = root.__desc.params;
      const now = new Date();
      const settings = {
        mode: p.mode === "analog" ? "analog" : "digital",
        hours: p.hours === "h12" ? "h12" : "h24",
        seconds: p.seconds !== false,
      };
      const analog = settings.mode === "analog";
      // An SVG element has no `hidden` property, only the attribute.
      root.__analog.toggleAttribute("hidden", !analog);
      root.__digital.hidden = analog;
      if (analog) {
        const s = now.getSeconds();
        const m = now.getMinutes() + s / 60;
        const h = (now.getHours() % 12) + m / 60;
        const hands = root.__analog.querySelectorAll(".clock-hand");
        hands[0].setAttribute("transform", `rotate(${h * 30})`);
        hands[1].setAttribute("transform", `rotate(${m * 6})`);
        hands[2].setAttribute("transform", `rotate(${s * 6})`);
        hands[2].style.display = settings.seconds ? "" : "none";
      } else {
        const text = digitalText(now, settings);
        if (root.__digital.textContent !== text) root.__digital.textContent = text;
      }
      const caption = root.querySelector(".clock-caption");
      caption.textContent = p.caption || "";
      caption.hidden = !p.caption;
      root.querySelector(".clock-zone").textContent = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
      const gear = root.querySelector(".clock-gear");
      gear.title = t("clock.action.settings");
      gear.hidden = typeof p.settings !== "function";
    }

    return {
      mount(host, desc) {
        const root = html("div", "clock-face");
        const gear = html("button", "mu-icon-button clock-gear", { type: "button" });
        gear.append(html("i", `bi bi-${ICONS.gear || "gear"}`));
        gear.addEventListener("click", (event) => {
          event.stopPropagation();
          const run = host.__desc && host.__desc.params.settings;
          if (typeof run === "function") run();
        });
        const middle = html("div", "clock-middle");
        middle.append(html("div", "clock-digital"), analogFace());
        root.append(gear, middle, html("div", "clock-caption"), html("div", "clock-zone"));
        host.append(root);
        host.__desc = desc;
        root.__desc = desc;
        root.__analog = middle.querySelector(".clock-analog");
        root.__digital = middle.querySelector(".clock-digital");
        host.__root = root;
        draw(root);
        // What changes between the draws is the clock: it asks for the next one itself.
        host.__timer = setInterval(() => draw(root), 1000);
      },
      update(host, desc) {
        host.__desc = desc;
        host.__root.__desc = desc;
        draw(host.__root);
      },
      unmount(host) {
        clearInterval(host.__timer);
      },
    };
  },
};
