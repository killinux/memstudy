# 用 Claude Code 架构升级斯坦福小镇 — 设计方案

> 基于本仓库对 Claude Code (free-code45) 的深度逆向分析，提出将斯坦福 Generative Agents 从 2023 年的 GPT-3.5 + embedding 架构升级到 2025 年 Claude/GPT-4o 级别模型架构的具体方案。
>
> 前置阅读：
> - `docs/stanford-generative-agents-vs-claude-code.md`（两者对比）
> - `docs/memory-system.md`（Claude Code 记忆系统）
> - `docs/sub-agent-fork.md`（子 Agent / Fork 机制）
> - `docs/agent-loop-implementation.md`（Agent Loop 实现）

---

## 目录

1. [升级总览](#升级总览)
2. [升级 1：用 LLM sidequery 替代 embedding 检索](#升级-1用-llm-sidequery-替代-embedding-检索)
3. [升级 2：记忆从 append-only 流改为类型化文件](#升级-2记忆从-append-only-流改为类型化文件)
4. [升级 3：Reflection 改为 autoDream 式就地整合](#升级-3reflection-改为-autodream-式就地整合)
5. [升级 4：引入 Fork pattern 降低多 agent 成本](#升级-4引入-fork-pattern-降低多-agent-成本)
6. [升级 5：加入双注入路径管理上下文窗口](#升级-5加入双注入路径管理上下文窗口)
7. [升级 6：记忆写入从全记改为选记](#升级-6记忆写入从全记改为选记)
8. [升级 7：显式 staleness 替代隐式衰减](#升级-7显式-staleness-替代隐式衰减)
9. [升级 8：引入 agent 间记忆共享](#升级-8引入-agent-间记忆共享)
10. [升级 9：Agent Loop 化改造主循环](#升级-9agent-loop-化改造主循环)
11. [升级 10：权限与安全模型](#升级-10权限与安全模型)
12. [实现优先级与依赖关系](#实现优先级与依赖关系)
13. [预期效果](#预期效果)
14. [风险与取舍](#风险与取舍)

---

## 升级总览

### 当前架构（2023 论文）

```
┌──────────────────────────────────────────────────┐
│              25 个 Agent 各自独立                  │
│                                                   │
│  感知 → Memory Stream (append-only)               │
│           ↓                                       │
│  检索 ← embedding cosine + recency + importance   │
│           ↓                                       │
│  Reflection (importance 累积触发，追加新条目)       │
│           ↓                                       │
│  Planning (每日生成 + 细化)                        │
│           ↓                                       │
│  Action (单步输出)                                 │
│                                                   │
│  模型: GPT-3.5-turbo / GPT-4                      │
│  存储: Python list (内存)                          │
│  检索: embedding + 三维加权公式                     │
└──────────────────────────────────────────────────┘
```

### 目标架构（升级后）

```
┌──────────────────────────────────────────────────────────────┐
│              25 个 Agent，共享记忆层                           │
│                                                               │
│  感知 → 选择性写入 (LLM gate: "琐碎的不存")                    │
│           ↓                                                   │
│  类型化文件存储 (social/self/world/plan 四类)                   │
│  ├── MEMORY.md 索引 (常驻 system prompt)                      │
│  └── topic files (按需注入)                                    │
│           ↓                                                   │
│  检索 ← LLM sidequery (读 description 清单, 不用 embedding)   │
│           ↓                                                   │
│  autoDream 式整合 (时间触发，就地修改，不追加层级)               │
│           ↓                                                   │
│  Agent Loop (循环执行，工具调用，自我纠错)                      │
│           ↓                                                   │
│  Fork pattern (agent 间对话/reflection 共享 cache)             │
│                                                               │
│  模型: Claude Sonnet / GPT-4o                                 │
│  存储: 文件系统 (持久化 + 跨 session)                          │
│  检索: LLM sidequery (零 embedding 依赖)                      │
└──────────────────────────────────────────────────────────────┘
```

### 十项升级一览

| # | 升级项 | 来源 | 核心变化 | 难度 |
|---|---|---|---|---|
| 1 | LLM 检索替代 embedding | `findRelevantMemories.ts` | 删掉 embedding 管线 | ★★☆ |
| 2 | 类型化文件替代 append-only 流 | `memdir/memoryTypes.ts` | 重写存储层 | ★★★ |
| 3 | 就地整合替代追加 reflection | `autoDream/` | 重写 reflection | ★★★ |
| 4 | Fork pattern 降成本 | `forkedAgent.ts` | 新增 cache 共享机制 | ★★★★ |
| 5 | 双注入路径 | `memdir.ts` + `attachments.ts` | 新增索引 + 按需附件 | ★★☆ |
| 6 | 选择性写入 | `extractMemories/` | 新增写入 gate | ★★☆ |
| 7 | 显式 staleness | `memoryAge.ts` | 替换 recency 衰减 | ★☆☆ |
| 8 | agent 间记忆共享 | `teamMemorySync/` | 新增共享层 | ★★★ |
| 9 | Agent Loop 主循环 | `query.ts` | 重写行动循环 | ★★★★ |
| 10 | 权限安全 | `permissions/` | 新增安全层 | ★★☆ |

---

## 升级 1：用 LLM sidequery 替代 embedding 检索

### 当前问题

斯坦福小镇用 `embedding + 三维加权` 检索记忆：

```python
score = α * recency(m) + β * importance(m) + γ * cosine_sim(embed(query), embed(m))
```

问题：
- **embedding 是语义浅匹配**——"Klaus 在图书馆看论文" 和 "Klaus 对城市规划感兴趣" 的 embedding 距离可能很远，但语义高度相关
- **三个超参数 α, β, γ 需要手调**——论文里用了固定值，不同场景需要不同权重
- **importance 打分不稳定**——GPT-3.5 对 1-10 的校准很差

### Claude Code 的方案

```python
# 伪代码：把 Claude Code 的 findRelevantMemories 移植到小镇
def retrieve_memories(agent, query, recent_actions):
    # 1. 构建 manifest（只有 description，不含 body）
    manifest = []
    for m in agent.memory_files:
        manifest.append(f"[{m.type}] {m.name} ({m.date}): {m.description}")

    # 2. LLM sidequery（用便宜模型）
    prompt = f"""Select memories useful for this agent's next action.
    
Agent: {agent.name} ({agent.traits})
Current situation: {query}
Recent actions: {recent_actions}

Available memories:
{chr(10).join(manifest)}

Return filenames of clearly relevant memories (max 5). 
If unsure, don't include. Be selective."""

    selected = cheap_model.query(prompt, max_tokens=256)
    
    # 3. 读取完整内容
    return [agent.read_memory(f) for f in selected]
```

### 为什么对小镇更好

- **25 个 agent × 每步都检索** → embedding API 调用量大；LLM sidequery 用 Haiku/GPT-4o-mini 级别，比 embedding + cosine 更便宜
- **模型理解语义关联** → "看论文" 和 "对城市规划感兴趣" 的关联，LLM 能识别，embedding 不一定能
- **上下文感知** → Claude Code 的 tool-aware 过滤可以改成 **action-aware 过滤**：如果 agent 正在吃饭，不检索工作相关记忆的 API 文档类条目，但检索"Klaus 不吃辣"这种偏好类条目

### 小镇特殊适配

小镇和 Claude Code 的区别：小镇记忆量更大（数千条 vs 数十条）。当记忆超过 200 条时，manifest 放不进一次 sidequery。

**解法：两阶段检索**

```
阶段 1: 按 type + recency 预过滤到 ≤200 条（便宜，纯规则）
阶段 2: LLM sidequery 精选 ≤5 条（贵，但只跑一次）
```

保留 recency 作为**预过滤器**而非评分因子。importance score 可以完全去掉。

---

## 升级 2：记忆从 append-only 流改为类型化文件

### 当前问题

Memory stream 是一个巨大的 append-only list，所有东西（观察、反思、计划）混在一起：

```
[09:14] Klaus sees Maria painting (observation)
[09:15] Klaus walks to the cafe (observation)
[09:15] Klaus is passionate about urban research (reflection)
[10:00] Klaus plans to visit the library (plan)
```

问题：
- **线性增长**——模拟几天就有数千条
- **没有结构**——检索时无法按语义分区
- **reflection 和 observation 混在一起**——高价值和低价值记忆无区分

### 升级方案：四类封闭分类法

借鉴 Claude Code 的 `MEMORY_TYPES`，为小镇设计四类：

```python
MEMORY_TYPES = [
    'social',      # 关于其他人的认知（≈ Claude Code 的 user）
    'self',        # 关于自己的偏好/目标/身份（≈ feedback）
    'world',       # 关于环境/事件/地点的知识（≈ project）
    'plan',        # 当前和未来的计划（≈ reference）
]
```

### 存储结构

```
agents/
├── klaus_mueller/
│   ├── MEMORY.md                          # 索引（≤100 行）
│   ├── social_maria_lopez.md              # 对 Maria 的认知
│   ├── social_john_lin.md                 # 对 John 的认知
│   ├── self_research_interests.md         # 自己的研究兴趣
│   ├── self_daily_habits.md               # 日常习惯偏好
│   ├── world_library_resources.md         # 图书馆相关知识
│   ├── world_valentines_party.md          # 情人节派对事件
│   └── plan_current.md                    # 当前计划
├── maria_lopez/
│   ├── MEMORY.md
│   └── ...
```

每个文件有 frontmatter：

```markdown
---
name: Maria Lopez - friendship and art discussions
description: Klaus's understanding of Maria's personality, art interests, and their friendship dynamics
type: social
last_interaction: 2023-02-13T09:15:00
---

Maria is an artist living next door. She's been working on a series about urban landscapes.
Klaus and Maria often discuss the intersection of art and urban planning.
She mentioned she's preparing for a gallery showing in March.
```

### 核心好处

| 维度 | append-only 流 | 类型化文件 |
|---|---|---|
| 查找"Klaus 对 Maria 的印象" | 全流扫描 | 直接读 `social_maria_lopez.md` |
| 总记忆量 | O(时间步) 无限增长 | O(实体数) 有上限 |
| 更新认知 | 追加新条目（旧的还在） | 修改原文件（旧的被覆盖） |
| 检索效率 | 需要 embedding 全量排序 | manifest 只有文件名 + description |

---

## 升级 3：Reflection 改为 autoDream 式就地整合

### 当前问题

斯坦福小镇的 Reflection 是**追加式**的：

```
观察 → 观察 → 观察 → [触发 Reflection] → 追加一条高阶 insight → 继续观察 → ...
```

问题：
- **层数无限增长**（observation → reflection → reflection-of-reflection）
- **不删不改**——被推翻的旧认知永远留着
- **reflection 频率靠 importance 累积**——重要事件少的日子可能一整天不 reflect

### 升级方案：autoDream 式定时就地整合

```python
class DreamEngine:
    """模拟 Claude Code 的 autoDream 机制"""
    
    MIN_HOURS = 6          # 小镇时间 6 小时触发一次（≈ Claude Code 的 24h）
    MIN_INTERACTIONS = 10  # 至少 10 次有意义交互
    
    async def maybe_dream(self, agent, current_time):
        # Gate 1: 时间（最便宜的检查）
        hours_since = (current_time - agent.last_dream_time).hours
        if hours_since < self.MIN_HOURS:
            return
        
        # Gate 2: 交互量
        interactions = agent.count_interactions_since(agent.last_dream_time)
        if interactions < self.MIN_INTERACTIONS:
            return
        
        # Gate 3: 锁（防并发 dream）
        if not agent.try_acquire_dream_lock():
            return
        
        try:
            await self.run_dream(agent, current_time)
        finally:
            agent.release_dream_lock(current_time)  # mtime = now
    
    async def run_dream(self, agent, current_time):
        """四阶段整合，直接移植 Claude Code 的 consolidationPrompt"""
        
        prompt = f"""# Dream: Memory Consolidation for {agent.name}

You are performing a dream — a reflective pass over {agent.name}'s memory files.
Synthesize recent experiences into durable, well-organized memories.

## Phase 1 — Orient
- Read MEMORY.md index
- Scan existing topic files

## Phase 2 — Gather recent signal
Priority:
1. New social interactions (met someone, learned something about someone)
2. Significant events (party, argument, discovery)
3. Changes in plans or goals

## Phase 3 — Consolidate
- Merge new observations into existing topic files
- Convert "earlier today" → absolute timestamps
- If today's experience contradicts a memory, UPDATE the source file
- Do NOT create near-duplicate files

## Phase 4 — Prune and index
- Keep MEMORY.md under 100 lines
- Remove stale pointers
- Add important new entries
- Resolve contradictions between files

## Current memories:
{agent.memory_manifest()}

## Recent unprocessed observations:
{agent.unprocessed_observations()}
"""
        
        result = await model.query(prompt, tools=[
            FileReadTool, FileWriteTool, FileEditTool
        ])
        
        # 清空已处理的观察缓冲区
        agent.clear_observation_buffer()
```

### 关键差异：追加 → 就地修改

```
旧方案（Reflection）:
  "Klaus saw Maria painting" (observation, day 1)
  "Klaus values his friendship with Maria" (reflection, day 1)
  "Klaus and Maria discussed urban art" (observation, day 2)
  "Klaus considers Maria a kindred spirit" (reflection, day 2)  ← 越来越多
  
新方案（Dream）:
  social_maria_lopez.md (持续更新):
  ---
  最新：Klaus 和 Maria 讨论了城市艺术，两人是志趣相投的朋友。
  Maria 正在准备三月的画展。
  ---
  ← 一个文件，所有关于 Maria 的认知都在这里，会被 dream 持续更新
```

### 小镇特殊适配：观察缓冲区

Claude Code 的 extractMemories 在每个 query 结束后运行。小镇需要一个**观察缓冲区**：

```python
class Agent:
    def __init__(self):
        self.observation_buffer = []  # 未被 dream 处理的观察
        self.memory_dir = Path(f"agents/{self.name}/")
    
    def observe(self, event):
        """每个时间步调用——只写缓冲区，不动文件"""
        self.observation_buffer.append({
            'time': current_time,
            'content': event,
        })
    
    def unprocessed_observations(self):
        """给 dream prompt 用"""
        return "\n".join(
            f"[{o['time']}] {o['content']}" 
            for o in self.observation_buffer
        )
```

**观察先进缓冲区，dream 时批量整合进文件**。这比原版的"每步都写 memory stream"更高效——减少了 90% 的 LLM 写入调用。

---

## 升级 4：引入 Fork pattern 降低多 agent 成本

### 当前问题

25 个 agent，每个每步都要调 API。如果每个都带完整 system prompt + 记忆 + 历史，**token 成本爆炸**。

### Claude Code 的 Fork 精髓

来自 `docs/sub-agent-fork.md` 的核心发现：

> Fork 的本质是构造**字节相同的 API 请求前缀**让父子共享 Anthropic prompt cache。

```
cache_key = hash(system_prompt + tools + model + messages_prefix + thinking_config)
```

### 移植方案：世界模拟器作为"父 agent"

```
┌──────────────────────────────────────────────────┐
│  World Simulator（父 agent）                      │
│  - 共享的世界描述 system prompt                    │
│  - 共享的工具定义（move, talk, observe, ...）      │
│  - 共享的世界状态消息前缀                          │
└─────────────────────┬────────────────────────────┘
                      │ fork（字节相同的前缀）
        ┌─────────────┼─────────────────┐
        ▼             ▼                 ▼
    Klaus fork    Maria fork       John fork
    (+ Klaus 记忆  (+ Maria 记忆    (+ John 记忆
     + Klaus 性格)  + Maria 性格)    + John 性格)
```

**具体做法**：

```python
class WorldSimulator:
    def __init__(self):
        # 所有 agent 共享的前缀
        self.shared_system_prompt = """You are simulating a character in a small town.
        
World state:
- Location map: ...
- Current time: ...
- Weather: ...

Available actions:
- move(destination): Walk to a location
- talk(agent, message): Start a conversation
- observe(): Look around
- reflect(): Think about recent events
- sleep(): End the day
"""
        self.shared_tools = [MoveTool, TalkTool, ObserveTool, ReflectTool, SleepTool]
    
    async def step(self, agent):
        """每个 agent 的每一步"""
        
        # 构造 cache-safe 请求
        messages = [
            # 共享前缀（所有 agent 字节相同 → 命中 cache）
            *self.shared_world_state_messages(),
            
            # agent 特有部分（只有这部分是新 token）
            user_message(f"""You are {agent.name}. {agent.personality}
            
Your current memories:
{agent.relevant_memories(context)}

Your current location: {agent.location}
What do you do next?""")
        ]
        
        response = await api.query(
            system=self.shared_system_prompt,  # ← cache hit
            tools=self.shared_tools,           # ← cache hit
            messages=messages,                 # ← 前缀 cache hit
        )
        
        return response
```

### 成本估算

假设 shared prefix = 5000 tokens, agent-specific = 2000 tokens：

| 方案 | 每步每 agent 的 input tokens | 25 agent × 100 步 |
|---|---|---|
| 原版（无 cache） | 7000 | 17,500,000 |
| Fork pattern（90% cache hit） | 700 + 2000 = 2700 | 6,750,000 |
| **节省** | | **61%** |

实际节省可能更高，因为 Anthropic API 的 cache hit token 价格是原价的 10%。

---

## 升级 5：加入双注入路径管理上下文窗口

### 当前问题

原版把所有检索到的记忆直接拼进 prompt。当记忆多了，prompt 膨胀，成本上升。

### Claude Code 的双路径

| 路径 | 内容 | 常驻？ | 成本 |
|---|---|---|---|
| MEMORY.md 索引 | 一行/文件，知道"有什么" | ✅ 每次都带 | 低（≤100 行） |
| 相关文件附件 | 完整内容，知道"具体是什么" | ❌ 按需注入 | 中（≤5 文件） |

### 小镇移植

```python
class AgentMemoryInjector:
    def build_system_prompt_section(self, agent):
        """路径 1：常驻索引（每步都带）"""
        index = agent.read_memory_index()  # MEMORY.md 内容
        return f"""
# Your Memory Index
The following is a summary of everything you remember. 
Use this to decide if you need to recall specific memories.

{index}
"""
    
    def build_relevant_attachments(self, agent, situation):
        """路径 2：按需注入（LLM sidequery 选择）"""
        selected = retrieve_memories(agent, situation)  # 升级 1 的检索
        attachments = []
        for mem in selected:
            content = agent.read_memory_file(mem.path)
            age_days = (now - mem.mtime).days
            header = f"[Memory: {mem.name}]"
            if age_days > 2:
                header += f" (⚠️ {age_days} days old — verify before relying on)"
            attachments.append(f"{header}\n{content}")
        return "\n\n".join(attachments)
```

**效果**：每步只带 ~100 行索引（常驻），只在需要时注入 ≤5 个完整文件。比原版"检索 10 条记忆全文拼进去"省 token。

---

## 升级 6：记忆写入从全记改为选记

### 当前问题

原版每步都写 memory stream："Klaus walks to the cafe" "Klaus sits down" "Klaus orders coffee"——大量琐碎观察。

### 升级方案：写入 gate

```python
class ObservationFilter:
    """借鉴 Claude Code 的 "What NOT to save" gate"""
    
    TRIVIAL_PATTERNS = [
        "walks to",
        "sits down", 
        "stands up",
        "looks around",
        "enters the",
        "exits the",
    ]
    
    def should_record(self, agent, observation):
        """快速过滤 + LLM 判断"""
        
        # Gate 1: 模式过滤（免费）
        for pattern in self.TRIVIAL_PATTERNS:
            if pattern in observation.lower():
                return False
        
        # Gate 2: 与已有记忆重复检测（便宜）
        if self.is_redundant(agent, observation):
            return False
        
        # Gate 3: LLM 判断是否值得记（贵，但只对通过前两关的调用）
        return self.llm_importance_check(agent, observation)
    
    def llm_importance_check(self, agent, observation):
        prompt = f"""Would this observation change {agent.name}'s understanding 
of someone, something, or themselves? 

Observation: {observation}
Answer YES or NO only."""
        
        return cheap_model.query(prompt).strip() == "YES"
```

**预期效果**：写入量减少 70-80%。"Klaus 走到咖啡馆"不记，"Klaus 发现 Maria 在为画展焦虑"记。

---

## 升级 7：显式 staleness 替代隐式衰减

### 当前问题

原版的 recency decay 是隐式的——旧记忆分数自然下降但永远不删。几天后 memory stream 里充满了过时信息。

### 升级方案

```python
def memory_freshness_warning(memory_file, current_sim_time):
    """移植 Claude Code 的 memoryAge.ts"""
    age_hours = (current_sim_time - memory_file.last_modified).total_seconds() / 3600
    
    # 小镇时间流速不同，用小时而非天
    if age_hours <= 6:
        return ""  # 6 小时内的记忆是新鲜的
    elif age_hours <= 24:
        return f"(This memory is {int(age_hours)} hours old. The situation may have changed.)"
    else:
        return f"(⚠️ This memory is {int(age_hours/24)} days old. Verify before acting on it.)"
```

配合 autoDream（升级 3），过时记忆会在 dream 期间被**主动修改或删除**，而不是无限堆积。

---

## 升级 8：引入 agent 间记忆共享

### 当前问题

原版 25 个 agent 各自独立。如果 Klaus 告诉 Maria 一件事，Maria 只通过"对话记忆"知道，但这个信息不会在其他 agent 间传播（除非他们也对话）。

### 升级方案：借鉴 teamMemorySync 的共享层

```
agents/
├── _shared/                    # 共享层（≈ Claude Code 的 team memory）
│   ├── MEMORY.md               # 共享索引
│   ├── world_valentines_party.md   # 公共事件
│   └── world_weather.md        # 天气等公共信息
│
├── klaus_mueller/              # 私有层
│   ├── MEMORY.md
│   ├── social_maria_lopez.md   # Klaus 视角的 Maria
│   └── self_research.md
│
├── maria_lopez/
│   ├── MEMORY.md
│   ├── social_klaus_mueller.md # Maria 视角的 Klaus
│   └── self_art_projects.md
```

**规则**：
- 公共事件（派对、天气、店铺开关门）写入 `_shared/`
- 个人观察和社交印象写入私有层
- 每个 agent 的检索同时查两个目录
- 共享记忆的 staleness 阈值更长（公共事实变化慢）

**与斯坦福小镇的"传话"机制互补**：原版靠 agent 对话传播信息，共享层让**公共事件自动可见**（现实中人通过布告栏/新闻/环境感知获取公共信息，不全靠口口相传）。

---

## 升级 9：Agent Loop 化改造主循环

### 当前问题

原版每步只输出一个动作。agent 不能"尝试 → 失败 → 调整"。

### 升级方案：借鉴 query.ts 的 Agent Loop

```python
async def agent_step(agent, world, max_turns=5):
    """一个时间步内，agent 可以多次尝试"""
    
    messages = build_initial_messages(agent, world)
    
    for turn in range(max_turns):
        response = await model.query(
            system=agent.system_prompt,
            messages=messages,
            tools=AGENT_TOOLS,
        )
        
        # 纯文本回复 = agent 在"想"或"说"
        if not response.tool_calls:
            # 对外表达（其他 agent 可感知）
            world.broadcast(agent, response.text)
            break
        
        # 有工具调用 = agent 在"做"
        for tool_call in response.tool_calls:
            result = await execute_tool(agent, world, tool_call)
            
            # 关键：错误作为 tool_result 返回（不抛异常）
            # 让模型自己纠错
            messages.append(tool_result_message(tool_call.id, result))
        
        # 继续循环，模型看到结果后可能调整策略
    
    return messages

# 工具定义
AGENT_TOOLS = [
    {
        "name": "move",
        "description": "Walk to a location. Returns what you see there.",
        "parameters": {"destination": "string"}
    },
    {
        "name": "talk",
        "description": "Say something to someone nearby. Returns their response.",
        "parameters": {"target": "string", "message": "string"}
    },
    {
        "name": "observe",
        "description": "Look around carefully. Returns detailed description.",
    },
    {
        "name": "use_object",
        "description": "Interact with an object (open door, read book, etc.)",
        "parameters": {"object": "string", "action": "string"}
    },
    {
        "name": "wait",
        "description": "Wait and do nothing for a while.",
        "parameters": {"duration_minutes": "integer"}
    },
]
```

### 关键设计：错误作为 tool_result

来自 `docs/agent-loop-implementation.md` 的核心发现：

> 错误作为 tool_result 让模型自己纠错，不抛异常。

```python
async def execute_tool(agent, world, tool_call):
    try:
        if tool_call.name == "move":
            if world.is_path_blocked(agent.location, tool_call.params["destination"]):
                # 不抛异常，返回失败描述 → 模型会尝试其他路线
                return f"The path to {tool_call.params['destination']} is blocked. You could try going through the park instead."
            agent.location = tool_call.params["destination"]
            return world.describe_location(agent.location)
        
        elif tool_call.name == "talk":
            target = world.find_agent(tool_call.params["target"])
            if target is None:
                return f"{tool_call.params['target']} is not here. You see: {world.agents_at(agent.location)}"
            # 触发目标 agent 的响应
            response = await target.respond_to(agent, tool_call.params["message"])
            return response
        # ...
    except Exception as e:
        return f"Error: {str(e)}"  # 始终返回，不抛出
```

**效果**：agent 可以在一个时间步内尝试多个动作，遇到障碍自己调整。比原版的"单步输出"更自然——现实中人不会"走到门口 → 发现锁了 → 等下一个时间步才想到敲门"。

---

## 升级 10：权限与安全模型

### 为什么需要

如果小镇 agent 有工具（move, talk, use_object），就需要约束：
- agent 不能瞬移（必须经过路径）
- agent 不能读取他人私有记忆
- agent 不能同时在两个地方

### 借鉴 Claude Code 的 canUseTool 模式

```python
def can_use_tool(agent, tool_call, world):
    """运行时权限检查（不是裁剪工具列表）"""
    
    if tool_call.name == "move":
        dest = tool_call.params["destination"]
        if not world.is_adjacent(agent.location, dest):
            return False, f"You can't reach {dest} from {agent.location} in one step"
        if world.is_locked(dest) and not agent.has_key(dest):
            return False, f"{dest} is locked"
    
    elif tool_call.name == "talk":
        target_name = tool_call.params["target"]
        target = world.find_agent(target_name)
        if target is None or target.location != agent.location:
            return False, f"{target_name} is not in {agent.location}"
    
    elif tool_call.name == "use_object":
        obj = tool_call.params["object"]
        if obj not in world.objects_at(agent.location):
            return False, f"There is no {obj} here"
    
    return True, ""
```

**关键**：像 Claude Code 一样，**不裁剪工具列表，而是在调用时检查**。原因相同——如果不同 agent 的工具列表不同，就无法共享 prompt cache（升级 4 的 Fork pattern 失效）。

---

## 实现优先级与依赖关系

```
                          ┌─────────────┐
                          │ 升级 2       │
                     ┌───>│ 类型化文件   │<───┐
                     │    └──────┬──────┘    │
                     │           │           │
              ┌──────┴───┐ ┌────▼─────┐ ┌───┴──────┐
              │ 升级 1    │ │ 升级 3   │ │ 升级 5   │
              │ LLM 检索  │ │ autoDream│ │ 双注入   │
              └──────┬───┘ └────┬─────┘ └───┬──────┘
                     │          │           │
                     └────┬─────┘           │
                          │                 │
                     ┌────▼─────┐    ┌──────▼──────┐
                     │ 升级 6   │    │ 升级 7      │
                     │ 选择写入  │    │ staleness   │
                     └──────────┘    └─────────────┘

        ─── 独立可并行 ───

  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐
  │ 升级 4   │  │ 升级 8   │  │ 升级 9   │  │ 升级 10  │
  │ Fork     │  │ 共享记忆  │  │ AgentLoop│  │ 权限     │
  │ pattern  │  │          │  │          │  │          │
  └──────────┘  └──────────┘  └──────────┘  └──────────┘
```

### 推荐实施顺序

| Phase | 升级项 | 理由 | 预计工作量 |
|---|---|---|---|
| **Phase 0** | **升级 2**（类型化文件） | 存储层是其他一切的基础 | 2-3 天 |
| **Phase 1a** | **升级 1**（LLM 检索） | 有了类型化文件才能做 manifest | 1-2 天 |
| **Phase 1b** | **升级 5**（双注入） | 和检索同时做，相互依赖 | 1 天 |
| **Phase 1c** | **升级 7**（staleness） | 最简单，几十行代码 | 半天 |
| **Phase 2** | **升级 3**（autoDream） | 依赖类型化文件 | 2-3 天 |
| **Phase 2** | **升级 6**（选择写入） | 和 dream 配合 | 1 天 |
| **Phase 3** | **升级 9**（Agent Loop） | 独立，改主循环 | 2-3 天 |
| **Phase 3** | **升级 10**（权限） | 和 Agent Loop 配合 | 1 天 |
| **Phase 4** | **升级 4**（Fork pattern） | 优化项，最后做 | 2-3 天 |
| **Phase 4** | **升级 8**（共享记忆） | 扩展项，最后做 | 1-2 天 |

**总计：约 2-3 周**（一个人全职）。

---

## 预期效果

### 定性提升

| 维度 | 原版 | 升级后 |
|---|---|---|
| **记忆质量** | 大量琐碎观察淹没重要记忆 | 只存有意义的，定期整理 |
| **行为自然度** | 单步输出，不能自我纠错 | 多步尝试，遇到障碍自动调整 |
| **长期一致性** | 旧认知永远留着，可能矛盾 | dream 主动修正矛盾 |
| **社交深度** | 只记对话内容 | 维护结构化人物档案 |
| **公共认知** | 只靠口口相传 | 共享层自动广播公共事件 |

### 定量估算

| 指标 | 原版 | 升级后 | 来源 |
|---|---|---|---|
| 每步 input token | ~7000 | ~2700 | Fork pattern cache hit |
| 记忆写入频率 | 每步一条 | 每 5-10 步一条 | 选择性写入 gate |
| 记忆总量增速 | O(时间步) | O(实体/事件数) | 类型化文件 + dream 合并 |
| 检索准确率 | embedding cosine ~60% | LLM sidequery ~85% | 经验估计 |
| API 总成本 | 基准 | **-50% ~ -65%** | Fork + 双注入 + 选记 |

---

## 风险与取舍

### 1. 失去的东西

| 原版优势 | 升级后的代价 | 缓解方案 |
|---|---|---|
| **完整记录**（每步都有） | 选记会丢失细节 | 观察缓冲区保留原始流，dream 前可回溯 |
| **importance score** | 没有显式重要性评分 | LLM 检索隐式做了这件事 |
| **多层 reflection** | 只有单层 dream | 如果需要深度反思，可在 dream prompt 里加 "generate higher-level insights" |
| **简单可复现** | LLM sidequery 有随机性 | 固定 temperature=0 + seed |

### 2. 新增的风险

| 风险 | 严重程度 | 缓解 |
|---|---|---|
| **dream 写错文件**（合并时丢信息） | 中 | dream 前 git snapshot，出错可回滚 |
| **LLM 检索遗漏**（sidequery 没选到关键记忆） | 中 | 保留 recency 预过滤作为 fallback |
| **fork cache miss**（system prompt 漂移） | 低 | 字节冻结 shared prefix，不动态生成 |
| **共享记忆冲突**（两个 agent 同时改 _shared/） | 低 | 文件级锁 + last-write-wins |

### 3. 适用性判断

这套升级方案**最适合**：
- 模拟时间长（数天以上）——记忆整合价值高
- agent 数量多（>10）——Fork cache 节省明显
- 需要长期一致人格——类型化记忆保障连续性
- 预算有限——token 节省 50-65%

**不太适合**：
- 短时间模拟（<几小时）——dream 来不及触发
- 强调完整回放——选记会丢细节
- 需要严格可复现——LLM sidequery 有随机性

---

## 结语

这十项升级的核心思路只有一个：

> **把 2023 年用算法做的事，交给 2025 年的模型自己做。**

embedding → LLM sidequery。importance score → LLM 写入 gate。recency decay → LLM dream 主动清理。三维加权公式 → 让模型读个清单自己判断。

斯坦福小镇论文的伟大在于**定义了问题**（agent 需要记忆-反思-规划三环节）。Claude Code 的贡献在于**证明了一条工程路线**（让模型自己承担一切判断，代码只提供工具和约束）。

把两者结合：**保留小镇的问题定义和社会模拟框架，替换为 Claude Code 验证过的工程实现**——这就是升级的本质。
