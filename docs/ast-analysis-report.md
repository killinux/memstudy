# AST 分析报告：free-code45

通过 ts-morph 对 free-code45 (Claude Code v2.1.87) 做编程式 AST 分析，量化项目的内部结构。

---

## 方法

### 工具选型

| 工具 | 适用 | 优劣 |
|---|---|---|
| **ts-morph** | TypeScript | 理解 tsconfig + 类型信息，API 友好 |
| tree-sitter | 多语言 | 速度快，但只看语法不看类型 |
| TS Compiler API | TypeScript | 最底层，最强大但繁琐 |
| Python ast | Python | 内置无依赖 |
| jscodeshift | JS/TS | 适合自动重构 |

free-code45 是 TypeScript 项目，且依赖 tsconfig 路径别名，所以 ts-morph 是最佳选择。

### 安装与运行

```bash
mkdir ast-analysis && cd ast-analysis
npm init -y
npm install ts-morph
node analyze.mjs /path/to/free-code45 /tmp/ast-output
```

### 分析维度

1. **每个文件的 export 数** — 找出"上帝模块"
2. **所有 Tool 定义** — 列出全部工具
3. **所有 Command 定义** — 列出全部斜杠命令
4. **函数统计** — async 比例、generator、参数数分布
5. **React 组件统计** — Hook 使用模式
6. **Import 引用排行** — 哪些模块被引用最多

完整脚本见 `tools/ast-analysis/analyze.mjs`。

---

## 总览数据

| 指标 | 数值 |
|---|---|
| 源文件数（src/ 下） | **1,932** |
| 总函数数 | **20,181** |
| 总 export 数 | **8,611** |
| Tool 定义数 | **42** |
| Command 定义数 | **73** |
| React 组件数 | **573** |
| 总 import 语句 | **15,989** |
| 唯一被引模块数 | **3,794** |

---

## 1. 全部 42 个 Tool

通过 AST 分析直接列出 free-code45 注册的**所有**工具：

### 文件操作（5）
- `FileReadTool` — 读文件
- `FileWriteTool` — 写文件
- `FileEditTool` — 字符串替换式编辑
- `NotebookEditTool` — Jupyter notebook 编辑
- `GlobTool` — 文件名匹配

### 命令执行（2）
- `BashTool` — Bash 命令执行
- `PowerShellTool` — PowerShell 命令执行（Windows）

### 搜索（3）
- `GrepTool` — 文本搜索（基于 ripgrep）
- `WebSearchTool` — 网络搜索
- `WebFetchTool` — 网页抓取

### Agent 系统（3）
- `AgentTool` — 子 agent 启动
- `TeamCreateTool` — 创建 agent 团队
- `TeamDeleteTool` — 删除 agent 团队

### 任务管理（6）
- `TaskCreateTool` — 创建任务
- `TaskGetTool` — 查询任务
- `TaskListTool` — 列出任务
- `TaskOutputTool` — 获取任务输出
- `TaskStopTool` — 停止任务
- `TaskUpdateTool` — 更新任务状态

### Todo 管理（1）
- `TodoWriteTool` — Todo 列表

### 用户交互（1）
- `AskUserQuestionTool` — 向用户提问

### Plan 模式（3）
- `EnterPlanModeTool` — 进入 Plan 模式
- `ExitPlanModeV2Tool` — 退出 Plan 模式
- `VerifyPlanExecutionTool` — 验证 Plan 执行

### Worktree（2）
- `EnterWorktreeTool` — 进入 git worktree
- `ExitWorktreeTool` — 退出 worktree

### 调度（4）
- `CronCreateTool` — 创建 cron 任务
- `CronDeleteTool` — 删除 cron 任务
- `CronListTool` — 列出 cron 任务
- `RemoteTriggerTool` — 远程触发

### MCP 集成（3）
- `MCPTool` — MCP 工具调用
- `ListMcpResourcesTool` — 列出 MCP 资源
- `ReadMcpResourceTool` — 读取 MCP 资源

### Skill 系统（1）
- `SkillTool` — Skill 调用

### 团队协作（1）
- `SendMessageTool` — 给 teammate 发消息

### 其他（7）
- `BriefTool` — 简报生成
- `ConfigTool` — 配置管理
- `LSPTool` — LSP 集成
- `ToolSearchTool` — 工具搜索（按需加载）
- `SyntheticOutputTool` — 合成输出（测试用）
- `TungstenTool` — 内部工具
- `TestingPermissionTool` — 权限测试

