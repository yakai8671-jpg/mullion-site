/* The chain's window: the list of blocks with what each one is, and the chain's variables.
 *
 * What cannot be said in a declaration: which rows a block has depends on its kind and on what the linked
 * apps offer (their buttons and inputs, picked by pointing at them on screen), and a block's output is a
 * port that carries on. The values come in as arguments (`blocks`, `apps`, `variableList`, and `view`, what the
 * chain is now); what is done goes out as the item's actions (`run`, `cancel`, `say`) or as writes back to the
 * arguments.
 */
import {
  KIND_ICON,
  KIND_ORDER,
  MAKES_OUTPUT,
  MARKERS,
  RESULT,
  RUNS,
  VARIABLE_LISTS,
  asText,
  blankOf,
  coerceBlocks,
  coerceDecls,
  computeView,
  declaredVariables,
  derive,
  isPlain,
  labelOf,
  newId,
  remember,
  resultsOf,
  specOfVariable,
  variableOfKind,
} from "./lib.js";

const VAR_TYPES = ["string", "number", "boolean", "image", "prompt.tags", "prompt.template"];

export function createEditor({ core, describe }, VT, IT) {
  const { NODES, t } = core;
  const varTypes = () => VAR_TYPES.filter((one) => VT[VARIABLE_LISTS[one] || one] || ["string", "number", "boolean"].includes(one));
  return {
    body(screen) {
      // Read when it is done, not from the pass that drew the screen: what an event handler asks is what the
      // item holds then. The item's actions by name.
      const P = () => ({
        blocks: screen.read("blocks"),
        apps: screen.read("apps"),
        variableList: screen.read("variableList"),
        report: screen.read("report"),
        run: (payload) => screen.run("run", payload),
        cancel: (payload) => screen.run("cancel", payload),
        say: (payload) => screen.run("say", payload),
        open: (payload) => screen.run("open", payload),
      });
      const SET = (key, value) => screen.set(key, value);
      const say = (key) => P().say({ key });
      const api = screen.api;
      const itemId = screen.item.id;
      const view = P().report || computeView(api, itemId, P(), () => core.refreshAll());
      const apps = (Array.isArray(P().apps) ? P().apps : []).filter((id) => api.items.get(id));
      const { list: blocks, problems: structural } = derive(coerceBlocks(P().blocks));
      // The variables, with those an older chain made by blocks brought into
      // the list the first time it is drawn.
      const declared = declaredVariables(P());
      if (declared.length !== coerceDecls(P().variableList).length) SET("variableList", declared);
      const run = RUNS.get(itemId) || null;
      const running = Boolean(run && run.running);

      // Read when it is done, not closed over from this pass: a control that
      // was drawn earlier keeps the function it was first given, and a list
      // taken from then would put back what has since changed.
      const current = () => coerceBlocks(P().blocks);
      const linked = () => (Array.isArray(P().apps) ? P().apps : []).filter((id) => api.items.get(id));
      const save = (next) => SET("blocks", next);
      const update = (id, patch) => save(current().map((one) => (one.id === id ? { ...one, ...patch } : one)));
      const markersFor = (kind, id) => (MARKERS[kind] || []).map((marker) => ({ id: newId(), kind: marker, pair: id }));
      // A start takes its end with it, and an end cannot be taken alone.
      const remove = (id) => save(current().filter((one) => one.id !== id && one.pair !== id));
      // What a block of a kind starts as: the first of the kinds is the one
      // a new block is, and the kind is changed from the block itself.
      const starting = (kind) =>
        ({
          run: { button: null },
          set: { app: "", key: "", source: { type: "value" } },
          repeat: { mode: "times", count: 3, source: "" },
          if: { test: "has", source: "", value: "" },
          setvar: { target: "", op: "set", value: undefined, amount: 1 },
        })[kind];
      const add = () => {
        const block = { id: newId(), kind: KIND_ORDER[0], pair: "", ...starting(KIND_ORDER[0]) };
        save([...current(), block]);
      };
      // Another kind in the same place. The markers of the old one go and
      // those of the new one are put right after: what stood between them
      // is then outside of both.
      const changeKind = (id, kind) => {
        const all = current();
        const old = all.find((one) => one.id === id);
        if (!old || old.kind === kind || !KIND_ORDER.includes(kind)) return;
        const next = [];
        for (const one of all) {
          if (one.pair === id) continue;
          if (one.id !== id) next.push(one);
          else next.push({ id, kind, pair: "", ...starting(kind) }, ...markersFor(kind, id));
        }
        save(next);
      };

      // ---- what the apps offer -----------------------------------------
      // Read once per drawing.
      const surfaces = new Map();
      const surfaceOf = (id) => {
        if (!id || !apps.includes(id)) return null;
        if (!surfaces.has(id)) {
          let found = null;
          try {
            found = api.apps.surface(id);
          } catch (error) {
            found = null;
          }
          surfaces.set(id, found);
        }
        return surfaces.get(id);
      };
      const buttonOf = (pick) => {
        const surface = pick && surfaceOf(pick.app);
        return surface ? surface.buttons.find((one) => one.key === pick.key) || null : null;
      };

      // ---- one block's rows -------------------------------------------
      // The block as it is now: a control may be written to and read back many
      // times before the windows are drawn again, so what it reads is not the
      // block this pass was handed.
      const fresh = (block) => current().find((one) => one.id === block.id) || block;
      const field = (block, key, label, spec) =>
        describe(
          {
            ...spec,
            read: () => {
              const now = fresh(block);
              return now[key] === undefined ? spec.default : now[key];
            },
            write: (_api, value) => update(block.id, { [key]: value }),
          },
          { api, key: `${block.id}-${key}`, label: t(label) }
        );
      const choice = (block, key, label, options) =>
        field(block, key, label, { type: "enum", control: "select", default: options[0] ? options[0].value : "", options });
      const none = () => ({ value: "", label: t("chain.value.none") });
      const readonly = (block, key, label, value) =>
        describe({ type: "string", readonly: true, read: () => value }, { api, key: `${block.id}-${key}`, label: t(label) });
      const numberOf = new Map(blocks.map((one) => [one.id, one.label]));
      const describeBlock = (one) => {
        const kind = t(`chain.kind.${one.kind}`);
        if (one.kind === "run") {
          const button = buttonOf(one.button);
          return button ? `${kind} · ${labelOf(api, one.button.app)} · ${button.label}` : kind;
        }
        if (one.kind === "set") {
          const surface = surfaceOf(one.app);
          const input = surface && one.key ? surface.inputs.find((entry) => entry.key === one.key) : null;
          return input ? `${kind} · ${labelOf(api, one.app)} · ${one.shown || input.label}` : kind;
        }
        if (one.kind === "setvar") {
          const made = declared.find((entry) => entry.id === one.target);
          return `${kind} · ${(made && made.name) || ""}`;
        }
        return kind;
      };
      const inside = (id, ancestor) => {
        for (let at = blocks.find((b) => b.id === id); at; at = blocks.find((b) => b.id === at.parent)) {
          if (at.id === ancestor) return true;
        }
        return false;
      };
      // Which block's output a block takes, picked from a list as well as by
      // dropping a grip: every block that makes an output, but not itself.
      const sourceChoice = (block, key, held, write, blank) => {
        const makes = blocks.filter((one) => one.id !== block.id && !inside(one.id, block.id) && MAKES_OUTPUT.includes(one.kind));
        const options = [{ value: "", label: blank }, ...makes.map((one) => ({ value: one.id, label: `${one.label}. ${describeBlock(one)}` }))];
        return describe(
          { type: "enum", control: "select", options, read: () => held || "", write: (_api, value) => write(String(value || "")) },
          { api, key: `${block.id}-${key}`, label: t("chain.field.from") }
        );
      };

      // A choice among given blocks, by the id of the one chosen.
      const sourceChoiceOf = (block, key, held, write, options, label) =>
        describe(
          { type: "enum", control: "select", options: [{ value: "", label: t("chain.value.none") }, ...options], read: () => fresh(block)[key] || "", write: (_api, value) => write(String(value || "")) },
          { api, key: `${block.id}-${key}`, label: t(label) }
        );
      // What a template may hold, said by the hint of the value it is written in.
      const placeholderHint = () =>
        t("chain.hint.placeholders", { names: declared.filter((one) => one.name.trim()).map((one) => `{${one.name.trim()}}`).join(" ") || t("chain.value.none") });

      // Dropping another block's grip on what takes a source.
      const sink = (block, put, kinds = MAKES_OUTPUT, variables = false) => ({
        label: t("chain.action.dropSource"),
        accepts: ["chainref"],
        put: (value) => {
          // One of the chain's variables, when what takes it can.
          const held = value && value.variable;
          if (held && variables && declared.some((one) => one.id === held)) return put(held, true);
          const id = value && value.block;
          const from = id && current().find((one) => one.id === id);
          if (!from || from.id === block.id || !kinds.includes(from.kind)) return;
          put(id);
        },
      });

      // Pointing at a thing on a linked app's own window: the guides cover
      // what can be chosen, and the one pressed is the answer.
      const pickOn = async (what) => {
        const found = await api.apps.pick(what);
        if (found === undefined) say(t("chain.status.nothingToPick"));
        return found || null;
      };
      // A control of an app -- its run button, drawn with what it makes -- is
      // one pick: its main button is pressed.
      const pickControl = async (id) => {
        const found = await pickOn("control");
        if (found) update(id, { button: { app: found.item, key: found.key } });
      };
      const pickProperty = async (id) => {
        const found = await pickOn("input");
        if (found) {
          update(id, { app: found.item, key: found.key, shown: found.shown || "", valueKind: found.kind || "value", source: { type: "value", value: undefined } });
        }
      };
      const dashed = (key, label, title, onPick) => NODES.control(key, { control: "propertypick", label: t(label), title: t(title), onPick });
      // Automation-only operations and inputs have no on-screen control to
      // point at. They can still be chosen from each linked app's surface.
      const targetChoice = (block, what) => {
        const choices = apps.flatMap((app) => (surfaceOf(app)?.[what] || []).map((entry) => ({ app, entry })));
        return NODES.props(`target-${block.id}`, [describe({
          type: "enum", control: "select",
          options: [{ value: "", label: t("chain.value.none") }, ...choices.map(({ app, entry }) => ({
            value: `${app}\n${entry.key}`, label: `${labelOf(api, app)} · ${entry.label || entry.key}`,
          }))],
          read: () => "",
          write: (_api, value) => {
            const chosen = choices.find(({ app, entry }) => `${app}\n${entry.key}` === value);
            if (!chosen) return;
            const { app, entry } = chosen;
            if (what === "buttons") update(block.id, { button: { app, key: entry.key } });
            else update(block.id, { app, key: entry.key, shown: entry.label || "", valueKind: entry.kind || "value", source: { type: "value", value: undefined } });
          },
        }, { api, key: `${block.id}-target`, label: t(what === "buttons" ? "chain.field.control" : "chain.field.input") })]);
      };

      const rowsOf = (block) => {
        const props = [];
        const lead = [];
        let extra = null;
        let tools = [];
        // The kind can be changed from the block itself; a marker has none.
        if (!block.marker) {
          props.push(
            describe(
              {
                type: "enum",
                control: "select",
                options: KIND_ORDER.map((kind) => ({ value: kind, label: t(`chain.kind.${kind}`) })),
                read: () => fresh(block).kind,
                write: (_api, value) => changeKind(block.id, String(value)),
              },
              { api, key: `${block.id}-kind`, label: t("chain.field.blockKind") }
            )
          );
        }
        switch (block.kind) {
          case "run": {
            const pick = isPlain(block.button) ? block.button : null;
            const button = buttonOf(pick);
            if (!button) {
              // One choice of a control: from the list of what the linked apps
              // offer (what has no control on screen is there too), or by
              // pointing at it, the way beside the list.
              lead.push(
                NODES.bar(`control-${block.id}`, [
                  targetChoice(block, "buttons"),
                  dashed(`pickcontrol-${block.id}`, "chain.action.pickShort", "chain.action.pickControlTitle", () => pickControl(block.id)),
                ])
              );
              break;
            }
            // The control picked: a card of its own that is only its top bar,
            // named after the app and the button it presses.
            lead.push(
              NODES.card(`control-${block.id}`, `${labelOf(api, pick.app)} · ${button.label || button.key}`, [], [], {
                icon: KIND_ICON.run,
                onDiscard: () => update(block.id, { button: null }),
              })
            );
            // What it made, as the app has it: drawn from the app's own value
            // through the link to the app, each result a port that carries it
            // on and that a property pick can point at.
            const kindNodes = core.kindNodes;
            if (kindNodes) {
              for (const out of resultsOf(api, pick.app, pick.key)) {
                // An output that does not say what it is cannot be shown.
                if (!out.kind) continue;
                lead.push(
                  ...kindNodes({
                    kind: out.kind,
                    value: api.apps.output(pick.app, out.key),
                    port: { item: itemId, key: "blocks", path: [block.id, `${RESULT}${out.key}`] },
                    prefix: `${block.id}-${out.key}`,
                    name: `result-${block.id}-${out.key}-`,
                    empty: t("chain.value.noOutput"),
                    compact: true,
                    label: out.label || "",
                  })
                );
              }
            }
            break;
          }
          case "set": {
            const surface = surfaceOf(block.app);
            const input = block.key && surface ? surface.inputs.find((one) => one.key === block.key) || null : null;
            const src = isPlain(block.source) ? block.source : { type: "value" };
            const linkedTo = src.type === "ref" || src.type === "block" ? src.block : "";
            const linkedVar = src.type === "ref" && src.variable ? src.variable : "";
            const heldSource = () => {
              const now = current().find((one) => one.id === block.id);
              return now && isPlain(now.source) ? now.source : src;
            };
            const setSource = (patch) => update(block.id, { source: { ...heldSource(), ...patch } });
            if (!input) {
              lead.push(targetChoice(block, "inputs"));
              // Nothing picked: a dashed button, like a list's add. Pressing it
              // covers the controls of the linked apps with guides.
              lead.push(dashed(`pick-${block.id}`, "chain.action.pick", "chain.action.pickTitle", () => pickProperty(block.id)));
              break;
            }
            // Picked. A property that is a card of its own (a text card, a picture,
            // a list of prompts) stands in the block as it is; any other is a
            // row, and goes in a card named after its app. What either follows
            // (another block's output, another window's property) hangs on its
            // card. A block's output dropped on it is what it is set to instead
            // of the typed value, until that is let go of.
            const port = { item: itemId, key: "blocks", path: [block.id, "value"] };
            // What a block that has no value to follow -- a counter, a loop's
            // number -- makes is dropped as a reference, resolved when it runs.
            const refSink = sink(
              block,
              (id, variable) => setSource(variable ? { type: "ref", variable: id, block: undefined } : { type: "ref", block: id, variable: undefined }),
              ["repeat"],
              true
            );
            // Let go of the property: the card's close button.
            const discard = () => {
              api.props.release(port);
              update(block.id, { app: "", key: "", shown: "", valueKind: "", source: { type: "value", value: undefined } });
            };
            const cardTools = [];
            // What feeds this property from another window writes over it at
            // every refresh: said on the card, since the set would be lost.
            const fedKey = input.prop || input.key;
            if (api.apps.fed(block.app, fedKey)) {
              cardTools.push(NODES.warning(t("chain.warning.fed"), `fed-${block.id}`), {
                key: "unfeed",
                icon: "link-45deg",
                title: t("chain.action.unfeed"),
                run: () => {
                  api.apps.unfeed(block.app, fedKey);
                  core.refreshAll();
                },
              });
            }
            const shown = block.shown || input.label;
            const label = `${labelOf(api, block.app)} · ${shown}`;
            // A row in a card named after its app.
            // A one-line text is a port where it stands (`rowPort`), so its card
            // takes a block's grip (a variable, a loop's number) and nothing
            // else: the card's own guides would cover the row they are about.
            // Any other row (a number, a choice) has no port of its own, and
            // the card is the port.
            const inCard = (rows, withPort, rowIsPort = false) =>
              lead.push(
                NODES.card(`target-${block.id}`, labelOf(api, block.app), [NODES.props(`target-rows-${block.id}`, rows)], cardTools, {
                  icon: "box-arrow-in-right",
                  ...(withPort ? { ...(rowIsPort ? {} : { port }), sink: refSink } : {}),
                  onDiscard: discard,
                })
              );
            if ((linkedTo || linkedVar) && input.kind !== "*") {
              const from = blocks.find((one) => one.id === linkedTo);
              const variable = declared.find((one) => one.id === linkedVar);
              cardTools.push({ key: "unlink", icon: "x-lg", title: t("chain.action.unlink"), run: () => setSource({ type: "value", block: undefined, variable: undefined }) });
              inCard(
                [
                  readonly(
                    block,
                    "from",
                    "chain.field.from",
                    linkedVar ? (variable ? variable.name : t("chain.value.none")) : from ? `${from.label}. ${describeBlock(from)}` : t("chain.value.none")
                  ),
                ],
                true
              );
            } else if (input.kind === "preset") {
              // The app's whole preset: one of the runs kept for it.
              const entry = api.items.get(block.app);
              const presets = api.store
                .saved("workflow.runpreset")
                .filter((one) => entry && one.value && one.value.app === entry.type)
                .map((one) => ({ value: String(one.id), label: one.name }));
              inCard(
                [
                  describe(
                    {
                      type: "enum",
                      control: "select",
                      options: [none(), ...presets],
                      read: () => {
                        const held = heldSource().value;
                        return held === undefined || held === null ? "" : String(held);
                      },
                      write: (_api, value) => setSource({ type: "value", value: String(value || "") }),
                    },
                    { api, key: `${block.id}-preset`, label: shown }
                  ),
                ],
                false
              );
            } else if (input.kind === "*") {
              const kind = src.kind || input.defaultKind || "";
              const types = Object.entries(VT);
              const found = types.find(([, def]) => def.stash === kind) || types.find(([, def]) => def.port === kind);
              const type = !src.kind || src.kind === input.defaultKind
                ? input.spec.type
                : found ? found[0] : variableOfKind(kind) || (["number", "boolean"].includes(kind) ? kind : "string");
              const spec = type === input.spec.type ? input.spec : { ...(VT[specOfVariable(type).type] || {}).sample, ...specOfVariable(type) };
              const blank = (VT[spec.type] || {}).defaultValue;
              const desc = describe({
                ...spec,
                read: () => heldSource().value === undefined ? (blank ? blank(spec) : null) : heldSource().value,
                write: (_api, value) => setSource({ type: "value", value, kind }),
              }, { api, key: `${block.id}-property-${type}`, label });
              lead.push(NODES.control(`property-${block.id}-${type}`, {
                control: input.spec.control,
                desc,
                kind,
                empty: t("chain.value.noProperty"),
                port,
                sink: refSink,
                onDiscard: discard,
              }));
            } else {
              // Typed in, with the control the property itself is edited with.
              const blank = (VT[input.spec.type] || {}).defaultValue;
              const desc = describe(
                {
                  ...input.spec,
                  // A one-line text is linked from where it stands.
                  rowPort: port,
                  read: () => {
                    const held = heldSource().value;
                    return held === undefined ? (blank ? blank(input.spec) : input.spec.default ?? "") : held;
                  },
                  write: (_api, value) => setSource({ type: "value", value }),
                },
                { api, key: `${block.id}-typed-${block.app}-${block.key}`, label: shown }
              );
              const ownCard = Boolean(desc.control && (desc.control.params || []).includes("port"));
              if (ownCard) {
                // Its own card: the warnings and what lets go of a reference are
                // on the block's bar, since there is no card of ours to hold them.
                tools.push(...cardTools);
                lead.push(NODES.control(`target-${block.id}`, { desc: { ...desc, label }, port, sink: refSink, onDiscard: discard }));
              } else {
                inCard([desc], true, Boolean(desc.control && desc.control.linkable && input.kind === "text"));
              }
            }
            break;
          }
          case "repeat": {
            props.push(choice(block, "mode", "chain.field.mode", ["times", "each"].map((one) => ({ value: one, label: t(`chain.mode.${one}`) }))));
            if (block.mode === "each") {
              props.push(sourceChoice(block, "from", block.source, (id) => update(block.id, { source: id }), t("chain.value.none")));
              extra = sink(block, (id) => update(block.id, { source: id }));
            } else {
              props.push(field(block, "count", "chain.field.count", { type: "number", min: 1, step: 1, default: 3 }));
            }
            break;
          }
          case "if": {
            props.push(
              sourceChoice(block, "from", block.source, (id) => update(block.id, { source: id }), t("chain.value.none")),
              choice(block, "test", "chain.field.test", ["has", "empty", "equals", "contains"].map((one) => ({ value: one, label: t(`chain.test.${one}`) })))
            );
            if (block.test === "equals" || block.test === "contains") {
              props.push(field(block, "value", "chain.field.value", { type: "string", default: "" }));
            }
            extra = sink(block, (id) => update(block.id, { source: id }));
            break;
          }
          case "setvar": {
            const made = declared.find((one) => one.id === block.target);
            props.push(
              sourceChoiceOf(block, "target", block.target, (id) => update(block.id, { target: id }), declared.map((one) => ({ value: one.id, label: one.name || t("chain.value.unnamed") })), "chain.field.target"),
              choice(block, "op", "chain.field.op", ["set", "add"].map((one) => ({ value: one, label: t(`chain.op.${one}`) })))
            );
            if (block.op === "add") {
              props.push(field(block, "amount", "chain.field.amount", { type: "number", step: 1, default: 1 }));
            } else if (made) {
              // The value is edited as a value of the variable's own type.
              const desc = field(block, "value", "chain.field.value", { ...specOfVariable(made.type), default: blankOf(made.type), ...(made.type === "string" ? { hint: placeholderHint() } : {}) });
              const own = Boolean(desc.control && (desc.control.params || []).includes("port"));
              if (own) lead.push(NODES.control(`value-${block.id}`, { desc }));
              else props.push(desc);
            }
            break;
          }
          default:
            break;
        }
        return { props, lead, extra, tools };
      };

      // ---- one block, as a card -----------------------------------------
      const card = (block) => {
        const { props, lead, extra, tools: own } = rowsOf(block);
        const children = [...(props.length ? [NODES.props(`rows-${block.id}`, props)] : []), ...lead];
        const failed = run && run.errors.get(block.id);
        const active = Boolean(run && run.running && run.current === block.id);
        const tools = [
          ...own,
          ...(failed ? [NODES.warning(failed, `err-${block.id}`)] : []),
          ...(run && run.done.has(block.id) && !failed ? [{ key: `done-${block.id}`, icon: "check-lg", title: t("chain.value.done") }] : []),
        ];
        const title = `${active ? "▶ " : ""}${block.label ? `${block.label}. ` : ""}${t(`chain.kind.${block.kind}`)}`;
        return NODES.card(`block-${block.id}`, title, children, tools, {
          port: { item: itemId, key: "blocks", path: [block.id] },
          // A marker goes with its start, and never alone.
          ...(block.marker ? {} : { onDiscard: () => remove(block.id) }),
          icon: KIND_ICON[block.kind],
          ...(extra ? { sink: extra } : {}),
        });
      };

      // ---- the variables ---------------------------------------------------------
      const liveDecls = () => coerceDecls(P().variableList);
      const saveDecls = (next) => SET("variableList", next);
      const changeVar = (id, patch) => saveDecls(liveDecls().map((one) => (one.id === id ? { ...one, ...patch } : one)));
      const removeVar = (id) => saveDecls(liveDecls().filter((one) => one.id !== id));
      const addVariable = () => {
        const names = new Set(liveDecls().map((one) => one.name.trim()));
        let n = liveDecls().length + 1;
        while (names.has(`v${n}`)) n += 1;
        saveDecls([...liveDecls(), { id: newId(), name: `v${n}`, type: "string", keep: false, value: null }]);
      };
      const variableCard = (one) => {
        const now = () => liveDecls().find((entry) => entry.id === one.id) || one;
        const row = (key, label, spec) => describe({ ...spec }, { api, key: `${one.id}-${key}`, label: t(label) });
        const held = run && one.name.trim() && run.vars.has(one.name.trim()) ? run.vars.get(one.name.trim()) : one.keep ? one.value : undefined;
        return NODES.card(
          `variable-${one.id}`,
          one.name.trim() || t("chain.value.unnamed"),
          [
            NODES.props(`variable-rows-${one.id}`, [
              row("name", "chain.field.name", { type: "string", read: () => now().name, write: (_api, value) => changeVar(one.id, { name: String(value) }) }),
              row("type", "chain.field.type", {
                type: "enum",
                control: "select",
                options: varTypes().map((type) => ({ value: type, label: t(`chain.vartype.${type}`) })),
                read: () => now().type,
                write: (_api, value) => changeVar(one.id, { type: String(value), value: null }),
              }),
              row("keep", "chain.field.persist", { type: "boolean", read: () => now().keep, write: (_api, value) => changeVar(one.id, { keep: Boolean(value) }) }),
              row("now", "chain.field.valueNow", {
                type: "string",
                readonly: true,
                read: () => (held === undefined || held === null ? t("chain.value.unset") : asText(held)),
              }),
            ]),
          ],
          [],
          { icon: "braces", port: { item: itemId, key: "variableList", path: [one.id] }, onDiscard: () => removeVar(one.id) }
        );
      };


      const blocked = view.blocked;
      const nodes = [
        // What the chain is -- ready, running, stopped on something -- as one row in the item's bar, with its
        // detail a screen behind it, as a connected program's is.
        NODES.pinned("state", [
          NODES.control("state", {
            control: "statusrow",
            name: t("chain.section.state"),
            lamp: view.lamp,
            text: view.text,
            ...(view.error ? { error: true } : {}),
            moreTitle: t("chain.state.details"),
            onMore: () => P().open(),
          }),
        ]),
        // The label is the list's, so it sits outside the card, over it. Running the chain is the main act of
        // the card; what is added is the first kind, changed afterwards from the block's own kind row.
        NODES.section("chain", t("chain.section.chain"), [
          NODES.listCard("list-chain",
            blocks.map((one) => card(one)), { tools: [
              running
                ? { key: "cancel", primary: true, icon: "stop-fill", label: t("chain.action.cancel"), run: () => P().cancel() }
                : { key: "run", primary: true, icon: "play-fill", label: t("chain.action.run"), disabled: blocked, run: () => P().run() },
            ], add: { label: t("chain.action.addBlock"), run: add } }),
        ]),
        // The chain's variables, as a list: one card each, a name and a type, and under them the way to one
        // more. The list's grip carries them, with what they hold, to a text composer's catalog; a variable's
        // own grip carries it as the value a property is set to.
        NODES.section("variables", t("chain.section.variables"), [
          NODES.listCard("variables", declared.map((one) => variableCard(one)), { icon: "braces",
            port: { item: itemId, key: "variables" },
            add: { label: t("chain.action.addVariable"), run: addVariable } }),
        ]),
      ];
      return nodes;
    },
  };
}
