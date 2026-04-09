# Claude Code Context 管理系统详解

本文档结合 `context-focused.svg` 依赖图，详细解释 free-code45（Claude Code v2.1.87）中 context 管理的每个模块、它们在 context 生命周期中的角色、以及实际运行时的工作流程。

---

## 依赖图总览

`context-focused.svg` 中的节点按颜色分为四组：

| 颜色 | 含义 | 模块 |
|---|---|---|
| 红色 | 核心枢纽 | `context.ts` |
| 蓝色 | 消费者（依赖 context.ts） | btw.tsx, caches.ts, REPL.tsx, queryContext.ts 等 |
| 绿色 | 组装层 | `utils/queryContext.ts` |
| 橙色 | 压缩系统 | `utils/context.ts`, autoCompact.ts, compact.ts, microCompact.ts |

箭头方向表示"谁依赖谁"：蓝色节点的箭头指向红色节点，说明蓝色模块 import 了 `context.ts`。

---

## 每个模块详解

### 1. `context.ts` — 上下文构建器（红色，核心）

**文件位置**: `src/context.ts`（约 190 行）

**职责**: 在会话开始时收集环境信息，构建两块上下文数据，传给 Claude API 作为对话前缀。

**核心函数**:

#### `getSystemContext()` — 系统级上下文

会话启动时调用一次（memoize 缓存），收集 git 仓库状态：

```typescript
// 并行获取 5 个 git 信息
const [branch, mainBranch, status, log, userName] = await Promise.all([
  getBranch(),                    // 当前分支名
  getDefaultBranch(),             // 默认分支（通常是 main）
  git status --short,             // 工作区状态（限 2000 字符）
  git log --oneline -n 5,         // 最近 5 条提交
  git config user.name,           // git 用户名
])
```

生成的文本类似：

```
This is the git status at the start of the conversation...
Current branch: feature/context-refactor
Main branch: main
Git user: zhangsan
Status: M src/context.ts
Recent commits:
  a1b2c3d fix: compact threshold calculation
  e4f5g6h feat: add 1M context support
```

**为什么重要**: 这段信息让 Claude 知道当前代码库的状态——在哪个分支、有哪些未提交的修改、最近做了什么。没有它，Claude 每次都得用工具主动查询。

#### `getUserContext()` — 用户级上下文

加载所有 CLAUDE.md 配置文件和 memory 文件：

```typescript
const claudeMd = getClaudeMds(filterInjectedMemoryFiles(await getMemoryFiles()))
return {
  claudeMd,                                          // CLAUDE.md 合并内容
  currentDate: `Today's date is ${getLocalISODate()}` // 当前日期
}
```

**为什么重要**: CLAUDE.md 是用户对 Claude 行为的持久化指令（项目规范、代码风格、禁止操作等）。这是用户"教"Claude 如何在特定项目中工作的核心机制。

---

### 2. `context.ts` 的依赖（灰色节点）

这些是 `context.ts` 为了完成工作而依赖的底层工具：

| 模块 | 作用 | 示例 |
|---|---|---|
| `bootstrap/state.ts` | 全局状态存储（会话 ID、项目根目录、CLAUDE.md 缓存） | `setCachedClaudeMdContent()` 缓存加载结果供其他模块快速读取 |
| `constants/common.ts` | 通用常量和工具函数 | `getLocalISODate()` 返回 `"2026-04-08"` |
| `utils/claudemd.ts` | CLAUDE.md 文件发现与加载 | 从 cwd 向上遍历目录，按优先级加载 4 层 CLAUDE.md |
| `utils/diagLogs.ts` | 性能诊断日志（非用户可见） | 记录 git 命令耗时，用于内部性能分析 |
| `utils/envUtils.ts` | 环境变量读取 | `isEnvTruthy(process.env.CLAUDE_CODE_REMOTE)` 判断是否远程模式 |
| `utils/execFileNoThrow.ts` | 安全执行外部命令（不抛异常） | 执行 `git status` 时即使失败也不会崩溃 |
| `utils/git.ts` | git 操作封装 | `getBranch()`, `getDefaultBranch()`, `getIsGit()` |
| `utils/gitSettings.ts` | git 相关设置 | `shouldIncludeGitInstructions()` 判断是否要包含 git 信息 |
| `utils/log.ts` | 错误日志 | 记录 git 命令失败等异常 |

#### CLAUDE.md 加载优先级（`utils/claudemd.ts` 的核心逻辑）

```
优先级从低到高（后加载的覆盖先加载的）：

