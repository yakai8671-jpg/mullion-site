/* The cell document and its HTML: what BsEditor did to cells and markup,
 * moved here as it was (a cell is {id, templateId, category, html, contentMode,
 * children, slotIndex, collapsed, detailsOpen}; `html` is the root element with
 * editor marks -- data-edit, data-inline-id, .cell-container -- that
 * buildCellHTML() strips for the page that is shown and exported).
 *
 * Nothing in this file touches the window: the operations that edit a
 * document are in ops.js.
 */

import { TEMPLATE_CATALOG } from "./templates.js";

const ALLOWED_TAGS = new Set([
  'a', 'abbr', 'acronym', 'address', 'b', 'big', 'blockquote', 'br', 'cite', 'code', 
  'dd', 'del', 'dfn', 'div', 'dl', 'dt', 'em', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 
  'hr', 'i', 'img', 'ins', 'kbd', 'li', 'mark', 'ol', 'p', 'pre', 'samp', 'small', 
  'span', 'strong', 'sub', 'sup', 'time', 'tt', 'ul', 'var', 'table', 'thead', 
  'tbody', 'tfoot', 'tr', 'th', 'td', 'button', 'details', 'summary'
]);

const ALLOWED_ATTRS = new Set([
  'abbr', 'alt', 'cite', 'class', 'datetime', 'height', 'href', 'lang', 'name',
  'src', 'title', 'width', 'xml:lang', 'colspan', 'rowspan', 'role', 'rel', 'target', 'open', 'data-inline-id'
]);

const SANITIZE_STRIP_ENTIRELY_TAGS = new Set(['script', 'style', 'noscript', 'template', 'iframe', 'object', 'embed']);

function findCellById(cells, id) {
  for (const cell of cells) {
    if (cell.id === id) return cell;
    if (cell.children && cell.children.length > 0) {
      const found = findCellById(cell.children, id);
      if (found) return found;
    }
  }
  return null;
}

function findCellParentArrayAndIndex(cells, id) {
  for (let i = 0; i < cells.length; i++) {
    if (cells[i].id === id) {
      return { array: cells, index: i, parent: null };
    }
    if (cells[i].children && cells[i].children.length > 0) {
      const res = findCellParentArrayAndIndex(cells[i].children, id);
      if (res) {
        if (!res.parent) res.parent = cells[i];
        return res;
      }
    }
  }
  return null;
}

function insertChildIntoSlot(childrenArray, newChild, slotIndex, slotChildIndex) {
  newChild.slotIndex = (slotIndex !== undefined && slotIndex !== null) ? parseInt(slotIndex, 10) : 0;
  const targetSlot = newChild.slotIndex;
  
  const slotIndices = [];
  for (let i = 0; i < childrenArray.length; i++) {
    if ((childrenArray[i].slotIndex || 0) === targetSlot) {
      slotIndices.push(i);
    }
  }
  
  if (slotIndices.length === 0 || slotChildIndex <= 0) {
    if (slotIndices.length > 0) {
      childrenArray.splice(slotIndices[0], 0, newChild);
    } else {
      childrenArray.push(newChild);
    }
  } else if (slotChildIndex >= slotIndices.length) {
    const lastIdx = slotIndices[slotIndices.length - 1];
    childrenArray.splice(lastIdx + 1, 0, newChild);
  } else {
    const targetIdx = slotIndices[slotChildIndex];
    childrenArray.splice(targetIdx, 0, newChild);
  }
}

function cloneCellRecursive(cell) {
  const cloned = JSON.parse(JSON.stringify(cell));
  function assignNewIds(c) {
    c.id = 'cell-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
    if (c.children && c.children.length > 0) {
      c.children.forEach(assignNewIds);
    }
  }
  assignNewIds(cloned);
  return cloned;
}

function stripEmptyContainerPlaceholders(htmlString) {
  const temp = document.createElement('div');
  temp.innerHTML = htmlString;
  temp.querySelectorAll('.cell-container.is-empty').forEach(c => {
    c.innerHTML = '';
    c.classList.remove('is-empty');
  });
  return temp.innerHTML;
}

