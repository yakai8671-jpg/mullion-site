// Reddit の JSON からの取り出しだけを担当する層。
// ここだけが Reddit のフィールド名を知っていて、上の層は Discussion しか見ない。

/** `/r/{sub}/comments/{id}.json` のレスポンスから投稿本体を取り出す。 */
export function extractPost(json) {
  const post = json?.[0]?.data?.children?.[0]?.data;
  if (!post) throw new Error('スレッド本文が取得できませんでした');
  return post;
}

/**
 * ネストしたコメントツリーを再帰的に平らな配列にする。more は別途集める。
 * @returns {{comments: any[], mores: {parentId:string, children:string[], count:number, depth:number}[]}}
 */
export function collectTree(children, depth = 0, acc = { comments: [], mores: [] }) {
  for (const child of children) {
    if (child.kind === 't1') {
      const d = child.data;
      d.__depth = depth;
      acc.comments.push(d);
      const replies = d.replies;
      if (replies && replies.data && Array.isArray(replies.data.children)) {
        collectTree(replies.data.children, depth + 1, acc);
      }
    } else if (child.kind === 'more') {
      acc.mores.push(normalizeMore(child.data, depth));
    }
  }
  return acc;
}

export function normalizeMore(data, depth = 0) {
  return {
    parentId: data?.parent_id ?? '',
    children: Array.isArray(data?.children) ? data.children : [],
    count: data?.count ?? 0,
    depth: data?.depth ?? depth,
  };
}

/** 未展開の more の総数。 */
export function countHidden(mores) {
  return mores.reduce((n, m) => n + (m.count || m.children.length), 0);
}
