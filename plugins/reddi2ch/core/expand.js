// more（「さらに N 件の返信を表示」）を自動展開する。
// ネットワークが要るので fetch は注入してもらう。core 自体は fetch を知らないままにする。

import { extractPost, collectTree, normalizeMore } from './reddit.js';

/** Reddit の morechildren は 1 リクエストあたり 100 件までしか受け付けない。 */
const MORE_BATCH = 100;

export const DEFAULT_EXPAND_OPTIONS = {
  sort: 'confidence',
  /** 安全弁。100 req/min の制限に対して余裕を見た回数で打ち切る。 */
  maxRequests: 40,
  /** 進捗コールバック ({ loaded, pending, requests }) => void */
  onProgress: null,
};

/**
 * @param {any[]} json  `/r/x/comments/yyy.json` のレスポンス
 * @param {(path:string, params:object) => Promise<any>} fetchJson
 *        パスに `.json` を付けて取得する関数。アプリ側（拡張 / クローラ）が用意する。
 * @param {Partial<typeof DEFAULT_EXPAND_OPTIONS>} [options]
 * @returns {Promise<{post:any, comments:any[], hiddenCount:number, truncated:boolean, requests:number}>}
 */
export async function expandThread(json, fetchJson, options = {}) {
  const opts = { ...DEFAULT_EXPAND_OPTIONS, ...options };
  const post = extractPost(json);
  const acc = collectTree(json?.[1]?.data?.children ?? []);

  const comments = acc.comments;
  const seen = new Set(comments.map((c) => c.id));
  const queue = acc.mores.slice();
  const failed = [];
  let requests = 0;

  while (queue.length && requests < opts.maxRequests) {
    const more = queue.shift();
    requests++;
    try {
      if (more.children.length) {
        // 通常の more。子 ID が分かっているので morechildren でまとめて取れる。
        const batch = more.children.slice(0, MORE_BATCH);
        if (more.children.length > MORE_BATCH) {
          queue.push({ ...more, children: more.children.slice(MORE_BATCH) });
        }
        const res = await fetchJson('/api/morechildren', {
          api_type: 'json',
          link_id: post.name,
          children: batch.join(','),
          sort: opts.sort,
          limit_children: false,
          raw_json: 1,
        });
        for (const thing of res?.json?.data?.things ?? []) {
          if (thing.kind === 't1') {
            addComment(thing.data, seen, comments);
          } else if (thing.kind === 'more') {
            queue.push(normalizeMore(thing.data, more.depth));
          }
        }
      } else {
        // 「続きを読む」型の more。子 ID が無いので、その位置のスレを取り直す。
        const sub = await fetchJson(`${post.permalink}${stripPrefix(more.parentId)}`, {
          raw_json: 1,
          limit: 500,
          sort: opts.sort,
        });
        const part = collectTree(sub?.[1]?.data?.children ?? [], more.depth);
        for (const c of part.comments) addComment(c, seen, comments);
        queue.push(...part.mores);
      }
    } catch (e) {
      failed.push(more);
    }
    opts.onProgress?.({ loaded: comments.length, pending: queue.length, requests });
  }

  const hiddenCount = [...queue, ...failed].reduce((n, m) => n + (m.count || m.children.length), 0);
  return { post, comments, hiddenCount, truncated: queue.length > 0, requests };
}

function addComment(data, seen, out) {
  if (!data || seen.has(data.id)) return;
  seen.add(data.id);
  data.__depth = data.depth ?? data.__depth ?? 0;
  out.push(data);
  // morechildren は基本フラットで返すが、稀に replies が入るので念のため辿る。
  const replies = data.replies;
  if (replies && replies.data && Array.isArray(replies.data.children)) {
    for (const child of replies.data.children) {
      if (child.kind === 't1') addComment(child.data, seen, out);
    }
  }
}

function stripPrefix(fullname) {
  return String(fullname).replace(/^t\d_/, '');
}