function isCellOrDescendant(cell, targetId) {
  if (cell.id === targetId) return true;
  if (!cell.children) return false;
  return cell.children.some(child => isCellOrDescendant(child, targetId));
}

function findCellParentAndIndex(cells, id) {
  for (let i = 0; i < cells.length; i++) {
    if (cells[i].id === id) {
      return { parentArray: cells, index: i };
    }
    if (cells[i].children && cells[i].children.length > 0) {
      const result = findCellParentAndIndex(cells[i].children, id);
      if (result) return result;
    }
  }
  return null;
}

function assignInlineIds(htmlString) {
  const temp = document.createElement('div');
  temp.innerHTML = htmlString;
  
  const inlineTags = ['a', 'abbr', 'b', 'strong', 'i', 'em', 'sub', 'sup', 'mark', 'code', 'kbd', 'del', 'ins', 'span'];
  inlineTags.forEach(tag => {
    const elements = temp.querySelectorAll(tag);
    elements.forEach(el => {
      if (el.classList.contains('cell-container') || el.hasAttribute('data-edit')) {
        return;
      }
      // 編集可能なテキスト（[data-edit="text"]）の外側にある要素は、ボタンの
      // アイコンなどセル自体の構造の一部であり、ユーザーが編集する文章中の
      // 装飾ではないため、テキスト装飾として扱わない（＝IDを付与しない）。
      const editableAncestor = el.closest('[data-edit="text"]');
      if (!editableAncestor) {
        return;
      }
      // Bootstrap Iconsのアイコン（<i class="bi ...">）はテキストを持たない空要素であるため、
      // ブラウザのcontenteditableは「中身の無い装飾のない要素」とみなし、直接触れていない
      // 近隣のテキストを削除しただけでも巻き込んで消してしまうことがある(実機で確認済み)。
      // contenteditable="false"を付与し、ブラウザに対して「これは編集不可の単一の塊」だと
      // 明示することで、意図せず消えてしまう問題を防ぐ。
      if (tag === 'i' && el.classList.contains('bi')) {
        el.setAttribute('contenteditable', 'false');
        if (editableAncestor.textContent.trim() === '') {
          // インポート等でボタンのアイコン単体がそのままdata-edit="text"としてラップ
          // された場合、それは文中に挿入されたインラインアイコンではなくボタン自体の
          // 見た目の一部（＝ツールバーのアイコン等）なので、装飾としては扱わない。
          return;
        }
      }
      if (!el.getAttribute('data-inline-id')) {
        el.setAttribute('data-inline-id', 'inline-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9));
      }
    });
  });
  return temp.innerHTML;
}

function getContainerSlotIndex(containerEl, fallbackIdx) {
  const match = Array.from(containerEl.classList).find(c => /^slot-idx-\d+$/.test(c));
  return match ? parseInt(match.split('-').pop(), 10) : fallbackIdx;
}

function buildCellHTML(cell, removeEditor = true, markPreview = false) {
  const temp = document.createElement('div');
  temp.innerHTML = cell.html;

  const containers = temp.querySelectorAll('.cell-container');
  containers.forEach((container, arrIdx) => {
    const cIdx = getContainerSlotIndex(container, arrIdx);
    container.innerHTML = '';
    const slotChildren = (cell.children || []).filter(child => (child.slotIndex || 0) === cIdx);
    slotChildren.forEach(child => {
      const childHtml = buildCellHTML(child, removeEditor, markPreview);
      container.insertAdjacentHTML('beforeend', childHtml);
    });

    // .cell-container（および slot-idx-* クラス）はエディター内部専用のマーカーで、
    // 出力されるHTML（プレビュー・HTML出力とも buildCellHTML を通る）には意味を持たない。
    // 本番と全く同じ見た目・マークアップになるよう、ラッパーごと展開して取り除く。
    if (removeEditor) {
      while (container.firstChild) {
        container.parentNode.insertBefore(container.firstChild, container);
      }
      container.parentNode.removeChild(container);
    }
  });

  const details = temp.querySelector('details');
  if (details) {
    if (cell.detailsOpen) {
      details.setAttribute('open', '');
    } else {
      details.removeAttribute('open');
    }
  }

  if (markPreview && temp.firstElementChild) {
    temp.firstElementChild.setAttribute('data-preview-cell-id', cell.id);
  }

  return sanitizeHTML(temp.innerHTML, removeEditor, markPreview);
}

function sanitizeHTML(htmlString, removeEditorAttrs = true, keepPreviewCellId = false) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(htmlString, 'text/html');
  
  function cleanNode(node) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const tagName = node.tagName.toLowerCase();

      // script/style等は中身（JSソースやCSS）がそのまま可視テキストとして
      // 持ち上がってしまわないよう、子ごと丸ごと除去する（他の非対応タグは中身を残して展開する）
      if (SANITIZE_STRIP_ENTIRELY_TAGS.has(tagName)) {
        node.parentNode.removeChild(node);
        return;
      }

      if (!ALLOWED_TAGS.has(tagName)) {
        while (node.firstChild) {
          node.parentNode.insertBefore(node.firstChild, node);
        }
        node.parentNode.removeChild(node);
        return;
      }
      
      const attrs = Array.from(node.attributes);
      for (const attr of attrs) {
        const attrName = attr.name.toLowerCase();

        if (attrName === 'data-preview-cell-id') {
          if (!keepPreviewCellId) {
            node.removeAttribute(attr.name);
          }
          continue;
        }
        
        if (removeEditorAttrs && (attrName.startsWith('data-edit') || attrName === 'contenteditable' || attrName === 'data-inline-id')) {
          node.removeAttribute(attr.name);
          continue;
        }
        
        if (!removeEditorAttrs && (attrName.startsWith('data-edit') || attrName === 'contenteditable' || attrName === 'data-inline-id')) {
          continue;
        }
        
        if (!ALLOWED_ATTRS.has(attrName)) {
          node.removeAttribute(attr.name);
        }
      }

      // Word/Excel/Google Docs等からの貼り付け・インポートでは、元々の書式指定(style等)が
      // 属性ごと取り除かれた結果、何の意味も持たない空の<span>だけが大量に残ることがある。
      // これらは「テキスト装飾」一覧に(未適用)の項目として大量に表示されノイズになるため、
      // 属性が1つも残っていない<span>はタグごと展開して取り除く。
      if (tagName === 'span' && node.attributes.length === 0) {
        const childNodes = Array.from(node.childNodes);
        childNodes.forEach(child => node.parentNode.insertBefore(child, node));
        node.parentNode.removeChild(node);
        childNodes.forEach(child => cleanNode(child));
        return;
      }

      const children = Array.from(node.childNodes);
      for (const child of children) {
        cleanNode(child);
      }
    }
  }
  
  const body = doc.body;
  const children = Array.from(body.childNodes);
  for (const child of children) {
    cleanNode(child);
  }

  return body.innerHTML;
}

