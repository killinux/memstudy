# 斯坦福小镇 vs Claude Code — 记忆架构对比分析

> 斯坦福 Generative Agents 论文（Park et al., 2023）提出了 LLM agent 的记忆-反思-规划三层架构，被视为"给 LLM 装上长期记忆"的开山之作。Claude Code (free-code45) 的记忆系统在 2025 年实现了一套生产级方案。本文逐模块对比两者的设计选择，找出同源点、分歧点和背后的工程权衡。
>
> 前置阅读：`docs/memory-system.md`（Claude Code 记忆系统深度解析）

---

## 目录

1. [一句话对比](#一句话对比)
2. [论文回顾：Generative Agents 的三层架构](#论文回顾generative-agents-的三层架构)
3. [模块级对照表](#模块级对照表)
4. [记忆写入：Memory Stream vs extractMemories](#记忆写入memory-stream-vs-extractmemories)
5. [记忆整合：Reflection vs autoDream](#记忆整合reflection-vs-autodream)
6. [记忆检索：三维评分 vs LLM sidequery](#记忆检索三维评分-vs-llm-sidequery)
7. [记忆分类：三类 vs 四类封闭分类法](#记忆分类三类-vs-四类封闭分类法)
8. [遗忘机制：隐式衰减 vs 显式 staleness](#遗忘机制隐式衰减-vs-显式-staleness)
9. [规划：Plan 组件 vs 会话级 Plan 工具](#规划plan-组件-vs-会话级-plan-工具)
10. [Claude Code 独有的设计](#claude-code-独有的设计)
11. [为什么会有这些分歧](#为什么会有这些分歧)
12. [设计决策对照（15 条）](#设计决策对照15-条)
13. [结语](#结语)

---

## 一句话对比

| | Generative Agents (2023) | Claude Code (2025) |
|---|---|---|
| **一句话** | 用 embedding + 公式给 25 个小镇居民装上"看起来像人"的记忆 | 用 LLM 自身给开发者装上"跨会话有用"的记忆 |
| **核心押注** | 模型太弱 → 需要算法辅助（embedding + 加权公式） | 模型够强 → 让模型自己当检索器和整理者 |

---

## 论文回顾：Generative Agents 的三层架构

Park et al. (2023) *"Generative Agents: Interactive Simulacra of Human Behavior"* 的核心贡献是为 LLM agent 设计了三个记忆组件：

### 1. Memory Stream（记忆流）

一个 **append-only** 的观察日志。agent 每个时间步都把感知到的事件写进去，格式：

```
[2023-02-13 09:14] Klaus Mueller is reading a book on gentrification
[2023-02-13 09:15] Klaus Mueller sees Maria Lopez painting
```

每条带时间戳 + 自然语言描述。不过滤、不分类，全部记下来。

### 2. Reflection（反思）

定期触发的**高阶抽象**。当累积的 importance score 超过阈值时，agent 对最近的记忆做一次反思：

```
输入：最近 100 条 memory stream 记录
过程：
  1. 生成 3 个高阶问题（"What are the most salient questions about X?"）
  2. 对每个问题检索相关记忆
  3. 合成 insight（"Klaus Mueller is passionate about gentrification research"）
输出：一条新的 reflection 记录，写回 memory stream
```

反思的产物**和普通观察存在同一个流里**，但标记为 reflection 类型，有更高的 importance score。

### 3. Planning（规划）

日常行程规划。每天早上 agent 生成一天的粗粒度计划，然后逐步细化：

```
粗粒度：9:00-12:00 在图书馆做研究
细粒度：9:00-9:30 阅读论文 → 9:30-10:00 做笔记 → ...
```

计划可以被突发事件打断（encounter 另一个 agent → 重新规划）。

### 检索机制

检索是三个因素的**加权求和**：

```
score(memory) = α × recency(memory)
              + β × importance(memory)
              + γ × relevance(memory, query)
```

- **recency**：指数衰减，最近的得分高
- **importance**：1-10 整数，由 LLM 在写入时评分（"吃早饭" = 1，"分手" = 9）
- **relevance**：query 与 memory 文本的 embedding cosine similarity

---

## 模块级对照表

| 功能 | Generative Agents | Claude Code | 对应源码 |
|---|---|---|---|
| **记忆写入** | Memory Stream（append-only 日志） | extractMemories（fork agent 后台抽取） | `services/extractMemories/` |
| **记忆整合** | Reflection（importance 阈值触发） | autoDream（24h + 5 session 触发） | `services/autoDream/` |
| **记忆检索** | 三维加权（recency + importance + relevance） | Sonnet sidequery（纯 LLM 判断） | `memdir/findRelevantMemories.ts` |
| **记忆分类** | 3 类（observation / reflection / plan） | 4 类封闭（user / feedback / project / reference） | `memdir/memoryTypes.ts` |
| **记忆存储** | Python list（内存） | 文件系统（~/.claude/projects/.../memory/） | `memdir/paths.ts` |
| **遗忘** | recency 指数衰减（隐式） | staleness warning + autoDream 删除（显式） | `memdir/memoryAge.ts` |
| **规划** | Planning 组件（日程 + 细化） | Plan 工具（会话级，不持久化） | `tools/EnterPlanModeTool/` |
| **索引** | 无（全量检索） | MEMORY.md（≤200 行常驻系统提示） | `memdir/memdir.ts` |
| **多 agent 同步** | 无（每个 agent 独立） | teamMemorySync（server API 同步） | `services/teamMemorySync/` |

---

## 记忆写入：Memory Stream vs extractMemories

### 共同点：被动、不中断主流程

两者都选择了**不打断主行为**的被动写入：

- **Generative Agents**：每个时间步自动把感知写入 stream，agent 的"行动"不会因为"记录"而暂停
- **Claude Code**：`extractMemories` 是 `void`（fire-and-forget），query loop 结束后 fork 一个 agent 在后台抽取

### 分歧 1：全记 vs 选记

| | Generative Agents | Claude Code |
|---|---|---|
| **策略** | 全记（每步都写） | 选记（LLM 判断什么值得存） |
| **过滤** | 不过滤，靠 importance score 在检索时降权 | 写入时过滤——"可从代码推导的不存" |
| **原因** | 模拟"人类观察即记录" | 工程实用——存太多 token 浪费 |

Claude Code 的 `memoryTypes.ts:183-195` 明确列了"What NOT to save"，而且加了一条强约束：

> These exclusions apply even when the user explicitly asks you to save.

斯坦福小镇没有这种门——因为它的 recency decay 会自然把低 importance 的记忆"沉底"。

### 分歧 2：平铺流 vs 分类文件

| | Generative Agents | Claude Code |
|---|---|---|
| **存储** | 单一有序流（list） | 独立文件（每条一个 .md） |
| **结构** | 时间戳 + 自然语言 | frontmatter（name/description/type）+ body |
| **索引** | 无，全量扫描 | MEMORY.md 索引（一行一条） |

Claude Code 的 frontmatter `description` 字段是关键设计——它让检索只需看 description 清单而不用读全文。这在斯坦福小镇里没有对应物。

### 分歧 3：主 agent 也能写

Claude Code 有**双轨写入**：

1. 主 agent 在对话中直接写（用户说"记住这个"）
2. extractMemories fork 在后台抽取

如果主 agent 写了，后台抽取就跳过（`hasMemoryWritesSince` 检测）。斯坦福小镇只有一条写入通道。

---

## 记忆整合：Reflection vs autoDream

这是**最直接的同源关系**。

### 共同的核心思想

两者都认为：**碎片记忆需要定期整理成更高层的结构化知识**。

- Generative Agents 叫 **Reflection**（反思）
- Claude Code 叫 **autoDream**（做梦），代码注释明确说"模拟人类在 REM 睡眠中巩固长期记忆"

### 触发条件

| | Generative Agents | Claude Code |
|---|---|---|
| **触发逻辑** | importance score 累积超过阈值 | 三道 gate：24h 时间 + 5 个 session + 锁 |
| **设计哲学** | 内容驱动（重要的事多了就该反思） | 时间驱动（足够久了就该整理） |
| **开销控制** | 无显式开销控制 | cheapest-first gate（stat → readdir → lock） |

Claude Code 的三道 gate 是典型的工程化——先做最便宜的检查（一次 `stat`），不过就早退。论文里没有这种考虑。

### 整理方式

| | Generative Agents | Claude Code |
|---|---|---|
| **输入** | 最近 N 条记忆 | 整个 memory 目录的所有文件 |
| **输出** | 新的 reflection 条目，**追加到流里** | **修改原有文件**（合并重复、删过时、更新索引） |
| **结果去哪** | 和 observation 混在一起 | 原地修改，不产生新层级 |

这是一个关键分歧：**斯坦福小镇的 reflection 是增量的**（往流里加一条），**Claude Code 的 dream 是就地修改的**（改原文件）。

斯坦福小镇的 reflection 会越来越多层（observation → reflection → reflection-of-reflection）。Claude Code 故意**不分层**——dream 的结果直接修改 topic 文件，不产生"meta-memory"。

### autoDream 的 4 Phase

```
Phase 1 — Orient（读目录、读索引）
Phase 2 — Gather recent signal（找新信号）
Phase 3 — Consolidate（合并进已有 topic）
Phase 4 — Prune and index（修剪 MEMORY.md）
```

对比 Generative Agents 的 reflection：

```
Step 1 — 基于最近记忆生成高阶问题
Step 2 — 对每个问题检索相关记忆
Step 3 — 合成 insight
```

Claude Code 的 Phase 4（Prune and index）**在斯坦福小镇里没有对应物**。因为斯坦福小镇的 memory stream 是 append-only 的，不删不改；而 Claude Code 必须维护 MEMORY.md 索引在 200 行以内。

---

## 记忆检索：三维评分 vs LLM sidequery

这是**两套系统分歧最大的地方**，也是最能体现时代差异的地方。

### 斯坦福小镇：公式化检索

```python
score = α * recency_score + β * importance_score + γ * relevance_score

# recency: 指数衰减，e^(-λt)
# importance: LLM 在写入时打的 1-10 分
# relevance: embedding cosine similarity
```

三个维度各自独立计算，线性加权，取 top-K。

### Claude Code：LLM 直接判断

```typescript
// findRelevantMemories.ts
const result = await sideQuery({
  model: 'sonnet',
  system: SELECT_MEMORIES_SYSTEM_PROMPT,
  user: `Query: ${query}\n\nAvailable memories:\n${manifest}`,
  // manifest = 每条只有 [type] filename (mtime): description
})
// 返回：最多 5 个 filename
```

没有 embedding，没有公式，没有 importance score。**一切交给 Sonnet**。

### 为什么可以这样做？

| 因素 | 2023 (GPT-3.5) | 2025 (Sonnet) |
|---|---|---|
| 模型判断相关性的能力 | 不可靠 → 需要 embedding 兜底 | 足够强 → 直接当检索器 |
| 上下文窗口 | 4K-8K → 放不下太多候选 | 200K → manifest 全放进去 |
| API 成本 | 高 → 不敢给每次检索调一次 LLM | 低（Sonnet 便宜，且 max_tokens=256） |
| 记忆总量 | 数千条（模拟几天） | 数十到数百条（实际项目） |

关键洞察：Claude Code 的记忆数量远少于斯坦福小镇（一个项目通常 10-50 条 vs 小镇数千条），但每条的**语义密度更高**（整个 topic 文件 vs 一句观察）。在这个规模下，让 LLM 读 50 条 description 比 embedding 检索更准。

### tool-aware 过滤

Claude Code 还有一个斯坦福小镇没有的机制：

> 如果已知最近用过某些工具，不选那些工具的 API 文档类记忆，但要选那些工具的 warning/gotcha 类记忆——正在用恰好是这类记忆最该被看到的时候。

这是**上下文感知检索**——检索器知道 agent 正在做什么，据此调整策略。斯坦福小镇的检索只看 query 和 memory 本身。

---

## 记忆分类：三类 vs 四类封闭分类法

### 斯坦福小镇的三类

| 类型 | 内容 | 怎么产生 |
|---|---|---|
| **Observation** | 感知到的事件 | 自动记录 |
| **Reflection** | 高阶 insight | reflection 过程生成 |
| **Plan** | 未来行程 | planning 过程生成 |

三类按**产生方式**区分（被动观察 / 主动反思 / 规划）。

### Claude Code 的四类

| 类型 | 内容 | 怎么产生 |
|---|---|---|
| **user** | 用户的角色/目标/知识 | 主 agent 或 extract |
| **feedback** | 做事方式的正负反馈 | 主 agent 或 extract |
| **project** | 正在进行的工作/截止日期 | 主 agent 或 extract |
| **reference** | 外部系统的指针 | 主 agent 或 extract |

四类按**内容语义**区分（关于谁 / 怎么做 / 做什么 / 去哪找）。

### 对比

| 维度 | Generative Agents | Claude Code |
|---|---|---|
| **分类依据** | 产生方式 | 内容语义 |
| **是否封闭** | 是（硬编码 3 类） | 是（`as const`，不可扩展） |
| **是否分层** | 是（observation → reflection 是层级关系） | 否（四类平行） |
| **plan 去哪** | memory stream 里 | **不进记忆**（Plan 工具是会话级） |

Claude Code 把 plan 排除出记忆系统是刻意的——prompt 里明确说：

> When to use or update a plan instead of memory: 非平凡实现任务的对齐

---

## 遗忘机制：隐式衰减 vs 显式 staleness

### 斯坦福小镇：recency 指数衰减

旧记忆不会被删除，但 recency score 随时间指数衰减。效果：**自然沉底**——不手动删，但检索时排名越来越低。

### Claude Code：显式 staleness + 主动删除

两层机制：

**1. staleness warning（被动）**

```typescript
// memoryAge.ts
if (memoryAgeDays(mtimeMs) > 1) {
  return `This memory is ${d} days old. Verify against current code before asserting as fact.`
}
```

2 天后开始警告。代码注释里的动机：

> 精确的 `file:line` 引用反而让模型更相信过时信息。

**2. autoDream 主动删除（主动）**

Phase 3 里明确说"删掉被推翻的事实"。这在斯坦福小镇里没有——memory stream 是 append-only 的，reflection 只追加不修改。

### 对比

| | Generative Agents | Claude Code |
|---|---|---|
| **旧记忆命运** | 永存，recency 衰减 | 可被 dream 删除 |
| **衰减方式** | 连续（指数函数） | 离散（2 天阈值 + dream 整理） |
| **哲学** | "记忆不会消失，只会变淡" | "错误的记忆比没有记忆更有害" |

Claude Code 更激进。因为代码领域里，**过时的 file:line 引用是 actively harmful**（让模型说出错误的代码位置）。斯坦福小镇的记忆（"Klaus 在看书"）过时了只是无关，不会有害。

---

## 规划：Plan 组件 vs 会话级 Plan 工具

### 斯坦福小镇的 Planning

是记忆系统的一部分——计划写进 memory stream，像记忆一样被检索。

```
[Plan] 9:00-12:00: Research at the library
[Plan] 12:00-13:00: Lunch at the cafe
```

计划可以被意外事件打断，触发重新规划。

### Claude Code 的 Plan

**完全不在记忆系统里**。Plan 是一个独立的会话级工具（`EnterPlanModeTool`），用于在开始实现前与用户对齐方案。

```
持久化层级：
  CLAUDE.md      — VCS 永久 — 人手写
  auto memory    — 本地永久 — 模型写
  Plan           — 当前会话 — 模型写  ← 不持久化
  Task           — 当前会话 — 模型写  ← 不持久化
```

这个设计选择反映了不同的使用场景：

- 小镇居民需要"明天的计划"（持久化有意义）
- 开发者需要"这次对话的方案"（会话结束就失效）

---

## Claude Code 独有的设计

以下是 Claude Code 有而斯坦福小镇完全没有的：

### 1. 双注入路径

| 路径 | 内容 | 常驻？ |
|---|---|---|
| 系统提示中的 MEMORY.md 索引 | 一行/文件，≤25KB | ✅ |
| 附件中的相关文件完整内容 | ≤5 个文件 | ❌（可被 compact 清掉） |

斯坦福小镇只有一条路径：检索 → 拼入 prompt。

### 2. Fork pattern + prompt cache 共享

extractMemories 和 autoDream 都通过 `runForkedAgent` 执行，构造 byte-identical 的 API 请求前缀以共享 Anthropic prompt cache。

这是纯工程优化——论文不需要考虑 API 成本。

### 3. canUseTool 权限控制

后台 agent（extract / dream）的工具权限被精确限制：只能读一切、只能写记忆目录、bash 只能 read-only。而且**不是通过裁剪工具列表实现的**（那会破坏 cache key），而是通过运行时 deny。

### 4. 写入 carve-out 安全模型

记忆目录享有"不需要用户确认就能写"的特殊权限，但：
- `projectSettings`（.claude/settings.json）被排除 → 防恶意 repo 指定 `~/.ssh`
- env var 覆盖路径时 carve-out 失效

### 5. team memory 跨人同步

通过 server API 在组织内共享记忆。斯坦福小镇的 agent 各自独立，不共享记忆（它们通过直接对话交流）。

### 6. secret scanner

写入 team 目录前扫描敏感信息。斯坦福小镇不需要——虚拟小镇没有 API key。

---

## 为什么会有这些分歧

大部分分歧可以归结为**三个根本差异**：

### 差异 1：模型能力

| | 2023 | 2025 |
|---|---|---|
| 基础模型 | GPT-3.5-turbo | Claude Sonnet / Opus |
| 上下文窗口 | 4K-8K tokens | 200K tokens |
| 判断相关性的能力 | 弱 → 需要 embedding 辅助 | 强 → 直接当检索器 |
| 遵循复杂指令的能力 | 弱 → 用公式约束行为 | 强 → 用 prompt 约束行为 |

这解释了为什么 Claude Code 能放弃 embedding + 公式，转而用"让模型读 description 清单"。

### 差异 2：使用场景

| | Generative Agents | Claude Code |
|---|---|---|
| agent 数量 | 25 个持续运行 | 1 个按需启动 |
| 记忆量 | 数千条（模拟几天） | 数十条（一个项目） |
| 记忆寿命 | 模拟时间内（~2 天） | 数月到数年 |
| 错误代价 | 低（行为看起来不太像人） | 高（给出错误的代码建议） |

错误代价的差异解释了为什么 Claude Code 对 staleness 更激进（2 天就警告）、对分类更严格（封闭四类 + "不存可推导的"）。

### 差异 3：工程约束

| | 论文 | 生产系统 |
|---|---|---|
| API 成本 | 不重要 | 必须优化（fork cache 共享） |
| 安全性 | 不考虑 | 核心关注（carve-out / secret scanner / path validation） |
| 并发 | 单线程模拟 | 多 session 并发（锁 / debounce / stale holder 回收） |
| 存储 | 内存 | 文件系统（持久化 + 跨会话） |

---

## 设计决策对照（15 条）

| # | 决策维度 | Generative Agents | Claude Code | 谁更好？ |
|---|---|---|---|---|
| 1 | **检索算法** | embedding + 公式 | LLM sidequery | 取决于模型能力 |
| 2 | **写入策略** | 全记 | 选记（gate: "可推导的不存"） | Claude Code（token 经济） |
| 3 | **整合方式** | 追加新条目 | 修改原文件 | Claude Code（避免膨胀） |
| 4 | **分类依据** | 产生方式（3 类） | 内容语义（4 类） | Claude Code（更实用） |
| 5 | **遗忘机制** | 隐式衰减 | 显式 staleness + 删除 | Claude Code（代码场景更安全） |
| 6 | **plan 归属** | 记忆系统内 | 独立会话级工具 | 场景决定 |
| 7 | **importance score** | 有（1-10，LLM 打分） | 无 | 小镇需要（量大时区分优先级） |
| 8 | **索引** | 无 | MEMORY.md（常驻系统提示） | Claude Code（跨会话必需） |
| 9 | **多 agent 共享** | 无（对话交流） | teamMemorySync（API 同步） | 场景决定 |
| 10 | **安全模型** | 无 | carve-out + secret scan + path validation | Claude Code（生产必需） |
| 11 | **成本优化** | 无 | fork cache 共享 | Claude Code（API 计费必需） |
| 12 | **触发整理** | importance 累积阈值 | 时间 + session + 锁 | 小镇更自然，Claude Code 更可控 |
| 13 | **反思层级** | 多层（reflection of reflection） | 单层（dream 不分层） | 小镇更丰富，Claude Code 更简单 |
| 14 | **存储介质** | 内存 | 文件系统 | Claude Code（持久化必需） |
| 15 | **上下文注入** | 单路径（拼入 prompt） | 双路径（索引常驻 + 附件按需） | Claude Code（token 效率） |

---

## 结语

### 同源

Claude Code 的记忆系统和斯坦福小镇**共享同一个核心信念**：

> LLM agent 需要**被动记录 + 主动整理 + 按需检索**三个环节才能拥有有用的长期记忆。

`extractMemories` ≈ Memory Stream，`autoDream` ≈ Reflection，`findRelevantMemories` ≈ Retrieval。命名不同，角色一致。autoDream 甚至直接用了"dream"和"REM 睡眠"的隐喻——这与斯坦福小镇用"sleep"来触发 reflection 的思路如出一辙。

### 分歧

但具体实现几乎处处不同。核心原因是**模型能力的代际差异**：

- 2023 年的 GPT-3.5 需要 embedding + 公式来做模型做不好的事（相关性排序、重要性评估）
- 2025 年的 Sonnet/Opus 足够强，可以直接承担检索和整理的全部判断

Claude Code 的押注是：

> **prompt + eval 迭代 >> 预设算法**

这在 `docs/memory-system.md` 的结尾被精确总结：

> 整个系统极度依赖 Claude 的"自觉"。没有自动 evictor、没有 embedding 重排、没有 TTL 自动清理——所有"整理"都是靠 autoDream 里的 prompt "希望模型自己识别什么该删"。

如果 2023 年的论文是"**用工程弥补模型不足**"，那 2025 年的 Claude Code 就是"**相信模型，只给它足够的工具和指令**"。

### 演化方向

两者的关系不是"Claude Code 抄了斯坦福小镇"，而是：

```
                    认知科学的"记忆三阶段"
                    (编码 → 巩固 → 检索)
                          │
              ┌───────────┴───────────┐
              │                       │
     Generative Agents (2023)   Claude Code (2025)
     用算法模拟三阶段             用 LLM 自身实现三阶段
     embedding + 公式             prompt + sidequery
     append-only stream           typed files + index
     隐式衰减                      显式 staleness
```

两者都是把**认知科学中的记忆模型**（编码-巩固-检索）工程化。斯坦福小镇更忠实于"模拟人类"（连"重要的事情记得更牢"都模拟了），Claude Code 更务实地解决"跨会话上下文"问题。

它们的共同贡献是确立了一个被广泛验证的 pattern：**agent 的记忆不能只是 append-only 日志，必须有主动整理环节**。无论叫 reflection 还是 dream，这一步都不可省。
