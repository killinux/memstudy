# free-code45 代码挖掘报告

通过两种方法对 free-code45 (Claude Code v2.1.87) 做横向分析：

1. **架构注释挖掘** — 找出代码中标注的设计决策和"红线"
2. **复杂度分析** — 找出最复杂的函数和模块（项目的"心脏"和"重灾区"）

---

## 第一部分：架构注释挖掘

### 方法

```bash
grep -rn "IMPORTANT:" src/ --include="*.ts" --include="*.tsx"
grep -rn "DO NOT" src/ --include="*.ts" --include="*.tsx"
grep -rn "do not change" src/ --include="*.ts" --include="*.tsx"
```

### 总览数据

| 指标 | 数量 |
|---|---|
| 源文件总数 | 1914 个 .ts/.tsx |
| `IMPORTANT:` 注释 | 93 处，分布在 64 个文件 |
| `IMPORTANT.*do not` 强约束 | 16 处，11 个文件 |
| `HACK/XXX/FIXME` | 4 处（极少，代码质量高） |

### 关键发现

#### 1. 模型行为相关：6 处"不要随便改"的硬性约束

这些注释都指向"修改前必须找模型团队对齐"，是产品安全的红线：

```
src/utils/thinking.ts:100
  // IMPORTANT: Do not change thinking support without notifying the model
  // launch DRI and research. This can greatly affect model quality and bashing.

src/utils/thinking.ts:131
  // IMPORTANT: Do not change adaptive thinking support without notifying the
  // model launch DRI and research.

src/utils/thinking.ts:156
  // IMPORTANT: Do not change default thinking enabled value...

src/utils/effort.ts:41
  // IMPORTANT: Do not change the default effort support...

src/utils/effort.ts:303
  // IMPORTANT: Do not change the default effort level...

src/constants/cyberRiskInstruction.ts:8
  /* IMPORTANT: DO NOT MODIFY THIS INSTRUCTION WITHOUT SAFEGUARDS TEAM REVIEW
   * This instruction is owned by the Safeguards team... */
```

**洞察**：thinking 和 effort 相关的所有默认值都是"敏感参数"。代码注释明确写明改动需要跨团队对齐，说明这些参数经过模型评估确定，随意改动会"silently degrade model quality"。这印证了我们在 [cot-thinking-design.md](cot-thinking-design.md) 中的分析——adaptive thinking 是经过精心设计的默认行为。

#### 2. 跨进程/跨模块约束：状态隔离与共享的边界

```
src/utils/swarm/inProcessRunner.ts:973
  // IMPORTANT: Set permissionMode to 'default' so teammates always get full
  // tool access regardless of the leader's permission mode.
```

**洞察**：子 agent 不继承 leader 的权限模式。这避免了"leader 在受限模式下，团队成员意外被限制"的问题。

```
src/utils/sideQuestion.ts:107
  // IMPORTANT: claude.ts yields one AssistantMessage PER CONTENT BLOCK,
  // not one per API response. With adaptive thinking enabled (inherited
  // from the main thread to preserve the cache key)...
```

**洞察**：流式响应中"一条消息一个 content block"是一个容易踩坑的语义。子 agent 必须继承父级的 thinking 配置以保证 cache key 一致——这印证了我们在 agent-loop 文档中的发现。

#### 3. 安全相关：路径、命令、权限

```
src/utils/permissions/filesystem.ts:614
  /* IMPORTANT: This function checks BOTH the original path AND resolved
   * symlink paths to prevent bypasses via symlinks pointing to protected files. */

src/utils/permissions/filesystem.ts:1428
  // IMPORTANT: Include both the symlink path and resolved path so subsequent
  // checks pass

src/utils/managedEnvConstants.ts:88
  /* IMPORTANT: This is the source of truth for which env vars are safe.
   * Any env var NOT in this list is considered dangerous and will trigger
   * a security dialog when set via remote managed settings. */

src/utils/bash/commands.ts:491
  // IMPORTANT: Bash commands may run multiple commands that are chained together.
  // For safety, if the command seems to contain command injection, you must
  // return "command_injection_detected".
```

