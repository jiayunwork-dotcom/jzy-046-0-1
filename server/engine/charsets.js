// 字符集工具：内部一律用「互不相交、按起点排序的码点区间」表示。
// 区间为闭区间 [lo, hi]，元素是 Unicode 码点（JS string 默认按 UTF-16，
// 本项目只处理 BMP，\uXXXX 足够；区间集合本身可表达任意码点）。

export const MAX_CODEPOINT = 0x10ffff;

/** [a,b,c,d] -> [[a,b],[c,d]] 并做排序、合并重叠区间 */
export function mergeRanges(pairs) {
  const iv = pairs
    .map(([lo, hi]) => (lo <= hi ? [lo, hi] : [hi, lo]))
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const out = [];
  for (const [lo, hi] of iv) {
    if (out.length && lo <= out[out.length - 1][1] + 1) {
      if (hi > out[out.length - 1][1]) out[out.length - 1][1] = hi;
    } else {
      out.push([lo, hi]);
    }
  }
  return out;
}

export function union(a, b) {
  return mergeRanges([...a, ...b]);
}

export function intersect(a, b) {
  const out = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const lo = Math.max(a[i][0], b[j][0]);
    const hi = Math.min(a[i][1], b[j][1]);
    if (lo <= hi) out.push([lo, hi]);
    if (a[i][1] < b[j][1]) i += 1;
    else j += 1;
  }
  return mergeRanges(out);
}

/** a - b */
export function subtract(a, b) {
  if (b.length === 0) return a.map((r) => [...r]);
  const out = [];
  let j = 0;
  for (const [lo, hi] of a) {
    let cur = lo;
    while (j < b.length && b[j][1] < lo) j += 1;
    let k = j;
    while (k < b.length && b[k][0] <= hi) {
      const [blo, bhi] = b[k];
      if (blo > cur) out.push([cur, Math.min(blo - 1, hi)]);
      if (bhi + 1 > cur) cur = bhi + 1;
      if (cur > hi) break;
      k += 1;
    }
    if (cur <= hi) out.push([cur, hi]);
  }
  return mergeRanges(out);
}

export function negate(a) {
  return subtract([[0, MAX_CODEPOINT]], a);
}

export function contains(a, cp) {
  let lo = 0;
  let hi = a.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (cp < a[mid][0]) hi = mid - 1;
    else if (cp > a[mid][1]) lo = mid + 1;
    else return true;
  }
  return false;
}

export const empty = () => [];
export const singleton = (cp) => [[cp, cp]];

// —— 预定义类（采用 ASCII 语义，与教学语境一致）——
function range(lo, hi) {
  return [[lo, hi]];
}

export const PERL = {
  d: union(range(48, 57), []), // 0-9
  w: union(union(range(48, 57), range(65, 90)), union(range(97, 122), [[95, 95]])), // [0-9A-Za-z_]
  s: [
    [9, 13], // \t \n \v \f \r
    [32, 32], // 空格
  ],
};
PERL.D = negate(PERL.d);
PERL.W = negate(PERL.w);
PERL.S = negate(PERL.s);

/** . 的语义：除 \n \r 外任意字符 */
export const DOT_SET = negate([
  [10, 10],
  [13, 13],
]);

/** 把区间集合转成人类可读的标签，如 a-z、\d、\x41 */
export function describeRanges(ranges) {
  if (ranges.length === 0) return '∅';
  const names = new Map([
    [JSON.stringify(PERL.d), '\\d'],
    [JSON.stringify(PERL.w), '\\w'],
    [JSON.stringify(PERL.s), '\\s'],
    [JSON.stringify(DOT_SET), '.'],
  ]);
  const key = JSON.stringify(ranges);
  if (names.has(key)) return names.get(key);
  const printable = (cp) =>
    cp >= 0x21 && cp <= 0x7e ? String.fromCodePoint(cp) : null;
  const parts = ranges.map(([lo, hi]) => {
    if (lo === hi) {
      const ch = printable(lo);
      return ch !== null ? ch : `\\x${lo.toString(16).padStart(2, '0')}`;
    }
    if (hi - lo === 25) {
      const loCh = printable(lo);
      const hiCh = printable(hi);
      if (loCh && hiCh) return `${loCh}-${hiCh}`;
    }
    return `\\x${lo.toString(16)}-\\x${hi.toString(16)}`;
  });
  const label = parts.join('');
  return label.length > 14 ? `${label.slice(0, 13)}…` : label;
}