**洞察**：
- 文件 + 命令是核心（7 个），其余都是扩展功能
- 任务管理工具有 6 个，说明 Claude Code 是为长任务设计的
- 4 个调度工具说明支持后台/定时任务
- 3 个 MCP 工具说明 MCP 是一等公民

---

## 2. 全部 73 个 Command

按类型分组：

### `prompt` 类型（7）— 静态 prompt 模板

```
commit, commit-push-pr, init, init-verifiers, insights, review, statusline
```

最简单的命令：把 prompt 文本喂给 Claude。

### `local` 类型（19）— 同步本地命令

```
advisor, bridge-kick, clear, compact, context, cost, extra-usage, version, ...
```

直接执行本地逻辑，不调用 Claude。如 `/clear` 清除会话、`/cost` 显示成本。

### `local-jsx` 类型（47）— 交互式 JSX 命令

```
add-dir, agents, branch, brief, btw, install, ultrareview, remote-control, ...
```

返回 React 组件渲染交互式界面。这是最常用的命令类型，绝大多数 Claude Code 命令都属于此类。

**洞察**：73 个命令分布说明 Claude Code 把 CLI 当成 GUI 来用——47 个 local-jsx 命令意味着大部分交互都是富 UI 而非纯文本。

---

## 3. 函数特征

### 整体统计

| 特征 | 数量 | 比例 |
|---|---|---|
| 总函数 | 20,181 | 100% |
| async | 2,835 | **14.0%** |
| generator | 50 | 0.2% |
| async generator | 45 | 0.2% |
| arrow function | 9,649 | 47.8% |
| 命名函数 | 10,532 | 52.2% |

**洞察**：
- 14% async 比例对一个 IO 密集项目来说**偏低**——很多同步辅助函数
- async generator 仅 45 个但都是关键函数（包括 `queryLoop`）
- arrow / named 几乎对半，说明代码风格统一

### 参数数分布

| 参数数 | 函数数 | 占比 |
|---|---|---|
| 0 | 6,249 | 31.0% |
| 1 | 10,144 | **50.3%** |
| 2 | 2,518 | 12.5% |
| 3 | 740 | 3.7% |
| 4 | 271 | 1.3% |
| 5 | 118 | 0.6% |
| 6+ | 141 | 0.7% |

**洞察**：
- **81% 的函数参数 ≤ 1**，符合"小函数 + 单一职责"原则
- 多参数函数极少，但有 1 个 17 参的"上帝函数"

### 参数最多的函数

```
processUserInputBase   — 17 参数
```

这是处理用户输入的中枢函数，要承接命令解析、附件处理、权限上下文、agent 状态等多种信息。17 参可能是个重构信号，但放在中枢位置也合理。

---

## 4. Export 最多的文件 Top 10

| Rank | Count | File | 说明 |
|---|---|---|---|
| 1 | 215 | `bootstrap/state.ts` | 全局状态枢纽 |
| 2 | 135 | `entrypoints/sdk/coreSchemas.ts` | SDK 类型定义 |
| 3 | 114 | `utils/messages.ts` | 消息处理工具集 |
| 4 | 94 | `utils/sessionStorage.ts` | 持久化（IMPORTANT 注释最多） |
| 5 | 73 | `entrypoints/agentSdkTypes.ts` | Agent SDK 类型 |
| 6 | 61 | `utils/auth.ts` | 认证工具 |
| 7 | 55 | `ink.ts` | UI 框架入口 |
| 8 | 54 | `utils/teammateMailbox.ts` | 团队邮箱 |
| 9 | 52 | `utils/attachments.ts` | 附件处理 |
| 10 | 51 | `utils/hooks.ts` | Hook 系统 |

**洞察**：
- `bootstrap/state.ts` 215 个 export 是绝对的"上帝模块"，整个应用的全局状态都在这里
- 前 10 中有 7 个是 `utils/`，说明工具函数的复用度很高
- 这个排行和"复杂度 Top 10"几乎不重合——大模块不一定复杂，复杂模块不一定大

---

## 5. 被引用最多的模块 Top 20

