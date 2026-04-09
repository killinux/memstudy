# Claude Code Prompt 提取与分析

通过 AST 提取 free-code45 中的所有 prompt 字符串，分析 Anthropic 是如何用 prompt 工程"塑造"Claude Code 行为的。

---

## 提取方法

### 工具

`tools/ast-analysis/extract-prompts.mjs` 基于 ts-morph 实现：

1. 扫描所有 `prompt.ts` / `prompts.ts` 文件
2. 提取两类内容：
   - 顶层导出的字符串常量（`export const PROMPT = '...'`）
   - 名字像 prompt 的函数返回的字符串（`function getXxxPrompt() { return '...' }`）
3. 处理三种字符串字面量：StringLiteral、NoSubstitutionTemplateLiteral、TemplateExpression
4. 按文件路径分类：system / tools / services / utils

### 后处理分析

`tools/ast-analysis/analyze-prompts.mjs` 对提取的 prompt 计算：
- 关键词频次：IMPORTANT, MUST, NEVER, ALWAYS, CRITICAL, DO NOT, REQUIRED 等
- 软约束词：should, recommended, prefer, avoid
- 指令密度：rules per 1000 chars

---

## 总览数据

| 指标 | 数值 |
|---|---|
| 提取的 prompt 段总数 | **77** |
| 来源文件数 | **43** |
| 总字符数 | **87,003** |
| 估算 token 数 | **~21,750** |
| 硬约束总数 | **60** |
| 软约束总数 | **28** |
| 硬:软 比例 | **1 : 0.47** |

**洞察 1**：Claude Code 的 prompt 总量约 22k token，但这只是显式 prompt 部分。运行时还会动态注入工具 schema、系统上下文（git status、CLAUDE.md）等，实际请求体会更大。

**洞察 2**：硬约束远多于软约束（60 vs 28），说明 Anthropic 倾向用**强命令式语言**来约束 Claude，而非"建议"。这是 prompt engineering 的一个重要选择——LLM 对 IMPORTANT/MUST/NEVER 这些词的响应明显强于 should/recommended。

---

## 按类别分布

| 类别 | Prompts | 字符数 | 硬规则 | 软规则 | 密度（rules/k chars） |
|---|---|---|---|---|---|
| **tools** | 55 | 62,019 | 42 | 23 | **1.0** |
| **system** | 15 | 12,727 | 5 | 3 | 0.6 |
| **services** | 3 | 7,816 | 7 | 2 | 1.2 |
| **utils** | 4 | 4,441 | 6 | 0 | **1.4** |

**洞察**：
- Tools 占了 71% 的字符数——大部分 prompt 工程都花在工具描述上
- utils 类别（如 claudeInChrome）密度最高（1.4/k）——专门场景的指令最密集
- system prompt 反而密度最低（0.6/k）——主要是介绍性内容，不是命令

---

## Top 10 最长的 Prompt

| Rank | 字符数 | 硬规则 | Prompt 名 | 文件 |
|---|---|---|---|---|
| 1 | **9,132** | 1 | `PROMPT` | TodoWriteTool/prompt.ts |
| 2 | **6,305** | **16** | `getCommitAndPRInstructions` | BashTool/prompt.ts |
| 3 | 5,127 | 5 | `getPrompt` | PowerShellTool/prompt.ts |
| 4 | 3,766 | 1 | `getProactiveSection` | constants/prompts.ts |
| 5 | 3,681 | 0 | `getEnterPlanModeToolPromptExternal` | EnterPlanModeTool/prompt.ts |
| 6 | 3,459 | 5 | `getDefaultUpdatePrompt` | SessionMemory/prompts.ts |
| 7 | 3,353 | 3 | `BASE_CHROME_PROMPT` | claudeInChrome/prompt.ts |
| 8 | 3,208 | 1 | `getPrompt` | AgentTool/prompt.ts |
| 9 | 3,189 | 2 | `getUpdatePromptTemplate` | MagicDocs/prompts.ts |
| 10 | 2,832 | 0 | `getActionsSection` | constants/prompts.ts |

### 几个有意思的发现

#### TodoWriteTool 是最长的 prompt（9132 字符）