**洞察**：权限系统对 symlink 攻击有专门防御。路径检查同时检查"原路径"和"resolved 路径"，防止用户通过 `ln -s /etc/passwd ./safe.txt` 这种方式绕过。

#### 4. 跨平台兼容：Windows/Linux/macOS 约束

```
src/utils/secureStorage/macOsKeychainHelpers.ts:25
  // DO NOT change this value — it's part of the keychain lookup key
  // and would orphan existing stored credentials.

src/utils/tmuxSocket.ts:21
  /* IMPORTANT: The user's original TMUX env var is NOT used. After socket
   * initialization, getClaudeTmuxEnv() returns a value that overrides... */
```

**洞察**：很多"DO NOT change"是为了**向后兼容**——一个常量看似可以重命名，但实际上它是数据迁移的桥梁。

#### 5. API 协议约束

```
src/utils/fingerprint.ts:43
  /* IMPORTANT: Do not change this method without careful coordination with
   * 1P and 3P (Bedrock, Vertex, Azure) APIs. */
```

**洞察**：用户指纹算法跨多个 provider，修改会破坏跨 provider 的一致性。

#### 6. 性能/稳定性陷阱

```
src/utils/imageResizer.ts:288
  // IMPORTANT: Always create fresh sharp(imageBuffer) instances for each operation.
  // The native image-processor-napi module doesn't properly apply format
  // conversions when reusing a sharp instance...

src/components/Spinner.tsx:287
  // IMPORTANT: we need this width="100%" to avoid an Ink bug where the
  // tip gets duplicated over and over while the spinner is running...
```

**洞察**：这些都是"我踩过的坑"——通过注释把陷阱固化到代码里，避免后人重蹈覆辙。

#### 7. 数据一致性

```
src/utils/sessionStorage.ts:131
  /* IMPORTANT: This is the single source of truth for what constitutes
   * a transcript message. */

src/utils/sessionStorage.ts:4353
  // IMPORTANT: We deliberately filter out most attachments for non-ants because
  // they have sensitive info for training that we don't want exposed to the public.
```

**洞察**：sessionStorage.ts 是数据持久化的核心，注释明确标注了"single source of truth"模式。"non-ants"过滤暴露了一个细节：内部用户和外部用户的会话存储格式有差异，目的是防止训练数据泄露。

### 注释挖掘的方法学价值

通过 93 个 IMPORTANT 注释，可以快速建立起项目的"心智地图"：

| 类别 | 数量 | 含义 |
|---|---|---|
| 模型行为约束 | 6 | 改动需要跨团队对齐 |
| 安全/权限 | 8 | 防止绕过的关键路径 |
| 跨进程/状态 | 5 | 状态隔离边界 |
| 跨平台兼容 | 4 | 不能动的常量/字段 |
| API 协议 | 3 | 跨 provider 一致性 |
| 性能陷阱 | 5 | 已知 bug 的 workaround |
| 数据一致性 | 4 | source of truth 模式 |
| Prompt 工程 | 60+ | 给模型的指令，不是给人的 |

注意：60+ 是 prompt 文件里的 IMPORTANT，那些是给 Claude 模型看的 prompt 内容（如"IMPORTANT: Always use this scratchpad directory..."），不是设计约束。挖掘时需要分清两种 IMPORTANT。

---

## 第二部分：复杂度分析

### 方法

```bash
lizard src/ -l typescript --CCN 30 -w
```

参数：
- `-l typescript` — 只分析 TS 文件
- `--CCN 30` — 圈复杂度阈值 30（高于此值告警）
- `-w` — 仅显示告警

### 总览数据

| 指标 | 数值 |
|---|---|
| 总有效代码行 | 280,594 NLOC |
| 函数总数 | 12,271 |
| 平均圈复杂度 | 3.0 |
| 平均函数行数 | 11.6 |
| 高复杂度函数数（CCN > 15） | 282 |
| 极高复杂度（CCN > 30） | 77 |

