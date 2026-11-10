/* Mullion -- a declarative plugin, built and registered.
 *
 * A plugin whose manifest says `"api": 1` has no entry module: the server reads
 * its files (items, apps, translations; JSONC) and hands them over with the
 * manifest (`declarations`, see backend/handlers/plugins_api.py). Here they are
 * checked and compiled (compile-item.js), and registered through the same
 * surface a plugin written in code is given (surfaceFor in plugins.js), so the
 * manifest binds them just as it binds code: only what `provides` lists, only
 * the permissions it declares.
 *
 * Every problem in every file is collected first, with the file and where in
 * it; one is enough for the plugin not to load (the shell reports it as it
 * reports a plugin whose code throws).
 *
 * Action declarations and their item bindings are checked before importing
 * action scripts. Registration happens only after both pass.
 */

import { compileApp } from "./compile-app.js";
import { compileItem } from "./compile-item.js";
import { prepareActions } from "./action-registry.js";
import { compileControls, loadControlScripts } from "./compile-control.js";
import { compileTypePreviews, compileTypes, loadTypeScripts } from "./compile-type.js";
import { VALUE_ADAPTERS } from "./value-adapters.js";
import { ACTIONS, ITEM_FACTORIES, bindElementByIdentity, bindProperty, bindSpec, defaultFor, describe, describeProperty, elementIdentity, paramNames } from "./registry.js";

export const API_VERSIONS = [1];

