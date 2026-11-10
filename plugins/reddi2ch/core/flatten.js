// Discussion（中立表現）→ ScThread（5ch のフラットなレス列）。
// ここが 5ch 変換の本体。レス番・>>N・ID:xxxx・和暦の日時といった 5ch 固有の概念は
// すべてこの層で初めて発生する。保存されたデータには持ち込まない。
//
// 別形式（例: 掲示板風でない普通のスレッド表示）に対応するときは、
// このファイルの隣に同じ入力（Discussion）を取る変換を足す。

import { makeUid } from './hash.js';
import { format5chDate, escapeHtml, shortNum } from './format.js';
import { toDiscussion } from './discussion.js';
import { extractPost, collectTree, countHidden } from './reddit.js';

/**
 * @typedef {Object} Res
 * @property {number} no          レス番号（1 = スレ本文）
 * @property {string} sourceId    元のコメント id（Discussion に戻れるように）
 * @property {string} author
 * @property {string} name        名前欄に出す文字列
 * @property {string} uid         ID:xxxxxxxx の中身
 * @property {number} createdUtc
 * @property {string} date        整形済み日時
 * @property {number} score
 * @property {string} bodyHtml
 * @property {number[]} anchors   このレスが参照している先（>>N）
 * @property {number[]} replies   このレスに返信しているレス番号
 * @property {number} depth
 * @property {boolean} isOp
 * @property {boolean} isStickied
 * @property {string} permalink
 */

export const DEFAULT_OPTIONS = {
  /** 'author' = ユーザー名を名前欄に出す / 'anon' = 名無し固定 */
  nameMode: 'author',
  anonName: '名無しさん@お腹いっぱい。',
  /** ID を板単位で振るか、スレ単位で振るか */
  idScope: 'subreddit',
  dropDeleted: false,
  dropAutoModerator: true,
  minScore: null,

  /**
   * 並び順。
   *   'time'   … 書き込み順（5ch そのもの）
   *   'thread' … 返信を返信先の下に置く（まとめサイト風）
   * どちらでもレス番号は書き込み順で振る。番号を並びに依存させると
   * >>N が元スレと食い違うため。
   */
  order: 'time',

  /** 残すレス数の目安。null で全部。会話が切れないよう祖先は残すので多少超える */
  maxRes: null,
  /** カットの評価: スコア + 返信数 × これ */
  replyWeight: 3,

  /** 人気レスの強調（スレ内での相対評価） */
  highlight: true,

  /** 画像を本文に出す */
  showImages: true,
  /** 1 レスあたりの最大枚数 */
  maxImages: 4,
  /** 画像の最大幅（px）。0 で指定しない */
  imageWidth: 520,
};

/**
 * Discussion → ScThread。
 * @param {import('./discussion.js').Discussion} discussion
 * @param {Partial<typeof DEFAULT_OPTIONS>} [options]
 */
export function buildScThread(discussion, options = {}) {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const all = discussion.comments ?? [];

  // 親を辿るために、フィルタ前の全件を先に引けるようにしておく。
  const allById = new Map(all.map((c) => [c.id, c]));
  const filtered = all.filter((c) => keep(c, opts));

  // 5ch はツリーではなく書き込み順。ここでフラット化の意味が決まる。
  filtered.sort((a, b) => (a.createdUtc - b.createdUtc) || String(a.id).localeCompare(String(b.id)));

  const salt = opts.idScope === 'subreddit' ? discussion.board.id : discussion.id;
  const noOf = new Map(); // コメント id -> レス番号
  filtered.forEach((c, i) => noOf.set(c.id, i + 2));

  const res = [buildOpRes(discussion, opts, salt)];

  for (const c of filtered) {
    res.push({
      no: noOf.get(c.id),
      sourceId: c.id,
      author: c.author ?? '[deleted]',
      name: displayName(c.author, opts),
      uid: makeUid(c.author ?? '', c.createdUtc, salt),
      createdUtc: c.createdUtc,
      date: format5chDate(c.createdUtc, c.id),
      score: c.score ?? 0,
      bodyHtml: (c.bodyHtml ?? '') + mediaHtml(c.media, opts),
      anchors: anchorsFor(c, noOf, allById),
      replies: [],
      depth: c.depth ?? 0,
      isOp: c.isSubmitter === true,
      isStickied: c.stickied === true,
      permalink: c.permalink ?? '',
    });
  }

  // 逆引き。「返信: >>15 >>23」は 5ch 専ブラでいちばん使う導線。
  const byNo = new Map(res.map((r) => [r.no, r]));
  for (const r of res) {
    for (const a of r.anchors) byNo.get(a)?.replies.push(r.no);
  }

  // ここから先は「見せ方」。番号を振り終えてから間引き・並べ替え・強調をする。
  const kept = opts.maxRes ? selectRes(res, opts) : res;
  const omitted = res.length - kept.length;
  if (opts.highlight) applyHeat(kept);
  const ordered = opts.order === 'thread' ? threadOrder(kept) : kept;

  return {
    id: discussion.id,
    title: discussion.title,
    subreddit: discussion.board.id,
    boardName: discussion.board.name,
    permalink: discussion.permalink,
    url: discussion.link?.url ?? '',
    createdUtc: discussion.createdUtc,
    score: discussion.metrics.score,
    numComments: discussion.metrics.commentCount,
    hiddenCount: discussion.truncated?.count ?? 0,
    fetchedAt: discussion.fetchedAt,
    order: opts.order,
    totalRes: res.length,
    omittedRes: omitted,
    res: ordered,
  };
}

