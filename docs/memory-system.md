# 记忆管理系统 — free-code45 深度解析

> 本文是对 Claude Code (free-code45) 持久化记忆系统的深度解析。与 SESSION-SUMMARY 中列出的其他子系统研究同风格：读源码、画图、归纳设计权衡。
>
> 涉及源码：`src/memdir/*` (1736 LOC)、`src/services/extractMemories/*`、`src/services/autoDream/*`、`src/services/teamMemorySync/*`、`src/skills/bundled/remember.ts`、`src/utils/attachments.ts` (记忆注入部分)、`src/constants/prompts.ts` (系统提示注入点)。

---

## 目录

1. [一句话总结](#一句话总结)
2. [五个子系统的分工](#五个子系统的分工)
3. [记忆类型：四类封闭分类法](#记忆类型四类封闭分类法)
4. [存储布局与路径安全](#存储布局与路径安全)
5. [memdir 核心模块](#memdir-核心模块)
6. [两条注入路径：系统提示 vs 消息附件](#两条注入路径系统提示-vs-消息附件)
7. [findRelevantMemories — 用 LLM 选相关记忆](#findrelevantmemories--用-llm-选相关记忆)
8. [extractMemories — 回合尾背景抽取 agent](#extractmemories--回合尾背景抽取-agent)
9. [autoDream — 做梦，也就是后台整理](#autodream--做梦也就是后台整理)
10. [team memory — 组织级同步](#team-memory--组织级同步)
11. [/remember skill — 用户触发的跨层迁移](#remember-skill--用户触发的跨层迁移)
12. [权限模型：写入的 carve-out](#权限模型写入的-carve-out)
13. [与 CLAUDE.md / Plan / Task 的边界](#与-claudemd--plan--task-的边界)
14. [关键设计决策（12 条）](#关键设计决策12-条)
15. [和 memstudy 项目里的 auto-memory prompt 的关系](#和-memstudy-项目里的-auto-memory-prompt-的关系)

---

## 一句话总结

> Claude Code 的记忆系统是**一套基于文件的、按四类封闭分类法组织、由 LLM 自己写入并通过 LLM 自己做相关性召回的持久化上下文层**，分为前台写入（主 agent）、后台抽取（extractMemories fork）、后台整理（autoDream REM 式 consolidation）、组织级同步（teamMemorySync）四个执行路径，通过两条注入通道（系统提示的 MEMORY.md 索引 + 附件里的完整相关文件）把"过去"带回每一次新对话。

---

## 五个子系统的分工

| 子系统 | 角色 | 触发时机 | 产出 |
|---|---|---|---|
| **memdir** | 类型定义 + 提示构造 + 读写原语 | 每次系统提示构建 | MEMORY.md 索引 + 类型化指令 |
| **findRelevantMemories** | 相关性召回 | 每个用户 query（async 预取） | 最多 5 个主题文件注入为 attachment |
| **extractMemories** | 回合尾背景写入 | 每个 query loop 结束 | 新建/更新 memory 文件 |
| **autoDream** | 整理/合并/剪枝 | 24h + 5 个 session 后 | 合并重复、删过时、维护 MEMORY.md |
| **teamMemorySync** | 跨人共享 | 文件改动 debounce 2s / 启动时 pull | server API PUT/GET |

```
┌─────────────────────────────────────────────────────────────────┐
│                     人类在对话中                                 │
└───────┬─────────────────────────────────────────────────────────┘
        │
        ▼
┌────────────────┐      ┌─────────────────┐      ┌──────────────┐
│  前台主 agent  │─────>│  memory dir     │<─────│ 后台抽取     │
│  (边聊边写)    │      │  (文件存储)     │      │ extractMem   │
└────────────────┘      └─────────────────┘      └──────────────┘
        ▲                       ▲                       ▲
        │                       │                       │
        │  注入路径 1:          │                       │
        │  MEMORY.md 索引       │                       │
        │  + 类型化指令          │                       │
        │  (系统提示)            │                       │
        │                       │                       │
        │  注入路径 2:          │                       │
        │  findRelevantMemories │                       │
        │  (attachment, 5 文件) │                       │
        │                       │                       │
        └───────────────────────┼───────────────────────┘
                                │
                                ▼
                       ┌──────────────┐      ┌──────────────┐
                       │   autoDream  │      │ teamMemSync  │
                       │ (24h + 5sess)│      │ (2s debounce)│
                       └──────────────┘      └──────┬───────┘
                                                    │
                                                    ▼
                                           Server API
                                           (claude.ai)
```

---

## 记忆类型：四类封闭分类法

源码：`src/memdir/memoryTypes.ts:14-19`

```ts
export const MEMORY_TYPES = [
  'user',
  'feedback',
  'project',
  'reference',
] as const
```

只有这四类。选择封闭分类法的理由（来自代码注释和两个 TYPES_SECTION 变体）：**任何可以从当前项目状态推导出的信息（代码模式、架构、git history）都不该存记忆。** 记忆承载的是"**读代码推不出的上下文**"。

### 四类详情（含官方 few-shot 例子）

| 类型 | 范围 | 捕获内容 | 官方例子 |
|---|---|---|---|
| **user** | 总是 private | 用户的角色/目标/知识 | 「我是 data scientist，正在调研 logging」 |
| **feedback** | 默认 private，工程惯例才 team | 用户给的做事方式指导（正面 + 负面） | 「别在测试里 mock 数据库，上次 mock 过了但 prod migration 挂了」 |
| **project** | 偏向 team | 正在进行的工作/截止日期/事故，不在代码/git 里 | 「周四之后冻结非紧急 merge，mobile 要切 release 分支」 |
| **reference** | 通常 team | 外部系统的"去哪里找" | 「pipeline bugs 在 Linear 的 INGEST 项目」 |

### 两个尤其精巧的约束

**1. feedback 要同时记录成功与失败**（`memoryTypes.ts:60`）

> Record from failure AND success: if you only save corrections, you will avoid past mistakes but drift away from approaches the user has already validated, and may grow overly cautious.

只记纠正会让模型慢慢变保守 → 必须也记"你做对了、继续这样做"。

**2. project 类必须把相对日期转成绝对日期**（`memoryTypes.ts:79`）

> Always convert relative dates in user messages to absolute dates when saving (e.g., "Thursday" → "2026-03-05"), so the memory remains interpretable after time passes.

这是典型的"LLM 回看历史时把相对词理解错"的预防针。

### frontmatter schema

```markdown
---
name: {{memory name}}
description: {{one-line description — used to decide relevance in future conversations, so be specific}}
type: {{user, feedback, project, or reference}}
---

{{memory content}}
```

注意 `description` 的注释：**它是相关性召回的关键**。后面 findRelevantMemories 会只看 description，不看 body。

### 两个 TYPES_SECTION 变体

`memoryTypes.ts` 导出了两份几乎一样的 `## Types of memory` 文案：

- `TYPES_SECTION_COMBINED`：auto + team 双目录模式，额外有 `<scope>` 标签和 team/private 判断指引
- `TYPES_SECTION_INDIVIDUAL`：单目录模式，无 scope

**代码注释直接说明了为什么要重复**（`memoryTypes.ts:8-12`）：

> The two TYPES_SECTION_* exports below are intentionally duplicated rather than generated from a shared spec — keeping them flat makes per-mode edits trivial without reasoning through a helper's conditional rendering.

一个很务实的反 DRY 决定：**prompt 文案是需要频繁微调的，抽象化反而妨碍调整**。

### 不该存的（What NOT to save）

`memoryTypes.ts:183-195`，重要的是最后一句：

> These exclusions apply even when the user explicitly asks you to save. If they ask you to save a PR list or activity summary, ask what was *surprising* or *non-obvious* about it — that is the part worth keeping.

这是一个 **eval-validated gate**（代码注释写明 "Eval-validated: memory-prompt-iteration case 3, 0/2 → 3/3"）。失败模式是用户说"把这周的 PR 列表记下来"，模型就傻乎乎地把活动日志当记忆存。这条明文指令把失败率从 0/2 拉到了 3/3。

---

## 存储布局与路径安全

源码：`src/memdir/paths.ts`

### 目录结构

```
~/.claude/projects/<sanitized-git-root>/memory/
├── MEMORY.md                    # 索引，始终加载到系统提示，≤200 行 / 25KB
├── user_role.md                 # 类型文件
├── feedback_testing.md
├── project_incident_202603.md
├── reference_dashboard.md
├── logs/                        # 仅 KAIROS（assistant mode）
│   └── 2026/04/2026-04-14.md   # 按日追加的日志
├── team/                        # TEAMMEM 启用时
│   ├── MEMORY.md
│   └── *.md
└── .consolidate-lock            # autoDream 锁文件（mtime = lastConsolidatedAt）
```

### 路径解析优先级（`paths.ts:210-235`）

```
1. CLAUDE_COWORK_MEMORY_PATH_OVERRIDE env var (full-path override)
2. settings.json autoMemoryDirectory （trusted sources only: policy/local/user）
3. <memoryBase>/projects/<sanitizePath(canonical-git-root)>/memory/
```

两个值得注意的点：

**worktree 共享同一套记忆**。`getAutoMemBase()` 用 `findCanonicalGitRoot()` 回到规范 git root，所以同一个仓库的多个 worktree 不会各自分裂出一份记忆（issue #24382）。

**projectSettings（`.claude/settings.json` 跟进 git 的那份）被有意排除**（`paths.ts:175-177`）：

> SECURITY: projectSettings (.claude/settings.json committed to the repo) is intentionally excluded — a malicious repo could otherwise set `autoMemoryDirectory: "~/.ssh"` and gain silent write access to sensitive directories via the filesystem.ts write carve-out.

这是 supply-chain 防御。因为记忆目录享有"写入不需要询问用户"的 carve-out（见下文权限部分），所以让 repo 自己决定记忆目录 = 让 repo 决定 Claude 能静默写哪里 = 不能允许。

### `validateMemoryPath` 的攻击面防御（`paths.ts:109-150`）

防御清单：

- 非绝对路径（相对路径会绑 CWD）
- 长度 < 3（`/` 被 strip 后变成 `""`；`/a` 太短）
- Windows drive root（`C:\`）
- UNC 路径（`\\server\share`）
- null byte（能在 syscall 里截断）
- 裸 `~`、`~/.`、`~/..`（会展开成 $HOME 或上级）
- 强制 NFC normalize（防 Unicode 正规化攻击）

这个函数是典型的"paranoid 外部输入验证"——每一条检查都对应一个可利用的路径模式。

---

## memdir 核心模块

源码：`src/memdir/memdir.ts` (507 LOC)

这是记忆子系统的"中枢"：构造指令、读截 MEMORY.md、决定注入哪种模式。

### 导出的公共 API

| 名字 | 作用 |
|---|---|
| `ENTRYPOINT_NAME = 'MEMORY.md'` | 索引文件名 |
| `MAX_ENTRYPOINT_LINES = 200` | 行数上限 |
| `MAX_ENTRYPOINT_BYTES = 25_000` | 字节上限（~125 char/line × 200） |
| `truncateEntrypointContent(raw)` | 截断 + 追加 warning |
| `buildMemoryLines(name, dir, extra?, skipIndex?)` | 纯指令（无 MEMORY.md 内容） |
| `buildMemoryPrompt({name, dir, ...})` | 指令 + 读到的 MEMORY.md 内容 |
| `ensureMemoryDirExists(dir)` | 幂等 mkdir |
| `loadMemoryPrompt()` | 顶层入口，dispatch 到各模式 |
| `buildSearchingPastContextSection(dir)` | 给模型搜索过去上下文的指引（gate 后） |
| `DIR_EXISTS_GUIDANCE` | "目录已存在，别 mkdir" 的提示句 |

### `truncateEntrypointContent` — 双重截断

两级上限的原因（代码注释）：

> ~125 chars/line at 200 lines. At p97 today; catches long-line indexes that slip past the line cap (p100 observed: 197KB under 200 lines).

观察到的病态案例：200 行但 197KB（每行 ~1KB 的 markdown 巨型链接），纯行数 cap 挡不住。所以先行截、再字节截，最后附警告指明触发了哪一条。

```typescript
const reason = wasByteTruncated && !wasLineTruncated
  ? `${bytes} (limit: ${limit}) — index entries are too long`
  : wasLineTruncated && !wasByteTruncated
    ? `${lines} lines (limit: 200)`
    : `${lines} lines and ${bytes}`
```

### `loadMemoryPrompt` — 顶层 dispatch

`memdir.ts:419-507`，按优先级决定走哪条分支：

```
1. KAIROS（assistant 长期会话模式）
   → buildAssistantDailyLogPrompt()     日志 append-only
2. TEAMMEM 启用 && 团队记忆启用
   → buildCombinedMemoryPrompt()        auto + team 双目录
3. autoMemory 启用
   → buildMemoryLines().join('\n')       单目录
4. 都不启用
   → null                               （日志上报 disabled 原因）
```

几个细节：

- **KAIROS 模式 takes precedence over TEAMMEM**。注释：「append-only log paradigm does not compose with team sync」
- 每条分支都会 `ensureMemoryDirExists()`，所以模型的 Write 可以直接写而不必先 mkdir
- 并且附带的指令里明文说 `DIR_EXISTS_GUIDANCE = 'This directory already exists — write to it directly with the Write tool (do not run mkdir or check for its existence).'`——因为真实跑下来 Claude 会浪费回合先 `ls` / `mkdir -p`

### "目录已存在"的教训

这是一处"行为修 bug"的痕迹。代码注释（`memdir.ts:113-115`）：

> Shared guidance text appended to each memory directory prompt line. **Shipped because Claude was burning turns on `ls`/`mkdir -p` before writing.** Harness guarantees the directory exists via ensureMemoryDirExists().

把"保证目录存在 + 在 prompt 里明说存在"作为一对，是"代码与 prompt 协作"的典型案例：**你可以用代码消除不确定性，但还要用 prompt 告诉模型不要再去检查那个不确定性**。

---

## 两条注入路径：系统提示 vs 消息附件

记忆进入上下文有**两条完全独立的路径**。

### 路径 1：系统提示（MEMORY.md 索引）

`constants/prompts.ts:495`

```typescript
systemPromptSection('memory', () => loadMemoryPrompt())
```

**注入内容**：

1. 类型化行为指令（4 类定义 + 什么不要存 + 怎么存 + 什么时候访问 + 怎么 recall 前验证）
2. **MEMORY.md 索引内容**（最多 200 行 / 25KB）

**注入时机**：系统提示构建期。`systemPromptSection` 做了缓存——同一个 section key 同一个结果只构建一次。

**注入载荷**：常驻。每次调用 Anthropic API 都会带。

### 路径 2：消息附件（相关主题文件）

`utils/attachments.ts:2196-2242` → `getRelevantMemoryAttachments`

```typescript
type: 'relevant_memories'
memories: {
  path: string
  content: string     // 完整文件内容（截断到 MAX_MEMORY_LINES/BYTES）
  mtimeMs: number
  header: string
  limit?: number
}[]
```

**注入内容**：每次最多 5 个主题文件的完整内容。

**注入时机**：每次用户 query 都触发一次异步预取（`startRelevantMemoryPrefetch`），不阻塞主对话。

**注入方式**：作为 attachment 进入消息流——**可被 microCompact 清掉**，与前者"常驻"不同。

**去重**：
- 之前回合已经 surfaced 过的 path 不再选（`alreadySurfaced`）
- 当前对话已经被 FileReadTool 读过的 path 不再注入（`readFileState`）
- 两次过滤：一次在 selector 前（省 budget），一次在 selector 后（多目录 flatten 之后）

### 为什么要分两条路径？

**MEMORY.md 是索引**，必须常驻——模型需要随时知道"过去有没有关于 X 的记忆"，否则它不会去 grep。

**完整文件是内容**，按需注入——注入所有文件会炸 token budget，而大部分记忆对当前 query 无关。

**对比一下两条路径的成本**：

| 路径 | 大小 | 常驻？ | 如何选 |
|---|---|---|---|
| MEMORY.md 索引 | 一行/文件，≤25KB 总量 | ✅ | 模型自己维护 |
| 相关文件附件 | 完整内容，≤5 个 | ❌ | Sonnet sidequery |

---

## findRelevantMemories — 用 LLM 选相关记忆

源码：`src/memdir/findRelevantMemories.ts` (142 LOC)

### 核心决策：不是 keyword，不是 embedding，而是 side-query to Sonnet

```typescript
const SELECT_MEMORIES_SYSTEM_PROMPT = `You are selecting memories that will be useful to Claude Code as it processes a user's query. You will be given the user's query and a list of available memory files with their filenames and descriptions.

Return a list of filenames for the memories that will clearly be useful to Claude Code as it processes the user's query (up to 5). Only include memories that you are certain will be helpful based on their name and description.
- If you are unsure if a memory will be useful in processing the user's query, then do not include it in your list. Be selective and discerning.
- If there are no memories in the list that would clearly be useful, feel free to return an empty list.
- If a list of recently-used tools is provided, do not select memories that are usage reference or API documentation for those tools (Claude Code is already exercising them). DO still select memories containing warnings, gotchas, or known issues about those tools — active use is exactly when those matter.
`
```

### 流程

```
1. scanMemoryFiles(memoryDir)
   ├─ readdir recursive（滤掉 MEMORY.md）
   ├─ 读每个文件前 30 行做 frontmatter parse
   ├─ 按 mtime 倒序，取前 200
   └─ 返回 [{filename, filePath, mtimeMs, description, type}]

2. 按 alreadySurfaced 过滤

3. formatMemoryManifest → 文本清单
   - [feedback] testing.md (2026-04-10T09:15:22Z): 集成测试必须真连库

4. sideQuery 到 Sonnet (max_tokens=256, JSON schema output)
   input: 
     system: SELECT_MEMORIES_SYSTEM_PROMPT
     user: Query: {{query}}\n\nAvailable memories:\n{{manifest}}\n\nRecently used tools: {{tools}}
   output: { selected_memories: string[] }

5. 过滤输出确保只含合法 filename

6. 返回 [{path, mtimeMs}] 最多 5 个
```

### 两个精妙的选择

**1. 只喂 description 不喂 body**。manifest 里每条只有 `[type] filename (mtime): description`。原因：body 可能很大，description 就是为此设计的。这就是为什么 `memoryTypes.ts` 要反复强调 "be specific" in description。

**2. tool-aware 过滤**。如果已知最近用过某些工具，指令要求 selector **不要**选那些工具的 API 文档类记忆（会议已经在用了，文档是噪音）。但**要**选那些工具的 warning/gotcha 类记忆——正在用恰好是这类记忆最该被看到的时候。

这个 prompt 背后的失败模式来自代码注释（`findRelevantMemories.ts:87-91`）：

> The selector otherwise matches on keyword overlap ("spawn" in query + "spawn" in a memory description → false positive).

基于 description 的相关性本质还是 LLM 在做 keyword overlap；而当工具名在 query 里出现又在记忆描述里出现时，会产生 "注入的是工具自己的使用文档" 这种无用结果。所以加了这个 negative filter。

### mtime 贯穿整个链路

`scanMemoryFiles` 返回 `mtimeMs` → `findRelevantMemories` 返回 `mtimeMs` → attachments 里生成 `memoryHeader(path, mtimeMs)` → 触发 `memoryFreshnessText()`：

```typescript
// memoryAge.ts:33
export function memoryFreshnessText(mtimeMs: number): string {
  const d = memoryAgeDays(mtimeMs)
  if (d <= 1) return ''
  return (
    `This memory is ${d} days old. ` +
    `Memories are point-in-time observations, not live state — ` +
    `claims about code behavior or file:line citations may be outdated. ` +
    `Verify against current code before asserting as fact.`
  )
}
```

`memoryFreshnessNote` 把这个警告包进 `<system-reminder>` tag 注入到 attachment。

**注释里的动机**（`memoryAge.ts:28-32`）：

> Motivated by user reports of stale code-state memories (file:line citations to code that has since changed) being asserted as fact — the citation makes the stale claim sound more authoritative, not less.

精确的 `file:line` 反而让模型**更**相信过时信息。解法是在附件里显式告诉它"这条记忆 N 天前写的，别当即时真相"。

"2 天前就开始 stale" 是很激进的 threshold。原因：记忆里的 code 引用贬值很快。

---

## extractMemories — 回合尾背景抽取 agent

源码：`src/services/extractMemories/extractMemories.ts`

### 触发

在 `query/stopHooks.ts:149` 调用：

```typescript
void extractMemoriesModule!.executeExtractMemories(
  stopHookContext,
  toolUseContext.appendSystemMessage,
)
```

触发点是 **stop hook**——即 query loop 结束（模型出了 final text，没再 tool_use）。这是一个 fire-and-forget 调用（`void`）。

### 跳过条件：主 agent 自己写过了

```typescript
if (hasMemoryWritesSince(messages, lastMemoryMessageUuid)) {
  // 主 agent 已经写了记忆 → 跳过这个回合
}
```

`hasMemoryWritesSince` 扫描消息历史，看 since cursor 之后的 assistant 消息里有没有 FileWrite/FileEdit 命中 `isAutoMemPath()` 的路径。如果有，背景抽取就跳过——主 agent 的系统提示已经包含了所有写入指令，它自己写的更精确。

**这是一个精心设计的"双轨 fallback"**：

> 主 agent 在写 → 背景 agent 不做重复工作
> 主 agent 没写 → 背景 agent 兜底

### Fork pattern

```typescript
const result = await runForkedAgent({
  promptMessages: [createUserMessage({ content: prompt })],
  cacheSafeParams: createCacheSafeParams(context),
  canUseTool: createAutoMemCanUseTool(memoryDir),
  querySource: 'extract_memories',
  forkLabel: 'extract_memories',
  skipTranscript: true,
  ...
})
```

这是标准的 fork-subagent（见 `sub-agent-fork.md`）：构造 byte-identical 的前缀让父子共享 Anthropic prompt cache。抽取 agent 享受**满 cache hit**——抽取的 marginal cost ≈ output tokens only。

### Prompt（摘自 `prompts.ts`）

```
You are now acting as the memory extraction subagent. Analyze the most recent ~{N} messages above and use them to update your persistent memory systems.

Available tools: FileReadTool, GrepTool, GlobTool, read-only BashTool (ls/find/cat/stat/wc/head/tail and similar), and FileEditTool/FileWriteTool for paths inside the memory directory only. BashTool rm is not permitted.

You have a limited turn budget. FileEditTool requires a prior FileReadTool of the same file, so the efficient strategy is: turn 1 — issue all FileReadTool calls in parallel; turn 2 — issue all FileWriteTool/FileEditTool calls in parallel. Do not interleave reads and writes across multiple turns.

You MUST only use content from the last ~{N} messages to update your persistent memories. Do not waste any turns attempting to investigate or verify that content further — no grepping source files, no reading code to confirm a pattern exists, no git commands.

## Existing memory files

{manifest — pre-injected so the agent doesn't `ls`}
```

几个**显式的效率约束**：

1. "turn 1 所有 read 并行 → turn 2 所有 write 并行" — 强制最多 2 个 turn
2. "只用最后 N 条消息内容" — 禁止抽取 agent 出去搜代码
3. 现有记忆清单预注入 — 避免它浪费回合 `ls`

这些约束把一次抽取的 token/turn 开销压到最低。配合 fork cache 共享，抽取几乎是 "免费的"。

### 工具权限：`createAutoMemCanUseTool`

抽取 agent 的 `canUseTool`（被 autoDream 复用）：

| 工具 | 允许条件 |
|---|---|
| REPL | 无条件允许（但内部的 read/bash/write 会递归走这个 canUseTool） |
| FileRead / Grep / Glob | 无条件允许 |
| Bash | 仅允许 `tool.isReadOnly(parsedInput)` 返回 true 的命令 |
| FileEdit / FileWrite | 仅当 `isAutoMemPath(file_path)` |
| 其他（MCP、Agent 等） | 全拒 |

有一个非常微妙的注释（`extractMemories.ts:176-179`）：

> Giving the fork a different tool list would break prompt cache sharing (tools are part of the cache key — see CacheSafeParams in forkedAgent.ts).

不能通过"修改工具列表"来限制 fork 的能力——那会破坏 cache。必须用 canUseTool 运行时拒绝。**权限不是通过"不给工具"而是通过"给了工具后在 call 时 deny"实现的**。

### 节流：turns since last extraction

```typescript
turnsSinceLastExtraction++
if (turnsSinceLastExtraction < (feature('tengu_bramble_lintel') ?? 1)) {
  return
}
turnsSinceLastExtraction = 0
```

每 N 个合格回合抽取一次（默认 1，即每回合）。Trailing run（stash 出来的 context）不受节流。

---

## autoDream — 做梦，也就是后台整理

源码：`src/services/autoDream/{autoDream.ts, consolidationLock.ts, consolidationPrompt.ts}`

### 比喻：REM 睡眠

注释 / 代码命名处处是"dream"。这个子系统模拟的是**人类在睡眠中巩固长期记忆**：把碎片日志整理成条理化的 topic 文件、合并重复、删掉被推翻的事实、更新索引。

这不是用户触发的，是**后台自动**的——用户感知到的只是"几天后的某次对话开头，某几个记忆文件变干净了"。

### 触发（三道 gate，从便宜到贵）

```typescript
// 1. 时间 gate — 一次 stat
const lastAt = await readLastConsolidatedAt()   // lock 文件的 mtime
const hoursSince = (Date.now() - lastAt) / 3_600_000
if (hoursSince < cfg.minHours) return    // 默认 24h

// 2. 扫描节流 — 10 分钟内只扫一次 session 目录
if (sinceScanMs < SESSION_SCAN_INTERVAL_MS) return

// 3. session gate — 枚举 session 目录
const sessionIds = await listSessionsTouchedSince(lastAt)
if (sessionIds.length < cfg.minSessions) return   // 默认 5

// 4. 锁 — 原子写 PID + 验证
const priorMtime = await tryAcquireConsolidationLock()
if (priorMtime === null) return
```

**cheapest-first** 的经典写法：时间 gate 是一次 stat，session gate 需要 `readdir`，这两者没过就早退。

### 锁文件：mtime = lastConsolidatedAt

`consolidationLock.ts`：

- 路径：`<memoryDir>/.consolidate-lock`
- **mtime = 上次 consolidated 时间**（所以 `readLastConsolidatedAt()` 只是 `stat()`）
- body = 当前进程 PID（防复用 + 死锁回收）
- HOLDER_STALE_MS = 1 小时 → 即便 PID 还活着，持锁超 1h 也判为 stale

失败回滚：`rollbackConsolidationLock(priorMtime)` 用 `utimes()` 把 mtime 拨回 prior。**注意它只拨 mtime 不删文件**——这让"下一次非强制 run 看到 lock 如同从未加过"。

### Fork 复用 extractMemories 的 canUseTool

```typescript
const result = await runForkedAgent({
  promptMessages: [createUserMessage({ content: prompt })],
  cacheSafeParams: createCacheSafeParams(context),
  canUseTool: createAutoMemCanUseTool(memoryRoot),   // ← 同一个函数
  ...
})
```

`createAutoMemCanUseTool` 是 extractMemories 导出的，autoDream 直接复用。两个背景 agent 的权限模型完全相同——读一切、写只能写记忆目录、bash 只能 read-only。

### Consolidation prompt（4 个 phase）

摘自 `consolidationPrompt.ts:15-64`：

```
# Dream: Memory Consolidation

You are performing a dream — a reflective pass over your memory files. Synthesize what you've learned recently into durable, well-organized memories so that future sessions can orient quickly.

## Phase 1 — Orient
- ls 记忆目录
- 读 MEMORY.md
- 扫已有 topic 文件（避免创建重复）
- 如果 logs/ 子目录存在（KAIROS 模式），浏览最近条目

## Phase 2 — Gather recent signal
优先级：
1. 日常日志（append-only stream）
2. 已漂移的现有记忆（与代码不符）
3. transcript 搜索（窄搜，不读整个文件）

## Phase 3 — Consolidate
- 把新 signal 并入已有 topic 文件，不要建几乎重复的
- 把 "昨天/上周" 转成绝对日期
- 删除被推翻的事实——今天的调研否定了某条记忆就修掉源头

## Phase 4 — Prune and index
- MEMORY.md 保持 <200 行 / <25KB
- 删过时指针
- 超过 200 char 的条目→内容太多，搬到 topic 文件
- 新增重要指针
- 解决矛盾：两文件冲突就修错的那个
```

这个 prompt 不包含类型定义和 "What NOT to save"——因为它是 fork，**系统提示已经有完整指令了**。只需要给它"做梦的流程"。

### 用户可见性

```typescript
if (appendSystemMessage && isDreamTask(dreamState) && dreamState.filesTouched.length > 0) {
  appendSystemMessage({
    ...createMemorySavedMessage(dreamState.filesTouched),
    verb: 'Improved',
  })
}
```

做完梦后，主对话里会插一条系统消息 "Improved N memories: foo.md, bar.md"。用户能看见梦的结果，但没法中止（abortController 不绑父亲——用户 ESC 不杀 dream）。

---

## team memory — 组织级同步

源码：`src/services/teamMemorySync/{index.ts, watcher.ts, teamMemSecretGuard.ts, secretScanner.ts}`

### 定位

- **Scope**：per-repo（按 git remote hash），组织内成员共享
- **Storage**：`<memoryPath>/team/`
- **Transport**：Anthropic server API

### API

```
GET  /api/claude_code/team_memory?repo={owner/repo}              → TeamMemoryData + entryChecksums
GET  /api/claude_code/team_memory?repo={owner/repo}&view=hashes  → 仅 checksums（无 body）
PUT  /api/claude_code/team_memory?repo={owner/repo}              → 批量上传（upsert）
```

### 推送触发：文件变动 debounce 2s

```typescript
const DEBOUNCE_MS = 2000
```

`watcher.ts` 用 `fs.watch({recursive:true})` 监听 team/ 目录。任意改动 → reset timer → 2s 后 push。**不推删除**——server→local 的同步不能删本地文件。

### Delta upload

upload 之前先 GET `?view=hashes` 拿到 server 端的 checksum，比对后**只上传 checksum 不同的文件**。这让"两个人都在同一个 team 目录里折腾" 的带宽代价 = 改动差异。

### 大小限制

```typescript
const MAX_FILE_SIZE_BYTES = 250_000    // 单条记忆 250KB
const MAX_PUT_BODY_BYTES = 200_000     // 单次 PUT 200KB（服务端 gateway ~512KB，留余量）
```

批量上传 → 分批，每批不超过 200KB。

### 永久失败抑制

如果 push 遇到 "permanent" 错误（no_oauth、4xx 非 409/429），**挂起 retry 直到**：
- 用户 unlink 一个文件（signal "something changed")
- session 重启

这个机制很必要——共享目录会被其他 session 的写入触发 watch 事件，如果每次失败都重试会陷入无限循环。

### 秘密扫描：`teamMemSecretGuard.ts`

写入 team 目录前过一遍 `scanForSecrets()`：

```typescript
`Content contains potential secrets (${labels}) and cannot be written to team memory.`
```

一个细节：`secretScanner` 在运行时组装敏感前缀（代码里显示 `ANT_KEY_PFX` — 把 "sk-ant-" 这样的前缀拆散，防止自己的源码里出现 literal）。

PSR ticket 编号 **M22174** 可见于注释——这是 Anthropic 内部 post-incident fix。

---

## /remember skill — 用户触发的跨层迁移

源码：`src/skills/bundled/remember.ts`

这**不是**保存记忆的接口（保存是模型自己做的）。这是一个**跨层审查和迁移工具**。

### 目标

审查所有记忆层（CLAUDE.md、CLAUDE.local.md、auto-memory、team memory），对每一条 auto-memory 提出归属建议：

| 目的地 | 该放什么 |
|---|---|
| CLAUDE.md | 所有贡献者都应遵守的项目惯例 |
| CLAUDE.local.md | 仅当前用户的个人偏好 |
| Team memory | 跨 repo 的组织知识 |
| Stay in auto-memory | 不确定、临时、没法归类 |

### 输出结构（不自动应用）

1. Promotions — 要迁移的条目
2. Cleanup — 重复 / 过时 / 冲突
3. Ambiguous — 需要用户决策
4. No action needed — 留着就行

**严格规则**：「Do NOT modify files without explicit user approval」。

这个 skill 的价值在于**让用户理解记忆的分层**。模型自己写 auto-memory，但是 auto-memory 里很多东西其实属于 CLAUDE.md（大家都要知道）或 CLAUDE.local.md（仅我个人）。手动迁移一次，记忆系统就"分层清晰"了。

限定 `USER_TYPE === 'ant'` —— 目前只在 Anthropic 内部员工账户启用。

---

## 权限模型：写入的 carve-out

源码：`src/utils/memoryFileDetection.ts` + `src/utils/permissions/filesystem.ts`

### 默认行为

FileWriteTool 在 "危险目录"（$HOME, /etc 等）写入前需要用户确认。

### Carve-out

如果 `isAutoMemPath(filePath) && !hasAutoMemPathOverride()`：

- 绕过 DANGEROUS_WRITE 提示
- 直接允许写入

这让 Claude 可以**静默写记忆**——否则每条记忆都要 prompt 一次，不可用。

### 两个加锁

**1. `!hasAutoMemPathOverride()`**：env var 覆盖路径时 carve-out 失效。因为 env var 往往是 Cowork/SDK 配的，这时候信任链不同，保守起见不给默许权限。

**2. `getAutoMemPathSetting` 排除 projectSettings**：前面说过了，恶意 repo 不能指定 `autoMemoryDirectory: "~/.ssh"` 然后让 Claude 静默写 ssh 目录。

权限系统的这个 carve-out 精确对应"记忆系统需要的最小特权"，没有一丝溢出。

---

## 与 CLAUDE.md / Plan / Task 的边界

这是 `memdir.ts:254-257` 直接写在 prompt 里的边界：

> Memory is one of several persistence mechanisms available to you as you assist the user in a given conversation. The distinction is often that memory can be recalled in future conversations and should not be used for persisting information that is only useful within the scope of the current conversation.
>
> - When to use or update a plan instead of memory: 非平凡实现任务的对齐
> - When to use or update tasks instead of memory: 当前会话步骤追踪

把五种持久化层列齐：

| 层 | 生命周期 | 作者 | 什么去那里 |
|---|---|---|---|
| **CLAUDE.md** | VCS 永久 | 人手写 | 项目规范（check-in） |
| **CLAUDE.local.md** | 本地永久（gitignored） | 人手写 | 个人偏好 |
| **auto memory** | 本地永久（per user） | 模型写 | 推不出的上下文 |
| **team memory** | Server 同步 | 模型写 | 组织共享知识 |
| **Plan** | 当前会话 | 模型写 | 执行前对齐 |
| **Task** | 当前会话 | 模型写 | 进度追踪 |

核心区分：**永久 vs 会话内** + **人手 vs 模型** + **本地 vs 同步**。

---

## 关键设计决策（12 条）

| # | 决策 | 在代码里的证据 |
|---|---|---|
| 1 | **四类封闭分类法**（不可扩展） | `MEMORY_TYPES` as const |
| 2 | **不存代码可推导的事实**（what NOT to save gate） | memoryTypes.ts:183-195，eval-validated |
| 3 | **description 承载相关性信号**（不是 body） | findRelevantMemories 只喂 manifest |
| 4 | **用 LLM 做相关性召回**（不是 keyword 也不是 embedding） | sonnet sidequery |
| 5 | **MEMORY.md 索引双重截断**（行 + 字节） | truncateEntrypointContent |
| 6 | **两条独立注入路径**（常驻索引 + 按需附件） | systemPromptSection vs attachment |
| 7 | **fork pattern 共享 cache** | extractMemories + autoDream 都用 runForkedAgent |
| 8 | **canUseTool 运行时权限** vs 裁剪工具列表 | 注释：裁剪会破 cache key |
| 9 | **写入 carve-out 只给记忆目录，且排除 projectSettings 来源** | paths.ts:175-186 |
| 10 | **锁 mtime = lastConsolidatedAt**（单一真相源） | consolidationLock.ts |
| 11 | **staleness warning 从 2 天开始**（激进 threshold） | memoryAge.ts:35 |
| 12 | **两个 TYPES_SECTION 故意重复**（反 DRY） | memoryTypes.ts:8-12 |
| 13 | **dream 是 fork，不重复 system prompt** | consolidationPrompt 不含类型定义 |
| 14 | **feedback 要记正面也要记负面**（防过度保守） | memoryTypes.ts:60 |
| 15 | **主 agent 写了就跳过背景抽取**（避免重复） | hasMemoryWritesSince |

---

## 和 memstudy 项目里的 auto-memory prompt 的关系

打开 `/root/.claude/projects/-opt-workspace-myclaude-memstudy/memory/` 看一眼——那就是 Claude Code 自己在运行时写的 auto-memory，正是本文分析的这套系统的产物。

把 SESSION 开头注入的系统提示和 `memdir.ts::buildMemoryLines()` 对比：**几乎 1:1 对应**。

```
# auto memory
You have a persistent, file-based memory system at `...`
...
## Types of memory
<types><type>...
```

区别在于 `/opt/workspace/myclaude/memstudy` 只有单目录（TYPES_SECTION_INDIVIDUAL），没有 `<scope>` 标签。

> **换句话说：memstudy 这个项目在研究的那套记忆系统，本身就是当前 Claude session 的记忆系统**。每次 `Write` 到 `memory/feedback_*.md` 都经过本文分析的 carve-out 权限；每次看 `MEMORY.md` 就是 `truncateEntrypointContent` 截断后的索引；每次对话开头的相关记忆注入就是 `findRelevantMemories` 的 Sonnet sidequery 结果。

memstudy 目录里实际运行的 memory/ 是这套系统的活样本。下次 debug 记忆行为可以直接看那里的文件 mtime + MEMORY.md 索引体积，用本文的 threshold 对照。

---

## 结语

记忆系统是 Claude Code 里**设计最完整**的子系统之一：

- **理论边界清晰**：封闭分类法 + "可推导 vs 不可推导" 的 dichotomy
- **注入机制双轨**：常驻索引 + 按需附件
- **写入通道双轨**：前台主 agent + 后台 fork
- **整理通道独立**：autoDream REM 风格
- **跨机器扩展**：team sync
- **安全性保守**：carve-out 只放记忆目录，projectSettings 排除，secret scanner
- **Prompt 工程克制**：用 eval 迭代措辞，不用 chain-of-thought 类模板

比起"memory = vector DB + similarity search"的工业界常见套路，这套系统显得**反主流**：没有 embedding、没有向量数据库、没有 ANN 索引。它的押注是：**模型本身就是最好的相关性函数，只要你让它看到 description 清单**。而这个押注成立的前提是 frontmatter 的 description 写得足够精确——所以前台 prompt 反复强调 "be specific"。

最后一条软性观察：整个系统极度依赖 Claude 的"自觉"。没有自动 evictor、没有 embedding 重排、没有 TTL 自动清理——所有"整理"都是靠 autoDream 里的 prompt "希望模型自己识别什么该删"。这种设计赌的是 **"prompt + eval 迭代 >> 预设算法"** 的工程哲学，在这套代码的每一处都能看到。
