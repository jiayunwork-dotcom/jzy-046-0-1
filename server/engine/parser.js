// 正则语法分析：词法 + 递归下降语法分析，产出带源码区间（s/e，按字符计偏移）的 AST。
//
// 支持子集：
//   字面字符 | . | 字符类 [a-z] [^0-9] | \d \w \s（及大写取反）\D \W \S
//   量词 * + ? {n} {n,} {n,m}，可后缀 ? 变为懒惰
//   捕获组 (...) 与非捕获组 (?:...) | 选择分支 | 锚点 ^ $
//
// AST 节点：
//   {type:'empty', s, e}
//   {type:'char', code, s, e}
//   {type:'class', negated, ranges:[[lo,hi]...], shorthand:['d'...], s, e}
//   {type:'dot', s, e}
//   {type:'anchor', kind:'start'|'end', s, e}
//   {type:'concat', items:[node...], s, e}
//   {type:'alt', options:[node...], s, e}
//   {type:'repeat', atom, min, max|null, lazy, s, e}   s/e 覆盖整个量词
//   {type:'group', capturing, index|null, child, s, e}

import {
  PERL,
  DOT_SET,
  union,
  mergeRanges,
  singleton,
  empty,
  negate as negateSet,
} from './charsets.js';

const MAX_REPEAT = 100; // {n,m} 的上限，避免 {1000000} 把构造器撑爆

class ParseError extends Error {
  constructor(message, index, length = 1) {
    super(message);
    this.name = 'ParseError';
    this.index = index; // 出错位置（字符偏移）
    this.length = length; // 出错片段长度，供前端画定位标记
  }
}

export { ParseError };

export function parse(source) {
  const p = new Parser(source);
  const node = p.parseAlternation();
  if (!p.atEnd()) {
    const ch = p.peek();
    if (ch === ')') throw new ParseError('未匹配的右括号 “)”：没有对应的 “(”', p.pos);
    throw new ParseError(`无法解析的字符 “${ch}”`, p.pos);
  }
  node.groups = p.groups; // 捕获组登记表：[{index, name, s, e}]
  return node;
}

class Parser {
  constructor(src) {
    this.src = src;
    this.chars = Array.from(src); // 按 Unicode 码点切分，位置与字符一一对应
    this.pos = 0;
    this.groups = [];
  }

  atEnd() {
    return this.pos >= this.chars.length;
  }

  peek(offset = 0) {
    return this.chars[this.pos + offset];
  }

  // —— 选择分支： concat ('|' concat)* ——
  parseAlternation() {
    const s = this.pos;
    const options = [this.parseConcat()];
    while (this.peek() === '|') {
      this.pos += 1;
      options.push(this.parseConcat());
    }
    if (options.length === 1) return options[0];
    return { type: 'alt', options, s, e: this.pos };
  }

  // —— 串联（空串联合法，如 a| 中的空分支）——
  parseConcat() {
    const s = this.pos;
    const items = [];
    for (;;) {
      const ch = this.peek();
      if (ch === undefined || ch === '|' || ch === ')') break;
      items.push(this.parseQuantified());
    }
    if (items.length === 0) return { type: 'empty', s, e: this.pos };
    if (items.length === 1) return items[0];
    return { type: 'concat', items, s, e: this.pos };
  }

  // —— 量词后缀 ——
  parseQuantified() {
    const atom = this.parseAtom();
    const ch = this.peek();
    if (ch !== '*' && ch !== '+' && ch !== '?' && ch !== '{') return atom;
    if (ch === '{') {
      // 预读：仅 {n} / {n,} / {n,m} 才是量词，其余裸 { 留给 atom 当字面字符
      const rest = this.chars.slice(this.pos + 1).join('');
      if (!/^\d+(?:,\d*)?}/.test(rest)) return atom;
    }

    const qs = this.pos;
    let min;
    let max;

    if (ch === '*' || ch === '+' || ch === '?') {
      if (ch === '*') {
        min = 0;
        max = null;
      } else if (ch === '+') {
        min = 1;
        max = null;
      } else {
        min = 0;
        max = 1;
      }
      this.pos += 1;
    } else {
      ({ min, max } = this.parseBraceQuantifier()); // 预读已保证形状，{3,2} 等在这里抛错
    }

