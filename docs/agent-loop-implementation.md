# Agent Loop + 工具反馈的代码实现

本文档基于 free-code45 (Claude Code v2.1.87) 源码，详细分析 Agent Loop 的实现机制。通过一个具体例子（Blender 插件调试）对照代码，说明哪些步骤在代码中有体现、哪些在代码之外（由模型和训练数据承载）。

---

## 目录

1. [核心概念](#1-核心概念)
2. [代码架构](#2-代码架构)
3. [主循环完整实现](#3-主循环完整实现)
4. [数据流与调用关系](#4-数据流与调用关系)
5. [结合 Blender 调试例子](#5-结合-blender-调试例子)
6. [代码中能体现的步骤](#6-代码中能体现的步骤)
7. [代码中不能体现的部分](#7-代码中不能体现的部分)
8. [关键设计决策](#8-关键设计决策)

---

## 1. 核心概念

**Agent Loop** = 让大模型在循环中不断"看 → 想 → 做 → 看结果 → 再想 → 再做"直到任务完成。

```
用户输入
  ↓
[Loop start]
  ↓
发送消息给 Claude API（含历史对话 + 工具定义）
  ↓
Claude 返回：文本 + 工具调用请求（tool_use blocks）
  ↓
有工具调用？
  ├─ 否 → 返回最终答案，退出循环
  └─ 是 → 执行工具 → 将结果作为新消息加入历史 → 回到 Loop start
```

**关键洞察**：模型本身是**无状态**的，每一次 API 调用都是独立的。"连续对话"是由客户端通过**累积消息历史**模拟出来的。Agent loop 就是这个累积+调用+再累积的过程。

---

## 2. 代码架构

### 核心文件

| 文件 | 职责 | 关键函数 |
|---|---|---|
| `src/query.ts` | 主循环实现 | `queryLoop()` 异步生成器 |
| `src/services/tools/StreamingToolExecutor.ts` | 流式工具执行器 | `addTool()`, `executeTool()` |
| `src/services/tools/toolOrchestration.ts` | 工具编排 | `runTools()`, `runToolsConcurrently()` |
| `src/services/tools/toolExecution.ts` | 单个工具执行 | `runToolUse()` |
| `src/Tool.ts` | 工具抽象 | Tool 类型定义、工具注册表 |
| `src/hooks/useCanUseTool.tsx` | 权限检查 | `canUseTool()` |
| `src/services/api/claude.ts` | API 调用 | `queryModelWithStreaming()` |

### 架构图

```
┌─────────────────────────────────────────────────────────┐
│                    queryLoop() [query.ts]               │
│                   主循环（async generator）              │
│                                                         │
│  ┌───────────────────────────────────────────────────┐  │
│  │  while (true) {                                   │  │
│  │    1. 调用 API → queryModelWithStreaming()        │  │
│  │    2. 收集 assistantMessages + toolUseBlocks      │  │
│  │    3. 判断是否需要工具执行                         │  │
│  │    4. 执行工具 → StreamingToolExecutor            │  │
│  │       └─ 权限检查 → canUseTool()                  │  │
│  │       └─ 真正执行 → runToolUse()                  │  │
│  │    5. 追加 tool_result 到 messages                │  │
│  │    6. 判断是否继续循环                             │  │
│  │       ├─ 有新工具调用 → continue                  │  │
│  │       └─ 无 → return (completed)                  │  │
│  │  }                                                │  │
│  └───────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
         ↓                    ↓                    ↓
┌─────────────────┐  ┌──────────────────┐  ┌───────────────┐
│ claude.ts       │  │ StreamingTool    │  │ Tool.ts       │
│ API 调用 +       │  │ Executor         │  │ 工具注册表     │
│ 流式响应处理      │  │ 并发/串行控制     │  │ Zod schema    │
└─────────────────┘  └──────────────────┘  └───────────────┘
                              ↓
                     ┌──────────────────┐
                     │ tools/*.ts       │
                     │ 具体工具实现      │
                     │ (Read, Bash,     │
                     │  Edit, Grep...)  │
                     └──────────────────┘
```

---

## 3. 主循环完整实现

### 3.1 入口：`queryLoop()` 异步生成器

**文件**: `src/query.ts:241-1728`

```typescript
async function* queryLoop(
  params: QueryParams,
  consumedCommandUuids: string[],
): AsyncGenerator<...> {
  // 可变状态（跨迭代）
  let state: State = {
    messages: params.messages,           // 对话历史
    toolUseContext: params.toolUseContext,
    turnCount: 1,                        // 当前第几轮
    // ... 其他追踪字段
  }

  while (true) {
    const { messages, turnCount } = state

    // ═══ Step 1: 发送 API 请求 ═══
    yield { type: 'stream_request_start' }

    const stream = queryModelWithStreaming({
      messages: normalizeMessagesForAPI(messages),
      systemPrompt,
      tools: toolUseContext.options.tools,
      thinkingConfig,
      // ...
    })

    // ═══ Step 2: 流式接收响应 ═══
    const assistantMessages: AssistantMessage[] = []
    const toolUseBlocks: ToolUseBlock[] = []
    let needsFollowUp = false

    for await (const event of stream) {
      if (event.type === 'content_block_start' && event.content_block.type === 'tool_use') {
        toolUseBlocks.push(event.content_block)
        needsFollowUp = true

        // 流式执行（可选）：tool_use 块一到就开始执行
        if (streamingToolExecutor) {
          streamingToolExecutor.addTool(event.content_block, currentMessage)
        }
      }
      yield event  // 流式事件实时传给 UI
    }

    // ═══ Step 3: 判断是否需要工具 ═══
    if (!needsFollowUp) {
      // 没有工具调用 → 这一轮是纯文本回答，结束循环
      return { reason: 'completed' }
    }

    // ═══ Step 4: 执行工具 ═══
    const toolResults: UserMessage[] = []
    const toolUpdates = streamingToolExecutor
      ? streamingToolExecutor.getRemainingResults()
      : runTools(toolUseBlocks, assistantMessages, canUseTool, toolUseContext)

    for await (const update of toolUpdates) {
      if (update.message) {
        yield update.message  // 实时输出到 UI
        toolResults.push(update.message)
      }
    }

    // ═══ Step 5: 检查各种停止条件 ═══
    if (turnCount >= maxTurns) {
      return { reason: 'max_turns_reached' }
    }
    if (toolUseContext.abortController.signal.aborted) {
      return { reason: 'aborted' }
    }

    // ═══ Step 6: 构造下一轮状态，继续循环 ═══
    state = {
      ...state,
      messages: [...messages, ...assistantMessages, ...toolResults],
      turnCount: turnCount + 1,
    }
    // 回到 while (true) 顶部
  }
}
```

### 3.2 StreamingToolExecutor：边接收边执行

**文件**: `src/services/tools/StreamingToolExecutor.ts`

核心思路：**不等完整响应，只要 tool_use 块一到就开始执行**。这样当 API 还在流式输出后续内容时，工具已经在执行了，节省时间。

```typescript
class StreamingToolExecutor {
  addTool(block: ToolUseBlock, message: AssistantMessage) {
    // 1. Zod schema 验证输入
    const parsed = toolDefinition.inputSchema.safeParse(block.input)

    // 2. 判断是否并发安全
    const isConcurrencySafe = tool.isConcurrencySafe?.() ?? false

    // 3. 入队
    this.queue.push({ block, message, isConcurrencySafe })

    // 4. 触发处理队列
    this.processQueue()
  }

  async processQueue() {
    // 并发安全的工具并行执行
    // 非并发安全的工具必须等前面的完成
    for (const item of this.queue) {
      if (item.isConcurrencySafe) {
        this.executeTool(item)  // 不 await，并行
      } else {
        await this.waitForPrevious()
        await this.executeTool(item)
      }
    }
  }

  async executeTool(item: QueueItem) {
    // 1. 权限检查
    const permission = await canUseTool(tool, item.block.input, context)
    if (permission === 'deny') {
      return errorResult('Permission denied')
    }

    // 2. 真正执行
    try {
      const result = await tool.call(item.block.input, context, ...)
      this.results.push(result)
    } catch (err) {
      // 3. 错误捕获 → 转为 tool_result 返回给模型
      this.results.push({
        type: 'tool_result',
        tool_use_id: item.block.id,
        content: err.message,
        is_error: true,
      })
    }
  }
}
```

### 3.3 工具注册：`Tool.ts`

**文件**: `src/Tool.ts`

每个工具是一个实现了 `Tool` 接口的对象：

```typescript
interface Tool<Input, Output> {
  name: string                          // 工具名（Claude 调用时用）
  description: () => Promise<string>    // 工具描述（告诉 Claude 怎么用）
  inputSchema: ZodSchema<Input>         // 输入 schema（转 JSON Schema 发给 API）

  isConcurrencySafe?: () => boolean     // 是否可并发执行
  isReadOnly?: () => boolean             // 是否只读（影响权限）

  call(
    input: Input,
    context: ToolUseContext,
    canUseTool: CanUseToolFn,
    parentMessage: AssistantMessage,
    onProgress?: (p: Progress) => void
  ): AsyncGenerator<ToolResult<Output>>  // 实际执行逻辑
}
```

**注册方式**：在 `tools.ts` 中把所有 Tool 对象塞进一个数组：

```typescript
export const TOOLS: Tool[] = [
  BashTool,
  FileReadTool,
  FileEditTool,
  FileWriteTool,
  GrepTool,
  GlobTool,
  AgentTool,
  WebSearchTool,
  WebFetchTool,
  // ...
]
```

发送 API 请求时，把每个工具的 `name + description + inputSchema(转JSON Schema)` 一起发出去，Claude 就"知道"有哪些工具可以用。

---

## 4. 数据流与调用关系

### 完整调用链

```
用户输入 "帮我修复 Blender 插件的腿抖动问题"
   │
   ▼
┌────────────────────────────────────────────────────┐
│ query() / queryLoop() [query.ts:241]               │
│                                                     │
│ ━━━━━━━━━ 迭代 1 ━━━━━━━━━                         │
│                                                     │
│ ①  normalizeMessagesForAPI(messages)                │
│    └─ 规范化消息格式供 API 使用                     │
│                                                     │
│ ②  queryModelWithStreaming() [claude.ts:1596]       │
│    ├─ 构建 API 请求                                │
│    │  ├─ thinking: { type: 'adaptive' }            │
│    │  ├─ tools: [Read, Bash, Grep, Edit, ...]      │
│    │  ├─ output_config: { effort: 'high' }         │
│    │  └─ messages: [...历史对话]                    │
│    └─ 返回流式响应                                  │
│                                                     │
│ ③  流式处理 [claude.ts:2020-2170]                   │
│    ├─ content_block_start → tool_use 块            │
│    │  └─ streamingToolExecutor.addTool(block)      │
│    │     └─ 立即开始执行（不等流完）                │
│    ├─ thinking_delta → 累积到 thinking 块          │
│    ├─ text_delta → 累积到 text 块                  │
│    └─ message_stop                                 │
│                                                     │
│ ④  StreamingToolExecutor.getRemainingResults()      │
│    └─ 等所有工具执行完成                            │
│       └─ 每个工具：                                 │
│          1. canUseTool() 权限检查                   │
│          2. tool.call(input, context)               │
│          3. 收集 ToolResult                         │
│                                                     │
│ ⑤  yield tool results → UI 实时显示                 │
│                                                     │
│ ⑥  检查停止条件                                     │
│    ├─ maxTurns 达到？→ return                      │
│    ├─ aborted？→ return                            │
│    ├─ needsFollowUp === false？→ return            │
│    └─ 否则 → 构造新 state，continue                 │
│                                                     │
│ ━━━━━━━━━ 迭代 2 ━━━━━━━━━                         │
│ state.messages 现在包含：                           │
│   [原历史] + [assistant 消息 + tool_use] +          │
│   [user 消息 + tool_result]                        │
│                                                     │
│ 继续 ①②③④⑤⑥... 直到完成                           │
└────────────────────────────────────────────────────┘
```

### 消息历史的增长

```
迭代 1 开始:
  messages = [
    { role: 'user', content: '帮我修复 Blender 插件...' }
  ]

迭代 1 结束后:
  messages = [
    { role: 'user', content: '帮我修复 Blender 插件...' },
    { role: 'assistant', content: [
        { type: 'thinking', text: '让我先看看代码...' },
        { type: 'text', text: '我先读一下插件代码' },
        { type: 'tool_use', id: 'tu_1', name: 'Read',
          input: { file_path: 'xps_to_pmx/bone_setup.py' } }
    ]},
    { role: 'user', content: [
        { type: 'tool_result', tool_use_id: 'tu_1',
          content: '...文件内容...' }
    ]}
  ]

迭代 2 开始时，这整个历史都会再次发给 API
```

---

## 5. 结合 Blender 调试例子

假设用户说："帮我修复 Blender 插件的腿抖动，顺便看看这张截图 [图片]"

### 时序图

```
┌──────┐                ┌──────────┐                ┌──────┐
│ User │                │queryLoop │                │Claude│
│      │                │          │                │ API  │
└──┬───┘                └────┬─────┘                └───┬──┘
   │                         │                          │
   │ "帮我修复腿抖动"+截图     │                          │
   ├─────────────────────────▶                          │
   │                         │                          │
   │                         │ API call (含截图+tools)   │
   │                         ├──────────────────────────▶
   │                         │                          │
   │                         │ ← thinking: "看起来是..." │
   │                         │ ← text: "我先看代码"      │
   │                         │ ← tool_use(Read)          │
   │                         │◀──────────────────────────
   │                         │                          │
   │                         │ 执行 Read 工具            │
   │                         │ (调用文件系统)             │
   │                         │                          │
   │                         │ tool_result: 文件内容     │
   │                         │                          │
   │                         │ continue loop             │
   │                         │                          │
   │                         │ API call (历史+新结果)    │
   │                         ├──────────────────────────▶
   │                         │                          │
   │                         │ ← text: "发现问题在..."   │
   │                         │ ← tool_use(Edit)          │
   │                         │◀──────────────────────────
   │                         │                          │
   │                         │ 执行 Edit 工具            │
   │                         │ tool_result: 修改成功     │
   │                         │                          │
   │                         │ continue loop             │
   │                         │                          │
   │                         │ API call (历史+新结果)    │
   │                         ├──────────────────────────▶
   │                         │                          │
   │                         │ ← text: "修改完成，请测试" │
   │                         │ ← stop_reason: "end_turn" │
   │                         │◀──────────────────────────
   │                         │                          │
   │                         │ needsFollowUp === false   │
   │                         │ return                    │
   │                         │                          │
   │ "修改完成，请测试"         │                          │
   │◀────────────────────────┤                          │
   │                         │                          │
   │ 用户在 Blender 里测试     │                          │
   │ 还是抖动，发新截图        │                          │
   ├─────────────────────────▶                          │
   │                         │ 新的 queryLoop 开始...    │
```

---

## 6. 代码中能体现的步骤

以下步骤在 free-code45 源码中有明确的代码对应：

### ✅ 6.1 消息历史累积

**代码位置**: `query.ts:1715-1727`

```typescript
state = {
  ...state,
  messages: [...messages, ...assistantMessages, ...toolResults],
  turnCount: turnCount + 1,
}
```

每一轮的 assistant 消息和 tool 结果都被追加到 messages 数组。下一轮 API 调用时整个历史一起发送。

### ✅ 6.2 工具调用的触发

**代码位置**: `query.ts:829-842`

```typescript
if (event.type === 'content_block_start' && event.content_block.type === 'tool_use') {
  toolUseBlocks.push(event.content_block)
  needsFollowUp = true
  streamingToolExecutor?.addTool(event.content_block, currentMessage)
}
```

流式响应中只要遇到 `tool_use` 块就触发执行。

### ✅ 6.3 工具执行与结果收集

**代码位置**: `StreamingToolExecutor.ts:265` + `toolExecution.ts`

```typescript
async executeTool(item) {
  const permission = await canUseTool(tool, item.block.input, context)
  if (permission !== 'allow') return errorResult()

  try {
    const result = await tool.call(item.block.input, context)
    this.results.push(result)
  } catch (err) {
    this.results.push({ type: 'tool_result', is_error: true, content: err.message })
  }
}
```

### ✅ 6.4 循环终止条件

**代码位置**: `query.ts:1062, 1357, 1485, 1705`

```typescript
// 条件 1: 没有工具调用
if (!needsFollowUp) {
  return { reason: 'completed' }
}

// 条件 2: 达到最大轮数
if (turnCount >= maxTurns) {
  return { reason: 'max_turns_reached' }
}

// 条件 3: 用户中断
if (toolUseContext.abortController.signal.aborted) {
  return { reason: 'aborted' }
}
```

### ✅ 6.5 错误反馈给模型

**代码位置**: `toolExecution.ts:400`

当工具抛异常时，错误被序列化成 `tool_result` 块（`is_error: true`），作为 user 消息发回给 Claude。**Claude 能看到错误描述，决定下一步怎么办**（重试、换方法、放弃）。

这是"自我纠错"的代码基础：错误不会让系统崩溃，而是变成信息反馈给模型。

### ✅ 6.6 权限门禁

**代码位置**: `hooks/useCanUseTool.tsx:28-42`

```typescript
export function canUseTool(tool, input, context): PermissionDecision {
  // allow / deny / ask
  // ask 会弹权限对话框
}
```

### ✅ 6.7 并发与串行控制

**代码位置**: `toolOrchestration.ts:19`

```typescript
function runTools(blocks, ...) {
  const { concurrent, serial } = partition(blocks, isConcurrencySafe)
  return [
    ...runToolsConcurrently(concurrent),  // 并行
    ...runToolsSerially(serial),          // 串行
  ]
}
```

### ✅ 6.8 上下文窗口保护

**代码位置**: `services/compact/autoCompact.ts`

每一轮循环都会检查 token 用量。如果接近上下文窗口，触发 microCompact 或 compact，压缩历史消息。

### ✅ 6.9 工具 schema 发送给 API

**代码位置**: `Tool.ts` + `claude.ts`

每个工具的 Zod schema 被转换成 JSON Schema，作为 API 请求的 `tools` 参数发送。Claude 因此"知道"有哪些工具可用、每个工具接受什么参数。

### ✅ 6.10 流式输出到 UI

**代码位置**: `query.ts:yield` 语句遍布全文

`queryLoop` 是个 `AsyncGenerator`，每个关键节点都 `yield` 事件（流式开始、消息块、工具结果）。UI 层订阅这个生成器实时渲染。

---

## 7. 代码中不能体现的部分

以下是"聪明"感的来源，但它们不在 free-code45 的代码里——而是在**模型权重**、**训练数据**、或 **API 服务端**。

### ❌ 7.1 模型的"决策过程"

**代码中没有**：为什么 Claude 看到截图会想到"D-bone 约束问题"？

**真相**：这发生在 Claude 模型内部，通过注意力层对"截图中的骨骼视觉特征"和"训练数据里 MMD 调试讨论"的关联计算得出。**代码只负责传输数据**——截图变 base64、工具 schema 变 JSON——至于模型怎么"想"，代码看不见。

**在代码中能看到的**：
- 截图被打包进 API 请求（`claude.ts` 的 message content 构建）
- 工具 schema 被打包进 API 请求
- 响应里有 `text` 和 `tool_use` 块

**在代码中看不到的**：
- 为什么模型选择了 Read 而不是 Grep
- 为什么模型推理出"先读代码再改"而不是"直接改"
- 模型内部的所有思考过程（即使有 thinking 块，那也只是思考的**文字输出**，底层的权重计算看不见）

### ❌ 7.2 多模态理解

**代码中没有**：截图怎么变成可理解的视觉信息？

**真相**：
1. 截图被编码成 base64 + 打包进 `image` 块
2. 发送到 Claude API
3. **服务端**的视觉编码器（ViT）把图像切成 patch，每个 patch 变成 token
4. 这些视觉 token 和文字 token 一起送进语言模型
5. 注意力机制让"抖动"这个文字关注到腿部的视觉 patch
6. 模型生成响应

代码只做第 1-2 步和接收第 6 步。**视觉编码发生在 API 服务器上**，对客户端是黑盒。

### ❌ 7.3 模型的"领域知识"

**代码中没有**：为什么 Claude 知道 PMX 格式、D-bone、MMD 骨骼结构？

**真相**：这些知识在**模型权重**里——训练时见过大量相关讨论、教程、代码、论坛帖子。模型权重文件通常是几十到几百 GB，这些"知识"以浮点数矩阵的形式存储在里面。free-code45 的代码是**使用者**，不包含也不能修改这些知识。

### ❌ 7.4 "从现象到方案"的映射

**代码中没有**：看到"腿抖动" → 想到"可能是 D-bone 约束"的映射表。

**真相**：不存在这样的映射表。这是模型在训练时从大量"症状-原因-解决方案"的文本对中**统计学习**到的。每个神经元都参与编码部分信息，没有明确的"如果腿抖动就建议查约束"规则。

### ❌ 7.5 Chain of Thought 的"内部逻辑"

**代码中能看到的**：`thinking` 块的字符串内容（经过流式累积）。

**代码中看不到的**：为什么思考内容是那样的。思考内容是模型自己"生成"的——用它生成普通文本的同一套机制。"思考"和"回答"的唯一区别是训练时它们被标注了不同的 token 类型。

### ❌ 7.6 模型的"自我纠错"能力

**代码中能看到的**：
- 错误作为 tool_result 发回给模型（`toolExecution.ts`）
- 下一轮 API 调用会带上这个错误（`query.ts` 累积 messages）

**代码中看不到的**：
- 模型看到错误后**怎么决定**要换方法
- 模型**判断**上一个方法为什么错的推理

代码只是把错误原封不动发回去。"看到错误然后想出新方案"完全发生在模型内部。

### ❌ 7.7 "试 5 次才成功"的底层原因

Insights 报告里提到 Blender 调试需要 ~5 次失败。为什么？

**代码中的原因**（能解释）：
- Agent loop 正确地把失败反馈给了模型
- 模型每次都提出了新方案
- 直到第 5 次才成功

**代码外的原因**（更根本）：
- PMX/MMD 是小众领域，训练数据稀疏
- 空间推理是 LLM 的弱项
- 从截图提取信息有局限（看不清数值参数）
- 每次尝试只能得到局部反馈，无法一次推导出完整答案

这些底层原因 **没法通过改代码解决**——它们是模型本身的能力边界。

---

## 8. 关键设计决策

### 8.1 为什么用 async generator？

**文件**: `src/query.ts:241`

`queryLoop` 是 `AsyncGenerator`，每一步都 `yield` 事件。这样的设计带来：

1. **流式 UI**：UI 不用等整个循环结束，能实时显示每个 token 和工具执行
2. **中断友好**：外部可以调用 `generator.return()` 中止循环
3. **测试友好**：可以逐步 consume 事件流做断言

### 8.2 为什么有 StreamingToolExecutor？

**文件**: `src/services/tools/StreamingToolExecutor.ts`

不等完整响应，只要 tool_use 块一到就开始执行。这节省了"等流完→开始执行"的延迟。对于多个工具调用的场景（比如"读 5 个文件然后分析"），并发执行显著加速。

### 8.3 为什么工具结果也用 user 角色？

**API 约定**：`tool_result` 必须包裹在 `user` 消息里。这是 Anthropic API 的设计——只有两种 role：user 和 assistant。

```typescript
{
  role: 'user',
  content: [
    { type: 'tool_result', tool_use_id: '...', content: '...' }
  ]
}
```

这让消息历史永远是 user/assistant 交替，简化了 API 协议。

### 8.4 为什么错误要作为 tool_result 而不是抛异常？

**代码位置**: `toolExecution.ts:400`

如果抛异常，整个 agent loop 崩溃，用户要重新开始。把错误序列化成 tool_result：

1. 模型能看到错误，尝试纠正
2. 用户能看到完整的失败过程
3. 历史记录完整，便于调试

这是典型的"让错误成为一等公民"设计。

### 8.5 为什么 maxTurns 存在？

**代码位置**: `query.ts:1705`

没有这个限制，一个不收敛的循环可能一直调用 API，烧 token、烧 rate limit。`maxTurns`（默认通常 20-50）是安全阀，防止失控。

---

## 附录：关键代码行索引

| 功能 | 文件 | 行号 |
|---|---|---|
| 主循环入口 | query.ts | 241 |
| 循环状态初始化 | query.ts | 268-279 |
| API 调用点 | query.ts | 337+ |
| tool_use 块检测 | query.ts | 829-834 |
| 流式工具执行触发 | query.ts | 838-842 |
| 工具结果收集 | query.ts | 1380-1408 |
| 无工具→结束 | query.ts | 1062 |
| 最大轮数检查 | query.ts | 1705 |
| 状态更新 | query.ts | 1715-1727 |
| Thinking 参数构建 | claude.ts | 1596-1630 |
| Thinking 流式处理 | claude.ts | 2020-2170 |
| StreamingExecutor 入队 | StreamingToolExecutor.ts | 76 |
| 工具执行 | StreamingToolExecutor.ts | 265 |
| 权限检查 | useCanUseTool.tsx | 28-42 |
| 工具编排 | toolOrchestration.ts | 19 |
| 工具错误捕获 | toolExecution.ts | 400 |

---

## 总结

**代码负责"管道"，模型负责"智能"。**

Agent Loop 的代码实现本质上是一个可靠的数据管道：
- 把消息、工具定义、用户输入打包发给 API
- 接收响应，解析 tool_use 块，执行对应工具
- 把结果打包回传，重复直到完成
- 处理各种边界情况（超时、中断、错误、配额）

真正的"聪明"——看截图知道是 D-bone 问题、根据错误换方法、理解 PMX 格式——**都不在代码里**，而在模型权重和训练数据里。

代码和模型的协作关系类似**操作系统和应用程序**：
- OS 提供进程调度、内存管理、IO 接口（对应 agent loop、工具执行、消息管理）
- App 实现业务逻辑（对应模型的推理和决策）
- OS 无法理解 App 在做什么，但能保证 App 有正确的运行环境

理解这个分工很重要：
- 想改进 Agent 行为（更少错误、更好策略）→ 改模型或 prompt，改代码没用
- 想加新工具、新集成、新权限 → 改代码，模型会自动学会用
- 想让 Agent 更快、更稳定 → 改代码（并发、缓存、重试）