**对比基准**：业界平均圈复杂度约 4-6。free-code45 平均 3.0 属于**非常健康**的水平。但有 77 个函数复杂度爆表，这些就是"项目的雷区"。

### 圈复杂度 Top 20（最复杂的函数）

| 排名 | 函数 | CCN | NLOC | 文件 |
|---|---|---|---|---|
| 1 | `peek` | 229 | 565 | utils/bash/bashParser.ts:1719 |
| 2 | `parseDoGroup` | 176 | 445 | utils/bash/bashParser.ts:3306 |
| 3 | `ansi256FromRgb` | 164 | 763 | native-ts/color-diff/index.ts:105 |
| 4 | `parseExpansionRest` | 129 | 298 | utils/bash/bashParser.ts:2807 |
| 5 | `parseTestNegatablePrimary` | 120 | 248 | utils/bash/bashParser.ts:3791 |
| 6 | `stringWidthJavaScript` | 92 | 140 | ink/stringWidth.ts:20 |
| 7 | `isDangerousRemovalRawPath` | 87 | 1111 | tools/PowerShellTool/pathValidation.ts:840 |
| 8 | `checkResponseForCacheBreak` | 84 | 174 | services/api/promptCacheBreakDetection.ts:437 |
| 9 | `layoutNode` | 81 | 258 | native-ts/yoga-layout/index.ts:1058 |
| 10 | `getLanguageFromPath` | 79 | 222 | commands/insights.ts:462 |
| 11 | `walkArgument` | 76 | 159 | utils/bash/ast.ts:605 |
| 12 | `isCommandSafeViaFlagParsing` | 73 | 553 | tools/BashTool/readOnlyValidation.ts:1246 |
| 13 | `parseSimpleCommand` | 72 | 229 | utils/bash/bashParser.ts:1141 |
| 14 | `isTextBreaker` | 70 | 230 | utils/collapseReadSearch.ts:331 |
| 15 | `parseCasePatternSegmented` | 64 | 235 | utils/bash/bashParser.ts:3525 |
| 16 | `classifyAPIError` | 63 | 157 | services/api/errors.ts:964 |
| 17 | `useVirtualScroll` | 62 | 213 | hooks/useVirtualScroll.ts:142 |
| 18 | `mapKey` | 58 | 115 | hooks/useTextInput.ts:318 |
| 19 | `validateFlagArgument` | 57 | 153 | utils/shell/readOnlyCommandValidation.ts:1649 |
| 20 | `flushGroup` | 57 | 133 | utils/collapseReadSearch.ts:770 |

### 高复杂度文件 Top 10

| 文件 | 高复杂度函数数 | 类型 |
|---|---|---|
| `utils/bash/bashParser.ts` | 10 | Bash 语法解析器 |
| `commands/insights.ts` | 8 | 使用统计分析 |
| `utils/sessionStorage.ts` | 6 | 会话持久化 |
| `utils/attachments.ts` | 5 | Attachment 处理 |
| `ink/styles.ts` | 5 | UI 样式计算 |
| `utils/shell/readOnlyCommandValidation.ts` | 4 | Shell 命令验证 |
| `utils/plugins/mcpbHandler.ts` | 4 | MCP bundle 处理 |
| `utils/collapseReadSearch.ts` | 4 | 工具结果压缩 |
| `ink/selection.ts` | 4 | 终端选择 |
| `utils/permissions/filesystem.ts` | 3 | 文件权限检查 |

### 关键发现

#### 1. Bash 解析器是项目"最复杂的山头"

`utils/bash/bashParser.ts` 一个文件就有 10 个高复杂度函数，圈复杂度 Top 5 中占了 4 个。

**为什么这么复杂**：

Bash 是一个语法极其丰富的语言：
- Heredoc (`<<EOF`)
- Process substitution (`<(cmd)`, `>(cmd)`)
- Brace expansion (`{a,b,c}`)
- Parameter expansion (`${var:-default}`, `${var//pattern/replace}`)
- Command substitution (`$(cmd)`, `\`cmd\``)
- Arithmetic expansion (`$((expr))`)
- Test commands (`[`, `[[`, `(`, `((` 各有不同语法)
- Here strings (`<<<`)

