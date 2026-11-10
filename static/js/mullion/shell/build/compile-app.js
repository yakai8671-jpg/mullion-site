/* Mullion -- a declared app (`apps/<name>.json`), checked and compiled.
 *
 * What `apps/<name>.json` of a declarative plugin says (see
 * docs/declarative-items-proposal.md and docs/plugin-guide.md §9) is checked
 * here before any code runs or anything is registered:
 *
 *   - Top-level keys: `type` (required, naming an item declared by this plugin),
 *     `name`, `icon`, `layout`, `props`, `defaultItem`, `keep`,
 *     `excludeHistory`, `hotkeys`.
 *   - `layout`: 2-way splits (`{ dir, ratio, children }`), `"self"`,
 *     `{ self: true, collapsed }`, `{ add, tag, props, collapsed }`,
 *     `{ app, tag, collapsed }`, `{ bay: { name, active, sashes }, tag }`,
 *     and `{ children: ["self"] }` at the root. Legacy `{ owned }` and nested
 *     bays are rejected. Every `tag` must match `/^[A-Za-z0-9_]+$/` and be
 *     unique across the app's layout.
 *   - `layout.links`: static validation of `to` and `from` (`at`, `key`, `path`),
 *     checking that endpoints exist, do not self-link or loop, and satisfy
 *     `canLink` (port compatibility / conversion) or `canShare` (`share: true`).
 *   - `layout.appLinks`: static validation of `{ at, key, to }`, checking that
 *     `key` is a `link: true` property on `at` and every target in `to` fits
 *     its `itemType` (`linkFits`).
 *   - `props` and `keep`: checked against the item's writable/stored properties
 *     and value types.
 *   - `hotkeys`: unique keys (`key`), valid `at` in the layout, and `action`
 *     naming a declared action on the target item or a shell hotkey action.
 */

import { APPS, ITEM_TYPES, isStandalone } from "./registry.js";

const APP_DECLARATION_KEYS = new Set([
  "type", "name", "icon", "layout", "props", "defaultItem", "keep", "excludeHistory", "hotkeys",
]);
const TAG_RE = /^[A-Za-z0-9_]+$/;
const HOTKEY_KEY_RE = /^(?:ctrl\+)?(?:alt\+)?(?:shift\+)?(?:[a-z0-9]|F[1-46-9]|F10)$/i;
const MAX_DEPTH = 16;

const isObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);

function derivesFromIn(valueTypes, name, ancestor) {
  if (!name || !ancestor) return false;
  if (name === ancestor) return true;
  const def = valueTypes[name];
  return Boolean(def && (def.ancestors || []).includes(ancestor));
}

function resolveValueType(spec, valueTypes) {
  const base = spec && valueTypes[spec.type];
  if (!base || spec.type !== "list") return base;
  const element = spec.each && valueTypes[spec.each.type];
  if (!element || !element.list) return base;
  const { label: _l, icon: _i, sample: _s, each: _e, ...own } = element.list;
  return { ...base, ...own, methods: { ...(base.methods || {}), ...(own.methods || {}) } };
}

function paramsForIn(spec, valueTypes) {
  const def = valueTypes[spec?.type];
  if (!def || !def.defaults) return spec;
  return { ...def.defaults, ...spec };
}

function valueCompatibleWithSpec(value, spec, valueTypes) {
  if (!spec || !spec.type) return false;
  const params = paramsForIn(spec, valueTypes);
  const type = spec.type;
  if (derivesFromIn(valueTypes, type, "boolean")) {
    return typeof value === "boolean";
  }
  if (derivesFromIn(valueTypes, type, "number")) {
    return typeof value === "number" && Number.isFinite(value);
  }
  if (derivesFromIn(valueTypes, type, "enum")) {
    if (typeof value !== "string") return false;
    if (Array.isArray(params.options)) {
      const allowed = params.options.map((opt) => (isObject(opt) ? opt.value : opt));
      return allowed.includes(value);
    }
    return true;
  }
  if (derivesFromIn(valueTypes, type, "string")) {
    return typeof value === "string";
  }
  if (derivesFromIn(valueTypes, type, "list")) {
    if (!Array.isArray(value)) return false;
    const each = params.each;
    if (each && each.type) {
      return value.every((elem) => valueCompatibleWithSpec(elem, each, valueTypes));
    }
    return true;
  }
  if (derivesFromIn(valueTypes, type, "ref")) {
    return value === null || typeof value === "string";
  }
  const def = resolveValueType(spec, valueTypes);
  if (def && isObject(def.fields)) {
    if (!isObject(value)) return false;
    for (const [k, v] of Object.entries(value)) {
      if (k === def.identity) {
        if (typeof v !== "string" && typeof v !== "number") return false;
        continue;
      }
      if (Object.hasOwn(def.fields, k)) {
        if (!valueCompatibleWithSpec(v, def.fields[k], valueTypes)) return false;
      }
    }
    return true;
  }
  if (type === "data") {
    if (Array.isArray(params.default)) return Array.isArray(value);
    return true;
  }
  return value !== undefined;
}

