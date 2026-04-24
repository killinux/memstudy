# Sub-Agent / Fork 依赖图

> 配套文档：`docs/sub-agent-fork.md`

## 文件清单

| 文件 | 内容 |
|---|---|
| `agent-fork-overview.svg` | 手工架构图：5 条路径（fork / 命名 / coordinator / teammate / isolation）+ runAgent 共享层 + 异步输出 |
| `agent-fork-overview.dot` | 上图源码 |
| `layers-AgentTool/` | `AgentTool.tsx` 的分层依赖（2 层）：300 个文件 |
| `layers-forkedAgent/` | `utils/forkedAgent.ts` 的分层依赖（2 层）：292 个文件 |
| `layers-forkSubagent/` | `tools/AgentTool/forkSubagent.ts` 的分层依赖（2 层）：93 个文件 |

## 三个分层图的对比

| 入口 | Layer 1 | Layer 2 | 说明 |
|---|---|---|---|
| **AgentTool.tsx** | 51 | 248 | 工具入口，依赖最广（包含 UI、worktree、teleport、teammate 等所有形态） |
| **forkedAgent.ts** | 20 | 271 | Fork 工具集函数，主要拉入 query.ts、claude.ts、CacheSafeParams 周边 |
| **forkSubagent.ts** | 6 | 86 | **Fork 路径的纯逻辑**——只依赖消息构造、状态查询、coordinator 互斥检查 |

`forkSubagent.ts` 的依赖最少（86 vs 248），印证了 fork 机制的"瘦身"设计：它只是在 AgentTool 的入口处做一个**消息组装** + **配置切换**，真正的执行逻辑完全复用 runAgent / query 这条主链。

## 看图顺序

1. **`agent-fork-overview.svg`** ← 先看这张总览
   - 上半部分是分支决策（FORK / Named / Coordinator）
   - 中间是 runAgent 共享层
   - 右下是 cache safety / isolation 的细节
2. **`layers-forkSubagent/layer-1.svg`** — 看 fork 路径直接依赖的 6 个模块
3. **`layers-AgentTool/layer-1.svg`** — 看 AgentTool 入口依赖的 51 个模块（FORM 形态全景）

## 关键发现

- **AgentTool 是 fork 的入口**，但 fork 的实际"机关"在 forkSubagent.ts（仅 210 行 + 6 个直接依赖）
- **runAgent 是共享层**：fork 和命名子 agent 都汇入 runAgent.ts，差别只在传给它的参数（`useExactTools`、`forkContextMessages`、`override.systemPrompt`）
- **Cache 安全是横切关注点**：CacheSafeParams 通过 `forkedAgent.ts` 集中表达，fork 路径必须满足这 5 个字段字节相同
- **Coordinator 与 fork 互斥**：`forkSubagent.ts:34` 显式拒绝，因为两者都是"编排"角色但模型不同

## 复现命令

```bash
cd /opt/workspace/myclaude/free-code45
madge src/ --ts-config tsconfig.json --extensions ts,tsx,js,jsx --json \
  2>/dev/null > /tmp/deps.json

cd /opt/workspace/myclaude/memstudy
python3 tools/layered-deps.py /tmp/deps.json tools/AgentTool/AgentTool.tsx 2
python3 tools/layered-deps.py /tmp/deps.json utils/forkedAgent.ts 2
python3 tools/layered-deps.py /tmp/deps.json tools/AgentTool/forkSubagent.ts 2
```