这个工具本身很简单（只是写一个 todo 数组），但 prompt 长达 9k 字符，因为里面包含**5 个完整的使用场景示例**（带 `<example>...</example>` 标签）。

```
<example>
User: I want to add a dark mode toggle to the application settings...
Assistant: *Creates todo list with the following items:*
1. Creating dark mode toggle component...
<reasoning>
The assistant used the todo list because:
1. Adding dark mode is a multi-step feature...
</reasoning>
</example>
```

**洞察**：Anthropic 用大量 few-shot 示例教 Claude **何时**使用 TodoWrite。工具本身简单，难的是判断"什么时候该用"——这是 prompt engineering 的核心。

#### BashTool 的 git 操作 prompt 是硬规则之王（16 个）

```
Git Safety Protocol:
- NEVER update the git config
- NEVER run destructive git commands (push --force, reset --hard, ...)
- NEVER skip hooks (--no-verify, --no-gpg-sign, etc) ...
- NEVER run force push to main/master, warn the user if they request it
- CRITICAL: Always create NEW commits rather than amending...
- NEVER commit changes unless the user explicitly asks you to.
```

5 个 NEVER + 1 个 CRITICAL + 多个 IMPORTANT，密集度极高。

**洞察**：git 是高风险操作（误操作会丢代码），所以这里用最强的命令式语言。这一段是从无数"用户被 Claude 误操作 git"的真实事故中沉淀出来的。

---

## Top 10 指令密度最高的 Prompt

| Rank | 密度 | 硬 | 软 | Prompt 名 |
|---|---|---|---|---|
| 1 | **5.6** | 2 | 1 | `getSimpleIntroSection` (system) |
| 2 | 4.6 | 0 | 1 | `getLanguageSection` (system) |
| 3 | 4.5 | 2 | 0 | `getCommitAndPRInstructions` (BashTool, 短版) |
| 4 | 4.1 | 1 | 4 | `DESCRIPTION` (WebFetchTool) |
| 5 | 4.0 | 2 | 0 | `CHROME_TOOL_SEARCH_INSTRUCTIONS` |
| 6 | 3.8 | 5 | 0 | `getWebSearchPrompt` |
| 7 | 3.3 | 1 | 0 | `CLAUDE_IN_CHROME_SKILL_HINT` |
| 8 | 3.0 | 2 | 1 | `getDefaultEditDescription` (FileEditTool) |
| 9 | 2.9 | 16 | 2 | `getCommitAndPRInstructions` (BashTool, 长版) |
| 10 | 2.8 | 0 | 1 | `getEditionSection` (PowerShellTool) |

**洞察**：密度最高的 prompt 通常是**短而精的指令片段**。介绍 Claude Code 是什么的 `getSimpleIntroSection`（534 字符）只有 3 个规则就达到了 5.6/k 的密度——因为它直奔主题。

---

## System Prompt 内部结构（constants/prompts.ts）

`getSystemPrompt()` 是最重要的入口函数，组装 25+ 个 section：

| Section 函数 | 内容 |
|---|---|
| `getSimpleIntroSection` | "You are an interactive agent..."（角色定义） |
| `getSimpleSystemSection` | 平台、shell、cwd、git 状态等环境信息 |
| `getSimpleDoingTasksSection` | 任务执行原则 |
| `getActionsSection` | **执行高风险操作的护栏** |
| `getUsingYourToolsSection` | 工具使用通用规则 |
| `getAgentToolSection` | 子 agent 使用指南 |
| `getDiscoverSkillsGuidance` | Skill 发现机制 |
| `getSessionSpecificGuidanceSection` | 会话级指引 |
| `getOutputEfficiencySection` | **沟通效率（怎么写给用户的文字）** |
| `getSimpleToneAndStyleSection` | 语气和风格 |
| `getOutputStyleSection` | 用户配置的输出风格 |
| `getLanguageSection` | 语言偏好 |
| `getMcpInstructionsSection` | MCP 工具使用 |
| `getHooksSection` | Hook 系统说明 |
| `getSystemRemindersSection` | system-reminder 标签语义 |
| `getProactiveSection` | 主动模式（KAIROS） |
| `getBriefSection` | 简报功能 |

### 最重要的两个 section

#### `getActionsSection`（2832 字符）— 操作安全护栏

完整内容值得细读：