function validatePropsForItem(propsObj, itemDef, itemTypeName, pathPrefix, valueTypes, at) {
  if (!isObject(propsObj)) {
    at(pathPrefix, "must be an object");
    return;
  }
  const properties = itemDef?.properties || {};
  for (const [key, value] of Object.entries(propsObj)) {
    const propPath = `${pathPrefix}.${key}`;
    if (!Object.hasOwn(properties, key)) {
      at(propPath, `property "${key}" does not exist on "${itemTypeName}"`);
      continue;
    }
    const spec = properties[key];
    if (spec.read || spec.readonly) {
      at(propPath, `property "${key}" on "${itemTypeName}" is read-only and cannot be set in props`);
      continue;
    }
    if (!valueCompatibleWithSpec(value, spec, valueTypes)) {
      at(propPath, `value is not compatible with property "${key}" (type "${spec.type}")`);
    }
  }
}

function resolvePortNode(itemDef, itemTypeName, endpoint, endPath, valueTypes, at) {
  const properties = itemDef?.properties || {};
  const key = endpoint.key;
  if (!Object.hasOwn(properties, key)) {
    at(`${endPath}.key`, `property "${key}" does not exist on "${itemTypeName}"`);
    return null;
  }
  const rootSpec = properties[key];
  let node = {
    spec: paramsForIn(rootSpec, valueTypes),
    own: resolveValueType(rootSpec, valueTypes) || {},
    type: rootSpec.type,
    isProperty: true,
    isElement: false,
    isField: false,
    isFacet: false,
    facet: null,
    writable: !rootSpec.readonly && (!rootSpec.read || Boolean(rootSpec.write)),
  };

  const steps = endpoint.path || [];
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const stepPath = `${endPath}.path[${i}]`;
    if (node.isFacet) {
      at(stepPath, `cannot step further inside facet`);
      return null;
    }
    if (derivesFromIn(valueTypes, node.type, "list")) {
      const each = node.spec.each;
      const elementDef = each && valueTypes[each.type];
      if (!each || !elementDef || !elementDef.identity) {
        at(stepPath, `property "${key}" is not a list of addressable elements`);
        return null;
      }
      const eachParams = paramsForIn(each, valueTypes);
      node = {
        spec: eachParams,
        own: resolveValueType(eachParams, valueTypes) || {},
        type: eachParams.type,
        isProperty: false,
        isElement: true,
        isField: false,
        isFacet: false,
        facet: null,
        writable: node.writable && !eachParams.readonly && (!eachParams.read || Boolean(eachParams.write)),
      };
      continue;
    }
    if (node.own.fields && Object.hasOwn(node.own.fields, step)) {
      const fieldSpec = paramsForIn(node.own.fields[step], valueTypes);
      node = {
        spec: fieldSpec,
        own: resolveValueType(fieldSpec, valueTypes) || {},
        type: fieldSpec.type,
        isProperty: false,
        isElement: false,
        isField: true,
        isFacet: false,
        facet: null,
        writable: node.writable && !fieldSpec.readonly && (!fieldSpec.read || Boolean(fieldSpec.write)),
      };
      continue;
    }
    if (node.own.portKindOf) {
      const named = Object.entries(valueTypes).find(([, def]) => def && def.fields && Object.hasOwn(def.fields, step));
      if (named) {
        const fieldSpec = paramsForIn(named[1].fields[step], valueTypes);
        node = {
          spec: fieldSpec,
          own: resolveValueType(fieldSpec, valueTypes) || {},
          type: fieldSpec.type,
          isProperty: false,
          isElement: false,
          isField: true,
          isFacet: false,
          facet: null,
          writable: node.writable && !fieldSpec.readonly,
        };
        continue;
      }
    }
    if (node.isElement) {
      const fixedFacet = node.own.portFacets && Object.hasOwn(node.own.portFacets, step) ? node.own.portFacets[step] : null;
      if (fixedFacet) {
        node = {
          spec: null,
          own: {},
          type: "",
          isProperty: false,
          isElement: false,
          isField: false,
          isFacet: true,
          facet: fixedFacet,
          writable: node.writable && typeof fixedFacet.write === "function",
        };
        continue;
      }
      if (typeof node.own.portFacetOf === "function") {
        node = {
          spec: null,
          own: {},
          type: "",
          isProperty: false,
          isElement: false,
          isField: false,
          isFacet: true,
          facet: { kind: "*", accepts: ["*"] },
          writable: false,
        };
        continue;
      }
    }
    at(stepPath, `"${step}" is not a valid path step from "${node.type || key}"`);
    return null;
  }

  return node;
}

