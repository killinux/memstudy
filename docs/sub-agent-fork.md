# 子 Agent / Fork 机制深度解析

> 分析对象：free-code45 (Claude Code v2.1.87)
> 关键源码：`src/tools/AgentTool/`、`src/utils/forkedAgent.ts`、`src/coordinator/coordinatorMode.ts`
> 关键文件总规模：约 4400 行

---

## 0. 一句话总结

Claude Code 的"子 Agent"不是一种东西而是**四种**：fork 子 agent（继承上下文复用 prompt cache）、命名子 agent（独立循环 + 独立 system prompt）、coordinator worker（异步协调模式下的并发 worker）、teammate（多 agent 间用 SendMessage 互相通信）。**fork** 是其中最有创意的设计——它通过构造**字节相同的 API 请求前缀**让父子共享 prompt cache，使子 agent 几乎"免费"。

---

## 1. 四种形态对比

| 形态 | 触发方式 | 上下文继承 | System Prompt | Thinking | 工具池 | 异步 | 适用场景 |
|---|---|---|---|---|---|---|---|
| **Fork** | `Agent({prompt, ...})` 不传 `subagent_type`（gate `FORK_SUBAGENT` 开启时） | 完整 message history | 继承父亲已渲染的字节 | 继承父亲 config | 继承父亲完整工具 | 强制 async | 研究 / 分解任务 / 实施 |
| **命名子 agent** | `Agent({subagent_type: 'explore', ...})` | 仅初始 prompt | 重新构建 | 强制 disabled（控成本） | `assembleToolPool` 重算 | 可选 | 专用 agent (Explore/Plan) |
| **Coordinator worker** | coordinator 模式下 `Agent(...)` 自动走 worker 路径 | 独立 | 独立 | 独立 | `ASYNC_AGENT_ALLOWED_TOOLS` | 总是 async | 协调器编排并发任务 |
| **Teammate** | `spawnTeammate`（多 agent swarm gate） | 独立但可双向通信 | 独立 | 独立 | 独立 | 长存 | 多 agent 协作（tmux pane）|

**互斥关系**：fork 与 coordinator 模式互斥（`forkSubagent.ts:34` 显式拒绝），因为 coordinator 已经拥有自己的编排模型。

---

## 2. Fork 的核心：cache-identical API prefix

Fork 之所以"便宜"，本质是**让父子的 API 请求前缀字节相同**，命中 Anthropic prompt cache。Anthropic API 的缓存键由 5 部分组成：

```
cache_key = hash(system_prompt + tools + model + messages_prefix + thinking_config)
```

`CacheSafeParams` 类型(`forkedAgent.ts:57`)就是这五个东西的载体：

```typescript
export type CacheSafeParams = {
  systemPrompt: SystemPrompt          // 必须字节相同
  userContext: { [k: string]: string } // 拼到 messages 前
  systemContext: { [k: string]: string } // 拼到 system 后
  toolUseContext: ToolUseContext       // 包含 tools, model
  forkContextMessages: Message[]       // 父亲的消息历史
}
```

### 2.1 System Prompt 复用：为什么不能"重新算一遍"

Fork 子 agent **不重新调用 `getSystemPrompt()`**，而是直接复用父亲已经渲染好的字节。原因写在 `forkSubagent.ts:54-58`：

> "Reconstructing by re-calling getSystemPrompt() can diverge (GrowthBook cold→warm) and bust the prompt cache; threading the rendered bytes is byte-exact."

System prompt 内部可能引用 GrowthBook gate（feature flag），父亲启动时是 cold cache，子 agent 启动时可能已经 warm 了，两边的 system prompt 会有细微 byte 差异，缓存就废了。所以 fork 路径在 `AgentTool.tsx:496` 直接拿 `toolUseContext.renderedSystemPrompt`：

```typescript
if (toolUseContext.renderedSystemPrompt) {
  forkParentSystemPrompt = toolUseContext.renderedSystemPrompt;
} else {
  // Fallback: recompute. May diverge from parent's cached bytes...
}
```

