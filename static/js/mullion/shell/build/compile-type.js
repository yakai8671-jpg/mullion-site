/* Mullion -- declared value types (types/<name>.json) and their optional
 * JS hooks (export const types = { [id]: { ... } } in scripts).
 *
 * A value type declaration specifies what a value is as data: its fields, its
 * port kind, its default control, how it is grouped, how its list is kept,
 * and how the generic Preview shows it (`preview`). Record types (`fields`)
 * automatically receive defaultValue, coerce, format (from `format: { field }`),
 * and coerceList (when `identity` is declared); non-record types with `default`
 * automatically receive defaultValue. Only behavior that cannot be expressed
 * as data is supplied in `scripts` via `export const types`, restricted to
 * the allowed hook names.
 */

import { ICONS, paramNames } from "./registry.js";
import { compileItem } from "./compile-item.js";

const TYPE_KEYS = new Set([
  "id", "label", "icon", "base", "default", "fields", "identity", "format",
  "defaultControl", "params", "sample", "port", "portAccepts", "portReceive",
  "portKeep", "portKeeps", "list", "preview", "groups", "storable", "presetNew",
  "stash", "shareFrom", "defaults", "version",
]);

const LIST_KEYS = new Set([
  "label", "icon", "port", "portAccepts", "portReceive",
  "defaultControl", "sample", "each", "preview", "storable", "presetNew",
]);

const FIELD_BANNED = new Set(["section", "sections", "group"]);

const HOOK_FUNCTIONS = new Set([
  "defaultValue", "coerce", "format", "portRead", "portWrite", "portPut",
  "portKindOf", "portText", "portGroup", "portNodes", "presetName",
  "presetEditor", "presetPreview", "coerceList", "fromWords", "fromBytes",
  "dataNodes", "migrate",
]);

const HOOK_TABLES = new Set(["methods", "supplies", "yields", "portFacets"]);

const ALIAS_NAMESPACES = {
  textcompose: "compose",
  lists: "list",
};

const isObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const clone = (value) => (value === undefined ? undefined : structuredClone(value));

let nextGeneratedId = 0;
function makeGeneratedId(prefix = "id") {
  return `${prefix}${Date.now().toString(36)}${(nextGeneratedId++).toString(36)}`;
}

function derivesFromIn(valueTypes, name, ancestor) {
  if (!name || !ancestor) return false;
  if (name === ancestor) return true;
  const def = valueTypes[name];
  return Boolean(def && (def.ancestors || []).includes(ancestor));
}

function defaultForIn(valueTypes, spec) {
  const def = valueTypes[spec?.type];
  if (!def || typeof def.defaultValue !== "function") return null;
  const params = def.defaults ? { ...def.defaults, ...spec } : spec;
  return def.defaultValue(params);
}

function coerceFieldIn(valueTypes, spec, rawValue) {
  const def = valueTypes[spec?.type];
  const params = def?.defaults ? { ...def.defaults, ...spec } : spec;
  if (rawValue === undefined) return defaultForIn(valueTypes, spec);
  return typeof def?.coerce === "function" ? def.coerce(rawValue, params) : rawValue;
}

function makeRecordSynthetics(id, fields, identity, formatSpec, valueTypes) {
  const prefix = (id.split(".").pop() || "e").slice(0, 1);
  const defaultValue = (p) => {
    if (p && p.default !== undefined) return coerce(clone(p.default));
    const out = {};
    if (identity) out[identity] = makeGeneratedId(prefix);
    for (const [field, spec] of Object.entries(fields)) {
      out[field] = defaultForIn(valueTypes, spec);
    }
    return out;
  };
  const coerce = (value) => {
    const from = isObject(value) ? value : {};
    const out = { ...from };
    if (identity) {
      out[identity] = typeof from[identity] === "string" && from[identity]
        ? from[identity]
        : typeof from[identity] === "number" && Number.isFinite(from[identity])
          ? String(from[identity])
          : makeGeneratedId(prefix);
    }
    for (const [field, spec] of Object.entries(fields)) {
      if (field === identity) continue;
      out[field] = coerceFieldIn(valueTypes, spec, from[field]);
    }
    return out;
  };
  const coerceList = identity
    ? (value) => {
        if (!Array.isArray(value)) return [];
        const seen = new Set();
        return value.map((entry) => {
          const item = coerce(entry);
          if (!item[identity] || seen.has(item[identity])) {
            item[identity] = makeGeneratedId(prefix);
          }
          seen.add(item[identity]);
          return item;
        });
      }
    : undefined;
  const format = formatSpec?.field
    ? (value) => {
        const current = isObject(value) ? value : coerce(value);
        const fieldName = formatSpec.field;
        const raw = current?.[fieldName];
        if (raw === "" || raw === null || raw === undefined) return "—";
        const fieldSpec = fields[fieldName];
        const fieldDef = fieldSpec && valueTypes[fieldSpec.type];
        if (typeof fieldDef?.format === "function") {
          const params = fieldDef.defaults ? { ...fieldDef.defaults, ...fieldSpec } : fieldSpec;
          return fieldDef.format(raw, params);
        }
        return String(raw) || "—";
      }
    : (value) => {
        const current = isObject(value) ? value : coerce(value);
        if (identity && current?.[identity]) return String(current[identity]);
        return "—";
      };
  return { defaultValue, coerce, ...(coerceList ? { coerceList } : {}), format };
}