function portKindOfNode(node, valueTypes) {
  if (!node) return null;
  if (node.isFacet) {
    return typeof node.facet.kind === "string" ? node.facet.kind : "*";
  }
  if (node.own.portKindOf) return "*";
  if (!node.spec || node.spec.port === false) return null;
  if (typeof node.spec.port === "string") return node.spec.port;
  if (typeof node.own.port === "string") return node.own.port;
  return derivesFromIn(valueTypes, node.type, "string") ? "text" : null;
}

function portAcceptsOfNode(node, valueTypes) {
  if (!node) return [];
  if (node.isFacet) {
    if (Array.isArray(node.facet.accepts)) return node.facet.accepts;
    const k = portKindOfNode(node, valueTypes);
    return k ? [k] : [];
  }
  if (node.own.portReceive === false) return [];
  if (node.own.portAcceptsAny) return ["*"];
  const kind = portKindOfNode(node, valueTypes);
  if (!kind) return [];
  return [kind, ...(node.spec.portAccepts || node.own.portAccepts || [])];
}

function sameEndpoint(a, b) {
  if (a.at !== b.at || a.key !== b.key) return false;
  const pa = a.path || [];
  const pb = b.path || [];
  return pa.length === pb.length && pa.every((s, idx) => s === pb[idx]);
}

function endpointWithin(a, b) {
  if (a.at !== b.at || a.key !== b.key) return false;
  const pa = a.path || [];
  const pb = b.path || [];
  const len = Math.min(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    if (pa[i] !== pb[i]) return false;
  }
  return true;
}