要正确解析所有这些结构，必须处理大量的状态和分支。`peek()` 函数（CCN 229）是 lookahead 解析的核心，它需要在不消耗 token 的前提下"偷看"接下来是什么语法结构——这是递归下降解析器最复杂的部分。

**为什么不用第三方解析器**：可能是为了精确控制错误处理和安全检查。Bash 解析的结果直接喂给权限验证（判断命令是否危险），需要保证每个语法节点都能被审查。

#### 2. 安全验证集中在少数几个"巨型函数"

| 函数 | CCN | 作用 |
|---|---|---|
| `isDangerousRemovalRawPath` | 87 | PowerShell 路径删除安全检查 |
| `isCommandSafeViaFlagParsing` | 73 | Bash 命令通过 flag 解析判断只读 |
| `validateFlagArgument` | 57 | Shell flag 参数验证 |
| `isGitSafe` | 54 | PowerShell git 命令安全 |

这些函数本质上是**白名单 + 黑名单 + 规则引擎**的混合体。每个分支对应一个安全场景：

```typescript
// 伪代码示意
function isDangerousRemovalRawPath(path) {
  if (path === '/') return DANGEROUS
  if (path === 'C:\\') return DANGEROUS
  if (path === '~' || path === '~/') return DANGEROUS
  if (matchGlob(path, ['/etc/*', '/usr/*', ...])) return DANGEROUS
  if (isSymlink(path) && resolvedPath.startsWith('/etc')) return DANGEROUS
  if (containsWildcard(path)) {
    if (parentDirIsRoot) return DANGEROUS
    if (containsRecursiveWildcard) {
      // 50+ 行的递归判断
    }
  }
  // ... 持续 1000+ 行
}
```

**洞察**：这种"巨型安全函数"在防御编程中很常见。每一个 if 分支都对应一个真实发生过的攻击案例或边界情况。复杂度高不代表代码差——可能恰恰相反，说明经过了大量真实场景考验。

#### 3. 终端 UI 渲染（Ink）的内在复杂性

| 函数 | CCN | 作用 |
|---|---|---|
| `stringWidthJavaScript` | 92 | 计算字符串视觉宽度 |
| `layoutNode` | 81 | Flexbox 布局计算 |
| `diffEach` | 44 | 屏幕 diff |
| `renderChildren` | 47 | 节点渲染 |

终端 UI 比 Web UI 更复杂，因为：
- 字符宽度不固定（CJK 是 2 倍宽，emoji 不规律）
- 没有像浏览器那样的 GPU 加速排版
- 必须自己实现 flexbox 布局
- 需要计算屏幕 diff 决定增量更新

`stringWidthJavaScript` 复杂度 92 的原因：要识别 CJK、emoji、组合字符（combining mark）、ZWJ 序列、控制字符、ANSI escape 等等所有可能影响宽度的字符。

#### 4. query.ts 的核心循环也在 Top 50

```
src/query.ts:671  ...  CCN 44, NLOC 217
```

这是 `queryLoop` 内的一个内部函数（流式处理逻辑）。CCN 44 不算极高，但放在 query.ts 这个本身就很大的文件里，说明它是协调中枢的复杂点。

考虑到 query.ts 要处理：
- 流式响应的多种事件类型
- 工具调用的并发/串行
- 各种中断和恢复路径
- 多种循环停止条件
- 错误重试和降级

CCN 44 已经算克制了。

#### 5. PowerShell 工具复杂度堪比 Bash

很多人不知道 free-code45 还专门支持 PowerShell：

```
tools/PowerShellTool/pathValidation.ts        — 4 个高复杂度函数
tools/PowerShellTool/powershellSecurity.ts    — 3 个
tools/PowerShellTool/readOnlyValidation.ts    — 3 个
tools/PowerShellTool/gitSafety.ts             — 1 个 (CCN 139)
```

PowerShell 比 Bash 还要"奇葩"——cmdlet 命名、属性访问、管道对象传递都和 Unix 不同。代码里有专门的 PowerShell 安全验证层，复杂度和 Bash 不相上下。

