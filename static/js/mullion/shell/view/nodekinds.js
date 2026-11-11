/* The body nodes a view draws, by kind (NODE_KINDS), and what a list card
 * shows of its list (its search, filters and pages) and the bars a card has.
 * Split out of view.js (2026-11-11); part of the view module. */
import { controlActions, itemProperties, portLink, portShare, portSpec, unlinkPort, t, describeSpec, document } from "./deps.js";
import { NODES, buildCardHead, cardIsElement, cardIsList, checkCardsNamed, designProblem, fitCardHead, foldBody, foldChanged, foldIcon, foldedLists, hintButton, markElements, mountWidget, noteListCard, noteUnknownParams, openingCards, paintCardTools, paintEmpty, propRow, renderNodes, row, sectionToolsProblem, syncPortBadge, teardownTree, updatePropRow, viewHooks, announceViewChange } from "./view.js";
import { controlActionKey, controlDescriptor, paintReadonly } from "./descriptors.js";

// ---- what a list card shows of its list: a search, filters and pages -----------------------------
// What was asked of a list (the words, what is switched off, the page) belongs to the item and the card,
// not to what the item keeps: it is read when the list is drawn and not saved with the layout.
export const listViews = new Map();

export const listViewKey = (itemId, key) => `${itemId}\n${key}`;

export function listView(itemId, key) {
  const held = listViews.get(listViewKey(itemId, key));
  return { query: held?.query ?? "", off: held?.off ?? {}, page: held?.page ?? 1 };
}

// `patch`: { query?, off?: { filter: [values switched off] }, page? }, put over what is held.
export function setListView(itemId, key, patch) {
  const now = listView(itemId, key);
  listViews.set(listViewKey(itemId, key), {
    query: patch.query ?? now.query,
    off: { ...now.off, ...(patch.off || {}) },
    page: patch.page ?? now.page,
  });
  announceViewChange({ redraw: true });
}

// The bars of a list card from its `view`: { query: text | null (no search), placeholder, filters: [{ key, label, icon,
// all: [{ value, label }], off: [values] }], page: { page, pages, total } | null, set(patch) }. A search and the
// filters share the first bar; the pages, when there is more than one, are the second, centred.
export function listViewBars(key, view) {
  const bars = [];
  const line = [];
  if (view.query !== null && view.query !== undefined) {
    line.push(NODES.control(`${key}-query`, {
      desc: describeSpec(
        { type: "string", control: "searchbox", placeholder: view.placeholder || t("mu.list.search"), read: () => view.query, write: (_api, value) => view.set({ query: String(value ?? ""), page: 1 }) },
        { key: `${key}-query`, label: t("mu.list.search") }
      ),
    }));
  }
  for (const filter of view.filters || []) {
    line.push(NODES.control(`${key}-filter-${filter.key}`, {
      control: "popupchecklist",
      icon: filter.icon || "funnel",
      title: filter.label,
      items: filter.all.map((one) => ({ value: one.value, label: one.label, checked: !filter.off.includes(one.value) })),
      onChange: (checked) => view.set({ off: { [filter.key]: filter.all.map((one) => one.value).filter((value) => !checked.includes(value)) }, page: 1 }),
    }));
  }
  if (line.length) bars.push(line);
  if (view.page && view.page.pages > 1) {
    const { page, pages } = view.page;
    const step = (name, icon, to) => NODES.control(`${key}-page-${name}`, { control: "iconbutton", icon, title: t(`mu.list.page.${name}`), disabled: to === page, run: () => view.set({ page: to }) });
    bars.push({
      middle: [
        step("first", "chevron-double-left", 1),
        step("previous", "chevron-left", Math.max(1, page - 1)),
        NODES.control(`${key}-page`, { control: "readout", text: `${page}/${pages}`, title: t("mu.list.page") }),
        step("next", "chevron-right", Math.min(pages, page + 1)),
        step("last", "chevron-double-right", pages),
      ],
    });
  }
  return bars;
}

