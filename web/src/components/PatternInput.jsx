import React, { useMemo } from 'react';

// 正则输入框 + 语法错误定位标记：
//   abc(
//         ^ 括号未闭合……
export default function PatternInput({ value, onChange, error }) {
  const ruler = useMemo(() => {
    if (!error) return null;
    const idx = Math.max(0, error.index ?? 0);
    const len = Math.max(1, Math.min(error.length || 1, value.length - idx + 1));
    const before = value.slice(0, idx).replace(/./g, ' ');
    const carets = '^'.repeat(len);
    return { before, carets };
  }, [error, value]);

  return (
    <div className="pattern-wrap">
      <input
        className={`pattern-input ${error ? 'error' : ''}`}
        value={value}
        spellCheck={false}
        autoComplete="off"
        placeholder="在此输入正则，如 [a-z]+\d+"
        onChange={(e) => onChange(e.target.value)}
      />
      {error && (
        <>
          <div className="error-ruler">
            <span className="src">{value || ' '}</span>{'\n'}
            <span>{ruler.before}</span>
            <span className="mark">{ruler.carets}</span>
          </div>
          <div className="error-msg">⚠ {error.message}</div>
        </>
      )}
    </div>
  );
}