    let lazy = false;
    if (this.peek() === '?') {
      lazy = true;
      this.pos += 1;
    }
    return { type: 'repeat', atom, min, max, lazy, s: atom.s, e: this.pos, qs };
  }

  // 消费从 '{' 开始的内容；裸 { （不构成量词）由 parseAtom 当字面字符处理，
  // 形如 {1?、{3,2} 等构成量词但非法的形式在这里抛 ParseError
  parseBraceQuantifier() {
    const bracePos = this.pos;
    this.pos += 1; // 跳过 {
    const digits1 = this.consumeDigits();
    let min;
    let max;
    min = Number(digits1);
    if (this.peek() === '}') {
      this.pos += 1;
      max = min;
    } else if (this.peek() === ',') {
      this.pos += 1;
      const digits2 = this.consumeDigits();
      if (this.peek() !== '}') {
        throw new ParseError('量词格式错误：应为 “{n}” 或 “{n,m}”，缺少闭合的 “}”', bracePos, Math.max(1, this.pos - bracePos));
      }
      this.pos += 1;
      if (digits2 === null) {
        max = null; // {n,}
      } else {
        max = Number(digits2);
        if (max < min) {
          throw new ParseError(
            `量词范围非法：{${min},${max}} 中下限大于上限（不能返回去重复更少次）`,
            bracePos,
            this.pos - bracePos,
          );
        }
      }
    } else {
      throw new ParseError('量词格式错误：“{” 后应为数字，如 {3} 或 {1,3}', bracePos, Math.max(1, this.pos - bracePos + 1));
    }
    if (min > MAX_REPEAT || (max !== null && max > MAX_REPEAT)) {
      throw new ParseError(`量词重复次数超过上限 ${MAX_REPEAT}，请减小 {n,m} 的范围`, bracePos, this.pos - bracePos);
    }
    return { min, max, valid: true };
  }

  consumeDigits() {
    let s = '';
    while (this.peek() !== undefined && this.peek() >= '0' && this.peek() <= '9') {
      s += this.peek();
      this.pos += 1;
    }
    return s === '' ? null : s;
  }

  // —— 原子 ——
  parseAtom() {
    const ch = this.peek();
    if (ch === undefined) throw new ParseError('正则意外结束：这里还需要一个表达式', this.pos, 0);

    if (ch === '(') return this.parseGroup();
    if (ch === '[') return this.parseClass();
    if (ch === '^') {
      const s = this.pos;
      this.pos += 1;
      return { type: 'anchor', kind: 'start', s, e: this.pos };
    }
    if (ch === '$') {
      const s = this.pos;
      this.pos += 1;
      return { type: 'anchor', kind: 'end', s, e: this.pos };
    }
    if (ch === '.') {
      const s = this.pos;
      this.pos += 1;
      return { type: 'dot', set: DOT_SET, s, e: this.pos };
    }
    if (ch === '\\') return this.parseEscape();
    if (ch === '*' || ch === '+' || ch === '?') {
      throw new ParseError(`量词 “${ch}” 前缺少可重复的项`, this.pos);
    }
    if (ch === '}') {
      // 裸 } 不当量词成分时按字面字符处理（宽松语义）
      const s = this.pos;
      this.pos += 1;
      return { type: 'char', code: 125, s, e: this.pos };
    }
    if (ch === '|' || ch === ')') {
      throw new ParseError(`意外的 “${ch}”：这里应当是一个表达式`, this.pos);
    }
    // 普通字面字符
    const s = this.pos;
    const code = this.chars[s].codePointAt(0);
    this.pos += 1;
    return { type: 'char', code, s, e: this.pos };
  }

  parseGroup() {
    const s = this.pos;
    this.pos += 1; // (
    let capturing = true;
    let index = null;
    if (this.peek() === '?') {
      const c1 = this.peek(1);
      if (c1 === ':') {
        capturing = false;
        this.pos += 2;
      } else if (c1 === '=') {
        throw new ParseError('本教学子集不支持前瞻断言 (?=…)，请使用普通分组 (?:…)', s, 2);
      } else if (c1 === '!') {
        throw new ParseError('本教学子集不支持负向前瞻断言 (?!…)，请使用普通分组 (?:…)', s, 2);
      } else if (c1 === '<') {
        throw new ParseError('本教学子集不支持命名分组 / 后行断言 (?<…)，请使用 (…) 或 (?:…)', s, 2);
      } else {
        throw new ParseError('无法识别的分组语法 “?' + (c1 ?? '') + '”，支持 (…) 捕获组与 (?:…) 非捕获组', s, 2);
      }
    }
    if (capturing) {
      index = this.groups.length + 1;
      this.groups.push({ index, s });
    }
    const child = this.parseAlternation();
    if (this.peek() !== ')') {
      throw new ParseError('括号未闭合：缺少对应的 “)”', s, 1);
    }
    this.pos += 1;
    if (capturing) this.groups[index - 1].e = this.pos;
    return { type: 'group', capturing, index, child, s, e: this.pos };
  }

  parseClass() {
    const s = this.pos;
    this.pos += 1; // [
    let negated = false;
    if (this.peek() === '^') {
      negated = true;
      this.pos += 1;
    }
    const parts = []; // 区间并集
    let first = true;
    for (;;) {
      const ch = this.peek();
      if (ch === undefined) {
        throw new ParseError('字符类未闭合：缺少对应的 “]”', s, Math.max(1, this.pos - s));
      }
      if (ch === ']' && !first) {
        this.pos += 1;
        break;
      }
      first = false;
      const value = this.parseClassAtom(); // 返回 {set} 或 {shorthand}
      if (value.shorthand) parts.push({ shorthand: value.shorthand, set: PERL[value.shorthand] });
      else parts.push({ set: value.set });
      // 区间 a-z
      if (this.peek() === '-' && this.peek(1) !== undefined && this.peek(1) !== ']') {
        this.pos += 1; // -
        if (this.peek() === '\\') {
          // 允许 \w-z 这种？标准语义不允许简写类做区间端点
        }
        const rhs = this.parseClassAtom();
        if (rhs.shorthand || value.shorthand) {
          throw new ParseError('字符区间的端点必须是单个字符，不能使用 \\d 这类简写', s, this.pos - s);
        }
        const loCp = value.set[0][0];
        const hiCp = rhs.set[0][0];
        if (loCp > hiCp) {
          throw new ParseError(
            `字符区间顺序颠倒：${String.fromCodePoint(loCp)}-${String.fromCodePoint(hiCp)}`,
            s,
            this.pos - s,
          );
        }
        parts[parts.length - 1] = { set: mergeRanges([[loCp, hiCp]]) };
      }
    }
    let set = empty();
    const shorthandList = [];
    for (const part of parts) {
      set = union(set, part.set);
      if (part.shorthand) shorthandList.push(part.shorthand);
    }
    if (negated) set = negateSet(set);
    return { type: 'class', negated, set, shorthand: shorthandList, s, e: this.pos };
  }

  parseClassAtom() {
    const ch = this.peek();
    if (ch === '\\') {
      const esc = this.parseEscape({ inClass: true });
      if (esc.type === 'shorthand') return { shorthand: esc.letter };
      return { set: singleton(esc.code) };
    }
    if (ch === '^' && this.pos === 0) {
      // 不会走到这里
    }
    this.pos += 1;
    return { set: singleton(ch.codePointAt(0)) };
  }

  // 解析反斜杠转义。inClass 下 \b 视为退格（此处简化：类外 \b 不在支持子集，直接报错提示）
  parseEscape({ inClass = false } = {}) {
    const s = this.pos;
    this.pos += 1; // \
    const ch = this.peek();
    if (ch === undefined) {
      throw new ParseError('转义未完成：“\\” 后缺少字符', s, 1);
    }
    if ('dDwWsS'.includes(ch)) {
      this.pos += 1;
      if (inClass) return { type: 'shorthand', letter: ch, s, e: this.pos };
      return { type: 'class', negated: ch === ch.toUpperCase() && ch !== ch.toLowerCase(), set: PERL[ch], shorthand: [ch], s, e: this.pos };
    }
    if (ch === 'n' || ch === 'r' || ch === 't' || ch === 'f' || ch === 'v' || ch === '0') {
      const map = { n: 10, r: 13, t: 9, f: 12, v: 11, 0: 0 };
      this.pos += 1;
      return { type: 'char', code: map[ch], s, e: this.pos };
    }
    if (ch === 'x' || ch === 'u') {
      const base = this.pos + 1;
      const n = ch === 'x' ? 2 : 4;
      const hex = this.chars.slice(base, base + n).join('');
      if (!/^[0-9a-fA-F]+$/.test(hex) || hex.length < n) {
        throw new ParseError(`无效的 ${ch === 'x' ? '\\xHH' : '\\uHHHH'} 十六进制转义`, s, Math.max(2, this.pos - s + 1));
      }
      this.pos += 1 + n;
      return { type: 'char', code: parseInt(hex, 16), s, e: this.pos };
    }
    if (ch === 'b' || ch === 'B') {
      throw new ParseError('本教学子集不支持单词边界 \\b（可改用 ^、$ 或具体字符）', s, 2);
    }
    // 其余一律视为转义后的字面字符（\\ \( \) \[ \] \. \* ...）
    this.pos += 1;
    return { type: 'char', code: ch.codePointAt(0), s, e: this.pos };
  }
}