export function compileTypes(manifest, env, problems) {
  const valueTypes = Object.assign(Object.create(null), env.valueTypes);
  const definitions = [];
  const provided = new Set(manifest.provides?.valueTypes || []);
  const claimed = new Set();

  for (const { file, data } of manifest.declarations?.types || []) {
    const before = problems.length;
    const at = (path, message) => problems.push(`${file}: ${path}: ${message}`);
    if (!isObject(data)) {
      at("type", "must be an object");
      continue;
    }
    const { id } = data;
    const ns = ALIAS_NAMESPACES[manifest.id] || manifest.id;
    const inNamespace = typeof id === "string" && (id === manifest.id || id.startsWith(`${manifest.id}.`) || id === ns || id.startsWith(`${ns}.`));
    if (!inNamespace || !provided.has(id) || claimed.has(id) || Object.hasOwn(env.valueTypes, id)) {
      at("id", "must be a unique value type listed in provides.valueTypes under this plugin's namespace");
      continue;
    }
    for (const key of Object.keys(data)) {
      if (!TYPE_KEYS.has(key)) at(key, "unknown value type field");
    }
    if (data.label !== undefined && (typeof data.label !== "string" || !data.label)) {
      at("label", "must be a translation key");
    }
    if (data.icon !== undefined && (typeof data.icon !== "string" || !data.icon)) {
      at("icon", "must be an icon name");
    }
    let base = null;
    if (data.base !== undefined) {
      if (typeof data.base !== "string" || !valueTypes[data.base]) {
        at("base", "must name a registered or earlier declared value type");
      } else {
        base = valueTypes[data.base];
      }
    }
    if (data.identity !== undefined && (typeof data.identity !== "string" || !data.identity)) {
      at("identity", "must be a nonempty field key");
    }
    let fields = null;
    if (data.fields !== undefined) {
      if (!isObject(data.fields) || !Object.keys(data.fields).length) {
        at("fields", "must be a nonempty object of field specs");
      } else {
        fields = {};
        for (const [field, spec] of Object.entries(data.fields)) {
          const where = `fields.${field}`;
          if (!isObject(spec) || typeof spec.type !== "string" || !valueTypes[spec.type]) {
            at(where, "must name a registered value type");
            continue;
          }
          for (const banned of FIELD_BANNED) {
            if (Object.hasOwn(spec, banned)) at(`${where}.${banned}`, `fields of a value are flat and cannot name a ${banned}`);
          }
          const fieldType = valueTypes[spec.type];
          if (spec.type === "list" || derivesFromIn(valueTypes, spec.type, "list")) {
            const each = spec.each || fieldType?.defaults?.each;
            const elemType = each && valueTypes[each.type];
            if (!spec.identity && !fieldType?.identity && !elemType?.identity) {
              at(where, "is a list whose elements have no identity; use the data type");
            }
          }
          fields[field] = { ...spec };
        }
      }
    }
    if (data.format !== undefined) {
      if (!isObject(data.format) || Object.keys(data.format).length !== 1 || typeof data.format.field !== "string" ||
          !fields || !Object.hasOwn(fields, data.format.field)) {
        at("format", 'must be { "field": fieldName } naming a declared field');
      }
    }
    const defaultControl = data.defaultControl ?? base?.defaultControl;
    if (typeof defaultControl !== "string" || !defaultControl) {
      at("defaultControl", "is required unless inherited from base");
    }
    if (data.params !== undefined) {
      if (!isObject(data.params) || !Object.values(data.params).every((spec) => isObject(spec) && typeof spec.type === "string")) {
        at("params", "must be a typed parameter table ({ param: { type } })");
      }
    }
    if (data.port !== undefined && data.port !== false && (typeof data.port !== "string" || !data.port)) {
      at("port", "must be a port kind string or false");
    }
    if (data.portAccepts !== undefined && (!Array.isArray(data.portAccepts) || !data.portAccepts.every((k) => typeof k === "string" && k))) {
      at("portAccepts", "must be a list of port kind names");
    }
    if (data.portReceive !== undefined && typeof data.portReceive !== "boolean") {
      at("portReceive", "must be true or false");
    }
    if (data.portKeep !== undefined && (!Array.isArray(data.portKeep) || !data.portKeep.every((k) => typeof k === "string" && k))) {
      at("portKeep", "must be a list of field keys");
    }
    if (data.portKeeps !== undefined && typeof data.portKeeps !== "boolean") {
      at("portKeeps", "must be true or false");
    }
    if (data.storable !== undefined && typeof data.storable !== "boolean") {
      at("storable", "must be true or false");
    }
    if (data.presetNew !== undefined && typeof data.presetNew !== "boolean") {
      at("presetNew", "must be true or false");
    }
    if (data.stash !== undefined && (typeof data.stash !== "string" || !data.stash)) {
      at("stash", "must be a stash kind string");
    }
    if (data.shareFrom !== undefined && (typeof data.shareFrom !== "string" || !valueTypes[data.shareFrom])) {
      at("shareFrom", "must name a registered value type");
    }
    if (data.defaults !== undefined && !isObject(data.defaults)) {
      at("defaults", "must be an object");
    }
    let groups = undefined;
    if (data.groups !== undefined) {
      if (!isObject(data.groups) || typeof data.groups.label !== "string" || !data.groups.label ||
          !Object.keys(data.groups).every((k) => k === "label" || k === "field") ||
          (data.groups.field !== undefined && (typeof data.groups.field !== "string" || !data.groups.field || (fields && !Object.hasOwn(fields, data.groups.field))))) {
        at("groups", 'must be { "label": translationKey, "field"?: fieldName }');
      } else {
        groups = {
          label: data.groups.label,
          ...(data.groups.field ? { field: data.groups.field, of: (v) => (isObject(v) ? String(v[data.groups.field] || "") : "") } : {}),
        };
      }
    }
    if (data.preview !== undefined) {
      validatePreviewDecl(data.preview, "preview", at);
    }
    let list = undefined;
    if (data.list !== undefined) {
      if (!isObject(data.list)) {
        at("list", "must be an object");
      } else {
        for (const key of Object.keys(data.list)) {
          if (!LIST_KEYS.has(key)) at(`list.${key}`, "unknown list type field");
        }
        if (data.list.label !== undefined && (typeof data.list.label !== "string" || !data.list.label)) {
          at("list.label", "must be a translation key");
        }
        if (data.list.preview !== undefined) {
          validatePreviewDecl(data.list.preview, "list.preview", at);
        }
        list = { ...data.list };
      }
    }
    if (before !== problems.length) continue;

    const { id: _id, default: defaultLiteral, format: formatSpec, groups: _groups, fields: _fields, list: _list, ...rest } = data;
    const def = {
      ...rest,
      ...(fields ? { fields } : {}),
      ...(groups ? { groups } : {}),
      ...(list ? { list } : {}),
    };
    if (fields) {
      Object.assign(def, makeRecordSynthetics(id, fields, data.identity, formatSpec, valueTypes));
    } else if (Object.hasOwn(data, "default")) {
      def.defaultValue = (p) => clone(p && p.default !== undefined ? p.default : defaultLiteral);
      if (!base) {
        def.coerce = (value) => (value === undefined ? clone(defaultLiteral) : value);
      }
    }

    const merged = base
      ? {
          ...base,
          ...def,
          params: def.params || base.params,
          defaults: { ...(base.defaults || {}), ...(def.defaults || {}) },
          methods: { ...(base.methods || {}), ...(def.methods || {}) },
          ancestors: [data.base, ...(base.ancestors || [])],
        }
      : { icon: ICONS.value, ...def, methods: { ...(def.methods || {}) }, ancestors: [] };

    claimed.add(id);
    valueTypes[id] = merged;
    definitions.push({ id, def, staged: merged, file, hasBase: Boolean(base), hasDefault: Boolean(fields || Object.hasOwn(data, "default")) });
  }

  for (const id of provided) {
    if (!claimed.has(id)) problems.push(`provides.valueTypes: "${id}" has no valid declaration`);
  }
  return { valueTypes, definitions };
}

