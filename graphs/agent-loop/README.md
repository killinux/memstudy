# Agent Loop 模块依赖图

基于 free-code45 (Claude Code v2.1.87) 源码，分析 Agent Loop 的实现架构和依赖关系。

## 图文件说明

### 手工精选图

**`agent-loop-overview.svg`** — Agent Loop 完整架构图

这张图不是简单的"谁 import 谁"，而是展示了**运行时的数据流**：从用户输入到 API 调用、工具执行、结果反馈、循环继续的完整路径。

#### 节点分组（5 个 subgraph）

##### 1. Main Loop（红色区域）— `query.ts`

| 节点 | 职责 |
|---|---|
| `queryLoop()` [query.ts:241] | 主循环入口，async generator |
| `State` | 可变状态：messages[], turnCount, abortController |
| Stop Conditions [query.ts:1062,1357,1705] | 三个退出条件：无工具、达最大轮数、被中断 |

##### 2. API Layer（蓝色区域）— `services/api/`

| 节点 | 职责 |
|---|---|
| `queryModelWithStreaming()` | 构建 API 请求并发起流式调用 |
| Stream Handler [claude.ts:2020-2170] | 处理 content_block_start、thinking_delta、tool_use 块 |
| `normalizeMessagesForAPI()` | 把内部消息格式转成 Anthropic API 格式 |

##### 3. Tool Execution（绿色区域）— `services/tools/`

| 节点 | 职责 |
|---|---|
| `StreamingToolExecutor` | 流式工具执行器：边接收边执行，并发控制 |
| `runTools()` | 传统编排：并发安全的并行，不安全的串行 |
| `runToolUse()` | 单个工具执行：调用 tool.call()，错误捕获 |
| `canUseTool()` [useCanUseTool.tsx:28] | 权限门禁：allow/deny/ask |

##### 4. Tool Registry（黄色区域）— `tools/`

| 节点 | 职责 |
|---|---|
| `Tool.ts` | Tool 接口定义：name + inputSchema + call() |
| `BashTool` / `FileReadTool` / `FileEditTool` / `GrepTool` / `AgentTool` / ... | 20+ 具体工具实现 |

##### 5. Supporting Systems（紫色区域）— 交叉关注点

| 节点 | 职责 |
|---|---|
| `context.ts` | 提供 git 状态和 CLAUDE.md（system context 构建） |
| `compact/` | 压缩系统：autoCompact + microCompact |
| `thinking.ts` | ThinkingConfig 类型和模型能力检测 |
| `effort.ts` | Effort 等级管理 |

#### 边的含义

图中的边**按数据流的时间顺序编号**（1-10），按颜色区分类型：

| 颜色/样式 | 含义 |
|---|---|
| 黑色实线 | 数据流或函数调用 |
| 绿色 (`#006600`) | 工具结果回传 |
| 蓝色 (`#0066ff`) | 循环继续 |
| 红色 (`#990000`) | 循环终止 |
| 青色 (`#0099cc`) | UI 流式输出 |
| 灰色虚线 (dashed) | 跨模块依赖（system context、thinking、effort 等） |
| 灰色点线 (dotted) | 条件触发（如压缩） |

#### 编号对应的数据流

```
User → queryLoop → [1] normalize → [2] build request
                                      ↓
                                   [3] HTTP POST → Claude API
                                                     ↓
       queryLoop ← [5] yield events ← [4] stream events
          ↓
       [6] tool_use 检测
          ↓
       StreamingToolExecutor
          ↓ [7] permission check → useCanUseTool
          ↓ [8] execute → toolExecution → Tool.ts → 具体工具
          ↓ [9] tool_result (绿色) → queryLoop
          ↓
       [10] check stop conditions
          ├─ 继续 (蓝色) → 更新 state → 回到 [1]
          └─ 终止 (红色) → yield 到 UI → 返回
```

#### 如何阅读这张图

1. **从顶部 User 节点开始**：跟着数字 1-10 的顺序走一遍
2. **注意循环**：第 10 步的"继续"箭头会回到主循环，形成闭环
3. **虚线是静态依赖**：queryModelWithStreaming 依赖 context/thinking/effort，这些是构建请求时的配置来源
4. **点线是条件依赖**：压缩系统只在 token 超阈值时触发
5. **5 个 subgraph 对应文档的 5 个层次**：主循环 / API / 工具执行 / 工具注册 / 支撑系统

#### 实际例子对照

用户说："帮我修复 parser.ts 的空指针错误"，数据流：

