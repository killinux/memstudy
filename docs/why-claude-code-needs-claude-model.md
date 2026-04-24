# 为什么 Claude Code 换别的模型效果就没这么好

> 一个常见的疑问：Claude Code 如果接上 GPT-4o 或 Gemini，是不是改个 API key 就行了？答案是不行——效果会显著下降。本文基于对 free-code45 源码的逆向分析，解释这背后的三层绑定关系。
>
> 前置阅读：
> - `docs/memory-system.md`（记忆系统深度解析）
> - `docs/prompt-analysis.md`（Prompt 工程分析）
> - `docs/agent-loop-implementation.md`（Agent Loop 实现）
> - `docs/sub-agent-fork.md`（Fork 机制）

---

## 目录

1. [一句话回答](#一句话回答)
2. [三层绑定总览](#三层绑定总览)
3. [第一层：Prompt 是针对 Claude 做 eval 迭代出来的](#第一层prompt-是针对-claude-做-eval-迭代出来的)
4. [第二层：记忆系统的协议依赖 Claude 的特定能力](#第二层记忆系统的协议依赖-claude-的特定能力)
5. [第三层：代码和模型之间的暗协议](#第三层代码和模型之间的暗协议)
6. [换模型到底要改什么](#换模型到底要改什么)
7. [对斯坦福小镇升级的启示](#对斯坦福小镇升级的启示)

---

## 一句话回答

> Claude Code 的 22k token prompt、代码逻辑、模型行为三者是**作为一个整体被 eval 迭代出来的**。换模型不是换个 API key 的事，而是三层绑定中的每一层都会失效。

---

## 三层绑定总览

```
┌─────────────────────────────────────────────────────────┐
│  第三层：代码-模型暗协议                     换模型 → 改代码 │
│  tool_use 格式 / stop_reason / thinking / prompt cache   │
├─────────────────────────────────────────────────────────┤
│  第二层：记忆系统协议                  换模型 → 边界 case 出错 │
│  frontmatter / 封闭分类 / LLM 检索 / dream 指令跟随       │
├─────────────────────────────────────────────────────────┤
│  第一层：Prompt 行为校准            换模型 → 重跑 eval 重调  │
│  60 硬约束 / eval-validated / 命令式 vs 解释式              │
└─────────────────────────────────────────────────────────┘
```

三层从上往下：第三层最硬（格式不兼容，直接报错），第二层最隐蔽（大部分能跑但偶尔出错），第一层最费力（要重新调 prompt 措辞）。

---

## 第一层：Prompt 是针对 Claude 做 eval 迭代出来的

### 证据：eval-validated 注释

源码注释中有明确的 eval 迭代痕迹（`memoryTypes.ts:183`）：

> Eval-validated: memory-prompt-iteration case 3, **0/2 → 3/3**

这表示：
- 初始 prompt 写法：Claude 在 2 个测试用例中答对 **0** 个
- 迭代后的写法：Claude 在 3 个测试用例中答对 **3** 个

每条关键 prompt 都有对应的评测用例，而且是**在 Claude 模型上跑的评测**。当注释说"0/2 → 3/3"时，措辞的改动是为了让 **Claude** 从答错到答对。换一个模型，同样的措辞调整可能没有同样的效果——甚至可能让效果变差。

### 22k token 的 prompt 是怎么组织的

从 `docs/prompt-analysis.md` 的分析数据：

| 指标 | 数值 |
|---|---|
| Prompt 段总数 | 77 |
| 总 token 量 | ~22k |
| 硬约束（NEVER/MUST/CRITICAL） | **60 个** |
| 软约束（should/recommended） | **28 个** |
| 硬:软比例 | 1 : 0.47 |

Anthropic 用两种不同的语气写 prompt，**而这两种语气的选择是针对 Claude 的响应特性调的**：

| 场景 | 语气 | 例子 | 为什么这样写 |
|---|---|---|---|
| 安全关键操作 | 命令式（NEVER/MUST） | `NEVER run destructive git commands` | Claude 对 NEVER 的遵守度经过 eval 验证 |
| 风格偏好 | 解释式（描述 + 理由） | `Write user-facing text in flowing prose...` | 风格是判断题，命令式反而让 Claude 太死板 |
| 时机判断 | few-shot 示例 | TodoWriteTool 的 5 个 `<example>` 标签 | Claude 对 example 标签有特定的理解方式 |
| 复杂流程 | 分步模板 | BashTool 的 commit 4 步 | Claude 对编号步骤的跟随度高 |

### 换模型会怎样

| Claude Code 的 prompt 技巧 | Claude 的反应 | 其他模型可能的反应 |
|---|---|---|
| `NEVER commit unless explicitly asked` | 严格遵守 | 可能打折扣——觉得"用户暗示了就算" |
| `CRITICAL: Always create NEW commits` | 绝对不 amend | 可能忽略 CRITICAL 这个词的权重 |
| `measure twice, cut once` | 理解为决策框架隐喻 | 可能理解为字面意思 |
| `<system-reminder>` 标签 | 知道是系统注入，高优先级 | 可能当普通文本处理 |
| `getActionsSection` 的风险矩阵 | 内化为二维判断（reversibility × blast radius） | 可能只当描述文本读过就忘 |

关键：**prompt 的措辞不是通用的"好 prompt"，而是针对 Claude 的行为特性校准过的**。就像一副给特定度数配的眼镜——别人戴不一定合适。

---

## 第二层：记忆系统的协议依赖 Claude 的特定能力

这一层回答你最初的问题：**是不是因为 Claude 能识别自己存的记忆规则？**

答案是：不完全是"识别规则"这么简单，而是记忆系统的**整个协议栈**都假设了 Claude 的特定能力。

### 2a. frontmatter 精确解析

记忆文件的格式：

```markdown
---
name: testing preferences
description: integration tests must use real DB, not mocks
type: feedback
---

Integration tests must hit a real database, not mocks.
Why: prior incident where mock/prod divergence masked a broken migration.
```

Claude Code 假设模型能：
1. 精确解析 YAML frontmatter
2. 区分 `description`（一行摘要）和 body（完整内容）
3. 在被要求"只看 description"时真的不看 body

**证据**：`findRelevantMemories.ts` 的 manifest 只喂 description，不喂 body。prompt 说：

> Only include memories that you are certain will be helpful **based on their name and description**.

这需要模型能精确地把判断**限制在 description 字段内**。Claude 做到了这一点（通过 eval 验证），但换模型后，模型可能倾向于要求看完整内容才做判断——那整个"只用 description 做轻量检索"的设计就废了。

### 2b. 封闭分类法的严格遵守

四类记忆是 `as const` 封闭的：`user | feedback | project | reference`。

prompt 里有一条极端规则（`memoryTypes.ts:183-195`）：

> These exclusions apply **even when the user explicitly asks you to save**. If they ask you to save a PR list or activity summary, ask what was *surprising* or *non-obvious* about it — that is the part worth keeping.

这要求模型在**用户明确要求存某个东西**时，拒绝执行并引导用户说出真正值得存的部分。这需要：
1. 系统指令优先于用户指令（Claude 在这方面有明确的优先级设计）
2. 在"拒绝用户"时仍然表现得有帮助（Claude 的 harmlessness 训练）
3. 精确区分"可从代码推导的事实" vs "推不出的上下文"

其他模型在"系统指令 vs 用户指令"的优先级权衡上可能有不同的行为——有些模型更倾向于顺从用户的直接要求。

### 2c. LLM 做检索器

`findRelevantMemories` 不用 embedding，直接让 Sonnet 读 description 清单选记忆：

```typescript
const SELECT_MEMORIES_SYSTEM_PROMPT = `You are selecting memories that will be useful 
to Claude Code as it processes a user's query...
Return a list of filenames for the memories that will clearly be useful (up to 5). 
Only include memories that you are certain will be helpful.
Be selective and discerning.`
```

这个设计的前提是 **Sonnet 能在 200 条 description 清单中做出高质量的相关性判断**。

已知的模型间差异：
- **位置偏差**：有些模型对清单中间位置的条目关注度下降（"lost in the middle" 问题）
- **选择力度**：prompt 说"be selective"——有些模型倾向于选太多（过度 inclusive），有些选太少
- **工具感知**：prompt 要求"如果最近用过某工具，不选该工具的 API 文档但选 warning"——这需要精细的条件推理

### 2d. autoDream 的复杂指令跟随

Dream 的 consolidation prompt 要求模型在**一次调用**里执行 4 个 phase：

```
Phase 1 — Orient（读目录、读索引）
Phase 2 — Gather recent signal（找新信号，有优先级排序）
Phase 3 — Consolidate（合并进已有文件、转换日期格式、删被推翻的事实）
Phase 4 — Prune and index（维护 MEMORY.md 在 200 行以内、解决矛盾）
```

每个 phase 都有多个子规则。这是一个高度复杂的多步指令跟随任务。能力差异体现在：

| 步骤 | Claude 的表现 | 其他模型的风险 |
|---|---|---|
| "把'昨天'转成绝对日期" | 精确执行 | 可能忘记转换某些实例 |
| "如果今天的调研否定了某条记忆，修改源头" | 主动修改旧文件 | 可能只追加新条目而不改旧的 |
| "MEMORY.md 保持 <200 行" | 严格遵守上限 | 可能超出（觉得"多几行也没关系"） |
| "两文件冲突就修错的那个" | 做出正确判断 | 可能选错或两个都改 |

### 2e. "目录已存在"的行为校正

一个很具体的例子。Claude Code 有这样一条 prompt（`memdir.ts:113-115`）：

> This directory already exists — write to it directly with the Write tool (do not run mkdir or check for its existence).

代码注释说明了为什么：

> Shipped because Claude was burning turns on `ls`/`mkdir -p` before writing.

这条指令是**专门针对 Claude 的行为缺陷**加的——Claude 在早期版本倾向于在写文件前先检查目录是否存在。Anthropic 通过代码保证目录存在 + prompt 告诉模型不要检查，消除了这个问题。

换模型后，这条指令可能：
- 对该模型无意义（因为它本来就不会 ls/mkdir）
- 或者不够——该模型可能有别的"浪费回合"的习惯需要不同的指令来修正

**每一条这样的微调都是在 Claude 上观察到问题、然后针对 Claude 写的修正。**

---

## 第三层：代码和模型之间的暗协议

这是最硬的一层——不是"效果下降"而是"直接不能用"。

### 3a. tool_use 调用格式

Claude API 的工具调用返回格式：

```json
{
  "type": "tool_use",
  "id": "toolu_01A09q90qw90lq917835lq9",
  "name": "BashTool",
  "input": {"command": "git status"}
}
```

代码中的 `StreamingToolExecutor` 按这个格式解析流式响应。每个模型的 tool calling 协议不同：
- OpenAI 的 function calling 用 `function_call` / `tool_calls` 字段
- Gemini 的 function calling 格式又不一样

换模型需要重写整个工具调用的解析和路由层。

### 3b. stop_reason 语义

`query.ts` 的主循环核心逻辑：

```
while (true) {
  response = await queryModel(messages)
  
  if (response.stop_reason === 'end_turn') → 退出
  if (response.stop_reason === 'tool_use') → 执行工具，继续循环
}
```

这依赖 Claude API 的 `stop_reason` 枚举值。其他 API 的停止原因编码不同（OpenAI 用 `finish_reason: 'stop'` / `'tool_calls'`）。

### 3c. Extended Thinking

从 `docs/cot-thinking-design.md` 的分析，Claude Code 有三层 thinking 控制：

```
adaptive thinking（4.6+ 模型自主决定推理深度）
effort 参数（low/medium/high）
ultrathink（effort 的语法糖，映射到 high）
```

这是 Claude 4.x 独有的特性。`budget_tokens` 参数直接控制模型的推理 token 分配——这在其他模型 API 上**没有对应物**。

去掉 thinking，Claude Code 在复杂任务上的表现会显著下降——因为它失去了"先想再做"的能力。

### 3d. Prompt cache 的字节级精确

Fork pattern 的核心（`forkedAgent.ts`）：

```
cache_key = hash(system_prompt + tools + model + messages_prefix + thinking_config)
```

这依赖 **Anthropic API 的 prompt cache 机制**——请求前缀字节相同就命中缓存，缓存 token 价格是原价的 10%。

这个机制让 fork 子 agent（extractMemories, autoDream）几乎"免费"。没有它：
- 每次 extractMemories 都是全价调用
- 每次 autoDream 都是全价调用
- 25 个小镇 agent 不能共享 world prompt

OpenAI 有类似的 prefix caching，但行为细节不同（自动触发 vs 显式控制、缓存粒度、缓存时效）。Gemini 的 context caching 是又一套完全不同的机制。代码中精心维护的 `CacheSafeParams` 和 `promptCacheBreakDetection` 都需要重写。

### 3e. 流式输出格式

Claude API 的 Server-Sent Events 格式：

```
event: content_block_start
event: content_block_delta
event: content_block_stop
event: message_delta（含 stop_reason）
```

代码中的 `StreamingToolExecutor` 在收到 `content_block_start` 且 type 是 `tool_use` 时就**提前开始解析工具参数**——不等模型输出完就执行（streaming tool execution）。

这个优化强依赖 Claude API 的流式事件格式。换模型需要适配完全不同的流式协议。

---

## 换模型到底要改什么

| 层 | 要改的东西 | 工作量 | 能自动化吗 |
|---|---|---|---|
| **第三层** | tool calling 解析、stop_reason、streaming 协议、thinking API、cache API | 重写 API 适配层 | 部分可以（adapter pattern） |
| **第二层** | 验证记忆协议在新模型上是否成立（frontmatter 解析、分类遵守、检索质量、dream 质量） | 跑 eval 逐条验证 | 不能——需要人判断 |
| **第一层** | 60 个硬约束 + 28 个软约束的措辞调整、few-shot 示例调整、命令式 vs 解释式的比例调整 | 重跑 eval 重调 prompt | 不能——需要逐条迭代 |

**最乐观的估计**：第三层可以通过写 adapter 解决（社区已有 openai-compatible 的适配方案）。但第一层和第二层需要**针对新模型重跑整套 eval**——这就是为什么"换个 API key 就能用"在实践中效果远不如原版。

---

## 对斯坦福小镇升级的启示

如果要按 `docs/generative-agents-upgrade-proposal.md` 的方案升级斯坦福小镇，这三层绑定带来的教训是：

### 1. 不要假设 prompt 可以跨模型复用

Claude Code 的 prompt 措辞是在 Claude 上 eval 出来的。升级小镇时，如果用 GPT-4o 或 Gemini：

- **相同的设计思路可以复用**（比如"用类型化文件而非 append-only 流"）
- **具体的 prompt 措辞不能直接抄**（比如 NEVER 的效果在不同模型上不同）
- **必须建自己的 eval 集**——在目标模型上验证每条关键 prompt

### 2. 记忆协议要针对目标模型验证

搬过来的记忆系统（类型化文件 + LLM 检索 + dream 整合）设计是通用的，但需要验证：

| 要验证的点 | 怎么验证 |
|---|---|
| 目标模型能精确解析 frontmatter 吗？ | 10 条样例 → 检查解析正确率 |
| 目标模型在 200 条 description 清单里能精确选择吗？ | 构造已知正确答案的检索测试集 |
| 目标模型能执行 dream 的 4 phase 吗？ | 给一堆碎片记忆 → 检查整合结果 |
| 目标模型会遵守"不存可推导的事实"吗？ | 模拟用户说"把 PR 列表存下来" → 看是否拒绝 |

### 3. 把"模型特定"和"设计通用"分开

Claude Code 给我们的最大教训是**设计和实现要分层**：

```
通用层（可跨模型复用）：
  - 类型化文件存储 + frontmatter schema
  - 双注入路径（索引常驻 + 内容按需）
  - 定时整合（dream/reflection）
  - 选择性写入 gate
  - Agent Loop 主循环模式

模型特定层（必须针对性调整）：
  - prompt 措辞和强度（NEVER 的效果因模型而异）
  - 检索 prompt 的具体写法
  - dream prompt 的 phase 描述方式
  - tool calling 和 streaming 协议
  - cache 共享机制
```

升级小镇时，先把通用层搭好，然后针对选定的模型逐条 eval 调整模型特定层。**不要试图写"模型无关的 prompt"——那是幻觉**。好的 prompt 都是针对特定模型调的。

---

## 结语

回到最初的问题：**为什么 Claude Code 换别的模型效果就没这么好？**

不是因为"Claude 能识别自己存的记忆格式"这一个原因。而是三层绑定：

1. **Prompt 校准**：22k token 的 prompt 里每个 NEVER/MUST 的措辞都是在 Claude 上 eval 出来的
2. **记忆协议**：整个记忆系统（写入 gate、frontmatter 解析、LLM 检索、dream 整合）都假设了 Claude 的特定能力
3. **代码协议**：tool_use 格式、stop_reason、thinking API、prompt cache 都是 Claude API 特有的

这三层构成了一个**围绕 Claude 模型共同进化出来的系统**。拆掉任何一层，其他两层都会出问题。这不是锁定（lock-in）——这是**协同设计（co-design）的必然结果**。任何足够深度优化的系统都会和它的核心组件深度耦合。

斯坦福小镇升级时的正确做法：**学设计，不抄 prompt**。
