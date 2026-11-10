// Discussion = 変換先に依存しない中立表現。
//
//   Reddit の生 JSON ──toDiscussion──▶ Discussion ──buildScThread──▶ ScThread（5ch）
//                                          └──────────────────────▶ 将来の別形式
//
// 保存するのはこの層まで。5ch 固有の概念（レス番・>>N・ID:xxxx・和暦の日時）は
// 一切持たせない。それらは表示のたびに ScThread を組んで作る。
//
// なお Discussion はモデル化した範囲しか持たないので、失われた情報を取り戻せるよう
// 生 JSON は別に丸ごと保存する（packages/store の archive）。

import { normalizeBodyHtml, sanitizeHtml } from './format.js';
import { extractPost, collectTree, countHidden } from './reddit.js';

export const DISCUSSION_SCHEMA = 'discussion/2'; // v2: media を追加

/**
 * @typedef {Object} DiscussionComment
 * @property {string} id
 * @property {string} fullId        プラットフォーム側の完全 ID（reddit なら t1_xxx）
 * @property {string|null} parentId 親コメントの id。トップレベルは null
 * @property {string|null} author   削除済みは null
 * @property {number} createdUtc
 * @property {string} bodyHtml      サニタイズ済み
 * @property {string} bodyText
 * @property {number} score
 * @property {number} depth
 * @property {boolean} isSubmitter
 * @property {boolean} stickied
 * @property {string|null} distinguished
 * @property {boolean} edited
 * @property {string} permalink
 */

/**
 * @typedef {Object} Discussion
 * @property {string} schema
 * @property {string} platform
 * @property {string} id
 * @property {string} fullId
 * @property {number} fetchedAt
 * @property {{id:string,name:string}} board   板／カテゴリ（reddit なら subreddit）
 * @property {string} permalink
 * @property {string} title
 * @property {string|null} author
 * @property {number} createdUtc
 * @property {{score:number, commentCount:number, upvoteRatio:number|null}} metrics
 * @property {{url:string, domain:string, isSelf:boolean}|null} link
 * @property {string} bodyHtml
 * @property {string} bodyText
 * @property {string} flair
 * @property {boolean} stickied
 * @property {DiscussionComment[]} comments   取得順のまま。並べ替えは変換側の仕事
 * @property {{count:number}} truncated       取得しきれなかったコメント数
 */

/**
 * expandThread() の戻り値（または collectTree の結果）から Discussion を組む。
 * @param {{post:any, comments:any[], hiddenCount?:number}} parts
 * @param {{fetchedAt?:number}} [options]
 * @returns {Discussion}
 */
export function toDiscussion(parts, options = {}) {
  const { post, comments, hiddenCount = 0 } = parts;
  const fetchedAt = options.fetchedAt ?? Math.floor(Date.now() / 1000);

  return {
    schema: DISCUSSION_SCHEMA,
    platform: 'reddit',
    id: post.id,
    fullId: post.name,
    fetchedAt,
    board: { id: post.subreddit ?? '', name: post.subreddit ? `r/${post.subreddit}` : '' },
    permalink: post.permalink ?? '',
    title: post.title ?? '',
    author: normalizeAuthor(post.author),
    createdUtc: post.created_utc,
    metrics: {
      score: post.score ?? 0,
      commentCount: post.num_comments ?? comments.length,
      upvoteRatio: typeof post.upvote_ratio === 'number' ? post.upvote_ratio : null,
    },
    link:
      post.url && post.is_self !== true
        ? { url: post.url, domain: post.domain ?? '', isSelf: false }
        : null,
    bodyHtml: post.selftext_html ? sanitizeHtml(normalizeBodyHtml(post.selftext_html)) : '',
    bodyText: post.selftext ?? '',
    flair: post.link_flair_text ?? '',
    stickied: post.stickied === true,
    media: extractMedia(post),
    thumbnail: /^https?:/.test(post.thumbnail ?? '') ? cleanUrl(post.thumbnail) : null,
    comments: comments.map((c) => toDiscussionComment(c, post)),
    truncated: { count: hiddenCount },
  };
}

/**
 * 画像・動画を取り出す。Reddit は同じ画像を何通りもの形で持っているので、
 * 出どころ（source）を添えて全部拾い、どれを使うかは表示側で決める。
 */