| Rank | Count | Module | 类型 |
|---|---|---|---|
| 1 | **761** | `react` | 第三方 |
| 2 | 395 | `react/compiler-runtime` | 第三方 |
| 3 | 254 | `path` | Node 内置 |
| 4 | 240 | `../../ink.js` | 项目内（Ink UI） |
| 5 | 194 | `bun:bundle` | Bun 内置 |
| 6 | 167 | `../../Tool.js` | 项目内（Tool 抽象） |
| 7 | 147 | `../ink.js` | 项目内 |
| 8 | 146 | `fs/promises` | Node 内置 |
| 9 | 128 | `zod/v4` | 第三方（schema） |
| 10 | 127 | `../../commands.js` | 项目内 |
| 11 | 125 | `../../bootstrap/state.js` | 项目内 |
| 12 | 117 | `crypto` | Node 内置 |
| 13 | 104 | `./types.js` | 项目内 |
| 14 | 99 | `services/analytics/index.js` | 项目内 |
| 15 | 95 | `utils/errors.js` | 项目内 |
| 16 | 94 | `../debug.js` | 项目内 |
| 17 | 89 | `bootstrap/state.js` | 项目内 |
| 18 | 89 | `figures` | 第三方（终端图标） |
| 19 | 86 | `utils/log.js` | 项目内 |
| 20 | 84 | `utils/debug.js` | 项目内 |

