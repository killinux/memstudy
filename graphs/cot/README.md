# CoT / Extended Thinking 模块依赖图

基于 free-code45 (Claude Code v2.1.87) 源码，分析 Extended Thinking 系统的依赖关系。

## 图文件说明

### 手工精选图

**`cot-overview.svg`** — CoT 三层架构全景图

展示 thinking.ts、effort.ts、attachments.ts 三个核心模块如何协作，以及它们与 API 层、UI 层、压缩系统的关系。

#### 模块分组（subgraph）

图中分为 4 个区域，每个区域对应系统的一个层次：

##### Core: Three-Layer Thinking System（核心三层）

| 节点 | 颜色 | 职责 |
|---|---|---|
| `thinking.ts` | 红色 | **第一层：思考模式控制。** 定义 ThinkingConfig 类型（adaptive/enabled/disabled），检测模型是否支持 thinking 和 adaptive thinking，检测 ultrathink 关键词 |
| `effort.ts` | 橙色 | **第二层：思考深度控制。** 管理 4 个 effort 等级（low/medium/high/max），实现优先级链（env → appState → 模型默认），为 Opus 4.6 设置默认 medium |
| `attachments.ts` | 黄色 | **第三层：Ultrathink 触发器。** 检测用户输入中的 "ultrathink" 关键词，生成 `ultrathink_effort` attachment，临时将 effort 提升到 high |

**核心关系**：
- `effort.ts → thinking.ts`：effort 需要调用 `isUltrathinkEnabled()` 来决定默认 effort 是否设为 medium
- `attachments.ts → thinking.ts`：attachment 需要调用 `hasUltrathinkKeyword()` 检测关键词

##### API Layer: Request & Response（API 层）

| 节点 | 颜色 | 职责 |
|---|---|---|
| `claude.ts` | 蓝色 | **API 请求组装。** 根据 ThinkingConfig 和模型能力，决定发送 `{ type: 'adaptive' }` 还是 `{ type: 'enabled', budget_tokens: N }`；处理流式响应中的 thinking_delta 和 signature_delta 事件 |
| `utils/context.ts` | 蓝色 | **Token 预算计算。** `getMaxThinkingTokensForModel()` 返回各模型的 thinking 预算上限（如 Opus 4.6 = 127,999） |
| `betas.ts` | 蓝色 | **Beta Header 管理。** 控制 REDACT_THINKING（隐藏思考内容加速 TTFT）和 EFFORT beta header |

**核心关系**：
- `claude.ts → thinking.ts`：调用 `modelSupportsThinking()` 和 `modelSupportsAdaptiveThinking()` 决定 thinking 参数
- `claude.ts → effort.ts`：调用 `resolveAppliedEffort()` 获取最终 effort 值
- `claude.ts → utils/context.ts`：获取 thinking token 预算
- `claude.ts → betas.ts`：获取 REDACT_THINKING 和 EFFORT beta header

##### Consumers: UI & Agents（消费者）

| 节点 | 颜色 | 职责 |
|---|---|---|
| `PromptInput.tsx` | 绿色 | **输入框 UI。** 检测 ultrathink 关键词并显示彩虹色文字；显示 effort 等级通知 |
| `AssistantThinkingMessage` | 绿色 | **Thinking 块渲染。** 显示 `∴ Thinking` 标签，默认折叠，`Ctrl+O` 展开查看完整思考内容 |
| `RedactedThinkingMessage` | 绿色 | **Redacted 渲染。** 显示 `✻ Thinking…`，内容不可见（API 端跳过了摘要以加速响应） |
| `AgentTool/runAgent.ts` | 绿色 | **子 Agent 策略。** Fork 子 agent 继承父级 ThinkingConfig（为了 cache 命中），普通子 agent 禁用 thinking（控制成本） |
| `REPL.tsx` | 绿色 | **会话初始化。** 在启动时根据用户设置和环境变量构建初始 ThinkingConfig |

##### Support: Messages & Compact（支撑）

| 节点 | 颜色 | 职责 |
|---|---|---|
| `messages.ts` | 紫色 | **消息规范化。** 过滤尾部 thinking 块（API 不接受以 thinking 结尾的 assistant 消息）；将 ultrathink_effort attachment 转为 system reminder；清理过期签名 |
| `compact/` | 紫色 | **压缩系统。** 计算 thinking 块的 token 数（redacted_thinking 计为 0）；压缩后清理 thinking 相关缓存 |

#### 边的含义

- **实线箭头**：直接依赖（import 关系），标注了调用的关键函数
- **虚线箭头**：间接或运行时关系（消息处理流程中的数据流）

#### 如何阅读这张图

1. **从上往下**：Core → API → Consumers/Support，对应数据流向
2. **三个红/橙/黄节点是核心**：thinking.ts 控制"是否思考"，effort.ts 控制"思考多深"，attachments.ts 是用户触发入口
3. **蓝色 claude.ts 是枢纽**：所有配置在这里汇合，组装成 API 请求参数
4. **绿色节点是终端**：UI 展示和子 agent 策略，是思考系统的最终消费者
5. **边上的标注**：每条边标注了调用的关键函数名，可以直接在源码中搜索