export function compileApp(data, { items, declared, declaredApps = new Map(), valueTypes, env }) {
  const problems = [];
  const at = (path, message) => problems.push(path ? `${path}: ${message}` : message);
  if (!isObject(data)) return { type: "", app: null, problems: ["an app declaration must be an object"] };

  for (const key of Object.keys(data)) {
    if (!APP_DECLARATION_KEYS.has(key)) at(key, "is not a key of an app declaration");
  }

  const type = typeof data.type === "string" ? data.type : "";
  if (!type) {
    at("type", "is missing");
    return { type: "", app: null, problems };
  }
  if (!declared.has(type)) {
    at("type", `"${type}" is not an item this plugin declares`);
    return { type, app: null, problems };
  }

  const itemMap = new Map();
  for (const [id, def] of Object.entries(ITEM_TYPES)) itemMap.set(id, def);
  for (const one of items) {
    if (one.name && one.def) itemMap.set(one.name, one.def);
  }

  const compiled = items.find((one) => one.name === type);
  const itemDef = compiled?.def;
  // If the target item failed to compile, its own file already reported the error.
  if (!itemDef) return { type, app: null, problems };

  if (itemDef.standalone === false) {
    at("type", `"${type}" is not a standalone item type`);
  }

  if (data.name !== undefined && (typeof data.name !== "string" || !data.name)) {
    at("name", "must be a non-empty string (a translation key)");
  }
  if (data.icon !== undefined && (typeof data.icon !== "string" || !data.icon)) {
    at("icon", "must be a non-empty icon name");
  }
  if (data.excludeHistory !== undefined && typeof data.excludeHistory !== "boolean") {
    at("excludeHistory", "must be true or false");
  }

  if (data.defaultItem !== undefined) {
    if (typeof data.defaultItem !== "string" || !data.defaultItem) {
      at("defaultItem", "must be an item type ID");
    } else {
      const targetDef = itemMap.get(data.defaultItem);
      if (!targetDef) {
        at("defaultItem", `"${data.defaultItem}" is not a registered item type`);
      } else if (!isStandalone(targetDef)) {
        at("defaultItem", `"${data.defaultItem}" is not a standalone item type`);
      }
    }
  }

  if (data.props !== undefined) {
    validatePropsForItem(data.props, itemDef, type, "props", valueTypes, at);
  }

  if (data.keep !== undefined) {
    if (!Array.isArray(data.keep)) {
      at("keep", "must be a list of property names");
    } else {
      const seenKeep = new Set();
      const props = itemDef.properties || {};
      data.keep.forEach((key, idx) => {
        const kPath = `keep[${idx}]`;
        if (typeof key !== "string" || !key) {
          at(kPath, "must be a property name");
          return;
        }
        if (seenKeep.has(key)) {
          at(kPath, `duplicate property "${key}" in keep`);
          return;
        }
        seenKeep.add(key);
        if (!Object.hasOwn(props, key)) {
          at(kPath, `property "${key}" does not exist on "${type}"`);
        } else if (props[key].read) {
          at(kPath, `property "${key}" is read-through and cannot be kept`);
        }
      });
    }
  }

  // Track addressable targets in the layout:
  // itemTargets: Map<address ("self" | "+tag"), { itemType, itemDef }>
  // bayTags: Set<tag>
  // windowTags: Set<tag> (tags of add or app windows)
  const usedTags = new Set();
  const itemTargets = new Map([["self", { itemType: type, itemDef }]]);
  const bayTags = new Set();
  const windowTags = new Set();

  const checkTag = (tag, path) => {
    if (tag === undefined) return null;
    if (typeof tag !== "string" || !TAG_RE.test(tag)) {
      at(path, "must be a non-empty alphanumeric/underscore tag");
      return null;
    }
    if (usedTags.has(tag)) {
      at(path, `duplicate tag "${tag}" in layout`);
      return null;
    }
    usedTags.add(tag);
    return tag;
  };

  const resolveAppMainType = (appId) => {
    if (APPS[appId]) return APPS[appId].type || appId;
    if (declaredApps.has(appId)) return declaredApps.get(appId);
    return null;
  };

  const validateLayoutNode = (spec, path, depth, insideBay) => {
    if (depth > MAX_DEPTH) {
      at(path, "layout is nested too deeply");
      return;
    }
    if (spec === "self") return;
    if (!isObject(spec)) {
      at(path, 'expected "self" or a layout object');
      return;
    }
    if (depth > 0) {
      if (spec.links !== undefined) at(`${path}.links`, "links are only allowed at the top level of layout");
      if (spec.appLinks !== undefined) at(`${path}.appLinks`, "appLinks are only allowed at the top level of layout");
    }

    if (Object.hasOwn(spec, "owned")) {
      at(`${path}.owned`, "owned windows are no longer supported in declarations; use { add, tag } and links");
      return;
    }

    if (spec.self === true) {
      const allowed = new Set(["self", "collapsed", ...(depth === 0 ? ["links", "appLinks"] : [])]);
      for (const k of Object.keys(spec)) {
        if (!allowed.has(k)) at(`${path}.${k}`, "is not a valid key on a self window");
      }
      if (spec.collapsed !== undefined && typeof spec.collapsed !== "boolean") {
        at(`${path}.collapsed`, "must be true or false");
      }
      return;
    }

    if (Object.hasOwn(spec, "add")) {
      const allowed = new Set(["add", "tag", "props", "collapsed", ...(depth === 0 ? ["links", "appLinks"] : [])]);
      for (const k of Object.keys(spec)) {
        if (!allowed.has(k)) at(`${path}.${k}`, "is not a valid key on an add window");
      }
      if (typeof spec.add !== "string" || !spec.add) {
        at(`${path}.add`, "must be an item type ID");
        return;
      }
      const addDef = itemMap.get(spec.add);
      if (!addDef) {
        at(`${path}.add`, `"${spec.add}" is not a registered item type`);
      } else if (!isStandalone(addDef)) {
        at(`${path}.add`, `"${spec.add}" is not a standalone item type`);
      }
      if (spec.collapsed !== undefined && typeof spec.collapsed !== "boolean") {
        at(`${path}.collapsed`, "must be true or false");
      }
      const tag = checkTag(spec.tag, `${path}.tag`);
      if (tag && addDef) {
        itemTargets.set(`+${tag}`, { itemType: spec.add, itemDef: addDef });
        windowTags.add(tag);
      }
      if (spec.props !== undefined && addDef) {
        validatePropsForItem(spec.props, addDef, spec.add, `${path}.props`, valueTypes, at);
      } else if (spec.props !== undefined && !isObject(spec.props)) {
        at(`${path}.props`, "must be an object");
      }
      return;
    }

    if (Object.hasOwn(spec, "app")) {
      const allowed = new Set(["app", "tag", "collapsed", ...(depth === 0 ? ["links", "appLinks"] : [])]);
      for (const k of Object.keys(spec)) {
        if (!allowed.has(k)) at(`${path}.${k}`, "is not a valid key on an app window");
      }
      if (typeof spec.app !== "string" || !spec.app) {
        at(`${path}.app`, "must be an app ID");
        return;
      }
      const appMainType = resolveAppMainType(spec.app);
      const appMainDef = appMainType ? itemMap.get(appMainType) : null;
      if (!appMainType || !appMainDef) {
        at(`${path}.app`, `"${spec.app}" is not a registered app`);
      }
      if (spec.collapsed !== undefined && typeof spec.collapsed !== "boolean") {
        at(`${path}.collapsed`, "must be true or false");
      }
      const tag = checkTag(spec.tag, `${path}.tag`);
      if (tag && appMainDef) {
        itemTargets.set(`+${tag}`, { itemType: appMainType, itemDef: appMainDef });
        windowTags.add(tag);
      }
      return;
    }

    if (Object.hasOwn(spec, "bay")) {
      if (insideBay) {
        at(`${path}.bay`, "cannot nest a bay inside another bay");
        return;
      }
      const allowed = new Set(["bay", "tag", ...(depth === 0 ? ["links", "appLinks"] : [])]);
      for (const k of Object.keys(spec)) {
        if (!allowed.has(k)) at(`${path}.${k}`, "is not a valid key on a bay node");
      }
      const tag = checkTag(spec.tag, `${path}.tag`);
      if (tag) bayTags.add(tag);
      const bay = spec.bay;
      if (!isObject(bay)) {
        at(`${path}.bay`, "must be an object");
        return;
      }
      for (const k of Object.keys(bay)) {
        if (!["name", "active", "sashes"].includes(k)) at(`${path}.bay.${k}`, "is not a valid key on bay");
      }
      if (bay.name !== undefined && typeof bay.name !== "string") {
        at(`${path}.bay.name`, "must be a string");
      }
      if (!Array.isArray(bay.sashes) || bay.sashes.length === 0) {
        at(`${path}.bay.sashes`, "must be a non-empty list of sashes");
        return;
      }
      if (bay.active !== undefined) {
        if (typeof bay.active !== "number" || !Number.isInteger(bay.active) || bay.active < 0 || bay.active >= bay.sashes.length) {
          at(`${path}.bay.active`, `must be an integer index in 0..${bay.sashes.length - 1}`);
        }
      }
      bay.sashes.forEach((sash, idx) => {
        if (sash === null) return;
        validateLayoutNode(sash, `${path}.bay.sashes[${idx}]`, depth + 1, true);
      });
      return;
    }

    if (Object.hasOwn(spec, "children")) {
      const allowed = new Set(["dir", "ratio", "children", ...(depth === 0 ? ["links", "appLinks"] : [])]);
      for (const k of Object.keys(spec)) {
        if (!allowed.has(k)) at(`${path}.${k}`, "is not a valid key on a layout split");
      }
      if (!Array.isArray(spec.children)) {
        at(`${path}.children`, "must be a list");
        return;
      }
      // Single-child wrapper `{ children: ["self"] }` is allowed at root (depth === 0)
      if (depth === 0 && spec.children.length === 1 && spec.dir === undefined && spec.ratio === undefined) {
        validateLayoutNode(spec.children[0], `${path}.children[0]`, depth + 1, insideBay);
        return;
      }
      if (spec.children.length !== 2) {
        at(`${path}.children`, "a split must have exactly 2 children");
      }
      if (spec.dir !== "row" && spec.dir !== "col") {
        at(`${path}.dir`, 'must be "row" or "col"');
      }
      if (typeof spec.ratio !== "number" || !Number.isFinite(spec.ratio) || spec.ratio <= 0 || spec.ratio >= 1) {
        at(`${path}.ratio`, "must be a number between 0 and 1 (exclusive)");
      }
      spec.children.forEach((child, idx) => {
        validateLayoutNode(child, `${path}.children[${idx}]`, depth + 1, insideBay);
      });
      return;
    }

    at(path, 'expected "self", { self: true }, { add }, { app }, { bay }, or a { dir, ratio, children } split');
  };

  if (data.layout !== undefined) {
    validateLayoutNode(data.layout, "layout", 0, false);

    if (isObject(data.layout) && data.layout.links !== undefined) {
      if (!Array.isArray(data.layout.links)) {
        at("layout.links", "must be a list");
      } else {
        const validatedLinks = [];
        const canConvertPort = env.canConvertPort;
        data.layout.links.forEach((one, idx) => {
          const lPath = `layout.links[${idx}]`;
          if (!isObject(one)) {
            at(lPath, "must be an object");
            return;
          }
          for (const k of Object.keys(one)) {
            if (!["to", "from", "share"].includes(k)) at(`${lPath}.${k}`, "is not a valid key on a link");
          }
          if (one.share !== undefined && typeof one.share !== "boolean") {
            at(`${lPath}.share`, "must be true or false");
          }
          const checkEndpoint = (endKey) => {
            const ep = one[endKey];
            const epPath = `${lPath}.${endKey}`;
            if (!isObject(ep)) {
              at(epPath, "must be an object with at and key");
              return null;
            }
            for (const k of Object.keys(ep)) {
              if (!["at", "key", "path"].includes(k)) at(`${epPath}.${k}`, "is not a valid key on a link endpoint");
            }
            if (typeof ep.at !== "string" || !ep.at) {
              at(`${epPath}.at`, "must be a target address");
              return null;
            }
            const target = itemTargets.get(ep.at);
            if (!target) {
              at(`${epPath}.at`, `"${ep.at}" does not match "self" or any tagged window in layout`);
              return null;
            }
            if (typeof ep.key !== "string" || !ep.key) {
              at(`${epPath}.key`, "must be a property name");
              return null;
            }
            if (ep.path !== undefined) {
              if (!Array.isArray(ep.path) || !ep.path.every((s) => typeof s === "string" && s)) {
                at(`${epPath}.path`, "must be a list of non-empty step strings");
                return null;
              }
            }
            const node = resolvePortNode(target.itemDef, target.itemType, ep, epPath, valueTypes, at);
            if (!node) return null;
            return { ep, target, node };
          };

          const toRes = checkEndpoint("to");
          const fromRes = checkEndpoint("from");
          if (!toRes || !fromRes) return;

          if (sameEndpoint(toRes.ep, fromRes.ep) || endpointWithin(toRes.ep, fromRes.ep)) {
            at(lPath, "a port cannot link to or inside itself");
            return;
          }

          if (one.share === true) {
            if (toRes.ep.path && toRes.ep.path.length > 0) {
              at(`${lPath}.to.path`, "a shared property cannot have a path on to");
              return;
            }
            if (!toRes.node.isProperty || !toRes.node.writable) {
              at(`${lPath}.to`, `property "${toRes.ep.key}" on "${toRes.target.itemType}" is not a writable property`);
              return;
            }
            const fromType = fromRes.node.type;
            const shareTarget = toRes.node.own.shareFrom || toRes.node.type;
            const compatible = Boolean(
              fromRes.node.own.portKindOf ||
              (fromType && derivesFromIn(valueTypes, fromType, shareTarget))
            );
            if (!compatible) {
              at(lPath, `cannot share "${fromRes.target.itemType}.${fromRes.ep.key}" (type "${fromType || "unknown"}") with "${toRes.target.itemType}.${toRes.ep.key}" (expects "${shareTarget}")`);
              return;
            }
          } else {
            if (!toRes.node.writable) {
              at(`${lPath}.to`, `target "${toRes.target.itemType}.${toRes.ep.key}" is not writable`);
              return;
            }
            const fromKind = portKindOfNode(fromRes.node, valueTypes);
            if (!fromKind) {
              at(`${lPath}.from`, `source "${fromRes.target.itemType}.${fromRes.ep.key}" is not a port`);
              return;
            }
            const accepted = portAcceptsOfNode(toRes.node, valueTypes);
            if (!accepted.length) {
              at(`${lPath}.to`, `target "${toRes.target.itemType}.${toRes.ep.key}" does not accept port links`);
              return;
            }
            const canRoute =
              fromKind === "*" ||
              accepted.includes("*") ||
              accepted.includes(fromKind) ||
              accepted.some((ak) => typeof canConvertPort === "function" && canConvertPort(fromKind, ak));
            if (!canRoute) {
              at(lPath, `port kind "${fromKind}" from "${fromRes.target.itemType}.${fromRes.ep.key}" cannot link into "${toRes.target.itemType}.${toRes.ep.key}" (accepts ${accepted.join(", ")})`);
              return;
            }
          }

          // Check loop against previously validated links
          let cursor = fromRes.ep;
          for (let hops = 0; cursor && hops <= validatedLinks.length; hops++) {
            if (sameEndpoint(cursor, toRes.ep) || endpointWithin(toRes.ep, cursor)) {
              at(lPath, "link forms a loop");
              return;
            }
            const up = validatedLinks.find((prev) => sameEndpoint(prev.to, cursor));
            cursor = up ? up.from : null;
          }
          validatedLinks.push({ to: toRes.ep, from: fromRes.ep, share: Boolean(one.share) });
        });
      }
    }

    if (isObject(data.layout) && data.layout.appLinks !== undefined) {
      if (!Array.isArray(data.layout.appLinks)) {
        at("layout.appLinks", "must be a list");
      } else {
        data.layout.appLinks.forEach((one, idx) => {
          const aPath = `layout.appLinks[${idx}]`;
          if (!isObject(one)) {
            at(aPath, "must be an object");
            return;
          }
          for (const k of Object.keys(one)) {
            if (!["at", "key", "to"].includes(k)) at(`${aPath}.${k}`, "is not a valid key on an appLink");
          }
          if (typeof one.at !== "string" || !one.at) {
            at(`${aPath}.at`, "must be a target address");
            return;
          }
          const holder = itemTargets.get(one.at);
          if (!holder) {
            at(`${aPath}.at`, `"${one.at}" does not match "self" or any tagged window in layout`);
            return;
          }
          if (typeof one.key !== "string" || !one.key) {
            at(`${aPath}.key`, "must be a property name");
            return;
          }
          const spec = (holder.itemDef.properties || {})[one.key];
          if (!spec) {
            at(`${aPath}.key`, `property "${one.key}" does not exist on "${holder.itemType}"`);
            return;
          }
          const isLinkSlot =
            spec.link === true &&
            (derivesFromIn(valueTypes, spec.type, "ref") || derivesFromIn(valueTypes, spec.type, "list")) &&
            Boolean(spec.itemType);
          if (!isLinkSlot) {
            at(`${aPath}.key`, `property "${one.key}" on "${holder.itemType}" is not an app link slot (link: true)`);
            return;
          }
          if (!Array.isArray(one.to) || one.to.length === 0) {
            at(`${aPath}.to`, "must be a non-empty list of target addresses");
            return;
          }
          if (derivesFromIn(valueTypes, spec.type, "ref") && one.to.length > 1) {
            at(`${aPath}.to`, `property "${one.key}" is a single ref and can only link to one target`);
          }
          one.to.forEach((targetAt, tIdx) => {
            const tPath = `${aPath}.to[${tIdx}]`;
            if (typeof targetAt !== "string" || !targetAt) {
              at(tPath, "must be a target address");
              return;
            }
            if (targetAt === one.at) {
              at(tPath, "an item cannot appLink to itself");
              return;
            }
            const target = itemTargets.get(targetAt);
            if (!target) {
              at(tPath, `"${targetAt}" does not match "self" or any tagged window in layout`);
              return;
            }
            // A slot that decides by a function looks the type up in the registry; an item this
            // plugin declares is not registered yet, so it is shown to the function as it will be.
            const own = (items || []).find((one) => one.name === target.itemType);
            const pending = Boolean(own) && !Object.hasOwn(ITEM_TYPES, own.name);
            if (pending) ITEM_TYPES[own.name] = own.def;
            let fits;
            try {
              fits =
                typeof spec.itemType === "function"
                  ? Boolean(spec.itemType(target.itemType))
                  : [].concat(spec.itemType).includes(target.itemType);
            } finally {
              if (pending) delete ITEM_TYPES[own.name];
            }
            if (!fits) {
              at(tPath, `"${target.itemType}" (at "${targetAt}") does not fit link slot "${holder.itemType}.${one.key}"`);
            }
          });
        });
      }
    }
  }

  if (data.hotkeys !== undefined) {
    if (!Array.isArray(data.hotkeys)) {
      at("hotkeys", "must be a list");
    } else {
      const seenKeys = new Set();
      const hotkeyActions = env.HOTKEY_ACTIONS || {};
      data.hotkeys.forEach((one, idx) => {
        const hPath = `hotkeys[${idx}]`;
        if (!isObject(one)) {
          at(hPath, "must be an object");
          return;
        }
        for (const k of Object.keys(one)) {
          if (!["key", "at", "action"].includes(k)) at(`${hPath}.${k}`, "is not a valid key on a hotkey");
        }
        if (typeof one.key !== "string" || !HOTKEY_KEY_RE.test(one.key)) {
          at(`${hPath}.key`, "expected a valid hotkey combination");
        } else {
          const normKey = one.key.toLowerCase();
          if (seenKeys.has(normKey)) {
            at(`${hPath}.key`, `duplicate hotkey "${one.key}"`);
          }
          seenKeys.add(normKey);
        }
        if (typeof one.at !== "string" || !one.at) {
          at(`${hPath}.at`, "must be a target address");
          return;
        }
        if (typeof one.action !== "string" || !one.action) {
          at(`${hPath}.action`, "must be an action name");
          return;
        }

        if (one.at.startsWith("bay:")) {
          const bayTag = one.at.slice(4);
          if (!bayTags.has(bayTag)) {
            at(`${hPath}.at`, `bay "${one.at}" does not exist in layout`);
            return;
          }
          const shellAction = hotkeyActions[one.action];
          if (!shellAction || !shellAction.bay) {
            at(`${hPath}.action`, `"${one.action}" is not a bay hotkey action`);
          }
          return;
        }

        if (one.at === "frame") {
          const shellAction = hotkeyActions[one.action];
          if (!shellAction || shellAction.bay) {
            at(`${hPath}.action`, `"${one.action}" is not a frame hotkey action`);
          }
          return;
        }

        const target = itemTargets.get(one.at);
        if (!target) {
          at(`${hPath}.at`, `"${one.at}" does not match "self" or any tagged window in layout`);
          return;
        }
        const hasItemAction = Boolean(target.itemDef.actions && Object.hasOwn(target.itemDef.actions, one.action));
        const shellAction = hotkeyActions[one.action];
        const hasWindowAction = Boolean(shellAction && !shellAction.bay);
        if (!hasItemAction && !hasWindowAction) {
          at(`${hPath}.action`, `"${one.action}" is not an action declared on "${target.itemType}"`);
        }
      });
    }
  }

  const { type: _type, ...appRest } = data;
  return {
    type,
    app: problems.length ? null : { ...compiled?.app, ...appRest },
    problems,
  };
}
