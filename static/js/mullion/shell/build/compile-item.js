/* Mullion -- a declared item, made into an item type definition.
 *
 * What `items/<name>.json` of a declarative plugin says (see
 * docs/declarative-items-proposal.md and docs/plugin-guide.md) is checked here
 * and turned into what registerItemType takes: the properties as they are, and
 * a body() that builds the same node tree a body written in code would --
 * NODES.control with its bind and its `binds`, NODES.section with its children.
 *
 * Nothing here touches the DOM or the shell's state: the registry's tables and
 * the node helpers are handed in, so the same code is checked by tests in Node
 * (tests/build-compile.mjs) and run in the page.
 *
 * What is checked is reported with where it is in the file
 * (`layout[0].options.value`), every problem at once, and a declaration with
 * any problem is not registered: the plugin it belongs to fails to load.
 */

// What the first engine reads. More (actions, derived values, apps' hotkeys
// calling an item's actions, dynamic forms) comes with the later stages; a key
// that is not read yet is refused rather than ignored.
const ITEM_KEYS = new Set(["id", "label", "icon", "standalone", "permissions", "properties", "derived", "actions", "layout", "screen", "surface", "drop"]);
// What every property may say, whatever its type; the rest is the type's own
// (its `params`).
const PROPERTY_KEYS = new Set(["type", "label", "default", "placeholder", "readonly", "control", "port", "role", "group", "visible"]);
// The meaning hints the automatic layout reads (docs/auto-layout-proposal.md §4.2): what a property is
// for, never where or how it is drawn.
const HINT_KEYS = ["role", "group", "visible"];
const ROLES = new Set(["output", "input", "main"]);
const ELEMENT_KEYS = new Set(["control", "key", "options", "layout", "slots", "views", "visible", "each", "as", "switch", "cases", "row"]);
const EACH_KEY = "@each:";
const SWITCH_KEY = "@switch:";
// The containers the first engine knows; every other control is a leaf.
const CONTAINERS = new Set(["section", "card", "list", "bar", "pinned"]);

const isObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const isBind = (value) => isObject(value) && Object.keys(value).length === 1 && typeof value.bind === "string";
const isItemRef = (value) => isObject(value) && Object.keys(value).length === 1 && typeof value.item === "string";
const namesOf = (params) => (Array.isArray(params) ? params : Object.keys(params || {}));
const escapeKey = (parts) => encodeURIComponent(JSON.stringify(parts)).replace(/i/g, "%69");

// What a typed slot holds -- a property, an action's input or result -- as one string to compare:
// "list<element>" for a list that says what it is a list of (`{ "type": "list", "each": { "type": ... } }`),
// the type's own name for anything else.
function slotKey(spec, valueTypes) {
  if (!isObject(spec) || typeof spec.type !== "string") return "";
  if (spec.type === "list" && typeof spec.each?.type === "string") return `list<${spec.each.type}>`;
  return spec.type;
}

// Whether two slots hold the same thing. A list that does not say what it is a list of fits any list.
function sameSlot(a, b, valueTypes) {
  const x = slotKey(a, valueTypes);
  const y = slotKey(b, valueTypes);
  if (x === y) return true;
  return (x === "list" && y.startsWith("list<")) || (y === "list" && x.startsWith("list<"));
}

// A saved value as an element of a list: its own fields when it is a record, with the id it is kept under (as text, the
// way an element's identity is) and the name it is kept as.
function elementOfSaved(row) {
  const own = row.value && typeof row.value === "object" && !Array.isArray(row.value) ? row.value : { value: row.value };
  return { ...own, id: String(row.id), name: row.name };
}