const IMPORT_CONTAINER_TAGS = new Set(['div', 'ul', 'ol', 'dl', 'blockquote', 'address', 'details']);
const IMPORT_CELL_WORTHY_TAGS = new Set(['div', 'ul', 'ol', 'dl', 'blockquote', 'address', 'details', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'table', 'hr', 'pre', 'img']);

let importCellIdCounter = 0;

function generateImportedCellId() {
  importCellIdCounter += 1;
  return 'cell-' + Date.now() + '-' + importCellIdCounter + '-' + Math.random().toString(36).substr(2, 6);
}

function importMakeCell(overrides) {
  const cell = Object.assign({
    id: generateImportedCellId(),
    templateId: undefined,
    category: undefined,
    html: '',
    contentMode: 'text',
    collapsed: false,
    children: [],
    slotIndex: 0
  }, overrides);

  // インライン装飾（b/strong/a/mark等）に data-inline-id を付与する。
  // これが無いと「テキスト装飾」一覧・ハイライト・選択範囲装飾が正しく機能しない
  // （他の全セル生成経路(テンプレート追加・テキスト編集等)は必ずこれを通している）。
  if (cell.html) {
    cell.html = assignInlineIds(cell.html);
  }
  return cell;
}

function importTemplateInfoForTag(tag) {
  const id = 'tag-' + tag;
  return TEMPLATE_CATALOG.some(t => t.id === id) ? { templateId: id, category: 'tag' } : {};
}