/**
 * 目立つレスだけ残す。評価は スコア + 返信数 × replyWeight。
 * 選ばれたレスの祖先も残す（>>N を辿れなくなると会話が読めないため）。
 */
function selectRes(res, opts) {
  const byNo = new Map(res.map((r) => [r.no, r]));
  const scored = res
    .filter((r) => r.no !== 1)
    .map((r) => ({ r, weight: r.score + r.replies.length * opts.replyWeight }))
    .sort((a, b) => b.weight - a.weight || a.r.no - b.r.no);

  const keep = new Set([1]);
  for (const { r } of scored.slice(0, Math.max(0, opts.maxRes - 1))) keep.add(r.no);

  // 祖先を補う
  for (const no of [...keep]) {
    let cur = byNo.get(no);
    for (let i = 0; i < 64 && cur?.anchors.length; i++) {
      const parent = cur.anchors[0];
      if (keep.has(parent)) break;
      keep.add(parent);
      cur = byNo.get(parent);
    }
  }

  const kept = res.filter((r) => keep.has(r.no));
  // 残らなかったレスへの逆引きは消す（クリックしても飛べないため）
  for (const r of kept) r.replies = r.replies.filter((n) => keep.has(n));
  return kept;
}

/**
 * スレ内での相対評価で 0〜3 の段階を振る。
 * 絶対値で決めると、伸びたスレでは全部が「人気」になり、静かなスレでは何も光らない。
 */