#### 实际数据流示例

用户输入 `"ultrathink 帮我重构"` 时的数据流：

```
用户输入
  │
  ├──→ attachments.ts: hasUltrathinkKeyword() → true
  │    创建 { type: 'ultrathink_effort', level: 'high' }
  │
  ├──→ PromptInput.tsx: "ultrathink" 显示彩虹色
  │
  ├──→ messages.ts: attachment → system reminder
  │    "The user has requested reasoning effort level: high"
  │
  └──→ claude.ts:
       ├── thinking.ts: modelSupportsAdaptiveThinking() → true
       │   → thinking: { type: 'adaptive' }
       ├── effort.ts: resolveAppliedEffort() → 'high'
       │   → output_config.effort: 'high'
       └── 发送 API 请求
            │
            ← thinking_delta 流式返回
            ← signature_delta
            ← text_delta
            │
            └──→ AssistantThinkingMessage: 渲染 thinking 块
```

#### 生成方式

```bash
dot -Tsvg cot-overview.dot -o cot-overview.svg
```

---

### 分层依赖图

分别从 `thinking.ts` 和 `effort.ts` 两个入口生成分层图。

#### `layers-thinking/` — thinking.ts 的依赖层级

从 thinking.ts 出发 BFS 展开 3 层，共 117 个文件。

| 文件 | 节点数 | 内容 |
|---|---|---|
| `overview.svg` | 117 | 全局概览 |
| `layer-0.svg` | 1 | 入口：`thinking.ts` |
| `layer-1.svg` | 6 | 直接依赖：growthbook.ts, model.ts, modelSupportOverrides.ts, providers.ts, settings.ts, theme.ts |
| `layer-2.svg` | 41 | 二级依赖：config.ts, auth.ts, envUtils.ts 等 |
| `layer-3.svg` | 69 | 三级依赖：Tool.ts, messages.ts, AppState.tsx 等 |

**关键发现**：
- thinking.ts 的直接依赖只有 6 个，非常精简
- 主要依赖是模型能力检测（model.ts, providers.ts）和特性开关（growthbook.ts）
- 不直接依赖 effort.ts（反过来 effort.ts 依赖 thinking.ts）

#### `layers-effort/` — effort.ts 的依赖层级

从 effort.ts 出发 BFS 展开 2 层，共 59 个文件。

| 文件 | 节点数 | 内容 |
|---|---|---|
| `overview.svg` | 59 | 全局概览 |
| `layer-0.svg` | 1 | 入口：`effort.ts` |
| `layer-1.svg` | 8 | 直接依赖：thinking.ts, auth.ts, envUtils.ts, growthbook.ts, settings.ts 等 |
| `layer-2.svg` | 50 | 二级依赖 |

**关键发现**：
- effort.ts 依赖 thinking.ts（调用 isUltrathinkEnabled），形成 effort → thinking 的单向依赖
- 还依赖 auth.ts（判断用户订阅类型：Pro/Max/Team，决定默认 effort）
- 比 thinking.ts 多了 2 个直接依赖，因为需要更多用户上下文

#### 颜色含义（分层图通用）

| 颜色 | 层级 |
|---|---|
| 红色 | Layer 0 — 入口 |
| 橙色 | Layer 1 — 直接依赖 |
| 黄色 | Layer 2 — 二级依赖 |
| 绿色 | Layer 3 — 三级依赖 |

#### 生成方式

```bash
# 导出依赖 JSON（以 thinking.ts 为入口）
madge src/utils/thinking.ts --ts-config tsconfig.json \
  --extensions ts,tsx,js,jsx --json 2>/dev/null > deps.json

# 分层生成
python3 tools/layered-deps.py deps.json thinking.ts 3
python3 tools/layered-deps.py deps.json effort.ts 2
```

---

## 两个入口的反向依赖（谁在使用它们）

### thinking.ts 的 11 个消费者

```
services/api/claude.ts       ← API 请求组装（核心）
utils/effort.ts              ← effort 系统调用 isUltrathinkEnabled
utils/attachments.ts         ← ultrathink 关键词检测
screens/REPL.tsx             ← 会话初始化 ThinkingConfig
state/AppStateStore.ts       ← 状态管理
Tool.ts                      ← 工具系统
components/PromptInput.tsx   ← 输入框 UI（彩虹色）
components/HighlightedThinkingText.tsx ← 思考文本高亮
services/api/withRetry.ts    ← 重试逻辑
buddy/useBuddyNotification   ← Buddy 通知
components/tasks/RemoteSession ← 远程会话
```

### effort.ts 的 22 个消费者

effort 的消费者是 thinking 的两倍，因为 effort 直接影响 UI 展示（Logo、Spinner、ModelPicker 等多个组件都需要显示当前 effort 等级）。