function importWrapAsTextLeaf(tag, el) {
  const wrapper = document.createElement(tag);
  Array.from(el.attributes).forEach(attr => wrapper.setAttribute(attr.name, attr.value));
  const span = document.createElement('span');
  span.setAttribute('data-edit', 'text');
  span.innerHTML = el.innerHTML;
  wrapper.appendChild(span);
  return importMakeCell(Object.assign({ html: wrapper.outerHTML, contentMode: 'text' }, importTemplateInfoForTag(tag)));
}

function importMarkAsTextLeaf(el) {
  const tag = el.tagName.toLowerCase();
  const clone = el.cloneNode(true);
  clone.setAttribute('data-edit', 'text');
  return importMakeCell(Object.assign({ html: clone.outerHTML, contentMode: 'text' }, importTemplateInfoForTag(tag)));
}

function importConvertContainer(tag, el, itemChildren) {
  const wrapper = document.createElement(tag);
  Array.from(el.attributes).forEach(attr => wrapper.setAttribute(attr.name, attr.value));
  const containerDiv = document.createElement('div');
  containerDiv.className = 'cell-container';
  wrapper.appendChild(containerDiv);
  return importMakeCell(Object.assign({
    html: wrapper.outerHTML,
    contentMode: 'container',
    children: itemChildren
  }, importTemplateInfoForTag(tag)));
}

function isImportRowLike(el) {
  if (!el.classList.contains('row')) return false;
  const children = Array.from(el.children);
  if (children.length === 0) return false;
  return children.every(c => c.tagName.toLowerCase() === 'div' && Array.from(c.classList).some(cls => /^col(-|$)/.test(cls)));
}

function importConvertRow(el) {
  const wrapper = document.createElement('div');
  Array.from(el.attributes).forEach(attr => wrapper.setAttribute(attr.name, attr.value));

  const children = [];
  Array.from(el.children).forEach((colEl, colIndex) => {
    const colWrapper = document.createElement('div');
    Array.from(colEl.attributes).forEach(attr => colWrapper.setAttribute(attr.name, attr.value));
    const containerDiv = document.createElement('div');
    containerDiv.className = 'cell-container slot-idx-' + colIndex;
    colWrapper.appendChild(containerDiv);
    wrapper.appendChild(colWrapper);

    const colChildren = importConvertChildNodes(colEl);
    colChildren.forEach(c => { c.slotIndex = colIndex; });
    children.push(...colChildren);
  });

  return importMakeCell(Object.assign({
    html: wrapper.outerHTML,
    contentMode: 'container',
    children
  }, importTemplateInfoForTag('div')));
}

function importConvertListLike(tag, el) {
  const allowedItemTags = (tag === 'dl') ? ['dt', 'dd'] : ['li'];
  const items = Array.from(el.children).filter(c => allowedItemTags.includes(c.tagName.toLowerCase()));
  const childCells = items.map(item => importConvertElement(item));
  return importConvertContainer(tag, el, childCells);
}