// `decl`: the parsed file. `env`: { controls, valueTypes, NODES, t }.
// Returns { name, def, problems }; `def` only when there are no problems.
export function compileItem(decl, env) {
  const problems = [];
  const at = (path, message) => problems.push(path ? `${path}: ${message}` : message);
  if (!isObject(decl)) return { name: "", def: null, problems: ["an item declaration must be an object"] };

  for (const key of Object.keys(decl)) if (!ITEM_KEYS.has(key)) at(key, "is not a key of an item declaration");
  const name = typeof decl.id === "string" ? decl.id : "";
  if (!name) at("id", "is missing");
  if (typeof decl.label !== "string" || !decl.label) at("label", "is missing (a translation key)");
  if (decl.icon !== undefined && typeof decl.icon !== "string") at("icon", "must be a name");
  if (decl.standalone !== undefined && typeof decl.standalone !== "boolean") at("standalone", "must be true or false");
  const permissions = decl.permissions === undefined ? [] : decl.permissions;
  if (!Array.isArray(permissions) || !permissions.every((one) => typeof one === "string")) at("permissions", "must be a list of names");

  // ---- the properties ----
  const properties = Object.create(null);
  if (decl.properties !== undefined && !isObject(decl.properties)) at("properties", "must be an object");
  const hinted = new Map();
  for (const [key, spec] of Object.entries(isObject(decl.properties) ? decl.properties : {})) {
    const path = `properties.${key}`;
    if (!isObject(spec)) {
      at(path, "must be an object");
      continue;
    }
    const type = env.valueTypes[spec.type];
    if (!type) {
      at(`${path}.type`, `"${spec.type}" is not a value type`);
      continue;
    }
    const own = new Set(namesOf(type.params));
    const typedParams = isObject(type.params) ? type.params : null;
    for (const [field, val] of Object.entries(spec)) {
      if (!PROPERTY_KEYS.has(field) && !own.has(field)) {
        at(`${path}.${field}`, `is not something a ${spec.type} property takes`);
      } else if (typedParams && Object.hasOwn(typedParams, field) && field !== "default") {
        const expected = typedParams[field]?.type;
        if (expected === "string" || expected === "label") {
          if (typeof val !== "string") at(`${path}.${field}`, "must be a string");
        } else if (expected === "number") {
          if (typeof val !== "number" || !Number.isFinite(val)) at(`${path}.${field}`, "must be a number");
        } else if (expected === "boolean") {
          if (typeof val !== "boolean") at(`${path}.${field}`, "must be true or false");
        } else if (expected === "object") {
          if (!isObject(val)) at(`${path}.${field}`, "must be an object");
        } else if (expected === "array") {
          if (!Array.isArray(val)) at(`${path}.${field}`, "must be a list");
        }
      }
    }
    if (spec.control !== undefined && !env.controls[spec.control]) at(`${path}.control`, `"${spec.control}" is not a control`);
    if (spec.role !== undefined && !ROLES.has(spec.role)) at(`${path}.role`, "must be output, input or main");
    if (spec.group !== undefined && (typeof spec.group !== "string" || !spec.group)) at(`${path}.group`, "must be a translation key");
    if (spec.visible !== undefined && typeof spec.visible !== "boolean" && !isBind(spec.visible)) at(`${path}.visible`, 'must be true, false or { "bind": property }');
    if (HINT_KEYS.some((hint) => spec[hint] !== undefined)) hinted.set(key, Object.fromEntries(HINT_KEYS.filter((hint) => spec[hint] !== undefined).map((hint) => [hint, spec[hint]])));
    properties[key] = { ...spec };
    for (const hint of HINT_KEYS) delete properties[key][hint];
    if (isObject(spec.itemType)) {
      const selector = spec.itemType;
      const kind = selector.kind;
      if (spec.link !== true || !["standalone", "runApp", "surfaced"].includes(kind) ||
          Object.keys(selector).some((key) => key !== "kind" && key !== "exclude") ||
          (selector.exclude !== undefined && (!Array.isArray(selector.exclude) || !selector.exclude.every((one) => typeof one === "string")))) {
        at(`${path}.itemType`, 'expected a link selector with kind "standalone", "runApp" or "surfaced" and optional exclude list');
      } else {
        const excluded = new Set(selector.exclude || []);
        properties[key].itemType = (name) => {
          const item = env.itemTypes?.[name];
          // "surfaced": what a chain can drive -- a screen that opens by itself, or one that declares its `surface`.
          return !excluded.has(name) && Boolean(item && (kind === "runApp" ? item.runApp : kind === "surfaced" ? item.standalone || typeof item.appSurface === "function" : item.standalone));
        };
      }
    }
  }
  if (decl.derived !== undefined && !isObject(decl.derived)) at("derived", "must be an object");
  // The script values this declaration reads, checked against the scripts once they are imported.
  const derivedScripts = new Set();
  for (const [key, spec] of Object.entries(isObject(decl.derived) ? decl.derived : {})) {
    // A value made by the plugin's script (`export const derived = { name: (api, item) => value }`),
    // read when it is drawn with the item's own API; never stored.
    if (isObject(spec) && isObject(spec.from) && typeof spec.from.script === "string") {
      if (Object.hasOwn(properties, key) || !env.valueTypes[spec.type] ||
          (spec.writable !== undefined && typeof spec.writable !== "boolean") ||
          !Object.keys(spec).every((field) => ["type", "label", "from", "each", "writable", "view"].includes(field)) ||
          Object.keys(spec.from).length !== 1 || !spec.from.script) {
        at(`derived.${key}`, 'expected a new property of a value type, read from { "script": name }');
        continue;
      }
      const name = spec.from.script;
      derivedScripts.add(spec.writable ? `${name}!` : name);
      const { from: _from, writable: canWrite, view: viewSpec, ...shown } = spec;
      // A list too big to be held whole is asked for the part a list card shows: `"view": { "list": key, "size": n }`
      // names the list card (of this item) whose search, filters and page the script is given, and how many entries
      // go on a page. The script answers { total, rows, choices? } -- `choices` the values a filter can switch off,
      // by field.
      if (viewSpec !== undefined && (canWrite || !isObject(viewSpec) || typeof viewSpec.list !== "string" || !viewSpec.list ||
          !Number.isInteger(viewSpec.size) || viewSpec.size < 1 || Object.keys(viewSpec).some((field) => !["list", "size"].includes(field)) ||
          !(spec.type === "list" || env.valueTypes[spec.type]?.ancestors?.includes("list")))) {
        at(`derived.${key}.view`, 'a read-only list can say { "list": the key of a list card, "size": entries to a page }');
        continue;
      }
      const asked = new Map();
      const ask = (api, item, reader) => {
        const state = env.listView(item.id, viewSpec.list);
        const serial = env.drawSerial ? env.drawSerial() : -1;
        const stamp = JSON.stringify([serial, state]);
        const held = asked.get(item.id);
        if (serial !== -1 && held && held.stamp === stamp) return held.result;
        const result = reader(api, item, { t: env.t, read: (field) => env.bindProperty(item, field, api).get(), view: { ...state, size: viewSpec.size } });
        asked.set(item.id, { stamp, result });
        return result;
      };
      // A value the script can also take back (`{ read, write }`): a list put in a new order, say.
      const entry = () => env.derivedScripts?.get(name);
      properties[key] = {
        ...shown, storable: false,
        ...(canWrite ? {} : { readonly: true }),
        ...(viewSpec ? { view: viewSpec, answer: (api, item) => {
          const fn = entry();
          const reader = typeof fn === "function" ? fn : fn?.read;
          return (reader && ask(api, item, reader)) || {};
        } } : {}),
        read: (api, item) => {
          const fn = entry();
          const reader = typeof fn === "function" ? fn : fn?.read;
          if (viewSpec) {
            const answer = reader ? ask(api, item, reader) : null;
            return Array.isArray(answer?.rows) ? answer.rows : [];
          }
          return reader ? reader(api, item, { t: env.t, read: (key) => env.bindProperty(item, key, api).get() }) : undefined;
        },
        ...(canWrite ? { write: (api, value, item) => entry()?.write(api, value, item) } : {}),
      };
      continue;
    }
    // A list read from the library: `"from": { "store": "<type>" }` is every saved value of that type, one element
    // each -- the fields of the saved value (when it is a record) with its `id` and `name` -- as the value types
    // of `each` take them. It is read only, and the item has to be allowed to read the library.
    if (isObject(spec) && isObject(spec.from) && typeof spec.from.store === "string") {
      const isList = spec.type === "list" || Boolean(env.valueTypes[spec.type]?.ancestors?.includes("list"));
      if (Object.hasOwn(properties, key) || !env.valueTypes[spec.type] || !isList || !spec.from.store ||
          Object.keys(spec.from).length !== 1 || !Object.keys(spec).every((field) => ["type", "label", "from", "each"].includes(field))) {
        at(`derived.${key}`, 'expected a new list reading { "store": a saved type }');
        continue;
      }
      if (!permissions?.includes?.("store:read")) {
        at(`derived.${key}.from`, 'reading the library needs the "store:read" permission');
        continue;
      }
      const saved = spec.from.store;
      const { from: _from, ...shown } = spec;
      properties[key] = {
        ...shown, storable: false, readonly: true,
        read: (api) => (api?.store?.saved ? api.store.saved(saved).map(elementOfSaved) : []),
      };
      continue;
    }
    if (Object.hasOwn(properties, key) || !isObject(spec) || spec.type !== "string" ||
        spec.from?.api !== "shell.program" || !permissions?.includes?.("shell:exec") ||
        !Object.keys(spec).every((field) => ["type", "label", "from"].includes(field))) {
      at(`derived.${key}`, 'expected a new string property reading "shell.program" with shell:exec permission');
      continue;
    }
    properties[key] = { type: spec.type, label: spec.label, readonly: true, storable: false, read: (api) => api?.shell?.program() };
  }

  const record = (value, path) => actionRecord(value, path, at);
  const writable = (key) => writableTarget(properties, key);
  const actions = compileActionBindings(decl.actions, properties, permissions, env, at);

  // ---- the layout ----
  // Each element is checked once, here, and made into a function of the item
  // that builds its node: the declaration is read when the plugin loads, not
  // on every redraw.
  const placed = new Set();
  const aliases = new Map();
  const buildNodes = (builders, item, api, scope) => builders.flatMap((build) => build(item, api, scope) || []);
  function reference(name) {
    if (Object.hasOwn(properties, name)) return { spec: properties[name], root: name, readonly: properties[name].readonly };
    const [alias, ...fields] = name.split(".");
    const source = aliases.get(alias);
    const rootSpec = properties[alias];
    if (!source && !rootSpec) return null;
    let spec = source ? source.spec : rootSpec;
    let readonly = source ? source.readonly : rootSpec.readonly;
    for (const field of fields) {
      const table = env.valueTypes[spec.type]?.fields;
      if (!table || !Object.hasOwn(table, field)) return null;
      if (env.valueTypes[spec.type]?.identity === field) readonly = true;
      spec = table[field];
      readonly ||= spec.readonly;
    }
    return source ? { spec, alias, fields, readonly } : { spec, root: alias, fields, readonly };
  }

  function binding(ref, item, api, scope) {
    if (!ref.alias) {
      const base = env.bindProperty(item, ref.root, api);
      return { root: ref.root, property: (ref.fields || []).reduce((value, field) => value.field(field), base) };
    }
    const source = scope.get(ref.alias);
    return { root: source.root, property: ref.fields.reduce((value, field) => value.field(field), source.property) };
  }
  const property = (path, key) => {
    if (!Object.hasOwn(properties, key)) {
      at(path, `"${key}" is not a property of this item`);
      return false;
    }
    placed.add(key);
    return true;
  };

  function compileElement(el, path, topLevel = false) {
    if (!isObject(el)) {
      at(path, "must be an object");
      return null;
    }
    for (const key of Object.keys(el)) if (!ELEMENT_KEYS.has(key)) at(`${path}.${key}`, "is not a key of a layout element");
    if (el.switch !== undefined || el.cases !== undefined) {
      if (el.key !== undefined && (typeof el.key !== "string" || !el.key)) at(`${path}.key`, "is missing");
      else if (typeof el.key === "string" && (el.key.startsWith(EACH_KEY) || el.key.startsWith(SWITCH_KEY))) {
        at(`${path}.key`, `must not start with "${EACH_KEY}" or "${SWITCH_KEY}"`);
      }
      return compileSwitch(el, path, topLevel);
    }
    if (typeof el.key !== "string" || !el.key) at(`${path}.key`, "is missing");
    else if (el.key.startsWith(EACH_KEY) || el.key.startsWith(SWITCH_KEY)) {
      at(`${path}.key`, `must not start with "${EACH_KEY}" or "${SWITCH_KEY}"`);
    }
    if (el.each === undefined) {
      if (el.as !== undefined) at(`${path}.as`, "requires each");
      return compileVisible(el, path, topLevel);
    }
    return compileEach(el, path, topLevel);
  }

  function compileSwitch(el, path, topLevel = false) {
    for (const key of ["control", "options", "layout", "slots", "views", "each", "as"]) {
      if (el[key] !== undefined) at(`${path}.${key}`, "is not allowed on a switch element");
    }
    const source = isBind(el.switch) ? reference(el.switch.bind) : null;
    if (!source) {
      at(`${path}.switch`, 'must be { "bind": property } naming a property or element field');
    } else if (!canSwitchOn(source.spec.type)) {
      at(`${path}.switch`, "must bind to a string, enum, number, or boolean property");
    }
    if (!isObject(el.cases) || !Object.keys(el.cases).length) {
      at(`${path}.cases`, "must be a nonempty object of cases");
      return null;
    }
    const branches = Object.create(null);
    for (const [caseName, list] of Object.entries(el.cases)) {
      branches[caseName] = compileList(list, `${path}.cases.${caseName}`, topLevel);
    }
    const switchKey = typeof el.key === "string" && el.key ? el.key : path;
    const build = (item, api, scope) => {
      if (!source) return [];
      const raw = binding(source, item, api, scope).property.get();
      const key = String(raw ?? "");
      const branch = Object.hasOwn(branches, key) ? key : Object.hasOwn(branches, "default") ? "default" : null;
      if (branch === null) return [];
      return buildNodes(branches[branch], item, api, scope).map((node) => ({
        ...node,
        key: SWITCH_KEY + escapeKey([switchKey, branch, node.key]),
      }));
    };
    return wrapVisible(el, path, build, []);
  }

  function canSwitchOn(type) {
    if (!type) return false;
    if (["string", "enum", "number", "boolean"].includes(type)) return true;
    const ancestors = env.valueTypes[type]?.ancestors || [];
    return ancestors.some((a) => ["string", "enum", "number", "boolean"].includes(a));
  }

  function compileEach(el, path, topLevel = false) {
    const source = isBind(el.each) ? reference(el.each.bind) : null;
    const listType = env.valueTypes[source?.spec.type];
    const element = source?.spec.each ?? listType?.defaults?.each;
    const identity = env.valueTypes[element?.type]?.identity;
    if (!(source?.spec.type === "list" || listType?.ancestors?.includes("list")) || !identity) {
      at(`${path}.each`, 'must bind to a typed list whose elements declare an identity');
      return null;
    }
    const alias = el.as;
    if (typeof alias !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(alias) ||
        aliases.has(alias) || Object.hasOwn(properties, alias)) {
      at(`${path}.as`, "must name a new element alias");
      return null;
    }
    if (el.control === "pinned") at(path, "put repeated nodes inside pinned, rather than repeating pinned");
    if (source.root) placed.add(source.root);
    aliases.set(alias, { spec: element, readonly: source.readonly || element.readonly });
    const build = compileVisible(el, path, topLevel);
    aliases.delete(alias);
    if (!build) return null;
    return (item, api, scope) => {
      const list = binding(source, item, api, scope);
      const ids = list.property.items().map((one) => env.elementIdentity(one, identity));
      const seen = new Set();
      const duplicates = new Set();
      for (const id of ids) {
        if (seen.has(id)) duplicates.add(id);
        seen.add(id);
      }
      // A list card that searches, filters and pages shows some of its entries: the cards of the list it works on.
      const listed = scope?.get("@listview");
      const visible = listed && !source.alias && listed.root === list.root ? listed.ids : null;
      return ids.flatMap((id) => {
        if (id === null || duplicates.has(id) || (visible && !visible.has(id))) return [];
        const nested = new Map(scope);
        // Where the element is, from the item's property down (a port's `path`): an element of a list
        // inside another element continues that element's path through its fields.
        const outer = source.alias ? scope.get(source.alias) : null;
        const steps = [...(outer?.path || []), ...(source.fields || []), id];
        nested.set(alias, { root: list.root, id, path: steps, property: env.bindElementByIdentity(list.property, identity, id, source.readonly || element.readonly) });
        const node = build(item, api, nested);
        // Fold state recognizes item IDs in node keys. Escape literal "i"
        // so an element ID such as i123 cannot be mistaken for an item.
        if (!node) return [];
        const nodes = Array.isArray(node) ? node : [node];
        return nodes.filter(Boolean).map((one) => ({
          ...one,
          key: EACH_KEY + escapeKey([el.key, id, ...(nodes.length > 1 ? [one.key] : [])]),
        }));
      });
    };
  }

  function wrapVisible(el, path, build, hiddenValue = null) {
    if (!Object.hasOwn(el, "visible")) return build;
    if (typeof el.visible === "boolean") return el.visible ? build : () => hiddenValue;
    const ref = isBind(el.visible) ? reference(el.visible.bind) : null;
    const type = ref?.spec.type;
    if (type !== "boolean" && !env.valueTypes[type]?.ancestors?.includes("boolean")) {
      at(`${path}.visible`, 'must be true, false, or { "bind": booleanProperty }');
      return build;
    }
    // Reading a predicate does not place its property in the layout. The
    // toggle can still live in the item's own property table.
    return build && ((item, api, scope) => binding(ref, item, api, scope).property.get() === true ? build(item, api, scope) : hiddenValue);
  }

  function compileVisible(el, path, topLevel = false) {
    const build = compileNode(el, path, topLevel);
    return wrapVisible(el, path, build, null);
  }

  function compileNode(el, path, topLevel = false) {
    const options = el.options === undefined ? {} : el.options;
    if (!isObject(options)) {
      at(`${path}.options`, "must be an object");
      return null;
    }
    if (isObject(el.control)) {
      return compileFromType(el, path, options);
    }
    if (el.views !== undefined && (CONTAINERS.has(el.control) || el.control === "props" || el.control === "fields")) {
      at(`${path}.views`, `"${el.control}" does not support views`);
    }
    if (CONTAINERS.has(el.control)) return compileContainer(el, path, options, topLevel);
    if (el.layout !== undefined) at(`${path}.layout`, `"${el.control}" holds no layout`);
    if (el.control === "props") {
      if (el.slots !== undefined) at(`${path}.slots`, "props has no slots");
      if (!Array.isArray(options.entries) || Object.keys(options).length !== 1) at(`${path}.options`, "props needs an entries list");
      const entries = Array.isArray(options.entries) ? options.entries : [];
      for (const key of entries) property(`${path}.options.entries`, key);
      return (item, api) => {
        const rows = new Map(env.itemProperties(item, api).map((row) => [row.key, row]));
        return env.NODES.props(el.key, entries.map((key) => rows.get(key)));
      };
    }
    if (el.control === "fields") {
      return compileFields(el, path, options);
    }
    if (el.control === "output") {
      return compileOutput(el, path, options);
    }
    return compileLeaf(el, path, options);
  }

  function compileContainer(el, path, options, topLevel = false) {
    const { control, key } = el;
    const titled = control === "section" || control === "card" || control === "list";
    const takes = control === "section" ? ["label", "hint"] : control === "card" ? ["label", "icon", "empty", "side", "discard", "add", "port"] : control === "list" ? ["label", "icon", "empty", "add", "port", "of", "search", "filters", "page", "count"] : [];
    let portOn = false;
    // A list's port: the list property it holds, whole.
    let listPort = null;
    let labelRef = null;
    let iconRef = null;
    let discard = null;
    let add = null;
    // What the list shows of itself: `of` names the list property the entries come from, `search` the fields of an
    // entry that are looked through, `filters` the fields that can be switched off by value, `page` how many entries
    // to a page. The cards of an `each` over that property are the ones that are searched, filtered and paged.
    let cardPortRef = null;
    let sideCard = false;
    let ofRef = null;
    let searchFields = null;
    let filterSpecs = [];
    let pageSize = 0;
    let countInTitle = false;
    for (const [arg, value] of Object.entries(options)) {
      if (!takes.includes(arg)) at(`${path}.options.${arg}`, `is not something a ${control} takes`);
      else if (arg === "icon" && isBind(value)) {
        // A card's icon from a value: a field of the element it stands for, an icon name.
        iconRef = reference(value.bind);
        if (!iconRef || !["string", "enum", "icon"].includes(iconRef.spec.type)) at(`${path}.options.icon`, "must be an icon name or bind a text property or element field");
      } else if (arg === "icon" || arg === "empty") {
        // The icon of the card's head (a name), and what it says while there is nothing in it (a translation key).
        if (typeof value !== "string" || !value) at(`${path}.options.${arg}`, arg === "icon" ? "must be an icon name" : "must be a translation key");
      }
      else if (arg === "label" && control !== "section" && isBind(value)) {
        // A card's name from a value: a field of the element it stands for, shown as it is.
        labelRef = reference(value.bind);
        if (!labelRef || !["string", "enum"].includes(labelRef.spec.type)) at(`${path}.options.label`, "must bind a text property or element field");
      } else if (arg === "label" || arg === "hint") {
        if (typeof value !== "string") at(`${path}.options.${arg}`, "must be a translation key");
      } else if (arg === "of") {
        const ref = isBind(value) ? reference(value.bind) : null;
        const type = ref?.spec.type;
        if (!ref || ref.alias || !(type === "list" || env.valueTypes[type]?.ancestors?.includes("list"))) {
          at(`${path}.options.of`, 'must be { "bind": listProperty } naming a list property of the item');
        } else {
          if (ref.root) placed.add(ref.root);
          ofRef = ref;
        }
      } else if (arg === "count") {
        // The number of entries the list holds is said in its name: the label has {n} where it goes.
        if (value !== true) at(`${path}.options.count`, "must be true");
        else countInTitle = true;
      } else if (arg === "search") {
        if (value === true) searchFields = true;
        else if (!Array.isArray(value) || !value.length || !value.every((one) => typeof one === "string" && one)) at(`${path}.options.search`, "must be true, or a list of field names of the entries");
        else searchFields = value;
      } else if (arg === "filters") {
        if (!Array.isArray(value) || !value.length || !value.every((one) => isObject(one) && typeof one.field === "string" && one.field && Object.keys(one).every((field) => ["field", "label", "icon"].includes(field)))) {
          at(`${path}.options.filters`, "must be a list of { field, label?, icon? }");
        } else filterSpecs = value;
      } else if (arg === "page") {
        if (!Number.isInteger(value) || value < 1) at(`${path}.options.page`, "must be the number of entries to a page");
        else pageSize = value;
      } else if (arg === "port" && control === "list") {
        // The list's grip carries the list property it holds, whole (or a list inside an element).
        const ref = isBind(value) ? reference(value.bind) : null;
        const type = ref?.spec.type;
        if (!ref || !(type === "list" || env.valueTypes[type]?.ancestors?.includes("list"))) {
          at(`${path}.options.port`, 'must be { "bind": listProperty } naming a list property or element field');
        } else {
          if (ref.root) placed.add(ref.root);
          listPort = ref;
        }
      } else if (arg === "port" && !el.as && isBind(value)) {
        // A card that holds one property carries it by its grip.
        const ref = reference(value.bind);
        if (!ref || !ref.root || ref.alias) at(`${path}.options.port`, 'must be { "bind": property } of the item');
        else {
          placed.add(ref.root);
          cardPortRef = ref;
        }
      } else if (arg === "side") {
        if (value !== true) at(`${path}.options.side`, "must be true");
        else sideCard = true;
      } else if (arg === "port") {
        // The card's grip carries the element it stands for (only inside `each`).
        if (value !== true || !el.as) at(`${path}.options.port`, "must be true, on a card repeated by each, or { bind: property }");
        else portOn = true;
      } else if (arg === "discard") {
        // The card's close button: the action is given the element the card stands for.
        discard = actionRef(value, `${path}.options.discard`);
      } else if (arg === "add") {
        // A card that is not an entry of a list and has an add button is a list: made with `list`.
        if (control === "card" && !el.as) at(`${path}.options.add`, 'a list is made with "control": "list"; a card has an add button only as an entry of a list (repeated by each)');
        if (!isObject(value) || typeof value.label !== "string" || !Object.keys(value).every((one) => ["action", "label", "drop"].includes(one))) {
          at(`${path}.options.add`, "must be { action, label } with an optional drop");
        } else if (value.drop !== undefined && (!isObject(value.drop) || Object.keys(value.drop).some((one) => !["kind", "action"].includes(one)) ||
            typeof value.drop.kind !== "string" || !value.drop.kind)) {
          // What may be dropped on the button, and the action that takes it (given { value }): as an item's `drop`.
          at(`${path}.options.add.drop`, "must be { kind, action }");
        } else {
          add = {
            run: actionRef(value.action, `${path}.options.add.action`),
            label: value.label,
            ...(value.drop ? { kind: value.drop.kind, put: actionRef(value.drop.action, `${path}.options.add.drop.action`) } : {}),
          };
        }
      }
    }
    if ((control === "section" || control === "pinned") && (env.nestedLayout || !topLevel)) {
      at(path, `a ${control} is only the top level of an item's layout`);
    }
    const slots = record(el.slots, `${path}.slots`);
    for (const name of Object.keys(slots)) {
      if (!["card", "list"].includes(control) || !["body", "bars", "lead", "tools"].includes(name)) at(`${path}.slots.${name}`, `is not a slot of ${control}`);
    }
    const namedBody = Object.hasOwn(slots, "body");
    if (el.layout !== undefined && namedBody) at(`${path}.slots.body`, "use either layout or the body slot");
    const children = compileList(namedBody ? slots.body : el.layout, namedBody ? `${path}.slots.body` : `${path}.layout`);
    const bars = compileBars(slots.bars, `${path}.slots.bars`);
    const keys = new Set();
    const buttonRefs = { reference, binding };
    const lead = compileButtons(slots.lead, `${path}.slots.lead`, { header: true, primary: true, keys, refs: buttonRefs, element: el.as || null });
    const tools = compileButtons(slots.tools, `${path}.slots.tools`, { header: true, keys, refs: buttonRefs, element: el.as || null });
    if (lead.length > 1) at(`${path}.slots.lead`, "a card has at most one primary button");
    // A list that is asked of its source (a derived list with a `view`) has the source search, filter and page it.
    const queried = ofRef?.spec.view || null;
    if (queried) {
      if (queried.list !== key) at(`${path}.options.of`, `"${ofRef.root}" is asked for the list "${queried.list}", not this one`);
      if (pageSize) at(`${path}.options.page`, "the entries to a page are said where the list is asked for (its view)");
      pageSize = queried.size;
    }
    const viewed = Boolean(searchFields || filterSpecs.length || pageSize);
    if (viewed && !ofRef) at(`${path}.options`, '"of" names the list that is searched, filtered or paged');
    const viewElement = ofRef ? ofRef.spec.each ?? env.valueTypes[ofRef.spec.type]?.defaults?.each : null;
    const viewFields = env.valueTypes[viewElement?.type]?.fields || {};
    const viewIdentity = env.valueTypes[viewElement?.type]?.identity;
    if (ofRef && viewed) {
      if (!viewIdentity && !queried) at(`${path}.options.of`, "the entries of the list must declare an identity");
      for (const field of queried ? [] : [...(Array.isArray(searchFields) ? searchFields : []), ...filterSpecs.map((one) => one.field)]) {
        if (!Object.hasOwn(viewFields, field)) at(`${path}.options`, `"${field}" is not a field of the entries`);
      }
    }
    // The entries a list shows (searched, filtered and paged), and what its bars say of that.
    const makeView = (item, api, scope) => {
      if (queried) {
        // Asked of the source: the entries of the page are what it holds, and the rest it says of itself.
        const answer = ofRef.spec.answer(api, item);
        const state = env.listView(item.id, key);
        const total = Number(answer.total) || 0;
        const pages = Math.max(1, Math.ceil(total / pageSize));
        const page = Math.min(Math.max(1, Number(state.page) || 1), pages);
        const filters = filterSpecs.map((spec) => ({
          key: spec.field,
          label: env.t(spec.label || "mu.list.filter"),
          icon: spec.icon,
          all: ((answer.choices || {})[spec.field] || []).map((one) => ({ value: String(isObject(one) ? one.value : one), label: String(isObject(one) ? one.label ?? one.value : one) })),
          off: state.off[spec.field] || [],
        }));
        return {
          ids: null,
          total,
          card: { query: searchFields ? state.query : null, filters, page: { page, pages, total }, set: (patch) => env.setListView(item.id, key, patch) },
        };
      }
      const items = binding(ofRef, item, api, scope).property.items();
      const state = env.listView(item.id, key);
      const lower = (value) => String(value ?? "").toLowerCase();
      const words = lower(state.query).trim();
      const filters = filterSpecs.map((spec) => {
        const field = viewFields[spec.field];
        const values = [...new Set(items.map((one) => String(one?.[spec.field] ?? "")))].sort();
        const labelOf = (value) => {
          if (field.type === "boolean") return env.t(value === "true" ? "mu.list.true" : "mu.list.false");
          const option = (Array.isArray(field.options) ? field.options : []).find((one) => String(isObject(one) ? one.value : one) === value);
          return option && isObject(option) && option.label ? env.t(option.label) : value || "\u2014";
        };
        return { key: spec.field, label: env.t(spec.label || field.label || "mu.list.filter"), icon: spec.icon, all: values.map((value) => ({ value, label: labelOf(value) })), off: state.off[spec.field] || [] };
      });
      const passes = (one) => (!Array.isArray(searchFields) || !words || searchFields.some((field) => lower(one?.[field]).includes(words))) &&
        filters.every((filter) => !filter.off.includes(String(one?.[filter.key] ?? "")));
      const matches = items.filter(passes);
      const pages = pageSize ? Math.max(1, Math.ceil(matches.length / pageSize)) : 1;
      const page = Math.min(Math.max(1, Number(state.page) || 1), pages);
      const shown = pageSize ? matches.slice((page - 1) * pageSize, page * pageSize) : matches;
      return {
        ids: new Set(shown.map((one) => env.elementIdentity(one, viewIdentity))),
        total: matches.length,
        card: {
          query: searchFields ? state.query : null,
          filters,
          page: pageSize ? { page, pages, total: matches.length } : null,
          set: (patch) => env.setListView(item.id, key, patch),
        },
      };
    };
    return (item, api, scope) => {
      let view = null;
      let nodes;
      if (ofRef && viewed && (viewIdentity || queried)) {
        view = makeView(item, api, scope);
        const inner = new Map(scope);
        if (view.ids) inner.set("@listview", { root: ofRef.root, ids: view.ids });
        nodes = buildNodes(children, item, api, inner);
      } else nodes = buildNodes(children, item, api, scope);
      if (!titled) return env.NODES[control](key, nodes);
      const title = labelRef ? String(binding(labelRef, item, api, scope).property.get() ?? "") : options.label ? env.t(options.label, countInTitle && view ? { n: view.total.toLocaleString() } : undefined) : "";
      if (control === "section") return env.NODES.section(key, title, nodes, options.hint ? { hint: env.t(options.hint) } : {});
      const element = el.as && scope?.get(el.as);
      const extra = {
        bars: bars.map((row) => buildNodes(row, item, api, scope)),
        ...(iconRef ? { icon: String(binding(iconRef, item, api, scope).property.get() ?? "") || undefined } : typeof options.icon === "string" ? { icon: options.icon } : {}),
        ...(cardPortRef ? { port: { item: item.id, key: cardPortRef.root } } : {}),
        ...(sideCard ? { side: true } : {}),
        // What a container with nothing in it says: a list of no entries, a card of no rows.
        ...(typeof options.empty === "string" && !nodes.length ? { empty: env.t(options.empty) } : {}),
      };
      if (discard) {
        const run = discard(item);
        extra.onDiscard = () => run(element ? element.property.get() : undefined);
      }
      if (add) {
        const run = add.run(item);
        const put = add.put ? add.put(item) : null;
        extra.add = {
          label: env.t(add.label),
          run: () => run(element ? element.property.get() : undefined),
          ...(put ? { accepts: [add.kind], put: (value) => put({ value }) } : {}),
        };
      }
      // A card standing for an element of a stored or written list carries it by its grip.
      if (portOn && element?.path) extra.port = { item: item.id, key: element.root, path: element.path };
      const buttons = [...lead, ...tools].map((one) => one(item, api, scope)).filter(Boolean);
      if (control === "list") {
        if (listPort) {
          const held = binding(listPort, item, api, scope);
          const steps = listPort.alias || listPort.fields?.length ? held.property.steps() : null;
          extra.port = steps ? { item: item.id, key: held.root, path: steps } : { item: item.id, key: held.root };
        }
        return env.NODES.listCard(key, nodes, { ...extra, title, tools: buttons, ...(view ? { view: view.card } : {}) });
      }
      return env.NODES.card(key, title, nodes, buttons, extra);
    };
  }

  function compileBars(value, path) {
    if (value === undefined) return [];
    if (!Array.isArray(value)) {
      at(path, "must be a list of rows");
      return [];
    }
    return value.map((row, index) => compileList(row, `${path}[${index}]`));
  }

  const actionRef = (ref, where) => compileActionRef(ref, where, actions, at, env);
  const compileButtons = (value, path, options) => compileActionButtons(value, path, actions, at, env, options);

  function compileLeaf(el, path, options) {
    const control = env.controls[el.control];
    if (!control) {
      at(`${path}.control`, `"${el.control}" is not a control`);
      return null;
    }
    // A control used from a declaration says what it takes, typed.
    if (Array.isArray(control.params)) {
      at(`${path}.control`, `"${el.control}" lists its params without types, so it cannot be used from a declaration`);
      return null;
    }
    const table = control.params || {};
    let value = null;
    let adapter = control.declarationAdapter;
    const constants = {};
    const binds = {};
    const elementReads = {};
    const states = {};
    const fromItem = {};
    const dynamic = {};
    // The element a control stands in (the innermost `each`): an action it calls is given that element, as a
    // card's button is, with what the control says added.
    const element = [...aliases.keys()].at(-1) || null;
    const elementActions = {};
    const views = el.views === undefined ? control.declarationViews :
      compileViews(el.views, `${path}.views`, control, at, (layout, where) => {
        const nodes = compileList(layout, where);
        return (item, api, scope) => buildNodes(nodes, item, api, scope);
      });
    const slots = record(el.slots, `${path}.slots`);
    const slotBuilders = { ...control.declarationSlots };
    const toolKeys = new Set();
    for (const [name, layout] of Object.entries(slots)) {
      const where = `${path}.slots.${name}`;
      if (!control.declarationSlotNames?.includes(name)) at(where, `is not a slot of ${el.control}`);
      else if (name === "bars") {
        const rows = compileBars(layout, where);
        slotBuilders.bars = (item, api, scope) => rows.map((row) => buildNodes(row, item, api, scope));
      } else if (name === "body") {
        const body = compileList(layout, where);
        slotBuilders.body = (item, api, scope) => buildNodes(body, item, api, scope);
      } else {
        const buttons = compileButtons(layout, where, {
          header: true, primary: name === "lead", keys: toolKeys,
          anchors: name === "tools" ? control.declarationToolAnchors : undefined,
        });
        if (name === "lead" && buttons.length > 1) at(where, "a card has at most one primary button");
        slotBuilders[name] = (item) => buttons.map((one) => one(item));
      }
    }
    for (const [arg, given] of Object.entries(options)) {
      const where = `${path}.options.${arg}`;
      if (arg === "value") {
        if (!isObject(given) || typeof given.bind !== "string" ||
            Object.keys(given).some((key) => key !== "bind" && key !== "via")) {
          at(where, 'must be { "bind": property } with an optional "via" adapter');
        } else {
          value = reference(given.bind);
          if (!value) at(where, `"${given.bind}" is not a property of this item or repeated element`);
          else if (value.root) placed.add(value.root);
          if (Object.hasOwn(given, "via")) adapter = resolveValueAdapter(given.via, control, env, `${where}.via`, at);
        }
        continue;
      }
      if (!Object.hasOwn(table, arg)) {
        at(where, `is not something "${el.control}" takes`);
        continue;
      }
      const bindable = ["read", "readwrite"].includes(table[arg].bind);
      if (arg === "view" && (!views?.length ||
          (isBind(given) ? !writable(given.bind) || properties[given.bind].type !== "string" :
            !isObject(given) || Object.keys(given).length !== 1 || !Object.hasOwn(given, "state")))) {
        at(where, "requires views and must bind to a writable string property or display state");
      } else if (arg === "features" && control.textcard?.features && !validFeatures(given, control.textcard.features)) {
        at(where, "must list supported text card features without duplicates");
      } else if (arg === "emptyAction" && table[arg].type === "action") {
        dynamic.emptyAction = compileEmptyAction(given, where, actions, at, env);
        if (options.busy === undefined && Object.hasOwn(table, "busy") && dynamic.emptyAction.actionName) {
          const actionName = dynamic.emptyAction.actionName;
          dynamic.busy = (item) => env.actionStatus(item, actionName).state === "busy";
        }
      } else if (table[arg].type === "action") {
        if (element) elementActions[arg] = actionRef(given, where);
        else dynamic[arg] = actionRef(given, where);
      } else if (table[arg].type === "buttons") {
        const buttons = compileButtons(given, where);
        dynamic[arg] = (item) => buttons.map((button) => button(item));
      } else if (isObject(given) && Object.keys(given).length === 1 && Object.hasOwn(given, "status")) {
        if (table[arg].type !== "data" || typeof given.status !== "string" || !Object.hasOwn(actions, given.status)) {
          at(where, 'must name an item action in a "data" argument');
        } else dynamic[arg] = (item) => env.actionStatus(item, given.status);
      } else if (isBind(given) && !Object.hasOwn(properties, given.bind) && reference(given.bind)?.alias) {
        // A list element, or a field of one: read where the element stands (the shell's `binds`
        // keep item properties only), so the argument is given, not written back.
        const ref = reference(given.bind);
        if (!bindable) at(where, `"${arg}" of "${el.control}" cannot be bound`);
        else if (table[arg].bind !== "read") at(where, `"${arg}" of "${el.control}" is written back; an element can be read only`);
        else elementReads[arg] = ref;
      } else if (isBind(given)) {
        if (!bindable) at(where, `"${arg}" of "${el.control}" cannot be bound`);
        else if (property(where, given.bind)) binds[arg] = given.bind;
      } else if (isObject(given) && Object.keys(given).length === 1 && Object.hasOwn(given, "state")) {
        if (typeof given.state !== "string" || !given.state.trim()) at(where, '{ "state": ... } needs a nonempty name');
        else if (table[arg].state !== true) at(where, `"${arg}" of "${el.control}" does not declare display state`);
        else states[arg] = given.state;
      } else if (isItemRef(given)) {
        if (given.item !== "id") at(where, '{ "item": ... } only names "id"');
        else fromItem[arg] = given.item;
      } else if (isObject(given) && Object.values(given).some(isBind)) {
        // A set of values, each kept in a property of its own.
        if (!bindable) at(where, `"${arg}" of "${el.control}" cannot be bound`);
        const map = {};
        for (const [field, one] of Object.entries(given)) {
          if (!isBind(one)) at(`${where}.${field}`, 'must be { "bind": property } like the rest');
          else if (property(`${where}.${field}`, one.bind)) map[field] = one.bind;
        }
        binds[arg] = map;
      } else {
        constants[arg] = given;
      }
    }
    if (!value && (!control.standalone || adapter)) at(`${path}.options.value`, `"${el.control}" shows a value: give it { "bind": property }`);
    // `row: true`: drawn as a row of a property table -- the field's label beside it -- not as a control alone.
    if (el.row !== undefined && (el.row !== true || !value?.alias)) at(`${path}.row`, "is true, on a control that shows a field of a repeated element");
    if (value && adapter && value.spec.type !== adapter.from) {
      at(`${path}.options.value`, `adapter requires a ${adapter.from} property, got ${value.spec.type}`);
    }
    if (value?.alias && !adapter) {
      const methods = env.valueTypes[value.spec.type]?.methods;
      const missing = (control.needs || []).find((method) => typeof methods?.[method] !== "function");
      if (missing) at(`${path}.options.value`, `element value type ${value.spec.type} does not support ${missing}`);
    }
    const localActions = Object.values(control.declarationActions || {});
    if (localActions.length) {
      const type = adapter?.to ?? value?.spec.type;
      if (control.declarationActionValueType && type !== control.declarationActionValueType) {
        at(`${path}.options.value`, `control actions require a ${control.declarationActionValueType} value`);
      }
      for (const action of localActions) {
        if (!action.permissions.every((permission) => permissions?.includes?.(permission))) {
          at(path, "item does not declare all permissions needed by the control actions");
        }
      }
      const outputs = new Set(localActions.flatMap((action) => Object.values(action.outputs)));
      for (const arg of outputs) {
        if (arg === "value") continue; // Read-only values can display the control with its write actions disabled.
        const binding = binds[arg];
        const usesState = table[arg].state === true && (!Object.hasOwn(options, arg) || Object.hasOwn(states, arg));
        const available = typeof binding === "string" ? writable(binding) :
          binding ? Object.values(binding).every(writable) : usesState;
        if (!available || (arg === "view" && !views?.length && !binding)) {
          at(`${path}.options.${arg}`, "control action output needs a writable binding or display state");
        }
      }
    }
    return (item, api, scope) => {
      const params = { control: el.control, ...constants };
      for (const arg of Object.keys(fromItem)) params[arg] = item.id;
      for (const [arg, read] of Object.entries(dynamic)) params[arg] = read(item);
      for (const [arg, ref] of Object.entries(elementActions)) {
        const run = ref(item);
        params[arg] = (payload) => {
          const held = scope?.get(element)?.property.get();
          const given = payload && typeof payload === "object" && !Array.isArray(payload) ? payload : null;
          return run(held && typeof held === "object" && (given || payload === undefined) ? { ...held, ...(given || {}) } : payload);
        };
      }
      for (const [arg, ref] of Object.entries(elementReads)) params[arg] = binding(ref, item, api, scope).property.get();
      if (Object.keys(binds).length) params.binds = binds;
      if (Object.keys(states).length) params.states = states;
      if (adapter) params.valueAdapter = adapter;
      if (Object.keys(slotBuilders).length) {
        params.slotNodes = Object.fromEntries(Object.entries(slotBuilders).map(([name, build]) => [name, build(item, api, scope)]));
      }
      if (views?.length) {
        params.viewNodes = views.map(({ build, ...view }) => ({
          ...view, label: env.t(view.label), ...(build ? { layout: build(item, api, scope) } : {}),
        }));
      }
      if (!value) return env.NODES.control(el.key, params);
      if (!value.alias && !value.fields?.length) return env.NODES.control(el.key, value.root, params);
      const ref = binding(value, item, api, scope);
      const path = ref.property.steps();
      const desc = env.describeProperty(ref.property, {
        key: JSON.stringify([item.id, ref.root, path]),
        label: value.spec.label ? env.t(value.spec.label) : value.fields.at(-1) || "",
      });
      if (el.row) {
        const { control: _name, ...given } = params;
        return env.NODES.props(el.key, [{
          ...desc, control, readonly: Boolean(value.readonly || desc.readonly),
          params: { ...(desc.params || {}), ...given, port: { item: item.id, key: ref.root, path } },
        }]);
      }
      return env.NODES.control(el.key, {
        ...params, desc: { ...desc, readonly: Boolean(value.readonly || desc.readonly) },
        port: { item: item.id, key: ref.root, path },
      });
    };
  }

  // ---- the output card (docs/auto-layout-proposal.md §7.1) ----
  // What an action made, held as a card: the grip carries it, the value is drawn by its type's
  // preview, and the header's one primary button is what can be done now -- run while there is
  // nothing, cancel while it runs, delete once there is something (deleting puts the property back
  // to its default, so a plugin needs no clear action of its own).
  //   { "control": "output", "key": k, "options": { "value": { "bind": p }, "run": action,
  //     "label"?: key, "empty"?: key, "runLabel"?: key } }
  function compileOutput(el, path, options) {
    for (const key of ["layout", "slots", "views"]) if (el[key] !== undefined) at(`${path}.${key}`, `output has no ${key}`);
    for (const arg of Object.keys(options)) {
      if (!["value", "run", "label", "empty", "runLabel"].includes(arg)) at(`${path}.options.${arg}`, "is not something output takes");
    }
    for (const arg of ["label", "empty", "runLabel"]) {
      if (options[arg] !== undefined && (typeof options[arg] !== "string" || !options[arg])) at(`${path}.options.${arg}`, "must be a translation key");
    }
    if (!isBind(options.value)) {
      at(`${path}.options.value`, 'must be { "bind": property }');
      return null;
    }
    const source = reference(options.value.bind);
    if (!source || !source.root || source.fields?.length || source.alias) {
      at(`${path}.options.value`, `"${options.value.bind}" is not a property of this item`);
      return null;
    }
    // Without `run` the card only holds a result something else writes: it can be deleted, not made here.
    const runName = options.run;
    if (runName !== undefined && (typeof runName !== "string" || !Object.hasOwn(actions, runName))) {
      at(`${path}.options.run`, "must name an action of this item");
      return null;
    }
    const shown = compileFromType({ control: { fromType: options.value }, key: `${el.key}-value` }, path, {});
    const spec = source.spec;
    const fresh = () => {
      const def = env.valueTypes[spec.type];
      if (spec.default !== undefined) return JSON.parse(JSON.stringify(spec.default));
      return def?.defaultValue ? def.defaultValue({ ...(def.defaults || {}), ...spec }) : null;
    };
    const blank = (value) => value === null || value === undefined || value === "" ||
      (Array.isArray(value) && !value.length) || (isObject(value) && !Object.keys(value).length);
    return (item, api, scope) => {
      const ref = binding(source, item, api, scope);
      const value = ref.property.get();
      // Nothing made yet: no value, or the value the property starts with (a record type's default is an object).
      const def = env.valueTypes[spec.type];
      const start = fresh();
      const empty = blank(value) || JSON.stringify(value) === JSON.stringify(def?.coerce ? def.coerce(start, { ...(def.defaults || {}), ...spec }) : start);
      const status = runName ? env.actionStatus(item, runName) : { state: "ready" };
      const busy = status.state === "busy";
      const cancellable = Boolean(runName && actions[runName].cancellable);
      const tool = !runName && empty ? null : busy
        ? { key: "act", icon: "stop-fill", label: env.t("mu.action.cancel"), title: status.message || env.t("mu.action.cancel"),
            primary: true, disabled: !cancellable, run: () => env.cancelAction(item, runName) }
        : empty
          ? { key: "act", icon: "play-fill", label: env.t(options.runLabel || "mu.action.run"), title: status.message || env.t(options.runLabel || "mu.action.run"),
              primary: true, disabled: status.state === "blocked", run: () => env.runAction(item, runName) }
          : { key: "act", icon: "x-lg", label: env.t("mu.action.delete"), title: env.t("mu.action.delete"),
              primary: true, run: () => { ref.property.set(fresh()); env.refreshAll?.(); } };
      const title = options.label ? env.t(options.label) : spec.label ? env.t(spec.label) : "";
      // A value whose type has no preview is read as text (tier 1 of a type's preview): what its type
      // formats it as, in the shell's text card, with no card of its own.
      const previewed = !empty && resolveFromTypePreview(spec.type, value, spec);
      const asText = () => {
        const def = env.valueTypes[spec.type];
        const text = typeof value === "string" ? value : def?.format ? def.format(value) : JSON.stringify(value);
        return [env.NODES.control(`${el.key}-text`, {
          control: "texteditor", bare: true, readonly: true, grow: true,
          desc: env.describe({ type: "string", readonly: true, read: () => text }, { api, key: `${item.id}-${el.key}-text`, label: title }),
        })];
      };
      const children = empty ? [] : previewed ? [].concat(shown ? shown(item, api, scope) || [] : []) : asText();
      const extra = { port: { item: item.id, key: ref.root }, ...(options.empty ? { empty: env.t(options.empty) } : {}) };
      // A list is held as a list card (the one way to make a list), whatever draws its entries.
      return spec.type === "list"
        ? env.NODES.listCard(el.key, children, { ...extra, title, tools: tool ? [tool] : [] })
        : env.NODES.card(el.key, title, children, tool ? [tool] : [], extra);
    };
  }

  function compileFromType(el, path, options) {
    if (el.layout !== undefined) at(`${path}.layout`, "fromType holds no layout");
    if (el.slots !== undefined) at(`${path}.slots`, "fromType has no slots");
    if (el.views !== undefined) at(`${path}.views`, "fromType does not support views");
    if (Object.keys(el.control).length !== 1 || !isBind(el.control.fromType)) {
      at(`${path}.control`, 'dynamic control must be { "fromType": { "bind": property } }');
      return null;
    }
    const source = reference(el.control.fromType.bind);
    if (!source) {
      at(`${path}.control.fromType`, `"${el.control.fromType.bind}" is not a property of this item or repeated element`);
      return null;
    }
    if (source.root) placed.add(source.root);
    for (const [arg, val] of Object.entries(options)) {
      if (arg === "label" || arg === "empty") {
        if (typeof val !== "string") at(`${path}.options.${arg}`, "must be a translation key");
      } else if (arg === "compact") {
        if (typeof val !== "boolean") at(`${path}.options.compact`, "must be true or false");
      } else {
        at(`${path}.options.${arg}`, "is not something fromType takes");
      }
    }
    const compact = Boolean(options.compact);
    return (item, api, scope) => {
      const ref = binding(source, item, api, scope);
      const held = ref.property.get();
      const port = source.alias || source.fields?.length
        ? { item: item.id, key: ref.root, path: ref.property.steps() }
        : { item: item.id, key: ref.root };
      const customLabel = options.label ? env.t(options.label) : null;
      const customEmpty = options.empty ? env.t(options.empty) : "";
      const propReadonly = Boolean(source.readonly || ref.property.params?.readonly);

      const resolved = resolveFromTypePreview(source.spec.type, held, source.spec);
      if (!resolved) {
        return missingPreviewNode(el.key, describeUnpreviewable(source.spec.type, held), port);
      }
      const { typeName, typeDef, kind: shownKind, value: shownValue, canEdit, writeBack } = resolved;
      const preview = typeDef.preview;
      if (!previewFitsRuntime(preview, typeDef, shownValue)) {
        return missingPreviewNode(el.key, typeName || shownKind || source.spec.type, port);
      }
      const writable = Boolean(preview.editable && !propReadonly && canEdit && typeof writeBack === "function");
      const set = writable ? (next) => writeBack(ref.property, next) : null;
      const label = customLabel ?? (typeDef.label ? env.t(typeDef.label) : shownKind || typeName);
      if (typeof preview.build === "function") {
        const built = preview.build({
          api,
          value: shownValue,
          port,
          clear: null,
          set,
          readonly: !writable,
          prefix: `${item.id}-${el.key}-${shownKind || typeName}`,
          label,
        });
        if (!Array.isArray(built) || !built.length) {
          return missingPreviewNode(el.key, typeName || shownKind, port);
        }
        if (built.length === 1) return { ...built[0], key: el.key };
        return built.map((node, index) => ({ ...node, key: `${el.key}-${node.key ?? index}` }));
      }
      const controlName = preview.control;
      if (controlName === "imagecard") {
        const images =
          shownKind === "imagelist" || typeName === "imagelist"
            ? (Array.isArray(shownValue) ? shownValue.map((one) => (isObject(one) ? String(one.src || "") : String(one || ""))).filter(Boolean) : [])
            : typeof shownValue === "string" && shownValue
              ? [shownValue]
              : [];
        return env.NODES.control(el.key, {
          control: "imagecard",
          port,
          images,
          showSize: false,
          fill: !compact,
          grow: true,
          defaultFull: !compact,
          empty: customEmpty || env.t(shownKind ? "mu.preview.nothing" : "mu.preview.empty"),
          onClear: null,
        });
      }
      if (controlName === "audiocard") {
        return env.NODES.control(el.key, {
          control: "audiocard",
          port,
          src: typeof shownValue === "string" ? shownValue : "",
          empty: customEmpty || env.t("mu.preview.nothing"),
          onClear: null,
        });
      }
      const control = env.controls[controlName];
      const allowed = new Set(namesOf(control.params));
      const previewOptions = {};
      for (const [k, v] of Object.entries(preview.options || {})) {
        if (k !== "value") previewOptions[k] = v;
      }
      const descKey = `${item.id}-${el.key}-${shownKind || typeName}`;
      return env.NODES.control(el.key, {
        control: controlName,
        ...(allowed.has("port") ? { port } : {}),
        ...(customEmpty && allowed.has("empty") ? { empty: customEmpty } : {}),
        ...(allowed.has("fill") && previewOptions.fill === undefined ? { fill: !compact } : {}),
        ...(allowed.has("defaultFull") && previewOptions.defaultFull === undefined ? { defaultFull: !compact } : {}),
        ...previewOptions,
        grow: true,
        readonly: !writable,
        desc: env.describe(
          {
            ...(typeDef.defaults || {}),
            type: typeName,
            readonly: !writable,
            read: () => shownValue,
            ...(writable ? { write: (_api, next) => set(next) } : {}),
          },
          { api, key: descKey, label }
        ),
      });
    };
  }

  function resolveFromTypePreview(propType, held, spec = null) {
    const isPortValue = propType === "portvalue" || Boolean(env.valueTypes[propType]?.ancestors?.includes("portvalue"));
    if (isPortValue) {
      if (!isObject(held) || typeof held.kind !== "string" || !held.kind) return null;
      const kind = held.kind;
      const value = held.value;
      const direct = Object.entries(env.valueTypes).find(([, def]) => def.port === kind && def.preview);
      if (direct) {
        return {
          typeName: direct[0],
          typeDef: direct[1],
          kind,
          value,
          canEdit: true,
          writeBack: (prop, next) => prop.set({ kind, value: next }),
        };
      }
      if (typeof env.portConvert === "function") {
        const hasPortText = Object.values(env.valueTypes).some((def) => def.port === kind && typeof def.portText === "function");
        if (!hasPortText) {
          for (const [typeName, typeDef] of Object.entries(env.valueTypes)) {
            if (!typeDef.port || !typeDef.preview) continue;
            const converted = env.portConvert(value, kind, typeDef.port);
            if (converted !== null && converted !== undefined && converted !== "" && (!Array.isArray(converted) || converted.length > 0)) {
              return {
                typeName,
                typeDef,
                kind: typeDef.port,
                value: converted,
                canEdit: false,
                writeBack: null,
              };
            }
          }
        }
      }
      return null;
    }
    if (propType === "data" && isObject(held)) {
      if (typeof held.type === "string" && env.valueTypes[held.type]?.preview) {
        const typeDef = env.valueTypes[held.type];
        return {
          typeName: held.type,
          typeDef,
          kind: typeDef.port || held.type,
          value: held.value,
          canEdit: true,
          writeBack: (prop, next) => prop.set({ ...held, value: next }),
        };
      }
      if (typeof held.kind === "string" && held.kind) {
        return resolveFromTypePreview("portvalue", held);
      }
      return null;
    }
    // A list is previewed as its element type says a list of it is (`list.preview` of the element).
    const element = propType === "list" ? env.valueTypes[spec?.each?.type] : null;
    if (element?.list?.preview && env.valueTypes.list) {
      return {
        typeName: "list",
        typeDef: {
          ...env.valueTypes.list,
          defaults: { ...(env.valueTypes.list.defaults || {}), each: spec.each },
          preview: element.list.preview,
          ...(element.list.label ? { label: element.list.label } : {}),
        },
        kind: element.list.port || "list",
        value: held,
        canEdit: true,
        writeBack: (prop, next) => prop.set(next),
      };
    }
    const typeDef = env.valueTypes[propType];
    if (typeDef?.preview) {
      return {
        typeName: propType,
        typeDef,
        kind: typeDef.port || propType,
        value: held,
        canEdit: true,
        writeBack: (prop, next) => prop.set(next),
      };
    }
    return null;
  }

  function previewFitsRuntime(preview, typeDef, value) {
    if (!preview) return false;
    if (!valueFitsType(typeDef, value)) return false;
    if (typeof preview.build === "function") return true;
    const control = env.controls[preview.control];
    if (!control) return false;
    if (preview.control !== "imagecard" && preview.control !== "audiocard") {
      const missing = (control.needs || []).some((method) => typeof typeDef.methods?.[method] !== "function");
      if (missing) return false;
    }
    return true;
  }

  function valueFitsType(typeDef, value) {
    if (!typeDef) return false;
    if (typeDef.fields) return isObject(value);
    if (typeDef.ancestors?.includes("list") || typeDef.defaultControl === "list" || Array.isArray(typeDef.defaults?.default)) {
      return Array.isArray(value);
    }
    return value !== undefined;
  }

  function describeUnpreviewable(propType, held) {
    if (isObject(held)) {
      if (typeof held.kind === "string" && held.kind) return held.kind;
      if (typeof held.type === "string" && held.type) return held.type;
    }
    return propType || "?";
  }

  function missingPreviewNode(key, typeOrKind, port) {
    return env.NODES.card(
      key,
      "",
      [
        env.NODES.props(`${key}-missing`, [
          {
            key: `${key}-missing-type`,
            label: env.t("mu.field.type"),
            type: "string",
            params: {},
            value: String(typeOrKind || "?"),
            readonly: true,
            missing: true,
          },
        ]),
      ],
      [],
      { port, readonly: true }
    );
  }

  function compileFields(el, path, options) {
    if (el.slots !== undefined) at(`${path}.slots`, "fields has no slots");
    let fieldsRef = null;
    let valuesRef = null;
    for (const [arg, given] of Object.entries(options)) {
      const where = `${path}.options.${arg}`;
      if (arg === "fields") {
        if (!isBind(given)) at(where, 'must be { "bind": property }');
        else {
          fieldsRef = reference(given.bind);
          if (!fieldsRef) at(where, `"${given.bind}" is not a property of this item or repeated element`);
          else if (fieldsRef.root) placed.add(fieldsRef.root);
        }
      } else if (arg === "values") {
        if (!isBind(given)) at(where, 'must be { "bind": property }');
        else {
          valuesRef = reference(given.bind);
          if (!valuesRef) at(where, `"${given.bind}" is not a property of this item or repeated element`);
          else if (valuesRef.root) placed.add(valuesRef.root);
        }
      } else {
        at(where, 'is not something "fields" takes');
      }
    }
    if (!Object.hasOwn(options, "fields")) {
      at(`${path}.options.fields`, 'fields requires options.fields as { "bind": property }');
    }
    return (item, api, scope) => {
      if (!fieldsRef) return env.NODES.props(el.key, []);
      const rawSchema = binding(fieldsRef, item, api, scope).property.get();
      const entries = normalizeFieldEntries(rawSchema);
      if (!entries.length) return env.NODES.props(el.key, []);
      const valuesBinding = valuesRef ? binding(valuesRef, item, api, scope) : null;
      const valuesProp = valuesBinding?.property || null;
      const valuesReadonly = Boolean(!valuesProp || valuesRef.readonly || valuesProp.params?.readonly);
      const currentContainer = valuesProp ? valuesProp.get() : null;
      const containerValid =
        !valuesProp ||
        currentContainer === null ||
        currentContainer === undefined ||
        (Array.isArray(currentContainer) && currentContainer.every((one) => isObject(one) && (typeof one.id === "string" || typeof one.key === "string"))) ||
        isObject(currentContainer);

      const rows = entries.map((entry, index) => {
        const fieldKey = entry.key || `#${index}`;
        const label = entry.label ? env.t(entry.label) : fieldKey;
        const rowKey = `${item.id}-${el.key}-${fieldKey}-${entry.type || "missing"}`;
        const typeDef = entry.valid && entry.type ? env.valueTypes[entry.type] : null;
        const controlName = entry.control || typeDef?.defaultControl;
        const control = controlName ? env.controls[controlName] : null;
        const methodsFit = Boolean(
          typeDef &&
          control &&
          (control.needs || []).every((method) => typeof typeDef.methods?.[method] === "function")
        );
        const rawVal = readDynamicFieldValue(currentContainer, fieldKey, entry.spec, typeDef);
        const valFits = Boolean(methodsFit && containerValid && fieldValueFits(entry.type, typeDef, rawVal));
        if (!entry.valid || !valFits) {
          return {
            key: `${item.id}-${el.key}-${fieldKey}-missing`,
            label,
            type: "string",
            params: {},
            value: String(entry.type || "?"),
            readonly: true,
            missing: true,
          };
        }
        return env.describe(
          {
            ...(typeDef.defaults || {}),
            ...entry.spec,
            type: entry.type,
            readonly: Boolean(valuesReadonly || entry.spec.readonly),
            read: () => readDynamicFieldValue(valuesProp ? valuesProp.get() : null, fieldKey, entry.spec, typeDef),
            ...(!valuesReadonly && !entry.spec.readonly
              ? {
                  write: (_api, next) => writeDynamicFieldValue(valuesProp, fieldKey, next),
                }
              : {}),
          },
          { api, item, key: rowKey, label }
        );
      });
      return env.NODES.props(el.key, rows);
    };
  }

  function normalizeFieldEntries(rawSchema) {
    if (Array.isArray(rawSchema)) {
      return rawSchema.map((one, index) => normalizeOneField(one, null, index));
    }
    if (isObject(rawSchema)) {
      return Object.entries(rawSchema).map(([key, one], index) => normalizeOneField(one, key, index));
    }
    return [];
  }

  function normalizeOneField(raw, explicitKey, index) {
    if (!isObject(raw)) {
      return { valid: false, key: explicitKey || `#${index}`, label: explicitKey || `#${index}`, type: "", spec: {} };
    }
    const key =
      typeof explicitKey === "string" && explicitKey
        ? explicitKey
        : typeof raw.key === "string" && raw.key
          ? raw.key
          : typeof raw.id === "string" && raw.id
            ? raw.id
            : raw.node_id !== undefined && raw.input_key !== undefined
              ? `${raw.node_id}::${raw.input_key}`
              : "";
    const label =
      typeof raw.label === "string" && raw.label
        ? raw.label
        : typeof raw.input_key === "string" && raw.input_key
          ? raw.input_key
          : key || `#${index}`;
    let type = typeof raw.type === "string" ? raw.type : "";
    const spec = { ...raw };
    if (!type && typeof raw.value_type === "string") {
      if (Array.isArray(raw.options) && raw.options.length) {
        type = "enum";
        const values = raw.default !== undefined && !raw.options.includes(String(raw.default))
          ? [String(raw.default), ...raw.options]
          : raw.options;
        spec.options = values.map((v) => (isObject(v) ? v : { value: String(v), label: String(v) }));
      } else if (raw.value_type === "integer") {
        type = "number";
        if (spec.step === undefined) spec.step = 1;
      } else if (raw.value_type === "number") {
        type = "number";
      } else if (raw.value_type === "boolean") {
        type = "boolean";
      } else if (raw.value_type === "string") {
        type = "string";
      } else {
        type = raw.value_type;
      }
    } else if (type === "enum" && Array.isArray(raw.options)) {
      spec.options = raw.options.map((v) => (isObject(v) ? v : { value: String(v), label: String(v) }));
    }
    if (!key || !type) {
      return { valid: false, key: key || `#${index}`, label, type, spec };
    }
    return { valid: true, key, label, type, control: raw.control, spec };
  }

  function readDynamicFieldValue(container, fieldKey, spec, typeDef) {
    if (Array.isArray(container)) {
      const found = container.find((one) => isObject(one) && (one.id === fieldKey || one.key === fieldKey));
      if (found && found.value !== undefined) return found.value;
    } else if (isObject(container) && Object.hasOwn(container, fieldKey) && container[fieldKey] !== undefined) {
      return container[fieldKey];
    }
    if (spec && spec.default !== undefined) return spec.default;
    if (typeDef && typeof env.defaultFor === "function" && spec?.type) return env.defaultFor(spec);
    if (typeof typeDef?.defaultValue === "function") return typeDef.defaultValue(spec || {});
    return undefined;
  }

  function writeDynamicFieldValue(valuesProp, fieldKey, value) {
    const current = valuesProp.get();
    if (Array.isArray(current)) {
      const useKey = current.some((one) => isObject(one) && Object.hasOwn(one, "key") && !Object.hasOwn(one, "id"));
      const rest = current.filter((one) => !isObject(one) || (one.id ?? one.key) !== fieldKey);
      valuesProp.set([...rest, useKey ? { key: fieldKey, value } : { id: fieldKey, value }]);
      return;
    }
    const base = isObject(current) ? current : {};
    valuesProp.set({ ...base, [fieldKey]: value });
  }

  function fieldValueFits(typeName, typeDef, value) {
    if (value === undefined || value === null) return true;
    if (typeName === "number" || typeDef?.ancestors?.includes("number")) {
      return typeof value === "number" && Number.isFinite(value);
    }
    if (typeName === "boolean" || typeDef?.ancestors?.includes("boolean")) {
      return typeof value === "boolean";
    }
    if (typeName === "string" || typeName === "enum" || typeDef?.ancestors?.includes("string") || typeDef?.ancestors?.includes("enum")) {
      return typeof value === "string";
    }
    if (typeName === "vector" || typeDef?.ancestors?.includes("vector") || typeName === "list" || typeDef?.ancestors?.includes("list")) {
      return Array.isArray(value);
    }
    if (typeDef?.fields) {
      return isObject(value);
    }
    return true;
  }

  function compileList(list, path, topLevel = false) {
    if (list === undefined) return [];
    if (!Array.isArray(list)) {
      at(path, "must be a list");
      return [];
    }
    const keys = new Set();
    const out = [];
    list.forEach((el, index) => {
      if (isObject(el) && typeof el.key === "string") {
        if (keys.has(el.key)) at(`${path}[${index}].key`, `"${el.key}" is used twice here`);
        keys.add(el.key);
      }
      const one = compileElement(el, `${path}[${index}]`, topLevel);
      if (one) out.push(one);
    });
    return out;
  }

  // A screen is what draws the whole body in code, where a layout cannot say it (what it holds is
  // asked of a server, the disk or a library): `"screen": "name"`, drawn by `export const screens`
  // of the plugin's scripts. It takes the layout's place, so an item has one or the other.
  let screenName = null;
  if (decl.screen !== undefined) {
    if (typeof decl.screen !== "string" || !decl.screen.trim()) at("screen", "must name a screen exported by the plugin's scripts");
    else if (decl.layout !== undefined) at("screen", "an item has a layout or a screen, not both");
    else screenName = decl.screen;
  }
  // No layout and no screen, but hints: the layout is made from what the properties and actions mean.
  const automatic = !screenName && decl.layout === undefined &&
    (hinted.size > 0 || Object.values(isObject(decl.actions) ? decl.actions : {}).some((one) => isObject(one) && (one.label !== undefined || one.main !== undefined)));
  const layout = screenName ? [] : compileList(automatic ? autoLayout(decl, properties, hinted, at) : decl.layout, "layout", true);
  if (problems.length) return { name, def: null, problems };

  // A property the layout shows is placed: not a row of the item's own table. A screen shows what it
  // chooses to, so all of them are.
  if (screenName) for (const key of Object.keys(properties)) placed.add(key);
  for (const key of placed) properties[key].placed = true;
  const appSurface = decl.surface === undefined ? null : compileSurface(decl.surface, { properties, actions, env, at });
  let drop = null;
  if (decl.drop !== undefined) {
    const spec = decl.drop;
    if (!isObject(spec) || Object.keys(spec).some((key) => !["kind", "label", "action"].includes(key)) ||
        typeof spec.kind !== "string" || !spec.kind || typeof spec.label !== "string" || !spec.label ||
        typeof spec.action !== "string" || !Object.hasOwn(actions, spec.action)) {
      at("drop", "must have a kind, a translation label and an item action");
    } else {
      drop = { kind: spec.kind, label: spec.label, put: (item, value) => env.runAction(item, spec.action, { value }) };
    }
  }
  if (problems.length) return { name, def: null, problems };
  // What a screen is given: what the item holds now (`props`, and `read` for the same asked later, by an event
  // handler), a property written, and an action of the item run by name with what it is given.
  let redrawAsked = false;
  const redrawSoon = () => {
    if (redrawAsked || typeof env.refreshAll !== "function") return;
    redrawAsked = true;
    queueMicrotask(() => {
      redrawAsked = false;
      env.refreshAll();
    });
  };
  const makeScreen = (item, api, ctx) => {
    const read = (key) => env.bindProperty(item, key, api).get();
    return {
      item,
      api,
      ctx,
      props: Object.fromEntries(Object.keys(properties).map((key) => [key, read(key)])),
      read,
      // A write from a button of the screen (not a control's, which redraws when it is done) is seen once
      // the screen is drawn again: one redraw for the writes of one turn.
      set: (key, value) => {
        env.bindProperty(item, key, api).set(value);
        redrawSoon();
      },
      run: (action, payload) => env.runAction(item, action, payload),
    };
  };
  const def = {
    label: decl.label,
    ...(decl.icon ? { icon: decl.icon } : {}),
    ...(decl.standalone ? { standalone: true } : {}),
    permissions,
    properties,
    ...(Object.keys(actions).length ? { actions } : {}),
    ...(appSurface ? { appSurface } : {}),
    ...(drop ? { drop } : {}),
    ...(screenName ? {
      body: (api, item, ctx) => env.screenScripts?.get(screenName)?.body(makeScreen(item, api, ctx)) || [],
      // Once, when a window shows the item: what the screen does as it opens.
      mount: (ctx) => env.screenScripts?.get(screenName)?.mount?.(makeScreen(ctx.item, ctx.api, ctx)),
    } : { body: (api, item) => buildNodes(layout, item, api) }),
  };
  return { name, def, problems, derivedScripts: [...derivedScripts], screenScript: screenName };
}

