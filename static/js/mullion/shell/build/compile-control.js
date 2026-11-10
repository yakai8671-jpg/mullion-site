import { extendControl } from "./registry.js";
import { slotProblem } from "./spec-type.js";
import { compileActionBindings, compileActionButtons, compileItem, compileViews, resolveValueAdapter, validFeatures } from "./compile-item.js";

const ALIAS_NAMESPACES = {
  textcompose: "compose",
  lists: "list",
};

// Build against a staging table so items can use the new control immediately,
// without publishing any of it until the whole plugin passes validation.
export function compileControls(manifest, env, problems) {
  const controls = Object.assign(Object.create(null), env.controls);
  const definitions = [];
  const provided = new Set(manifest.provides?.controls || []);
  const ns = ALIAS_NAMESPACES[manifest.id] || manifest.id;
  for (const { file, data } of manifest.declarations?.controls || []) {
    const before = problems.length;
    const at = (path, message) => problems.push(`${file}: ${path}: ${message}`);
    const { id, extends: parent, label, features, slots, views, via, valueType, actions, script, why } = data;
    const inNamespace = typeof id === "string" && (id.startsWith(`${manifest.id}.`) || id.startsWith(`${ns}.`));
    if (!inNamespace || !provided.has(id) || Object.hasOwn(controls, id)) {
      at("id", "must be a unique control listed in provides.controls under this plugin's namespace");
      continue;
    }
    // A new leaf, not made from another control: it draws itself (`script`,
    // with a reason the shell's controls do not do), and says what it takes as
    // a typed table, so items can place it like any declared control.
    if (parent === undefined) {
      const { params = {}, needs = [], standalone, sampleParams, nestedNodes } = data;
      for (const key of Object.keys(data)) {
        if (!["id", "label", "script", "why", "params", "needs", "standalone", "sampleParams", "nestedNodes"].includes(key)) at(key, "unknown field of a new leaf control");
      }
      if (script !== true) at("script", "a control that extends nothing draws itself: script must be true");
      if (typeof why !== "string" || !why.trim()) at("why", "must explain why the control needs its own drawing");
      if (typeof label !== "string" || !label) at("label", "must be a translation key");
      const typed = params && typeof params === "object" && !Array.isArray(params) &&
        Object.values(params).every((one) => one && typeof one === "object" && typeof one.type === "string");
      if (!typed) at("params", "must be a table of { type, ... } by name");
      else {
        // A list says what it is a list of: { "type": "list", "each": { "type": element } }.
        for (const [name, one] of Object.entries(params)) {
          const wrong = one.each === undefined ? "" : slotProblem({ type: one.type, each: one.each }, env.valueTypes);
          if (wrong) at(`params.${name}`, wrong);
        }
      }
      if (!Array.isArray(needs) || !needs.every((one) => typeof one === "string")) at("needs", "must be a list of method names");
      if (standalone !== undefined && typeof standalone !== "boolean") at("standalone", "must be true or false");
      if (nestedNodes !== undefined && typeof nestedNodes !== "boolean") at("nestedNodes", "must be true or false");
      if (sampleParams !== undefined && (!sampleParams || typeof sampleParams !== "object" || Array.isArray(sampleParams))) at("sampleParams", "must be an object");
      if (before !== problems.length) continue;
      // `nestedNodes`: the control draws nodes inside itself, so the shell hands it `desc.renderNodes`.
      const def = { label, why, params, needs, ...(standalone ? { standalone: true } : {}), ...(nestedNodes ? { nestedNodes: true } : {}), ...(sampleParams ? { sampleParams } : {}) };
      controls[id] = { requiresParams: [], ...def, name: id };
      definitions.push({ id, def, script, file });
      continue;
    }
    const base = typeof parent === "string" ? controls[parent] : undefined;
    if (!base || Array.isArray(base.params)) {
      at("extends", "must name a registered or earlier declared control with typed parameters");
      continue;
    }
    for (const key of Object.keys(data)) if (!["id", "extends", "label", "features", "slots", "views", "via", "valueType", "actions", "script", "why"].includes(key)) at(key, "unknown control field");
    if (script !== undefined && script !== true) at("script", "must be true when supplying a drawing implementation");
    if (script && (typeof why !== "string" || !why.trim())) at("why", "must explain why the control needs its own drawing");
    if (why !== undefined && typeof why !== "string") at("why", "must be a string");
    if (label !== undefined && (typeof label !== "string" || !label)) at("label", "must be a translation key");
    if (features !== undefined && (!base.textcard?.features || !validFeatures(features, base.textcard.features))) {
      at("features", "must list supported text card features without duplicates");
    }
    const declarationSlots = { ...base.declarationSlots };
    const declarationAdapter = via === undefined ? base.declarationAdapter : resolveValueAdapter(via, base, env, "via", at);
    const actionValueType = valueType ?? base.declarationActionValueType ?? declarationAdapter?.to;
    if (valueType !== undefined && (typeof valueType !== "string" || !Object.hasOwn(env.valueTypes, valueType))) {
      at("valueType", "must name a registered value type");
    }
    if (base.declarationActionValueType && actionValueType !== base.declarationActionValueType) {
      at("valueType", "must preserve the base control's action value type");
    }
    const targets = Object.create(null);
    if (actionValueType) targets.value = { type: actionValueType };
    for (const [key, spec] of Object.entries(base.params || {})) {
      if (key !== "value" && Object.hasOwn(env.valueTypes, spec.type)) {
        targets[key] = { type: spec.type, ...(spec.each ? { each: spec.each } : {}), readonly: spec.bind !== "readwrite" };
      }
    }
    const ownActions = compileActionBindings(actions, targets, manifest.permissions || [], env, at);
    for (const name of Object.keys(ownActions)) {
      if (Object.hasOwn(base.declarationActions || {}, name)) at(`actions.${name}`, "cannot replace an inherited control action");
    }
    const declarationActions = Object.assign(Object.create(null), base.declarationActions, ownActions);
    const declarationActionTools = { ...base.declarationActionTools };
    const toolEnv = {
      t: env.t,
      runAction: (scope, name, payload) => scope.run(name, payload),
      cancelAction: (scope, name) => scope.cancel(name),
      actionStatus: (scope, name) => scope.status(name),
    };
    const compileSlot = (layout, path) => {
      if (!Array.isArray(layout)) {
        at(path, "must be a list of nodes");
        return () => [];
      }
      // Reusable slots are self-contained. Item bindings and actions can be
      // supplied when the control is placed in an item's layout.
      const compiled = compileItem({ id, label: label || id, layout }, { ...env, controls, nestedLayout: true });
      for (const error of compiled.problems) at(path, error);
      return (item, api) => compiled.def.body(api, item);
    };
    if (slots !== undefined) {
      if (!slots || typeof slots !== "object" || Array.isArray(slots)) at("slots", "must be an object");
      else for (const [name, layout] of Object.entries(slots)) {
        const path = `slots.${name}`;
        if (!base.declarationSlotNames?.includes(name)) at(path, `is not a slot of ${parent}`);
        else if (name === "lead" || name === "tools") {
          const buttons = compileActionButtons(layout, path, declarationActions, at, toolEnv, {
            header: true, primary: name === "lead",
            anchors: name === "tools" ? base.declarationToolAnchors : undefined,
          });
          if (name === "lead" && buttons.length > 1) at(path, "a card has at most one primary button");
          declarationActionTools[name] = buttons;
        }
        else if (name === "bars") {
          if (!Array.isArray(layout)) at(path, "must be a list of rows");
          else {
            const rows = layout.map((row, index) => compileSlot(row, `${path}[${index}]`));
            declarationSlots.bars = (item, api) => rows.map((build) => build(item, api));
          }
        } else declarationSlots.body = compileSlot(layout, path);
      }
    }
    const declarationViews = views === undefined ? base.declarationViews : compileViews(views, "views", base, at, compileSlot);
    if (before !== problems.length) continue;
    const def = {
      extends: parent,
      why: why || `Declares a reusable configuration of ${parent}.`,
      ...(label ? { label } : {}),
      ...(features !== undefined ? { textcard: { ...base.textcard, defaultFeatures: features } } : {}),
      declarationSlots,
      declarationViews,
      declarationAdapter,
      declarationActions,
      declarationActionTools,
      declarationActionValueType: actionValueType,
    };
    controls[id] = extendControl(id, def, base);
    definitions.push({ id, def, script, file });
  }
  const ids = new Set(definitions.map((one) => one.id));
  for (const id of provided) if (!ids.has(id)) problems.push(`provides.controls: "${id}" has no valid declaration`);
  return { controls, definitions };
}