> Carefully consider the **reversibility** and **blast radius** of actions. Generally you can freely take local, reversible actions like editing files or running tests. But for actions that are hard to reverse, affect shared systems beyond your local environment, or could otherwise be risky or destructive, **check with the user before proceeding**.
>
> The cost of pausing to confirm is low, while the cost of an unwanted action (lost work, unintended messages sent, deleted branches) can be very high.
>
> Examples of risky actions:
> - Destructive operations: deleting files/branches, dropping database tables, killing processes, rm -rf, overwriting uncommitted changes
> - Hard-to-reverse: force-pushing, git reset --hard, amending published commits, removing dependencies
> - Visible to others: pushing code, creating PRs, sending Slack messages
> - Uploading to third-party tools: pastebins, gists (may be cached/indexed)
>
> When you encounter an obstacle, **do not use destructive actions as a shortcut to simply make it go away**. Try to identify root causes... If you discover unexpected state... investigate before deleting or overwriting, as it may represent the user's in-progress work.
>
> **measure twice, cut once.**

**洞察**：这一段定义了 Claude Code 的"风险意识框架"——把操作按 reversibility（可逆性）和 blast radius（影响范围）二维分类，对高风险操作要求显式确认。这不是简单的"小心点"，而是一个完整的决策框架。

#### `getOutputEfficiencySection`（2395 字符）— 怎么和用户沟通

> When sending user-facing text, you're writing for a person, not logging to a console. Assume users can't see most tool calls or thinking - only your text output...
>
> When making updates, assume the person has stepped away and lost the thread. They don't know codenames, abbreviations, or shorthand...
>
> Write user-facing text in **flowing prose** while eschewing fragments, excessive em dashes, symbols and notation...
>
> Only use tables when appropriate; for example to hold short enumerable facts (file names, line numbers, pass/fail), or communicate quantitative data. **Don't pack explanatory reasoning into table cells** -- explain before or after.
>
> What's most important is the reader understanding your output without mental overhead or follow-ups, not how terse you are. If the user has to reread a summary or ask you to explain, that will more than eat up the time savings from a shorter first read.

**洞察**：这段完全是写作指南，**没有一个 IMPORTANT/MUST**。Anthropic 用解释性的方式教 Claude 写作风格，因为风格是判断题不是规则题。这和 git 安全 prompt 的高强度命令式形成强烈对比。

---

## Tool Prompt 设计模式

### 模式 1：纯描述（Read/Edit/Write 等基础工具）

```
Reads a file from the local filesystem.
Usage:
- The file_path parameter must be an absolute path
- By default, it reads up to 2000 lines starting from the beginning
- ...
```

只描述参数和行为，不教"什么时候用"——因为读文件是基础操作，模型自己会判断。

### 模式 2：带使用场景的指令（TodoWriteTool）

```
## When to Use This Tool
1. Complex multi-step tasks ...
2. Non-trivial and complex tasks ...

## When NOT to Use This Tool
Skip when:
1. There is only a single, straightforward task
...

## Examples
<example>
...
<reasoning>
...
</reasoning>
</example>
```

明确"用 vs 不用"，配合多个示例。这是教 Claude 在**判断时机**上对齐。

### 模式 3：安全协议（BashTool 的 git 部分）

```
Git Safety Protocol:
- NEVER ...
- NEVER ...
- CRITICAL: Always ...
```

高密度命令式，针对高风险操作。

### 模式 4：流程模板（BashTool 的 commit 流程）

```
1. Run the following bash commands in parallel:
   - git status
   - git diff
   - git log
2. Analyze all staged changes...
3. Run the following commands in parallel:
   - git add
   - git commit
   - git status (verify)
```

把一个完整工作流分步骤模板化。这是把"专家工作流"硬编码成 prompt。

### 模式 5：负面示例引导（AgentTool）

```
- The agent's outputs should generally be trusted
- Clearly tell the agent whether you expect it to write code or just to do research
- If the user specifies that they want you to run agents "in parallel", you MUST send a single message with multiple Agent tool use content blocks.
```

通过"反例"教学：用户说什么时该怎么做。

---

## Anthropic 的 Prompt 工程哲学（从代码中归纳）

### 1. 命令式 > 建议式（用于安全/正确性）