### 2.2 Tools 复用：useExactTools

普通子 agent 通过 `assembleToolPool(workerPermissionContext, ...)` 重新组装工具，但 `workerPermissionContext.mode = selectedAgent.permissionMode ?? 'acceptEdits'`，跟父亲的 mode 不同 → 工具序列化会有差异 → 缓存的第一个不同的工具就把后面全部 invalidate 了。

Fork 路径走 `useExactTools: true`(`AgentTool.tsx:632`)，直接传父亲的 `toolUseContext.options.tools` 引用，工具池字节相同。

### 2.3 Thinking config 继承陷阱

`runAgent.ts:679-684`:
```typescript
thinkingConfig: useExactTools
  ? toolUseContext.options.thinkingConfig
  : { type: 'disabled' as const },
```

只有 fork 路径继承 thinking config，其他子 agent **强制禁用 thinking** 控成本。

陷阱（`forkedAgent.ts:51-55`）：如果 fork 调用方设置了 `maxOutputTokens`，会在 `claude.ts` 里 clamp `budget_tokens`，从而改变 thinking config 的有效值，破坏缓存相同性。文档明说：**只有不打算复用缓存时才设 maxOutputTokens**（如 compact summary）。

### 2.4 Messages 前缀：占位符大法

`buildForkedMessages()` (`forkSubagent.ts:107-169`) 是整个机制的精妙之处。它构造的消息序列：

```
[
  ...parent_history,                                    // 父亲完整历史
  assistant(全部 thinking + text + tool_use blocks),    // 父亲最后那条 assistant 消息（克隆）
  user(
    tool_result(placeholder) × N,    // 每个 tool_use 配一个占位符 result
    text(directive)                  // 唯一不同的 per-child 指令
  )
]
```

**关键约束** (`forkSubagent.ts:91-93`):
```typescript
const FORK_PLACEHOLDER_RESULT = 'Fork started — processing in background'
// Must be identical across all fork children for prompt cache sharing.
```

也就是说：**所有 fork 子的消息前缀字节相同**，只有最后一个 text block（directive）不同。如果父亲在同一轮里 spawn 5 个 fork，5 个 fork 共享前面所有的缓存，每个只为自己的 directive 付钱。

为什么要塞这些 placeholder 而不是直接拼一条 user 消息？因为父亲的最后一条 assistant 消息里有 `tool_use` blocks，按 Anthropic API 协议**必须**配对应的 `tool_result`，否则 API 会 400。这些占位符就是用来"凑数"的——等真实的子 agent 执行完，结果会回到父亲的对话历史里替换占位符。

### 2.5 防止递归 fork

Fork 子 agent 的工具池里**仍然包含 Agent tool**（因为要保持工具列表字节相同），所以理论上 fork 能再 fork。运行时通过两个机制阻止：

1. `isInForkChild(messages)`(`forkSubagent.ts:78`)：扫描消息历史里有没有 `<${FORK_BOILERPLATE_TAG}>` 标记
2. `options.querySource === 'agent:builtin:fork'` 检查（`runAgent.ts:688-694` 注释里说明）：survives autocompact，因为 autocompact 会重写 messages 但不动 context.options

两个机制并存：第一个在普通流程下足够，第二个是 autocompact 后的 fallback。

---

## 3. 子 agent 启动时继承了什么

**完整继承表**（fork vs 命名子 agent 的对比）：