export function loadControlScripts(definitions, modules, surface, problems) {
  const expected = new Map(definitions.filter((one) => one.script).map((one) => [one.id, one]));
  const loaded = new Set();
  const hooks = new Set(["render", "update", "mount", "unmount"]);
  const api = { core: surface.core, controls: surface.controls, valueTypes: surface.valueTypes, describe: surface.describe, card: surface.card };
  for (const { file, module } of modules) {
    if (module.controls === undefined) continue;
    if (!module.controls || typeof module.controls !== "object" || Array.isArray(module.controls)) {
      problems.push(`${file}: controls must be an object of drawing factories`);
      continue;
    }
    for (const [id, factory] of Object.entries(module.controls)) {
      const declaration = expected.get(id);
      if (!declaration || loaded.has(id) || typeof factory !== "function") {
        problems.push(`${file}: ${id}: expected one drawing factory for a control declared with script: true`);
        continue;
      }
      loaded.add(id);
      let drawing;
      try {
        drawing = factory(api);
      } catch (error) {
        problems.push(`${file}: ${id}: ${error?.message || String(error)}`);
        continue;
      }
      const render = typeof drawing?.render === "function";
      const mount = typeof drawing?.mount === "function";
      if (!drawing || typeof drawing !== "object" || Array.isArray(drawing) || render === mount || (drawing.unmount && !mount) ||
          !Object.entries(drawing || {}).every(([key, fn]) => hooks.has(key) && typeof fn === "function")) {
        problems.push(`${file}: ${id}: expected rendering or mounting hooks only`);
        continue;
      }
      Object.assign(declaration.def, drawing);
    }
  }
  for (const [id, { file }] of expected) {
    if (!loaded.has(id)) problems.push(`${file}: ${id}: control has no drawing factory`);
  }
}
