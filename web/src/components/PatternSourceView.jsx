import React from 'react';

// 正则源码视图：根据 AST 悬停区间 [s,e) 高亮对应片段。
export default function PatternSourceView({ source, hoverRange }) {
  if (!source) return <div className="muted">（空正则）</div>;
  const chars = Array.from(source);
  return (
    <div className="input-view" style={{ lineHeight: 1.8 }}>
      {chars.map((ch, i) => {
        const on = hoverRange && i >= hoverRange.s && i < hoverRange.e;
        return (
          <span
            key={i}
            style={
              on
                ? { background: 'rgba(91,157,255,0.35)', borderRadius: 3, padding: '0 1px' }
                : undefined
            }
          >
            {ch}
          </span>
        );
      })}
    </div>
  );
}
