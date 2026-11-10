// 日付整形と、Reddit の body_html を安全に扱うためのユーティリティ。
// DOM に依存しないこと（プロジェクト2の Node 側でも同じものを使う）。

import { fnv1a } from './hash.js';

const WEEKDAY_JA = { Sun: '日', Mon: '月', Tue: '火', Wed: '水', Thu: '木', Fri: '金', Sat: '土' };

const JST_FULL = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Tokyo',
  weekday: 'short',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

/**
 * 「2026/08/16(土) 13:48:22.51」形式。
 * Reddit の created_utc は秒までしか無いので、1/100 秒はハッシュで安定生成する。
 */
export function format5chDate(unixSec, seed = '') {
  const parts = JST_FULL.formatToParts(new Date(unixSec * 1000));
  const get = (type) => parts.find((p) => p.type === type)?.value ?? '';
  const wd = WEEKDAY_JA[get('weekday')] ?? '';
  const cs = String(fnv1a(`${seed}|${unixSec}`) % 100).padStart(2, '0');
  return `${get('year')}/${get('month')}/${get('day')}(${wd}) ${get('hour')}:${get('minute')}:${get('second')}.${cs}`;
}

const NAMED_ENTITIES = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

/** &lt; などの実体参照を戻す。DOM を使わないので Node でも動く。 */
export function decodeEntities(str) {
  return str.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (m, ref) => {
    if (ref[0] === '#') {
      const code = ref[1] === 'x' || ref[1] === 'X' ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    const v = NAMED_ENTITIES[ref.toLowerCase()];
    return v === undefined ? m : v;
  });
}

/**
 * body_html は raw_json=1 を付けても環境によってエスケープ済みで来ることがある。
 * `&lt;div` で始まっていたら 1 回だけデコードする。
 */
export function normalizeBodyHtml(html) {
  if (!html) return '';
  const s = String(html);
  return /^\s*&lt;/.test(s) ? decodeEntities(s) : s;
}

/**
 * Reddit 由来の HTML を挿入する前の最低限のサニタイズ。
 * Reddit 側でも sanitize されているが、拡張の権限で描画する以上こちらでも落とす。
 */
export function sanitizeHtml(html) {
  return String(html)
    .replace(/<\s*(script|style|iframe|object|embed|link|meta)\b[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
    .replace(/<\s*(script|style|iframe|object|embed|link|meta)\b[^>]*>/gi, '')
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, '')
    .replace(/\son\w+\s*=\s*'[^']*'/gi, '')
    .replace(/\son\w+\s*=\s*[^\s>]+/gi, '')
    .replace(/javascript:/gi, '');
}

/** テキストを HTML に埋め込むためのエスケープ。 */
export function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** 1000 以上を 1.2k 表記に。スレ一覧のレス数などに使う。 */
export function shortNum(n) {
  if (!Number.isFinite(n)) return '0';
  if (Math.abs(n) < 1000) return String(n);
  return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`;
}