function importConvertListItem(el) {
  const nestedList = Array.from(el.children).find(c => ['ul', 'ol'].includes(c.tagName.toLowerCase()));
  if (!nestedList) {
    return importMarkAsTextLeaf(el);
  }

  const directContentHolder = document.createElement('div');
  Array.from(el.childNodes).forEach(n => {
    if (n !== nestedList) directContentHolder.appendChild(n.cloneNode(true));
  });

  const liEl = document.createElement('li');
  Array.from(el.attributes).forEach(attr => liEl.setAttribute(attr.name, attr.value));

  if (directContentHolder.textContent.trim() !== '') {
    const span = document.createElement('span');
    span.setAttribute('data-edit', 'text');
    span.innerHTML = directContentHolder.innerHTML;
    liEl.appendChild(span);
  }
  const containerDiv = document.createElement('div');
  containerDiv.className = 'cell-container';
  liEl.appendChild(containerDiv);

  return importMakeCell(Object.assign({
    html: liEl.outerHTML,
    contentMode: 'container',
    children: [importConvertElement(nestedList)]
  }, importTemplateInfoForTag('li')));
}

function importConvertDetails(el) {
  const summaryEl = el.querySelector(':scope > summary');
  const isOpen = el.hasAttribute('open');
  const bodyHolder = document.createElement('div');
  Array.from(el.childNodes).forEach(n => {
    if (n === summaryEl) return;
    bodyHolder.appendChild(n.cloneNode(true));
  });

  const structuralChildren = Array.from(bodyHolder.children).filter(c => IMPORT_CELL_WORTHY_TAGS.has(c.tagName.toLowerCase()));

  const detailsEl = document.createElement('details');
  if (isOpen) detailsEl.setAttribute('open', '');
  Array.from(el.attributes).forEach(attr => {
    if (attr.name !== 'open') detailsEl.setAttribute(attr.name, attr.value);
  });
  const summary = document.createElement('summary');
  summary.setAttribute('data-edit', 'text');
  summary.innerHTML = summaryEl ? summaryEl.innerHTML : '折りたたみタイトル';
  detailsEl.appendChild(summary);

  if (structuralChildren.length > 0) {
    const containerDiv = document.createElement('div');
    containerDiv.className = 'cell-container';
    detailsEl.appendChild(containerDiv);
    return importMakeCell(Object.assign({
      html: detailsEl.outerHTML,
      contentMode: 'container',
      detailsOpen: isOpen,
      children: importConvertChildNodes(bodyHolder)
    }, importTemplateInfoForTag('details')));
  } else {
    const span = document.createElement('span');
    span.setAttribute('data-edit', 'text');
    span.innerHTML = bodyHolder.innerHTML;
    detailsEl.appendChild(span);
    return importMakeCell(Object.assign({ html: detailsEl.outerHTML, contentMode: 'text', detailsOpen: isOpen }, importTemplateInfoForTag('details')));
  }
}

function importConvertTable(el) {
  const clone = el.cloneNode(true);
  clone.setAttribute('data-edit-attr', 'class');

  const tdList = Array.from(clone.querySelectorAll('td, th'));
  const children = [];
  tdList.forEach((tdEl, tdIndex) => {
    const structuralChildren = Array.from(tdEl.children).filter(c => IMPORT_CELL_WORTHY_TAGS.has(c.tagName.toLowerCase()));
    if (structuralChildren.length > 0) {
      const childCells = importConvertChildNodes(tdEl);
      childCells.forEach(c => { c.slotIndex = tdIndex; });
      children.push(...childCells);

      tdEl.innerHTML = '';
      const containerDiv = document.createElement('div');
      containerDiv.className = 'cell-container slot-idx-' + tdIndex;
      tdEl.appendChild(containerDiv);
    } else {
      tdEl.setAttribute('data-edit', 'text');
    }
  });

  return importMakeCell(Object.assign({ html: clone.outerHTML, contentMode: 'text', children }, importTemplateInfoForTag('table')));
}