// A card's bars as `extra` says them: [spec], a spec being nodes in a line or {start, middle, end}.
export function cardBarSpecs(extra) {
  const given = Array.isArray(extra.bars) ? extra.bars : extra.bar ? [extra.bar] : [];
  return given.filter((spec) => spec && (Array.isArray(spec) ? true : typeof spec === "object"));
}

export function barSpecNodes(spec) {
  return (Array.isArray(spec) ? spec : [...(spec.start || []), ...(spec.middle || []), ...(spec.end || [])]).filter(Boolean);
}

// The bar elements of a card, in order: the first is always there (it holds the shell's own
// things too); the rest are made and taken away to match the card's `bars`.
export function cardBarEls(el) {
  return [...el.children].filter((one) => one.classList.contains("mu-action-bar"));
}

export function paintCardBars(el, node, ctx, path) {
  // A row with nothing in it (what it holds is not shown now) is not drawn: the first bar stays, for the shell's own things.
  const specs = (node.bars || []).filter((spec) => barSpecNodes(spec).length);
  const have = cardBarEls(el);
  while (have.length < Math.max(1, specs.length)) {
    const more = Object.assign(document.createElement("div"), { className: "mu-action-bar mu-action-bar-row" });
    have[have.length - 1].after(more);
    have.push(more);
  }
  while (have.length > Math.max(1, specs.length)) {
    const gone = have.pop();
    teardownTree(gone);
    gone.remove();
  }
  have.forEach((bar, i) => {
    const spec = specs[i] || [];
    const thirds = !Array.isArray(spec);
    // One bar is one row, as a line or in thirds; its own children are never both.
    if (bar.classList.contains("is-thirds") !== thirds) {
      Array.from(bar.children).forEach((child) => {
        teardownTree(child);
        child.remove();
      });
      bar.classList.toggle("is-thirds", thirds);
      if (thirds) for (const part of ["start", "middle", "end"]) bar.append(Object.assign(document.createElement("div"), { className: `mu-action-bar-${part}` }));
    }
    if (thirds) ["start", "middle", "end"].forEach((part, j) => renderNodes(bar.children[j], spec[part] || [], ctx, [...path, ["bar", i, part]]));
    else renderNodes(bar, spec, ctx, [...path, ["bar", i]]);
    bar.__filled = barSpecNodes(spec).length > 0;
  });
}