| 属性 | Fork | 命名子 agent | 来源 |
|---|---|---|---|
| Messages history | ✅ 完整 | ❌ 仅 prompt | `AgentTool.tsx:512, 538` |
| System prompt | ✅ 父亲渲染好的字节 | ❌ `selectedAgent.getSystemPrompt()` 重算 | `:496-541` |
| Thinking config | ✅ | ❌ disabled | `runAgent.ts:682-684` |
| 工具池 | ✅ exact 引用 | ❌ `assembleToolPool` 重算 | `AgentTool.tsx:577, 627` |
| Model | ✅ inherit | 🟡 可被 model 参数覆盖 | `forkSubagent.ts:66` |
| Permission mode | ✅ `bubble`（冒泡到父终端） | 🟡 `selectedAgent.permissionMode` | `runAgent.ts:420-434` |
| CWD | 🟡 worktree 隔离 | 🟡 同上 / cwd 参数 | `AgentTool.tsx:590-593, 640` |
| MCP servers | ✅ 父亲的 + agent 自己的合并 | ✅ 同 | `runAgent.ts:649-664` |
| Memory base | - | 🟡 `selectedAgent.memory` 决定 scope | `AgentTool.tsx:523-531` |
| isNonInteractiveSession | ✅ 继承 | 🟡 async → true | `runAgent.ts:668-672` |
| AbortController | ❌ unlinked（独立） | ❌ unlinked | `AgentTool.tsx:694-696` 注释 |

### 3.1 AbortController 不继承的设计

`AgentTool.tsx:694` 附近的注释：
> "Don't link to parent's abort controller — background agents should survive when the user presses ESC to cancel the main thread."

后台子 agent 有独立生命周期。用户 ESC 取消主线程不应该杀掉后台 worker——要杀必须用 TaskStop tool 显式 kill。

---

## 4. 子 agent 怎么把结果返回

### 4.1 同步 vs 异步两条路

`AgentTool.tsx:141-156` 定义的 output schema 是个 union：

```typescript
syncOutputSchema   = { status: 'completed', result, prompt }
asyncOutputSchema  = { status: 'async_launched', agentId, outputFile, ... }
```

**同步路径**：父 agent 等子 agent 跑完，直接拿到 result string。

**异步路径**：返回 `{ status: 'async_launched', agentId, outputFile }`。子 agent 跑完后，结果以 **user-role `<task-notification>` 消息**的形式插入到父 agent 的对话历史里：

```xml
<task-notification>
<task-id>agent-a1b</task-id>
<status>completed|failed|killed</status>
<summary>...</summary>
<result>...</result>
<usage><total_tokens>N</total_tokens>...</usage>
</task-notification>
```

来源：`coordinatorMode.ts:148-160` 里有完整的 prompt 描述，让模型知道这是"看起来像 user message 但其实是系统通知"。

### 4.2 何时强制 async

`AgentTool.tsx:557-567` 列出 5 个强制 async 的条件（任一即可）：

```typescript
const forceAsync = isForkSubagentEnabled();          // fork gate 开了 → 全部 async
const assistantForceAsync = feature('KAIROS') && appState.kairosEnabled;
const shouldRunAsync = (
  run_in_background === true ||
  selectedAgent.background === true ||
  isCoordinator ||
  forceAsync ||
  assistantForceAsync ||
  proactiveModule?.isProactiveActive()
) && !isBackgroundTasksDisabled;
```

注释解释了为什么 KAIROS 模式要 force async（`AgentTool.tsx:559-565`）：
> "Synchronous subagents hold the main loop's turn open until they complete — the daemon's inputQueue backs up, and the first overdue cron catch-up on spawn becomes N serial subagent turns blocking all user input."

---

## 5. 并发模型：Coordinator Mode

`CLAUDE_CODE_COORDINATOR_MODE=1` 环境变量激活（`coordinatorMode.ts:36-41`）。在这个模式下：

- 主 agent 变成 **coordinator**（编排者），自己不写代码、不读文件
- 所有任务都通过 `Agent` tool spawn 给 **worker**（subagent_type: 'worker'）
- worker 在后台并发跑，结果以 `<task-notification>` 反馈
- coordinator 用 `SendMessage` 工具**继续**已完成的 worker（"continue vs spawn fresh"）

### 5.1 Coordinator 的两个工具

