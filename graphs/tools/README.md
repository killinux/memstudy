# Tool 系统模块依赖图

基于 free-code45 (Claude Code v2.1.87) 源码，分析 Tool 系统的架构和依赖关系。

## 为什么 Tool.ts 是核心抽象

数据说话：
- **Tool.ts 被 167 个文件 import**（仅次于 react 和 ink，是项目内排名第一的核心模块）
- 项目共有 **42 个 Tool 实现**，全部从 `Tool` 接口派生
- Tool.ts 的 3 层依赖展开包含 **533 个文件**（占项目 28%）

理解 Tool 系统等于理解 Claude Code 怎么"做事"——agent loop 是骨架，Tool 系统是肌肉。

## 图文件说明

### 1. `tool-system-overview.svg` — 架构总览图

展示 Tool 系统的 4 层架构：

#### Layer 1: Tool 接口定义（红色区域）

| 节点 | 文件 | 职责 |
|---|---|---|
| `Tool<Input,Output,P>` | Tool.ts:362 | 核心接口，定义所有 tool 必须实现的方法 |
| `ToolDef` | Tool.ts:721 | Partial<Tool>，可省略默认方法 |
| `buildTool()` | Tool.ts:783 | 工厂函数，把 ToolDef 填充为完整 Tool |
| `TOOL_DEFAULTS` | Tool.ts:757 | 默认实现（fail-closed） |
| `ToolUseContext` | Tool.ts:158 | 工具执行上下文（abortController, state, ...）|

**关键设计**：所有工具都通过 `buildTool(def)` 工厂创建，而非直接实现 `Tool` 接口。这让"安全默认值"集中在一处：

```typescript
const TOOL_DEFAULTS = {
  isEnabled: () => true,
  isConcurrencySafe: (_input?) => false,    // 默认 NOT 并发安全
  isReadOnly: (_input?) => false,           // 默认 NOT 只读
  isDestructive: (_input?) => false,
  checkPermissions: (input, _ctx?) =>       // 默认放行（交给通用权限）
    Promise.resolve({ behavior: 'allow', updatedInput: input }),
  toAutoClassifierInput: (_input?) => '',   // 默认空（跳过分类器）
  userFacingName: (_input?) => '',
}
```

注释明确说："defaults (fail-closed where it matters)"——并发和只读默认 false 是为了**安全偏保守**：宁可错杀（不并发）也不要错放（误并发导致冲突）。

#### Layer 2: 注册与查找（蓝色区域）

| 节点 | 文件 | 职责 |
|---|---|---|
| `getAllBaseTools()` | tools.ts:193 | 返回所有可用 Tool 数组（按 feature flag 条件包含） |
| `getTools(permCtx)` | tools.ts:271 | 按权限上下文过滤后返回可用工具 |
| `filterToolsByDenyRules` | tools.ts:262 | 按 deny 规则筛选 |
| `findToolByName` | Tool.ts:358 | 按名字 + alias 查找 |

**关键设计**：注册不是声明式（如 decorator），而是命令式——`getAllBaseTools()` 是个返回数组的函数，里面有大量 `...(condition ? [Tool] : [])`：

```typescript
return [
  AgentTool,
  BashTool,
  ...(hasEmbeddedSearchTools() ? [] : [GlobTool, GrepTool]),
  ...(process.env.USER_TYPE === 'ant' ? [ConfigTool] : []),
  ...(isWorktreeModeEnabled() ? [EnterWorktreeTool, ExitWorktreeTool] : []),
  ...(isAgentSwarmsEnabled() ? [getTeamCreateTool(), getTeamDeleteTool()] : []),
  // ...
]
```

这让工具集**完全由运行时配置决定**——同一份代码在不同模式下能暴露不同的工具集合。

#### Layer 3: 工具实现（绿色区域）