// `env`: { controls, valueTypes, NODES, t } -- the registry's tables and the
// node helpers, handed in rather than imported, as compile-item.js wants.
export async function buildPlugin(manifest, surface, env) {
  env = {
    actions: ACTIONS,
    ...env,
    manifest,
    itemTypes: surface.types,
    valueAdapters: VALUE_ADAPTERS,
    bindProperty,
    bindSpec,
    defaultFor,
    describe,
    bindElementByIdentity,
    describeProperty,
    elementIdentity,
    paramNames,
    portConvert: env.portConvert ?? surface?.core?.portConvert,
    canConvertPort: env.canConvertPort ?? surface?.core?.canConvertPort,
    HOTKEY_ACTIONS: env.HOTKEY_ACTIONS ?? surface?.core?.HOTKEY_ACTIONS,
    // Values the plugin's scripts make (`export const derived`), filled once they are imported.
    derivedScripts: new Map(),
    // What items draw their whole body with (`export const screens`), filled once they are imported.
    screenScripts: new Map(),
  };
  const declarations = manifest.declarations || {};
  const problems = [];
  const { valueTypes, definitions: typeDefinitions } = compileTypes(manifest, env, problems);
  const { registered, actions, load } = prepareActions(manifest, { ...env, valueTypes }, problems);
  const { controls, definitions } = compileControls(manifest, { ...env, valueTypes, actions }, problems);
  compileTypePreviews(typeDefinitions, valueTypes, controls, env, problems);
  if (problems.length) throw new Error(problems.join("\n"));

  const items = [];
  // Derived items with hooks are built once the scripts are imported -- and the
  // scripts only after every item declaration is checked (below).
  const deferred = [];
  const modules = [];
  const importModule = async (file) => {
    const module = await env.importScript(file);
    if (module.initialize !== undefined) {
      if (typeof module.initialize !== "function") throw new Error(`${file}: initialize must be a function`);
      await module.initialize({ core: surface.core, controls: surface.controls, valueTypes: surface.valueTypes, types: surface.types, describe: surface.describe, describeProperty: surface.describeProperty, grouping: surface.grouping, card: surface.card, registerPermission: surface.registerPermission, backend: surface.backend, granted: surface.granted });
    }
    return { file, module };
  };
  const assets = new Map((declarations.assets || []).map(({ file, data }) => [file, data]));
  const declared = new Set();
  const provided = new Set(manifest.provides?.itemTypes || []);
  const accept = (file, result) => {
    for (const one of result.problems) problems.push(`${file}: ${one}`);
    if (result.def?.permissions.some((permission) => !manifest.permissions?.includes(permission))) {
      problems.push(`${file}: permissions: item asks for a permission missing from its manifest`);
    }
    if (result.def) items.push(result);
  };
  for (const { file, data } of declarations.items || []) {
    const name = data?.id;
    if (!provided.has(name) || declared.has(name)) problems.push(`${file}: id: expected a unique item in provides.itemTypes`);
    declared.add(name);
    if (Object.hasOwn(data, "extends") && Object.hasOwn(data, "hooks")) {
      deferred.push({ file, data });
      continue;
    }
    accept(file, Object.hasOwn(data, "extends")
      ? compileDerivedItem(data, manifest, surface, assets)
      : compileItem(data, { ...env, valueTypes, controls, actions }));
  }
  for (const name of provided) if (!declared.has(name)) problems.push(`provides.itemTypes: "${name}" has no declaration`);
  if (deferred.length) {
    if (problems.length) throw new Error(problems.join("\n"));
    for (const file of declarations.scripts || []) modules.push(await importModule(file));
    for (const { file, data } of deferred) accept(file, compileDerivedItem(data, manifest, surface, assets, modules));
  }
  const apps = [];
  const declaredApps = new Map();
  for (const { data } of declarations.apps || []) {
    if (data && typeof data.type === "string" && declared.has(data.type)) {
      declaredApps.set(data.type, data.type);
    }
  }
  const seenAppTypes = new Set();
  for (const { file, data } of declarations.apps || []) {
    const result = compileApp(data, { items, declared, declaredApps, valueTypes, env });
    for (const one of result.problems) problems.push(`${file}: ${one}`);
    if (result.type && seenAppTypes.has(result.type)) {
      problems.push(`${file}: type: duplicate app declaration for "${result.type}"`);
    }
    if (result.type) seenAppTypes.add(result.type);
    if (result.app) apps.push({ type: result.type, app: result.app });
  }
  if (problems.length) throw new Error(problems.join("\n"));
  if (!deferred.length) for (const file of declarations.scripts || []) modules.push(await importModule(file));
  load(modules);
  // The values items read from the scripts: each declared one exported once, nothing exported unread.
  // A name ending in "!" is a value declared writable: its export must be { read, write }.
  const writableNames = new Set(items.flatMap((one) => one.derivedScripts || []).filter((one) => one.endsWith("!")).map((one) => one.slice(0, -1)));
  const wanted = new Set(items.flatMap((one) => one.derivedScripts || []).map((one) => one.replace(/!$/, "")));
  for (const { file, module } of modules) {
    if (module.derived === undefined) continue;
    if (!module.derived || typeof module.derived !== "object" || Array.isArray(module.derived)) {
      problems.push(`${file}: derived must be an object of functions`);
      continue;
    }
    for (const [name, fn] of Object.entries(module.derived)) {
      const shaped = writableNames.has(name)
        ? fn && typeof fn.read === "function" && typeof fn.write === "function"
        : typeof fn === "function" || (fn && typeof fn.read === "function" && fn.write === undefined);
      if (!shaped || env.derivedScripts.has(name) || !wanted.has(name)) {
        problems.push(`${file}: derived.${name}: expected one function for a value an item declares`);
      } else env.derivedScripts.set(name, fn);
    }
  }
  for (const name of wanted) if (!env.derivedScripts.has(name)) problems.push(`derived: "${name}" is not exported by the plugin's scripts`);
  // The screens items name: each exported once as a factory that returns `{ body(screen) -> nodes, mount?(screen) }`.
  const wantedScreens = new Set(items.map((one) => one.screenScript).filter(Boolean));
  const screenApi = { core: surface.core, controls: surface.controls, valueTypes: surface.valueTypes, describe: surface.describe, card: surface.card };
  for (const { file, module } of modules) {
    if (module.screens === undefined) continue;
    if (!module.screens || typeof module.screens !== "object" || Array.isArray(module.screens)) {
      problems.push(`${file}: screens must be an object of factories`);
      continue;
    }
    for (const [name, factory] of Object.entries(module.screens)) {
      if (!wantedScreens.has(name) || env.screenScripts.has(name) || typeof factory !== "function") {
        problems.push(`${file}: screens.${name}: expected one factory for a screen an item names`);
        continue;
      }
      let drawing;
      try {
        drawing = factory(screenApi);
      } catch (error) {
        problems.push(`${file}: screens.${name}: ${error?.message || String(error)}`);
        continue;
      }
      if (!drawing || typeof drawing.body !== "function" || Object.entries(drawing).some(([key, fn]) => (key !== "body" && key !== "mount") || typeof fn !== "function")) {
        problems.push(`${file}: screens.${name}: expected { body, mount? } only`);
        continue;
      }
      env.screenScripts.set(name, drawing);
    }
  }
  for (const name of wantedScreens) if (!env.screenScripts.has(name)) problems.push(`screen: "${name}" is not exported by the plugin's scripts`);
  loadTypeScripts(typeDefinitions, modules, surface, problems);
  loadControlScripts(definitions, modules, surface, problems);

  const providedFactories = new Set(manifest.provides?.itemFactories || []);
  const declaredFactories = new Map();
  for (const { file, module } of modules) {
    if (module.itemFactories === undefined) continue;
    if (!module.itemFactories || typeof module.itemFactories !== "object" || Array.isArray(module.itemFactories)) {
      problems.push(`${file}: itemFactories must be an object of builder functions`);
      continue;
    }
    for (const [name, build] of Object.entries(module.itemFactories)) {
      if (!providedFactories.has(name) || declaredFactories.has(name)) {
        problems.push(`${file}: itemFactories.${name}: expected a unique factory in provides.itemFactories`);
      } else if (typeof build !== "function") {
        problems.push(`${file}: itemFactories.${name}: expected a builder function`);
      } else {
        declaredFactories.set(name, build);
      }
    }
  }
  for (const name of providedFactories) {
    if (!declaredFactories.has(name)) problems.push(`provides.itemFactories: "${name}" is not exported by the plugin's scripts`);
  }

  if (problems.length) throw new Error(problems.join("\n"));

  if (declarations.translations) surface.registerTranslations(declarations.translations.data);
  for (const { id, def } of typeDefinitions) surface.registerValueType(id, def);
  for (const [id, def] of registered) surface.registerAction?.(id, def);
  for (const { id, def } of definitions) surface.registerControl(id, def);
  for (const [name, build] of declaredFactories) surface.registerItemFactory?.(name, build);
  for (const { name, def } of items) surface.registerItemType(name, def);
  for (const { type, app } of apps) surface.registerApp(type, app);
  for (const { file, module } of modules) {
    if (module.afterRegister !== undefined) {
      if (typeof module.afterRegister !== "function") throw new Error(`${file}: afterRegister must be a function`);
      await module.afterRegister();
    }
  }
}