function validatePreviewDecl(preview, path, at) {
  if (!isObject(preview)) {
    at(path, "must be an object");
    return;
  }
  const hasControl = Object.hasOwn(preview, "control");
  const hasLayout = Object.hasOwn(preview, "layout");
  if (hasControl === hasLayout) {
    at(path, 'must specify either "control" or "layout"');
    return;
  }
  if (preview.editable !== undefined && typeof preview.editable !== "boolean") {
    at(`${path}.editable`, "must be true or false");
  }
  if (hasControl) {
    for (const key of Object.keys(preview)) {
      if (!["control", "options", "editable"].includes(key)) at(`${path}.${key}`, "unknown preview field");
    }
    if (typeof preview.control !== "string" || !preview.control) {
      at(`${path}.control`, "must name a control");
    }
    if (preview.options !== undefined && !isObject(preview.options)) {
      at(`${path}.options`, "must be an object");
    }
  } else {
    for (const key of Object.keys(preview)) {
      if (!["layout", "editable"].includes(key)) at(`${path}.${key}`, "unknown preview field");
    }
    if (!Array.isArray(preview.layout)) {
      at(`${path}.layout`, "must be a list of nodes");
    }
  }
}

export function compileTypePreviews(definitions, valueTypes, controls, env, problems) {
  for (const entry of definitions) {
    const { id, def, file } = entry;
    if (def.preview) {
      compileOnePreview(id, def, def.preview, "preview", file, valueTypes, controls, env, problems);
    }
    if (def.list?.preview) {
      // The list of this element, previewed as a plain list of it.
      const own = { label: def.list.label, port: def.list.port, defaults: { type: "list", each: { type: id, ...(def.list.each || {}) } } };
      compileOnePreview("list", own, def.list.preview, "list.preview", file, valueTypes, controls, env, problems, `${id}.list`);
    }
  }
}