42 个 Tool 实现，按职责分组：
- **File Ops** (5)：Read, Write, Edit, NotebookEdit, Glob
- **Execution** (2)：Bash, PowerShell
- **Search** (3)：Grep, WebSearch, WebFetch
- **Agent** (3)：Agent, TeamCreate, SendMessage
- **Task** (6+1)：TaskCreate/Get/List/Update/Output/Stop + TodoWrite
- **MCP & Skill** (4)：MCP, Skill, ListMcpResources, ReadMcpResource, ToolSearch
- **Plan & Worktree** (5)：EnterPlanMode, ExitPlanModeV2, EnterWorktree, ExitWorktree, VerifyPlanExecution
- **Other** (~13)：AskUserQuestion, Cron*, Brief, Config, LSP, Tungsten 等

每个工具都用 `buildTool()` 创建，结构一致。

#### Layer 4: 调度执行（黄色区域）

| 节点 | 职责 |
|---|---|
| `query.ts queryLoop` | 主循环，调用 `getTools(permCtx)` 获取可用工具集 |
| `StreamingToolExecutor` | 接收 tool_use 块、入队、并发执行 |
| `canUseTool()` | 权限检查 |
| `tool.call()` | 实际执行 |

#### 数据流

```
1. queryLoop 启动 → getTools(permCtx) → 过滤后的 Tools 数组
2. queryLoop → 把 tool schemas 发送给 Claude API
3. Claude API → 返回 tool_use blocks
4. StreamingToolExecutor.addTool(block)
5. → findToolByName(toolName) → 找到对应 Tool 对象
6. → canUseTool() → 权限检查
7. → tool.call(args, context) → 实际执行
8. → 收集 ToolResult → 喂回 queryLoop
```

---

### 2. `tool-categories.svg` — 工具分类视图

把 42 个工具按功能分组排列，每个分组用不同颜色：

| 分组 | 工具数 | 颜色 |
|---|---|---|
| File Operations | 5 | 浅绿 |
| Execution | 2 | 浅红（高复杂度） |
| Search | 3 | 浅蓝 |
| Agent System | 4 | 浅黄 |
| Task Management | 6 | 浅紫 |
| Legacy Todo | 1 | 浅紫 |
| User Interaction | 1 | 浅粉 |
| Plan Mode | 3 | 浅绿 |
| Worktree | 2 | 浅绿 |
| Scheduling | 4 | 浅蓝 |
| MCP Integration | 3 | 浅橙 |
| Skill | 1 | 浅橙 |
| Other | 8 | 灰色 |

**洞察**：
- **任务管理 + Todo 共 7 个工具**——Claude Code 是为长任务设计的
- **调度类工具 4 个**（Cron + RemoteTrigger）——支持后台定时任务
- **MCP 工具 3 个**——MCP 是一等公民
- **核心只有 7 个**（File ops + Execution）——其余 35 个都是扩展能力

---

### 3. `layers-tool/` — Tool.ts 的分层依赖图

从 Tool.ts 出发 BFS 展开 3 层，共 **533 个文件**（占项目 28%）。

| 文件 | 节点数 | 大小 | 内容 |
|---|---|---|---|
| `overview.svg` | 533 | 1.8 MB | 全局概览 |
| `layer-0.svg` | 1 | 14 KB | 入口：`Tool.ts` |
| `layer-1.svg` | 19 | 180 KB | 直接依赖 |
| `layer-2.svg` | 187 | 750 KB | 二级依赖 |
| `layer-3.svg` | 326 | 607 KB | 三级依赖 |

#### 与其他模块对比

| 模块 | Layer 1 | Layer 2 | Layer 3 | Layer 1+2+3 |
|---|---|---|---|---|
| `context.ts` | 9 | 41 | 105 | 156 |
| `thinking.ts` | 6 | 41 | 69 | 117 |
| `effort.ts` | 8 | 50 | - | 59 |
| `query.ts` | 41 | 227 | - | 269 |
| **`Tool.ts`** | **19** | **187** | **326** | **533** |

**Tool.ts 的依赖深度和广度都最大**——它的 3 层展开比 query.ts 的 2 层都大近一倍。这说明 Tool.ts 不只是"接口定义"，它的类型系统拉入了大量项目内类型（permission types、message types、agent types、progress types、context types 等），形成一个巨大的类型依赖网。

#### Layer 1 直接依赖（19 个）