**洞察**：
- React 被引用 **761 次**——free-code45 实质上是个 React 应用，只不过渲染目标是终端
- `bun:bundle` 被 194 个文件 import — 这是 Bun 的 feature flag 系统，用来做条件编译
- `Tool.js` 被 167 个文件 import — 工具系统是核心抽象
- `bootstrap/state.js` 多种路径写法合计 ~250 次，确认了它是状态枢纽
- 没有任何 commands/* 进入 Top 20 — 命令是叶子模块，不是依赖中心

---

## 6. React 组件分析

### 总览

| 指标 | 数值 |
|---|---|
| 总组件数 | 573 |
| useState 总调用 | 583 |
| useEffect 总调用 | 252 |
| useCallback 总调用 | 171 |
| useMemo 总调用 | 104 |

### 组件复杂度分布（按 Hook 数量）

| 桶 | 组件数 | 比例 |
|---|---|---|
| 0 hooks | 220 | 38.4% |
| 1-5 hooks | 240 | 41.9% |
| 6-15 hooks | 87 | 15.2% |
| 16-30 hooks | 18 | 3.1% |
| 31+ hooks | **8** | 1.4% |

**洞察**：
- 80% 的组件 Hook 数 ≤ 5，是"小组件"
- 但有 8 个组件 Hook 数 > 30，是"巨型组件"

### Hook 使用最多的组件 Top 10

| 组件 | useState | useEffect | useCallback | useMemo | 总 Hook | 文件 |
|---|---|---|---|---|---|---|
| `REPL` | 65 | 38 | 43 | 14 | **371** | `screens/REPL.tsx` |
| `PromptInput` | 17 | 13 | 26 | 26 | 160 | `components/PromptInput/PromptInput.tsx` |
| `Config` | 15 | 2 | 6 | 1 | 67 | `components/Settings/Config.tsx` |
| `ManagePlugins` | 14 | 6 | 5 | 4 | 56 | `commands/plugin/ManagePlugins.tsx` |
| `InstallGitHubApp` | 2 | 2 | 5 | 0 | 39 | `commands/install-github-app/install-github-app.tsx` |
| `LogSelector` | 17 | 8 | 0 | 0 | 38 | `components/LogSelector.tsx` |
| `MCPRemoteServerMenu` | 13 | 1 | 6 | 0 | 34 | `components/mcp/MCPRemoteServerMenu.tsx` |
| `ModeIndicator` | 2 | 2 | 0 | 1 | 34 | `components/PromptInput/PromptInputFooterLeftSide.tsx` |
| `MessagesImpl` | 1 | 2 | 5 | 14 | 30 | `components/Messages.tsx` |
| `VirtualMessageList` | 2 | 2 | 6 | 0 | 30 | `components/VirtualMessageList.tsx` |

**关键发现**：

#### `REPL` 组件是绝对的怪物

- **371 个 hook 调用**（含自定义 hook）
- **65 个 useState**
- **38 个 useEffect**

REPL 是 Claude Code 的主界面，承担：用户输入、消息流、工具调用、状态显示、键盘事件、会话管理、各种弹窗和模式切换……所有交互逻辑都汇集在这一个组件里。

这是经典的"上帝组件"——但在终端 UI 这种环境里，很难像 Web 那样把组件拆得很碎，因为终端是单一全屏视图。这个复杂度可能是不可避免的。

#### `PromptInput` 是次重灾区

160 个 hook，其中 **26 个 useCallback + 26 个 useMemo** 说明做了大量的性能优化（防止不必要的重渲染）。输入框是用户交互最频繁的组件，性能敏感。

---

## 7. 与之前分析的交叉验证

### Export 数 vs 复杂度（lizard 结果）

| 文件 | Export 数 | 高复杂度函数 | 角色 |
|---|---|---|---|
| `bootstrap/state.ts` | 215 | 0 | 大但不复杂（纯数据） |
| `utils/messages.ts` | 114 | 1 (`buildMessageLookups` CCN 38) | 大且有热点 |
| `utils/sessionStorage.ts` | 94 | 6 | **大且复杂**（重灾区） |
| `utils/bash/bashParser.ts` | 少 | **10 个高复杂度** | 小但极复杂（解析器） |

**结论**：
- "大文件"和"复杂文件"是两个不同维度
- bootstrap/state.ts 大但简单——是注册表式代码
- bashParser.ts 不一定是 export 大户但内部极其复杂——是算法核心
- sessionStorage.ts 两个维度都高——既是数据中心又是逻辑热点

### 工具数 vs 命令数 vs 文件数

```
1932 文件
  ├── 42 Tool 定义        (2.2% 文件占比)
  ├── 73 Command 定义     (3.8% 文件占比)
  └── 573 React 组件      (29.7% 文件占比)
```

**洞察**：核心抽象（Tool、Command）只占文件总数的 6%，剩下 94% 是支撑代码——UI、工具函数、类型定义等。这符合"业务逻辑薄、基础设施厚"的健康比例。

---

## 8. AST 分析的方法学价值

相比 grep 和 madge，AST 分析能做到：

| 任务 | grep | madge | AST |
|---|---|---|---|
| 找文件 | ✅ | - | ✅ |
| 找文本模式 | ✅ | - | ✅ |
| 模块依赖 | - | ✅ | ✅ |
| **找所有 export** | 难（需要正则） | - | ✅ 准确 |
| **统计函数特征** | ❌ | - | ✅ |
| **找 React Hook 使用** | 有误报 | - | ✅ |
| **找特定结构（Tool 定义）** | 有误报 | - | ✅ |
| **量化代码模式** | ❌ | - | ✅ |
| 类型信息 | ❌ | ❌ | ✅（ts-morph） |

### 何时用 AST

✅ 好场景：
- 需要精确找到某种**语法结构**（不是文本模式）
- 需要量化**代码风格**（async 比例、参数数分布）
- 需要做**自动化重构**（批量重命名、提取函数）
- 需要生成**统计报告**

❌ 不适合：
- 简单文本搜索（grep 更快）
- 模块关系（madge 直接给依赖图）
- 一次性的探索查询（写脚本成本高）

---

## 9. 完整数据文件

所有原始数据存储在 `reports/ast-analysis/`：

| 文件 | 大小 | 内容 |
|---|---|---|
| `summary.md` | 3KB | 人类可读总结 |
| `tools.json` | 7KB | 42 个 Tool 定义详情 |
| `commands.json` | 12KB | 73 个 Command 定义详情 |
| `functions.json` | 3KB | 函数统计 + Top 20 多参函数 |
| `components.json` | 121KB | 573 个 React 组件统计 |
| `imports.json` | 255KB | 3794 个被引模块的引用次数 |
| `exports.json` | 141KB | 每个文件的 export 数 |

可以用 `jq` 或 Python 进一步查询，例如：

```bash
# 找特定组件
jq '.[] | select(.name == "REPL")' reports/ast-analysis/components.json

# Top 20 最多 export 的文件
jq -r '. | sort_by(.count) | reverse | .[:20] | .[] | "\(.count) \(.file)"' \
  reports/ast-analysis/exports.json

# 找参数数最多的函数
jq '.topByParams[] | "\(.params) \(.name) @ \(.file):\(.line)"' \
  reports/ast-analysis/functions.json
```

---

## 附录：完整脚本

完整的分析脚本在 `tools/ast-analysis/analyze.mjs`，依赖：

```bash
npm install ts-morph
```

可以复用到任何 TypeScript 项目（只需修改 `--tsConfigFilePath`）。