// ---- the surface: what a chain may press, set and read of an item --------------------------------
// `surface` says it in full (what is not listed is not offered):
//   buttons  [{ action, label, key?, primary?, node?, tool? }]   an action of the item, pressed by name
//   inputs   [{ property, key?, label?, kind?, spec?, node?, wide?, defaultKind? }]   a property that is set
//   outputs  [{ property, key?, label?, kind?, node?, display? }]   a property that is read
//   prepare  the name of an action called before a property is pointed at on screen (a result card that took
//            the form's place is closed, say): nothing can be pointed at while the form is not drawn
// `node` (a node key, or a list of them) says which node of the screen is the thing, for pointing at it. The
// kind is what is carried; it follows the type of a text, a number and a switch, and a `portvalue` carries its
// own ({kind, value}: read as its value, set from a kind and a value). Anything else says its `kind`.
const SURFACE_KEYS = new Set(["buttons", "inputs", "outputs", "prepare"]);
const kindOfType = (type) => (type === "boolean" ? "boolean" : type === "number" ? "number" : type === "string" || type === "enum" ? "text" : "");

function compileSurface(surface, { properties, actions, env, at }) {
  const record = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
  if (!record(surface)) {
    at("surface", "must be an object");
    return null;
  }
  for (const key of Object.keys(surface)) if (!SURFACE_KEYS.has(key)) at(`surface.${key}`, "is not a key of a surface");
  const list = (name) => (surface[name] === undefined ? [] : Array.isArray(surface[name]) ? surface[name] : (at(`surface.${name}`, "must be a list"), []));
  const nodeOk = (value) => value === undefined || typeof value === "string" || (Array.isArray(value) && value.every((one) => typeof one === "string"));
  const known = (path, given, allowed) => {
    for (const key of Object.keys(given)) if (!allowed.includes(key)) at(`${path}.${key}`, "is not a key here");
  };
  // A key is used once among the buttons, once among the inputs and once among the outputs (an input and an output
  // may share a name: they are asked for apart).
  const seen = { buttons: new Set(), inputs: new Set(), outputs: new Set() };
  const unique = (path, key, kind) => {
    if (seen[kind].has(key)) at(`${path}.key`, `"${key}" is used twice`);
    seen[kind].add(key);
  };

  const buttons = list("buttons").map((one, index) => {
    const path = `surface.buttons[${index}]`;
    if (!record(one)) return at(path, "must be an object");
    known(path, one, ["action", "label", "key", "primary", "node", "tool"]);
    if (typeof one.action !== "string" || !Object.hasOwn(actions, one.action)) at(`${path}.action`, "must name an action of the item");
    if (typeof one.label !== "string" || !one.label) at(`${path}.label`, "must be a translation key");
    if (!nodeOk(one.node)) at(`${path}.node`, "must be a node key or a list of them");
    unique(path, one.key || `${one.node || ""}:${one.tool || one.action}`, "buttons");
    return one;
  });
  const properties_ = (name, check) =>
    list(name).map((one, index) => {
      const path = `surface.${name}[${index}]`;
      if (!record(one)) return at(path, "must be an object");
      known(path, one, check);
      const spec = typeof one.property === "string" ? properties[one.property] : null;
      if (!spec) at(`${path}.property`, "must name a property of the item");
      if (spec && !one.kind && !kindOfType(spec.type) && spec.type !== "portvalue") at(`${path}.kind`, `is needed: a ${spec.type} does not say what it is carried as`);
      if (!nodeOk(one.node)) at(`${path}.node`, "must be a node key or a list of them");
      unique(path, one.key || one.property, name);
      return one;
    });
  const inputs = properties_("inputs", ["property", "key", "label", "kind", "spec", "node", "wide", "defaultKind"]);
  const outputs = properties_("outputs", ["property", "key", "label", "kind", "node", "display"]);
  if (surface.prepare !== undefined && (typeof surface.prepare !== "string" || !Object.hasOwn(actions, surface.prepare))) at("surface.prepare", "must name an action of the item");
  if (!buttons.length && !inputs.length && !outputs.length) at("surface", "offers nothing");

  const copy = (value) => (value === undefined ? null : JSON.parse(JSON.stringify(value)));
  const labelOf = (one, spec) => env.t(one.label || spec.label || one.property || one.key);
  return (api, item) => {
    const bound = (key) => env.bindProperty(item, key, api);
    return {
      exclusive: true,
      ...(surface.prepare ? { prepare: () => env.runAction(item, surface.prepare) } : {}),
      buttons: buttons.map((one) => ({
        key: one.key || `${one.node || ""}:${one.tool || one.action}`,
        label: env.t(one.label),
        primary: Boolean(one.primary),
        ...(one.node !== undefined ? { node: one.node } : {}),
        ...(one.tool ? { tool: one.tool } : {}),
        // A chain waits for it, and stops with what the action said when it failed.
        run: async () => {
          const done = await env.runAction(item, one.action);
          if (done && (done.state === "error" || done.state === "blocked")) {
            const said = env.actionStatus?.(item, one.action);
            throw new Error((said && said.message) || `${one.action} did not finish`);
          }
          return done;
        },
      })),
      inputs: inputs.map((one) => {
        const spec = properties[one.property];
        const kind = one.kind || kindOfType(spec.type);
        const { label: _l, ...bare } = spec;
        return {
          key: one.key || one.property,
          prop: one.property,
          label: labelOf(one, spec),
          kind: kind || "text",
          spec: one.spec || { type: spec.type === "portvalue" ? "string" : spec.type },
          ...(one.wide ? { wide: true } : {}),
          ...(one.defaultKind ? { defaultKind: one.defaultKind } : {}),
          ...(one.node !== undefined ? { node: one.node } : {}),
          set: (value, carried) => {
            if (spec.type === "portvalue") bound(one.property).set({ kind: carried && carried !== "*" ? carried : one.defaultKind || (kind !== "*" && kind) || "text", value: copy(value) });
            else bound(one.property).set(kind === "text" ? String(value ?? "") : value);
          },
        };
      }),
      outputs: outputs.map((one) => {
        const spec = properties[one.property];
        const held = bound(one.property).get();
        const own = spec.type === "portvalue";
        return {
          key: one.key || one.property,
          label: labelOf(one, spec),
          kind: one.kind || (own ? (held && held.kind) || "text" : kindOfType(spec.type)),
          spec: { type: own ? "portvalue" : spec.type },
          ...(one.node !== undefined ? { node: one.node } : {}),
          ...(one.display ? { display: true } : {}),
          read: () => {
            const now = bound(one.property).get();
            return own ? (now && now.kind ? now.value : null) : now;
          },
        };
      }),
    };
  };
}