```
Agent       → 启动新 worker
SendMessage → 给已存在的 worker 发后续指令（复用其 context）
TaskStop    → 杀掉跑偏的 worker
```

### 5.2 Continue vs Spawn fresh

`coordinatorMode.ts:284-293` 给出明确决策表：

| 场景 | 选择 | 理由 |
|---|---|---|
| 研究阶段探索的恰好就是要改的文件 | **Continue** | worker 已有文件 + 现在拿到清晰 plan |
| 研究广泛但实施只动几个文件 | **Spawn fresh** | 避免拖着探索噪音 |
| 修正失败 / 延续刚做的工作 | **Continue** | worker 有错误上下文 |
| 验证另一个 worker 写的代码 | **Spawn fresh** | 验证者要 fresh eyes |
| 第一次实施方向完全错了 | **Spawn fresh** | 错误上下文污染重试 |

这个表是 prompt 写给模型看的，但反映了一个核心设计观点：**子 agent 的 context 既是资产也是负债**，要根据 overlap 决定。

### 5.3 跨 worker 共享：Scratchpad

`coordinatorMode.ts:104-106`：
```
Scratchpad directory: ${scratchpadDir}
Workers can read and write here without permission prompts.
Use this for durable cross-worker knowledge.
```

Worker 之间没有直接通信渠道，只能通过 coordinator 中介。Scratchpad 是个例外——一个共享目录，多个 worker 可以 read/write 而不弹权限。门控：`tengu_scratch` GrowthBook gate。

---

## 6. 隔离机制

### 6.1 Worktree 隔离

`AgentTool.tsx:590-593`：
```typescript
if (effectiveIsolation === 'worktree') {
  const slug = `agent-${earlyAgentId.slice(0, 8)}`;
  worktreeInfo = await createAgentWorktree(slug);
}
```

为子 agent 创建一个独立 git worktree，子 agent 的所有文件操作都在这个隔离副本里跑，不影响父亲的 working copy。

Fork + worktree 组合时（`AgentTool.tsx:598-602`），会注入 `buildWorktreeNotice()`：
> "You've inherited the conversation context above from a parent agent working in {parentCwd}. You are operating in an isolated git worktree at {worktreeCwd}... Paths in the inherited context refer to the parent's working directory; translate them to your worktree root. Re-read files before editing if the parent may have modified them..."

这是个有意思的细节：fork 子 agent 看到的"上下文里的文件路径"指向父亲的目录，但它实际工作在 worktree 里，需要自己翻译路径并重新读取（防止陈旧）。

### 6.2 Remote 隔离

`isolation: 'remote'`（仅 ant 内部）→ `teleportToRemote()` 把 agent 启动到远程 CCR 环境。总是异步。

### 6.3 权限继承的 3 条规则

`runAgent.ts:415-479` 的核心逻辑：

1. **Agent 定义可以指定 permission mode**，但**父亲是 bypassPermissions/acceptEdits/auto 时不被覆盖**（父亲已经"放开了"，子 agent 不能比父亲更严或更松，否则混淆）
2. **Bubble mode**：子 agent 触发权限提示时，不在子 agent 自己的上下文里弹，而是冒泡到父亲的终端让父亲批准。这是 fork 子 agent 的默认 mode。
3. **CLI rules 永不清除**（`runAgent.ts:466-468`）：
   > "Preserve cliArg rules (from SDK's --allowedTools) since those are explicit permissions from the SDK consumer that should apply to all agents."

   也就是 SDK 启动时 `--allowedTools` 给的权限对所有子 agent 强制有效。session-level rules 会被清掉防止泄露，但 CLI rules 不行。

---

## 7. 内置 Agent 清单

`builtInAgents.ts:22-72` 列出的内置 agent（按 gate 条件）：

