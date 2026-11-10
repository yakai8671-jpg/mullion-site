// 依存なしのハッシュ／ID 生成。ブラウザでも Node でも同じ結果になること。

/** FNV-1a 32bit */
export function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

const JST_DATE = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Tokyo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** JST の YYYY-MM-DD。5ch の ID は「板 × 日 × 人」で変わるのでその日付キー。 */
export function jstDayKey(unixSec) {
  return JST_DATE.format(new Date(unixSec * 1000));
}

const ID_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/**
 * 5ch 風の 8 桁 ID。同じ人・同じ日・同じスレなら同じ ID になる。
 * @param {string} author
 * @param {number} unixSec
 * @param {string} salt スレ ID など。板単位にしたければ subreddit を渡す。
 */
export function makeUid(author, unixSec, salt = '') {
  if (!author || author === '[deleted]') return '???';
  const day = jstDayKey(unixSec);
  let a = fnv1a(`${salt}|${day}|${author}`);
  let b = fnv1a(`${author}|${day}|${salt}`);
  let s = '';
  for (let i = 0; i < 4; i++) {
    s += ID_CHARS[a & 63];
    a >>>= 6;
  }
  for (let i = 0; i < 4; i++) {
    s += ID_CHARS[b & 63];
    b >>>= 6;
  }
  return s;
}