export function validFeatures(features, supported) {
  return Array.isArray(features) && new Set(features).size === features.length && features.every((name) => supported.includes(name));
}

export function resolveValueAdapter(name, control, env, path, at) {
  const adapter = typeof name === "string" && env.valueAdapters?.get(name);
  if (!adapter) {
    at(path, "must name a registered value adapter");
    return undefined;
  }
  const target = env.valueTypes[adapter.to];
  const missing = (control.needs || []).find((method) => typeof target?.methods?.[method] !== "function");
  if (!target || missing) {
    at(path, missing ? `adapter produces ${adapter.to}, which does not support ${missing}` : `unknown adapter target type "${adapter.to}"`);
    return undefined;
  }
  return adapter;
}

export function compileViews(value, path, control, at, compileLayout) {
  if (!control.declarationSupportsViews) {
    at(path, "this control does not support views");
    return [];
  }
  if (!isObject(value) || !Object.keys(value).length) {
    at(path, "must be a nonempty object of named views");
    return [];
  }
  const views = [];
  for (const [key, spec] of Object.entries(value)) {
    const where = `${path}.${key}`;
    if (!key.trim() || !isObject(spec) || Object.keys(spec).some((field) => !["label", "icon", "layout"].includes(field)) ||
        (spec.label !== undefined && (typeof spec.label !== "string" || !spec.label)) ||
        (spec.icon !== undefined && (typeof spec.icon !== "string" || !spec.icon))) {
      at(where, "expected a named view with optional label, icon and layout");
      continue;
    }
    if (spec.layout !== undefined && !Array.isArray(spec.layout)) {
      at(`${where}.layout`, "must be a list of nodes");
      continue;
    }
    const build = spec.layout === undefined ? undefined : compileLayout(spec.layout, `${where}.layout`);
    views.push({ key, label: spec.label || key, icon: spec.icon, build });
  }
  return views;
}

