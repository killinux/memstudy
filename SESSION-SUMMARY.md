# Session Summary — free-code45 内部研究总览

> 这份文档汇总了对 free-code45 (Claude Code v2.1.87) 的所有研究内容、使用过的方法、得出的结论，以及未完成可继续的方向。下次回来直接看这一份就能接上。

---

## 📋 目录

1. [项目目录速查](#项目目录速查)
2. [使用过的分析方法](#使用过的分析方法)
3. [产出的文档清单](#产出的文档清单)
4. [核心架构理解](#核心架构理解)
5. [关键数据](#关键数据)
6. [尚未验证的方向](#尚未验证的方向)
7. [复用脚本](#复用脚本)
8. [下次接续指南](#下次接续指南)

---

## 项目目录速查

```
memstudy/
├── README.md                              # 项目说明
├── SESSION-SUMMARY.md                     # 本文档（总结）
│
├── docs/                                  # 分析文档（MD + HTML 双格式）
│   ├── context-management-explained.md    # Context 管理系统
│   ├── cot-thinking-design.md             # CoT/Extended Thinking
│   ├── agent-loop-implementation.md       # Agent Loop 实现
│   ├── prompt-analysis.md                 # Prompt 提取与分析
│   ├── codebase-insights.md               # 注释挖掘 + 复杂度
│   ├── ast-analysis-report.md             # AST 静态分析
│   ├── code-analysis-methods.md           # 10 种分析方法目录
│   └── madge-guide.md                     # Madge 工具使用指南
│
├── graphs/                                # 依赖关系图
│   ├── context/                           # context.ts 模块
│   │   ├── README.md                      # 图解说明
│   │   ├── context-focused.svg            # 手工精选（24 节点）
│   │   └── layers-context/                # 分层（156 文件，4 层）
│   ├── cot/                               # CoT/Thinking 模块
│   │   ├── README.md
│   │   ├── cot-overview.svg               # 三层架构图
│   │   ├── layers-thinking/               # thinking.ts 分层（117 文件）
│   │   └── layers-effort/                 # effort.ts 分层（59 文件）
│   ├── agent-loop/                        # Agent Loop 协调中枢
│   │   ├── README.md
│   │   ├── agent-loop-overview.svg        # 数据流图（10 步编号）
│   │   └── layers-query/                  # query.ts 分层（269 文件）
│   └── tools/                             # Tool 系统（核心抽象，最大）
│       ├── README.md
│       ├── tool-system-overview.svg       # 4 层架构图（接口/注册/分类/执行）
│       ├── tool-categories.svg            # 42 工具按 13 类分组
│       └── layers-tool/                   # Tool.ts 分层（533 文件，3 层）
│
├── tools/                                 # 可复用工具脚本
│   ├── layered-deps.py                    # BFS 分层依赖图生成器
│   ├── md2html.py                         # MD → HTML5 转换器
│   └── ast-analysis/                      # AST 分析脚本
│       ├── analyze.mjs                    # 通用 AST 分析
│       ├── extract-prompts.mjs            # Prompt 提取
│       └── analyze-prompts.mjs            # Prompt 关键词分析
│
└── reports/                               # 量化数据
    ├── ast-analysis/                      # AST 分析输出（7 JSON）
    ├── prompts/                           # 提取的所有 prompt 文本
    └── report.html                        # Claude Code Insights
```

---

## 使用过的分析方法

### ✅ 已用（覆盖了 10 种方法中的 6 种）

| # | 方法 | 工具 | 产出 | 特点 |
|---|---|---|---|---|
| 1 | **静态依赖分析** | madge | context/cot/agent-loop 三套依赖图 | 看模块关系 |
| 2 | **分层依赖图** | 自创 layered-deps.py | 三个 layers-* 目录 | 解决大项目 OOM |
| 3 | **手动读源码** | Read + Grep | 4 篇深度文档 | 理解实现细节 |
| 4 | **架构注释挖掘** | grep IMPORTANT | codebase-insights.md 第一部分 | 找设计决策 |
| 5 | **复杂度度量** | lizard | codebase-insights.md 第二部分 | 找复杂度热点 |
| 6 | **AST 分析** | ts-morph | ast-analysis-report.md + prompt-analysis.md | 量化代码结构 |

### 🔲 未用（4 种）

| # | 方法 | 工具 | 为什么没用 |
|---|---|---|---|
| 7 | 调用图 | ts-callgraph / doxygen | 时间未到 |
| 8 | 运行时追踪 | node --prof | 需要运行环境 |
| 9 | 火焰图 | 0x / py-spy | 需要运行环境 |
| 10 | Git 考古 | git log + code-maat | free-code45 是源码快照，无真实历史 |

详见 `docs/code-analysis-methods.md`。

---

## 产出的文档清单

### 7 篇深度分析文档

| 文档 | 核心内容 | 字数 | 关键发现 |
|---|---|---|---|
| **context-management-explained.md** | Context 管理系统 | ~5000 | 两核心函数 + 两级压缩 + 7 阶段生命周期 |
| **cot-thinking-design.md** | Extended Thinking 三层架构 | ~6500 | adaptive/effort/ultrathink 解耦设计 |
| **agent-loop-implementation.md** | Agent Loop 实现 | ~6000 | 代码 vs 模型的清晰边界 |
| **prompt-analysis.md** | Prompt 工程提取 | ~4500 | 5 种 prompt 设计模式 |
| **codebase-insights.md** | 注释挖掘 + 复杂度 | ~3500 | 项目"心脏"和"红线" |
| **ast-analysis-report.md** | AST 量化分析 | ~3500 | 42 工具 + 73 命令 + 573 组件 |
| **agent-loop-implementation.md** | （上面已列） | | |

### 2 篇方法论文档

| 文档 | 内容 |
|---|---|
| **code-analysis-methods.md** | 10 种代码分析方法目录 + 选择指南 |
| **madge-guide.md** | madge 使用手册（含分层方案） |

---

## 核心架构理解

### 一句话总结 free-code45 是什么

> 一个**渲染到终端的 React 应用**（react 被 import 761 次），核心是 query.ts 的 async generator 主循环，协调 42 个工具 + 73 个命令 + 573 个组件，通过约 22k token 的 prompt 工程对 Claude 模型进行行为约束。

### 三层架构

```
┌─────────────────────────────────────────────────┐
│  Layer 1: Prompts (~22k tokens)                  │
│  告诉模型"该怎么做事"                             │
│    - getActionsSection: 风险决策框架               │
│    - getOutputEfficiencySection: 沟通规范          │
│    - 工具 prompts: 工具使用规则                    │
│    - BashTool git safety: 安全协议                 │
├─────────────────────────────────────────────────┤
│  Layer 2: Code (~280k LOC, 1932 文件)            │
│  提供"试错环境和管道"                             │
│    - query.ts: 主循环                             │
│    - StreamingToolExecutor: 工具执行              │
│    - 权限系统                                     │
│    - 上下文管理                                    │
├─────────────────────────────────────────────────┤
│  Layer 3: Model Weights (远端 API)               │
│  提供"知识和直觉"                                 │
│    - 视觉理解（ViT）                              │
│    - 领域知识（编程、调试、各种语言）              │
│    - 推理能力                                     │
│    - Extended Thinking                            │
└─────────────────────────────────────────────────┘
```

### 核心子系统及其关系

```
                     用户输入
                        │
                        ▼
                ┌──────────────┐
                │  REPL.tsx    │  (371 个 hook 的"上帝组件")
                └──────┬───────┘
                       │
                       ▼
                ┌──────────────────┐
                │  query.ts        │ ←─── context.ts (CLAUDE.md + git)
                │  queryLoop()     │ ←─── thinking.ts + effort.ts
                │  while(true)     │ ←─── prompts.ts (system prompt)
                └──┬────────┬─────┘
                   │        │
              发请求│        │收到工具调用
                   ▼        ▼
         ┌──────────┐  ┌─────────────────┐
         │ Claude   │  │ Streaming       │
         │ API      │  │ ToolExecutor    │
         └──────────┘  └────┬────────────┘
                            │
                            ▼
                   ┌────────────────┐
                   │ canUseTool     │ (权限检查)
                   └────┬───────────┘
                        │
                        ▼
                   ┌────────────────┐
                   │ tool.call()    │ (BashTool/ReadTool/...)
                   └────┬───────────┘
                        │
                        ▼ tool_result 回到 messages
                   循环继续，直到 stop_reason='end_turn'
                        │
                        ▼
                ┌──────────────┐
                │  压缩系统     │ (token 接近上限时自动触发)
                │  microCompact│
                │  compact     │
                └──────────────┘
```

### 关键设计决策

| # | 决策 | 文档来源 |
|---|---|---|
| 1 | **adaptive thinking** > 固定预算（4.6+ 模型自主决定推理深度） | cot-thinking-design.md |
| 2 | **错误作为 tool_result**（让模型自己纠错，不抛异常） | agent-loop-implementation.md |
| 3 | **两级压缩**（microCompact 清工具输出 → compact 摘要替换） | context-management-explained.md |
| 4 | **Streaming Tool Execution**（不等响应完就开始执行） | agent-loop-implementation.md |
| 5 | **Effort 与 Thinking 解耦**（独立 API 参数） | cot-thinking-design.md |
| 6 | **Ultrathink 是 Effort 的语法糖**（不修改 ThinkingConfig） | cot-thinking-design.md |
| 7 | **getActionsSection 定义风险决策框架**（reversibility × blast radius） | prompt-analysis.md |
| 8 | **命令式 vs 解释式分场景**（安全用 NEVER，风格用解释） | prompt-analysis.md |
| 9 | **子 agent 的 fork vs 普通分支**（fork 继承 thinking config 命中 cache） | cot-thinking-design.md |
| 10 | **subagent_type 不继承 leader 权限**（避免意外受限） | codebase-insights.md |
| 11 | **buildTool() 工厂 + fail-closed 默认值**（isConcurrencySafe/isReadOnly 默认 false） | graphs/tools/README.md |
| 12 | **工具注册是命令式的**（运行时根据 feature flag 动态决定工具集） | graphs/tools/README.md |

---

## 关键数据

### 项目规模

| 指标 | 数值 | 来源 |
|---|---|---|
| TypeScript 源文件 | 1,932 | AST |
| 总代码行 (NLOC) | 280,594 | lizard |
| 总函数数 | 20,181 | AST |
| 平均圈复杂度 | **3.0**（业界 4-6） | lizard |
| HACK/FIXME 注释 | **4 个**（极低技术债） | grep |
| IMPORTANT 注释 | 93 处 / 64 文件 | grep |
| 高复杂度函数 (CCN > 30) | 77 个 | lizard |

### 系统组件

| 组件 | 数量 | 备注 |
|---|---|---|
| **Tool 定义** | 42 | AST 列出全部清单 |
| **Command 定义** | 73 | 7 prompt + 19 local + 47 local-jsx |
| **React 组件** | 573 | REPL 是怪物（371 hook） |
| **Prompt 段** | 77 | ~22k token 总量 |
| **硬约束** | 60 | NEVER/MUST/CRITICAL |
| **软约束** | 28 | should/recommended |

### 复杂度热点 Top 5

| 函数 | CCN | 文件 |
|---|---|---|
| `peek` | **229** | utils/bash/bashParser.ts |
| `parseDoGroup` | 176 | utils/bash/bashParser.ts |
| `ansi256FromRgb` | 164 | native-ts/color-diff/index.ts |
| `parseExpansionRest` | 129 | utils/bash/bashParser.ts |
| `parseTestNegatablePrimary` | 120 | utils/bash/bashParser.ts |

复杂度集中在三类**本质复杂**的领域：解析器（32%）、安全验证（23%）、UI 渲染（16%）。

### 模块依赖广度 Top 5（Layer 1+2+3 总数）

| 模块 | Layer 1 | Layer 2 | Layer 3 | 总计 |
|---|---|---|---|---|
| **Tool.ts** ⭐ | 19 | 187 | 326 | **533** |
| query.ts | 41 | 227 | - | 269 |
| context.ts | 9 | 41 | 105 | 156 |
| thinking.ts | 6 | 41 | 69 | 117 |
| effort.ts | 8 | 50 | - | 59 |

**Tool.ts 是最大的依赖中枢**——3 层展开占项目 28%。原因是 ToolUseContext 类型有 70+ 个字段，拉入了整个项目的类型系统。

### 最长 Prompt Top 5

| Prompt | 字符数 | 备注 |
|---|---|---|
| TodoWriteTool `PROMPT` | 9,132 | 5 个 few-shot 示例 |
| BashTool `getCommitAndPRInstructions` | 6,305 | 16 个硬规则 |
| PowerShellTool `getPrompt` | 5,127 | Windows 等价 BashTool |
| `getProactiveSection` | 3,766 | KAIROS 主动模式 |
| EnterPlanModeTool | 3,681 | Plan 模式 |

---

## 尚未验证的方向

按价值排序的待办：

### 🥇 高价值（核心子系统，应该补全 graphs/）

#### 1. 权限系统（utils/permissions/）

**为什么必须有**：
- 之前列为 P0 但没做
- bashPermissions.ts 复杂度爆表（10 个高 CCN 函数）
- 是 Claude Code 安全边界的核心，市面上做得最严的 agent 框架之一

**关键文件**：
- `utils/permissions/permissions.ts` — 规则引擎
- `utils/permissions/PermissionRule.ts` — 规则匹配
- `utils/permissions/yoloClassifier.ts` — LLM 风险分类
- `utils/permissions/filesystem.ts` — 路径权限（symlink 防御）
- `tools/BashTool/bashPermissions.ts` — Bash 命令分析
- `hooks/useCanUseTool.tsx` — 入口

**应该产出**：
- `docs/permission-system.md` — 权限决策流程深度文档
- `graphs/permissions/permission-decision-flow.svg` — allow/deny/ask 决策树
- `graphs/permissions/permission-overview.svg` — 整体架构
- `graphs/permissions/layers-permissions/` — 分层依赖

#### 2. Bootstrap / 启动流程

**为什么必须有**：
- 我们分析了主循环但**没分析 main.tsx 怎么启动到主循环**
- bootstrap/state.ts 215 个 export，是绝对的"上帝模块"，但我们从没专门画过
- 启动流程是任何项目的"骨架"

**关键文件**：
- `entrypoints/cli.tsx` — 入口
- `main.tsx` — 主初始化（4.7k 行）
- `bootstrap/state.ts` — 全局状态枢纽
- `setup.ts` — 环境设置

**应该产出**：
- `docs/bootstrap-flow.md`
- `graphs/bootstrap/startup-flow.svg` — cli → setup → main → REPL → queryLoop
- `graphs/bootstrap/layers-state/` — bootstrap/state.ts 分层

#### 3. 子 Agent / Fork 机制（tools/AgentTool/ + coordinator/）

**为什么值得**：
- Claude Code 最有创意的设计之一（OpenAI Codex 没有这个）
- 涉及并发、缓存共享、上下文隔离等多个有意思的工程问题
- 之前在 cot 文档里提到了 fork 继承 thinking config，但没单独深入

**关键文件**：
- `tools/AgentTool/AgentTool.tsx`
- `tools/AgentTool/runAgent.ts`
- `utils/forkedAgent.ts`
- `coordinator/coordinatorMode.ts`
- `coordinator/workerAgent.ts`

**应该产出**：
- `docs/sub-agent-fork.md`
- `graphs/agent-fork/agent-fork-mechanism.svg` — fork vs spawn 对比
- `graphs/agent-fork/coordinator-overview.svg` — 多 worker 协调

#### 4. BashTool 内部实现

**为什么值得**：
- BashTool 是最复杂的工具（lizard 显示 bashPermissions.ts 有 10 个高复杂度函数）
- bashParser.ts 的 `peek` 函数是项目复杂度第一（CCN 229）
- 是"代码到行为"的完整闭环案例

**关键文件**：
- `tools/BashTool/BashTool.tsx`
- `tools/BashTool/bashPermissions.ts`
- `utils/bash/bashParser.ts`
- `utils/bash/commands.ts`
- `tools/BashTool/bashSecurity.ts`

### 🥈 中价值（独立子系统）

| # | 主题 | 关键文件 |
|---|---|---|
| 5 | **Compact 系统**（独立画图） | `services/compact/compact.ts`, `microCompact.ts`, `autoCompact.ts` |
| 6 | **Command 系统**（73 个命令的注册和调度） | `commands.ts`, `commands/*` |
| 7 | **MCP 集成** | `services/mcp/`, MCP 工具 |
| 8 | **Skills 系统** | `skills/`, `services/skillSearch/` |
| 9 | **Hooks 扩展机制** | `utils/hooks.ts`, `utils/hooks/*` |
| 10 | **Prompt Cache 机制** | `services/api/promptCacheBreakDetection.ts`, `cachedMicrocompact.ts` |
| 11 | **多 Provider 支持** | `services/api/claude.ts`, `model/providers.ts` |

### 🥉 锦上添花

| # | 主题 |
|---|---|
| 12 | 全景架构总结文档（把所有零散发现织成一张网） |
| 13 | 与 Aider/Cursor/Codex CLI 的横向对比 |
| 14 | Memory 系统（memdir）|
| 15 | 流式 UI 渲染（Ink + components/）|
| 16 | Session 存储（utils/sessionStorage.ts，IMPORTANT 注释最多）|

### 📊 graphs/ 目录补全计划

```
graphs/
├── context/         ✅ 已完成
├── cot/             ✅ 已完成
├── tools/           ✅ 已完成（最新）
├── agent-loop/      ✅ 已完成
│
├── permissions/     ⬜ 待补 (P0 - 安全核心)
├── bootstrap/       ⬜ 待补 (P0 - 启动骨架)
├── agent-fork/      ⬜ 待补 (P1 - 最有创意的设计)
│
├── compact/         ⬜ 待补 (P2 - 独立子系统)
└── commands/        ⬜ 待补 (P2 - 73 个命令)
```

补全这 5 个，graphs/ 就完整覆盖了 Claude Code 所有核心子系统。

### ❌ 不推荐做

| # | 主题 | 原因 |
|---|---|---|
| - | 运行时追踪/火焰图 | 需要真正运行 Claude Code，环境配置成本高 |
| - | Git 考古 | free-code45 是源码快照，无真实 git 历史 |
| - | 类型系统深度 | 产出对架构理解帮助有限 |
| - | 测试代码分析 | free-code45 没发布测试 |

---

## 复用脚本

所有脚本都在 `tools/` 下，可直接用于其他 TypeScript 项目：

### 1. 分层依赖图

```bash
# 第一步：用 madge 导出 JSON
cd <your-project>
madge src/ --ts-config tsconfig.json --extensions ts,tsx --json \
  2>/dev/null > /tmp/deps.json

# 第二步：分层
python3 tools/layered-deps.py /tmp/deps.json <entry-file> <max-depth>
# 例: python3 tools/layered-deps.py /tmp/deps.json query.ts 2
```

### 2. AST 分析

```bash
cd tools/ast-analysis
npm install ts-morph

# 通用代码统计
node analyze.mjs <project-root> <output-dir>

# Prompt 提取
node extract-prompts.mjs <project-root> <output-dir>

# Prompt 关键词分析
node analyze-prompts.mjs <prompts-output-dir>
```

### 3. Markdown 转 HTML

```bash
python3 tools/md2html.py docs/some-doc.md
# 输出: docs/some-doc.html（带暗色模式 + 响应式布局）
```

### 4. 复杂度分析

```bash
pip install lizard
lizard <project>/src -l typescript --CCN 30 -w
```

### 5. 注释挖掘

```bash
grep -rn "IMPORTANT:" src/ --include="*.ts" --include="*.tsx"
grep -rn "DO NOT\|do not change\|do not modify" src/ -i
```

---

## 下次接续指南

### 如果只有 30 分钟，看什么

1. **本文档**（5 分钟）— 唤起记忆
2. **`docs/agent-loop-implementation.md`** 的"代码 vs 模型边界"章节（10 分钟）— 核心抽象
3. **`docs/prompt-analysis.md`** 的"5 种 prompt 设计模式"（10 分钟）— 实用启示
4. 浏览 `graphs/agent-loop/agent-loop-overview.svg` + `graphs/tools/tool-system-overview.svg`（5 分钟）— 直观架构

### 如果有半天，做什么

**首选：权限系统深入**（P0，graphs/ 还缺）

```bash
# 起步代码点
src/hooks/useCanUseTool.tsx               # 入口
src/utils/permissions/permissions.ts      # 规则引擎
src/utils/permissions/yoloClassifier.ts   # LLM 风险分类
src/utils/permissions/filesystem.ts       # 路径权限 + symlink 防御
src/tools/BashTool/bashPermissions.ts     # Bash 命令分析（CCN 极高）
```

**做什么**：
1. 画出权限决策树（allow/deny/ask 流程）
2. 解读 yoloClassifier 的 LLM 风险判断
3. 理解 isDangerousRemovalRawPath 87 个分支的意图
4. 写一份 `docs/permission-system.md`
5. 生成 `graphs/permissions/`：
   - permission-decision-flow.svg（手工决策树）
   - permission-overview.svg（架构总览）
   - layers-permissions/（filesystem.ts 分层）

**备选：Bootstrap / 启动流程**（P0，graphs/ 还缺）

```bash
src/entrypoints/cli.tsx                   # 入口
src/main.tsx                              # 4.7k 行的初始化
src/bootstrap/state.ts                    # 215 export 的状态枢纽
src/setup.ts                              # 环境设置
```

**产出**：`docs/bootstrap-flow.md` + `graphs/bootstrap/`

### 如果有一天，做什么

**做"Tool 内部实现深度系列"**：

挑 3 个代表性工具各写一篇深度文档：
- BashTool（最复杂）
- FileEditTool（最常用）
- AgentTool（最有创意，对应"子 Agent / Fork 机制"P0）

每篇按"prompt → 代码实现 → 与 agent loop 的交互"三层组织。

**或者：补全 graphs/ 的 5 个待办**（permissions / bootstrap / agent-fork / compact / commands）

### 思维框架（写新文档时用）

每个子系统按这个模板分析：

```
1. 在 prompt 里被怎么描述？     → reports/prompts/
2. 入口代码在哪？               → grep + Read
3. 数据流是什么？                → 画时序图或数据流图
4. 关键设计决策是什么？           → 注释挖掘
5. 复杂度集中在哪里？             → lizard
6. 依赖关系？                    → madge + layered-deps.py
7. 跟模型 vs 代码的边界是什么？    → 仿照 agent-loop 文档
```

---

## 关键洞察备忘

### 1. "Claude 看图就知道怎么做"的真相

不是任何一份文档单独能解释，而是三层共同作用：
- **模型权重**：视觉理解 + 领域知识（API 服务端，看不见）
- **Prompt**：调试方法论（getActionsSection 等，在 reports/prompts/）
- **代码**：试错环境（agent loop，在 query.ts）

### 2. Anthropic 的 prompt 工程哲学

- 安全约束 → 命令式（NEVER/MUST）
- 风格规范 → 解释式（应该/最好）
- 时机判断 → few-shot 示例
- 复杂流程 → 分步模板
- 反例引导 → 列出"不要做 X"

### 3. 项目质量观察

- 平均 CCN **3.0** 极健康
- HACK/FIXME 仅 **4 个**，技术债极低
- IMPORTANT 注释 **93 处**，设计意图被充分文档化
- 复杂度集中在"本质复杂"领域（解析器/安全/UI），业务逻辑简洁

### 4. 代码规模感知

- 1932 个 TS 文件，但只有 42 个 Tool + 73 个 Command 是核心抽象
- 其余 94% 都是支撑代码（UI、工具函数、类型）
- React 被 import 761 次 — 终端 CLI 实质是个 React 应用
- query.ts 直接依赖 41 个文件，是真正的"中枢"

---

## Git 状态

```
仓库: git@github.com:killinux/memstudy.git
分支: main
最近的核心 commit:
  09ccb5e  Add prompt extraction and analysis from free-code45
  e11f394  Add AST-based analysis using ts-morph
  dfe48fb  Add codebase insights from comment mining + complexity analysis
  3152be0  Add Agent Loop dependency graphs
  bb8b49d  Add Agent Loop implementation deep-dive with Blender debugging example
  442b2ce  Add comprehensive code analysis methods guide
  63d1942  Add CoT dependency graphs and README explanations
```

---

**就这些。下次回来，从本文档第一节开始扫一眼，5 分钟就能进入状态。**