export const NODE_KINDS = {
  pinned: {
    create(node, ctx, path) {
      const el = document.createElement("div");
      el.className = "mu-pinned";
      renderNodes(el, node.children || [], ctx, path);
      return el;
    },
    update(el, node, ctx, path) {
      renderNodes(el, node.children || [], ctx, path);
    },
  },
  bar: {
    create(node, ctx, path) {
      const el = document.createElement("div");
      el.className = "mu-bar";
      NODE_KINDS.bar.update(el, node, ctx, path);
      return el;
    },
    update(el, node, ctx, path) {
      renderNodes(el, node.children || [], ctx, path);
    },
  },
  section: {
    create(node, ctx, path) {
      const el = document.createElement("div");
      el.className = "mu-view-section";
      const title = document.createElement("div");
      title.className = "mu-view-title";
      title.append(Object.assign(document.createElement("span"), { className: "mu-view-label" }), hintButton());
      const body = document.createElement("div");
      body.className = "mu-section-body";
      el.append(title, body);
      NODE_KINDS.section.update(el, node, ctx, path);
      return el;
    },
    update(el, node, ctx, path) {
      const problem = sectionToolsProblem(node);
      if (problem) designProblem(problem);
      const title = el.firstElementChild;
      const label = title.firstElementChild;
      const text = node.title || "";
      if (label.textContent !== text) label.textContent = text;
      title.hidden = !text;
      title.lastElementChild.setHint(node.hint || "", t("mu.action.hint"));
      renderNodes(el.lastElementChild, node.children || [], ctx, path);
      paintEmpty(el.lastElementChild, node);
      checkCardsNamed(el, node, ctx);
    },
  },
  card: {
    create(node, ctx, path) {
      const el = document.createElement("div");
      el.className = "mu-card mu-listcard mu-nodecard";
      // The header is built by the same hand as every other card's (buildCardHead): the grip, then
      // the primary buttons (lead) and the icon, the name, what the card follows (the link badge),
      // the gap, its own tools, the shrink button -- which on a node card folds it -- and close.
      const lead = Object.assign(document.createElement("span"), { className: "mu-nodecard-lead" });
      const glyph = Object.assign(document.createElement("i"), { className: "bi mu-nodecard-icon" });
      glyph.setAttribute("aria-hidden", "true");
      const tools = Object.assign(document.createElement("span"), { className: "mu-nodecard-tools" });
      const parts = buildCardHead("mu-nodecard", { lead: [lead, glyph], tools: [tools], onDiscard: () => el.__discard && el.__discard() });
      const { head, label, size: fold } = parts;
      // The classes the shell's styles know a node card's header by.
      head.className = "mu-card-bar mu-listcard-head mu-nodecard-head";
      label.className = "mu-card-title mu-textcard-label mu-nodecard-label";
      head.querySelector(":scope > .mu-nodecard-gap").className = "mu-textcard-gap mu-card-gap";
      fold.className = "mu-icon-button mu-listcard-fold";
      // A card with cards inside folds in two steps: the cards inside it
      // first, then itself. Opening goes the other way: itself, then the
      // cards inside.
      fold.addEventListener("click", (event) => {
        event.stopPropagation();
        const where = el.__foldKey;
        // A card with nothing in it has nothing to open: it is not one of them.
        const inner = [...el.lastElementChild.querySelectorAll(".mu-nodecard:not(.is-side):not(.is-bare):not(.is-plain)")].filter((one) => one.__foldKey);
        const open = inner.filter((one) => !foldedLists.has(one.__foldKey));
        if (foldedLists.has(where)) {
          foldedLists.delete(where);
          if (inner.length > open.length) openingCards.add(where);
        } else if (openingCards.has(where) && open.length < inner.length) {
          openingCards.delete(where);
          inner.forEach((one) => foldedLists.delete(one.__foldKey));
        } else if (open.length) {
          openingCards.delete(where);
          open.forEach((one) => foldedLists.add(one.__foldKey));
        } else {
          openingCards.delete(where);
          foldedLists.add(where);
        }
        inner.forEach((one) => NODE_KINDS.card.paintFold(one));
        NODE_KINDS.card.paintFold(el);
        foldChanged();
      });
      // Guides for the card as a whole go on its header while the cards
      // inside it offer their own (see startPortMove).
      el.__portHead = head;
      const items = Object.assign(document.createElement("div"), { className: "mu-nodecard-items" });
      const add = Object.assign(document.createElement("button"), { type: "button", className: "mu-add mu-nodecard-add" });
      add.addEventListener("click", (event) => {
        event.stopPropagation();
        // Handed the button, so an add that opens something can anchor it.
        if (el.__add && el.__add.run) el.__add.run(add);
      });
      // The button in a box of its own: what is dropped on it is offered
      // its guide there, and a button cannot hold one.
      const zone = Object.assign(document.createElement("div"), { className: "mu-nodecard-addzone" });
      zone.append(add);
      const body = Object.assign(document.createElement("div"), { className: "mu-listcard-body mu-nodecard-body" });
      // A side-headed card's icon and title, in its body (see extra.side).
      const face = Object.assign(document.createElement("div"), { className: "mu-nodecard-face" });
      face.append(Object.assign(document.createElement("i"), { className: "bi" }), document.createElement("span"));
      body.append(face, items, zone);
      const bar = Object.assign(document.createElement("div"), { className: "mu-action-bar mu-action-bar-row" });
      el.append(head, bar, body);
      NODE_KINDS.card.update(el, node, ctx, path);
      return el;
    },
    paintFold(el) {
      const folded = foldedLists.has(el.__foldKey);
      const head = el.children[0];
      const body = el.querySelector(":scope > .mu-nodecard-body");
      const fold = head.querySelector(".mu-listcard-fold");
      // Open, but its cards still to be opened: the button opens them.
      const opening =
        !folded &&
        openingCards.has(el.__foldKey) &&
        [...body.querySelectorAll(".mu-nodecard:not(.is-side):not(.is-bare):not(.is-plain)")].some((one) => one.__foldKey && foldedLists.has(one.__foldKey));
      el.classList.toggle("is-folded", folded);
      fold.firstElementChild.className = foldIcon(folded || opening);
      fold.title = t(folded || opening ? "mu.action.unfoldList" : "mu.action.foldList");
      fold.setAttribute("aria-expanded", String(!folded));
      foldBody(body, folded);
      for (const one of cardBarEls(el)) one.hidden = folded || !one.__filled;
    },
    update(el, node, ctx, path) {
      const head = el.children[0];
      const body = el.querySelector(":scope > .mu-nodecard-body");
      // Found by what they are, not where they stand in the header.
      const part = (selector) => head.querySelector(`:scope > ${selector}`);
      const [grip, lead, glyph, label, link, tools] = [".mu-port-grip", ".mu-nodecard-lead", ".mu-nodecard-icon", ".mu-nodecard-label", ".mu-port-link", ".mu-nodecard-tools"].map(part);
      const [face, items, zone] = body.children;
      const add = zone.firstElementChild;
      el.__add = node.add || null;
      // A card that takes what is dropped on it (`sink`: {accepts, put, label})
      // draws nothing for it: the label is on the guide that covers it while
      // something is being carried, which is the only time it is wanted.
      if (node.sink) {
        viewHooks.attachSink(el, node.sink);
        el.__cardSink = true;
      } else if (el.__cardSink) {
        el.classList.remove("mu-port-sink");
        el.__sink = null;
        el.__cardSink = false;
      }
      const discard = head.querySelector(".mu-card-discard");
      el.__discard = node.onDiscard || null;
      // A card that is a property (a list as a whole, a form) names itself outside its box, as a row's
      // label is; only an entry of a list, or a card with no property behind it, wears its name in the
      // header.
      const held = node.port ? portSpec(node.port) : null;
      const isProperty = held ? !held.element : !node.side && !cardIsElement(node);
      // The close button means the card itself goes, and only an element of a list has one. What any
      // other card holds is taken out with a primary "delete" button (it lets the value go; it does
      // not remove the card).
      const releasing = Boolean(node.onDiscard) && isProperty && !node.side;
      discard.hidden = !node.onDiscard || releasing;
      discard.title = t("mu.action.discard");
      viewHooks.attachPort(el, grip, node.port || null);
      // What the card follows, on its own badge (the one every card header has).
      const following = node.port ? portLink(node.port) || portShare(node.port) : null;
      syncPortBadge(link, following, following ? () => unlinkPort(node.port) : null);
      if (node.readonly) el.dataset.portReadonly = "1";
      else delete el.dataset.portReadonly;
      grip.title = t("mu.port.grip");
      zone.hidden = !node.add;
      if (node.add && add.textContent !== node.add.label) add.textContent = node.add.label;
      // A window dragged by its handle: asked at the time what it would
      // become here (see showLinkGuides).
      zone.__windowDrop = node.add && node.add.windows ? (id) => (el.__add && el.__add.windows ? el.__add.windows(id) : []) : null;
      if (node.add && node.add.accepts) {
        viewHooks.attachSink(zone, {
          accepts: node.add.accepts,
          label: node.add.label,
          put: (value, kind) => {
            const now = el.__add;
            if (now && now.put) now.put(value, kind);
          },
        });
      } else {
        zone.classList.remove("mu-port-sink");
        zone.__sink = null;
      }
      // Folded by where it is: the item and the card's own key, so a card
      // stays folded through redraws and when its list is reordered.
      el.__foldKey = `card:${(ctx.item && ctx.item.id) || ""}:${node.key}`;
      const text = node.title || "";
      if (label.textContent !== text) label.textContent = text;
      label.hidden = !text;
      // A card's label has no icon: what a card is about is its label's
      // business (and its property's, outside) -- only a side card's face
      // shows one.
      glyph.hidden = true;
      const all = [
        ...(node.tools || []),
        ...(releasing ? [{ key: "release", icon: "trash", label: t("mu.action.delete"), primary: true, run: node.onDiscard }] : []),
      ];
      for (const tool of all) {
        if (tool && tool.hint && !/exclamation/.test(String(tool.icon || ""))) {
          designProblem(`card "${node.key}" has a hint button (${tool.key}); a hint stands in a section's title or a value's label, not in a card's header`);
        }
      }
      paintCardTools(lead, all.filter((one) => one.primary), true);
      paintCardTools(tools, all.filter((one) => !one.primary), false);
      // Nothing to hold by: only the nesting of its children (see NODES.card).
      const plain = !node.side && !node.listCard && !text && !all.length && !node.onDiscard && !node.port;
      noteListCard(node, ctx);
      el.classList.toggle("is-plain", plain);
      el.classList.toggle("is-property", isProperty);
      el.classList.toggle("is-side", node.side);
      // The face is the name alone: a side card shows no icon (its `icon` is not drawn).
      face.hidden = !node.side || !text;
      if (node.side) {
        face.firstElementChild.hidden = true;
        if (face.lastElementChild.textContent !== text) face.lastElementChild.textContent = text;
        // Never folded: there is nothing under its face to put away.
        foldedLists.delete(el.__foldKey);
      }
      // Nor does a card with no header: nothing to press.
      if (plain) foldedLists.delete(el.__foldKey);
      NODE_KINDS.card.paintFold(el);
      // A list with nothing in it says so (its own `empty` if it has one, else the shell's): its
      // body is not taken away, and the person sees an empty list and not a card gone missing.
      const nothing = !(node.children || []).filter(Boolean).length;
      const said = node.empty || (nothing && cardIsList(node) ? t("mu.value.emptyList") : "");
      // A card with nothing in it is its top bar and no more: nothing to fold.
      const bare = nothing && !node.add && !said && !node.bar?.length;
      el.classList.toggle("is-bare", bare);
      head.querySelector(".mu-listcard-fold").hidden = bare;
      // Narrow: the primary down to its icon, then the rest into the menu.
      // A side header holds two buttons and has nothing to fold.
      if (!node.side && !plain) fitCardHead(head);
      paintCardBars(el, node, ctx, path);
      for (const one of cardBarEls(el)) one.hidden = foldedLists.has(el.__foldKey) || !one.__filled;
      markElements(node);
      renderNodes(items, node.children || [], ctx, path);
      // The body's one card can fill the window (see expandOf).
      viewHooks.paintExpand(el, node, ctx);
      // A card that only holds another card is a wrapper -- made to carry what
      // a section could not (its tools). The card inside is the value; its
      // own tools are where they go.
      if (/-content$/.test(String(node.key)) && !node.title && items.children.length === 1 && items.firstElementChild.classList.contains("mu-card")) {
        designProblem(`card "${node.key}" only wraps another card; give the inner card the tools, and drop the wrapper`);
      }
      paintEmpty(items, said === node.empty ? node : { ...node, empty: said });
    },
  },

  props: {
    create(node, ctx) {
      const el = document.createElement("dl");
      el.className = "mu-props";
      NODE_KINDS.props.update(el, node, ctx);
      return el;
    },
    update(el, node, ctx) {
      // `own: true` means "this item's own properties" -- an item never has
      // to reach into core helpers to describe its own editors.
      // `placed: true` means body() puts this property somewhere itself, so
      // the automatic table leaves it out rather than drawing it twice.
      const entries = node.own
        ? itemProperties(ctx.item, ctx.api)
            .filter((desc) => !desc.params.placed)
            .map((desc) => ({ ...desc, rowPort: { item: ctx.item.id, key: desc.key } }))
        : node.entries || [];
      const existing = new Map();
      for (const child of Array.from(el.children)) existing.set(child.dataset.nodeKey, child);

      const kept = new Set();
      let cursor = el.firstElementChild;
      entries.forEach((desc) => {
        let row = existing.get(desc.key);
        if (row) updatePropRow(row, desc, ctx);
        else row = propRow(desc, ctx);
        kept.add(desc.key);
        if (row === cursor) cursor = cursor.nextElementSibling;
        else el.insertBefore(row, cursor);
      });
      existing.forEach((row, key) => {
        if (kept.has(key)) return;
        teardownTree(row);
        row.remove();
      });
    },
  },

  control: {
    matches(el, node, ctx) {
      const desc = controlDescriptor(node, ctx);
      // The key alone is not identity for a placed descriptor: a chooser
      // pointed at another property builds a new one, and reusing the old
      // control's DOM would leave it writing to the property that is gone.
      return (
        el.dataset.controlName === desc.control.name &&
        (el.dataset.descKey || "") === (node.desc ? desc.key : "") &&
        el.__valueAdapter === node.params?.valueAdapter &&
        (!el.__controlActions || el.__controlActionKey === controlActionKey(node)) &&
        (!el.__valueAdapter || (el.__adapterSource === node.bind && Boolean(el.dataset.conversionFailed) === Boolean(desc.conversionError)))
      );
    },
    create(node, ctx, path) {
      let desc = controlDescriptor(node, ctx, path);
      if (!desc.control) throw new Error(`property "${node.bind}" has no control to place`);
      noteUnknownParams(node, desc.control, ctx.item && ctx.item.type);
      const scope = !desc.conversionError && Object.keys(desc.control.declarationActions || {}).length
        ? controlActions.create(ctx) : null;
      if (scope) desc = controlActions.bind(scope, node, desc);
      const el = !desc.conversionError && desc.control.mount
        ? mountWidget(desc.control, desc, ctx)
        : Object.assign(document.createElement("div"), { className: "mu-control" });
      el.__valueAdapter = node.params?.valueAdapter;
      if (el.__valueAdapter) el.__adapterSource = node.bind;
      el.dataset.controlName = desc.control.name;
      if (scope) {
        el.dataset.controlActions = "1";
        el.__controlActions = scope;
        el.__controlActionKey = controlActionKey(node);
      }
      if (node.desc) el.dataset.descKey = desc.key;
      if (desc.conversionError) {
        el.dataset.conversionFailed = "1";
        el.classList.add("mu-empty");
        el.setAttribute("role", "status");
        el.textContent = t("mu.control.conversionReadError", { message: desc.conversionError });
        return el;
      }
      if (!desc.control.mount) {
        el.append(desc.control.render(desc, (value) => ctx.onChange(desc, value)));
      }
      if (scope) scope.live = true;
      // A control that draws nodes inside itself (nestedNodes) draws them in `update`, and its `render`
      // is only the box they go in: without this the control is empty until something else redraws the
      // window, and a window just opened has nothing to do that.
      if (!desc.control.mount && desc.control.nestedNodes && typeof desc.control.update === "function") desc.control.update(el.firstElementChild, desc);
      NODE_KINDS.control.paintSink(el, node);
      el.classList.toggle("is-grow", Boolean(node.params && node.params.grow));
      paintReadonly(el, desc);
      viewHooks.paintExpand(el, node, ctx);
      return el;
    },
    update(el, node, ctx, path) {
      let desc = controlDescriptor(node, ctx, path);
      if (desc.conversionError) {
        const message = t("mu.control.conversionReadError", { message: desc.conversionError });
        if (el.textContent !== message) el.textContent = message;
        return;
      }
      if (el.__controlActions) desc = controlActions.bind(el.__controlActions, node, desc);
      // A mounted control is the host itself; a rendered one sits inside it.
      const target = el.dataset.widget ? el : el.firstElementChild;
      if (desc.control.update) desc.control.update(target, desc);
      NODE_KINDS.control.paintSink(el, node);
      el.classList.toggle("is-grow", Boolean(node.params && node.params.grow));
      paintReadonly(el, desc);
      viewHooks.paintExpand(el, node, ctx);
    },
    // A control placed with a `sink` ({accepts, put, label}) takes what is
    // dropped on it, the way a card's does.
    paintSink(el, node) {
      const sink = node.params && node.params.sink;
      if (sink) {
        viewHooks.attachSink(el, sink);
        el.__nodeSink = true;
      } else if (el.__nodeSink) {
        el.classList.remove("mu-port-sink");
        el.__sink = null;
        el.__nodeSink = false;
      }
    },
  },
};