function importConvertElement(el) {
  const tag = el.tagName.toLowerCase();

  if (tag === 'ul' || tag === 'ol' || tag === 'dl') {
    return importConvertListLike(tag, el);
  }
  if (tag === 'details') {
    return importConvertDetails(el);
  }
  if (tag === 'table') {
    return importConvertTable(el);
  }
  if (tag === 'img' || tag === 'hr') {
    const clone = el.cloneNode(false);
    if (tag === 'img') clone.setAttribute('data-edit-attr', 'src,alt');
    return importMakeCell(Object.assign({ html: clone.outerHTML, contentMode: 'text' }, importTemplateInfoForTag(tag)));
  }
  if (tag === 'li') {
    return importConvertListItem(el);
  }
  if (['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'a', 'pre', 'code', 'kbd', 'samp', 'dt', 'dd'].includes(tag)) {
    return importMarkAsTextLeaf(el);
  }
  if (tag === 'div' || tag === 'blockquote' || tag === 'address') {
    // Bootstrapの "row > col-*" 構造は特別扱いする。通常のコンテナ変換だと全ての列を
    // 1つの共有 .cell-container にまとめてしまい、結果的に .row の直下に .cell-container が来て
    // col-* がその孫要素になってしまう。Bootstrapのグリッドは col-* が .row の直接の子で
    // ないと横並びにならないため、列ごとに個別の .cell-container を持たせる必要がある
    // （Grid 2/3 テンプレートと同じ構造）。
    if (tag === 'div' && isImportRowLike(el)) {
      return importConvertRow(el);
    }
    const structuralChildren = Array.from(el.children).filter(c => IMPORT_CELL_WORTHY_TAGS.has(c.tagName.toLowerCase()));
    if (structuralChildren.length > 0) {
      return importConvertContainer(tag, el, importConvertChildNodes(el));
    }
    return importWrapAsTextLeaf(tag, el);
  }

  // 想定外のタグが残っていた場合のフォールバック（破壊的変換）：テキストの葉セルとして取り込む
  return importWrapAsTextLeaf('div', el);
}

function importConvertChildNodes(parentEl) {
  const cells = [];
  Array.from(parentEl.childNodes).forEach(node => {
    if (node.nodeType === Node.ELEMENT_NODE) {
      cells.push(importConvertElement(node));
    } else if (node.nodeType === Node.TEXT_NODE && node.textContent.trim() !== '') {
      // 素のテキストノードは破棄せず、テキストの葉セルとして取り込む
      const div = document.createElement('div');
      const span = document.createElement('span');
      span.setAttribute('data-edit', 'text');
      span.textContent = node.textContent.trim();
      div.appendChild(span);
      cells.push(importMakeCell({ html: div.outerHTML, contentMode: 'text' }));
    }
  });
  return cells;
}

const IMPORT_TAG_REMAP = { section: 'div', article: 'div', header: 'div', footer: 'div', nav: 'div', main: 'div', aside: 'div', figure: 'div', figcaption: 'p' };

function importRemapSemanticTags(doc) {
  Object.keys(IMPORT_TAG_REMAP).forEach(fromTag => {
    const toTag = IMPORT_TAG_REMAP[fromTag];
    Array.from(doc.querySelectorAll(fromTag)).forEach(el => {
      const replacement = doc.createElement(toTag);
      Array.from(el.attributes).forEach(attr => replacement.setAttribute(attr.name, attr.value));
      while (el.firstChild) replacement.appendChild(el.firstChild);
      el.parentNode.replaceChild(replacement, el);
    });
  });
}

function importHtmlToCells(rawHtml) {
  const parser = new DOMParser();
  const preDoc = parser.parseFromString(rawHtml, 'text/html');
  importRemapSemanticTags(preDoc);

  const cleaned = sanitizeHTML(preDoc.body.innerHTML, true);
  const doc = parser.parseFromString(cleaned, 'text/html');
  return importConvertChildNodes(doc.body);
}

export {
  ALLOWED_ATTRS,
  assignInlineIds,
  buildCellHTML,
  cloneCellRecursive,
  findCellById,
  findCellParentArrayAndIndex,
  findCellParentAndIndex,
  generateImportedCellId,
  getContainerSlotIndex,
  importHtmlToCells,
  insertChildIntoSlot,
  isCellOrDescendant,
  sanitizeHTML,
  stripEmptyContainerPlaceholders,
};
