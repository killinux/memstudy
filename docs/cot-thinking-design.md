# Claude Code Extended Thinking（CoT）设计详解

本文档基于 free-code45（Claude Code v2.1.87）源码，详细分析 Chain of Thought（CoT）/ Extended Thinking 系统的完整设计。

---

## 目录

1. [系统总览](#1-系统总览)
2. [三层架构](#2-三层架构)
3. [第一层：ThinkingConfig — 思考模式控制](#3-第一层thinkingconfig--思考模式控制)
4. [第二层：Effort — 思考深度控制](#4-第二层effort--思考深度控制)
5. [第三层：Ultrathink — 关键词触发的深度思考](#5-第三层ultrathink--关键词触发的深度思考)
6. [API 请求构建](#6-api-请求构建)
7. [流式响应处理](#7-流式响应处理)
8. [Thinking 块的存储与消息规范化](#8-thinking-块的存储与消息规范化)
9. [密码学签名机制](#9-密码学签名机制)
10. [Redacted Thinking — 思考内容隐藏](#10-redacted-thinking--思考内容隐藏)
11. [Thinking Clear — 长时间闲置后的思考清理](#11-thinking-clear--长时间闲置后的思考清理)
12. [子 Agent 的思考继承策略](#12-子-agent-的思考继承策略)
13. [压缩系统中的思考处理](#13-压缩系统中的思考处理)
14. [UI 展示](#14-ui-展示)
15. [完整生命周期示例](#15-完整生命周期示例)
16. [模型参数速查表](#16-模型参数速查表)
17. [关键设计决策总结](#17-关键设计决策总结)

---

## 1. 系统总览

Extended Thinking 让 Claude 在输出最终回答之前，先进行一段内部推理（类似人类的"先想再说"）。这段推理内容以 `thinking` 块的形式返回给客户端，用户可以选择查看或隐藏。

在 Claude Code 中，这套系统由三层组成：

```
┌─────────────────────────────────────────────────┐
│  第三层：Ultrathink（关键词触发器）                │
│  用户输入 "ultrathink" → 本轮 effort 提升到 high  │
├─────────────────────────────────────────────────┤
│  第二层：Effort（思考深度）                       │
│  low / medium / high / max → API output_config   │
├─────────────────────────────────────────────────┤
│  第一层：ThinkingConfig（思考模式）               │
│  adaptive / enabled+budget / disabled → API thinking │
└─────────────────────────────────────────────────┘
```

- **ThinkingConfig** 决定"是否思考"以及"思考模式"
- **Effort** 决定"思考多深"
- **Ultrathink** 是用户手动触发深度思考的快捷方式

三者是独立的 API 参数，互不干扰。

---

## 2. 三层架构

### 核心文件清单

| 文件 | 职责 |
|---|---|
| `src/utils/thinking.ts` | ThinkingConfig 类型定义、模型能力检测、ultrathink 关键词检测 |
| `src/utils/effort.ts` | Effort 等级管理、优先级链、模型默认 effort |
| `src/services/api/claude.ts` | API 请求构建、流式响应处理、thinking 参数组装 |
| `src/utils/context.ts` | 模型输出 token 上限、thinking 预算计算 |
| `src/utils/messages.ts` | thinking 块的过滤、规范化、签名清理 |
| `src/utils/attachments.ts` | ultrathink attachment 创建 |
| `src/utils/betas.ts` | redacted_thinking beta header 管理 |
| `src/components/messages/AssistantThinkingMessage.tsx` | thinking 块 UI 渲染 |
| `src/tools/AgentTool/runAgent.ts` | 子 agent thinking 继承策略 |
| `src/services/compact/microCompact.ts` | 压缩时 thinking 块 token 计数 |

---

## 3. 第一层：ThinkingConfig — 思考模式控制

**文件**: `src/utils/thinking.ts`

### 类型定义

```typescript
type ThinkingConfig =
  | { type: 'adaptive' }               // 自适应：模型自己决定思考多少
  | { type: 'enabled'; budgetTokens: number }  // 固定预算：限制思考 token 数
  | { type: 'disabled' }               // 关闭：不思考
```

### 初始化流程

**文件**: `src/main.tsx:2456-2488`

ThinkingConfig 在会话启动时构建，优先级从高到低：

```
1. CLI 参数 options.thinking（'adaptive' | 'enabled' | 'disabled'）
2. 环境变量 MAX_THINKING_TOKENS（> 0 则 enabled，= 0 则 disabled）
3. CLI 参数 options.maxThinkingTokens
4. 用户设置 settings.alwaysThinkingEnabled
5. 默认值：shouldEnableThinkingByDefault() → true（启用 adaptive）
```

### shouldEnableThinkingByDefault()

**文件**: `src/utils/thinking.ts:146-162`

```typescript
export function shouldEnableThinkingByDefault(): boolean {
  // 环境变量优先
  if (process.env.MAX_THINKING_TOKENS) {
    return parseInt(process.env.MAX_THINKING_TOKENS, 10) > 0
  }
  // 用户设置其次
  const { settings } = getSettingsWithErrors()
  if (settings.alwaysThinkingEnabled === false) {
    return false
  }
  // 默认启用
  return true
}
```

### 模型能力检测

**文件**: `src/utils/thinking.ts:90-144`

两个关键函数：

#### modelSupportsThinking(model)

判断模型是否支持 thinking：

| 模型 | 1P / Foundry | 3P (Bedrock/Vertex) |
|---|---|---|
| Claude 4.6 (Opus/Sonnet) | 支持 | 支持 |
| Claude 4 (Opus/Sonnet) | 支持 | 支持 |
| Haiku 4.5 | 支持 | 不支持 |
| Claude 3.x | 不支持 | 不支持 |

```typescript
// 1P/Foundry: 所有 Claude 4+ 模型
if (provider === 'foundry' || provider === 'firstParty') {
  return !canonical.includes('claude-3-')
}
// 3P: 仅 Opus 4+ 和 Sonnet 4+
return canonical.includes('sonnet-4') || canonical.includes('opus-4')
```

#### modelSupportsAdaptiveThinking(model)

判断模型是否支持自适应思考（无预算限制）：

```typescript
// 仅 4.6+ 模型支持 adaptive
if (canonical.includes('opus-4-6') || canonical.includes('sonnet-4-6')) {
  return true
}
// 其他已知模型（opus/sonnet/haiku 旧版）不支持
// 未知模型在 1P/Foundry 上默认支持（为了新模型测试不受影响）
```

---

## 4. 第二层：Effort — 思考深度控制

**文件**: `src/utils/effort.ts`

### Effort 等级

```typescript
const EFFORT_LEVELS = ['low', 'medium', 'high', 'max'] as const
```

| 等级 | 描述 | 适用模型 |
|---|---|---|
| `low` | 快速直接，最少开销 | 所有 4.6+ |
| `medium` | 平衡速度和质量 | 所有 4.6+（Opus 4.6 默认） |
| `high` | 全面实现 + 充分测试 | 所有 4.6+（API 默认） |
| `max` | 最深度推理 | 仅 Opus 4.6 |

### 优先级链

**文件**: `src/utils/effort.ts:152-167`

```typescript
export function resolveAppliedEffort(model, appStateEffortValue) {
  // 1. 环境变量最高优先
  const envOverride = getEffortEnvOverride()  // CLAUDE_CODE_EFFORT_LEVEL
  if (envOverride === null) return undefined   // 'unset' 显式禁用

  // 2. 应用状态（用户在 UI 中的选择）
  // 3. 模型默认值
  const resolved = envOverride ?? appStateEffortValue ?? getDefaultEffortForModel(model)

  // API 不允许非 Opus 4.6 使用 'max'，自动降级为 'high'
  if (resolved === 'max' && !modelSupportsMaxEffort(model)) {
    return 'high'
  }
  return resolved
}
```

### 模型默认 Effort

**文件**: `src/utils/effort.ts:279-329`

```typescript
export function getDefaultEffortForModel(model) {
  // Opus 4.6: Pro 用户默认 medium
  if (model.includes('opus-4-6')) {
    if (isProSubscriber()) return 'medium'
    if (getOpusDefaultEffortConfig().enabled &&
        (isMaxSubscriber() || isTeamSubscriber())) {
      return 'medium'
    }
  }

  // Ultrathink 开启时，默认 medium（ultrathink 会临时提升到 high）
  if (isUltrathinkEnabled() && modelSupportsEffort(model)) {
    return 'medium'
  }

  // 兜底：undefined（API 默认行为等效 high）
  return undefined
}
```

**设计意图**: Opus 4.6 默认 medium 而非 high，是为了平衡速度和 rate limit。用户需要深度思考时，通过 ultrathink 关键词临时提升。

### Effort 如何传给 API

**文件**: `src/services/api/claude.ts:440-466`

```typescript
function configureEffortParams(effortValue, outputConfig, extraBodyParams, betas, model) {
  if (!modelSupportsEffort(model)) return

  if (effortValue === undefined) {
    betas.push(EFFORT_BETA_HEADER)          // 让 API 使用默认 effort
  } else if (typeof effortValue === 'string') {
    outputConfig.effort = effortValue        // 'low' | 'medium' | 'high' | 'max'
    betas.push(EFFORT_BETA_HEADER)
  } else if (process.env.USER_TYPE === 'ant') {
    // 数值型 effort（仅内部用户），通过 anthropic_internal 传递
    extraBodyParams.anthropic_internal = {
      effort_override: effortValue           // 0-200 的数值
    }
  }
}
```

数值型 effort 到等级的映射：

```
0-50   → low
51-85  → medium
86-100 → high
101+   → max
```

---

## 5. 第三层：Ultrathink — 关键词触发的深度思考

### 触发条件

**文件**: `src/utils/thinking.ts:19-31`

```typescript
// 构建时 + 运行时双重门控
export function isUltrathinkEnabled(): boolean {
  if (!feature('ULTRATHINK')) return false     // 构建时开关（死代码消除）
  return getFeatureValue_CACHED_MAY_BE_STALE('tengu_turtle_carbon', true)  // 运行时 A/B 测试
}

// 关键词匹配：不区分大小写的 "ultrathink"
export function hasUltrathinkKeyword(text: string): boolean {
  return /\bultrathink\b/i.test(text)
}
```

### 工作流程

```
用户输入: "ultrathink 帮我设计一个缓存系统"
    │
    ├── Step 1: 关键词检测
    │   attachments.ts:1446 → hasUltrathinkKeyword() → true
    │   创建 attachment: { type: 'ultrathink_effort', level: 'high' }
    │   记录遥测: logEvent('tengu_ultrathink')
    │
    ├── Step 2: Attachment → System Reminder
    │   messages.ts:4170 → 转换为:
    │   "The user has requested reasoning effort level: high.
    │    Apply this to the current turn."
    │
    ├── Step 3: UI 反馈
    │   PromptInput.tsx:685 → "ultrathink" 文字显示彩虹色
    │   通知: "Effort set to high for this turn"（5 秒后消失）
    │
    └── Step 4: 本轮 API 请求
        effort 从 medium → high（仅本轮，下一轮恢复 medium）
```

### 彩虹色渲染

**文件**: `src/utils/thinking.ts:60-86`

Ultrathink 关键词在输入框中逐字符循环 7 种彩虹色：

```typescript
const RAINBOW_COLORS = [
  'rainbow_red',      // 红
  'rainbow_orange',   // 橙
  'rainbow_yellow',   // 黄
  'rainbow_green',    // 绿
  'rainbow_blue',     // 蓝
  'rainbow_indigo',   // 靛
  'rainbow_violet',   // 紫
]

export function getRainbowColor(charIndex: number): keyof Theme {
  return RAINBOW_COLORS[charIndex % RAINBOW_COLORS.length]
}
```

---

## 6. API 请求构建

**文件**: `src/services/api/claude.ts:1596-1630`

这是整个系统最核心的代码——将 ThinkingConfig 和 Effort 转化为 API 参数。

### Thinking 参数构建

```typescript
const hasThinking =
  thinkingConfig.type !== 'disabled' &&
  !isEnvTruthy(process.env.CLAUDE_CODE_DISABLE_THINKING)

let thinking = undefined

if (hasThinking && modelSupportsThinking(model)) {
  if (!isEnvTruthy(process.env.CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING) &&
      modelSupportsAdaptiveThinking(model)) {
    // ★ 4.6+ 模型：自适应思考，无 token 预算限制
    thinking = { type: 'adaptive' }
  } else {
    // ★ 旧模型：固定预算思考
    let thinkingBudget = getMaxThinkingTokensForModel(model)
    if (thinkingConfig.type === 'enabled' && thinkingConfig.budgetTokens !== undefined) {
      thinkingBudget = thinkingConfig.budgetTokens
    }
    // 预算不能超过 maxOutputTokens - 1
    thinkingBudget = Math.min(maxOutputTokens - 1, thinkingBudget)
    thinking = { type: 'enabled', budget_tokens: thinkingBudget }
  }
}
```

### Temperature 约束

**文件**: `src/services/api/claude.ts:1691-1695`

```typescript
// thinking 启用时不能设置 temperature（API 要求 temperature=1，即默认值）
const temperature = !hasThinking
  ? (options.temperatureOverride ?? 1)
  : undefined   // 不发送 temperature 字段
```

### 最终 API 请求示例

```json
{
  "model": "claude-opus-4-6-20250414",
  "thinking": { "type": "adaptive" },
  "output_config": { "effort": "high" },
  "messages": [...],
  "system": [...],
  "max_tokens": 64000
}
```

---

## 7. 流式响应处理

**文件**: `src/services/api/claude.ts:2020-2170`

Claude API 以 Server-Sent Events 形式流式返回 thinking 块。

### 阶段 1：块初始化（content_block_start）

```typescript
case 'thinking':
  contentBlocks[part.index] = {
    ...part.content_block,
    thinking: '',      // 初始化为空字符串
    signature: '',     // 预初始化签名字段，防止 undefined
  }
  break
```

### 阶段 2：内容累积（content_block_delta）

```typescript
case 'thinking_delta':
  // 类型检查：确保 delta 发给了正确的 thinking 块
  if (contentBlock.type !== 'thinking') {
    throw new Error('Content block is not a thinking block')
  }
  // 追加思考内容
  contentBlock.thinking += delta.thinking
  break

case 'signature_delta':
  // 签名可以出现在 thinking 块或 connector_text 块上
  if (contentBlock.type === 'connector_text') {
    contentBlock.signature = delta.signature
  } else if (contentBlock.type === 'thinking') {
    contentBlock.signature = delta.signature
  }
  break
```

### 阶段 3：块结束（content_block_stop）

块完成时，整个 thinking 块已经累积完毕，等待后续处理。

### 流式事件序列示例

```
content_block_start  → { index: 0, type: 'thinking', thinking: '', signature: '' }
thinking_delta       → { index: 0, thinking: '让我分析一下这个' }
thinking_delta       → { index: 0, thinking: '问题的几个方面...' }
signature_delta      → { index: 0, signature: 'abc123...' }
content_block_stop   → { index: 0 }
content_block_start  → { index: 1, type: 'text' }
text_delta           → { index: 1, text: '根据分析，建议...' }
content_block_stop   → { index: 1 }
message_stop
```

**注意**: signature_delta 不计入 token 计数（排除在 `onUpdateLength` 之外），避免状态栏 token 计数器跳动。

---

## 8. Thinking 块的存储与消息规范化

**文件**: `src/utils/messages.ts`

### 类型守卫

```typescript
// line 4774
function isThinkingBlock(block): boolean {
  return block.type === 'thinking' || block.type === 'redacted_thinking'
}
```

### 尾部 Thinking 块过滤

**文件**: `src/utils/messages.ts:4781-4824`

Claude API 拒绝以 thinking 块结尾的 assistant 消息。代码在发送前自动剥离：

```typescript
// 如果 assistant 消息的 content 数组末尾是 thinking 块，移除它
// 如果移除后 content 为空，插入占位文本
[{ type: 'text', text: '[No message content]' }]
```

### 孤立消息过滤

如果流式传输中断导致某条 assistant 消息只包含 thinking 块（没有 text），这条消息会被完全移除。处理顺序很重要：

```
1. 先剥离尾部 thinking 块
2. 再过滤空白内容的消息
（顺序反过来会遗漏只有 thinking 块的消息）
```

---

## 9. 密码学签名机制

**文件**: `src/utils/messages.ts:5061-5099`

### 签名是什么

每个 thinking 块和 redacted_thinking 块都携带一个 `signature` 字段，这是 API 端生成的密码学签名。

### 签名的作用

签名与**生成时使用的 API 密钥**绑定。当客户端在后续请求中回传 thinking 块时，API 通过签名验证这些块确实是自己生成的，没有被篡改。这允许 API 执行有状态转换（如从压缩摘要恢复原始内容）。

### 签名失效场景

当用户切换 API 密钥（如 `/login` 重新登录）后，旧签名变得无效。API 会返回 400 错误。

### 签名清理

**文件**: `src/utils/messages.ts:5061-5099`

```typescript
function stripSignatureBlocks(messages): Message[] {
  // 登录/凭证刷新时调用
  // 移除所有带 signature 的块（thinking、redacted_thinking、connector_text）
  // 如果移除后某条 assistant 消息变空，返回空数组让消息合并机制吸收
}
```

---

## 10. Redacted Thinking — 思考内容隐藏

**文件**: `src/utils/betas.ts:264-277`

### 什么是 Redacted Thinking

正常情况下，API 返回 `thinking` 块（包含实际思考文本）。当启用 Redact Thinking Beta 时，API 返回 `redacted_thinking` 块——只有类型标记，没有实际内容。

### 触发条件

```
REDACT_THINKING_BETA_HEADER = 'redact-thinking-2026-02-12'

启用条件（全部满足）:
  1. 模型支持 ISP（Interleaved Structured Prompting）
  2. 非 SDK/非 print 模式（交互式会话）
  3. 用户设置 showThinkingSummaries !== true
```

### 为什么要 Redact

正常模式下，API 会用 Haiku 对 thinking 内容做摘要（summarization），这增加了 TTFT（Time To First Token）。Redact 模式跳过摘要，直接返回不可见的占位块，加快首字节响应时间。

### UI 展示区别

```
thinking 块     → 显示 "∴ Thinking"，用户可展开查看完整内容
redacted_thinking → 显示 "✻ Thinking…"，无法查看内容
```

---

## 11. Thinking Clear — 长时间闲置后的思考清理

**文件**: `src/services/api/claude.ts:1444-1456`

### 问题背景

用户暂离超过 1 小时后回来继续对话，之前的 prompt cache 已过期。历史消息中的 thinking 块会增加请求体积，但没有 cache 命中收益。

### 清理机制

```typescript
let thinkingClearLatched = getThinkingClearLatched()

if (!thinkingClearLatched && isAgenticQuery) {
  const lastCompletion = getLastApiCompletionTimestamp()
  if (lastCompletion !== null &&
      Date.now() - lastCompletion > CACHE_TTL_1HOUR_MS) {
    thinkingClearLatched = true
    setThinkingClearLatched(true)   // 锁存：一旦触发，整个会话持续生效
  }
}
```

### 清理策略

通过 API 的 context management 功能，在请求中指定清理策略：

```typescript
// 清理所有 thinking 块，只保留最近 1 轮
clearAllThinking ? { type: 'thinking_turns', value: 1 } : 'all'
```

### 重置

`/clear` 或 `/compact` 命令会重置 thinkingClearLatched 状态。

---

## 12. 子 Agent 的思考继承策略

**文件**: `src/tools/AgentTool/runAgent.ts:679-684`

### 两种策略

```typescript
thinkingConfig: useExactTools
  ? toolUseContext.options.thinkingConfig   // Fork 子 agent：继承父级配置
  : { type: 'disabled' as const },         // 普通子 agent：关闭思考
```

| 子 agent 类型 | Thinking 配置 | 原因 |
|---|---|---|
| Fork 子 agent（`useExactTools=true`） | 继承父级 | 需要匹配父级 API 请求前缀以命中 prompt cache |
| 普通子 agent | 禁用 | 控制输出 token 成本（子 agent 通常做简单任务） |

### Fork 子 agent 的特殊性

Fork 子 agent 携带父级的完整对话历史（`forkContextMessages`），使用相同的工具集和系统提示。为了命中 prompt cache，它必须让 API 请求前缀（包括 thinking 参数）与父级完全一致。

---

## 13. 压缩系统中的思考处理

### Token 计数

**文件**: `src/services/compact/microCompact.ts:183-188`

```typescript
if (block.type === 'thinking') {
  totalTokens += roughTokenCountEstimation(block.thinking)
}
if (block.type === 'redacted_thinking') {
  // redacted_thinking 没有实际内容，计为 0 token
  totalTokens += 0
}
```

### 压缩时的 Thinking 块处理

压缩对话时，thinking 块随 assistant 消息一起发送给压缩 agent。压缩 agent 只输出文本摘要，不保留原始 thinking 块。压缩后，旧的 thinking 块被摘要替换，签名也随之失效。

---

## 14. UI 展示

### Thinking 块渲染

**文件**: `src/components/messages/AssistantThinkingMessage.tsx`

```
非 verbose 模式（默认）:
  ∴ Thinking
  [按 Ctrl+O 展开查看]

verbose 模式 / transcript 模式:
  ∴ Thinking
  让我分析一下这个问题的几个方面...
  首先，空指针错误通常发生在...
  （完整思考内容，暗色斜体渲染）
```

### Redacted Thinking 渲染

**文件**: `src/components/messages/AssistantRedactedThinkingMessage.tsx`

```
✻ Thinking…
（无法展开，内容不可见）
```

### Ultrathink UI 反馈

**文件**: `src/components/PromptInput/PromptInput.tsx:685-758`

```
输入框中 "ultrathink" 文字 → 逐字符彩虹色渲染
通知栏 → "Effort set to high for this turn"（5 秒超时）
```

---

## 15. 完整生命周期示例

### 场景：用户在 Opus 4.6 上使用 ultrathink

```
步骤 1: 会话初始化
  main.tsx → shouldEnableThinkingByDefault() → true
  → ThinkingConfig = { type: 'adaptive' }
  → 默认 effort = 'medium'（Opus 4.6 Pro 用户）

步骤 2: 用户输入
  "ultrathink 请帮我设计一个分布式缓存的淘汰策略"

步骤 3: 输入处理
  attachments.ts → hasUltrathinkKeyword("ultrathink ...") → true
  → 创建 attachment: { type: 'ultrathink_effort', level: 'high' }
  → UI: "ultrathink" 显示彩虹色
  → 通知: "Effort set to high for this turn"

步骤 4: 消息构建
  messages.ts → ultrathink_effort attachment 转为 system reminder:
  "The user has requested reasoning effort level: high. Apply this to the current turn."

步骤 5: API 请求构建
  claude.ts:1604 → modelSupportsAdaptiveThinking('opus-4-6') → true
  → thinking = { type: 'adaptive' }
  claude.ts:1458 → resolveAppliedEffort() → 'high'（ultrathink 提升）
  → output_config.effort = 'high'

  最终请求:
  {
    model: "claude-opus-4-6-20250414",
    thinking: { type: "adaptive" },
    output_config: { effort: "high" },
    temperature: undefined,  // thinking 启用时不发送
    messages: [
      { role: "user", content: [
        { type: "text", text: "请帮我设计一个分布式缓存的淘汰策略" }
      ]},
      { role: "user", content: [
        { type: "text", text: "<system-reminder>...reasoning effort level: high...</system-reminder>" }
      ]}
    ]
  }

步骤 6: 流式响应
  ← content_block_start { index: 0, type: 'thinking' }
  ← thinking_delta { thinking: '分布式缓存淘汰策略需要考虑几个维度：\n' }
  ← thinking_delta { thinking: '1. 一致性 vs 可用性的权衡...\n' }
  ← thinking_delta { thinking: '2. 热点数据识别...\n' }
  ← ... (可能很长，adaptive 模式无 token 限制)
  ← signature_delta { signature: 'sig_abc123...' }
  ← content_block_stop { index: 0 }
  ← content_block_start { index: 1, type: 'text' }
  ← text_delta { text: '# 分布式缓存淘汰策略设计\n\n' }
  ← text_delta { text: '## 核心思路\n\n基于...' }
  ← content_block_stop { index: 1 }
  ← message_stop

步骤 7: 消息存储
  assistant message = {
    content: [
      { type: 'thinking', thinking: '分布式缓存淘汰...', signature: 'sig_abc123...' },
      { type: 'text', text: '# 分布式缓存淘汰策略设计\n\n...' }
    ]
  }

步骤 8: UI 渲染
  ∴ Thinking                          ← 折叠状态，按 Ctrl+O 展开
  # 分布式缓存淘汰策略设计             ← 正常渲染
  ## 核心思路
  基于...

步骤 9: 下一轮
  effort 恢复为 'medium'（ultrathink 仅影响当前轮）
  thinking 仍然是 adaptive（会话级别不变）
```

---

## 16. 模型参数速查表

### Thinking 预算

| 模型 | 默认输出 | 上限输出 | Thinking 预算（固定模式） |
|---|---|---|---|
| Opus 4.6 | 64,000 | 128,000 | 127,999 |
| Sonnet 4.6 | 32,000 | 128,000 | 127,999 |
| Opus 4.5 / Sonnet 4 / Haiku 4 | 32,000 | 64,000 | 63,999 |
| Opus 4.1 / Opus 4 | 32,000 | 32,000 | 31,999 |
| Claude 3.7 Sonnet | 32,000 | 64,000 | 63,999 |
| Claude 3.5 Sonnet / Haiku | 8,192 | 8,192 | 8,191 |
| Claude 3 Opus | 4,096 | 4,096 | 4,095 |

计算公式：`getMaxThinkingTokensForModel(model) = upperLimit - 1`

### 上下文窗口

| 模型 | 上下文窗口 |
|---|---|
| Opus 4.6 [1m] | 1,000,000 |
| Sonnet 4.6 [1m] | 1,000,000 |
| 其他 4.x 模型 | 200,000 |

### Effort 默认值

| 模型 | 用户类型 | 默认 Effort |
|---|---|---|
| Opus 4.6 | Pro | medium |
| Opus 4.6 | Max/Team（config enabled） | medium |
| 其他支持 effort 的模型（ultrathink 开启时） | 所有 | medium |
| 其他 | 所有 | undefined（等效 API 默认 high） |

### GrowthBook 特性标志

| 标志名 | 控制内容 |
|---|---|
| `tengu_turtle_carbon` | Ultrathink 功能开关（默认 true） |
| `tengu_grey_step2` | Opus 4.6 Max/Team 用户默认 effort 配置 |

### 环境变量

| 变量 | 作用 |
|---|---|
| `MAX_THINKING_TOKENS` | 设置固定 thinking 预算（>0 启用，=0 禁用） |
| `CLAUDE_CODE_DISABLE_THINKING` | 强制禁用所有 thinking |
| `CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING` | 强制使用固定预算模式（即使模型支持 adaptive） |
| `CLAUDE_CODE_EFFORT_LEVEL` | 覆盖 effort 等级（'low'/'medium'/'high'/'max'/'unset'） |
| `CLAUDE_CODE_ALWAYS_ENABLE_EFFORT` | 为所有模型启用 effort 参数 |

---

## 17. 关键设计决策总结

### 1. Adaptive 优于固定预算

4.6+ 模型全部使用 adaptive thinking，让模型自己决定思考多少。固定预算只为旧模型保留。代码注释反复强调"不要在没通知模型团队的情况下修改 adaptive 支持"。

### 2. Effort 与 Thinking 解耦

两者是独立的 API 参数。Thinking 控制"是否有内部推理过程"，Effort 控制"推理的深度"。这允许：
- 开启 thinking + low effort（快速浅层思考）
- 开启 thinking + max effort（深度长时间思考）
- 关闭 thinking + high effort（不展示内部推理但仍然认真处理）

### 3. Ultrathink 是 Effort 的语法糖

Ultrathink 不修改 ThinkingConfig，只临时提升当前轮的 effort。这意味着它通过 attachment → system reminder 的间接路径生效，而非直接修改 API 参数。设计优雅之处：不需要为"临时提升"引入新的状态管理。

### 4. 子 Agent 默认关闭 Thinking

普通子 agent 禁用 thinking 以控制成本。只有 fork 子 agent（需要 cache 命中）才继承父级配置。这是成本和性能的权衡。

### 5. 签名实现信任链

密码学签名让 API 能验证 thinking 块的来源，支持跨请求的有状态操作。凭证变更时自动清理，防止 400 错误。

### 6. 1 小时闲置触发清理

超过 1 小时未活动 → cache 过期 → thinking 块变成纯负担 → 自动清理。这是一个典型的"缓存友好"优化，减少无效 token 传输。