function applyHeat(res) {
  const scores = res.filter((r) => r.no !== 1).map((r) => r.score);
  if (scores.length < 4) {
    for (const r of res) r.heat = 0;
    return;
  }
  const sorted = [...scores].sort((a, b) => a - b);
  const q = (p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
  const [q40, q70, q90] = [q(0.4), q(0.7), q(0.9)];

  for (const r of res) {
    if (r.no === 1 || r.score <= 0) {
      r.heat = 0;
      continue;
    }
    r.heat = r.score >= q90 ? 3 : r.score >= q70 ? 2 : r.score >= q40 ? 1 : 0;
  }
}

/**
 * 返信を返信先の下に並べる。同じ深さでは書き込み順。
 * 5ch は書き込み順が正だが、まとめサイトはこの並びのほうが読みやすい。
 */
function threadOrder(res) {
  const children = new Map();
  const roots = [];
  const present = new Set(res.map((r) => r.no));

  for (const r of res) {
    if (r.no === 1) continue;
    const parent = r.anchors.find((a) => present.has(a));
    if (parent) {
      if (!children.has(parent)) children.set(parent, []);
      children.get(parent).push(r);
    } else {
      roots.push(r);
    }
  }

  const out = [];
  const op = res.find((r) => r.no === 1);
  if (op) out.push(op);

  const walk = (r, depth) => {
    r.indent = depth;
    out.push(r);
    for (const c of (children.get(r.no) ?? []).sort((a, b) => a.no - b.no)) walk(c, depth + 1);
  };
  for (const r of roots.sort((a, b) => a.no - b.no)) walk(r, 0);

  return out;
}

function keep(c, opts) {
  if (opts.dropAutoModerator && c.author === 'AutoModerator') return false;
  if (opts.dropDeleted && (!c.author || c.bodyText === '[deleted]' || c.bodyText === '[removed]')) return false;
  if (opts.minScore !== null && typeof c.score === 'number' && c.score < opts.minScore) return false;
  return true;
}

/**
 * 親がフィルタで消えている場合は、生き残っている最も近い祖先までさかのぼる。
 * こうしないと NG やスコア閾値を使った瞬間に会話の繋がりが切れる。
 */
function anchorsFor(c, noOf, allById) {
  let parentId = c.parentId;
  for (let i = 0; i < 64 && parentId; i++) {
    const no = noOf.get(parentId);
    if (no) return [no];
    const parent = allById.get(parentId);
    if (!parent) return [];
    parentId = parent.parentId;
  }
  // parentId が null＝トップレベル。5ch のトップレスと同じくアンカーは出さない。
  return [];
}

function displayName(author, opts) {
  if (opts.nameMode === 'anon') return opts.anonName;
  return author || '名無しさん';
}

/**
 * 画像・動画の HTML。
 * 同じ画像が gallery / direct / preview と重複して入っているので、
 * 出どころの優先順で 1 枚ずつに絞る。
 */
// referrerpolicy: these are drawn on a localhost page, and Reddit's image
// hosts refuse a referrer that is not Reddit's own.
function mediaHtml(media, opts) {
  if (!opts.showImages || !media?.length) return '';

  const priority = { gallery: 0, direct: 1, reddit_video: 1, preview: 2 };
  const seen = new Set();
  const picked = [...media]
    .sort((a, b) => (priority[a.source] ?? 9) - (priority[b.source] ?? 9))
    .filter((m) => {
      // 同じ画像の別サイズを二重に出さない。gallery と preview は URL の
      // クエリだけが違う（i.redd.it/x.png と preview.redd.it/x.png?width=…）ので、
      // ファイル名で判定する。
      const key = m.url.split('/').pop().split('?')[0].toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, opts.maxImages);

  if (!picked.length) return '';
  const style = opts.imageWidth ? ` style="max-width:${opts.imageWidth}px"` : '';

  return `<div class="r2c-media">${picked
    .map((m) =>
      m.kind === 'video'
        ? `<video class="r2c-video" controls preload="none" referrerpolicy="no-referrer" src="${escapeHtml(m.url)}"${style}></video>`
        : `<a href="${escapeHtml(m.url)}" target="_blank" rel="noreferrer noopener">` +
          `<img class="r2c-img" src="${escapeHtml(m.url)}" loading="lazy" referrerpolicy="no-referrer" alt=""${style}></a>`
    )
    .join('')}</div>`;
}

function buildOpRes(d, opts, salt) {
  const parts = [];
  if (d.link?.url && !d.media?.some((m) => m.url === d.link.url)) {
    parts.push(`<p><a href="${escapeHtml(d.link.url)}">${escapeHtml(d.link.url)}</a></p>`);
  }
  if (d.bodyHtml) parts.push(d.bodyHtml);
  parts.push(mediaHtml(d.media, opts));
  if (!parts.filter(Boolean).length) parts.push('<p>（本文なし）</p>');

  return {
    no: 1,
    sourceId: d.id,
    author: d.author ?? '[deleted]',
    name: displayName(d.author, opts),
    uid: makeUid(d.author ?? '', d.createdUtc, salt),
    createdUtc: d.createdUtc,
    date: format5chDate(d.createdUtc, d.id),
    score: d.metrics.score,
    bodyHtml: parts.filter(Boolean).join('\n'),
    anchors: [],
    replies: [],
    depth: -1,
    isOp: true,
    isStickied: d.stickied === true,
    permalink: d.permalink,
  };
}

// ------------------------------------------------------------- 互換ラッパー
// 拡張は Reddit の JSON から直接 5ch まで一気に変換する（保存しないので中立表現を
// 経由する必要がない）。内部では Discussion を通しているので変換規則は 1 つだけ。

/** `/r/x/comments/yyy.json` のレスポンス → ScThread。more は展開しない。 */
export function buildThread(json, options = {}) {
  const post = extractPost(json);
  const acc = collectTree(json?.[1]?.data?.children ?? []);
  return buildThreadFromParts({ post, comments: acc.comments, hiddenCount: countHidden(acc.mores) }, options);
}

/** expandThread() の戻り値 → ScThread。 */
export function buildThreadFromParts(parts, options = {}) {
  return buildScThread(toDiscussion(parts), options);
}

// ------------------------------------------------------------------ 板一覧

/**
 * 勢い。5ch の板一覧と同じ意味の指標で、キュレーションの「話題になっている」判定にも使う。
 * 立って間もないスレが過大評価されないよう、経過時間に下駄を履かせる。
 */
export function momentum(numComments, createdUtc, nowSec = Date.now() / 1000) {
  const hours = Math.max(1, (nowSec - createdUtc) / 3600);
  return Math.round((numComments / hours) * 24);
}

/** `/r/x/hot.json` のレスポンスを板のスレ一覧に変換する。 */
export function buildThreadList(json, subreddit = '', options = {}) {
  const { sort = 'hot', nowSec = Date.now() / 1000 } = options;
  const children = json?.data?.children ?? [];
  const items = children
    .filter((c) => c.kind === 't3')
    .map((c, i) => {
      const d = c.data;
      return {
        no: i + 1,
        id: d.id,
        title: d.title ?? '',
        numComments: d.num_comments ?? 0,
        score: d.score ?? 0,
        permalink: d.permalink ?? '',
        createdUtc: d.created_utc,
        author: d.author ?? '',
        flair: d.link_flair_text ?? '',
        domain: d.domain ?? '',
        isSelf: d.is_self === true,
        stickied: d.stickied === true,
        subreddit: d.subreddit ?? subreddit,
        momentum: momentum(d.num_comments ?? 0, d.created_utc, nowSec),
      };
    });
  return {
    subreddit: subreddit || items[0]?.subreddit || '',
    sort,
    items,
    after: json?.data?.after ?? null,
  };
}

/** 板一覧のヘッダに出すサマリ。 */
export function listSummary(list) {
  const total = list.items.reduce((n, it) => n + it.numComments, 0);
  return `${list.items.length} スレッド ／ 総レス ${shortNum(total)}`;
}
