import React, { useState } from 'react';

// 可展开的 AST 树；悬停某行时回调 onHover(s,e) 供正则源片段高亮。
function Node({ node, depth, hoverRange, onHover }) {
  const [open, setOpen] = useState(depth < 3);
  const hasKids = node.children && node.children.length > 0;
  const active =
    hoverRange && node.s === hoverRange.s && node.e === hoverRange.e;
  return (
    <div className="ast-node">
      <div
        className={`ast-row ${active ? 'active' : ''}`}
        onMouseEnter={() => onHover?.({ s: node.s, e: node.e })}
        onMouseLeave={() => onHover?.(null)}
      >
        <span
          className="ast-toggle"
          onClick={() => hasKids && setOpen(!open)}
          style={{ visibility: hasKids ? 'visible' : 'hidden' }}
        >
          {hasKids ? (open ? '▾' : '▸') : '·'}
        </span>
        <span className="ast-label">{node.label}</span>
        <span className="ast-kind">{node.type}</span>
      </div>
      {open && hasKids && (
        <div className="ast-children">
          {node.children.map((c, i) => (
            <Node key={i} node={c} depth={depth + 1} hoverRange={hoverRange} onHover={onHover} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function ASTTree({ ast, hoverRange, onHover }) {
  if (!ast) return <div className="muted">解析成功后这里会显示 AST</div>;
  return (
    <div className="ast-tree">
      <Node node={ast.tree} depth={0} hoverRange={hoverRange} onHover={onHover} />
    </div>
  );
}
