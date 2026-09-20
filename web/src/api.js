// 后端 API 封装。前端只负责展示，所有构造/匹配结果均来自后端，保证两侧结论一致。
async function post(path, body) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export const api = {
  parse: (pattern) => post('/api/parse', { pattern }),
  compile: (pattern, dfaLimit = 256) => post('/api/compile', { pattern, dfaLimit }),
  match: (pattern, input, opts = {}) =>
    post('/api/match', { pattern, input, cap: opts.cap, dfaLimit: opts.dfaLimit }),
  examples: async () => (await fetch('/api/examples')).json(),
};