function compileOnePreview(typeName, targetDef, preview, path, file, valueTypes, controls, env, problems, idName = typeName) {
  const at = (where, message) => problems.push(`${file}: ${where}: ${message}`);
  if (typeof targetDef.port !== "string" || !targetDef.port) {
    at(path, "requires a port kind on the value type");
  }
  if (typeof preview.control === "string") {
    const control = controls[preview.control];
    if (!control) {
      at(`${path}.control`, `"${preview.control}" is not a control`);
      return;
    }
    const options = preview.options || {};
    const allowed = new Set(paramNames(control));
    for (const [arg, given] of Object.entries(options)) {
      if (arg === "value") {
        if (!isObject(given) || Object.keys(given).length !== 1 || given.bind !== "value") {
          at(`${path}.options.value`, 'must be { "bind": "value" }');
        }
        continue;
      }
      if (!allowed.has(arg)) {
        at(`${path}.options.${arg}`, `is not something "${preview.control}" takes`);
      }
    }
    return;
  }
  if (Array.isArray(preview.layout)) {
    const compiled = compileItem(
      {
        id: `${idName}.$preview`,
        label: targetDef.label || typeName,
        properties: {
          value: {
            ...(targetDef.defaults || {}),
            type: typeName,
            ...(preview.editable ? {} : { readonly: true }),
          },
        },
        layout: preview.layout,
      },
      { ...env, valueTypes, controls }
    );
    for (const problem of compiled.problems) at(`${path}.${problem}`, "");
    if (!compiled.def) return;
    preview.build = ({ api, value, port, clear, set, readonly, prefix }) => {
      let current = value;
      const item = {
        id: prefix || "preview",
        type: `${idName}.$preview`,
        props: { value: current },
      };
      const fakeEnv = {
        ...env,
        valueTypes,
        controls,
        bindProperty: (_item, key, _api) =>
          env.bindSpec(
            {
              ...(targetDef.defaults || {}),
              type: typeName,
              readonly: Boolean(readonly || !set),
              read: () => current,
              ...(set && !readonly
                ? {
                    write: (_a, next) => {
                      current = next;
                      set(next);
                    },
                  }
                : {}),
            },
            { item, key, api }
          ),
        itemProperties: () => [
          env.describe(
            {
              ...(targetDef.defaults || {}),
              type: typeName,
              readonly: Boolean(readonly || !set),
              read: () => current,
              ...(set && !readonly
                ? {
                    write: (_a, next) => {
                      current = next;
                      set(next);
                    },
                  }
                : {}),
            },
            { item, key: "value", api, label: targetDef.label ? env.t(targetDef.label) : typeName }
          ),
        ],
      };
      const recompiled = compileItem(
        {
          id: `${idName}.$preview`,
          label: targetDef.label || typeName,
          properties: {
            value: {
              ...(targetDef.defaults || {}),
              type: typeName,
              ...(readonly ? { readonly: true } : {}),
            },
          },
          layout: preview.layout,
        },
        fakeEnv
      );
      const built = recompiled.def ? recompiled.def.body(api, item) : [];
      if (built.length === 1 && built[0].kind === "card") {
        return [{ ...built[0], port: built[0].port || port, onDiscard: built[0].onDiscard || clear }];
      }
      return [
        env.NODES.card("preview", targetDef.label ? env.t(targetDef.label) : typeName, built, [], {
          port,
          onDiscard: clear,
        }),
      ];
    };
  }
}

