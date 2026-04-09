# Context 管理模块依赖图

基于 free-code45 (Claude Code v2.1.87) 源码，分析 `src/context.ts` 的依赖关系。

## 图文件说明

### 手工精选图

**`context-focused.svg`** — 24 个关键节点的精选依赖图

只包含 `context.ts` 的直接依赖和直接消费者，去掉所有传递依赖。适合快速理解 context 模块在系统中的位置。

#### 节点颜色含义

| 颜色 | 含义 | 节点 |
|---|---|---|
| 红色 `#ff9999` | 核心枢纽 | `context.ts` — 上下文构建器 |
| 灰色 | `context.ts` 的依赖 | git.ts, claudemd.ts, envUtils.ts 等 9 个底层模块 |
| 蓝色 `#99ccff` | 消费者（import 了 context.ts） | REPL.tsx, queryContext.ts, runAgent.ts 等 9 个模块 |
| 绿色 `#99ff99` | 组装层 | `queryContext.ts` — 负责将 context 组装为 API 请求前缀 |
| 橙色 `#ffcc99` | 压缩系统 | autoCompact.ts, compact.ts — 通过 `utils/context.ts` 获取窗口大小 |

#### 箭头方向

箭头表示"依赖方向"：`A → B` 表示 A import 了 B。

#### 如何阅读这张图

1. **从红色节点开始**：`context.ts` 是核心，它在会话启动时收集 git 状态和 CLAUDE.md 内容
2. **向右看灰色节点**：这些是 context.ts 完成工作需要的底层工具（git 命令、文件读取等）
3. **向左看蓝色节点**：这些是使用 context 数据的消费者（API 请求、子 agent、UI 等）
4. **绿色是关键桥梁**：`queryContext.ts` 把 context 数据和 system prompt 组装在一起发给 API
5. **橙色是容量管理**：压缩系统通过 `utils/context.ts`（注意不是 `context.ts`）获取模型的上下文窗口大小

#### 生成方式

手写 DOT 文件，只保留核心节点，用 Graphviz 渲染：

```bash
dot -Tsvg context-focused.dot -o context-focused.svg
```

---

### 分层依赖图

**`layers-context/`** — 从 `context.ts` 出发 BFS 展开 3 层，共 156 个文件

| 文件 | 节点数 | 内容 |
|---|---|---|
| `overview.svg` | 156 | 全局概览，所有层按颜色分组 |
| `layer-0.svg` | 1 | 入口：`context.ts` 自身 |
| `layer-1.svg` | 9 | 直接依赖：git.ts, claudemd.ts, envUtils.ts 等 |
| `layer-2.svg` | 41 | 二级依赖：config.ts, settings.ts, model.ts, growthbook.ts 等 |
| `layer-3.svg` | 105 | 三级依赖：Tool.ts, messages.ts, auth.ts, AppState.tsx 等 |

#### 颜色含义（分层图）

| 颜色 | 层级 |
|---|---|
| 红色 `#ff9999` | Layer 0 — 入口 |
| 橙色 `#ffcc99` | Layer 1 — 直接依赖 |
| 黄色 `#ffff99` | Layer 2 — 二级依赖 |
| 绿色 `#99ff99` | Layer 3 — 三级依赖 |

#### 如何阅读分层图

- **overview.svg**：鸟瞰全貌，每个 subgraph 框是一层，框内节点颜色相同
- **layer-N.svg**：聚焦第 N 层，显示该层节点到上下层的连接边
- **从上往下看**：Layer 0 是"为什么需要这些依赖"，Layer 3 是"最底层的基础设施"

#### 关键发现

从分层图可以看出：

1. **Layer 1 很窄**（9 文件）：context.ts 的职责单一，只依赖 git、文件读取、环境变量
2. **Layer 2 爆炸**（41 文件）：config.ts 和 settings.ts 是枢纽节点，拉入大量配置相关代码
3. **Layer 3 最大**（105 文件）：Tool.ts、messages.ts 等核心抽象出现在第三层，说明 context 模块在依赖图中位置较高，不依赖业务逻辑

#### 生成方式

```bash
# 导出依赖 JSON
madge src/context.ts --ts-config tsconfig.json --extensions ts,tsx,js,jsx \
  --json 2>/dev/null > deps.json

# BFS 分层生成
python3 tools/layered-deps.py deps.json context.ts 3
```