```
[User] 输入 prompt
   ↓ [1] normalizeMessagesForAPI: {role: 'user', content: ...}
   ↓ [2] 构建请求：messages + tools(Read, Edit...) + thinking config
   ↓ [3] POST https://api.anthropic.com/v1/messages
        Claude 推理...
   ← [4] 流式返回: thinking + "让我先读代码" + tool_use(Read, parser.ts)
   ↓ [5] yield 事件给 UI（用户看到"让我先读代码"）
   ↓ [6] 检测到 tool_use 块
   ↓ [7] canUseTool(Read) → 'allow' (只读无需确认)
   ↓ [8] FileReadTool.call({ file_path: 'parser.ts' })
   ↓ [9] tool_result: "...文件内容..."
   ↓ [10] 检查：needsFollowUp=true → 继续
   
state.messages 现在多了:
  + assistant { thinking, text, tool_use }
  + user { tool_result }
   ↓ 回到 [1] 下一轮
   ↓
[User] 看到 Claude 分析代码、提出修改、调用 Edit、再次循环...
[User] 最终看到 "修改完成" → stop_reason='end_turn' → 循环结束
```

#### 生成方式

```bash
# 手写的 DOT 文件（agent-loop-overview.dot）
dot -Tsvg agent-loop-overview.dot -o agent-loop-overview.svg
```

---

### 分层依赖图

**`layers-query/`** — query.ts 的分层依赖图

从 `query.ts` 出发 BFS 展开 2 层，共 269 个文件。

| 文件 | 节点数 | 大小 | 内容 |
|---|---|---|---|
| `overview.svg` | 269 | 1.1 MB | 全局概览（最大） |
| `layer-0.svg` | 1 | 31 KB | 入口：`query.ts` |
| `layer-1.svg` | 41 | 400 KB | 直接依赖：claude.ts, StreamingToolExecutor, Tool.ts, context.ts, 各种 utils |
| `layer-2.svg` | 227 | 854 KB | 二级依赖：BashTool, FileReadTool 及它们的所有内部依赖 |

#### 为什么 query.ts 的依赖这么多

query.ts 是 Claude Code 的**中枢文件**，负责协调：

- **API 通信**：services/api/claude.ts 及相关
- **工具编排**：services/tools/* 多个文件
- **上下文管理**：context.ts, autoCompact.ts
- **消息处理**：utils/messages.ts 及相关
- **状态追踪**：state/AppState.tsx, cost-tracker.ts
- **权限系统**：useCanUseTool.tsx
- **会话管理**：utils/sessionStorage.ts
- **错误处理**：services/api/errors.ts
- **遥测**：services/analytics/*
- **压缩系统**：services/compact/*
- **Hook 系统**：utils/hooks.ts
- **思考/Effort**：utils/thinking.ts, utils/effort.ts（间接）

41 个直接依赖映射到了上述每个子系统的入口。

#### 与 context.ts / thinking.ts 对比

| 模块 | Layer 1 数 | 说明 |
|---|---|---|
| `context.ts` | 9 | 纯数据构建，依赖少 |
| `thinking.ts` | 6 | 纯能力检测，依赖更少 |
| `effort.ts` | 8 | 需要用户上下文 |
| **`query.ts`** | **41** | **协调者，依赖所有子系统** |

这符合架构原则：**叶子模块依赖少，枢纽模块依赖多**。

#### 颜色含义（分层图通用）

| 颜色 | 层级 |
|---|---|
| 红色 `#ff9999` | Layer 0 — 入口 |
| 橙色 `#ffcc99` | Layer 1 — 直接依赖 |
| 黄色 `#ffff99` | Layer 2 — 二级依赖 |

#### 生成方式

```bash
# 导出依赖 JSON
madge src/query.ts --ts-config tsconfig.json --extensions ts,tsx,js,jsx \
  --json 2>/dev/null > deps.json

# BFS 分层生成
python3 tools/layered-deps.py deps.json query.ts 2
```

---

## 为什么不画 3 层

query.ts 的三层展开会超过 600 个文件，渲染出的 SVG 节点密密麻麻无法阅读。2 层已经足够看出架构重点——想看更细节可以直接查看代码或从 Layer 2 中某个文件重新分层。

例如想深入 StreamingToolExecutor：

```bash
python3 tools/layered-deps.py deps.json StreamingToolExecutor.ts 2
```

---

## 与已有图的关系

| 图 | 聚焦 | 层级 |
|---|---|---|
| `graphs/context/` | 上下文构建 | 叶子模块（被 query.ts 使用） |
| `graphs/cot/` | 思考能力 | 叶子模块（被 claude.ts 使用） |
| `graphs/agent-loop/` | **协调中枢** | **顶层模块（使用 context 和 cot）** |

三张图从不同抽象层次描述了 Claude Code 的核心架构：
- agent-loop 是"发动机"（协调执行）
- context 是"感知输入"（上下文数据）
- cot 是"思考方式"（推理配置）

组合起来就是 Claude Code 的核心回路。