function actionRecord(value, path, at, list = false) {
    if (value === undefined) return {};
    if (isObject(value)) return value;
    if (list && Array.isArray(value) && value.every((name) => typeof name === "string") && new Set(value).size === value.length) {
      return Object.fromEntries(value.map((name) => [name, name]));
    }
    at(path, list ? "must be an object or a list of unique names" : "must be an object");
    return {};
}

const writableTarget = (properties, key) => typeof key === "string" && Object.hasOwn(properties, key) && !properties[key].readonly;

export function compileActionBindings(declarations, properties, permissions, env, at) {
  const actions = Object.create(null);
  const writable = (key) => writableTarget(properties, key);
  for (const [key, spec] of Object.entries(actionRecord(declarations, "actions", at))) {
    const path = `actions.${key}`;
    if (!isObject(spec) || typeof spec.use !== "string") {
      at(path, 'must name an action with "use"');
      continue;
    }
    for (const field of Object.keys(spec)) if (!["use", "inputs", "outputs", "with", "label", "main"].includes(field)) at(`${path}.${field}`, "unknown action binding field");
    // `open`: a screen of this plugin, one step along the window's path (a
    // settings window, an editor), with properties shared with it --
    // `with: { screen: type, share: [names] | { its: ours } }`.
    if (spec.use === "open") {
      if (spec.inputs !== undefined || spec.outputs !== undefined) at(path, "built-in actions take only with");
      const given = isObject(spec.with) ? spec.with : {};
      for (const field of Object.keys(given)) if (!["screen", "share"].includes(field)) at(`${path}.with.${field}`, "is not something open takes");
      const screen = given.screen;
      if (typeof screen !== "string" || !(env.manifest?.provides?.itemTypes || []).includes(screen)) {
        at(`${path}.with.screen`, "must name an item type this plugin provides");
      }
      const share = given.share === undefined ? {} : actionRecord(given.share, `${path}.with.share`, at, true);
      for (const [theirs, ours] of Object.entries(share)) {
        if (typeof theirs !== "string" || !Object.hasOwn(properties, ours)) at(`${path}.with.share.${theirs}`, "must share a property of this item");
      }
      if (!(permissions || []).includes("window:write")) at(path, 'open needs the item to declare "window:write"');
      actions[key] = { builtin: "open", permissions: ["window:write"], inputs: {}, constants: {}, outputs: {}, nonEmpty: [], screen, share };
      continue;
    }
    const constants = actionRecord(spec.with, `${path}.with`, at);
    if (["set", "toggle", "reset"].includes(spec.use)) {
      if (spec.inputs !== undefined || spec.outputs !== undefined) at(path, "built-in actions take only with");
      const outputs = Object.create(null);
      for (const [target, value] of Object.entries(constants)) {
        if (!writable(target) || (spec.use === "toggle" && properties[target].type !== "boolean")) {
          at(`${path}.with.${target}`, "must name a writable property of the appropriate type");
        } else if (spec.use !== "set" && value !== true) {
          at(`${path}.with.${target}`, "must be true");
        } else outputs[target] = target;
      }
      if (!Object.keys(outputs).length) at(path, "must target at least one property");
      actions[key] = { builtin: spec.use, permissions: [], inputs: {}, constants, outputs, nonEmpty: [] };
      continue;
    }
    const operation = env.actions instanceof Map ? env.actions.get(spec.use) : env.actions?.[spec.use];
    if (!operation) {
      at(`${path}.use`, `"${spec.use}" is not a declared action`);
      continue;
    }
    if (
      env.manifest &&
      operation.source &&
      operation.source !== "core" &&
      operation.source !== env.manifest.id &&
      !env.manifest.requires?.includes(operation.source)
    ) {
      at(`${path}.use`, `"${spec.use}" comes from "${operation.source}", which is not in manifest.requires`);
    }
    if (!operation.permissions.every((permission) => permissions?.includes?.(permission))) at(path, "owner does not declare all of the action's permissions");
    const inputs = actionRecord(spec.inputs, `${path}.inputs`, at, true);
    const outputs = actionRecord(spec.outputs, `${path}.outputs`, at, true);
    for (const [input, source] of Object.entries(inputs)) {
      const payload = isObject(source) && Object.keys(source).length === 1 && typeof source.payload === "string" && source.payload;
      if (!Object.hasOwn(operation.params, input) || Object.hasOwn(constants, input) ||
          (!payload && (typeof source !== "string" || !sameSlot(properties[source], operation.params[input], env.valueTypes)))) {
        at(`${path}.inputs.${input}`, "must bind a declared input once to a matching property or payload field");
      }
    }
    for (const input of Object.keys(constants)) if (!Object.hasOwn(operation.params, input)) at(`${path}.with.${input}`, "unknown input");
    for (const input of Object.keys(operation.params)) {
      if (!Object.hasOwn(inputs, input) && !Object.hasOwn(constants, input)) at(`${path}.inputs.${input}`, "missing input");
    }
    for (const [output, target] of Object.entries(outputs)) {
      if (!Object.hasOwn(operation.results, output) || !writable(target) || !sameSlot(properties[target], operation.results[output], env.valueTypes)) {
        at(`${path}.outputs.${output}`, "must bind a declared result to a writable property of the same type");
      }
    }
    for (const output of Object.keys(operation.results)) if (!Object.hasOwn(outputs, output)) at(`${path}.outputs.${output}`, "missing result binding");
    // The script implementation is attached only after all declarations pass.
    actions[key] = Object.assign(Object.create(operation), { inputs, outputs, constants });
  }

  return actions;
}

