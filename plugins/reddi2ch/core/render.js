// Thread / ThreadList → HTML 文字列。DOM API を使わないので Node からも呼べる。

import { escapeHtml, format5chDate, shortNum } from './format.js';
import { listSummary } from './flatten.js';

const DEFAULT_RENDER_OPTIONS = {
  /** レス番号のリンク先。拡張ではページ内アンカー、静的サイトでは同じで良い */
  anchorPrefix: 'r',
  /** スレ一覧の各行のリンクをどう作るか */
  threadHref: (item) => `https://www.reddit.com${item.permalink}`,
  /** 元スレへのリンクを出すか */
  showSource: true,
  showScore: true,
};

/**
 * @param {import('./flatten.js').Thread} thread
 */
export function renderThread(thread, options = {}) {
  const o = { ...DEFAULT_RENDER_OPTIONS, ...options };
  const body = thread.res.map((r) => renderRes(r, o)).join('\n');
  const notes = [];
  if (thread.omittedRes) {
    notes.push(`※ 人気のないレス ${thread.omittedRes} 件を省略しています（全 ${thread.totalRes} レス）`);
  }
  if (thread.hiddenCount) {
    notes.push(`※ ${thread.hiddenCount} レスが未展開です（Reddit 側で折りたたまれています）`);
  }
  const hidden = notes.length ? `<div class="r2c-note">${notes.join('<br>')}</div>` : '';

  return `<div class="r2c-root">
  <div class="r2c-head">
    <div class="r2c-board">r/${escapeHtml(thread.subreddit)}</div>
    <h1 class="r2c-title">${escapeHtml(thread.title)}</h1>
    <div class="r2c-sub">全 ${thread.res.length} レス ／ スコア ${shortNum(thread.score)} ／ ${escapeHtml(thread.res[0]?.date ?? '')}${
      o.showSource ? ` ／ <a class="r2c-src" href="https://www.reddit.com${escapeHtml(thread.permalink)}">元スレ</a>` : ''
    }</div>
  </div>
  <div class="r2c-list">
${body}
  </div>
  ${hidden}
  <div class="r2c-foot">read.cgi ver 2ch風 — reddi2ch</div>
</div>`;
}

/**
 * @param {import('./flatten.js').Res} res
 */
export function renderRes(res, options = {}) {
  const o = { ...DEFAULT_RENDER_OPTIONS, ...options };
  const id = `${o.anchorPrefix}${res.no}`;
  const anchorLine = res.anchors.length
    ? `<div class="r2c-anchors">${res.anchors.map((n) => anchorLink(n, o)).join(' ')}</div>`
    : '';
  const replyLine = res.replies.length
    ? `<div class="r2c-replies">返信: ${res.replies.map((n) => anchorLink(n, o)).join(' ')}</div>`
    : '';
  const score = o.showScore ? ` <span class="r2c-score ${res.score < 0 ? 'is-neg' : ''}">(${res.score > 0 ? '+' : ''}${shortNum(res.score)})</span>` : '';
  const opTag = res.no !== 1 && res.isOp ? ' <span class="r2c-optag">[主]</span>' : '';

  const heat = res.heat ? ` is-heat${res.heat}` : '';
  const indent = res.indent ? ` style="margin-left:${Math.min(res.indent, 6) * 1.4}em"` : '';

  return `    <div class="r2c-res${res.no === 1 ? ' is-op' : ''}${heat}"${indent} id="${id}" data-no="${res.no}">
      <div class="r2c-resh"><a class="r2c-no" href="#${id}">${res.no}</a> ：<span class="r2c-name"><b>${escapeHtml(res.name)}</b></span>${opTag}：<span class="r2c-date">${escapeHtml(res.date)}</span> <span class="r2c-uid">ID:${escapeHtml(res.uid)}</span>${score}</div>
      <div class="r2c-body">${anchorLine}${res.bodyHtml}${replyLine}</div>
    </div>`;
}

function anchorLink(n, o) {
  return `<a class="r2c-anchor" href="#${o.anchorPrefix}${n}" data-target="${n}">&gt;&gt;${n}</a>`;
}

/**
 * 板トップ（スレ一覧）。5ch の subject 表示に寄せて `1: タイトル (128)` を主役にし、
 * 勢い・日時を右側に添える。勢いはプロジェクト2の「話題になっている」判定と同じ指標。
 */
export function renderThreadList(list, options = {}) {
  const o = { ...DEFAULT_RENDER_OPTIONS, ...options };
  const rows = list.items
    .map((it) => {
      const flair = it.flair ? `<span class="r2c-flair">[${escapeHtml(it.flair)}]</span> ` : '';
      const pin = it.stickied ? '<span class="r2c-pin">★</span> ' : '';
      const src = !it.isSelf && it.domain ? ` <span class="r2c-domain">(${escapeHtml(it.domain)})</span>` : '';
      return `    <div class="r2c-row${it.stickied ? ' is-pinned' : ''}">
      <span class="r2c-rowno">${it.no}:</span> <span class="r2c-rowmain">${pin}${flair}<a class="r2c-rowlink" href="${escapeHtml(o.threadHref(it))}">${escapeHtml(it.title)}</a> <span class="r2c-count">(${it.numComments})</span>${src}</span>
      <span class="r2c-rowmeta"><span class="r2c-mom" title="1日あたりのレス数">勢い ${shortNum(it.momentum ?? 0)}</span> ${shortNum(it.score)}pt ${escapeHtml(format5chDate(it.createdUtc, it.id))}</span>
    </div>`;
    })
    .join('\n');

  return `<div class="r2c-root">
  <div class="r2c-head">
    <div class="r2c-board">reddi2ch＠${escapeHtml(list.sort ?? '')}</div>
    <h1 class="r2c-title">r/${escapeHtml(list.subreddit)}</h1>
    <div class="r2c-sub">${listSummary(list)}</div>
  </div>
  <div class="r2c-rows">
${rows}
  </div>
  <div class="r2c-foot">reddi2ch</div>
</div>`;
}