| Agent | 工具 | 说明 |
|---|---|---|
| **general-purpose** | `['*']` 所有工具 | 通用 agent，任何研究/搜索/多步任务 |
| **statusline-setup** | Read, Edit | 配置 Claude Code 的状态行 |
| **Explore** *(gate `tengu_amber_stoat`)* | 除 Edit/Write/Agent/PlanMode 外全部 | 快速代码搜索专家。Ant 用户继承主模型；外部用户**强制 haiku**（速度优先） |
| **Plan** *(同 gate)* | 同 Explore | 规划任务专家 |
| **claude-code-guide** | Glob, Grep, Read, WebFetch, WebSearch | Claude Code 使用指南。**只在非 SDK 入口点**注册 |
| **Verification** *(gate `tengu_hive_evidence`)* | 自定义 | 验证 agent。**禁用 Agent tool 防止递归** |
| **Coordinator workers** | `ASYNC_AGENT_ALLOWED_TOOLS` | 仅 coordinator 模式下，由 `getCoordinatorAgents()` 动态返回 |

**SDK 用户特殊处理**：`CLAUDE_AGENT_SDK_DISABLE_BUILTIN_AGENTS=1` + 非交互模式 → 返回空数组（白板）。

---

## 8. Agent Memory 系统

子 agent 有自己独立的 memory 系统（不同于主 session memory）。

`agentMemory.ts:12-65` 定义了三种作用域：

| Scope | 路径 | 特点 |
|---|---|---|
| **user** | `~/.claude/agent-memory/<agentType>/` | 跨所有项目持久化 |
| **project** | `.claude/agent-memory/<agentType>/` | 项目级，**入版本控制** |
| **local** | `.claude/agent-memory-local/<agentType>/` 或 `$CLAUDE_CODE_REMOTE_MEMORY_DIR/projects/{hash}/...` | 不入版本 |

每个 agent 类型有独立的 memory 目录，互不干扰。Fork 不单独持久化（它本来就是父亲的延伸）。

---

## 9. 关键设计权衡（注释挖掘）

| # | 决策 | 文件 | 权衡 |
|---|---|---|---|
| 1 | Fork 占位符必须字节相同 | `forkSubagent.ts:91-93` | 牺牲完整性换缓存共享 |
| 2 | System prompt 字节线程化（不重算） | `forkSubagent.ts:54-58` | 避免 GrowthBook cold→warm 破坏缓存，代价是父亲必须提前渲染并暴露 |
| 3 | 后台 agent 不绑定父 abort controller | `AgentTool.tsx:694-696` | 用户 ESC 不杀后台 worker；要杀必须显式 TaskStop |
| 4 | CLI rules 永不清除 | `runAgent.ts:466-468` | SDK 消费者权限对所有 agent 强制，防止 agent 自治绕过 |
| 5 | thinking config 与缓存耦合 | `forkedAgent.ts:51-55` | maxOutputTokens 会通过 clamp budget_tokens 破坏缓存（隐式陷阱） |
| 6 | 工具池独立组装（非 fork 路径） | `AgentTool.tsx:568-577` 注释 | 子 agent 不受父亲工具限制影响；代价是不能复用父亲的工具序列化缓存 |
| 7 | Agent list 走 attachment 不走 tool description | `prompt.ts:48-58` | "动态 agent 列表 ~10.2% 的 fleet cache_creation tokens"——MCP 异步连接、reload-plugins、permission mode 改变都会变 list → tool schema cache 全废 |
| 8 | Fork 与 coordinator 模式互斥 | `forkSubagent.ts:34` | "coordinator 已经拥有编排角色和自己的委派模型" |
| 9 | Agent permission mode 不覆盖 parent 的 bypass/accept | `runAgent.ts:421-434` | 父亲已经放开的权限不被 agent 收紧（也不被进一步放开） |
| 10 | Subagent_type 不继承 leader 权限 | `runAgent.ts:573-577` | `assembleToolPool(workerPermissionContext, ...)` 用 agent 自己的 mode，不是父亲的 |

---

## 10. 数据流图