function compileActionRef(ref, where, actions, at, env) {
  const cancel = isObject(ref) && Object.keys(ref).length === 1 && Object.hasOwn(ref, "cancel");
  const name = cancel ? ref.cancel : ref;
  if (typeof name !== "string" || !Object.hasOwn(actions, name) || (cancel && !actions[name].cancellable)) {
    at(where, "must name an item action or a cancellable action to cancel");
    return () => undefined;
  }
  return (item) => (payload) => cancel ? env.cancelAction(item, name) : env.runAction(item, name, payload);
}

function compileEmptyAction(given, where, actions, at, env) {
  let name = "";
  let labelKey = "mu.action.run";
  let titleKey = "";
  let cancelLabelKey = "mu.action.cancel";
  let cancelTitleKey = "";
  if (typeof given === "string") {
    name = given;
  } else if (isObject(given)) {
    const allowed = new Set(["action", "label", "title", "cancelLabel", "cancelTitle"]);
    for (const key of Object.keys(given)) {
      if (!allowed.has(key)) at(`${where}.${key}`, "unknown emptyAction field");
    }
    if (typeof given.action === "string") name = given.action;
    if (given.label !== undefined) {
      if (typeof given.label !== "string" || !given.label) at(`${where}.label`, "must be a translation key");
      else labelKey = given.label;
    }
    if (given.title !== undefined) {
      if (typeof given.title !== "string") at(`${where}.title`, "must be a translation key");
      else titleKey = given.title;
    }
    if (given.cancelLabel !== undefined) {
      if (typeof given.cancelLabel !== "string" || !given.cancelLabel) at(`${where}.cancelLabel`, "must be a translation key");
      else cancelLabelKey = given.cancelLabel;
    }
    if (given.cancelTitle !== undefined) {
      if (typeof given.cancelTitle !== "string") at(`${where}.cancelTitle`, "must be a translation key");
      else cancelTitleKey = given.cancelTitle;
    }
  }
  if (!name || !Object.hasOwn(actions, name)) {
    at(where, "must name an item action or { action, label?, title?, cancelLabel?, cancelTitle? }");
    const noop = () => null;
    noop.actionName = "";
    return noop;
  }
  const action = actions[name];
  const fn = (item) => {
    const status = env.actionStatus(item, name);
    const busy = status.state === "busy";
    if (busy && action.cancellable) {
      return {
        label: env.t(cancelLabelKey),
        title: cancelTitleKey ? env.t(cancelTitleKey) : env.t(cancelLabelKey),
        disabled: false,
        run: () => env.cancelAction(item, name),
      };
    }
    return {
      label: env.t(labelKey),
      title: status.message || (titleKey ? env.t(titleKey) : env.t(labelKey)),
      disabled: status.state === "blocked" || (busy && action.concurrency !== "restart"),
      run: () => env.runAction(item, name),
    };
  };
  fn.actionName = name;
  return fn;
}