**选择 IMPORTANT/MUST/NEVER 而不是 should/please** 当你需要可靠的行为约束。这是基于经验：LLM 对强命令式的响应明显更稳定。

### 2. 解释性 > 命令式（用于风格/品味）

写作风格、沟通方式这类**判断题**用解释性语言。命令式语言会让模型死板地遵循规则，反而失去灵活性。

### 3. Few-shot > 抽象描述（用于判断时机）

教 Claude **何时**使用某工具时，提供 3-5 个完整示例比抽象规则更有效。TodoWriteTool 的 9k 字符 prompt 大部分是示例。

### 4. 把工作流模板化

复杂操作（如 git commit）不是依赖 Claude 自己想步骤，而是把整个流程作为模板写进 prompt。这降低了变异性，提高了可靠性。

### 5. 显式约束高风险操作

列出具体的"危险操作清单"（destructive/hard-to-reverse/visible-to-others）比泛泛的"小心点"有效得多。

### 6. 用 example 标签教学

XML 标签（`<example>`, `<reasoning>`）让 Claude 能区分"这是示例"和"这是当前任务"。

### 7. 把"为什么"也写进去

Git 安全 prompt 不只说"NEVER force push to main"，还解释 "warn the user if they request it"——给出上下文让 Claude 理解约束的边界。

### 8. 区分硬约束和软约束的明确语言

```
NEVER X      ← 硬约束，零容忍
You should Y ← 软约束，可以违反
prefer Z     ← 倾向，模型自由判断
```

这种语言层级让模型知道每条规则的"权重"。

---

## 实用启示：怎么写自己的 Agent Prompt

基于对 Claude Code prompt 的分析，给写自己 agent prompt 的人几点建议：

### 1. 区分场景用不同语气

| 场景 | 用什么 |
|---|---|
| 安全/正确性约束 | NEVER, MUST, CRITICAL, IMPORTANT |
| 风格/审美建议 | 解释性长段落，用 should |
| 教使用时机 | `<example>` + `<reasoning>` 配对 |
| 复杂工作流 | 分步骤模板 |

### 2. 工具描述要包含"什么时候用"和"什么时候不用"

只描述"工具做什么"是不够的。模型需要知道何时调用、何时不调用。看 TodoWriteTool 的"When NOT to Use This Tool"部分。

### 3. 列出具体的反面操作

不要说"不要做危险的事"，而要说"不要 force-push、不要 reset --hard、不要 rm -rf"。具体清单远胜抽象类别。

### 4. 解释"为什么"

NEVER 后面跟一句"因为 X 会导致 Y"。模型理解了约束的原因，在边界情况下才能做出合理判断。

### 5. 主动告诉模型"什么时候停下来问用户"

`getActionsSection` 的核心就是这一条。Agent 的失控通常不是因为不会做事，而是因为不会停。

---

## 数据文件

完整提取的 prompt 文本和分析数据存储在 `reports/prompts/`：

| 路径 | 内容 |
|---|---|
| `system/` | constants/prompts.ts 的 15 个 section |
| `tools/` | 35 个工具的 prompt 文件（55 个 prompt 段） |
| `services/` | 3 个服务级 prompt（compact、SessionMemory、MagicDocs） |
| `utils/` | 4 个工具类 prompt（含 claudeInChrome） |
| `index.json` | 全部 prompt 元数据 |
| `stats.json` | 提取阶段统计 |
| `analysis.json` | 关键词分析结果 + 排行榜 |

### 查询示例

```bash
# 看 BashTool 的所有 prompt
cat reports/prompts/tools/BashTool__prompt.txt

# 找最严的安全 prompt
jq '.topByHardRules[:5]' reports/prompts/analysis.json

# 找指令密度最高的
jq '.topByDensity[:5]' reports/prompts/analysis.json
```

---

## 附录：可复现的命令

```bash
# 1. 提取
node tools/ast-analysis/extract-prompts.mjs \
  /path/to/free-code45 \
  /tmp/prompts-output

# 2. 分析
node tools/ast-analysis/analyze-prompts.mjs /tmp/prompts-output

# 3. 阅读
ls /tmp/prompts-output/tools/
cat /tmp/prompts-output/tools/BashTool__prompt.txt
```

依赖：`npm install ts-morph`