1. /etc/claude-code/CLAUDE.md          ← 管理员全局指令
2. ~/.claude/CLAUDE.md                  ← 用户全局指令
3. 项目根目录/CLAUDE.md                 ← 项目指令（提交到 git）
   项目根目录/.claude/CLAUDE.md
   项目根目录/.claude/rules/*.md
4. 项目根目录/CLAUDE.local.md           ← 本地私有指令（不提交）
```

---

### 3. `utils/queryContext.ts` — 上下文组装层（绿色）

**文件位置**: `src/utils/queryContext.ts`（约 180 行）

**职责**: 将 system prompt、user context、system context 三部分组装在一起，构成发给 Claude API 的完整前缀。

**为什么独立成文件**: 文件头注释明确说明——它同时 import 了 `context.ts` 和 `constants/prompts.ts`，这两个在依赖图中位置很高。如果把这些 import 放到 `commands.ts` 里会造成循环依赖。

**核心函数**:

#### `fetchSystemPromptParts()` — 并行获取三部分

```typescript
const [defaultSystemPrompt, userContext, systemContext] = await Promise.all([
  getSystemPrompt(tools, model, dirs, mcpClients),  // 系统提示词（工具定义、行为规则）
  getUserContext(),                                   // CLAUDE.md + 日期
  getSystemContext(),                                 // git 状态
])
```

#### `buildSideQuestionFallbackParams()` — 构建 side question 上下文

当 Agent SDK 在主循环执行中途触发 side question 时，需要重建完整的上下文前缀。这个函数镜像了 `QueryEngine.ts` 的组装逻辑，确保 cache key 匹配。

**实际运行时的组装顺序**:

```
┌─ API 请求 ─────────────────────────────────────────────┐
│                                                         │
│  system: [                                              │
│    systemPrompt        ← 工具定义 + 行为规则（最大块）    │
│    + userContext        ← CLAUDE.md 内容 + 日期          │
│    + systemContext      ← git 状态                       │
│  ]                                                      │
│                                                         │
│  messages: [                                            │
│    user: "帮我修复这个 bug..."                           │
│    assistant: "我来看一下代码..."                         │
│    user: [tool_result: 文件内容...]                      │
│    ...                                                  │
│  ]                                                      │
└─────────────────────────────────────────────────────────┘
```

---

### 4. `utils/context.ts` — 上下文窗口管理（橙色）

**文件位置**: `src/utils/context.ts`（约 120 行）

**职责**: 管理模型的上下文窗口大小——决定"装得下多少 token"。

**注意**: 此文件和 `src/context.ts` 是**不同的文件**，尽管名字相似。`src/context.ts` 负责"构建上下文内容"，`src/utils/context.ts` 负责"计算上下文容量"。

**核心常量和函数**:

```typescript
MODEL_CONTEXT_WINDOW_DEFAULT = 200_000     // 默认 200k token
COMPACT_MAX_OUTPUT_TOKENS    = 20_000      // 压缩摘要最大输出
CAPPED_DEFAULT_MAX_TOKENS    = 8_000       // 默认输出上限（节省 slot）
ESCALATED_MAX_TOKENS         = 64_000      // 输出被截断后重试的上限

function getContextWindowForModel(model, betas): number
  // 优先级：
  // 1. 环境变量 CLAUDE_CODE_MAX_CONTEXT_TOKENS 覆盖
  // 2. [1m] 后缀 → 返回 1,000,000
  // 3. 模型能力表查询 → 返回该模型的 max_input_tokens
  // 4. beta header 匹配 → 返回 1,000,000
  // 5. 兜底 → 返回 200,000
```

**实际例子**:

```
用户使用 claude-opus-4-6[1m]:
  getContextWindowForModel() → 1,000,000 tokens

用户使用 claude-sonnet-4-6:
  getContextWindowForModel() → 200,000 tokens（可能通过实验升到 1M）
```

---

### 5. `services/compact/autoCompact.ts` — 自动压缩触发器（橙色）

**文件位置**: `src/services/compact/autoCompact.ts`（约 200 行）

**职责**: 每轮对话后检查 token 用量，决定是否触发自动压缩。

**核心逻辑**:

```
有效窗口 = contextWindow - 20,000（预留给压缩摘要输出）
自动压缩阈值 = 有效窗口 - 13,000（AUTOCOMPACT_BUFFER_TOKENS）

例如 200k 模型：
  有效窗口 = 200,000 - 20,000 = 180,000
  触发阈值 = 180,000 - 13,000 = 167,000 tokens

当消息总 token 数 >= 167,000 时，触发自动压缩。
```

**关键保护机制**:

```typescript
// 连续失败 3 次后停止重试（熔断器）
const MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES = 3

// 防止子 agent 触发压缩导致死锁
if (querySource === 'session_memory' || querySource === 'compact') {
  return false
}
```

**token 用量状态分级**:

```
正常        →  继续对话
警告阈值     →  显示黄色警告（剩余 < 20,000）
错误阈值     →  显示红色警告（剩余 < 20,000）
自动压缩阈值 →  触发压缩
阻塞上限     →  拒绝新输入（剩余 < 3,000）
```

---

### 6. `services/compact/compact.ts` — 完整压缩引擎（橙色）

**文件位置**: `src/services/compact/compact.ts`（约 500 行）

**职责**: 执行实际的对话压缩——把长对话浓缩为一段结构化摘要。

**压缩流程**:

```
1. 预处理
   - stripImagesFromMessages(): 把图片替换为 [image] 标记
   - 过滤掉不需要的消息

2. 调用 Claude API 生成摘要
   - fork 一个子 agent（不会触发工具调用）
   - system prompt 强调"只输出文本，不调用工具"
   - 要求先写 <analysis> 思考过程，再写 <summary> 结构化摘要

3. 后处理
   - formatCompactSummary(): 剥离 <analysis>，格式化 <summary>
   - 插入 SystemCompactBoundaryMessage 标记压缩边界
   - 恢复最近读取的文件内容（最多 5 个文件，限 50k token）
   - 恢复活跃的 skill 内容

4. 清理
   - runPostCompactCleanup(): 清除各种缓存
```

**摘要结构（9 个部分）**:

```
1. Primary Request and Intent     ← 用户要做什么
2. Key Technical Concepts          ← 涉及的技术概念
3. Files and Code Sections         ← 操作了哪些文件（含代码片段）
4. Errors and fixes                ← 遇到的错误和修复方式
5. Problem Solving                 ← 解决了什么问题
6. All user messages               ← 所有用户消息（非工具结果）
7. Pending Tasks                   ← 待完成的任务
8. Current Work                    ← 压缩前正在做什么
9. Optional Next Step              ← 下一步建议
```

**支持两种压缩模式**:

| 模式 | 说明 | 适用场景 |
|---|---|---|
| 完整压缩（full compact） | 压缩整个对话历史为一段摘要 | 对话很长，所有内容都需要压缩 |
| 部分压缩（partial compact） | 只压缩旧消息，保留近期对话原文 | 近期对话仍然重要，只需清理早期内容 |

---

### 7. `services/compact/microCompact.ts` — 微压缩引擎（橙色）

**文件位置**: `src/services/compact/microCompact.ts`（约 300 行）

**职责**: 不压缩对话逻辑，只清理大体积的工具输出内容。这是比 compact 更轻量的方案。

**只处理以下工具的输出**:

```typescript
const COMPACTABLE_TOOLS = new Set([
  'Read',        // 文件读取结果
  'Bash',        // 命令执行输出
  'Grep',        // 搜索结果
  'Glob',        // 文件匹配结果
  'WebSearch',   // 网页搜索结果
  'WebFetch',    // 网页抓取内容
  'Edit',        // 文件编辑结果
  'Write',       // 文件写入结果
])
```

**工作方式**:

```
原始工具结果:
  Read src/context.ts → (200 行代码，约 3000 token)

微压缩后:
  [Old tool result content cleared]
```

**为什么需要两级压缩**:

```
对话 token 使用量增长：

时间 → ████████████████████████████████████████
       ↑                    ↑              ↑
       开始                 微压缩触发      完整压缩触发
                           (清理工具输出)   (摘要替换整段对话)

微压缩更快（不需要调 API）、不丢失对话逻辑，
但如果对话本身就很长，最终还是需要完整压缩。
```

---

### 8. `services/compact/postCompactCleanup.ts` — 压缩后清理

**文件位置**: `src/services/compact/postCompactCleanup.ts`（约 78 行）

**职责**: 压缩完成后清除所有被压缩内容相关的缓存，避免状态不一致。

**清理的内容**:

```typescript
function runPostCompactCleanup(querySource) {
  resetMicrocompactState()          // 重置微压缩追踪状态
  resetContextCollapse()            // 重置上下文折叠状态（仅主线程）
  getUserContext.cache.clear()      // 清除 getUserContext 的 memoize 缓存
  resetGetMemoryFilesCache()        // 清除 CLAUDE.md 文件缓存
  clearSystemPromptSections()       // 清除系统提示词分段缓存
  clearClassifierApprovals()        // 清除分类器审批缓存
  clearSpeculativeChecks()          // 清除 Bash 工具的推测性权限检查
  clearBetaTracingState()           // 清除 beta 追踪状态
  clearSessionMessagesCache()       // 清除会话消息缓存
}
```

**为什么重要**: 压缩后消息历史发生了根本性变化。如果旧缓存不清除，会导致：
- `getUserContext` 返回过时的 CLAUDE.md 内容（用户可能在对话中修改了 CLAUDE.md）
- 微压缩状态指向已被删除的消息
- 权限检查引用不存在的工具调用

**主线程保护**: 子 agent 和主线程共享进程，所以子 agent 压缩时不能清除主线程的状态：

```typescript
const isMainThreadCompact =
  querySource === undefined ||
  querySource.startsWith('repl_main_thread') ||
  querySource === 'sdk'

if (isMainThreadCompact) {
  getUserContext.cache.clear()     // 只有主线程压缩才清除
  resetGetMemoryFilesCache()
}
```

---

### 9. 消费者模块（蓝色节点）

这些模块 import `context.ts` 来使用上下文数据：

| 模块 | 如何使用 context | 场景 |
|---|---|---|
| `screens/REPL.tsx` | 启动时调用 `getSystemContext()` + `getUserContext()` 初始化会话 | 用户打开 Claude Code 时 |
| `tools/AgentTool/runAgent.ts` | 为子 agent 构建独立的 system context | 用户触发 Agent 工具时 |
| `commands/compact/compact.ts` | 手动 `/compact` 时清除 context 缓存 | 用户输入 `/compact` |
| `commands/clear/caches.ts` | `/clear` 命令清除所有缓存包括 context | 用户输入 `/clear caches` |
| `commands/btw/btw.tsx` | BTW 命令使用 context 构建侧问题 | 用户在对话中插入旁白问题 |
| `utils/api.ts` | 构建 API 请求时组装 context | 每次发送 API 请求 |
| `utils/analyzeContext.ts` | 分析当前上下文的 token 组成 | 调试和监控上下文使用情况 |

---

## 完整生命周期：一次对话中 Context 如何流转

下面用一个具体例子走一遍完整流程。

### 场景：用户在一个 git 项目中使用 Claude Code 修复 bug

```
用户：帮我修复 src/utils/parser.ts 第 42 行的空指针错误
```

#### 阶段 1：会话初始化

```
screens/REPL.tsx 启动
    │
    ├─→ context.ts: getSystemContext()
    │     ├─→ utils/git.ts: 获取 branch, status, log
    │     ├─→ utils/execFileNoThrow.ts: 安全执行 git 命令
    │     └─→ 返回: "Current branch: fix/null-ptr\nStatus: M parser.ts\n..."
    │
    ├─→ context.ts: getUserContext()
    │     ├─→ utils/claudemd.ts: 加载 CLAUDE.md 文件链
    │     │     ~/.claude/CLAUDE.md → "使用 TypeScript strict mode..."
    │     │     ./CLAUDE.md → "本项目使用 vitest 测试框架..."
    │     └─→ 返回: { claudeMd: "...", currentDate: "2026-04-08" }
    │
    └─→ 两个结果被 memoize 缓存，整个会话期间不再重新获取
```

#### 阶段 2：发送 API 请求

```
utils/queryContext.ts: fetchSystemPromptParts()
    │
    ├─→ getSystemPrompt(tools, model, dirs, mcpClients)
    │     返回: 工具定义（Read, Edit, Bash...）+ 行为规则（安全、风格...）
    │
    ├─→ getUserContext()  ← 命中缓存，直接返回
    │
    ├─→ getSystemContext() ← 命中缓存，直接返回
    │
    └─→ 组装为 API 请求:
          system: [systemPrompt + userContext + systemContext]
          messages: [{ role: "user", content: "帮我修复..." }]
```

#### 阶段 3：多轮工具调用（token 不断增长）

```
轮次 1: Claude 调用 Read("src/utils/parser.ts")
  → tool_result: 200 行代码（~3000 token）
  → 累计 ~15,000 token

轮次 2: Claude 调用 Grep("nullableField", "src/")
  → tool_result: 50 个匹配结果（~2000 token）
  → 累计 ~22,000 token

轮次 3: Claude 调用 Bash("npm test")
  → tool_result: 测试输出 500 行（~8000 token）
  → 累计 ~35,000 token

... 经过 50 轮工具调用 ...
  → 累计 ~160,000 token
```

#### 阶段 4：微压缩触发

```
microCompact.ts: microcompactMessages(messages)
    │
    │  扫描消息历史，找到旧的大体积工具结果:
    │
    │  轮次 1 的 Read 结果（3000 token）→ "[Old tool result content cleared]"
    │  轮次 2 的 Grep 结果（2000 token）→ "[Old tool result content cleared]"
    │  轮次 3 的 Bash 结果（8000 token）→ "[Old tool result content cleared]"
    │  ...
    │
    └─→ 释放约 50,000 token，不需要调 API，瞬间完成
        累计降至 ~110,000 token
```

#### 阶段 5：继续对话，token 再次增长到阈值

```
累计达到 167,000 token（自动压缩阈值）

autoCompact.ts: shouldAutoCompact(messages, model)
    │
    ├─→ utils/context.ts: getEffectiveContextWindowSize("claude-sonnet-4-6")
    │     → 200,000 - 20,000 = 180,000
    │
    ├─→ getAutoCompactThreshold()
    │     → 180,000 - 13,000 = 167,000
    │
    ├─→ tokenCountWithEstimation(messages) → 168,000
    │
    └─→ 168,000 >= 167,000 → 触发压缩！
```

#### 阶段 6：完整压缩执行

```
compact.ts: compactConversation(messages, cacheSafeParams)
    │
    ├─→ 1. 预处理
    │     stripImagesFromMessages(): 图片 → [image]
    │
    ├─→ 2. fork 子 agent 调用 Claude API
    │     prompt: "创建对话摘要，包含 9 个结构化部分..."
    │     │
    │     └─→ Claude 返回:
    │           <analysis>用户在修复 parser.ts 的空指针...</analysis>
    │           <summary>
    │           1. Primary Request: 修复 src/utils/parser.ts:42 空指针
    │           2. Key Concepts: TypeScript null safety, optional chaining
    │           3. Files: parser.ts (修改了第 42 行), parser.test.ts (新增测试)
    │           4. Errors: 首次尝试用 ! 断言，测试失败，改用 ?. 解决
    │           ...
    │           </summary>
    │
    ├─→ 3. 后处理
    │     formatCompactSummary(): 剥离 <analysis>，格式化 <summary>
    │     恢复最近读取的文件（parser.ts 最新版本）
    │
    ├─→ 4. 替换消息历史
    │     [50 轮对话消息] → [1 条摘要消息 + 压缩边界标记]
    │     168,000 token → ~8,000 token
    │
    └─→ 5. 清理缓存
          postCompactCleanup.ts: runPostCompactCleanup()
            - getUserContext.cache.clear()   ← 下次重新读取 CLAUDE.md
            - resetMicrocompactState()       ← 重置微压缩追踪
            - clearClassifierApprovals()     ← 权限审批重新计算
```

#### 阶段 7：压缩后继续对话

```
用户看到的（无感知）：Claude 继续回答，好像什么都没发生

Claude 看到的消息历史：
  [system: systemPrompt + userContext + systemContext]
  [user: "This session is being continued from a previous conversation...
          Summary:
          1. Primary Request: 修复 parser.ts:42 空指针...
          ..."]
  [attachment: parser.ts 最新内容]
  [user: 用户的最新消息]

效果：Claude 保留了关键上下文，继续原来的工作。
```

---

## 关键模块重要性排序

按"如果删掉它系统会怎样"来排序：

| 优先级 | 模块 | 删掉的后果 |
|---|---|---|
| P0 | `utils/context.ts` | 无法判断上下文窗口大小，所有压缩逻辑失效，API 请求超长报错 |
| P0 | `autoCompact.ts` | 长对话必然超出窗口限制，用户被迫手动 `/compact` |
| P0 | `compact.ts` | 无法执行压缩，上下文窗口用完后对话终止 |
| P1 | `context.ts` | Claude 不知道 git 状态和 CLAUDE.md 规则，每次都要手动查询 |
| P1 | `queryContext.ts` | 无法组装 API 请求的前缀，cache key 失效，每次请求都无法命中缓存 |
| P1 | `microCompact.ts` | 工具输出不被清理，上下文更快耗尽，压缩频率大幅增加 |
| P2 | `postCompactCleanup.ts` | 压缩后缓存不一致，CLAUDE.md 修改不生效，权限状态错乱 |
| P2 | `utils/claudemd.ts` | CLAUDE.md 不被加载，用户的项目规则完全失效 |

---

## 核心设计洞察

### 1. 两层缓存策略

`context.ts` 用 `memoize` 做会话级缓存，避免每轮对话都跑 git 命令。但压缩后通过 `postCompactCleanup` 清除缓存，确保 CLAUDE.md 的修改能被感知。

### 2. 两级压缩策略

微压缩（快、不调 API、只清工具输出）→ 完整压缩（慢、调 API、生成摘要）。这像操作系统的内存管理：先回收缓存页，不够再做 swap。

### 3. 防循环依赖的架构

`queryContext.ts` 独立存在的唯一原因是避免循环 import。代码注释明确标注了这一点。这说明在大型项目中，依赖管理有时需要"不自然"的文件拆分。

### 4. 主线程/子 agent 状态隔离

子 agent（如 compact 的 fork agent）和主线程共享进程，`postCompactCleanup` 通过 `querySource` 参数区分调用者，避免子 agent 清除主线程状态。