// A derived item: an item factory of another plugin (`extends`), given its
// `config`, a name and an icon. It may also add properties (`properties` that
// the base does not have, as full specs), ask for permissions of its own
// manifest (`permissions`), and take the hooks the factory accepts from the
// plugin's scripts (`hooks`: the key of `export const items = { key: {...} }`)
// -- what a plugin written in code passed to the factory as functions.
function compileDerivedItem(data, manifest, surface, assets, modules = []) {
  const { id: name, extends: base, label, icon, config, properties, permissions = [], hooks: hooksKey } = data;
  const failed = (message) => ({ name, def: null, problems: [message] });
  const factory = ITEM_FACTORIES.get(base);
  if (!factory || (factory.source !== "core" && !manifest.requires?.includes(factory.source))) {
    return failed(`extends: "${base}" must name an item factory from a required plugin`);
  }
  for (const key of Object.keys(data)) {
    if (!["id", "extends", "label", "icon", "config", "properties", "permissions", "hooks"].includes(key)) return failed(`${key}: cannot override a derived item field`);
  }
  if (typeof name !== "string" || !name || typeof label !== "string" || !label || (icon !== undefined && typeof icon !== "string")) {
    return failed("expected an item ID, label and optional icon");
  }
  if (!Array.isArray(permissions) || !permissions.every((one) => typeof one === "string")) return failed("permissions: expected a list of names");
  let hooks = {};
  if (hooksKey !== undefined) {
    const found = modules.filter(({ module }) => module.items && Object.hasOwn(module.items, hooksKey));
    if (typeof hooksKey !== "string" || found.length !== 1) return failed(`hooks: "${hooksKey}" must be exported once as items["${hooksKey}"] by the plugin's scripts`);
    hooks = found[0].module.items[hooksKey];
    // Given as a function, it is handed the surface (core, describe, types), as register(fw) was.
    if (typeof hooks === "function") hooks = hooks({ core: surface.core, describe: surface.describe, types: surface.types });
    if (!hooks || typeof hooks !== "object") return failed(`hooks: items["${hooksKey}"] must be an object, or a function returning one`);
  }
  // New properties (full specs) go to the factory; the base's own may only have their default changed (below).
  const added = {};
  for (const [key, spec] of Object.entries(properties && typeof properties === "object" && !Array.isArray(properties) ? properties : {})) {
    if (spec && typeof spec === "object" && typeof spec.type === "string") added[key] = spec;
  }
  try {
    const { item, app } = factory.build({ core: surface.core, describe: surface.describe, types: surface.types },
      name, { label, icon }, config, (file) => assets.get(file), { permissions, properties: added, hooks });
    const def = { ...item, properties: { ...item.properties } };
    if (properties !== undefined) {
      if (!properties || typeof properties !== "object" || Array.isArray(properties)) return failed("properties: expected an object of default overrides");
      for (const [key, override] of Object.entries(properties)) {
        if (Object.hasOwn(added, key)) continue;
        if (!Object.hasOwn(def.properties, key) || !override || Object.keys(override).length !== 1 || !Object.hasOwn(override, "default") || def.properties[key].read) {
          return failed(`properties.${key}: can only override the default of an existing stored property`);
        }
        def.properties[key] = { ...def.properties[key], default: override.default };
      }
    }
    return { name, def, app, problems: [] };
  } catch (error) {
    return failed(error.message || String(error));
  }
}