export function extractMedia(data) {
  const out = [];
  const push = (m) => {
    if (m?.url && !out.some((x) => x.url === m.url)) out.push(m);
  };

  // ギャラリー投稿（複数画像）
  if (data.media_metadata) {
    const ids = data.gallery_data?.items?.map((i) => i.media_id) ?? Object.keys(data.media_metadata);
    for (const id of ids) {
      const meta = data.media_metadata[id];
      if (!meta || (meta.status && meta.status !== 'valid')) continue;
      const best = meta.s ?? meta.p?.[meta.p.length - 1];
      if (!best) continue;
      push({
        kind: meta.e === 'AnimatedImage' ? 'gif' : 'image',
        id,
        url: cleanUrl(best.u ?? best.gif ?? best.mp4),
        width: best.x ?? null,
        height: best.y ?? null,
        mime: meta.m ?? null,
        source: 'gallery',
      });
    }
  }

  // 直リンク投稿
  const direct = data.url_overridden_by_dest ?? data.url;
  if (direct && (data.post_hint === 'image' || /\.(jpe?g|png|gifv?|webp)(\?|$)/i.test(direct))) {
    push({ kind: /\.gifv?(\?|$)/i.test(direct) ? 'gif' : 'image', url: cleanUrl(direct), source: 'direct' });
  }

  // プレビュー（外部リンクのサムネにもなる）
  for (const img of data.preview?.images ?? []) {
    if (img.source?.url) {
      push({
        kind: 'image',
        url: cleanUrl(img.source.url),
        width: img.source.width ?? null,
        height: img.source.height ?? null,
        source: 'preview',
      });
    }
  }

  const video = data.media?.reddit_video ?? data.secure_media?.reddit_video ?? data.preview?.reddit_video_preview;
  if (video?.fallback_url) {
    push({
      kind: 'video',
      url: cleanUrl(video.fallback_url),
      width: video.width ?? null,
      height: video.height ?? null,
      source: 'reddit_video',
    });
  }

  return out;
}

/** Reddit の JSON は URL を HTML エスケープして返すことがある。 */
function cleanUrl(u) {
  return String(u).replace(/&amp;/g, '&');
}

/** `/r/x/comments/yyy.json` のレスポンスから直接。more は展開しない。 */
export function discussionFromJson(json, options = {}) {
  const post = extractPost(json);
  const acc = collectTree(json?.[1]?.data?.children ?? []);
  return toDiscussion({ post, comments: acc.comments, hiddenCount: countHidden(acc.mores) }, options);
}

function toDiscussionComment(c, post) {
  return {
    id: c.id,
    fullId: c.name,
    // 親をスレ本体ではなく null で表す。「トップレベル」を中立に表現するため。
    parentId: !c.parent_id || c.parent_id === post.name ? null : String(c.parent_id).replace(/^t\d_/, ''),
    author: normalizeAuthor(c.author),
    createdUtc: c.created_utc,
    bodyHtml: sanitizeHtml(normalizeBodyHtml(c.body_html)),
    bodyText: c.body ?? '',
    score: typeof c.score === 'number' ? c.score : 0,
    media: extractMedia(c),
    depth: c.__depth ?? c.depth ?? 0,
    isSubmitter: c.is_submitter === true,
    stickied: c.stickied === true,
    distinguished: c.distinguished ?? null,
    edited: Boolean(c.edited),
    permalink: c.permalink ?? '',
  };
}

function normalizeAuthor(author) {
  return !author || author === '[deleted]' ? null : String(author);
}

/**
 * 翻訳を当てた Discussion を返す（元は変更しない）。
 * 訳が無い部分は原文のまま残すので、部分翻訳でも表示が崩れない。
 * @param {Discussion} discussion
 * @param {{locale:string, title?:string, body?:string, comments?:Record<string,string>}} translation
 */
export function applyTranslation(discussion, translation) {
  if (!translation) return discussion;
  const comments = translation.comments ?? {};
  return {
    ...discussion,
    locale: translation.locale,
    translated: { locale: translation.locale, model: translation.model, at: translation.translatedAt },
    title: translation.title || discussion.title,
    titleOriginal: discussion.title,
    bodyHtml: translation.body ? textToHtml(translation.body) : discussion.bodyHtml,
    comments: discussion.comments.map((c) =>
      comments[c.id] ? { ...c, bodyHtml: textToHtml(comments[c.id]), bodyOriginal: c.bodyText } : c
    ),
  };
}

/** 素のテキストを段落 HTML に。翻訳結果はプレーンテキストで返ってくる。 */
export function textToHtml(text) {
  return String(text)
    .split(/\n{2,}/)
    .map((p) => `<p>${escapeText(p).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

function escapeText(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** 保存済み Discussion の健全性チェック（スキーマ移行の足がかり）。 */
export function isDiscussion(v) {
  return Boolean(v && typeof v === 'object' && String(v.schema ?? '').startsWith('discussion/'));
}

/** 古いスキーマで保存されているか。raw から作り直せば最新になる。 */
export function isStale(v) {
  return isDiscussion(v) && v.schema !== DISCUSSION_SCHEMA;
}
