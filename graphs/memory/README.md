# graphs/memory/

Memory management system dependency graphs. See `docs/memory-system.md` for the deep-dive document.

## 手绘架构图（精简版）

两张图都只保留最关键的节点，去掉了 team sync / UI / 类型定义等次要子系统（那些看文档就够了）。

| 文件 | 焦点 | 节点数 |
|---|---|---|
| `memory-overview.svg` | **2×2 核心结构**：两条读路径 × 两条写路径，围绕中心 memory/ 存储 | 9 |
| `memory-dataflow.svg` | **一次 user turn 的生命周期**：并行读 → API → loop → 回合尾触发背景写 | 11 |

两张图想突出的东西：

1. **读路径二分**：常驻的系统提示 (MEMORY.md 索引) vs 按需的附件 (Sonnet 相关性召回)
2. **写路径三分**：主 agent inline write / extractMemories fork / autoDream consolidate
3. **双轨 fallback**：主 agent 写过就跳过 extract (`hasMemoryWritesSince`)
4. **存储是唯一交汇点**：所有读写都绕着 memory/ 转

## 分层依赖图（madge + 自制 BFS）

4 个入口各自的 Layer 0→N 依赖展开，用 `tools/layered-deps.py` 生成。数字=展开到该层为止的文件总数（展示"依赖广度"）。

| 入口 | 角色 | Layer 1 | Layer 2 | Layer 3 | 备注 |
|---|---|---|---|---|---|
| **memdir.ts** | 核心 prompt 构造器 | 16 | 60 | 208 | 中枢模块；拉入类型/路径/scan/age |
| **findRelevantMemories.ts** | Sonnet side-query 召回 | — | 37 | — | 最窄；依赖 sideQuery + memoryScan |
| **extractMemories.ts** | 回合尾背景抽取 agent | — | 142 | — | 要引入 forkedAgent + 工具常量 + message types |
| **autoDream.ts** | 后台整理（REM） | — | 131 | — | 与 extract 共享 canUseTool；多出 lock + DreamTask |

每个 `layers-*/` 目录里有：

- `overview.svg` — 指定深度的总览（方便一眼看尺寸）
- `layer-0.svg` — 入口本身
- `layer-N.svg` — 第 N 层的节点 + 入边
- `README.md` — 脚本自动生成的说明

## 一些对比观察

**memdir.ts 的 Layer 3 是 208 文件**——相比 Tool.ts (533) 和 query.ts (269) 中等体量。中枢性来自于它同时依赖：
- 内部 memdir/* 子模块
- `services/analytics/` (telemetry)
- `bootstrap/state.ts` (KAIROS / cwd)
- `utils/sessionStorage.ts`、`utils/settings/settings.ts`
- 间接经过 `teamMemPaths.ts` 拉入整个 team memory 子树

**findRelevantMemories 最瘦 (Layer 2 只有 37)**——因为它只依赖 `sideQuery` + `memoryScan` + `frontmatterParser`。不经过主 agent 循环任何基础设施。这证明"相关性召回"被设计成了一个**可独立替换的组件**：如果将来换向量数据库，只需改这一个文件。

**extractMemories 和 autoDream 的 Layer 2 基本相等 (142 vs 131)**——两者都走 `runForkedAgent` → 拉入工具系统 + 消息管道 + fork 基础设施。autoDream 稍薄是因为它不做 cursor / throttle / drain 这类长生命周期状态（extractMemories 的 closure 态更重）。

## 生成命令（可复现）

```bash
cd /opt/workspace/myclaude/free-code45
madge src/ --ts-config tsconfig.json --extensions ts,tsx,js,jsx --json \
  2>/dev/null > /tmp/deps.json

cd /opt/workspace/myclaude/memstudy/graphs/memory
python3 ../../tools/layered-deps.py /tmp/deps.json memdir/memdir.ts 3
python3 ../../tools/layered-deps.py /tmp/deps.json memdir/findRelevantMemories.ts 2
python3 ../../tools/layered-deps.py /tmp/deps.json services/extractMemories/extractMemories.ts 2
python3 ../../tools/layered-deps.py /tmp/deps.json services/autoDream/autoDream.ts 2

# 手绘图
dot -Tsvg memory-overview.dot -o memory-overview.svg
dot -Tsvg memory-dataflow.dot -o memory-dataflow.svg
```
