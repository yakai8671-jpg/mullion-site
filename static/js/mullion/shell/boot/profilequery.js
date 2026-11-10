/* Mullion -- the profile a page asks for.
 *
 * `/?profile=work` opens Mullion on the profile `work` (its id, or its name): if the server has
 * another one open, it is started again with that one asked for -- the default is not changed,
 * and a server started afresh opens the default again -- and the page is read again when it
 * answers. The address is cleaned first, so a reload (or a switch made from the Profiles list)
 * is not asked the same thing twice. A server that was started on one data directory
 * (MULLION_DATA_DIR) has no profiles, and a profile that is not there is said and left.
 *
 * Run before anything reads the library: the library is the profile's.
 */

import { t, window, fetchJSON, toast } from "./deps.js";

const same = (one, text) => {
  const wanted = String(text).trim();
  return one.id === wanted || Boolean(one.name && one.name.toLocaleLowerCase() === wanted.toLocaleLowerCase());
};

export async function followProfileQuery(loading) {
  const url = new URL(window.location.href);
  const asked = url.searchParams.get("profile");
  if (asked === null) return;
  url.searchParams.delete("profile");
  const clean = `${url.pathname}${url.search}${url.hash}`;
  window.history.replaceState(window.history.state, "", clean);
  if (!asked.trim()) return;

  const say = (message) => {
    console.warn(`[mullion] ?profile=${asked}: ${message}`);
    toast(message);
  };
  let state;
  try {
    state = await fetchJSON("/api/profiles", { cache: "no-store" });
  } catch (error) {
    return say(error.message);
  }
  if (state.locked) return say(t("mu.profile.queryLocked"));
  // The id first, then the name: an id is never another profile's name by accident.
  const entry = state.profiles.find((one) => one.id === asked.trim()) || state.profiles.find((one) => same(one, asked));
  if (!entry) return say(t("mu.profile.queryUnknown", { name: asked }));
  if (entry.active) return;

  loading.step(30, "mu.loading.profile", { name: entry.name || t("mu.profile.default") });
  let was;
  try {
    was = (await fetchJSON("/api/profiles/activate", { method: "POST", body: { id: entry.id } })).boot;
  } catch (error) {
    return say(error.message);
  }
  const until = Date.now() + 90000;
  while (Date.now() < until) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    try {
      const body = await fetchJSON("/api/control/status", { cache: "no-store" });
      if (body && body.boot && body.boot !== was) {
        window.location.replace(clean);
        // The page is being read again: nothing after this one is started.
        return new Promise(() => {});
      }
    } catch {
      // Down between the old server and the new one: keep asking.
    }
  }
  say(t("mu.status.restartFailed"));
}