// `refs` (from an item's layout): how a `{ "bind": ... }` in a button is read --
// its label, title or icon from a value (shown as it is), whether it is shown
// (`visible`) or can be pressed (`disabled`). `element`: the `each` alias the
// button stands in; its action is then given that element.
export function compileActionButtons(value, path, actions, at, env, { header = false, primary = false, keys = new Set(), anchors = [], refs = null, element = null } = {}) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    at(path, "must be a list of buttons");
    return [];
  }
  const allowed = ["key", "label", "title", "action", "visible", "disabled", ...(header ? ["icon", "after"] : [])];
  const bound = (given) => Boolean(refs) && isBind(given);
  const text = (given, optional) => (optional && given === undefined) || typeof given === "string" || bound(given);
  return value.map((button, index) => {
    const where = `${path}[${index}]`;
    if (!isObject(button) || typeof button.key !== "string" || !button.key || keys.has(button.key) ||
        !text(button.label, false) || !text(button.title, true) ||
        (header && !(bound(button.icon) || (typeof button.icon === "string" && button.icon))) ||
        (button.visible !== undefined && typeof button.visible !== "boolean" && !bound(button.visible)) ||
        (button.disabled !== undefined && typeof button.disabled !== "boolean" && !bound(button.disabled)) ||
        !Object.keys(button).every((key) => allowed.includes(key))) {
      at(where, "expected a button with a unique key, label and action");
      return () => null;
    }
    const resolved = Object.create(null);
    for (const field of ["label", "title", "icon", "visible", "disabled"]) {
      if (!bound(button[field])) continue;
      const ref = refs.reference(button[field].bind);
      if (!ref) at(`${where}.${field}`, `"${button[field].bind}" is not a property or element field`);
      else resolved[field] = ref;
    }
    if (Object.hasOwn(button, "after") && !anchors.includes(button.after)) {
      at(`${where}.after`, anchors.length ? `must name a base tool (${anchors.join(", ")})` : "this slot does not support tool positioning");
    }
    keys.add(button.key);
    const run = compileActionRef(button.action, `${where}.action`, actions, at, env);
    return (item, api, scope) => {
      const read = (field) => resolved[field] ? refs.binding(resolved[field], item, api, scope).property.get() : button[field];
      if (button.visible !== undefined && read("visible") !== true) return null;
      const cancel = typeof button.action !== "string";
      const name = cancel ? button.action.cancel : button.action;
      const status = env.actionStatus(item, name);
      const shown = (field) => resolved[field] ? String(read(field) ?? "") : button[field] ? env.t(button[field]) : "";
      const payload = element && scope?.get(element) ? scope.get(element).property.get() : undefined;
      return {
        key: button.key,
        label: shown("label"),
        title: status.message || shown("title"),
        disabled: read("disabled") === true || (cancel ? status.state !== "busy" :
          status.state === "blocked" || (status.state === "busy" && actions[name].concurrency !== "restart")),
        ...(header ? { icon: resolved.icon ? String(read("icon") || "") : button.icon, primary, ...(button.after ? { after: button.after } : {}) } : {}),
        run: () => run(item)(payload),
      };
    };
  });
}