这说明 free-code45 对 Windows 用户的支持是认真的，不是简单的"凑合用"。

#### 6. 复杂度的"健康分布"

```
高复杂度（CCN > 30）的 77 个函数中：
  - 解析器（Bash/PowerShell）   : 25 个 (32%)
  - 安全验证                    : 18 个 (23%)
  - UI 渲染（Ink）              : 12 个 (16%)
  - 工具实现（具体业务）         : 10 个 (13%)
  - 其他（统计、网络、配置）      : 12 个 (16%)
```

**洞察**：高复杂度集中在三类"本质上就复杂"的领域——**解析器、安全、UI 渲染**。业务逻辑代码反而很简洁。这是健康的复杂度分布——把复杂性隔离在专门的模块里，而不是散布全代码库。

---

## 综合洞察

### 1. 注释挖掘和复杂度分析的互补

| 维度 | 注释挖掘 | 复杂度分析 |
|---|---|---|
| 看到的 | 设计意图、跨团队约束、踩过的坑 | 代码量化指标、热点位置 |
| 看不到的 | 没注释的复杂代码 | 注释里的设计决策 |
| 适合 | 理解"为什么这样设计" | 找到"哪里值得深入" |

两种方法结合：

- **复杂度告诉你"哪里**：bashParser.ts 复杂度爆表
- **注释告诉你"为什么"**：bashPermissions.ts 的 IMPORTANT 注释解释了为什么需要解析（安全验证）
- **注释 × 复杂度**：在两个维度都高的文件，是最"危险"也最"重要"的代码

### 2. free-code45 的代码质量观察

**优点**：
- 平均圈复杂度 3.0，远低于业界平均
- HACK/FIXME 极少（4 处），说明没有大量技术债
- IMPORTANT 注释多达 93 处，设计意图被充分文档化
- 复杂度集中在"本质上复杂"的模块（解析器、安全、UI），业务逻辑很干净

**值得警惕**：
- bashParser.ts 一个文件 10 个高复杂度函数，是单点维护风险
- 安全验证函数有 1000+ 行的"巨型 if 链"，难以审查
- PowerShell 支持代码量大但用户群相对小，维护成本高

### 3. 学习这个项目的"地图"

如果想深入 free-code45，按照注释挖掘 + 复杂度分析的结果，最值得先读的 10 个文件：

| 优先级 | 文件 | 原因 |
|---|---|---|
| P0 | `query.ts` | 主循环，所有功能的入口 |
| P0 | `services/api/claude.ts` | API 调用核心 |
| P0 | `Tool.ts` | 工具系统抽象 |
| P1 | `tools/BashTool/bashPermissions.ts` | 复杂度高 + 安全关键 |
| P1 | `utils/bash/commands.ts` | 1180 NLOC + 注释多 |
| P1 | `utils/permissions/filesystem.ts` | 路径权限核心 |
| P1 | `utils/thinking.ts` + `utils/effort.ts` | IMPORTANT 注释最多 |
| P2 | `utils/messages.ts` | 消息处理中枢 |
| P2 | `services/compact/compact.ts` | 上下文压缩核心 |
| P2 | `utils/sessionStorage.ts` | 持久化 + IMPORTANT 注释多 |

---

## 附录：可复现的命令

```bash
# 注释挖掘
grep -rn "IMPORTANT:" src/ --include="*.ts" --include="*.tsx"
grep -rn "DO NOT" src/ --include="*.ts" --include="*.tsx"
grep -rn "do not change\|do not modify" src/ -i

# 复杂度分析
pip install lizard
lizard src/ -l typescript                     # 完整报告
lizard src/ -l typescript --CCN 30            # 只显示 CCN > 30 的告警
lizard src/ -l typescript --CCN 30 -w | wc -l # 高复杂度函数数量
lizard src/ -l typescript --sort cyclomatic_complexity | head -50

# 高复杂度文件排行
lizard src/ -l typescript --CCN 30 -w | awk -F: '{print $1}' | sort | uniq -c | sort -rn
```
