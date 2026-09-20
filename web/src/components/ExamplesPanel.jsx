import React, { useEffect, useState } from 'react';
import { api } from '../api.js';

// 内置教学案例列表 + 选中案例的分步讲解。
export default function ExamplesPanel({ onSelect }) {
  const [examples, setExamples] = useState([]);
  const [activeId, setActiveId] = useState(null);

  useEffect(() => {
    api.examples().then((r) => setExamples(r.examples || []));
  }, []);

  const active = examples.find((e) => e.id === activeId);

  return (
    <div className="section">
      <h2>教学案例</h2>
      <div className="examples-list">
        {examples.map((ex) => (
          <div
            key={ex.id}
            className="example-item"
            onClick={() => {
              setActiveId(ex.id);
              onSelect?.(ex);
            }}
          >
            <div className="name">{ex.name}</div>
            <div className="pat">{ex.pattern}</div>
          </div>
        ))}
      </div>
      {active && (
        <div className="lesson" style={{ marginTop: 10 }}>
          <div style={{ color: 'var(--text)', fontWeight: 600, marginBottom: 4 }}>{active.name} · 分步讲解</div>
          <div>{active.intro}</div>
          <div style={{ marginTop: 8 }}>
            {active.parts.map((p, i) => (
              <div className="part" key={i}>
                <code>{p.expr}</code> — {p.meaning}
              </div>
            ))}
          </div>
          <div className="watch">🔍 观察点：{active.watch}</div>
          <button className="btn primary" style={{ marginTop: 8 }} onClick={() => onSelect?.(active)}>
            载入正则 “{active.pattern}” 与测试串
          </button>
        </div>
      )}
    </div>
  );
}