// ---- the automatic layout (docs/auto-layout-proposal.md §4.3) -------------------------------------
// Made as a layout declaration, so it is checked by the same code as a written one.
//   1. output properties -> the preview section, first, each drawn by its type's preview; the first
//      is the main action's output card (run / cancel / delete on its header)
//   2. main, then input properties, then the rest in declared order -> the property table
//   3. each group -> a section of its own, in the order a group is first met
//   4. a property with `visible` -> a table of its own that shows or hides
//   5. other labelled actions -> a button row at the end
export function autoLayout(decl, properties, hinted, at) {
  const hint = (key) => hinted.get(key) || {};
  const keys = Object.keys(properties);
  const actions = isObject(decl.actions) ? decl.actions : {};
  const button = (name, one) => {
    if (typeof one.label !== "string" || !one.label) at(`actions.${name}.label`, "an action the automatic layout shows needs a label");
    return { key: name, label: one.label || name, action: name };
  };
  const mains = Object.entries(actions).filter(([, one]) => isObject(one) && one.main === true);
  if (mains.length > 1) at("actions", "at most one action is main");
  for (const [name, one] of Object.entries(actions)) {
    if (isObject(one) && one.main !== undefined && typeof one.main !== "boolean") at(`actions.${name}.main`, "must be true or false");
  }
  const tables = (list, prefix) => {
    const out = [];
    let run = [];
    const flush = () => { if (run.length) out.push({ control: "props", key: `${prefix}-${out.length}`, options: { entries: run } }); run = []; };
    for (const key of list) {
      const visible = hint(key).visible;
      if (visible === undefined) { run.push(key); continue; }
      flush();
      out.push({ control: "props", key: `${prefix}-${key}`, visible, options: { entries: [key] } });
    }
    flush();
    return out;
  };
  const layout = [];
  const outputs = keys.filter((key) => hint(key).role === "output");
  if (outputs.length || mains.length) {
    // The first output is the main action's card: run, cancel and delete on its header.
    const shown = outputs.map((key, index) => index === 0 && mains.length
      ? { control: "output", key: `out-${key}`, options: { value: { bind: key }, run: mains[0][0] } }
      : { control: { fromType: { bind: key } }, key: `out-${key}`, ...(properties[key].label ? { options: { label: properties[key].label } } : {}) });
    if (mains.length && !outputs.length) shown.push({ control: "buttonrow", key: "main-action", options: { buttons: [button(...mains[0])] } });
    layout.push({ control: "section", key: "preview", options: { label: "mu.section.previewEmpty" }, layout: shown });
  }
  const rank = (key) => (hint(key).role === "main" ? 0 : hint(key).role === "input" ? 1 : 2);
  const loose = keys.filter((key) => hint(key).role !== "output" && hint(key).group === undefined)
    .map((key, index) => [key, index]).sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1]).map(([key]) => key);
  layout.push(...tables(loose, "props"));
  const groups = [];
  for (const key of keys) {
    const group = hint(key).group;
    if (group !== undefined && hint(key).role !== "output" && !groups.includes(group)) groups.push(group);
  }
  for (const group of groups) {
    const members = keys.filter((key) => hint(key).group === group && hint(key).role !== "output");
    layout.push({ control: "section", key: `group-${group}`, options: { label: group }, layout: tables(members, `group-${group}`) });
  }
  const others = Object.entries(actions).filter(([, one]) => isObject(one) && one.main !== true && one.label !== undefined);
  if (others.length) layout.push({ control: "buttonrow", key: "actions", options: { buttons: others.map(([name, one]) => button(name, one)) } });
  return layout;
}
