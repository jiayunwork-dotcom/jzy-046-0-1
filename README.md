# 正则状态机可视化调试器

在浏览器里把一条正则的 **Thompson NFA → 子集构造 DFA → Hopcroft 最小化 → 回溯匹配**全过程像放电影一样逐帧演出来。引擎逻辑全部在 Node.js 后端实现并通过接口下发，前端只负责交互、树形展示、Canvas 渲染与动画，保证两侧结论永远一致。

![tech](https://img.shields.io/badge/node-20-339933) ![react](https://img.shields.io/badge/react-18-61dafb) ![express](https://img.shields.io/badge/express-4-eee)

## 快速开始

```bash
# 安装依赖（锁定 Node.js 20）
npm install

# 生产模式：构建前端并由 Express 一并托管
npm run build
npm start            # 打开 http://localhost:3000

# 开发模式（两个进程）
npm run dev:server   # 后端 http://localhost:3000（--watch 热重启）
npm run dev:web       # 前端 http://localhost:5173（/api 代理到 3000）
```

### Docker

```bash
docker build -t regex-visualizer .
docker run --rm -p 3000:3000 regex-visualizer
# 浏览器打开 http://localhost:3000，无需另起任何进程
```

基础镜像 `node:20-slim`，容器内完成前端构建后 `npm prune --production`，Express 同时托管 API 与 `web/dist`。

## 功能一览

- **实时解析与错误定位**：输入即解析；括号未闭合、`{3,2}` 非法范围、字符类未闭合等错误在出错字符下方给出 `^` 标记和原因。
- **AST 侧栏**：可展开树形结构，悬停任意 AST 节点时正则源码对应片段联动高亮。
- **三步自动机构造动画**（都支持单步 / 一键构造完）：
  1. **Thompson NFA**：状态圆圈、接受态双圈、字符边与 ε 空转移；按规则一条条长出，分层自动布局（起始在左、接受在右、回边画成回弧）。
  2. **子集构造 DFA**：演示每个 NFA 状态集合如何合并成一个 DFA 状态、新状态金色高亮；状态上限默认 256，超出截断并提示。
  3. **Hopcroft 最小化**：逐轮标出被判等价而合并的状态组（紫色虚线圈），面板对比最小化前后状态数。
- **匹配演示（主戏）**：
  - 回溯引擎：当前探索状态高亮，失败回退用**红色虚线**标出，输入串当前消费字符同步高亮。
  - NFA 集合模拟：高亮当前所有可能活跃的状态集合（线性、不回溯）。
  - DFA：高亮唯一当前状态。
  - 播放 / 暂停 / 单步前进 / 单步后退 / 0.5×–4× 倍速。
- **性能分析**：状态转移次数、回溯次数、访问状态总数；转移数呈平方级增长时告警；对 `(a+)+` 等结构识别为指数级灾难性回溯并给改写建议。
- **贪婪 / 懒惰并排对比**：同一正则同一测试串，两条轨迹同步逐帧对照（可强制翻转量词优先级）。
- **教学案例**：邮箱、URL、日期、HTML 标签、灾难性回溯、贪婪 vs 懒惰，每个带分步拆解讲解。

> 语义说明：采用与 JS `regexp.test()` 一致的**搜索语义**——可在输入任意位置命中，`^` / `$` 约束行首 / 行尾。写 `^…$` 即退化为全串匹配。

## 核心正确性判据

> 同一条正则、同一个测试串，**NFA / 子集构造 DFA / 最小化 DFA / 回溯** 四者给出的接受/拒绝结论必须完全一致。

- 后端 `/api/match` 每次都计算四套结果并返回 `consistent` 自洽标志，前端右栏显示自检结果。
- 自动化测试包含 **3900+ 随机正则 × 随机串**的交叉验证，以原生 `RegExp` 为基准（离线已跑通 0 mismatch）。

## 支持的正则子集

| 类别 | 内容 |
| --- | --- |
| 字面量 | 普通字符、`. `、`\n \r \t \f \v \0 \xHH \uHHHH`、转义元字符 |
| 字符类 | `[a-z]` `[^0-9]` `[abc]`，区间与取反；`\d \D \w \W \s \S` |
| 量词 | `* + ? {n} {n,} {n,m}`，后缀 `?` 切换贪婪/懒惰 |
| 分组 | `(...)` 捕获组（自动编号）、`(?:...)` 非捕获组 |
| 选择 | `\|` |
| 锚点 | `^` `$` |

不支持前瞻/后顾/命名分组/`\b`，遇到时会给出明确的错误提示。

## 代码结构

```
server/
  index.js              Express 入口 + API 路由 + 静态托管
  engine/
    charsets.js          码点区间的并/交/补、预定义类
    parser.js            词法 + 递归下降语法分析 -> AST（带源码区间、错误定位）
    nfa.js               Thompson 构造（含搜索语义外壳、构造步骤日志）
    dfa.js               子集构造（区间分区、锚点闭包、状态上限、诞生步骤日志）
    minimize.js          Hopcroft 等价类划分最小化（逐轮日志）
    match.js             三套匹配：DFA / NFA 集合模拟 / 显式 DFS 回溯（逐帧）
    analyze.js           灾难性回溯静态分析 + 运行时增长判定
    layout.js            NFA 分层布局 / DFA 力导向布局
    compile.js           编排 + 前端序列化
    examples.js          内置教学案例
web/
  src/
    App.jsx              主布局与数据流
    api.js               后端接口封装
    player.js            通用帧播放器 hook
    styles.css
    components/          PatternInput / ASTTree / ConstructionViews /
                         MatchView / CompareView / StatsPanel / ExamplesPanel ...
    canvas/
      draw.js            Canvas 图元（圆/双圈/箭头/自环/回退红虚线/高亮）
      NFACanvas.jsx
      DFACanvas.jsx
test/
  parser.test.js         解析与错误定位
  automata.test.js       三种自动机构造 + 四引擎一致性 + 随机交叉验证
  match.test.js          匹配、回溯、贪婪/懒惰、灾难检测
  api.test.js            HTTP 接口契约与静态托管
```

## HTTP 接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/parse` | `{pattern}` → AST 树或带 `index/length/message` 的错误 |
| POST | `/api/compile` | `{pattern, dfaLimit}` → NFA + DFA + 最小化 DFA + 静态分析（含布局坐标、构造步骤） |
| POST | `/api/match` | `{pattern, input, cap}` → 四引擎帧序列、统计、自洽标志、性能分析 |
| GET | `/api/examples` | 教学案例 |

## 测试

```bash
npm test     # node --test test/
```