主要是各种 type 定义：
- `commands.js` — Command 类型
- `useCanUseTool.js` — CanUseToolFn
- `thinking.js` — ThinkingConfig
- `mcp/types.js` — MCP 类型
- `AgentTool/loadAgentsDir.js` — AgentDefinition
- `types/message.js` — Message 类型
- `types/permissions.js` — PermissionResult
- `types/tools.js` — ToolProgressData
- `state/AppState.js` — AppState
- `services/notifications.js` — Notification
- `utils/fileStateCache.js` — FileStateCache
- `utils/permissions/denialTracking.js`
- `utils/systemPromptType.js`
- `utils/toolResultStorage.js`
- `commitAttribution.js`
- `fileHistory.js`
- `theme.js`
- `ids.js` — AgentId
- `utils.js` — DeepImmutable

**洞察**：Tool 接口的 ToolUseContext 类型字段非常多（300+ 行），它要承接整个执行上下文——所以拉入了这么多类型。

#### 颜色含义（分层图通用）

| 颜色 | 层级 |
|---|---|
| 红色 `#ff9999` | Layer 0 — 入口 |
| 橙色 `#ffcc99` | Layer 1 — 直接依赖 |
| 黄色 `#ffff99` | Layer 2 — 二级依赖 |
| 绿色 `#99ff99` | Layer 3 — 三级依赖 |

---

## 关键设计洞察

### 1. buildTool 模式 = 安全默认值集中管理

每个工具都通过 `buildTool(def)` 创建，让"如果没显式声明，默认是什么"集中在一处。这避免了 60+ 个工具各自实现默认值时的不一致风险。

### 2. fail-closed 默认值

`isConcurrencySafe` 和 `isReadOnly` 默认 `false`——宁可保守也不要激进。需要并发或只读时**必须显式声明**，否则按"不安全"对待。

### 3. 注册是命令式的，不是声明式

`getAllBaseTools()` 是普通函数，里面用 spread + 条件包含拼出工具数组。这比 decorator 或 plugin 注册更灵活：能根据 feature flag、env var、user type 动态决定工具集。

### 4. 工具集是动态的

`getTools(permCtx)` 在每次启动时根据**当前权限上下文**返回不同的工具集。同一份代码在不同权限模式下暴露不同的工具——这是 Claude Code 多模式支持的基础。

### 5. Tool 接口背负了"全部上下文"

ToolUseContext 类型有 70+ 个字段，包括 abortController、appState、setAppState、各种 set/update 回调、queryTracking、agentId、各种 cache 等。这让任何工具都能访问到执行所需的所有运行时信息——但代价是 Tool.ts 必须 import 整个项目的类型系统。

### 6. Tool.ts 是项目的"类型枢纽"

被 167 个文件 import，3 层依赖 533 个文件。Tool 接口的修改会牵动半个代码库，这也是为什么 Tool.ts 写得非常稳定（注释多、设计周到）。

---

## 与其他图的关系

```
graphs/
├── context/      ← 输入：上下文数据来源
├── cot/          ← 推理：思考能力配置
├── tools/        ← 能力：工具系统（本目录）
└── agent-loop/   ← 执行：把工具调起来的中枢
```

四张图组成一个完整的"Claude Code 核心系统地图"：
- context 提供"看到什么"
- cot 提供"怎么思考"
- **tools 提供"能做什么"**
- agent-loop 把上面三者串起来"实际做事"

---

## 生成方式

### 手工架构图

```bash
# 编辑 DOT 文件后渲染
dot -Tsvg tool-system-overview.dot -o tool-system-overview.svg
dot -Tsvg tool-categories.dot -o tool-categories.svg
```

### 分层依赖图

```bash
# 1. 导出 madge JSON
cd /opt/workspace/myclaude/free-code45
madge src/Tool.ts --ts-config tsconfig.json \
  --extensions ts,tsx,js,jsx --json 2>/dev/null > /tmp/tool-deps.json

# 2. BFS 分层
python3 tools/layered-deps.py /tmp/tool-deps.json Tool.ts 3
```