```
                  父 agent 调用 Agent tool
                         │
               ┌─────────┴─────────┐
               │ subagent_type 缺? │
               └─────────┬─────────┘
                         │
            ┌────────────┴───────────┐
            │ FORK_SUBAGENT gate?    │
            └────────────┬───────────┘
                         │
        ┌────────────────┼─────────────────┐
        │                │                 │
       是                │                 否
        │                │                 │
        ▼                │                 ▼
┌───────────────┐        │      ┌──────────────────┐
│   FORK 路径    │       │      │  命名子 agent 路径  │
├───────────────┤        │      ├──────────────────┤
│ • renderedSP  │        │      │ • getSystemPrompt│
│ • 父 messages  │       │      │ • createUserMsg  │
│ • exactTools  │        │      │ • assembleTools  │
│ • thinkConfig │        │      │ • thinking off   │
│ • bubble perm │        │      │ • own perm mode  │
│ • forced async│        │      │ • async optional │
└───────┬───────┘        │      └─────────┬────────┘
        │                │                │
        │       ┌────────┴────────┐       │
        │       │ coordinator mode?│      │
        │       └────────┬────────┘       │
        │                │                │
        │       ┌────────┴────────┐       │
        │       ▼                 ▼       │
        │   ┌────────┐     ┌────────┐    │
        │   │worker  │     │normal  │    │
        │   │(forced │     │subagent│    │
        │   │ async) │     └────┬───┘    │
        │   └───┬────┘          │        │
        │       │               │        │
        └───────┴───────┬───────┴────────┘
                        │
                        ▼
              ┌──────────────────┐
              │   runAgent()     │
              │   queryLoop      │ ← buildAgentSystemPrompt / mergedMcpClients
              └────────┬─────────┘
                       │
              ┌────────┴─────────┐
              │  isAsync?        │
              └────────┬─────────┘
                       │
            ┌──────────┼──────────┐
            ▼                     ▼
   ┌─────────────────┐   ┌──────────────────┐
   │ 同步: 等结果     │   │ 异步: 注册 task   │
   │ → 直接返回       │   │ → outputFile      │
   │   {completed,    │   │ → 后台 queryLoop  │
   │    result}       │   │ → 完成时           │
   └─────────────────┘   │   <task-notif>    │
                         │   插入父对话        │
                         └──────────────────┘
```

---

## 11. 与其他 agent 框架的对比启示

| 维度 | Claude Code | OpenAI Codex CLI | Cursor / Continue |
|---|---|---|---|
| Sub-agent 抽象 | ✅ Agent tool + 4 形态 | ❌ 单循环 | 🟡 有但简单 |
| Fork (cache 复用) | ✅ buildForkedMessages | ❌ | ❌ |
| 并发 worker | ✅ Coordinator mode | ❌ | ❌ |
| 异步通知模型 | ✅ `<task-notification>` | ❌ | ❌ |
| 工作目录隔离 | ✅ git worktree | ❌ | ❌ |
| 权限冒泡 | ✅ bubble mode | - | - |

Claude Code 在子 agent 这块的工程化深度明显领先。Fork 这种细节（system prompt 字节线程化 / 占位符 placeholder 一致 / thinking config 耦合警告）几乎是 Anthropic 对 prompt cache 机制内部理解的直接产物。

---

## 12. 阅读顺序建议

首次读这个子系统：

1. `forkSubagent.ts` 全部（210 行）— 看 fork 是什么
2. `AgentTool.tsx:483-636` — 看 fork vs normal 的分支
3. `runAgent.ts:410-720` — 看子 agent 怎么真正启动
4. `forkedAgent.ts:46-113` — 看 CacheSafeParams 和 maxOutputTokens 陷阱
5. `coordinatorMode.ts` 全部 — 看协调模式 prompt 长什么样
6. `prompt.ts:80-155` — 看模型看到的 fork 使用说明
7. `builtInAgents.ts` — 看内置清单