export function loadTypeScripts(definitions, modules, surface, problems) {
  const byId = new Map(definitions.map((one) => [one.id, one]));
  const loaded = new Set();
  for (const { file, module } of modules) {
    if (module.types === undefined) continue;
    if (!isObject(module.types)) {
      problems.push(`${file}: types must be an object of value type hooks`);
      continue;
    }
    for (const [id, exported] of Object.entries(module.types)) {
      const entry = byId.get(id);
      const hooks = typeof exported === "function" ? exported({ core: surface.core }) : exported;
      if (!entry || loaded.has(id) || !isObject(hooks)) {
        problems.push(`${file}: ${id}: must match one declared value type`);
        continue;
      }
      loaded.add(id);
      for (const [key, value] of Object.entries(hooks)) {
        if (key === "list") {
          if (!entry.def.list || !isObject(value) ||
              Object.keys(value).some((name) => !["portRead", "portWrite", "methods"].includes(name)) ||
              Object.entries(value).some(([name, hook]) => name === "methods"
                ? !isObject(hook) || !Object.values(hook).every((fn) => typeof fn === "function")
                : typeof hook !== "function")) {
            problems.push(`${file}: ${id}.list: expected list port hooks or methods for a declared list type`);
          } else {
            entry.def.list = { ...entry.def.list, ...value };
            entry.staged.list = entry.def.list;
          }
          continue;
        }
        if (TYPE_KEYS.has(key) && key !== "format" && key !== "groups") {
          problems.push(`${file}: ${id}.${key}: cannot overwrite a declarative value type field in scripts`);
          continue;
        }
        if (HOOK_FUNCTIONS.has(key)) {
          if (typeof value !== "function") {
            problems.push(`${file}: ${id}.${key}: must be a function`);
            continue;
          }
          entry.def[key] = value;
          entry.staged[key] = value;
        } else if (HOOK_TABLES.has(key)) {
          if (!isObject(value) || !Object.values(value).every((fn) => typeof fn === "function")) {
            problems.push(`${file}: ${id}.${key}: must be an object of functions`);
            continue;
          }
          if (key === "methods") {
            entry.def.methods = { ...(entry.def.methods || {}), ...value };
            entry.staged.methods = { ...(entry.staged.methods || {}), ...value };
          } else {
            entry.def[key] = value;
            entry.staged[key] = value;
          }
        } else if (key === "groups") {
          if (!isObject(value) || Object.keys(value).length !== 1 || typeof value.of !== "function") {
            problems.push(`${file}: ${id}.groups: expected { of(value) }`);
            continue;
          }
          if (!entry.def.groups?.label) {
            problems.push(`${file}: ${id}.groups: requires groups.label in the type declaration`);
            continue;
          }
          entry.def.groups = { ...entry.def.groups, of: value.of };
          entry.staged.groups = entry.def.groups;
        } else {
          problems.push(`${file}: ${id}.${key}: unknown value type hook`);
        }
      }
    }
  }
  for (const entry of definitions) {
    if (!entry.hasBase && !entry.hasDefault && typeof entry.def.defaultValue !== "function") {
      problems.push(`${entry.file}: defaultValue: required when neither fields, default, nor base is declared`);
    }
    if (entry.def.groups && typeof entry.def.groups.of !== "function") {
      problems.push(`${entry.file}: groups: requires either a declared field or a groups.of hook in scripts`);
    }
  }
}
